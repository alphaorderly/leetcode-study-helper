import * as vscode from 'vscode';
import type {
  RepositorySubmissionSnapshot,
  SubmissionFileSnapshot,
} from '../../../shared/contracts';
import {
  pullRequestStatus,
  type GitHubSubmissionClient,
  type ParsedGitHubRemote,
  type RemoteSubmissionState,
} from '../../github/githubSubmissionClient';
import { buildPullRequestBody, buildPullRequestCompareUrl } from '../../github/pullRequestBody';
import { getRefRelation } from '../refRelation';
import { SubmissionBranches } from './submissionBranches';
import { submissionFilesByPath, type SubmissionSolution } from './submissionFiles';
import { MAX_PUSH_COMMITS, SubmissionGuards } from './submissionGuards';
import { weekBranchName, weekFromBranch } from './submissionModel';
import {
  relativeChangePaths,
  relativeGitPath,
  type GitRepository,
  type GitRepositoryAdapter,
} from '../vscodeGit';

export type { SubmissionSolution } from './submissionFiles';

/**
 * GitStatusService가 전달한 사용자 명령의 실행 순서를 관리합니다.
 * guards는 현재 상태의 허용 여부를 검사하고 branches는 브랜치 전환·동기화를 수행합니다.
 * 화면 스냅샷은 사용자가 선택한 범위를 나타낼 뿐 쓰기 권한의 근거가 아닙니다.
 * await 사이에 저장소가 바뀔 수 있으므로 조회 전 검사와 쓰기 직전 검사를 모두 유지합니다.
 */
export class SubmissionActions {
  private readonly guards: SubmissionGuards;
  private readonly branches: SubmissionBranches;

  /** 제출 검증기와 브랜치 관리기를 구성해 Git 작업의 검증·실행 흐름을 연결합니다. */
  constructor(
    private readonly repositoryAdapter: GitRepositoryAdapter,
    private readonly githubClient: GitHubSubmissionClient,
  ) {
    this.guards = new SubmissionGuards(repositoryAdapter, githubClient);
    this.branches = new SubmissionBranches(githubClient, this.guards);
  }

  /** 제출 주차와 기존 브랜치를 검증하고 열린 문서를 저장한 뒤 해당 풀이만 스테이징합니다. */
  async stageSolution(
    repositoryRoot: vscode.Uri,
    uri: vscode.Uri,
    week: number | undefined,
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    if (!week) {
      throw new Error('주차가 지정된 풀이만 제출할 수 있습니다.');
    }
    const repository = await this.guards.requireSubmissionMutation(repositoryRoot, false);
    const branch = weekBranchName(week);
    const currentBranch = repository.state.HEAD?.name;
    if (currentBranch !== 'main' && currentBranch !== branch) {
      throw new Error(`Week ${week} 풀이는 main 또는 ${branch} 브랜치에서만 추가할 수 있습니다.`);
    }
    if (repository.state.indexChanges.length === 0 && currentBranch === 'main') {
      await this.branches.requireSynchronizedMain(repository, solutions);
    }
    const origin = this.guards.requireOrigin(repository);
    const remote = await this.githubClient.getRemoteSubmission(origin, undefined, true);
    if (remote.openPullRequestCount > 0 && remote.headBranch !== branch) {
      throw new Error(
        `${remote.headBranch ?? '다른 주차'} PR이 끝나기 전에는 ${branch} 제출을 시작할 수 없습니다.`,
      );
    }
    await this.branches.requireNoOtherOutstandingWeek(
      repository,
      branch,
      submissionFilesByPath(repository, solutions),
      remote.canonicalFilePaths,
    );
    const document = vscode.workspace.textDocuments.find(
      ({ uri: documentUri }) => documentUri.toString() === uri.toString(),
    );
    if (document?.isDirty && !(await document.save())) {
      throw new Error('풀이 파일을 저장하지 못해 커밋에 추가하지 않았습니다.');
    }
    await repository.add([uri.fsPath]);
    await repository.status();
  }

  /** 풀이의 스테이징을 해제하고 상태를 다시 읽습니다. */
  async unstageSolution(repositoryRoot: vscode.Uri, uri: vscode.Uri): Promise<void> {
    const repository = await this.repositoryAdapter.requireRepository(repositoryRoot);
    await repository.revert([uri.fsPath]);
    await repository.status();
  }

