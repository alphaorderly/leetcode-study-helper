import type {
  ExtensionSnapshot,
  ProblemSnapshot,
  RepositorySnapshot,
  WebviewToExtensionMessage,
} from '../core/types';

export type StatusFilter = 'all' | 'completed' | 'incomplete';
export type GroupingMode = 'week' | 'difficulty';

export interface UiState {
  query: string;
  filter: StatusFilter;
  groupBy: GroupingMode;
  busy: boolean;
}

export type PostMessage = (message: WebviewToExtensionMessage) => void;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function matchesSearch(problem: ProblemSnapshot, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) {
    return true;
  }
  const week = problem.week === undefined ? '' : `${problem.week}주차`;
  return [problem.slug, formatProblemTitle(problem.slug), difficultyLabel(problem.difficulty), week]
    .join(' ')
    .toLocaleLowerCase()
    .includes(needle);
}

function formatProblemTitle(slug: string): string {
  const words = slug.replace(/-+/g, ' ').trim();
  return words.replace(/(^|\s)([a-z])/g, (_, prefix: string, letter: string) =>
    `${prefix}${letter.toLocaleUpperCase()}`,
  );
}

function visibleProblems(
  repository: RepositorySnapshot,
  query: string,
  filter: StatusFilter,
): ProblemSnapshot[] {
  return repository.problems.filter((problem) => {
    const matchesFilter =
      filter === 'all' ||
      (filter === 'completed' && problem.completed) ||
      (filter === 'incomplete' && !problem.completed);
    return matchesFilter && matchesSearch(problem, query);
  });
}

function renderSettings(
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
): HTMLElement {
  const form = element('form', 'settings-card');
  form.setAttribute('aria-label', '풀이 설정');

  const nicknameLabel = element('label', 'field-label', '닉네임');
  nicknameLabel.htmlFor = 'nickname';
  const nicknameInput = element('input', 'text-input');
  nicknameInput.id = 'nickname';
  nicknameInput.name = 'nickname';
  nicknameInput.required = true;
  nicknameInput.pattern = '[A-Za-z0-9-]+';
  nicknameInput.placeholder = '예: study-user';
  nicknameInput.title = '영문, 숫자, 하이픈만 사용할 수 있습니다.';
  nicknameInput.value = state.nickname;
  nicknameInput.autocomplete = 'off';

  const languageLabel = element('label', 'field-label', '기본 언어');
  languageLabel.htmlFor = 'preferred-language';
  const languageSelect = element('select', 'select-input');
  languageSelect.id = 'preferred-language';
  languageSelect.name = 'preferredLanguage';
  for (const language of state.languages) {
    const option = element(
      'option',
      undefined,
      `${language.label} (.${language.extension})`,
    );
    option.value = language.id;
    option.selected = language.id === state.preferredLanguage;
    languageSelect.append(option);
  }

  const applyButton = element('button', 'primary-button', ui.busy ? '적용 중…' : '적용');
  applyButton.type = 'submit';
  applyButton.disabled = ui.busy;

  form.append(nicknameLabel, nicknameInput, languageLabel, languageSelect, applyButton);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) {
      return;
    }
    post({
      type: 'saveSettings',
      nickname: nicknameInput.value,
      preferredLanguage: languageSelect.value,
    });
  });
  return form;
}

function renderStats(state: ExtensionSnapshot): HTMLElement {
  const allProblems = state.repositories.flatMap(({ problems }) => problems);
  const completed = allProblems.filter(({ completed: solved }) => solved).length;
  const stats = element('section', 'stats');
  stats.setAttribute('aria-label', '풀이 현황');

  for (const [label, value] of [
    ['전체', allProblems.length],
    ['풀이 있음', completed],
    ['풀이 없음', allProblems.length - completed],
  ] as const) {
    const card = element('div', 'stat-card');
    card.append(element('strong', 'stat-value', String(value)), element('span', 'stat-label', label));
    stats.append(card);
  }
  return stats;
}

