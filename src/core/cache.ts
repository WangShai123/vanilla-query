import { createStorage } from 'vanilla-create-storage';
import Lru from 'vanilla-simple-lru';

import { DEFAULT_CACHE_TIME, DEFAULT_STORAGE_NAMESPACE } from './options.ts';
import { normalizePositiveNumber, now } from './time.ts';
import type {
  CacheErrorContext,
  CacheErrorHandler,
  CacheAdapterName,
  NormalizedCacheConfig,
  QueryCacheAdapter,
  QueryCacheRecord,
  QueryCacheSetOptions,
} from './types.ts';

const SUPPORTED_STORAGE_ADAPTERS = new Set([
  'cookie',
  'indexedDB',
  'localStorage',
]);

type StorageCacheAdapterName = Exclude<CacheAdapterName, 'memory'>;
type StorageCacheConfig = NormalizedCacheConfig & {
  adapter: StorageCacheAdapterName;
};

export class MemoryQueryCacheAdapter implements QueryCacheAdapter {
  name: CacheAdapterName = 'memory';
  key: string;
  private cache: Lru<string, QueryCacheRecord>;

  constructor(config: NormalizedCacheConfig) {
    this.key = config.options.namespace ?? DEFAULT_STORAGE_NAMESPACE;
    this.cache = new Lru({
      maxSize: config.maxSize,
      maxAge: config.ttl,
    });
  }

  get(key: string) {
    return this.cache.get(key);
  }

  set(key: string, record: QueryCacheRecord, options: QueryCacheSetOptions) {
    this.cache.set(key, record, { maxAge: options.ttl });
  }

  delete(key: string) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  entries() {
    return this.cache.entries();
  }

  expiresIn(key: string) {
    return this.cache.expiresIn(key);
  }

  resize(maxSize: number) {
    if (
      Number.isInteger(maxSize) &&
      maxSize > 0 &&
      this.cache.max !== maxSize
    ) {
      this.cache.resize(maxSize);
    }
  }
}

export class StorageQueryCacheAdapter implements QueryCacheAdapter {
  name: CacheAdapterName;
  key: string;
  private shadow: MemoryQueryCacheAdapter;
  private storage: {
    clear(): Promise<void> | void;
    close?(): Promise<void> | void;
    delete(key: string): Promise<void> | void;
    entries(): Promise<Array<[string, unknown]>> | Array<[string, unknown]>;
    get(key: string): unknown;
    set(
      key: string,
      value: QueryCacheRecord,
      options: QueryCacheSetOptions
    ): Promise<void> | void;
  };
  private ready: Promise<void>;
  private onError?: CacheErrorHandler;
  private ttl: number;

  constructor(config: NormalizedCacheConfig) {
    const storageConfig = normalizeStorageCacheConfig(config);

    this.name = storageConfig.adapter;
    this.key = storageConfig.options.namespace ?? DEFAULT_STORAGE_NAMESPACE;
    this.onError = storageConfig.options.onError;
    this.ttl = storageConfig.ttl;
    this.shadow = new MemoryQueryCacheAdapter(storageConfig);
    this.storage = createStorage(createStorageOptions(storageConfig));
    this.ready = this.hydrate();
  }

  get(key: string) {
    return this.shadow.get(key);
  }

  async getAsync(key: string) {
    const existing = this.shadow.get(key);
    if (existing) return existing;

    await this.ready;
    try {
      const record = await this.storage.get(key);
      if (isCacheRecord(record)) {
        this.shadow.set(key, record, { ttl: this.ttlFor(record) });
        return record;
      }
    } catch (error) {
      this.reportError(error, { key, operation: 'get' });
      throw error;
    }

    return undefined;
  }

  async set(
    key: string,
    record: QueryCacheRecord,
    options: QueryCacheSetOptions
  ) {
    this.shadow.set(key, record, options);
    try {
      await this.storage.set(key, record, { ttl: options.ttl });
    } catch (error) {
      this.reportError(error, { key, operation: 'set' });
      throw error;
    }
  }

