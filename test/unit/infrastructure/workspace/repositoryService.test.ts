import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeFs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  dirs: new Set<string>(),
  folders: [] as { name: string; path: string }[],
}));

vi.mock('vscode', () => {
  class Uri {
    constructor(readonly path: string) {}
    static parse(value: string): Uri {
      return new Uri(value.replace('file://', ''));
    }
    static joinPath(base: Uri, ...parts: string[]): Uri {
      return new Uri([base.path, ...parts].join('/').replace(/\/+/g, '/'));
    }
    toString(): string {
      return `file://${this.path}`;
    }
  }
  class FileSystemError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  const missing = (): never => {
    throw new FileSystemError('FileNotFound');
  };
  const childrenOf = (path: string): Map<string, number> => {
    const prefix = `${path}/`;
    const children = new Map<string, number>();
    for (const file of fakeFs.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const [name, ...rest] = file.slice(prefix.length).split('/');
      children.set(name!, rest.length > 0 ? 2 : 1);
    }
    for (const dir of fakeFs.dirs) {
      if (!dir.startsWith(prefix)) continue;
      children.set(dir.slice(prefix.length).split('/')[0]!, 2);
    }
    return children;
  };
  return {
    Uri,
    FileSystemError,
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    workspace: {
      get workspaceFolders() {
        return fakeFs.folders.map(({ name, path }) => ({ name, uri: new Uri(path) }));
      },
      fs: {
        async readFile(uri: Uri) {
          const content = fakeFs.files.get(uri.path);
          return content === undefined ? missing() : new TextEncoder().encode(content);
        },
        async readDirectory(uri: Uri) {
          if (!fakeFs.dirs.has(uri.path) && childrenOf(uri.path).size === 0) return missing();
          return [...childrenOf(uri.path)];
        },
        async stat(uri: Uri) {
          return fakeFs.files.has(uri.path) || fakeFs.dirs.has(uri.path) ? {} : missing();
        },
      },
    },
  };
});

import { StudyRepositoryService } from '../../../../src/infrastructure/workspace/repositoryService';

const CATALOG = JSON.stringify({ 'two-sum': { difficulty: 'Easy', categories: [] } });

function openFolders(...paths: string[]): void {
  fakeFs.folders = paths.map((path) => ({ name: path.split('/').pop()!, path }));
}

describe('StudyRepositoryService.scan workspace classification', () => {
  beforeEach(() => {
    fakeFs.files.clear();
    fakeFs.dirs.clear();
    fakeFs.folders = [];
  });

  it('reports none without open folders', async () => {
    const result = await new StudyRepositoryService().scan('me');
    expect(result.workspace.kind).toBe('none');
    expect(result.issues).toEqual([]);
  });

  it('reports an empty folder without raising an issue', async () => {
    fakeFs.dirs.add('/work/blank');
    fakeFs.dirs.add('/work/blank/.git');
    openFolders('/work/blank');
    const result = await new StudyRepositoryService().scan('me');
    expect(result.workspace.kind).toBe('empty');
    expect(result.repositories).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('reports an unrelated project as other', async () => {
    fakeFs.files.set('/work/app/package.json', '{}');
    openFolders('/work/app');
    const result = await new StudyRepositoryService().scan('me');
    expect(result.workspace).toEqual({ kind: 'other', nestedStudyFolders: [] });
    expect(result.issues).toEqual([]);
  });

  it('finds a study repository one level below the opened folder', async () => {
    fakeFs.files.set('/dev/leetcode-study/problem-categories.json', CATALOG);
    fakeFs.files.set('/dev/leetcode-study-notes/notes.md', 'x');
    fakeFs.files.set('/dev/other/readme.md', 'x');
    openFolders('/dev');
    const result = await new StudyRepositoryService().scan('me');
    expect(result.workspace).toEqual({
      kind: 'nested',
      nestedStudyFolders: [{ name: 'leetcode-study', uri: 'file:///dev/leetcode-study' }],
    });
  });

  it('reports an invalid catalog as broken with an issue', async () => {
    fakeFs.files.set('/work/study/problem-categories.json', '{not json');
    openFolders('/work/study');
    const result = await new StudyRepositoryService().scan('me');
    expect(result.workspace.kind).toBe('broken');
    expect(result.issues).toHaveLength(1);
  });

  it('reports a catalog without matching problem folders as broken', async () => {
    fakeFs.files.set('/work/study/problem-categories.json', CATALOG);
    openFolders('/work/study');
    const result = await new StudyRepositoryService().scan('me');
    expect(result.workspace.kind).toBe('broken');
    expect(result.issues[0]?.message).toContain('문제 폴더');
  });

  it('reports a valid repository as study and prefers it in multi-root workspaces', async () => {
    fakeFs.files.set('/work/study/problem-categories.json', CATALOG);
    fakeFs.files.set('/work/study/two-sum/me.py', 'pass');
    fakeFs.files.set('/work/app/package.json', '{}');
    openFolders('/work/app', '/work/study');
    const result = await new StudyRepositoryService().scan('me');
    expect(result.workspace.kind).toBe('study');
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]?.problems[0]?.completed).toBe(true);
  });
});
