import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ExtensionSnapshot,
  RepositorySubmissionSnapshot,
} from '../../../src/shared/contracts';
import { SubmissionCommands } from '../../../src/application/submissionCommands';

const windowMocks = vi.hoisted(() => ({ showWarningMessage: vi.fn() }));
vi.mock('vscode', () => ({
  Uri: { parse: (value: string) => ({ fsPath: new URL(value).pathname, toString: () => value }) },
  workspace: { isTrusted: true },
  window: windowMocks,
}));

const gitMocks = {
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

async function createCommands(submission: RepositorySubmissionSnapshot) {
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
  const commands = new SubmissionCommands(() => current, gitMocks, refresh, refreshAll);
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

    expect(gitMocks.returnToMainAndSync).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/study' }),
      expect.arrayContaining([
        expect.objectContaining({ slug: 'two-sum' }),
        expect.objectContaining({ slug: 'three-sum' }),
      ]),
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
});
