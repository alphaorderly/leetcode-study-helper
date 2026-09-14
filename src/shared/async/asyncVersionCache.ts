/**
 * 동일 키·버전의 완료 결과만 재사용하는 메모리 캐시입니다. Git 커밋 변화처럼 명확한 버전이
 * 있는 조회에 사용합니다. 진행 중 요청 공유나 오래된 응답의 게시 방지는 담당하지 않습니다.
 * 반환 객체를 복제하지 않으므로 호출자가 캐시 값을 직접 변경하지 않아야 합니다.
 */
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
