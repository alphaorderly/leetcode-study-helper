import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepositorySnapshot } from '../../src/core/types';

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

const solutionUri = 'file:///study/two-sum/CaseUser.py';
const repositories: RepositorySnapshot[] = [{
  name: 'study',
  rootUri: 'file:///study',
  problems: [{
    slug: 'two-sum',
    week: 1,
    difficulty: 'Easy',
    categories: [],
    blindCategories: [],
    completed: true,
    hasOtherSolutions: false,
    solutions: [{ name: 'CaseUser.py', uri: solutionUri, gitStatus: 'pushed' }],
  }],
}];

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('vscode');
});

describe('CurrentProblemSession', () => {
  it('debounces edit bursts and aborts stale Python inspection', async () => {
    vi.useFakeTimers();
    const activeEditor = eventSource<{ document: { uri: { toString(): string } } } | undefined>();
    const textDocument = eventSource<{ document: { uri: { toString(): string } } }>();
    const configuration = eventSource<{ affectsConfiguration(value: string): boolean }>();
    const trust = eventSource<void>();
    const uri = {
      toString: () => solutionUri,
      fsPath: '/study/two-sum/CaseUser.py',
      path: '/study/two-sum/CaseUser.py',
    };
    class TestEventEmitter<T> {
      private readonly source = eventSource<T>();
      readonly event = this.source.event;
      fire(value: T): void { this.source.fire(value); }
      dispose(): void {}
    }
    vi.doMock('vscode', () => ({
      EventEmitter: TestEventEmitter,
      Uri: {
        parse: () => uri,
        joinPath: () => uri,
      },
      window: {
        activeTextEditor: { document: { uri } },
        visibleTextEditors: [],
        onDidChangeActiveTextEditor: activeEditor.event,
      },
      workspace: {
        isTrusted: true,
        textDocuments: [{ uri, getText: () => 'class Solution: pass' }],
        onDidChangeTextDocument: textDocument.event,
        onDidChangeConfiguration: configuration.event,
        onDidGrantWorkspaceTrust: trust.event,
        getConfiguration: () => ({ get: () => 'python3' }),
        fs: { readFile: vi.fn() },
      },
    }));

    let inspectionSignal: AbortSignal | undefined;
    const inspect = vi.fn((...args: unknown[]) => {
      inspectionSignal = args.at(-1) as AbortSignal;
      return new Promise<never>((_resolve, reject) => {
        inspectionSignal?.addEventListener('abort', () => {
          const error = new Error('cancelled');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    });
    const { CurrentProblemSession } = await import('../../src/currentProblemSession.js');
    const session = new CurrentProblemSession(uri as never, {
      leetCodeApiService: { getProblem: vi.fn() },
      testDataService: {
        getProblem: vi.fn(async () => ({
          taskId: '1',
          questionId: 1,
          entryPoint: 'Solution().twoSum',
          methodName: 'twoSum',
          test: '',
          requiredObjects: [],
        })),
      },
      pythonRunnerService: {
        inspect,
        run: vi.fn(),
        dispose: vi.fn(),
      },
    });
    session.setRepositories(repositories);

    await vi.advanceTimersByTimeAsync(200);
    textDocument.fire({ document: { uri } });
    await vi.advanceTimersByTimeAsync(200);
    textDocument.fire({ document: { uri } });
    await vi.advanceTimersByTimeAsync(349);
    expect(inspect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(inspectionSignal?.aborted).toBe(false);

    textDocument.fire({ document: { uri } });
    expect(inspectionSignal?.aborted).toBe(true);
    await Promise.resolve();
    session.dispose();
  });
});
