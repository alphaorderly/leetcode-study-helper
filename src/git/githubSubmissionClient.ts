import type { ForkIdentitySnapshot } from '../core/types';
import type { GitRemote } from './vscodeGit';

export const CANONICAL_OWNER = 'DaleStudy';
export const CANONICAL_REPOSITORY = 'leetcode-study';
export const CANONICAL_FULL_NAME = `${CANONICAL_OWNER}/${CANONICAL_REPOSITORY}`;
export const CANONICAL_REMOTE_URL = `https://github.com/${CANONICAL_FULL_NAME}.git`;

const REMOTE_CACHE_MS = 30_000;
const GITHUB_API_TIMEOUT_MS = 8_000;

interface GitHubRepositoryResponse {
  readonly full_name?: string;
  readonly fork?: boolean;
  readonly source?: { readonly full_name?: string };
  readonly parent?: { readonly full_name?: string };
}

export interface GitHubCompareFile {
  readonly filename: string;
  readonly status: string;
}

export interface GitHubCompareCommit {
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

export interface ParsedGitHubRemote {
  readonly owner: string;
  readonly repository: string;
  readonly url: string;
}

export interface RemoteSubmissionState {
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

export function parseConsistentRemote(
  remote: GitRemote | undefined,
): ParsedGitHubRemote | undefined {
  const fetch = parseGitHubRemote(remote?.fetchUrl);
  const push = parseGitHubRemote(remote?.pushUrl);
  if (fetch && push && !sameGitHubRepository(fetch, push)) {
    return undefined;
  }
  return push ?? fetch;
}

export function isCanonicalRemote(url: string | undefined): boolean {
  const parsed = parseGitHubRemote(url);
  return parsed?.owner.toLowerCase() === CANONICAL_OWNER.toLowerCase()
    && parsed.repository.toLowerCase() === CANONICAL_REPOSITORY.toLowerCase();
}

export class GitHubSubmissionClient {
  private readonly forkIdentityCache =
    new Map<string, CachedRemoteValue<ForkIdentitySnapshot>>();
  private readonly remoteSubmissionCache =
    new Map<string, CachedRemoteValue<RemoteSubmissionState>>();
  private canonicalTreeCache: CachedRemoteValue<ReadonlySet<string>> | undefined;

  async getForkIdentity(
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

  async getRemoteSubmission(
    remote: ParsedGitHubRemote,
    force: boolean,
  ): Promise<RemoteSubmissionState> {
    const key = `${remote.owner}/${remote.repository}`.toLowerCase();
    const cached = this.remoteSubmissionCache.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const comparePath =
      `/repos/${CANONICAL_FULL_NAME}/compare/main...${encodeURIComponent(remote.owner)}:main`;
    const pullsPath =
      `/repos/${CANONICAL_FULL_NAME}/pulls?state=open&base=main&head=${encodeURIComponent(`${remote.owner}:main`)}&per_page=10`;
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

  clearSubmissionCache(): void {
    this.remoteSubmissionCache.clear();
    this.canonicalTreeCache = undefined;
  }

  dispose(): void {
    this.forkIdentityCache.clear();
    this.remoteSubmissionCache.clear();
    this.canonicalTreeCache = undefined;
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
}
