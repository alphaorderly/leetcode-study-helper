import { describe, expect, it } from 'vitest';
import {
  getProblemIssue,
  getProblemWeek,
  WEEKLY_PROBLEM_ISSUES,
  WEEKLY_PROBLEM_SLUGS,
} from '../../../../src/domain/study/studySchedule';

describe('study schedule', () => {
  it('starts with a single onboarding problem followed by 15 weeks of five unique problems', () => {
    const allSlugs = WEEKLY_PROBLEM_SLUGS.flat();

    expect(WEEKLY_PROBLEM_SLUGS).toHaveLength(16);
    expect(WEEKLY_PROBLEM_SLUGS[0]).toEqual(['to-lower-case']);
    expect(WEEKLY_PROBLEM_SLUGS.slice(1).every((week) => week.length === 5)).toBe(true);
    expect(new Set(allSlugs)).toHaveProperty('size', 76);
  });

  it('keeps issue numbers aligned with weekly slugs', () => {
    expect(WEEKLY_PROBLEM_ISSUES).toHaveLength(WEEKLY_PROBLEM_SLUGS.length);
    expect(
      WEEKLY_PROBLEM_ISSUES.every(
        (week, index) => week.length === WEEKLY_PROBLEM_SLUGS[index]!.length,
      ),
    ).toBe(true);
    expect(new Set(WEEKLY_PROBLEM_ISSUES.flat())).toHaveProperty('size', 76);
  });

  it('returns the assigned week for a known problem', () => {
    expect(getProblemWeek('to-lower-case')).toBe(0);
    expect(getProblemWeek('two-sum')).toBe(1);
    expect(getProblemWeek('alien-dictionary')).toBe(15);
    expect(getProblemWeek('not-in-the-schedule')).toBeUndefined();
  });

  it('returns DaleStudy issue numbers for known problems', () => {
    expect(getProblemIssue('to-lower-case')).toBe(2885);
    expect(getProblemIssue('two-sum')).toBe(219);
    expect(getProblemIssue('valid-anagram')).toBe(218);
    expect(getProblemIssue('alien-dictionary')).toBe(291);
    expect(getProblemIssue('not-in-the-schedule')).toBeUndefined();
  });
});
