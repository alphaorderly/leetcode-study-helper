import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import type { SubmissionFileSnapshot } from '../../../shared/contracts';
import {
  githubRequestNeedsSignIn,
  parseConsistentRemote,
  resolveCanonicalRemoteName,
  type GitHubSubmissionClient,
  type RemoteSubmissionState,
} from '../../github/githubSubmissionClient';
import { getRefRelation } from '../refRelation';
import type { SubmissionSolution } from './submissionFiles';
import { SubmissionHistory } from './submissionHistory';
import {
  collectBlockingTrackedFiles,
  projectSubmissionStatuses,
  singleWeek,
  weekBranchName,
  weekFromBranch,
} from './submissionModel';
import {
  buildReadySubmission,
  buildUnavailableSubmission,
  projectLocalSubmission,
  type LocalSubmissionContext,
  type SubmissionStatusResult,
} from './submissionSnapshot';
import { addRelativeChangePaths, relativeGitPath, type GitRepository } from '../vscodeGit';

/** 로컬 Git, GitHub, 파일 해시를 순서대로 읽고 순수 상태 조립 함수에 전달합니다. */
export class SubmissionStatusReader {
  private readonly history = new SubmissionHistory();

  /** 원격 제출 상태 조회에 사용할 GitHub 클라이언트를 보관합니다. */
  constructor(private readonly githubClient: GitHubSubmissionClient) {}

  /** 원격 오류가 발생해도 이미 읽은 로컬 제출 정보를 반환합니다. */
  async read(
    repository: GitRepository,
    solutions: readonly SubmissionSolution[],
    forceRemote: boolean,
  ): Promise<SubmissionStatusResult> {
    const context = await this.readLocalState(repository, solutions);
    const {
      files,
      fileByPath,
      indexPaths,
      workingPaths,
      conflictPaths,
      pendingPaths,
      requestedSubmissionBranch,
      branch,
    } = context;
    const origin = repository.state.remotes.find(({ name }) => name === 'origin');
    const parsedOrigin = parseConsistentRemote(origin);
    const fork = parsedOrigin
      ? await this.githubClient.getForkIdentity(parsedOrigin, forceRemote)
      : {
          status: 'unsupported' as const,
          reason: 'origin의 fetch/push URL이 동일한 GitHub 저장소를 가리키지 않습니다.',
        };
    if (fork.status !== 'verified' || !parsedOrigin) {
      return buildUnavailableSubmission(context, fork);
    }
    let remote: RemoteSubmissionState;
    try {
      remote = await this.githubClient.getRemoteSubmission(
        parsedOrigin,
        requestedSubmissionBranch,
        forceRemote,
      );
    } catch (error) {
      return buildUnavailableSubmission(context, {
        ...fork,
        reason: error instanceof Error ? error.message : String(error),
        needsGitHubSignIn: githubRequestNeedsSignIn(error),
      });
    }
    const canonicalMatchingPaths = await this.getCanonicalMatchingPaths(
      files,
      remote.canonicalFileHashes,
    );
    const projected = projectSubmissionStatuses({
      files,
      indexPaths,
      workingPaths,
      conflictPaths,
      pendingPaths,
      remote,
      canonicalMatchingPaths,
    });
    const remotePaths = new Set(remote.compareFiles.map(({ filename }) => filename));
    const remoteCommits = await this.history.getRemoteCommits(
      repository,
      remote.compareCommits,
      remotePaths,
      fileByPath,
    );
    let hasBlockingOriginCommits = false;
    if (branch === 'main') {
      try {
        const originRelation = await getRefRelation(repository, 'origin/main');
        hasBlockingOriginCommits = originRelation === 'ahead' || originRelation === 'diverged';
      } catch {
        hasBlockingOriginCommits = false;
      }
    }
    let hasCanonicalRemote: boolean;
    try {
      hasCanonicalRemote = resolveCanonicalRemoteName(repository.state.remotes) !== undefined;
    } catch {
      hasCanonicalRemote = false;
    }
    return buildReadySubmission(context, {
      fork,
      remote,
      remoteCommits,
      ...projected,
      hasBlockingOriginCommits,
      hasCanonicalRemote,
      hasDirtyTrackedState:
        repository.state.indexChanges.length > 0 ||
        repository.state.workingTreeChanges.length > 0 ||
        repository.state.mergeChanges.length > 0,
      hasUntrackedChanges: repository.state.untrackedChanges.length > 0,
      rebaseInProgress: Boolean(repository.state.rebaseCommit),
    });
  }

