import * as vscode from 'vscode';
import type {
  RepositorySubmissionSnapshot,
  SolutionGitStatus,
  SolutionSubmissionStatus,
  SubmissionCommitSnapshot,
  SubmissionFileSnapshot,
} from './core/types';
import {
  GitHubSubmissionClient,
  parseConsistentRemote,
  type GitHubCompareCommit,
  type RemoteSubmissionState,
} from './git/githubSubmissionClient';
import {
  addChangeUris,
  addRelativeChangePaths,
  type GitCommit,
  type GitRepository,
  GitRepositoryAdapter,
  relativeGitPath,
  upstreamRef,
} from './git/vscodeGit';
import { getRefRelation } from './git/refRelation';
import {
  SubmissionActions,
  type SubmissionSolution,
} from './git/submissionActions';
import {
  firstLine,
  localSubmissionStatuses,
  projectSubmissionStatuses,
  singleWeek,
  summaryForStatuses,
} from './git/submissionModel';

export type { SubmissionSolution } from './git/submissionActions';

export interface SolutionGitStatusResult {
  remoteName?: string;
  statuses: ReadonlyMap<string, SolutionGitStatus>;
  submissionStatuses?: ReadonlyMap<string, SolutionSubmissionStatus>;
  pullRequestNumbers?: ReadonlyMap<string, number>;
  submission?: RepositorySubmissionSnapshot;
}

export class GitStatusService implements vscode.Disposable {
  private readonly repositoryAdapter = new GitRepositoryAdapter();
  private readonly githubClient = new GitHubSubmissionClient();
  private readonly submissionActions = new SubmissionActions(
    this.repositoryAdapter,
    this.githubClient,
  );
  readonly onDidChange = this.repositoryAdapter.onDidChange;

  async getStatuses(
    repositoryRoot: vscode.Uri,
    solutionUris: readonly string[],
    forceStatus = false,
    submissionSolutions: readonly SubmissionSolution[] = [],
    forceRemote = false,
  ): Promise<SolutionGitStatusResult> {
    const statuses = new Map(
      solutionUris.map((uri) => [uri, 'unknown' as SolutionGitStatus]),
    );
    if (solutionUris.length === 0) {
      return { statuses };
    }

    const repository = await this.repositoryAdapter.getRepository(repositoryRoot);
    if (!repository) {
      return { statuses };
    }

    try {
      if (forceStatus) {
        await repository.status();
      }
      const upstream = repository.state.HEAD?.upstream;
      const changedUris = new Set<string>();
      const { state } = repository;
      addChangeUris(changedUris, state.mergeChanges);
      addChangeUris(changedUris, state.indexChanges);
      addChangeUris(changedUris, state.workingTreeChanges);
      addChangeUris(changedUris, state.untrackedChanges);

      if (upstream) {
        const committedChanges = await this.repositoryAdapter.getCommittedChanges(
          repository,
          upstream,
        );
        for (const uri of committedChanges) {
          changedUris.add(uri);
        }
      }

      for (const uri of solutionUris) {
        statuses.set(
          uri,
          !upstream
            ? 'unknown'
            : changedUris.has(uri) ? 'unpushed' : 'pushed',
        );
      }
      const submissionResult = submissionSolutions.length > 0
        ? await this.getSubmission(
          repository,
          submissionSolutions,
          forceRemote,
        )
        : undefined;
      return {
        remoteName: upstream?.remote,
        statuses,
        submissionStatuses: submissionResult?.statuses,
        pullRequestNumbers: submissionResult?.pullRequestNumbers,
        submission: submissionResult?.snapshot,
      };
    } catch (error) {
      if (submissionSolutions.length === 0) {
        return { statuses };
      }
      const submissionStatuses = new Map(
        submissionSolutions.map(({ uri }) => [
          uri,
          'unknown' as SolutionSubmissionStatus,
        ]),
      );
      return {
        statuses,
        submissionStatuses,
        pullRequestNumbers: new Map(),
        submission: {
          status: 'unavailable',
          fork: {
            status: 'unavailable',
            reason: error instanceof Error
              ? error.message
              : 'Git 제출 상태를 확인할 수 없습니다.',
          },
          stagedFiles: [],
          otherStagedFiles: [],
          pendingCommits: [],
          forkFiles: [],
          otherForkFiles: [],
          summary: summaryForStatuses(submissionStatuses),
          canSync: false,
        },
      };
    }
  }

  async stageSolution(repositoryRoot: vscode.Uri, uri: vscode.Uri): Promise<void> {
    return this.submissionActions.stageSolution(repositoryRoot, uri);
  }

  async unstageSolution(repositoryRoot: vscode.Uri, uri: vscode.Uri): Promise<void> {
    return this.submissionActions.unstageSolution(repositoryRoot, uri);
  }

  async commit(
    repositoryRoot: vscode.Uri,
    message: string,
    expectedFiles: readonly SubmissionFileSnapshot[],
  ): Promise<void> {
    return this.submissionActions.commit(repositoryRoot, message, expectedFiles);
  }

  async push(
    repositoryRoot: vscode.Uri,
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    return this.submissionActions.push(repositoryRoot, solutions);
  }