function renderLintAction(
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
): HTMLElement {
  const eligibleSolutionCount = state.repositories
    .flatMap(({ problems }) => problems)
    .flatMap(({ solutions }) => solutions)
    .filter(({ name }) => !name.endsWith('.md')).length;
  const action = element('section', 'lint-action');
  const button = element(
    'button',
    'primary-button lint-button',
    '파일 맨 끝에 빈줄 추가하기',
  );
  button.type = 'button';
  button.disabled = ui.busy || !state.workspaceTrusted || eligibleSolutionCount === 0;
  if (!state.workspaceTrusted) {
    button.title = '파일을 수정하려면 워크스페이스를 신뢰해야 합니다.';
  } else if (eligibleSolutionCount === 0) {
    button.title = '수정할 제출 파일이 없습니다.';
  }
  button.addEventListener('click', () => post({ type: 'fixAllSolutions' }));
  action.append(button);
  return action;
}

function renderControls(ui: UiState, rerender: () => void): HTMLElement {
  const controls = element('section', 'controls');
  const searchLabel = element('label', 'sr-only', '문제 검색');
  searchLabel.htmlFor = 'problem-search';
  const search = element('input', 'text-input search-input');
  search.id = 'problem-search';
  search.type = 'search';
  search.placeholder = '문제 검색';
  search.value = ui.query;
  search.addEventListener('input', () => {
    ui.query = search.value;
    rerender();
    const nextSearch = document.querySelector<HTMLInputElement>('#problem-search');
    nextSearch?.focus();
    nextSearch?.setSelectionRange(ui.query.length, ui.query.length);
  });

  const tabs = element('div', 'filter-tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', '풀이 상태 필터');
  for (const [filter, label] of [
    ['all', '전체'],
    ['completed', '풀이 있음'],
    ['incomplete', '풀이 없음'],
  ] as const) {
    const button = element('button', `filter-button${ui.filter === filter ? ' active' : ''}`, label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(ui.filter === filter));
    button.addEventListener('click', () => {
      ui.filter = filter;
      rerender();
    });
    tabs.append(button);
  }

  const grouping = element('div', 'grouping-control');
  grouping.append(element('span', 'control-label', '분류'));
  const groupTabs = element('div', 'group-tabs');
  groupTabs.setAttribute('role', 'group');
  groupTabs.setAttribute('aria-label', '문제 분류 기준');
  for (const [mode, label] of [
    ['week', '주차'],
    ['difficulty', '난이도'],
  ] as const) {
    const button = element(
      'button',
      `group-button${ui.groupBy === mode ? ' active' : ''}`,
      label,
    );
    button.type = 'button';
    button.setAttribute('aria-pressed', String(ui.groupBy === mode));
    button.addEventListener('click', () => {
      ui.groupBy = mode;
      rerender();
    });
    groupTabs.append(button);
  }
  grouping.append(groupTabs);

  controls.append(searchLabel, search, tabs, grouping);
  return controls;
}

function difficultyClass(difficulty: string): string {
  const normalized = difficulty.toLocaleLowerCase();
  return ['easy', 'medium', 'hard'].includes(normalized) ? normalized : 'unknown';
}

function difficultyLabel(difficulty: string): string {
  switch (difficultyClass(difficulty)) {
    case 'easy':
      return '쉬움';
    case 'medium':
      return '보통';
    case 'hard':
      return '어려움';
    default:
      return '알 수 없음';
  }
}

function difficultyOrder(problem: ProblemSnapshot): number {
  switch (difficultyClass(problem.difficulty)) {
    case 'easy':
      return 0;
    case 'medium':
      return 1;
    case 'hard':
      return 2;
    default:
      return 3;
  }
}

function sortByDifficulty(problems: ProblemSnapshot[]): ProblemSnapshot[] {
  return problems.sort((left, right) =>
    difficultyOrder(left) - difficultyOrder(right)
      || left.slug.localeCompare(right.slug),
  );
}

