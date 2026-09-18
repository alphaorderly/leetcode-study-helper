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

describe('GitStatusService status SyncPermissions', () => {
  it('disables canSync when main is ahead of origin without upstream', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.upstream = undefined;
    repository.state.HEAD.commit = 'local';
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
          return githubResponse({
            truncated: false,
            tree: [],
          });
        }
        return githubResponse([]);
      }),
    );
    const service = new GitStatusService();
    const solutionUri = 'file:///study/two-sum/CaseUser.py';

    const result = await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      [{ name: 'CaseUser.py', uri: solutionUri, slug: 'two-sum', week: 1 }],
      true,
    );

    expect(result.submission?.canSync).toBe(false);
    expect(result.submission?.syncDisabledReason).toBe(
      'origin에 push하지 않은 로컬 커밋을 먼저 처리해 주세요.',
    );
    service.dispose();
  });

  it('keeps canSync enabled when origin/main cannot be compared', async () => {
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
          return githubResponse({
            truncated: false,
            tree: [],
          });
        }
        return githubResponse([]);
      }),
    );
    const service = new GitStatusService();
    const solutionUri = 'file:///study/two-sum/CaseUser.py';

    const result = await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      [{ name: 'CaseUser.py', uri: solutionUri, slug: 'two-sum', week: 1 }],
      true,
    );

    expect(result.submission?.canSync).toBe(true);
    expect(result.submission?.syncDisabledReason).toBeUndefined();
    service.dispose();
  });

  it('keeps canSync enabled when only untracked files exist on main', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.untrackedChanges = [change('linked-list-cycle/CaseUser.py')];
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
          return githubResponse({
            truncated: false,
            tree: [],
          });
        }
        return githubResponse([]);
      }),
    );
    const service = new GitStatusService();
    const solutionUri = 'file:///study/two-sum/CaseUser.py';

    const result = await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      [{ name: 'CaseUser.py', uri: solutionUri, slug: 'two-sum', week: 1 }],
      true,
    );

    expect(result.submission?.canSync).toBe(true);
    expect(result.submission?.hasCanonicalRemote).toBe(true);
    expect(result.submission?.behindOfficialMain).toBe(false);
    expect(result.submission?.syncDisabledReason).toBeUndefined();
    service.dispose();
  });

  it('keeps canSync enabled when only solution working-tree files are modified', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.workingTreeChanges = [change('two-sum/CaseUser.py')];
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
          return githubResponse({
            truncated: false,
            tree: [],
          });
        }
        return githubResponse([]);
      }),
    );
    const service = new GitStatusService();
    const solutionUri = 'file:///study/two-sum/CaseUser.py';

    const result = await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      [{ name: 'CaseUser.py', uri: solutionUri, slug: 'two-sum', week: 1 }],
      true,
    );

    expect(result.submission?.canSync).toBe(true);
    expect(result.submission?.blockingTrackedFiles).toEqual([
      {
        relativePath: 'two-sum/CaseUser.py',
        kind: 'solution',
        state: 'modified',
      },
    ]);
    expect(result.submission?.syncDisabledReason).toBeUndefined();
    service.dispose();
  });

  it('disables canSync when non-solution tracked files are modified', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.workingTreeChanges = [change('README.md')];
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
          return githubResponse({
            truncated: false,
            tree: [],
          });
        }
        return githubResponse([]);
      }),
    );
    const service = new GitStatusService();
    const solutionUri = 'file:///study/two-sum/CaseUser.py';

    const result = await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      [{ name: 'CaseUser.py', uri: solutionUri, slug: 'two-sum', week: 1 }],
      true,
    );

    expect(result.submission?.canSync).toBe(false);
    expect(result.submission?.blockingTrackedFiles).toEqual([
      {
        relativePath: 'README.md',
        kind: 'other',
        state: 'modified',
      },
    ]);
    expect(result.submission?.syncDisabledReason).toBe(
      '풀이 외 추적 파일 변경을 되돌린 뒤 포크를 동기화해 주세요.',
    );
    service.dispose();
  });

  it('reports a missing canonical remote without adding it during status', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.remotes = repository.state.remotes.filter(({ name }) => name !== 'upstream');
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
          return githubResponse({ ahead_by: 0, behind_by: 0, files: [], commits: [] });
        }
        if (requestUrl.includes('/git/trees/main')) {
          return githubResponse({ truncated: false, tree: [] });
        }
        return githubResponse([]);
      }),
    );
    const service = new GitStatusService();
    const solutionUri = 'file:///study/two-sum/CaseUser.py';

    const result = await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      [{ name: 'CaseUser.py', uri: solutionUri, slug: 'two-sum', week: 1 }],
      true,
    );

    expect(result.submission?.hasCanonicalRemote).toBe(false);
    expect(repository.addRemote).not.toHaveBeenCalled();
    service.dispose();
  });

  it('marks the fork behind official main from the GitHub compare', async () => {
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
        if (requestUrl.includes('/compare/main...CaseUser:main')) {
          return githubResponse({ ahead_by: 0, behind_by: 4, files: [], commits: [] });
        }
        if (requestUrl.includes('/compare/')) {
          return githubResponse({ ahead_by: 0, behind_by: 0, files: [], commits: [] });
        }
        if (requestUrl.includes('/git/trees/main')) {
          return githubResponse({ truncated: false, tree: [] });
        }
        return githubResponse([]);
      }),
    );
    const service = new GitStatusService();
    const solutionUri = 'file:///study/two-sum/CaseUser.py';

    const result = await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      [{ name: 'CaseUser.py', uri: solutionUri, slug: 'two-sum', week: 1 }],
      true,
    );

    expect(result.submission?.behindOfficialMain).toBe(true);
    service.dispose();
  });
});
