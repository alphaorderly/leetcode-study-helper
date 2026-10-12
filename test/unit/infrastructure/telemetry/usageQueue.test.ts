import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeliveryStatus,
  PostHogEvent,
} from '../../../../src/infrastructure/telemetry/posthogHttp';
import { UsageQueue, type BatchSender } from '../../../../src/infrastructure/telemetry/usageQueue';

/** 완료 시점을 테스트에서 선택하는 전송 결과입니다. */
function deferred() {
  let resolve!: (value: DeliveryStatus) => void;
  const promise = new Promise<DeliveryStatus>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

/** 큐 순서 검증에 쓸 서로 다른 소요 시간을 가진 허용 이벤트를 만듭니다. */
function event(index: number): PostHogEvent {
  return {
    event: 'solution_open_finished',
    distinct_id: 'e5bb96ee-88fd-4c16-8e41-7983515c8b85',
    timestamp: '2026-10-12T00:00:00.000Z',
    properties: { outcome: 'completed', duration_ms: index },
  };
}

let queues: UsageQueue[];
beforeEach(() => {
  vi.useFakeTimers();
  queues = [];
});
afterEach(() => {
  for (const queue of queues) queue.dispose();
  vi.useRealTimers();
});

describe('UsageQueue', () => {
  it('flushes five seconds after the first event without extending the timer on input', async () => {
    const sender = vi.fn<BatchSender>(async () => 'accepted');
    const queue = new UsageQueue(() => true, sender);
    queues.push(queue);
    queue.enqueue(event(0));
    await vi.advanceTimersByTimeAsync(4000);
    queue.enqueue(event(1));
    await vi.advanceTimersByTimeAsync(999);
    expect(sender).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]?.[0]).toEqual([event(0), event(1)]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts at twenty events and keeps later batches serial', async () => {
    const results: ReturnType<typeof deferred>[] = [];
    const sender = vi.fn<BatchSender>(() => {
      const result = deferred();
      results.push(result);
      return result.promise;
    });
    const queue = new UsageQueue(() => true, sender);
    queues.push(queue);
    for (let index = 0; index < 19; index++) queue.enqueue(event(index));
    expect(sender).not.toHaveBeenCalled();
    queue.enqueue(event(19));
    expect(sender).toHaveBeenCalledTimes(1);
    for (let index = 20; index < 45; index++) queue.enqueue(event(index));
    await vi.advanceTimersByTimeAsync(5000);
    expect(sender).toHaveBeenCalledTimes(1);

    results[0]!.resolve('accepted');
    await vi.advanceTimersByTimeAsync(0);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls.map(([events]) => events.length)).toEqual([20, 20]);
    results[1]!.resolve('accepted');
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.mock.calls[2]?.[0]).toEqual([40, 41, 42, 43, 44].map(event));
  });

  it('flushes overdue waiting events as soon as the active batch completes', async () => {
    const first = deferred();
    const sender = vi
      .fn<BatchSender>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue('accepted');
    const queue = new UsageQueue(() => true, sender);
    queues.push(queue);
    for (let index = 0; index < 21; index++) queue.enqueue(event(index));
    await vi.advanceTimersByTimeAsync(5000);
    expect(sender).toHaveBeenCalledTimes(1);
    first.resolve('accepted');
    await vi.advanceTimersByTimeAsync(0);

    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[1]![0]).toEqual([event(20)]);
  });

  it('caps waiting and active events at one hundred, dropping oldest waiting events', async () => {
    const first = deferred();
    const sender = vi
      .fn<(events: readonly PostHogEvent[], signal: AbortSignal) => Promise<DeliveryStatus>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue('accepted');
    const queue = new UsageQueue(() => true, sender);
    queues.push(queue);
    for (let index = 0; index < 120; index++) queue.enqueue(event(index));
    expect(sender).toHaveBeenCalledTimes(1);
    first.resolve('accepted');
    await vi.advanceTimersByTimeAsync(0);

    const delivered = sender.mock.calls.flatMap(([events]) =>
      events.map(({ properties }) => properties.duration_ms),
    );
    expect(delivered).toEqual([
      ...Array.from({ length: 20 }, (_, index) => index),
      ...Array.from({ length: 80 }, (_, index) => index + 40),
    ]);
    expect(sender.mock.calls.every(([events]) => events.length <= 20)).toBe(true);
  });

  it.each(['http_error', 'quota_limited', 'network_error', 'timeout'] as const)(
    'does not retry a %s batch and continues with new events',
    async (status) => {
      const sender = vi
        .fn<(events: readonly PostHogEvent[], signal: AbortSignal) => Promise<DeliveryStatus>>()
        .mockResolvedValueOnce(status)
        .mockResolvedValue('accepted');
      const queue = new UsageQueue(() => true, sender);
      queues.push(queue);
      queue.enqueue(event(0));
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(10000);
      expect(sender).toHaveBeenCalledTimes(1);
      queue.enqueue(event(1));
      await vi.advanceTimersByTimeAsync(5000);

      expect(sender.mock.calls.map(([events]) => events)).toEqual([[event(0)], [event(1)]]);
    },
  );

  it('discards old work on revocation and prevents an old finally from replacing a new request', async () => {
    let allowed = true;
    const results: ReturnType<typeof deferred>[] = [];
    const sender = vi.fn<BatchSender>(() => {
      const result = deferred();
      results.push(result);
      return result.promise;
    });
    const queue = new UsageQueue(() => allowed, sender);
    queues.push(queue);
    for (let index = 0; index < 25; index++) queue.enqueue(event(index));
    const oldSignal = sender.mock.calls[0]![1];
    allowed = false;
    queue.revoke();
    expect(oldSignal.aborted).toBe(true);
    expect(queue.enqueue(event(999))).toBe(false);
    allowed = true;
    for (let index = 100; index < 140; index++) queue.enqueue(event(index));
    expect(sender).toHaveBeenCalledTimes(2);
    results[0]!.resolve('accepted');
    await vi.advanceTimersByTimeAsync(10000);
    expect(sender).toHaveBeenCalledTimes(2);

    results[1]!.resolve('accepted');
    await vi.advanceTimersByTimeAsync(0);
    expect(sender).toHaveBeenCalledTimes(3);
    expect(sender.mock.calls[2]![0]).toEqual(
      Array.from({ length: 20 }, (_, index) => event(index + 120)),
    );
    expect(
      sender.mock.calls
        .slice(1)
        .flatMap(([events]) => events)
        .every(({ properties }) => Number(properties.duration_ms) >= 100),
    ).toBe(true);
  });

  it('rechecks consent before a scheduled flush', async () => {
    let allowed = true;
    const sender = vi.fn<BatchSender>(async () => 'accepted');
    const queue = new UsageQueue(() => allowed, sender);
    queues.push(queue);
    queue.enqueue(event(0));
    allowed = false;
    await vi.advanceTimersByTimeAsync(5000);

    expect(sender).not.toHaveBeenCalled();
    expect(queue.enqueue(event(1))).toBe(false);
  });

  it('dispose discards pending data without starting a request and is idempotent', async () => {
    const sender = vi.fn<BatchSender>(async () => 'accepted');
    const queue = new UsageQueue(() => true, sender);
    queues.push(queue);
    queue.enqueue(event(0));
    queue.dispose();
    queue.dispose();
    await queue.shutdown();
    await vi.advanceTimersByTimeAsync(10000);

    expect(sender).not.toHaveBeenCalled();
    expect(queue.enqueue(event(1))).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shutdown sends queued work and rejects subsequent input', async () => {
    const sender = vi.fn<BatchSender>(async () => 'accepted');
    const queue = new UsageQueue(() => true, sender);
    queues.push(queue);
    queue.enqueue(event(0));
    const shutdown = queue.shutdown();
    expect(queue.enqueue(event(1))).toBe(false);
    await shutdown;

    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]?.[0]).toEqual([event(0)]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shutdown is bounded to 1.5 seconds even for an unresponsive active request', async () => {
    const result = deferred();
    const sender = vi.fn<BatchSender>(() => result.promise);
    const queue = new UsageQueue(() => true, sender);
    queues.push(queue);
    for (let index = 0; index < 22; index++) queue.enqueue(event(index));
    const signal = sender.mock.calls[0]![1];
    let finished = false;
    const shutdown = queue.shutdown().then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(1499);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await shutdown;

    expect(finished).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(sender).toHaveBeenCalledTimes(1);
    result.resolve('accepted');
    await vi.advanceTimersByTimeAsync(10000);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shutdown never sends when consent is already disabled', async () => {
    let allowed = true;
    const sender = vi.fn<BatchSender>(async () => 'accepted');
    const queue = new UsageQueue(() => allowed, sender);
    queues.push(queue);
    queue.enqueue(event(0));
    allowed = false;
    await queue.shutdown();

    expect(sender).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('absorbs injected sender exceptions without blocking the next batch', async () => {
    const sender = vi
      .fn<(events: readonly PostHogEvent[], signal: AbortSignal) => Promise<DeliveryStatus>>()
      .mockRejectedValueOnce(new Error('sender failure'))
      .mockResolvedValue('accepted');
    const queue = new UsageQueue(() => true, sender);
    queues.push(queue);
    queue.enqueue(event(0));
    await vi.advanceTimersByTimeAsync(5000);
    queue.enqueue(event(1));
    await vi.advanceTimersByTimeAsync(5000);

    expect(sender.mock.calls.map(([events]) => events)).toEqual([[event(0)], [event(1)]]);
  });
});
