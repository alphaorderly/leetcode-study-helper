import { afterEach, describe, expect, it, vi } from 'vitest';
import { AsyncVersionCache } from '../../src/core/asyncVersionCache';
import { TrailingTask } from '../../src/core/trailingTask';

afterEach(() => {
  vi.useRealTimers();
});

describe('performance coordination primitives', () => {
  it('reuses expensive data until its version changes', async () => {
    const cache = new AsyncVersionCache<string>();
    const load = vi.fn(async () => `value-${load.mock.calls.length}`);

    expect(await cache.get('repository', 'head-a:upstream-a', load)).toBe('value-1');
    expect(await cache.get('repository', 'head-a:upstream-a', load)).toBe('value-1');
    expect(await cache.get('repository', 'head-b:upstream-a', load)).toBe('value-2');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('runs only once after a burst of trailing schedules', () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const task = new TrailingTask(350, action);

    task.schedule();
    vi.advanceTimersByTime(200);
    task.schedule();
    vi.advanceTimersByTime(349);
    expect(action).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
