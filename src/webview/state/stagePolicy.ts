import type {
  ExtensionSnapshot,
  RepositorySnapshot,
  SolutionFileSnapshot,
  SolutionSubmissionStatus,
} from '../../shared/contracts';

/** 추가·해제를 제공할 수 있는 로컬 제출 상태인지 판별합니다. */
export function canToggleStage(status: SolutionSubmissionStatus | undefined): boolean {
  return status === 'working' || status === 'staged' || status === 'staged-outdated';
}

/**
 * 화면 버튼의 비활성 이유를 신뢰 → 포크 → 기존 스테이징 여부 → 차단 사유 → 주차 순으로 선택합니다.
 * 기존 스테이징 해제는 제출 차단 상태에서도 정리를 위해 허용합니다. 반환값 부재는 화면에서
 * 허용한다는 뜻이며 실제 Git 작업은 호스트에서 재검증합니다.
 */
export function stageDisabledReason(
  repository: RepositorySnapshot,
  week: number | undefined,
  state: ExtensionSnapshot,
  solution: SolutionFileSnapshot,
): string | undefined {
  if (!state.workspaceTrusted) {
    return '워크스페이스를 신뢰한 뒤 커밋에 추가할 수 있습니다.';
  }
  const submission = repository.submission;
  if (submission?.fork.status !== 'verified') {
    return submission?.fork.reason ?? 'DaleStudy 포크에서만 제출 기능을 사용할 수 있습니다.';
  }
  const staged =
    solution.submissionStatus === 'staged' || solution.submissionStatus === 'staged-outdated';
  if (staged) {
    return undefined;
  }
  if (submission.blockedReason) {
    return submission.blockedReason;
  }
  if (
    week !== undefined &&
    submission.activeSubmissionWeek !== undefined &&
    submission.activeSubmissionWeek !== week
  ) {
    return `Week ${submission.activeSubmissionWeek} 제출을 먼저 완료해 주세요.`;
  }
  return undefined;
}
