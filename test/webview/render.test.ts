// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSnapshot } from '../../src/core/types';
import { renderApp, type UiState } from '../../src/webview/render';

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
          completed: true,
          solutions: [
            { name: 'CaseUser.ts', uri: 'file:///study-a/two-sum/CaseUser.ts' },
            { name: 'CaseUser.py', uri: 'file:///study-a/two-sum/CaseUser.py' },
          ],
        },
        {
          slug: 'three-sum',
          week: 2,
          difficulty: 'Medium',
          categories: ['Array', 'Two Pointers'],
          blindCategories: ['Array'],
          intendedApproach: 'Sort and use two pointers.',
          completed: false,
          solutions: [],
        },
      ],
    },
  ],
};

describe('webview rendering', () => {
  let root: HTMLElement;
  let ui: UiState;

  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    root = document.querySelector('#app')!;
    ui = { query: '', filter: 'all', groupBy: 'week', busy: false };
  });

  it('renders settings, progress, and weekly groups', () => {
    renderApp(root, snapshot, ui, vi.fn());

    expect((root.querySelector('#nickname') as HTMLInputElement).value).toBe('CaseUser');
    expect(root.textContent).toContain('1주차');
    expect(root.textContent).toContain('2주차');
    expect(root.textContent).toContain('Two Sum');
    expect(root.textContent).toContain('Three Sum');
    expect(root.textContent).not.toContain('two-sum');
    expect(root.textContent).not.toContain('three-sum');
    expect(root.textContent).not.toContain('Use a hash map.');
    expect(root.textContent).not.toContain('Array');
    expect(root.textContent).toContain('파일');
    expect(root.textContent).toContain('풀이 없음');
    expect(root.textContent).not.toContain('CaseUser.py');
    expect(root.textContent).not.toContain('CaseUser.ts');
    expect(root.querySelectorAll('.solution-button')).toHaveLength(0);
    expect(root.querySelectorAll('.solution-status.has-file')).toHaveLength(1);
    expect(root.querySelectorAll('.solution-status.no-file')).toHaveLength(1);
    expect(root.querySelectorAll('.problem-card-action')).toHaveLength(2);
    expect(root.querySelectorAll('.open-page-button')).toHaveLength(2);
    expect(root.querySelectorAll('.file-icon')).toHaveLength(1);
    expect(root.querySelectorAll('.problem-group.week')).toHaveLength(2);
    expect((root.querySelector('.lint-button') as HTMLButtonElement).textContent)
      .toBe('파일 맨 끝에 빈줄 추가하기');
    expect(root.querySelector('.lint-action')).not.toBeNull();
    expect(root.querySelector('.lint-card')).toBeNull();
    expect(root.textContent).not.toContain('제출 파일 라인린트');
    expect(root.textContent).not.toContain('*.md는 제외됩니다.');
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
    (root.querySelector('.delete-button') as HTMLButtonElement).click();
    (root.querySelector('.problem-card.completed .open-page-button') as HTMLButtonElement).click();
    (root.querySelector('.problem-card.incomplete .problem-card-action') as HTMLButtonElement).click();
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
      type: 'deleteSolution',
      uri: 'file:///study-a/two-sum/CaseUser.py',
    });
    expect(post).toHaveBeenCalledWith({
      type: 'openProblem',
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
    expect(post).toHaveBeenCalledTimes(7);
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
    expect(root.querySelector('.problem-card.incomplete .solution-status')?.textContent)
      .toBe('풀이 없음');
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.title).toContain('워크스페이스를 신뢰');
    expect((root.querySelector('.lint-button') as HTMLButtonElement).disabled).toBe(true);
  });
});
