import './submissionTestHarness';
import { describe, expect, it, vi } from 'vitest';
import { change, harness, uri, type createRepository } from './submissionTestHarness';
import { GitStatusService } from '../../../../src/infrastructure/git/gitStatusService.js';

const solutionUri = 'file:///study/to-lower-case/CaseUser.py';
const solution = { name: 'CaseUser.py', uri: solutionUri, slug: 'to-lower-case', week: 0 };

describe('GitStatusService onboarding submission status', () => {
  it('selects week-00 for an onboarding solution staged on main', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.indexChanges = [change('to-lower-case/CaseUser.py')];
    const service = new GitStatusService();

    const result = await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      [solution],
      true,
    );

    expect(result.submission).toMatchObject({
      status: 'ready',
      submissionBranch: 'week-00',
      activeSubmissionWeek: 0,
      stagedFiles: [expect.objectContaining({ uri: solutionUri, week: 0 })],
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/compare/main...CaseUser:week-00'),
      expect.anything(),
    );
    service.dispose();
  });

  it('allows a committed onboarding solution to be pushed from week-00', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.HEAD.name = 'week-00';
    repository.state.HEAD.commit = 'onboarding-tip';
    repository.state.HEAD.upstream = undefined;
    repository.getMergeBase.mockResolvedValue('official-base');
    repository.log.mockResolvedValue([
      { hash: 'onboarding-tip', message: '[CaseUser] Onboarding', parents: ['official-base'] },
    ]);
    repository.diffBetween.mockResolvedValue([change('to-lower-case/CaseUser.py')]);
    const service = new GitStatusService();

    const result = await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      [solution],
      true,
    );

    expect(result.submission).toMatchObject({
      status: 'ready',
      branch: 'week-00',
      submissionBranch: 'week-00',
      activeSubmissionWeek: 0,
      pendingCommits: [
        expect.objectContaining({ message: '[CaseUser] Onboarding', pushed: false }),
      ],
    });
    expect(result.submissionStatuses?.get(solutionUri)).toBe('push-needed');
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/compare/main...CaseUser:week-00'),
      expect.anything(),
    );
    service.dispose();
  });
});
