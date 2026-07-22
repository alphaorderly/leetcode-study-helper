import DOMPurify from 'dompurify';
import type {
  CurrentProblemSnapshot,
  ExtensionSnapshot,
  ProblemSnapshot,
  RepositorySnapshot,
  WebviewToExtensionMessage,
} from '../core/types';
import {
  difficultyClass,
  difficultyLabel,
  formatProblemTitle,
  groupProblems,
  preferredSolution,
  visibleProblems,
  type GroupingMode,
  type StatusFilter,
} from './problemViewModel';

export type { GroupingMode, StatusFilter } from './problemViewModel';
export type ViewMode = 'list' | 'currentProblem';

export interface UiState {
  query: string;
  filter: StatusFilter;
  groupBy: GroupingMode;
  unpushedOnly: boolean;
  viewMode: ViewMode;
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

function renderLoadingState(
  title: string,
  description?: string,
  className = '',
): HTMLElement {
  const loading = element(
    'div',
    ['loading-state', className].filter(Boolean).join(' '),
  );
  loading.setAttribute('role', 'status');

  const spinner = element('span', 'loading-spinner');
  spinner.setAttribute('aria-hidden', 'true');
  const copy = element('span', 'loading-copy');
  copy.append(element('strong', 'loading-title', title));
  if (description) {
    copy.append(element('span', 'loading-description', description));
  }
  loading.append(spinner, copy);
  return loading;
}

function externalLinkIcon(): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.classList.add('external-link-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    'M14 3h7v7M21 3 10 14M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  );
  icon.append(path);
  return icon;
}

function trashIcon(): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.classList.add('trash-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    'M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v5M14 11v5',
  );
  icon.append(path);
  return icon;
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

function renderControls(ui: UiState, renderList: () => void): HTMLElement {
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
    renderList();
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
      for (const tab of tabs.querySelectorAll<HTMLButtonElement>('.filter-button')) {
        const active = tab === button;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-pressed', String(active));
      }
      renderList();
    });
    tabs.append(button);
  }

  const grouping = element('div', 'grouping-control');
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
      for (const tab of groupTabs.querySelectorAll<HTMLButtonElement>('.group-button')) {
        const active = tab === button;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-pressed', String(active));
      }
      renderList();
    });
    groupTabs.append(button);
  }
  const unpushedFilter = element('label', 'unpushed-filter');
  const unpushedCheckbox = element('input', 'unpushed-checkbox');
  unpushedCheckbox.type = 'checkbox';
  unpushedCheckbox.checked = ui.unpushedOnly;
  unpushedCheckbox.addEventListener('change', () => {
    ui.unpushedOnly = unpushedCheckbox.checked;
    renderList();
  });
  unpushedFilter.append(
    unpushedCheckbox,
    element('span', 'unpushed-filter-label', '미푸시만'),
  );
  grouping.append(groupTabs, unpushedFilter);

  controls.append(searchLabel, search, tabs, grouping);
  return controls;
}

function gitStatusLabel(
  solution: ProblemSnapshot['solutions'][number],
  repository: RepositorySnapshot,
): string {
  const remote = repository.gitRemote ?? '원격';
  switch (solution.gitStatus) {
    case 'checking':
      return '푸시 상태 확인 중';
    case 'pushed':
      return `${remote}`;
    case 'unpushed':
      return `push 되지 않음`;
    case 'unknown':
      return '푸시 상태 확인 불가';
  }
}

function gitStatusTitle(
  solution: ProblemSnapshot['solutions'][number],
  repository: RepositorySnapshot,
): string {
  const remote = repository.gitRemote ?? '원격 저장소';
  switch (solution.gitStatus) {
    case 'checking':
      return `${solution.name}의 푸시 상태를 확인하고 있습니다.`;
    case 'pushed':
      return `${solution.name}의 로컬 변경이 모두 ${remote}에 반영되어 있습니다.`;
    case 'unpushed':
      return `${solution.name}에 ${remote}으로 보내지 않은 로컬 변경이 있습니다.`;
    case 'unknown':
      return 'Git 저장소 또는 현재 브랜치의 upstream을 확인할 수 없습니다.';
  }
}

