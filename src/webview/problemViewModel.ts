import type {
  ExtensionSnapshot,
  ProblemSnapshot,
  RepositorySnapshot,
} from '../core/types';

export type StatusFilter = 'all' | 'completed' | 'incomplete';
export type GroupingMode = 'week' | 'difficulty';

interface ProblemVisibilityOptions {
  query: string;
  filter: StatusFilter;
  unpushedOnly: boolean;
}

export interface ProblemGroup {
  label: string;
  problems: ProblemSnapshot[];
  kind?: string;
}

export function formatProblemTitle(slug: string): string {
  const words = slug.replace(/-+/g, ' ').trim();
  return words.replace(/(^|\s)([a-z])/g, (_, prefix: string, letter: string) =>
    `${prefix}${letter.toLocaleUpperCase()}`,
  );
}

export function difficultyClass(difficulty: string): string {
  const normalized = difficulty.toLocaleLowerCase();
  return ['easy', 'medium', 'hard'].includes(normalized) ? normalized : 'unknown';
}

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

export function preferredSolution(
  problem: ProblemSnapshot,
  state: ExtensionSnapshot,
): ProblemSnapshot['solutions'][number] | undefined {
  const preferredExtension = state.languages.find(
    ({ id }) => id === state.preferredLanguage,
  )?.extension;
  return problem.solutions.find(({ name }) => name.endsWith(`.${preferredExtension}`))
    ?? problem.solutions[0];
}

export function visibleProblems(
  repository: RepositorySnapshot,
  state: ExtensionSnapshot,
  options: ProblemVisibilityOptions,
): ProblemSnapshot[] {
  const needle = options.query.trim().toLocaleLowerCase();
  return repository.problems.filter((problem) => {
    const matchesFilter =
      options.filter === 'all'
      || (options.filter === 'completed' && problem.completed)
      || (options.filter === 'incomplete' && !problem.completed);
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

export function groupProblems(
  problems: ProblemSnapshot[],
  grouping: GroupingMode,
): ProblemGroup[] {
  return grouping === 'week' ? groupByWeek(problems) : groupByDifficulty(problems);
}

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

function sortByDifficulty(problems: ProblemSnapshot[]): ProblemSnapshot[] {
  return problems.sort((left, right) =>
    difficultyOrder(left) - difficultyOrder(right)
      || left.slug.localeCompare(right.slug),
  );
}

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
