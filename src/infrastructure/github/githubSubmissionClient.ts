import { GitHubHttpClient, githubRequestNeedsSignIn } from './githubHttpClient';
import { CANONICAL_FULL_NAME, type ParsedGitHubRemote } from './githubRemote';
// 기존 호출부가 사용하던 공개 경로를 유지합니다. 내부 구현은 각각의 역할별 모듈에 있습니다.
export { GitHubRequestError, githubRequestNeedsSignIn } from './githubHttpClient';
export {
  CANONICAL_OWNER,
  CANONICAL_REPOSITORY,
  CANONICAL_FULL_NAME,
  CANONICAL_REMOTE_URL,
  parseConsistentRemote,
  isCanonicalRemote,
  resolveCanonicalRemoteName,
  type ParsedGitHubRemote,
} from './githubRemote';
import type { ForkIdentitySnapshot } from '../../shared/contracts';

const REMOTE_CACHE_MS = 30_000;

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

/**
 * 포크 신원, 주차 PR·비교 결과, 공식 파일 트리를 GitHub API에서 읽습니다.
 * 완료 결과를 30초 동안 캐시하며 제출 캐시는 요청 브랜치별로 분리합니다.
 * 쓰기 기능은 없고, Git 작업 후 clearSubmissionCache 또는 인증 변경 후 clearCaches를 호출합니다.
 */
export class GitHubSubmissionClient {
  /** 요청마다 인증 정보를 읽는 전송 계층입니다. 이 클라이언트의 제출 판단·캐시와 분리되어 있습니다. */
  private readonly http: GitHubHttpClient;
  /** owner/repository 소문자 키의 완료된 포크 신원입니다. 조회 실패 시 이전 verified 값은 만료 후에도 fallback으로 사용합니다. */
  private readonly forkIdentityCache = new Map<string, CachedRemoteValue<ForkIdentitySnapshot>>();
  /** 요청한 브랜치별 완료 결과입니다. 열린 PR 때문에 실제 응답 브랜치가 달라져도 요청 키로 보관합니다. */
  private readonly remoteSubmissionCache = new Map<
    string,
    CachedRemoteValue<RemoteSubmissionState>
  >();
  /** 공식 main의 파일 경로·blob SHA 캐시입니다. 제출 작업·인증 변경·dispose에서 비우며 실패한 조회 결과는 저장하지 않습니다. */
  private canonicalTreeCache: CachedRemoteValue<CanonicalFileTree> | undefined;

  /**
   * 비동기 토큰 공급자를 보관합니다. 생략하면 인증 없이 조회하며 HTTP 요청은 전역 fetch를 사용합니다.
   */
  constructor(getAccessToken: () => Promise<string | undefined> = async () => undefined) {
    this.http = new GitHubHttpClient(getAccessToken);
  }

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
      const response = await this.http.githubJson<GitHubRepositoryResponse>(
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

  /**
   * 공식 main 비교와 포크의 주차 PR을 조회하여 표시·검증에 필요한 원격 정보를 모읍니다.
   * 호출자의 브랜치보다 단 하나의 열린 PR을 우선합니다. PR이 없으면 요청한 브랜치를 사용합니다.
   * 캐시는 요청한 브랜치별로 분리하며 force이면 우회합니다. 진행 중 Promise는 공유하지 않습니다.
   * 비교 API의 파일·커밋 한도에 도달하면 compareIncomplete로 표시하고 호출자가 제출을 차단합니다.
   * @throws 인증·네트워크·목록 조회 실패. 공식 파일 트리 조회 실패만 선택적 정보 부재로 처리합니다.
   */
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
      this.http.githubPagedJson<GitHubPullRequest>(pullsPath),
      this.getCanonicalFiles(force),
      this.http.githubJson<GitHubCompareResponse>(
        `/repos/${CANONICAL_FULL_NAME}/compare/main...${encodeURIComponent(remote.owner)}:main`,
      ),
    ]);
    const openPullRequests = allOpenPullRequests.filter(
      (pullRequest) =>
        belongsToFork(pullRequest, remote) && isWeekBranch(pullRequestBranch(pullRequest)),
    );
    // 열린 주차 PR이 하나라면 요청한 주차보다 그 PR을 우선해 중복 제출을 방지합니다.
    const resolvedHeadBranch =
      openPullRequests.length === 1 ? pullRequestBranch(openPullRequests[0]!) : headBranch;
    const activePullRequest = resolvedHeadBranch
      ? openPullRequests.find(
          (pullRequest) => pullRequestBranch(pullRequest) === resolvedHeadBranch,
        )
      : undefined;
    let compare: GitHubCompareResponse | undefined;
    if (resolvedHeadBranch) {
      compare = await this.http.githubJsonOptional<GitHubCompareResponse>(
        `/repos/${CANONICAL_FULL_NAME}/compare/main...${encodeURIComponent(remote.owner)}:${encodeURIComponent(resolvedHeadBranch)}`,
      );
    }
    const latestPullRequest = await this.findLatestPullRequest(
      remote,
      resolvedHeadBranch,
      activePullRequest,
    );
    const pullRequestFiles = await this.readPullRequestFiles(latestPullRequest);
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

  /** 열린 PR을 우선 사용합니다. 없을 때만 선택한 브랜치의 마지막 갱신 PR을 조회하며, 브랜치도 없으면 요청하지 않습니다. */
  private async findLatestPullRequest(
    remote: ParsedGitHubRemote,
    headBranch: string | undefined,
    active: GitHubPullRequest | undefined,
  ): Promise<GitHubPullRequest | undefined> {
    if (active) return active;
    if (!headBranch) return undefined;
    const pulls = await this.http.githubJson<GitHubPullRequest[]>(
      `/repos/${CANONICAL_FULL_NAME}/pulls?state=all&base=main&head=${encodeURIComponent(`${remote.owner}:${headBranch}`)}&sort=updated&direction=desc&per_page=1`,
    );
    return pulls[0];
  }

  /** 열린 PR뿐 아니라 최근 닫힌 PR의 파일도 읽어 병합·종료 화면의 주차를 판단할 수 있게 합니다. */
  private async readPullRequestFiles(
    pullRequest: GitHubPullRequest | undefined,
  ): Promise<string[]> {
    if (!pullRequest) return [];
    const files = await this.http.githubPagedJson<GitHubPullFile>(
      `/repos/${CANONICAL_FULL_NAME}/pulls/${pullRequest.number}/files`,
    );
    return files.map(({ filename }) => filename);
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

  /**
   * 조회기가 소유한 세 캐시를 비웁니다. 외부 토큰 공급자의 수명은 소유자가 관리합니다.
   */
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
      const response = await this.http.githubJson<GitHubTreeResponse>(
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
