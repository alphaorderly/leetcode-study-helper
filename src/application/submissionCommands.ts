import * as vscode from 'vscode';
import type { ExtensionSnapshot, RepositorySnapshot } from '../shared/contracts';
import type { GitStatusService } from '../infrastructure/git/gitStatusService';
import { requireSolution } from './snapshotQueries';

/** 제출 명령이 호출하는 Git 기능만 노출하여 조회·구독 수명과 분리합니다. */
type SubmissionGitService = Pick<
  GitStatusService,
  | 'stageSolution'
  | 'unstageSolution'
  | 'commit'
  | 'push'
  | 'openPullRequest'
  | 'syncFork'
  | 'discardOtherTrackedChanges'
  | 'returnToMainAndSync'
  | 'signInGitHub'
>;

/**
 * 컨트롤러에서 제출 명령의 사전 확인과 실행 후 갱신을 위임받습니다.
 * 화면 상태를 직접 변경하지 않으며 명령 시점마다 getSnapshot으로 최신 게시 상태를 읽습니다.
 * 여기서 확인하는 스냅샷은 안내와 선택 범위용입니다. 실제 쓰기 직전 검증은 Git 서비스에 남깁니다.
 * 주입된 서비스·갱신 함수의 수명은 컨트롤러가 소유하므로 이 객체는 별도로 dispose하지 않습니다.
 */
export class SubmissionCommands {
  /** 전체 컨트롤러 대신 읽기·Git 명령·두 종류의 갱신 경계만 연결합니다. */
  constructor(
    private readonly getSnapshot: () => ExtensionSnapshot,
    private readonly gitStatusService: SubmissionGitService,
    private readonly refreshGitStatuses: (
      forceStatus?: boolean,
      forceRemote?: boolean,
    ) => Promise<void>,
    private readonly refreshAll: () => Promise<ExtensionSnapshot>,
  ) {}

