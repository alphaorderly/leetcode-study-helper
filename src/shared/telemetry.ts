/** 확장이 명시적으로 수집하는 사용 이벤트입니다. 자동 조회·편집·렌더링은 포함하지 않습니다. */
export type UsageEventName =
  | 'study_session_started'
  | 'setup_ready'
  | 'solution_open_finished'
  | 'solution_create_finished'
  | 'reference_open_finished'
  | 'test_finished'
  | 'submission_action_finished'
  | 'fork_sync_finished'
  | 'next_week_preparation_finished';

/** 사용자 작업의 완료와 취소·복구 가능 실패를 구분합니다. */
export type UsageOutcome =
  'completed' | 'cancelled' | 'noop' | 'error' | 'awaiting_recovery' | 'passed' | 'failed';

/** 준비 기록에 저장되는 고정된 단계만 통계로 전달합니다. */
export type UsagePreparationPhase =
  'preserve' | 'main' | 'sync' | 'push' | 'target' | 'apply' | 'applying' | 'done' | 'cancelled';

/** 입력·예외 객체 대신 전송할 수 있는 유한한 속성 계약입니다. 실제 송신 전에 다시 검증합니다. */
export interface UsageProperties {
  outcome?: UsageOutcome;
  action?:
    | 'stage'
    | 'unstage'
    | 'commit'
    | 'push'
    | 'open_pr'
    | 'prepare'
    | 'continue'
    | 'cancel'
    | 'shelf'
    | 'cleanup'
    | 'conflicts'
    | 'existing_week';
  problem_slug?: string;
  study_week?: number;
  source_week?: number;
  target_week?: number;
  problem_count?: number;
  language?: string;
  preferred_language?: string;
  setup_ready?: boolean;
  create_result?: 'created' | 'exists';
  reference_kind?: 'other_solution' | 'answer' | 'problem';
  pr_target?: 'existing' | 'creation_form';
  phase?: UsagePreparationPhase;
  duration_ms?: number;
  passed?: number;
  total?: number;
  followup_failed?: boolean;
  failure_stage?: 'validation' | 'prepare' | 'execute' | 'editor' | 'refresh' | 'post_operation';
  error_code?:
    'syntax' | 'missing_objects' | 'candidate' | 'execution' | 'runner' | 'operation_failed';
}

/** 한 호출의 결과를 보관하고 본체 성공과 후처리 실패를 구분해 최종 이벤트를 한 번 발행합니다. */
export interface UsageOperation {
  /** 本体の結果と時刻を保存します。重複通知は無視し、ここでは送信しません。 */
  markResult(properties: UsageProperties): void;
  /** 保存した本体結果を優先して一度だけ発行します。統計側の失敗は呼び出し元へ伝えません。 */
  finish(properties?: UsageProperties): void;
}

/** application が必要とする統計契約です。生のエラー・自由形式のイベントは受け取りません。 */
export interface UsageRecorder {
  /** 開始時の同意世代を固定します。完了時まで同じ世代で許可されている場合だけ記録します。 */
  begin(name: UsageEventName, properties?: UsageProperties): UsageOperation;
}

/** 統計を注入しない既存テストと無効な収集状態で使う、例外も副作用もない処理です。 */
export const NOOP_USAGE_OPERATION: UsageOperation = {
  /** 수집이 꺼진 상태에서는 본체 결과를 보관하지 않습니다. */
  markResult() {},
  /** 수집이 꺼진 상태에서는 최종 결과를 발행하지 않습니다. */
  finish() {},
};

/** 無効な統計ポートです。利用者は有効・無効を分岐せず同じ契約を呼び出せます。 */
export const NOOP_USAGE: UsageRecorder = {
  /** 부수 효과가 없는 공용 작업 객체를 반환합니다. */
  begin() {
    return NOOP_USAGE_OPERATION;
  },
};

/** 注入された統計実装が失敗しても、ファイル・Git・Python の処理を失敗させない境界です。 */
export function beginUsage(
  recorder: UsageRecorder,
  name: UsageEventName,
  properties: UsageProperties = {},
): UsageOperation {
  try {
    const operation = recorder.begin(name, properties);
    return {
      /** 선택적 통계 구현의 완료 기록 오류는 사용자 작업과 분리합니다. */
      markResult(result) {
        try {
          operation.markResult(result);
        } catch {
          /* 통계 예외는 기능으로 전달하지 않습니다. */
        }
      },
      /** 선택적 통계 구현의 발행 오류는 사용자 작업과 분리합니다. */
      finish(result) {
        try {
          operation.finish(result);
        } catch {
          /* 통계 예외는 기능으로 전달하지 않습니다. */
        }
      },
    };
  } catch {
    return NOOP_USAGE_OPERATION;
  }
}
