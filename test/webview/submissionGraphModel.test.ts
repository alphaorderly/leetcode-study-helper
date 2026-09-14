import { describe, expect, it } from 'vitest';
import type { RepositorySubmissionSnapshot } from '../../src/shared/contracts';
import {
  blockingFilesModel,
  pullRequestAction,
  remoteWriteDisabled,
  resolveSubmissionRepository,
  submissionGraphFacts,
  submissionGraphLayout,
  submissionHeaderActions,
} from '../../src/webview/state/submissionGraphModel';
import type { UiState } from '../../src/webview/state/viewTypes';

const emptySummary = {
  working: 0,
  staged: 0,
  pushNeeded: 0,
  prPending: 0,
  merged: 0,
  unknown: 0,
};

function submission(
  overrides: Partial<RepositorySubmissionSnapshot> = {},
): RepositorySubmissionSnapshot {
  return {
    status: 'ready',
    fork: {
      status: 'verified',
      owner: 'CaseUser',
      repository: 'leetcode-study',
      originUrl: 'https://github.com/CaseUser/leetcode-study.git',
    },
    stagedFiles: [],
    otherStagedFiles: [],
    pendingCommits: [],
    forkFiles: [],
    otherForkFiles: [],
    summary: emptySummary,
    canSync: true,
    canReturnToMain: false,
    hasCanonicalRemote: true,
    behindOfficialMain: false,
    blockingTrackedFiles: [],
    ...overrides,
  };
}

const ui: UiState = {
  query: '',
  filter: 'all',
  groupBy: 'week',
  unpushedOnly: false,
  viewMode: 'submission',
  busy: false,
};

describe('submissionGraphLayout', () => {
  it('loads while the snapshot is missing or still checking', () => {
    expect(submissionGraphLayout(undefined)).toEqual({
      type: 'loading',
      title: '제출 상태를 확인하는 중…',
      description: undefined,
    });
    expect(submissionGraphLayout(submission({ status: 'checking' })).type).toBe('loading');
  });

  it('stops at unsupported and auth-only when there is no local work', () => {
    expect(
      submissionGraphLayout(
        submission({
          status: 'unsupported',
          fork: { status: 'unsupported', reason: 'not a fork' },
        }),
      ),
    ).toEqual({ type: 'unsupported', reason: 'not a fork' });
    expect(
      submissionGraphLayout(
        submission({
          status: 'unavailable',
          fork: { status: 'unavailable', reason: 'sign in', needsGitHubSignIn: true },
        }),
      ),
    ).toEqual({
      type: 'auth-only',
      reason: 'sign in',
      needsSignIn: true,
    });
  });

  it('keeps a timeline when GitHub is unavailable but local commits exist', () => {
    expect(
      submissionGraphLayout(
        submission({
          status: 'unavailable',
          pendingCommits: [
            {
              hash: 'abc',
              shortHash: 'abc',
              message: 'w',
              pushed: false,
              files: [],
              otherFiles: [],
            },
          ],
        }),
      ).type,
    ).toBe('timeline');
  });

  it('chooses empty-sync when official main is missing or behind', () => {
    expect(submissionGraphLayout(submission({ hasCanonicalRemote: false })).type).toBe(
      'empty-sync',
    );
    expect(submissionGraphLayout(submission({ behindOfficialMain: true })).type).toBe('empty-sync');
    expect(submissionGraphLayout(submission()).type).toBe('empty-idle');
  });
});

describe('submissionGraphFacts and actions', () => {
  it('treats unavailable as a remote lock, not a missing timeline', () => {
    const facts = submissionGraphFacts(
      submission({
        status: 'unavailable',
        blockedReason: 'blocked',
        pendingCommits: [
          {
            hash: 'abc',
            shortHash: 'abc',
            message: 'w',
            pushed: false,
            files: [],
            otherFiles: [],
          },
        ],
      }),
    );
    expect(facts.remoteUnavailable).toBe(true);
    expect(facts.hasUnpushed).toBe(true);
    expect(facts.hasTimeline).toBe(true);
    expect(remoteWriteDisabled(ui, facts)).toBe(true);
  });

  it('disables PR creation until unpushed commits and fork files are ready', () => {
    const current = submission({
      pendingCommits: [
        {
          hash: 'abc',
          shortHash: 'abc',
          message: 'w',
          pushed: false,
          files: [],
          otherFiles: [],
        },
      ],
    });
    const action = pullRequestAction('file:///study', current, submissionGraphFacts(current), ui);
    expect(action.disabled).toBe(true);
    expect(action.title).toBe('로컬 커밋을 origin에 먼저 push해 주세요.');
  });

  it('only busy-disables opening an existing pull request', () => {
    const current = submission({
      pullRequest: {
        number: 7,
        title: 'week',
        url: 'https://example.test/7',
        branch: 'week-01',
        status: 'closed-unmerged',
      },
      status: 'unavailable',
      blockedReason: 'blocked',
    });
    expect(
      pullRequestAction('file:///study', current, submissionGraphFacts(current), ui).disabled,
    ).toBe(false);
    expect(
      pullRequestAction('file:///study', current, submissionGraphFacts(current), {
        ...ui,
        busy: true,
      }).disabled,
    ).toBe(true);
  });

  it('shows return-to-main only on week branches', () => {
    const repository = {
      name: 'study',
      rootUri: 'file:///study',
      problems: [],
      submission: submission({ branch: 'week-11', canReturnToMain: false }),
    };
    expect(submissionHeaderActions(repository, ui).returnToMain?.disabled).toBe(true);
    expect(
      submissionHeaderActions({ ...repository, submission: submission({ branch: 'main' }) }, ui)
        .returnToMain,
    ).toBeUndefined();
  });

  it('groups blocking files by kind and conflict state', () => {
    const model = blockingFilesModel([
      { relativePath: 'notes.md', kind: 'other', state: 'modified' },
      { relativePath: 'two-sum/a.py', kind: 'solution', state: 'staged' },
      { relativePath: 'conflict.py', kind: 'other', state: 'conflict' },
      { relativePath: 'ok.py', kind: 'solution', state: 'modified' },
    ]);
    expect(model?.otherFiles.map(({ relativePath }) => relativePath)).toEqual(['notes.md']);
    expect(model?.stagedSolutions).toHaveLength(1);
    expect(model?.conflicts).toHaveLength(1);
  });

  it('prefers the selected repository, then a verified fork', () => {
    const unverified = {
      name: 'a',
      rootUri: 'file:///a',
      problems: [],
      submission: submission({ fork: { status: 'unavailable' } }),
    };
    const verified = {
      name: 'b',
      rootUri: 'file:///b',
      problems: [],
      submission: submission(),
    };
    expect(resolveSubmissionRepository([unverified, verified], 'file:///a')).toBe(unverified);
    expect(resolveSubmissionRepository([unverified, verified], undefined)).toBe(verified);
  });
});
