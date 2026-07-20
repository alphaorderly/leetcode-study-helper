import { describe, expect, it } from 'vitest';
import { findLanguage, LANGUAGE_OPTIONS } from '../../src/core/languages';

describe('language options', () => {
  it('matches the repository language-extension mapping', () => {
    expect(findLanguage('python3')?.extension).toBe('py');
    expect(findLanguage('typescript')?.extension).toBe('ts');
    expect(findLanguage('elixir')?.extension).toBe('ex');
    expect(new Set(LANGUAGE_OPTIONS.map(({ id }) => id)).size).toBe(
      LANGUAGE_OPTIONS.length,
    );
  });
});
