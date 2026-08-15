import * as vscode from 'vscode';

export const GITHUB_AUTH_PROVIDER = 'github';
export const GITHUB_AUTH_SCOPES = ['public_repo'] as const;

export class GitHubAuthService implements vscode.Disposable {
  private readonly disposable: vscode.Disposable;

  constructor(onDidChangeSessions?: () => void) {
    this.disposable = vscode.authentication.onDidChangeSessions((event) => {
      if (event.provider.id === GITHUB_AUTH_PROVIDER) {
        onDidChangeSessions?.();
      }
    });
  }

  async getAccessToken(options: { prompt?: boolean } = {}): Promise<string | undefined> {
    try {
      const session = await vscode.authentication.getSession(
        GITHUB_AUTH_PROVIDER,
        [...GITHUB_AUTH_SCOPES],
        options.prompt
          ? { createIfNone: true }
          : { createIfNone: false, silent: true },
      );
      return session?.accessToken;
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
