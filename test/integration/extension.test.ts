import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

interface SolutionFileSnapshot {
  name: string;
  uri: string;
}

interface ProblemSnapshot {
  slug: string;
  week?: number;
  completed: boolean;
  solutions: SolutionFileSnapshot[];
}

interface RepositorySnapshot {
  name: string;
  rootUri: string;
  problems: ProblemSnapshot[];
}

interface ExtensionSnapshot {
  nickname: string;
  preferredLanguage: string;
  repositories: RepositorySnapshot[];
}

interface LineLintFixResult {
  checked: number;
  fixed: number;
  ignored: number;
}

suite('LeetCode Study Helper integration', () => {
  const configuration = vscode.workspace.getConfiguration('leetcodeStudyHelper');
  let createdUri: vscode.Uri | undefined;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(
      'leetcode-study-helper.leetcode-study-helper',
    );
    assert.ok(extension, 'Extension should be discoverable in the development host.');
    await extension.activate();
    await configuration.update('nickname', 'CaseUser', vscode.ConfigurationTarget.Global);
    await configuration.update(
      'preferredLanguage',
      'python3',
      vscode.ConfigurationTarget.Global,
    );
  });

  suiteTeardown(async () => {
    if (createdUri) {
      try {
        await vscode.workspace.fs.delete(createdUri);
      } catch {
        // The file may already have been cleaned up by a failed test rerun.
      }
    }
    await configuration.update('nickname', undefined, vscode.ConfigurationTarget.Global);
    await configuration.update(
      'preferredLanguage',
      undefined,
      vscode.ConfigurationTarget.Global,
    );
  });

  test('detects both workspace roots and matches case-sensitively', async () => {
    const state = await vscode.commands.executeCommand<ExtensionSnapshot>(
      'leetcodeStudyHelper.__getState',
    );
    assert.ok(state);
    assert.equal(state.repositories.length, 2);

    const studyA = state.repositories.find(({ name }) => name === 'study-a');
    const twoSum = studyA?.problems.find(({ slug }) => slug === 'two-sum');
    assert.ok(twoSum);
    assert.equal(twoSum.week, 1);
    assert.deepEqual(
      twoSum.solutions.map(({ name }) => name),
      ['CaseUser.go.md', 'CaseUser.py'],
    );
  });

  test('creates and deletes a solution while refreshing completion state', async () => {
    const before = await vscode.commands.executeCommand<ExtensionSnapshot>(
      'leetcodeStudyHelper.__getState',
    );
    const studyA = before?.repositories.find(({ name }) => name === 'study-a');
    assert.ok(studyA);

    const created = await vscode.commands.executeCommand<string>(
      'leetcodeStudyHelper.__createSolution',
      studyA.rootUri,
      'three-sum',
    );
    assert.ok(created);
    const createdFileUri = vscode.Uri.parse(created);
    createdUri = createdFileUri;
    assert.equal((await vscode.workspace.fs.readFile(createdFileUri)).byteLength, 0);

    const after = await vscode.commands.executeCommand<ExtensionSnapshot>(
      'leetcodeStudyHelper.__getState',
    );
    const problem = after?.repositories
      .find(({ name }) => name === 'study-a')
      ?.problems.find(({ slug }) => slug === 'three-sum');
    assert.equal(problem?.completed, true);
    assert.deepEqual(problem?.solutions.map(({ name }) => name), ['CaseUser.py']);

    const deleted = await vscode.commands.executeCommand<boolean>(
      'leetcodeStudyHelper.__deleteSolution',
      created,
    );
    assert.equal(deleted, true);
    await assert.rejects(async () => vscode.workspace.fs.stat(createdFileUri));
    createdUri = undefined;

    const afterDelete = await vscode.commands.executeCommand<ExtensionSnapshot>(
      'leetcodeStudyHelper.__getState',
    );
    const deletedProblem = afterDelete?.repositories
      .find(({ name }) => name === 'study-a')
      ?.problems.find(({ slug }) => slug === 'three-sum');
    assert.equal(deletedProblem?.completed, false);
    assert.deepEqual(deletedProblem?.solutions, []);
  });

  test('fixes all matching submissions while ignoring markdown', async () => {
    const state = await vscode.commands.executeCommand<ExtensionSnapshot>(
      'leetcodeStudyHelper.__getState',
    );
    const studyA = state?.repositories.find(({ name }) => name === 'study-a');
    const twoSum = studyA?.problems.find(({ slug }) => slug === 'two-sum');
    const python = twoSum?.solutions.find(({ name }) => name === 'CaseUser.py');
    const markdown = twoSum?.solutions.find(({ name }) => name === 'CaseUser.go.md');
    assert.ok(python);
    assert.ok(markdown);

    await vscode.workspace.fs.writeFile(
      vscode.Uri.parse(python.uri),
      Buffer.from('answer\n \t'),
    );
    await vscode.workspace.fs.writeFile(vscode.Uri.parse(markdown.uri), Buffer.from('ignored'));

    const result = await vscode.commands.executeCommand<LineLintFixResult>(
      'leetcodeStudyHelper.__fixAllSolutions',
    );
    assert.deepEqual(result, { checked: 2, fixed: 1, ignored: 1 });
    assert.equal(
      Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.parse(python.uri))).toString(),
      'answer\n',
    );
    assert.equal(
      Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.parse(markdown.uri))).toString(),
      'ignored',
    );
  });
});
