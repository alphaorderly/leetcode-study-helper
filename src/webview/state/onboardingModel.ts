import type {
  ExtensionSnapshot,
  ProblemSnapshot,
  RepositorySnapshot,
  WorkspaceKind,
} from '../../shared/contracts';
import { CANONICAL_OWNER, CANONICAL_REPOSITORY } from '../../shared/canonicalRepository';
import { resolveSubmissionRepository } from './submissionGraphModel';

/**
 * 제출 준비(포크·GitHub) 상태입니다. checking은 판정 전이라 경고하지 않고,
 * no-git·origin-invalid·official-clone·other-origin은 제출이 불가능한 확정 상태입니다.
 * sign-in은 로그인으로, retry는 일시 오류라 다시 확인으로 풀립니다.
 */
export type ForkNotice =
  | 'checking'
  | 'no-git'
  | 'origin-invalid'
  | 'official-clone'
  | 'other-origin'
  | 'sign-in'
  | 'retry'
  | 'verified';

/** 체크리스트 단계 식별자입니다. 저장소 단계는 지원 저장소가 열렸을 때만 존재하므로 항상 완료입니다. */
export type OnboardingStepId = 'repository' | 'profile' | 'first-solution' | 'submission';

/** done은 완료, current는 지금 할 일, todo는 아직 차례가 아님, checking은 판정 중, warning은 확정된 문제입니다. */
export type OnboardingStepStatus = 'done' | 'current' | 'todo' | 'checking' | 'warning';

/** 체크리스트 한 줄의 식별자와 상태입니다. */
export interface OnboardingStep {
  id: OnboardingStepId;
  status: OnboardingStepStatus;
}

/**
 * 지원 저장소가 열렸을 때의 안내입니다. checklist는 아직 시작하지 않은 사용자에게 네 단계를,
 * warning은 시작을 마친 사용자에게 해결해야 할 제출 문제 한 줄만 보여 주며, hidden은 아무것도 보이지 않습니다.
 */
export interface StudyOnboarding {
  layout: 'checklist' | 'warning' | 'hidden';
  steps: OnboardingStep[];
  fork: ForkNotice;
  /** 포크 확인이 의미를 갖는 저장소입니다. 첫 풀이 만들기도 이 저장소에 만듭니다. */
  rootUri: string;
  /** 첫 풀이로 안내할 문제입니다. 풀이를 만들 수 없거나 문제가 없으면 undefined입니다. */
  firstProblem?: ProblemSnapshot;
  /** 신뢰되지 않은 워크스페이스에서는 파일을 만들 수 없습니다. */
  canCreateFile: boolean;
  /** 제출 불가 사유를 설명할 때 보여 줄 원문입니다. */
  forkReason?: string;
}

/** 열린 폴더 종류와 종류별 안내입니다. 지원 저장소가 아니면 study는 없습니다. */
export interface OnboardingModel {
  kind: WorkspaceKind;
  study?: StudyOnboarding;
  /** 닉네임·언어 설정 폼을 보여 줄지 여부입니다. 지원 저장소가 아닐 때는 숨깁니다. */
  showSettings: boolean;
}

const DIFFICULTY_RANK: Record<string, number> = { Easy: 0, Medium: 1, Hard: 2 };

/**
 * 공식 저장소 URL과 같은 소유자·저장소인지 대소문자 구분 없이 확인합니다.
 * 소유자와 저장소가 모두 있어야 하므로 해석하지 못한 값은 공식 저장소로 취급하지 않습니다.
 */
function isOfficialRepository(owner: string | undefined, repository: string | undefined): boolean {
  return (
    owner?.toLowerCase() === CANONICAL_OWNER.toLowerCase() &&
    repository?.toLowerCase() === CANONICAL_REPOSITORY.toLowerCase()
  );
}

/**
 * 저장소의 Git·포크 조회 결과를 제출 준비 상태로 바꿉니다.
 * 조회 전이거나 Git 확장이 아직 저장소를 찾는 중이면 hasGit이 undefined라 checking으로 둬 경고를 미룹니다.
 */
