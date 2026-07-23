import { describe, expect, it, vi } from 'vitest';
import {
  confirmOtherSolutionAccess,
  isOtherSolutionFile,
  OTHER_SOLUTION_CONSENT_KEY,
  selectRandomOtherSolution,
} from '../../src/core/otherSolutions';

describe('other solution rules', () => {
  it('finds another participant by the filename nickname', () => {
    expect(isOtherSolutionFile('AnotherUser.py', 'CaseUser')).toBe(true);
    expect(isOtherSolutionFile('caseuser.ts', 'CaseUser')).toBe(true);
    expect(isOtherSolutionFile('CaseUser.py', 'CaseUser')).toBe(false);
    expect(isOtherSolutionFile('README.md', 'CaseUser')).toBe(false);
    expect(isOtherSolutionFile('_helper.py', 'CaseUser')).toBe(false);
  });

  it('prefers the configured language and avoids an immediate repeat', () => {
    const files = [
      'CaseUser.py',
      'OtherTypeScript.ts',
      'SecondPython.py',
      'FirstPython.py',
      'README.md',
    ];

    expect(selectRandomOtherSolution(files, 'CaseUser', 'py', undefined, () => 0))
      .toBe('FirstPython.py');
    expect(selectRandomOtherSolution(files, 'CaseUser', 'py', 'FirstPython.py', () => 0.99))
      .toBe('SecondPython.py');
  });

  it('falls back to another language instead of repeating the only preferred file', () => {
    expect(selectRandomOtherSolution(
      ['OnlyPython.py', 'OtherTypeScript.ts'],
      'CaseUser',
      'py',
      'OnlyPython.py',
      () => 0,
    )).toBe('OtherTypeScript.ts');
  });

  it('persists consent only after confirmation and skips later prompts', async () => {
    const values = new Map<string, unknown>();
    const state = {
      get: <T>(key: string) => values.get(key) as T | undefined,
      update: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value);
      }),
    };
    const prompt = vi.fn(async () => '풀이 보기');

    await expect(confirmOtherSolutionAccess(state, prompt)).resolves.toBe(true);
    await expect(confirmOtherSolutionAccess(state, prompt)).resolves.toBe(true);

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(state.update).toHaveBeenCalledWith(OTHER_SOLUTION_CONSENT_KEY, true);
  });

  it('asks again after cancellation', async () => {
    const state = {
      get: <T>(): T | undefined => undefined,
      update: vi.fn(async () => {}),
    };
    const prompt = vi.fn(async () => undefined);

    await expect(confirmOtherSolutionAccess(state, prompt)).resolves.toBe(false);
    await expect(confirmOtherSolutionAccess(state, prompt)).resolves.toBe(false);

    expect(prompt).toHaveBeenCalledTimes(2);
    expect(state.update).not.toHaveBeenCalled();
  });
});
