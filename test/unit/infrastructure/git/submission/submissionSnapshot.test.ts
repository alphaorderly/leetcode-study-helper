import { describe, expect, it } from 'vitest';
import type {
  SubmissionCommitSnapshot,
  SubmissionFileSnapshot,
} from '../../../../../src/shared/contracts';
import {
  buildReadySubmission,
  buildUnavailableSubmission,
  projectLocalSubmission,
  type LocalSubmissionContext,
} from '../../../../../src/infrastructure/git/submission/submissionSnapshot';

const file: SubmissionFileSnapshot = {
  name: 'CaseUser.py',
  uri: 'file:///study/two-sum/CaseUser.py',
  relativePath: 'two-sum/CaseUser.py',
  slug: 'two-sum',
  week: 1,
};

const commit: SubmissionCommitSnapshot = {
  hash: 'abc1234',
  shortHash: 'abc1234',
  message: 'Week 01 solution',
  pushed: false,
  files: [file],
  otherFiles: [],
  fileInspectionStatus: 'ready',
};

function localContext(overrides: Partial<LocalSubmissionContext> = {}): LocalSubmissionContext {
  const input = {
    files: [file],
    fileByPath: new Map([[file.relativePath, file]]),
    indexPaths: new Set<string>(),
    workingPaths: new Set<string>(),
    conflictPaths: new Set<string>(),
    stagedFiles: [],
    otherStagedFiles: [],
    blockingTrackedFiles: [],
    branch: 'week-01',
    currentBranchWeek: 1,
    requestedSubmissionBranch: 'week-01',
    canonicalRemoteName: 'upstream',
    local: { commits: [commit], history: { status: 'ready' as const } },
    ...overrides,
  };
  return { ...input, ...projectLocalSubmission(input) };
}

function remoteInput(): Parameters<typeof buildReadySubmission>[1] {
  return {
    fork: { status: 'verified' },
    remote: {
      headBranch: 'week-01',
      compareFiles: [],
      compareCommits: [],
      behindBy: 0,
      openPullRequestCount: 0,
      pullRequestFiles: [],
    },
    remoteCommits: [],
    statuses: new Map([[file.uri, 'push-needed']]),
    pullRequestNumbers: new Map(),
    hasBlockingOriginCommits: false,
    hasDirtyTrackedState: false,
    hasUntrackedChanges: false,
    rebaseInProgress: false,
    hasCanonicalRemote: true,
  };
}

describe('submission snapshot composition', () => {
  it('keeps local commits and their validation reason when remote lookup fails', () => {
    const context = localContext({
      local: {
        commits: [{ ...commit, fileInspectionStatus: 'unavailable' }],
        history: { status: 'ready' },
      },
    });
    const result = buildUnavailableSubmission(context, {
      status: 'verified',
      reason: 'HTTP 403',
      needsGitHubSignIn: true,
    });

    expect(result.snapshot).toMatchObject({
      status: 'unavailable',
      pendingCommits: context.local.commits,
      blockedReason: '일부 로컬 커밋의 변경 파일을 확인할 수 없어 push할 수 없습니다.',
      fork: { reason: 'HTTP 403', needsGitHubSignIn: true },
      canSync: false,
      canReturnToMain: false,
    });
    expect(result.statuses.get(file.uri)).toBe('push-needed');
  });

  it('prefers the pushed copy of a commit without duplicating or changing local history', () => {
    const context = localContext();
    const input = remoteInput();
    const pushed = { ...commit, pushed: true };
    input.remoteCommits = [pushed];

    const result = buildReadySubmission(context, input);

    expect(result.snapshot.pendingCommits).toEqual([pushed]);
    expect(context.local.commits).toEqual([commit]);
    expect(context.local.commits[0]?.pushed).toBe(false);
  });

  it('keeps working and staged-outdated states even when the same file has pending commits', () => {
    const working = localContext({ workingPaths: new Set([file.relativePath]) });
    const outdated = localContext({
      indexPaths: new Set([file.relativePath]),
      workingPaths: new Set([file.relativePath]),
    });

    expect(working.localStatuses.get(file.uri)).toBe('working');
    expect(outdated.localStatuses.get(file.uri)).toBe('staged-outdated');
  });

  it('uses the branch week only when no active file has a week', () => {
    const empty = localContext({ local: { commits: [], history: { status: 'ready' } } });
    const mixed = localContext({ stagedFiles: [{ ...file, week: 2 }] });

    expect(empty.localActiveSubmissionWeek).toBe(1);
    expect(mixed.localActiveSubmissionWeek).toBeUndefined();
    expect(buildReadySubmission(mixed, remoteInput()).snapshot).toMatchObject({
      status: 'blocked',
      activeSubmissionWeek: undefined,
      blockedReason: '공식 저장소에 반영되지 않은 풀이가 여러 주차에 걸쳐 있습니다.',
    });
  });

  it('reports a local history failure before remote and staged-file blockers', () => {
    const context = localContext({
      local: { commits: [], history: { status: 'unavailable', reason: '공통 조상 조회 실패' } },
      otherStagedFiles: ['README.md'],
    });
    const input = remoteInput();
    input.remote = { ...input.remote, compareIncomplete: true, openPullRequestCount: 2 };

    expect(buildReadySubmission(context, input).snapshot.blockedReason).toBe('공통 조상 조회 실패');
  });

  it('reports incomplete remote comparison before multiple PRs or other staged files', () => {
    const context = localContext({ otherStagedFiles: ['README.md'] });
    const input = remoteInput();
    input.remote = { ...input.remote, compareIncomplete: true, openPullRequestCount: 2 };

    expect(buildReadySubmission(context, input).snapshot.blockedReason).toBe(
      'GitHub 조회 한도로 origin 변경 파일을 모두 확인할 수 없어 제출할 수 없습니다.',
    );
  });
});
