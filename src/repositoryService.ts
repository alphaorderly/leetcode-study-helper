import * as vscode from 'vscode';
import { parseProblemCatalog } from './core/catalog';
import { isMatchingSolution } from './core/solutions';
import { getProblemWeek } from './core/studySchedule';
import type {
  DetectionIssue,
  ProblemSnapshot,
  RepositorySnapshot,
} from './core/types';

export interface ScanResult {
  repositories: RepositorySnapshot[];
  issues: DetectionIssue[];
}

interface DirectoryEntry {
  name: string;
  type: vscode.FileType;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

export class StudyRepositoryService {
  async scan(nickname: string): Promise<ScanResult> {
    const results = await Promise.all((vscode.workspace.workspaceFolders ?? []).map(async (folder) => {
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
    }));

    return {
      repositories: results.flatMap(({ repository }) => repository ? [repository] : []),
      issues: results.flatMap(({ issue }) => issue ? [issue] : []),
    };
  }

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

    const slugs = Object.keys(catalog).filter((slug) => problemFolders.has(slug)).sort();
    if (slugs.length === 0) {
      throw new Error('problem-categories.json과 일치하는 문제 폴더가 없습니다.');
    }

    const problems = await Promise.all(
      slugs.map(async (slug): Promise<ProblemSnapshot> => {
        const problemUri = vscode.Uri.joinPath(folder.uri, slug);
        const entries = await this.readDirectory(problemUri);
        const solutions = entries
          .filter(({ type }) => (type & vscode.FileType.File) !== 0)
          .filter(({ name }) => isMatchingSolution(name, nickname))
          .map(({ name }) => ({
            name,
            uri: vscode.Uri.joinPath(problemUri, name).toString(),
            gitStatus: 'unknown' as const,
          }))
          .sort((left, right) => left.name.localeCompare(right.name));

        return {
          slug,
          week: getProblemWeek(slug),
          ...catalog[slug]!,
          completed: solutions.length > 0,
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
    const solutions = (await this.readDirectory(problemUri))
      .filter(({ type }) => (type & vscode.FileType.File) !== 0)
      .filter(({ name }) => isMatchingSolution(name, nickname))
      .map(({ name }) => ({
        name,
        uri: vscode.Uri.joinPath(problemUri, name).toString(),
        gitStatus: 'unknown' as const,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const problems = [...repository.problems];
    problems[problemIndex] = {
      ...problems[problemIndex]!,
      completed: solutions.length > 0,
      solutions,
    };
    return { ...repository, problems };
  }

  private async readDirectory(uri: vscode.Uri): Promise<DirectoryEntry[]> {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    return entries.map(([name, type]) => ({ name, type }));
  }
}
