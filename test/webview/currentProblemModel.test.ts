import { describe, expect, it } from 'vitest';
import type { CurrentProblemSnapshot } from '../../src/shared/contracts';
import { problemDetailView, pythonRunnerView } from '../../src/webview/state/currentProblemModel';

const solution = {
  name: 'CaseUser.py',
  uri: 'file:///study/two-sum/CaseUser.py',
  gitStatus: 'pushed' as const,
};

const base = {
  rootUri: 'file:///study',
  slug: 'two-sum',
  solution,
  runner: { status: 'checking' as const },
};

describe('problemDetailView', () => {
  it('shows loading, error, paid, and loaded content states', () => {
    expect(problemDetailView({ ...base, status: 'idle' }).kind).toBe('loading');
    expect(problemDetailView({ ...base, status: 'error', message: 'boom' })).toEqual({
      kind: 'error',
      message: 'boom',
      slug: 'two-sum',
    });
    const paid: CurrentProblemSnapshot = {
      ...base,
      status: 'loaded',
      detail: {
        questionId: '1',
        title: 'Two Sum',
        titleSlug: 'two-sum',
        difficulty: 'Easy',
        isPaidOnly: true,
        topicTags: [],
      },
    };
    expect(problemDetailView(paid)).toMatchObject({ kind: 'loaded', hideContent: true });
  });
});

describe('pythonRunnerView', () => {
  it('maps checking, unavailable, and missing candidates before controls', () => {
    expect(pythonRunnerView({ status: 'checking' }).kind).toBe('checking');
    expect(
      pythonRunnerView({
        status: 'unavailable',
        reason: 'no python',
        missingObjects: ['ListNode'],
      }),
    ).toEqual({
      kind: 'unavailable',
      reason: 'no python',
      missingObjects: ['ListNode'],
    });
    expect(pythonRunnerView({ status: 'error', message: 'parse failed' })).toEqual({
      kind: 'no-candidates',
      message: 'parse failed',
    });
  });

  it('keeps controls visible while a candidate is running or failing', () => {
    const candidates = [{ id: 'c0', label: 'Solution', classLine: 1, methodLine: 2 }];
    expect(
      pythonRunnerView({
        status: 'running',
        candidates,
        selectedCandidateId: 'c0',
      }),
    ).toMatchObject({
      kind: 'ready',
      running: true,
      runLabel: '실행 중…',
      result: { kind: 'running' },
    });
    expect(
      pythonRunnerView({
        status: 'failed',
        candidates,
        selectedCandidateId: 'c0',
        passed: 1,
        total: 2,
        failedCase: 2,
        durationMs: 9,
        assertion: 'assert x',
        stdout: 'out',
      }),
    ).toMatchObject({
      kind: 'ready',
      result: {
        kind: 'failed',
        text: '2번째 테스트 실패 · 1/2개 통과 · 9ms',
        assertion: 'assert x',
      },
      stdout: 'out',
    });
  });
});
