import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

interface SolutionFileSnapshot {
  name: string;
  uri: string;
  gitStatus: 'checking' | 'pushed' | 'unpushed' | 'unknown';
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
  gitRemote?: string;
  problems: ProblemSnapshot[];
}

interface ExtensionSnapshot {
  nickname: string;
  preferredLanguage: string;
  repositories: RepositorySnapshot[];
  currentProblem?: {
    rootUri: string;
    slug: string;
    status: 'idle' | 'loading' | 'loaded' | 'error';
    solution: SolutionFileSnapshot;
    runner: {
      status: 'checking' | 'unavailable' | 'ready' | 'running' | 'passed' | 'failed' | 'error';
      candidates?: Array<{ id: string; label: string }>;
      selectedCandidateId?: string;
      passed?: number;
      total?: number;
    };
  };
}

interface LineLintFixResult {
  checked: number;
  fixed: number;
  ignored: number;
}

async function waitForState(
  predicate: (state: ExtensionSnapshot) => boolean,
  timeoutMs = 5_000,
): Promise<ExtensionSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await vscode.commands.executeCommand<ExtensionSnapshot>(
      'leetcodeStudyHelper.__getState',
    );
    if (state && predicate(state)) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the expected extension state.');
}

suite('LeetCode Study Helper integration', () => {
  const configuration = vscode.workspace.getConfiguration('leetcodeStudyHelper');
  let createdUri: vscode.Uri | undefined;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(
      'alphaorderly.leetcode-study-helper',
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
    const state = await waitForState((current) =>
      current.repositories
        .find(({ name }) => name === 'study-a')
        ?.problems.find(({ slug }) => slug === 'two-sum')
        ?.solutions.every(({ gitStatus }) => gitStatus === 'pushed') === true,
    );
    assert.equal(state.repositories.length, 2);

    const studyA = state.repositories.find(({ name }) => name === 'study-a');
    assert.equal(studyA?.gitRemote, 'origin');
    const twoSum = studyA?.problems.find(({ slug }) => slug === 'two-sum');
    assert.ok(twoSum);
    assert.equal(twoSum.week, 1);
    assert.deepEqual(
      twoSum.solutions.map(({ name }) => name),
      ['CaseUser.go.md', 'CaseUser.py'],
    );
    assert.deepEqual(
      twoSum.solutions.map(({ gitStatus }) => gitStatus),
      ['pushed', 'pushed'],
    );
  });

  test('tracks only the active solution belonging to the configured nickname', async () => {
    const state = await vscode.commands.executeCommand<ExtensionSnapshot>(
      'leetcodeStudyHelper.__getState',
    );
    const studyA = state?.repositories.find(({ name }) => name === 'study-a');
    const twoSum = studyA?.problems.find(({ slug }) => slug === 'two-sum');
    const ownSolution = twoSum?.solutions.find(({ name }) => name === 'CaseUser.py');
    assert.ok(studyA);
    assert.ok(ownSolution);

    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(vscode.Uri.parse(ownSolution.uri)),
    );
    const activeSolution = await vscode.commands.executeCommand<ExtensionSnapshot>(
      'leetcodeStudyHelper.__getState',
    );
    assert.equal(activeSolution?.currentProblem?.rootUri, studyA.rootUri);
    assert.equal(activeSolution?.currentProblem?.slug, 'two-sum');
    assert.equal(activeSolution?.currentProblem?.status, 'idle');
    assert.equal(activeSolution?.currentProblem?.solution.uri, ownSolution.uri);

    await vscode.commands.executeCommand('leetcodeStudyHelper.openView');
    const webviewFocused = await vscode.commands.executeCommand<ExtensionSnapshot>(
      'leetcodeStudyHelper.__getState',
    );
    assert.equal(webviewFocused?.currentProblem?.solution.uri, ownSolution.uri);

    const readmeUri = vscode.Uri.joinPath(
      vscode.Uri.parse(studyA.rootUri),
      'three-sum',
      'README.md',
    );
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(readmeUri));
    const activeReadme = await vscode.commands.executeCommand<ExtensionSnapshot>(
      'leetcodeStudyHelper.__getState',
    );
    assert.equal(activeReadme?.currentProblem, undefined);

    const otherSolutionUri = vscode.Uri.joinPath(
      vscode.Uri.parse(studyA.rootUri),
      'two-sum',
      'caseuser.ts',
    );
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(otherSolutionUri),
    );
    const activeOtherSolution = await vscode.commands.executeCommand<ExtensionSnapshot>(
      'leetcodeStudyHelper.__getState',
    );
    assert.equal(activeOtherSolution?.currentProblem, undefined);
  });

  test('runs an unsaved Python candidate with bundled dataset tests', async () => {
    const state = await vscode.commands.executeCommand<ExtensionSnapshot>(
      'leetcodeStudyHelper.__getState',
    );
    const solution = state?.repositories
      .find(({ name }) => name === 'study-a')
      ?.problems.find(({ slug }) => slug === 'two-sum')
      ?.solutions.find(({ name }) => name === 'CaseUser.py');
    assert.ok(solution);

    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(solution.uri));
    await vscode.window.showTextDocument(document);
    try {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        [
          'class Solution:',
          '    def twoSum(self, nums, target):',
          '        seen = {}',
          '        for index, value in enumerate(nums):',
          '            if target - value in seen:',
          '                return [seen[target - value], index]',
          '            seen[value] = index',
          '',
          'class Solution:',
          '    def twoSum(self, nums, target):',
          '        for left in range(len(nums)):',
          '            for right in range(left + 1, len(nums)):',
          '                if nums[left] + nums[right] == target:',
          '                    return [left, right]',
          '',
        ].join('\n'),
      );
      assert.equal(await vscode.workspace.applyEdit(edit), true);

      const ready = await waitForState((current) =>
        current.currentProblem?.solution.uri === solution.uri
        && current.currentProblem.runner.status === 'ready'
        && current.currentProblem.runner.candidates?.length === 2,
      );
      const candidateId = ready.currentProblem?.runner.candidates?.[0]?.id;
      assert.ok(candidateId);
      await vscode.commands.executeCommand(
        'leetcodeStudyHelper.__runCurrentSolution',
        candidateId,
      );
      const result = await vscode.commands.executeCommand<ExtensionSnapshot>(
        'leetcodeStudyHelper.__getState',
      );
      assert.equal(result?.currentProblem?.runner.status, 'passed');
      assert.equal(result?.currentProblem?.runner.passed, result?.currentProblem?.runner.total);
      assert.equal(document.isDirty, true);
    } finally {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
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

    const after = await waitForState((current) =>
      current.repositories
        .find(({ name }) => name === 'study-a')
        ?.problems.find(({ slug }) => slug === 'three-sum')
        ?.solutions.some(({ gitStatus }) => gitStatus === 'unpushed') === true,
    );
    const problem = after?.repositories
      .find(({ name }) => name === 'study-a')
      ?.problems.find(({ slug }) => slug === 'three-sum');
    assert.equal(problem?.completed, true);
    assert.deepEqual(problem?.solutions.map(({ name }) => name), ['CaseUser.py']);
    assert.deepEqual(problem?.solutions.map(({ gitStatus }) => gitStatus), ['unpushed']);

    const repositoryPath = vscode.Uri.parse(studyA.rootUri).fsPath;
    await execFileAsync('git', ['add', 'three-sum/CaseUser.py'], { cwd: repositoryPath });
    await execFileAsync('git', ['commit', '-m', 'Add three-sum solution'], {
      cwd: repositoryPath,
    });
    const committed = await vscode.commands.executeCommand<ExtensionSnapshot>(
      'leetcodeStudyHelper.__getState',
    );
    assert.equal(
      committed?.repositories
        .find(({ name }) => name === 'study-a')
        ?.problems.find(({ slug }) => slug === 'three-sum')
        ?.solutions[0]?.gitStatus,
      'unpushed',
    );

    await execFileAsync('git', ['push', 'origin', 'main'], { cwd: repositoryPath });
    const pushed = await waitForState((current) =>
      current.repositories
        .find(({ name }) => name === 'study-a')
        ?.problems.find(({ slug }) => slug === 'three-sum')
        ?.solutions[0]?.gitStatus === 'pushed',
    );
    assert.equal(
      pushed.repositories
        .find(({ name }) => name === 'study-a')
        ?.problems.find(({ slug }) => slug === 'three-sum')
        ?.solutions[0]?.gitStatus,
      'pushed',
    );

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
