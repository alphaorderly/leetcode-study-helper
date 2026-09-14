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

  /**
   * 일반 상태 조회는 기존 인증 세션만 조용히 사용해 로그인 창을 띄우지 않습니다.
   * @param options prompt가 true이면 사용자의 로그인 명령으로 새 세션을 요청합니다.
   * @returns 액세스 토큰. 세션 부재·사용자 취소·인증 API 실패는 모두 undefined입니다.
   */
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
