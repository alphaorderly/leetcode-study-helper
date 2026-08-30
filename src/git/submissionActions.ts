import * as vscode from 'vscode';
import type {
  RepositorySubmissionSnapshot,
  SubmissionFileSnapshot,
} from '../core/types';
import {
  CANONICAL_REMOTE_URL,
  type GitHubSubmissionClient,
  parseConsistentRemote,
  pullRequestStatus,
  resolveCanonicalRemoteName,
} from './githubSubmissionClient';
import { buildPullRequestBody, buildPullRequestCompareUrl } from './pullRequestBody';
import { getRefRelation } from './refRelation';
import {
  collectBlockingTrackedFiles,
  trackedFilesBlockSync,
  weekBranchName,
  weekFromBranch,
} from './submissionModel';
import {
  type GitCommit,
  type GitRepository,
  type GitRepositoryAdapter,
  gitRefLookupPattern,
  relativeChangePaths,
  relativeGitPath,
} from './vscodeGit';

const MAX_PUSH_COMMITS = 200;

export interface SubmissionSolution {
  readonly name: string;
  readonly uri: string;
  readonly slug: string;
  readonly week?: number;
}

export class SubmissionActions {
  constructor(
    private readonly repositoryAdapter: GitRepositoryAdapter,
    private readonly githubClient: GitHubSubmissionClient,
  ) {}

  async stageSolution(
    repositoryRoot: vscode.Uri,
    uri: vscode.Uri,
    week: number | undefined,
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    if (!week) {
      throw new Error('주차가 지정된 풀이만 제출할 수 있습니다.');
    }
    const repository = await this.requireSubmissionMutation(repositoryRoot, false);
    const branch = weekBranchName(week);
    const currentBranch = repository.state.HEAD?.name;
    if (currentBranch !== 'main' && currentBranch !== branch) {
      throw new Error(`Week ${week} 풀이는 main 또는 ${branch} 브랜치에서만 추가할 수 있습니다.`);
    }
    if (repository.state.indexChanges.length === 0 && currentBranch === 'main') {
      await this.requireSynchronizedMain(repository, solutions);
    }
    const origin = this.requireOrigin(repository);
    const remote = await this.githubClient.getRemoteSubmission(origin, undefined, true);
    if (
      remote.openPullRequestCount > 0
      && remote.headBranch !== branch
    ) {
      throw new Error(
        `${remote.headBranch ?? '다른 주차'} PR이 끝나기 전에는 ${branch} 제출을 시작할 수 없습니다.`,
      );
    }
    await this.requireNoOtherOutstandingWeek(
      repository,
      branch,
      this.fileByPath(repository, solutions),
      remote.canonicalFilePaths,
    );
    const document = vscode.workspace.textDocuments.find(
      ({ uri: documentUri }) => documentUri.toString() === uri.toString(),
    );
    if (document?.isDirty && !await document.save()) {
      throw new Error('풀이 파일을 저장하지 못해 커밋에 추가하지 않았습니다.');
    }
    await repository.add([uri.fsPath]);
    await repository.status();
  }

  async unstageSolution(repositoryRoot: vscode.Uri, uri: vscode.Uri): Promise<void> {
    const repository = await this.repositoryAdapter.requireRepository(repositoryRoot);
    await repository.revert([uri.fsPath]);
    await repository.status();
  }

