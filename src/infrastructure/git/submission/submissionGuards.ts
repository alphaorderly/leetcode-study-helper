import type * as vscode from 'vscode';
import {
  type GitHubSubmissionClient,
  type ParsedGitHubRemote,
  parseConsistentRemote,
} from '../../github/githubSubmissionClient';
import { type SubmissionSolution, submissionFilesByPath } from './submissionFiles';
import { collectBlockingTrackedFiles, trackedFilesBlockSync } from './submissionModel';
import {
  type GitCommit,
  type GitRepository,
  type GitRepositoryAdapter,
  gitRefLookupPattern,
  relativeChangePaths,
  relativeGitPath,
} from '../vscodeGit';

export const MAX_PUSH_COMMITS = 200;

/** Git 작업 경계에서 저장소 신원, 변경 파일과 제출 이력을 검증합니다. */
export class SubmissionGuards {
  /** 저장소 접근기와 포크 신원 조회기를 검증 작업에 연결합니다. */
  constructor(
    private readonly repositoryAdapter: GitRepositoryAdapter,
    private readonly githubClient: GitHubSubmissionClient,
  ) {}

  /**
   * 실제 Git 상태와 포크 신원을 확인합니다. 원격 조회 이후 상태와 origin을 다시 검증합니다.
   * @throws 브랜치·진행 중 작업·포크 신원·origin이 제출 조건을 만족하지 않는 경우.
   */
  async requireSubmissionMutation(
    repositoryRoot: vscode.Uri,
    forceIdentity: boolean,
  ): Promise<GitRepository> {
    const repository = await this.repositoryAdapter.requireRepository(repositoryRoot);
    await repository.status();
    this.requireCleanOperationState(repository);
    const origin = this.requireOrigin(repository);
    const identity = await this.githubClient.getForkIdentity(origin, forceIdentity);
    if (identity.status !== 'verified') {
      throw new Error(identity.reason ?? 'DaleStudy 포크를 확인할 수 없습니다.');
    }
    await repository.status();
    this.requireCleanOperationState(repository);
    this.requireUnchangedOrigin(repository, origin);
    return repository;
  }

  /** 브랜치가 없거나 merge·rebase가 진행 중이면 오류를 던집니다. */
  requireCleanOperationState(repository: GitRepository): void {
    if (!repository.state.HEAD?.name) {
      throw new Error('현재 Git 브랜치를 확인할 수 없습니다.');
    }
    if (repository.state.rebaseCommit || repository.state.mergeChanges.length > 0) {
      throw new Error('진행 중인 merge 또는 rebase를 먼저 정리해 주세요.');
    }
  }

  /** fetch/push URL이 같은 GitHub 저장소를 가리킬 때만 origin 정보를 반환합니다. */
  requireOrigin(repository: GitRepository) {
    const origin = parseConsistentRemote(
      repository.state.remotes.find(({ name }) => name === 'origin'),
    );
    if (!origin) {
      throw new Error('origin의 fetch/push URL이 동일한 GitHub 저장소를 가리키지 않습니다.');
    }
    return origin;
  }

  /** 검증 당시 origin과 현재 origin을 비교해 작업 도중 대상 저장소가 바뀌는 것을 막습니다. */
  requireUnchangedOrigin(repository: GitRepository, expected: ParsedGitHubRemote): void {
    const current = this.requireOrigin(repository);
    if (
      current.owner.toLowerCase() !== expected.owner.toLowerCase() ||
      current.repository.toLowerCase() !== expected.repository.toLowerCase() ||
      current.url !== expected.url
    ) {
      throw new Error('Git 작업 중 origin URL이 변경되어 중단했습니다.');
    }
  }

  /** 두 ref의 공통 조상을 반환하며 확인할 수 없으면 오류를 던집니다. */
  async requireMergeBase(
    repository: GitRepository,
    baseRef: string,
    headRef: string,
  ): Promise<string> {
    const mergeBase = await repository.getMergeBase(headRef, baseRef);
    if (!mergeBase) {
      throw new Error(`${baseRef}와 ${headRef}의 공통 기준점을 확인할 수 없습니다.`);
    }
    return mergeBase;
  }

