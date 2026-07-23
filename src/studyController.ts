import * as vscode from 'vscode';
import { CurrentProblemSession } from './currentProblemSession';
import { DEFAULT_LANGUAGE, findLanguage, LANGUAGE_OPTIONS } from './core/languages';
import {
  confirmOtherSolutionAccess,
  type ConsentState,
  OTHER_SOLUTION_CONFIRM_LABEL,
} from './core/otherSolutions';
import { isIgnoredByLineLint, isValidNickname } from './core/solutions';
import type {
  CurrentProblemSnapshot,
  ExtensionSnapshot,
  LineLintFixResult,
  RepositorySnapshot,
} from './core/types';
import { GitStatusService } from './gitStatusService';
import { StudyRepositoryService } from './repositoryService';
import { SolutionFileService } from './solutionFileService';

const CONFIGURATION_SECTION = 'leetcodeStudyHelper';
const REFRESH_DEBOUNCE_MS = 150;

interface PendingProblemRefresh {
  rootUri: string;
  slug: string;
}

export class StudyController implements vscode.Disposable {
  private readonly gitStatusService = new GitStatusService();
  private readonly repositoryService = new StudyRepositoryService();
  private readonly solutionFileService = new SolutionFileService();
  private readonly currentProblemSession: CurrentProblemSession;
  private readonly changeEmitter = new vscode.EventEmitter<ExtensionSnapshot>();
  private readonly currentProblemEmitter = new vscode.EventEmitter<CurrentProblemSnapshot | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pendingProblemRefreshes = new Map<string, PendingProblemRefresh>();
  private readonly problemRefreshes = new Map<string, Promise<void>>();
  private readonly lastOtherSolutionNames = new Map<string, string>();
  private watchers: vscode.FileSystemWatcher[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private gitRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private problemRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshing: Promise<ExtensionSnapshot> | undefined;
  private gitRefreshing: Promise<void> | undefined;
  private gitRefreshRequested = false;
  private forceGitRefreshRequested = false;
  private initialized = false;
  private snapshot: ExtensionSnapshot = {
    nickname: '',
    preferredLanguage: DEFAULT_LANGUAGE,
    languages: [...LANGUAGE_OPTIONS],
    repositories: [],
    issues: [],
    workspaceTrusted: vscode.workspace.isTrusted,
  };

  readonly onDidChange = this.changeEmitter.event;
  readonly onDidChangeCurrentProblem = this.currentProblemEmitter.event;

  constructor(
    extensionUri: vscode.Uri,
    private readonly consentState: ConsentState,
  ) {
    this.currentProblemSession = new CurrentProblemSession(extensionUri);
    this.rebuildWatchers();
    this.disposables.push(
      this.gitStatusService,
      this.currentProblemSession,
      this.gitStatusService.onDidChange(() => this.scheduleGitRefresh()),
      this.currentProblemSession.onDidChange((currentProblem) => {
        this.snapshot = { ...this.snapshot, currentProblem };
        this.currentProblemEmitter.fire(currentProblem);
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.rebuildWatchers();
        this.scheduleRefresh();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration(`${CONFIGURATION_SECTION}.nickname`)
          || event.affectsConfiguration(`${CONFIGURATION_SECTION}.preferredLanguage`)
        ) {
          this.scheduleRefresh();
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.scheduleRefresh()),
    );
  }

  get currentSnapshot(): ExtensionSnapshot {
    return this.snapshot;
  }

  async getState(): Promise<ExtensionSnapshot> {
    return this.initialized ? this.snapshot : this.refresh();
  }

  async refresh(): Promise<ExtensionSnapshot> {
    this.clearScheduledFullRefresh();
    if (this.refreshing) {
      return this.refreshing;
    }

    this.refreshing = this.performRefresh();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }

  async saveSettings(nicknameInput: string, preferredLanguage: string): Promise<void> {
    const nickname = nicknameInput.trim();
    if (!isValidNickname(nickname)) {
      throw new Error('닉네임에는 영문, 숫자, 하이픈만 사용할 수 있습니다.');
    }
    if (!findLanguage(preferredLanguage)) {
      throw new Error(`지원하지 않는 언어입니다: ${preferredLanguage}`);
    }

    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    await Promise.all([
      configuration.update('nickname', nickname, vscode.ConfigurationTarget.Global),
      configuration.update(
        'preferredLanguage',
        preferredLanguage,
        vscode.ConfigurationTarget.Global,
      ),
    ]);
    await this.refresh();
  }

  async openSolution(uriString: string): Promise<void> {
    const known = this.snapshot.repositories.some((repository) =>
      repository.problems.some((problem) =>
        problem.solutions.some(({ uri }) => uri === uriString),
      ),
    );
    if (!known) {
      throw new Error('요청한 풀이가 현재 워크스페이스에 없습니다.');
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriString));
    await vscode.window.showTextDocument(document);
  }

  async openOtherSolution(
    rootUri: string,
    slug: string,
    confirm = true,
  ): Promise<string | undefined> {
    const repository = this.snapshot.repositories.find((item) => item.rootUri === rootUri);
    const problem = repository?.problems.find((item) => item.slug === slug);
    if (!repository || !problem) {
      throw new Error('요청한 문제가 현재 워크스페이스에 없습니다.');
    }

    const preferredLanguage = findLanguage(this.snapshot.preferredLanguage);
    if (!preferredLanguage) {
      throw new Error('기본 언어 설정을 확인할 수 없습니다.');
    }

    const key = this.problemKey(rootUri, slug);
    const uri = await this.repositoryService.findOtherSolution(
      repository,
      slug,
      this.snapshot.nickname,
      preferredLanguage.extension,
      this.lastOtherSolutionNames.get(key),
    );
    if (!uri) {
      await vscode.window.showInformationMessage(
        '이 문제에는 다른 참여자의 풀이가 없습니다.',
      );
      return undefined;
    }

    if (confirm && !await confirmOtherSolutionAccess(
      this.consentState,
      () => vscode.window.showWarningMessage(
        '다른 참여자의 풀이를 열까요?',
        {
          modal: true,
          detail: '아직 직접 풀지 않았다면 풀이 내용이 노출될 수 있습니다. 동의하면 다음부터는 다시 묻지 않습니다.',
        },
        OTHER_SOLUTION_CONFIRM_LABEL,
      ),
    )) {
      return undefined;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: true });
    this.lastOtherSolutionNames.set(
      key,
      uri.path.split('/').pop() ?? uri.path,
    );
    return uri.toString();
  }

