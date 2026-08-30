import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const temporaryRoot = resolve('.tmp');
const workspaceA = resolve(temporaryRoot, 'study-a');
const workspaceB = resolve(temporaryRoot, 'study-b');
const originA = resolve(temporaryRoot, 'study-a-origin.git');
const week11Slugs = [
  'missing-number',
  'reorder-list',
  'graph-valid-tree',
  'merge-intervals',
  'binary-tree-maximum-path-sum',
];

await rm(temporaryRoot, { recursive: true, force: true });
await mkdir(temporaryRoot, { recursive: true });
await cp(resolve('test/fixtures/study-a'), workspaceA, { recursive: true });
await cp(resolve('test/fixtures/study-b'), workspaceB, { recursive: true });
const catalogPath = resolve(workspaceA, 'problem-categories.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
for (const slug of week11Slugs) {
  catalog[slug] = {
    difficulty: 'Medium',
    categories: ['Integration'],
    blindCategories: [],
    intended_approach: 'Integration fixture',
  };
  const problemPath = resolve(workspaceA, slug);
  await mkdir(problemPath, { recursive: true });
  await writeFile(
    resolve(problemPath, 'README.md'),
    `- 문제: https://leetcode.com/problems/${slug}/\n`,
  );
}
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
await execFileAsync('git', ['init', '--bare', originA]);
await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: workspaceA });
await execFileAsync('git', ['config', 'user.name', 'Integration Test'], { cwd: workspaceA });
await execFileAsync('git', ['config', 'user.email', 'integration@example.com'], {
  cwd: workspaceA,
});
await execFileAsync('git', ['add', '.'], { cwd: workspaceA });
await execFileAsync('git', ['commit', '-m', 'Prepare integration fixture'], { cwd: workspaceA });
const { stdout: baseCommitOutput } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
  cwd: workspaceA,
});
const baseCommit = baseCommitOutput.trim();
await execFileAsync('git', ['remote', 'add', 'origin', originA], { cwd: workspaceA });
await execFileAsync(
  'git',
  ['remote', 'add', 'upstream', 'https://github.com/DaleStudy/leetcode-study.git'],
  { cwd: workspaceA },
);

await execFileAsync('git', ['switch', '-c', 'official-main', baseCommit], { cwd: workspaceA });
await writeFile(resolve(workspaceA, 'official-main.txt'), 'official main advanced\n');
await execFileAsync('git', ['add', 'official-main.txt'], { cwd: workspaceA });
await execFileAsync('git', ['commit', '-m', 'Advance official main'], { cwd: workspaceA });
const { stdout: officialCommitOutput } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
  cwd: workspaceA,
});
const officialCommit = officialCommitOutput.trim();

await execFileAsync('git', ['switch', 'main'], { cwd: workspaceA });
for (let index = 1; index <= 8; index += 1) {
  const fileName = `.integration-personal-${index}`;
  await writeFile(resolve(workspaceA, fileName), `personal main ${index}\n`);
  await execFileAsync('git', ['add', fileName], { cwd: workspaceA });
  await execFileAsync('git', ['commit', '-m', `Personal main ${index}`], { cwd: workspaceA });
}
await execFileAsync('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: workspaceA });
await execFileAsync(
  'git',
  ['update-ref', 'refs/remotes/upstream/main', officialCommit],
  { cwd: workspaceA },
);
await execFileAsync('git', ['branch', '-D', 'official-main'], { cwd: workspaceA });

await execFileAsync('git', ['switch', '-c', 'week-11', baseCommit], { cwd: workspaceA });
for (const slug of week11Slugs) {
  await writeFile(
    resolve(workspaceA, slug, 'CaseUser.py'),
    `# ${slug} integration solution\n`,
  );
}
await execFileAsync('git', ['add', ...week11Slugs], { cwd: workspaceA });
await execFileAsync('git', ['commit', '-m', '[CaseUser] WEEK 11 Solutions'], {
  cwd: workspaceA,
});
await execFileAsync('git', ['switch', 'main'], { cwd: workspaceA });
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
