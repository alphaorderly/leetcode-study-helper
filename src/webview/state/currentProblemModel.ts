import type {
  CurrentProblemSnapshot,
  LeetCodeProblemDetail,
  PythonRunnerSnapshot,
  PythonSolutionCandidate,
} from '../../shared/contracts';

/** 현재 문제 설명 영역의 로딩·오류·본문 표시 상태입니다. */
export type ProblemDetailView =
  | { kind: 'loading'; title: string; description: string }
  | { kind: 'error'; message: string; slug: string }
  | { kind: 'loaded'; detail: LeetCodeProblemDetail; hideContent: boolean };

/** Python 러너 영역의 분석·실행 결과 표시 상태입니다. */
export type PythonRunnerView =
  | { kind: 'checking' }
  | { kind: 'unavailable'; reason: string; missingObjects?: string[] }
  | { kind: 'no-candidates'; message: string }
  | {
      kind: 'ready';
      candidates: readonly PythonSolutionCandidate[];
      selectedCandidateId: string;
      running: boolean;
      runLabel: string;
      result?: RunnerResultView;
      stdout?: string;
      stderr?: string;
    };

/** 실행 가능한 러너에서 결과 행에 쓸 상태입니다. */
export type RunnerResultView =
  | { kind: 'running' }
  | { kind: 'passed'; text: string }
  | { kind: 'failed'; text: string; assertion?: string }
  | { kind: 'error'; text: string; traceback?: string };

/** 설명 로딩·오류·유료 가림과 본문 표시 여부를 고릅니다. */
export function problemDetailView(currentProblem: CurrentProblemSnapshot): ProblemDetailView {
  if (currentProblem.status === 'idle' || currentProblem.status === 'loading') {
    return {
      kind: 'loading',
      title: '문제 내용을 불러오는 중…',
      description: 'LeetCode에서 문제 정보와 본문을 가져오고 있습니다.',
    };
  }
  if (currentProblem.status === 'error') {
    return { kind: 'error', message: currentProblem.message, slug: currentProblem.slug };
  }
  const { detail } = currentProblem;
  return {
    kind: 'loaded',
    detail,
    hideContent: detail.isPaidOnly || !detail.content,
  };
}

/**
 * 호스트의 runner 상태를 DOM 없이 표시 모델로 변환합니다.
 * view.kind의 ready는 후보 선택 UI를 그릴 수 있다는 뜻으로, 실행 중·통과·실패·오류도 포함합니다.
 * 실제 결과 종류는 result.kind에서 구분하며 후보 없는 오류는 no-candidates로 표시합니다.
 */
export function pythonRunnerView(runner: PythonRunnerSnapshot): PythonRunnerView {
  if (runner.status === 'checking') {
    return { kind: 'checking' };
  }
  if (runner.status === 'unavailable') {
    return {
      kind: 'unavailable',
      reason: runner.reason,
      missingObjects: runner.missingObjects,
    };
  }
  if (!runner.candidates || runner.candidates.length === 0) {
    return {
      kind: 'no-candidates',
      message: runner.status === 'error' ? runner.message : '실행할 풀이 후보가 없습니다.',
    };
  }
  return {
    kind: 'ready',
    candidates: runner.candidates,
    selectedCandidateId: runner.selectedCandidateId ?? '',
    running: runner.status === 'running',
    runLabel: runner.status === 'running' ? '실행 중…' : '테스트 실행',
    result: runnerResultView(runner),
    stdout: 'stdout' in runner ? runner.stdout : undefined,
    stderr: 'stderr' in runner ? runner.stderr : undefined,
  };
}

/** 통과·실패·오류·실행 중 결과 행에 쓸 문구를 만듭니다. */
function runnerResultView(runner: PythonRunnerSnapshot): RunnerResultView | undefined {
  switch (runner.status) {
    case 'running':
      return { kind: 'running' };
    case 'passed':
      return {
        kind: 'passed',
        text: `${runner.passed}/${runner.total}개 테스트 통과 · ${runner.durationMs}ms`,
      };
    case 'failed':
      return {
        kind: 'failed',
        text: `${runner.failedCase}번째 테스트 실패 · ${runner.passed}/${runner.total}개 통과 · ${runner.durationMs}ms`,
        assertion: runner.assertion,
      };
    case 'error':
      return {
        kind: 'error',
        text: runner.testCase
          ? `${runner.testCase}번째 테스트 실행 중 오류: ${runner.message}`
          : runner.message,
        traceback: runner.traceback,
      };
    default:
      return undefined;
  }
}
