import { execFile } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const temporaryRoot = resolve('.tmp');
const workspaceA = resolve(temporaryRoot, 'study-a');
const workspaceB = resolve(temporaryRoot, 'study-b');
const originA = resolve(temporaryRoot, 'study-a-origin.git');

await rm(temporaryRoot, { recursive: true, force: true });
await mkdir(temporaryRoot, { recursive: true });
await cp(resolve('test/fixtures/study-a'), workspaceA, { recursive: true });
await cp(resolve('test/fixtures/study-b'), workspaceB, { recursive: true });
await execFileAsync('git', ['init', '--bare', originA]);
await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: workspaceA });
await execFileAsync('git', ['config', 'user.name', 'Integration Test'], { cwd: workspaceA });
await execFileAsync('git', ['config', 'user.email', 'integration@example.com'], {
  cwd: workspaceA,
});
await execFileAsync('git', ['add', '.'], { cwd: workspaceA });
await execFileAsync('git', ['commit', '-m', 'Prepare integration fixture'], { cwd: workspaceA });
await execFileAsync('git', ['remote', 'add', 'origin', originA], { cwd: workspaceA });
await execFileAsync('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: workspaceA });
await writeFile(
  resolve(temporaryRoot, 'integration.code-workspace'),
  JSON.stringify(
    {
      folders: [{ path: workspaceA }, { path: workspaceB }],
      settings: {
        'workbench.startupEditor': 'none',
      },
    },
    null,
    2,
  ),
);
