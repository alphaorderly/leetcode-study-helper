import { afterEach, describe, expect, it, vi } from 'vitest';

interface EventSource<T> {
  event: (listener: (value: T) => void) => { dispose(): void };
  fire(value: T): void;
}

function eventSource<T>(): EventSource<T> {
  const listeners = new Set<(value: T) => void>();
  return {
    event: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: (value) => {
      for (const listener of listeners) {
        listener(value);
      }
    },
  };
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

describe('StudyController startup', () => {
  it('publishes the file scan before the first Git status refresh finishes', async () => {
    const configuration = eventSource<{ affectsConfiguration(value: string): boolean }>();
    const folders = eventSource<void>();
    const trust = eventSource<void>();
    class TestEventEmitter<T> {
      private readonly source = eventSource<T>();
      readonly event = this.source.event;
      fire(value: T): void { this.source.fire(value); }
      dispose(): void {}
    }
    vi.doMock('vscode', () => ({
      EventEmitter: TestEventEmitter,
      Uri: { parse: (value: string) => ({ toString: () => value }) },
      window: {},
      workspace: {
        isTrusted: true,
        workspaceFolders: [],
        getConfiguration: () => ({
          get: (key: string, fallback: string) => key === 'nickname' ? 'CaseUser' : fallback,
        }),
        onDidChangeWorkspaceFolders: folders.event,
        onDidChangeConfiguration: configuration.event,
        onDidGrantWorkspaceTrust: trust.event,
      },
    }));

    const currentProblemChanges = eventSource<undefined>();
    vi.doMock('../../src/currentProblemSession.js', () => ({
      CurrentProblemSession: class {
        readonly onDidChange = currentProblemChanges.event;
        readonly currentSnapshot = undefined;
        setRepositories(): void {}
        dispose(): void {}
      },
    }));

    let finishGitRefresh!: (value: {
      remoteName: string;
      statuses: Map<string, 'pushed'>;
    }) => void;
    const gitResult = new Promise<{
      remoteName: string;
      statuses: Map<string, 'pushed'>;
    }>((resolve) => {
      finishGitRefresh = resolve;
    });
    const gitChanges = eventSource<void>();
    const getStatuses = vi.fn(() => gitResult);
    vi.doMock('../../src/gitStatusService.js', () => ({
      GitStatusService: class {
        readonly onDidChange = gitChanges.event;
        readonly getStatuses = getStatuses;
        dispose(): void {}
      },
    }));

    const solutionUri = 'file:///study/two-sum/CaseUser.py';
    vi.doMock('../../src/repositoryService.js', () => ({
      StudyRepositoryService: class {
        scan = vi.fn(async () => ({
          repositories: [{
            name: 'study',
            rootUri: 'file:///study',
            problems: [{
              slug: 'two-sum',
              difficulty: 'Easy',
              categories: [],
              blindCategories: [],
              completed: true,
              solutions: [{
                name: 'CaseUser.py',
                uri: solutionUri,
                gitStatus: 'unknown',
              }],
            }],
          }],
          issues: [],
        }));
      },
    }));
    vi.doMock('../../src/solutionFileService.js', () => ({
      SolutionFileService: class {},
    }));

    const { StudyController } = await import('../../src/studyController.js');
    const controller = new StudyController({} as never);
    const initial = await controller.getState();

    expect(initial.repositories[0]?.problems[0]?.solutions[0]?.gitStatus)
      .toBe('checking');
    expect(getStatuses).toHaveBeenCalledTimes(1);

    finishGitRefresh({
      remoteName: 'origin',
      statuses: new Map([[solutionUri, 'pushed']]),
    });
    await vi.waitFor(() => {
      expect(controller.currentSnapshot.repositories[0]?.gitRemote).toBe('origin');
      expect(controller.currentSnapshot.repositories[0]?.problems[0]?.solutions[0]?.gitStatus)
        .toBe('pushed');
    });

    controller.dispose();
  });
});
