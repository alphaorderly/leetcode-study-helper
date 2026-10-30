import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  files: new Map<string, string>(),
  beforeConfirm: undefined as (() => void) | undefined,
  beforeApply: undefined as (() => void) | undefined,
  caseInsensitive: false,
  failApply: false,
  confirm: true,
  edits: [] as { uri: string; options: { overwrite?: boolean; ignoreIfExists?: boolean } }[],
}));

vi.mock('vscode', () => {
  class Uri {
    constructor(readonly value: string) {}
    static parse(value: string): Uri {
      return new Uri(value);
    }
    static joinPath(base: Uri, ...parts: string[]): Uri {
      return new Uri(`${base.value.replace(/\/$/, '')}/${parts.join('/')}`);
    }
    toString(): string {
      return this.value;
    }
  }
  class WorkspaceEdit {
    entry: { uri: Uri; options: { overwrite?: boolean; ignoreIfExists?: boolean } } | undefined;
    createFile(uri: Uri, options: { overwrite?: boolean; ignoreIfExists?: boolean }): void {
      this.entry = { uri, options };
      fake.edits.push({ uri: uri.toString(), options });
    }
  }
  return {
    Uri,
    WorkspaceEdit,
    workspace: {
      fs: {
        async readDirectory(uri: Uri) {
          const prefix = `${uri.toString()}/`;
          return [...fake.files.keys()]
            .filter((file) => file.startsWith(prefix))
            .map((file) => [file.slice(prefix.length), 1]);
        },
      },
      async applyEdit(edit: WorkspaceEdit) {
        fake.beforeApply?.();
        const { uri, options } = edit.entry!;
        const target = uri.toString();
        const exists = [...fake.files.keys()].some((file) =>
          fake.caseInsensitive ? file.toLowerCase() === target.toLowerCase() : file === target,
        );
        if ((exists && !options.overwrite) || fake.failApply) return false;
        fake.files.set(target, '');
        return true;
      },
    },
    window: {
      async showInformationMessage() {
        fake.beforeConfirm?.();
        return fake.confirm ? '만들기' : undefined;
      },
    },
  };
});

import { SolutionFileService } from '../../../../src/infrastructure/workspace/solutionFileService';

const rootUri = 'vscode-remote://ssh-remote+test/study';
const request = {
  rootUri,
  slug: 'two-sum',
  nickname: 'CaseUser',
  preferredLanguage: 'python3',
  confirm: true,
};
const target = `${rootUri}/two-sum/CaseUser.py`;
const differentCase = `${rootUri}/two-sum/caseuser.py`;

describe('SolutionFileService.create', () => {
  beforeEach(() => {
    fake.files.clear();
    fake.beforeConfirm = undefined;
    fake.beforeApply = undefined;
    fake.caseInsensitive = false;
    fake.failApply = false;
    fake.confirm = true;
    fake.edits = [];
  });

  it('creates an empty remote file with overwrite disabled', async () => {
    const result = await new SolutionFileService().create(request);
    expect(result.status).toBe('created');
    expect(fake.files.get(target)).toBe('');
    expect(fake.edits).toEqual([
      { uri: target, options: { overwrite: false, ignoreIfExists: false } },
    ]);
  });

  it('opens a file created during confirmation without overwriting it', async () => {
    fake.beforeConfirm = () => fake.files.set(target, 'existing content');
    const result = await new SolutionFileService().create(request);
    expect(result.status).toBe('exists');
    expect(fake.files.get(target)).toBe('existing content');
    expect(fake.edits).toHaveLength(0);
  });

  it('does not overwrite a file created immediately before the edit', async () => {
    fake.beforeApply = () => fake.files.set(target, 'racing content');
    const result = await new SolutionFileService().create(request);
    expect(result.status).toBe('exists');
    expect(fake.files.get(target)).toBe('racing content');
  });

  it('rejects a case conflict created during confirmation', async () => {
    fake.beforeConfirm = () => fake.files.set(differentCase, 'existing content');
    await expect(new SolutionFileService().create(request)).rejects.toThrow('대소문자만 다른');
    expect(fake.files.get(differentCase)).toBe('existing content');
    expect(fake.edits).toHaveLength(0);
  });

  it('reports a case-insensitive provider collision immediately before the edit', async () => {
    fake.caseInsensitive = true;
    fake.beforeApply = () => fake.files.set(differentCase, 'racing content');
    await expect(new SolutionFileService().create(request)).rejects.toThrow('대소문자만 다른');
    expect(fake.files.get(differentCase)).toBe('racing content');
    expect(fake.files.has(target)).toBe(false);
  });

  it('reports an edit failure when no target was created', async () => {
    fake.failApply = true;
    await expect(new SolutionFileService().create(request)).rejects.toThrow(
      '파일을 만들지 못했습니다',
    );
    expect(fake.files.has(target)).toBe(false);
  });

  it('does not create a file when confirmation is cancelled', async () => {
    fake.confirm = false;
    expect(await new SolutionFileService().create(request)).toEqual({ status: 'cancelled' });
    expect(fake.edits).toHaveLength(0);
  });
});
