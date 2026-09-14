import * as vscode from 'vscode';
import { extractAnswerUrl } from '../../domain/problems/answerLinks';
import { parseProblemCatalog } from '../../domain/problems/catalog';
import {
  isOtherSolutionFile,
  selectRandomOtherSolution,
} from '../../domain/solutions/otherSolutions';
import { isMatchingSolution } from '../../domain/solutions/solutions';
import { getProblemWeek } from '../../domain/study/studySchedule';
import type { DetectionIssue, ProblemSnapshot, RepositorySnapshot } from '../../shared/contracts';

/** 인식한 스터디 저장소 목록과 루트별 탐색 오류입니다. */
export interface ScanResult {
  repositories: RepositorySnapshot[];
  issues: DetectionIssue[];
}

/** VS Code 파일 시스템에서 읽은 항목 이름과 파일 종류입니다. */
interface DirectoryEntry {
  name: string;
  type: vscode.FileType;
}

/** 탐색 대상이 없는 FileNotFound 오류인지 확인합니다. */
function isMissingFile(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

/**
 * 갱신 세션이 사용하는 파일 탐색 전용 서비스입니다. 카탈로그와 실제 폴더가 일치하는 문제만
 * 읽으며 닉네임·파일명으로 내 풀이를 분류합니다. 소스 실행이나 Git 조회는 하지 않습니다.
 * 완료 여부는 파일 존재 여부이고 Git 초기 상태는 unknown으로 반환합니다.
 */
export class StudyRepositoryService {
  /**
   * 각 워크스페이스 루트를 독립적으로 탐색하므로 한 루트 실패가 다른 루트의 목록을 막지 않습니다.
   * 카탈로그 없는 루트는 정상적으로 건너뛰고, 잘못된 카탈로그·파일 접근 실패는 해당 루트의 issues로 반환합니다.
   */
  async scan(nickname: string): Promise<ScanResult> {
    const results = await Promise.all(
      (vscode.workspace.workspaceFolders ?? []).map(async (folder) => {
        try {
          const repository = await this.scanFolder(folder, nickname);
          return { repository };
        } catch (error) {
          return {
            issue: {
              rootName: folder.name,
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      }),
    );

    return {
      repositories: results.flatMap(({ repository }) => (repository ? [repository] : [])),
      issues: results.flatMap(({ issue }) => (issue ? [issue] : [])),
    };
  }

  /** 카탈로그와 실제 문제 폴더를 결합하며 카탈로그가 없는 루트는 건너뜁니다. */
  private async scanFolder(
    folder: vscode.WorkspaceFolder,
    nickname: string,
  ): Promise<RepositorySnapshot | undefined> {
    const catalogUri = vscode.Uri.joinPath(folder.uri, 'problem-categories.json');
    let catalogBytes: Uint8Array;

    try {
      catalogBytes = await vscode.workspace.fs.readFile(catalogUri);
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }

    const catalog = parseProblemCatalog(new TextDecoder().decode(catalogBytes));
    const rootEntries = await this.readDirectory(folder.uri);
    const problemFolders = new Set(
      rootEntries
        .filter(({ type }) => (type & vscode.FileType.Directory) !== 0)
        .map(({ name }) => name),
    );

    const slugs = Object.keys(catalog)
      .filter((slug) => problemFolders.has(slug))
      .sort();
    if (slugs.length === 0) {
      throw new Error('problem-categories.json과 일치하는 문제 폴더가 없습니다.');
    }

    const problems = await Promise.all(
      slugs.map(async (slug): Promise<ProblemSnapshot> => {
        const problemUri = vscode.Uri.joinPath(folder.uri, slug);
        const entries = await this.readDirectory(problemUri);
        const solutionUrl = await this.readAnswerUrl(problemUri);
        const fileNames = entries
          .filter(({ type }) => (type & vscode.FileType.File) !== 0)
          .map(({ name }) => name);
        const solutions = fileNames
          .filter((name) => isMatchingSolution(name, nickname))
          .map((name) => ({
            name,
            uri: vscode.Uri.joinPath(problemUri, name).toString(),
            gitStatus: 'unknown' as const,
          }))
          .sort((left, right) => left.name.localeCompare(right.name));

        return {
          slug,
          week: getProblemWeek(slug),
          solutionUrl,
          ...catalog[slug]!,
          completed: solutions.length > 0,
          hasOtherSolutions: fileNames.some((name) => isOtherSolutionFile(name, nickname)),
          solutions,
        };
      }),
    );

    return {
      name: folder.name,
      rootUri: folder.uri.toString(),
      problems,
    };
  }

  /**
   * 기존 카탈로그 정보는 유지하고 지정 문제의 파일 목록과 정답 링크만 다시 읽습니다.
   * 새 저장소·문제 배열을 만들어 반환하며, 등록되지 않은 slug이면 입력 저장소를 그대로 반환합니다.
   * 파일 읽기 오류는 호출자에게 전달하고 Git 상태 결합은 갱신 세션에서 수행합니다.
   */
  async refreshProblem(
    repository: RepositorySnapshot,
    slug: string,
    nickname: string,
  ): Promise<RepositorySnapshot> {
    const problemIndex = repository.problems.findIndex((problem) => problem.slug === slug);
    if (problemIndex === -1) {
      return repository;
    }

    const problemUri = vscode.Uri.joinPath(vscode.Uri.parse(repository.rootUri), slug);
    const solutionUrl = await this.readAnswerUrl(problemUri);
    const fileNames = (await this.readDirectory(problemUri))
      .filter(({ type }) => (type & vscode.FileType.File) !== 0)
      .map(({ name }) => name);
    const solutions = fileNames
      .filter((name) => isMatchingSolution(name, nickname))
      .map((name) => ({
        name,
        uri: vscode.Uri.joinPath(problemUri, name).toString(),
        gitStatus: 'unknown' as const,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const problems = [...repository.problems];
    problems[problemIndex] = {
      ...problems[problemIndex]!,
      solutionUrl,
      completed: solutions.length > 0,
      hasOtherSolutions: fileNames.some((name) => isOtherSolutionFile(name, nickname)),
      solutions,
    };
    return { ...repository, problems };
  }

  /** 선호 언어와 직전 선택을 고려해 다른 참여자의 풀이 URI를 고릅니다. */
  async findOtherSolution(
    repository: RepositorySnapshot,
    slug: string,
    nickname: string,
    preferredExtension: string,
    previousFileName?: string,
  ): Promise<vscode.Uri | undefined> {
    const problemUri = vscode.Uri.joinPath(vscode.Uri.parse(repository.rootUri), slug);
    const fileNames = (await this.readDirectory(problemUri))
      .filter(({ type }) => (type & vscode.FileType.File) !== 0)
      .map(({ name }) => name);
    const selected = selectRandomOtherSolution(
      fileNames,
      nickname,
      preferredExtension,
      previousFileName,
    );
    return selected ? vscode.Uri.joinPath(problemUri, selected) : undefined;
  }

  /** 디렉터리 항목을 이름·종류 객체로 변환하며 읽기 오류는 호출자에게 전달합니다. */
  private async readDirectory(uri: vscode.Uri): Promise<DirectoryEntry[]> {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    return entries.map(([name, type]) => ({ name, type }));
  }

  /**
   * 문제 README에서 허용된 정답 링크를 찾습니다. 파일이 없거나 유효한 링크가 없으면 undefined입니다.
   * 권한 오류 등 FileNotFound 이외의 읽기 오류는 숨기지 않고 호출자에게 전달합니다.
   */
  private async readAnswerUrl(problemUri: vscode.Uri): Promise<string | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(problemUri, 'README.md'),
      );
      return extractAnswerUrl(new TextDecoder().decode(bytes));
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }
}
