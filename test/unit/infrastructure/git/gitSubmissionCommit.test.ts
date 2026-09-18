import './submissionTestHarness';
import { describe, expect, it, vi } from 'vitest';
import {
  harness,
  uri,
  change,
  type createRepository,
  useCanonicalRemote,
  makeMainAheadOfCanonical,
  githubResponse,
} from './submissionTestHarness';
import { GitStatusService } from '../../../../src/infrastructure/git/gitStatusService.js';

describe('GitStatusService commit', () => {
  it('commits only when the live index exactly matches the expected solutions', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    const solution = change('two-sum/CaseUser.py');
    repository.state.indexChanges = [solution];
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
    const expected = [
      {
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        relativePath: 'two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      },
    ];

    await service.commit(
      uri('file:///study') as never,
      '[CaseUser] WEEK 01 Solutions',
      expected,
      expected,
    );
    repository.state.indexChanges = [solution, change('notes/private.md')];

    await expect(
      service.commit(
        uri('file:///study') as never,
        '[CaseUser] WEEK 01 Solutions',
        expected,
        expected,
      ),
    ).rejects.toThrow('스테이징 상태가 변경');

    expect(repository.commit).toHaveBeenCalledOnce();
    expect(repository.createBranch).toHaveBeenCalledWith('week-01', true, 'upstream/main');
    expect(repository.state.HEAD.name).toBe('week-01');
    service.dispose();
  });

  it('creates a new week branch from canonical main when fork main is ahead', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    makeMainAheadOfCanonical(repository);
    repository.state.indexChanges = [change('two-sum/CaseUser.py')];
    const expected = [
      {
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        relativePath: 'two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      },
    ];
    const service = new GitStatusService();

    await service.commit(
      uri('file:///study') as never,
      '[CaseUser] WEEK 01 Solutions',
      expected,
      expected,
    );

    expect(repository.createBranch).toHaveBeenCalledWith('week-01', true, 'upstream/main');
    expect(repository.state.HEAD.name).toBe('week-01');
    expect(repository.state.HEAD.commit).toBe('canonical');
    expect(repository.commit).toHaveBeenCalledOnce();
    service.dispose();
  });

  it('uses a differently named canonical remote and does not add upstream', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    useCanonicalRemote(repository, 'official');
    repository.state.indexChanges = [change('two-sum/CaseUser.py')];
    const expected = [
      {
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        relativePath: 'two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      },
    ];
    const service = new GitStatusService();

    await service.commit(
      uri('file:///study') as never,
      '[CaseUser] WEEK 01 Solutions',
      expected,
      expected,
    );

    expect(repository.createBranch).toHaveBeenCalledWith('week-01', true, 'official/main');
    expect(repository.fetch).toHaveBeenCalledWith({
      remote: 'official',
      ref: 'main',
      prune: true,
    });
    expect(repository.addRemote).not.toHaveBeenCalled();
    expect(repository.commit).toHaveBeenCalledOnce();
    service.dispose();
  });

  it('reuses an aligned local and remote week branch before committing', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.indexChanges = [change('two-sum/CaseUser.py')];
    repository.state.refs.push(
      { name: 'week-01', commit: 'week-tip', remote: undefined },
      { name: 'origin/week-01', commit: 'week-tip', remote: 'origin' },
    );
    const expected = [
      {
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        relativePath: 'two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      },
    ];
    const service = new GitStatusService();

    await service.commit(
      uri('file:///study') as never,
      '[CaseUser] WEEK 01 Solutions',
      expected,
      expected,
    );

    expect(repository.checkout).toHaveBeenCalledWith('week-01');
    expect(repository.createBranch).not.toHaveBeenCalled();
    expect(repository.setBranchUpstream).toHaveBeenCalledWith('week-01', 'origin/week-01');
    expect(repository.commit).toHaveBeenCalledOnce();
    service.dispose();
  });

  it('creates a tracking local branch from an existing remote week branch', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.indexChanges = [change('two-sum/CaseUser.py')];
    repository.state.refs.push({ name: 'origin/week-01', commit: 'week-tip', remote: 'origin' });
    const expected = [
      {
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        relativePath: 'two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      },
    ];
    const service = new GitStatusService();

    await service.commit(
      uri('file:///study') as never,
      '[CaseUser] WEEK 01 Solutions',
      expected,
      expected,
    );

    expect(repository.createBranch).toHaveBeenCalledWith('week-01', true, 'origin/week-01');
    expect(repository.setBranchUpstream).toHaveBeenCalledWith('week-01', 'origin/week-01');
    expect(repository.commit).toHaveBeenCalledOnce();
    service.dispose();
  });

  it('does not reuse a week branch whose local and remote tips differ', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.indexChanges = [change('two-sum/CaseUser.py')];
    repository.state.refs.push(
      { name: 'week-01', commit: 'local-tip', remote: undefined },
      { name: 'origin/week-01', commit: 'remote-tip', remote: 'origin' },
    );
    const expected = [
      {
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        relativePath: 'two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      },
    ];
    const service = new GitStatusService();

    await expect(
      service.commit(
        uri('file:///study') as never,
        '[CaseUser] WEEK 01 Solutions',
        expected,
        expected,
      ),
    ).rejects.toThrow('로컬·원격 상태가 일치하지 않아');

    expect(repository.checkout).not.toHaveBeenCalled();
    expect(repository.commit).not.toHaveBeenCalled();
    service.dispose();
  });

  it('does not reuse a week branch that contains another week vs canonical main', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.indexChanges = [change('two-sum/CaseUser.py')];
    repository.state.refs.push(
      { name: 'week-01', commit: 'week-tip', remote: undefined },
      { name: 'origin/week-01', commit: 'week-tip', remote: 'origin' },
    );
    repository.log.mockResolvedValue([
      {
        hash: 'week-eight',
        message: '[CaseUser] WEEK 08 Solutions',
        parents: ['origin'],
      },
    ]);
    repository.diffBetween.mockResolvedValue([change('linked-list-cycle/CaseUser.py')]);
    const expected = [
      {
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        relativePath: 'two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      },
    ];
    const service = new GitStatusService();

    await expect(
      service.commit(uri('file:///study') as never, '[CaseUser] WEEK 01 Solutions', expected, [
        ...expected,
        {
          name: 'CaseUser.py',
          uri: 'file:///study/linked-list-cycle/CaseUser.py',
          slug: 'linked-list-cycle',
          week: 8,
        },
      ]),
    ).rejects.toThrow('Week 1 풀이 외 변경');

    expect(repository.log).toHaveBeenCalledWith(
      expect.objectContaining({
        range: 'origin..week-01',
      }),
    );
    expect(repository.checkout).not.toHaveBeenCalled();
    expect(repository.commit).not.toHaveBeenCalled();
    service.dispose();
  });

  it('does not reuse a week branch that contains a merge commit vs canonical main', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.indexChanges = [change('two-sum/CaseUser.py')];
    repository.state.refs.push(
      { name: 'week-01', commit: 'week-tip', remote: undefined },
      { name: 'origin/week-01', commit: 'week-tip', remote: 'origin' },
    );
    repository.log.mockResolvedValue([
      {
        hash: 'mergeabc',
        message: 'Merge origin/main',
        parents: ['origin', 'personal'],
      },
    ]);
    const expected = [
      {
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        relativePath: 'two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      },
    ];
    const service = new GitStatusService();

    await expect(
      service.commit(
        uri('file:///study') as never,
        '[CaseUser] WEEK 01 Solutions',
        expected,
        expected,
      ),
    ).rejects.toThrow('공식 main이 아닌 merge 히스토리');

    expect(repository.commit).not.toHaveBeenCalled();
    service.dispose();
  });

  it('commits on a week branch whose history vs canonical main is the current week', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'week-01';
    repository.state.HEAD.commit = 'local';
    repository.state.HEAD.upstream = undefined;
    repository.state.indexChanges = [change('two-sum/CaseUser.py')];
    repository.log.mockResolvedValue([
      {
        hash: 'local',
        message: '[CaseUser] WEEK 01 Solutions',
        parents: ['origin'],
      },
    ]);
    repository.diffBetween.mockResolvedValue([change('two-sum/CaseUser.py')]);
    const expected = [
      {
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        relativePath: 'two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      },
    ];
    const service = new GitStatusService();

    await service.commit(
      uri('file:///study') as never,
      '[CaseUser] WEEK 01 Solutions',
      expected,
      expected,
    );

    expect(repository.log).toHaveBeenCalledWith(
      expect.objectContaining({
        range: 'local..HEAD',
      }),
    );
    expect(repository.createBranch).not.toHaveBeenCalled();
    expect(repository.commit).toHaveBeenCalledOnce();
    service.dispose();
  });

  it('rejects committing on a week branch whose canonical range includes another week', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'week-01';
    repository.state.HEAD.commit = 'local';
    repository.state.HEAD.upstream = undefined;
    repository.state.indexChanges = [change('two-sum/CaseUser.py')];
    repository.log.mockResolvedValue([
      {
        hash: 'week-eight',
        message: '[CaseUser] WEEK 08 Solutions',
        parents: ['origin'],
      },
    ]);
    repository.diffBetween.mockResolvedValue([change('linked-list-cycle/CaseUser.py')]);
    const expected = [
      {
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        relativePath: 'two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      },
    ];
    const service = new GitStatusService();

    await expect(
      service.commit(uri('file:///study') as never, '[CaseUser] WEEK 01 Solutions', expected, [
        ...expected,
        {
          name: 'CaseUser.py',
          uri: 'file:///study/linked-list-cycle/CaseUser.py',
          slug: 'linked-list-cycle',
          week: 8,
        },
      ]),
    ).rejects.toThrow('Week 1 풀이 외 변경');

    expect(repository.log).toHaveBeenCalledWith(
      expect.objectContaining({
        range: 'local..HEAD',
      }),
    );
    expect(repository.commit).not.toHaveBeenCalled();
    service.dispose();
  });

  it('rechecks the current branch before committing a cached submission', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'feature/stale-view';
    repository.state.indexChanges = [change('two-sum/CaseUser.py')];
    const service = new GitStatusService();

    await expect(
      service.commit(
        uri('file:///study') as never,
        '[CaseUser] WEEK 01 Solutions',
        [
          {
            name: 'CaseUser.py',
            uri: 'file:///study/two-sum/CaseUser.py',
            relativePath: 'two-sum/CaseUser.py',
            slug: 'two-sum',
            week: 1,
          },
        ],
        [
          {
            name: 'CaseUser.py',
            uri: 'file:///study/two-sum/CaseUser.py',
            slug: 'two-sum',
            week: 1,
          },
        ],
      ),
    ).rejects.toThrow('main 또는 week-01');

    expect(repository.commit).not.toHaveBeenCalled();
    service.dispose();
  });
});
