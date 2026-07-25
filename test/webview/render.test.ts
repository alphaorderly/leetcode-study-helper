// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSnapshot } from '../../src/core/types';
import { renderApp, WebviewRenderer, type UiState } from '../../src/webview/render';

const snapshot: ExtensionSnapshot = {
  nickname: 'CaseUser',
  preferredLanguage: 'python3',
  languages: [
    { id: 'python3', label: 'Python 3', extension: 'py' },
    { id: 'typescript', label: 'TypeScript', extension: 'ts' },
  ],
  workspaceTrusted: true,
  issues: [],
  repositories: [
    {
      name: 'study-a',
      rootUri: 'file:///study-a',
      problems: [
        {
          slug: 'two-sum',
          week: 1,
          difficulty: 'Easy',
          categories: ['Array'],
          blindCategories: ['Array'],
          intendedApproach: 'Use a hash map.',
          solutionUrl: 'https://www.algodale.com/problems/two-sum/',
          completed: true,
          hasOtherSolutions: true,
          solutions: [
            {
              name: 'CaseUser.ts',
              uri: 'file:///study-a/two-sum/CaseUser.ts',
              gitStatus: 'unpushed',
            },
            {
              name: 'CaseUser.py',
              uri: 'file:///study-a/two-sum/CaseUser.py',
              gitStatus: 'pushed',
            },
          ],
        },
        {
          slug: 'three-sum',
          week: 2,
          difficulty: 'Medium',
          categories: ['Array', 'Two Pointers'],
          blindCategories: ['Array'],
          intendedApproach: 'Sort and use two pointers.',
          solutionUrl: 'https://www.algodale.com/problems/3sum/',
          completed: false,
          hasOtherSolutions: false,
          solutions: [],
        },
      ],
      gitRemote: 'origin',
    },
  ],
};

const currentProblemBase = {
  rootUri: 'file:///study-a',
  slug: 'two-sum',
  solution: {
    name: 'CaseUser.py',
    uri: 'file:///study-a/two-sum/CaseUser.py',
    gitStatus: 'pushed' as const,
  },
  runner: {
    status: 'ready' as const,
    candidates: [
      {
        id: 'c0m0',
        label: 'Solution #1 · twoSum · 1번째 줄',
        classLine: 1,
        methodLine: 2,
      },
    ],
    selectedCandidateId: 'c0m0',
  },
};

