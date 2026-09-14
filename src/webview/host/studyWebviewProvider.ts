import * as vscode from 'vscode';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../../shared/contracts';
import type { StudyController } from '../../application/studyController';

/** 웹뷰의 스크립트 허용 nonce로 사용할 32자리 영숫자 문자열을 생성합니다. */
function nonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () =>
    characters.charAt(Math.floor(Math.random() * characters.length)),
  ).join('');
}

const WEBVIEW_MESSAGE_TYPES: Record<WebviewToExtensionMessage['type'], true> = {
  ready: true,
  refresh: true,
  saveSettings: true,
  openSolution: true,
  openOtherSolution: true,
  openProblem: true,
  openAnswer: true,
  loadCurrentProblem: true,
  runCurrentSolution: true,
  deleteSolution: true,
  fixAllSolutions: true,
  createSolution: true,
  stageSolution: true,
  unstageSolution: true,
  commitActiveWeek: true,
  pushActiveWeek: true,
  openPullRequest: true,
  syncFork: true,
  discardOtherTrackedChanges: true,
  returnToMainAndSync: true,
  refreshSubmission: true,
  signInGitHub: true,
};

/** 알려진 메시지 type인지 확인하며 개별 payload 필드의 유효성까지 검사하지는 않습니다. */
function isWebviewMessage(value: unknown): value is WebviewToExtensionMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && Object.hasOwn(WEBVIEW_MESSAGE_TYPES, type);
}

/**
 * 확장 호스트와 브라우저 웹뷰 사이의 메시지 경계입니다. VS Code API 호출은 컨트롤러에
 * 위임하고 전체·현재 문제 변경을 다른 메시지로 게시합니다.
 * 생성 시 컨트롤러 이벤트를 구독하고 dispose에서 해당 구독을 해제합니다.
 */
export class StudyWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly changeSubscriptions: vscode.Disposable[];

  /** 컨트롤러의 전체·현재 문제 변경을 웹뷰 메시지 전송에 연결합니다. */
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

  /** 웹뷰의 리소스·스크립트 옵션과 HTML을 설정하고 수신 메시지를 명령에 연결합니다. */
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

  /** 컨트롤러의 화면 상태 변경 구독을 해제합니다. */
  dispose(): void {
    for (const subscription of this.changeSubscriptions) {
      subscription.dispose();
    }
  }

  /**
   * 메시지 종류를 컨트롤러 명령에 대응시킵니다. 긴 작업은 withBusy로 감싸 화면 버튼에
   * 진행 여부를 전달합니다. 현재 문제 분석·실행은 자체 runner 상태를 사용합니다.
   * 컨트롤러가 던진 오류는 VS Code 알림으로 표시하고 메시지 수신 Promise 밖으로 전파하지 않습니다.
   */
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
          await this.withBusy(() => this.controller.createSolution(message.rootUri, message.slug));
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
        case 'discardOtherTrackedChanges':
          await this.withBusy(() => this.controller.discardOtherTrackedChanges(message.rootUri));
          break;
        case 'returnToMainAndSync':
          await this.withBusy(() => this.controller.returnToMainAndSync(message.rootUri));
          break;
        case 'refreshSubmission':
          await this.withBusy(() => this.controller.refreshSubmission());
          break;
        case 'signInGitHub':
          await this.withBusy(() => this.controller.signInGitHub());
          break;
      }
    } catch (error) {
      await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 웹뷰에 작업 중 표시를 전달하고 finally에서 해제합니다. 작업 결과와 예외는 호출자에게 돌려줍니다.
   * 이 플래그는 UI 안내이며 명령 큐나 동시 실행 잠금으로 사용하지 않습니다.
   */
  private async withBusy<T>(action: () => Promise<T>): Promise<T> {
    await this.post({ type: 'busy', value: true });
    try {
      return await action();
    } finally {
      await this.post({ type: 'busy', value: false });
    }
  }

  /** 웹뷰가 있으면 메시지를 보내고 없으면 전송을 건너뜁니다. */
  private async post(message: ExtensionToWebviewMessage): Promise<boolean> {
    const webview = this.view?.webview;
    if (!webview) {
      return false;
    }
    return await webview.postMessage(message);
  }

  /** 확장 리소스 URI와 CSP nonce를 포함한 웹뷰 HTML을 생성합니다. */
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
