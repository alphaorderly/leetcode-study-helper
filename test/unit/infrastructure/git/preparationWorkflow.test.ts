import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PreparationGit } from '../../../../src/infrastructure/git/submission/preparationGit';
import { PreparationWorkflow } from '../../../../src/infrastructure/git/submission/preparationWorkflow';

let folder: string;
let git: PreparationGit;
let workflow: PreparationWorkflow;
let base: string;
let canonical: string;
let pushFails = false;

async function write(file: string, content: string | Buffer) {
  await fs.mkdir(path.dirname(path.join(folder, file)), { recursive: true });
  await fs.writeFile(path.join(folder, file), content);
}
async function commit(message: string) {
  await git.run(['add', '-A']);
  await git.run(['commit', '-m', message]);
  return (await git.ref('HEAD'))!;
}
async function start(files: string[] = [], week?: number) {
  const preview = await workflow.preview(base);
  return workflow.start(preview, files, week);
}

beforeEach(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'study-preparation-'));
  git = new PreparationGit(folder, 'git');
  await git.run(['init', '-b', 'main']);
  await git.run(['config', 'user.name', 'Test']);
  await git.run(['config', 'user.email', 'test@localhost']);
  await write('one/user.py', 'submitted\n');
  await write('two/user.py', 'original\n');
  canonical = await commit('initial');
  await git.run(['init', '--bare', path.join(folder, 'remote.git')]);
  await git.run(['remote', 'add', 'origin', path.join(folder, 'remote.git')]);
  await git.run(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
  await write('.gitignore', 'remote.git/\nignored/\n');
  canonical = await commit('ignore fixtures');
  await git.run(['push', '-u', 'origin', 'main']);
  await git.run(['checkout', '-b', 'week-01']);
  await write('one/user.py', 'submitted PR\n');
  base = await commit('week 1');
  // Squash-style official commit has a different SHA from the PR head.
  await git.run(['checkout', 'main']);
  await write('one/user.py', 'submitted PR\n');
  canonical = await commit('squash merged week 1');
  await git.run(['checkout', 'week-01']);
  pushFails = false;
  workflow = new PreparationWorkflow(git, {
    fetch: async () => {
      await git.run(['fetch', 'origin', '--prune']);
      return canonical;
    },
    push: async () => {
      if (pushFails) throw new Error('network unavailable');
      await git.run(['push', 'origin', 'main']);
    },
  });
});
afterEach(async () => {
  await fs.rm(folder, { recursive: true, force: true });
});

