import * as vscode from 'vscode';
import type { DetectionIssue, RepositorySnapshot } from '../../shared/contracts';
import { TrailingTask } from '../../shared/async/trailingTask';
import type {
  SolutionGitStatusResult,
  GitStatusService,
} from '../../infrastructure/git/gitStatusService';
import type { StudyRepositoryService } from '../../infrastructure/workspace/repositoryService';

const REFRESH_DEBOUNCE_MS = 150;

/** 중복 갱신을 합칠 문제의 저장소 루트와 slug입니다. */
interface PendingProblemRefresh {
  rootUri: string;
  slug: string;
}

/** 저장소 목록과 루트별 탐색 오류를 담은 세션 갱신 결과입니다. */
export interface RepositoryRefreshState {
  readonly repositories: RepositorySnapshot[];
  readonly issues: DetectionIssue[];
}

/**
 * StudyController에 저장소 목록을 공급하는 갱신 세션입니다.
 * 전체 탐색은 파일 목록부터 게시하고 Git 조회를 후속 실행해 초기 화면을 지연시키지 않습니다.
 * 전체 탐색은 진행 중 Promise를 공유하고, 문제 탐색은 루트·slug별로 공유합니다.
 * Git 조회만 실행 중 요청을 누적해 한 번 더 처리합니다. 세 경로의 병합 정책은 서로 다릅니다.
 * 생성 시 파일·Git 이벤트를 구독하고 dispose에서 구독과 예약 타이머를 해제합니다.
 */
export class RepositoryRefreshSession implements vscode.Disposable {
  /** 최신 저장소 배열과 탐색 오류를 함께 게시합니다. 컨트롤러가 이 이벤트로 전체 화면 상태를 조립합니다. */
  private readonly changeEmitter = new vscode.EventEmitter<RepositoryRefreshState>();
  /** Git·워크스페이스 이벤트와 달리 파일 감시기는 재구성할 수 있어 watchers에서 별도로 관리합니다. */
  private readonly disposables: vscode.Disposable[] = [];
  /** 현재 워크스페이스 루트의 카탈로그·풀이 감시기입니다. 루트 변경 때 기존 감시기를 해제하고 다시 만듭니다. */
  private watchers: vscode.FileSystemWatcher[] = [];
  /** 전체 파일 탐색의 실행과 예약입니다. 실행 중 요청은 같은 Promise를 기다리며 별도 후속 요청을 쌓지 않습니다. */
  private readonly fullRefresh = {
    /** 진행 중 전체 탐색이 없으면 undefined입니다. 탐색 종료의 finally에서 비워 다음 요청을 허용합니다. */
    running: undefined as Promise<RepositoryRefreshState> | undefined,
    task: new TrailingTask(REFRESH_DEBOUNCE_MS, () => void this.refresh(this.getNickname())),
  };
  /** Git 조회는 전체 탐색과 달리 실행 중 새 요청을 누적하여 후속 회차에서 처리합니다. */
  private readonly gitRefresh = {
    running: undefined as Promise<void> | undefined,
    /** 다음 조회 회차가 필요하다는 표시입니다. 각 회차 시작에서 소비하며 조회 중 들어온 요청은 다시 true로 남습니다. */
    requested: false,
    /** 대기 요청 중 하나라도 로컬 status 강제 조회를 요구하면 유지합니다. 회차 시작에 소비하고 기준 배열이 바뀌면 복원합니다. */
    forceStatus: false,
    /** 대기 요청의 원격 캐시 우회 요구를 누적합니다. 약한 요청이 뒤에 와도 이미 요청한 강도를 낮추지 않습니다. */
    forceRemote: false,
    task: new TrailingTask(REFRESH_DEBOUNCE_MS, () => void this.refreshGitStatuses()),
  };
  /** 문제별 갱신은 루트 URI와 slug를 키로 합칩니다. 예약 목록과 현재 실행 목록은 수명이 달라 별도로 둡니다. */
  private readonly problemRefresh = {
    /** 다음 예약 실행이 가져갈 문제 목록입니다. 실행 시작 전에 비워 실행 중 추가된 변경을 다음 예약에 남깁니다. */
    pending: new Map<string, PendingProblemRefresh>(),
    /** 같은 문제의 중복 조회가 함께 기다릴 Promise입니다. 다른 문제는 서로 다른 키로 추적합니다. */
    running: new Map<string, Promise<void>>(),
    task: new TrailingTask(REFRESH_DEBOUNCE_MS, () => void this.drainProblemRefreshes()),
  };
  /** 첫 전체 탐색이 게시되기 전 Git 이벤트로 불완전한 목록을 조회하지 않도록 하는 플래그입니다. */
  private initialized = false;
  /** 마지막 게시 결과입니다. repositories 배열의 참조는 Git 조회 결과를 적용해도 되는지 판단하는 버전 역할도 합니다. */
  private state: RepositoryRefreshState = {
    repositories: [],
    issues: [],
  };

