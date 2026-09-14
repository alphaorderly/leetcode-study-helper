/** 키와 버전이 일치하는 완료 결과를 재사용합니다. 진행 중인 load 요청 자체는 합치지 않습니다. */
export class AsyncVersionCache<T> {
  private readonly values = new Map<string, { version: string; value: T }>();

  /** 버전이 달라지면 다시 읽고 성공 결과만 저장합니다. load의 오류는 호출자에게 전달합니다. */
  async get(key: string, version: string, load: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached?.version === version) {
      return cached.value;
    }
    const value = await load();
    this.values.set(key, { version, value });
    return value;
  }

  /** 지정 키의 완료 결과를 제거해 다음 조회에서 다시 읽도록 합니다. */
  delete(key: string): void {
    this.values.delete(key);
  }

  /** 저장된 모든 완료 결과를 비웁니다. */
  clear(): void {
    this.values.clear();
  }
}
