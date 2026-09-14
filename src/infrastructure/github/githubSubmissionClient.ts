import type { ForkIdentitySnapshot } from '../../shared/contracts';
import type { GitRemote } from '../git/vscodeGit';

export const CANONICAL_OWNER = 'DaleStudy';
export const CANONICAL_REPOSITORY = 'leetcode-study';
export const CANONICAL_FULL_NAME = `${CANONICAL_OWNER}/${CANONICAL_REPOSITORY}`;
export const CANONICAL_REMOTE_URL = `https://github.com/${CANONICAL_FULL_NAME}.git`;

const REMOTE_CACHE_MS = 30_000;
const GITHUB_API_TIMEOUT_MS = 8_000;

/** 포크 여부와 원본 저장소 확인에 필요한 GitHub 저장소 응답 필드입니다. */
interface GitHubRepositoryResponse {
  readonly full_name?: string;
  readonly fork?: boolean;
  readonly source?: { readonly full_name?: string };
  readonly parent?: { readonly full_name?: string };
}

/** GitHub 비교 API가 반환한 변경 파일 경로와 변경 종류입니다. */
export interface GitHubCompareFile {
  readonly filename: string;
  readonly status: string;
}

/** GitHub 비교 API가 반환한 커밋 SHA, 메시지와 부모 목록입니다. */
export interface GitHubCompareCommit {
  readonly sha: string;
  readonly commit: { readonly message?: string };
  readonly parents: Array<{ readonly sha: string }>;
}

/** 브랜치 간 앞섬·뒤처짐과 변경 파일·커밋을 담은 GitHub 비교 응답입니다. */
interface GitHubCompareResponse {
  readonly ahead_by?: number;
  readonly behind_by?: number;
  readonly total_commits?: number;
  readonly files?: GitHubCompareFile[];
  readonly commits?: GitHubCompareCommit[];
}

/** 주차 제출 PR의 신원, 상태와 원본 브랜치 정보입니다. */
export interface GitHubPullRequest {
  readonly number: number;
  readonly title: string;
  readonly html_url: string;
  readonly state?: 'open' | 'closed';
  readonly merged_at?: string | null;
  readonly head?: {
    readonly ref?: string;
    readonly repo?: { readonly full_name?: string } | null;
    readonly user?: { readonly login?: string } | null;
  };
}

/** PR 변경 파일 조회에서 사용하는 저장소 상대 경로입니다. */
interface GitHubPullFile {
  readonly filename: string;
}

/** 공식 저장소 트리의 항목 경로, 객체 종류와 SHA입니다. */
interface GitHubTreeEntry {
  readonly path?: string;
  readonly type?: string;
  readonly sha?: string;
}

/** 공식 저장소 트리 응답과 조회 결과 잘림 여부입니다. */
interface GitHubTreeResponse {
  readonly truncated?: boolean;
  readonly tree?: GitHubTreeEntry[];
}

/** GitHub remote URL에서 추출한 소유자·저장소 이름과 원래 URL입니다. */
export interface ParsedGitHubRemote {
  readonly owner: string;
  readonly repository: string;
  readonly url: string;
}

/** 포크 브랜치 비교, 주차 PR와 공식 파일 정보를 합친 원격 제출 조회 결과입니다. */
export interface RemoteSubmissionState {
  readonly headBranch?: string;
  readonly compareFiles: GitHubCompareFile[];
  readonly compareCommits: GitHubCompareCommit[];
  readonly behindBy: number;
  readonly openPullRequestCount: number;
  readonly activePullRequest?: GitHubPullRequest;
  readonly latestPullRequest?: GitHubPullRequest;
  readonly pullRequestFiles: string[];
  readonly canonicalFilePaths?: ReadonlySet<string>;
  readonly canonicalFileHashes?: ReadonlyMap<string, string>;
  readonly compareIncomplete?: boolean;
}

/** 공식 main의 파일 경로 집합과 파일별 객체 해시입니다. */
interface CanonicalFileTree {
  readonly paths: ReadonlySet<string>;
  readonly hashes: ReadonlyMap<string, string>;
}

/** 만료 시각을 함께 보관하는 원격 조회 캐시 항목입니다. */
interface CachedRemoteValue<T> {
  readonly expiresAt: number;
  readonly value: T;
}

/** 지원하는 GitHub HTTPS·SSH URL을 해석하며 인식할 수 없으면 undefined입니다. */
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