  readonly onDidChange = this.changeEmitter.event;

  /** 파일 감시를 시작하고 Git·워크스페이스 변경을 갱신 예약에 연결합니다. */
  constructor(
    private readonly repositoryService: StudyRepositoryService,
    private readonly gitStatusService: GitStatusService,
    private readonly getNickname: () => string,
  ) {
    this.rebuildWatchers();
    this.disposables.push(
      this.gitStatusService.onDidChange(() => this.scheduleGitRefresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.rebuildWatchers();
        this.scheduleFullRefresh();
      }),
    );
  }

  /** 추가 탐색 없이 마지막으로 발행한 저장소 상태를 반환합니다. */
  get currentState(): RepositoryRefreshState {
    return this.state;
  }

  /**
   * 수동 새로고침은 예약된 전체 탐색을 취소하고 즉시 탐색을 시작합니다.
   * 이미 실행 중이면 그 작업을 공유하므로 새 nickname으로 추가 탐색을 예약하지는 않습니다.
   * 반환은 파일 탐색 완료를 뜻하며 Git 후속 조회까지 기다리는 계약이 아닙니다.
   */
  async refresh(nickname: string): Promise<RepositoryRefreshState> {
    this.fullRefresh.task.cancel();
    if (this.fullRefresh.running) {
      return this.fullRefresh.running;
    }
    this.fullRefresh.running = this.performRefresh(nickname);
    try {
      return await this.fullRefresh.running;
    } finally {
      this.fullRefresh.running = undefined;
    }
  }

  /** 연속된 변경 알림을 모아 마지막 알림 이후에 전체 탐색을 예약합니다. */
  scheduleFullRefresh(): void {
    this.fullRefresh.task.schedule();
  }

  /**
   * 진행 중 요청이 있으면 같은 완료를 기다리되 새 요청이 있었다는 사실과 강제 옵션을 누적합니다.
   * 따라서 호출자가 true로 요청한 옵션이 뒤의 false 요청에 의해 취소되지 않습니다.
   * @param forceStatus 각 Git 조회 전 실제 status를 갱신할지 여부.
   * @param forceRemote GitHub의 완료 결과 캐시를 우회할지 여부.
   */
  async refreshGitStatuses(forceStatus = false, forceRemote = false): Promise<void> {
    this.gitRefresh.requested = true;
    this.gitRefresh.forceStatus ||= forceStatus;
    this.gitRefresh.forceRemote ||= forceRemote;
    if (this.gitRefresh.running) {
      return this.gitRefresh.running;
    }

    this.gitRefresh.running = this.drainGitRefreshes();
    try {
      await this.gitRefresh.running;
    } finally {
      this.gitRefresh.running = undefined;
    }
  }

  /**
   * 생성·삭제 등 사용자 작업 직후 한 문제를 갱신하고 같은 문제의 예약 항목을 제거합니다.
   * 이미 실행 중이면 해당 작업을 공유하며 옵션을 추가 누적하지 않습니다. Git 전체 갱신과 다른 계약입니다.
   * @throws 파일 탐색·Git 조회에서 전달된 오류. 이 메서드는 오류를 표시 상태로 바꾸지 않습니다.
   */
  async refreshProblem(rootUri: string, slug: string, forceStatus: boolean): Promise<void> {
    const key = this.problemKey(rootUri, slug);
    this.problemRefresh.pending.delete(key);
    const existing = this.problemRefresh.running.get(key);
    if (existing) {
      return existing;
    }
    const refresh = this.performProblemRefresh(rootUri, slug, forceStatus);
    this.problemRefresh.running.set(key, refresh);
    try {
      await refresh;
    } finally {
      this.problemRefresh.running.delete(key);
    }
  }

  /** 지정 문제를 다시 읽어 Git 표시를 붙인 뒤 해당 루트의 스냅샷을 교체합니다. 요청 공유는 refreshProblem이 담당합니다. */
  private async performProblemRefresh(
    rootUri: string,
    slug: string,
    forceStatus: boolean,
  ): Promise<void> {
    const repository = this.state.repositories.find((item) => item.rootUri === rootUri);
    if (!repository) {
      return;
    }
    const updated = await this.repositoryService.refreshProblem(
      repository,
      slug,
      this.getNickname(),
    );
    const [withGit] = await this.withGitStatuses([updated], forceStatus);
    if (!withGit) {
      return;
    }
    this.publish({
      ...this.state,
      repositories: this.state.repositories.map((item) =>
        item.rootUri === rootUri ? withGit : item,
      ),
    });
  }

  /** 파일 감시와 예약된 갱신 타이머, 이벤트 구독을 해제합니다. */
  dispose(): void {
    this.fullRefresh.task.cancel();
    this.gitRefresh.task.cancel();
    this.problemRefresh.task.cancel();
    this.disposeWatchers();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.changeEmitter.dispose();
  }

  /** 저장소를 탐색해 기존 Git 표시 상태와 합친 뒤 Git 상태의 후속 갱신을 시작합니다. */
  private async performRefresh(nickname: string): Promise<RepositoryRefreshState> {
    const scanResult = await this.repositoryService.scan(nickname);
    this.publish({
      repositories: reuseGitStatuses(scanResult.repositories, this.state.repositories),
      issues: scanResult.issues,
    });
    this.initialized = true;
    void this.refreshGitStatuses(true);
    return this.state;
  }

  /** 저장소별 Git 조회 결과를 풀이와 제출 상태에 결합합니다. */
  private async withGitStatuses(
    repositories: RepositorySnapshot[],
    forceStatus: boolean,
    forceRemote = false,
  ): Promise<RepositorySnapshot[]> {
    return Promise.all(
      repositories.map(async (repository) => {
        const solutions = repository.problems.flatMap((problem) => problem.solutions);
        const result = await this.gitStatusService.getStatuses(
          vscode.Uri.parse(repository.rootUri),
          solutions.map(({ uri }) => uri),
          forceStatus,
          repository.problems.flatMap((problem) =>
            problem.solutions.map((solution) => ({
              name: solution.name,
              uri: solution.uri,
              slug: problem.slug,
              week: problem.week,
            })),
          ),
          forceRemote,
        );
        return applyGitStatuses(repository, result);
      }),
    );
  }

  /** 초기 탐색 이후 연속 Git 이벤트를 한 번의 지연 갱신으로 합칩니다. */
  private scheduleGitRefresh(): void {
    if (!this.initialized) {
      return;
    }
    this.gitRefresh.task.schedule();
  }

  /**
   * 누적된 Git 요청을 소진합니다. 이번 회차의 옵션을 소비한 뒤 새 요청은 다음 회차에 남깁니다.
   * 전체 탐색을 기다린 후의 배열 참조가 조회 기준입니다. await 중 배열이 교체되면
   * 결과를 버리고 소비한 강제 조회 옵션까지 복구하여 최신 목록을 다시 조회합니다.
   * 내용 비교로 대체하면 같은 내용의 재탐색도 새 기준이라는 의미를 잃게 됩니다.
   */
  private async drainGitRefreshes(): Promise<void> {
    while (this.gitRefresh.requested) {
      this.gitRefresh.requested = false;
      const forceStatus = this.gitRefresh.forceStatus;
      this.gitRefresh.forceStatus = false;
      const forceRemote = this.gitRefresh.forceRemote;
      this.gitRefresh.forceRemote = false;
      if (this.fullRefresh.running) {
        await this.fullRefresh.running;
      }
      /** 이 조회의 기준 배열을 잡습니다. await 중 전체·부분 갱신이 배열을 교체하면 결과를 적용하지 않고 다시 조회합니다. */
      const sourceRepositories = this.state.repositories;
      const repositories = await this.withGitStatuses(sourceRepositories, forceStatus, forceRemote);
      if (this.state.repositories === sourceRepositories) {
        this.publish({ ...this.state, repositories });
      } else {
        this.gitRefresh.requested = true;
        this.gitRefresh.forceStatus ||= forceStatus;
        this.gitRefresh.forceRemote ||= forceRemote;
      }
    }
  }

  /** 저장소 상태를 교체하고 구독자에게 변경을 발행합니다. */
  private publish(state: RepositoryRefreshState): void {
    this.state = state;
    this.changeEmitter.fire(state);
  }

  /** 기존 감시기를 해제하고 각 루트의 카탈로그·풀이·README 변경을 다시 구독합니다. */
  private rebuildWatchers(): void {
    this.disposeWatchers();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const catalogWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, 'problem-categories.json'),
      );
      catalogWatcher.onDidCreate(() => this.scheduleFullRefresh());
      catalogWatcher.onDidChange(() => this.scheduleFullRefresh());
      catalogWatcher.onDidDelete(() => this.scheduleFullRefresh());

      const solutionWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, '*/*'),
      );
      solutionWatcher.onDidCreate((uri) => this.scheduleProblemRefresh(folder, uri));
      solutionWatcher.onDidChange((uri) => {
        if (uri.path.endsWith('/README.md')) {
          this.scheduleProblemRefresh(folder, uri);
        }
      });
      solutionWatcher.onDidDelete((uri) => this.scheduleProblemRefresh(folder, uri));
      this.watchers.push(catalogWatcher, solutionWatcher);
    }
  }

  /** 변경 파일이 속한 문제별로 요청을 모은 뒤 순서대로 부분 갱신합니다. */
  private scheduleProblemRefresh(folder: vscode.WorkspaceFolder, uri: vscode.Uri): void {
    const folderPath = folder.uri.path.endsWith('/') ? folder.uri.path : `${folder.uri.path}/`;
    if (!uri.path.startsWith(folderPath)) {
      return;
    }
    const [slug] = uri.path.slice(folderPath.length).split('/');
    if (!slug) {
      return;
    }
    const pending = { rootUri: folder.uri.toString(), slug };
    this.problemRefresh.pending.set(this.problemKey(pending.rootUri, slug), pending);
    this.problemRefresh.task.schedule();
  }

  /** 예약된 문제 목록을 먼저 비워 실행 중 들어온 변경이 다음 예약에 남도록 합니다. */
  private async drainProblemRefreshes(): Promise<void> {
    const refreshes = [...this.problemRefresh.pending.values()];
    this.problemRefresh.pending.clear();
    for (const item of refreshes) {
      await this.refreshProblem(item.rootUri, item.slug, true);
    }
  }

  /** 저장소 URI와 slug를 NUL 문자로 구분해 문제별 갱신 키를 만듭니다. */
  private problemKey(rootUri: string, slug: string): string {
    return `${rootUri}\u0000${slug}`;
  }

  /** 등록된 파일 감시기를 모두 해제하고 목록을 비웁니다. */
  private disposeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
  }
}

