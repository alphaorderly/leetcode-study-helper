import DOMPurify from 'dompurify';
import type { CurrentProblemSnapshot } from '../../shared/contracts';
import { actionButton } from '../components/controls';
import { element, renderLoadingState } from '../components/dom';
import { difficultyClass, difficultyLabel } from '../state/problemViewModel';
import { problemDetailView, pythonRunnerView } from '../state/currentProblemModel';
import type { PostMessage } from '../state/viewTypes';

/** LeetCode 문제 페이지 열기 메시지를 보내는 버튼을 생성합니다. */
function renderProblemPageButton(slug: string, label: string, post: PostMessage): HTMLElement {
  return actionButton({
    className: 'problem-page-button',
    label,
    onClick: () => post({ type: 'openProblem', slug }),
  });
}

/** 출력이 있을 때만 접을 수 있는 진단 출력 영역을 만듭니다. */
function renderRunnerOutput(label: string, value: string | undefined): HTMLElement | undefined {
  if (!value) {
    return undefined;
  }
  const details = element('details', 'runner-output');
  details.append(element('summary', undefined, label), element('pre', undefined, value));
  return details;
}

/** 분석·실행 상태에 맞는 후보 선택, 실행 버튼과 Python 테스트 결과를 만듭니다. */
function renderPythonRunner(
  currentProblem: CurrentProblemSnapshot,
  post: PostMessage,
): HTMLElement {
  const view = pythonRunnerView(currentProblem.runner);
  const section = element('section', 'python-runner');
  section.setAttribute('aria-label', '로컬 Python 풀이 테스트');
  section.append(element('h3', 'runner-title', '로컬 Python 풀이 테스트'));

  if (view.kind === 'checking') {
    section.append(
      renderLoadingState(
        '풀이 후보를 분석하는 중…',
        undefined,
        'loading-state-compact runner-state',
      ),
    );
    return section;
  }
  if (view.kind === 'unavailable') {
    const state = element('p', 'runner-state runner-unavailable', view.reason);
    if (view.missingObjects?.length) {
      state.dataset.missingObjects = view.missingObjects.join(',');
    }
    section.append(state);
    return section;
  }
  if (view.kind === 'no-candidates') {
    section.append(element('p', 'runner-state runner-error', view.message));
    return section;
  }

  const controls = element('div', 'runner-controls');
  const label = element('label', 'field-label', '실행할 풀이');
  label.htmlFor = 'runner-candidate';
  const select = element('select', 'select-input runner-candidate');
  select.id = 'runner-candidate';
  for (const candidate of view.candidates) {
    const option = element('option', undefined, candidate.label);
    option.value = candidate.id;
    option.selected = candidate.id === view.selectedCandidateId;
    select.append(option);
  }
  const runButton = actionButton({
    className: 'primary-button runner-button',
    label: view.runLabel,
    disabled: view.running,
    onClick: () => post({ type: 'runCurrentSolution', candidateId: select.value }),
  });
  controls.append(label, select, runButton);
  section.append(controls);

  const result = view.result;
  if (result?.kind === 'running') {
    section.append(
      renderLoadingState(
        '테스트를 실행하는 중…',
        undefined,
        'loading-state-compact runner-state runner-running',
      ),
    );
  } else if (result?.kind === 'passed') {
    section.append(element('p', 'runner-state runner-passed', result.text));
  } else if (result?.kind === 'failed') {
    const failure = element('div', 'runner-state runner-failed', result.text);
    if (result.assertion) {
      failure.append(element('pre', 'runner-assertion', result.assertion));
    }
    section.append(failure);
  } else if (result?.kind === 'error') {
    section.append(element('p', 'runner-state runner-error', result.text));
    if (result.traceback) {
      const traceback = renderRunnerOutput('오류 상세', result.traceback);
      if (traceback) {
        section.append(traceback);
      }
    }
  }

  const stdout = renderRunnerOutput('표준 출력', view.stdout);
  const stderr = renderRunnerOutput('오류 출력', view.stderr);
  if (stdout) {
    section.append(stdout);
  }
  if (stderr) {
    section.append(stderr);
  }
  return section;
}

const sanitizedProblemContent = new WeakMap<object, string>();

/** 설명 로딩·오류·본문을 렌더링하며 외부 HTML은 정화한 결과를 캐시해 사용합니다. */
function renderCurrentProblemDetail(
  currentProblem: CurrentProblemSnapshot,
  post: PostMessage,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const view = problemDetailView(currentProblem);

  if (view.kind === 'loading') {
    fragment.append(renderLoadingState(view.title, view.description, 'loading-state-panel'));
    return fragment;
  }

  if (view.kind === 'error') {
    const state = element('div', 'problem-detail-state problem-detail-error');
    state.append(
      element('p', undefined, view.message),
      renderProblemPageButton(view.slug, 'LeetCode에서 열기', post),
      actionButton({
        className: 'secondary-button',
        label: '다시 시도',
        onClick: () => post({ type: 'loadCurrentProblem' }),
      }),
    );
    fragment.append(state);
    return fragment;
  }

  const { detail } = view;
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

  if (view.hideContent) {
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
    sanitized = DOMPurify.sanitize(detail.content ?? '', {
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

/** 문제 본문이 바뀌었는지 판단할 객체 참조 또는 상태 식별 문자열을 반환합니다. */
function problemDetailIdentity(currentProblem: CurrentProblemSnapshot): unknown {
  if (currentProblem.status === 'loaded') {
    return currentProblem.detail;
  }
  return `${currentProblem.slug}:${currentProblem.status}:${currentProblem.status === 'error' ? currentProblem.message : ''}`;
}

/**
 * 현재 풀이 URI와 설명 identity를 보관하는 브라우저 렌더러입니다.
 * 같은 풀이의 러너만 바뀌면 설명 DOM은 유지하고, 파일이 바뀌면 두 영역을 새로 만듭니다.
 * 본문 HTML은 정화한 결과를 사용하며 설명 객체가 같은 동안 정화 결과도 재사용합니다.
 */
export class CurrentProblemViewRenderer {
  private uri: string | undefined;
  private section: HTMLElement | undefined;
  private detailRegion: HTMLElement | undefined;
  private runnerRegion: HTMLElement | undefined;
  private detailIdentity: unknown;

  /** 같은 풀이의 본문 DOM은 재사용하고 설명 변경 영역과 실행 결과만 갱신합니다. */
  render(currentProblem: CurrentProblemSnapshot, post: PostMessage): HTMLElement {
    const uri = currentProblem.solution.uri;
    if (this.uri !== uri || !this.section) {
      this.uri = uri;
      this.detailIdentity = undefined;
      this.section = element('section', 'current-problem');
      this.section.setAttribute('role', 'tabpanel');
      this.detailRegion = element('div', 'current-problem-detail');
      this.runnerRegion = element('div', 'current-problem-runner');
      this.section.append(this.detailRegion, this.runnerRegion);
    }
    const identity = problemDetailIdentity(currentProblem);
    if (identity !== this.detailIdentity) {
      this.detailIdentity = identity;
      this.detailRegion!.replaceChildren(renderCurrentProblemDetail(currentProblem, post));
    }
    this.runnerRegion!.replaceChildren(renderPythonRunner(currentProblem, post));
    return this.section;
  }
}
