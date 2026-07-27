import * as vscode from 'vscode';
import type {
  DetectionIssue,
  RepositorySnapshot,
} from './core/types';
import type { GitStatusService } from './gitStatusService';
import type { StudyRepositoryService } from './repositoryService';

const REFRESH_DEBOUNCE_MS = 150;

interface PendingProblemRefresh {
  rootUri: string;
  slug: string;
}

export interface RepositoryRefreshState {
  readonly repositories: RepositorySnapshot[];
  readonly issues: DetectionIssue[];
}

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

  get currentState(): RepositoryRefreshState {
    return this.state;
  }

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

  scheduleFullRefresh(): void {
    this.clearScheduledFullRefresh();
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh(this.getNickname());
    }, REFRESH_DEBOUNCE_MS);
  }

  async refreshGitStatuses(
    forceStatus = false,
    forceRemote = false,
  ): Promise<void> {
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

  async refreshProblem(
    rootUri: string,
    slug: string,
    forceStatus: boolean,
  ): Promise<void> {
    const key = this.problemKey(rootUri, slug);
    this.pendingProblemRefreshes.delete(key);
    const existing = this.problemRefreshes.get(key);
    if (existing) {
      return existing;
    }
    const refresh = (async () => {
      const repository = this.state.repositories.find(
        (item) => item.rootUri === rootUri,
      );
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
        repositories: this.state.repositories.map(
          (item) => item.rootUri === rootUri ? withGit : item,
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

  private reuseGitStatuses(repositories: RepositorySnapshot[]): RepositorySnapshot[] {
    const previousRepositories = new Map(
      this.state.repositories.map((repository) => [repository.rootUri, repository]),
    );
    return repositories.map((repository) => {
      const previousRepository = previousRepositories.get(repository.rootUri);
      const previousSolutions = new Map(
        previousRepository?.problems.flatMap((problem) => problem.solutions)
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
            submissionStatus:
              previousSolutions.get(solution.uri)?.submissionStatus ?? 'checking',
            pullRequestNumber:
              previousSolutions.get(solution.uri)?.pullRequestNumber,
          })),
        })),
      };
    });
  }

  private async withGitStatuses(
    repositories: RepositorySnapshot[],
    forceStatus: boolean,
    forceRemote = false,
  ): Promise<RepositorySnapshot[]> {
    return Promise.all(repositories.map(async (repository) => {
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
          }))
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
            submissionStatus:
              result.submissionStatuses?.get(solution.uri) ?? 'unknown',
            pullRequestNumber:
              result.pullRequestNumbers?.get(solution.uri),
          })),
        })),
      };
    }));
  }

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
      const repositories = await this.withGitStatuses(
        sourceRepositories,
        forceStatus,
        forceRemote,
      );
      if (this.state.repositories === sourceRepositories) {
        this.publish({ ...this.state, repositories });
      } else {
        this.gitRefreshRequested = true;
        this.forceGitRefreshRequested ||= forceStatus;
        this.forceRemoteRefreshRequested ||= forceRemote;
      }
    }
  }

  private publish(state: RepositoryRefreshState): void {
    this.state = state;
    this.changeEmitter.fire(state);
  }

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

  private scheduleProblemRefresh(
    folder: vscode.WorkspaceFolder,
    uri: vscode.Uri,
  ): void {
    const folderPath = folder.uri.path.endsWith('/')
      ? folder.uri.path
      : `${folder.uri.path}/`;
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

  private problemKey(rootUri: string, slug: string): string {
    return `${rootUri}\u0000${slug}`;
  }

  private clearScheduledFullRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private disposeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
  }
}
