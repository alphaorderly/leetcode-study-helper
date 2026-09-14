import * as vscode from 'vscode';
import {
  ANSWER_CONFIRM_LABEL,
  confirmAnswerAccess,
  normalizeAnswerUrl,
} from '../domain/problems/answerLinks';
import { DEFAULT_LANGUAGE, findLanguage, LANGUAGE_OPTIONS } from '../domain/solutions/languages';
import {
  confirmOtherSolutionAccess,
  type ConsentState,
  OTHER_SOLUTION_CONFIRM_LABEL,
} from '../domain/solutions/otherSolutions';
import { isIgnoredByLineLint, isValidNickname } from '../domain/solutions/solutions';
import type {
  CurrentProblemSnapshot,
  ExtensionSnapshot,
  LineLintFixResult,
  RepositorySnapshot,
} from '../shared/contracts';
import { CurrentProblemSession } from './sessions/currentProblemSession';
import { GitStatusService } from '../infrastructure/git/gitStatusService';
import {
  RepositoryRefreshSession,
  type RepositoryRefreshState,
} from './sessions/repositoryRefreshSession';
import { StudyRepositoryService } from '../infrastructure/workspace/repositoryService';
import { SolutionFileService } from '../infrastructure/workspace/solutionFileService';

const CONFIGURATION_SECTION = 'leetcodeStudyHelper';

/** 설정과 사용자 명령을 조율하고 저장소·현재 문제 세션의 상태를 웹뷰에 전달합니다. */
export class StudyController implements vscode.Disposable {
  private readonly gitStatusService = new GitStatusService();
  private readonly repositoryService = new StudyRepositoryService();
  private readonly solutionFileService = new SolutionFileService();
  private readonly currentProblemSession: CurrentProblemSession;
  private readonly repositoryRefreshSession: RepositoryRefreshSession;
  private readonly changeEmitter = new vscode.EventEmitter<ExtensionSnapshot>();
  private readonly currentProblemEmitter = new vscode.EventEmitter<
    CurrentProblemSnapshot | undefined
  >();
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

