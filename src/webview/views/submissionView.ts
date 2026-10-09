import type { PreparationAction, RepositorySnapshot } from '../../shared/contracts';
import { actionButton } from '../components/controls';
import { element } from '../components/dom';
import {
  resolveSubmissionRepository,
  submissionHeaderActions,
} from '../state/submissionGraphModel';
import type { ViewContext } from '../state/viewTypes';
import { renderSubmissionGraph } from './submissionGraph';

/** 저장소의 제출 단계별 풀이 수 중 0이 아닌 단계만 화면 요약 항목으로 만듭니다. */
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
    if (count === 0) {
      continue;
    }
    const item = element('span', `submission-summary-item ${className}`);
    item.append(
      element('span', 'submission-summary-count', String(count)),
      element('span', 'submission-summary-label', label),
    );
    region.append(item);
  }
  return region;
}

/** 제출 새로고침·포크 동기화·main 복귀 버튼 중 표시할 것만 현재 허용 상태와 명령을 연결합니다. */
function renderSubmissionActions(
  repository: RepositorySnapshot,
  { ui, post }: ViewContext,
): HTMLElement {
  const actions = element('div', 'submission-view-actions');
  const model = submissionHeaderActions(repository, ui);
  const className = 'secondary-button submission-header-button';
  for (const action of [model.refresh, model.sync, model.returnToMain]) {
    if (action) {
      actions.append(
        actionButton({
          className,
          label: action.label,
          disabled: action.disabled,
          title: action.title,
          onClick: () => post(action.message),
        }),
      );
    }
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
  const preparation = repository.submission?.preparation;
  if (preparation) {
    const panel = element('div', 'submission-auth');
    const phases: Record<string, string> = {
      preserve: '작업 보관',
      main: 'main 준비',
      sync: '공식 main 동기화',
      push: 'origin 반영',
      target: '다음 주차 브랜치 준비',
      apply: '풀이 이동',
      applying: '풀이 이동·충돌 확인',
      done: '준비 완료',
      cancelled: '원본 복원 완료',
    };
    panel.append(element('h3', undefined, phases[preparation.phase] ?? '다음 주차 준비'));
    panel.append(
      element(
        'p',
        undefined,
        `${preparation.sourceBranch} → ${preparation.targetWeek ? `Week ${preparation.targetWeek}` : 'main'} · 보관 파일 ${preparation.files.length}개`,
      ),
    );
    if (preparation.error) panel.append(element('p', 'issue', preparation.error));
    /** 보관 작업 ID와 저장소를 명령에 고정합니다. */
    const button = (label: string, action: PreparationAction) =>
      actionButton({
        label,
        className: 'secondary-button',
        disabled: ui.busy,
        onClick: () =>
          context.post({
            type: 'preparationAction',
            rootUri: repository.rootUri,
            operationId: preparation.id,
            action,
          }),
      });
    if (!preparation.completed) {
      if (preparation.phase === 'target' && preparation.targetWeek)
        panel.append(button('기존 주차 작업 열기', 'existingWeek'));
      if (preparation.conflicts.length)
        panel.append(button(`충돌 해결 (${preparation.conflicts.length})`, 'conflicts'));
      panel.append(
        button(preparation.error ? '해결 후 계속 / 재시도' : '계속', 'continue'),
        button('취소하고 원본 복원', 'cancel'),
      );
    }
    panel.append(button('보관함 열기', 'shelf'));
    if (preparation.completed) panel.append(button('보관 기록 정리', 'cleanup'));
    section.append(panel);
  }
  if (repository.submission?.mergedCurrentBranch && !preparation?.completed) {
    section.append(
      element(
        'p',
        'empty-state',
        '제출이 완료되었습니다. 다음 주차 준비에서 작성 중인 풀이를 보존하고 main을 동기화할 수 있습니다.',
      ),
    );
  }
  section.append(renderSubmissionSummary(repository), renderSubmissionGraph(repository, context));
  return section;
}
