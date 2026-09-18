import { SubmissionCommands } from './submissionCommands';
import { requireSolution } from './snapshotQueries';
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

/**
 * 확장 진입점이 생성하며 웹뷰 명령과 VS Code 명령이 함께 사용하는 조율자입니다.
 * 설정·사용자 선택·전체 스냅샷을 소유하고, 탐색·취소의 수명 관리는 두 세션에 위임합니다.
 * 전체 변경과 현재 문제 변경을 다른 이벤트로 보내 제출 입력과 목록 DOM을 보존합니다.
 * 여기서 하는 사전 확인은 사용자 안내용이며 실제 Git 쓰기 검증은 서비스가 다시 수행합니다.
 * dispose는 소유한 서비스·세션과 이벤트 구독을 함께 해제합니다.
 */
export class StudyController implements vscode.Disposable {
  /** 컨트롤러가 소유하는 작업 서비스입니다. Git 서비스는 이벤트 구독도 소유하므로 dispose 목록에 포함합니다. */
  private readonly gitStatusService = new GitStatusService();
  private readonly repositoryService = new StudyRepositoryService();
  private readonly solutionFileService = new SolutionFileService();
  /** 현재 풀이 선택·분석·실행을 관리하는 세션입니다. 저장소 목록은 컨트롤러가 갱신 세션에서 받아 전달합니다. */
  private readonly currentProblemSession: CurrentProblemSession;
  /** 파일·Git 갱신을 합쳐 저장소 목록을 공급합니다. 명령은 갱신을 요청하고 결과는 이벤트로 다시 받아 게시합니다. */
  private readonly repositoryRefreshSession: RepositoryRefreshSession;
  /** 설정·저장소 목록을 포함한 전체 상태 이벤트입니다. 현재 문제만 바뀔 때는 아래의 별도 이벤트를 사용합니다. */
  private readonly changeEmitter = new vscode.EventEmitter<ExtensionSnapshot>();
  /** 현재 문제 변경만 알리는 이벤트입니다. 웹뷰가 목록 DOM과 제출 중 입력을 유지하면서 상세 영역만 갱신하게 합니다. */
  private readonly currentProblemEmitter = new vscode.EventEmitter<
    CurrentProblemSnapshot | undefined
  >();
  /** 직접 소유한 서비스·세션과 이들이 발생시키는 이벤트 구독을 함께 해제합니다. 제출 명령 객체는 수명을 소유하지 않습니다. */
  private readonly disposables: vscode.Disposable[] = [];
  /** 루트 URI와 문제 slug별로 마지막에 연 다른 참여자의 파일명을 기록해 다음 후보 탐색에 전달합니다. */
  private readonly lastOtherSolutionNames = new Map<string, string>();
  /** 상태는 getter로 읽게 하고 갱신은 세션에 위임합니다. 생성 시에는 콜백을 보관할 뿐 세션을 호출하지 않습니다. */
  private readonly submissionCommands = new SubmissionCommands(
    () => this.snapshot,
    this.gitStatusService,
    (forceStatus, forceRemote) =>
      this.repositoryRefreshSession.refreshGitStatuses(forceStatus, forceRemote),
    () => this.refresh(),
  );
  /** getState의 최초 전체 탐색 여부입니다. true여도 후속 Git 조회까지 완료되었다는 뜻은 아닙니다. */
  private initialized = false;
  /** 마지막 화면 상태입니다. 초기값은 설정·파일 조회 전에도 유효한 빈 화면을 제공하며 각 이벤트에서 새 객체로 교체합니다. */
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

  /**
   * 설정을 스냅샷에 반영하고 전체 파일 탐색을 요청합니다.
   * 반환 시 파일 목록은 준비되지만 Git 후속 조회는 아직 진행 중일 수 있습니다.
   * 세션 이벤트에서 이미 게시한 배열은 다시 게시하지 않아 중복 렌더링을 줄입니다.
   */
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

  /**
   * 현재 목록의 내 풀이 URI를 중복 제거하고 Markdown을 제외해 줄 끝을 보정합니다.
   * 파일 내용이 바뀌는 작업입니다. 대상 중 저장하지 않은 문서가 하나라도 있으면
   * 서비스가 쓰기 시작 전에 중단하고 오류를 전달합니다.
   */
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
    return this.submissionCommands.stageSolution(uriString);
  }

  /** 등록된 풀이의 스테이징을 해제하고 Git 표시 상태를 다시 읽습니다. */
  async unstageSolution(uriString: string): Promise<void> {
    return this.submissionCommands.unstageSolution(uriString);
  }

  /** 활성 주차와 스테이징 상태를 확인해 커밋하고 성공하면 Git 표시 상태를 갱신합니다. */
  async commitActiveWeek(rootUri: string, message: string): Promise<void> {
    return this.submissionCommands.commitActiveWeek(rootUri, message);
  }

  /** 활성 저장소의 주차 브랜치를 push하고 Git·원격 상태를 다시 읽습니다. */
  async pushActiveWeek(rootUri: string): Promise<void> {
    return this.submissionCommands.pushActiveWeek(rootUri);
  }

  /** 선택한 저장소의 제출 상태로 주차 PR 또는 생성 화면을 엽니다. */
  async openPullRequest(rootUri: string): Promise<void> {
    return this.submissionCommands.openPullRequest(rootUri);
  }

  /** 신뢰·저장소·동기화 가능 여부를 확인해 포크를 동기화하고 성공하면 전체 상태를 갱신합니다. */
  async syncFork(rootUri: string): Promise<void> {
    return this.submissionCommands.syncFork(rootUri);
  }

  /** 대상 변경 목록을 보여주고 확인받은 뒤 풀이 외 추적 변경을 되돌립니다. */
  async discardOtherTrackedChanges(rootUri: string): Promise<void> {
    return this.submissionCommands.discardOtherTrackedChanges(rootUri);
  }

  /** 신뢰·저장소·복귀 가능 여부를 확인해 main 복귀·동기화 후 Git·원격 상태를 갱신합니다. */
  async returnToMainAndSync(rootUri: string): Promise<void> {
    return this.submissionCommands.returnToMainAndSync(rootUri);
  }

  /** 로컬 Git 상태와 원격 제출 정보를 모두 강제로 다시 읽습니다. */
  async refreshSubmission(): Promise<void> {
    return this.submissionCommands.refreshSubmission();
  }

  /** GitHub 로그인을 요청하고 성공했을 때 Git·원격 상태를 다시 읽습니다. */
  async signInGitHub(): Promise<void> {
    return this.submissionCommands.signInGitHub();
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

  /**
   * 새 저장소 목록으로 현재 풀이 선택부터 맞춘 다음 전체 상태를 게시합니다.
   * setRepositories가 현재 문제 변경 이벤트를 동기적으로 발생시킬 수 있으므로
   * 최종 스냅샷에는 세션이 갱신한 currentSnapshot을 사용합니다.
   */
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
    return requireSolution(this.snapshot, uri);
  }

  /** 저장소 URI와 slug를 NUL 문자로 구분해 문제별 선택 이력 키를 만듭니다. */
  private problemKey(rootUri: string, slug: string): string {
    return `${rootUri}\u0000${slug}`;
  }
}