  /** 저장소·현재 문제 세션을 구성하고 설정·신뢰·세션 변경 이벤트를 연결합니다. */
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
          event.affectsConfiguration(`${CONFIGURATION_SECTION}.nickname`) ||
          event.affectsConfiguration(`${CONFIGURATION_SECTION}.preferredLanguage`)
        ) {
          this.repositoryRefreshSession.scheduleFullRefresh();
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() =>
        this.repositoryRefreshSession.scheduleFullRefresh(),
      ),
    );
  }

  /** 추가 갱신 없이 마지막 전체 화면 상태를 반환합니다. */
  get currentSnapshot(): ExtensionSnapshot {
    return this.snapshot;
  }

  /** 초기화 전에는 전체 갱신을 수행하고 이후에는 보관한 상태를 반환합니다. */
  async getState(): Promise<ExtensionSnapshot> {
    return this.initialized ? this.snapshot : this.refresh();
  }

  /** 설정을 다시 읽고 저장소 목록을 갱신합니다. Git 상태는 세션에서 후속 갱신합니다. */
  async refresh(): Promise<ExtensionSnapshot> {
    const nickname = this.prepareRefreshSettings();
    const repositoryState = await this.repositoryRefreshSession.refresh(nickname);
    if (
      this.snapshot.repositories !== repositoryState.repositories ||
      this.snapshot.issues !== repositoryState.issues
    ) {
      this.publishRepositoryState(repositoryState);
    }
    this.initialized = true;
    return this.snapshot;
  }

  /**
   * 닉네임과 언어를 검증해 전역 설정에 저장한 뒤 목록을 갱신합니다.
   * @throws 닉네임 또는 언어가 지원되지 않거나 설정 저장에 실패한 경우.
   */
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

  /** 현재 목록에 등록된 풀이 파일을 편집기로 엽니다. */
  async openSolution(uriString: string): Promise<void> {
    this.requireSolution(uriString);

    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriString));
    await vscode.window.showTextDocument(document);
  }

  /**
   * 이전 선택과 다른 참여자의 풀이를 찾고, 필요한 동의를 받은 뒤 엽니다.
   * @returns 연 파일의 URI. 후보가 없거나 사용자가 취소하면 undefined입니다.
   */
  async openOtherSolution(
    rootUri: string,
    slug: string,
    confirm = true,
  ): Promise<string | undefined> {
    const { repository } = this.requireProblem(rootUri, slug);

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
      await vscode.window.showInformationMessage('이 문제에는 다른 참여자의 풀이가 없습니다.');
      return undefined;
    }

    if (
      confirm &&
      !(await confirmOtherSolutionAccess(this.consentState, () =>
        vscode.window.showWarningMessage(
          '다른 참여자의 풀이를 열까요?',
          {
            modal: true,
            detail:
              '아직 직접 풀지 않았다면 풀이 내용이 노출될 수 있습니다. 동의하면 다음부터는 다시 묻지 않습니다.',
          },
          OTHER_SOLUTION_CONFIRM_LABEL,
        ),
      ))
    ) {
      return undefined;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: true });
    this.lastOtherSolutionNames.set(key, uri.path.split('/').pop() ?? uri.path);
    return uri.toString();
  }

  /** 현재 목록에 있는 문제의 LeetCode 페이지를 외부 브라우저로 엽니다. */
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
    if (!(await vscode.env.openExternal(problemUri))) {
      throw new Error('LeetCode 문제 페이지를 열지 못했습니다.');
    }
  }

  /**
   * 문제 README의 정답 링크를 검증하고 확인 후 외부 브라우저로 엽니다.
   * @returns 사용자가 확인을 취소하면 false입니다.
   */
  async openAnswer(rootUri: string, slug: string, confirm = true): Promise<boolean> {
    const { problem } = this.requireProblem(rootUri, slug);

    const answerUrl = problem.solutionUrl ? normalizeAnswerUrl(problem.solutionUrl) : undefined;
    if (!answerUrl) {
      throw new Error('README.md에서 유효한 정답 URL을 찾을 수 없습니다.');
    }

    if (
      confirm &&
      !(await confirmAnswerAccess(() =>
        vscode.window.showWarningMessage(
          '정답으로 이동합니다.',
          { modal: true },
          ANSWER_CONFIRM_LABEL,
        ),
      ))
    ) {
      return false;
    }

    if (!(await vscode.env.openExternal(vscode.Uri.parse(answerUrl)))) {
      throw new Error('정답 페이지를 열지 못했습니다.');
    }
    return true;
  }

  /** 현재 문제 세션에 선택된 문제의 설명 로딩을 요청합니다. */
  async loadCurrentProblem(): Promise<void> {
    await this.currentProblemSession.loadProblem();
  }

  /** 현재 문제 세션에 지정 Python 후보의 테스트 실행을 요청합니다. */
  async runCurrentSolution(candidateId: string): Promise<void> {
    await this.currentProblemSession.run(candidateId);
  }

  /**
   * 신뢰된 워크스페이스에서 풀이를 삭제하고 해당 문제만 갱신합니다.
   * @returns 삭제가 취소되면 false입니다.
   */
  async deleteSolution(uriString: string, confirm = true): Promise<boolean> {
    if (!vscode.workspace.isTrusted) {
      throw new Error('풀이 파일을 삭제하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    }

    const target = this.requireSolution(uriString);
    const result = await this.solutionFileService.delete({
      uri: vscode.Uri.parse(target.uri),
      relativePath: `${target.slug}/${target.name}`,
      confirm,
    });
    if (result.status === 'cancelled') {
      return false;
    }

    await this.repositoryRefreshSession.refreshProblem(target.rootUri, target.slug, true);
    return true;
  }

  /**
   * 닉네임·기본 언어에 맞는 파일을 만들거나 기존 파일을 열고 해당 문제를 갱신합니다.
   * @returns 연 파일의 URI. 생성이 취소되면 undefined입니다.
   */
  async createSolution(rootUri: string, slug: string, confirm = true): Promise<string | undefined> {
    if (!vscode.workspace.isTrusted) {
      throw new Error('풀이 파일을 만들려면 먼저 워크스페이스를 신뢰해야 합니다.');
    }

    this.requireProblem(rootUri, slug);

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

  /** Markdown을 제외한 내 풀이의 파일 끝 개행을 정리합니다. 저장하지 않은 문서가 있으면 중단합니다. */
  async fixAllSolutions(): Promise<LineLintFixResult> {
    if (!vscode.workspace.isTrusted) {
      throw new Error('풀이 파일을 수정하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    }

    const solutions = this.snapshot.repositories.flatMap((repository) =>
      repository.problems.flatMap((problem) => problem.solutions),
    );
    const eligibleUris = [
      ...new Set(solutions.filter(({ name }) => !isIgnoredByLineLint(name)).map(({ uri }) => uri)),
    ].map((uri) => vscode.Uri.parse(uri));
    const result = await this.solutionFileService.fixLineEndings(eligibleUris);
    return {
      ...result,
      ignored: solutions.length - eligibleUris.length,
    };
  }

  /** 신뢰·풀이·주차를 확인해 스테이징하고 Git 표시 상태를 다시 읽습니다. */
  async stageSolution(uriString: string): Promise<void> {
    this.requireTrustedWorkspace('풀이를 커밋에 추가하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    const target = this.requireSolution(uriString);
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

  /** 등록된 풀이의 스테이징을 해제하고 Git 표시 상태를 다시 읽습니다. */
  async unstageSolution(uriString: string): Promise<void> {
    this.requireTrustedWorkspace('스테이징을 해제하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    const target = this.requireSolution(uriString);
    this.requireSubmissionRepository(target.rootUri, true);
    await this.gitStatusService.unstageSolution(
      vscode.Uri.parse(target.rootUri),
      vscode.Uri.parse(target.uri),
    );
    await this.repositoryRefreshSession.refreshGitStatuses(true);
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
    await this.repositoryRefreshSession.refreshGitStatuses(true);
  }

  /** 활성 저장소의 주차 브랜치를 push하고 Git·원격 상태를 다시 읽습니다. */
  async pushActiveWeek(rootUri: string): Promise<void> {
    this.requireTrustedWorkspace('풀이를 push하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    const repository = this.requireSubmissionRepository(rootUri);
    await this.gitStatusService.push(
      vscode.Uri.parse(rootUri),
      this.submissionSolutions(repository),
    );
    await this.repositoryRefreshSession.refreshGitStatuses(true, true);
  }

  /** 선택한 저장소의 제출 상태로 주차 PR 또는 생성 화면을 엽니다. */
  async openPullRequest(rootUri: string): Promise<void> {
    const repository = this.requireSubmissionRepository(rootUri);
    await this.gitStatusService.openPullRequest(repository.submission!, this.snapshot.nickname);
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
    await this.refresh();
    await this.repositoryRefreshSession.refreshGitStatuses(true, true);
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
    await this.repositoryRefreshSession.refreshGitStatuses(true, true);
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
    await this.repositoryRefreshSession.refreshGitStatuses(true, true);
  }

  /** 로컬 Git 상태와 원격 제출 정보를 모두 강제로 다시 읽습니다. */
  async refreshSubmission(): Promise<void> {
    await this.repositoryRefreshSession.refreshGitStatuses(true, true);
  }

  /** GitHub 로그인을 요청하고 성공했을 때 Git·원격 상태를 다시 읽습니다. */
  async signInGitHub(): Promise<void> {
    const signedIn = await this.gitStatusService.signInGitHub();
    if (!signedIn) {
      return;
    }
    await this.repositoryRefreshSession.refreshGitStatuses(true, true);
  }

  /** 하위 세션·서비스 구독을 해제하고 화면 상태 이벤트 발행기를 종료합니다. */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.changeEmitter.dispose();
    this.currentProblemEmitter.dispose();
  }

  /** 닉네임과 언어 설정을 읽고 유효하지 않은 값은 빈 닉네임·기본 언어로 대체합니다. */
  private readSettings(): { nickname: string; preferredLanguage: string } {
    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    const configuredNickname = configuration.get<string>('nickname', '').trim();
    const configuredLanguage = configuration.get<string>('preferredLanguage', DEFAULT_LANGUAGE);
    return {
      nickname: isValidNickname(configuredNickname) ? configuredNickname : '',
      preferredLanguage: findLanguage(configuredLanguage) ? configuredLanguage : DEFAULT_LANGUAGE,
    };
  }

  /** 현재 설정과 신뢰 상태를 스냅샷에 반영하고 탐색에 사용할 닉네임을 반환합니다. */
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

  /** 저장소 상태를 현재 문제 세션과 전체 스냅샷에 반영하고 변경을 발행합니다. */
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

  /** 현재 스냅샷에 포함된 저장소와 문제만 작업 대상으로 반환합니다. */
  private requireProblem(rootUri: string, slug: string) {
    const repository = this.snapshot.repositories.find((item) => item.rootUri === rootUri);
    const problem = repository?.problems.find((item) => item.slug === slug);
    if (!repository || !problem) {
      throw new Error('요청한 문제가 현재 워크스페이스에 없습니다.');
    }
    return { repository, problem };
  }

  /** 현재 목록에 없는 URI로 파일 작업을 요청하면 중단합니다. */
  private requireSolution(uri: string) {
    const target = this.findSolution(uri);
    if (!target) {
      throw new Error('요청한 풀이가 현재 워크스페이스에 없습니다.');
    }
    return target;
  }

  /** 현재 목록에서 URI와 일치하는 풀이의 소속 정보를 찾으며 없으면 undefined입니다. */
  private findSolution(uri: string):
    | {
        rootUri: string;
        slug: string;
        week?: number;
        name: string;
        uri: string;
      }
    | undefined {
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

  /** 화면 상태를 기준으로 명령의 사전 조건을 확인합니다. 실제 Git 쓰기 검증은 서비스가 다시 수행합니다. */
  private requireSubmissionRepository(rootUri: string, allowBlocked = false): RepositorySnapshot {
    const repository = this.snapshot.repositories.find((item) => item.rootUri === rootUri);
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

  /** 저장소 URI와 slug를 NUL 문자로 구분해 문제별 선택 이력 키를 만듭니다. */
  private problemKey(rootUri: string, slug: string): string {
    return `${rootUri}\u0000${slug}`;
  }
}