/** 새 탐색 결과에 직전 Git 표시를 붙여 후속 조회 중 화면이 불필요하게 비지 않게 합니다. */
function reuseGitStatuses(
  repositories: RepositorySnapshot[],
  previous: RepositorySnapshot[],
): RepositorySnapshot[] {
  const previousRepositories = new Map(
    previous.map((repository) => [repository.rootUri, repository]),
  );
  return repositories.map((repository) => {
    const previousRepository = previousRepositories.get(repository.rootUri);
    const previousSolutions = new Map(
      previousRepository?.problems
        .flatMap((problem) => problem.solutions)
        .map((solution) => [solution.uri, solution] as const) ?? [],
    );
    return {
      ...repository,
      gitRemote: previousRepository?.gitRemote,
      submission: previousRepository?.submission
        ? { ...previousRepository.submission, status: 'checking' }
        : undefined,
      problems: repository.problems.map((problem) => ({
        ...problem,
        solutions: problem.solutions.map((solution) => ({
          ...solution,
          gitStatus: previousSolutions.get(solution.uri)?.gitStatus ?? 'checking',
          submissionStatus: previousSolutions.get(solution.uri)?.submissionStatus ?? 'checking',
          pullRequestNumber: previousSolutions.get(solution.uri)?.pullRequestNumber,
        })),
      })),
    };
  });
}

/** 조회 결과를 새 스냅샷에 붙입니다. 입력 객체를 변경하지 않아 진행 중 조회의 기준 참조가 유지됩니다. */
function applyGitStatuses(
  repository: RepositorySnapshot,
  result: SolutionGitStatusResult,
): RepositorySnapshot {
  return {
    ...repository,
    gitRemote: result.remoteName,
    submission: result.submission,
    problems: repository.problems.map((problem) => ({
      ...problem,
      solutions: problem.solutions.map((solution) => ({
        ...solution,
        gitStatus: result.statuses.get(solution.uri) ?? 'unknown',
        submissionStatus: result.submissionStatuses?.get(solution.uri) ?? 'unknown',
        pullRequestNumber: result.pullRequestNumbers?.get(solution.uri),
      })),
    })),
  };
}