/** 소유자와 저장소 이름을 대소문자 구분 없이 비교합니다. */
function sameGitHubRepository(left: ParsedGitHubRemote, right: ParsedGitHubRemote): boolean {
  return (
    left.owner.toLowerCase() === right.owner.toLowerCase() &&
    left.repository.toLowerCase() === right.repository.toLowerCase()
  );
}

/** fetch와 push URL을 해석하고 서로 다른 GitHub 저장소를 가리키면 undefined를 반환합니다. */
export function parseConsistentRemote(
  remote: GitRemote | undefined,
): ParsedGitHubRemote | undefined {
  if (!remote) {
    return undefined;
  }
  const fetchUrl = remote.fetchUrl?.trim();
  const pushUrl = remote.pushUrl?.trim();
  const fetch = parseGitHubRemote(fetchUrl);
  const push = parseGitHubRemote(pushUrl);
  if ((fetchUrl && !fetch) || (pushUrl && !push)) {
    return undefined;
  }
  if (fetch && push && !sameGitHubRepository(fetch, push)) {
    return undefined;
  }
  return push ?? fetch;
}

/** URL이 공식 DaleStudy 저장소를 가리키는지 확인합니다. */
export function isCanonicalRemote(url: string | undefined): boolean {
  const parsed = parseGitHubRemote(url);
  return (
    parsed?.owner.toLowerCase() === CANONICAL_OWNER.toLowerCase() &&
    parsed.repository.toLowerCase() === CANONICAL_REPOSITORY.toLowerCase()
  );
}

/**
 * 공식 저장소 remote를 찾으며 upstream 이름을 우선합니다.
 * @throws 기존 upstream이 공식 저장소를 가리키지 않는 경우.
 */
export function resolveCanonicalRemoteName(remotes: readonly GitRemote[]): string | undefined {
  const namedUpstream = remotes.find(({ name }) => name === 'upstream');
  if (namedUpstream) {
    const parsed = parseConsistentRemote(namedUpstream);
    if (
      !parsed ||
      parsed.owner.toLowerCase() !== CANONICAL_OWNER.toLowerCase() ||
      parsed.repository.toLowerCase() !== CANONICAL_REPOSITORY.toLowerCase()
    ) {
      throw new Error(
        '기존 upstream이 DaleStudy/leetcode-study를 가리키지 않습니다. fetch/push URL을 모두 확인해 주세요.',
      );
    }
  }
  const canonicalNames = remotes.flatMap((remote) => {
    const parsed = parseConsistentRemote(remote);
    return parsed &&
      parsed.owner.toLowerCase() === CANONICAL_OWNER.toLowerCase() &&
      parsed.repository.toLowerCase() === CANONICAL_REPOSITORY.toLowerCase()
      ? [remote.name]
      : [];
  });
  if (canonicalNames.includes('upstream')) {
    return 'upstream';
  }
  return canonicalNames[0];
}

/** GitHub 요청의 HTTP 상태와 인증 사용 여부를 보존하는 오류입니다. */
export class GitHubRequestError extends Error {
  readonly status: number;
  readonly usedAuth: boolean;
  readonly needsSignIn: boolean;

  /** HTTP 상태와 인증 여부로 로그인 안내 필요 여부를 계산합니다. */
  constructor(status: number, usedAuth: boolean) {
    const needsSignIn = status === 401 || (status === 403 && !usedAuth);
    super(
      needsSignIn
        ? 'GitHub API 요청 한도에 걸렸습니다. GitHub으로 로그인하면 상태를 확인할 수 있습니다.'
        : `GitHub 상태 확인 실패 (${status})`,
    );
    this.name = 'GitHubRequestError';
    this.status = status;
    this.usedAuth = usedAuth;
    this.needsSignIn = needsSignIn;
  }
}

/** GitHub 요청 실패가 로그인 안내를 필요로 하는지 확인합니다. */
export function githubRequestNeedsSignIn(error: unknown): boolean {
  return error instanceof GitHubRequestError && error.needsSignIn;
}

/** GitHub API로 포크 신원과 주차별 PR·변경 파일을 조회하고 유효 기간 동안 캐시합니다. */
export class GitHubSubmissionClient {
  private readonly forkIdentityCache = new Map<string, CachedRemoteValue<ForkIdentitySnapshot>>();
  private readonly remoteSubmissionCache = new Map<
    string,
    CachedRemoteValue<RemoteSubmissionState>
  >();
  private canonicalTreeCache: CachedRemoteValue<CanonicalFileTree> | undefined;

