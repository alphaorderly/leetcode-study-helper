/**
 * 마지막 schedule 호출에서 delayMs가 지난 뒤 작업을 한 번 호출하는 debounce 도구입니다.
 * 예약만 소유하며 비동기 작업의 Promise·취소·오류 처리는 호출자가 담당합니다.
 * 세션 종료 시 cancel을 호출해야 대기 중 작업이 실행되지 않습니다.
 */
export class TrailingTask {
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** 예약 지연 시간과 만료 시 실행할 작업을 보관합니다. */
  constructor(
    private readonly delayMs: number,
    private readonly task: () => void,
  ) {}

  /** 기존 예약을 취소하고 지연 시간 뒤 실행할 작업을 새로 예약합니다. */
  schedule(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.task();
    }, this.delayMs);
  }

  /** 예약된 작업을 취소하며 이미 실행 중인 작업에는 영향을 주지 않습니다. */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
