declare module 'vanilla-create-storage' {
  export function createStorage(options?: any): any;
}

declare module 'vanilla-simple-lru' {
  export default class Lru<K = string, V = unknown> {
    readonly max: number;
    constructor(options: {
      max?: number;
      maxAge?: number;
      maxSize?: number;
      ttl?: number;
    });
    get(key: K): V | undefined;
    set(key: K, value: V, options?: { maxAge?: number }): this;
    delete(key: K): boolean;
    clear(): void;
    entries(): IterableIterator<[K, V]>;
    expiresIn(key: K): number | undefined;
    resize(maxSize: number): void;
  }
}
