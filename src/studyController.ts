import * as vscode from 'vscode';
import { CurrentProblemSession } from './currentProblemSession';
import {
  ANSWER_CONFIRM_LABEL,
  confirmAnswerAccess,
  normalizeAnswerUrl,
} from './core/answerLinks';
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
import {
  RepositoryRefreshSession,
  type RepositoryRefreshState,
} from './repositoryRefreshSession';
import { SolutionFileService } from './solutionFileService';

const CONFIGURATION_SECTION = 'leetcodeStudyHelper';

export class StudyController implements vscode.Disposable {
  private readonly gitStatusService = new GitStatusService();
  private readonly repositoryService = new StudyRepositoryService();
  private readonly solutionFileService = new SolutionFileService();
  private readonly currentProblemSession: CurrentProblemSession;
  private readonly repositoryRefreshSession: RepositoryRefreshSession;
  private readonly changeEmitter = new vscode.EventEmitter<ExtensionSnapshot>();
  private readonly currentProblemEmitter = new vscode.EventEmitter<CurrentProblemSnapshot | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly lastOtherSolutionNames = new Map<string, string>();
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
    this.repositoryRefreshSession = new RepositoryRefreshSession(
      this.repositoryService,
      this.gitStatusService,
      () => this.prepareRefreshSettings(),
    );
    this.disposables.push(
      this.gitStatusService,
      this.currentProblemSession,
      this.repositoryRefreshSession,
      this.repositoryRefreshSession.onDidChange((state) => {
        this.publishRepositoryState(state);
      }),
      this.currentProblemSession.onDidChange((currentProblem) => {
        this.snapshot = { ...this.snapshot, currentProblem };
        this.currentProblemEmitter.fire(currentProblem);
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration(`${CONFIGURATION_SECTION}.nickname`)
          || event.affectsConfiguration(`${CONFIGURATION_SECTION}.preferredLanguage`)
        ) {
          this.repositoryRefreshSession.scheduleFullRefresh();
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(
        () => this.repositoryRefreshSession.scheduleFullRefresh(),
      ),
    );
  }

  get currentSnapshot(): ExtensionSnapshot {
    return this.snapshot;
  }

  async getState(): Promise<ExtensionSnapshot> {
    return this.initialized ? this.snapshot : this.refresh();
  }

  async refresh(): Promise<ExtensionSnapshot> {
    const nickname = this.prepareRefreshSettings();
    const repositoryState = await this.repositoryRefreshSession.refresh(nickname);
    if (
      this.snapshot.repositories !== repositoryState.repositories
      || this.snapshot.issues !== repositoryState.issues
    ) {
      this.publishRepositoryState(repositoryState);
    }
    this.initialized = true;
    return this.snapshot;
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

  async openAnswer(
    rootUri: string,
    slug: string,
    confirm = true,
  ): Promise<boolean> {
    const repository = this.snapshot.repositories.find((item) => item.rootUri === rootUri);
    const problem = repository?.problems.find((item) => item.slug === slug);
    if (!repository || !problem) {
      throw new Error('요청한 문제가 현재 워크스페이스에 없습니다.');
    }

    const answerUrl = problem.solutionUrl
      ? normalizeAnswerUrl(problem.solutionUrl)
      : undefined;
    if (!answerUrl) {
      throw new Error('README.md에서 유효한 정답 URL을 찾을 수 없습니다.');
    }

    if (confirm && !await confirmAnswerAccess(() =>
      vscode.window.showWarningMessage(
        '정답으로 이동합니다.',
        { modal: true },
        ANSWER_CONFIRM_LABEL,
      ))) {
      return false;
    }

    if (!await vscode.env.openExternal(vscode.Uri.parse(answerUrl))) {
      throw new Error('정답 페이지를 열지 못했습니다.');
    }
    return true;
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

    await this.repositoryRefreshSession.refreshProblem(
      target.rootUri,
      target.slug,
      true,
    );
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
    await this.repositoryRefreshSession.refreshProblem(rootUri, slug, true);
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

  async stageSolution(uriString: string): Promise<void> {
    this.requireTrustedWorkspace('풀이를 커밋에 추가하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    const target = this.findSolution(uriString);
    if (!target) {
      throw new Error('요청한 풀이가 현재 워크스페이스에 없습니다.');
    }
    const repository = this.requireSubmissionRepository(target.rootUri);
    this.validateSubmissionWeek(repository, target.week);
    await this.gitStatusService.stageSolution(
      vscode.Uri.parse(target.rootUri),
      vscode.Uri.parse(target.uri),
      target.week,
      this.submissionSolutions(repository),
    );
    await this.repositoryRefreshSession.refreshGitStatuses(true);
  }

  async unstageSolution(uriString: string): Promise<void> {
    this.requireTrustedWorkspace('스테이징을 해제하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    const target = this.findSolution(uriString);
    if (!target) {
      throw new Error('요청한 풀이가 현재 워크스페이스에 없습니다.');
    }
    this.requireSubmissionRepository(target.rootUri, true);
    await this.gitStatusService.unstageSolution(
      vscode.Uri.parse(target.rootUri),
      vscode.Uri.parse(target.uri),
    );
    await this.repositoryRefreshSession.refreshGitStatuses(true);
  }

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
    const stagedOutdated = repository.problems.flatMap(({ solutions }) => solutions)
      .some(({ uri, submissionStatus }) =>
        stagedUris.has(uri) && submissionStatus === 'staged-outdated'
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
    await this.repositoryRefreshSession.refreshGitStatuses(true);
  }

  async pushActiveWeek(rootUri: string): Promise<void> {
    this.requireTrustedWorkspace('풀이를 push하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    const repository = this.requireSubmissionRepository(rootUri);
    await this.gitStatusService.push(
      vscode.Uri.parse(rootUri),
      this.submissionSolutions(repository),
    );
    await this.repositoryRefreshSession.refreshGitStatuses(true, true);
  }

  async openPullRequest(rootUri: string): Promise<void> {
    const repository = this.requireSubmissionRepository(rootUri);
    await this.gitStatusService.openPullRequest(
      repository.submission!,
      this.snapshot.nickname,
    );
  }

  async syncFork(rootUri: string): Promise<void> {
    this.requireTrustedWorkspace('포크를 동기화하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    const repository = this.requireSubmissionRepository(rootUri);
    if (!repository.submission?.canSync) {
      throw new Error('현재 Git 변경을 정리한 뒤 포크를 동기화해 주세요.');
    }
    await this.gitStatusService.syncFork(vscode.Uri.parse(rootUri));
    await this.refresh();
    await this.repositoryRefreshSession.refreshGitStatuses(true, true);
  }

  async returnToMainAndSync(rootUri: string): Promise<void> {
    this.requireTrustedWorkspace('main으로 돌아가려면 먼저 워크스페이스를 신뢰해야 합니다.');
    const repository = this.requireSubmissionRepository(rootUri, true);
    if (!repository.submission?.canReturnToMain) {
      throw new Error('병합 완료와 깨끗한 Git 상태를 확인한 뒤 main으로 돌아가 주세요.');
    }
    await this.gitStatusService.returnToMainAndSync(vscode.Uri.parse(rootUri));
    await this.repositoryRefreshSession.refreshGitStatuses(true, true);
  }

  async refreshSubmission(): Promise<void> {
    await this.repositoryRefreshSession.refreshGitStatuses(true, true);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.changeEmitter.dispose();
    this.currentProblemEmitter.dispose();
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

  private prepareRefreshSettings(): string {
    const { nickname, preferredLanguage } = this.readSettings();
    this.snapshot = {
      ...this.snapshot,
      nickname,
      preferredLanguage,
      workspaceTrusted: vscode.workspace.isTrusted,
    };
    return nickname;
  }

  private publishRepositoryState(state: RepositoryRefreshState): void {
    this.currentProblemSession.setRepositories(state.repositories);
    this.snapshot = {
      ...this.snapshot,
      repositories: state.repositories,
      issues: state.issues,
      workspaceTrusted: vscode.workspace.isTrusted,
      currentProblem: this.currentProblemSession.currentSnapshot,
    };
    this.changeEmitter.fire(this.snapshot);
  }

  private findSolution(uri: string): {
    rootUri: string;
    slug: string;
    week?: number;
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
            week: problem.week,
            name: solution.name,
            uri: solution.uri,
          };
        }
      }
    }
    return undefined;
  }

  private submissionSolutions(repository: RepositorySnapshot) {
    return repository.problems.flatMap((problem) =>
      problem.solutions.map((solution) => ({
        name: solution.name,
        uri: solution.uri,
        slug: problem.slug,
        week: problem.week,
      }))
    );
  }

  private requireTrustedWorkspace(message: string): void {
    if (!vscode.workspace.isTrusted) {
      throw new Error(message);
    }
  }

  private requireSubmissionRepository(
    rootUri: string,
    allowBlocked = false,
  ): RepositorySnapshot {
    const repository = this.snapshot.repositories.find((item) => item.rootUri === rootUri);
    if (!repository) {
      throw new Error('요청한 저장소가 현재 워크스페이스에 없습니다.');
    }
    if (repository.submission?.fork.status !== 'verified') {
      throw new Error(
        repository.submission?.fork.reason
          ?? 'DaleStudy/leetcode-study 포크에서만 제출 기능을 사용할 수 있습니다.',
      );
    }
    if (!allowBlocked && repository.submission.status === 'blocked') {
      throw new Error(repository.submission.blockedReason ?? '제출 상태를 먼저 정리해 주세요.');
    }
    return repository;
  }

  private validateSubmissionWeek(
    repository: RepositorySnapshot,
    week: number | undefined,
  ): void {
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

  private problemKey(rootUri: string, slug: string): string {
    return `${rootUri}\u0000${slug}`;
  }

}
