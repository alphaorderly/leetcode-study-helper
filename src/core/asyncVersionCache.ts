export class AsyncVersionCache<T> {
  private readonly values = new Map<string, { version: string; value: T }>();

  async get(key: string, version: string, load: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached?.version === version) {
      return cached.value;
    }
    const value = await load();
    this.values.set(key, { version, value });
    return value;
  }

  delete(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}
