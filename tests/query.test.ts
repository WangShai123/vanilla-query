import { createRoot, createSignal } from 'vanilla-signal';
import { describe, expect, it, vi } from 'vite-plus/test';

import {
  createQuery,
  createQueryClient,
  hashQueryKey,
  stableHash,
} from '../src/index.ts';
import type {
  CacheErrorContext,
  QueryCacheOptions,
  QueryClientEvent,
} from '../src/index.ts';

interface Todo {
  id: number;
  text: string;
}

interface CodedError extends Error {
  code?: unknown;
}

type QueryCacheErrorEvent = Extract<QueryClientEvent, { type: 'cache-error' }>;

type MemoryWebStorageOverrides = Partial<Storage>;

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const tick = () => delay(0);

describe('stableHash', () => {
  it('creates stable keys for object query keys', () => {
    expect(stableHash(['users', { page: 1, q: 'a' }])).toBe(
      stableHash(['users', { q: 'a', page: 1 }])
    );
    expect(hashQueryKey(['users', 1])).not.toBe(hashQueryKey(['users', 2]));
  });
});

describe('createQuery', () => {
  it('runs automatically and exposes query state', async () => {
    const client = createQueryClient();
    const query = createQuery({
      client,
      queryKey: ['profile'],
      queryFn: async ({ queryKey }) => {
        const [id] = queryKey as [string];
        return { id };
      },
    });

    expect(query.state.isFetching).toBe(true);

    await query.promise();

    expect(query()).toEqual({ id: 'profile' });
    expect(query.state.status).toBe('success');
    expect(query.state.isSuccess).toBe(true);
    expect(query.state.isFetching).toBe(false);

    query.destroy();
  });

  it('uses fresh cached data without calling the fetcher again', async () => {
    const client = createQueryClient();
    const queryFn = vi.fn(async () => 'cached');

    const first = createQuery({
      client,
      queryKey: ['settings'],
      staleTime: 1000,
      queryFn,
    });
    await first.promise();
    first.destroy();

    const second = createQuery({
      client,
      queryKey: ['settings'],
      staleTime: 1000,
      queryFn,
    });
    await tick();

    expect(second()).toBe('cached');
    expect(queryFn).toHaveBeenCalledTimes(1);

    second.destroy();
  });

  it('dedupes concurrent requests by query key', async () => {
    const client = createQueryClient();
    const queryFn = vi.fn(async () => {
      await delay(10);
      return 'shared';
    });

    const first = createQuery({
      client,
      queryKey: ['products'],
      staleTime: 1000,
      queryFn,
    });
    const second = createQuery({
      client,
      queryKey: ['products'],
      staleTime: 1000,
      queryFn,
    });

    await Promise.all([first.promise(), second.promise()]);

    expect(first()).toBe('shared');
    expect(second()).toBe('shared');
    expect(queryFn).toHaveBeenCalledTimes(1);

    first.destroy();
    second.destroy();
  });

  it('retries retryable failures', async () => {
    const client = createQueryClient();
    let calls = 0;

    const query = createQuery({
      client,
      queryKey: ['retry'],
      retry: 2,
      retryDelay: 0,
      queryFn: async () => {
        calls += 1;
        if (calls < 3) throw new Error('temporary');
        return 'ok';
      },
    });

    await query.promise();

    expect(query()).toBe('ok');
    expect(calls).toBe(3);
    expect(query.state.failureCount).toBe(0);

    query.destroy();
  });

  it('stores business errors from normalized responses', async () => {
    const client = createQueryClient();

    const query = createQuery({
      client,
      queryKey: ['biz-error'],
      queryFn: async () => ({
        success: false,
        code: 'NO_ACCESS',
        message: 'No access',
      }),
    });

    await expect(query.promise()).rejects.toThrow('No access');
    expect(query.state.status).toBe('error');
    expect((query.state.error as CodedError).name).toBe('BusinessError');
    expect((query.state.error as CodedError).code).toBe('NO_ACCESS');

    query.destroy();
  });

  it('keeps previous data while a reactive key is refetching', async () => {
    const client = createQueryClient();
    const [page, setPage] = createSignal(1);

    const query = createQuery({
      client,
      queryKey: () => ['page', page()],
      keepPreviousData: true,
      staleTime: 1000,
      queryFn: async ({ queryKey }) => {
        const [, currentPage] = queryKey as [string, number];
        await delay(5);
        return `page-${currentPage}`;
      },
    });

    await query.promise();
    expect(query()).toBe('page-1');

    setPage(2);
    await tick();

    expect(query()).toBe('page-1');
    expect(query.state.isStale).toBe(true);

    await query.promise();

    expect(query()).toBe('page-2');
    expect(query.state.isStale).toBe(false);

    query.destroy();
  });

  it('types tuple query keys and selected data', async () => {
    const client = createQueryClient();
    const [userId] = createSignal(7);
    const query = createQuery<
      number,
      { value: number },
      ['typed-user', number]
    >({
      client,
      queryKey: () => ['typed-user', userId()],
      queryFn: async ({ queryKey }) => ({
        value: queryKey[1] * 2,
      }),
      select: (response) => response.value,
    });

    await query.promise();

    expect(query.queryKey()).toEqual(['typed-user', 7]);
    expect(query()).toBe(14);

    query.destroy();
  });

  it('destroys queries with the current vanilla-signal owner', async () => {
    const client = createQueryClient();
    let query: ReturnType<typeof createQuery<string>> | undefined;

    const dispose = createRoot((currentDispose) => {
      query = createQuery({
        client,
        queryKey: ['owner-cleanup'],
        queryFn: async () => 'owned',
      });

      return currentDispose;
    });

    await query?.promise();
    expect(query?.state.status).toBe('success');

    dispose();

    expect(query?.promise()).toBeNull();
    expect(query?.state.isFetching).toBe(false);
  });

  it('mutates local state and cache', async () => {
    const client = createQueryClient();
    const query = createQuery<Todo[]>({
      client,
      queryKey: ['todos'],
      enabled: false,
      staleTime: 1000,
      initialData: [],
      queryFn: async () => [],
    });

    query.mutate((todos) => [...(todos ?? []), { id: 1, text: 'write tests' }]);

    expect(query()).toEqual([{ id: 1, text: 'write tests' }]);
    expect(client.getQueryData(['todos'])).toEqual([
      { id: 1, text: 'write tests' },
    ]);

    query.destroy();
  });

  it('invalidates cache entries by query-key prefix', async () => {
    const client = createQueryClient();
    await client.prefetchQuery({
      queryKey: ['todos', 1],
      queryFn: async () => ['a'],
      staleTime: 1000,
    });
    await client.prefetchQuery({
      queryKey: ['todos', 2],
      queryFn: async () => ['b'],
      staleTime: 1000,
    });

    expect(client.invalidateQueries(['todos'])).toBe(2);
    expect(client.getQueryEntry(['todos', 1])?.isStale).toBe(true);
    expect(client.getQueryEntry(['todos', 2])?.isStale).toBe(true);
  });

  it('aborts the current request and ignores the old result', async () => {
    const client = createQueryClient();
    let signal: AbortSignal | undefined;

    const query = createQuery({
      client,
      queryKey: ['abort'],
      queryFn: ({ signal: currentSignal }) => {
        signal = currentSignal;
        return new Promise((resolve) => {
          setTimeout(() => resolve('late'), 20);
        });
      },
    });

    await tick();
    query.abort();

    expect(signal?.aborted).toBe(true);
    expect(query.state.isFetching).toBe(false);

    await delay(30);

    expect(query()).toBeUndefined();
    expect(query.state.status).toBe('pending');

    query.destroy();
  });

  it('times out slow requests', async () => {
    const client = createQueryClient();
    const query = createQuery({
      client,
      queryKey: ['timeout'],
      timeout: 5,
      queryFn: async () => {
        await delay(20);
        return 'slow';
      },
    });

    await expect(query.promise()).rejects.toThrow('Query timed out');
    expect((query.state.error as Error).name).toBe('TimeoutError');

    query.destroy();
  });

  it('uses memory cache options for LRU eviction', async () => {
    const client = createQueryClient({
      cache: {
        adapter: 'memory',
        options: {
          maxSize: 1,
          ttl: 1000,
        },
      },
    });

    await client.prefetchQuery({
      queryKey: ['cache', 1],
      queryFn: async () => 'first',
      staleTime: 1000,
    });
    await client.prefetchQuery({
      queryKey: ['cache', 2],
      queryFn: async () => 'second',
      staleTime: 1000,
    });

    expect(client.getQueryData(['cache', 1])).toBeUndefined();
    expect(client.getQueryData(['cache', 2])).toBe('second');
  });

  it('persists fresh query data through localStorage adapter', async () => {
    const storage = createMemoryWebStorage();
    const cache: QueryCacheOptions = {
      adapter: 'localStorage',
      options: {
        namespace: 'query-test',
        storage,
        ttl: 1000,
      },
    };

    const firstClient = createQueryClient({ cache });
    await firstClient.prefetchQuery({
      queryKey: ['persisted'],
      queryFn: async () => 'stored',
      staleTime: 1000,
    });

    const secondClient = createQueryClient({ cache });
    const queryFn = vi.fn(async () => 'network');
    const data = await secondClient.prefetchQuery({
      queryKey: ['persisted'],
      queryFn,
      staleTime: 1000,
    });

    expect(data).toBe('stored');
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('inherits cache adapter options from the query client', async () => {
    const storage = createMemoryWebStorage();
    const cache: QueryCacheOptions = {
      adapter: 'localStorage',
      options: {
        namespace: 'query-client-inherit',
        storage,
        ttl: 1000,
      },
    };

    const firstClient = createQueryClient({ cache });
    const first = createQuery({
      client: firstClient,
      queryKey: ['inherit'],
      staleTime: 1000,
      queryFn: async () => 'from-client',
    });
    await first.promise();
    first.destroy();

    const secondClient = createQueryClient({ cache });
    const queryFn = vi.fn(async () => 'network');
    const second = createQuery({
      client: secondClient,
      queryKey: ['inherit'],
      staleTime: 1000,
      queryFn,
    });
    await tick();

    expect(second()).toBe('from-client');
    expect(queryFn).not.toHaveBeenCalled();

    second.destroy();
  });

  it('lets query cache true use the default memory adapter', async () => {
    const storage = createMemoryWebStorage();
    const cache: QueryCacheOptions = {
      adapter: 'localStorage',
      options: {
        namespace: 'query-cache-override',
        storage,
        ttl: 1000,
      },
    };
    const firstClient = createQueryClient({ cache });

    await firstClient.prefetchQuery({
      queryKey: ['override'],
      cache: true,
      queryFn: async () => 'memory-only',
      staleTime: 1000,
    });

    const secondClient = createQueryClient({ cache });
    const queryFn = vi.fn(async () => 'network');
    const data = await secondClient.prefetchQuery({
      queryKey: ['override'],
      queryFn,
      staleTime: 1000,
    });

    expect(data).toBe('network');
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('expires localStorage adapter records by cache options ttl', async () => {
    const storage = createMemoryWebStorage();
    const cache: QueryCacheOptions = {
      adapter: 'localStorage',
      options: {
        namespace: 'query-ttl-test',
        storage,
        ttl: 5,
      },
    };

    const firstClient = createQueryClient({ cache });
    await firstClient.prefetchQuery({
      queryKey: ['ttl'],
      queryFn: async () => 'old',
      staleTime: 1000,
    });

    await delay(10);

    const secondClient = createQueryClient({ cache });
    const queryFn = vi.fn(async () => 'new');
    const data = await secondClient.prefetchQuery({
      queryKey: ['ttl'],
      queryFn,
      staleTime: 1000,
    });

    expect(data).toBe('new');
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('persists fresh query data through cookie adapter', async () => {
    const document = createMemoryCookieDocument();
    const cache: QueryCacheOptions = {
      adapter: 'cookie',
      options: {
        document,
        namespace: 'query-cookie-test',
        ttl: 1000,
      },
    };

    const firstClient = createQueryClient({ cache });
    await firstClient.prefetchQuery({
      queryKey: ['cookie'],
      queryFn: async () => 'cookie-data',
      staleTime: 1000,
    });

    const secondClient = createQueryClient({ cache });
    const queryFn = vi.fn(async () => 'network');
    const data = await secondClient.prefetchQuery({
      queryKey: ['cookie'],
      queryFn,
      staleTime: 1000,
    });

    expect(data).toBe('cookie-data');
    expect(queryFn).not.toHaveBeenCalled();
    expect(document.cookie).toContain('query-cookie-test');
  });

  it('emits cache-error events when persistent cache writes fail', async () => {
    const error = new Error('storage denied');
    const baseStorage = createMemoryWebStorage();
    const storage = createMemoryWebStorage({
      getItem: (key) => baseStorage.getItem(key),
      key: (index) => baseStorage.key(index),
      removeItem: (key) => baseStorage.removeItem(key),
      setItem(key, value) {
        if (key.includes('__vanilla_storage_test__')) {
          baseStorage.setItem(key, value);
          return;
        }

        throw error;
      },
    });
    const cacheErrors: QueryCacheErrorEvent[] = [];
    const optionErrors: Array<[unknown, CacheErrorContext]> = [];
    const client = createQueryClient({
      cache: {
        adapter: 'localStorage',
        options: {
          namespace: 'query-error-test',
          onError(currentError: unknown, context: CacheErrorContext) {
            optionErrors.push([currentError, context]);
          },
          storage,
          ttl: 1000,
        },
      },
    });

    client.subscribe((event) => {
      if (event.type === 'cache-error') {
        expect(event.error).toBeDefined();
        cacheErrors.push(event);
      }
    });

    const data = await client.prefetchQuery({
      queryKey: ['cache-error'],
      queryFn: async () => 'ok',
      staleTime: 1000,
    });

    expect(data).toBe('ok');
    expect(cacheErrors).toHaveLength(1);
    expect((cacheErrors[0].error as Error).message).toBe(error.message);
    expect(optionErrors).toHaveLength(1);
    expect(optionErrors[0][0]).toBe(cacheErrors[0].error);
    expect(optionErrors[0][1].operation).toBe('set');
  });
});

function createMemoryCookieDocument(): Document {
  const store = new Map<string, string>();

  return {
    get cookie() {
      return Array.from(store, ([key, value]) => `${key}=${value}`).join('; ');
    },
    set cookie(value: string) {
      const [pair, ...attributes] = value.split(';').map((item) => item.trim());
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex < 0) return;

      const key = pair.slice(0, separatorIndex);
      const cookieValue = pair.slice(separatorIndex + 1);
      const expired = attributes.some((attribute) => {
        const [name, attributeValue] = attribute.split('=');
        return name.toLowerCase() === 'max-age' && Number(attributeValue) <= 0;
      });

      if (expired) {
        store.delete(key);
        return;
      }

      store.set(key, cookieValue);
    },
  } as Document;
}

function createMemoryWebStorage(
  overrides: MemoryWebStorageOverrides = {}
): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    ...overrides,
  };
}
