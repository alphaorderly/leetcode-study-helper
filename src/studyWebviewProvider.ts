import * as vscode from 'vscode';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from './core/types';
import type { StudyController } from './studyController';

function nonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () =>
    characters.charAt(Math.floor(Math.random() * characters.length)),
  ).join('');
}

function isWebviewMessage(value: unknown): value is WebviewToExtensionMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return (
    type === 'ready' ||
    type === 'refresh' ||
    type === 'saveSettings' ||
    type === 'openSolution' ||
    type === 'openOtherSolution' ||
    type === 'openProblem' ||
    type === 'openAnswer' ||
    type === 'loadCurrentProblem' ||
    type === 'runCurrentSolution' ||
    type === 'deleteSolution' ||
    type === 'fixAllSolutions' ||
    type === 'createSolution' ||
    type === 'stageSolution' ||
    type === 'unstageSolution' ||
    type === 'commitActiveWeek' ||
    type === 'pushActiveWeek' ||
    type === 'openPullRequest' ||
    type === 'syncFork' ||
    type === 'refreshSubmission'
  );
}

export class StudyWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly changeSubscriptions: vscode.Disposable[];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: StudyController,
  ) {
    this.changeSubscriptions = [
      controller.onDidChange((state) => {
        void this.post({ type: 'state', state });
      }),
      controller.onDidChangeCurrentProblem((currentProblem) => {
        void this.post({ type: 'currentProblem', currentProblem });
      }),
    ];
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message: unknown) => {
      if (isWebviewMessage(message)) {
        void this.handleMessage(message);
      }
    });
  }

  dispose(): void {
    for (const subscription of this.changeSubscriptions) {
      subscription.dispose();
    }
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready': {
          await this.controller.getState();
          await this.post({ type: 'state', state: this.controller.currentSnapshot });
          break;
        }
        case 'refresh':
          await this.withBusy(() => this.controller.refresh());
          break;
        case 'saveSettings':
          await this.withBusy(() =>
            this.controller.saveSettings(message.nickname, message.preferredLanguage),
          );
          break;
        case 'openSolution':
          await this.controller.openSolution(message.uri);
          break;
        case 'openOtherSolution':
          await this.withBusy(() =>
            this.controller.openOtherSolution(message.rootUri, message.slug),
          );
          break;
        case 'openProblem':
          await this.controller.openProblem(message.slug);
          break;
        case 'openAnswer':
          await this.controller.openAnswer(message.rootUri, message.slug);
          break;
        case 'loadCurrentProblem':
          await this.controller.loadCurrentProblem();
          break;
        case 'runCurrentSolution':
          await this.controller.runCurrentSolution(message.candidateId);
          break;
        case 'deleteSolution':
          await this.withBusy(() => this.controller.deleteSolution(message.uri));
          break;
        case 'fixAllSolutions': {
          const result = await this.withBusy(() => this.controller.fixAllSolutions());
          const passed = result.checked - result.fixed;
          await vscode.window.showInformationMessage(
            `라인린트 수정 완료: ${result.fixed}개 수정, ${passed}개 통과, ${result.ignored}개 제외`,
          );
          break;
        }
        case 'createSolution':
          await this.withBusy(() =>
            this.controller.createSolution(message.rootUri, message.slug),
          );
          break;
        case 'stageSolution':
          await this.withBusy(() => this.controller.stageSolution(message.uri));
          break;
        case 'unstageSolution':
          await this.withBusy(() => this.controller.unstageSolution(message.uri));
          break;
        case 'commitActiveWeek':
          await this.withBusy(() =>
            this.controller.commitActiveWeek(message.rootUri, message.message),
          );
          break;
        case 'pushActiveWeek':
          await this.withBusy(() => this.controller.pushActiveWeek(message.rootUri));
          break;
        case 'openPullRequest':
          await this.controller.openPullRequest(message.rootUri);
          break;
        case 'syncFork':
          await this.withBusy(() => this.controller.syncFork(message.rootUri));
          break;
        case 'refreshSubmission':
          await this.withBusy(() => this.controller.refreshSubmission());
          break;
      }
    } catch (error) {
      await vscode.window.showErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async withBusy<T>(action: () => Promise<T>): Promise<T> {
    await this.post({ type: 'busy', value: true });
    try {
      return await action();
    } finally {
      await this.post({ type: 'busy', value: false });
    }
  }

  private async post(message: ExtensionToWebviewMessage): Promise<boolean> {
    return (await this.view?.webview.postMessage(message)) ?? false;
  }

  private html(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.css'),
    );
    const scriptNonce = nonce();

    return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src 'nonce-${scriptNonce}';">
    <link rel="stylesheet" href="${styleUri}">
    <title>리트코드 스터디 도우미</title>
  </head>
  <body>
    <main id="app" aria-live="polite" aria-busy="true">
      <div class="loading-state loading-state-page" role="status">
        <span class="loading-spinner" aria-hidden="true"></span>
        <span class="loading-copy">
          <strong class="loading-title">스터디 데이터를 불러오는 중…</strong>
          <span class="loading-description">워크스페이스의 문제와 풀이를 확인하고 있습니다.</span>
        </span>
      </div>
    </main>
    <script nonce="${scriptNonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
