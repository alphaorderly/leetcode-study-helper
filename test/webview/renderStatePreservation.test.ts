// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSnapshot } from '../../src/shared/contracts';
import { WebviewRenderer, type UiState } from '../../src/webview/render';
import { createSnapshot, createCurrentProblem, submissionSnapshot } from './renderFixtures';

describe('webview statePreservation', () => {
  let root: HTMLElement;
  let ui: UiState;
  let snapshot: ExtensionSnapshot;
  let currentProblemBase: ReturnType<typeof createCurrentProblem>;
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    root = document.querySelector('#app')!;
    ui = {
      query: '',
      filter: 'all',
      groupBy: 'week',
      unpushedOnly: false,
      viewMode: 'list',
      busy: false,
    };
    snapshot = createSnapshot();
    currentProblemBase = createCurrentProblem();
  });

  it('keeps the shell and list DOM stable for current-problem patches', () => {
    const renderer = new WebviewRenderer(root, ui, vi.fn());
    renderer.updateState(snapshot);
    const search = root.querySelector('#problem-search');
    const firstCard = root.querySelector('.problem-card');

    renderer.updateCurrentProblem({
      ...currentProblemBase,
      status: 'idle',
    });

    expect(root.querySelector('#problem-search')).toBe(search);
    expect(root.querySelector('.problem-card')).toBe(firstCard);
  });

  it('updates only the runner when loaded problem details are unchanged', () => {
    const post = vi.fn();
    const renderer = new WebviewRenderer(root, ui, post);
    const detail = {
      questionId: '1',
      title: 'Two Sum',
      titleSlug: 'two-sum',
      difficulty: 'Easy',
      isPaidOnly: false,
      topicTags: [],
      content: '<p>Stable detail</p>',
    };
    ui.viewMode = 'currentProblem';
    renderer.updateState({
      ...snapshot,
      currentProblem: {
        ...currentProblemBase,
        status: 'loaded',
        detail,
      },
    });
    const detailNode = root.querySelector('.problem-detail-content');
    const runnerNode = root.querySelector('.python-runner');

    renderer.updateCurrentProblem({
      ...currentProblemBase,
      status: 'loaded',
      detail,
      runner: {
        ...currentProblemBase.runner,
        status: 'passed',
        passed: 2,
        total: 2,
        durationMs: 3,
      },
    });

    expect(root.querySelector('.problem-detail-content')).toBe(detailNode);
    expect(root.querySelector('.python-runner')).not.toBe(runnerNode);
    expect(root.querySelector('.runner-passed')?.textContent).toContain('2/2개');
  });

  it('preserves commit input, focus and scroll on current-problem patches', () => {
    ui.viewMode = 'submission';
    const renderer = new WebviewRenderer(root, ui, vi.fn());
    renderer.updateState(submissionSnapshot());
    const input = root.querySelector<HTMLInputElement>('.submission-commit-input')!;
    const graph = root.querySelector<HTMLElement>('.submission-graph')!;
    input.value = '직접 작성한 커밋 메시지';
    input.dispatchEvent(new Event('input'));
    input.focus();
    input.setSelectionRange(3, 6);
    graph.scrollTop = 120;

    renderer.updateCurrentProblem({ ...currentProblemBase, status: 'loading' });

    expect(root.querySelector('.submission-commit-input')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('직접 작성한 커밋 메시지');
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 6]);
    expect(root.querySelector('.submission-graph')).toBe(graph);
    expect(graph.scrollTop).toBe(120);
  });

  it('preserves nickname, language, focus and list content on telemetry patches', () => {
    const renderer = new WebviewRenderer(root, ui, vi.fn());
    renderer.updateState(snapshot);
    const panel = root.querySelector<HTMLDetailsElement>('.settings-panel')!;
    const nickname = root.querySelector<HTMLInputElement>('#nickname')!;
    const language = root.querySelector<HTMLSelectElement>('#preferred-language')!;
    const checkbox = root.querySelector<HTMLInputElement>('#telemetry-enabled')!;
    const card = root.querySelector('.problem-card');
    panel.open = true;
    nickname.value = 'unfinished-name';
    language.value = 'typescript';
    nickname.focus();
    nickname.setSelectionRange(1, 4);
    root.scrollTop = 95;

    renderer.updateTelemetryState({ enabled: true, effectiveEnabled: true });

    expect(root.querySelector('#nickname')).toBe(nickname);
    expect(root.querySelector('#preferred-language')).toBe(language);
    expect(root.querySelector('#telemetry-enabled')).toBe(checkbox);
    expect(root.querySelector('.problem-card')).toBe(card);
    expect(nickname.value).toBe('unfinished-name');
    expect(language.value).toBe('typescript');
    expect(document.activeElement).toBe(nickname);
    expect([nickname.selectionStart, nickname.selectionEnd]).toEqual([1, 4]);
    expect(panel.open).toBe(true);
    expect(root.scrollTop).toBe(95);
    expect(checkbox.checked).toBe(true);
    expect(root.querySelector('#telemetry-status')?.textContent).toContain('허용했습니다');
  });

  it('preserves commit input and graph scroll when telemetry changes or saving fails', () => {
    ui.viewMode = 'submission';
    const renderer = new WebviewRenderer(root, ui, vi.fn());
    renderer.updateState(submissionSnapshot());
    const input = root.querySelector<HTMLInputElement>('.submission-commit-input')!;
    const graph = root.querySelector<HTMLElement>('.submission-graph')!;
    input.value = '작성 중인 메시지';
    input.focus();
    input.setSelectionRange(2, 5);
    graph.scrollTop = 120;

    renderer.updateTelemetryState({
      enabled: true,
      effectiveEnabled: false,
      disabledReason: 'storage',
    });
    renderer.updateTelemetryState({ enabled: false, effectiveEnabled: false });

    expect(root.querySelector('.submission-commit-input')).toBe(input);
    expect(root.querySelector('.submission-graph')).toBe(graph);
    expect(input.value).toBe('작성 중인 메시지');
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
    expect(graph.scrollTop).toBe(120);
    expect(root.querySelector<HTMLInputElement>('#telemetry-enabled')?.checked).toBe(false);
  });

  it('reuses the edited commit message after busy and full-state updates', () => {
    ui.viewMode = 'submission';
    const post = vi.fn();
    const renderer = new WebviewRenderer(root, ui, post);
    renderer.updateState(submissionSnapshot());
    const input = root.querySelector<HTMLInputElement>('.submission-commit-input')!;
    input.value = '보관할 커밋 메시지';
    input.dispatchEvent(new Event('input'));

    renderer.updateBusy(true);
    renderer.updateBusy(false);
    renderer.updateState(submissionSnapshot());

    expect(root.querySelector<HTMLInputElement>('.submission-commit-input')?.value).toBe(
      '보관할 커밋 메시지',
    );
    root.querySelector<HTMLButtonElement>('.staged .submission-action-button')!.click();
    expect(post).toHaveBeenCalledWith({
      type: 'commitActiveWeek',
      rootUri: 'file:///study-a',
      message: '보관할 커밋 메시지',
    });
  });

  it('keeps the submission graph visible when the active editor is cleared', () => {
    ui.viewMode = 'submission';
    const renderer = new WebviewRenderer(root, ui, vi.fn());
    renderer.updateState(submissionSnapshot());

    renderer.updateCurrentProblem(undefined);

    expect(root.querySelector('.submission-view-title')?.textContent).toBe('주차별 제출');
    expect(root.querySelector('.submission-graph')).not.toBeNull();
    expect(root.querySelector('.problem-list')).toBeNull();
  });
});