  async openProblem(slug: string): Promise<void> {
    const problemExists = this.snapshot.repositories.some((repository) =>
      repository.problems.some((problem) => problem.slug === slug),
    );
    if (!problemExists) {
      throw new Error('요청한 문제가 현재 워크스페이스에 없습니다.');
    }

    const problemUri = vscode.Uri.parse(
      `https://leetcode.com/problems/${encodeURIComponent(slug)}/`,
    );
    if (!await vscode.env.openExternal(problemUri)) {
      throw new Error('LeetCode 문제 페이지를 열지 못했습니다.');
    }
  }

  async loadCurrentProblem(): Promise<void> {
    await this.currentProblemSession.loadProblem();
  }

  async runCurrentSolution(candidateId: string): Promise<void> {
    await this.currentProblemSession.run(candidateId);
  }

  async deleteSolution(uriString: string, confirm = true): Promise<boolean> {
    if (!vscode.workspace.isTrusted) {
      throw new Error('풀이 파일을 삭제하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    }

    const target = this.findSolution(uriString);
    if (!target) {
      throw new Error('요청한 풀이가 현재 워크스페이스에 없습니다.');
    }
    const result = await this.solutionFileService.delete({
      uri: vscode.Uri.parse(target.uri),
      relativePath: `${target.slug}/${target.name}`,
      confirm,
    });
    if (result.status === 'cancelled') {
      return false;
    }

    await this.refreshProblem(target.rootUri, target.slug, true);
    return true;
  }

  async createSolution(rootUri: string, slug: string, confirm = true): Promise<string | undefined> {
    if (!vscode.workspace.isTrusted) {
      throw new Error('풀이 파일을 만들려면 먼저 워크스페이스를 신뢰해야 합니다.');
    }

    const repository = this.snapshot.repositories.find((item) => item.rootUri === rootUri);
    const problem = repository?.problems.find((item) => item.slug === slug);
    if (!repository || !problem) {
      throw new Error('요청한 문제가 현재 워크스페이스에 없습니다.');
    }

    const result = await this.solutionFileService.create({
      rootUri,
      slug,
      nickname: this.snapshot.nickname,
      preferredLanguage: this.snapshot.preferredLanguage,
      confirm,
    });
    if (result.status === 'cancelled') {
      return undefined;
    }

    const document = await vscode.workspace.openTextDocument(result.uri);
    await vscode.window.showTextDocument(document);
    await this.refreshProblem(rootUri, slug, true);
    return result.uri.toString();
  }

  async fixAllSolutions(): Promise<LineLintFixResult> {
    if (!vscode.workspace.isTrusted) {
      throw new Error('풀이 파일을 수정하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    }

    const solutions = this.snapshot.repositories.flatMap((repository) =>
      repository.problems.flatMap((problem) => problem.solutions),
    );
    const eligibleUris = [...new Set(
      solutions
        .filter(({ name }) => !isIgnoredByLineLint(name))
        .map(({ uri }) => uri),
    )].map((uri) => vscode.Uri.parse(uri));
    const result = await this.solutionFileService.fixLineEndings(eligibleUris);
    return {
      ...result,
      ignored: solutions.length - eligibleUris.length,
    };
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
    this.currentProblemEmitter.dispose();
  }

  private async performRefresh(): Promise<ExtensionSnapshot> {
    const { nickname, preferredLanguage } = this.readSettings();
    const scanResult = await this.repositoryService.scan(nickname);
    const repositories = this.reuseGitStatuses(scanResult.repositories);
    this.currentProblemSession.setRepositories(repositories);
    this.snapshot = {
      nickname,
      preferredLanguage,
      languages: [...LANGUAGE_OPTIONS],
      repositories,
      issues: scanResult.issues,
      workspaceTrusted: vscode.workspace.isTrusted,
      currentProblem: this.currentProblemSession.currentSnapshot,
    };
    this.initialized = true;
    this.changeEmitter.fire(this.snapshot);
    void this.refreshGitStatuses(true);
    return this.snapshot;
  }

  private reuseGitStatuses(repositories: RepositorySnapshot[]): RepositorySnapshot[] {
    const previousRepositories = new Map(
      this.snapshot.repositories.map((repository) => [repository.rootUri, repository]),
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
        problems: repository.problems.map((problem) => ({
          ...problem,
          solutions: problem.solutions.map((solution) => ({
            ...solution,
            gitStatus: previousSolutions.get(solution.uri)?.gitStatus ?? 'checking',
          })),
        })),
      };
    });
  }

  private readSettings(): { nickname: string; preferredLanguage: string } {
    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    const configuredNickname = configuration.get<string>('nickname', '').trim();
    const configuredLanguage = configuration.get<string>(
      'preferredLanguage',
      DEFAULT_LANGUAGE,
    );
    return {
      nickname: isValidNickname(configuredNickname) ? configuredNickname : '',
      preferredLanguage: findLanguage(configuredLanguage)
        ? configuredLanguage
        : DEFAULT_LANGUAGE,
    };
  }

  private async withGitStatuses(
    repositories: RepositorySnapshot[],
    forceStatus: boolean,
  ): Promise<RepositorySnapshot[]> {
    return Promise.all(repositories.map(async (repository) => {
      const solutions = repository.problems.flatMap((problem) => problem.solutions);
      const result = await this.gitStatusService.getStatuses(
        vscode.Uri.parse(repository.rootUri),
        solutions.map(({ uri }) => uri),
        forceStatus,
      );
      return {
        ...repository,
        gitRemote: result.remoteName,
        problems: repository.problems.map((problem) => ({
          ...problem,
          solutions: problem.solutions.map((solution) => ({
            ...solution,
            gitStatus: result.statuses.get(solution.uri) ?? 'unknown',
          })),
        })),
      };
    }));
  }

  private scheduleRefresh(): void {
    this.clearScheduledFullRefresh();
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
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

  private async refreshGitStatuses(forceStatus = false): Promise<void> {
    this.gitRefreshRequested = true;
    this.forceGitRefreshRequested ||= forceStatus;
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

  private async drainGitRefreshes(): Promise<void> {
    while (this.gitRefreshRequested) {
      this.gitRefreshRequested = false;
      const forceStatus = this.forceGitRefreshRequested;
      this.forceGitRefreshRequested = false;
      if (this.refreshing) {
        await this.refreshing;
      }
      const sourceRepositories = this.snapshot.repositories;
      const repositories = await this.withGitStatuses(sourceRepositories, forceStatus);
      if (this.snapshot.repositories === sourceRepositories) {
        this.publishRepositories(repositories);
      } else {
        this.gitRefreshRequested = true;
        this.forceGitRefreshRequested ||= forceStatus;
      }
    }
  }

  private async refreshProblem(rootUri: string, slug: string, forceStatus: boolean): Promise<void> {
    const key = this.problemKey(rootUri, slug);
    this.pendingProblemRefreshes.delete(key);
    const existing = this.problemRefreshes.get(key);
    if (existing) {
      return existing;
    }
    const refresh = (async () => {
      const repository = this.snapshot.repositories.find((item) => item.rootUri === rootUri);
      if (!repository) {
        return;
      }
      const updated = await this.repositoryService.refreshProblem(
        repository,
        slug,
        this.snapshot.nickname,
      );
      const [withGit] = await this.withGitStatuses([updated], forceStatus);
      if (!withGit) {
        return;
      }
      this.publishRepositories(
        this.snapshot.repositories.map((item) => item.rootUri === rootUri ? withGit : item),
      );
    })();
    this.problemRefreshes.set(key, refresh);
    try {
      await refresh;
    } finally {
      this.problemRefreshes.delete(key);
    }
  }

  private publishRepositories(repositories: RepositorySnapshot[]): void {
    this.currentProblemSession.setRepositories(repositories);
    this.snapshot = {
      ...this.snapshot,
      repositories,
      currentProblem: this.currentProblemSession.currentSnapshot,
    };
    this.changeEmitter.fire(this.snapshot);
  }

  private findSolution(uri: string): {
    rootUri: string;
    slug: string;
    name: string;
    uri: string;
  } | undefined {
    for (const repository of this.snapshot.repositories) {
      for (const problem of repository.problems) {
        const solution = problem.solutions.find((item) => item.uri === uri);
        if (solution) {
          return {
            rootUri: repository.rootUri,
            slug: problem.slug,
            name: solution.name,
            uri: solution.uri,
          };
        }
      }
    }
    return undefined;
  }

  private rebuildWatchers(): void {
    this.disposeWatchers();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const catalogWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, 'problem-categories.json'),
      );
      catalogWatcher.onDidCreate(() => this.scheduleRefresh());
      catalogWatcher.onDidChange(() => this.scheduleRefresh());
      catalogWatcher.onDidDelete(() => this.scheduleRefresh());

      const solutionWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, '*/*'),
      );
      solutionWatcher.onDidCreate((uri) => this.scheduleProblemRefresh(folder, uri));
      solutionWatcher.onDidDelete((uri) => this.scheduleProblemRefresh(folder, uri));
      this.watchers.push(catalogWatcher, solutionWatcher);
    }
  }

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
