import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepositorySnapshot } from '../../../../src/shared/contracts';
import type { UsageRecorder } from '../../../../src/shared/telemetry';
import type {
  PythonInspection,
  PythonRunResult,
} from '../../../../src/infrastructure/python/pythonRunnerService';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function eventSource<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    event: (listener: (value: T) => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: (value: T) => {
      for (const listener of listeners) listener(value);
    },
  };
}
const candidate = { id: 'c0m0', label: 'Solution', classLine: 1, methodLine: 2 };
const data = {
  taskId: 'sample',
  questionId: 1,
  entryPoint: 'Solution().answer',
  methodName: 'answer',
  requiredObjects: [],
  test: '',
};
const passed: PythonRunResult = { ok: true, outcome: 'passed', passed: 1, total: 1, durationMs: 1 };

async function setup() {
  vi.useFakeTimers();
  const uri = (name: string) => ({
    toString: () => `file:///study/sample/${name}.py`,
    fsPath: `/study/sample/${name}.py`,
  });
  const editor = eventSource<{ document: { uri: ReturnType<typeof uri> } }>();
  const edits = eventSource<{ document: { uri: ReturnType<typeof uri> } }>();
  vi.doMock('vscode', () => ({
    EventEmitter: class<T> {
      private readonly source = eventSource<T>();
      readonly event = this.source.event;
      fire(value: T) {
        this.source.fire(value);
      }
      dispose() {}
    },
    Uri: { parse: (value: string) => ({ fsPath: value }) },
    window: {
      activeTextEditor: { document: { uri: uri('A') } },
      visibleTextEditors: [],
      onDidChangeActiveTextEditor: editor.event,
    },
    workspace: {
      isTrusted: true,
      textDocuments: ['A', 'B'].map((name) => ({ uri: uri(name), getText: () => 'source' })),
      onDidChangeTextDocument: edits.event,
      onDidChangeConfiguration: eventSource<void>().event,
      onDidGrantWorkspaceTrust: eventSource<void>().event,
      getConfiguration: () => ({ get: () => 'python3' }),
    },
  }));
  const inspect = vi.fn<(...args: unknown[]) => Promise<PythonInspection>>().mockResolvedValue({
    candidates: [candidate],
    missingObjects: [],
  });
  const run = vi.fn<(...args: unknown[]) => Promise<PythonRunResult>>().mockResolvedValue(passed);
  const getProblem = vi.fn(async () => data);
  const operations: Array<{
    markResult: ReturnType<typeof vi.fn>;
    finish: ReturnType<typeof vi.fn>;
  }> = [];
  const usage = {
    begin: vi.fn<UsageRecorder['begin']>(() => {
      const operation = { markResult: vi.fn(), finish: vi.fn() };
      operations.push(operation);
      return operation;
    }),
  };
  const { CurrentProblemSession } =
    await import('../../../../src/application/sessions/currentProblemSession.js');
  const session = new CurrentProblemSession(
    {} as never,
    {
      leetCodeApiService: { getProblem: vi.fn() },
      testDataService: { getProblem },
      pythonRunnerService: { inspect, run, dispose: vi.fn() },
    },
    usage,
  );
  const repositories: RepositorySnapshot[] = [
    {
      rootUri: 'file:///study',
      name: 'study',
      problems: [
        {
          slug: 'sample',
          week: 1,
          difficulty: 'Easy',
          categories: [],
          blindCategories: [],
          completed: true,
          hasOtherSolutions: false,
          solutions: ['A', 'B'].map((name) => ({
            name: `${name}.py`,
            uri: uri(name).toString(),
            gitStatus: 'unknown' as const,
          })),
        },
      ],
    },
  ];
  session.setRepositories(repositories);
  await vi.advanceTimersByTimeAsync(350);
  return {
    session,
    run,
    inspect,
    getProblem,
    usage,
    operations,
    switchFile: () => editor.fire({ document: { uri: uri('B') } }),
    edit: () => edits.fire({ document: { uri: uri('A') } }),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('vscode');
  vi.resetModules();
});

