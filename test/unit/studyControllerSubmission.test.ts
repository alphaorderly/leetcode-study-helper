import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSnapshot, RepositorySubmissionSnapshot } from '../../src/core/types';

const gitMocks = vi.hoisted(() => ({
  stageSolution: vi.fn(async () => {}),
  unstageSolution: vi.fn(async () => {}),
  commit: vi.fn(async () => {}),
  push: vi.fn(async () => {}),
  syncFork: vi.fn(async () => {}),
  openPullRequest: vi.fn(async () => {}),
  getStatuses: vi.fn(async () => ({
    statuses: new Map(),
  })),
}));

function event(): (listener: (value: unknown) => void) => { dispose(): void } {
  return () => ({ dispose(): void {} });
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock('vscode');
  vi.doUnmock('../../src/currentProblemSession.js');
  vi.doUnmock('../../src/gitStatusService.js');
  vi.doUnmock('../../src/repositoryService.js');
  vi.doUnmock('../../src/solutionFileService.js');
});

async function createController(submission: RepositorySubmissionSnapshot) {
  class TestEventEmitter<T> {
    readonly event = event();
    fire(value: T): void { void value; }
    dispose(): void {}
  }
  vi.doMock('vscode', () => ({
    EventEmitter: TestEventEmitter,
    Uri: {
      parse: (value: string) => ({
        fsPath: new URL(value).pathname,
        path: new URL(value).pathname,
        toString: () => value,
      }),
    },
    workspace: {
      isTrusted: true,
      workspaceFolders: [],
      createFileSystemWatcher: () => ({
        onDidCreate: vi.fn(),
        onDidChange: vi.fn(),
        onDidDelete: vi.fn(),
        dispose: vi.fn(),
      }),
      onDidChangeWorkspaceFolders: event(),
      onDidChangeConfiguration: event(),
      onDidGrantWorkspaceTrust: event(),
    },
    window: {},
  }));
  vi.doMock('../../src/currentProblemSession.js', () => ({
    CurrentProblemSession: class {
      readonly onDidChange = event();
      readonly currentSnapshot = undefined;
      setRepositories(): void {}
      dispose(): void {}
    },
  }));
  vi.doMock('../../src/gitStatusService.js', () => ({
    GitStatusService: class {
      readonly onDidChange = event();
      readonly stageSolution = gitMocks.stageSolution;
      readonly unstageSolution = gitMocks.unstageSolution;
      readonly commit = gitMocks.commit;
      readonly push = gitMocks.push;
      readonly syncFork = gitMocks.syncFork;
      readonly openPullRequest = gitMocks.openPullRequest;
      readonly getStatuses = gitMocks.getStatuses;
      dispose(): void {}
    },
  }));
  vi.doMock('../../src/repositoryService.js', () => ({
    StudyRepositoryService: class {},
  }));
  vi.doMock('../../src/solutionFileService.js', () => ({
    SolutionFileService: class {},
  }));
  const { StudyController } = await import('../../src/studyController.js');
  const controller = new StudyController(
    {} as never,
    { get: () => undefined, update: async () => {} },
  );
  const snapshot: ExtensionSnapshot = {
    nickname: 'CaseUser',
    preferredLanguage: 'python3',
    languages: [],
    issues: [],
    workspaceTrusted: true,
    repositories: [{
      name: 'study',
      rootUri: 'file:///study',
      submission,
      problems: [{
        slug: 'two-sum',
        week: 1,
        difficulty: 'Easy',
        categories: [],
        blindCategories: [],
        completed: true,
        hasOtherSolutions: false,
        solutions: [{
          name: 'CaseUser.py',
          uri: 'file:///study/two-sum/CaseUser.py',
          gitStatus: 'unpushed',
          submissionStatus: 'working',
        }],
      }, {
        slug: 'three-sum',
        week: 2,
        difficulty: 'Medium',
        categories: [],
        blindCategories: [],
        completed: true,
        hasOtherSolutions: false,
        solutions: [{
          name: 'CaseUser.py',
          uri: 'file:///study/three-sum/CaseUser.py',
          gitStatus: 'unpushed',
          submissionStatus: 'working',
        }],
      }],
    }],
  };
  (controller as unknown as { snapshot: ExtensionSnapshot }).snapshot = snapshot;
  return controller;
}

