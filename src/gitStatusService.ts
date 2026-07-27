import * as path from 'node:path';
import * as vscode from 'vscode';
import { AsyncVersionCache } from './core/asyncVersionCache';
import type {
  ForkIdentitySnapshot,
  RepositorySubmissionSnapshot,
  SolutionGitStatus,
  SolutionSubmissionStatus,
  SubmissionCommitSnapshot,
  SubmissionFileSnapshot,
  SubmissionSummary,
} from './core/types';

const CANONICAL_OWNER = 'DaleStudy';
const CANONICAL_REPOSITORY = 'leetcode-study';
const CANONICAL_FULL_NAME = `${CANONICAL_OWNER}/${CANONICAL_REPOSITORY}`;
const CANONICAL_REMOTE_URL = `https://github.com/${CANONICAL_FULL_NAME}.git`;
const REMOTE_CACHE_MS = 30_000;
const GITHUB_API_TIMEOUT_MS = 8_000;
const MAX_PUSH_COMMITS = 200;

interface GitChange {
  readonly uri: vscode.Uri;
  readonly originalUri: vscode.Uri;
  readonly renameUri: vscode.Uri | undefined;
}

interface GitUpstreamRef {
  readonly remote: string;
  readonly name: string;
  readonly commit?: string;
}

interface GitBranch {
  readonly name?: string;
  readonly commit?: string;
  readonly upstream?: GitUpstreamRef;
  readonly ahead?: number;
  readonly behind?: number;
}

interface GitRepositoryState {
  readonly HEAD: GitBranch | undefined;
  readonly remotes: GitRemote[];
  readonly rebaseCommit?: GitCommit;
  readonly mergeChanges: GitChange[];
  readonly indexChanges: GitChange[];
  readonly workingTreeChanges: GitChange[];
  readonly untrackedChanges: GitChange[];
  readonly onDidChange: vscode.Event<unknown>;
}

interface GitRemote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

interface GitCommit {
  readonly hash: string;
  readonly message: string;
  readonly parents: string[];
}

interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
  getCommit(ref: string): Promise<GitCommit>;
  getMergeBase(ref1: string, ref2: string): Promise<string | undefined>;
  diffBetween(ref1: string, ref2: string): Promise<GitChange[]>;
  log(options?: {
    maxEntries?: number;
    range?: string;
    reverse?: boolean;
  }): Promise<GitCommit[]>;
  add(paths: string[]): Promise<void>;
  revert(paths: string[]): Promise<void>;
  commit(message: string, options?: {
    requireUserConfig?: boolean;
    postCommitCommand?: string | null;
  }): Promise<void>;
  fetch(options?: { remote?: string; ref?: string; prune?: boolean }): Promise<void>;
  push(
    remoteName?: string,
    branchName?: string,
    setUpstream?: boolean,
  ): Promise<void>;
  merge(ref: string): Promise<void>;
  mergeAbort(): Promise<void>;
  addRemote(name: string, url: string): Promise<void>;
  setBranchUpstream(name: string, upstream: string): Promise<void>;
  status(): Promise<void>;
}

interface GitApi {
  readonly repositories: GitRepository[];
  readonly onDidChangeState: vscode.Event<unknown>;
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
  getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}

export interface SolutionGitStatusResult {
  remoteName?: string;
  statuses: ReadonlyMap<string, SolutionGitStatus>;
  submissionStatuses?: ReadonlyMap<string, SolutionSubmissionStatus>;
  pullRequestNumbers?: ReadonlyMap<string, number>;
  submission?: RepositorySubmissionSnapshot;
}

export interface SubmissionSolution {
  readonly name: string;
  readonly uri: string;
  readonly slug: string;
  readonly week?: number;
}

interface GitHubRepositoryResponse {
  readonly full_name?: string;
  readonly fork?: boolean;
  readonly source?: { readonly full_name?: string };
  readonly parent?: { readonly full_name?: string };
}

interface GitHubCompareFile {
  readonly filename: string;
  readonly status: string;
}

interface GitHubCompareCommit {
  readonly sha: string;
  readonly commit: { readonly message?: string };
  readonly parents: Array<{ readonly sha: string }>;
}

