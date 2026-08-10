import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubSubmissionClient } from '../../src/git/githubSubmissionClient';

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GitHubSubmissionClient branch state', () => {
  it('keeps remote submission cache entries separate per week branch', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/git/trees/main')) {
        return response({ truncated: false, tree: [] });
      }
      if (url.includes('/compare/')) {
        return response({ ahead_by: 1, behind_by: 0, files: [], commits: [] });
      }
      return response([]);
    }));
    const client = new GitHubSubmissionClient();
    const remote = {
      owner: 'CaseUser',
      repository: 'leetcode-study',
      url: 'https://github.com/CaseUser/leetcode-study.git',
    };

    await client.getRemoteSubmission(remote, 'week-01', false);
    await client.getRemoteSubmission(remote, 'week-01', false);
    await client.getRemoteSubmission(remote, 'week-02', false);

    expect(requests.filter((url) => url.includes(':week-01'))).toHaveLength(1);
    expect(requests.filter((url) => url.includes(':week-02'))).toHaveLength(1);
    client.dispose();
  });

  it('prefers the one open fork PR over a requested different week', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/pulls?state=open')) {
        return response([{
          number: 77,
          title: '[CaseUser] WEEK 01 Solutions',
          html_url: 'https://github.com/DaleStudy/leetcode-study/pull/77',
          state: 'open',
          head: {
            ref: 'week-01',
            user: { login: 'CaseUser' },
            repo: { full_name: 'CaseUser/leetcode-study' },
          },
        }]);
      }
      if (url.includes('/pulls/77/files')) {
        return response([{ filename: 'two-sum/CaseUser.py' }]);
      }
      if (url.includes('/git/trees/main')) {
        return response({ truncated: false, tree: [] });
      }
      if (url.includes('/compare/')) {
        return response({ ahead_by: 1, behind_by: 0, files: [], commits: [] });
      }
      return response([]);
    }));
    const client = new GitHubSubmissionClient();

    const state = await client.getRemoteSubmission({
      owner: 'CaseUser',
      repository: 'leetcode-study',
      url: 'https://github.com/CaseUser/leetcode-study.git',
    }, 'week-02', true);

    expect(state.headBranch).toBe('week-01');
    expect(state.activePullRequest?.number).toBe(77);
    expect(state.openPullRequestCount).toBe(1);
    client.dispose();
  });
});
