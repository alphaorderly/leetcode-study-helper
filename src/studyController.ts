import * as vscode from 'vscode';
import { DEFAULT_LANGUAGE, findLanguage, LANGUAGE_OPTIONS } from './core/languages';
import { isIgnoredByLineLint, isValidNickname } from './core/solutions';
import type { ExtensionSnapshot, LineLintFixResult } from './core/types';
import { StudyRepositoryService } from './repositoryService';
import { SolutionFileService } from './solutionFileService';

const CONFIGURATION_SECTION = 'leetcodeStudyHelper';

export class StudyController implements vscode.Disposable {
  private readonly repositoryService = new StudyRepositoryService();
  private readonly solutionFileService = new SolutionFileService();
  private readonly changeEmitter = new vscode.EventEmitter<ExtensionSnapshot>();
  private readonly disposables: vscode.Disposable[] = [];
  private watchers: vscode.FileSystemWatcher[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshing: Promise<ExtensionSnapshot> | undefined;
  private snapshot: ExtensionSnapshot = {
    nickname: '',
    preferredLanguage: DEFAULT_LANGUAGE,
    languages: [...LANGUAGE_OPTIONS],
    repositories: [],
    issues: [],
    workspaceTrusted: vscode.workspace.isTrusted,
  };

  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    this.rebuildWatchers();
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.rebuildWatchers();
        this.scheduleRefresh();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(CONFIGURATION_SECTION)) {
          this.scheduleRefresh();
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.scheduleRefresh()),
    );
  }

  get currentSnapshot(): ExtensionSnapshot {
    return this.snapshot;
  }

  async refresh(): Promise<ExtensionSnapshot> {
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
    const knownUris = new Set(
      this.snapshot.repositories.flatMap((repository) =>
        repository.problems.flatMap((problem) => problem.solutions.map(({ uri }) => uri)),
      ),
    );
    if (!knownUris.has(uriString)) {
      throw new Error('요청한 풀이가 현재 워크스페이스에 없습니다.');
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriString));
    await vscode.window.showTextDocument(document);
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
    const opened = await vscode.env.openExternal(problemUri);
    if (!opened) {
      throw new Error('LeetCode 문제 페이지를 열지 못했습니다.');
    }
  }

  async deleteSolution(uriString: string, confirm = true): Promise<boolean> {
    if (!vscode.workspace.isTrusted) {
      throw new Error('풀이 파일을 삭제하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    }

    const target = this.snapshot.repositories
      .flatMap((repository) =>
        repository.problems.flatMap((problem) =>
          problem.solutions.map((solution) => ({ problem, solution })),
        ),
      )
      .find(({ solution }) => solution.uri === uriString);
    if (!target) {
      throw new Error('요청한 풀이가 현재 워크스페이스에 없습니다.');
    }

    const result = await this.solutionFileService.delete({
      uri: vscode.Uri.parse(target.solution.uri),
      relativePath: `${target.problem.slug}/${target.solution.name}`,
      confirm,
    });
    if (result.status === 'cancelled') {
      return false;
    }

    await this.refresh();
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
    await this.refresh();
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
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.disposeWatchers();
    this.changeEmitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async performRefresh(): Promise<ExtensionSnapshot> {
    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    const configuredNickname = configuration.get<string>('nickname', '').trim();
    const configuredLanguage = configuration.get<string>(
      'preferredLanguage',
      DEFAULT_LANGUAGE,
    );
    const nickname = isValidNickname(configuredNickname) ? configuredNickname : '';
    const preferredLanguage = findLanguage(configuredLanguage)
      ? configuredLanguage
      : DEFAULT_LANGUAGE;
    const scanResult = await this.repositoryService.scan(nickname);

    this.snapshot = {
      nickname,
      preferredLanguage,
      languages: [...LANGUAGE_OPTIONS],
      repositories: scanResult.repositories,
      issues: scanResult.issues,
      workspaceTrusted: vscode.workspace.isTrusted,
    };
    this.changeEmitter.fire(this.snapshot);
    return this.snapshot;
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, 150);
  }

  private rebuildWatchers(): void {
    this.disposeWatchers();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const patterns = [
        new vscode.RelativePattern(folder, 'problem-categories.json'),
        new vscode.RelativePattern(folder, '*/*'),
      ];
      for (const pattern of patterns) {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        watcher.onDidCreate(() => this.scheduleRefresh());
        watcher.onDidChange(() => this.scheduleRefresh());
        watcher.onDidDelete(() => this.scheduleRefresh());
        this.watchers.push(watcher);
      }
    }
  }

  private disposeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
  }
}