  /** 원격 요청을 보내기 전에 로컬 경로, 주차와 미푸시 이력을 수집합니다. */
  private async readLocalState(
    repository: GitRepository,
    solutions: readonly SubmissionSolution[],
  ): Promise<LocalSubmissionContext> {
    const files = solutions.map((solution): SubmissionFileSnapshot => ({
      ...solution,
      relativePath: relativeGitPath(repository.rootUri, vscode.Uri.parse(solution.uri)),
    }));
    const fileByPath = new Map(files.map((file) => [file.relativePath, file]));
    const indexPaths = new Set<string>();
    const workingPaths = new Set<string>();
    const trackedWorkingPaths = new Set<string>();
    const conflictPaths = new Set<string>();
    addRelativeChangePaths(indexPaths, repository.rootUri, repository.state.indexChanges);
    addRelativeChangePaths(
      trackedWorkingPaths,
      repository.rootUri,
      repository.state.workingTreeChanges,
    );
    addRelativeChangePaths(workingPaths, repository.rootUri, [
      ...repository.state.workingTreeChanges,
      ...repository.state.untrackedChanges,
    ]);
    addRelativeChangePaths(conflictPaths, repository.rootUri, repository.state.mergeChanges);

    const stagedFiles = files.filter(({ relativePath }) => indexPaths.has(relativePath));
    const otherStagedFiles = [...indexPaths].filter(
      (relativePath) => !fileByPath.has(relativePath),
    );
    const blockingTrackedFiles = collectBlockingTrackedFiles(
      indexPaths,
      trackedWorkingPaths,
      conflictPaths,
      new Set(fileByPath.keys()),
    );
    const branch = repository.state.HEAD?.name;
    const stagedWeek = singleWeek(stagedFiles);
    const currentBranchWeek = weekFromBranch(branch);
    const requestedSubmissionBranch = currentBranchWeek
      ? branch
      : stagedWeek
        ? weekBranchName(stagedWeek)
        : undefined;
    let canonicalRemoteName: string | undefined;
    try {
      canonicalRemoteName = resolveCanonicalRemoteName(repository.state.remotes);
    } catch {
      canonicalRemoteName = undefined;
    }
    const local = await this.history.getLocalPendingCommits(
      repository,
      fileByPath,
      currentBranchWeek,
      canonicalRemoteName,
    );

    return {
      files,
      fileByPath,
      indexPaths,
      workingPaths,
      conflictPaths,
      stagedFiles,
      otherStagedFiles,
      blockingTrackedFiles,
      branch,
      currentBranchWeek,
      requestedSubmissionBranch,
      canonicalRemoteName,
      local,
      ...projectLocalSubmission({
        files,
        indexPaths,
        workingPaths,
        conflictPaths,
        stagedFiles,
        currentBranchWeek,
        local,
      }),
    };
  }

  /** 로컬 파일의 Git blob 해시가 공식 파일 해시와 같은 경로만 반환합니다. 읽기 실패는 일치로 보지 않습니다. */
  private async getCanonicalMatchingPaths(
    files: readonly SubmissionFileSnapshot[],
    canonicalHashes: ReadonlyMap<string, string> | undefined,
  ): Promise<ReadonlySet<string>> {
    if (!canonicalHashes) {
      return new Set();
    }
    const matches = new Set<string>();
    await Promise.all(
      files.map(async (file) => {
        const expectedHash = canonicalHashes.get(file.relativePath);
        if (!expectedHash) {
          return;
        }
        try {
          const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(file.uri));
          const header = Buffer.from(`blob ${bytes.byteLength}\0`);
          const actualHash = createHash('sha1').update(header).update(bytes).digest('hex');
          if (actualHash === expectedHash) {
            matches.add(file.relativePath);
          }
        } catch {
          // A missing or unreadable local file is not proof that the solution was merged.
        }
      }),
    );
    return matches;
  }
}
