import type { ExtensionSnapshot, RepositorySnapshot } from '../../shared/contracts';
import { element } from '../components/dom';
import { renderSubmissionGraph } from '../components/submissionGraph';
import type { PostMessage, UiState } from '../state/viewTypes';

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
  ui: UiState,
  post: PostMessage,
): HTMLElement {
  const actions = element('div', 'submission-view-actions');
  const refreshButton = element('button', 'secondary-button submission-header-button', '새로고침');
  refreshButton.type = 'button';
  refreshButton.disabled = ui.busy;
  refreshButton.addEventListener('click', () => post({ type: 'refreshSubmission' }));
  const syncButton = element('button', 'secondary-button submission-header-button', '포크 동기화');
  syncButton.type = 'button';
  syncButton.disabled = ui.busy || !repository.submission?.canSync;
  syncButton.title = repository.submission?.canSync
    ? '공식 main 가져오기'
    : (repository.submission?.syncDisabledReason ??
      '스테이징·추적 파일 수정과 미푸시 커밋을 먼저 정리해 주세요.');
  syncButton.addEventListener('click', () =>
    post({ type: 'syncFork', rootUri: repository.rootUri }),
  );
  const returnButton = element(
    'button',
    'secondary-button submission-header-button',
    'main으로 돌아가 동기화',
  );
  returnButton.type = 'button';
  returnButton.disabled = ui.busy || !repository.submission?.canReturnToMain;
  if (!repository.submission?.canReturnToMain) {
    returnButton.title = 'PR 병합과 깨끗한 주차 브랜치 상태를 먼저 확인해 주세요.';
  }
  returnButton.addEventListener('click', () =>
    post({ type: 'returnToMainAndSync', rootUri: repository.rootUri }),
  );
  actions.append(refreshButton, syncButton);
  if (/^week-\d{2}$/.test(repository.submission?.branch ?? '')) {
    actions.append(returnButton);
  }

  return actions;
}

/** 저장소 선택과 제출 화면 헤더를 만들고 선택한 저장소의 제출 흐름을 렌더링합니다. */
export function renderSubmissionView(
  state: ExtensionSnapshot,
  ui: UiState,
  post: PostMessage,
  rerender: () => void,
): HTMLElement {
  const section = element('section', 'submission-view');
  section.setAttribute('role', 'tabpanel');
  const repositories = state.repositories;
  let repository = repositories.find(({ rootUri }) => rootUri === ui.submissionRepository);
  repository ??=
    repositories.find(({ submission }) => submission?.fork.status === 'verified') ??
    repositories[0];
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
  const actions = renderSubmissionActions(repository, ui, post);
  header.append(titleGroup, actions);
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
  section.append(
    renderSubmissionSummary(repository),
    renderSubmissionGraph(repository, state, ui, post),
  );
  return section;
}
