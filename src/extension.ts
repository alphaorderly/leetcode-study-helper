import * as vscode from 'vscode';
import { StudyController } from './application/studyController';
import { StudyWebviewProvider } from './webview/host/studyWebviewProvider';
import { TelemetryService } from './infrastructure/telemetry/telemetryService';

const VIEW_ID = 'leetcodeStudyHelper.explorer';
let telemetry: TelemetryService | undefined;

/**
 * VS Code 확장 호스트의 시작점입니다. 컨트롤러와 웹뷰 제공자를 한 번 구성하고
 * 사용자 명령·내부 테스트 명령을 같은 컨트롤러에 연결합니다. 실제 최초 탐색은 getState/refresh에서
 * 시작합니다. 컨트롤러·웹뷰·명령은 subscriptions에서 해제하며 통계는 deactivate가 별도로 정리해
 * VS Code의 동기 구독 해제가 제한 시간 안의 정상 전송을 중단하지 않게 합니다.
 */
export function activate(context: vscode.ExtensionContext): void {
  telemetry = new TelemetryService(context);
  try {
    const controller = new StudyController(context.extensionUri, context.globalState, telemetry);
    const provider = new StudyWebviewProvider(context.extensionUri, controller, telemetry);

    context.subscriptions.push(
      controller,
      provider,
      vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
      vscode.commands.registerCommand('leetcodeStudyHelper.refresh', () => controller.refresh()),
      vscode.commands.registerCommand('leetcodeStudyHelper.fixAllSolutions', () =>
        provider.fixAllSolutions(),
      ),
      vscode.commands.registerCommand('leetcodeStudyHelper.openView', async () => {
        await vscode.commands.executeCommand('workbench.view.extension.leetcodeStudyHelper');
        await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
      }),
      vscode.commands.registerCommand('leetcodeStudyHelper.__getState', () =>
        controller.getState(),
      ),
      vscode.commands.registerCommand(
        'leetcodeStudyHelper.__createSolution',
        (rootUri: string, slug: string) => controller.createSolution(rootUri, slug, false),
      ),
      vscode.commands.registerCommand(
        'leetcodeStudyHelper.__openOtherSolution',
        (rootUri: string, slug: string) => controller.openOtherSolution(rootUri, slug, false),
      ),
      vscode.commands.registerCommand('leetcodeStudyHelper.__deleteSolution', (uri: string) =>
        controller.deleteSolution(uri, false),
      ),
      vscode.commands.registerCommand('leetcodeStudyHelper.__fixAllSolutions', () =>
        controller.fixAllSolutions(),
      ),
      vscode.commands.registerCommand(
        'leetcodeStudyHelper.__runCurrentSolution',
        (candidateId: string) => controller.runCurrentSolution(candidateId),
      ),
    );

    if (context.extensionMode === vscode.ExtensionMode.Test) {
      context.subscriptions.push(
        vscode.commands.registerCommand(
          'leetcodeStudyHelper.__setTelemetryEnabled',
          async (enabled: boolean) => {
            await telemetry?.setEnabled(enabled);
            return telemetry?.state;
          },
        ),
        vscode.commands.registerCommand(
          'leetcodeStudyHelper.__getTelemetryState',
          () => telemetry?.state,
        ),
      );
    }
  } catch (error) {
    telemetry.dispose();
    telemetry = undefined;
    throw error;
  }
}

/** 정상 종료에서 유효한 동의 아래 제한 시간만 전송한 뒤 남은 통계 리소스를 해제합니다. */
export async function deactivate(): Promise<void> {
  const current = telemetry;
  telemetry = undefined;
  await current?.shutdown();
}
