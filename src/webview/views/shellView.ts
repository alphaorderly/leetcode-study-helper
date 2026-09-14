import type { CurrentProblemSnapshot } from '../../shared/contracts';
import { actionButton, toggleGroup } from '../components/controls';
import { element } from '../components/dom';
import { currentProblemTabModel, lintActionModel, shellNotices } from '../state/shellModel';
import type { GroupingMode, StatusFilter } from '../state/problemViewModel';
import type { ViewContext, ViewMode } from '../state/viewTypes';

/** 닉네임 미설정과 지원 저장소 미발견 안내를 문단으로 만듭니다. */
export function renderNotices(state: ViewContext['state'] | undefined): HTMLElement[] {
  return shellNotices(state).map((text) => element('p', 'empty-state', text));
}

/** 루트별 탐색 오류를 안내 문구로 변환합니다. */
export function renderIssues(state: ViewContext['state'] | undefined): HTMLElement[] {
  return (
    state?.issues.map((issue) => element('p', 'issue', `${issue.rootName}: ${issue.message}`)) ?? []
  );
}

/** 전체 풀이의 줄 끝 보정 명령 버튼을 만들고 신뢰·작업 상태를 반영합니다. */
export function renderLintAction({ state, ui, post }: ViewContext): HTMLElement {
  const model = lintActionModel(state, ui);
  const action = element('section', 'lint-action');
  action.append(
    actionButton({
      className: 'primary-button lint-button',
      label: '파일 맨 끝에 빈줄 추가하기',
      disabled: model.disabled,
      title: model.title,
      onClick: () => post({ type: 'fixAllSolutions' }),
    }),
  );
  return action;
}

/** 검색·상태 필터·그룹 선택을 UI 상태에 연결하고 변경 시 목록 갱신을 요청합니다. */
export function renderControls(ui: ViewContext['ui'], renderList: () => void): HTMLElement {
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

  const tabs = toggleGroup<StatusFilter>({
    options: [
      { value: 'all', label: '전체' },
      { value: 'completed', label: '풀이 있음' },
      { value: 'incomplete', label: '풀이 없음' },
    ],
    value: ui.filter,
    ariaLabel: '풀이 상태 필터',
    groupClass: 'filter-tabs',
    buttonClass: 'filter-button',
    onSelect: (filter) => {
      ui.filter = filter;
      renderList();
    },
  });

  const grouping = element('div', 'grouping-control');
  const groupTabs = toggleGroup<GroupingMode>({
    options: [
      { value: 'week', label: '주차' },
      { value: 'difficulty', label: '난이도' },
    ],
    value: ui.groupBy,
    ariaLabel: '문제 분류 기준',
    groupClass: 'group-tabs',
    buttonClass: 'group-button',
    onSelect: (mode) => {
      ui.groupBy = mode;
      renderList();
    },
  });
  const unpushedFilter = element('label', 'unpushed-filter');
  const unpushedCheckbox = element('input', 'unpushed-checkbox');
  unpushedCheckbox.type = 'checkbox';
  unpushedCheckbox.checked = ui.unpushedOnly;
  unpushedCheckbox.addEventListener('change', () => {
    ui.unpushedOnly = unpushedCheckbox.checked;
    renderList();
  });
  unpushedFilter.append(unpushedCheckbox, element('span', 'unpushed-filter-label', '미푸시만'));
  grouping.append(groupTabs, unpushedFilter);

  controls.append(searchLabel, search, tabs, grouping);
  return controls;
}

/** 목록·현재 문제·제출 탭을 만들고 탭 선택 시 상태 변경과 갱신을 연결합니다. */
export function renderViewTabs(
  currentProblem: CurrentProblemSnapshot | undefined,
  context: ViewContext,
  rerender: () => void,
): HTMLElement {
  const { ui, post } = context;
  const problemTab = currentProblemTabModel(currentProblem);
  return toggleGroup<ViewMode>({
    options: [
      { value: 'list', label: '리스트', role: 'tab' },
      {
        value: 'currentProblem',
        label: '현재 문제 보기',
        role: 'tab',
        disabled: problemTab.disabled,
        title: problemTab.title,
      },
      { value: 'submission', label: '제출', role: 'tab' },
    ],
    value: ui.viewMode,
    ariaLabel: '문제 목록과 현재 문제 전환',
    groupClass: 'view-tabs',
    buttonClass: 'view-tab',
    groupRole: 'tablist',
    selectedAttribute: 'aria-selected',
    onSelect: (viewMode) => {
      if (viewMode === 'currentProblem') {
        if (!currentProblem) {
          return;
        }
        ui.viewMode = 'currentProblem';
        rerender();
        if (currentProblem.status === 'idle' || currentProblem.status === 'error') {
          post({ type: 'loadCurrentProblem' });
        }
        return;
      }
      ui.viewMode = viewMode;
      rerender();
      if (viewMode === 'submission') {
        post({ type: 'refreshSubmission' });
      }
    },
  });
}
