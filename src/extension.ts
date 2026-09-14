import * as vscode from 'vscode';
import { StudyController } from './application/studyController';
import { StudyWebviewProvider } from './webview/host/studyWebviewProvider';

const VIEW_ID = 'leetcodeStudyHelper.explorer';

/** 확장 서비스와 명령을 등록하고 해제할 리소스를 확장 컨텍스트에 연결합니다. */
export function activate(context: vscode.ExtensionContext): void {
  const controller = new StudyController(context.extensionUri, context.globalState);
  const provider = new StudyWebviewProvider(context.extensionUri, controller);

  context.subscriptions.push(
    controller,
    provider,
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('leetcodeStudyHelper.refresh', () => controller.refresh()),
    vscode.commands.registerCommand('leetcodeStudyHelper.openView', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.leetcodeStudyHelper');
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }),
    vscode.commands.registerCommand('leetcodeStudyHelper.__getState', () => controller.getState()),
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
}

/** 비활성화 진입점입니다. 리소스 해제는 확장 컨텍스트에 등록한 구독이 담당합니다. */
export function deactivate(): void {}