describe('persistent next-week preparation with real Git', () => {
  it('returns after squash merge even when the remote week branch never exists', async () => {
    const record = await start();
    await workflow.resume(record.id);
    expect(await git.text(['symbolic-ref', '--short', 'HEAD'])).toBe('main');
    expect(await git.ref('HEAD')).toBe(canonical);
    expect(await git.text(['rev-parse', '--abbrev-ref', '@{upstream}'])).toBe('origin/main');
    expect((await workflow.read(record.id)).phase).toBe('done');
  });

  it('preserves extra commits, partial staging, untracked binary and ignored files through transfer and cancellation', async () => {
    await write('two/user.py', 'extra commit\n');
    const extra = await commit('oops next week');
    await write('two/user.py', 'staged\n');
    await git.run(['add', 'two/user.py']);
    await write('two/user.py', 'working\n');
    const binary = Buffer.from([0, 1, 255, 127]);
    await write('two/new.bin', binary);
    await write('notes.txt', 'leave on shelf\n');
    await write('ignored/secret.txt', 'untouched');
    const originalIndex = await git.run(['diff', '--cached', '--binary']);
    const originalWork = await git.run(['diff', '--binary']);
    const record = await start(['two/user.py', 'two/new.bin'], 2);
    await workflow.resume(record.id);
    expect(await git.text(['symbolic-ref', '--short', 'HEAD'])).toBe('week-02');
    expect(await fs.readFile(path.join(folder, 'two/user.py'), 'utf8')).toBe('working\n');
    expect(await fs.readFile(path.join(folder, 'two/new.bin'))).toEqual(binary);
    expect(await git.text(['diff', '--cached'])).toBe('');
    expect(await git.ref(`refs/heads/study-backup/${record.id}`)).toBe(extra);
    await expect(fs.access(path.join(folder, 'notes.txt'))).rejects.toThrow();
    expect(await fs.readFile(path.join(folder, 'ignored/secret.txt'), 'utf8')).toBe('untouched');
    await workflow.cancel(record.id);
    expect(await git.ref('HEAD')).toBe(extra);
    expect(await git.run(['diff', '--cached', '--binary'])).toEqual(originalIndex);
    expect(await git.run(['diff', '--binary'])).toEqual(originalWork);
    expect(await fs.readFile(path.join(folder, 'notes.txt'), 'utf8')).toBe('leave on shelf\n');
    expect(await fs.readFile(path.join(folder, 'two/new.bin'))).toEqual(binary);
  });

  it('resumes a failed push from its saved merge result without relaxing arbitrary ahead checks', async () => {
    const record = await start();
    pushFails = true;
    await expect(workflow.resume(record.id)).rejects.toThrow('network unavailable');
    expect((await workflow.read(record.id)).phase).toBe('push');
    pushFails = false;
    await workflow.resume(record.id);
    expect((await workflow.read(record.id)).phase).toBe('done');
  });

  it('rejects changed previews and preserves user stash entries', async () => {
    await write('notes.txt', 'old stash');
    await git.run(['stash', 'push', '-u', '-m', 'user stash']);
    const stash = await git.ref('refs/stash');
    const preview = await workflow.preview(base);
    await write('two/user.py', 'changed after preview');
    await expect(workflow.start(preview, [], undefined)).rejects.toThrow('미리보기');
    const record = await start(['two/user.py'], 2);
    await workflow.resume(record.id);
    expect(await git.text(['stash', 'list', '--format=%H'])).toContain(stash);
  });

  it('keeps a conflicting draft and completes only after explicit resolution', async () => {
    await git.run(['checkout', 'main']);
    await write('two/user.py', 'official change\n');
    canonical = await commit('official change');
    await git.run(['checkout', 'week-01']);
    await write('two/user.py', 'my next solution\n');
    const record = await start(['two/user.py'], 2);
    await expect(workflow.resume(record.id)).rejects.toThrow();
    expect(await workflow.conflicts()).toEqual(['two/user.py']);
    expect((await workflow.read(record.id)).phase).toBe('applying');
    await write('two/user.py', 'resolved\n');
    await git.run(['add', 'two/user.py']);
    await workflow.reviewed(record.id, 'two/user.py');
    await workflow.resume(record.id);
    expect((await workflow.read(record.id)).phase).toBe('done');
    expect(await fs.readFile(path.join(folder, 'two/user.py'), 'utf8')).toBe('resolved\n');
    expect(await git.text(['diff', '--cached'])).toBe('');
  });

  it('rejects concurrent preparation and preserves changes when cancelled before stash', async () => {
    await write('two/user.py', 'draft\n');
    const record = await start(['two/user.py'], 2);
    await expect(workflow.preview(base)).rejects.toThrow('진행 중');
    await workflow.cancel(record.id);
    expect(await fs.readFile(path.join(folder, 'two/user.py'), 'utf8')).toBe('draft\n');
    await workflow.exclusive(async () => {
      await expect(workflow.exclusive(async () => undefined)).rejects.toThrow('다른 Git 작업');
    });
  });
  it.each(['stash', 'checkout', 'merge', 'apply'])(
    'recovers a process interruption immediately after %s',
    async (command) => {
      await write('two/user.py', 'next draft\n');
      const record = await start(['two/user.py'], 2);
      const original = git.run.bind(git);
      let interrupted = false;
      const spy = vi.spyOn(git, 'run').mockImplementation(async (args, input, env) => {
        const value = await original(args, input, env);
        if (!interrupted && args[0] === command && (command !== 'stash' || args[1] === 'push')) {
          interrupted = true;
          throw new Error('simulated interruption');
        }
        return value;
      });
      await expect(workflow.resume(record.id)).rejects.toThrow('simulated interruption');
      spy.mockRestore();
      const resumed = new PreparationWorkflow(new PreparationGit(folder, 'git'), {
        fetch: async () => {
          await git.run(['fetch', 'origin']);
          return canonical;
        },
        push: async () => {
          await git.run(['push', 'origin', 'main']);
        },
      });
      if (command === 'apply') await resumed.reviewed(record.id, 'two/user.py');
      await resumed.resume(record.id);
      expect((await resumed.read(record.id)).phase).toBe('done');
      expect(await fs.readFile(path.join(folder, 'two/user.py'), 'utf8')).toBe('next draft\n');
    },
  );

  it('creates a missing local main and backs up divergent main without publishing its private commit', async () => {
    await git.run(['branch', '-D', 'main']);
    let record = await start();
    await workflow.resume(record.id);
    expect(await git.ref('HEAD')).toBe(canonical);
    await write('private.txt', 'private commit');
    const privateHead = await commit('private main');
    await git.run(['checkout', 'week-01']);
    const preview = await workflow.preview(base);
    expect(preview.mainNeedsBackup).toBe(true);
    record = await workflow.start(preview, [], undefined);
    await workflow.resume(record.id);
    expect(await git.ref(`refs/leetcode-study/${record.id}/main`)).toBe(privateHead);
    expect(await git.ref('origin/main')).toBe(canonical);
    await expect(fs.access(path.join(folder, 'private.txt'))).rejects.toThrow();
  });

  it('preserves deletion and rename drafts as uncommitted changes', async () => {
    await fs.unlink(path.join(folder, 'two/user.py'));
    await write('two/renamed.py', 'original\n');
    const record = await start(['two/user.py', 'two/renamed.py'], 2);
    await workflow.resume(record.id);
    await expect(fs.access(path.join(folder, 'two/user.py'))).rejects.toThrow();
    expect(await fs.readFile(path.join(folder, 'two/renamed.py'), 'utf8')).toBe('original\n');
    expect(await git.text(['diff', '--cached'])).toBe('');
    await workflow.cancel(record.id);
    await expect(fs.access(path.join(folder, 'two/user.py'))).rejects.toThrow();
    expect(await fs.readFile(path.join(folder, 'two/renamed.py'), 'utf8')).toBe('original\n');
  });

  it('keeps sync conflicts recoverable and resumes after editor resolution', async () => {
    await git.run(['checkout', '-B', 'fork-main', 'origin/main']);
    await write('one/user.py', 'fork change\n');
    await commit('fork main change');
    await git.run(['push', 'origin', 'HEAD:main']);
    await git.run(['checkout', 'week-01']);
    const record = await start();
    await expect(workflow.resume(record.id)).rejects.toThrow();
    expect((await workflow.read(record.id)).phase).toBe('sync');
    expect(await workflow.conflicts()).toEqual(['one/user.py']);
    await write('one/user.py', 'resolved official and fork\n');
    await git.run(['add', 'one/user.py']);
    await workflow.resume(record.id);
    expect((await workflow.read(record.id)).phase).toBe('done');
    expect(await git.ref('origin/main')).toBe(await git.ref('HEAD'));
  });

  it('does not overwrite an existing next-week branch and can open its work', async () => {
    await git.run(['branch', 'week-02', base]);
    await write('two/user.py', 'new draft\n');
    const record = await start(['two/user.py'], 2);
    await expect(workflow.resume(record.id)).rejects.toThrow('기존 작업');
    await workflow.openExistingTarget(record.id);
    expect(await git.ref('HEAD')).toBe(base);
    expect(await git.text(['symbolic-ref', '--short', 'HEAD'])).toBe('week-02');
    expect((await workflow.read(record.id)).phase).toBe('done');
    expect(await git.text(['show', `${record.snapshot}:two/user.py`])).toBe('new draft');
  });

  it('cancels during a draft conflict without losing conflict edits or original staging', async () => {
    await git.run(['checkout', 'main']);
    await write('two/user.py', 'official\n');
    canonical = await commit('official');
    await git.run(['checkout', 'week-01']);
    await write('two/user.py', 'draft\n');
    await git.run(['add', 'two/user.py']);
    const record = await start(['two/user.py'], 2);
    await expect(workflow.resume(record.id)).rejects.toThrow();
    await write('two/user.py', 'partially resolved\n');
    await workflow.cancel(record.id);
    expect(await fs.readFile(path.join(folder, 'two/user.py'), 'utf8')).toBe('draft\n');
    expect(await git.text(['show', ':two/user.py'])).toBe('draft');
    const cancelled = await workflow.read(record.id);
    expect(await git.text(['show', `${cancelled.extras[0]}:two/user.py`])).toBe(
      'partially resolved',
    );
  });

  it('refuses foreign branch changes and invalid file paths', async () => {
    const preview = await workflow.preview(base);
    await expect(workflow.start(preview, ['../escape'], 2)).rejects.toThrow();
    const record = await workflow.start(preview, [], undefined);
    pushFails = true;
    await expect(workflow.resume(record.id)).rejects.toThrow();
    await write('foreign.txt', 'external commit');
    await commit('external');
    pushFails = false;
    await expect(workflow.resume(record.id)).rejects.toThrow('외부에서');
    expect(await fs.readFile(path.join(folder, 'foreign.txt'), 'utf8')).toBe('external commit');
  });
  it('does not overwrite ignored files when the target starts tracking their path', async () => {
    await git.run(['checkout', 'main']);
    await write('ignored/local.txt', 'official tracked file');
    await git.run(['add', '-f', 'ignored/local.txt']);
    canonical = await commit('track previously ignored file');
    await git.run(['checkout', 'week-01']);
    await write('ignored/local.txt', 'local ignored content');
    const record = await start();
    await expect(workflow.resume(record.id)).rejects.toThrow();
    expect(await fs.readFile(path.join(folder, 'ignored/local.txt'), 'utf8')).toBe(
      'local ignored content',
    );
  });
});