  /**
   * 선택한 파일과 실제 index가 일치하는지 확인하고 주차 브랜치에서 커밋합니다.
   * @throws 조회·브랜치 전환 중 HEAD, origin 또는 스테이징 상태가 달라진 경우.
   */
  async commit(
    repositoryRoot: vscode.Uri,
    message: string,
    expectedFiles: readonly SubmissionFileSnapshot[],
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    const repository = await this.guards.requireSubmissionMutation(repositoryRoot, false);
    const verifiedOrigin = this.guards.requireOrigin(repository);
    const { normalizedMessage, expectedPaths, week, submissionBranch } = validateCommitInput(
      message,
      expectedFiles,
    );
    const currentBranch = repository.state.HEAD?.name;
    if (currentBranch !== 'main' && currentBranch !== submissionBranch) {
      throw new Error(
        `Week ${week} 커밋은 main 또는 ${submissionBranch} 브랜치에서만 만들 수 있습니다.`,
      );
    }
    this.requireCommitFiles(repository, expectedPaths);
    const fileByPath = submissionFilesByPath(repository, solutions);
    let canonicalMain: string;
    if (currentBranch === 'main') {
      canonicalMain = await this.branches.requireSynchronizedMain(repository, solutions);
      await this.branches.checkoutSubmissionBranch(
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
      canonicalMain = await this.branches.fetchCanonicalMain(repository);
      await this.guards.requireSafeSubmissionHistory(
        repository,
        canonicalMain,
        'HEAD',
        week,
        fileByPath,
      );
    }
    const canonicalCommit = (await repository.getCommit(canonicalMain)).hash;
    await repository.status();
    await this.revalidateCommit(repository, {
      verifiedOrigin,
      submissionBranch,
      canonicalMain,
      canonicalCommit,
      expectedPaths,
    });
    await this.guards.requireSafeSubmissionHistory(
      repository,
      canonicalMain,
      'HEAD',
      week,
      fileByPath,
    );
    await repository.commit(normalizedMessage, {
      requireUserConfig: true,
      postCommitCommand: null,
    });
    await repository.status();
  }

  /**
   * 주차 브랜치의 커밋 경로와 원격 상태를 검증한 뒤 일반 push를 수행합니다.
   * 네트워크 조회 뒤 쓰기 직전 검증을 반복하므로 검증 호출을 합치면 안 됩니다.
   */
  async push(repositoryRoot: vscode.Uri, solutions: readonly SubmissionSolution[]): Promise<void> {
    const repository = await this.guards.requireSubmissionMutation(repositoryRoot, true);
    const verifiedOrigin = this.guards.requireOrigin(repository);
    const submissionBranch = repository.state.HEAD?.name;
    const branchWeek = weekFromBranch(submissionBranch);
    if (!submissionBranch || !branchWeek) {
      throw new Error('push는 week-XX 제출 브랜치에서만 실행할 수 있습니다.');
    }
    const canonicalMain = await this.branches.fetchCanonicalMain(repository);
    await repository.fetch({ remote: 'origin', prune: true });
    await repository.status();
    this.guards.requireCleanOperationState(repository);
    const remoteBranch = await this.guards.getBranch(repository, `origin/${submissionBranch}`);
    if (remoteBranch) await this.requirePushAhead(repository, submissionBranch);

    const fileByPath = submissionFilesByPath(repository, solutions);
    const baseRef = remoteBranch ? `origin/${submissionBranch}` : canonicalMain;
    const pendingWeek = await this.requirePendingPushWeek(
      repository,
      baseRef,
      submissionBranch,
      branchWeek,
      fileByPath,
    );

    const origin = this.guards.requireOrigin(repository);
    const remote = await this.githubClient.getRemoteSubmission(origin, submissionBranch, true);
    this.requireRemotePushWeek(remote, submissionBranch, pendingWeek, fileByPath);

    const expectedHead = repository.state.HEAD?.commit;
    const expectedRemoteCommit = remoteBranch?.commit;
    if (!expectedHead) {
      throw new Error('push할 HEAD 커밋을 확인할 수 없습니다.');
    }
    await repository.fetch({ remote: 'origin', prune: true });
    await repository.status();
    await this.revalidatePush(repository, {
      verifiedOrigin,
      submissionBranch,
      expectedHead,
      expectedRemoteCommit,
    });

    await repository.push(
      'origin',
      submissionBranch,
      !remoteBranch || !repository.state.HEAD?.upstream,
    );
    await repository.status();
    this.githubClient.clearSubmissionCache();
  }

  /** 브랜치 전환 전 index와 사용자 선택이 일치하고 작업 파일이 깨끗한지 확인합니다. */
  private requireCommitFiles(repository: GitRepository, expectedPaths: ReadonlySet<string>): void {
    const indexPaths = relativeChangePaths(repository.rootUri, repository.state.indexChanges);
    if (!setsEqual(indexPaths, expectedPaths)) {
      throw new Error(
        '스테이징 상태가 변경되었습니다. 풀이 외 파일을 해제하고 제출 상태를 새로고침해 주세요.',
      );
    }
    const conflictPaths = relativeChangePaths(repository.rootUri, repository.state.mergeChanges);
    const workingPaths = relativeChangePaths(repository.rootUri, [
      ...repository.state.workingTreeChanges,
      ...repository.state.untrackedChanges,
    ]);
    if (
      [...expectedPaths].some(
        (relativePath) => conflictPaths.has(relativePath) || workingPaths.has(relativePath),
      )
    ) {
      throw new Error('스테이징 후 수정되었거나 충돌한 풀이를 다시 커밋에 추가해 주세요.');
    }
    if (workingPaths.size > 0 || conflictPaths.size > 0) {
      throw new Error('브랜치를 전환하기 전에 스테이징되지 않은 변경과 충돌을 먼저 정리해 주세요.');
    }
  }

  /**
   * 마지막 status 직후의 브랜치·origin·공식 ref·index를 다시 검사합니다.
   * 앞선 검사는 브랜치 전환을 위한 것이므로 이 검사를 대체할 수 없습니다.
   */
  private async revalidateCommit(
    repository: GitRepository,
    expected: {
      verifiedOrigin: ParsedGitHubRemote;
      submissionBranch: string;
      canonicalMain: string;
      canonicalCommit: string;
      expectedPaths: ReadonlySet<string>;
    },
  ): Promise<void> {
    const { verifiedOrigin, submissionBranch, canonicalMain, canonicalCommit, expectedPaths } =
      expected;
    this.guards.requireCleanOperationState(repository);
    this.guards.requireUnchangedOrigin(repository, verifiedOrigin);
    if (repository.state.HEAD?.name !== submissionBranch) {
      throw new Error('커밋 직전에 제출 브랜치가 변경되어 중단했습니다.');
    }
    if ((await repository.getCommit(canonicalMain)).hash !== canonicalCommit) {
      throw new Error('커밋 준비 중 공식 main이 변경되었습니다. 제출 상태를 새로고침해 주세요.');
    }
    const liveIndexPaths = relativeChangePaths(repository.rootUri, repository.state.indexChanges);
    if (!setsEqual(liveIndexPaths, expectedPaths)) {
      throw new Error('커밋 직전에 스테이징 상태가 변경되어 중단했습니다.');
    }
    const liveConflictPaths = relativeChangePaths(
      repository.rootUri,
      repository.state.mergeChanges,
    );
    const liveWorkingPaths = relativeChangePaths(repository.rootUri, [
      ...repository.state.workingTreeChanges,
      ...repository.state.untrackedChanges,
    ]);
    if (liveConflictPaths.size > 0 || liveWorkingPaths.size > 0) {
      throw new Error('커밋 직전에 작업 파일 상태가 변경되어 중단했습니다.');
    }
  }

  /** 기존 원격 주차 브랜치가 있을 때 로컬이 앞선 상태인지 검사합니다. */
  private async requirePushAhead(
    repository: GitRepository,
    submissionBranch: string,
  ): Promise<void> {
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

  /**
   * 최초 push는 공식 main, 이후 push는 origin 주차 브랜치를 기준으로 커밋을 검사합니다.
   * 빈 이력·merge·조회 한도·풀이 외 파일을 먼저 거부한 후 단일 주차를 반환합니다.
   */
  private async requirePendingPushWeek(
    repository: GitRepository,
    baseRef: string,
    submissionBranch: string,
    branchWeek: number,
    fileByPath: ReadonlyMap<string, SubmissionSolution>,
  ): Promise<number> {
    const rangeBase = await this.guards.requireMergeBase(repository, baseRef, 'HEAD');
    const pendingCommits = await repository.log({
      range: `${rangeBase}..HEAD`,
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
      const paths = await this.guards.readSubmissionCommitPaths(repository, commit);
      for (const relativePath of paths) {
        const solution = fileByPath.get(relativePath);
        if (!solution?.week) {
          throw new Error(`풀이 외 파일이 포함된 커밋은 자동 push할 수 없습니다: ${relativePath}`);
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
    return pendingWeek;
  }

  /** GitHub 조회 직후 PR과 원격 파일의 주차를 확인합니다. 실제 Git ref 검증은 뒤에서 별도로 수행합니다. */
  private requireRemotePushWeek(
    remote: RemoteSubmissionState,
    submissionBranch: string,
    pendingWeek: number,
    fileByPath: ReadonlyMap<string, SubmissionSolution>,
  ): void {
    if (remote.compareIncomplete) {
      throw new Error(
        'GitHub 조회 한도로 origin 변경 파일을 모두 확인할 수 없어 자동 push할 수 없습니다.',
      );
    }
    if (remote.openPullRequestCount > 1) {
      throw new Error('열린 주차 PR이 여러 개입니다. GitHub에서 하나만 남겨 주세요.');
    }
    if (remote.openPullRequestCount === 1 && remote.headBranch !== submissionBranch) {
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
  }

  /** 최종 fetch 뒤 HEAD·origin URL·원격 tip을 재검증합니다. 확인 실패 시 push에 도달하지 않습니다. */
  private async revalidatePush(
    repository: GitRepository,
    expected: {
      verifiedOrigin: ParsedGitHubRemote;
      submissionBranch: string;
      expectedHead: string;
      expectedRemoteCommit: string | undefined;
    },
  ): Promise<void> {
    const { verifiedOrigin, submissionBranch, expectedHead, expectedRemoteCommit } = expected;
    this.guards.requireCleanOperationState(repository);
    this.guards.requireUnchangedOrigin(repository, verifiedOrigin);
    if (
      repository.state.HEAD?.name !== submissionBranch ||
      repository.state.HEAD.commit !== expectedHead
    ) {
      throw new Error('push 직전에 브랜치 또는 HEAD가 변경되어 중단했습니다.');
    }
    const liveRemoteBranch = await this.guards.getBranch(repository, `origin/${submissionBranch}`);
    if (liveRemoteBranch?.commit !== expectedRemoteCommit) {
      throw new Error(`push 직전에 origin/${submissionBranch} 상태가 변경되어 중단했습니다.`);
    }
    if (liveRemoteBranch) {
      const liveRelation = await getRefRelation(repository, `origin/${submissionBranch}`);
      if (liveRelation !== 'ahead') {
        throw new Error(
          `push 직전에 ${submissionBranch}의 로컬·원격 관계가 변경되어 중단했습니다.`,
        );
      }
    }
  }

  /** main에서 동기화를 막는 추적 파일 변경을 확인한 뒤 공식 main을 포크에 반영합니다. */
  async syncFork(
    repositoryRoot: vscode.Uri,
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    const repository = await this.guards.requireSubmissionMutation(repositoryRoot, true);
    if (repository.state.HEAD?.name !== 'main') {
      throw new Error('포크 동기화는 main 브랜치에서만 실행할 수 있습니다.');
    }
    if (this.guards.hasBlockingDirtyState(repository, solutions)) {
      throw new Error('스테이징 또는 풀이 외 추적 파일 변경을 먼저 정리해 주세요.');
    }
    await this.branches.performForkSync(repository, this.guards.requireOrigin(repository));
  }

  /** 사용자가 확인한 풀이 외 추적 파일 목록이 현재 목록과 같을 때만 변경을 되돌립니다. */
  async discardOtherTrackedChanges(
    repositoryRoot: vscode.Uri,
    solutions: readonly SubmissionSolution[],
    expectedRelativePaths: readonly string[],
  ): Promise<void> {
    const repository = await this.repositoryAdapter.requireRepository(repositoryRoot);
    await repository.status();
    if (repository.state.rebaseCommit || repository.state.mergeChanges.length > 0) {
      throw new Error('진행 중인 merge 또는 rebase를 먼저 정리해 주세요.');
    }
    const otherPaths = this.guards.otherTrackedChangePaths(repository, solutions);
    if (otherPaths.length === 0) {
      throw new Error('되돌릴 풀이 외 추적 파일 변경이 없습니다.');
    }
    const liveRelativePaths = new Set(
      otherPaths.map((filePath) => relativeGitPath(repository.rootUri, vscode.Uri.file(filePath))),
    );
    if (!setsEqual(liveRelativePaths, new Set(expectedRelativePaths))) {
      throw new Error(
        '확인 후 풀이 외 변경 목록이 달라졌습니다. 제출 상태를 새로고침한 뒤 다시 확인해 주세요.',
      );
    }
    await repository.revert(otherPaths);
    await repository.status();
    const remainingTrackedPaths = this.guards.otherTrackedChangePaths(repository, solutions);
    if (remainingTrackedPaths.length > 0) {
      await repository.clean(remainingTrackedPaths);
      await repository.status();
    }
    const remaining = this.guards.otherTrackedChangePaths(repository, solutions);
    if (remaining.length > 0) {
      throw new Error('풀이 외 추적 파일 변경을 모두 되돌리지 못했습니다.');
    }
  }

  /** 기존 PR을 열거나 주차별 제목·본문이 채워진 GitHub PR 작성 화면을 엽니다. PR을 직접 생성하지 않습니다. */
  async openPullRequest(submission: RepositorySubmissionSnapshot, nickname: string): Promise<void> {
    if (submission.pullRequest) {
      if (!(await vscode.env.openExternal(vscode.Uri.parse(submission.pullRequest.url)))) {
        throw new Error('GitHub PR 페이지를 열지 못했습니다.');
      }
      return;
    }
    if (submission.pendingCommits.some(({ pushed }) => !pushed)) {
      throw new Error('PR을 만들기 전에 로컬 커밋을 origin에 push해 주세요.');
    }
    if (
      !submission.activeSubmissionWeek ||
      !submission.submissionBranch ||
      submission.fork.status !== 'verified'
    ) {
      throw new Error('PR로 제출할 주차의 파일이 없습니다.');
    }
    const owner = submission.fork.owner;
    if (!owner) {
      throw new Error('포크 소유자를 확인할 수 없습니다.');
    }
    const weekLabel = String(submission.activeSubmissionWeek).padStart(2, '0');
    const title = `[${nickname}] WEEK ${weekLabel} Solutions`;
    const files = submission.forkFiles.filter(
      ({ week }) => week === submission.activeSubmissionWeek,
    );
    const slugs = [...new Set(files.map(({ slug }) => slug))];
    const body = buildPullRequestBody(slugs);
    const url = buildPullRequestCompareUrl(owner, submission.submissionBranch, title, body);
    try {
      await vscode.commands.executeCommand('vscode.open', url);
    } catch {
      throw new Error('GitHub PR 작성 화면을 열지 못했습니다.');
    }
  }

  /** 주차 PR 병합과 깨끗한 로컬·원격 상태를 확인하고 main으로 전환해 동기화합니다. */
  async returnToMainAndSync(
    repositoryRoot: vscode.Uri,
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    const repository = await this.guards.requireSubmissionMutation(repositoryRoot, true);
    const branch = repository.state.HEAD?.name;
    if (!branch || !weekFromBranch(branch)) {
      throw new Error('main으로 돌아가기는 week-XX 제출 브랜치에서만 사용할 수 있습니다.');
    }
    if (
      repository.state.indexChanges.length > 0 ||
      repository.state.workingTreeChanges.length > 0 ||
      repository.state.untrackedChanges.length > 0 ||
      repository.state.mergeChanges.length > 0 ||
      repository.state.rebaseCommit
    ) {
      throw new Error('main으로 돌아가기 전에 모든 변경과 진행 중인 작업을 정리해 주세요.');
    }
    await repository.fetch({ remote: 'origin', prune: true });
    await repository.status();
    const remoteBranch = await this.guards.getBranch(repository, `origin/${branch}`);
    if (!remoteBranch) {
      throw new Error(`origin/${branch}을 찾을 수 없습니다.`);
    }
    if ((await getRefRelation(repository, `origin/${branch}`)) !== 'equal') {
      throw new Error(`${branch}의 로컬·원격 상태가 일치하지 않습니다.`);
    }
    const origin = this.guards.requireOrigin(repository);
    const remote = await this.githubClient.getRemoteSubmission(origin, branch, true);
    if (!remote.latestPullRequest || pullRequestStatus(remote.latestPullRequest) !== 'merged') {
      throw new Error('병합 완료된 주차 PR만 main으로 돌아가 동기화할 수 있습니다.');
    }
    await repository.checkout('main');
    await repository.status();
    await this.syncFork(repositoryRoot, solutions);
  }
}

/** 두 집합의 크기와 모든 원소가 일치하는지 확인합니다. */
function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

/** 커밋 메시지와 선택 파일의 주차를 검증합니다. Git 상태를 읽거나 변경하지 않습니다. */
function validateCommitInput(message: string, expectedFiles: readonly SubmissionFileSnapshot[]) {
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
  return { normalizedMessage, expectedPaths, week, submissionBranch };
}
