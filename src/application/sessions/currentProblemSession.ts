import * as vscode from 'vscode';
import { TrailingTask } from '../../shared/async/trailingTask';
import type {
  CurrentProblemSnapshot,
  LeetCodeProblemDetail,
  PythonRunnerSnapshot,
  PythonSolutionCandidate,
  RepositorySnapshot,
  SolutionFileSnapshot,
} from '../../shared/contracts';
import { LeetCodeApiService } from '../../infrastructure/leetcode/leetcodeApiService';
import {
  LeetCodeTestDataService,
  type LeetCodePythonTestData,
} from '../../infrastructure/leetcode/leetcodeTestDataService';
import type { PythonRunResult } from '../../infrastructure/python/pythonRunnerService';
import { PythonRunnerService } from '../../infrastructure/python/pythonRunnerService';

const CONFIGURATION_SECTION = 'leetcodeStudyHelper';
const INSPECTION_DEBOUNCE_MS = 350;

/** 문제 설명 조회의 대기·로딩·성공·실패 상태를 구분합니다. */
type ProblemLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; detail: LeetCodeProblemDetail }
  | { status: 'error'; message: string };

/** 활성 편집기에 대응하는 저장소, 문제와 풀이 파일입니다. */
interface CurrentSelection {
  rootUri: string;
  slug: string;
  solution: SolutionFileSnapshot;
}

/** 현재 문제 세션에 주입할 설명 조회·테스트 데이터·Python 실행 기능입니다. */
export interface CurrentProblemSessionDependencies {
  leetCodeApiService: Pick<LeetCodeApiService, 'getProblem'>;
  testDataService: Pick<LeetCodeTestDataService, 'getProblem'>;
  pythonRunnerService: Pick<PythonRunnerService, 'inspect' | 'run' | 'dispose'>;
}

/** 일반 실패와 구분할 AbortError 취소 신호인지 확인합니다. */
function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * StudyController가 소유하는 현재 풀이 세션입니다. 편집기 URI로 저장소의 풀이를 선택합니다.
 * 설명은 slug별로 보관하고, Python 분석·실행은 파일별로 취소하므로 두 상태의 수명이 다릅니다.
 * 편집·설정 변경은 분석을 지연 예약하고 실행을 중단합니다. 파일 전환은 이전 결과를 무효화합니다.
 * 생성자는 이벤트를 구독하며 dispose는 예약·요청·자식 프로세스와 구독을 정리합니다.
 */
export class CurrentProblemSession implements vscode.Disposable {
  /**
   * 외부 입출력 의존성입니다. 기본 구현 또는 테스트 대체물을 생성자에서 연결합니다.
   * Python 프로세스 서비스는 disposables에 포함해 세션 종료 시 실행 중 프로세스도 정리합니다.
   */
  private readonly leetCodeApiService: Pick<LeetCodeApiService, 'getProblem'>;
  private readonly testDataService: Pick<LeetCodeTestDataService, 'getProblem'>;
  private readonly pythonRunnerService: Pick<PythonRunnerService, 'inspect' | 'run' | 'dispose'>;
  /** 설명과 러너 상태를 합친 현재 선택의 스냅샷을 컨트롤러에 전달합니다. 전체 목록 이벤트와는 별개입니다. */
  private readonly changeEmitter = new vscode.EventEmitter<CurrentProblemSnapshot | undefined>();
  /** 생성자에서 등록한 편집기·문서·설정 이벤트와 소유한 Python 서비스를 해제할 목록입니다. */
  private readonly disposables: vscode.Disposable[] = [];
  /**
   * 문제 slug별 설명 조회 상태입니다. 같은 문제의 다른 풀이로 이동해도 재사용합니다.
   * 파일 선택이 바뀌어도 진행 중 설명 응답은 캐시에 남기며, 현재 문제일 때만 화면에 게시합니다.
   */
  private readonly problemLoadStates = new Map<string, ProblemLoadState>();
  /** 마지막으로 전달받은 저장소 목록입니다. 파일 URI를 풀이 정보로 연결할 때 읽고 setRepositories에서 교체합니다. */
  private repositories: RepositorySnapshot[] = [];
  /**
   * 현재 추적하는 편집 문서 URI입니다. 포커스가 웹뷰로 옮겨져도 해당 문서가 보이면 유지합니다.
   * 이 URI가 워크스페이스에 등록된 풀이인지는 selection을 찾는 단계에서 별도로 확인합니다.
   */
  private activeDocumentUri = vscode.window.activeTextEditor?.document.uri.toString();
  /**
   * 현재 목록에서 찾은 풀이와 문제의 소속 정보입니다. 등록된 풀이가 없으면 undefined입니다.
   * 같은 파일의 Git 상태 갱신도 이 정보는 교체하지만 분석·실행을 취소하지 않습니다.
   */
  private selection: CurrentSelection | undefined;
  /**
   * 현재 runner 표시가 귀속된 풀이 URI입니다. 선택된 파일과 다르면 이전 결과를 표시하지 않습니다.
   * 실행 중 요청의 유효성은 이 값만으로 판단하지 않고 요청별 취소 신호도 함께 확인합니다.
   */
  private runnerUri: string | undefined;
  /** 분석 대기부터 실행 결과까지의 표시 상태입니다. checking은 아직 실행 가능한 후보가 확정되지 않았음을 뜻합니다. */
  private runner: PythonRunnerSnapshot = { status: 'checking' };
  /** 연속 편집을 합쳐 마지막 변경 350ms 뒤 분석을 시작하는 예약입니다. 이미 실행 중인 요청 취소와는 별개입니다. */
  private readonly inspectionTask = new TrailingTask(
    INSPECTION_DEBOUNCE_MS,
    () => void this.inspectCurrentSolution(),
  );
  /** 현재 분석 요청의 취소 소유자입니다. 교체된 요청의 finally는 새 소유자를 지우지 않도록 참조를 비교합니다. */
  private inspectionController: AbortController | undefined;
  /** 현재 테스트 실행 요청의 취소 소유자입니다. 입력 준비 중에도 유효하며 선택 변경·편집·새 실행에서 취소합니다. */
  private runController: AbortController | undefined;
  /** 마지막으로 발행한 합성 스냅샷입니다. emitCurrent에서만 구성하며 선택된 풀이가 없으면 undefined입니다. */
  private current: CurrentProblemSnapshot | undefined;

