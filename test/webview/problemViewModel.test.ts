import { describe, expect, it } from 'vitest';
import type { SolutionFileSnapshot } from '../../src/shared/contracts';
import { isUnpushed } from '../../src/webview/state/problemViewModel';

function solution(overrides: Partial<SolutionFileSnapshot>): SolutionFileSnapshot {
  return {
    name: 'CaseUser.py',
    uri: 'file:///study/two-sum/CaseUser.py',
    gitStatus: 'pushed',
    ...overrides,
  };
}

describe('isUnpushed', () => {
  it('follows the submission status shown on verified-fork cards', () => {
    for (const submissionStatus of [
      'working',
      'staged',
      'staged-outdated',
      'push-needed',
    ] as const) {
      expect(isUnpushed(solution({ submissionStatus }))).toBe(true);
    }
    for (const submissionStatus of ['pr-needed', 'pr-open', 'merged', 'checking'] as const) {
      expect(isUnpushed(solution({ submissionStatus, gitStatus: 'unpushed' }))).toBe(false);
    }
  });

  it('falls back to the upstream git status without a known submission status', () => {
    expect(isUnpushed(solution({ gitStatus: 'unpushed' }))).toBe(true);
    expect(isUnpushed(solution({ gitStatus: 'unpushed', submissionStatus: 'unknown' }))).toBe(true);
    expect(isUnpushed(solution({ gitStatus: 'pushed' }))).toBe(false);
  });
});