function preferredSolution(
  problem: ProblemSnapshot,
  state: ExtensionSnapshot,
): ProblemSnapshot['solutions'][number] | undefined {
  const preferredExtension = state.languages.find(
    ({ id }) => id === state.preferredLanguage,
  )?.extension;
  return problem.solutions.find(({ name }) => name.endsWith(`.${preferredExtension}`))
    ?? problem.solutions[0];
}

function renderProblem(
  problem: ProblemSnapshot,
  repository: RepositorySnapshot,
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
): HTMLElement {
  const card = element('article', `problem-card ${problem.completed ? 'completed' : 'incomplete'}`);
  const problemTitle = formatProblemTitle(problem.slug);
  const solution = problem.completed ? preferredSolution(problem, state) : undefined;
  const cardAction = element('button', 'problem-card-action');
  cardAction.type = 'button';
  if (solution) {
    cardAction.setAttribute('aria-label', `${problemTitle} 풀이 파일 열기`);
    cardAction.disabled = ui.busy;
    cardAction.addEventListener('click', () =>
      post({ type: 'openSolution', uri: solution.uri }),
    );
  } else if (!problem.completed) {
    cardAction.setAttribute('aria-label', `${problemTitle} 풀이 파일 만들기`);
    cardAction.disabled = ui.busy || !state.workspaceTrusted || !state.nickname;
    if (!state.workspaceTrusted) {
      cardAction.title = '파일을 만들려면 워크스페이스를 신뢰해야 합니다.';
    }
    cardAction.addEventListener('click', () =>
      post({ type: 'createSolution', rootUri: repository.rootUri, slug: problem.slug }),
    );
  } else {
    cardAction.disabled = true;
  }

  const heading = element('div', 'problem-heading');
  const title = element('h4', 'problem-title', problemTitle);
  const badges = element('div', 'problem-badges');
  const difficulty = element(
    'span',
    `difficulty ${difficultyClass(problem.difficulty)}`,
    difficultyLabel(problem.difficulty),
  );
  badges.append(difficulty);
  heading.append(title, badges);
  card.append(heading);

  const actions = element('div', 'solution-actions');
  const actionButtons = element('div', 'solution-action-buttons');
  if (solution) {
    const status = element('span', 'solution-status has-file');
    status.append(
      element('span', 'file-icon'),
      element('span', undefined, '파일'),
    );
    const deleteButton = element('button', 'delete-button', '삭제');
    deleteButton.type = 'button';
    deleteButton.setAttribute('aria-label', '풀이 파일 삭제');
    deleteButton.disabled = ui.busy || !state.workspaceTrusted;
    if (!state.workspaceTrusted) {
      deleteButton.title = '파일을 삭제하려면 워크스페이스를 신뢰해야 합니다.';
    }
    deleteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      post({ type: 'deleteSolution', uri: solution.uri });
    });
    actionButtons.append(deleteButton);
    actions.append(status);
  } else {
    actions.append(element('span', 'solution-status no-file', '풀이 없음'));
  }
  const openPageButton = element('button', 'open-page-button', 'Leetcode 열기');
  openPageButton.type = 'button';
  openPageButton.setAttribute('aria-label', `${problemTitle} LeetCode Leetcode 열기`);
  openPageButton.disabled = ui.busy;
  openPageButton.addEventListener('click', (event) => {
    event.stopPropagation();
    post({ type: 'openProblem', slug: problem.slug });
  });
  actionButtons.append(openPageButton);
  actions.append(actionButtons);
  card.prepend(cardAction);
  card.append(actions);
  return card;
}

interface ProblemGroup {
  label: string;
  problems: ProblemSnapshot[];
  kind?: string;
}