  async syncFork(repositoryRoot: vscode.Uri): Promise<void> {
    return this.submissionActions.syncFork(repositoryRoot);
  }

  async openPullRequest(
    submission: RepositorySubmissionSnapshot,
    nickname: string,
  ): Promise<void> {
    return this.submissionActions.openPullRequest(submission, nickname);
  }

  dispose(): void {
    this.repositoryAdapter.dispose();
    this.githubClient.dispose();
  }

  private async getSubmission(
    repository: GitRepository,
    solutions: readonly SubmissionSolution[],
    forceRemote: boolean,
  ): Promise<{
    statuses: ReadonlyMap<string, SolutionSubmissionStatus>;
    pullRequestNumbers: ReadonlyMap<string, number>;
    snapshot: RepositorySubmissionSnapshot;
  }> {
    const files = solutions.map((solution): SubmissionFileSnapshot => ({
      ...solution,
      relativePath: relativeGitPath(repository.rootUri, vscode.Uri.parse(solution.uri)),
    }));
    const fileByPath = new Map(files.map((file) => [file.relativePath, file]));
    const origin = repository.state.remotes.find(({ name }) => name === 'origin');
    const parsedOrigin = parseConsistentRemote(origin);
    const fork = parsedOrigin
      ? await this.githubClient.getForkIdentity(parsedOrigin, forceRemote)
      : {
        status: 'unsupported' as const,
        reason: 'origin의 fetch/push URL이 동일한 GitHub 저장소를 가리키지 않습니다.',
      };

    const indexPaths = new Set<string>();
    const workingPaths = new Set<string>();
    const conflictPaths = new Set<string>();
    addRelativeChangePaths(indexPaths, repository.rootUri, repository.state.indexChanges);
    addRelativeChangePaths(workingPaths, repository.rootUri, [
      ...repository.state.workingTreeChanges,
      ...repository.state.untrackedChanges,
    ]);
    addRelativeChangePaths(conflictPaths, repository.rootUri, repository.state.mergeChanges);

    const stagedFiles = files.filter(({ relativePath }) => indexPaths.has(relativePath));
    const otherStagedFiles = [...indexPaths].filter(
      (relativePath) => !fileByPath.has(relativePath),
    );
    if (fork.status !== 'verified' || !parsedOrigin) {
      const statuses = localSubmissionStatuses({
        files,
        indexPaths,
        workingPaths,
        conflictPaths,
      });
      const snapshot: RepositorySubmissionSnapshot = {
        status: fork.status === 'unsupported' ? 'unsupported' : 'unavailable',
        branch: repository.state.HEAD?.name,
        fork,
        stagedFiles,
        otherStagedFiles,
        pendingCommits: [],
        forkFiles: [],
        otherForkFiles: [],
        summary: summaryForStatuses(statuses),
        canSync: false,
      };
      return { statuses, pullRequestNumbers: new Map(), snapshot };
    }

    let remote: RemoteSubmissionState;
    try {
      remote = await this.githubClient.getRemoteSubmission(parsedOrigin, forceRemote);
    } catch (error) {
      const statuses = localSubmissionStatuses({
        files,
        indexPaths,
        workingPaths,
        conflictPaths,
      });
      const snapshot: RepositorySubmissionSnapshot = {
        status: 'unavailable',
        branch: repository.state.HEAD?.name,
        fork: {
          ...fork,
          reason: error instanceof Error ? error.message : String(error),
        },
        stagedFiles,
        otherStagedFiles,
        pendingCommits: [],
        forkFiles: [],
        otherForkFiles: [],
        summary: summaryForStatuses(statuses),
        canSync: false,
      };
      return { statuses, pullRequestNumbers: new Map(), snapshot };
    }

    const pendingCommits = await this.getLocalPendingCommits(repository, fileByPath);
    const pendingPaths = new Set(
      pendingCommits.flatMap(({ files }) => files.map(({ relativePath }) => relativePath)),
    );
    const remotePaths = new Set(remote.compareFiles.map(({ filename }) => filename));
    const forkFiles = remote.compareFiles.flatMap(({ filename }) => {
      const file = fileByPath.get(filename);
      return file ? [file] : [];
    });
    const otherForkFiles = remote.compareFiles
      .map(({ filename }) => filename)
      .filter((filename) => !fileByPath.has(filename));
    const { statuses, pullRequestNumbers } = projectSubmissionStatuses({
      files,
      indexPaths,
      workingPaths,
      conflictPaths,
      pendingPaths,
      remote,
    });

    const remoteCommits = await this.getRemoteCommits(
      repository,
      remote.compareCommits,
      remotePaths,
      fileByPath,
    );
    const commits = [...remoteCommits, ...pendingCommits];
    const activeFiles = [
      ...stagedFiles,
      ...commits.flatMap(({ files: commitFiles }) => commitFiles),
      ...forkFiles,
    ];
    const activeWeeks = new Set(activeFiles.map(({ week }) => week).filter(
      (week): week is number => week !== undefined,
    ));
    const activeSubmissionWeek = activeWeeks.size === 1
      ? [...activeWeeks][0]
      : undefined;
    const pullRequestWeek = singleWeek(
      remote.pullRequestFiles.flatMap((relativePath) => {
        const file = fileByPath.get(relativePath);
        return file ? [file] : [];
      }),
    );
    const mixedWeeks = activeWeeks.size > 1;
    const branch = repository.state.HEAD?.name;
    let hasBlockingOriginCommits: boolean;
    try {
      const originRelation = await getRefRelation(repository, 'origin/main');
      hasBlockingOriginCommits = originRelation === 'ahead'
        || originRelation === 'diverged';
    } catch {
      hasBlockingOriginCommits = true;
    }
    const hasTrackedChanges = repository.state.indexChanges.length > 0
      || repository.state.workingTreeChanges.length > 0
      || repository.state.mergeChanges.length > 0;
    const canSync = branch === 'main'
      && !hasTrackedChanges
      && !repository.state.rebaseCommit
      && !hasBlockingOriginCommits;
    const blockedReason = remote.openPullRequestCount > 1
      ? 'origin/main에서 열린 PR이 여러 개입니다. GitHub에서 하나만 남겨 주세요.'
      : otherStagedFiles.length > 0
      ? '풀이 외 파일이 스테이징되어 있습니다. 해당 파일을 먼저 스테이징 해제해 주세요.'
      : mixedWeeks
        ? '공식 저장소에 반영되지 않은 풀이가 여러 주차에 걸쳐 있습니다.'
      : branch !== 'main'
        ? '제출 기능은 main 브랜치에서만 사용할 수 있습니다.'
        : undefined;
    const snapshot: RepositorySubmissionSnapshot = {
      status: blockedReason ? 'blocked' : 'ready',
      branch,
      activeSubmissionWeek,
      fork,
      stagedFiles,
      otherStagedFiles,
      pendingCommits: commits,
      forkFiles,
      otherForkFiles,
      activePullRequest: remote.activePullRequest
        ? {
          number: remote.activePullRequest.number,
          title: remote.activePullRequest.title,
          url: remote.activePullRequest.html_url,
          week: pullRequestWeek,
        }
        : undefined,
      blockedReason,
      summary: summaryForStatuses(statuses),
      canSync,
    };
    return { statuses, pullRequestNumbers, snapshot };
  }