describe('CurrentProblemSession result ownership', () => {
  it('keeps the latest inspection cancellable after an older inspection completes', async () => {
    const { session, inspect, edit, switchFile } = await setup();
    const old = deferred<PythonInspection>();
    const next = deferred<PythonInspection>();
    inspect.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    edit();
    await vi.advanceTimersByTimeAsync(350);
    switchFile();
    await vi.advanceTimersByTimeAsync(350);
    old.resolve({ candidates: [{ ...candidate, id: 'old' }], missingObjects: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.currentSnapshot?.runner.status).toBe('checking');
    const signal = inspect.mock.calls[2]?.at(-1) as AbortSignal;
    session.dispose();
    expect(signal.aborted).toBe(true);
    next.resolve({ candidates: [candidate], missingObjects: [] });
    await vi.advanceTimersByTimeAsync(0);
  });

  it('rejects preparation errors but publishes execution errors with candidates', async () => {
    const { session, getProblem, run, operations } = await setup();
    getProblem.mockRejectedValueOnce(new Error('dataset unavailable'));
    await expect(session.run(candidate.id)).rejects.toThrow('dataset unavailable');
    expect(session.currentSnapshot?.runner.status).toBe('ready');
    expect(run).not.toHaveBeenCalled();
    expect(operations[0]?.finish).toHaveBeenCalledExactlyOnceWith({
      outcome: 'error',
      error_code: 'operation_failed',
      failure_stage: 'prepare',
    });
    run.mockRejectedValueOnce(new Error('process failed'));
    await session.run(candidate.id);
    expect(session.currentSnapshot?.runner).toMatchObject({
      status: 'error',
      message: 'process failed',
      candidates: [candidate],
    });
    expect(operations[1]?.finish).toHaveBeenCalledExactlyOnceWith({
      outcome: 'error',
      error_code: 'runner',
      failure_stage: 'execute',
    });
    session.dispose();
  });

  it('ignores a completed run after switching files', async () => {
    const { session, run, switchFile, operations } = await setup();
    const pending = deferred<PythonRunResult>();
    run.mockReturnValueOnce(pending.promise);
    const running = session.run(candidate.id);
    await vi.advanceTimersByTimeAsync(0);
    const signal = run.mock.calls[0]?.at(-1) as AbortSignal;
    switchFile();
    expect(signal.aborted).toBe(true);
    pending.resolve(passed);
    await running;
    expect(session.currentSnapshot?.solution.name).toBe('B.py');
    expect(session.currentSnapshot?.runner.status).toBe('checking');
    expect(operations[0]?.markResult).not.toHaveBeenCalled();
    expect(operations[0]?.finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'cancelled' });
    session.dispose();
  });

  it('does not release the new run controller when an older run finishes', async () => {
    const { session, run, edit, operations } = await setup();
    const old = deferred<PythonRunResult>();
    const next = deferred<PythonRunResult>();
    run.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const first = session.run(candidate.id);
    await vi.advanceTimersByTimeAsync(0);
    const second = session.run(candidate.id);
    await vi.advanceTimersByTimeAsync(0);
    old.resolve(passed);
    await first;
    expect(session.currentSnapshot?.runner.status).toBe('running');
    const currentSignal = run.mock.calls[1]?.at(-1) as AbortSignal;
    edit();
    expect(currentSignal.aborted).toBe(true);
    next.resolve(passed);
    await second;
    expect(session.currentSnapshot?.runner.status).toBe('checking');
    expect(operations).toHaveLength(2);
    for (const operation of operations) {
      expect(operation.finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'cancelled' });
    }
    session.dispose();
  });

  it('does not start Python when a file changes while test data is loading', async () => {
    const { session, getProblem, run, switchFile, operations } = await setup();
    const pending = deferred<typeof data>();
    getProblem.mockReturnValueOnce(pending.promise);
    const running = session.run(candidate.id);
    switchFile();
    pending.resolve(data);
    await running;
    expect(run).not.toHaveBeenCalled();
    expect(operations[0]?.finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'cancelled' });
    session.dispose();
  });

  it('records only explicit runs and separates a failed assertion from execution failure', async () => {
    const { session, run, usage, operations } = await setup();
    expect(usage.begin).not.toHaveBeenCalled();
    run.mockResolvedValueOnce({
      ok: true,
      outcome: 'failed',
      passed: 1,
      total: 3,
      durationMs: 7,
      assertion: 'private source and test inputs',
      stdout: 'private stdout',
      stderr: 'private stderr',
    });
    await session.run(candidate.id);
    expect(usage.begin).toHaveBeenCalledExactlyOnceWith('test_finished', {
      problem_slug: 'sample',
      study_week: 1,
      language: 'python3',
    });
    expect(operations[0]?.markResult).toHaveBeenCalledExactlyOnceWith({
      outcome: 'failed',
      passed: 1,
      total: 3,
    });
    expect(operations[0]?.finish).toHaveBeenCalledExactlyOnceWith({
      outcome: 'failed',
      passed: 1,
      total: 3,
    });
    session.dispose();
  });

  it.each([
    ['syntax', 'syntax'],
    ['missingObjects', 'missing_objects'],
    ['candidate', 'candidate'],
    ['execution', 'execution'],
    ['unrecognized-private-detail', 'runner'],
  ])('maps the %s protocol failure to a finite error code', async (kind, code) => {
    const { session, run, operations } = await setup();
    run.mockResolvedValueOnce({
      ok: false,
      kind,
      message: 'private diagnostic',
      traceback: 'private traceback',
      stdout: 'private output',
      stderr: 'private error output',
    });
    await session.run(candidate.id);
    expect(operations[0]?.markResult).toHaveBeenCalledExactlyOnceWith({
      outcome: 'error',
      error_code: code,
      failure_stage: 'execute',
    });
    expect(operations[0]?.finish).toHaveBeenCalledExactlyOnceWith({
      outcome: 'error',
      error_code: code,
      failure_stage: 'execute',
    });
    session.dispose();
  });

  it('records rejected candidate validation without invoking Python', async () => {
    const { session, run, operations } = await setup();
    await expect(session.run('not-a-candidate')).rejects.toThrow('풀이 후보');
    expect(run).not.toHaveBeenCalled();
    expect(operations[0]?.finish).toHaveBeenCalledExactlyOnceWith({
      outcome: 'error',
      error_code: 'operation_failed',
      failure_stage: 'validation',
    });
    session.dispose();
  });
});