  /** 스테이징·충돌·풀이 외 추적 파일 변경이 동기화를 막는지 확인합니다. */
  hasBlockingDirtyState(
    repository: GitRepository,
    solutions: readonly SubmissionSolution[],
  ): boolean {
    return trackedFilesBlockSync(this.blockingTrackedFiles(repository, solutions));
  }

  /** 현재 index·작업 트리·충돌 경로를 풀이 여부와 함께 분류합니다. */
  blockingTrackedFiles(repository: GitRepository, solutions: readonly SubmissionSolution[]) {
    const solutionPaths = new Set(submissionFilesByPath(repository, solutions).keys());
    return collectBlockingTrackedFiles(
      relativeChangePaths(repository.rootUri, repository.state.indexChanges),
      relativeChangePaths(repository.rootUri, repository.state.workingTreeChanges),
      relativeChangePaths(repository.rootUri, repository.state.mergeChanges),
      solutionPaths,
    );
  }

  /** 풀이 파일을 제외한 index·작업 트리 변경의 절대 경로를 중복 없이 반환합니다. */
  otherTrackedChangePaths(
    repository: GitRepository,
    solutions: readonly SubmissionSolution[],
  ): string[] {
    const solutionPaths = new Set(submissionFilesByPath(repository, solutions).keys());
    const paths = new Set<string>();
    for (const change of [
      ...repository.state.indexChanges,
      ...repository.state.workingTreeChanges,
    ]) {
      if (!solutionPaths.has(relativeGitPath(repository.rootUri, change.uri))) {
        paths.add(change.uri.fsPath);
      }
    }
    return [...paths];
  }

  /**
   * 공통 조상 이후의 각 커밋에 지정 주차의 풀이만 포함되었는지 확인합니다.
   * @throws merge 커밋, 불명확한 변경 경로 또는 조회 한도 초과가 있는 경우.
   */
  async requireSafeSubmissionHistory(
    repository: GitRepository,
    baseRef: string,
    headRef: string,
    expectedWeek: number,
    fileByPath: ReadonlyMap<string, SubmissionSolution>,
  ): Promise<void> {
    const mergeBase = await this.requireMergeBase(repository, baseRef, headRef);
    const commits = await repository.log({
      range: `${mergeBase}..${headRef}`,
      reverse: true,
      maxEntries: MAX_PUSH_COMMITS + 1,
    });
    if (commits.length > MAX_PUSH_COMMITS) {
      throw new Error(`${headRef}의 커밋이 너무 많아 자동으로 검증할 수 없습니다.`);
    }
    for (const commit of commits) {
      rejectMergeCommit(commit);
      const parent = commit.parents[0];
      if (!parent) {
        throw new Error(`커밋 ${commit.hash.slice(0, 7)}의 변경 범위를 확인할 수 없습니다.`);
      }
      const paths = relativeChangePaths(
        repository.rootUri,
        await repository.diffBetween(parent, commit.hash),
      );
      if (paths.size === 0) {
        throw new Error(`커밋 ${commit.hash.slice(0, 7)}의 변경 파일을 확인할 수 없습니다.`);
      }
      for (const relativePath of paths) {
        const solution = fileByPath.get(relativePath);
        if (solution?.week !== expectedWeek) {
          throw new Error(`${headRef}에 Week ${expectedWeek} 풀이 외 변경이 포함되어 있습니다.`);
        }
      }
    }
  }

  /** 정확히 일치하는 ref를 찾습니다. 조회 실패와 없는 ref는 undefined로 반환합니다. */
  async getBranch(repository: GitRepository, name: string) {
    try {
      return (await repository.getRefs({ pattern: gitRefLookupPattern(name) })).find(
        (ref) => ref.name === name,
      );
    } catch {
      return undefined;
    }
  }
}

/** 부모가 여럿인 merge 커밋이면 자동 제출 검증을 중단하는 오류를 던집니다. */
export function rejectMergeCommit(commit: GitCommit): void {
  if (commit.parents.length > 1) {
    throw new Error(
      `커밋 ${commit.hash.slice(0, 7)}에 공식 main이 아닌 merge 히스토리가 포함되어 있습니다.`,
    );
  }
}
