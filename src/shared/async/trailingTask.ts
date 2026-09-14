/** 연속 호출을 마지막 요청 시점 기준의 한 번의 작업으로 모으는 타이머입니다. */
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
