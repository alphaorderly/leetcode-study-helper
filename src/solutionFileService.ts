import * as vscode from 'vscode';
import { findLanguage } from './core/languages';
import { addMissingEndOfFileNewline, isValidNickname, targetFileStatus } from './core/solutions';

export interface CreateSolutionRequest {
  rootUri: string;
  slug: string;
  nickname: string;
  preferredLanguage: string;
  confirm: boolean;
}

export type CreateSolutionResult =
  | { status: 'created'; uri: vscode.Uri }
  | { status: 'cancelled' }
  | { status: 'exists'; uri: vscode.Uri };

export interface DeleteSolutionRequest {
  uri: vscode.Uri;
  relativePath: string;
  confirm: boolean;
}

export type DeleteSolutionResult = { status: 'deleted' } | { status: 'cancelled' };

export interface FixLineEndingsResult {
  checked: number;
  fixed: number;
}

export class SolutionFileService {
  async create(request: CreateSolutionRequest): Promise<CreateSolutionResult> {
    if (!isValidNickname(request.nickname)) {
      throw new Error('닉네임에는 영문, 숫자, 하이픈만 사용할 수 있습니다.');
    }

    const language = findLanguage(request.preferredLanguage);
    if (!language) {
      throw new Error(`지원하지 않는 언어입니다: ${request.preferredLanguage}`);
    }

    const rootUri = vscode.Uri.parse(request.rootUri);
    const problemUri = vscode.Uri.joinPath(rootUri, request.slug);
    const targetName = `${request.nickname}.${language.extension}`;
    const targetUri = vscode.Uri.joinPath(problemUri, targetName);
    const entries = await vscode.workspace.fs.readDirectory(problemUri);
    const names = entries.map(([name]) => name);
    const status = targetFileStatus(names, targetName);

    if (status === 'exists') {
      return { status: 'exists', uri: targetUri };
    }
    if (status === 'case-conflict') {
      const conflictingName = names.find(
        (name) =>
          name.toLocaleLowerCase('en-US') === targetName.toLocaleLowerCase('en-US'),
      );
      throw new Error(
        `${conflictingName ?? '다른 파일'}과 대소문자만 다른 ${targetName} 파일은 만들 수 없습니다.`,
      );
    }

    if (request.confirm) {
      const relativePath = `${request.slug}/${targetName}`;
      const choice = await vscode.window.showInformationMessage(
        '빈 풀이 파일을 만들까요?',
        {
          modal: true,
          detail: relativePath,
        },
        '만들기',
      );
      if (choice !== '만들기') {
        return { status: 'cancelled' };
      }
    }

    await vscode.workspace.fs.writeFile(targetUri, new Uint8Array());
    return { status: 'created', uri: targetUri };
  }

  async delete(request: DeleteSolutionRequest): Promise<DeleteSolutionResult> {
    if (request.confirm) {
      const firstChoice = await vscode.window.showWarningMessage(
        '풀이 파일을 삭제할까요?',
        {
          modal: true,
          detail: request.relativePath,
        },
        '계속',
      );
      if (firstChoice !== '계속') {
        return { status: 'cancelled' };
      }

      const secondChoice = await vscode.window.showWarningMessage(
        '정말 삭제할까요?',
        {
          modal: true,
          detail: `${request.relativePath}\n삭제한 파일은 휴지통에서 복원할 수 있습니다.`,
        },
        '삭제',
      );
      if (secondChoice !== '삭제') {
        return { status: 'cancelled' };
      }
    }

    await vscode.workspace.fs.delete(request.uri, { recursive: false, useTrash: true });
    return { status: 'deleted' };
  }

  async fixLineEndings(uris: readonly vscode.Uri[]): Promise<FixLineEndingsResult> {
    const targetUris = new Set(uris.map((uri) => uri.toString()));
    const dirtyDocument = vscode.workspace.textDocuments.find(
      (document) => document.isDirty && targetUris.has(document.uri.toString()),
    );
    if (dirtyDocument) {
      throw new Error(
        `저장하지 않은 풀이 파일이 있습니다. 먼저 저장한 뒤 다시 시도해 주세요: ${dirtyDocument.uri.path.split('/').pop() ?? dirtyDocument.uri.path}`,
      );
    }

    let fixed = 0;
    for (const uri of uris) {
      const content = await vscode.workspace.fs.readFile(uri);
      const nextContent = addMissingEndOfFileNewline(content);
      if (nextContent) {
        await vscode.workspace.fs.writeFile(uri, nextContent);
        fixed += 1;
      }
    }

    return { checked: uris.length, fixed };
  }
}
