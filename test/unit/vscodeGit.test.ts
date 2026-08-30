import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class {
    readonly event = () => ({ dispose(): void {} });
    dispose(): void {}
  },
}));

import {
  gitRefLookupPattern,
  repositoryFingerprint,
  type GitRepository,
} from '../../src/git/vscodeGit';

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

describe('repositoryFingerprint', () => {
  it('changes when switching branches that point to the same commit', () => {
    const repository = {
      state: {
        HEAD: {
          name: 'main',
          commit: 'same-commit',
        },
        remotes: [],
        rebaseCommit: undefined,
        mergeChanges: [],
        indexChanges: [],
        workingTreeChanges: [],
        untrackedChanges: [],
      },
    } as unknown as GitRepository;
    const mainFingerprint = repositoryFingerprint(repository);

    const weekRepository = {
      ...repository,
      state: {
        ...repository.state,
        HEAD: {
          ...repository.state.HEAD,
          name: 'week-11',
        },
      },
    } as GitRepository;

    expect(repositoryFingerprint(weekRepository)).not.toBe(mainFingerprint);
  });
});
