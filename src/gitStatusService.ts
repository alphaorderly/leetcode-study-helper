import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import type {
  BlockingTrackedFile,
  LocalSubmissionHistorySnapshot,
  RepositorySubmissionSnapshot,
  SolutionGitStatus,
  SolutionSubmissionStatus,
  SubmissionCommitSnapshot,
  SubmissionFileSnapshot,
} from './core/types';
import { GitHubAuthService } from './git/githubAuth';
import {
  GitHubSubmissionClient,
  githubRequestNeedsSignIn,
  parseConsistentRemote,
  pullRequestStatus,
  resolveCanonicalRemoteName,
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
  collectBlockingTrackedFiles,
  firstLine,
  localSubmissionStatuses,
  projectSubmissionStatuses,
  singleWeek,
  summaryForStatuses,
  trackedFilesBlockSync,
  weekBranchName,
  weekFromBranch,
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
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly repositoryAdapter = new GitRepositoryAdapter();
  private readonly githubAuth = new GitHubAuthService(() => this.onGitHubSessionsChanged());
  private readonly githubClient = new GitHubSubmissionClient(
    () => this.githubAuth.getAccessToken(),
  );
  private readonly submissionActions = new SubmissionActions(
    this.repositoryAdapter,
    this.githubClient,
  );
  private readonly disposables: vscode.Disposable[] = [
    this.githubAuth,
    this.repositoryAdapter.onDidChange(() => this.changeEmitter.fire()),
  ];
  readonly onDidChange = this.changeEmitter.event;

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
            needsGitHubSignIn: githubRequestNeedsSignIn(error),
          },
          stagedFiles: [],
          otherStagedFiles: [],
          pendingCommits: [],
          forkFiles: [],
          otherForkFiles: [],
          summary: summaryForStatuses(submissionStatuses),
          canSync: false,
          canReturnToMain: false,
          hasCanonicalRemote: false,
          behindOfficialMain: false,
          blockingTrackedFiles: [],
        },
      };
    }
  }

  async stageSolution(
    repositoryRoot: vscode.Uri,
    uri: vscode.Uri,
    week: number | undefined,
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    return this.submissionActions.stageSolution(repositoryRoot, uri, week, solutions);
  }

  async unstageSolution(repositoryRoot: vscode.Uri, uri: vscode.Uri): Promise<void> {
    return this.submissionActions.unstageSolution(repositoryRoot, uri);
  }

  async commit(
    repositoryRoot: vscode.Uri,
    message: string,
    expectedFiles: readonly SubmissionFileSnapshot[],
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    return this.submissionActions.commit(repositoryRoot, message, expectedFiles, solutions);
  }

  async push(
    repositoryRoot: vscode.Uri,
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    return this.submissionActions.push(repositoryRoot, solutions);
  }

  async syncFork(
    repositoryRoot: vscode.Uri,
    solutions: readonly SubmissionSolution[] = [],
  ): Promise<void> {
    return this.submissionActions.syncFork(repositoryRoot, solutions);
  }

  async discardOtherTrackedChanges(
    repositoryRoot: vscode.Uri,
    solutions: readonly SubmissionSolution[],
    expectedRelativePaths: readonly string[],
  ): Promise<void> {
    return this.submissionActions.discardOtherTrackedChanges(
      repositoryRoot,
      solutions,
      expectedRelativePaths,
    );
  }

  async returnToMainAndSync(
    repositoryRoot: vscode.Uri,
    solutions: readonly SubmissionSolution[] = [],
  ): Promise<void> {
    return this.submissionActions.returnToMainAndSync(repositoryRoot, solutions);
  }

  async openPullRequest(
    submission: RepositorySubmissionSnapshot,
    nickname: string,
  ): Promise<void> {
    return this.submissionActions.openPullRequest(submission, nickname);
  }

  async signInGitHub(): Promise<boolean> {
    const token = await this.githubAuth.getAccessToken({ prompt: true });
    if (!token) {
      return false;
    }
    this.githubClient.clearCaches();
    return true;
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.repositoryAdapter.dispose();
    this.githubClient.dispose();
    this.changeEmitter.dispose();
  }

  private onGitHubSessionsChanged(): void {
    this.githubClient.clearCaches();
    this.changeEmitter.fire();
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
    const indexPaths = new Set<string>();
    const workingPaths = new Set<string>();
    const trackedWorkingPaths = new Set<string>();
    const conflictPaths = new Set<string>();
    addRelativeChangePaths(indexPaths, repository.rootUri, repository.state.indexChanges);
    addRelativeChangePaths(trackedWorkingPaths, repository.rootUri, repository.state.workingTreeChanges);
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
      : stagedWeek ? weekBranchName(stagedWeek) : undefined;
    let canonicalRemoteName: string | undefined;
    try {
      canonicalRemoteName = resolveCanonicalRemoteName(repository.state.remotes);
    } catch {
      canonicalRemoteName = undefined;
    }
    const local = await this.getLocalPendingCommits(
      repository,
      fileByPath,
      currentBranchWeek,
      canonicalRemoteName,
    );
    const pendingPaths = new Set(
      local.commits.flatMap(({ files: commitFiles }) =>
        commitFiles.map(({ relativePath }) => relativePath)
      ),
    );
    const localStatuses = new Map(localSubmissionStatuses({
      files,
      indexPaths,
      workingPaths,
      conflictPaths,
    }));
    for (const file of files) {
      if (pendingPaths.has(file.relativePath) && localStatuses.get(file.uri) === 'unknown') {
        localStatuses.set(file.uri, 'push-needed');
      }
    }
    const localInspectionFailed = local.commits.some(
      ({ fileInspectionStatus }) => fileInspectionStatus === 'unavailable',
    );
    const localBlockedReason = local.history.status === 'unavailable'
      ? local.history.reason ?? '로컬 커밋 기록을 확인할 수 없습니다.'
      : localInspectionFailed
        ? '일부 로컬 커밋의 변경 파일을 확인할 수 없어 push할 수 없습니다.'
        : local.history.usedLocalMainFallback
          ? '공식 remote를 확인할 수 없어 로컬 main 기준으로만 커밋을 표시합니다.'
          : undefined;
    const localActiveFiles = [
      ...stagedFiles,
      ...local.commits.flatMap(({ files: commitFiles }) => commitFiles),
    ];
    const localActiveWeeks = new Set(localActiveFiles.map(({ week }) => week).filter(
      (week): week is number => week !== undefined,
    ));
    const localActiveSubmissionWeek = localActiveWeeks.size === 1
      ? [...localActiveWeeks][0]
      : localActiveWeeks.size === 0
        ? currentBranchWeek
        : undefined;

    const origin = repository.state.remotes.find(({ name }) => name === 'origin');
    const parsedOrigin = parseConsistentRemote(origin);
    const fork = parsedOrigin
      ? await this.githubClient.getForkIdentity(parsedOrigin, forceRemote)
      : {
        status: 'unsupported' as const,
        reason: 'origin의 fetch/push URL이 동일한 GitHub 저장소를 가리키지 않습니다.',
      };
    if (fork.status !== 'verified' || !parsedOrigin) {
      const snapshot: RepositorySubmissionSnapshot = {
        status: fork.status === 'unsupported' ? 'unsupported' : 'unavailable',
        branch,
        submissionBranch: requestedSubmissionBranch,
        activeSubmissionWeek: localActiveSubmissionWeek,
        fork,
        stagedFiles,
        otherStagedFiles,
        pendingCommits: local.commits,
        localHistory: local.history,
        forkFiles: [],
        otherForkFiles: [],
        blockedReason: localBlockedReason ?? fork.reason,
        summary: summaryForStatuses(localStatuses),
        canSync: false,
        canReturnToMain: false,
        hasCanonicalRemote: canonicalRemoteName !== undefined,
        behindOfficialMain: false,
        blockingTrackedFiles,
      };
      return { statuses: localStatuses, pullRequestNumbers: new Map(), snapshot };
    }
    let remote: RemoteSubmissionState;
    try {
      remote = await this.githubClient.getRemoteSubmission(
        parsedOrigin,
        requestedSubmissionBranch,
        forceRemote,
      );
    } catch (error) {
      const snapshot: RepositorySubmissionSnapshot = {
        status: 'unavailable',
        branch,
        submissionBranch: requestedSubmissionBranch,
        activeSubmissionWeek: localActiveSubmissionWeek,
        fork: {
          ...fork,
          reason: error instanceof Error ? error.message : String(error),
          needsGitHubSignIn: githubRequestNeedsSignIn(error),
        },
        stagedFiles,
        otherStagedFiles,
        pendingCommits: local.commits,
        localHistory: local.history,
        forkFiles: [],
        otherForkFiles: [],
        blockedReason: localBlockedReason
          ?? (error instanceof Error ? error.message : String(error)),
        summary: summaryForStatuses(localStatuses),
        canSync: false,
        canReturnToMain: false,
        hasCanonicalRemote: canonicalRemoteName !== undefined,
        behindOfficialMain: false,
        blockingTrackedFiles,
      };
      return { statuses: localStatuses, pullRequestNumbers: new Map(), snapshot };
    }

    const submissionBranch = remote.headBranch ?? requestedSubmissionBranch;
    const remotePaths = new Set(remote.compareFiles.map(({ filename }) => filename));
    const forkFiles = remote.compareFiles.flatMap(({ filename }) => {
      const file = fileByPath.get(filename);
      return file ? [file] : [];
    });
    const otherForkFiles = remote.compareFiles
      .map(({ filename }) => filename)
      .filter((filename) => !fileByPath.has(filename));
    const canonicalMatchingPaths = await this.getCanonicalMatchingPaths(
      files,
      remote.canonicalFileHashes,
    );
    const { statuses, pullRequestNumbers } = projectSubmissionStatuses({
      files,
      indexPaths,
      workingPaths,
      conflictPaths,
      pendingPaths,
      remote,
      canonicalMatchingPaths,
    });

    const remoteCommits = await this.getRemoteCommits(
      repository,
      remote.compareCommits,
      remotePaths,
      fileByPath,
    );
    const commitsByHash = new Map<string, SubmissionCommitSnapshot>();
    for (const commit of [...remoteCommits, ...local.commits]) {
      const existing = commitsByHash.get(commit.hash);
      commitsByHash.set(commit.hash, existing?.pushed ? existing : commit);
    }
    const commits = [...commitsByHash.values()];
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
      : activeWeeks.size === 0
        ? weekFromBranch(submissionBranch)
        : undefined;
    const pullRequestWeek = singleWeek(
      remote.pullRequestFiles.flatMap((relativePath) => {
        const file = fileByPath.get(relativePath);
        return file ? [file] : [];
      }),
    );
    const mixedWeeks = activeWeeks.size > 1;
    let hasBlockingOriginCommits = false;
    if (branch === 'main') {
      try {
        const originRelation = await getRefRelation(repository, 'origin/main');
        hasBlockingOriginCommits = originRelation === 'ahead'
          || originRelation === 'diverged';
      } catch {
        hasBlockingOriginCommits = false;
      }
    }
    const hasDirtyTrackedState = repository.state.indexChanges.length > 0
      || repository.state.workingTreeChanges.length > 0
      || repository.state.mergeChanges.length > 0;
    const hasUntrackedChanges = repository.state.untrackedChanges.length > 0;
    const blocksForkSync = trackedFilesBlockSync(blockingTrackedFiles);
    const canSync = branch === 'main'
      && !blocksForkSync
      && !repository.state.rebaseCommit
      && !hasBlockingOriginCommits;
    const syncDisabledReason = describeSyncDisabledReason(
      branch,
      blockingTrackedFiles,
      Boolean(repository.state.rebaseCommit),
      hasBlockingOriginCommits,
    );
    let hasCanonicalRemote: boolean;
    try {
      hasCanonicalRemote = resolveCanonicalRemoteName(repository.state.remotes) !== undefined;
    } catch {
      hasCanonicalRemote = false;
    }
    const latestPullRequestStatus = remote.latestPullRequest
      ? pullRequestStatus(remote.latestPullRequest)
      : undefined;
    const canReturnToMain = currentBranchWeek !== undefined
      && latestPullRequestStatus === 'merged'
      && !hasDirtyTrackedState
      && !hasUntrackedChanges
      && !repository.state.rebaseCommit
      && local.commits.length === 0;
    const branchAllowed = branch === 'main'
      || (currentBranchWeek !== undefined && branch === submissionBranch);
    const hasOtherOpenPullRequest = remote.openPullRequestCount === 1
      && requestedSubmissionBranch !== undefined
      && remote.headBranch !== requestedSubmissionBranch;
    const blockedReason = localBlockedReason
      ?? (remote.compareIncomplete
        ? 'GitHub 조회 한도로 origin 변경 파일을 모두 확인할 수 없어 제출할 수 없습니다.'
        : remote.openPullRequestCount > 1
      ? '열린 주차 PR이 여러 개입니다. GitHub에서 하나만 남겨 주세요.'
      : hasOtherOpenPullRequest
        ? '다른 주차 PR이 끝나기 전에는 현재 주차를 제출할 수 없습니다.'
      : otherStagedFiles.length > 0
      ? '풀이 외 파일이 스테이징되어 있습니다. 해당 파일을 먼저 스테이징 해제해 주세요.'
      : mixedWeeks
        ? '공식 저장소에 반영되지 않은 풀이가 여러 주차에 걸쳐 있습니다.'
      : !branchAllowed
        ? '제출 기능은 main 또는 활성 week-XX 브랜치에서만 사용할 수 있습니다.'
        : undefined);
    const toPullRequestSnapshot = (
      pullRequest: NonNullable<RemoteSubmissionState['latestPullRequest']>,
    ) => ({
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.html_url,
      week: pullRequestWeek ?? weekFromBranch(remote.headBranch),
      branch: remote.headBranch ?? submissionBranch ?? 'week-unknown',
      status: pullRequestStatus(pullRequest),
    });
    const snapshot: RepositorySubmissionSnapshot = {
      status: blockedReason ? 'blocked' : 'ready',
      branch,
      submissionBranch,
      activeSubmissionWeek,
      fork,
      stagedFiles,
      otherStagedFiles,
      pendingCommits: commits,
      localHistory: local.history,
      forkFiles,
      otherForkFiles,
      activePullRequest: remote.activePullRequest
        ? toPullRequestSnapshot(remote.activePullRequest)
        : undefined,
      pullRequest: remote.latestPullRequest
        ? toPullRequestSnapshot(remote.latestPullRequest)
        : undefined,
      blockedReason,
      summary: summaryForStatuses(statuses),
      canSync,
      canReturnToMain,
      hasCanonicalRemote,
      behindOfficialMain: remote.behindBy > 0,
      syncDisabledReason,
      blockingTrackedFiles,
    };
    return { statuses, pullRequestNumbers, snapshot };
  }

  private async getLocalPendingCommits(
    repository: GitRepository,
    fileByPath: ReadonlyMap<string, SubmissionFileSnapshot>,
    currentBranchWeek: number | undefined,
    canonicalRemoteName: string | undefined,
  ): Promise<{
    commits: SubmissionCommitSnapshot[];
    history: LocalSubmissionHistorySnapshot;
  }> {
    const upstream = repository.state.HEAD?.upstream;
    const usedLocalMainFallback = !upstream
      && currentBranchWeek !== undefined
      && canonicalRemoteName === undefined;
    const ref = upstream
      ? upstreamRef(upstream)
      : currentBranchWeek !== undefined
        ? canonicalRemoteName ? `${canonicalRemoteName}/main` : 'main'
        : undefined;
    if (!ref) {
      return {
        commits: [],
        history: { status: 'ready' },
      };
    }
    try {
      const mergeBase = await repository.getMergeBase('HEAD', ref);
      if (!mergeBase) {
        throw new Error(`${ref}와 현재 브랜치의 공통 기준점을 찾을 수 없습니다.`);
      }
      const commits = await repository.log({
        range: `${mergeBase}..HEAD`,
        reverse: true,
        maxEntries: 51,
      });
      if (commits.length > 50) {
        throw new Error('로컬 제출 커밋이 너무 많아 화면에 안전하게 표시할 수 없습니다.');
      }
      const snapshots = await Promise.all(commits.map((commit) =>
        this.toCommitSnapshot(repository, commit, false, fileByPath)
      ));
      return {
        commits: snapshots.filter(({ files, otherFiles, fileInspectionStatus }) =>
          files.length > 0
          || otherFiles.length > 0
          || fileInspectionStatus === 'unavailable'
        ),
        history: {
          status: 'ready',
          baseRef: ref,
          mergeBase,
          usedLocalMainFallback,
          reason: usedLocalMainFallback
            ? '공식 remote가 없어 로컬 main의 merge-base를 사용했습니다.'
            : undefined,
        },
      };
    } catch (error) {
      return {
        commits: [],
        history: {
          status: 'unavailable',
          baseRef: ref,
          usedLocalMainFallback,
          reason: error instanceof Error
            ? `로컬 커밋 기록을 확인할 수 없습니다: ${error.message}`
            : '로컬 커밋 기록을 확인할 수 없습니다.',
        },
      };
    }
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
        if (
          snapshot.files.length > 0
          || snapshot.otherFiles.length > 0
          || snapshot.fileInspectionStatus === 'unavailable'
        ) {
          snapshots.push(snapshot);
        }
      } catch {
        // A remote commit may not exist locally yet. The origin node still lists its files.
      }
    }
    return snapshots;
  }

  private async getCanonicalMatchingPaths(
    files: readonly SubmissionFileSnapshot[],
    canonicalHashes: ReadonlyMap<string, string> | undefined,
  ): Promise<ReadonlySet<string>> {
    if (!canonicalHashes) {
      return new Set();
    }
    const matches = new Set<string>();
    await Promise.all(files.map(async (file) => {
      const expectedHash = canonicalHashes.get(file.relativePath);
      if (!expectedHash) {
        return;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(file.uri));
        const header = Buffer.from(`blob ${bytes.byteLength}\0`);
        const actualHash = createHash('sha1')
          .update(header)
          .update(bytes)
          .digest('hex');
        if (actualHash === expectedHash) {
          matches.add(file.relativePath);
        }
      } catch {
        // A missing or unreadable local file is not proof that the solution was merged.
      }
    }));
    return matches;
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
    if (!parent) {
      return {
        hash: commit.hash,
        shortHash: commit.hash.slice(0, 7),
        message: firstLine(commit.message),
        pushed,
        files: [],
        otherFiles: [],
        fileInspectionStatus: 'unavailable',
        fileInspectionReason: '부모 커밋이 없어 변경 파일을 확인할 수 없습니다.',
      };
    }
    try {
      addRelativeChangePaths(
        paths,
        repository.rootUri,
        await repository.diffBetween(parent, commit.hash),
      );
    } catch (error) {
      return {
        hash: commit.hash,
        shortHash: commit.hash.slice(0, 7),
        message: firstLine(commit.message),
        pushed,
        files: [],
        otherFiles: [],
        fileInspectionStatus: 'unavailable',
        fileInspectionReason: error instanceof Error
          ? `변경 파일을 확인할 수 없습니다: ${error.message}`
          : '변경 파일을 확인할 수 없습니다.',
      };
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
      fileInspectionStatus: 'ready',
    };
  }

}

function describeSyncDisabledReason(
  branch: string | undefined,
  blockingTrackedFiles: readonly BlockingTrackedFile[],
  rebaseInProgress: boolean,
  hasBlockingOriginCommits: boolean,
): string | undefined {
  if (branch !== 'main') {
    return '포크 동기화는 main 브랜치에서만 실행할 수 있습니다.';
  }
  if (rebaseInProgress || blockingTrackedFiles.some(({ state }) => state === 'conflict')) {
    return '진행 중인 merge 또는 rebase를 먼저 정리해 주세요.';
  }
  if (blockingTrackedFiles.some(({ state }) => state === 'staged')) {
    return '스테이징된 파일을 먼저 정리해 주세요.';
  }
  if (blockingTrackedFiles.some(({ kind }) => kind === 'other')) {
    return '풀이 외 추적 파일 변경을 되돌린 뒤 포크를 동기화해 주세요.';
  }
  if (hasBlockingOriginCommits) {
    return 'origin에 push하지 않은 로컬 커밋을 먼저 처리해 주세요.';
  }
  return undefined;
}