interface GitHubCompareResponse {
  readonly ahead_by?: number;
  readonly behind_by?: number;
  readonly files?: GitHubCompareFile[];
  readonly commits?: GitHubCompareCommit[];
}

interface GitHubPullRequest {
  readonly number: number;
  readonly title: string;
  readonly html_url: string;
}

interface GitHubPullFile {
  readonly filename: string;
}

interface GitHubTreeEntry {
  readonly path?: string;
  readonly type?: string;
}

interface GitHubTreeResponse {
  readonly truncated?: boolean;
  readonly tree?: GitHubTreeEntry[];
}

interface ParsedGitHubRemote {
  readonly owner: string;
  readonly repository: string;
  readonly url: string;
}

interface RemoteSubmissionState {
  readonly compareFiles: GitHubCompareFile[];
  readonly compareCommits: GitHubCompareCommit[];
  readonly behindBy: number;
  readonly openPullRequestCount: number;
  readonly activePullRequest?: GitHubPullRequest;
  readonly pullRequestFiles: string[];
  readonly canonicalFilePaths?: ReadonlySet<string>;
}

interface CachedRemoteValue<T> {
  readonly expiresAt: number;
  readonly value: T;
}

type GitRefRelation = 'equal' | 'ahead' | 'behind' | 'diverged';

interface SubmissionMutationContext {
  readonly repository: GitRepository;
  readonly origin: ParsedGitHubRemote;
}

function upstreamRef(upstream: GitUpstreamRef): string {
  return upstream.name.startsWith(`${upstream.remote}/`)
    ? upstream.name
    : `${upstream.remote}/${upstream.name}`;
}

function addChangeUris(target: Set<string>, changes: readonly GitChange[]): void {
  for (const change of changes) {
    target.add(change.uri.toString());
    target.add(change.originalUri.toString());
    if (change.renameUri) {
      target.add(change.renameUri.toString());
    }
  }
}

function uriContains(parent: vscode.Uri, child: vscode.Uri): boolean {
  if (parent.scheme !== child.scheme || parent.authority !== child.authority) {
    return false;
  }
  const parentPath = parent.path.endsWith('/') ? parent.path : `${parent.path}/`;
  return child.path === parent.path || child.path.startsWith(parentPath);
}

function repositoryFingerprint(repository: GitRepository): string {
  const {
    HEAD,
    remotes,
    rebaseCommit,
    mergeChanges,
    indexChanges,
    workingTreeChanges,
    untrackedChanges,
  } =
    repository.state;
  const changeFingerprint = (changes: readonly GitChange[]): string[] =>
    changes.map(({ uri }) => uri.toString()).sort();
  return JSON.stringify([
    HEAD?.commit,
    HEAD?.upstream?.remote,
    HEAD?.upstream?.name,
    HEAD?.upstream?.commit,
    HEAD?.ahead,
    HEAD?.behind,
    remotes.map(({ name, fetchUrl, pushUrl }) => [name, fetchUrl, pushUrl]),
    rebaseCommit?.hash,
    changeFingerprint(mergeChanges),
    changeFingerprint(indexChanges),
    changeFingerprint(workingTreeChanges),
    changeFingerprint(untrackedChanges),
  ]);
}

function parseGitHubRemote(url: string | undefined): ParsedGitHubRemote | undefined {
  if (!url) {
    return undefined;
  }
  const trimmed = url.trim();
  const match = trimmed.match(
    /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  );
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return {
    owner: match[1],
    repository: match[2],
    url: trimmed,
  };
}

function sameGitHubRepository(
  left: ParsedGitHubRemote,
  right: ParsedGitHubRemote,
): boolean {
  return left.owner.toLowerCase() === right.owner.toLowerCase()
    && left.repository.toLowerCase() === right.repository.toLowerCase();
}

function parseConsistentRemote(remote: GitRemote | undefined): ParsedGitHubRemote | undefined {
  const fetch = parseGitHubRemote(remote?.fetchUrl);
  const push = parseGitHubRemote(remote?.pushUrl);
  if (fetch && push && !sameGitHubRepository(fetch, push)) {
    return undefined;
  }
  return push ?? fetch;
}

