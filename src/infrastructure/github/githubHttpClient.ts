const GITHUB_API_TIMEOUT_MS = 8_000;

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
/**
 * GitHub JSON 요청의 인증·시간 제한·페이지 처리를 담당합니다.
 * 제출 주차와 캐시는 알지 못하며, 호출할 때마다 토큰 공급자를 읽어 로그인 변경을 반영합니다.
 * optional 조회의 404만 정보 부재로 변환하고 나머지 실패는 호출자가 정책에 맞게 처리합니다.
 */
export class GitHubHttpClient {
  /** 요청마다 읽을 토큰 공급자를 연결합니다. 토큰 자체는 보관하지 않습니다. */
  constructor(private readonly getAccessToken: () => Promise<string | undefined>) {}

  /** 토큰과 시간 제한을 적용해 GitHub JSON을 조회하며 HTTP 실패는 전용 오류로 전달합니다. */
  async githubJson<T>(apiPath: string): Promise<T> {
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
  async githubPagedJson<T>(apiPath: string): Promise<T[]> {
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
  async githubJsonOptional<T>(apiPath: string): Promise<T | undefined> {
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
