import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepositorySnapshot } from '../../../../src/shared/contracts';
import type {
  SolutionGitStatusResult,
  GitStatusService,
} from '../../../../src/infrastructure/git/gitStatusService';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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

const repository: RepositorySnapshot = {
  rootUri: 'file:///study',
  name: 'study',
  problems: [
    {
      slug: 'two-sum',
      difficulty: 'Easy',
      categories: [],
      blindCategories: [],
      completed: true,
      hasOtherSolutions: false,
      solutions: [{ name: 'User.py', uri: 'file:///study/two-sum/User.py', gitStatus: 'unknown' }],
    },
  ],
};
const gitResult: SolutionGitStatusResult = { statuses: new Map(), remoteName: 'origin' };

async function setup() {
  vi.useFakeTimers();
  const gitEvents = eventSource<void>();
  const fileCreated = eventSource<{ path: string }>();
  vi.doMock('vscode', () => ({
    EventEmitter: class<T> {
      private readonly source = eventSource<T>();
      readonly event = this.source.event;
      fire(value: T) {
        this.source.fire(value);
      }
      dispose() {}
    },
    Uri: { parse: (value: string) => ({ toString: () => value }) },
    RelativePattern: class {
      constructor(
        readonly folder: unknown,
        readonly pattern: string,
      ) {}
    },
    workspace: {
      workspaceFolders: [{ uri: { path: '/study', toString: () => 'file:///study' } }],
      onDidChangeWorkspaceFolders: eventSource<void>().event,
      createFileSystemWatcher: ({ pattern }: { pattern: string }) => ({
        onDidCreate: pattern === '*/*' ? fileCreated.event : eventSource<{ path: string }>().event,
        onDidChange: eventSource<{ path: string }>().event,
        onDidDelete: eventSource<{ path: string }>().event,
        dispose() {},
      }),
    },
  }));
  const scan = vi.fn(async () => ({ repositories: [repository], issues: [] }));
  const refreshProblem = vi.fn(async (value: RepositorySnapshot) => value);
  const getStatuses = vi.fn<GitStatusService['getStatuses']>().mockResolvedValue(gitResult);
  const { RepositoryRefreshSession } =
    await import('../../../../src/application/sessions/repositoryRefreshSession.js');
  const session = new RepositoryRefreshSession(
    { scan, refreshProblem } as never,
    { getStatuses, onDidChange: gitEvents.event } as never,
    () => 'User',
  );
  return { session, scan, getStatuses, gitEvents, refreshProblem, fileCreated };
}

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('vscode');
  vi.resetModules();
});

describe('RepositoryRefreshSession coordination', () => {
  it('coalesces file bursts by problem and shares an in-flight problem refresh', async () => {
    const { session, refreshProblem, fileCreated } = await setup();
    await session.refresh('User');
    await vi.advanceTimersByTimeAsync(0);
    const pending = deferred<RepositorySnapshot>();
    refreshProblem.mockReturnValueOnce(pending.promise);
    fileCreated.fire({ path: '/study/two-sum/User.py' });
    await vi.advanceTimersByTimeAsync(100);
    fileCreated.fire({ path: '/study/two-sum/User.ts' });
    await vi.advanceTimersByTimeAsync(149);
    expect(refreshProblem).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const sameRequest = session.refreshProblem('file:///study', 'two-sum', true);
    expect(refreshProblem).toHaveBeenCalledTimes(1);
    pending.resolve(repository);
    await sameRequest;
    session.dispose();
  });

  it('publishes the scan before Git and accumulates force flags for the following request', async () => {
    const { session, getStatuses } = await setup();
    const pending = deferred<SolutionGitStatusResult>();
    getStatuses.mockReturnValueOnce(pending.promise);
    const first = await session.refresh('User');
    expect(first.repositories[0]?.problems[0]?.solutions[0]?.gitStatus).toBe('checking');
    const statusRefresh = session.refreshGitStatuses(true, false);
    const remoteRefresh = session.refreshGitStatuses(false, true);
    pending.resolve(gitResult);
    await Promise.all([statusRefresh, remoteRefresh]);
    expect(getStatuses).toHaveBeenCalledTimes(2);
    expect(getStatuses.mock.calls[1]?.[2]).toBe(true);
    expect(getStatuses.mock.calls[1]?.[4]).toBe(true);
    session.dispose();
  });

  it('drops a Git result for an old repository array and retries with the latest scan', async () => {
    const { session, scan, getStatuses } = await setup();
    const old = deferred<SolutionGitStatusResult>();
    const latest = deferred<SolutionGitStatusResult>();
    getStatuses.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const published: string[] = [];
    session.onDidChange((state) => {
      published.push(state.repositories[0]?.gitRemote ?? 'none');
    });
    await session.refresh('User');
    scan.mockResolvedValueOnce({
      repositories: [{ ...repository, name: 'rescanned' }],
      issues: [],
    });
    await session.refresh('User');
    const complete = session.refreshGitStatuses(false, true);
    old.resolve({ ...gitResult, remoteName: 'stale' });
    await vi.advanceTimersByTimeAsync(0);
    expect(published).not.toContain('stale');
    expect(getStatuses).toHaveBeenCalledTimes(2);
    latest.resolve(gitResult);
    await complete;
    expect(session.currentState.repositories[0]?.name).toBe('rescanned');
    expect(session.currentState.repositories[0]?.gitRemote).toBe('origin');
    session.dispose();
  });

  it('debounces full and Git refresh events and cancels pending timers on disposal', async () => {
    const { session, scan, getStatuses, gitEvents } = await setup();
    await session.refresh('User');
    await vi.advanceTimersByTimeAsync(0);
    getStatuses.mockClear();
    gitEvents.fire();
    await vi.advanceTimersByTimeAsync(100);
    gitEvents.fire();
    await vi.advanceTimersByTimeAsync(149);
    expect(getStatuses).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(getStatuses).toHaveBeenCalledTimes(1);
    session.scheduleFullRefresh();
    await vi.advanceTimersByTimeAsync(100);
    session.scheduleFullRefresh();
    await vi.advanceTimersByTimeAsync(150);
    expect(scan).toHaveBeenCalledTimes(2);
    session.scheduleFullRefresh();
    gitEvents.fire();
    session.dispose();
    await vi.advanceTimersByTimeAsync(150);
    expect(scan).toHaveBeenCalledTimes(2);
  });
});
