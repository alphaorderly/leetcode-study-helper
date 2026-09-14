import type { ExtensionSnapshot, ExtensionToWebviewMessage } from '../shared/contracts';
import { WebviewRenderer, type UiState } from './render';

/** VS Code가 웹뷰에 주입하는 메시지·상태 저장 API를 한 번 획득합니다. */
declare function acquireVsCodeApi<T = unknown>(): {
  /** 직렬화 가능한 메시지를 확장 호스트에 전달합니다. */
  postMessage(message: unknown): void;
  /** 이 웹뷰에 저장된 UI 상태를 읽으며 저장된 값이 없으면 undefined입니다. */
  getState(): T | undefined;
  /** 웹뷰가 다시 열릴 때 복원할 UI 상태를 저장합니다. */
  setState(state: T): void;
};

const vscode = acquireVsCodeApi<UiState>();
const root = document.querySelector<HTMLElement>('#app');
const ui: UiState = {
  query: '',
  filter: 'all',
  groupBy: 'week',
  unpushedOnly: false,
  viewMode: 'list',
  busy: false,
  commitMessages: {},
  ...vscode.getState(),
};
const renderer = root
  ? new WebviewRenderer(root, ui, (message) => vscode.postMessage(message))
  : undefined;
let state: ExtensionSnapshot | undefined;
let requestedProblemSlug: string | undefined;

/** 현재 문제 탭의 대기 상태에서 slug별 중복을 막아 설명 로딩을 요청합니다. */
function requestProblemIfNeeded(): void {
  const currentProblem = state?.currentProblem;
  if (
    ui.viewMode === 'currentProblem' &&
    currentProblem?.status === 'idle' &&
    requestedProblemSlug !== currentProblem.slug
  ) {
    requestedProblemSlug = currentProblem.slug;
    vscode.postMessage({ type: 'loadCurrentProblem' });
  } else if (currentProblem?.status !== 'idle') {
    requestedProblemSlug = undefined;
  }
}

window.addEventListener('message', (event: MessageEvent<ExtensionToWebviewMessage>) => {
  switch (event.data.type) {
    case 'state':
      state = event.data.state;
      renderer?.updateState(state);
      break;
    case 'currentProblem':
      if (state) {
        state = { ...state, currentProblem: event.data.currentProblem };
      }
      renderer?.updateCurrentProblem(event.data.currentProblem);
      break;
    case 'busy':
      renderer?.updateBusy(event.data.value);
      break;
  }
  vscode.setState(ui);
  requestProblemIfNeeded();
});

vscode.postMessage({ type: 'ready' });
