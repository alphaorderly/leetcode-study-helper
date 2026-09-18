import './submissionTestHarness';
import { describe, expect, it, vi } from 'vitest';
import {
  harness,
  uri,
  change,
  type createRepository,
  githubErrorResponse,
} from './submissionTestHarness';
import { GitStatusService } from '../../../../src/infrastructure/git/gitStatusService.js';

describe('GitStatusService status LocalHistory', () => {
  it('shows a local week commit from the merge-base when local main has diverged', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    const paths = [
      'missing-number/CaseUser.py',
      'reorder-list/CaseUser.py',
      'graph-valid-tree/CaseUser.py',
      'merge-intervals/CaseUser.py',
      'binary-tree-maximum-path-sum/CaseUser.py',
    ];
    repository.state.HEAD.name = 'week-11';
    repository.state.HEAD.commit = 'week-11-tip';
    repository.state.HEAD.upstream = undefined;
    repository.state.refs.find(({ name }) => name === 'main')!.commit = 'fork-main';
    repository.state.refs.find(({ name }) => name === 'upstream/main')!.commit = 'official-newer';
    repository.getMergeBase.mockImplementation(async (ref1: string, ref2: string) =>
      ref1 === 'HEAD' && ref2 === 'upstream/main' ? 'official-base' : 'origin',
    );
    repository.log.mockImplementation(async (options?: { range?: string }) =>
      options?.range === 'official-base..HEAD'
        ? [
            {
              hash: 'week-11-tip',
              message: '[CaseUser] WEEK 11 Solutions',
              parents: ['official-base'],
            },
          ]
        : [],
    );
    repository.diffBetween.mockImplementation(async (ref1?: string, ref2?: string) =>
      ref1 === 'official-base' && ref2 === 'week-11-tip' ? paths.map(change) : [],
    );
    const service = new GitStatusService();
    const solutions = paths.map((relativePath) => ({
      name: 'CaseUser.py',
      uri: `file:///study/${relativePath}`,
      slug: relativePath.split('/')[0]!,
      week: 11,
    }));

    const result = await service.getStatuses(
      uri('file:///study') as never,
      solutions.map(({ uri: solutionUri }) => solutionUri),
      true,
      solutions,
      true,
    );

    expect(result.submission?.localHistory).toMatchObject({
      status: 'ready',
      baseRef: 'upstream/main',
      mergeBase: 'official-base',
    });
    expect(result.submission?.pendingCommits).toHaveLength(1);
    expect(result.submission?.pendingCommits[0]).toMatchObject({
      shortHash: 'week-11',
      pushed: false,
      fileInspectionStatus: 'ready',
    });
    expect(result.submission?.pendingCommits[0]?.files).toHaveLength(5);
    expect(result.submission?.activeSubmissionWeek).toBe(11);
    expect(result.submission?.summary.pushNeeded).toBe(5);
    expect(repository.log).toHaveBeenCalledWith(
      expect.objectContaining({
        range: 'official-base..HEAD',
      }),
    );
    service.dispose();
  });

  it('keeps local commits visible when GitHub is unavailable', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'week-01';
    repository.state.HEAD.commit = 'local-tip';
    repository.state.HEAD.upstream = undefined;
    repository.getMergeBase.mockResolvedValue('official-base');
    repository.log.mockResolvedValue([
      {
        hash: 'local-tip',
        message: '[CaseUser] WEEK 01 Solutions',
        parents: ['official-base'],
      },
    ]);
    repository.diffBetween.mockResolvedValue([change('two-sum/CaseUser.py')]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => githubErrorResponse(403)),
    );
    const service = new GitStatusService();
    const solutionUri = 'file:///study/two-sum/CaseUser.py';

    const result = await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      [{ name: 'CaseUser.py', uri: solutionUri, slug: 'two-sum', week: 1 }],
      true,
    );

    expect(result.submission?.status).toBe('unavailable');
    expect(result.submission?.pendingCommits).toHaveLength(1);
    expect(result.submission?.summary.pushNeeded).toBe(1);
    service.dispose();
  });

  it('surfaces local log and commit diff failures instead of hiding them', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'week-01';
    repository.state.HEAD.commit = 'local-tip';
    repository.state.HEAD.upstream = undefined;
    repository.getMergeBase.mockResolvedValue('official-base');
    repository.log.mockRejectedValueOnce(new Error('log failed'));
    const service = new GitStatusService();
    const solutionUri = 'file:///study/two-sum/CaseUser.py';
    const solutions = [
      {
        name: 'CaseUser.py',
        uri: solutionUri,
        slug: 'two-sum',
        week: 1,
      },
    ];

    const logFailure = await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      solutions,
      true,
    );

    expect(logFailure.submission?.localHistory).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('log failed'),
    });
    expect(logFailure.submission?.blockedReason).toContain('log failed');

    repository.log.mockResolvedValueOnce([
      {
        hash: 'local-tip',
        message: 'local solution',
        parents: ['official-base'],
      },
    ]);
    repository.diffBetween.mockRejectedValueOnce(new Error('diff failed'));

    const diffFailure = await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      solutions,
      true,
    );

    expect(diffFailure.submission?.pendingCommits).toHaveLength(1);
    expect(diffFailure.submission?.pendingCommits[0]).toMatchObject({
      fileInspectionStatus: 'unavailable',
      fileInspectionReason: expect.stringContaining('diff failed'),
    });
    expect(diffFailure.submission?.blockedReason).toContain('변경 파일');
    service.dispose();
  });
});
