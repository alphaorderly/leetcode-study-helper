// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSnapshot } from '../../src/shared/contracts';
import { renderApp, type UiState } from '../../src/webview/render';
import { createSnapshot } from './renderFixtures';

describe('webview listSettings', () => {
  let root: HTMLElement;
  let ui: UiState;
  let snapshot: ExtensionSnapshot;
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
    const solutionButtons = [...root.querySelectorAll<HTMLButtonElement>('.solution-button')];
    expect(solutionButtons.map(({ textContent }) => textContent)).toEqual(['.py', '.ts']);
    expect(solutionButtons[0]?.title).toBe('CaseUser.py 열기');
    expect(solutionButtons[0]?.getAttribute('aria-current')).toBe('true');
    expect(solutionButtons[1]?.title).toBe('CaseUser.ts 열기');
    expect(solutionButtons[1]?.hasAttribute('aria-current')).toBe(false);
    expect(root.querySelector('.solution-file-label')?.textContent).toBe('다른 언어 풀이');
    expect(root.querySelector('.solution-file-buttons')?.getAttribute('role')).toBe('group');
    expect(root.querySelector('.solution-file-buttons')?.getAttribute('aria-label')).toBe(
      'Two Sum 풀이 파일',
    );
    expect(root.querySelectorAll('.solution-status.has-file')).toHaveLength(1);
    expect(root.querySelectorAll('.solution-status.no-file')).toHaveLength(1);
    expect(root.querySelector('.solution-git-status.pushed')).not.toBeNull();
    expect(root.querySelectorAll('.problem-card-action')).toHaveLength(2);
    expect(root.querySelectorAll('.other-solution-button')).toHaveLength(2);
    expect(
      (root.querySelector('.problem-card.completed .other-solution-button') as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (root.querySelector('.problem-card.incomplete .other-solution-button') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(root.querySelectorAll('.other-solution-button .users-round-icon')).toHaveLength(2);
    expect(root.querySelector('.other-solution-button')?.textContent).toBe('');
    expect(root.querySelector('.other-solution-button')?.getAttribute('aria-label')).toBe(
      'Two Sum 다른 참여자의 풀이 열기',
    );
    expect(
      (root.querySelector('.other-solution-button') as HTMLButtonElement).dataset.tooltip,
    ).toBe('다른 참여자의 풀이 열기');
    expect(root.querySelectorAll('.answer-button')).toHaveLength(2);
    expect(
      [...root.querySelectorAll<HTMLButtonElement>('.answer-button')].every(
        ({ disabled }) => !disabled,
      ),
    ).toBe(true);
    expect(root.querySelector('.answer-button')?.textContent).toBe('');
    expect(root.querySelectorAll('.answer-button .book-open-icon')).toHaveLength(2);
    expect((root.querySelector('.answer-button') as HTMLButtonElement).dataset.tooltip).toBe(
      '정답 페이지 열기',
    );
    expect(root.querySelector('.answer-button')?.getAttribute('aria-label')).toBe(
      'Two Sum 정답 페이지 열기',
    );
    expect(root.querySelectorAll('.open-page-button')).toHaveLength(2);
    expect(root.querySelectorAll('.open-page-button .external-link-icon')).toHaveLength(2);
    expect(root.querySelector('.open-page-button')?.textContent).toBe('');
    expect((root.querySelector('.open-page-button') as HTMLButtonElement).dataset.tooltip).toBe(
      'LeetCode 페이지 열기',
    );
    expect(root.querySelector('.open-page-button')?.getAttribute('aria-label')).toBe(
      'Two Sum LeetCode 페이지 열기',
    );
    expect(root.querySelectorAll('.delete-button .trash-icon')).toHaveLength(1);
    expect(root.querySelector('.delete-button')?.textContent).toBe('');
    expect((root.querySelector('.delete-button') as HTMLButtonElement).dataset.tooltip).toBe(
      'CaseUser.py 삭제',
    );
    expect(root.querySelector('.delete-button')?.getAttribute('aria-label')).toBe(
      'CaseUser.py 풀이 파일 삭제',
    );
    expect(root.querySelectorAll('.file-icon')).toHaveLength(1);
    expect(root.querySelectorAll('.problem-group.week')).toHaveLength(2);
    expect(root.querySelector('.stats')).toBeNull();
    expect(root.querySelector('.stat-card')).toBeNull();
    expect((root.querySelector('.unpushed-checkbox') as HTMLInputElement).checked).toBe(false);
    expect((root.querySelector('.lint-button') as HTMLButtonElement).textContent).toBe(
      '파일 맨 끝에 빈줄 추가하기',
    );
    expect(root.querySelector('.lint-action')).not.toBeNull();
    expect(root.querySelector('.lint-card')).toBeNull();
    expect(root.querySelector('.repository-title')).toBeNull();
    expect(root.querySelector('.view-tabs')).not.toBeNull();
    expect(root.querySelector('.view-tab.active')?.textContent).toBe('리스트');
    const currentProblemButton = [...root.querySelectorAll<HTMLButtonElement>('.view-tab')].find(
      ({ textContent }) => textContent === '현재 문제 보기',
    );
    expect(currentProblemButton?.disabled).toBe(true);
    expect(currentProblemButton?.title).toContain('풀이 파일을 열면');
    expect(root.textContent).not.toContain('제출 파일 라인린트');
    expect(root.textContent).not.toContain('*.md는 제외됩니다.');
  });

  it('orders solution buttons by the configured language and disables them while busy', () => {
    ui.busy = true;
    renderApp(root, { ...snapshot, preferredLanguage: 'typescript' }, ui, vi.fn());

    const solutionButtons = [...root.querySelectorAll<HTMLButtonElement>('.solution-button')];
    expect(solutionButtons.map(({ textContent }) => textContent)).toEqual(['.ts', '.py']);
    expect(solutionButtons[0]?.getAttribute('aria-current')).toBe('true');
    expect(solutionButtons[0]?.getAttribute('aria-label')).toBe('CaseUser.ts 풀이 파일 열기');
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

    const typeScriptButton = [...root.querySelectorAll<HTMLButtonElement>('.solution-button')].find(
      ({ textContent }) => textContent === '.ts',
    );
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
            problem.slug === 'two-sum' ? { ...problem, solutionUrl: undefined } : problem,
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

    expect(
      [...root.querySelectorAll('.repository-title')].map(({ textContent }) => textContent),
    ).toEqual(['study-a', 'study-b']);
  });

  it('switches between weekly and difficulty groups', () => {
    renderApp(root, snapshot, ui, vi.fn());

    const difficultyButton = [...root.querySelectorAll<HTMLButtonElement>('.group-button')].find(
      ({ textContent }) => textContent === '난이도',
    );
    difficultyButton?.click();

    expect(ui.groupBy).toBe('difficulty');
    expect(root.textContent).toContain('쉬움');
    expect(root.textContent).toContain('보통');
    expect(root.querySelector('.problem-group.difficulty-easy')).not.toBeNull();
    expect(root.querySelector('.problem-group.difficulty-medium')).not.toBeNull();
  });

  it('renders unpushed and unavailable Git states', () => {
    renderApp(root, { ...snapshot, preferredLanguage: 'typescript' }, ui, vi.fn());

    expect(root.querySelector('.solution-git-status.unpushed')?.textContent).toBe('push 되지 않음');

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

    expect(root.querySelector('.solution-git-status.unknown')?.textContent).toBe(
      '푸시 상태 확인 불가',
    );

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

    expect(root.querySelector('.solution-git-status.checking')?.textContent).toBe(
      '푸시 상태 확인 중',
    );
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
    (
      root.querySelector('.problem-card.completed .problem-card-action') as HTMLButtonElement
    ).click();
    (
      root.querySelector('.problem-card.completed .other-solution-button') as HTMLButtonElement
    ).click();
    const solutionButtons = root.querySelectorAll<HTMLButtonElement>('.solution-button');
    solutionButtons[0]?.click();
    solutionButtons[1]?.click();
    (root.querySelector('.delete-button') as HTMLButtonElement).click();
    (root.querySelector('.problem-card.completed .answer-button') as HTMLButtonElement).click();
    (root.querySelector('.problem-card.completed .open-page-button') as HTMLButtonElement).click();
    (
      root.querySelector('.problem-card.incomplete .problem-card-action') as HTMLButtonElement
    ).click();
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

  it('disables creation in an untrusted workspace', () => {
    renderApp(root, { ...snapshot, workspaceTrusted: false }, ui, vi.fn());
    const create = root.querySelector(
      '.problem-card.incomplete .problem-card-action',
    ) as HTMLButtonElement;
    const deleteButton = root.querySelector('.delete-button') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(create.title).toContain('워크스페이스를 신뢰');
    expect(root.querySelector('.problem-card.incomplete .solution-status')?.textContent).toBe(
      '풀이 없음워크스페이스 신뢰 후 생성',
    );
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.dataset.tooltip).toContain('워크스페이스를 신뢰');
    expect((root.querySelector('.lint-button') as HTMLButtonElement).disabled).toBe(true);
    expect(root.querySelector('.solution-create-hint')?.textContent).toBe(
      '워크스페이스 신뢰 후 생성',
    );
  });
});
