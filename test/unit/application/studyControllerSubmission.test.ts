import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepositorySnapshot } from '../../../src/shared/contracts';

const mocks = vi.hoisted(() => ({
  stage: vi.fn(async () => {}),
  signIn: vi.fn(async () => true),
  refreshGit: vi.fn(async (_status?: boolean, _remote?: boolean) => {
    void _status;
    void _remote;
  }),
  repositories: [] as RepositorySnapshot[],
}));
vi.mock('vscode', () => ({
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  },
  Uri: { parse: (value: string) => ({ toString: () => value }) },
  workspace: {
    isTrusted: true,
    getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidGrantWorkspaceTrust: () => ({ dispose() {} }),
  },
}));
vi.mock('../../../src/infrastructure/git/gitStatusService', () => ({
  GitStatusService: class {
    stageSolution = mocks.stage;
    signInGitHub = mocks.signIn;
    dispose() {}
  },
}));
vi.mock('../../../src/application/sessions/repositoryRefreshSession', () => ({
  RepositoryRefreshSession: class {
    onDidChange = () => ({ dispose() {} });
    refresh = async () => ({ repositories: mocks.repositories, issues: [] });
    refreshGitStatuses = mocks.refreshGit;
    dispose() {}
  },
}));
vi.mock('../../../src/application/sessions/currentProblemSession', () => ({
  CurrentProblemSession: class {
    currentSnapshot = undefined;
    onDidChange = () => ({ dispose() {} });
    setRepositories() {}
    dispose() {}
  },
}));
vi.mock('../../../src/infrastructure/workspace/repositoryService', () => ({
  StudyRepositoryService: class {},
}));
vi.mock('../../../src/infrastructure/workspace/solutionFileService', () => ({
  SolutionFileService: class {},
}));

import { StudyController } from '../../../src/application/studyController';
afterEach(() => {
  vi.clearAllMocks();
  mocks.repositories = [];
});

describe('StudyController submission wiring', () => {
  it('forwards sign-in to the shared Git service and forces remote refresh', async () => {
    const controller = new StudyController({} as never, {
      get: () => undefined,
      update: async () => {},
    });
    try {
      await controller.signInGitHub();
      expect(mocks.signIn).toHaveBeenCalledOnce();
      expect(mocks.refreshGit).toHaveBeenCalledExactlyOnceWith(true, true);
    } finally {
      controller.dispose();
    }
  });

  it('uses the latest full scan in submission commands without private state mutation', async () => {
    const controller = new StudyController({} as never, {
      get: () => undefined,
      update: async () => {},
    });
    mocks.repositories = [
      {
        name: 'study',
        rootUri: 'file:///study',
        problems: [
          {
            slug: 'two-sum',
            week: 1,
            difficulty: 'Easy',
            categories: [],
            blindCategories: [],
            completed: true,
            hasOtherSolutions: false,
            solutions: [
              {
                name: 'CaseUser.py',
                uri: 'file:///study/two-sum/CaseUser.py',
                gitStatus: 'unpushed',
              },
            ],
          },
        ],
        submission: {
          status: 'ready',
          fork: { status: 'verified' },
          activeSubmissionWeek: 1,
          stagedFiles: [],
          otherStagedFiles: [],
          pendingCommits: [],
          forkFiles: [],
          otherForkFiles: [],
          summary: { working: 1, staged: 0, pushNeeded: 0, prPending: 0, merged: 0, unknown: 0 },
          canSync: false,
          canReturnToMain: false,
          hasCanonicalRemote: true,
          behindOfficialMain: false,
          blockingTrackedFiles: [],
        },
      },
    ];
    try {
      await controller.getState();
      await controller.stageSolution('file:///study/two-sum/CaseUser.py');
      expect(mocks.stage).toHaveBeenCalledWith(
        expect.objectContaining({ toString: expect.any(Function) }),
        expect.objectContaining({ toString: expect.any(Function) }),
        1,
        [
          {
            name: 'CaseUser.py',
            uri: 'file:///study/two-sum/CaseUser.py',
            slug: 'two-sum',
            week: 1,
          },
        ],
      );
      expect(mocks.refreshGit).toHaveBeenCalledExactlyOnceWith(true, undefined);
      mocks.repositories = [];
      await controller.refresh();
      await expect(controller.stageSolution('file:///study/two-sum/CaseUser.py')).rejects.toThrow(
        '요청한 풀이가',
      );
      expect(mocks.stage).toHaveBeenCalledOnce();
    } finally {
      controller.dispose();
    }
  });
});
