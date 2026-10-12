import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  sendPostHogBatch,
  type PostHogEvent,
} from '../../../../src/infrastructure/telemetry/posthogHttp';
import {
  POSTHOG_HOST,
  POSTHOG_PROJECT_TOKEN,
} from '../../../../src/infrastructure/telemetry/posthogConfig';

const event: PostHogEvent = {
  event: 'solution_open_finished',
  distinct_id: 'e5bb96ee-88fd-4c16-8e41-7983515c8b85',
  timestamp: '2026-10-12T00:00:00.000Z',
  properties: {
    outcome: 'completed',
    problem_slug: 'two-sum',
    study_week: 1,
    $process_person_profile: false,
    $geoip_disable: true,
  },
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('PostHog HTTP delivery', () => {
  it('sends the configured batch and privacy controls once without following redirects', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ status: 1, quota_limited: [] }));
    const controller = new AbortController();

    await expect(sendPostHogBatch([event], controller.signal, { fetch })).resolves.toBe('accepted');

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe(`${POSTHOG_HOST}/batch/`);
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(options?.body as string)).toEqual({
      api_key: POSTHOG_PROJECT_TOKEN,
      batch: [event],
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, ['events'], 'events'])('rejects an HTTP 200 quota result %j', async (quota) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ status: 1, quota_limited: quota }));

    await expect(sendPostHogBatch([event], new AbortController().signal, { fetch })).resolves.toBe(
      'quota_limited',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 429, 500])(
    'does not retry an HTTP %i failure or read its raw body',
    async (status) => {
      const response = new Response('private server error', { status });
      const read = vi.spyOn(response, 'json');
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);

      await expect(
        sendPostHogBatch([event], new AbortController().signal, { fetch }),
      ).resolves.toBe('http_error');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(read).not.toHaveBeenCalled();
    },
  );

  it('bounds a stalled fetch even when it ignores cancellation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise(() => {}));
    const result = sendPostHogBatch([event], new AbortController().signal, {
      fetch,
      timeoutMs: 30,
    });
    await vi.advanceTimersByTimeAsync(29);
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe('timeout');
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('includes a stalled response body in the same timeout', async () => {
    const response = new Response('unused body');
    vi.spyOn(response, 'json').mockReturnValue(new Promise(() => {}));
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const result = sendPostHogBatch([event], new AbortController().signal, {
      fetch,
      timeoutMs: 30,
    });
    await vi.advanceTimersByTimeAsync(30);

    await expect(result).resolves.toBe('timeout');
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('does not start a request for an already revoked signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(sendPostHogBatch([event], controller.signal, { fetch })).resolves.toBe('aborted');
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns control immediately on consent cancellation during response reading', async () => {
    const controller = new AbortController();
    const response = new Response('unused body');
    vi.spyOn(response, 'json').mockReturnValue(new Promise(() => {}));
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const result = sendPostHogBatch([event], controller.signal, { fetch });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(result).resolves.toBe('aborted');
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, 'unexpected body', 1])(
    'rejects unsupported successful response content %j',
    async (body) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(body));

      await expect(
        sendPostHogBatch([event], new AbortController().signal, { fetch }),
      ).resolves.toBe('invalid_response');
    },
  );

  it.each([
    { body: [] },
    { body: {} },
    { body: { status: 0, error: 'private server failure' } },
    { body: { status: 2 } },
    { body: { status: '1' } },
    { body: { status: 'ok' } },
    { body: { status: 'OK' } },
  ])('rejects a parsed response without an explicit success status: $body', async ({ body }) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(body));

    await expect(sendPostHogBatch([event], new AbortController().signal, { fetch })).resolves.toBe(
      'invalid_response',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('accepts the documented success status without optional quota data', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ status: 1 }));

    await expect(sendPostHogBatch([event], new AbortController().signal, { fetch })).resolves.toBe(
      'accepted',
    );
  });

  it('accepts the observed US endpoint response with the exact Ok status', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ status: 'Ok' }));

    await expect(sendPostHogBatch([event], new AbortController().signal, { fetch })).resolves.toBe(
      'accepted',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts Ok after reading its body within the deadline without an authorization header', async () => {
    const response = new Response('streamed result');
    vi.spyOn(response, 'json').mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ status: 'Ok' }), 20)),
    );
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const completed = vi.fn();
    const result = sendPostHogBatch([event], new AbortController().signal, {
      fetch,
      timeoutMs: 30,
    });
    void result.then(completed);
    await vi.advanceTimersByTimeAsync(19);
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe('accepted');
    const options = fetch.mock.calls[0]![1];
    expect(new Headers(options?.headers).get('authorization')).toBeNull();
    expect(options?.signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('prioritizes quota rejection even when the endpoint reports Ok', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ status: 'Ok', quota_limited: ['events'] }));

    await expect(sendPostHogBatch([event], new AbortController().signal, { fetch })).resolves.toBe(
      'quota_limited',
    );
  });

  it('rejects malformed JSON without classifying it as a network failure', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{"status":'));

    await expect(sendPostHogBatch([event], new AbortController().signal, { fetch })).resolves.toBe(
      'invalid_response',
    );
  });

  it('does not expose network errors, response bodies, or tokens through logs', async () => {
    const logs = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error('private path /Users/learner/solution.py with user data'));

    await expect(sendPostHogBatch([event], new AbortController().signal, { fetch })).resolves.toBe(
      'network_error',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
  });
});
