/** Git 저장소와 VS Code·GitHub 모킹을 구성합니다. beforeEach에서 각 시나리오의 상태를 새로 만듭니다. */
import { afterEach, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';

const mockState = vi.hoisted(() => ({
  repository: undefined as Record<string, unknown> | undefined,
  textDocuments: [] as Array<{
    uri: { toString(): string };
    isDirty: boolean;
    save(): Promise<boolean>;
  }>,
  getSession: vi.fn(async (): Promise<{ accessToken: string } | undefined> => undefined),
  readFile: vi.fn(async (): Promise<Uint8Array> => new TextEncoder().encode('solution')),
}));

export const harness = mockState;

function event(): (listener: (value: unknown) => void) => { dispose(): void } {
  return () => ({ dispose(): void {} });
}

export function uri(value: string): {
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
    fire(value: T): void {
      void value;
    }
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
  commands: {
    executeCommand: vi.fn(async () => undefined),
  },
  extensions: {
    getExtension: () => ({
      isActive: true,
      exports: {
        enabled: true,
        getAPI: () => ({
          repositories: mockState.repository ? [mockState.repository] : [],
          getRepository: () => mockState.repository,
          onDidChangeState: () => ({ dispose(): void {} }),
          onDidOpenRepository: () => ({ dispose(): void {} }),
          onDidCloseRepository: () => ({ dispose(): void {} }),
        }),
      },
    }),
  },
  workspace: {
    textDocuments: mockState.textDocuments,
    fs: {
      readFile: mockState.readFile,
    },
  },
  authentication: {
    getSession: mockState.getSession,
    onDidChangeSessions: () => ({ dispose(): void {} }),
  },
}));

export function change(relativePath: string) {
  const resource = uri(`file:///study/${relativePath}`);
  return {
    uri: resource,
    originalUri: resource,
    renameUri: undefined,
  };
}

function gitRefFullName(ref: { name: string; remote?: string }): string {
  return ref.remote ? `refs/remotes/${ref.name}` : `refs/heads/${ref.name}`;
}

function matchesGitRefPattern(ref: { name: string; remote?: string }, pattern: string): boolean {
  const gitPattern = pattern.startsWith('refs/') ? pattern : `refs/${pattern}`;
  const fullName = gitRefFullName(ref);
  return fullName === gitPattern || fullName.startsWith(`${gitPattern}/`);
}

export function createRepository() {
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
    refs: [
      { name: 'main', commit: 'origin' },
      { name: 'origin/main', commit: 'origin', remote: 'origin' },
      { name: 'upstream/main', commit: 'origin', remote: 'upstream' },
    ],
    remotes: [
      {
        name: 'origin',
        fetchUrl: 'https://github.com/CaseUser/leetcode-study.git',
        pushUrl: undefined as string | undefined,
      },
      {
        name: 'upstream',
        fetchUrl: 'https://github.com/DaleStudy/leetcode-study.git',
        pushUrl: undefined as string | undefined,
      },
    ],
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
      hash:
        ref === 'HEAD'
          ? state.HEAD.commit
          : (state.refs.find(({ name }) => name === ref)?.commit ?? ref),
      message: ref,
      parents: ['origin'],
    })),
    getMergeBase: vi.fn(async (_ref1: string, ref2: string) =>
      ref2 === 'upstream/main' ? state.HEAD.commit : 'origin',
    ),
    diffBetween: vi.fn(
      async (_ref1?: string, _ref2?: string): Promise<ReturnType<typeof change>[]> => {
        void _ref1;
        void _ref2;
        return [];
      },
    ),
    log: vi.fn(
      async (): Promise<Array<{ hash: string; message: string; parents: string[] }>> => [],
    ),
    add: vi.fn(async () => {}),
    revert: vi.fn(async (paths: string[]) => {
      void paths;
    }),
    clean: vi.fn(async (paths: string[]) => {
      const restored = new Set(paths);
      state.workingTreeChanges = state.workingTreeChanges.filter(
        (item) => !restored.has(item.uri.fsPath),
      );
    }),
    commit: vi.fn(async () => {}),
    createBranch: vi.fn(async (name: string, checkout: boolean, ref = 'HEAD') => {
      const commit =
        ref === 'HEAD'
          ? state.HEAD.commit
          : (state.refs.find((item) => item.name === ref)?.commit ?? ref);
      state.refs.push({ name, commit, remote: undefined });
      if (checkout) {
        state.HEAD.name = name;
        state.HEAD.commit = commit;
        state.HEAD.upstream = undefined;
      }
    }),
    getRefs: vi.fn(async ({ pattern }: { pattern?: string | string[] }) => {
      const patterns = Array.isArray(pattern) ? pattern : pattern ? [pattern] : [];
      return patterns.length === 0
        ? state.refs
        : state.refs.filter((ref) => patterns.some((item) => matchesGitRefPattern(ref, item)));
    }),
    checkout: vi.fn(async (name: string) => {
      const ref = state.refs.find((item) => item.name === name);
      if (!ref) {
        throw new Error('missing branch');
      }
      state.HEAD.name = name;
      state.HEAD.commit = ref.commit;
      state.HEAD.upstream =
        name === 'main' ? { remote: 'origin', name: 'main', commit: 'origin' } : undefined;
    }),
    fetch: vi.fn(async () => {}),
    push: vi.fn(async () => {}),
    merge: vi.fn(async (ref: string) => {
      void ref;
    }),
    mergeAbort: vi.fn(async () => {
      state.mergeChanges = [];
    }),
    addRemote: vi.fn(async (name: string, url: string) => {
      state.remotes.push({ name, fetchUrl: url, pushUrl: undefined });
      if (!state.refs.some((ref) => ref.name === `${name}/main`)) {
        state.refs.push({
          name: `${name}/main`,
          commit: state.HEAD.commit,
          remote: name,
        });
      }
    }),
    setBranchUpstream: vi.fn(async () => {}),
    status: vi.fn(async () => {}),
  };
}

