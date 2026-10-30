import { describe, expect, it } from 'vitest';
import { submissionTitle, weekLabel, weekTag } from '../../../src/shared/studyWeek';

describe('study week presentation', () => {
  it('names week 0 as the onboarding week', () => {
    expect(weekLabel(0)).toBe('온보딩');
    expect(weekTag(0)).toBe('Onboarding');
    expect(submissionTitle('CaseUser', 0)).toBe('[CaseUser] Onboarding');
  });

  it('keeps the numbered format for regular weeks', () => {
    expect(weekLabel(3)).toBe('3주차');
    expect(weekTag(3)).toBe('Week 03');
    expect(submissionTitle('CaseUser', 12)).toBe('[CaseUser] WEEK 12 Solutions');
  });
});