  readonly onDidChange = this.changeEmitter.event;

  /** 서비스를 구성하고 편집기·문서·실행 설정·신뢰 변경을 구독합니다. */
  constructor(
    extensionUri: vscode.Uri,
    dependencies: Partial<CurrentProblemSessionDependencies> = {},
  ) {
    this.leetCodeApiService = dependencies.leetCodeApiService ?? new LeetCodeApiService();
    this.testDataService =
      dependencies.testDataService ?? new LeetCodeTestDataService(extensionUri);
    this.pythonRunnerService =
      dependencies.pythonRunnerService ?? new PythonRunnerService(extensionUri);
    this.disposables.push(
      this.pythonRunnerService,
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.activeDocumentUri = editor.document.uri.toString();
        } else if (
          !vscode.window.visibleTextEditors.some(
            ({ document }) => document.uri.toString() === this.activeDocumentUri,
          )
        ) {
          this.activeDocumentUri = undefined;
        }
        this.syncSelection();
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === this.activeDocumentUri) {
          this.scheduleInspection(true);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${CONFIGURATION_SECTION}.pythonExecutable`)) {
          this.scheduleInspection(true);
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.scheduleInspection(true)),
    );
  }

  /** 추가 조회 없이 마지막으로 발행한 현재 문제 상태를 반환합니다. */
  get currentSnapshot(): CurrentProblemSnapshot | undefined {
    return this.current;
  }

  /** 저장소 목록을 교체하고 활성 문서에 대응하는 풀이를 다시 선택합니다. */
  setRepositories(repositories: RepositorySnapshot[]): void {
    this.repositories = repositories;
    this.syncSelection();
  }

  /**
   * 현재 선택의 slug별 설명 상태를 loading으로 바꾼 뒤 API를 조회합니다.
   * loading·loaded이면 중복 요청을 건너뛰고 error는 다음 호출에서 재시도합니다.
   * 파일을 전환해도 응답은 캐시에 남기되, 게시 시점에 같은 slug를 보고 있을 때만 알립니다.
   * 설명 실패는 세션의 error 상태로 게시하며 호출자에게 예외를 던지지 않습니다.
   */
  async loadProblem(): Promise<void> {
    const selection = this.selection;
    if (!selection) {
      return;
    }
    const previous = this.problemLoadStates.get(selection.slug);
    if (previous?.status === 'loading' || previous?.status === 'loaded') {
      return;
    }

    this.problemLoadStates.set(selection.slug, { status: 'loading' });
    this.emitCurrent();
    try {
      const detail = await this.leetCodeApiService.getProblem(selection.slug);
      this.problemLoadStates.set(selection.slug, { status: 'loaded', detail });
    } catch (error) {
      this.problemLoadStates.set(selection.slug, {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (this.selection?.slug === selection.slug) {
      this.emitCurrent();
    }
  }

  /**
   * 선택한 Python 후보를 실행하며 이전 실행을 취소합니다.
   * 취소되거나 다른 파일로 전환한 뒤 도착한 결과는 화면에 반영하지 않습니다.
   * 입력 준비 오류는 호출자에게 전달하고, Python 실행 오류는 runner.error로 게시합니다.
   * @throws 워크스페이스가 신뢰되지 않거나 후보·테스트 데이터를 사용할 수 없는 경우.
   */
  async run(candidateId: string): Promise<void> {
    const { selection, candidates } = this.requireRunCandidate(candidateId);

    this.cancelRun();
    /** 이 실행이 소유한 신호를 입력 읽기부터 결과 게시까지 전달합니다. 이후 선택 변경은 이 신호를 취소합니다. */
    const controller = new AbortController();
    this.runController = controller;
    const prepared = await this.prepareRun(selection, controller);
    /** 테스트 데이터·소스를 기다리는 동안 다른 파일로 이동했을 수 있으므로 실행 시작 전에 다시 확인합니다. */
    if (!this.canPublishResult(selection, controller.signal)) {
      this.releaseRunController(controller);
      return;
    }
    await this.executeRun(selection, candidates, candidateId, controller, prepared);
  }

  /** 현재 후보와 신뢰 상태를 확인합니다. 실패 시 기존 러너 표시와 진행 중 실행을 유지합니다. */
  private requireRunCandidate(candidateId: string): {
    selection: CurrentSelection;
    candidates: PythonSolutionCandidate[];
  } {
    if (!vscode.workspace.isTrusted) {
      throw new Error('Python 풀이를 실행하려면 먼저 워크스페이스를 신뢰해야 합니다.');
    }
    const selection = this.selection;
    if (!selection || this.runner.status === 'checking') {
      throw new Error('현재 Python 풀이를 아직 분석하고 있습니다.');
    }
    const candidates = 'candidates' in this.runner ? this.runner.candidates : undefined;
    if (!candidates) {
      throw new Error('현재 풀이를 실행할 수 없습니다.');
    }
    if (!candidates.some(({ id }) => id === candidateId)) {
      throw new Error('선택한 풀이 후보를 찾지 못했습니다.');
    }

    return { selection, candidates };
  }

  /**
   * 실행 입력을 읽습니다. 읽기 실패는 명령 오류로 전달하며 러너 결과로 바꾸지 않습니다.
   * 반환 후 실행 여부는 호출자가 최신 선택과 취소 신호로 확인합니다.
   * 입력 읽기에 실패한 경우에만 여기서 이 요청이 소유한 제어기를 정리합니다.
   */
  private async prepareRun(
    selection: CurrentSelection,
    controller: AbortController,
  ): Promise<{ data: LeetCodePythonTestData; source: string }> {
    try {
      const data = await this.testDataService.getProblem(selection.slug);
      if (!data) {
        throw new Error('이 문제는 포함된 데이터셋에 테스트 데이터가 없습니다.');
      }
      const source = await this.currentSource(selection.solution.uri);
      return { data, source };
    } catch (error) {
      this.releaseRunController(controller);
      throw error;
    }
  }

  /** 준비 완료 후에만 running을 게시합니다. 실행 실패는 후보를 보존한 error 상태로 표시합니다. */
  private async executeRun(
    selection: CurrentSelection,
    candidates: PythonSolutionCandidate[],
    candidateId: string,
    controller: AbortController,
    { source, data }: { source: string; data: LeetCodePythonTestData },
  ): Promise<void> {
    this.setRunner({
      status: 'running',
      candidates,
      selectedCandidateId: candidateId,
    });

    try {
      const result = await this.pythonRunnerService.run(
        source,
        vscode.Uri.parse(selection.solution.uri).fsPath,
        selection.slug,
        data,
        candidateId,
        this.pythonExecutable(),
        controller.signal,
      );
      if (!this.canPublishResult(selection, controller.signal)) {
        return;
      }
      this.setRunner(toRunnerSnapshot(result, candidates, candidateId));
    } catch (error) {
      if (!controller.signal.aborted && !isCancellation(error)) {
        this.setRunner({
          status: 'error',
          candidates,
          selectedCandidateId: candidateId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      this.releaseRunController(controller);
    }
  }

  /** 대기 중인 분석과 실행 프로세스를 취소하고 이벤트 구독을 해제합니다. */
  dispose(): void {
    this.inspectionTask.cancel();
    this.cancelInspection();
    this.cancelRun();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.changeEmitter.dispose();
  }

  /**
   * 저장소 목록 또는 편집기 변화 후 등록된 풀이를 다시 찾습니다.
   * URI가 달라질 때만 이전 분석·실행을 취소하고 runner를 checking으로 초기화합니다.
   * 같은 파일의 Git 스냅샷 갱신은 실행을 중단하지 않고 선택 정보만 새 것으로 바꿉니다.
   */
  private syncSelection(): void {
    const next = this.findSelection();
    /** 선택의 동일성은 객체 참조가 아니라 풀이 URI로 판단합니다. 목록 재조회만으로 실행을 끊지 않기 위함입니다. */
    const previousUri = this.selection?.solution.uri;
    const nextUri = next?.solution.uri;
    this.selection = next;
    if (previousUri !== nextUri) {
      this.inspectionTask.cancel();
      this.cancelInspection();
      this.cancelRun();
      this.runnerUri = nextUri;
      this.runner = { status: 'checking' };
      this.emitCurrent();
      this.scheduleInspection(false);
      return;
    }
    this.emitCurrent();
  }

  /** 활성 문서에 대응하는 등록된 풀이를 찾으며 없으면 undefined를 반환합니다. */
  private findSelection(): CurrentSelection | undefined {
    if (!this.activeDocumentUri) {
      return undefined;
    }
    for (const repository of this.repositories) {
      for (const problem of repository.problems) {
        const solution = problem.solutions.find(({ uri }) => uri === this.activeDocumentUri);
        if (solution) {
          return { rootUri: repository.rootUri, slug: problem.slug, solution };
        }
      }
    }
    return undefined;
  }

  /** 현재 선택의 설명·실행 상태를 합쳐 저장하고 변경 이벤트를 발행합니다. */
  private emitCurrent(): void {
    const selection = this.selection;
    this.current = selection
      ? {
          ...selection,
          runner: this.runnerUri === selection.solution.uri ? this.runner : { status: 'checking' },
          ...(this.problemLoadStates.get(selection.slug) ?? { status: 'idle' }),
        }
      : undefined;
    this.changeEmitter.fire(this.current);
  }

  /**
   * 예약된 분석과 진행 중 분석을 취소하고 마지막 편집 이후에 다시 분석합니다.
   * @param cancelRun 현재 테스트 실행도 중단해야 하는 변경인지 여부.
   */
  private scheduleInspection(cancelRun: boolean): void {
    this.inspectionTask.cancel();
    this.cancelInspection();
    if (cancelRun) {
      this.cancelRun();
    }
    if (!this.selection) {
      return;
    }
    if (this.runner.status !== 'checking') {
      this.runner = { status: 'checking' };
      this.emitCurrent();
    }
    this.inspectionTask.schedule();
  }

  /** 현재 소스를 분석해 실행 후보를 갱신합니다. 취소된 분석 결과는 게시하지 않습니다. */
  private async inspectCurrentSolution(): Promise<void> {
    const selection = this.selection;
    if (!selection) {
      return;
    }
    if (!vscode.workspace.isTrusted) {
      this.setRunner({
        status: 'unavailable',
        reason: 'Python 풀이를 실행하려면 워크스페이스를 신뢰해야 합니다.',
      });
      return;
    }
    if (!selection.solution.name.toLocaleLowerCase().endsWith('.py')) {
      this.setRunner({
        status: 'unavailable',
        reason: '현재 버전의 테스트 실행은 Python .py 풀이만 지원합니다.',
      });
      return;
    }

    const controller = new AbortController();
    this.inspectionController = controller;
    try {
      const data = await this.testDataService.getProblem(selection.slug);
      if (controller.signal.aborted) {
        return;
      }
      if (!data) {
        this.setRunner({
          status: 'unavailable',
          reason: '이 문제는 포함된 LeetCodeDataset에 테스트 데이터가 없습니다.',
        });
        return;
      }
      const inspection = await this.pythonRunnerService.inspect(
        await this.currentSource(selection.solution.uri),
        vscode.Uri.parse(selection.solution.uri).fsPath,
        selection.slug,
        data,
        this.pythonExecutable(),
        controller.signal,
      );
      if (!this.canPublishResult(selection, controller.signal)) {
        return;
      }
      if (inspection.missingObjects.length > 0) {
        this.setRunner({
          status: 'unavailable',
          reason: `LeetCode에서는 숨겨서 제공하는 ${inspection.missingObjects.join(', ')} 정의가 이 파일에 필요합니다. 로컬 실행을 위해 직접 선언하거나 import해 주세요.`,
          missingObjects: inspection.missingObjects,
        });
      } else if (inspection.candidates.length === 0) {
        this.setRunner({
          status: 'unavailable',
          reason: `${data.methodName} 메서드를 가진 Solution 클래스를 찾지 못했습니다.`,
        });
      } else {
        this.setRunner({
          status: 'ready',
          candidates: inspection.candidates,
          selectedCandidateId: inspection.candidates.at(-1)!.id,
        });
      }
    } catch (error) {
      if (!controller.signal.aborted && !isCancellation(error)) {
        this.setRunner({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      this.releaseInspectionController(controller);
    }
  }

  /** 열린 문서가 있으면 편집 중인 내용을 사용하고, 없으면 파일에서 소스를 읽습니다. */
  private async currentSource(uriString: string): Promise<string> {
    const document = vscode.workspace.textDocuments.find(({ uri }) => uri.toString() === uriString);
    if (document) {
      return document.getText();
    }
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uriString));
    return new TextDecoder().decode(bytes);
  }

  /** Python 실행 파일 설정을 읽으며 빈 설정은 python3로 대체합니다. */
  private pythonExecutable(): string {
    return (
      vscode.workspace
        .getConfiguration(CONFIGURATION_SECTION)
        .get<string>('pythonExecutable', 'python3')
        .trim() || 'python3'
    );
  }

  /**
   * 현재 runner가 선택 파일에 귀속될 때만 상태를 게시합니다. 이 함수는 비동기 요청의
   * 취소 신호까지 알지 못하므로 호출자는 await 이후 canPublishResult 또는 취소 검사를 먼저 수행합니다.
   */
  private setRunner(runner: PythonRunnerSnapshot): void {
    const selection = this.selection;
    if (!selection || this.runnerUri !== selection.solution.uri) {
      return;
    }
    this.runner = runner;
    this.emitCurrent();
  }

  /** 취소되지 않은 요청이 여전히 선택된 파일을 위한 결과인지 확인합니다. 제어기 정리 조건과 다릅니다. */
  private canPublishResult(selection: CurrentSelection, signal: AbortSignal): boolean {
    return !signal.aborted && this.selection?.solution.uri === selection.solution.uri;
  }

  /** 이전 실행의 finally가 새 실행의 취소 제어기를 지우지 않도록 소유권을 확인합니다. */
  private releaseRunController(controller: AbortController): void {
    if (this.runController === controller) this.runController = undefined;
  }

  /** 분석이 교체된 뒤 이전 분석의 finally가 호출되어도 새 제어기는 보존합니다. */
  private releaseInspectionController(controller: AbortController): void {
    if (this.inspectionController === controller) this.inspectionController = undefined;
  }

  /** 진행 중인 Python 분석에 취소를 요청하고 제어기를 해제합니다. */
  private cancelInspection(): void {
    this.inspectionController?.abort();
    this.inspectionController = undefined;
  }

  /** 진행 중인 Python 테스트에 취소를 요청하고 제어기를 해제합니다. */
  private cancelRun(): void {
    this.runController?.abort();
    this.runController = undefined;
  }
}

/** Python 실행 결과를 화면 상태로 변환하며 실행 실패와 테스트 실패를 구분합니다. */
function toRunnerSnapshot(
  result: PythonRunResult,
  candidates: PythonSolutionCandidate[],
  candidateId: string,
): PythonRunnerSnapshot {
  if (!result.ok) {
    return {
      status: 'error',
      candidates,
      selectedCandidateId: candidateId,
      message: result.message,
      testCase: result.case,
      traceback: result.traceback,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } else if (result.outcome === 'passed') {
    return {
      status: 'passed',
      candidates,
      selectedCandidateId: candidateId,
      passed: result.passed,
      total: result.total,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } else {
    return {
      status: 'failed',
      candidates,
      selectedCandidateId: candidateId,
      passed: result.passed,
      total: result.total,
      failedCase: result.failedCase ?? result.passed + 1,
      assertion: result.assertion,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}
