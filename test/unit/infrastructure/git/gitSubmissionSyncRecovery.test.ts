import './submissionTestHarness';
import { describe, expect, it, vi } from 'vitest';
import {
  harness,
  uri,
  change,
  type createRepository,
  useCanonicalRemote,
  githubResponse,
} from './submissionTestHarness';
import { PreparationService } from '../../../../src/infrastructure/git/submission/preparationService';
import { GitStatusService } from '../../../../src/infrastructure/git/gitStatusService.js';

describe('GitStatusService syncRecovery', () => {
  it('merges upstream and pushes main when the fork is clean', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.refs.find(({ name }) => name === 'upstream/main')!.commit = 'upstream';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        githubResponse({
          fork: true,
          source: { full_name: 'DaleStudy/leetcode-study' },
        }),
      ),
    );
    const service = new GitStatusService();

    await service.syncFork(uri('file:///study') as never);

    expect(repository.fetch).toHaveBeenNthCalledWith(1, {
      remote: 'origin',
      ref: 'main',
      prune: true,
    });
    expect(repository.fetch).toHaveBeenNthCalledWith(2, {
      remote: 'upstream',
      ref: 'main',
      prune: true,
    });
    expect(repository.merge).toHaveBeenCalledWith('upstream/main');
    expect(repository.push).toHaveBeenCalledWith('origin', 'main', false);
    service.dispose();
  });

  it('preserves the synchronized local main when origin push fails', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.refs.find(({ name }) => name === 'upstream/main')!.commit = 'upstream';
    repository.getMergeBase.mockImplementation(async (_ref1: string, ref2: string) => {
      if (ref2 === 'origin/main') {
        return 'origin';
      }
      if (ref2 === 'upstream/main') {
        return repository.state.HEAD.commit === 'synced' ? 'upstream' : 'origin';
      }
      return 'origin';
    });
    repository.merge.mockImplementation(async (ref: string) => {
      if (ref === 'upstream/main') {
        repository.state.HEAD.commit = 'synced';
        repository.state.refs.find(({ name }) => name === 'main')!.commit = 'synced';
      }
    });
    repository.push.mockRejectedValueOnce(new Error('network down'));
    const service = new GitStatusService();

    await expect(service.syncFork(uri('file:///study') as never)).rejects.toThrow(
      '로컬 main에는 동기화 결과가 안전하게 남아 있습니다',
    );

    expect(repository.state.HEAD.commit).toBe('synced');
    expect(repository.mergeAbort).not.toHaveBeenCalled();
    service.dispose();
  });

  it('allows fork sync when only solution working-tree files are modified', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.workingTreeChanges = [change('two-sum/CaseUser.py')];
    repository.state.refs.find(({ name }) => name === 'upstream/main')!.commit = 'upstream';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        githubResponse({
          fork: true,
          source: { full_name: 'DaleStudy/leetcode-study' },
        }),
      ),
    );
    const service = new GitStatusService();

    await service.syncFork(uri('file:///study') as never, [
      {
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      },
    ]);

    expect(repository.merge).toHaveBeenCalledWith('upstream/main');
    expect(repository.push).toHaveBeenCalledWith('origin', 'main', false);
    service.dispose();
  });

  it('merges an existing canonical remote that is not named upstream', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    useCanonicalRemote(repository, 'official');
    repository.state.refs.find(({ name }) => name === 'official/main')!.commit = 'canonical';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        githubResponse({
          fork: true,
          source: { full_name: 'DaleStudy/leetcode-study' },
        }),
      ),
    );
    const service = new GitStatusService();

    await service.syncFork(uri('file:///study') as never);

    expect(repository.addRemote).not.toHaveBeenCalled();
    expect(repository.fetch).toHaveBeenCalledWith({
      remote: 'official',
      ref: 'main',
      prune: true,
    });
    expect(repository.merge).toHaveBeenCalledWith('official/main');
    expect(repository.merge).not.toHaveBeenCalledWith('upstream/main');
    expect(repository.push).toHaveBeenCalledWith('origin', 'main', false);
    service.dispose();
  });

  it('skips upstream merge when main already contains upstream', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.commit = 'fork-ahead';
    repository.state.HEAD.upstream!.commit = 'fork-ahead';
    repository.state.refs.find(({ name }) => name === 'main')!.commit = 'fork-ahead';
    repository.state.refs.find(({ name }) => name === 'origin/main')!.commit = 'fork-ahead';
    repository.state.refs.find(({ name }) => name === 'upstream/main')!.commit = 'upstream';
    repository.getMergeBase.mockImplementation(async (_ref1: string, ref2: string) => {
      if (ref2 === 'upstream/main') {
        return 'upstream';
      }
      if (ref2 === 'origin/main') {
        return 'fork-ahead';
      }
      return 'origin';
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        githubResponse({
          fork: true,
          source: { full_name: 'DaleStudy/leetcode-study' },
        }),
      ),
    );
    const service = new GitStatusService();

    await service.syncFork(uri('file:///study') as never);

    expect(repository.merge).not.toHaveBeenCalled();
    expect(repository.push).toHaveBeenCalledWith('origin', 'main', false);
    service.dispose();
  });

  it('blocks fork sync when main has commits ahead of origin without an upstream', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.upstream = undefined;
    repository.state.HEAD.commit = 'local';
    repository.state.remotes = repository.state.remotes.filter(({ name }) => name !== 'upstream');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        githubResponse({
          fork: true,
          source: { full_name: 'DaleStudy/leetcode-study' },
        }),
      ),
    );
    const service = new GitStatusService();

    await expect(service.syncFork(uri('file:///study') as never)).rejects.toThrow(
      'push하지 않은 로컬 커밋',
    );

    expect(repository.addRemote).not.toHaveBeenCalled();
    expect(repository.merge).not.toHaveBeenCalled();
    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('rejects fork sync when origin/main is missing after fetch', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.getCommit.mockImplementation(async (ref: string) => {
      if (ref === 'origin/main') {
        throw new Error('missing origin/main');
      }
      return {
        hash:
          ref === 'HEAD'
            ? repository.state.HEAD.commit
            : (repository.state.refs.find(({ name }) => name === ref)?.commit ?? ref),
        message: ref,
        parents: ['origin'],
      };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        githubResponse({
          fork: true,
          source: { full_name: 'DaleStudy/leetcode-study' },
        }),
      ),
    );
    const service = new GitStatusService();

    await expect(service.syncFork(uri('file:///study') as never)).rejects.toThrow(
      'origin/main을 가져오지 못했습니다',
    );

    expect(repository.merge).not.toHaveBeenCalled();
    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('discards only non-solution tracked changes', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.indexChanges = [change('README.md')];
    repository.state.workingTreeChanges = [change('README.md'), change('two-sum/CaseUser.py')];
    repository.state.untrackedChanges = [change('notes.txt')];
    repository.revert.mockImplementation(async (paths: string[]) => {
      const unstaged = new Set(paths);
      repository.state.indexChanges = repository.state.indexChanges.filter(
        (item) => !unstaged.has(item.uri.fsPath),
      );
    });
    const service = new GitStatusService();

    await service.discardOtherTrackedChanges(
      uri('file:///study') as never,
      [
        {
          name: 'CaseUser.py',
          uri: 'file:///study/two-sum/CaseUser.py',
          slug: 'two-sum',
          week: 1,
        },
      ],
      ['README.md'],
    );

    expect(repository.revert).toHaveBeenCalledWith(['/study/README.md']);
    expect(repository.clean).toHaveBeenCalledWith(['/study/README.md']);
    expect(
      repository.state.workingTreeChanges.map(({ uri: changeUri }) => changeUri.fsPath),
    ).toEqual(['/study/two-sum/CaseUser.py']);
    expect(repository.state.untrackedChanges.map(({ uri: changeUri }) => changeUri.fsPath)).toEqual(
      ['/study/notes.txt'],
    );
    service.dispose();
  });

  it('does not restore a non-solution path added after confirmation', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.workingTreeChanges = [change('README.md'), change('new-config.json')];
    const service = new GitStatusService();

    await expect(
      service.discardOtherTrackedChanges(uri('file:///study') as never, [], ['README.md']),
    ).rejects.toThrow('변경 목록이 달라졌습니다');

    expect(repository.revert).not.toHaveBeenCalled();
    expect(repository.clean).not.toHaveBeenCalled();
    service.dispose();
  });

  it('aborts an origin merge when a behind branch encounters conflicts', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.commit = 'local';
    repository.getMergeBase.mockResolvedValueOnce('local');
    repository.merge.mockImplementation(async (ref: string) => {
      if (ref === 'origin/main') {
        repository.state.mergeChanges = [change('two-sum/CaseUser.py')];
        throw new Error('origin merge conflict');
      }
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        githubResponse({
          fork: true,
          source: { full_name: 'DaleStudy/leetcode-study' },
        }),
      ),
    );
    const service = new GitStatusService();

    await expect(service.syncFork(uri('file:///study') as never)).rejects.toThrow(
      'origin merge conflict',
    );

    expect(repository.merge).toHaveBeenCalledWith('origin/main');
    expect(repository.mergeAbort).toHaveBeenCalledOnce();
    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('aborts an upstream merge when it creates conflicts', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.refs.find(({ name }) => name === 'upstream/main')!.commit = 'upstream';
    repository.merge.mockImplementation(async (ref: string) => {
      if (ref === 'upstream/main') {
        repository.state.mergeChanges = [change('two-sum/CaseUser.py')];
        throw new Error('merge conflict');
      }
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        githubResponse({
          fork: true,
          parent: { full_name: 'DaleStudy/leetcode-study' },
        }),
      ),
    );
    const service = new GitStatusService();

    await expect(service.syncFork(uri('file:///study') as never)).rejects.toThrow('merge conflict');

    expect(repository.mergeAbort).toHaveBeenCalledOnce();
    expect(repository.push).not.toHaveBeenCalled();
    expect(repository.state.mergeChanges).toEqual([]);
    service.dispose();
  });

  it('routes the legacy main-return API through persistent preparation', async () => {
    const prepare = vi
      .spyOn(PreparationService.prototype, 'prepare')
      .mockResolvedValueOnce(undefined);
    const service = new GitStatusService();
    await service.returnToMainAndSync(uri('file:///study') as never);
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/study' }),
      [],
      undefined,
    );
    prepare.mockRestore();
    service.dispose();
  });
});
