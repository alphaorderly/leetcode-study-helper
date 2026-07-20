import { describe, expect, it, vi } from 'vitest';
import { LeetCodeApiService } from '../../src/leetcodeApiService';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const question = {
  questionId: '1',
  title: 'Two Sum',
  titleSlug: 'two-sum',
  content: '<p>Find two numbers.</p>',
  difficulty: 'Easy',
  isPaidOnly: false,
  topicTags: [{ name: 'Array', slug: 'array' }],
};

describe('LeetCodeApiService', () => {
  it('loads and caches anonymous problem details by slug', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return response({ data: { question } });
    });
    const service = new LeetCodeApiService(fetcher as typeof fetch);

    const [first, second] = await Promise.all([
      service.getProblem('two-sum'),
      service.getProblem('two-sum'),
    ]);

    expect(first).toEqual(question);
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://leetcode.com/graphql/');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toMatchObject({
      operationName: 'questionData',
      variables: { titleSlug: 'two-sum' },
    });
  });

  it('accepts a premium response with no public content', async () => {
    const fetcher = vi.fn(async () => response({
      data: {
        question: {
          ...question,
          content: null,
          isPaidOnly: true,
        },
      },
    }));
    const service = new LeetCodeApiService(fetcher as typeof fetch);

    await expect(service.getProblem('premium-problem')).resolves.toMatchObject({
      content: undefined,
      isPaidOnly: true,
    });
  });

  it('reports HTTP, GraphQL, and malformed response failures', async () => {
    const cases: Array<[Response, string]> = [
      [response({}, 503), 'HTTP 503'],
      [response({ errors: [{ message: 'failed' }] }), '문제 정보를 반환하지 않았습니다'],
      [response({ data: { question: { title: 'Incomplete' } } }), '응답이 올바르지 않습니다'],
    ];

    for (const [result, message] of cases) {
      const service = new LeetCodeApiService(vi.fn(async () => result) as typeof fetch);
      await expect(service.getProblem('two-sum')).rejects.toThrow(message);
    }
  });

  it('does not cache failed requests and allows retrying', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response({ data: { question } }));
    const service = new LeetCodeApiService(fetcher as typeof fetch);

    await expect(service.getProblem('two-sum')).rejects.toThrow('네트워크 연결');
    await expect(service.getProblem('two-sum')).resolves.toEqual(question);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('aborts requests that exceed the timeout', async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }));
    const service = new LeetCodeApiService(fetcher as typeof fetch, 5);

    await expect(service.getProblem('two-sum')).rejects.toThrow('시간이 초과');
  });
});
