import { sendPostHogBatch, type DeliveryStatus, type PostHogEvent } from './posthogHttp';

/** 테스트에서는 네트워크 대신 취소 신호를 관측할 수 있는 전송 함수를 주입합니다. */
export type BatchSender = (
  events: readonly PostHogEvent[],
  signal: AbortSignal,
) => Promise<DeliveryStatus>;

/** 한 배치의 소유자입니다. 이전 세대의 finally가 새 요청 상태를 지우지 못하도록 참조를 비교합니다. */
interface ActiveBatch {
  controller: AbortController;
  generation: number;
  count: number;
  promise: Promise<void>;
}

/** 메모리 큐·타이머·요청을 소유합니다. 동의 중단은 폐기만 하고 일반 종료만 제한 시간 동안 전송합니다. */
export class UsageQueue {
  private readonly events: { event: PostHogEvent; queuedAt: number }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: ActiveBatch | undefined;
  private generation = 0;
  private accepting = true;
  private disposed = false;

  /** 허용 상태는 배치 전송 직전에도 다시 읽으며 호출자의 기능 작업을 기다리게 하지 않습니다. */
  constructor(
    private readonly allowed: () => boolean,
    private readonly sender: BatchSender = sendPostHogBatch,
  ) {}

  /** 대기·전송 중인 합계가 100개를 넘지 않도록 오래된 대기 이벤트를 폐기합니다. */
  enqueue(event: PostHogEvent): boolean {
    if (!this.accepting || this.disposed || !this.allowed()) return false;
    const capacity = 100 - (this.active?.count ?? 0);
    if (this.events.length >= capacity) this.events.shift();
    this.events.push({ event, queuedAt: Date.now() });
    if (this.events.length >= 20 && !this.active) void this.drain();
    else this.schedule();
    return true;
  }

  /** 첫 대기 이벤트 뒤 한 번만 예약하며 연속 입력이 전송 시점을 미루지 않습니다. */
  private schedule(): void {
    if (this.timer || !this.events.length || this.disposed) return;
    const remaining = Math.max(0, (this.events[0]?.queuedAt ?? Date.now()) + 5000 - Date.now());
    if (remaining === 0) {
      if (!this.active) void this.drain();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain();
    }, remaining);
  }

  /** 전송은 직렬로 수행하며 실패한 배치는 재시도하지 않습니다. 이전 세대의 정리는 새 큐에 관여하지 않습니다. */
  private async drain(): Promise<void> {
    if (this.active || this.disposed || !this.events.length || !this.allowed()) return;
    this.clearTimer();
    const batch = this.events.splice(0, 20).map(({ event }) => event);
    const active: ActiveBatch = {
      controller: new AbortController(),
      generation: this.generation,
      count: batch.length,
      promise: Promise.resolve(),
    };
    this.active = active;
    active.promise = (async () => {
      try {
        if (this.allowed() && active.generation === this.generation)
          await this.sender(batch, active.controller.signal);
      } catch {
        /* 대체 전송기의 예외도 기능 작업과 다른 배치에 영향을 주지 않습니다. */
      } finally {
        if (this.active === active) {
          this.active = undefined;
          if (!this.disposed && active.generation === this.generation && this.allowed()) {
            if (this.events.length >= 20 || !this.accepting) void this.drain();
            else this.schedule();
          }
        }
      }
    })();
    await active.promise;
  }

  /** 예약한 타이머만 취소하며 전송 중인 요청의 취소는 revoke가 담당합니다. */
  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** 동의를 철회하면 이전 세대의 데이터와 요청을 즉시 폐기합니다. 재활성화는 새 데이터만 허용합니다. */
  revoke(): void {
    this.generation += 1;
    this.clearTimer();
    this.events.length = 0;
    this.active?.controller.abort();
    this.active = undefined;
  }

  /** 새 이벤트를 막고 유효한 동의 아래에서만 최대 1.5초 전송합니다. 제한 후에는 남은 작업을 폐기합니다. */
  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.accepting = false;
    this.clearTimer();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    /** 진행 중인 배치 이후 남은 배치를 직렬로 전송합니다. */
    const flush = async () => {
      while (!this.disposed && this.allowed() && (this.active || this.events.length)) {
        if (this.active) await this.active.promise;
        else await this.drain();
      }
    };
    try {
      await Promise.race([
        flush(),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 1500);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      this.dispose();
    }
  }

  /** 동기 리소스 해제에서는 전송하지 않으며 반복 호출은 안전합니다. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.accepting = false;
    this.revoke();
  }
}
