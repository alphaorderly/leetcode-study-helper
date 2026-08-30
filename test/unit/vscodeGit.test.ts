import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class {
    readonly event = () => ({ dispose(): void {} });
    dispose(): void {}
  },
}));

import { gitRefLookupPattern } from '../../src/git/vscodeGit';

describe('gitRefLookupPattern', () => {
  it('looks up local branches under refs/heads', () => {
    expect(gitRefLookupPattern('week-10')).toBe('refs/heads/week-10');
    expect(gitRefLookupPattern('main')).toBe('refs/heads/main');
  });

  it('looks up remote tracking branches under refs/remotes', () => {
    expect(gitRefLookupPattern('origin/week-10')).toBe('refs/remotes/origin/week-10');
    expect(gitRefLookupPattern('upstream/main')).toBe('refs/remotes/upstream/main');
  });
});