function creationHint(state: ExtensionSnapshot): string {
  if (!state.nickname) {
    return '닉네임 설정 후 생성';
  }
  if (!state.workspaceTrusted) {
    return '워크스페이스 신뢰 후 생성';
  }
  return '카드를 눌러 생성';
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
    status.title = gitStatusTitle(solution, repository);
    const gitStatus = element(
      'span',
      `solution-git-status ${solution.gitStatus}`,
      gitStatusLabel(solution, repository),
    );
    status.append(
      element('span', 'file-icon'),
      gitStatus,
    );
    const deleteButton = element('button', 'delete-button');
    deleteButton.type = 'button';
    deleteButton.setAttribute('aria-label', '풀이 파일 삭제');
    deleteButton.title = '풀이 파일 삭제';
    deleteButton.disabled = ui.busy || !state.workspaceTrusted;
    if (!state.workspaceTrusted) {
      deleteButton.title = '파일을 삭제하려면 워크스페이스를 신뢰해야 합니다.';
    }
    deleteButton.append(trashIcon());
    deleteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      post({ type: 'deleteSolution', uri: solution.uri });
    });
    actionButtons.append(deleteButton);
    actions.append(status);
  } else {
    const status = element('span', 'solution-status no-file');
    const statusCopy = element('span', 'solution-status-copy');
    statusCopy.append(
      element('span', 'solution-file-name', '풀이 없음'),
      element('span', 'solution-create-hint', creationHint(state)),
    );
    status.append(statusCopy);
    actions.append(status);
  }
  const openPageButton = element('button', 'open-page-button');
  openPageButton.type = 'button';
  openPageButton.title = 'LeetCode 페이지 열기';
  openPageButton.setAttribute('aria-label', `${problemTitle} LeetCode 페이지 열기`);
  openPageButton.disabled = ui.busy;
  openPageButton.append(externalLinkIcon());
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