  private async getLocalPendingCommits(
    repository: GitRepository,
    fileByPath: ReadonlyMap<string, SubmissionFileSnapshot>,
  ): Promise<SubmissionCommitSnapshot[]> {
    const upstream = repository.state.HEAD?.upstream;
    if (!upstream) {
      return [];
    }
    const ref = upstreamRef(upstream);
    let commits: GitCommit[];
    try {
      commits = await repository.log({
        range: `${ref}..HEAD`,
        reverse: true,
        maxEntries: 50,
      });
    } catch {
      return [];
    }
    return Promise.all(commits.map((commit) =>
      this.toCommitSnapshot(repository, commit, false, fileByPath)
    )).then((snapshots) => snapshots.filter(
      ({ files, otherFiles }) => files.length > 0 || otherFiles.length > 0,
    ));
  }

  private async getRemoteCommits(
    repository: GitRepository,
    commits: readonly GitHubCompareCommit[],
    remotePaths: ReadonlySet<string>,
    fileByPath: ReadonlyMap<string, SubmissionFileSnapshot>,
  ): Promise<SubmissionCommitSnapshot[]> {
    const snapshots: SubmissionCommitSnapshot[] = [];
    for (const item of commits) {
      try {
        const commit = await repository.getCommit(item.sha);
        const snapshot = await this.toCommitSnapshot(
          repository,
          commit,
          true,
          fileByPath,
          remotePaths,
        );
        if (snapshot.files.length > 0 || snapshot.otherFiles.length > 0) {
          snapshots.push(snapshot);
        }
      } catch {
        // A remote commit may not exist locally yet. The origin node still lists its files.
      }
    }
    return snapshots;
  }

  private async toCommitSnapshot(
    repository: GitRepository,
    commit: GitCommit,
    pushed: boolean,
    fileByPath: ReadonlyMap<string, SubmissionFileSnapshot>,
    includePaths?: ReadonlySet<string>,
  ): Promise<SubmissionCommitSnapshot> {
    const paths = new Set<string>();
    const parent = commit.parents[0];
    if (parent) {
      try {
        addRelativeChangePaths(
          paths,
          repository.rootUri,
          await repository.diffBetween(parent, commit.hash),
        );
      } catch {
        // Keep the commit visible even if its file diff cannot be read.
      }
    }
    const included = [...paths].filter((relativePath) =>
      !includePaths || includePaths.has(relativePath)
    );
    return {
      hash: commit.hash,
      shortHash: commit.hash.slice(0, 7),
      message: firstLine(commit.message),
      pushed,
      files: included.flatMap((relativePath) => {
        const file = fileByPath.get(relativePath);
        return file ? [file] : [];
      }),
      otherFiles: included.filter((relativePath) => !fileByPath.has(relativePath)),
    };
  }

}
