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

describe('GitStatusService staging', () => {
  it('saves and stages a solution, then unstages only the index entry', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    const save = vi.fn(async () => true);
    harness.textDocuments.push({
      uri: uri('file:///study/two-sum/CaseUser.py'),
      isDirty: true,
      save,
    });
    const service = new GitStatusService();

    await service.stageSolution(
      uri('file:///study') as never,
      uri('file:///study/two-sum/CaseUser.py') as never,
      1,
      [
        {
          name: 'CaseUser.py',
          uri: 'file:///study/two-sum/CaseUser.py',
          slug: 'two-sum',
          week: 1,
        },
      ],
    );
    await service.unstageSolution(
      uri('file:///study') as never,
      uri('file:///study/two-sum/CaseUser.py') as never,
    );

    expect(save).toHaveBeenCalledOnce();
    expect(repository.add).toHaveBeenCalledWith(['/study/two-sum/CaseUser.py']);
    expect(repository.revert).toHaveBeenCalledWith(['/study/two-sum/CaseUser.py']);
    expect(repository.status).toHaveBeenCalledTimes(5);
    service.dispose();
  });

  it('does not stage the first solution while main is ahead of origin', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.commit = 'local-main';
    const service = new GitStatusService();

    await expect(
      service.stageSolution(
        uri('file:///study') as never,
        uri('file:///study/two-sum/CaseUser.py') as never,
        1,
        [
          {
            name: 'CaseUser.py',
            uri: 'file:///study/two-sum/CaseUser.py',
            slug: 'two-sum',
            week: 1,
          },
        ],
      ),
    ).rejects.toThrow('origin에 push하지 않은 로컬 커밋');

    expect(repository.add).not.toHaveBeenCalled();
    expect(repository.merge).not.toHaveBeenCalled();
    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('adds a missing canonical remote before staging the first solution', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.remotes = repository.state.remotes.filter(({ name }) => name !== 'upstream');
    repository.state.refs = repository.state.refs.filter(({ name }) => name !== 'upstream/main');
    const service = new GitStatusService();

    await service.stageSolution(
      uri('file:///study') as never,
      uri('file:///study/two-sum/CaseUser.py') as never,
      1,
      [
        {
          name: 'CaseUser.py',
          uri: 'file:///study/two-sum/CaseUser.py',
          slug: 'two-sum',
          week: 1,
        },
      ],
    );

    expect(repository.addRemote).toHaveBeenCalledWith(
      'upstream',
      'https://github.com/DaleStudy/leetcode-study.git',
    );
    expect(repository.add).toHaveBeenCalledWith(['/study/two-sum/CaseUser.py']);
    service.dispose();
  });

  it('synchronizes a clean main before staging when official main is ahead', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.refs.find(({ name }) => name === 'upstream/main')!.commit = 'newer';
    repository.getMergeBase.mockImplementation(async (_ref1: string, ref2: string) => {
      if (ref2 === 'upstream/main' || ref2 === 'origin/main') {
        return 'origin';
      }
      return 'origin';
    });
    const service = new GitStatusService();

    await service.stageSolution(
      uri('file:///study') as never,
      uri('file:///study/two-sum/CaseUser.py') as never,
      1,
      [
        {
          name: 'CaseUser.py',
          uri: 'file:///study/two-sum/CaseUser.py',
          slug: 'two-sum',
          week: 1,
        },
      ],
    );

    expect(repository.merge).toHaveBeenCalledWith('upstream/main');
    expect(repository.push).toHaveBeenCalledWith('origin', 'main', false);
    expect(repository.add).toHaveBeenCalledWith(['/study/two-sum/CaseUser.py']);
    service.dispose();
  });

  it('does not auto-sync a dirty main when non-solution files are modified', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.workingTreeChanges = [change('README.md')];
    repository.state.refs.find(({ name }) => name === 'upstream/main')!.commit = 'newer';
    repository.getMergeBase.mockImplementation(async (_ref1: string, ref2: string) => {
      if (ref2 === 'upstream/main' || ref2 === 'origin/main') {
        return 'origin';
      }
      return 'origin';
    });
    const service = new GitStatusService();

    await expect(
      service.stageSolution(
        uri('file:///study') as never,
        uri('file:///study/two-sum/CaseUser.py') as never,
        1,
        [
          {
            name: 'CaseUser.py',
            uri: 'file:///study/two-sum/CaseUser.py',
            slug: 'two-sum',
            week: 1,
          },
        ],
      ),
    ).rejects.toThrow('풀이 외 추적 파일 변경을 정리한 뒤 포크를 동기화');

    expect(repository.add).not.toHaveBeenCalled();
    expect(repository.merge).not.toHaveBeenCalled();
    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('blocks a new week while another remote week branch is not merged', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.refs.push({ name: 'origin/week-01', commit: 'week-one', remote: 'origin' });
    repository.diffBetween.mockImplementation(async (ref1?: string, ref2?: string) =>
      ref1 === 'origin' && ref2 === 'origin/week-01' ? [change('two-sum/CaseUser.py')] : [],
    );
    const service = new GitStatusService();

    await expect(
      service.stageSolution(
        uri('file:///study') as never,
        uri('file:///study/three-sum/CaseUser.py') as never,
        2,
        [
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
        ],
      ),
    ).rejects.toThrow('week-01 제출이 공식 저장소에 반영되기 전');

    expect(repository.add).not.toHaveBeenCalled();
    service.dispose();
  });

  it('allows a new week when the prior branch paths exist on canonical main', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.refs.push({ name: 'origin/week-01', commit: 'week-one', remote: 'origin' });
    repository.diffBetween.mockImplementation(async (ref1?: string, ref2?: string) =>
      ref1 === 'origin' && ref2 === 'origin/week-01' ? [change('two-sum/CaseUser.py')] : [],
    );
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
          return githubResponse({
            truncated: false,
            tree: [
              {
                path: 'two-sum/CaseUser.py',
                type: 'blob',
                sha: 'e99d9f2f8b3116e6052ed78007ff65b2710b6065',
              },
            ],
          });
        }
        if (requestUrl.includes('/compare/')) {
          return githubResponse({ ahead_by: 0, behind_by: 0, files: [], commits: [] });
        }
        return githubResponse([]);
      }),
    );
    const service = new GitStatusService();

    await service.stageSolution(
      uri('file:///study') as never,
      uri('file:///study/three-sum/CaseUser.py') as never,
      2,
      [
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
      ],
    );

    expect(repository.add).toHaveBeenCalledWith(['/study/three-sum/CaseUser.py']);
    service.dispose();
  });

  it('allows staging a new week when main is ahead of upstream', async () => {
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
            ahead_by: 1,
            behind_by: 0,
            files: [],
            commits: [],
          });
        }
        if (requestUrl.includes('/git/trees/main')) {
          return githubResponse({
            truncated: false,
            tree: [],
          });
        }
        return githubResponse([]);
      }),
    );
    const service = new GitStatusService();

    await service.stageSolution(
      uri('file:///study') as never,
      uri('file:///study/two-sum/CaseUser.py') as never,
      1,
      [
        {
          name: 'CaseUser.py',
          uri: 'file:///study/two-sum/CaseUser.py',
          slug: 'two-sum',
          week: 1,
        },
      ],
    );

    expect(repository.add).toHaveBeenCalledWith(['/study/two-sum/CaseUser.py']);
    service.dispose();
  });
});
