import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ExtensionSnapshot,
  RepositorySubmissionSnapshot,
} from '../../../src/shared/contracts';
import { SubmissionCommands } from '../../../src/application/submissionCommands';
import type { GitOperationObserver } from '../../../src/infrastructure/git/submission/operationObservation';
import type { UsageEventName, UsageProperties, UsageRecorder } from '../../../src/shared/telemetry';

const windowMocks = vi.hoisted(() => ({ showWarningMessage: vi.fn() }));
vi.mock('vscode', () => ({
  Uri: { parse: (value: string) => ({ fsPath: new URL(value).pathname, toString: () => value }) },
  workspace: { isTrusted: true },
  window: windowMocks,
}));

const gitMocks = {
  prepareNextWeek: vi.fn(async () => {}),
  preparationAction: vi.fn(async () => {}),
  stageSolution: vi.fn(async () => {}),
  unstageSolution: vi.fn(async () => {}),
  commit: vi.fn(async () => {}),
  push: vi.fn(async () => {}),
  syncFork: vi.fn(async () => {}),
  discardOtherTrackedChanges: vi.fn(async () => {}),
  returnToMainAndSync: vi.fn(async () => {}),
  openPullRequest: vi.fn(async () => {}),
  signInGitHub: vi.fn(async () => true),
};
afterEach(() => {
  vi.clearAllMocks();
});

async function createCommands(submission: RepositorySubmissionSnapshot, usage?: UsageRecorder) {
  const snapshot: ExtensionSnapshot = {
    nickname: 'CaseUser',
    preferredLanguage: 'python3',
    languages: [],
    issues: [],
    workspaceTrusted: true,
    repositories: [
      {
        name: 'study',
        rootUri: 'file:///study',
        submission,
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
                submissionStatus: 'working',
              },
            ],
          },
          {
            slug: 'three-sum',
            week: 2,
            difficulty: 'Medium',
            categories: [],
            blindCategories: [],
            completed: true,
            hasOtherSolutions: false,
            solutions: [
              {
                name: 'CaseUser.py',
                uri: 'file:///study/three-sum/CaseUser.py',
                gitStatus: 'unpushed',
                submissionStatus: 'working',
              },
            ],
          },
        ],
      },
    ],
  };
  let current = snapshot;
  const refresh = vi.fn(async (_forceStatus?: boolean, _forceRemote?: boolean) => {
    void _forceStatus;
    void _forceRemote;
  });
  const refreshAll = vi.fn(async () => current);
  const commands = new SubmissionCommands(() => current, gitMocks, refresh, refreshAll, usage);
  return {
    commands,
    snapshot,
    refresh,
    refreshAll,
    setSnapshot: (value: ExtensionSnapshot) => {
      current = value;
    },
  };
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
    forkFiles: [
      {
        name: 'CaseUser.py',
        uri: 'file:///study/two-sum/CaseUser.py',
        relativePath: 'two-sum/CaseUser.py',
        slug: 'two-sum',
        week: 1,
      },
    ],
    otherForkFiles: [],
    activePullRequest: {
      number: 77,
      title: '[CaseUser] WEEK 01 Solutions',
      url: 'https://github.com/DaleStudy/leetcode-study/pull/77',
      week: 1,
      branch: 'week-01',
      status: 'open',
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
    canReturnToMain: false,
    hasCanonicalRemote: true,
    behindOfficialMain: false,
    blockingTrackedFiles: [],
    ...overrides,
  };
}