function groupByWeek(problems: ProblemSnapshot[]): ProblemGroup[] {
  const scheduled = new Map<number, ProblemSnapshot[]>();
  const unscheduled: ProblemSnapshot[] = [];

  for (const problem of problems) {
    if (problem.week === undefined) {
      unscheduled.push(problem);
      continue;
    }
    const weekProblems = scheduled.get(problem.week) ?? [];
    weekProblems.push(problem);
    scheduled.set(problem.week, weekProblems);
  }

  const groups = [...scheduled.entries()]
    .sort(([left], [right]) => left - right)
    .map(([week, weekProblems]) => ({
      label: `${week}주차`,
      problems: sortByDifficulty(weekProblems),
    }));
  if (unscheduled.length > 0) {
    groups.push({ label: '주차 미지정', problems: sortByDifficulty(unscheduled) });
  }
  return groups;
}

function groupByDifficulty(problems: ProblemSnapshot[]): ProblemGroup[] {
  const groups = new Map<string, ProblemSnapshot[]>();
  for (const problem of problems) {
    const key = difficultyClass(problem.difficulty);
    const difficultyProblems = groups.get(key) ?? [];
    difficultyProblems.push(problem);
    groups.set(key, difficultyProblems);
  }

  const orderedGroups: Array<[string, string]> = [
    ['easy', '쉬움'],
    ['medium', '보통'],
    ['hard', '어려움'],
    ['unknown', '알 수 없음'],
  ];
  return orderedGroups
    .map(([key, label]) => ({ label, problems: groups.get(key) ?? [], kind: key }))
    .filter(({ problems: difficultyProblems }) => difficultyProblems.length > 0);
}

function renderRepository(
  repository: RepositorySnapshot,
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
): HTMLElement | undefined {
  const problems = visibleProblems(repository, ui.query, ui.filter);
  if (problems.length === 0) {
    return undefined;
  }

  const section = element('section', 'repository');
  section.append(element('h2', 'repository-title', repository.name));

  const groups = ui.groupBy === 'week' ? groupByWeek(problems) : groupByDifficulty(problems);
  for (const { label, problems: groupProblems, kind } of groups) {
    const groupKind = ui.groupBy === 'week'
      ? 'week'
      : `difficulty-${kind ?? 'unknown'}`;
    const group = element('section', `problem-group ${groupKind}`);
    const groupHeader = element('div', 'group-header');
    groupHeader.append(
      element('h3', 'group-title', label),
      element('span', 'group-count', String(groupProblems.length)),
    );
    group.append(groupHeader);
    for (const problem of groupProblems) {
      group.append(renderProblem(problem, repository, state, ui, post));
    }
    section.append(group);
  }
  return section;
}

export function renderApp(
  root: HTMLElement,
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
): void {
  root.replaceChildren();
  const rerender = (): void => renderApp(root, state, ui, post);

  root.append(renderSettings(state, ui, post));

  if (!state.nickname) {
    root.append(
      element(
        'p',
        'empty-state',
        '닉네임과 기본 언어를 설정하면 내 풀이를 찾을 수 있습니다.',
      ),
    );
  }

  if (state.repositories.length === 0) {
    root.append(
      element(
        'p',
        'empty-state',
        '지원되는 워크스페이스를 찾지 못했습니다. problem-categories.json과 문제 폴더가 있는 저장소를 열어 주세요.',
      ),
    );
  } else {
    root.append(
      renderStats(state),
      renderLintAction(state, ui, post),
      renderControls(ui, rerender),
    );
    let visibleRepositoryCount = 0;
    for (const repository of state.repositories) {
      const rendered = renderRepository(repository, state, ui, post);
      if (rendered) {
        root.append(rendered);
        visibleRepositoryCount += 1;
      }
    }
    if (visibleRepositoryCount === 0) {
      root.append(element('p', 'empty-state', '현재 조건에 맞는 문제가 없습니다.'));
    }
  }

  for (const issue of state.issues) {
    root.append(
      element('p', 'issue', `${issue.rootName}: ${issue.message}`),
    );
  }

  if (ui.busy) {
    root.setAttribute('aria-busy', 'true');
  } else {
    root.removeAttribute('aria-busy');
  }
}
