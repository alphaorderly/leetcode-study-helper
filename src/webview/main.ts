import type { ExtensionSnapshot, ExtensionToWebviewMessage } from '../core/types';
import { WebviewRenderer, type UiState } from './render';

declare function acquireVsCodeApi<T = unknown>(): {
  postMessage(message: unknown): void;
  getState(): T | undefined;
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
  ...vscode.getState(),
};
const renderer = root
  ? new WebviewRenderer(root, ui, (message) => vscode.postMessage(message))
  : undefined;
let state: ExtensionSnapshot | undefined;
let requestedProblemSlug: string | undefined;

function requestProblemIfNeeded(): void {
  const currentProblem = state?.currentProblem;
  if (
    ui.viewMode === 'currentProblem'
    && currentProblem?.status === 'idle'
    && requestedProblemSlug !== currentProblem.slug
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
