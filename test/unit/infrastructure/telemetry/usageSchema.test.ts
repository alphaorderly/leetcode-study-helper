import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import {
  isUsageEventName,
  sanitizeUsageProperties,
} from '../../../../src/infrastructure/telemetry/usageSchema';
import { WEEKLY_PROBLEM_SLUGS } from '../../../../src/domain/study/studySchedule';
import type { UsageEventName, UsageProperties } from '../../../../src/shared/telemetry';
import type { PostHogEvent } from '../../../../src/infrastructure/telemetry/posthogHttp';

describe('usage payload schema', () => {
  it('recognizes only exact event names and rejects inherited names or extension prefixes', () => {
    expect(isUsageEventName('solution_open_finished')).toBe(true);
    for (const name of [
      'toString',
      'constructor',
      '__proto__',
      'telemetry_connection_test',
      'alphaorderly.leetcode-study-helper/solution_open_finished',
      ' solution_open_finished',
    ]) {
      expect(isUsageEventName(name)).toBe(false);
    }
  });

  it.each([undefined, null, 'private input', 1, [], new Error('private failure')])(
    'rejects non-event payloads %j',
    (input) => {
      expect(sanitizeUsageProperties('test_finished', input)).toBeUndefined();
    },
  );

  it('drops personal data, code, paths, repository details, and arbitrary common properties', () => {
    const input = Object.freeze({
      outcome: 'completed',
      problem_slug: 'two-sum',
      study_week: 15,
      language: 'python',
      duration_ms: 25,
      nickname: 'learner',
      code: 'class Solution: private',
      path: '/Users/learner/two-sum.py',
      uri: 'file:///Users/learner/two-sum.py',
      repository: 'https://github.com/learner/private',
      branch: 'week-01',
      commit_hash: '1234',
      pr_number: 12,
      operation_id: 'private-operation',
      error: new Error('private exception'),
      stdout: 'private output',
      $ip: '203.0.113.1',
      'common.vscodemachineid': 'machine-identity',
      properties: { raw: 'nested private data' },
    });

    expect(sanitizeUsageProperties('solution_open_finished', input)).toEqual({
      outcome: 'completed',
      problem_slug: 'two-sum',
      study_week: 1,
      language: 'python3',
      duration_ms: 25,
    });
    expect(input.study_week).toBe(15);
  });

  it('accepts only the seventy-five official problem slugs and derives their canonical week', () => {
    expect(WEEKLY_PROBLEM_SLUGS.flat()).toHaveLength(75);
    for (const [index, slugs] of WEEKLY_PROBLEM_SLUGS.entries()) {
      for (const slug of slugs) {
        expect(
          sanitizeUsageProperties('test_finished', {
            outcome: 'passed',
            problem_slug: slug,
            study_week: 999,
          }),
        ).toEqual({ outcome: 'passed', problem_slug: slug, study_week: index + 1 });
      }
    }
    for (const slug of ['three-sum', 'private-problem', '/Users/learner/two-sum', 'Two-Sum']) {
      expect(
        sanitizeUsageProperties('solution_open_finished', {
          outcome: 'completed',
          problem_slug: slug,
        }),
      ).toEqual({ outcome: 'completed' });
    }
  });

  it('uses different action allowlists for submission and preparation events', () => {
    expect(
      sanitizeUsageProperties('submission_action_finished', {
        outcome: 'completed',
        action: 'commit',
        phase: 'done',
        source_week: 1,
      }),
    ).toEqual({ outcome: 'completed', action: 'commit' });
    expect(
      sanitizeUsageProperties('next_week_preparation_finished', {
        outcome: 'completed',
        action: 'continue',
        pr_target: 'existing',
        study_week: 1,
      }),
    ).toEqual({ outcome: 'completed', action: 'continue' });
    expect(
      sanitizeUsageProperties('submission_action_finished', {
        outcome: 'completed',
        action: 'continue',
      }),
    ).toBeUndefined();
    expect(
      sanitizeUsageProperties('next_week_preparation_finished', {
        outcome: 'completed',
        action: 'commit',
      }),
    ).toBeUndefined();
  });

  it('restricts test outcomes, basic operation outcomes, and recoverable preparation outcomes', () => {
    for (const outcome of ['passed', 'failed', 'error', 'cancelled']) {
      expect(sanitizeUsageProperties('test_finished', { outcome })).toEqual({ outcome });
    }
    for (const outcome of ['completed', 'noop', 'awaiting_recovery']) {
      expect(sanitizeUsageProperties('test_finished', { outcome })).toBeUndefined();
    }
    for (const outcome of ['completed', 'cancelled', 'noop', 'error']) {
      expect(sanitizeUsageProperties('fork_sync_finished', { outcome })).toEqual({ outcome });
    }
    for (const outcome of ['passed', 'failed', 'awaiting_recovery']) {
      expect(sanitizeUsageProperties('fork_sync_finished', { outcome })).toBeUndefined();
      expect(
        sanitizeUsageProperties('submission_action_finished', { outcome, action: 'push' }),
      ).toBeUndefined();
      expect(sanitizeUsageProperties('solution_open_finished', { outcome })).toBeUndefined();
    }
    expect(
      sanitizeUsageProperties('next_week_preparation_finished', {
        outcome: 'awaiting_recovery',
        action: 'continue',
        phase: 'applying',
      }),
    ).toEqual({ outcome: 'awaiting_recovery', action: 'continue', phase: 'applying' });
    for (const outcome of ['passed', 'failed']) {
      expect(
        sanitizeUsageProperties('next_week_preparation_finished', {
          outcome,
          action: 'continue',
        }),
      ).toBeUndefined();
    }
  });

  it.each(['stage', 'unstage'])('retains the canonical problem and week for %s only', (action) => {
    expect(
      sanitizeUsageProperties('submission_action_finished', {
        outcome: 'completed',
        action,
        problem_slug: 'two-sum',
        study_week: 15,
        problem_count: 1,
        pr_target: 'existing',
      }),
    ).toEqual({
      outcome: 'completed',
      action,
      problem_slug: 'two-sum',
      study_week: 1,
      problem_count: 1,
    });
  });

  it.each(['commit', 'push', 'open_pr'])(
    'does not let a single problem override %s scope',
    (action) => {
      expect(
        sanitizeUsageProperties('submission_action_finished', {
          outcome: 'completed',
          action,
          problem_slug: 'two-sum',
          study_week: 2,
          problem_count: 3,
        }),
      ).toEqual({ outcome: 'completed', action, study_week: 2, problem_count: 3 });
      expect(
        sanitizeUsageProperties('submission_action_finished', {
          outcome: 'completed',
          action,
          problem_slug: 'two-sum',
          problem_count: 3,
        }),
      ).toEqual({ outcome: 'completed', action, problem_count: 3 });
    },
  );

  it('allows PR target only for actually opening a PR page', () => {
    expect(
      sanitizeUsageProperties('submission_action_finished', {
        outcome: 'completed',
        action: 'open_pr',
        pr_target: 'creation_form',
      }),
    ).toEqual({ outcome: 'completed', action: 'open_pr', pr_target: 'creation_form' });
    for (const action of ['stage', 'unstage', 'commit', 'push']) {
      expect(
        sanitizeUsageProperties('submission_action_finished', {
          outcome: 'completed',
          action,
          pr_target: 'existing',
        }),
      ).toEqual({ outcome: 'completed', action });
    }
  });

  it('requires result, action, reference kind, and session readiness where applicable', () => {
    expect(sanitizeUsageProperties('solution_open_finished', { duration_ms: 1 })).toBeUndefined();
    expect(
      sanitizeUsageProperties('submission_action_finished', { outcome: 'completed' }),
    ).toBeUndefined();
    expect(
      sanitizeUsageProperties('reference_open_finished', { outcome: 'completed' }),
    ).toBeUndefined();
    expect(
      sanitizeUsageProperties('study_session_started', { setup_ready: 'true' }),
    ).toBeUndefined();
    expect(
      sanitizeUsageProperties('study_session_started', {
        setup_ready: false,
        preferred_language: 'typescript',
        outcome: 'completed',
      }),
    ).toEqual({ setup_ready: false, preferred_language: 'typescript' });
  });

  it.each([-1, NaN, Infinity, -Infinity, '1', {}, true])(
    'drops unsafe numeric values %j',
    (value) => {
      expect(
        sanitizeUsageProperties('test_finished', {
          outcome: 'passed',
          duration_ms: value,
          passed: value,
          total: value,
          study_week: value,
        }),
      ).toEqual({ outcome: 'passed' });
    },
  );

  it('restricts whole counts, finite durations, and actual schedule weeks', () => {
    expect(
      sanitizeUsageProperties('test_finished', {
        outcome: 'passed',
        duration_ms: 86400001,
        passed: 0.5,
        total: 1000001,
        study_week: 16,
      }),
    ).toEqual({ outcome: 'passed' });
    expect(
      sanitizeUsageProperties('test_finished', {
        outcome: 'passed',
        duration_ms: 0.5,
        passed: 0,
        total: 1,
        study_week: 15,
      }),
    ).toEqual({ outcome: 'passed', duration_ms: 0.5, passed: 0, total: 1, study_week: 15 });
    expect(
      sanitizeUsageProperties('next_week_preparation_finished', {
        outcome: 'completed',
        action: 'prepare',
        source_week: 0,
        target_week: 1.5,
        problem_count: -2,
      }),
    ).toEqual({ outcome: 'completed', action: 'prepare' });
  });

  it('allows only explicit booleans and fixed language, result, phase, and error values', () => {
    expect(
      sanitizeUsageProperties('test_finished', {
        outcome: 'passed',
        language: '/usr/bin/python3',
        error_code: 'private traceback',
        followup_failed: 'true',
        failure_stage: 'unknown file',
      }),
    ).toEqual({ outcome: 'passed' });
    expect(
      sanitizeUsageProperties('test_finished', {
        outcome: 'error',
        language: 'python3',
        error_code: 'runner',
        followup_failed: true,
        failure_stage: 'execute',
      }),
    ).toEqual({
      outcome: 'error',
      language: 'python3',
      error_code: 'runner',
      followup_failed: true,
      failure_stage: 'execute',
    });
    expect(
      sanitizeUsageProperties('next_week_preparation_finished', {
        outcome: 'completed',
        action: 'cancel',
        phase: 'private-ref',
      }),
    ).toEqual({ outcome: 'completed', action: 'cancel' });
    expect(
      sanitizeUsageProperties('solution_open_finished', { outcome: 'private-error' }),
    ).toBeUndefined();
  });

  it('declares every runtime event and collected property in the published telemetry disclosure', async () => {
    vi.useFakeTimers();
    const extensionId = 'alphaorderly.leetcode-study-helper';
    vi.doMock('vscode', () => ({
      version: '1.100.0',
      ExtensionMode: { Production: 1, Development: 2, Test: 3 },
      EventEmitter: class<T> {
        private readonly listeners = new Set<(value: T) => void>();
        readonly event = (listener: (value: T) => void) => {
          this.listeners.add(listener);
          return { dispose: () => this.listeners.delete(listener) };
        };
        fire(value: T) {
          for (const listener of this.listeners) listener(value);
        }
        dispose() {
          this.listeners.clear();
        }
      },
      env: {
        isTelemetryEnabled: true,
        onDidChangeTelemetryEnabled: () => ({ dispose() {} }),
        createTelemetryLogger: (sender: vscode.TelemetrySender) => ({
          isUsageEnabled: true,
          onDidChangeEnableStates: () => ({ dispose() {} }),
          logUsage: (name: string, properties: Record<string, unknown>) => {
            sender.sendEventData(`${extensionId}/${name}`, properties);
          },
          dispose() {},
        }),
      },
      workspace: {
        getConfiguration: () => ({ inspect: () => ({ globalValue: true }) }),
        onDidChangeConfiguration: () => ({ dispose() {} }),
      },
    }));
    const { TelemetryService } =
      await import('../../../../src/infrastructure/telemetry/telemetryService.js');
    const recorded: PostHogEvent[] = [];
    const context = {
      extensionMode: 1,
      extension: { id: extensionId, packageJSON: { version: '1.10.0' } },
      globalState: {
        get: (key: string, fallback?: unknown) =>
          key === 'telemetry.installationId.v1' ? '11111111-1111-4111-8111-111111111111' : fallback,
        update: async () => {},
      },
    } as unknown as vscode.ExtensionContext;
    const service = new TelemetryService(context, {
      sender: async (events) => {
        recorded.push(...events);
        return 'accepted';
      },
      timestamp: () => '2026-10-12T12:00:00.000Z',
    });
    const result: UsageProperties = {
      outcome: 'completed',
      duration_ms: 10,
      followup_failed: true,
      failure_stage: 'refresh',
      error_code: 'operation_failed',
    };
    const problem: UsageProperties = {
      ...result,
      problem_slug: 'two-sum',
      study_week: 1,
      language: 'python3',
    };
    const examples: Record<UsageEventName, UsageProperties[]> = {
      study_session_started: [{ setup_ready: true, preferred_language: 'python3' }],
      setup_ready: [{ preferred_language: 'python3' }],
      solution_open_finished: [problem],
      solution_create_finished: [{ ...problem, create_result: 'created' }],
      reference_open_finished: [{ ...problem, reference_kind: 'answer' }],
      test_finished: [{ ...problem, outcome: 'failed', passed: 2, total: 3 }],
      submission_action_finished: [
        { ...result, action: 'stage', problem_slug: 'two-sum', study_week: 1, problem_count: 1 },
        { ...result, action: 'open_pr', study_week: 2, problem_count: 3, pr_target: 'existing' },
      ],
      fork_sync_finished: [result],
      next_week_preparation_finished: [
        {
          ...result,
          outcome: 'awaiting_recovery',
          action: 'continue',
          phase: 'applying',
          source_week: 1,
          target_week: 2,
          problem_count: 2,
        },
      ],
    };
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(service.state.effectiveEnabled).toBe(true);
      for (const [name, samples] of Object.entries(examples)) {
        for (const sample of samples) service.begin(name as UsageEventName).finish(sample);
      }
      await service.shutdown();

      const disclosure = JSON.parse(
        readFileSync(resolve(process.cwd(), 'telemetry.json'), 'utf8'),
      ) as {
        commonProperties: Record<
          string,
          { purpose: string; classification: string; comment: string }
        >;
        events: Record<
          string,
          {
            properties: Record<
              string,
              { purpose: string; classification: string; comment: string }
            >;
          }
        >;
      };
      expect(recorded).toHaveLength(
        Object.values(examples).reduce((sum, samples) => sum + samples.length, 0),
      );
      for (const emitted of recorded) {
        const eventDisclosure = disclosure.events[emitted.event];
        expect(eventDisclosure, emitted.event).toBeDefined();
        const fields = { ...disclosure.commonProperties, ...eventDisclosure?.properties };
        for (const field of [
          ...Object.keys(emitted).filter((key) => key !== 'event' && key !== 'properties'),
          ...Object.keys(emitted.properties),
        ]) {
          expect(fields[field], `${emitted.event}.${field} must be disclosed`).toBeDefined();
          expect(fields[field]?.purpose).toBeTruthy();
          expect(fields[field]?.classification).toBeTruthy();
          expect(fields[field]?.comment).toBeTruthy();
        }
      }
    } finally {
      service.dispose();
      vi.doUnmock('vscode');
      vi.useRealTimers();
    }
  });
});