  /** 신뢰·풀이·주차를 확인해 스테이징하고 Git 표시 상태를 다시 읽습니다. */
  async stageSolution(uriString: string): Promise<void> {
    this.requireTrustedWorkspace('풀이를 커밋에 추가하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    const target = requireSolution(this.getSnapshot(), uriString);
    const repository = this.requireSubmissionRepository(target.rootUri);
    this.validateSubmissionWeek(repository, target.week);
    await this.gitStatusService.stageSolution(
      vscode.Uri.parse(target.rootUri),
      vscode.Uri.parse(target.uri),
      target.week,
      this.submissionSolutions(repository),
    );
    await this.refreshGitStatuses(true);
  }

  /** 등록된 풀이의 스테이징을 해제하고 Git 표시 상태를 다시 읽습니다. */
  async unstageSolution(uriString: string): Promise<void> {
    this.requireTrustedWorkspace('스테이징을 해제하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    const target = requireSolution(this.getSnapshot(), uriString);
    this.requireSubmissionRepository(target.rootUri, true);
    await this.gitStatusService.unstageSolution(
      vscode.Uri.parse(target.rootUri),
      vscode.Uri.parse(target.uri),
    );
    await this.refreshGitStatuses(true);
  }

  /** 활성 주차와 스테이징 상태를 확인해 커밋하고 성공하면 Git 표시 상태를 갱신합니다. */
  async commitActiveWeek(rootUri: string, message: string): Promise<void> {
    this.requireTrustedWorkspace('풀이를 커밋하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    const repository = this.requireSubmissionRepository(rootUri);
    const submission = repository.submission!;
    if (!submission.activeSubmissionWeek || submission.stagedFiles.length === 0) {
      throw new Error('커밋 준비 상태인 풀이가 없습니다.');
    }
    if (submission.stagedFiles.some(({ week }) => week !== submission.activeSubmissionWeek)) {
      throw new Error('서로 다른 주차의 풀이를 한 커밋에 포함할 수 없습니다.');
    }
    const stagedUris = new Set(submission.stagedFiles.map(({ uri }) => uri));
    const stagedOutdated = repository.problems
      .flatMap(({ solutions }) => solutions)
      .some(
        ({ uri, submissionStatus }) =>
          stagedUris.has(uri) && submissionStatus === 'staged-outdated',
      );
    if (stagedOutdated) {
      throw new Error('스테이징 후 수정된 풀이를 다시 커밋에 추가해 주세요.');
    }
    await this.gitStatusService.commit(
      vscode.Uri.parse(rootUri),
      message,
      submission.stagedFiles,
      this.submissionSolutions(repository),
    );
    await this.refreshGitStatuses(true);
  }

  /** 활성 저장소의 주차 브랜치를 push하고 Git·원격 상태를 다시 읽습니다. */
  async pushActiveWeek(rootUri: string): Promise<void> {
    this.requireTrustedWorkspace('풀이를 push하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    const repository = this.requireSubmissionRepository(rootUri);
    await this.gitStatusService.push(
      vscode.Uri.parse(rootUri),
      this.submissionSolutions(repository),
    );
    await this.refreshGitStatuses(true, true);
  }

  /** 선택한 저장소의 제출 상태로 주차 PR 또는 생성 화면을 엽니다. */
  async openPullRequest(rootUri: string): Promise<void> {
    const repository = this.requireSubmissionRepository(rootUri);
    await this.gitStatusService.openPullRequest(
      repository.submission!,
      this.getSnapshot().nickname,
    );
  }

  /** 신뢰·저장소·동기화 가능 여부를 확인해 포크를 동기화하고 성공하면 전체 상태를 갱신합니다. */
  async syncFork(rootUri: string): Promise<void> {
    this.requireTrustedWorkspace('포크를 동기화하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    const repository = this.requireSubmissionRepository(rootUri);
    if (!repository.submission?.canSync) {
      throw new Error('현재 Git 변경을 정리한 뒤 포크를 동기화해 주세요.');
    }
    await this.gitStatusService.syncFork(
      vscode.Uri.parse(rootUri),
      this.submissionSolutions(repository),
    );
    await this.refreshAll();
    await this.refreshGitStatuses(true, true);
  }

  /** 대상 변경 목록을 보여주고 확인받은 뒤 풀이 외 추적 변경을 되돌립니다. */
  async discardOtherTrackedChanges(rootUri: string): Promise<void> {
    this.requireTrustedWorkspace('변경을 되돌리려면 먼저 워크스페이스를 신뢰해야 합니다.');
    const repository = this.requireSubmissionRepository(rootUri, true);
    const paths =
      repository.submission?.blockingTrackedFiles
        .filter(({ kind, state }) => kind === 'other' && state !== 'conflict')
        .map(({ relativePath }) => relativePath)
        .sort() ?? [];
    if (paths.length === 0) {
      throw new Error('되돌릴 풀이 외 추적 파일 변경이 없습니다.');
    }
    const confirmation = '변경 되돌리기';
    const selected = await vscode.window.showWarningMessage(
      `풀이 외 추적 파일 ${paths.length}개의 변경을 되돌립니다.`,
      {
        modal: true,
        detail: `${paths.join('\n')}\n\n풀이 파일과 untracked 파일은 보존됩니다.`,
      },
      confirmation,
    );
    if (selected !== confirmation) {
      return;
    }
    await this.gitStatusService.discardOtherTrackedChanges(
      vscode.Uri.parse(rootUri),
      this.submissionSolutions(repository),
      paths,
    );
    await this.refreshGitStatuses(true, true);
  }

  /** 신뢰·저장소·복귀 가능 여부를 확인해 main 복귀·동기화 후 Git·원격 상태를 갱신합니다. */
  async returnToMainAndSync(rootUri: string): Promise<void> {
    this.requireTrustedWorkspace('main으로 돌아가려면 먼저 워크스페이스를 신뢰해야 합니다.');
    const repository = this.requireSubmissionRepository(rootUri, true);
    if (!repository.submission?.canReturnToMain) {
      throw new Error('병합 완료와 깨끗한 Git 상태를 확인한 뒤 main으로 돌아가 주세요.');
    }
    await this.gitStatusService.returnToMainAndSync(
      vscode.Uri.parse(rootUri),
      this.submissionSolutions(repository),
    );
    await this.refreshGitStatuses(true, true);
  }

  /** 로컬 Git 상태와 원격 제출 정보를 모두 강제로 다시 읽습니다. */
  async refreshSubmission(): Promise<void> {
    await this.refreshGitStatuses(true, true);
  }

  /** GitHub 로그인을 요청하고 성공했을 때 Git·원격 상태를 다시 읽습니다. */
  async signInGitHub(): Promise<void> {
    const signedIn = await this.gitStatusService.signInGitHub();
    if (!signedIn) {
      return;
    }
    await this.refreshGitStatuses(true, true);
  }

  /** 저장소의 문제별 풀이를 주차·slug가 포함된 제출 대상 목록으로 펼칩니다. */
  private submissionSolutions(repository: RepositorySnapshot) {
    return repository.problems.flatMap((problem) =>
      problem.solutions.map((solution) => ({
        name: solution.name,
        uri: solution.uri,
        slug: problem.slug,
        week: problem.week,
      })),
    );
  }

  /** 워크스페이스가 신뢰되지 않으면 전달받은 안내 메시지로 오류를 던집니다. */
  private requireTrustedWorkspace(message: string): void {
    if (!vscode.workspace.isTrusted) {
      throw new Error(message);
    }
  }

  /**
   * 화면에서 알고 있는 포크와 제출 상태로 명령의 사전 조건을 확인합니다.
   * 이 결과를 장기 보관하거나 Git 쓰기의 유일한 근거로 사용하지 않습니다.
   * @param allowBlocked 스테이징 해제·복구 등 차단 상태에서도 필요한 명령인지 여부.
   * @throws 등록되지 않은 저장소, 확인되지 않은 포크 또는 허용되지 않은 차단 상태.
   */
  private requireSubmissionRepository(rootUri: string, allowBlocked = false): RepositorySnapshot {
    const repository = this.getSnapshot().repositories.find((item) => item.rootUri === rootUri);
    if (!repository) {
      throw new Error('요청한 저장소가 현재 워크스페이스에 없습니다.');
    }
    if (repository.submission?.fork.status !== 'verified') {
      throw new Error(
        repository.submission?.fork.reason ??
          'DaleStudy/leetcode-study 포크에서만 제출 기능을 사용할 수 있습니다.',
      );
    }
    if (!allowBlocked && repository.submission.status === 'blocked') {
      throw new Error(repository.submission.blockedReason ?? '제출 상태를 먼저 정리해 주세요.');
    }
    return repository;
  }

  /** 주차가 없거나 활성 제출 주차와 다르면 작업을 중단하는 오류를 던집니다. */
  private validateSubmissionWeek(repository: RepositorySnapshot, week: number | undefined): void {
    if (!week) {
      throw new Error('풀이의 주차를 확인할 수 없습니다.');
    }
    const activeWeek = repository.submission?.activeSubmissionWeek;
    if (activeWeek !== undefined && activeWeek !== week) {
      throw new Error(
        `Week ${activeWeek} 제출이 끝나기 전에는 Week ${week} 풀이를 커밋에 추가할 수 없습니다.`,
      );
    }
  }
}
