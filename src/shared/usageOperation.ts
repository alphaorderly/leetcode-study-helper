import type { UsageOperation, UsageProperties } from './telemetry';

/** 순수 tracker에 시각·허용 여부·발행 함수를 주입합니다. 플랫폼 API나 네트워크를 직접 읽지 않습니다. */
export interface UsageOperationDependencies {
  /** 시작 당시 동의 세대가 현재도 유효한지 반환합니다. */
  allowed(): boolean;
  /** 경과 시간을 계산할 단조 증가 밀리초 시각입니다. */
  now(): number;
  /** 발생 시각을 나타내는 UTC ISO 문자열입니다. */
  timestamp(): string;
  /** 타입이 지정된 결과를 검증·발행 경계로 전달합니다. */
  emit(properties: UsageProperties, timestamp: string): void;
}

/** 본체 결과를 먼저 보관하고 후처리를 마친 뒤 한 번 발행하며, 시작 당시의 동의가 계속 유효해야 합니다. */
export function createUsageOperation(
  context: UsageProperties,
  dependencies: UsageOperationDependencies,
): UsageOperation {
  const initial = { ...context };
  const start = dependencies.now();
  let marked: UsageProperties | undefined;
  let markedTime: number | undefined;
  let occurrence: string | undefined;
  let finished = false;
  return {
    /** 첫 본체 결과의 시각을 보존하고 중복·완료 이후 통지는 무시합니다. */
    markResult(properties) {
      if (finished || marked) return;
      marked = { ...properties };
      markedTime = dependencies.now();
      occurrence = dependencies.timestamp();
    },
    /** 유효한 동의 세대에서 한 번만 발행하며 본체 결과를 후처리 실패로 덮어쓰지 않습니다. */
    finish(properties = {}) {
      if (finished) return;
      finished = true;
      if (!dependencies.allowed()) return;
      const result = { ...initial, ...marked, ...properties };
      if (marked?.outcome) {
        result.outcome = marked.outcome;
        if (
          properties.outcome === 'error' &&
          ['completed', 'passed', 'failed', 'cancelled', 'noop'].includes(marked.outcome)
        ) {
          result.followup_failed = true;
        }
      }
      result.duration_ms =
        marked?.duration_ms ??
        properties.duration_ms ??
        Math.max(0, Math.round((markedTime ?? dependencies.now()) - start));
      dependencies.emit(result, occurrence ?? dependencies.timestamp());
    },
  };
}
