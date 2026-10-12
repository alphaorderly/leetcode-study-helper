/** 사용자 Git 작업의 결과만 전달하며 경로·ref·진단 메시지를 포함하지 않습니다. */
export interface GitOperationResult {
  outcome: 'completed' | 'cancelled' | 'noop' | 'error' | 'awaiting_recovery';
  studyWeek?: number;
  sourceWeek?: number;
  targetWeek?: number;
  problemCount?: number;
  phase?:
    'preserve' | 'main' | 'sync' | 'push' | 'target' | 'apply' | 'applying' | 'done' | 'cancelled';
  prTarget?: 'existing' | 'creation_form';
}

/** 쓰기 완료와 사용자 선택 결과를 호출별로 관찰하는 중립적인 콜백입니다. */
export type GitOperationObserver = (result: GitOperationResult) => void;

/** 관찰자의 실패가 Git 작업이나 사용자 오류 처리를 변경하지 않게 합니다. */
export function observeGitOperation(
  observer: GitOperationObserver | undefined,
  result: GitOperationResult,
): void {
  try {
    observer?.(result);
  } catch {
    // An optional observer must never change the result of a Git operation.
  }
}