function isCanonicalRemote(url: string | undefined): boolean {
  const parsed = parseGitHubRemote(url);
  return parsed?.owner.toLowerCase() === CANONICAL_OWNER.toLowerCase()
    && parsed.repository.toLowerCase() === CANONICAL_REPOSITORY.toLowerCase();
}

function relativeGitPath(root: vscode.Uri, uri: vscode.Uri): string {
  return path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/');
}

function addRelativeChangePaths(
  target: Set<string>,
  root: vscode.Uri,
  changes: readonly GitChange[],
): void {
  for (const change of changes) {
    target.add(relativeGitPath(root, change.uri));
    target.add(relativeGitPath(root, change.originalUri));
    if (change.renameUri) {
      target.add(relativeGitPath(root, change.renameUri));
    }
  }
}

function relativeChangePaths(
  root: vscode.Uri,
  changes: readonly GitChange[],
): Set<string> {
  const paths = new Set<string>();
  addRelativeChangePaths(paths, root, changes);
  return paths;
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function defaultSummary(): SubmissionSummary {
  return {
    working: 0,
    staged: 0,
    pushNeeded: 0,
    prPending: 0,
    merged: 0,
    unknown: 0,
  };
}

function summaryForStatuses(
  statuses: ReadonlyMap<string, SolutionSubmissionStatus>,
): SubmissionSummary {
  const summary = defaultSummary();
  for (const status of statuses.values()) {
    switch (status) {
      case 'working':
      case 'staged-outdated':
        summary.working += 1;
        break;
      case 'staged':
        summary.staged += 1;
        break;
      case 'push-needed':
        summary.pushNeeded += 1;
        break;
      case 'pr-needed':
      case 'pr-open':
      case 'sync-needed':
        summary.prPending += 1;
        break;
      case 'merged':
        summary.merged += 1;
        break;
      case 'checking':
      case 'conflict':
      case 'unknown':
        summary.unknown += 1;
        break;
    }
  }
  return summary;
}

function singleWeek(
  files: readonly SubmissionFileSnapshot[],
): number | undefined {
  const weeks = new Set(files.map(({ week }) => week).filter(
    (week): week is number => week !== undefined,
  ));
  return weeks.size === 1 ? [...weeks][0] : undefined;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() || '커밋';
}

export class GitStatusService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly repositorySubscriptions = new Map<string, vscode.Disposable>();
  private readonly repositoryFingerprints = new Map<string, string>();
  private readonly committedChanges = new AsyncVersionCache<ReadonlySet<string>>();
  private readonly forkIdentityCache = new Map<string, CachedRemoteValue<ForkIdentitySnapshot>>();
  private readonly remoteSubmissionCache =
    new Map<string, CachedRemoteValue<RemoteSubmissionState>>();
  private canonicalTreeCache: CachedRemoteValue<ReadonlySet<string>> | undefined;
  private apiPromise: Promise<GitApi | undefined> | undefined;

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

    const api = await this.getApi();
    const repository = api ? this.findRepository(api, repositoryRoot) : undefined;
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
        const committedChanges = await this.getCommittedChanges(repository, upstream);
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
    const repository = await this.requireRepository(repositoryRoot);
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
    const repository = await this.requireRepository(repositoryRoot);
    await repository.revert([uri.fsPath]);
    await repository.status();
  }

  async commit(
    repositoryRoot: vscode.Uri,
    message: string,
    expectedFiles: readonly SubmissionFileSnapshot[],
  ): Promise<void> {
    const { repository } = await this.requireSubmissionMutation(
      repositoryRoot,
      false,
    );
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
    const { repository, origin } = await this.requireSubmissionMutation(
      repositoryRoot,
      true,
    );
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

    const remote = await this.getRemoteSubmission(origin, true);
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
    this.clearRemoteCache(repositoryRoot);
  }

  async syncFork(repositoryRoot: vscode.Uri): Promise<void> {
    const { repository } = await this.requireSubmissionMutation(
      repositoryRoot,
      true,
    );
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
    this.clearRemoteCache(repositoryRoot);
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
  ): Promise<SubmissionMutationContext> {
    const repository = await this.requireRepository(repositoryRoot);
    await repository.status();
    this.requireCleanOperationState(repository);
    const originRemote = repository.state.remotes.find(({ name }) => name === 'origin');
    const origin = parseConsistentRemote(originRemote);
    if (!origin) {
      throw new Error(
        'origin의 fetch/push URL이 동일한 GitHub 저장소를 가리키지 않습니다.',
      );
    }
    const identity = await this.getForkIdentity(origin, forceIdentity);
    if (identity.status !== 'verified') {
      throw new Error(identity.reason ?? 'DaleStudy 포크를 확인할 수 없습니다.');
    }
    return { repository, origin };
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

  dispose(): void {
    for (const subscription of this.repositorySubscriptions.values()) {
      subscription.dispose();
    }
    this.repositorySubscriptions.clear();
    this.repositoryFingerprints.clear();
    this.committedChanges.clear();
    this.forkIdentityCache.clear();
    this.remoteSubmissionCache.clear();
    this.canonicalTreeCache = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.changeEmitter.dispose();
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
    const statuses = new Map(
      files.map(({ uri }) => [uri, 'unknown' as SolutionSubmissionStatus]),
    );
    const pullRequestNumbers = new Map<string, number>();
    const origin = repository.state.remotes.find(({ name }) => name === 'origin');
    const parsedOrigin = parseConsistentRemote(origin);
    const fork = parsedOrigin
      ? await this.getForkIdentity(parsedOrigin, forceRemote)
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
      for (const file of files) {
        if (conflictPaths.has(file.relativePath)) {
          statuses.set(file.uri, 'conflict');
        } else if (indexPaths.has(file.relativePath) && workingPaths.has(file.relativePath)) {
          statuses.set(file.uri, 'staged-outdated');
        } else if (indexPaths.has(file.relativePath)) {
          statuses.set(file.uri, 'staged');
        } else if (workingPaths.has(file.relativePath)) {
          statuses.set(file.uri, 'working');
        }
      }
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
      return { statuses, pullRequestNumbers, snapshot };
    }

    let remote: RemoteSubmissionState;
    try {
      remote = await this.getRemoteSubmission(parsedOrigin, forceRemote);
    } catch (error) {
      for (const file of files) {
        if (conflictPaths.has(file.relativePath)) {
          statuses.set(file.uri, 'conflict');
        } else if (indexPaths.has(file.relativePath) && workingPaths.has(file.relativePath)) {
          statuses.set(file.uri, 'staged-outdated');
        } else if (indexPaths.has(file.relativePath)) {
          statuses.set(file.uri, 'staged');
        } else if (workingPaths.has(file.relativePath)) {
          statuses.set(file.uri, 'working');
        }
      }
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
      return { statuses, pullRequestNumbers, snapshot };
    }

    const pendingCommits = await this.getLocalPendingCommits(repository, fileByPath);
    const pendingPaths = new Set(
      pendingCommits.flatMap(({ files }) => files.map(({ relativePath }) => relativePath)),
    );
    const remotePaths = new Set(remote.compareFiles.map(({ filename }) => filename));
    const pullRequestPaths = new Set(remote.pullRequestFiles);
    const forkFiles = remote.compareFiles.flatMap(({ filename }) => {
      const file = fileByPath.get(filename);
      return file ? [file] : [];
    });
    const otherForkFiles = remote.compareFiles
      .map(({ filename }) => filename)
      .filter((filename) => !fileByPath.has(filename));

    for (const file of files) {
      let status: SolutionSubmissionStatus;
      if (conflictPaths.has(file.relativePath)) {
        status = 'conflict';
      } else if (indexPaths.has(file.relativePath) && workingPaths.has(file.relativePath)) {
        status = 'staged-outdated';
      } else if (indexPaths.has(file.relativePath)) {
        status = 'staged';
      } else if (workingPaths.has(file.relativePath)) {
        status = 'working';
      } else if (pendingPaths.has(file.relativePath)) {
        status = 'push-needed';
      } else if (remotePaths.has(file.relativePath) && pullRequestPaths.has(file.relativePath)) {
        status = 'pr-open';
        if (remote.activePullRequest) {
          pullRequestNumbers.set(file.uri, remote.activePullRequest.number);
        }
      } else if (remotePaths.has(file.relativePath)) {
        const comparison = remote.compareFiles.find(
          ({ filename }) => filename === file.relativePath,
        );
        status = comparison?.status === 'modified' && remote.behindBy > 0
          ? 'sync-needed'
          : 'pr-needed';
      } else if (remote.canonicalFilePaths?.has(file.relativePath)) {
        status = 'merged';
      } else if (remote.behindBy > 0) {
        status = 'sync-needed';
      } else {
        status = 'unknown';
      }
      statuses.set(file.uri, status);
    }

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
    const branchUpstream = repository.state.HEAD?.upstream;
    const tracksOriginMain = branchUpstream
      ? upstreamRef(branchUpstream) === 'origin/main'
      : false;
    const hasKnownUnpushedCommits = tracksOriginMain
      && (repository.state.HEAD?.ahead ?? 0) > 0;
    const hasTrackedChanges = repository.state.indexChanges.length > 0
      || repository.state.workingTreeChanges.length > 0
      || repository.state.mergeChanges.length > 0;
    const canSync = branch === 'main'
      && !hasTrackedChanges
      && !repository.state.rebaseCommit
      && !hasKnownUnpushedCommits;
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

  private async getForkIdentity(
    remote: ParsedGitHubRemote,
    force: boolean,
  ): Promise<ForkIdentitySnapshot> {
    const key = `${remote.owner}/${remote.repository}`.toLowerCase();
    const cached = this.forkIdentityCache.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    try {
      const response = await this.githubJson<GitHubRepositoryResponse>(
        `/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repository)}`,
      );
      const source = response.source?.full_name ?? response.parent?.full_name;
      const verified = response.fork === true
        && source?.toLowerCase() === CANONICAL_FULL_NAME.toLowerCase();
      const value: ForkIdentitySnapshot = verified
        ? {
          status: 'verified',
          owner: remote.owner,
          repository: remote.repository,
          originUrl: remote.url,
        }
        : {
          status: 'unsupported',
          owner: remote.owner,
          repository: remote.repository,
          originUrl: remote.url,
          reason: `${CANONICAL_FULL_NAME}에서 포크한 저장소가 아닙니다.`,
        };
      this.forkIdentityCache.set(key, {
        expiresAt: Date.now() + REMOTE_CACHE_MS,
        value,
      });
      return value;
    } catch (error) {
      if (cached?.value.status === 'verified') {
        return cached.value;
      }
      return {
        status: 'unavailable',
        owner: remote.owner,
        repository: remote.repository,
        originUrl: remote.url,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async getRemoteSubmission(
    remote: ParsedGitHubRemote,
    force: boolean,
  ): Promise<RemoteSubmissionState> {
    const key = `${remote.owner}/${remote.repository}`.toLowerCase();
    const cached = this.remoteSubmissionCache.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const comparePath = `/repos/${CANONICAL_FULL_NAME}/compare/main...${encodeURIComponent(remote.owner)}:main`;
    const pullsPath = `/repos/${CANONICAL_FULL_NAME}/pulls?state=open&base=main&head=${encodeURIComponent(`${remote.owner}:main`)}&per_page=10`;
    const [compare, pulls, canonicalFilePaths] = await Promise.all([
      this.githubJson<GitHubCompareResponse>(comparePath),
      this.githubJson<GitHubPullRequest[]>(pullsPath),
      this.getCanonicalFilePaths(force),
    ]);
    const activePullRequest = pulls[0];
    const pullRequestFiles = activePullRequest
      ? (await this.githubJson<GitHubPullFile[]>(
        `/repos/${CANONICAL_FULL_NAME}/pulls/${activePullRequest.number}/files?per_page=100`,
      )).map(({ filename }) => filename)
      : [];
    const value: RemoteSubmissionState = {
      compareFiles: compare.files ?? [],
      compareCommits: compare.commits ?? [],
      behindBy: compare.behind_by ?? 0,
      openPullRequestCount: pulls.length,
      activePullRequest,
      pullRequestFiles,
      canonicalFilePaths,
    };
    this.remoteSubmissionCache.set(key, {
      expiresAt: Date.now() + REMOTE_CACHE_MS,
      value,
    });
    return value;
  }

  private async getCanonicalFilePaths(
    force: boolean,
  ): Promise<ReadonlySet<string> | undefined> {
    const cached = this.canonicalTreeCache;
    if (!force && cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    try {
      const response = await this.githubJson<GitHubTreeResponse>(
        `/repos/${CANONICAL_FULL_NAME}/git/trees/main?recursive=1`,
      );
      if (response.truncated || !Array.isArray(response.tree)) {
        return undefined;
      }
      const value = new Set(
        response.tree.flatMap(({ path: entryPath, type }) =>
          type === 'blob' && entryPath ? [entryPath] : []),
      );
      this.canonicalTreeCache = {
        expiresAt: Date.now() + REMOTE_CACHE_MS,
        value,
      };
      return value;
    } catch {
      return undefined;
    }
  }

  private async githubJson<T>(apiPath: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GITHUB_API_TIMEOUT_MS);
    try {
      const response = await fetch(`https://api.github.com${apiPath}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'leetcode-study-helper',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`GitHub 상태 확인 실패 (${response.status})`);
      }
      return await response.json() as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private clearRemoteCache(repositoryRoot: vscode.Uri): void {
    void repositoryRoot;
    this.remoteSubmissionCache.clear();
    this.canonicalTreeCache = undefined;
  }

  private async requireRepository(repositoryRoot: vscode.Uri): Promise<GitRepository> {
    const api = await this.getApi();
    const repository = api ? this.findRepository(api, repositoryRoot) : undefined;
    if (!repository) {
      throw new Error('현재 워크스페이스의 Git 저장소를 찾을 수 없습니다.');
    }
    return repository;
  }

  private getApi(): Promise<GitApi | undefined> {
    this.apiPromise ??= this.activateApi();
    return this.apiPromise;
  }

  private async activateApi(): Promise<GitApi | undefined> {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
      return undefined;
    }

    try {
      const gitExtension = extension.isActive ? extension.exports : await extension.activate();
      if (!gitExtension.enabled) {
        return undefined;
      }
      const api = gitExtension.getAPI(1);
      for (const repository of api.repositories) {
        this.subscribeRepository(repository);
      }
      this.disposables.push(
        api.onDidChangeState(() => this.changeEmitter.fire()),
        api.onDidOpenRepository((repository) => {
          this.subscribeRepository(repository);
          this.changeEmitter.fire();
        }),
        api.onDidCloseRepository((repository) => {
          const key = repository.rootUri.toString();
          this.repositorySubscriptions.get(key)?.dispose();
          this.repositorySubscriptions.delete(key);
          this.repositoryFingerprints.delete(key);
          this.committedChanges.delete(key);
          this.changeEmitter.fire();
        }),
      );
      return api;
    } catch {
      return undefined;
    }
  }

  private findRepository(api: GitApi, rootUri: vscode.Uri): GitRepository | undefined {
    const repository = api.getRepository(rootUri) ?? undefined;
    if (repository && uriContains(repository.rootUri, rootUri)) {
      return repository;
    }
    return api.repositories.find(({ rootUri: gitRoot }) => uriContains(gitRoot, rootUri));
  }

  private async getCommittedChanges(
    repository: GitRepository,
    upstream: GitUpstreamRef,
  ): Promise<ReadonlySet<string>> {
    const repositoryKey = repository.rootUri.toString();
    const remoteRef = upstreamRef(upstream);
    const cacheKey = JSON.stringify([
      repository.state.HEAD?.commit,
      remoteRef,
      upstream.commit,
    ]);
    return this.committedChanges.get(repositoryKey, cacheKey, async () => {
      const uris = new Set<string>();
      const mergeBase = await repository.getMergeBase('HEAD', remoteRef);
      if (mergeBase) {
        addChangeUris(uris, await repository.diffBetween(mergeBase, 'HEAD'));
      }
      return uris;
    });
  }

  private subscribeRepository(repository: GitRepository): void {
    const key = repository.rootUri.toString();
    if (this.repositorySubscriptions.has(key)) {
      return;
    }
    this.repositoryFingerprints.set(key, repositoryFingerprint(repository));
    this.repositorySubscriptions.set(
      key,
      repository.state.onDidChange(() => {
        const fingerprint = repositoryFingerprint(repository);
        if (fingerprint === this.repositoryFingerprints.get(key)) {
          return;
        }
        this.repositoryFingerprints.set(key, fingerprint);
        this.changeEmitter.fire();
      }),
    );
  }
}
