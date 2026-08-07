import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  repository: undefined as Record<string, unknown> | undefined,
  textDocuments: [] as Array<{
    uri: { toString(): string };
    isDirty: boolean;
    save(): Promise<boolean>;
  }>,
}));

function event(): (listener: (value: unknown) => void) => { dispose(): void } {
  return () => ({ dispose(): void {} });
}

function uri(value: string): {
  scheme: string;
  authority: string;
  path: string;
  fsPath: string;
  toString(): string;
} {
  const parsed = new URL(value);
  return {
    scheme: parsed.protocol.slice(0, -1),
    authority: parsed.host,
    path: parsed.pathname,
    fsPath: decodeURIComponent(parsed.pathname),
    toString: () => value,
  };
}

vi.mock('vscode', () => ({
  EventEmitter: class<T> {
    readonly event = () => ({ dispose(): void {} });
    fire(value: T): void { void value; }
    dispose(): void {}
  },
  Uri: {
    parse: (value: string) => {
      const parsed = new URL(value);
      return {
        scheme: parsed.protocol.slice(0, -1),
        authority: parsed.host,
        path: parsed.pathname,
        fsPath: decodeURIComponent(parsed.pathname),
        toString: () => value,
      };
    },
    file: (value: string) => ({
      scheme: 'file',
      authority: '',
      path: value,
      fsPath: value,
      toString: () => `file://${value}`,
    }),
  },
  env: {
    openExternal: vi.fn(async () => true),
  },
  extensions: {
    getExtension: () => ({
      isActive: true,
      exports: {
        enabled: true,
        getAPI: () => ({
          repositories: harness.repository ? [harness.repository] : [],
          getRepository: () => harness.repository,
          onDidChangeState: () => ({ dispose(): void {} }),
          onDidOpenRepository: () => ({ dispose(): void {} }),
          onDidCloseRepository: () => ({ dispose(): void {} }),
        }),
      },
    }),
  },
  workspace: {
    textDocuments: harness.textDocuments,
  },
}));

import { GitStatusService } from '../../src/gitStatusService.js';

function change(relativePath: string) {
  const resource = uri(`file:///study/${relativePath}`);
  return {
    uri: resource,
    originalUri: resource,
    renameUri: undefined,
  };
}

function createRepository() {
  const state = {
    HEAD: {
      name: 'main',
      commit: 'origin',
      upstream: {
        remote: 'origin',
        name: 'main',
        commit: 'origin',
      } as { remote: string; name: string; commit: string } | undefined,
      ahead: 0,
      behind: 0,
    },
    remotes: [{
      name: 'origin',
      fetchUrl: 'https://github.com/CaseUser/leetcode-study.git',
      pushUrl: undefined as string | undefined,
    }, {
      name: 'upstream',
      fetchUrl: 'https://github.com/DaleStudy/leetcode-study.git',
      pushUrl: undefined as string | undefined,
    }],
    rebaseCommit: undefined,
    mergeChanges: [] as ReturnType<typeof change>[],
    indexChanges: [] as ReturnType<typeof change>[],
    workingTreeChanges: [] as ReturnType<typeof change>[],
    untrackedChanges: [] as ReturnType<typeof change>[],
    onDidChange: event(),
  };
  return {
    rootUri: uri('file:///study'),
    state,
    getCommit: vi.fn(async (ref: string) => ({
      hash: ref === 'HEAD'
        ? state.HEAD.commit
        : ref === 'origin/main' ? 'origin' : ref === 'upstream/main' ? 'upstream' : ref,
      message: ref,
      parents: ['origin'],
    })),
    getMergeBase: vi.fn(async (_ref1: string, ref2: string) =>
      ref2 === 'upstream/main' ? state.HEAD.commit : 'origin'
    ),
    diffBetween: vi.fn(
      async (): Promise<ReturnType<typeof change>[]> => [],
    ),
    log: vi.fn(
      async (): Promise<Array<{ hash: string; message: string; parents: string[] }>> => [],
    ),
    add: vi.fn(async () => {}),
    revert: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    fetch: vi.fn(async () => {}),
    push: vi.fn(async () => {}),
    merge: vi.fn(async (ref: string) => { void ref; }),
    mergeAbort: vi.fn(async () => {
      state.mergeChanges = [];
    }),
    addRemote: vi.fn(async () => {}),
    setBranchUpstream: vi.fn(async () => {}),
    status: vi.fn(async () => {}),
  };
}

function githubResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  harness.repository = createRepository();
  harness.textDocuments.splice(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GitStatusService submission actions', () => {
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
    );
    await service.unstageSolution(
      uri('file:///study') as never,
      uri('file:///study/two-sum/CaseUser.py') as never,
    );

    expect(save).toHaveBeenCalledOnce();
    expect(repository.add).toHaveBeenCalledWith(['/study/two-sum/CaseUser.py']);
    expect(repository.revert).toHaveBeenCalledWith(['/study/two-sum/CaseUser.py']);
    expect(repository.status).toHaveBeenCalledTimes(2);
    service.dispose();
  });

  it('commits only when the live index exactly matches the expected solutions', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    const solution = change('two-sum/CaseUser.py');
    repository.state.indexChanges = [solution];
    vi.stubGlobal('fetch', vi.fn(async () => githubResponse({
      fork: true,
      source: { full_name: 'DaleStudy/leetcode-study' },
    })));
    const service = new GitStatusService();
    const expected = [{
      name: 'CaseUser.py',
      uri: 'file:///study/two-sum/CaseUser.py',
      relativePath: 'two-sum/CaseUser.py',
      slug: 'two-sum',
      week: 1,
    }];

    await service.commit(
      uri('file:///study') as never,
      '[CaseUser] WEEK 01 Solutions',
      expected,
    );
    repository.state.indexChanges = [
      solution,
      change('notes/private.md'),
    ];

    await expect(service.commit(
      uri('file:///study') as never,
      '[CaseUser] WEEK 01 Solutions',
      expected,
    )).rejects.toThrow('스테이징 상태가 변경');

    expect(repository.commit).toHaveBeenCalledOnce();
    service.dispose();
  });

  it('rechecks the current branch before committing a cached submission', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'feature/stale-view';
    repository.state.indexChanges = [change('two-sum/CaseUser.py')];
    const service = new GitStatusService();

    await expect(service.commit(
      uri('file:///study') as never,
      '[CaseUser] WEEK 01 Solutions',
      [{
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        relativePath: 'two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      }],
    )).rejects.toThrow('main 브랜치');

    expect(repository.commit).not.toHaveBeenCalled();
    service.dispose();
  });

  it('blocks push when an unpushed commit contains a non-solution file', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.commit = 'local';
    repository.log.mockResolvedValue([{
      hash: 'local',
      message: '[CaseUser] WEEK 01 Solutions',
      parents: ['origin'],
    }]);
    repository.diffBetween.mockResolvedValue([change('notes/private.md')]);
    vi.stubGlobal('fetch', vi.fn(async () => githubResponse({
      fork: true,
      source: { full_name: 'DaleStudy/leetcode-study' },
    })));
    const service = new GitStatusService();

    await expect(service.push(
      uri('file:///study') as never,
      [{
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      }],
    )).rejects.toThrow('풀이 외 파일이 포함된 커밋');

    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('pushes a single-week solution commit after refreshing origin and GitHub state', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.commit = 'local';
    repository.log.mockResolvedValue([{
      hash: 'local',
      message: '[CaseUser] WEEK 01 Solutions',
      parents: ['origin'],
    }]);
    repository.diffBetween.mockResolvedValue([change('two-sum/CaseUser.py')]);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
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
    }));
    const service = new GitStatusService();

    await service.push(
      uri('file:///study') as never,
      [{
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      }],
    );

    expect(repository.fetch).toHaveBeenCalledWith({
      remote: 'origin',
      ref: 'main',
      prune: true,
    });
    expect(repository.push).toHaveBeenCalledWith('origin', 'main', false);
    service.dispose();
  });

  it('blocks a push whose live commit range spans multiple weeks', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.commit = 'local';
    repository.log.mockResolvedValue([{
      hash: 'local',
      message: '[CaseUser] mixed solutions',
      parents: ['origin'],
    }]);
    repository.diffBetween.mockResolvedValue([
      change('two-sum/CaseUser.py'),
      change('three-sum/CaseUser.py'),
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => githubResponse({
      fork: true,
      source: { full_name: 'DaleStudy/leetcode-study' },
    })));
    const service = new GitStatusService();

    await expect(service.push(
      uri('file:///study') as never,
      [{
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      }, {
        name: 'CaseUser.py',
        uri: 'file:///study/three-sum/CaseUser.py',
        slug: 'three-sum',
        week: 2,
      }],
    )).rejects.toThrow('서로 다른 주차');

    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('rejects an origin whose fetch and push URLs target different repositories', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.remotes[0]!.pushUrl =
      'https://github.com/OtherUser/leetcode-study.git';
    const service = new GitStatusService();

    await expect(service.syncFork(uri('file:///study') as never))
      .rejects.toThrow('fetch/push URL이 동일한 GitHub 저장소');

    expect(repository.fetch).not.toHaveBeenCalled();
    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('merges upstream and pushes main when the fork is clean', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    vi.stubGlobal('fetch', vi.fn(async () => githubResponse({
      fork: true,
      source: { full_name: 'DaleStudy/leetcode-study' },
    })));
    const service = new GitStatusService();

    await service.syncFork(uri('file:///study') as never);

    expect(repository.fetch).toHaveBeenNthCalledWith(
      1,
      { remote: 'origin', ref: 'main', prune: true },
    );
    expect(repository.fetch).toHaveBeenNthCalledWith(
      2,
      { remote: 'upstream', ref: 'main', prune: true },
    );
    expect(repository.merge).toHaveBeenCalledWith('upstream/main');
    expect(repository.push).toHaveBeenCalledWith('origin', 'main', false);
    service.dispose();
  });

  it('blocks fork sync when main has commits ahead of origin without an upstream', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.upstream = undefined;
    repository.state.HEAD.commit = 'local';
    repository.state.remotes = repository.state.remotes.filter(
      ({ name }) => name !== 'upstream',
    );
    vi.stubGlobal('fetch', vi.fn(async () => githubResponse({
      fork: true,
      source: { full_name: 'DaleStudy/leetcode-study' },
    })));
    const service = new GitStatusService();

    await expect(service.syncFork(uri('file:///study') as never))
      .rejects.toThrow('push하지 않은 로컬 커밋');

    expect(repository.addRemote).not.toHaveBeenCalled();
    expect(repository.merge).not.toHaveBeenCalled();
    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('disables canSync when main is ahead of origin without upstream', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.upstream = undefined;
    repository.state.HEAD.commit = 'local';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
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
    }));
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
    vi.stubGlobal('fetch', vi.fn(async () => githubResponse({
      fork: true,
      source: { full_name: 'DaleStudy/leetcode-study' },
    })));
    const service = new GitStatusService();

    await expect(service.syncFork(uri('file:///study') as never))
      .rejects.toThrow('origin merge conflict');

    expect(repository.merge).toHaveBeenCalledWith('origin/main');
    expect(repository.mergeAbort).toHaveBeenCalledOnce();
    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('aborts an upstream merge when it creates conflicts', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.merge.mockImplementation(async (ref: string) => {
      if (ref === 'upstream/main') {
        repository.state.mergeChanges = [change('two-sum/CaseUser.py')];
        throw new Error('merge conflict');
      }
    });
    vi.stubGlobal('fetch', vi.fn(async () => githubResponse({
      fork: true,
      parent: { full_name: 'DaleStudy/leetcode-study' },
    })));
    const service = new GitStatusService();

    await expect(service.syncFork(uri('file:///study') as never))
      .rejects.toThrow('merge conflict');

    expect(repository.mergeAbort).toHaveBeenCalledOnce();
    expect(repository.push).not.toHaveBeenCalled();
    expect(repository.state.mergeChanges).toEqual([]);
    service.dispose();
  });

  it('blocks a mixed-week submission and maps files in the open PR', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.indexChanges = [change('three-sum/CaseUser.py')];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
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
      return githubResponse([{
        number: 77,
        title: '[CaseUser] WEEK 01 Solutions',
        html_url: 'https://github.com/DaleStudy/leetcode-study/pull/77',
      }]);
    }));
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
    expect(result.submission?.blockedReason).toContain('여러 주차');
    expect(result.submissionStatuses?.get(twoSumUri)).toBe('pr-open');
    expect(result.pullRequestNumbers?.get(twoSumUri)).toBe(77);
    expect(result.submissionStatuses?.get(threeSumUri)).toBe('staged');
    service.dispose();
  });

  it('requires synchronization before declaring a stale fork file merged', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
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
    }));
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
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
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
          tree: [{ path: 'two-sum/CaseUser.py', type: 'blob' }],
        });
      }
      return githubResponse([]);
    }));
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

  it('keeps a canonical solution merged while its fork is behind', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
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
          tree: [{ path: 'two-sum/CaseUser.py', type: 'blob' }],
        });
      }
      return githubResponse([]);
    }));
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
    const mergedPaths = Array.from(
      { length: 25 },
      (_, index) => `merged-${index + 1}/CaseUser.py`,
    );
    const pullRequestPaths = Array.from(
      { length: 5 },
      (_, index) => `pending-${index + 1}/CaseUser.py`,
    );
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
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
        return githubResponse([{
          number: 2777,
          title: '[CaseUser] WEEK 06 Solutions',
          html_url: 'https://github.com/DaleStudy/leetcode-study/pull/2777',
        }]);
      }
      if (requestUrl.includes('/git/trees/main')) {
        return githubResponse({
          truncated: false,
          tree: mergedPaths.map((entryPath) => ({ path: entryPath, type: 'blob' })),
        });
      }
      return githubResponse([]);
    }));
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
      vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
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
          return githubResponse([{
            number: 77,
            title: '[CaseUser] WEEK 01 Solutions',
            html_url: 'https://github.com/DaleStudy/leetcode-study/pull/77',
          }]);
        }
        if (requestUrl.includes('/git/trees/main')) {
          return treeState === 'failure'
            ? { ok: false, status: 500, json: async () => ({}) } as Response
            : githubResponse({ truncated: true, tree: [] });
        }
        return githubResponse([]);
      }));
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
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
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
          tree: [{ path: 'two-sum/CaseUser.py', type: 'blob' }],
        });
      }
      return githubResponse([]);
    }));
    const service = new GitStatusService();
    const solutionUri = 'file:///study/two-sum/CaseUser.py';
    const solutions = [{
      name: 'CaseUser.py',
      uri: solutionUri,
      slug: 'two-sum',
      week: 1,
    }];

    await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      solutions,
      false,
    );
    await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      solutions,
      false,
    );
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
