import * as vscode from 'vscode';
import type {
  RepositorySubmissionSnapshot,
  SolutionGitStatus,
  SolutionSubmissionStatus,
  SubmissionFileSnapshot,
} from '../../shared/contracts';
import { GitHubAuthService } from '../github/githubAuth';
import { GitHubSubmissionClient, githubRequestNeedsSignIn } from '../github/githubSubmissionClient';
import { SubmissionActions, type SubmissionSolution } from './submission/submissionActions';
import { summaryForStatuses } from './submission/submissionModel';
import { SubmissionStatusReader } from './submission/submissionStatusReader';
import { GitRepositoryAdapter, addChangeUris } from './vscodeGit';

export type { SubmissionSolution } from './submission/submissionActions';

/** 풀이별 Git·제출 상태, PR 번호와 저장소 제출 스냅샷을 함께 반환하는 조회 결과입니다. */
export interface SolutionGitStatusResult {
  remoteName?: string;
  statuses: ReadonlyMap<string, SolutionGitStatus>;
  submissionStatuses?: ReadonlyMap<string, SolutionSubmissionStatus>;
  pullRequestNumbers?: ReadonlyMap<string, number>;
  submission?: RepositorySubmissionSnapshot;
}

/** VS Code Git 이벤트와 인증 수명을 관리하며 상태 조회와 제출 작업을 전용 모듈에 위임합니다. */
export class GitStatusService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly repositoryAdapter = new GitRepositoryAdapter();
  private readonly githubAuth = new GitHubAuthService(() => this.onGitHubSessionsChanged());
  private readonly githubClient = new GitHubSubmissionClient(() =>
    this.githubAuth.getAccessToken(),
  );
  private readonly submissionActions = new SubmissionActions(
    this.repositoryAdapter,
    this.githubClient,
  );
  private readonly submissionStatusReader = new SubmissionStatusReader(this.githubClient);
  private readonly disposables: vscode.Disposable[] = [
    this.githubAuth,
    this.repositoryAdapter.onDidChange(() => this.changeEmitter.fire()),
  ];
  readonly onDidChange = this.changeEmitter.event;

  /**
   * 풀이별 upstream 반영 여부와 주차 제출 상태를 조회합니다. 조회할 수 없는 상태는 unknown으로 남깁니다.
   * @param forceStatus 조회 전에 실제 Git 상태를 새로 읽을지 여부.
   * @param forceRemote 원격 상태 캐시를 우회할지 여부.
   */
  async getStatuses(
    repositoryRoot: vscode.Uri,
    solutionUris: readonly string[],
    forceStatus = false,
    submissionSolutions: readonly SubmissionSolution[] = [],
    forceRemote = false,
  ): Promise<SolutionGitStatusResult> {
    const statuses = new Map(solutionUris.map((uri) => [uri, 'unknown' as SolutionGitStatus]));
    if (solutionUris.length === 0) {
      return { statuses };
    }

    const repository = await this.repositoryAdapter.getRepository(repositoryRoot);
    if (!repository) {
      return { statuses };
    }

    try {
      if (forceStatus) {
        await repository.status();
      }
      const upstream = repository.state.HEAD?.upstream;
      const changedUris = new Set<string>();
      const { state } = repository;
      addChangeUris(changedUris, state.mergeChanges);
      addChangeUris(changedUris, state.indexChanges);
      addChangeUris(changedUris, state.workingTreeChanges);
      addChangeUris(changedUris, state.untrackedChanges);

      if (upstream) {
        const committedChanges = await this.repositoryAdapter.getCommittedChanges(
          repository,
          upstream,
        );
        for (const uri of committedChanges) {
          changedUris.add(uri);
        }
      }

      for (const uri of solutionUris) {
        statuses.set(uri, !upstream ? 'unknown' : changedUris.has(uri) ? 'unpushed' : 'pushed');
      }
      const submissionResult =
        submissionSolutions.length > 0
          ? await this.submissionStatusReader.read(repository, submissionSolutions, forceRemote)
          : undefined;
      return {
        remoteName: upstream?.remote,
        statuses,
        submissionStatuses: submissionResult?.statuses,
        pullRequestNumbers: submissionResult?.pullRequestNumbers,
        submission: submissionResult?.snapshot,
      };
    } catch (error) {
      if (submissionSolutions.length === 0) {
        return { statuses };
      }
      const submissionStatuses = new Map(
        submissionSolutions.map(({ uri }) => [uri, 'unknown' as SolutionSubmissionStatus]),
      );
      return {
        statuses,
        submissionStatuses,
        pullRequestNumbers: new Map(),
        submission: {
          status: 'unavailable',
          fork: {
            status: 'unavailable',
            reason: error instanceof Error ? error.message : 'Git 제출 상태를 확인할 수 없습니다.',
            needsGitHubSignIn: githubRequestNeedsSignIn(error),
          },
          stagedFiles: [],
          otherStagedFiles: [],
          pendingCommits: [],
          forkFiles: [],
          otherForkFiles: [],
          summary: summaryForStatuses(submissionStatuses),
          canSync: false,
          canReturnToMain: false,
          hasCanonicalRemote: false,
          behindOfficialMain: false,
          blockingTrackedFiles: [],
        },
      };
    }
  }

  /** 제출 작업기에 풀이 스테이징과 주차 검증을 위임합니다. */
  async stageSolution(
    repositoryRoot: vscode.Uri,
    uri: vscode.Uri,
    week: number | undefined,
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    return this.submissionActions.stageSolution(repositoryRoot, uri, week, solutions);
  }

  /** 제출 작업기에 풀이 스테이징 해제를 위임합니다. */
  async unstageSolution(repositoryRoot: vscode.Uri, uri: vscode.Uri): Promise<void> {
    return this.submissionActions.unstageSolution(repositoryRoot, uri);
  }

  /** 제출 작업기에 현재 주차 풀이의 검증과 커밋을 위임합니다. */
  async commit(
    repositoryRoot: vscode.Uri,
    message: string,
    expectedFiles: readonly SubmissionFileSnapshot[],
    solutions: readonly SubmissionSolution[],
  ): Promise<void> {
    return this.submissionActions.commit(repositoryRoot, message, expectedFiles, solutions);
  }

  /** 제출 작업기에 주차 브랜치의 검증과 push를 위임합니다. */
  async push(repositoryRoot: vscode.Uri, solutions: readonly SubmissionSolution[]): Promise<void> {
    return this.submissionActions.push(repositoryRoot, solutions);
  }

  /** 제출 작업기에 공식 main과 포크 동기화를 위임합니다. */
  async syncFork(
    repositoryRoot: vscode.Uri,
    solutions: readonly SubmissionSolution[] = [],
  ): Promise<void> {
    return this.submissionActions.syncFork(repositoryRoot, solutions);
  }

  /** 제출 작업기에 풀이 외 추적 파일 변경 되돌리기를 위임합니다. */
  async discardOtherTrackedChanges(
    repositoryRoot: vscode.Uri,
    solutions: readonly SubmissionSolution[],
    expectedRelativePaths: readonly string[],
  ): Promise<void> {
    return this.submissionActions.discardOtherTrackedChanges(
      repositoryRoot,
      solutions,
      expectedRelativePaths,
    );
  }

  /** 제출 작업기에 main 복귀와 공식 main 동기화를 위임합니다. */
  async returnToMainAndSync(
    repositoryRoot: vscode.Uri,
    solutions: readonly SubmissionSolution[] = [],
  ): Promise<void> {
    return this.submissionActions.returnToMainAndSync(repositoryRoot, solutions);
  }

  /** 제출 작업기에 주차 PR 또는 생성 화면 열기를 위임합니다. */
  async openPullRequest(submission: RepositorySubmissionSnapshot, nickname: string): Promise<void> {
    return this.submissionActions.openPullRequest(submission, nickname);
  }

  /** GitHub 로그인을 요청하고 성공하면 이전 인증으로 만든 원격 캐시를 비웁니다. */
  async signInGitHub(): Promise<boolean> {
    const token = await this.githubAuth.getAccessToken({ prompt: true });
    if (!token) {
      return false;
    }
    this.githubClient.clearCaches();
    return true;
  }

  /** Git·인증 구독과 조회 캐시를 해제하고 상태 이벤트 발행기를 종료합니다. */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.repositoryAdapter.dispose();
    this.githubClient.dispose();
    this.changeEmitter.dispose();
  }

  /** 계정이 바뀌면 이전 계정의 조회 결과를 재사용하지 않도록 캐시를 무효화합니다. */
  private onGitHubSessionsChanged(): void {
    this.githubClient.clearCaches();
    this.changeEmitter.fire();
  }
}
