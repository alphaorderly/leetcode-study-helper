import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANSWER_CONFIRM_LABEL } from '../../src/core/answerLinks';

interface EventSource<T> {
  event: (listener: (value: T) => void) => { dispose(): void };
}

function eventSource<T>(): EventSource<T> {
  return {
    event: () => ({ dispose(): void {} }),
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

describe('StudyController answer navigation', () => {
  it('confirms every request and opens the stored URL only after approval', async () => {
    const showWarningMessage = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(ANSWER_CONFIRM_LABEL);
    const openExternal = vi.fn(async (uri: { toString(): string }) => {
      void uri;
      return true;
    });
    class TestEventEmitter<T> {
      readonly event = eventSource<T>().event;
      fire(): void {}
      dispose(): void {}
    }
    vi.doMock('vscode', () => ({
      EventEmitter: TestEventEmitter,
      Uri: {
        parse: (value: string) => ({
          toString: () => value,
        }),
      },
      env: { openExternal },
      window: { showWarningMessage },
      workspace: {
        isTrusted: true,
        workspaceFolders: [],
        getConfiguration: () => ({
          get: (_key: string, fallback: string) => fallback,
        }),
        onDidChangeWorkspaceFolders: eventSource<void>().event,
        onDidChangeConfiguration: eventSource<{
          affectsConfiguration(value: string): boolean;
        }>().event,
        onDidGrantWorkspaceTrust: eventSource<void>().event,
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
    vi.doMock('../../src/gitStatusService.js', () => ({
      GitStatusService: class {
        readonly onDidChange = eventSource<void>().event;
        readonly getStatuses = vi.fn(async () => ({
          remoteName: 'origin',
          statuses: new Map(),
        }));
        dispose(): void {}
      },
    }));
    vi.doMock('../../src/repositoryService.js', () => ({
      StudyRepositoryService: class {
        scan = vi.fn(async () => ({
          repositories: [{
            name: 'study',
            rootUri: 'file:///study',
            problems: [{
              slug: 'two-sum',
              solutionUrl: 'https://www.algodale.com/problems/two-sum/',
              difficulty: 'Easy',
              categories: [],
              blindCategories: [],
              completed: false,
              hasOtherSolutions: false,
              solutions: [],
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
    const controller = new StudyController(
      {} as never,
      { get: () => undefined, update: async () => {} },
    );
    await controller.getState();

    await expect(controller.openAnswer('file:///study', 'two-sum')).resolves.toBe(false);
    await expect(controller.openAnswer('file:///study', 'two-sum')).resolves.toBe(true);
    await expect(controller.openAnswer('file:///study', 'two-sum')).resolves.toBe(true);

    expect(showWarningMessage).toHaveBeenCalledTimes(3);
    expect(showWarningMessage).toHaveBeenNthCalledWith(
      1,
      '정답으로 이동합니다.',
      { modal: true },
      ANSWER_CONFIRM_LABEL,
    );
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(openExternal.mock.calls[0]![0].toString())
      .toBe('https://www.algodale.com/problems/two-sum/');

    controller.dispose();
  });
});