  /** 토큰 공급자와 요청 구현을 주입받아 GitHub 조회에 사용합니다. */
  constructor(
    private readonly getAccessToken: () => Promise<string | undefined> = async () => undefined,
  ) {}

  /**
   * DaleStudy 포크인지 조회합니다. 조회 실패 시 이전 verified 결과가 있으면 재사용합니다.
   * @param force 유효한 캐시가 있어도 새 조회를 시도할지 여부.
   */
  async getForkIdentity(remote: ParsedGitHubRemote, force: boolean): Promise<ForkIdentitySnapshot> {
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
      const verified =
        response.fork === true && source?.toLowerCase() === CANONICAL_FULL_NAME.toLowerCase();
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
        needsGitHubSignIn: githubRequestNeedsSignIn(error),
      };
    }
  }

  /** 주차 브랜치별 비교 결과와 PR 상태를 조회합니다. 불완전한 비교 결과는 표시해 제출을 차단할 수 있게 합니다. */
  async getRemoteSubmission(
    remote: ParsedGitHubRemote,
    headBranch: string | undefined,
    force: boolean,
  ): Promise<RemoteSubmissionState> {
    const key = `${remote.owner}/${remote.repository}:${headBranch ?? 'auto'}`.toLowerCase();
    const cached = this.remoteSubmissionCache.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const pullsPath = `/repos/${CANONICAL_FULL_NAME}/pulls?state=open&base=main`;
    const [allOpenPullRequests, canonicalFiles, mainCompare] = await Promise.all([
      this.githubPagedJson<GitHubPullRequest>(pullsPath),
      this.getCanonicalFiles(force),
      this.githubJson<GitHubCompareResponse>(
        `/repos/${CANONICAL_FULL_NAME}/compare/main...${encodeURIComponent(remote.owner)}:main`,
      ),
    ]);
    const openPullRequests = allOpenPullRequests.filter(
      (pullRequest) =>
        belongsToFork(pullRequest, remote) && isWeekBranch(pullRequestBranch(pullRequest)),
    );
    const resolvedHeadBranch =
      openPullRequests.length === 1 ? pullRequestBranch(openPullRequests[0]!) : headBranch;
    const activePullRequest = resolvedHeadBranch
      ? openPullRequests.find(
          (pullRequest) => pullRequestBranch(pullRequest) === resolvedHeadBranch,
        )
      : undefined;
    const compare = resolvedHeadBranch
      ? await this.githubJsonOptional<GitHubCompareResponse>(
          `/repos/${CANONICAL_FULL_NAME}/compare/main...${encodeURIComponent(remote.owner)}:${encodeURIComponent(resolvedHeadBranch)}`,
        )
      : undefined;
    const latestPullRequest =
      activePullRequest ??
      (resolvedHeadBranch
        ? (
            await this.githubJson<GitHubPullRequest[]>(
              `/repos/${CANONICAL_FULL_NAME}/pulls?state=all&base=main&head=${encodeURIComponent(`${remote.owner}:${resolvedHeadBranch}`)}&sort=updated&direction=desc&per_page=1`,
            )
          )[0]
        : undefined);
    const pullRequestFiles = latestPullRequest
      ? (
          await this.githubPagedJson<GitHubPullFile>(
            `/repos/${CANONICAL_FULL_NAME}/pulls/${latestPullRequest.number}/files`,
          )
        ).map(({ filename }) => filename)
      : [];
    const value: RemoteSubmissionState = {
      headBranch: resolvedHeadBranch,
      compareFiles: compare?.files ?? [],
      compareCommits: compare?.commits ?? [],
      behindBy: mainCompare.behind_by ?? 0,
      openPullRequestCount: openPullRequests.length,
      activePullRequest,
      latestPullRequest,
      pullRequestFiles,
      canonicalFilePaths: canonicalFiles?.paths,
      canonicalFileHashes: canonicalFiles?.hashes,
      compareIncomplete:
        compare !== undefined &&
        ((compare.files?.length ?? 0) >= 300 ||
          (typeof compare.total_commits === 'number' &&
            compare.total_commits > (compare.commits?.length ?? 0))),
    };
    this.remoteSubmissionCache.set(key, {
      expiresAt: Date.now() + REMOTE_CACHE_MS,
      value,
    });
    return value;
  }

  /** 제출 작업 이후 브랜치 비교와 공식 파일 캐시를 무효화합니다. */
  clearSubmissionCache(): void {
    this.remoteSubmissionCache.clear();
    this.canonicalTreeCache = undefined;
  }

  /** 인증 변경 등에 맞춰 포크 신원을 포함한 모든 원격 캐시를 무효화합니다. */
  clearCaches(): void {
    this.forkIdentityCache.clear();
    this.clearSubmissionCache();
  }

  /** GitHub 요청에 사용할 비동기 토큰 공급자를 보관합니다. */
  dispose(): void {
    this.clearCaches();
  }

  /** 공식 main의 전체 파일 트리를 캐시하며 실패하거나 잘린 응답이면 undefined입니다. */
  private async getCanonicalFiles(force: boolean): Promise<CanonicalFileTree | undefined> {
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
      const entries = response.tree.filter(
        ({ path: entryPath, type }) => type === 'blob' && Boolean(entryPath),
      );
      const value: CanonicalFileTree = {
        paths: new Set(entries.map(({ path: entryPath }) => entryPath!)),
        hashes: new Map(
          entries.flatMap(({ path: entryPath, sha }) =>
            entryPath && sha ? [[entryPath, sha] as const] : [],
          ),
        ),
      };
      this.canonicalTreeCache = {
        expiresAt: Date.now() + REMOTE_CACHE_MS,
        value,
      };
      return value;
    } catch {
      return undefined;
    }
  }

  /** 토큰과 시간 제한을 적용해 GitHub JSON을 조회하며 HTTP 실패는 전용 오류로 전달합니다. */
  private async githubJson<T>(apiPath: string): Promise<T> {
    const token = await this.getAccessToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GITHUB_API_TIMEOUT_MS);
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'leetcode-study-helper',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    try {
      const response = await fetch(`https://api.github.com${apiPath}`, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new GitHubRequestError(response.status, Boolean(token));
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 페이지별 GitHub 배열 응답을 끝까지 합치며 조회 한도 초과 시 오류를 던집니다. */
  private async githubPagedJson<T>(apiPath: string): Promise<T[]> {
    const values: T[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const separator = apiPath.includes('?') ? '&' : '?';
      const batch = await this.githubJson<T[]>(`${apiPath}${separator}per_page=100&page=${page}`);
      values.push(...batch);
      if (batch.length < 100) {
        return values;
      }
    }
    throw new Error('GitHub 목록이 너무 커서 안전하게 전체 상태를 확인할 수 없습니다.');
  }

  /** 선택적 GitHub 리소스를 조회하며 404만 undefined로 변환하고 다른 오류는 전달합니다. */
  private async githubJsonOptional<T>(apiPath: string): Promise<T | undefined> {
    try {
      return await this.githubJson<T>(apiPath);
    } catch (error) {
      if (error instanceof GitHubRequestError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }
}

/** PR의 병합 시각과 열림 여부로 병합 완료·열림·미병합 닫힘을 구분합니다. */
export function pullRequestStatus(
  pullRequest: GitHubPullRequest,
): 'open' | 'merged' | 'closed-unmerged' {
  if (pullRequest.merged_at) {
    return 'merged';
  }
  return pullRequest.state === 'closed' ? 'closed-unmerged' : 'open';
}

/** PR head 브랜치를 우선 사용하며 없으면 제목의 WEEK 번호로 주차 브랜치를 추론합니다. */
function pullRequestBranch(pullRequest: GitHubPullRequest): string | undefined {
  const branch = pullRequest.head?.ref;
  if (branch) {
    return branch;
  }
  const week = pullRequest.title.match(/\bWEEK\s+(\d{1,2})\b/i)?.[1];
  return week ? `week-${week.padStart(2, '0')}` : undefined;
}

/** 브랜치명이 두 자리 주차를 가진 week-XX 형식인지 확인합니다. */
function isWeekBranch(branch: string | undefined): branch is string {
  return /^week-\d{2}$/.test(branch ?? '');
}

/** PR head의 저장소 또는 소유자가 대상 포크와 일치하는지 확인합니다. */
function belongsToFork(pullRequest: GitHubPullRequest, remote: ParsedGitHubRemote): boolean {
  const fullName = pullRequest.head?.repo?.full_name;
  if (fullName) {
    return fullName.toLowerCase() === `${remote.owner}/${remote.repository}`.toLowerCase();
  }
  const owner = pullRequest.head?.user?.login;
  return !owner || owner.toLowerCase() === remote.owner.toLowerCase();
}
