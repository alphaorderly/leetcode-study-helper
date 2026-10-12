import { LANGUAGE_OPTIONS } from '../../domain/solutions/languages';
import { getProblemWeek, WEEKLY_PROBLEM_SLUGS } from '../../domain/study/studySchedule';
import type { UsageEventName } from '../../shared/telemetry';

/** 전송 직전 재검증을 통과한 평평한 속성만 담습니다. 임의 객체·배열·예외는 허용하지 않습니다. */
export type SafeUsageProperties = Record<string, string | number | boolean>;

const RESULT_FIELDS = ['outcome', 'duration_ms', 'followup_failed', 'failure_stage', 'error_code'];
const PROBLEM_FIELDS = ['problem_slug', 'study_week', 'language'];
const EVENT_FIELDS: Record<UsageEventName, readonly string[]> = {
  study_session_started: ['setup_ready', 'preferred_language'],
  setup_ready: ['preferred_language'],
  solution_open_finished: [...RESULT_FIELDS, ...PROBLEM_FIELDS],
  solution_create_finished: [...RESULT_FIELDS, ...PROBLEM_FIELDS, 'create_result'],
  reference_open_finished: [...RESULT_FIELDS, ...PROBLEM_FIELDS, 'reference_kind'],
  test_finished: [...RESULT_FIELDS, ...PROBLEM_FIELDS, 'passed', 'total'],
  submission_action_finished: [
    ...RESULT_FIELDS,
    'action',
    'problem_slug',
    'study_week',
    'problem_count',
    'pr_target',
  ],
  fork_sync_finished: RESULT_FIELDS,
  next_week_preparation_finished: [
    ...RESULT_FIELDS,
    'action',
    'phase',
    'source_week',
    'target_week',
    'problem_count',
  ],
};
const LANGUAGES = new Set(LANGUAGE_OPTIONS.map(({ id }) => id));
const PROBLEMS = new Set<string>(WEEKLY_PROBLEM_SLUGS.flat());
const ENUMS: Record<string, readonly string[]> = {
  outcome: ['completed', 'cancelled', 'noop', 'error', 'awaiting_recovery', 'passed', 'failed'],
  create_result: ['created', 'exists'],
  reference_kind: ['other_solution', 'answer', 'problem'],
  pr_target: ['existing', 'creation_form'],
  phase: ['preserve', 'main', 'sync', 'push', 'target', 'apply', 'applying', 'done', 'cancelled'],
  failure_stage: ['validation', 'prepare', 'execute', 'editor', 'refresh', 'post_operation'],
  error_code: ['syntax', 'missing_objects', 'candidate', 'execution', 'runner', 'operation_failed'],
};
const SUBMISSION_ACTIONS = ['stage', 'unstage', 'commit', 'push', 'open_pr'];
const PREPARATION_ACTIONS = [
  'prepare',
  'continue',
  'cancel',
  'shelf',
  'cleanup',
  'conflicts',
  'existing_week',
];
const BASIC_OUTCOMES = ['completed', 'cancelled', 'noop', 'error'];

/** 확장 ID 접두사를 제거한 이름이 고정된 이벤트 목록에 있는지 확인합니다. */
export function isUsageEventName(value: string): value is UsageEventName {
  return Object.hasOwn(EVENT_FIELDS, value);
}

/** 허용된 숫자만 선택하며 수량·주차·시간은 문자열로 변환하지 않습니다. */
function safeNumber(key: string, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false;
  if (key.endsWith('_week'))
    return Number.isInteger(value) && value >= 1 && value <= WEEKLY_PROBLEM_SLUGS.length;
  if (key === 'duration_ms') return value <= 86400000;
  return Number.isInteger(value) && value <= 1000000;
}

/** 타입 단언·예외 객체·웹뷰 입력으로 우회할 수 없도록 이름별 허용 속성과 값을 다시 구성합니다. */
export function sanitizeUsageProperties(
  name: UsageEventName,
  input: unknown,
): SafeUsageProperties | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const source = input as Record<string, unknown>;
  const result: SafeUsageProperties = {};
  for (const key of EVENT_FIELDS[name]) {
    const value = source[key];
    if (value === undefined) continue;
    if (key === 'language' || key === 'preferred_language') {
      if (typeof value === 'string' && LANGUAGES.has(value))
        result[key] = key === 'language' && value === 'python' ? 'python3' : value;
    } else if (key === 'problem_slug') {
      if (typeof value === 'string' && PROBLEMS.has(value)) result[key] = value;
    } else if (key === 'action') {
      const actions =
        name === 'submission_action_finished' ? SUBMISSION_ACTIONS : PREPARATION_ACTIONS;
      if (typeof value === 'string' && actions.includes(value)) result[key] = value;
    } else if (key === 'followup_failed' || key === 'setup_ready') {
      if (typeof value === 'boolean') result[key] = value;
    } else if (Object.hasOwn(ENUMS, key)) {
      if (typeof value === 'string' && ENUMS[key]?.includes(value)) result[key] = value;
    } else if (safeNumber(key, value)) {
      result[key] = value;
    }
  }
  if (name.endsWith('_finished') && !result.outcome) return undefined;
  if (name.endsWith('_finished')) {
    const outcomes =
      name === 'test_finished'
        ? ['passed', 'failed', 'error', 'cancelled']
        : name === 'next_week_preparation_finished'
          ? [...BASIC_OUTCOMES, 'awaiting_recovery']
          : BASIC_OUTCOMES;
    if (typeof result.outcome !== 'string' || !outcomes.includes(result.outcome)) return undefined;
  }
  if (name === 'submission_action_finished') {
    if (result.action !== 'stage' && result.action !== 'unstage') delete result.problem_slug;
    if (result.action !== 'open_pr') delete result.pr_target;
  }
  if (typeof result.problem_slug === 'string')
    result.study_week = getProblemWeek(result.problem_slug)!;
  if (
    (name === 'submission_action_finished' || name === 'next_week_preparation_finished') &&
    !result.action
  )
    return undefined;
  if (name === 'reference_open_finished' && !result.reference_kind) return undefined;
  if (name === 'study_session_started' && typeof result.setup_ready !== 'boolean') return undefined;
  return result;
}
