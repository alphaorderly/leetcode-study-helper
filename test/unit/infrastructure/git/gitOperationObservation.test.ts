import './submissionTestHarness';
import * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { harness, uri, change, type createRepository } from './submissionTestHarness';
import { GitStatusService } from '../../../../src/infrastructure/git/gitStatusService';
import type {
  GitOperationObserver,
  GitOperationResult,
} from '../../../../src/infrastructure/git/submission/operationObservation';
import type { RepositorySubmissionSnapshot } from '../../../../src/shared/contracts';

const solution = {
  name: 'CaseUser.py',
  uri: 'file:///study/two-sum/CaseUser.py',
  relativePath: 'two-sum/CaseUser.py',
  slug: 'two-sum',
  week: 1,
};

/** 현재 검증을 통과할 Git 상태와 실제 쓰기 경계를 선택합니다. */
function action(kind: 'stage' | 'unstage' | 'commit' | 'push' | 'sync') {
  const repository = harness.repository as ReturnType<typeof createRepository>;
  const service = new GitStatusService();
  const root = uri('file:///study') as never;
  if (kind === 'commit') repository.state.indexChanges = [change('two-sum/CaseUser.py')];
  if (kind === 'push') {
    repository.state.HEAD.name = 'week-01';
    repository.state.HEAD.upstream = undefined;
    repository.state.HEAD.commit = 'local';
    repository.log.mockResolvedValue([
      { hash: 'local', message: 'private message', parents: ['origin'] },
    ]);
    repository.diffBetween.mockResolvedValue([change('two-sum/CaseUser.py')]);
  }
  const write =
    kind === 'stage'
      ? repository.add
      : kind === 'unstage'
        ? repository.revert
        : kind === 'commit'
          ? repository.commit
          : repository.push;
  const run = (observer: GitOperationObserver) => {
    if (kind === 'stage')
      return service.stageSolution(root, uri(solution.uri) as never, 1, [solution], observer);
    if (kind === 'unstage')
      return service.unstageSolution(root, uri(solution.uri) as never, observer);
    if (kind === 'commit')
      return service.commit(root, 'private message', [solution], [solution], observer);
    if (kind === 'push') return service.push(root, [solution], observer);
    return service.syncFork(root, [solution], observer);
  };
  return { repository, service, write, run };
}

describe('Git primary-write observation', () => {
  it.each(['stage', 'unstage', 'commit', 'push', 'sync'] as const)(
    'observes completed %s before a later status error',
    async (kind) => {
      const { repository, service, write, run } = action(kind);
      const failure = new Error('status failed after successful write');
      write.mockImplementationOnce(async () => {
        repository.status.mockRejectedValueOnce(failure);
      });
      const results: GitOperationResult[] = [];
      await expect(
        run((result) => {
          results.push(result);
        }),
      ).rejects.toBe(failure);
      expect(write).toHaveBeenCalledOnce();
      expect(results).toHaveLength(1);
      expect(results[0]?.outcome).toBe('completed');
      expect(JSON.stringify(results)).not.toContain('CaseUser');
      expect(JSON.stringify(results)).not.toContain('private message');
      service.dispose();
    },
  );

  it.each([false, true])(
    'counts unique pushed problems across language files and commits (second problem: %s)',
    async (includeSecond) => {
      const { repository, service } = action('push');
      const javascript = {
        ...solution,
        name: 'CaseUser.js',
        uri: 'file:///study/two-sum/CaseUser.js',
        relativePath: 'two-sum/CaseUser.js',
      };
      const second = {
        ...solution,
        slug: 'contains-duplicate',
        uri: 'file:///study/contains-duplicate/CaseUser.py',
        relativePath: 'contains-duplicate/CaseUser.py',
      };
      const solutions = [solution, javascript, ...(includeSecond ? [second] : [])];
      repository.log.mockResolvedValue([
        { hash: 'local-1', message: 'first', parents: ['origin'] },
        { hash: 'local', message: 'second', parents: ['local-1'] },
      ]);
      repository.diffBetween.mockResolvedValue(
        solutions.map(({ relativePath }) => change(relativePath)),
      );
      const results: GitOperationResult[] = [];
      await service.push(uri('file:///study') as never, solutions, (result) => {
        results.push(result);
      });
      expect(results).toEqual([
        { outcome: 'completed', studyWeek: 1, problemCount: includeSecond ? 2 : 1 },
      ]);
      expect(repository.push).toHaveBeenCalledOnce();
      expect(JSON.stringify(results)).not.toContain('CaseUser');
      service.dispose();
    },
  );

  it('does not report completed commit when the write itself fails', async () => {
    const { service, write, run } = action('commit');
    write.mockRejectedValueOnce(new Error('commit failed'));
    const observer = vi.fn();
    await expect(run(observer)).rejects.toThrow('commit failed');
    expect(observer).not.toHaveBeenCalled();
    service.dispose();
  });

  it('does not let an observer failure change a successful commit', async () => {
    const { service, write, run } = action('commit');
    await expect(
      run(() => {
        throw new Error('optional observer failed');
      }),
    ).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledOnce();
    service.dispose();
  });

  it('distinguishes an existing PR page and a creation form without claiming creation', async () => {
    const service = new GitStatusService();
    const submission = {
      status: 'ready',
      activeSubmissionWeek: 1,
      submissionBranch: 'week-01',
      pendingCommits: [],
      fork: { status: 'verified', owner: 'CaseUser' },
      forkFiles: [solution],
    } as unknown as RepositorySubmissionSnapshot;
    const results: GitOperationResult[] = [];
    await service.openPullRequest(submission, 'private-nickname', (result) => {
      results.push(result);
    });
    await service.openPullRequest(
      {
        ...submission,
        pullRequest: {
          number: 1,
          title: 'private title',
          url: 'https://github.com/private-repo/pull/1',
          week: 1,
          branch: 'week-01',
          status: 'merged',
        },
      },
      'private-nickname',
      (result) => {
        results.push(result);
      },
    );
    expect(results.map(({ prTarget }) => prTarget)).toEqual(['creation_form', 'existing']);
    expect(results.every(({ outcome }) => outcome === 'completed')).toBe(true);
    expect(JSON.stringify(results)).not.toContain('private');
    vi.mocked(vscode.env.openExternal).mockResolvedValueOnce(false);
    const observer = vi.fn();
    await expect(
      service.openPullRequest(
        {
          ...submission,
          pullRequest: {
            number: 1,
            title: '',
            url: 'https://github.com/private-repo/pull/1',
            week: 1,
            branch: 'week-01',
            status: 'open',
          },
        },
        '',
        observer,
      ),
    ).rejects.toThrow();
    expect(observer).not.toHaveBeenCalled();
    service.dispose();
  });
});
