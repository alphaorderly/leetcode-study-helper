import * as vscode from 'vscode';
import { TrailingTask } from './core/trailingTask';
import type {
  CurrentProblemSnapshot,
  LeetCodeProblemDetail,
  PythonRunnerSnapshot,
  RepositorySnapshot,
  SolutionFileSnapshot,
} from './core/types';
import { LeetCodeApiService } from './leetcodeApiService';
import {
  LeetCodeTestDataService,
  type LeetCodePythonTestData,
} from './leetcodeTestDataService';
import { PythonRunnerService } from './pythonRunnerService';

const CONFIGURATION_SECTION = 'leetcodeStudyHelper';
const INSPECTION_DEBOUNCE_MS = 350;

type ProblemLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; detail: LeetCodeProblemDetail }
  | { status: 'error'; message: string };

interface CurrentSelection {
  rootUri: string;
  slug: string;
  solution: SolutionFileSnapshot;
}

export interface CurrentProblemSessionDependencies {
  leetCodeApiService: Pick<LeetCodeApiService, 'getProblem'>;
  testDataService: Pick<LeetCodeTestDataService, 'getProblem'>;
  pythonRunnerService: Pick<PythonRunnerService, 'inspect' | 'run' | 'dispose'>;
}

function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export class CurrentProblemSession implements vscode.Disposable {
  private readonly leetCodeApiService: Pick<LeetCodeApiService, 'getProblem'>;
  private readonly testDataService: Pick<LeetCodeTestDataService, 'getProblem'>;
  private readonly pythonRunnerService: Pick<PythonRunnerService, 'inspect' | 'run' | 'dispose'>;
  private readonly changeEmitter = new vscode.EventEmitter<CurrentProblemSnapshot | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly problemLoadStates = new Map<string, ProblemLoadState>();
  private repositories: RepositorySnapshot[] = [];
  private activeDocumentUri = vscode.window.activeTextEditor?.document.uri.toString();
  private selection: CurrentSelection | undefined;
  private runnerUri: string | undefined;
  private runner: PythonRunnerSnapshot = { status: 'checking' };
  private readonly inspectionTask = new TrailingTask(
    INSPECTION_DEBOUNCE_MS,
    () => void this.inspectCurrentSolution(),
  );
  private inspectionController: AbortController | undefined;
  private runController: AbortController | undefined;
  private current: CurrentProblemSnapshot | undefined;

  readonly onDidChange = this.changeEmitter.event;

  constructor(
    extensionUri: vscode.Uri,
    dependencies: Partial<CurrentProblemSessionDependencies> = {},
  ) {
    this.leetCodeApiService = dependencies.leetCodeApiService ?? new LeetCodeApiService();
    this.testDataService = dependencies.testDataService
      ?? new LeetCodeTestDataService(extensionUri);
    this.pythonRunnerService = dependencies.pythonRunnerService
      ?? new PythonRunnerService(extensionUri);
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

  get currentSnapshot(): CurrentProblemSnapshot | undefined {
    return this.current;
  }

  setRepositories(repositories: RepositorySnapshot[]): void {
    this.repositories = repositories;
    this.syncSelection();
  }

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

  async run(candidateId: string): Promise<void> {
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

    this.cancelRun();
    const controller = new AbortController();
    this.runController = controller;
    let data: LeetCodePythonTestData | undefined;
    let source: string;
    try {
      data = await this.testDataService.getProblem(selection.slug);
      if (!data) {
        throw new Error('이 문제는 포함된 데이터셋에 테스트 데이터가 없습니다.');
      }
      source = await this.currentSource(selection.solution.uri);
      if (controller.signal.aborted || this.selection?.solution.uri !== selection.solution.uri) {
        if (this.runController === controller) {
          this.runController = undefined;
        }
        return;
      }
    } catch (error) {
      if (this.runController === controller) {
        this.runController = undefined;
      }
      throw error;
    }
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
      if (controller.signal.aborted || this.selection?.solution.uri !== selection.solution.uri) {
        return;
      }
      if (!result.ok) {
        this.setRunner({
          status: 'error',
          candidates,
          selectedCandidateId: candidateId,
          message: result.message,
          testCase: result.case,
          traceback: result.traceback,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      } else if (result.outcome === 'passed') {
        this.setRunner({
          status: 'passed',
          candidates,
          selectedCandidateId: candidateId,
          passed: result.passed,
          total: result.total,
          durationMs: result.durationMs,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      } else {
        this.setRunner({
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
        });
      }
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
      if (this.runController === controller) {
        this.runController = undefined;
      }
    }
  }

  dispose(): void {
    this.inspectionTask.cancel();
    this.cancelInspection();
    this.cancelRun();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.changeEmitter.dispose();
  }

  private syncSelection(): void {
    const next = this.findSelection();
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

  private emitCurrent(): void {
    const selection = this.selection;
    this.current = selection
      ? {
          ...selection,
          runner: this.runnerUri === selection.solution.uri
            ? this.runner
            : { status: 'checking' },
          ...(this.problemLoadStates.get(selection.slug) ?? { status: 'idle' }),
        }
      : undefined;
    this.changeEmitter.fire(this.current);
  }

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
      if (controller.signal.aborted || this.selection?.solution.uri !== selection.solution.uri) {
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
      if (this.inspectionController === controller) {
        this.inspectionController = undefined;
      }
    }
  }

  private async currentSource(uriString: string): Promise<string> {
    const document = vscode.workspace.textDocuments.find(
      ({ uri }) => uri.toString() === uriString,
    );
    if (document) {
      return document.getText();
    }
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uriString));
    return new TextDecoder().decode(bytes);
  }

  private pythonExecutable(): string {
    return vscode.workspace
      .getConfiguration(CONFIGURATION_SECTION)
      .get<string>('pythonExecutable', 'python3')
      .trim() || 'python3';
  }

  private setRunner(runner: PythonRunnerSnapshot): void {
    const selection = this.selection;
    if (!selection || this.runnerUri !== selection.solution.uri) {
      return;
    }
    this.runner = runner;
    this.emitCurrent();
  }

  private cancelInspection(): void {
    this.inspectionController?.abort();
    this.inspectionController = undefined;
  }

  private cancelRun(): void {
    this.runController?.abort();
    this.runController = undefined;
  }
}
