import * as vscode from 'vscode';
import { StudyController } from './studyController';
import { StudyWebviewProvider } from './studyWebviewProvider';

const VIEW_ID = 'leetcodeStudyHelper.explorer';

export function activate(context: vscode.ExtensionContext): void {
  const controller = new StudyController(context.extensionUri);
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
    vscode.commands.registerCommand('leetcodeStudyHelper.__getState', () =>
      controller.getState(),
    ),
    vscode.commands.registerCommand(
      'leetcodeStudyHelper.__createSolution',
      (rootUri: string, slug: string) => controller.createSolution(rootUri, slug, false),
    ),
    vscode.commands.registerCommand(
      'leetcodeStudyHelper.__deleteSolution',
      (uri: string) => controller.deleteSolution(uri, false),
    ),
    vscode.commands.registerCommand(
      'leetcodeStudyHelper.__fixAllSolutions',
      () => controller.fixAllSolutions(),
    ),
    vscode.commands.registerCommand(
      'leetcodeStudyHelper.__runCurrentSolution',
      (candidateId: string) => controller.runCurrentSolution(candidateId),
    ),
  );
}

export function deactivate(): void {}
