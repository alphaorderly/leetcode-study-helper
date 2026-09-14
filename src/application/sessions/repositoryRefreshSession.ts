import * as vscode from 'vscode';
import type { DetectionIssue, RepositorySnapshot } from '../../shared/contracts';
import type { GitStatusService } from '../../infrastructure/git/gitStatusService';
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

/** 파일 감시, 문제별 재탐색과 Git 상태 갱신을 묶어 저장소 상태를 게시합니다. */
export class RepositoryRefreshSession implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<RepositoryRefreshState>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pendingProblemRefreshes = new Map<string, PendingProblemRefresh>();
  private readonly problemRefreshes = new Map<string, Promise<void>>();
  private watchers: vscode.FileSystemWatcher[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private gitRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private problemRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshing: Promise<RepositoryRefreshState> | undefined;
  private gitRefreshing: Promise<void> | undefined;
  private gitRefreshRequested = false;
  private forceGitRefreshRequested = false;
  private forceRemoteRefreshRequested = false;
  private initialized = false;
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

  /** 진행 중인 전체 탐색을 공유합니다. 목록 게시 후 Git 상태 갱신을 별도로 시작합니다. */
  async refresh(nickname: string): Promise<RepositoryRefreshState> {
    this.clearScheduledFullRefresh();
    if (this.refreshing) {
      return this.refreshing;
    }
    this.refreshing = this.performRefresh(nickname);
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }

  /** 연속된 변경 알림을 모아 마지막 알림 이후에 전체 탐색을 예약합니다. */
  scheduleFullRefresh(): void {
    this.clearScheduledFullRefresh();
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh(this.getNickname());
    }, REFRESH_DEBOUNCE_MS);
  }

  /** 중복 요청을 묶고 강제 조회 옵션을 누적합니다. 진행 중 요청 뒤에 새 요청도 처리합니다. */
  async refreshGitStatuses(forceStatus = false, forceRemote = false): Promise<void> {
    this.gitRefreshRequested = true;
    this.forceGitRefreshRequested ||= forceStatus;
    this.forceRemoteRefreshRequested ||= forceRemote;
    if (this.gitRefreshing) {
      return this.gitRefreshing;
    }

    this.gitRefreshing = this.drainGitRefreshes();
    try {
      await this.gitRefreshing;
    } finally {
      this.gitRefreshing = undefined;
    }
  }

  /** 한 문제의 파일을 다시 읽고 필요한 경우 Git 상태도 갱신합니다. */
  async refreshProblem(rootUri: string, slug: string, forceStatus: boolean): Promise<void> {
    const key = this.problemKey(rootUri, slug);
    this.pendingProblemRefreshes.delete(key);
    const existing = this.problemRefreshes.get(key);
    if (existing) {
      return existing;
    }
    const refresh = (async () => {
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
    })();
    this.problemRefreshes.set(key, refresh);
    try {
      await refresh;
    } finally {
      this.problemRefreshes.delete(key);
    }
  }

  /** 파일 감시와 예약된 갱신 타이머, 이벤트 구독을 해제합니다. */
  dispose(): void {
    this.clearScheduledFullRefresh();
    if (this.gitRefreshTimer) {
      clearTimeout(this.gitRefreshTimer);
    }
    if (this.problemRefreshTimer) {
      clearTimeout(this.problemRefreshTimer);
    }
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
      repositories: this.reuseGitStatuses(scanResult.repositories),
      issues: scanResult.issues,
    });
    this.initialized = true;
    void this.refreshGitStatuses(true);
    return this.state;
  }

  /** 새 탐색 결과에 직전 Git 표시를 붙여 후속 조회 중 화면이 불필요하게 비지 않게 합니다. */
  private reuseGitStatuses(repositories: RepositorySnapshot[]): RepositorySnapshot[] {
    const previousRepositories = new Map(
      this.state.repositories.map((repository) => [repository.rootUri, repository]),
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
      }),
    );
  }

  /** 초기 탐색 이후 연속 Git 이벤트를 한 번의 지연 갱신으로 합칩니다. */
  private scheduleGitRefresh(): void {
    if (!this.initialized) {
      return;
    }
    if (this.gitRefreshTimer) {
      clearTimeout(this.gitRefreshTimer);
    }
    this.gitRefreshTimer = setTimeout(() => {
      this.gitRefreshTimer = undefined;
      void this.refreshGitStatuses();
    }, REFRESH_DEBOUNCE_MS);
  }

  /** 조회 중 저장소 목록이 바뀌면 결과를 게시하지 않고 최신 목록으로 다시 조회합니다. */
  private async drainGitRefreshes(): Promise<void> {
    while (this.gitRefreshRequested) {
      this.gitRefreshRequested = false;
      const forceStatus = this.forceGitRefreshRequested;
      this.forceGitRefreshRequested = false;
      const forceRemote = this.forceRemoteRefreshRequested;
      this.forceRemoteRefreshRequested = false;
      if (this.refreshing) {
        await this.refreshing;
      }
      const sourceRepositories = this.state.repositories;
      const repositories = await this.withGitStatuses(sourceRepositories, forceStatus, forceRemote);
      if (this.state.repositories === sourceRepositories) {
        this.publish({ ...this.state, repositories });
      } else {
        this.gitRefreshRequested = true;
        this.forceGitRefreshRequested ||= forceStatus;
        this.forceRemoteRefreshRequested ||= forceRemote;
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
    this.pendingProblemRefreshes.set(this.problemKey(pending.rootUri, slug), pending);
    if (this.problemRefreshTimer) {
      clearTimeout(this.problemRefreshTimer);
    }
    this.problemRefreshTimer = setTimeout(() => {
      this.problemRefreshTimer = undefined;
      const refreshes = [...this.pendingProblemRefreshes.values()];
      this.pendingProblemRefreshes.clear();
      void (async () => {
        for (const item of refreshes) {
          await this.refreshProblem(item.rootUri, item.slug, true);
        }
      })();
    }, REFRESH_DEBOUNCE_MS);
  }

  /** 저장소 URI와 slug를 NUL 문자로 구분해 문제별 갱신 키를 만듭니다. */
  private problemKey(rootUri: string, slug: string): string {
    return `${rootUri}\u0000${slug}`;
  }

  /** 예약된 전체 갱신 타이머를 취소하고 참조를 해제합니다. */
  private clearScheduledFullRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /** 등록된 파일 감시기를 모두 해제하고 목록을 비웁니다. */
  private disposeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
  }
}
