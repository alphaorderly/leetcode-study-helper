import DOMPurify from 'dompurify';
import type { CurrentProblemSnapshot } from '../core/types';
import { element, renderLoadingState } from './dom';
import { difficultyClass, difficultyLabel } from './problemViewModel';
import type { PostMessage } from './viewTypes';

function renderProblemPageButton(
  slug: string,
  label: string,
  post: PostMessage,
): HTMLElement {
  const button = element('button', 'problem-page-button', label);
  button.type = 'button';
  button.addEventListener('click', () => post({ type: 'openProblem', slug }));
  return button;
}

function renderRunnerOutput(
  label: string,
  value: string | undefined,
): HTMLElement | undefined {
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

  const stdout = renderRunnerOutput(
    '표준 출력',
    'stdout' in runner ? runner.stdout : undefined,
  );
  const stderr = renderRunnerOutput(
    '오류 출력',
    'stderr' in runner ? runner.stderr : undefined,
  );
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

export class CurrentProblemViewRenderer {
  private uri: string | undefined;
  private section: HTMLElement | undefined;
  private detailRegion: HTMLElement | undefined;
  private runnerRegion: HTMLElement | undefined;
  private detailIdentity: unknown;

  render(
    currentProblem: CurrentProblemSnapshot,
    post: PostMessage,
  ): HTMLElement {
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
      this.detailRegion!.replaceChildren(
        renderCurrentProblemDetail(currentProblem, post),
      );
    }
    this.runnerRegion!.replaceChildren(renderPythonRunner(currentProblem, post));
    return this.section;
  }
}
