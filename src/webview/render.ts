import type {
  CurrentProblemSnapshot,
  ExtensionSnapshot,
} from '../core/types';
import { CurrentProblemViewRenderer } from './currentProblemView';
import { element } from './dom';
import { renderProblemList } from './problemListView';
import { renderSubmissionView } from './submissionView';
import type { PostMessage, UiState } from './viewTypes';

export type { GroupingMode, StatusFilter } from './problemViewModel';
export type { PostMessage, UiState, ViewMode } from './viewTypes';


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

  const submissionButton = element(
    'button',
    `view-tab${ui.viewMode === 'submission' ? ' active' : ''}`,
    '제출',
  );
  submissionButton.type = 'button';
  submissionButton.setAttribute('role', 'tab');
  submissionButton.setAttribute(
    'aria-selected',
    String(ui.viewMode === 'submission'),
  );
  submissionButton.addEventListener('click', () => {
    ui.viewMode = 'submission';
    rerender();
    post({ type: 'refreshSubmission' });
  });

  tabs.append(listButton, problemButton, submissionButton);
  return tabs;
}


export class WebviewRenderer {
  private readonly settingsRegion = element('div', 'app-region app-settings-region');
  private readonly noticesRegion = element('div', 'app-region app-notices-region');
  private readonly lintRegion = element('div', 'app-region app-lint-region');
  private readonly controlsRegion = element('div', 'app-region app-controls-region');
  private readonly tabsRegion = element('div', 'app-region app-tabs-region');
  private readonly contentRegion = element('div', 'app-region app-content-region');
  private readonly issuesRegion = element('div', 'app-region app-issues-region');
  private readonly currentProblemView = new CurrentProblemViewRenderer();
  private state: ExtensionSnapshot | undefined;

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
    if (!state.currentProblem && this.ui.viewMode === 'currentProblem') {
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
    if (!currentProblem && this.ui.viewMode === 'currentProblem') {
      this.ui.viewMode = 'list';
    }
    this.renderTabs();
    if (this.ui.viewMode === 'currentProblem' && currentProblem) {
      this.renderCurrentProblem(currentProblem);
    } else if (this.ui.viewMode === 'list' && !currentProblem) {
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
    const submissionView = this.ui.viewMode === 'submission';
    this.controlsRegion.hidden = submissionView;
    this.lintRegion.hidden = submissionView;
    if (submissionView) {
      this.contentRegion.replaceChildren(renderSubmissionView(
        state,
        this.ui,
        this.post,
        () => {
          this.renderTabs();
          this.renderContent();
        },
      ));
      return;
    }
    this.controlsRegion.hidden = false;
    this.lintRegion.hidden = false;
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
    this.contentRegion.replaceChildren(
      ...renderProblemList(state, this.ui, this.post),
    );
  }

  private renderCurrentProblem(currentProblem: CurrentProblemSnapshot): void {
    this.contentRegion.replaceChildren(
      this.currentProblemView.render(currentProblem, this.post),
    );
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
