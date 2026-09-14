import type { RepositorySnapshot } from '../../shared/contracts';
import { actionButton } from '../components/controls';
import { element } from '../components/dom';
import {
  resolveSubmissionRepository,
  submissionHeaderActions,
} from '../state/submissionGraphModel';
import type { ViewContext } from '../state/viewTypes';
import { renderSubmissionGraph } from './submissionGraph';

/** 저장소의 제출 단계별 풀이 수를 화면 요약 항목으로 만듭니다. */
function renderSubmissionSummary(repository: RepositorySnapshot): HTMLElement {
  const summary = repository.submission?.summary;
  const region = element('div', 'submission-summary');
  if (!summary) {
    return region;
  }
  for (const [label, count, className] of [
    ['작성 중', summary.working, 'working'],
    ['커밋 준비', summary.staged, 'staged'],
    ['push 필요', summary.pushNeeded, 'push-needed'],
    ['PR 진행', summary.prPending, 'pr-pending'],
    ['병합 완료', summary.merged, 'merged'],
  ] as const) {
    const item = element('span', `submission-summary-item ${className}`);
    item.append(
      element('span', 'submission-summary-count', String(count)),
      element('span', 'submission-summary-label', label),
    );
    region.append(item);
  }
  return region;
}

/** 제출 새로고침·포크 동기화·main 복귀 버튼에 현재 허용 상태와 명령을 연결합니다. */
function renderSubmissionActions(
  repository: RepositorySnapshot,
  { ui, post }: ViewContext,
): HTMLElement {
  const actions = element('div', 'submission-view-actions');
  const model = submissionHeaderActions(repository, ui);
  const className = 'secondary-button submission-header-button';
  actions.append(
    actionButton({
      className,
      label: model.refresh.label,
      disabled: model.refresh.disabled,
      onClick: () => post(model.refresh.message),
    }),
    actionButton({
      className,
      label: model.sync.label,
      disabled: model.sync.disabled,
      title: model.sync.title,
      onClick: () => post(model.sync.message),
    }),
  );
  const returnToMain = model.returnToMain;
  if (returnToMain) {
    actions.append(
      actionButton({
        className,
        label: returnToMain.label,
        disabled: returnToMain.disabled,
        title: returnToMain.title,
        onClick: () => post(returnToMain.message),
      }),
    );
  }
  return actions;
}

/**
 * UI에서 선택한 루트를 모델로 해석해 해당 저장소의 제출 그래프를 그립니다.
 * 선택이 사라졌으면 검증된 포크 또는 첫 저장소로 대체합니다. 저장소 전환은 ui와 렌더 콜백을
 * 통해 반영하며 이 함수가 Git 상태를 직접 조회하거나 변경하지 않습니다.
 */
export function renderSubmissionView(context: ViewContext, rerender: () => void): HTMLElement {
  const { state, ui } = context;
  const section = element('section', 'submission-view');
  section.setAttribute('role', 'tabpanel');
  const repositories = state.repositories;
  const repository = resolveSubmissionRepository(repositories, ui.submissionRepository);
  if (!repository) {
    section.append(element('p', 'empty-state', '제출할 저장소가 없습니다.'));
    return section;
  }
  ui.submissionRepository = repository.rootUri;

  const header = element('div', 'submission-view-header');
  const titleGroup = element('div', 'submission-view-title-group');
  titleGroup.append(
    element('h2', 'submission-view-title', '주차별 제출'),
    element('p', 'submission-view-description', '커밋에 추가한 풀이만 병합 전까지 표시됩니다.'),
  );
  header.append(titleGroup, renderSubmissionActions(repository, context));
  section.append(header);

  if (repositories.length > 1) {
    const select = element('select', 'select-input submission-repository-select');
    select.setAttribute('aria-label', '제출 저장소');
    for (const item of repositories) {
      const option = element('option', undefined, item.name);
      option.value = item.rootUri;
      option.selected = item.rootUri === repository.rootUri;
      select.append(option);
    }
    select.addEventListener('change', () => {
      ui.submissionRepository = select.value;
      rerender();
    });
    section.append(select);
  }
  section.append(renderSubmissionSummary(repository), renderSubmissionGraph(repository, context));
  return section;
}
