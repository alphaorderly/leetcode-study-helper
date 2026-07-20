import { describe, expect, it } from 'vitest';
import { getProblemWeek, WEEKLY_PROBLEM_SLUGS } from '../../src/core/studySchedule';

describe('study schedule', () => {
  it('contains 15 weeks with five unique problems each', () => {
    const allSlugs = WEEKLY_PROBLEM_SLUGS.flat();

    expect(WEEKLY_PROBLEM_SLUGS).toHaveLength(15);
    expect(WEEKLY_PROBLEM_SLUGS.every((week) => week.length === 5)).toBe(true);
    expect(new Set(allSlugs)).toHaveProperty('size', 75);
  });

  it('returns the assigned week for a known problem', () => {
    expect(getProblemWeek('two-sum')).toBe(1);
    expect(getProblemWeek('alien-dictionary')).toBe(15);
    expect(getProblemWeek('not-in-the-schedule')).toBeUndefined();
  });
});
