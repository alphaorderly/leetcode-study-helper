import type {
  ExtensionSnapshot,
  ProblemSnapshot,
  RepositorySnapshot,
} from '../../shared/contracts';

/** 문제 목록에서 전체·완료·미완료 여부를 선택하는 필터입니다. */
export type StatusFilter = 'all' | 'completed' | 'incomplete';
/** 문제 목록을 주차 또는 난이도로 묶는 표시 방식입니다. */
export type GroupingMode = 'week' | 'difficulty';

/** 문제 목록 검색·상태 필터·미푸시 필터를 적용할 조건입니다. */
interface ProblemVisibilityOptions {
  query: string;
  filter: StatusFilter;
  unpushedOnly: boolean;
}

/** 목록의 그룹 제목과 그 그룹에 표시할 문제 목록입니다. */
export interface ProblemGroup {
  label: string;
  problems: ProblemSnapshot[];
  kind?: string;
}

/** 하이픈으로 구분된 slug를 공백과 단어 첫 글자 대문자를 사용한 제목으로 바꿉니다. */
export function formatProblemTitle(slug: string): string {
  const words = slug.replace(/-+/g, ' ').trim();
  return words.replace(
    /(^|\s)([a-z])/g,
    (_, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase()}`,
  );
}

/** 난이도에 대응하는 CSS 클래스 이름을 반환합니다. */
export function difficultyClass(difficulty: string): string {
  const normalized = difficulty.toLocaleLowerCase();
  return ['easy', 'medium', 'hard'].includes(normalized) ? normalized : 'unknown';
}

/** 난이도에 대응하는 화면 표시 문구를 반환합니다. */
export function difficultyLabel(difficulty: string): string {
  switch (difficultyClass(difficulty)) {
    case 'easy':
      return '쉬움';
    case 'medium':
      return '보통';
    case 'hard':
      return '어려움';
    default:
      return '알 수 없음';
  }
}

/** 기본 언어의 풀이를 우선 선택하며 없으면 첫 번째 풀이를 사용합니다. */
export function preferredSolution(
  problem: ProblemSnapshot,
  state: ExtensionSnapshot,
): ProblemSnapshot['solutions'][number] | undefined {
  const preferredExtension = state.languages.find(
    ({ id }) => id === state.preferredLanguage,
  )?.extension;
  return (
    problem.solutions.find(({ name }) => name.endsWith(`.${preferredExtension}`)) ??
    problem.solutions[0]
  );
}

/** 검색어, 완료 필터와 미푸시 필터를 모두 만족하는 문제를 원래 순서대로 반환합니다. */
export function visibleProblems(
  repository: RepositorySnapshot,
  state: ExtensionSnapshot,
  options: ProblemVisibilityOptions,
): ProblemSnapshot[] {
  const needle = options.query.trim().toLocaleLowerCase();
  return repository.problems.filter((problem) => {
    const matchesFilter =
      options.filter === 'all' ||
      (options.filter === 'completed' && problem.completed) ||
      (options.filter === 'incomplete' && !problem.completed);
    const solution = problem.completed ? preferredSolution(problem, state) : undefined;
    const matchesPushStatus = !options.unpushedOnly || solution?.gitStatus === 'unpushed';
    if (!matchesFilter || !matchesPushStatus || !needle) {
      return matchesFilter && matchesPushStatus;
    }
    const week = problem.week === undefined ? '' : `${problem.week}주차`;
    return [
      problem.slug,
      formatProblemTitle(problem.slug),
      difficultyLabel(problem.difficulty),
      week,
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(needle);
  });
}

/** 주차 또는 난이도로 문제를 묶고 각 그룹을 표시 순서에 맞게 정렬합니다. */
export function groupProblems(problems: ProblemSnapshot[], grouping: GroupingMode): ProblemGroup[] {
  return grouping === 'week' ? groupByWeek(problems) : groupByDifficulty(problems);
}

/** 문제 정렬에 사용할 난이도 순서를 반환합니다. */
function difficultyOrder(problem: ProblemSnapshot): number {
  switch (difficultyClass(problem.difficulty)) {
    case 'easy':
      return 0;
    case 'medium':
      return 1;
    case 'hard':
      return 2;
    default:
      return 3;
  }
}

/** 전달받은 배열을 난이도 순서와 slug 순서로 제자리 정렬해 반환합니다. */
function sortByDifficulty(problems: ProblemSnapshot[]): ProblemSnapshot[] {
  return problems.sort(
    (left, right) =>
      difficultyOrder(left) - difficultyOrder(right) || left.slug.localeCompare(right.slug),
  );
}

/** 문제를 주차별로 묶고 각 그룹의 문제를 난이도 순서로 정렬합니다. */
function groupByWeek(problems: ProblemSnapshot[]): ProblemGroup[] {
  const scheduled = new Map<number, ProblemSnapshot[]>();
  const unscheduled: ProblemSnapshot[] = [];
  for (const problem of problems) {
    if (problem.week === undefined) {
      unscheduled.push(problem);
    } else {
      const weekProblems = scheduled.get(problem.week) ?? [];
      weekProblems.push(problem);
      scheduled.set(problem.week, weekProblems);
    }
  }

  const groups = [...scheduled.entries()]
    .sort(([left], [right]) => left - right)
    .map(([week, weekProblems]) => ({
      label: `${week}주차`,
      problems: sortByDifficulty(weekProblems),
    }));
  if (unscheduled.length > 0) {
    groups.push({ label: '주차 미지정', problems: sortByDifficulty(unscheduled) });
  }
  return groups;
}

/** 문제를 난이도별로 묶어 표시 순서대로 반환합니다. */
function groupByDifficulty(problems: ProblemSnapshot[]): ProblemGroup[] {
  const groups = new Map<string, ProblemSnapshot[]>();
  for (const problem of problems) {
    const key = difficultyClass(problem.difficulty);
    const difficultyProblems = groups.get(key) ?? [];
    difficultyProblems.push(problem);
    groups.set(key, difficultyProblems);
  }
  return [
    ['easy', '쉬움'],
    ['medium', '보통'],
    ['hard', '어려움'],
    ['unknown', '알 수 없음'],
  ]
    .map(([key, label]) => ({ label: label!, problems: groups.get(key!) ?? [], kind: key }))
    .filter(({ problems: difficultyProblems }) => difficultyProblems.length > 0);
}

import type { SolutionFileSnapshot, SolutionSubmissionStatus } from '../../shared/contracts';

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

/** 닉네임과 워크스페이스 신뢰 상태에 따라 풀이 생성 안내를 반환합니다. */
export function creationHint(state: ExtensionSnapshot): string {
  if (!state.nickname) {
    return '닉네임 설정 후 생성';
  }
  if (!state.workspaceTrusted) {
    return '워크스페이스 신뢰 후 생성';
  }
  return '카드를 눌러 생성';
}

/** 풀이 파일명에서 언어 표시용 확장자를 추출합니다. */
export function solutionExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot === -1 ? fileName : fileName.slice(lastDot);
}

/** 추가·해제를 제공할 수 있는 로컬 제출 상태인지 판별합니다. */
export function canToggleStage(status: SolutionSubmissionStatus | undefined): boolean {
  return status === 'working' || status === 'staged' || status === 'staged-outdated';
}

/** 신뢰·포크·주차 상태에 따라 스테이징을 막는 사유를 반환합니다. 기존 스테이징 해제는 허용합니다. */
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
