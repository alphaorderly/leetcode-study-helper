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

describe('GitStatusService status RemoteFiles', () => {
  it('blocks a mixed-week submission and maps files in the open PR', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.indexChanges = [change('three-sum/CaseUser.py')];
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
            files: [{ filename: 'two-sum/CaseUser.py', status: 'added' }],
            commits: [],
          });
        }
        if (requestUrl.includes('/pulls/77/files')) {
          return githubResponse([{ filename: 'two-sum/CaseUser.py' }]);
        }
        return githubResponse([
          {
            number: 77,
            title: '[CaseUser] WEEK 01 Solutions',
            html_url: 'https://github.com/DaleStudy/leetcode-study/pull/77',
          },
        ]);
      }),
    );
    const service = new GitStatusService();
    const twoSumUri = 'file:///study/two-sum/CaseUser.py';
    const threeSumUri = 'file:///study/three-sum/CaseUser.py';

    const result = await service.getStatuses(
      uri('file:///study') as never,
      [twoSumUri, threeSumUri],
      true,
      [
        { name: 'CaseUser.py', uri: twoSumUri, slug: 'two-sum', week: 1 },
        { name: 'CaseUser.py', uri: threeSumUri, slug: 'three-sum', week: 2 },
      ],
      true,
    );

    expect(result.submission?.status).toBe('blocked');
    expect(result.submission?.blockedReason).toContain('다른 주차 PR');
    expect(result.submissionStatuses?.get(twoSumUri)).toBe('pr-open');
    expect(result.pullRequestNumbers?.get(twoSumUri)).toBe(77);
    expect(result.submissionStatuses?.get(threeSumUri)).toBe('staged');
    service.dispose();
  });

  it('requires synchronization before declaring a stale fork file merged', async () => {
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
            behind_by: 3,
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

    expect(result.submissionStatuses?.get(solutionUri)).toBe('sync-needed');
    expect(result.submission?.summary.merged).toBe(0);
    service.dispose();
  });

  it('marks a clean file merged when its path exists on canonical main', async () => {
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
            tree: [
              {
                path: 'two-sum/CaseUser.py',
                type: 'blob',
                sha: 'e99d9f2f8b3116e6052ed78007ff65b2710b6065',
              },
            ],
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

    expect(result.submissionStatuses?.get(solutionUri)).toBe('merged');
    expect(result.submission?.activeSubmissionWeek).toBeUndefined();
    expect(result.submission?.summary.merged).toBe(1);
    service.dispose();
  });

  it('does not mark a same-path solution merged when its Git blob differs', async () => {
    harness.readFile.mockResolvedValueOnce(new TextEncoder().encode('different solution'));
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
            tree: [
              {
                path: 'two-sum/CaseUser.py',
                type: 'blob',
                sha: 'e99d9f2f8b3116e6052ed78007ff65b2710b6065',
              },
            ],
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

    expect(result.submissionStatuses?.get(solutionUri)).toBe('unknown');
    expect(result.submission?.summary.merged).toBe(0);
    service.dispose();
  });

  it('keeps a canonical solution merged while its fork is behind', async () => {
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
            behind_by: 9,
            files: [],
            commits: [],
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

    expect(result.submissionStatuses?.get(solutionUri)).toBe('merged');
    expect(result.submission?.summary.merged).toBe(1);
    expect(result.submission?.summary.prPending).toBe(0);
    service.dispose();
  });

  it('counts 25 canonical solutions separately from 5 files in an open PR', async () => {
    const mergedPaths = Array.from({ length: 25 }, (_, index) => `merged-${index + 1}/CaseUser.py`);
    const pullRequestPaths = Array.from(
      { length: 5 },
      (_, index) => `pending-${index + 1}/CaseUser.py`,
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
        if (requestUrl.includes('/compare/')) {
          return githubResponse({
            ahead_by: 28,
            behind_by: 9,
            files: pullRequestPaths.map((filename) => ({ filename, status: 'added' })),
            commits: [],
          });
        }
        if (requestUrl.includes('/pulls/2777/files')) {
          return githubResponse(pullRequestPaths.map((filename) => ({ filename })));
        }
        if (requestUrl.includes('/pulls?')) {
          return githubResponse([
            {
              number: 2777,
              title: '[CaseUser] WEEK 06 Solutions',
              html_url: 'https://github.com/DaleStudy/leetcode-study/pull/2777',
            },
          ]);
        }
        if (requestUrl.includes('/git/trees/main')) {
          return githubResponse({
            truncated: false,
            tree: mergedPaths.map((entryPath) => ({
              path: entryPath,
              type: 'blob',
              sha: 'e99d9f2f8b3116e6052ed78007ff65b2710b6065',
            })),
          });
        }
        return githubResponse([]);
      }),
    );
    const service = new GitStatusService();
    const solutionPaths = [...mergedPaths, ...pullRequestPaths];
    const solutions = solutionPaths.map((relativePath, index) => ({
      name: 'CaseUser.py',
      uri: `file:///study/${relativePath}`,
      slug: relativePath.split('/')[0] ?? relativePath,
      week: index < mergedPaths.length ? Math.floor(index / 5) + 1 : 6,
    }));

    const result = await service.getStatuses(
      uri('file:///study') as never,
      solutions.map(({ uri: solutionUri }) => solutionUri),
      true,
      solutions,
      true,
    );

    expect(result.submission?.summary).toMatchObject({
      prPending: 5,
      merged: 25,
      unknown: 0,
    });
    for (const relativePath of mergedPaths) {
      expect(result.submissionStatuses?.get(`file:///study/${relativePath}`)).toBe('merged');
    }
    for (const relativePath of pullRequestPaths) {
      const solutionUri = `file:///study/${relativePath}`;
      expect(result.submissionStatuses?.get(solutionUri)).toBe('pr-open');
      expect(result.pullRequestNumbers?.get(solutionUri)).toBe(2777);
    }
    service.dispose();
  });

  it.each(['failure', 'truncated'] as const)(
    'keeps open PR data when the canonical tree is %s',
    async (treeState) => {
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
              files: [{ filename: 'two-sum/CaseUser.py', status: 'added' }],
              commits: [],
            });
          }
          if (requestUrl.includes('/pulls/77/files')) {
            return githubResponse([{ filename: 'two-sum/CaseUser.py' }]);
          }
          if (requestUrl.includes('/pulls?')) {
            return githubResponse([
              {
                number: 77,
                title: '[CaseUser] WEEK 01 Solutions',
                html_url: 'https://github.com/DaleStudy/leetcode-study/pull/77',
              },
            ]);
          }
          if (requestUrl.includes('/git/trees/main')) {
            return treeState === 'failure'
              ? ({ ok: false, status: 500, json: async () => ({}) } as Response)
              : githubResponse({ truncated: true, tree: [] });
          }
          return githubResponse([]);
        }),
      );
      const service = new GitStatusService();
      const pullRequestUri = 'file:///study/two-sum/CaseUser.py';
      const unresolvedUri = 'file:///study/three-sum/CaseUser.py';

      const result = await service.getStatuses(
        uri('file:///study') as never,
        [pullRequestUri, unresolvedUri],
        true,
        [
          { name: 'CaseUser.py', uri: pullRequestUri, slug: 'two-sum', week: 1 },
          { name: 'CaseUser.py', uri: unresolvedUri, slug: 'three-sum', week: 1 },
        ],
        true,
      );

      expect(result.submission?.status).toBe('ready');
      expect(result.submission?.activePullRequest?.number).toBe(77);
      expect(result.submissionStatuses?.get(pullRequestUri)).toBe('pr-open');
      expect(result.submissionStatuses?.get(unresolvedUri)).toBe('unknown');
      expect(result.submission?.summary).toMatchObject({
        prPending: 1,
        merged: 0,
        unknown: 1,
      });
      service.dispose();
    },
  );

  it('caches the canonical tree and refreshes it when forced', async () => {
    let canonicalTreeRequests = 0;
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
          canonicalTreeRequests += 1;
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
        return githubResponse([]);
      }),
    );
    const service = new GitStatusService();
    const solutionUri = 'file:///study/two-sum/CaseUser.py';
    const solutions = [
      {
        name: 'CaseUser.py',
        uri: solutionUri,
        slug: 'two-sum',
        week: 1,
      },
    ];

    await service.getStatuses(uri('file:///study') as never, [solutionUri], true, solutions, false);
    await service.getStatuses(uri('file:///study') as never, [solutionUri], true, solutions, false);
    const refreshed = await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      solutions,
      true,
    );

    expect(canonicalTreeRequests).toBe(2);
    expect(refreshed.submissionStatuses?.get(solutionUri)).toBe('merged');
    service.dispose();
  });
});
