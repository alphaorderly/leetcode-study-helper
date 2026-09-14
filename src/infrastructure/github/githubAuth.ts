import * as vscode from 'vscode';

export const GITHUB_AUTH_PROVIDER = 'github';
export const GITHUB_AUTH_SCOPES = ['public_repo'] as const;

/** VS Code의 GitHub 인증 세션을 사용하며 계정 변경 이벤트를 전달합니다. */
export class GitHubAuthService implements vscode.Disposable {
  private readonly disposable: vscode.Disposable;

  /** GitHub 인증 세션의 변경을 구독해 전달받은 갱신 콜백을 호출합니다. */
  constructor(onDidChangeSessions?: () => void) {
    this.disposable = vscode.authentication.onDidChangeSessions((event) => {
      if (event.provider.id === GITHUB_AUTH_PROVIDER) {
        onDidChangeSessions?.();
      }
    });
  }

  /** 기본적으로 조용히 기존 세션을 조회합니다. prompt가 true일 때만 로그인 흐름을 요청합니다. */
  async getAccessToken(options: { prompt?: boolean } = {}): Promise<string | undefined> {
    try {
      const session = await vscode.authentication.getSession(
        GITHUB_AUTH_PROVIDER,
        [...GITHUB_AUTH_SCOPES],
        options.prompt ? { createIfNone: true } : { createIfNone: false, silent: true },
      );
      return session?.accessToken;
    } catch {
      return undefined;
    }
  }

  /** 인증 세션 변경 구독을 해제합니다. */
  dispose(): void {
    this.disposable.dispose();
  }
}
