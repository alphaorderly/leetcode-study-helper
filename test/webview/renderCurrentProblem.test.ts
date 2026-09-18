// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSnapshot } from '../../src/shared/contracts';
import { renderApp, type UiState } from '../../src/webview/render';
import { createSnapshot, createCurrentProblem } from './renderFixtures';

describe('webview currentProblem', () => {
  let root: HTMLElement;
  let ui: UiState;
  let snapshot: ExtensionSnapshot;
  let currentProblemBase: ReturnType<typeof createCurrentProblem>;
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
    snapshot = createSnapshot();
    currentProblemBase = createCurrentProblem();
  });

  it('shows list-first navigation for the active solution and requests details on demand', () => {
    const post = vi.fn();
    renderApp(
      root,
      {
        ...snapshot,
        currentProblem: {
          ...currentProblemBase,
          status: 'idle',
        },
      },
      ui,
      post,
    );

    expect(root.querySelector('.view-tab.active')?.textContent).toBe('리스트');
    expect(root.querySelectorAll('.problem-card')).toHaveLength(2);

    const currentProblemButton = [...root.querySelectorAll<HTMLButtonElement>('.view-tab')].find(
      ({ textContent }) => textContent === '현재 문제 보기',
    );
    currentProblemButton?.click();

    expect(ui.viewMode).toBe('currentProblem');
    expect(root.querySelector('.current-problem')?.textContent).toContain('불러오는 중');
    expect(root.querySelector('.loading-state-panel')?.getAttribute('role')).toBe('status');
    expect(root.querySelector('.loading-state-panel .loading-spinner')).not.toBeNull();
    expect(root.querySelector('.loading-description')?.textContent).toContain('문제 정보와 본문');
    expect(root.querySelector('.problem-card')).toBeNull();
    expect(post).toHaveBeenCalledWith({ type: 'loadCurrentProblem' });

    const listButton = [...root.querySelectorAll<HTMLButtonElement>('.view-tab')].find(
      ({ textContent }) => textContent === '리스트',
    );
    listButton?.click();
    expect(ui.viewMode).toBe('list');
    expect(root.querySelectorAll('.problem-card')).toHaveLength(2);
  });

  it('renders loaded problem details and sanitizes remote HTML', () => {
    const post = vi.fn();
    ui.viewMode = 'currentProblem';
    renderApp(
      root,
      {
        ...snapshot,
        currentProblem: {
          ...currentProblemBase,
          status: 'loaded',
          detail: {
            questionId: '1',
            title: 'Two Sum',
            titleSlug: 'two-sum',
            difficulty: 'Easy',
            isPaidOnly: false,
            topicTags: [
              { name: 'Array', slug: 'array' },
              { name: 'Hash Table', slug: 'hash-table' },
            ],
            content: [
              '<p>Find <strong>two numbers</strong>.</p>',
              '<script>globalThis.compromised = true</script>',
              '<img src="https://assets.leetcode.com/example.png" onerror="alert(1)">',
              '<a href="javascript:alert(1)">unsafe link</a>',
            ].join(''),
          },
        },
      },
      ui,
      post,
    );

    expect(root.querySelector('.problem-detail-title')?.textContent).toBe('1. Two Sum');
    expect(
      [...root.querySelectorAll('.problem-topic-tag')].map(({ textContent }) => textContent),
    ).toEqual(['Array', 'Hash Table']);
    expect(root.querySelector('.problem-detail-content strong')?.textContent).toBe('two numbers');
    expect(root.querySelector('.problem-detail-content script')).toBeNull();
    expect(root.querySelector('.problem-detail-content img')?.hasAttribute('onerror')).toBe(false);
    expect(root.querySelector('.problem-detail-content a')?.hasAttribute('href')).toBe(false);

    (root.querySelector('.problem-page-button') as HTMLButtonElement).click();
    expect(post).toHaveBeenCalledWith({ type: 'openProblem', slug: 'two-sum' });
    expect(post).not.toHaveBeenCalledWith({ type: 'loadCurrentProblem' });
  });

  it('shows retry and premium fallback states', () => {
    const post = vi.fn();
    ui.viewMode = 'currentProblem';
    renderApp(
      root,
      {
        ...snapshot,
        currentProblem: {
          ...currentProblemBase,
          status: 'error',
          message: 'API 요청 실패',
        },
      },
      ui,
      post,
    );

    expect(root.querySelector('.problem-detail-error')?.textContent).toContain('API 요청 실패');
    (root.querySelector('.secondary-button') as HTMLButtonElement).click();
    expect(post).toHaveBeenCalledWith({ type: 'loadCurrentProblem' });

    renderApp(
      root,
      {
        ...snapshot,
        currentProblem: {
          ...currentProblemBase,
          slug: 'premium-problem',
          status: 'loaded',
          detail: {
            questionId: '999',
            title: 'Premium Problem',
            titleSlug: 'premium-problem',
            difficulty: 'Hard',
            isPaidOnly: true,
            topicTags: [],
          },
        },
      },
      ui,
      vi.fn(),
    );

    expect(root.querySelector('.problem-detail-state')?.textContent).toContain(
      '본문은 LeetCode에서 공개되지 않습니다',
    );
    expect(root.querySelector('.problem-detail-content')).toBeNull();
  });

  it('runs the selected Python solution candidate from the problem detail', () => {
    const post = vi.fn();
    ui.viewMode = 'currentProblem';
    renderApp(
      root,
      {
        ...snapshot,
        currentProblem: {
          ...currentProblemBase,
          status: 'loaded',
          runner: {
            status: 'ready',
            candidates: [
              ...currentProblemBase.runner.candidates,
              {
                id: 'c1m0',
                label: 'Solution #2 · twoSum · 20번째 줄',
                classLine: 19,
                methodLine: 20,
              },
            ],
            selectedCandidateId: 'c1m0',
          },
          detail: {
            questionId: '1',
            title: 'Two Sum',
            titleSlug: 'two-sum',
            difficulty: 'Easy',
            isPaidOnly: false,
            topicTags: [],
            content: '<p>Problem</p>',
          },
        },
      },
      ui,
      post,
    );

    const select = root.querySelector('.runner-candidate') as HTMLSelectElement;
    expect(select.value).toBe('c1m0');
    select.value = 'c0m0';
    (root.querySelector('.runner-button') as HTMLButtonElement).click();
    expect(post).toHaveBeenCalledWith({
      type: 'runCurrentSolution',
      candidateId: 'c0m0',
    });
    expect(root.querySelector('.runner-title')?.textContent).toBe('로컬 Python 풀이 테스트');
    expect(root.textContent).not.toContain('OS 보안 샌드박스가 아니며');
  });

  it('shows object requirements only when the current problem needs them', () => {
    ui.viewMode = 'currentProblem';
    renderApp(
      root,
      {
        ...snapshot,
        currentProblem: {
          ...currentProblemBase,
          status: 'error',
          message: '본문 요청 실패',
          runner: {
            status: 'unavailable',
            reason: 'LeetCode에서는 숨겨서 제공하는 ListNode 정의가 이 파일에 필요합니다.',
            missingObjects: ['ListNode'],
          },
        },
      },
      ui,
      vi.fn(),
    );

    expect(root.textContent).toContain('본문 요청 실패');
    expect(root.querySelector('.runner-unavailable')?.textContent).toContain('ListNode');
    expect((root.querySelector('.runner-unavailable') as HTMLElement).dataset.missingObjects).toBe(
      'ListNode',
    );
  });

  it('renders dataset pass and first-failure results', () => {
    ui.viewMode = 'currentProblem';
    const detail = {
      questionId: '1',
      title: 'Two Sum',
      titleSlug: 'two-sum',
      difficulty: 'Easy',
      isPaidOnly: false,
      topicTags: [],
      content: '<p>Problem</p>',
    };
    renderApp(
      root,
      {
        ...snapshot,
        currentProblem: {
          ...currentProblemBase,
          status: 'loaded',
          detail,
          runner: {
            ...currentProblemBase.runner,
            status: 'passed',
            passed: 12,
            total: 12,
            durationMs: 34,
          },
        },
      },
      ui,
      vi.fn(),
    );
    expect(root.querySelector('.runner-passed')?.textContent).toContain(
      '12/12개 테스트 통과 · 34ms',
    );

    renderApp(
      root,
      {
        ...snapshot,
        currentProblem: {
          ...currentProblemBase,
          status: 'loaded',
          detail,
          runner: {
            ...currentProblemBase.runner,
            status: 'failed',
            passed: 1,
            total: 3,
            failedCase: 2,
            assertion: 'assert candidate(2) == 3',
            durationMs: 5,
          },
        },
      },
      ui,
      vi.fn(),
    );
    expect(root.querySelector('.runner-failed')?.textContent).toContain('2번째 테스트 실패');
    expect(root.querySelector('.runner-assertion')?.textContent).toBe('assert candidate(2) == 3');
  });

  it('keeps a runner status row while a test is running', () => {
    ui.viewMode = 'currentProblem';
    renderApp(
      root,
      {
        ...snapshot,
        currentProblem: {
          ...currentProblemBase,
          status: 'loaded',
          detail: {
            questionId: '1',
            title: 'Two Sum',
            titleSlug: 'two-sum',
            difficulty: 'Easy',
            isPaidOnly: false,
            topicTags: [],
            content: '<p>Problem</p>',
          },
          runner: {
            ...currentProblemBase.runner,
            status: 'running',
          },
        },
      },
      ui,
      vi.fn(),
    );

    expect(root.querySelector('.runner-running')?.textContent).toBe('테스트를 실행하는 중…');
    expect(root.querySelector('.runner-running.loading-state')?.getAttribute('role')).toBe(
      'status',
    );
    expect(root.querySelector('.runner-running .loading-spinner')).not.toBeNull();
    expect((root.querySelector('.runner-button') as HTMLButtonElement).disabled).toBe(true);
  });
});
