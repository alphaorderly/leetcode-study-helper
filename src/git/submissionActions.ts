import * as vscode from 'vscode';
import type {
  RepositorySubmissionSnapshot,
  SubmissionFileSnapshot,
} from '../core/types';
import {
  CANONICAL_FULL_NAME,
  CANONICAL_REMOTE_URL,
  type GitHubSubmissionClient,
  isCanonicalRemote,
  parseConsistentRemote,
} from './githubSubmissionClient';
import {
  type GitRepository,
  type GitRepositoryAdapter,
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

type GitRefRelation = 'equal' | 'ahead' | 'behind' | 'diverged';

export class SubmissionActions {
  constructor(
    private readonly repositoryAdapter: GitRepositoryAdapter,
    private readonly githubClient: GitHubSubmissionClient,
  ) {}

  async stageSolution(repositoryRoot: vscode.Uri, uri: vscode.Uri): Promise<void> {
    const repository = await this.repositoryAdapter.requireRepository(repositoryRoot);
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
    await repository.fetch({ remote: 'origin', ref: 'main', prune: true });
    await repository.status();
    this.requireCleanOperationState(repository);
    const relation = await this.getRefRelation(repository, 'origin/main');
    if (relation === 'equal') {
      throw new Error('origin/main에 push할 로컬 커밋이 없습니다.');
    }
    if (relation === 'behind') {
      throw new Error('로컬 main이 origin/main보다 뒤처져 있습니다. 포크를 먼저 동기화해 주세요.');
    }
    if (relation === 'diverged') {
      throw new Error('로컬 main과 origin/main이 서로 분기되어 push할 수 없습니다.');
    }

    const fileByPath = new Map(solutions.map((solution) => [
      relativeGitPath(repository.rootUri, vscode.Uri.parse(solution.uri)),
      solution,
    ]));
    const pendingCommits = await repository.log({
      range: 'origin/main..HEAD',
      reverse: true,
      maxEntries: MAX_PUSH_COMMITS + 1,
    });
    if (pendingCommits.length === 0) {
      throw new Error('origin/main에 push할 로컬 커밋이 없습니다.');
    }
    if (pendingCommits.length > MAX_PUSH_COMMITS) {
      throw new Error('미푸시 커밋이 너무 많아 안전하게 제출 범위를 확인할 수 없습니다.');
    }
    const pendingWeeks = new Set<number>();
    for (const commit of pendingCommits) {
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

    const origin = parseConsistentRemote(
      repository.state.remotes.find(({ name }) => name === 'origin'),
    )!;
    const remote = await this.githubClient.getRemoteSubmission(origin, true);
    if (remote.openPullRequestCount > 1) {
      throw new Error('origin/main에서 열린 PR이 여러 개입니다. GitHub에서 하나만 남겨 주세요.');
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
    const pendingWeek = [...pendingWeeks][0]!;
    const remoteWeek = remoteWeeks.size === 1 ? [...remoteWeeks][0] : undefined;
    if (remoteWeek !== undefined && remoteWeek !== pendingWeek) {
      throw new Error(
        `Week ${remoteWeek} 제출이 끝나기 전에는 Week ${pendingWeek} 커밋을 push할 수 없습니다.`,
      );
    }

    await repository.push('origin', 'main', false);
    await repository.status();
    this.githubClient.clearSubmissionCache();
  }

  async syncFork(repositoryRoot: vscode.Uri): Promise<void> {
    const repository = await this.requireSubmissionMutation(repositoryRoot, true);
    if (
      repository.state.indexChanges.length > 0
      || repository.state.workingTreeChanges.length > 0
      || repository.state.mergeChanges.length > 0
      || repository.state.rebaseCommit
    ) {
      throw new Error('스테이징 또는 추적 파일 변경을 먼저 정리해 주세요.');
    }

    await repository.fetch({ remote: 'origin', ref: 'main', prune: true });
    await repository.status();
    this.requireCleanOperationState(repository);

    const originRelation = await this.getRefRelation(repository, 'origin/main');
    if (originRelation === 'ahead') {
      throw new Error('origin에 push하지 않은 로컬 커밋을 먼저 처리해 주세요.');
    }
    if (originRelation === 'diverged') {
      throw new Error('로컬 main과 origin/main이 서로 분기되어 자동 동기화할 수 없습니다.');
    }
    if (originRelation === 'behind') {
      await this.mergeOrAbort(repository, 'origin/main');
    }

    const upstream = repository.state.remotes.find(({ name }) => name === 'upstream');
    if (upstream && !isCanonicalRemote(upstream.fetchUrl ?? upstream.pushUrl)) {
      throw new Error('기존 upstream이 DaleStudy/leetcode-study를 가리키지 않습니다.');
    }
    if (!upstream) {
      await repository.addRemote('upstream', CANONICAL_REMOTE_URL);
    }
    await repository.fetch({ remote: 'upstream', ref: 'main', prune: true });
    await repository.status();
    this.requireCleanOperationState(repository);

    const upstreamRelation = await this.getRefRelation(repository, 'upstream/main');
    if (upstreamRelation === 'behind' || upstreamRelation === 'diverged') {
      await this.mergeOrAbort(repository, 'upstream/main');
    }
    const finalOriginRelation = await this.getRefRelation(repository, 'origin/main');
    if (finalOriginRelation !== 'equal' && finalOriginRelation !== 'ahead') {
      throw new Error('동기화 결과가 origin/main에서 이어지지 않아 push하지 않았습니다.');
    }
    if (!repository.state.HEAD?.upstream) {
      await repository.setBranchUpstream('main', 'origin/main');
    }
    await repository.push('origin', 'main', false);
    await repository.status();
    this.githubClient.clearSubmissionCache();
  }

  async openPullRequest(
    submission: RepositorySubmissionSnapshot,
    nickname: string,
  ): Promise<void> {
    if (submission.activePullRequest) {
      if (!await vscode.env.openExternal(vscode.Uri.parse(submission.activePullRequest.url))) {
        throw new Error('GitHub PR 페이지를 열지 못했습니다.');
      }
      return;
    }
    if (submission.pendingCommits.some(({ pushed }) => !pushed)) {
      throw new Error('PR을 만들기 전에 로컬 커밋을 origin에 push해 주세요.');
    }
    if (!submission.activeSubmissionWeek || submission.fork.status !== 'verified') {
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
    const body = [
      '## 답안 제출 문제',
      '',
      ...slugs.map((slug) => `- [x] ${slug}`),
      '',
      '## 작성자 체크 리스트',
      '',
      '- [ ] Projects에서 현재 주차를 설정했습니다.',
      '- [ ] 문제를 모두 풀었다면 Status를 In Review로 설정했습니다.',
    ].join('\n');
    const compare = `https://github.com/${CANONICAL_FULL_NAME}/compare/main...${owner}:main`;
    const url = new URL(compare);
    url.searchParams.set('expand', '1');
    url.searchParams.set('title', title);
    url.searchParams.set('body', body);
    if (!await vscode.env.openExternal(vscode.Uri.parse(url.toString()))) {
      throw new Error('GitHub PR 작성 화면을 열지 못했습니다.');
    }
  }

  private async requireSubmissionMutation(
    repositoryRoot: vscode.Uri,
    forceIdentity: boolean,
  ): Promise<GitRepository> {
    const repository = await this.repositoryAdapter.requireRepository(repositoryRoot);
    await repository.status();
    this.requireCleanOperationState(repository);
    const origin = parseConsistentRemote(
      repository.state.remotes.find(({ name }) => name === 'origin'),
    );
    if (!origin) {
      throw new Error(
        'origin의 fetch/push URL이 동일한 GitHub 저장소를 가리키지 않습니다.',
      );
    }
    const identity = await this.githubClient.getForkIdentity(origin, forceIdentity);
    if (identity.status !== 'verified') {
      throw new Error(identity.reason ?? 'DaleStudy 포크를 확인할 수 없습니다.');
    }
    return repository;
  }

  private requireCleanOperationState(repository: GitRepository): void {
    if (repository.state.HEAD?.name !== 'main') {
      throw new Error('제출 기능은 main 브랜치에서만 사용할 수 있습니다.');
    }
    if (repository.state.rebaseCommit || repository.state.mergeChanges.length > 0) {
      throw new Error('진행 중인 merge 또는 rebase를 먼저 정리해 주세요.');
    }
  }

  private async getRefRelation(
    repository: GitRepository,
    remoteRef: string,
  ): Promise<GitRefRelation> {
    const [head, remote] = await Promise.all([
      repository.getCommit('HEAD'),
      repository.getCommit(remoteRef),
    ]);
    if (head.hash === remote.hash) {
      return 'equal';
    }
    const mergeBase = await repository.getMergeBase('HEAD', remoteRef);
    if (mergeBase === remote.hash) {
      return 'ahead';
    }
    if (mergeBase === head.hash) {
      return 'behind';
    }
    return 'diverged';
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
