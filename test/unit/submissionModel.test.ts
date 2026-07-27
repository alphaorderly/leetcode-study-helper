import { describe, expect, it } from 'vitest';
import type { SubmissionFileSnapshot } from '../../src/core/types';
import {
  localSubmissionStatuses,
  projectSubmissionStatuses,
  summaryForStatuses,
} from '../../src/git/submissionModel';
import type { RemoteSubmissionState } from '../../src/git/githubSubmissionClient';

function file(name: string): SubmissionFileSnapshot {
  return {
    name,
    uri: `file:///study/two-sum/${name}`,
    relativePath: `two-sum/${name}`,
    slug: 'two-sum',
    week: 1,
  };
}

describe('submission status projection', () => {
  it('keeps local conflict and index states ahead of remote progress', () => {
    const conflicted = file('Conflict.py');
    const outdated = file('Outdated.py');
    const staged = file('Staged.py');
    const working = file('Working.py');
    const pending = file('Pending.py');
    const open = file('Open.py');
    const merged = file('Merged.py');
    const files = [
      conflicted,
      outdated,
      staged,
      working,
      pending,
      open,
      merged,
    ];
    const indexPaths = new Set([
      conflicted.relativePath,
      outdated.relativePath,
      staged.relativePath,
    ]);
    const workingPaths = new Set([
      outdated.relativePath,
      working.relativePath,
    ]);
    const conflictPaths = new Set([conflicted.relativePath]);
    const remote: RemoteSubmissionState = {
      compareFiles: [
        { filename: conflicted.relativePath, status: 'modified' },
        { filename: open.relativePath, status: 'added' },
      ],
      compareCommits: [],
      behindBy: 0,
      openPullRequestCount: 1,
      activePullRequest: {
        number: 77,
        title: 'Week 1',
        html_url: 'https://github.com/DaleStudy/leetcode-study/pull/77',
      },
      pullRequestFiles: [open.relativePath],
      canonicalFilePaths: new Set([merged.relativePath]),
    };

    const { statuses, pullRequestNumbers } = projectSubmissionStatuses({
      files,
      indexPaths,
      workingPaths,
      conflictPaths,
      pendingPaths: new Set([pending.relativePath]),
      remote,
    });

    expect(Object.fromEntries(statuses)).toEqual({
      [conflicted.uri]: 'conflict',
      [outdated.uri]: 'staged-outdated',
      [staged.uri]: 'staged',
      [working.uri]: 'working',
      [pending.uri]: 'push-needed',
      [open.uri]: 'pr-open',
      [merged.uri]: 'merged',
    });
    expect(pullRequestNumbers.get(open.uri)).toBe(77);
    expect(summaryForStatuses(statuses)).toEqual({
      working: 2,
      staged: 1,
      pushNeeded: 1,
      prPending: 1,
      merged: 1,
      unknown: 1,
    });
  });

  it('projects local-only state when GitHub status is unavailable', () => {
    const staged = file('Staged.py');
    const working = file('Working.py');
    const statuses = localSubmissionStatuses({
      files: [staged, working],
      indexPaths: new Set([staged.relativePath]),
      workingPaths: new Set([working.relativePath]),
      conflictPaths: new Set(),
    });

    expect(statuses.get(staged.uri)).toBe('staged');
    expect(statuses.get(working.uri)).toBe('working');
  });
});
