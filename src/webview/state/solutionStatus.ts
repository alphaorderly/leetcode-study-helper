import type {
  ProblemSnapshot,
  RepositorySnapshot,
  SolutionFileSnapshot,
} from '../../shared/contracts';

/** 제출 상태가 알려져 있으면 우선 표시하고, 아니면 upstream 반영 상태를 표시합니다. */
export function gitStatusLabel(
  solution: ProblemSnapshot['solutions'][number],
  repository: RepositorySnapshot,
): string {
  if (solution.submissionStatus && solution.submissionStatus !== 'unknown') {
    return submissionStatusLabel(solution);
  }
  const remote = repository.gitRemote ?? '원격';
  switch (solution.gitStatus) {
    case 'checking':
      return '푸시 상태 확인 중';
    case 'pushed':
      return `${remote}`;
    case 'unpushed':
      return `push 되지 않음`;
    case 'unknown':
      return '푸시 상태 확인 불가';
  }
}

/** 제출 단계와 PR 번호를 사용자에게 보여줄 문구로 변환합니다. */
export function submissionStatusLabel(solution: SolutionFileSnapshot): string {
  switch (solution.submissionStatus) {
    case 'checking':
      return '제출 상태 확인 중';
    case 'working':
      return '작성 중';
    case 'staged':
      return '커밋 준비';
    case 'staged-outdated':
      return '추가 수정 있음';
    case 'push-needed':
      return 'push 필요';
    case 'pr-needed':
      return 'PR 필요';
    case 'pr-open':
      return solution.pullRequestNumber
        ? `PR #${solution.pullRequestNumber} 진행 중`
        : 'PR 진행 중';
    case 'merged':
      return '병합 완료';
    case 'sync-needed':
      return '동기화 후 확인';
    case 'conflict':
      return '충돌 확인 필요';
    case 'unknown':
    case undefined:
      return '상태 확인 불가';
  }
}

/** 풀이 파일의 상태를 툴팁과 접근성 설명에 사용할 문장으로 반환합니다. */
export function gitStatusTitle(
  solution: ProblemSnapshot['solutions'][number],
  repository: RepositorySnapshot,
): string {
  if (solution.submissionStatus && solution.submissionStatus !== 'unknown') {
    return `${solution.name}: ${submissionStatusLabel(solution)}`;
  }
  const remote = repository.gitRemote ?? '원격 저장소';
  switch (solution.gitStatus) {
    case 'checking':
      return `${solution.name}의 푸시 상태를 확인하고 있습니다.`;
    case 'pushed':
      return `${solution.name}의 로컬 변경이 모두 ${remote}에 반영되어 있습니다.`;
    case 'unpushed':
      return `${solution.name}에 ${remote}으로 보내지 않은 로컬 변경이 있습니다.`;
    case 'unknown':
      return 'Git 저장소 또는 현재 브랜치의 upstream을 확인할 수 없습니다.';
  }
}
