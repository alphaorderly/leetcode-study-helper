import { describe, expect, it } from 'vitest';
import {
  getProblemIssue,
  getProblemWeek,
  WEEKLY_PROBLEM_ISSUES,
  WEEKLY_PROBLEM_SLUGS,
} from '../../src/core/studySchedule';

describe('study schedule', () => {
  it('contains 15 weeks with five unique problems each', () => {
    const allSlugs = WEEKLY_PROBLEM_SLUGS.flat();

    expect(WEEKLY_PROBLEM_SLUGS).toHaveLength(15);
    expect(WEEKLY_PROBLEM_SLUGS.every((week) => week.length === 5)).toBe(true);
    expect(new Set(allSlugs)).toHaveProperty('size', 75);
  });

  it('keeps issue numbers aligned with weekly slugs', () => {
    expect(WEEKLY_PROBLEM_ISSUES).toHaveLength(WEEKLY_PROBLEM_SLUGS.length);
    expect(WEEKLY_PROBLEM_ISSUES.every((week, index) =>
      week.length === WEEKLY_PROBLEM_SLUGS[index]!.length
    )).toBe(true);
    expect(new Set(WEEKLY_PROBLEM_ISSUES.flat())).toHaveProperty('size', 75);
  });

  it('returns the assigned week for a known problem', () => {
    expect(getProblemWeek('two-sum')).toBe(1);
    expect(getProblemWeek('alien-dictionary')).toBe(15);
    expect(getProblemWeek('not-in-the-schedule')).toBeUndefined();
  });

  it('returns DaleStudy issue numbers for known problems', () => {
    expect(getProblemIssue('two-sum')).toBe(219);
    expect(getProblemIssue('valid-anagram')).toBe(218);
    expect(getProblemIssue('alien-dictionary')).toBe(291);
    expect(getProblemIssue('not-in-the-schedule')).toBeUndefined();
  });
});