function submission(
  overrides: Partial<RepositorySubmissionSnapshot> = {},
): RepositorySubmissionSnapshot {
  return {
    status: 'ready',
    branch: 'main',
    activeSubmissionWeek: 1,
    fork: {
      status: 'verified',
      owner: 'CaseUser',
      repository: 'leetcode-study',
    },
    stagedFiles: [],
    otherStagedFiles: [],
    pendingCommits: [],
    forkFiles: [{
      name: 'CaseUser.py',
      uri: 'file:///study/two-sum/CaseUser.py',
      relativePath: 'two-sum/CaseUser.py',
      slug: 'two-sum',
      week: 1,
    }],
    otherForkFiles: [],
    activePullRequest: {
      number: 77,
      title: '[CaseUser] WEEK 01 Solutions',
      url: 'https://github.com/DaleStudy/leetcode-study/pull/77',
      week: 1,
    },
    summary: {
      working: 2,
      staged: 0,
      pushNeeded: 0,
      prPending: 1,
      merged: 0,
      unknown: 0,
    },
    canSync: false,
    ...overrides,
  };
}

describe('StudyController weekly submission guard', () => {
  it('blocks staging a different week while an open PR is active', async () => {
    const controller = await createController(submission());

    await expect(controller.stageSolution(
      'file:///study/three-sum/CaseUser.py',
    )).rejects.toThrow('Week 1 제출이 끝나기 전에는 Week 2');

    expect(gitMocks.stageSolution).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('allows another solution from the active week to be staged', async () => {
    const controller = await createController(submission());

    await controller.stageSolution('file:///study/two-sum/CaseUser.py');

    expect(gitMocks.stageSolution).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('delegates the fresh push-range guard to the Git service', async () => {
    gitMocks.push.mockRejectedValueOnce(
      new Error('Week 1 제출이 끝나기 전에는 Week 2 커밋을 push할 수 없습니다.'),
    );
    const controller = await createController(submission({
      pendingCommits: [{
        hash: 'abcdef123456',
        shortHash: 'abcdef1',
        message: '[CaseUser] WEEK 02 Solutions',
        pushed: false,
        files: [{
          name: 'CaseUser.py',
          uri: 'file:///study/three-sum/CaseUser.py',
          relativePath: 'three-sum/CaseUser.py',
          slug: 'three-sum',
          week: 2,
        }],
        otherFiles: [],
      }],
    }));

    await expect(controller.pushActiveWeek('file:///study'))
      .rejects.toThrow('Week 1 제출이 끝나기 전에는 Week 2');

    expect(gitMocks.push).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/study' }),
      expect.arrayContaining([
        expect.objectContaining({ slug: 'two-sum', week: 1 }),
        expect.objectContaining({ slug: 'three-sum', week: 2 }),
      ]),
    );
    controller.dispose();
  });

  it('blocks committing a file changed after it was staged', async () => {
    const stagedFile = {
      name: 'CaseUser.py',
      uri: 'file:///study/two-sum/CaseUser.py',
      relativePath: 'two-sum/CaseUser.py',
      slug: 'two-sum',
      week: 1,
    };
    const controller = await createController(submission({
      stagedFiles: [stagedFile],
      forkFiles: [],
      activePullRequest: undefined,
    }));
    const current = controller.currentSnapshot;
    current.repositories[0]!.problems[0]!.solutions[0]!.submissionStatus =
      'staged-outdated';

    await expect(controller.commitActiveWeek(
      'file:///study',
      '[CaseUser] WEEK 01 Solutions',
    )).rejects.toThrow('스테이징 후 수정된 풀이');

    expect(gitMocks.commit).not.toHaveBeenCalled();
    controller.dispose();
  });
});
