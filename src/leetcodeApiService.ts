import type { LeetCodeProblemDetail, ProblemTopicTag } from './core/types';

const GRAPHQL_ENDPOINT = 'https://leetcode.com/graphql/';
const REQUEST_TIMEOUT_MS = 10_000;
const QUESTION_QUERY = `
  query questionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionId
      title
      titleSlug
      content
      difficulty
      isPaidOnly
      topicTags {
        name
        slug
      }
    }
  }
`;

type Fetch = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseTopicTags(value: unknown): ProblemTopicTag[] {
  if (!Array.isArray(value)) {
    throw new Error('LeetCode 문제 태그 응답이 올바르지 않습니다.');
  }

  return value.map((tag) => {
    if (!isRecord(tag) || typeof tag.name !== 'string' || typeof tag.slug !== 'string') {
      throw new Error('LeetCode 문제 태그 응답이 올바르지 않습니다.');
    }
    return { name: tag.name, slug: tag.slug };
  });
}

function parseProblemDetail(value: unknown): LeetCodeProblemDetail {
  if (!isRecord(value)) {
    throw new Error('LeetCode에서 문제를 찾지 못했습니다.');
  }

  const { questionId, title, titleSlug, content, difficulty, isPaidOnly, topicTags } = value;
  if (
    typeof questionId !== 'string'
    || typeof title !== 'string'
    || typeof titleSlug !== 'string'
    || (typeof content !== 'string' && content !== null)
    || typeof difficulty !== 'string'
    || typeof isPaidOnly !== 'boolean'
  ) {
    throw new Error('LeetCode 문제 응답이 올바르지 않습니다.');
  }

  return {
    questionId,
    title,
    titleSlug,
    content: content ?? undefined,
    difficulty,
    isPaidOnly,
    topicTags: parseTopicTags(topicTags),
  };
}

export class LeetCodeApiService {
  private readonly cache = new Map<string, Promise<LeetCodeProblemDetail>>();

  constructor(
    private readonly fetcher: Fetch = fetch,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS,
  ) {}

  getProblem(slug: string): Promise<LeetCodeProblemDetail> {
    const cached = this.cache.get(slug);
    if (cached) {
      return cached;
    }

    const request = this.fetchProblem(slug);
    this.cache.set(slug, request);
    void request.catch(() => this.cache.delete(slug));
    return request;
  }

  private async fetchProblem(slug: string): Promise<LeetCodeProblemDetail> {
    let response: Response;
    try {
      response = await this.fetcher(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://leetcode.com',
          Referer: `https://leetcode.com/problems/${encodeURIComponent(slug)}/`,
        },
        body: JSON.stringify({
          query: QUESTION_QUERY,
          variables: { titleSlug: slug },
          operationName: 'questionData',
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error('LeetCode 문제 요청 시간이 초과되었습니다.', { cause: error });
      }
      throw new Error(
        'LeetCode 문제를 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.',
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new Error(`LeetCode 문제 요청에 실패했습니다. (HTTP ${response.status})`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('LeetCode 문제 응답을 읽지 못했습니다.');
    }

    if (!isRecord(payload)) {
      throw new Error('LeetCode 문제 응답이 올바르지 않습니다.');
    }
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new Error('LeetCode에서 문제 정보를 반환하지 않았습니다.');
    }
    if (!isRecord(payload.data)) {
      throw new Error('LeetCode 문제 응답이 올바르지 않습니다.');
    }

    return parseProblemDetail(payload.data.question);
  }
}
