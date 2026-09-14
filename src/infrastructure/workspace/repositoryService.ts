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

/** 워크스페이스의 문제 카탈로그와 풀이 파일을 탐색하고 한 문제의 상태를 다시 읽습니다. */
export class StudyRepositoryService {
  /** 워크스페이스 루트를 병렬 탐색하고 루트별 실패를 issues로 분리해 반환합니다. */
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

  /** 등록된 한 문제의 풀이·다른 풀이 여부·정답 링크를 다시 읽어 교체합니다. */
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

  /** 문제 README에서 정답 링크를 추출하며 파일이 없을 때만 undefined를 반환합니다. */
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
