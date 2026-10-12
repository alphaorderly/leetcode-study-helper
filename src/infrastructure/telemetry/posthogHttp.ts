import { POSTHOG_HOST, POSTHOG_PROJECT_TOKEN } from './posthogConfig';
import type { SafeUsageProperties } from './usageSchema';
import type { UsageEventName } from '../../shared/telemetry';

/** 전송기에는 식별자·시각과 검증된 속성만 전달합니다. 개발 확인 이벤트는 수동 명령에서만 만듭니다. */
export interface PostHogEvent {
  event: UsageEventName | 'telemetry_connection_test';
  distinct_id: string;
  timestamp: string;
  properties: SafeUsageProperties;
}

/** 원문 응답·오류 대신 호출자가 확인할 수 있는 고정된 전송 결과입니다. */
export type DeliveryStatus =
  | 'accepted'
  | 'http_error'
  | 'quota_limited'
  | 'network_error'
  | 'timeout'
  | 'aborted'
  | 'invalid_response';

/** 네트워크 테스트는 대체 fetch를 주입하며 본문 읽기까지 같은 제한 시간을 사용합니다. */
export interface PostHogHttpOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/** 검증된 이벤트 배치를 전송하고 HTTP 수락만 확인합니다. 재시도·출력·예외 전달은 하지 않습니다. */
export async function sendPostHogBatch(
  events: readonly PostHogEvent[],
  signal: AbortSignal,
  options: PostHogHttpOptions = {},
): Promise<DeliveryStatus> {
  if (signal.aborted) return 'aborted';
  const controller = new AbortController();
  let timedOut = false;
  let response: Response | undefined;
  /** 종료·동의 변경의 취소를 요청과 응답 읽기에 함께 전달합니다. */
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 2000);
  /** 주입된 fetch가 취소를 무시하더라도 제한 시간 후 호출자에게 제어를 돌려줍니다. */
  const cancelled = new Promise<DeliveryStatus>((resolve) => {
    controller.signal.addEventListener('abort', () => resolve(timedOut ? 'timeout' : 'aborted'), {
      once: true,
    });
  });
  /** 전송 중 원문은 로그에 남기지 않고 응답은 quota 여부만 검사합니다. */
  const request = async (): Promise<DeliveryStatus> => {
    try {
      response = await (options.fetch ?? globalThis.fetch)(`${POSTHOG_HOST}/batch/`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: POSTHOG_PROJECT_TOKEN, batch: events }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return timedOut ? 'timeout' : 'aborted';
      if (!response.ok) return 'http_error';
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return timedOut ? 'timeout' : signal.aborted ? 'aborted' : 'invalid_response';
      }
      if (typeof body !== 'object' || body === null || Array.isArray(body))
        return 'invalid_response';
      const quota = (body as { quota_limited?: unknown }).quota_limited;
      if (
        (Array.isArray(quota) && quota.length > 0) ||
        (typeof quota === 'string' && quota.length > 0) ||
        quota === true
      )
        return 'quota_limited';
      const status = (body as { status?: unknown }).status;
      return status === 1 || status === 'Ok' ? 'accepted' : 'invalid_response';
    } catch {
      return timedOut ? 'timeout' : signal.aborted ? 'aborted' : 'network_error';
    } finally {
      if (response?.body && !response.bodyUsed) void response.body.cancel().catch(() => {});
    }
  };
  try {
    return await Promise.race([request(), cancelled]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
