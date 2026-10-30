import { describe, expect, it } from 'vitest';
import type { ProblemSnapshot, SolutionFileSnapshot } from '../../src/shared/contracts';
import { groupProblems, isUnpushed } from '../../src/webview/state/problemViewModel';

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

function problem(slug: string, week: number | undefined): ProblemSnapshot {
  return {
    slug,
    week,
    difficulty: 'Easy',
    categories: [],
    blindCategories: [],
    completed: false,
    hasOtherSolutions: false,
    solutions: [],
  };
}

describe('groupProblems by week', () => {
  it('puts the onboarding week first once the repository has its problem', () => {
    const groups = groupProblems(
      [problem('two-sum', 1), problem('to-lower-case', 0), problem('private-problem', undefined)],
      'week',
    );

    expect(groups.map(({ label }) => label)).toEqual(['온보딩', '1주차', '주차 미지정']);
    expect(groups[0]!.problems.map(({ slug }) => slug)).toEqual(['to-lower-case']);
  });

  it('shows no onboarding group while the repository lacks the onboarding problem', () => {
    const groups = groupProblems([problem('two-sum', 1), problem('valid-anagram', 2)], 'week');

    expect(groups.map(({ label }) => label)).toEqual(['1주차', '2주차']);
  });
});
