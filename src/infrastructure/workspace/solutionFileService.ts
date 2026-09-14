import * as vscode from 'vscode';
import { findLanguage } from '../../domain/solutions/languages';
import {
  addMissingEndOfFileNewline,
  isValidNickname,
  targetFileStatus,
} from '../../domain/solutions/solutions';

/** 풀이 파일을 생성할 저장소·문제·닉네임·언어와 확인 창 사용 여부입니다. */
export interface CreateSolutionRequest {
  rootUri: string;
  slug: string;
  nickname: string;
  preferredLanguage: string;
  confirm: boolean;
}

/** 풀이 생성 성공, 사용자 취소와 기존 파일 발견을 구분한 결과입니다. */
export type CreateSolutionResult =
  | { status: 'created'; uri: vscode.Uri }
  | { status: 'cancelled' }
  | { status: 'exists'; uri: vscode.Uri };

/** 삭제할 풀이 URI, 확인 창에 표시할 상대 경로와 확인 여부입니다. */
export interface DeleteSolutionRequest {
  uri: vscode.Uri;
  relativePath: string;
  confirm: boolean;
}

/** 풀이 삭제 완료와 사용자 취소를 구분한 결과입니다. */
export type DeleteSolutionResult = { status: 'deleted' } | { status: 'cancelled' };

/** 줄 끝 보정 작업에서 검사한 파일 수와 실제 수정한 파일 수입니다. */
export interface FixLineEndingsResult {
  checked: number;
  fixed: number;
}

/**
 * StudyController가 검증한 대상에 실제 파일 쓰기를 수행하는 서비스입니다.
 * 확인 창과 파일 시스템 접근을 담당하며 목록 갱신·편집기 열기는 컨트롤러에 남깁니다.
 * 워크스페이스 신뢰와 대상이 현재 목록에 속하는지는 호출자가 먼저 확인해야 합니다.
 */
export class SolutionFileService {
  /**
   * 파일명을 검증하고 디렉터리에서 존재 여부를 확인한 뒤 빈 파일을 기록합니다.
   * 발견한 기존 파일은 exists로 반환하며 대소문자만 다른 이름은 오류입니다.
   * confirm이 true일 때만 생성 확인을 표시하고 취소는 cancelled로 반환합니다.
   * @throws 잘못된 닉네임·언어, 대소문자 충돌 또는 파일 시스템 읽기·쓰기 실패.
   */
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
        (name) => name.toLocaleLowerCase('en-US') === targetName.toLocaleLowerCase('en-US'),
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

  /** 요청에 따라 두 번 확인한 뒤 파일을 휴지통으로 보냅니다. 취소하면 파일을 변경하지 않습니다. */
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

  /**
   * 대상 전체의 미저장 문서를 먼저 확인한 다음 파일을 순서대로 읽고 필요한 개행만 기록합니다.
   * 실행 중 파일 오류가 발생하면 오류를 전달하며 이미 수정한 앞선 파일을 되돌리지는 않습니다.
   * Markdown 제외와 URI 중복 제거는 호출자가 수행합니다.
   */
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
