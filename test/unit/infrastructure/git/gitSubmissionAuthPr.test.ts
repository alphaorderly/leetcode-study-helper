import './submissionTestHarness';
import * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import type { RepositorySubmissionSnapshot } from '../../../../src/shared/contracts';
import {
  harness,
  uri,
  type createRepository,
  githubResponse,
  githubErrorResponse,
} from './submissionTestHarness';
import { GitStatusService } from '../../../../src/infrastructure/git/gitStatusService.js';

describe('GitStatusService authPr', () => {
  it('opens a PR comparison from the week branch to canonical main', async () => {
    const service = new GitStatusService();
    const submission: RepositorySubmissionSnapshot = {
      status: 'ready',
      branch: 'week-01',
      submissionBranch: 'week-01',
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
      summary: {
        working: 0,
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
    };

    await service.openPullRequest(submission, 'CaseUser');

    const url = vi.mocked(vscode.commands.executeCommand).mock.calls[0]?.[1];
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      expect.stringContaining('/DaleStudy/leetcode-study/compare/main...CaseUser:week-01'),
    );
    expect(vscode.env.openExternal).not.toHaveBeenCalled();
    expect(url).toEqual(expect.stringContaining('%23'));
    expect(url).not.toEqual(expect.stringContaining('%2523'));
    expect(new URL(String(url)).searchParams.get('body')).toContain('- [x] #219');
    service.dispose();
  });

  it('rejects an origin whose fetch and push URLs target different repositories', async () => {
    const repository = harness.repository as ReturnType<typeof createRepository>;
    repository.state.remotes[0]!.pushUrl = 'https://github.com/OtherUser/leetcode-study.git';
    const service = new GitStatusService();

    await expect(service.syncFork(uri('file:///study') as never)).rejects.toThrow(
      'fetch/push URL이 동일한 GitHub 저장소',
    );

    expect(repository.fetch).not.toHaveBeenCalled();
    expect(repository.push).not.toHaveBeenCalled();
    service.dispose();
  });

  it('marks GitHub status unavailable and asks for sign-in after an unauthenticated 403', async () => {
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
    expect(result.submission?.fork.needsGitHubSignIn).toBe(true);
    expect(result.submission?.fork.reason).toContain('GitHub으로 로그인');
    service.dispose();
  });

  it('sends the GitHub session token on API requests', async () => {
    harness.getSession.mockResolvedValue({ accessToken: 'token-123' });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const requestUrl = String(input);
      if (requestUrl.includes('/repos/CaseUser/leetcode-study')) {
        return githubResponse({
          fork: true,
          source: { full_name: 'DaleStudy/leetcode-study' },
        });
      }
      if (requestUrl.includes('/git/trees/main')) {
        return githubResponse({ truncated: false, tree: [] });
      }
      if (requestUrl.includes('/compare/')) {
        return githubResponse({ ahead_by: 0, behind_by: 0, files: [], commits: [] });
      }
      return githubResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new GitStatusService();
    const solutionUri = 'file:///study/two-sum/CaseUser.py';

    await service.getStatuses(
      uri('file:///study') as never,
      [solutionUri],
      true,
      [{ name: 'CaseUser.py', uri: solutionUri, slug: 'two-sum', week: 1 }],
      true,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/repos/'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      }),
    );
    expect(harness.getSession).toHaveBeenCalledWith('github', ['public_repo'], {
      createIfNone: false,
      silent: true,
    });
    service.dispose();
  });

  it('prompts for GitHub sign-in and reports success', async () => {
    harness.getSession.mockResolvedValue({ accessToken: 'token-123' });
    const service = new GitStatusService();

    await expect(service.signInGitHub()).resolves.toBe(true);
    expect(harness.getSession).toHaveBeenCalledWith('github', ['public_repo'], {
      createIfNone: true,
    });
    service.dispose();
  });

  it('reports a cancelled GitHub sign-in without throwing', async () => {
    harness.getSession.mockResolvedValue(undefined);
    const service = new GitStatusService();

    await expect(service.signInGitHub()).resolves.toBe(false);
    service.dispose();
  });
});
