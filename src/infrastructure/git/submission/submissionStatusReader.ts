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

/**
 * GitStatusService가 호출하는 표시 전용 조회기입니다. 로컬 파일·이력을 먼저 확보하고
 * 원격 조회를 시도해 GitHub 실패 시에도 이미 읽은 로컬 정보를 보존합니다.
 * 파일 해시 일치 여부와 조회 결과를 순수 함수에 넘겨 화면 스냅샷을 만듭니다.
 * 이 경로에서는 remote 추가·브랜치 전환·push를 하지 않습니다.
 */
export class SubmissionStatusReader {
  private readonly history = new SubmissionHistory();

  /** 원격 제출 상태 조회에 사용할 GitHub 클라이언트를 보관합니다. */
  constructor(private readonly githubClient: GitHubSubmissionClient) {}

  /**
   * 로컬 정보 → 포크 확인 → 원격 상태 → 파일 일치·커밋 조회 → 스냅샷 조립 순서입니다.
   * 포크 미지원·원격 조회 실패는 로컬 상태를 포함한 표시 결과로 반환합니다.
   * 로컬 수집 자체의 예외는 상위 GitStatusService가 처리합니다.
   * @param forceRemote 원격 캐시를 우회할지 여부. 실제 Git status 갱신은 호출자가 담당합니다.
   */
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

  /**
   * 파일 URI를 저장소 상대 경로로 바꾸고 index·작업 파일·충돌·이력을 한 조회 문맥으로 묶습니다.
   * 현재 week 브랜치를 우선하고, main 등에서는 스테이징 파일의 단일 주차로 제출 브랜치를 추론합니다.
   * 공식 remote 탐색 실패는 이름 부재로 남겨 로컬 이력의 대체 기준을 선택할 수 있게 합니다.
   */
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