describe('SubmissionCommands', () => {
  it('blocks staging a different week while an open PR is active', async () => {
    const { commands } = await createCommands(submission());

    await expect(commands.stageSolution('file:///study/three-sum/CaseUser.py')).rejects.toThrow(
      'Week 1 제출이 끝나기 전에는 Week 2',
    );

    expect(gitMocks.stageSolution).not.toHaveBeenCalled();
  });

  it('allows another solution from the active week to be staged', async () => {
    const { commands } = await createCommands(submission());

    await commands.stageSolution('file:///study/two-sum/CaseUser.py');

    expect(gitMocks.stageSolution).toHaveBeenCalledOnce();
  });

  it('delegates the fresh push-range guard to the Git service', async () => {
    gitMocks.push.mockRejectedValueOnce(
      new Error('Week 1 제출이 끝나기 전에는 Week 2 커밋을 push할 수 없습니다.'),
    );
    const { commands } = await createCommands(
      submission({
        pendingCommits: [
          {
            hash: 'abcdef123456',
            shortHash: 'abcdef1',
            message: '[CaseUser] WEEK 02 Solutions',
            pushed: false,
            files: [
              {
                name: 'CaseUser.py',
                uri: 'file:///study/three-sum/CaseUser.py',
                relativePath: 'three-sum/CaseUser.py',
                slug: 'three-sum',
                week: 2,
              },
            ],
            otherFiles: [],
          },
        ],
      }),
    );

    await expect(commands.pushActiveWeek('file:///study')).rejects.toThrow(
      'Week 1 제출이 끝나기 전에는 Week 2',
    );

    expect(gitMocks.push).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/study' }),
      expect.arrayContaining([
        expect.objectContaining({ slug: 'two-sum', week: 1 }),
        expect.objectContaining({ slug: 'three-sum', week: 2 }),
      ]),
      expect.any(Function),
    );
  });

  it('blocks committing a file changed after it was staged', async () => {
    const stagedFile = {
      name: 'CaseUser.py',
      uri: 'file:///study/two-sum/CaseUser.py',
      relativePath: 'two-sum/CaseUser.py',
      slug: 'two-sum',
      week: 1,
    };
    const { commands, snapshot } = await createCommands(
      submission({
        stagedFiles: [stagedFile],
        forkFiles: [],
        activePullRequest: undefined,
      }),
    );
    const current = snapshot;
    current.repositories[0]!.problems[0]!.solutions[0]!.submissionStatus = 'staged-outdated';

    await expect(
      commands.commitActiveWeek('file:///study', '[CaseUser] WEEK 01 Solutions'),
    ).rejects.toThrow('스테이징 후 수정된 풀이');

    expect(gitMocks.commit).not.toHaveBeenCalled();
  });

  it('delegates an approved merged-branch return to the Git service', async () => {
    const { commands } = await createCommands(
      submission({
        branch: 'week-01',
        canReturnToMain: true,
      }),
    );

    await commands.returnToMainAndSync('file:///study');

    expect(gitMocks.prepareNextWeek).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/study' }),
      expect.arrayContaining([
        expect.objectContaining({ slug: 'two-sum' }),
        expect.objectContaining({ slug: 'three-sum' }),
      ]),
      expect.objectContaining({ nickname: 'CaseUser' }),
      expect.any(Function),
    );
  });

  it('confirms the exact non-solution paths before restoring them', async () => {
    windowMocks.showWarningMessage.mockResolvedValueOnce('변경 되돌리기');
    const { commands } = await createCommands(
      submission({
        blockingTrackedFiles: [
          {
            relativePath: 'README.md',
            kind: 'other',
            state: 'modified',
          },
          {
            relativePath: 'two-sum/CaseUser.py',
            kind: 'solution',
            state: 'modified',
          },
        ],
      }),
    );

    await commands.discardOtherTrackedChanges('file:///study');

    expect(windowMocks.showWarningMessage).toHaveBeenCalledWith(
      '풀이 외 추적 파일 1개의 변경을 되돌립니다.',
      expect.objectContaining({
        modal: true,
        detail: expect.stringContaining('README.md'),
      }),
      '변경 되돌리기',
    );
    expect(gitMocks.discardOtherTrackedChanges).toHaveBeenCalledOnce();
  });

  it('does not restore non-solution changes when confirmation is cancelled', async () => {
    windowMocks.showWarningMessage.mockResolvedValueOnce(undefined);
    const { commands } = await createCommands(
      submission({
        blockingTrackedFiles: [
          {
            relativePath: 'README.md',
            kind: 'other',
            state: 'modified',
          },
        ],
      }),
    );

    await commands.discardOtherTrackedChanges('file:///study');

    expect(gitMocks.discardOtherTrackedChanges).not.toHaveBeenCalled();
  });

  it('signs in to GitHub and refreshes remote submission state', async () => {
    gitMocks.signInGitHub.mockResolvedValueOnce(true);
    const { commands, refresh } = await createCommands(submission());

    await commands.signInGitHub();

    expect(gitMocks.signInGitHub).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith(true, true);
  });

  it('does not refresh when GitHub sign-in is cancelled', async () => {
    gitMocks.signInGitHub.mockResolvedValueOnce(false);
    const { commands, refresh } = await createCommands(submission());

    await commands.signInGitHub();

    expect(gitMocks.signInGitHub).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('SubmissionCommands dependency boundaries', () => {
  it('reads the replacement snapshot for each command', async () => {
    const { commands, snapshot, refresh, setSnapshot } = await createCommands(submission());
    await commands.stageSolution('file:///study/two-sum/CaseUser.py');
    setSnapshot({ ...snapshot, repositories: [] });
    await expect(commands.stageSolution('file:///study/two-sum/CaseUser.py')).rejects.toThrow(
      '요청한 풀이가 현재 워크스페이스에 없습니다.',
    );
    expect(gitMocks.stageSolution).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('refreshes only after staging finishes and propagates service failures', async () => {
    let finish!: () => void;
    gitMocks.stageSolution.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { commands, refresh } = await createCommands(submission());
    const pending = commands.stageSolution('file:///study/two-sum/CaseUser.py');
    expect(refresh).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(refresh).toHaveBeenCalledExactlyOnceWith(true);
    refresh.mockClear();
    gitMocks.push.mockRejectedValueOnce(new Error('push failed'));
    await expect(commands.pushActiveWeek('file:///study')).rejects.toThrow('push failed');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps fork sync, full scan and remote refresh in order', async () => {
    const { commands, refresh, refreshAll } = await createCommands(submission({ canSync: true }));
    const order: string[] = [];
    gitMocks.syncFork.mockImplementationOnce(async () => {
      order.push('sync');
    });
    refreshAll.mockImplementationOnce(async () => {
      order.push('scan');
      return {} as ExtensionSnapshot;
    });
    refresh.mockImplementationOnce(async () => {
      order.push('git');
    });
    await commands.syncFork('file:///study');
    expect(order).toEqual(['sync', 'scan', 'git']);
    expect(refresh).toHaveBeenCalledExactlyOnceWith(true, true);
  });

  it('propagates refresh failures and does not start the following refresh', async () => {
    const { commands, refresh, refreshAll } = await createCommands(submission({ canSync: true }));
    refreshAll.mockRejectedValueOnce(new Error('scan failed'));
    await expect(commands.syncFork('file:///study')).rejects.toThrow('scan failed');
    expect(gitMocks.syncFork).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });
  it('refreshes both solutions and Git state when preparation fails', async () => {
    const { commands, refresh, refreshAll } = await createCommands(
      submission({ status: 'blocked' }),
    );
    gitMocks.prepareNextWeek.mockRejectedValueOnce(new Error('recoverable conflict'));
    await expect(commands.prepareNextWeek('file:///study')).rejects.toThrow('recoverable conflict');
    expect(refreshAll).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith(true, true);
  });

  it('allows recovery during remote failure but rejects a foreign workspace root', async () => {
    const { commands } = await createCommands(submission({ status: 'unavailable' }));
    await commands.preparationAction('file:///study', 'id', 'continue');
    expect(gitMocks.preparationAction).toHaveBeenCalledOnce();
    await expect(commands.preparationAction('file:///foreign', 'id', 'cancel')).rejects.toThrow(
      '워크스페이스',
    );
    expect(gitMocks.preparationAction).toHaveBeenCalledOnce();
  });
});

/** 명령이 결과와 최종 전송을 각각 한 번 알리는지 확인하는 메모리 통계 포트입니다. */
function recordingUsage() {
  const starts: Array<{ name: UsageEventName; properties?: UsageProperties }> = [];
  const results: UsageProperties[] = [];
  const finishes: Array<UsageProperties | undefined> = [];
  const usage: UsageRecorder = {
    begin(name, properties) {
      starts.push({ name, properties });
      return {
        markResult(result) {
          results.push(result);
        },
        finish(result) {
          finishes.push(result);
        },
      };
    },
  };
  return { usage, starts, results, finishes };
}

describe('SubmissionCommands usage receipts', () => {
  it('tracks validation failure once without transmitting the private error or input', async () => {
    const observed = recordingUsage();
    const { commands } = await createCommands(submission(), observed.usage);
    await expect(commands.stageSolution('file:///secret/private.py')).rejects.toThrow();
    expect(observed.starts).toEqual([
      { name: 'submission_action_finished', properties: { action: 'stage' } },
    ]);
    expect(observed.results).toEqual([]);
    expect(observed.finishes).toEqual([
      {
        outcome: 'error',
        failure_stage: 'validation',
        followup_failed: false,
        error_code: 'operation_failed',
      },
    ]);
    expect(JSON.stringify(observed)).not.toContain('secret');
  });

  it('keeps the first push receipt when status fails after a completed write', async () => {
    const observed = recordingUsage();
    const failure = new Error('private origin URL and branch');
    gitMocks.push.mockImplementationOnce(async (...args: unknown[]) => {
      const notify = args.at(-1) as GitOperationObserver;
      notify({ outcome: 'completed', studyWeek: 1 });
      notify({ outcome: 'completed', studyWeek: 2 });
      throw failure;
    });
    const { commands, refresh } = await createCommands(submission(), observed.usage);
    await expect(commands.pushActiveWeek('file:///study')).rejects.toBe(failure);
    expect(observed.results).toHaveLength(1);
    expect(observed.results[0]).toMatchObject({ outcome: 'completed', study_week: 1 });
    expect(observed.finishes).toEqual([
      {
        outcome: 'error',
        failure_stage: 'post_operation',
        followup_failed: true,
        error_code: 'operation_failed',
      },
    ]);
    expect(refresh).not.toHaveBeenCalled();
    expect(JSON.stringify(observed)).not.toContain('private origin');
  });

  it('distinguishes a successful sync from a later snapshot refresh failure', async () => {
    const observed = recordingUsage();
    const { commands, refreshAll } = await createCommands(
      submission({ canSync: true }),
      observed.usage,
    );
    refreshAll.mockRejectedValueOnce(new Error('scan failed'));
    await expect(commands.syncFork('file:///study')).rejects.toThrow('scan failed');
    expect(observed.starts).toEqual([{ name: 'fork_sync_finished', properties: {} }]);
    expect(observed.results).toHaveLength(1);
    expect(observed.results[0]).toMatchObject({ outcome: 'completed' });
    expect(observed.finishes[0]).toMatchObject({ failure_stage: 'refresh', followup_failed: true });
  });

  it('records one cancelled preparation through the legacy return alias', async () => {
    const observed = recordingUsage();
    gitMocks.prepareNextWeek.mockImplementationOnce(async (...args: unknown[]) => {
      (args.at(-1) as GitOperationObserver)({ outcome: 'cancelled', sourceWeek: 1 });
    });
    const { commands, refresh, refreshAll } = await createCommands(submission(), observed.usage);
    await commands.returnToMainAndSync('file:///study');
    expect(observed.starts).toEqual([
      { name: 'next_week_preparation_finished', properties: { action: 'prepare' } },
    ]);
    expect(observed.results).toHaveLength(1);
    expect(observed.results[0]).toMatchObject({ outcome: 'cancelled', source_week: 1 });
    expect(observed.finishes).toEqual([undefined]);
    expect(refreshAll).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('preserves a recovery receipt and normal refreshes when the original preparation throws', async () => {
    const observed = recordingUsage();
    const failure = new Error('private conflict filename');
    gitMocks.preparationAction.mockImplementationOnce(async (...args: unknown[]) => {
      (args.at(-1) as GitOperationObserver)({
        outcome: 'awaiting_recovery',
        phase: 'applying',
        targetWeek: 2,
      });
      throw failure;
    });
    const { commands, refresh, refreshAll } = await createCommands(submission(), observed.usage);
    await expect(
      commands.preparationAction('file:///study', 'private-journal-id', 'continue'),
    ).rejects.toBe(failure);
    expect(observed.results[0]).toMatchObject({
      outcome: 'awaiting_recovery',
      phase: 'applying',
      target_week: 2,
    });
    expect(observed.finishes[0]).toMatchObject({
      failure_stage: 'execute',
      followup_failed: false,
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(refreshAll).toHaveBeenCalledOnce();
    expect(JSON.stringify(observed)).not.toContain('private');
  });

  it('keeps a completed original restoration distinct from dismissed cancellation', async () => {
    const observed = recordingUsage();
    gitMocks.preparationAction.mockImplementationOnce(async (...args: unknown[]) => {
      (args.at(-1) as GitOperationObserver)({ outcome: 'completed', phase: 'cancelled' });
    });
    const { commands } = await createCommands(submission(), observed.usage);
    await commands.preparationAction('file:///study', 'id', 'cancel');
    expect(observed.results[0]).toMatchObject({ outcome: 'completed', phase: 'cancelled' });
    expect(observed.starts[0]?.properties).toEqual({ action: 'cancel' });
    expect(observed.finishes).toHaveLength(1);
  });

  it('maps the recovery action spelling without exposing the journal identity', async () => {
    const observed = recordingUsage();
    const { commands } = await createCommands(submission(), observed.usage);
    await commands.preparationAction('file:///study', 'private-journal-id', 'existingWeek');
    expect(observed.starts[0]?.properties).toEqual({ action: 'existing_week' });
    expect(JSON.stringify(observed)).not.toContain('private-journal-id');
  });

  it('continues Git operations when the injected recorder throws', async () => {
    const usage: UsageRecorder = {
      begin() {
        throw new Error('recorder unavailable');
      },
    };
    const { commands } = await createCommands(submission(), usage);
    await commands.pushActiveWeek('file:///study');
    expect(gitMocks.push).toHaveBeenCalledOnce();
    const broken: UsageRecorder = {
      begin() {
        return {
          markResult() {
            throw new Error('bad result');
          },
          finish() {
            throw new Error('bad finish');
          },
        };
      },
    };
    const next = await createCommands(submission(), broken);
    await next.commands.pushActiveWeek('file:///study');
    expect(gitMocks.push).toHaveBeenCalledTimes(2);
  });
});
