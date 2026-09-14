import * as vscode from 'vscode';
import { relativeGitPath, type GitRepository } from '../vscodeGit';

/** 제출 검증에 사용하는 풀이의 식별 정보. 주차가 없으면 제출할 수 없습니다. */
export interface SubmissionSolution {
  readonly name: string;
  readonly uri: string;
  readonly slug: string;
  readonly week?: number;
}

/** 저장소 상대 경로를 키로 풀이를 조회합니다. 파일 내용은 읽지 않습니다. */
export function submissionFilesByPath(
  repository: GitRepository,
  solutions: readonly SubmissionSolution[],
): ReadonlyMap<string, SubmissionSolution> {
  return new Map(
    solutions.map((solution) => [
      relativeGitPath(repository.rootUri, vscode.Uri.parse(solution.uri)),
      solution,
    ]),
  );
}