  async commit(
    repositoryRoot: vscode.Uri,
    message: string,
    expectedFiles: readonly SubmissionFileSnapshot[],
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    const repository = await this.requireSubmissionMutation(repositoryRoot, false);
    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      throw new Error('커밋 메시지를 입력해 주세요.');
    }
    if (normalizedMessage.length > 200) {
      throw new Error('커밋 메시지는 200자 이하로 입력해 주세요.');
    }
    const expectedPaths = new Set(expectedFiles.map(({ relativePath }) => relativePath));
    if (expectedPaths.size === 0) {
      throw new Error('커밋 준비 상태인 풀이가 없습니다.');
    }
    const weeks = new Set(expectedFiles.map(({ week }) => week));
    if (weeks.size !== 1 || !expectedFiles[0]?.week) {
      throw new Error('서로 다른 주차의 풀이를 한 번에 커밋할 수 없습니다.');
    }
    const week = expectedFiles[0].week;
    const submissionBranch = weekBranchName(week);
    const currentBranch = repository.state.HEAD?.name;
    if (currentBranch !== 'main' && currentBranch !== submissionBranch) {
      throw new Error(
        `Week ${week} 커밋은 main 또는 ${submissionBranch} 브랜치에서만 만들 수 있습니다.`,
      );
    }
    const indexPaths = relativeChangePaths(
      repository.rootUri,
      repository.state.indexChanges,
    );
    if (!setsEqual(indexPaths, expectedPaths)) {
      throw new Error(
        '스테이징 상태가 변경되었습니다. 풀이 외 파일을 해제하고 제출 상태를 새로고침해 주세요.',
      );
    }
    const conflictPaths = relativeChangePaths(
      repository.rootUri,
      repository.state.mergeChanges,
    );
    const workingPaths = relativeChangePaths(repository.rootUri, [
      ...repository.state.workingTreeChanges,
      ...repository.state.untrackedChanges,
    ]);
    if ([...expectedPaths].some((relativePath) =>
      conflictPaths.has(relativePath) || workingPaths.has(relativePath)
    )) {
      throw new Error('스테이징 후 수정되었거나 충돌한 풀이를 다시 커밋에 추가해 주세요.');
    }
    if (workingPaths.size > 0 || conflictPaths.size > 0) {
      throw new Error('브랜치를 전환하기 전에 스테이징되지 않은 변경과 충돌을 먼저 정리해 주세요.');
    }
    const fileByPath = this.fileByPath(repository, solutions);
    if (currentBranch === 'main') {
      const canonicalMain = await this.requireSynchronizedMain(repository, solutions);
      await this.checkoutSubmissionBranch(
        repository,
        submissionBranch,
        week,
        fileByPath,
        canonicalMain,
      );
      const refreshedIndexPaths = relativeChangePaths(
        repository.rootUri,
        repository.state.indexChanges,
      );
      if (!setsEqual(refreshedIndexPaths, expectedPaths)) {
        throw new Error('브랜치 전환 중 스테이징 상태가 변경되어 커밋하지 않았습니다.');
      }
    } else {
      const canonicalMain = await this.fetchCanonicalMain(repository);
      await this.requireSafeSubmissionHistory(
        repository,
        canonicalMain,
        'HEAD',
        week,
        fileByPath,
      );
    }
    await repository.commit(normalizedMessage, {
      requireUserConfig: true,
      postCommitCommand: null,
    });
    await repository.status();
  }

  async push(
    repositoryRoot: vscode.Uri,
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    const repository = await this.requireSubmissionMutation(repositoryRoot, true);
    const submissionBranch = repository.state.HEAD?.name;
    const branchWeek = weekFromBranch(submissionBranch);
    if (!submissionBranch || !branchWeek) {
      throw new Error('push는 week-XX 제출 브랜치에서만 실행할 수 있습니다.');
    }
    const canonicalMain = await this.fetchCanonicalMain(repository);
    await repository.fetch({ remote: 'origin', prune: true });
    await repository.status();
    this.requireCleanOperationState(repository);
    const remoteBranch = await this.getBranch(repository, `origin/${submissionBranch}`);
    if (remoteBranch) {
      const relation = await getRefRelation(repository, `origin/${submissionBranch}`);
      if (relation === 'equal') {
        throw new Error(`origin/${submissionBranch}에 push할 로컬 커밋이 없습니다.`);
      }
      if (relation === 'behind') {
        throw new Error(`로컬 ${submissionBranch}가 origin보다 뒤처져 있어 push할 수 없습니다.`);
      }
      if (relation === 'diverged') {
        throw new Error(`로컬 ${submissionBranch}와 origin이 분기되어 push할 수 없습니다.`);
      }
    }

    const fileByPath = this.fileByPath(repository, solutions);
    const baseRef = remoteBranch ? `origin/${submissionBranch}` : canonicalMain;
    const pendingCommits = await repository.log({
      range: `${baseRef}..HEAD`,
      reverse: true,
      maxEntries: MAX_PUSH_COMMITS + 1,
    });
    if (pendingCommits.length === 0) {
      throw new Error(`origin/${submissionBranch}에 push할 로컬 커밋이 없습니다.`);
    }
    if (pendingCommits.length > MAX_PUSH_COMMITS) {
      throw new Error('미푸시 커밋이 너무 많아 안전하게 제출 범위를 확인할 수 없습니다.');
    }
    const pendingWeeks = new Set<number>();
    for (const commit of pendingCommits) {
      rejectMergeCommit(commit);
      const parent = commit.parents[0];
      if (!parent) {
        throw new Error(`커밋 ${commit.hash.slice(0, 7)}의 변경 범위를 확인할 수 없습니다.`);
      }
      const paths = relativeChangePaths(
        repository.rootUri,
        await repository.diffBetween(parent, commit.hash),
      );
      if (paths.size === 0) {
        throw new Error(`커밋 ${commit.hash.slice(0, 7)}의 변경 파일을 확인할 수 없습니다.`);
      }
      for (const relativePath of paths) {
        const solution = fileByPath.get(relativePath);
        if (!solution?.week) {
          throw new Error(
            `풀이 외 파일이 포함된 커밋은 자동 push할 수 없습니다: ${relativePath}`,
          );
        }
        pendingWeeks.add(solution.week);
      }
    }
    if (pendingWeeks.size !== 1) {
      throw new Error('서로 다른 주차의 커밋을 한 번에 push할 수 없습니다.');
    }
    const pendingWeek = [...pendingWeeks][0]!;
    if (pendingWeek !== branchWeek) {
      throw new Error(`${submissionBranch}에는 Week ${branchWeek} 풀이만 push할 수 있습니다.`);
    }

    const origin = this.requireOrigin(repository);
    const remote = await this.githubClient.getRemoteSubmission(
      origin,
      submissionBranch,
      true,
    );
    if (remote.openPullRequestCount > 1) {
      throw new Error('열린 주차 PR이 여러 개입니다. GitHub에서 하나만 남겨 주세요.');
    }
    if (
      remote.openPullRequestCount === 1
      && remote.headBranch !== submissionBranch
    ) {
      throw new Error('다른 주차 PR이 끝나기 전에는 현재 주차를 push할 수 없습니다.');
    }
    const remotePaths = remote.activePullRequest
      ? remote.pullRequestFiles
      : remote.compareFiles.map(({ filename }) => filename);
    const remoteWeeks = new Set<number>();
    for (const relativePath of remotePaths) {
      const solution = fileByPath.get(relativePath);
      if (!solution?.week) {
        throw new Error(
          `포크 또는 열린 PR에 풀이 외 파일이 있어 자동 push할 수 없습니다: ${relativePath}`,
        );
      }
      remoteWeeks.add(solution.week);
    }
    if (remoteWeeks.size > 1) {
      throw new Error('공식 저장소에 반영되지 않은 풀이가 여러 주차에 걸쳐 있습니다.');
    }
    const remoteWeek = remoteWeeks.size === 1 ? [...remoteWeeks][0] : undefined;
    if (remoteWeek !== undefined && remoteWeek !== pendingWeek) {
      throw new Error(
        `Week ${remoteWeek} 제출이 끝나기 전에는 Week ${pendingWeek} 커밋을 push할 수 없습니다.`,
      );
    }

    await repository.push(
      'origin',
      submissionBranch,
      !remoteBranch || !repository.state.HEAD?.upstream,
    );
    await repository.status();
    this.githubClient.clearSubmissionCache();
  }

  async syncFork(
    repositoryRoot: vscode.Uri,
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    const repository = await this.requireSubmissionMutation(repositoryRoot, true);
    if (repository.state.HEAD?.name !== 'main') {
      throw new Error('포크 동기화는 main 브랜치에서만 실행할 수 있습니다.');
    }
    if (this.hasBlockingDirtyState(repository, solutions)) {
      throw new Error('스테이징 또는 풀이 외 추적 파일 변경을 먼저 정리해 주세요.');
    }
    await this.performForkSync(repository);
  }

  async discardOtherTrackedChanges(
    repositoryRoot: vscode.Uri,
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    const repository = await this.repositoryAdapter.requireRepository(repositoryRoot);
    await repository.status();
    if (repository.state.rebaseCommit || repository.state.mergeChanges.length > 0) {
      throw new Error('진행 중인 merge 또는 rebase를 먼저 정리해 주세요.');
    }
    const otherPaths = this.otherTrackedChangePaths(repository, solutions);
    if (otherPaths.length === 0) {
      throw new Error('되돌릴 풀이 외 추적 파일 변경이 없습니다.');
    }
    await repository.revert(otherPaths);
    await repository.status();
    const remaining = this.otherTrackedChangePaths(repository, solutions);
    if (remaining.length > 0) {
      throw new Error('풀이 외 추적 파일 변경을 모두 되돌리지 못했습니다.');
    }
  }

  async openPullRequest(
    submission: RepositorySubmissionSnapshot,
    nickname: string,
  ): Promise<void> {
    if (submission.pullRequest) {
      if (!await vscode.env.openExternal(vscode.Uri.parse(submission.pullRequest.url))) {
        throw new Error('GitHub PR 페이지를 열지 못했습니다.');
      }
      return;
    }
    if (submission.pendingCommits.some(({ pushed }) => !pushed)) {
      throw new Error('PR을 만들기 전에 로컬 커밋을 origin에 push해 주세요.');
    }
    if (
      !submission.activeSubmissionWeek
      || !submission.submissionBranch
      || submission.fork.status !== 'verified'
    ) {
      throw new Error('PR로 제출할 주차의 파일이 없습니다.');
    }
    const owner = submission.fork.owner;
    if (!owner) {
      throw new Error('포크 소유자를 확인할 수 없습니다.');
    }
    const weekLabel = String(submission.activeSubmissionWeek).padStart(2, '0');
    const title = `[${nickname}] WEEK ${weekLabel} Solutions`;
    const files = submission.forkFiles
      .filter(({ week }) => week === submission.activeSubmissionWeek);
    const slugs = [...new Set(files.map(({ slug }) => slug))];
    const body = buildPullRequestBody(slugs);
    const url = buildPullRequestCompareUrl(owner, submission.submissionBranch, title, body);
    try {
      await vscode.commands.executeCommand('vscode.open', url);
    } catch {
      throw new Error('GitHub PR 작성 화면을 열지 못했습니다.');
    }
  }

  async returnToMainAndSync(
    repositoryRoot: vscode.Uri,
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    const repository = await this.requireSubmissionMutation(repositoryRoot, true);
    const branch = repository.state.HEAD?.name;
    if (!branch || !weekFromBranch(branch)) {
      throw new Error('main으로 돌아가기는 week-XX 제출 브랜치에서만 사용할 수 있습니다.');
    }
    if (
      repository.state.indexChanges.length > 0
      || repository.state.workingTreeChanges.length > 0
      || repository.state.untrackedChanges.length > 0
      || repository.state.mergeChanges.length > 0
      || repository.state.rebaseCommit
    ) {
      throw new Error('main으로 돌아가기 전에 모든 변경과 진행 중인 작업을 정리해 주세요.');
    }
    await repository.fetch({ remote: 'origin', prune: true });
    await repository.status();
    const remoteBranch = await this.getBranch(repository, `origin/${branch}`);
    if (!remoteBranch) {
      throw new Error(`origin/${branch}을 찾을 수 없습니다.`);
    }
    if (await getRefRelation(repository, `origin/${branch}`) !== 'equal') {
      throw new Error(`${branch}의 로컬·원격 상태가 일치하지 않습니다.`);
    }
    const origin = this.requireOrigin(repository);
    const remote = await this.githubClient.getRemoteSubmission(origin, branch, true);
    if (!remote.latestPullRequest || pullRequestStatus(remote.latestPullRequest) !== 'merged') {
      throw new Error('병합 완료된 주차 PR만 main으로 돌아가 동기화할 수 있습니다.');
    }
    await repository.checkout('main');
    await repository.status();
    await this.syncFork(repositoryRoot, solutions);
  }

  private async requireSubmissionMutation(
    repositoryRoot: vscode.Uri,
    forceIdentity: boolean,
  ): Promise<GitRepository> {
    const repository = await this.repositoryAdapter.requireRepository(repositoryRoot);
    await repository.status();
    this.requireCleanOperationState(repository);
    const origin = this.requireOrigin(repository);
    const identity = await this.githubClient.getForkIdentity(origin, forceIdentity);
    if (identity.status !== 'verified') {
      throw new Error(identity.reason ?? 'DaleStudy 포크를 확인할 수 없습니다.');
    }
    return repository;
  }

  private requireCleanOperationState(repository: GitRepository): void {
    if (!repository.state.HEAD?.name) {
      throw new Error('현재 Git 브랜치를 확인할 수 없습니다.');
    }
    if (repository.state.rebaseCommit || repository.state.mergeChanges.length > 0) {
      throw new Error('진행 중인 merge 또는 rebase를 먼저 정리해 주세요.');
    }
  }

  private requireOrigin(repository: GitRepository) {
    const origin = parseConsistentRemote(
      repository.state.remotes.find(({ name }) => name === 'origin'),
    );
    if (!origin) {
      throw new Error(
        'origin의 fetch/push URL이 동일한 GitHub 저장소를 가리키지 않습니다.',
      );
    }
    return origin;
  }

  private hasBlockingDirtyState(
    repository: GitRepository,
    solutions: readonly SubmissionSolution[],
  ): boolean {
    return trackedFilesBlockSync(this.blockingTrackedFiles(repository, solutions));
  }

  private blockingTrackedFiles(
    repository: GitRepository,
    solutions: readonly SubmissionSolution[],
  ) {
    const solutionPaths = new Set(this.fileByPath(repository, solutions).keys());
    return collectBlockingTrackedFiles(
      relativeChangePaths(repository.rootUri, repository.state.indexChanges),
      relativeChangePaths(repository.rootUri, repository.state.workingTreeChanges),
      relativeChangePaths(repository.rootUri, repository.state.mergeChanges),
      solutionPaths,
    );
  }

  private otherTrackedChangePaths(
    repository: GitRepository,
    solutions: readonly SubmissionSolution[],
  ): string[] {
    const solutionPaths = new Set(this.fileByPath(repository, solutions).keys());
    const paths = new Set<string>();
    for (const change of [
      ...repository.state.indexChanges,
      ...repository.state.workingTreeChanges,
    ]) {
      if (!solutionPaths.has(relativeGitPath(repository.rootUri, change.uri))) {
        paths.add(change.uri.fsPath);
      }
    }
    return [...paths];
  }

  private async originMainRelation(repository: GitRepository) {
    try {
      return await getRefRelation(repository, 'origin/main');
    } catch {
      throw new Error('origin/main을 가져오지 못했습니다.');
    }
  }

  private async performForkSync(repository: GitRepository): Promise<string> {
    await repository.fetch({ remote: 'origin', ref: 'main', prune: true });
    await repository.status();
    this.requireCleanOperationState(repository);

    const originRelation = await this.originMainRelation(repository);
    if (originRelation === 'ahead') {
      throw new Error('origin에 push하지 않은 로컬 커밋을 먼저 처리해 주세요.');
    }
    if (originRelation === 'diverged') {
      throw new Error('로컬 main과 origin/main이 서로 분기되어 자동 동기화할 수 없습니다.');
    }
    if (originRelation === 'behind') {
      await this.mergeOrAbort(repository, 'origin/main');
    }

    const canonicalRemote = await this.ensureCanonicalRemote(repository);
    await repository.fetch({ remote: canonicalRemote, ref: 'main', prune: true });
    await repository.status();
    this.requireCleanOperationState(repository);

    const canonicalMain = `${canonicalRemote}/main`;
    const canonicalRelation = await getRefRelation(repository, canonicalMain);
    if (canonicalRelation === 'behind' || canonicalRelation === 'diverged') {
      await this.mergeOrAbort(repository, canonicalMain);
    }
    const finalOriginRelation = await this.originMainRelation(repository);
    if (finalOriginRelation !== 'equal' && finalOriginRelation !== 'ahead') {
      throw new Error('동기화 결과가 origin/main에서 이어지지 않아 push하지 않았습니다.');
    }
    if (!repository.state.HEAD?.upstream) {
      await repository.setBranchUpstream('main', 'origin/main');
    }
    await repository.push('origin', 'main', false);
    await repository.status();
    this.githubClient.clearSubmissionCache();
    return canonicalMain;
  }

  private async requireSynchronizedMain(
    repository: GitRepository,
    solutions: readonly SubmissionSolution[],
  ): Promise<string> {
    if (repository.state.HEAD?.name !== 'main') {
      throw new Error('새 주차 브랜치는 main에서만 만들 수 있습니다.');
    }
    const remoteName = await this.ensureCanonicalRemote(repository);
    await repository.fetch({ remote: 'origin', prune: true });
    await repository.fetch({ remote: remoteName, ref: 'main', prune: true });
    await repository.status();
    const canonicalMain = `${remoteName}/main`;
    const [originRelation, canonicalRelation] = await Promise.all([
      this.originMainRelation(repository),
      getRefRelation(repository, canonicalMain),
    ]);
    if (originRelation === 'ahead') {
      throw new Error('origin에 push하지 않은 로컬 커밋을 먼저 처리해 주세요.');
    }
    if (originRelation === 'diverged') {
      throw new Error('로컬 main과 origin/main이 서로 분기되어 자동 동기화할 수 없습니다.');
    }
    const needsSync = originRelation === 'behind'
      || canonicalRelation === 'behind'
      || canonicalRelation === 'diverged';
    if (!needsSync) {
      // equal: 동일 SHA. ahead: 공식 main을 이미 포함한 포크(merge 커밋 등).
      return canonicalMain;
    }
    if (this.hasBlockingDirtyState(repository, solutions)) {
      throw new Error('스테이징 또는 풀이 외 추적 파일 변경을 정리한 뒤 포크를 동기화해 주세요.');
    }
    return this.performForkSync(repository);
  }

  private async ensureCanonicalRemote(repository: GitRepository): Promise<string> {
    const existing = resolveCanonicalRemoteName(repository.state.remotes);
    if (existing) {
      return existing;
    }
    await repository.addRemote('upstream', CANONICAL_REMOTE_URL);
    await repository.status();
    return resolveCanonicalRemoteName(repository.state.remotes) ?? 'upstream';
  }

  private async fetchCanonicalMain(repository: GitRepository): Promise<string> {
    const remoteName = await this.ensureCanonicalRemote(repository);
    await repository.fetch({ remote: remoteName, ref: 'main', prune: true });
    await repository.status();
    return `${remoteName}/main`;
  }

  private async checkoutSubmissionBranch(
    repository: GitRepository,
    branch: string,
    week: number,
    fileByPath: ReadonlyMap<string, SubmissionSolution>,
    canonicalMain: string,
  ): Promise<void> {
    const localBranch = await this.getBranch(repository, branch);
    const remoteBranch = await this.getBranch(repository, `origin/${branch}`);
    if (localBranch && remoteBranch && localBranch.commit !== remoteBranch.commit) {
      throw new Error(`${branch}의 로컬·원격 상태가 일치하지 않아 자동 재사용할 수 없습니다.`);
    }
    const existingRef = localBranch
      ? branch
      : remoteBranch ? `origin/${branch}` : undefined;
    if (existingRef) {
      const [canonicalCommit, mergeBase] = await Promise.all([
        repository.getCommit(canonicalMain),
        repository.getMergeBase(canonicalMain, existingRef),
      ]);
      if (mergeBase !== canonicalCommit.hash) {
        throw new Error(
          `${branch}가 현재 공식 main에서 이어지지 않아 자동 재사용할 수 없습니다.`,
        );
      }
      await this.requireSafeSubmissionHistory(
        repository,
        canonicalMain,
        existingRef,
        week,
        fileByPath,
      );
    }
    if (localBranch) {
      await repository.checkout(branch);
    } else {
      await repository.createBranch(branch, true, existingRef ?? canonicalMain);
      if (remoteBranch) {
        await repository.setBranchUpstream(branch, `origin/${branch}`);
      }
    }
    await repository.status();
    if (repository.state.HEAD?.name !== branch) {
      throw new Error(`${branch} 브랜치로 전환하지 못해 커밋하지 않았습니다.`);
    }
    if (remoteBranch && !repository.state.HEAD.upstream) {
      await repository.setBranchUpstream(branch, `origin/${branch}`);
      await repository.status();
    }
  }

  private async requireSafeSubmissionHistory(
    repository: GitRepository,
    baseRef: string,
    headRef: string,
    expectedWeek: number,
    fileByPath: ReadonlyMap<string, SubmissionSolution>,
  ): Promise<void> {
    const commits = await repository.log({
      range: `${baseRef}..${headRef}`,
      reverse: true,
      maxEntries: MAX_PUSH_COMMITS + 1,
    });
    if (commits.length > MAX_PUSH_COMMITS) {
      throw new Error(`${headRef}의 커밋이 너무 많아 자동으로 검증할 수 없습니다.`);
    }
    for (const commit of commits) {
      rejectMergeCommit(commit);
      const parent = commit.parents[0];
      if (!parent) {
        throw new Error(`커밋 ${commit.hash.slice(0, 7)}의 변경 범위를 확인할 수 없습니다.`);
      }
      const paths = relativeChangePaths(
        repository.rootUri,
        await repository.diffBetween(parent, commit.hash),
      );
      if (paths.size === 0) {
        throw new Error(`커밋 ${commit.hash.slice(0, 7)}의 변경 파일을 확인할 수 없습니다.`);
      }
      for (const relativePath of paths) {
        const solution = fileByPath.get(relativePath);
        if (solution?.week !== expectedWeek) {
          throw new Error(`${headRef}에 Week ${expectedWeek} 풀이 외 변경이 포함되어 있습니다.`);
        }
      }
    }
  }

  private async getBranch(repository: GitRepository, name: string) {
    try {
      return (await repository.getRefs({ pattern: gitRefLookupPattern(name) }))
        .find((ref) => ref.name === name);
    } catch {
      return undefined;
    }
  }

  private async requireNoOtherOutstandingWeek(
    repository: GitRepository,
    desiredBranch: string,
    fileByPath: ReadonlyMap<string, SubmissionSolution>,
    canonicalFilePaths: ReadonlySet<string> | undefined,
  ): Promise<void> {
    const refs = await repository.getRefs({});
    const localRefs = new Map(
      refs.flatMap((ref) =>
        /^week-\d{2}$/.test(ref.name ?? '') ? [[ref.name!, ref] as const] : []
      ),
    );
    const remoteRefs = new Map(
      refs.flatMap((ref) => {
        const branch = ref.name?.match(/^origin\/(week-\d{2})$/)?.[1];
        return branch ? [[branch, ref] as const] : [];
      }),
    );
    const branches = new Set([...localRefs.keys(), ...remoteRefs.keys()]);
    const otherBranches = [...branches].filter((branch) => branch !== desiredBranch);
    if (otherBranches.length === 0) {
      return;
    }
    const canonicalMain = await this.fetchCanonicalMain(repository);
    for (const branch of otherBranches) {
      const local = localRefs.get(branch);
      const remote = remoteRefs.get(branch);
      if (local && (!remote || local.commit !== remote.commit)) {
        throw new Error(`${branch}에 push되지 않은 로컬 변경이 있어 새 주차를 시작할 수 없습니다.`);
      }
      const ref = remote ? `origin/${branch}` : branch;
      const mergeBase = await repository.getMergeBase(canonicalMain, ref);
      if (!mergeBase) {
        throw new Error(`${branch}의 공식 main 기준점을 확인할 수 없습니다.`);
      }
      const paths = relativeChangePaths(
        repository.rootUri,
        await repository.diffBetween(mergeBase, ref),
      );
      const outstandingPath = [...paths].find((relativePath) =>
        !fileByPath.has(relativePath) || !canonicalFilePaths?.has(relativePath)
      );
      if (outstandingPath) {
        throw new Error(
          `${branch} 제출이 공식 저장소에 반영되기 전에는 새 주차를 시작할 수 없습니다.`,
        );
      }
    }
  }

  private fileByPath(
    repository: GitRepository,
    solutions: readonly SubmissionSolution[],
  ): ReadonlyMap<string, SubmissionSolution> {
    return new Map(solutions.map((solution) => [
      relativeGitPath(repository.rootUri, vscode.Uri.parse(solution.uri)),
      solution,
    ]));
  }

  private async mergeOrAbort(
    repository: GitRepository,
    ref: string,
  ): Promise<void> {
    try {
      await repository.merge(ref);
      await repository.status();
      this.requireCleanOperationState(repository);
    } catch (error) {
      await repository.status();
      if (repository.state.mergeChanges.length > 0) {
        await repository.mergeAbort();
        await repository.status();
      }
      throw error;
    }
  }
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function rejectMergeCommit(commit: GitCommit): void {
  if (commit.parents.length > 1) {
    throw new Error(
      `커밋 ${commit.hash.slice(0, 7)}에 공식 main이 아닌 merge 히스토리가 포함되어 있습니다.`,
    );
  }
}