describe('webview rendering', () => {
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

  it('renders settings, compact controls, and weekly groups', () => {
    const replaceChildren = vi.spyOn(root, 'replaceChildren');
    renderApp(root, snapshot, ui, vi.fn());

    expect(replaceChildren).toHaveBeenCalledTimes(1);
    expect(replaceChildren.mock.calls[0]).toHaveLength(7);
    expect(replaceChildren.mock.calls[0]?.[0]).toBeInstanceOf(HTMLElement);
    expect((root.querySelector('#nickname') as HTMLInputElement).value).toBe('CaseUser');
    expect(root.textContent).toContain('1주차');
    expect(root.textContent).toContain('2주차');
    expect(root.textContent).toContain('Two Sum');
    expect(root.textContent).toContain('Three Sum');
    expect(root.textContent).not.toContain('two-sum');
    expect(root.textContent).not.toContain('three-sum');
    expect(root.textContent).not.toContain('Use a hash map.');
    expect(root.textContent).not.toContain('Array');
    expect(root.textContent).toContain('풀이 없음');
    expect(root.textContent).toContain('카드를 눌러 생성');
    expect(root.textContent).not.toContain('CaseUser.py');
    expect(root.textContent).toContain('origin');
    expect(root.textContent).not.toContain('CaseUser.ts');
    const solutionButtons = [
      ...root.querySelectorAll<HTMLButtonElement>('.solution-button'),
    ];
    expect(solutionButtons.map(({ textContent }) => textContent)).toEqual(['.py', '.ts']);
    expect(solutionButtons[0]?.title).toBe('CaseUser.py 열기');
    expect(solutionButtons[0]?.getAttribute('aria-current')).toBe('true');
    expect(solutionButtons[1]?.title).toBe('CaseUser.ts 열기');
    expect(solutionButtons[1]?.hasAttribute('aria-current')).toBe(false);
    expect(root.querySelector('.solution-file-label')?.textContent).toBe('다른 언어 풀이');
    expect(root.querySelector('.solution-file-buttons')?.getAttribute('role')).toBe('group');
    expect(root.querySelector('.solution-file-buttons')?.getAttribute('aria-label'))
      .toBe('Two Sum 풀이 파일');
    expect(root.querySelectorAll('.solution-status.has-file')).toHaveLength(1);
    expect(root.querySelectorAll('.solution-status.no-file')).toHaveLength(1);
    expect(root.querySelector('.solution-git-status.pushed')).not.toBeNull();
    expect(root.querySelectorAll('.problem-card-action')).toHaveLength(2);
    expect(root.querySelectorAll('.other-solution-button')).toHaveLength(2);
    expect((root.querySelector(
      '.problem-card.completed .other-solution-button',
    ) as HTMLButtonElement).disabled).toBe(false);
    expect((root.querySelector(
      '.problem-card.incomplete .other-solution-button',
    ) as HTMLButtonElement).disabled).toBe(true);
    expect(root.querySelectorAll('.other-solution-button .users-round-icon')).toHaveLength(2);
    expect(root.querySelector('.other-solution-button')?.textContent).toBe('');
    expect(root.querySelector('.other-solution-button')?.getAttribute('aria-label'))
      .toBe('Two Sum 다른 참여자의 풀이 열기');
    expect((root.querySelector('.other-solution-button') as HTMLButtonElement).dataset.tooltip)
      .toBe('다른 참여자의 풀이 열기');
    expect(root.querySelectorAll('.answer-button')).toHaveLength(2);
    expect([...root.querySelectorAll<HTMLButtonElement>('.answer-button')]
      .every(({ disabled }) => !disabled)).toBe(true);
    expect(root.querySelector('.answer-button')?.textContent).toBe('');
    expect(root.querySelectorAll('.answer-button .book-open-icon')).toHaveLength(2);
    expect((root.querySelector('.answer-button') as HTMLButtonElement).dataset.tooltip)
      .toBe('정답 페이지 열기');
    expect(root.querySelector('.answer-button')?.getAttribute('aria-label'))
      .toBe('Two Sum 정답 페이지 열기');
    expect(root.querySelectorAll('.open-page-button')).toHaveLength(2);
    expect(root.querySelectorAll('.open-page-button .external-link-icon')).toHaveLength(2);
    expect(root.querySelector('.open-page-button')?.textContent).toBe('');
    expect((root.querySelector('.open-page-button') as HTMLButtonElement).dataset.tooltip)
      .toBe('LeetCode 페이지 열기');
    expect(root.querySelector('.open-page-button')?.getAttribute('aria-label'))
      .toBe('Two Sum LeetCode 페이지 열기');
    expect(root.querySelectorAll('.delete-button .trash-icon')).toHaveLength(1);
    expect(root.querySelector('.delete-button')?.textContent).toBe('');
    expect((root.querySelector('.delete-button') as HTMLButtonElement).dataset.tooltip)
      .toBe('CaseUser.py 삭제');
    expect(root.querySelector('.delete-button')?.getAttribute('aria-label'))
      .toBe('CaseUser.py 풀이 파일 삭제');
    expect(root.querySelectorAll('.file-icon')).toHaveLength(1);
    expect(root.querySelectorAll('.problem-group.week')).toHaveLength(2);
    expect(root.querySelector('.stats')).toBeNull();
    expect(root.querySelector('.stat-card')).toBeNull();
    expect((root.querySelector('.unpushed-checkbox') as HTMLInputElement).checked)
      .toBe(false);
    expect((root.querySelector('.lint-button') as HTMLButtonElement).textContent)
      .toBe('파일 맨 끝에 빈줄 추가하기');
    expect(root.querySelector('.lint-action')).not.toBeNull();
    expect(root.querySelector('.lint-card')).toBeNull();
    expect(root.querySelector('.repository-title')).toBeNull();
    expect(root.querySelector('.view-tabs')).not.toBeNull();
    expect(root.querySelector('.view-tab.active')?.textContent).toBe('리스트');
    const currentProblemButton = [...root.querySelectorAll<HTMLButtonElement>('.view-tab')]
      .find(({ textContent }) => textContent === '현재 문제 보기');
    expect(currentProblemButton?.disabled).toBe(true);
    expect(currentProblemButton?.title).toContain('풀이 파일을 열면');
    expect(root.textContent).not.toContain('제출 파일 라인린트');
    expect(root.textContent).not.toContain('*.md는 제외됩니다.');
  });

  it('orders solution buttons by the configured language and disables them while busy', () => {
    ui.busy = true;
    renderApp(root, { ...snapshot, preferredLanguage: 'typescript' }, ui, vi.fn());

    const solutionButtons = [
      ...root.querySelectorAll<HTMLButtonElement>('.solution-button'),
    ];
    expect(solutionButtons.map(({ textContent }) => textContent)).toEqual(['.ts', '.py']);
    expect(solutionButtons[0]?.getAttribute('aria-current')).toBe('true');
    expect(solutionButtons[0]?.getAttribute('aria-label'))
      .toBe('CaseUser.ts 풀이 파일 열기');
    expect(solutionButtons.every(({ disabled }) => disabled)).toBe(true);
  });

  it('hides solution buttons for a single code file and Markdown companions', () => {
    const singleSolution = snapshot.repositories[0]!.problems[0]!.solutions[1]!;
    const markdownSolution = {
      name: 'CaseUser.go.md',
      uri: 'file:///study-a/two-sum/CaseUser.go.md',
      gitStatus: 'pushed' as const,
    };
    renderApp(
      root,
      {
        ...snapshot,
        repositories: snapshot.repositories.map((repository) => ({
          ...repository,
          problems: repository.problems.map((problem) =>
            problem.slug === 'two-sum'
              ? { ...problem, solutions: [singleSolution, markdownSolution] }
              : problem,
          ),
        })),
      },
      ui,
      vi.fn(),
    );

    expect(root.querySelector('.solution-file-buttons')).toBeNull();
    expect(root.querySelector('.solution-button')).toBeNull();
  });

  it('does not open the preferred solution from the separated solution area', () => {
    const post = vi.fn();
    renderApp(root, snapshot, ui, post);

    (root.querySelector('.solution-file-section') as HTMLElement).click();
    (root.querySelector('.solution-file-label') as HTMLElement).click();
    expect(post).not.toHaveBeenCalled();

    const typeScriptButton = [...root.querySelectorAll<HTMLButtonElement>('.solution-button')]
      .find(({ textContent }) => textContent === '.ts');
    typeScriptButton?.click();
    expect(post).toHaveBeenCalledExactlyOnceWith({
      type: 'openSolution',
      uri: 'file:///study-a/two-sum/CaseUser.ts',
    });
  });

  it('disables the answer button when the README has no valid answer URL', () => {
    renderApp(
      root,
      {
        ...snapshot,
        repositories: snapshot.repositories.map((repository) => ({
          ...repository,
          problems: repository.problems.map((problem) =>
            problem.slug === 'two-sum'
              ? { ...problem, solutionUrl: undefined }
              : problem,
          ),
        })),
      },
      ui,
      vi.fn(),
    );

    const button = root.querySelector(
      '.problem-card.completed .answer-button',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.dataset.tooltip).toBe('README.md에서 정답 URL을 찾을 수 없습니다.');
  });

  it('keeps the shell and list DOM stable for current-problem patches', () => {
    const renderer = new WebviewRenderer(root, ui, vi.fn());
    renderer.updateState(snapshot);
    const search = root.querySelector('#problem-search');
    const firstCard = root.querySelector('.problem-card');

    renderer.updateCurrentProblem({
      ...currentProblemBase,
      status: 'idle',
    });

    expect(root.querySelector('#problem-search')).toBe(search);
    expect(root.querySelector('.problem-card')).toBe(firstCard);
  });

  it('updates only the runner when loaded problem details are unchanged', () => {
    const post = vi.fn();
    const renderer = new WebviewRenderer(root, ui, post);
    const detail = {
      questionId: '1',
      title: 'Two Sum',
      titleSlug: 'two-sum',
      difficulty: 'Easy',
      isPaidOnly: false,
      topicTags: [],
      content: '<p>Stable detail</p>',
    };
    ui.viewMode = 'currentProblem';
    renderer.updateState({
      ...snapshot,
      currentProblem: {
        ...currentProblemBase,
        status: 'loaded',
        detail,
      },
    });
    const detailNode = root.querySelector('.problem-detail-content');
    const runnerNode = root.querySelector('.python-runner');

    renderer.updateCurrentProblem({
      ...currentProblemBase,
      status: 'loaded',
      detail,
      runner: {
        ...currentProblemBase.runner,
        status: 'passed',
        passed: 2,
        total: 2,
        durationMs: 3,
      },
    });

    expect(root.querySelector('.problem-detail-content')).toBe(detailNode);
    expect(root.querySelector('.python-runner')).not.toBe(runnerNode);
    expect(root.querySelector('.runner-passed')?.textContent).toContain('2/2개');
  });

  it('keeps repository titles when multiple roots need disambiguation', () => {
    renderApp(
      root,
      {
        ...snapshot,
        repositories: [
          snapshot.repositories[0]!,
          {
            ...snapshot.repositories[0]!,
            name: 'study-b',
            rootUri: 'file:///study-b',
          },
        ],
      },
      ui,
      vi.fn(),
    );

    expect([...root.querySelectorAll('.repository-title')].map(({ textContent }) => textContent))
      .toEqual(['study-a', 'study-b']);
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

    const currentProblemButton = [...root.querySelectorAll<HTMLButtonElement>('.view-tab')]
      .find(({ textContent }) => textContent === '현재 문제 보기');
    currentProblemButton?.click();

    expect(ui.viewMode).toBe('currentProblem');
    expect(root.querySelector('.current-problem')?.textContent).toContain('불러오는 중');
    expect(root.querySelector('.loading-state-panel')?.getAttribute('role')).toBe('status');
    expect(root.querySelector('.loading-state-panel .loading-spinner')).not.toBeNull();
    expect(root.querySelector('.loading-description')?.textContent)
      .toContain('문제 정보와 본문');
    expect(root.querySelector('.problem-card')).toBeNull();
    expect(post).toHaveBeenCalledWith({ type: 'loadCurrentProblem' });

    const listButton = [...root.querySelectorAll<HTMLButtonElement>('.view-tab')]
      .find(({ textContent }) => textContent === '리스트');
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
    expect([...root.querySelectorAll('.problem-topic-tag')].map(({ textContent }) => textContent))
      .toEqual(['Array', 'Hash Table']);
    expect(root.querySelector('.problem-detail-content strong')?.textContent)
      .toBe('two numbers');
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

    expect(root.querySelector('.problem-detail-state')?.textContent)
      .toContain('본문은 LeetCode에서 공개되지 않습니다');
    expect(root.querySelector('.problem-detail-content')).toBeNull();
  });

  it('switches between weekly and difficulty groups', () => {
    renderApp(root, snapshot, ui, vi.fn());

    const difficultyButton = [...root.querySelectorAll<HTMLButtonElement>('.group-button')]
      .find(({ textContent }) => textContent === '난이도');
    difficultyButton?.click();

    expect(ui.groupBy).toBe('difficulty');
    expect(root.textContent).toContain('쉬움');
    expect(root.textContent).toContain('보통');
    expect(root.querySelector('.problem-group.difficulty-easy')).not.toBeNull();
    expect(root.querySelector('.problem-group.difficulty-medium')).not.toBeNull();
  });

  it('renders unpushed and unavailable Git states', () => {
    renderApp(root, { ...snapshot, preferredLanguage: 'typescript' }, ui, vi.fn());

    expect(root.querySelector('.solution-git-status.unpushed')?.textContent)
      .toBe('push 되지 않음');

    const unknownSnapshot: ExtensionSnapshot = {
      ...snapshot,
      repositories: snapshot.repositories.map((repository) => ({
        ...repository,
        gitRemote: undefined,
        problems: repository.problems.map((problem) => ({
          ...problem,
          solutions: problem.solutions.map((solution) => ({
            ...solution,
            gitStatus: 'unknown',
          })),
        })),
      })),
    };
    renderApp(root, unknownSnapshot, ui, vi.fn());

    expect(root.querySelector('.solution-git-status.unknown')?.textContent)
      .toBe('푸시 상태 확인 불가');

    const checkingSnapshot: ExtensionSnapshot = {
      ...unknownSnapshot,
      repositories: unknownSnapshot.repositories.map((repository) => ({
        ...repository,
        problems: repository.problems.map((problem) => ({
          ...problem,
          solutions: problem.solutions.map((solution) => ({
            ...solution,
            gitStatus: 'checking',
          })),
        })),
      })),
    };
    renderApp(root, checkingSnapshot, ui, vi.fn());

    expect(root.querySelector('.solution-git-status.checking')?.textContent)
      .toBe('푸시 상태 확인 중');
  });

  it('filters to the displayed solution when unpushed-only is checked', () => {
    renderApp(root, { ...snapshot, preferredLanguage: 'typescript' }, ui, vi.fn());

    (root.querySelector('.unpushed-checkbox') as HTMLInputElement).click();

    expect(ui.unpushedOnly).toBe(true);
    expect(root.textContent).toContain('Two Sum');
    expect(root.textContent).toContain('push 되지 않음');
    expect(root.textContent).not.toContain('Three Sum');
    expect(root.querySelectorAll('.problem-card')).toHaveLength(1);
  });

  it('sorts problems within a week from easy to medium to hard', () => {
    const weeklySnapshot: ExtensionSnapshot = {
      ...snapshot,
      repositories: [
        {
          ...snapshot.repositories[0]!,
          problems: [
            {
              ...snapshot.repositories[0]!.problems[0]!,
              slug: 'hard-problem',
              difficulty: 'Hard',
            },
            {
              ...snapshot.repositories[0]!.problems[0]!,
              slug: 'easy-problem',
              difficulty: 'Easy',
            },
            {
              ...snapshot.repositories[0]!.problems[0]!,
              slug: 'medium-problem',
              difficulty: 'Medium',
            },
          ],
        },
      ],
    };

    renderApp(root, weeklySnapshot, ui, vi.fn());

    expect(
      [...root.querySelectorAll('.problem-title')].map(({ textContent }) => textContent),
    ).toEqual(['Easy Problem', 'Medium Problem', 'Hard Problem']);
  });

  it('posts settings, lint, open, delete, and create messages', () => {
    const post = vi.fn();
    renderApp(root, snapshot, ui, post);

    (root.querySelector('#preferred-language') as HTMLSelectElement).value = 'typescript';
    root.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true }));
    (root.querySelector('.lint-button') as HTMLButtonElement).click();
    (root.querySelector('.problem-card.completed .problem-card-action') as HTMLButtonElement).click();
    (root.querySelector(
      '.problem-card.completed .other-solution-button',
    ) as HTMLButtonElement).click();
    const solutionButtons = root.querySelectorAll<HTMLButtonElement>('.solution-button');
    solutionButtons[0]?.click();
    solutionButtons[1]?.click();
    (root.querySelector('.delete-button') as HTMLButtonElement).click();
    (root.querySelector('.problem-card.completed .answer-button') as HTMLButtonElement).click();
    (root.querySelector('.problem-card.completed .open-page-button') as HTMLButtonElement).click();
    (root.querySelector('.problem-card.incomplete .problem-card-action') as HTMLButtonElement).click();
    (root.querySelector('.problem-card.incomplete .answer-button') as HTMLButtonElement).click();
    (root.querySelector('.problem-card.incomplete .open-page-button') as HTMLButtonElement).click();

    expect(post).toHaveBeenCalledWith({
      type: 'saveSettings',
      nickname: 'CaseUser',
      preferredLanguage: 'typescript',
    });
    expect(post).toHaveBeenCalledWith({
      type: 'fixAllSolutions',
    });
    expect(post).toHaveBeenCalledWith({
      type: 'openSolution',
      uri: 'file:///study-a/two-sum/CaseUser.py',
    });
    expect(post).toHaveBeenCalledWith({
      type: 'openOtherSolution',
      rootUri: 'file:///study-a',
      slug: 'two-sum',
    });
    expect(post).toHaveBeenCalledWith({
      type: 'openSolution',
      uri: 'file:///study-a/two-sum/CaseUser.py',
    });
    expect(post).toHaveBeenCalledWith({
      type: 'openSolution',
      uri: 'file:///study-a/two-sum/CaseUser.ts',
    });
    expect(
      post.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === 'openSolution')
        .map(({ uri }) => uri),
    ).toEqual([
      'file:///study-a/two-sum/CaseUser.py',
      'file:///study-a/two-sum/CaseUser.py',
      'file:///study-a/two-sum/CaseUser.ts',
    ]);
    expect(post).toHaveBeenCalledWith({
      type: 'deleteSolution',
      uri: 'file:///study-a/two-sum/CaseUser.py',
    });
    expect(post).toHaveBeenCalledWith({
      type: 'openProblem',
      slug: 'two-sum',
    });
    expect(post).toHaveBeenCalledWith({
      type: 'openAnswer',
      rootUri: 'file:///study-a',
      slug: 'two-sum',
    });
    expect(post).toHaveBeenCalledWith({
      type: 'createSolution',
      rootUri: 'file:///study-a',
      slug: 'three-sum',
    });
    expect(post).toHaveBeenCalledWith({
      type: 'openProblem',
      slug: 'three-sum',
    });
    expect(post).toHaveBeenCalledWith({
      type: 'openAnswer',
      rootUri: 'file:///study-a',
      slug: 'three-sum',
    });
    expect(post).toHaveBeenCalledTimes(12);
  });

  it('filters by status and search text', () => {
    ui.filter = 'incomplete';
    ui.query = 'three-sum';
    renderApp(root, snapshot, ui, vi.fn());

    expect(root.textContent).toContain('Three Sum');
    expect(root.textContent).not.toContain('CaseUser.py');
  });

  it('finds a problem by its week label', () => {
    ui.query = '2주차';
    renderApp(root, snapshot, ui, vi.fn());

    expect(root.textContent).toContain('Three Sum');
    expect(root.textContent).not.toContain('Two Sum');
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
    expect(root.querySelector('.runner-title')?.textContent)
      .toBe('로컬 Python 풀이 테스트');
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
    expect((root.querySelector('.runner-unavailable') as HTMLElement).dataset.missingObjects)
      .toBe('ListNode');
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
    expect(root.querySelector('.runner-passed')?.textContent)
      .toContain('12/12개 테스트 통과 · 34ms');

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
    expect(root.querySelector('.runner-assertion')?.textContent)
      .toBe('assert candidate(2) == 3');
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

    expect(root.querySelector('.runner-running')?.textContent)
      .toBe('테스트를 실행하는 중…');
    expect(root.querySelector('.runner-running.loading-state')?.getAttribute('role'))
      .toBe('status');
    expect(root.querySelector('.runner-running .loading-spinner')).not.toBeNull();
    expect((root.querySelector('.runner-button') as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('disables creation in an untrusted workspace', () => {
    renderApp(root, { ...snapshot, workspaceTrusted: false }, ui, vi.fn());
    const create = root.querySelector(
      '.problem-card.incomplete .problem-card-action',
    ) as HTMLButtonElement;
    const deleteButton = root.querySelector('.delete-button') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(create.title).toContain('워크스페이스를 신뢰');
    expect(root.querySelector('.problem-card.incomplete .solution-status')?.textContent)
      .toBe('풀이 없음워크스페이스 신뢰 후 생성');
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.dataset.tooltip).toContain('워크스페이스를 신뢰');
    expect((root.querySelector('.lint-button') as HTMLButtonElement).disabled).toBe(true);
    expect(root.querySelector('.solution-create-hint')?.textContent)
      .toBe('워크스페이스 신뢰 후 생성');
  });
});