function renderRepository(
  repository: RepositorySnapshot,
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
  showTitle: boolean,
): HTMLElement | undefined {
  const problems = visibleProblems(repository, state, ui);
  if (problems.length === 0) {
    return undefined;
  }

  const section = element('section', 'repository');
  if (showTitle) {
    section.append(element('h2', 'repository-title', repository.name));
  }

  const groups = groupProblems(problems, ui.groupBy);
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

function renderViewTabs(
  currentProblem: CurrentProblemSnapshot | undefined,
  ui: UiState,
  post: PostMessage,
  rerender: () => void,
): HTMLElement {
  const tabs = element('div', 'view-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '문제 목록과 현재 문제 전환');

  const listButton = element(
    'button',
    `view-tab${ui.viewMode === 'list' ? ' active' : ''}`,
    '리스트',
  );
  listButton.type = 'button';
  listButton.setAttribute('role', 'tab');
  listButton.setAttribute('aria-selected', String(ui.viewMode === 'list'));
  listButton.addEventListener('click', () => {
    ui.viewMode = 'list';
    rerender();
  });

  const problemButton = element(
    'button',
    `view-tab${ui.viewMode === 'currentProblem' ? ' active' : ''}`,
    '현재 문제 보기',
  );
  problemButton.type = 'button';
  problemButton.disabled = !currentProblem;
  if (!currentProblem) {
    problemButton.title = '풀이 파일을 열면 현재 문제를 볼 수 있습니다.';
  }
  problemButton.setAttribute('role', 'tab');
  problemButton.setAttribute('aria-selected', String(ui.viewMode === 'currentProblem'));
  problemButton.addEventListener('click', () => {
    if (!currentProblem) {
      return;
    }
    ui.viewMode = 'currentProblem';
    rerender();
    if (currentProblem.status === 'idle' || currentProblem.status === 'error') {
      post({ type: 'loadCurrentProblem' });
    }
  });

  tabs.append(listButton, problemButton);
  return tabs;
}

function renderProblemPageButton(slug: string, label: string, post: PostMessage): HTMLElement {
  const button = element('button', 'problem-page-button', label);
  button.type = 'button';
  button.addEventListener('click', () => post({ type: 'openProblem', slug }));
  return button;
}

function renderRunnerOutput(label: string, value: string | undefined): HTMLElement | undefined {
  if (!value) {
    return undefined;
  }
  const details = element('details', 'runner-output');
  details.append(
    element('summary', undefined, label),
    element('pre', undefined, value),
  );
  return details;
}

function renderPythonRunner(
  currentProblem: CurrentProblemSnapshot,
  post: PostMessage,
): HTMLElement {
  const runner = currentProblem.runner;
  const section = element('section', 'python-runner');
  section.setAttribute('aria-label', '로컬 Python 풀이 테스트');
  section.append(element('h3', 'runner-title', '로컬 Python 풀이 테스트'));

  if (runner.status === 'checking') {
    section.append(
      renderLoadingState(
        '풀이 후보를 분석하는 중…',
        undefined,
        'loading-state-compact runner-state',
      ),
    );
    return section;
  }
  if (runner.status === 'unavailable') {
    const state = element('p', 'runner-state runner-unavailable', runner.reason);
    if (runner.missingObjects?.length) {
      state.dataset.missingObjects = runner.missingObjects.join(',');
    }
    section.append(state);
    return section;
  }

  if (!runner.candidates || runner.candidates.length === 0) {
    section.append(
      element(
        'p',
        'runner-state runner-error',
        runner.status === 'error' ? runner.message : '실행할 풀이 후보가 없습니다.',
      ),
    );
    return section;
  }

  const controls = element('div', 'runner-controls');
  const label = element('label', 'field-label', '실행할 풀이');
  label.htmlFor = 'runner-candidate';
  const select = element('select', 'select-input runner-candidate');
  select.id = 'runner-candidate';
  for (const candidate of runner.candidates) {
    const option = element('option', undefined, candidate.label);
    option.value = candidate.id;
    option.selected = candidate.id === runner.selectedCandidateId;
    select.append(option);
  }
  const runButton = element(
    'button',
    'primary-button runner-button',
    runner.status === 'running' ? '실행 중…' : '테스트 실행',
  );
  runButton.type = 'button';
  runButton.disabled = runner.status === 'running';
  runButton.addEventListener('click', () => {
    post({ type: 'runCurrentSolution', candidateId: select.value });
  });
  controls.append(label, select, runButton);
  section.append(controls);

  if (runner.status === 'running') {
    section.append(
      renderLoadingState(
        '테스트를 실행하는 중…',
        undefined,
        'loading-state-compact runner-state runner-running',
      ),
    );
  } else if (runner.status === 'passed') {
    section.append(
      element(
        'p',
        'runner-state runner-passed',
        `${runner.passed}/${runner.total}개 테스트 통과 · ${runner.durationMs}ms`,
      ),
    );
  } else if (runner.status === 'failed') {
    const failure = element(
      'div',
      'runner-state runner-failed',
      `${runner.failedCase}번째 테스트 실패 · ${runner.passed}/${runner.total}개 통과 · ${runner.durationMs}ms`,
    );
    if (runner.assertion) {
      failure.append(element('pre', 'runner-assertion', runner.assertion));
    }
    section.append(failure);
  } else if (runner.status === 'error') {
    const message = runner.testCase
      ? `${runner.testCase}번째 테스트 실행 중 오류: ${runner.message}`
      : runner.message;
    section.append(element('p', 'runner-state runner-error', message));
    if (runner.traceback) {
      section.append(renderRunnerOutput('오류 상세', runner.traceback)!);
    }
  }

  const stdout = renderRunnerOutput('표준 출력', 'stdout' in runner ? runner.stdout : undefined);
  const stderr = renderRunnerOutput('오류 출력', 'stderr' in runner ? runner.stderr : undefined);
  if (stdout) {
    section.append(stdout);
  }
  if (stderr) {
    section.append(stderr);
  }
  return section;
}

const sanitizedProblemContent = new WeakMap<object, string>();

function renderCurrentProblemDetail(
  currentProblem: CurrentProblemSnapshot,
  post: PostMessage,
): DocumentFragment {
  const fragment = document.createDocumentFragment();

  if (currentProblem.status === 'idle' || currentProblem.status === 'loading') {
    fragment.append(
      renderLoadingState(
        '문제 내용을 불러오는 중…',
        'LeetCode에서 문제 정보와 본문을 가져오고 있습니다.',
        'loading-state-panel',
      ),
    );
    return fragment;
  }

  if (currentProblem.status === 'error') {
    const state = element('div', 'problem-detail-state problem-detail-error');
    state.append(
      element('p', undefined, currentProblem.message),
      renderProblemPageButton(currentProblem.slug, 'LeetCode에서 열기', post),
    );
    const retry = element('button', 'secondary-button', '다시 시도');
    retry.type = 'button';
    retry.addEventListener('click', () => post({ type: 'loadCurrentProblem' }));
    state.append(retry);
    fragment.append(state);
    return fragment;
  }

  const { detail } = currentProblem;
  const header = element('header', 'problem-detail-header');
  const titleRow = element('div', 'problem-detail-title-row');
  titleRow.append(
    element('h2', 'problem-detail-title', `${detail.questionId}. ${detail.title}`),
    renderProblemPageButton(detail.titleSlug, 'LeetCode에서 열기', post),
  );
  const metadata = element('div', 'problem-detail-metadata');
  metadata.append(
    element(
      'span',
      `difficulty ${difficultyClass(detail.difficulty)}`,
      difficultyLabel(detail.difficulty),
    ),
  );
  for (const tag of detail.topicTags) {
    metadata.append(element('span', 'problem-topic-tag', tag.name));
  }
  header.append(titleRow, metadata);
  fragment.append(header);

  if (detail.isPaidOnly || !detail.content) {
    fragment.append(
      element(
        'p',
        'problem-detail-state',
        '이 문제의 본문은 LeetCode에서 공개되지 않습니다. LeetCode 페이지에서 확인해 주세요.',
      ),
    );
    return fragment;
  }

  const content = element('div', 'problem-detail-content');
  let sanitized = sanitizedProblemContent.get(detail);
  if (sanitized === undefined) {
    sanitized = DOMPurify.sanitize(detail.content, {
      FORBID_TAGS: [
        'script',
        'style',
        'iframe',
        'object',
        'embed',
        'form',
        'input',
        'button',
        'textarea',
        'select',
        'option',
        'svg',
        'math',
      ],
      FORBID_ATTR: ['style', 'href', 'srcset'],
    });
    sanitizedProblemContent.set(detail, sanitized);
  }
  content.innerHTML = sanitized;
  fragment.append(content);
  return fragment;
}

function problemDetailIdentity(currentProblem: CurrentProblemSnapshot): unknown {
  if (currentProblem.status === 'loaded') {
    return currentProblem.detail;
  }
  return `${currentProblem.slug}:${currentProblem.status}:${currentProblem.status === 'error' ? currentProblem.message : ''}`;
}

export class WebviewRenderer {
  private readonly settingsRegion = element('div', 'app-region app-settings-region');
  private readonly noticesRegion = element('div', 'app-region app-notices-region');
  private readonly lintRegion = element('div', 'app-region app-lint-region');
  private readonly controlsRegion = element('div', 'app-region app-controls-region');
  private readonly tabsRegion = element('div', 'app-region app-tabs-region');
  private readonly contentRegion = element('div', 'app-region app-content-region');
  private readonly issuesRegion = element('div', 'app-region app-issues-region');
  private state: ExtensionSnapshot | undefined;
  private currentProblemUri: string | undefined;
  private currentProblemSection: HTMLElement | undefined;
  private currentDetailRegion: HTMLElement | undefined;
  private currentRunnerRegion: HTMLElement | undefined;
  private currentDetailIdentity: unknown;

  constructor(
    private readonly root: HTMLElement,
    private readonly ui: UiState,
    private readonly post: PostMessage,
  ) {
    this.controlsRegion.append(renderControls(ui, () => this.renderList()));
    this.root.replaceChildren(
      this.settingsRegion,
      this.noticesRegion,
      this.lintRegion,
      this.controlsRegion,
      this.tabsRegion,
      this.contentRegion,
      this.issuesRegion,
    );
  }

  updateState(state: ExtensionSnapshot): void {
    this.state = state;
    if (!state.currentProblem) {
      this.ui.viewMode = 'list';
    }
    this.renderSettings();
    this.renderNotices();
    this.renderLint();
    this.renderTabs();
    this.renderContent();
    this.renderIssues();
    this.updateBusyAttribute();
  }

  updateCurrentProblem(currentProblem: CurrentProblemSnapshot | undefined): void {
    if (!this.state) {
      return;
    }
    this.state = { ...this.state, currentProblem };
    if (!currentProblem) {
      this.ui.viewMode = 'list';
    }
    this.renderTabs();
    if (this.ui.viewMode === 'currentProblem' && currentProblem) {
      this.renderCurrentProblem(currentProblem);
    } else if (!currentProblem) {
      this.renderList();
    }
  }

  updateBusy(busy: boolean): void {
    if (this.ui.busy === busy) {
      return;
    }
    this.ui.busy = busy;
    this.renderSettings();
    this.renderLint();
    this.renderTabs();
    this.renderContent();
    this.updateBusyAttribute();
  }

  private renderSettings(): void {
    this.settingsRegion.replaceChildren(
      ...(this.state ? [renderSettings(this.state, this.ui, this.post)] : []),
    );
  }

  private renderNotices(): void {
    const notices: HTMLElement[] = [];
    if (!this.state?.nickname) {
      notices.push(element(
        'p',
        'empty-state',
        '닉네임과 기본 언어를 설정하면 내 풀이를 찾을 수 있습니다.',
      ));
    }
    if (this.state && this.state.repositories.length === 0) {
      notices.push(element(
        'p',
        'empty-state',
        '지원되는 워크스페이스를 찾지 못했습니다. problem-categories.json과 문제 폴더가 있는 저장소를 열어 주세요.',
      ));
    }
    this.noticesRegion.replaceChildren(...notices);
  }

  private renderLint(): void {
    const hasRepositories = (this.state?.repositories.length ?? 0) > 0;
    this.lintRegion.replaceChildren(
      ...(this.state && hasRepositories
        ? [renderLintAction(this.state, this.ui, this.post)]
        : []),
    );
    this.controlsRegion.hidden = !hasRepositories;
  }

  private renderTabs(): void {
    const hasRepositories = (this.state?.repositories.length ?? 0) > 0;
    this.tabsRegion.replaceChildren(
      ...(this.state && hasRepositories
        ? [renderViewTabs(
            this.state.currentProblem,
            this.ui,
            this.post,
            () => {
              this.renderTabs();
              this.renderContent();
            },
          )]
        : []),
    );
  }

  private renderContent(): void {
    const state = this.state;
    if (!state || state.repositories.length === 0) {
      this.contentRegion.replaceChildren();
      return;
    }
    if (this.ui.viewMode === 'currentProblem' && state.currentProblem) {
      this.renderCurrentProblem(state.currentProblem);
      return;
    }
    this.renderList();
  }

  private renderList(): void {
    const state = this.state;
    if (!state || state.repositories.length === 0 || this.ui.viewMode !== 'list') {
      return;
    }
    const repositories: HTMLElement[] = [];
    const showRepositoryTitle = state.repositories.length > 1;
    for (const repository of state.repositories) {
      const rendered = renderRepository(
        repository,
        state,
        this.ui,
        this.post,
        showRepositoryTitle,
      );
      if (rendered) {
        repositories.push(rendered);
      }
    }
    if (repositories.length === 0) {
      repositories.push(element('p', 'empty-state', '현재 조건에 맞는 문제가 없습니다.'));
    }
    this.contentRegion.replaceChildren(...repositories);
  }

  private renderCurrentProblem(currentProblem: CurrentProblemSnapshot): void {
    const uri = currentProblem.solution.uri;
    if (this.currentProblemUri !== uri || !this.currentProblemSection) {
      this.currentProblemUri = uri;
      this.currentDetailIdentity = undefined;
      this.currentProblemSection = element('section', 'current-problem');
      this.currentProblemSection.setAttribute('role', 'tabpanel');
      this.currentDetailRegion = element('div', 'current-problem-detail');
      this.currentRunnerRegion = element('div', 'current-problem-runner');
      this.currentProblemSection.append(this.currentDetailRegion, this.currentRunnerRegion);
    }
    const identity = problemDetailIdentity(currentProblem);
    if (identity !== this.currentDetailIdentity) {
      this.currentDetailIdentity = identity;
      this.currentDetailRegion!.replaceChildren(
        renderCurrentProblemDetail(currentProblem, this.post),
      );
    }
    this.currentRunnerRegion!.replaceChildren(renderPythonRunner(currentProblem, this.post));
    this.contentRegion.replaceChildren(this.currentProblemSection);
  }

  private renderIssues(): void {
    this.issuesRegion.replaceChildren(
      ...(this.state?.issues.map((issue) =>
        element('p', 'issue', `${issue.rootName}: ${issue.message}`),
      ) ?? []),
    );
  }

  private updateBusyAttribute(): void {
    if (this.ui.busy) {
      this.root.setAttribute('aria-busy', 'true');
    } else {
      this.root.removeAttribute('aria-busy');
    }
  }
}

const renderers = new WeakMap<HTMLElement, WebviewRenderer>();

export function renderApp(
  root: HTMLElement,
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
): void {
  let renderer = renderers.get(root);
  if (!renderer) {
    renderer = new WebviewRenderer(root, ui, post);
    renderers.set(root, renderer);
  }
  renderer.updateState(state);
}
