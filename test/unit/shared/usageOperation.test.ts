import { describe, expect, it, vi } from 'vitest';
import { createUsageOperation } from '../../../src/shared/usageOperation';
import {
  beginUsage,
  NOOP_USAGE,
  type UsageProperties,
  type UsageRecorder,
} from '../../../src/shared/telemetry';

/** 작업 시작·본체 완료·후처리 완료 시각을 독립적으로 지정하는 순수 의존성입니다. */
function dependencies() {
  let clock = 100;
  let timestamp = 'start';
  let permitted = true;
  const emit = vi.fn();
  return {
    allowed: () => permitted,
    now: () => clock,
    timestamp: () => timestamp,
    emit,
    advance: (value: number, occurrence: string) => {
      clock = value;
      timestamp = occurrence;
    },
    revoke: () => {
      permitted = false;
    },
  };
}

describe('usage operation tracker', () => {
  it('records the first primary result and timestamp, then publishes exactly once', () => {
    const deps = dependencies();
    const context: UsageProperties = { action: 'commit', study_week: 1 };
    const operation = createUsageOperation(context, deps);
    context.study_week = 15;
    deps.advance(160, 'commit-completed');
    const primary: UsageProperties = { outcome: 'completed', problem_count: 2 };
    operation.markResult(primary);
    primary.problem_count = 99;
    operation.markResult({ outcome: 'error', problem_count: 100 });
    expect(deps.emit).not.toHaveBeenCalled();
    deps.advance(310, 'followup-completed');
    operation.finish();
    operation.finish({ outcome: 'error' });
    operation.markResult({ outcome: 'error' });

    expect(deps.emit).toHaveBeenCalledExactlyOnceWith(
      {
        action: 'commit',
        study_week: 1,
        outcome: 'completed',
        problem_count: 2,
        duration_ms: 60,
      },
      'commit-completed',
    );
  });

  it.each(['completed', 'passed', 'failed', 'cancelled', 'noop'] as const)(
    'preserves primary %s and marks later failure separately',
    (outcome) => {
      const deps = dependencies();
      const operation = createUsageOperation({}, deps);
      deps.advance(125, 'primary');
      operation.markResult({ outcome });
      deps.advance(175, 'refresh-error');
      operation.finish({
        outcome: 'error',
        failure_stage: 'refresh',
        error_code: 'operation_failed',
      });

      expect(deps.emit).toHaveBeenCalledExactlyOnceWith(
        {
          outcome,
          followup_failed: true,
          failure_stage: 'refresh',
          error_code: 'operation_failed',
          duration_ms: 25,
        },
        'primary',
      );
    },
  );

  it('uses completion time and duration when no primary receipt was recorded', () => {
    const deps = dependencies();
    const operation = createUsageOperation({ language: 'python3' }, deps);
    deps.advance(112.6, 'completed');
    operation.finish({ outcome: 'passed' });

    expect(deps.emit).toHaveBeenCalledExactlyOnceWith(
      {
        language: 'python3',
        outcome: 'passed',
        duration_ms: 13,
      },
      'completed',
    );
  });

  it('honors explicit primary duration including zero and prevents followup replacement', () => {
    const deps = dependencies();
    const operation = createUsageOperation({}, deps);
    deps.advance(120, 'primary');
    operation.markResult({ outcome: 'passed', duration_ms: 0 });
    deps.advance(150, 'later');
    operation.finish({ duration_ms: 50 });

    expect(deps.emit).toHaveBeenCalledExactlyOnceWith(
      { outcome: 'passed', duration_ms: 0 },
      'primary',
    );
  });

  it('uses a supplied runner duration and never emits negative elapsed time', () => {
    const deps = dependencies();
    const runner = createUsageOperation({}, deps);
    runner.finish({ outcome: 'passed', duration_ms: 5 });
    expect(deps.emit.mock.calls[0]?.[0]).toEqual({ outcome: 'passed', duration_ms: 5 });
    const clockChange = createUsageOperation({}, deps);
    deps.advance(50, 'earlier-clock');
    clockChange.finish({ outcome: 'completed' });
    expect(deps.emit.mock.calls[1]?.[0]).toEqual({ outcome: 'completed', duration_ms: 0 });
  });

  it('drops a result if the captured generation is no longer allowed', () => {
    let generation = 1;
    let allowed = true;
    const captured = generation;
    const deps = dependencies();
    const operation = createUsageOperation(
      {},
      {
        ...deps,
        allowed: () => allowed && generation === captured,
      },
    );
    operation.markResult({ outcome: 'completed' });
    allowed = false;
    generation += 1;
    allowed = true;
    operation.finish();
    operation.finish({ outcome: 'completed' });

    expect(deps.emit).not.toHaveBeenCalled();
  });

  it('finalizes a revoked operation once without reviving it on later finish', () => {
    const deps = dependencies();
    const operation = createUsageOperation({}, deps);
    deps.revoke();
    operation.finish({ outcome: 'completed' });
    operation.finish({ outcome: 'completed' });

    expect(deps.emit).not.toHaveBeenCalled();
  });

  it('isolates recorder begin and completion exceptions from user operations', () => {
    const throwing: UsageRecorder = {
      begin: () => {
        throw new Error('begin failure');
      },
    };
    const operation = beginUsage(throwing, 'fork_sync_finished');
    expect(() => operation.markResult({ outcome: 'completed' })).not.toThrow();
    expect(() => operation.finish({ outcome: 'completed' })).not.toThrow();
    const throwingCompletion: UsageRecorder = {
      begin: () => ({
        markResult: () => {
          throw new Error('receipt failure');
        },
        finish: () => {
          throw new Error('emission failure');
        },
      }),
    };
    const wrapped = beginUsage(throwingCompletion, 'fork_sync_finished');
    expect(() => wrapped.markResult({ outcome: 'completed' })).not.toThrow();
    expect(() => wrapped.finish({ outcome: 'completed' })).not.toThrow();
    expect(() => beginUsage(NOOP_USAGE, 'fork_sync_finished').finish()).not.toThrow();
  });
});
