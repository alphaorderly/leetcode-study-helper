import './submissionTestHarness';
import { describe, expect, it, vi } from 'vitest';
import {
  harness,
  uri,
  change,
  type createRepository,
  githubResponse,
} from './submissionTestHarness';
import { GitStatusService } from '../../../../src/infrastructure/git/gitStatusService.js';

describe('GitStatusService push', () => {
  it('blocks push when an unpushed commit contains a non-solution file', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'week-01';
    repository.state.HEAD.upstream = undefined;
    repository.state.HEAD.commit = 'local';
    repository.log.mockResolvedValue([
      {
        hash: 'local',
        message: '[CaseUser] WEEK 01 Solutions',
        parents: ['origin'],
      },
    ]);
    repository.diffBetween.mockResolvedValue([change('notes/private.md')]);
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

    await expect(
      service.push(uri('file:///study') as never, [
        {
          name: 'CaseUser.py',
          uri: 'file:///study/two-sum/CaseUser.py',
          slug: 'two-sum',
          week: 1,
        },
      ]),
    ).rejects.toThrow('풀이 외 파일이 포함된 커밋');

    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('pushes a single-week solution commit after refreshing origin and GitHub state', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'week-01';
    repository.state.HEAD.upstream = undefined;
    repository.state.HEAD.commit = 'local';
    repository.log.mockResolvedValue([
      {
        hash: 'local',
        message: '[CaseUser] WEEK 01 Solutions',
        parents: ['origin'],
      },
    ]);
    repository.diffBetween.mockResolvedValue([change('two-sum/CaseUser.py')]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const requestUrl = String(input);
        if (requestUrl.includes('/repos/CaseUser/leetcode-study')) {
          return githubResponse({
            fork: true,
            source: { full_name: 'DaleStudy/leetcode-study' },
          });
        }
        if (requestUrl.includes('/compare/')) {
          return githubResponse({
            ahead_by: 0,
            behind_by: 0,
            files: [],
            commits: [],
          });
        }
        if (requestUrl.includes('/git/trees/main')) {
          return githubResponse({ truncated: false, tree: [] });
        }
        return githubResponse([]);
      }),
    );
    const service = new GitStatusService();

    await service.push(uri('file:///study') as never, [
      {
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      },
    ]);

    expect(repository.fetch).toHaveBeenCalledWith({ remote: 'origin', prune: true });
    expect(repository.fetch).toHaveBeenCalledWith({
      remote: 'upstream',
      ref: 'main',
      prune: true,
    });
    expect(repository.log).toHaveBeenCalledWith(
      expect.objectContaining({
        range: 'local..HEAD',
      }),
    );
    expect(repository.push).toHaveBeenCalledWith('origin', 'week-01', true);
    // 최종 fetch와 status는 실제 push보다 앞서 완료되어야 합니다.
    expect(repository.fetch.mock.invocationCallOrder.at(-1)).toBeLessThan(
      repository.push.mock.invocationCallOrder[0]!,
    );
    expect(repository.status.mock.invocationCallOrder.at(-2)).toBeLessThan(
      repository.push.mock.invocationCallOrder[0]!,
    );

    service.dispose();
  });

  it('blocks push when GitHub Compare reaches its file limit', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'week-01';
    repository.state.HEAD.upstream = undefined;
    repository.state.HEAD.commit = 'local';
    repository.log.mockResolvedValue([
      {
        hash: 'local',
        message: '[CaseUser] WEEK 01 Solutions',
        parents: ['origin'],
      },
    ]);
    repository.diffBetween.mockResolvedValue([change('two-sum/CaseUser.py')]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const requestUrl = String(input);
        if (requestUrl.includes('/repos/CaseUser/leetcode-study')) {
          return githubResponse({
            fork: true,
            source: { full_name: 'DaleStudy/leetcode-study' },
          });
        }
        if (requestUrl.includes('/git/trees/main')) {
          return githubResponse({ truncated: false, tree: [] });
        }
        if (requestUrl.includes(':week-01')) {
          return githubResponse({
            ahead_by: 1,
            behind_by: 0,
            total_commits: 1,
            files: Array.from({ length: 300 }, (_, index) => ({
              filename: `problem-${index}/CaseUser.py`,
              status: 'added',
            })),
            commits: [{ sha: 'remote', commit: {}, parents: [{ sha: 'origin' }] }],
          });
        }
        if (requestUrl.includes('/compare/')) {
          return githubResponse({ ahead_by: 0, behind_by: 0, files: [], commits: [] });
        }
        return githubResponse([]);
      }),
    );
    const service = new GitStatusService();

    await expect(
      service.push(uri('file:///study') as never, [
        {
          name: 'CaseUser.py',
          uri: 'file:///study/two-sum/CaseUser.py',
          slug: 'two-sum',
          week: 1,
        },
      ]),
    ).rejects.toThrow('GitHub 조회 한도');

    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('rejects a first push whose canonical range includes another week', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'week-01';
    repository.state.HEAD.upstream = undefined;
    repository.state.HEAD.commit = 'local';
    repository.log.mockResolvedValue([
      {
        hash: 'week-eight',
        message: '[CaseUser] WEEK 08 Solutions',
        parents: ['origin'],
      },
      {
        hash: 'local',
        message: '[CaseUser] WEEK 01 Solutions',
        parents: ['week-eight'],
      },
    ]);
    repository.diffBetween.mockImplementation(async (_ref1?: string, ref2?: string) =>
      ref2 === 'week-eight'
        ? [change('linked-list-cycle/CaseUser.py')]
        : [change('two-sum/CaseUser.py')],
    );
    const service = new GitStatusService();

    await expect(
      service.push(uri('file:///study') as never, [
        {
          name: 'CaseUser.py',
          uri: 'file:///study/two-sum/CaseUser.py',
          slug: 'two-sum',
          week: 1,
        },
        {
          name: 'CaseUser.py',
          uri: 'file:///study/linked-list-cycle/CaseUser.py',
          slug: 'linked-list-cycle',
          week: 8,
        },
      ]),
    ).rejects.toThrow('서로 다른 주차');

    expect(repository.log).toHaveBeenCalledWith(
      expect.objectContaining({
        range: 'local..HEAD',
      }),
    );
    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('rejects a first push whose canonical range includes a merge commit', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'week-01';
    repository.state.HEAD.upstream = undefined;
    repository.state.HEAD.commit = 'local';
    repository.log.mockResolvedValue([
      {
        hash: 'mergeabc',
        message: 'Merge origin/main',
        parents: ['origin', 'personal'],
      },
    ]);
    const service = new GitStatusService();

    await expect(
      service.push(uri('file:///study') as never, [
        {
          name: 'CaseUser.py',
          uri: 'file:///study/two-sum/CaseUser.py',
          slug: 'two-sum',
          week: 1,
        },
      ]),
    ).rejects.toThrow('공식 main이 아닌 merge 히스토리');

    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('blocks a push whose live commit range spans multiple weeks', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'week-01';
    repository.state.HEAD.upstream = undefined;
    repository.state.HEAD.commit = 'local';
    repository.log.mockResolvedValue([
      {
        hash: 'local',
        message: '[CaseUser] mixed solutions',
        parents: ['origin'],
      },
    ]);
    repository.diffBetween.mockResolvedValue([
      change('two-sum/CaseUser.py'),
      change('three-sum/CaseUser.py'),
    ]);
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

    await expect(
      service.push(uri('file:///study') as never, [
        {
          name: 'CaseUser.py',
          uri: 'file:///study/two-sum/CaseUser.py',
          slug: 'two-sum',
          week: 1,
        },
        {
          name: 'CaseUser.py',
          uri: 'file:///study/three-sum/CaseUser.py',
          slug: 'three-sum',
          week: 2,
        },
      ]),
    ).rejects.toThrow('서로 다른 주차');

    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('pushes subsequent commits to an existing remote week branch without force', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'week-01';
    repository.state.HEAD.commit = 'local-tip';
    repository.state.HEAD.upstream = {
      remote: 'origin',
      name: 'week-01',
      commit: 'remote-tip',
    };
    repository.state.refs.push(
      { name: 'week-01', commit: 'local-tip', remote: undefined },
      { name: 'origin/week-01', commit: 'remote-tip', remote: 'origin' },
    );
    repository.getMergeBase.mockImplementation(async (_ref1: string, ref2: string) =>
      ref2 === 'origin/week-01' ? 'remote-tip' : 'origin',
    );
    repository.log.mockResolvedValue([
      {
        hash: 'local-tip',
        message: '[CaseUser] WEEK 01 Solutions',
        parents: ['remote-tip'],
      },
    ]);
    repository.diffBetween.mockResolvedValue([change('two-sum/CaseUser.py')]);
    const service = new GitStatusService();

    await service.push(uri('file:///study') as never, [
      {
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      },
    ]);

    expect(repository.log).toHaveBeenCalledWith(
      expect.objectContaining({
        range: 'remote-tip..HEAD',
      }),
    );
    expect(repository.push).toHaveBeenCalledWith('origin', 'week-01', false);
    service.dispose();
  });

  it.each([
    ['HEAD', 'push 직전에 브랜치 또는 HEAD가 변경'],
    ['remote', 'push 직전에 origin/week-01 상태가 변경'],
    ['origin', 'origin URL이 변경'],
  ])('aborts push when %s changes during the final fetch', async (changed, message) => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'week-01';
    repository.state.HEAD.commit = 'local-tip';
    repository.state.HEAD.upstream = undefined;
    repository.log.mockResolvedValue([
      {
        hash: 'local-tip',
        message: '[CaseUser] WEEK 01 Solutions',
        parents: ['origin'],
      },
    ]);
    repository.diffBetween.mockResolvedValue([change('two-sum/CaseUser.py')]);
    let originFetches = 0;
    repository.fetch.mockImplementation(async (options?: { remote?: string }) => {
      if (options?.remote === 'origin') {
        originFetches += 1;
        if (originFetches === 2) {
          if (changed === 'HEAD') repository.state.HEAD.commit = 'changed-externally';
          if (changed === 'remote')
            repository.state.refs.push({
              name: 'origin/week-01',
              commit: 'external',
              remote: 'origin',
            });
          if (changed === 'origin')
            repository.state.remotes[0]!.pushUrl = 'git@github.com:CaseUser/leetcode-study.git';
        }
      }
    });
    const service = new GitStatusService();

    await expect(
      service.push(uri('file:///study') as never, [
        {
          name: 'CaseUser.py',
          uri: 'file:///study/two-sum/CaseUser.py',
          slug: 'two-sum',
          week: 1,
        },
      ]),
    ).rejects.toThrow(message);

    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('aborts a mutation when origin changes during fork verification', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'week-01';
    repository.state.HEAD.commit = 'local-tip';
    repository.state.indexChanges = [change('two-sum/CaseUser.py')];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        repository.state.remotes[0]!.pushUrl = 'git@github.com:CaseUser/leetcode-study.git';
        return githubResponse({
          fork: true,
          source: { full_name: 'DaleStudy/leetcode-study' },
        });
      }),
    );
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
    ).rejects.toThrow('origin URL이 변경');

    expect(repository.commit).not.toHaveBeenCalled();
    service.dispose();
  });
});
