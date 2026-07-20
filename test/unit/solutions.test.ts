import { describe, expect, it } from 'vitest';
import {
  addMissingEndOfFileNewline,
  isIgnoredByLineLint,
  isMatchingSolution,
  isValidNickname,
  solutionNickname,
  targetFileStatus,
} from '../../src/core/solutions';

describe('solution filename rules', () => {
  it('uses the segment before the first dot as the nickname', () => {
    expect(solutionNickname('study-user.go.md')).toBe('study-user');
    expect(solutionNickname('no-extension')).toBeUndefined();
  });

  it('matches case-sensitively and excludes README.md', () => {
    expect(isMatchingSolution('Alpha.py', 'Alpha')).toBe(true);
    expect(isMatchingSolution('alpha.py', 'Alpha')).toBe(false);
    expect(isMatchingSolution('Alpha.go.md', 'Alpha')).toBe(true);
    expect(isMatchingSolution('README.md', 'README')).toBe(false);
  });

  it('validates study nicknames', () => {
    expect(isValidNickname('study-user9')).toBe(true);
    expect(isValidNickname('')).toBe(false);
    expect(isValidNickname('../study-user')).toBe(false);
    expect(isValidNickname('study_user')).toBe(false);
  });

  it('detects exact and case-only target collisions', () => {
    expect(targetFileStatus(['Alpha.py'], 'Alpha.py')).toBe('exists');
    expect(targetFileStatus(['Alpha.py'], 'alpha.py')).toBe('case-conflict');
    expect(targetFileStatus(['Alpha.ts'], 'alpha.py')).toBe('available');
  });

  it('applies the configured line lint end-of-file rule', () => {
    const encoder = new TextEncoder();
    expect(addMissingEndOfFileNewline(encoder.encode('answer')))
      .toEqual(encoder.encode('answer\n'));
    expect(addMissingEndOfFileNewline(encoder.encode('answer\n'))).toBeUndefined();
    expect(addMissingEndOfFileNewline(encoder.encode('answer\n\n')))
      .toEqual(encoder.encode('answer\n'));
    expect(addMissingEndOfFileNewline(encoder.encode('answer\n\n\n')))
      .toEqual(encoder.encode('answer\n'));
    expect(addMissingEndOfFileNewline(new Uint8Array())).toBeUndefined();
  });

  it('clears spaces and tabs from trailing blank lines', () => {
    const encoder = new TextEncoder();
    expect(addMissingEndOfFileNewline(encoder.encode('answer\n \t')))
      .toEqual(encoder.encode('answer\n'));
    expect(addMissingEndOfFileNewline(encoder.encode('answer\n \t\n\t')))
      .toEqual(encoder.encode('answer\n'));
    expect(addMissingEndOfFileNewline(encoder.encode('answer\n \t\n')))
      .toEqual(encoder.encode('answer\n'));
  });

  it('keeps trailing whitespace on non-blank lines', () => {
    const encoder = new TextEncoder();
    expect(addMissingEndOfFileNewline(encoder.encode('answer \t')))
      .toEqual(encoder.encode('answer \t\n'));
    expect(addMissingEndOfFileNewline(encoder.encode('answer \t\n'))).toBeUndefined();
    expect(addMissingEndOfFileNewline(encoder.encode('answer\n \t\nnext')))
      .toEqual(encoder.encode('answer\n \t\nnext\n'));
  });

  it('ignores markdown files using the configured pattern', () => {
    expect(isIgnoredByLineLint('Alpha.go.md')).toBe(true);
    expect(isIgnoredByLineLint('Alpha.py')).toBe(false);
  });
});
