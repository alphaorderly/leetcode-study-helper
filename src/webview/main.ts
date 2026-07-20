import type { ExtensionSnapshot, ExtensionToWebviewMessage } from '../core/types';
import { renderApp, type UiState } from './render';

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
  busy: false,
  ...vscode.getState(),
};
let state: ExtensionSnapshot | undefined;

function draw(): void {
  vscode.setState(ui);
  if (root && state) {
    renderApp(root, state, ui, (message) => vscode.postMessage(message));
  }
}

window.addEventListener('message', (event: MessageEvent<ExtensionToWebviewMessage>) => {
  if (event.data.type === 'state') {
    state = event.data.state;
  } else if (event.data.type === 'busy') {
    ui.busy = event.data.value;
  }
  draw();
});

vscode.postMessage({ type: 'ready' });
