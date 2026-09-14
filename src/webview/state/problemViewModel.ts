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

/**
 * 검색·완료·미푸시 조건을 교집합으로 적용하며 입력 목록을 변경하지 않습니다.
 * 미푸시 판단은 선호 언어의 대표 풀이를 사용하고 completed는 파일 존재 여부입니다.
 * 검색 대상은 slug·표시 제목·난이도·주차이며 카탈로그의 모든 메타데이터를 검색하지는 않습니다.
 */
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
  return (
    [
      ['easy', '쉬움'],
      ['medium', '보통'],
      ['hard', '어려움'],
      ['unknown', '알 수 없음'],
    ] as const
  )
    .map(([key, label]) => ({ label, problems: groups.get(key) ?? [], kind: key }))
    .filter(({ problems: difficultyProblems }) => difficultyProblems.length > 0);
}