  async delete(key: string) {
    this.shadow.delete(key);
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.reportError(error, { key, operation: 'delete' });
      throw error;
    }
  }

  async clear() {
    this.shadow.clear();
    try {
      await this.storage.clear();
    } catch (error) {
      this.reportError(error, { operation: 'clear' });
      throw error;
    }
  }

  entries() {
    return this.shadow.entries();
  }

  expiresIn(key: string) {
    return this.shadow.expiresIn(key);
  }

  resize(maxSize: number) {
    this.shadow.resize(maxSize);
  }

  async close() {
    try {
      await this.storage.close?.();
    } catch (error) {
      this.reportError(error, { operation: 'close' });
      throw error;
    }
  }

  private async hydrate() {
    try {
      const entries = await this.storage.entries();
      for (const [key, record] of entries) {
        if (!isCacheRecord(record)) continue;
        this.shadow.set(key, record, { ttl: this.ttlFor(record) });
      }
    } catch (error) {
      this.reportError(error, { operation: 'hydrate' });
    }
  }

  private reportError(
    error: unknown,
    context: Pick<CacheErrorContext, 'key' | 'operation'>
  ) {
    this.onError?.(error, {
      adapter: this.name,
      key: context.key,
      namespace: this.key,
      operation: context.operation,
    });
  }

  private ttlFor(record: QueryCacheRecord) {
    return this.ttl === Infinity
      ? Infinity
      : Math.max(this.ttl - (now() - record.updatedAt), 1);
  }
}

export function createQueryCacheAdapter(config: NormalizedCacheConfig) {
  if (typeof config.adapter !== 'string') {
    return config.adapter;
  }

  if (config.adapter === 'memory') {
    return new MemoryQueryCacheAdapter(config);
  }

  if (SUPPORTED_STORAGE_ADAPTERS.has(config.adapter)) {
    return new StorageQueryCacheAdapter(config);
  }

  throw new TypeError(`Unsupported query cache adapter: ${config.adapter}`);
}

export function toReadableCacheEntry<TData = unknown>(
  record: QueryCacheRecord | undefined
) {
  if (!record) return undefined;

  return {
    ...(record as QueryCacheRecord<TData>),
    isStale:
      record.invalidated ||
      isEntryStaleByTime(record.updatedAt, record.staleTime),
  };
}

export function isEntryStaleByTime(updatedAt: number, staleTime = 0) {
  const stale = Number(staleTime || 0);
  if (stale === Infinity) return false;
  return now() - Number(updatedAt || 0) >= stale;
}

export function isCacheRecord(value: unknown): value is QueryCacheRecord {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.prototype.hasOwnProperty.call(value, 'data') &&
    typeof (value as QueryCacheRecord).updatedAt === 'number' &&
    typeof (value as QueryCacheRecord).staleTime === 'number'
  );
}

export function writeCache(
  cache: QueryCacheAdapter,
  key: string,
  record: QueryCacheRecord,
  options: QueryCacheSetOptions
) {
  return Promise.resolve(cache.set(key, record, options));
}

export function writeCacheInBackground(
  cache: QueryCacheAdapter,
  key: string,
  record: QueryCacheRecord,
  options: QueryCacheSetOptions,
  onError: (error: unknown) => void
) {
  void writeCache(cache, key, record, options).catch(onError);
}

function createStorageOptions(config: StorageCacheConfig) {
  const {
    adapters,
    clock,
    codec,
    codecs,
    driverOptions,
    fallback = false,
    keySeparator,
    max,
    maxAge,
    maxSize,
    namespace = DEFAULT_STORAGE_NAMESPACE,
    onError,
    onDriverError,
    ttl,
    ...implicitDriverOptions
  } = config.options as Record<string, unknown>;

  void max;
  void maxAge;
  void maxSize;
  void onError;
  void ttl;

  return {
    adapters,
    clock,
    codec,
    codecs,
    driver: config.adapter,
    driverOptions: {
      ...implicitDriverOptions,
      ...toRecord(driverOptions),
    },
    fallback,
    keySeparator,
    namespace,
    onDriverError,
    ttl: normalizePositiveNumber(config.ttl, DEFAULT_CACHE_TIME),
  };
}

function toRecord(value: unknown) {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeStorageCacheConfig(
  config: NormalizedCacheConfig
): StorageCacheConfig {
  if (
    config.adapter === 'cookie' ||
    config.adapter === 'indexedDB' ||
    config.adapter === 'localStorage'
  ) {
    return config as StorageCacheConfig;
  }

  throw new TypeError('StorageQueryCacheAdapter requires a storage adapter');
}