export function useCanonicalRemote(
  repository: ReturnType<typeof createRepository>,
  name: string,
): void {
  repository.state.remotes = [
    ...repository.state.remotes.filter(
      (remote) => remote.name !== 'upstream' && remote.name !== name,
    ),
    {
      name,
      fetchUrl: 'https://github.com/DaleStudy/leetcode-study.git',
      pushUrl: undefined,
    },
  ];
  repository.state.refs = [
    ...repository.state.refs.filter(
      (ref) => ref.name !== 'upstream/main' && ref.name !== `${name}/main`,
    ),
    {
      name: `${name}/main`,
      commit: repository.state.HEAD.commit,
      remote: name,
    },
  ];
}

export function makeMainAheadOfCanonical(
  repository: ReturnType<typeof createRepository>,
  remoteName = 'upstream',
): void {
  repository.state.HEAD.commit = 'fork-ahead';
  if (repository.state.HEAD.upstream) {
    repository.state.HEAD.upstream.commit = 'fork-ahead';
  }
  const main = repository.state.refs.find(({ name }) => name === 'main');
  if (main) {
    main.commit = 'fork-ahead';
  }
  const originMain = repository.state.refs.find(({ name }) => name === 'origin/main');
  if (originMain) {
    originMain.commit = 'fork-ahead';
  }
  const canonicalMain = repository.state.refs.find(({ name }) => name === `${remoteName}/main`);
  if (canonicalMain) {
    canonicalMain.commit = 'canonical';
  }
  repository.getMergeBase.mockImplementation(async (_ref1: string, ref2: string) => {
    if (ref2 === `${remoteName}/main`) {
      return 'canonical';
    }
    if (ref2 === 'origin/main') {
      return 'fork-ahead';
    }
    return 'origin';
  });
}

export function githubResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

export function githubErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({ message: 'error' }),
  } as Response;
}

beforeEach(() => {
  harness.repository = createRepository();
  harness.textDocuments.splice(0);
  harness.getSession.mockReset();
  harness.getSession.mockResolvedValue(undefined);
  harness.readFile.mockReset();
  harness.readFile.mockResolvedValue(new TextEncoder().encode('solution'));
  vi.mocked(vscode.commands.executeCommand).mockReset();
  vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);
  vi.mocked(vscode.env.openExternal).mockReset();
  vi.mocked(vscode.env.openExternal).mockResolvedValue(true);
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
      if (requestUrl.includes('/compare/')) {
        return githubResponse({ ahead_by: 0, behind_by: 0, files: [], commits: [] });
      }
      return githubResponse([]);
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});
