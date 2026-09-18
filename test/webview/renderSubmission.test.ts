// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSnapshot } from '../../src/shared/contracts';
import { renderApp, type UiState } from '../../src/webview/render';
import { submissionSnapshot } from './renderFixtures';

describe('webview submission', () => {
  let root: HTMLElement;
  let ui: UiState;
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    root = document.querySelector('#app')!;
    ui = {
      query: '',
      filter: 'all',
      groupBy: 'week',
      unpushedOnly: false,
      viewMode: 'list',
      busy: false,
    };
  });

  it('stages and unstages verified-fork solutions from problem cards', () => {
    const post = vi.fn();
    const state = submissionSnapshot();
    renderApp(root, state, ui, post);

    const stageButtons = root.querySelectorAll<HTMLButtonElement>('.stage-button');
    expect(stageButtons).toHaveLength(1);
    const staged = [...stageButtons].find(({ classList }) => classList.contains('active'));
    const workingState: ExtensionSnapshot = {
      ...state,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        problems: repository.problems.map((problem) => ({
          ...problem,
          solutions: problem.solutions.map((solution) =>
            solution.name === 'CaseUser.py'
              ? { ...solution, submissionStatus: 'working' as const }
              : solution,
          ),
        })),
      })),
    };
    staged?.click();
    expect(post).toHaveBeenCalledWith({
      type: 'unstageSolution',
      uri: 'file:///study-a/two-sum/CaseUser.ts',
    });

    renderApp(root, workingState, ui, post);
    const addButton = [...root.querySelectorAll<HTMLButtonElement>('.stage-button')].find(
      (button) => button.getAttribute('aria-label')?.includes('CaseUser.py 커밋에 추가'),
    );
    addButton?.click();
    expect(post).toHaveBeenCalledWith({
      type: 'stageSolution',
      uri: 'file:///study-a/two-sum/CaseUser.py',
    });

    const outdatedState: ExtensionSnapshot = {
      ...state,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        problems: repository.problems.map((problem) => ({
          ...problem,
          solutions: problem.solutions.map((solution) =>
            solution.name === 'CaseUser.ts'
              ? { ...solution, submissionStatus: 'staged-outdated' as const }
              : solution,
          ),
        })),
      })),
    };
    renderApp(root, outdatedState, ui, post);
    root
      .querySelector<HTMLButtonElement>('[aria-label*="CaseUser.ts 최신 수정 다시 추가"]')
      ?.click();
    expect(post).toHaveBeenCalledWith({
      type: 'stageSolution',
      uri: 'file:///study-a/two-sum/CaseUser.ts',
    });
  });

  it('renders the active submission as a single commit rail', () => {
    const post = vi.fn();
    ui.viewMode = 'submission';
    renderApp(root, submissionSnapshot(), ui, post);

    expect(root.querySelector('.submission-view-title')?.textContent).toBe('주차별 제출');
    expect(
      [...root.querySelectorAll('.submission-node-title')].map(({ textContent }) => textContent),
    ).toEqual([
      'PR #77 · 검토 중',
      'origin/week-01',
      'commit 1234567 · 풀이 1개',
      '커밋 준비 · 풀이 1개',
    ]);
    expect(root.textContent).toContain('two-sum/CaseUser.py');
    expect(root.textContent).toContain('two-sum/CaseUser.ts');
    expect(root.textContent).not.toContain('Three Sum');

    (root.querySelector('.submission-commit-input') as HTMLInputElement).value =
      '[CaseUser] WEEK 01 Updated';
    root
      .querySelector<HTMLInputElement>('.submission-commit-input')
      ?.dispatchEvent(new Event('input'));
    const commitButton = [
      ...root.querySelectorAll<HTMLButtonElement>('.submission-action-button'),
    ].find(({ textContent }) => textContent === '이 주차 커밋');
    commitButton?.click();
    expect(post).toHaveBeenCalledWith({
      type: 'commitActiveWeek',
      rootUri: 'file:///study-a',
      message: '[CaseUser] WEEK 01 Updated',
    });
  });

  it('distinguishes a closed unmerged PR and keeps its GitHub link', () => {
    ui.viewMode = 'submission';
    const state = submissionSnapshot();
    const closed: ExtensionSnapshot = {
      ...state,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        submission: {
          ...repository.submission!,
          activePullRequest: undefined,
          pullRequest: {
            ...repository.submission!.pullRequest!,
            status: 'closed-unmerged',
          },
        },
      })),
    };

    renderApp(root, closed, ui, vi.fn());

    expect(root.querySelector('.submission-node-title')?.textContent).toBe(
      'PR #77 · 종료됨 · 미병합',
    );
    expect(
      root.querySelector<HTMLButtonElement>('.pull-request .submission-action-button')?.textContent,
    ).toBe('GitHub에서 열기');
  });

  it('shows a GitHub sign-in button when submission status requires auth', () => {
    const post = vi.fn();
    ui.viewMode = 'submission';
    const state = submissionSnapshot();
    const unavailable: ExtensionSnapshot = {
      ...state,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        submission: {
          ...repository.submission!,
          status: 'unavailable',
          fork: {
            ...repository.submission!.fork,
            status: 'unavailable',
            reason:
              'GitHub API 요청 한도에 걸렸습니다. GitHub으로 로그인하면 상태를 확인할 수 있습니다.',
            needsGitHubSignIn: true,
          },
        },
      })),
    };

    renderApp(root, unavailable, ui, post);

    expect(root.textContent).toContain('GitHub으로 로그인하면');
    const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      ({ textContent }) => textContent === 'GitHub으로 로그인',
    );
    expect(button).toBeDefined();
    button?.click();
    expect(post).toHaveBeenCalledWith({ type: 'signInGitHub' });
  });

  it('does not show a GitHub sign-in button for a generic unavailable fork', () => {
    ui.viewMode = 'submission';
    const state = submissionSnapshot();
    const unavailable: ExtensionSnapshot = {
      ...state,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        submission: {
          ...repository.submission!,
          status: 'unavailable',
          fork: {
            status: 'unavailable',
            reason: '네트워크 오류로 GitHub 상태를 확인할 수 없습니다.',
          },
        },
      })),
    };

    renderApp(root, unavailable, ui, vi.fn());

    expect(root.textContent).toContain('네트워크 오류');
    expect(
      [...root.querySelectorAll('button')].some(
        ({ textContent }) => textContent === 'GitHub으로 로그인',
      ),
    ).toBe(false);
  });

  it('keeps local commits visible while GitHub status is unavailable', () => {
    ui.viewMode = 'submission';
    const state = submissionSnapshot();
    const localFile = state.repositories[0]!.submission!.pendingCommits[0]!.files[0]!;
    const unavailable: ExtensionSnapshot = {
      ...state,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        submission: {
          ...repository.submission!,
          status: 'unavailable',
          branch: 'week-01',
          fork: {
            ...repository.submission!.fork,
            status: 'unavailable',
            reason: 'GitHub 상태를 확인할 수 없습니다.',
          },
          stagedFiles: [],
          forkFiles: [],
          activePullRequest: undefined,
          pullRequest: undefined,
          pendingCommits: [
            {
              hash: 'abcdef0123456789',
              shortHash: 'abcdef0',
              message: '[CaseUser] WEEK 01 Solutions',
              pushed: false,
              files: [localFile],
              otherFiles: [],
              fileInspectionStatus: 'ready',
            },
          ],
          localHistory: {
            status: 'ready',
            baseRef: 'upstream/main',
            mergeBase: 'official-base',
          },
          blockedReason: 'GitHub 상태를 확인할 수 없습니다.',
        },
      })),
    };

    renderApp(root, unavailable, ui, vi.fn());

    expect(root.textContent).toContain('GitHub 상태를 확인할 수 없습니다.');
    expect(root.textContent).toContain('commit abcdef0 · 풀이 1개');
    expect(root.textContent).toContain(localFile.relativePath);
    const push = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      ({ textContent }) => textContent === 'origin에 push',
    );
    expect(push?.disabled).toBe(true);
  });

  it('shows the current week-11 commit and an enabled origin push action', () => {
    ui.viewMode = 'submission';
    const state = submissionSnapshot();
    const slugs = [
      'missing-number',
      'reorder-list',
      'graph-valid-tree',
      'merge-intervals',
      'binary-tree-maximum-path-sum',
    ];
    const current: ExtensionSnapshot = {
      ...state,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        submission: {
          ...repository.submission!,
          status: 'ready',
          branch: 'week-11',
          submissionBranch: 'week-11',
          activeSubmissionWeek: 11,
          stagedFiles: [],
          pendingCommits: [
            {
              hash: '5e06873500000000',
              shortHash: '5e06873',
              message: '[CaseUser] WEEK 11 Solutions',
              pushed: false,
              files: slugs.map((slug) => ({
                name: 'CaseUser.py',
                uri: `file:///study-a/${slug}/CaseUser.py`,
                relativePath: `${slug}/CaseUser.py`,
                slug,
                week: 11,
              })),
              otherFiles: [],
              fileInspectionStatus: 'ready',
            },
          ],
          forkFiles: [],
          otherForkFiles: [],
          activePullRequest: undefined,
          pullRequest: undefined,
          blockedReason: undefined,
          summary: {
            working: 0,
            staged: 0,
            pushNeeded: 5,
            prPending: 0,
            merged: 0,
            unknown: 0,
          },
        },
      })),
    };

    renderApp(root, current, ui, vi.fn());

    expect(root.textContent).toContain('commit 5e06873 · 풀이 5개');
    const push = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      ({ textContent }) => textContent === 'origin에 push',
    );
    expect(push?.disabled).toBe(false);
  });

  it('shows a commit when its file inspection failed', () => {
    ui.viewMode = 'submission';
    const state = submissionSnapshot();
    const failed: ExtensionSnapshot = {
      ...state,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        submission: {
          ...repository.submission!,
          stagedFiles: [],
          forkFiles: [],
          activePullRequest: undefined,
          pullRequest: undefined,
          pendingCommits: [
            {
              hash: 'abcdef0123456789',
              shortHash: 'abcdef0',
              message: 'local commit',
              pushed: false,
              files: [],
              otherFiles: [],
              fileInspectionStatus: 'unavailable',
              fileInspectionReason: '변경 파일을 확인할 수 없습니다: diff failed',
            },
          ],
          blockedReason: '일부 로컬 커밋의 변경 파일을 확인할 수 없어 push할 수 없습니다.',
        },
      })),
    };

    renderApp(root, failed, ui, vi.fn());

    expect(root.textContent).toContain('commit abcdef0 · 풀이 0개');
    expect(root.textContent).toContain('diff failed');
  });

  it('shows a connect CTA when the official remote is missing', () => {
    const post = vi.fn();
    ui.viewMode = 'submission';
    const state = submissionSnapshot();
    const empty: ExtensionSnapshot = {
      ...state,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        submission: {
          ...repository.submission!,
          hasCanonicalRemote: false,
          behindOfficialMain: false,
          stagedFiles: [],
          pendingCommits: [],
          forkFiles: [],
          otherForkFiles: [],
          otherStagedFiles: [],
          activePullRequest: undefined,
          pullRequest: undefined,
          canSync: true,
        },
      })),
    };

    renderApp(root, empty, ui, post);

    expect(root.textContent).toContain('공식 main을 포크에 반영하면');
    const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      ({ textContent }) => textContent === '지금 맞추기',
    );
    expect(button).toBeDefined();
    expect(button?.disabled).toBe(false);
    button?.click();
    expect(post).toHaveBeenCalledWith({
      type: 'syncFork',
      rootUri: 'file:///study-a',
    });
  });

  it('uses the specific sync-disabled reason as the fork sync tooltip', () => {
    ui.viewMode = 'submission';
    const state = submissionSnapshot();
    const onWeekBranch: ExtensionSnapshot = {
      ...state,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        submission: {
          ...repository.submission!,
          branch: 'week-01',
          canSync: false,
          syncDisabledReason: '포크 동기화는 main 브랜치에서만 실행할 수 있습니다.',
        },
      })),
    };

    renderApp(root, onWeekBranch, ui, vi.fn());

    const syncButton = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      ({ textContent }) => textContent === '포크 동기화',
    );
    expect(syncButton?.disabled).toBe(true);
    expect(syncButton?.title).toBe('포크 동기화는 main 브랜치에서만 실행할 수 있습니다.');
  });

  it('shows the sync-disabled reason in the connect empty state', () => {
    const post = vi.fn();
    ui.viewMode = 'submission';
    const state = submissionSnapshot();
    const behind: ExtensionSnapshot = {
      ...state,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        submission: {
          ...repository.submission!,
          behindOfficialMain: true,
          canSync: false,
          syncDisabledReason: '풀이 외 추적 파일 변경을 되돌린 뒤 포크를 동기화해 주세요.',
          blockingTrackedFiles: [
            {
              relativePath: 'README.md',
              kind: 'other',
              state: 'modified',
            },
          ],
          stagedFiles: [],
          pendingCommits: [],
          forkFiles: [],
          otherForkFiles: [],
          otherStagedFiles: [],
          activePullRequest: undefined,
          pullRequest: undefined,
        },
      })),
    };

    renderApp(root, behind, ui, post);

    expect(root.textContent).toContain('공식 main을 포크에 반영하면');
    expect(root.textContent).toContain(
      '풀이 외 추적 파일 변경을 되돌린 뒤 포크를 동기화해 주세요.',
    );
    expect(root.textContent).toContain('README.md');
    const connectButton = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      ({ textContent }) => textContent === '지금 맞추기',
    );
    expect(connectButton?.disabled).toBe(true);
    expect(connectButton?.title).toBe('풀이 외 추적 파일 변경을 되돌린 뒤 포크를 동기화해 주세요.');
    const restore = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      ({ textContent }) => textContent === '풀이 외 변경 되돌리기',
    );
    expect(restore).toBeDefined();
    restore?.click();
    expect(post).toHaveBeenCalledWith({
      type: 'discardOtherTrackedChanges',
      rootUri: 'file:///study-a',
    });
  });

  it('removes merged files from the submission graph while keeping the card badge', () => {
    const state = submissionSnapshot();
    const merged: ExtensionSnapshot = {
      ...state,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        submission: {
          ...repository.submission!,
          activeSubmissionWeek: undefined,
          stagedFiles: [],
          pendingCommits: [],
          forkFiles: [],
          activePullRequest: undefined,
          pullRequest: undefined,
          summary: {
            working: 0,
            staged: 0,
            pushNeeded: 0,
            prPending: 0,
            merged: 2,
            unknown: 0,
          },
        },
        problems: repository.problems.map((problem) => ({
          ...problem,
          solutions: problem.solutions.map((solution) => ({
            ...solution,
            submissionStatus: 'merged' as const,
            pullRequestNumber: undefined,
          })),
        })),
      })),
    };
    ui.viewMode = 'submission';
    renderApp(root, merged, ui, vi.fn());
    expect(root.querySelector('.submission-node')).toBeNull();
    expect(root.textContent).toContain('문제 카드에서 풀이를 커밋에 추가');

    ui.viewMode = 'list';
    renderApp(root, merged, ui, vi.fn());
    expect(root.textContent).toContain('병합 완료');
  });

  it('offers explicit main return only for a merged clean week branch', () => {
    const post = vi.fn();
    const state = submissionSnapshot();
    const merged: ExtensionSnapshot = {
      ...state,
      repositories: state.repositories.map((repository) => ({
        ...repository,
        submission: {
          ...repository.submission!,
          branch: 'week-01',
          activePullRequest: undefined,
          pullRequest: {
            ...repository.submission!.pullRequest!,
            status: 'merged',
          },
          canReturnToMain: true,
        },
      })),
    };
    ui.viewMode = 'submission';
    renderApp(root, merged, ui, post);

    const button = [...root.querySelectorAll<HTMLButtonElement>('.submission-header-button')].find(
      ({ textContent }) => textContent === 'main으로 돌아가 동기화',
    );
    expect(button?.disabled).toBe(false);
    button?.click();
    expect(post).toHaveBeenCalledWith({
      type: 'returnToMainAndSync',
      rootUri: 'file:///study-a',
    });
  });
});
