import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const temporaryRoot = resolve('.tmp');
const workspaceA = resolve(temporaryRoot, 'study-a');
const workspaceB = resolve(temporaryRoot, 'study-b');

await rm(temporaryRoot, { recursive: true, force: true });
await mkdir(temporaryRoot, { recursive: true });
await cp(resolve('test/fixtures/study-a'), workspaceA, { recursive: true });
await cp(resolve('test/fixtures/study-b'), workspaceB, { recursive: true });
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