export function forkNotice(repository: RepositorySnapshot): {
  notice: ForkNotice;
  reason?: string;
} {
  if (repository.hasGit === false) {
    return { notice: 'no-git' };
  }
  const fork = repository.submission?.fork;
  if (!fork || fork.status === 'checking') {
    return { notice: 'checking' };
  }
  switch (fork.status) {
    case 'verified':
      return { notice: 'verified' };
    case 'unavailable':
      return { notice: fork.needsGitHubSignIn ? 'sign-in' : 'retry', reason: fork.reason };
    case 'unsupported':
      if (!fork.originUrl) {
        return { notice: 'origin-invalid', reason: fork.reason };
      }
      return {
        notice: isOfficialRepository(fork.owner, fork.repository)
          ? 'official-clone'
          : 'other-origin',
        reason: fork.reason,
      };
  }
}

/**
 * 첫 풀이로 안내할 문제를 고릅니다. 주차가 빠른 문제가 먼저이고, 같은 주차에서는 쉬운 문제, 이름순입니다.
 * 주차표에 없는 문제는 뒤로 보냅니다. 이미 풀이가 있는 문제는 이 함수의 호출 조건에서 제외됩니다.
 */
export function pickFirstProblem(
  problems: readonly ProblemSnapshot[],
): ProblemSnapshot | undefined {
  return [...problems].sort(
    (left, right) =>
      (left.week ?? Number.MAX_SAFE_INTEGER) - (right.week ?? Number.MAX_SAFE_INTEGER) ||
      (DIFFICULTY_RANK[left.difficulty] ?? 3) - (DIFFICULTY_RANK[right.difficulty] ?? 3) ||
      left.slug.localeCompare(right.slug),
  )[0];
}

/** 지원 저장소 안내를 계산합니다. 시작 전 사용자는 체크리스트, 시작한 사용자는 확정된 제출 문제만 봅니다. */
function studyOnboarding(
  state: ExtensionSnapshot,
  repository: RepositorySnapshot,
): StudyOnboarding {
  const { notice, reason } = forkNotice(repository);
  const hasNickname = Boolean(state.nickname);
  const hasSolution = state.repositories.some(({ problems }) =>
    problems.some(({ completed }) => completed),
  );
  const submissionStatus: OnboardingStepStatus =
    notice === 'verified'
      ? 'done'
      : notice === 'checking'
        ? 'checking'
        : notice === 'sign-in'
          ? 'current'
          : notice === 'retry'
            ? 'todo'
            : 'warning';
  const steps: OnboardingStep[] = [
    { id: 'repository', status: 'done' },
    { id: 'profile', status: hasNickname ? 'done' : 'current' },
    {
      id: 'first-solution',
      status: hasSolution ? 'done' : hasNickname ? 'current' : 'todo',
    },
    { id: 'submission', status: submissionStatus },
  ];

  const started = hasNickname && hasSolution;
  const blocking =
    notice === 'no-git' ||
    notice === 'origin-invalid' ||
    notice === 'official-clone' ||
    notice === 'other-origin' ||
    notice === 'sign-in';
  const layout: StudyOnboarding['layout'] = !started
    ? 'checklist'
    : blocking
      ? 'warning'
      : 'hidden';

  return {
    layout,
    steps,
    fork: notice,
    rootUri: repository.rootUri,
    firstProblem: hasSolution ? undefined : pickFirstProblem(repository.problems),
    canCreateFile: state.workspaceTrusted,
    forkReason: reason,
  };
}

/**
 * 열린 폴더 종류와 닉네임·풀이·포크 상태로 온보딩 화면을 결정하는 순수 함수입니다.
 * 지원 저장소가 아니면 설정 폼을 숨기고 종류별 안내만 보여 줍니다.
 * 저장소가 여러 개면 제출 탭과 같은 기준(선택값, 검증된 포크, 첫 저장소)으로 하나를 고릅니다.
 */
export function onboardingModel(
  state: ExtensionSnapshot,
  selectedRootUri: string | undefined,
): OnboardingModel {
  const repository = resolveSubmissionRepository(state.repositories, selectedRootUri);
  if (state.workspace.kind !== 'study' || !repository) {
    return {
      kind: state.workspace.kind === 'study' ? 'none' : state.workspace.kind,
      showSettings: false,
    };
  }
  return {
    kind: 'study',
    study: studyOnboarding(state, repository),
    showSettings: true,
  };
}
