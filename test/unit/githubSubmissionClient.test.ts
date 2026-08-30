import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GitHubSubmissionClient,
  parseConsistentRemote,
  resolveCanonicalRemoteName,
} from '../../src/git/githubSubmissionClient';

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({ message: 'error' }),
  } as Response;
}

const CANONICAL_URL = 'https://github.com/DaleStudy/leetcode-study.git';

describe('resolveCanonicalRemoteName', () => {
  it('rejects a remote when either configured URL cannot be parsed', () => {
    expect(parseConsistentRemote({
      name: 'origin',
      fetchUrl: 'https://github.com/CaseUser/leetcode-study.git',
      pushUrl: 'not-a-github-url',
    })).toBeUndefined();
    expect(parseConsistentRemote({
      name: 'origin',
      fetchUrl: 'not-a-github-url',
      pushUrl: 'git@github.com:CaseUser/leetcode-study.git',
    })).toBeUndefined();
  });

  it('returns undefined when no remote points at the canonical repository', () => {
    expect(resolveCanonicalRemoteName([{
      name: 'origin',
      fetchUrl: 'https://github.com/CaseUser/leetcode-study.git',
    }])).toBeUndefined();
  });

  it('finds a canonical remote even when it is not named upstream', () => {
    expect(resolveCanonicalRemoteName([{
      name: 'origin',
      fetchUrl: 'https://github.com/CaseUser/leetcode-study.git',
    }, {
      name: 'official',
      fetchUrl: CANONICAL_URL,
    }])).toBe('official');
  });

  it('prefers the remote named upstream when several URLs are canonical', () => {
    expect(resolveCanonicalRemoteName([{
      name: 'official',
      fetchUrl: CANONICAL_URL,
    }, {
      name: 'upstream',
      fetchUrl: 'git@github.com:DaleStudy/leetcode-study.git',
    }])).toBe('upstream');
  });

  it('rejects a remote named upstream that does not point at the canonical repository', () => {
    expect(() => resolveCanonicalRemoteName([{
      name: 'official',
      fetchUrl: CANONICAL_URL,
    }, {
      name: 'upstream',
      fetchUrl: 'https://github.com/OtherOrg/leetcode-study.git',
    }])).toThrow('기존 upstream이 DaleStudy/leetcode-study를 가리키지 않습니다.');
  });
});

const remote = {
  owner: 'CaseUser',
  repository: 'leetcode-study',
  url: 'https://github.com/CaseUser/leetcode-study.git',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GitHubSubmissionClient branch state', () => {
  it('loads every page of open PRs and PR files', async () => {
    const firstPagePulls = Array.from({ length: 100 }, (_, index) => ({
      number: index + 1,
      title: `Other ${index + 1}`,
      html_url: `https://github.com/DaleStudy/leetcode-study/pull/${index + 1}`,
      state: 'open' as const,
      head: {
        ref: 'not-a-week',
        repo: { full_name: 'OtherUser/leetcode-study' },
      },
    }));
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      const page = new URL(url).searchParams.get('page');
      if (url.includes('/pulls?state=open') && page === '1') {
        return response(firstPagePulls);
      }
      if (url.includes('/pulls?state=open') && page === '2') {
        return response([{
          number: 101,
          title: '[CaseUser] WEEK 01 Solutions',
          html_url: 'https://github.com/DaleStudy/leetcode-study/pull/101',
          state: 'open',
          head: {
            ref: 'week-01',
            user: { login: 'CaseUser' },
            repo: { full_name: 'CaseUser/leetcode-study' },
          },
        }]);
      }
      if (url.includes('/pulls/101/files') && page === '1') {
        return response(Array.from(
          { length: 100 },
          (_, index) => ({ filename: `problem-${index + 1}/CaseUser.py` }),
        ));
      }
      if (url.includes('/pulls/101/files') && page === '2') {
        return response([{ filename: 'problem-101/CaseUser.py' }]);
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

    const state = await client.getRemoteSubmission(remote, 'week-01', true);

    expect(state.openPullRequestCount).toBe(1);
    expect(state.pullRequestFiles).toHaveLength(101);
    expect(requests.some((url) => url.includes('/pulls?state=open') && url.includes('page=2')))
      .toBe(true);
    expect(requests.some((url) => url.includes('/pulls/101/files') && url.includes('page=2')))
      .toBe(true);
    client.dispose();
  });

  it('marks compare results incomplete at the GitHub file limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/git/trees/main')) {
        return response({ truncated: false, tree: [] });
      }
      if (url.includes(':week-01')) {
        return response({
          ahead_by: 1,
          behind_by: 0,
          total_commits: 1,
          files: Array.from(
            { length: 300 },
            (_, index) => ({ filename: `problem-${index}/CaseUser.py`, status: 'added' }),
          ),
          commits: [{ sha: 'commit', commit: {}, parents: [{ sha: 'base' }] }],
        });
      }
      if (url.includes('/compare/')) {
        return response({ ahead_by: 0, behind_by: 0, files: [], commits: [] });
      }
      return response([]);
    }));
    const client = new GitHubSubmissionClient();

    const state = await client.getRemoteSubmission(remote, 'week-01', true);

    expect(state.compareIncomplete).toBe(true);
    client.dispose();
  });

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

describe('GitHubSubmissionClient authentication', () => {
  it('ends a stalled GitHub request at the configured timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('request timed out', 'AbortError'));
        });
      })
    ));
    const client = new GitHubSubmissionClient();

    try {
      const identityPromise = client.getForkIdentity(remote, true);
      await vi.advanceTimersByTimeAsync(8_000);
      const identity = await identityPromise;

      expect(identity.status).toBe('unavailable');
      expect(identity.reason).toContain('request timed out');
    } finally {
      client.dispose();
      vi.useRealTimers();
    }
  });

  it('sends a bearer token when an access token is available', async () => {
    const fetchMock = vi.fn(async () => response({ fork: false }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new GitHubSubmissionClient(async () => 'token-123');

    await client.getForkIdentity(remote, true);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/repos/CaseUser/leetcode-study'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      }),
    );
    client.dispose();
  });

  it('marks unauthenticated 403 responses as needing sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(403)));
    const client = new GitHubSubmissionClient();

    const identity = await client.getForkIdentity(remote, true);

    expect(identity.status).toBe('unavailable');
    expect(identity.needsGitHubSignIn).toBe(true);
    expect(identity.reason).toContain('GitHub으로 로그인');
    client.dispose();
  });

  it('does not ask for sign-in when an authenticated request is forbidden', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(403)));
    const client = new GitHubSubmissionClient(async () => 'token-123');

    const identity = await client.getForkIdentity(remote, true);

    expect(identity.status).toBe('unavailable');
    expect(identity.needsGitHubSignIn).toBeFalsy();
    expect(identity.reason).toBe('GitHub 상태 확인 실패 (403)');
    client.dispose();
  });

  it('throws a sign-in error for unauthenticated 403 compare requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(403)));
    const client = new GitHubSubmissionClient();

    await expect(client.getRemoteSubmission(remote, 'week-01', true))
      .rejects.toMatchObject({
        name: 'GitHubRequestError',
        status: 403,
        needsSignIn: true,
      });
    client.dispose();
  });
});
