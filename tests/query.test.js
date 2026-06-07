import { createSignal } from 'vanilla-signal';
import { describe, expect, it, vi } from 'vite-plus/test';

import {
  createQuery,
  createQueryClient,
  hashQueryKey,
  stableHash,
} from '../src/query.js';

const delay = (milliseconds) =>
  new Promise((resolve) => {
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
      queryFn: async ({ queryKey }) => ({ id: queryKey[0] }),
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
    expect(query.state.error.name).toBe('BusinessError');
    expect(query.state.error.code).toBe('NO_ACCESS');

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
        await delay(5);
        return `page-${queryKey[1]}`;
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

  it('mutates local state and cache', async () => {
    const client = createQueryClient();
    const query = createQuery({
      client,
      queryKey: ['todos'],
      enabled: false,
      staleTime: 1000,
      initialData: [],
      queryFn: async () => [],
    });

    query.mutate((todos) => [...todos, { id: 1, text: 'write tests' }]);

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
    expect(client.getQueryEntry(['todos', 1]).isStale).toBe(true);
    expect(client.getQueryEntry(['todos', 2]).isStale).toBe(true);
  });

  it('aborts the current request and ignores the old result', async () => {
    const client = createQueryClient();
    let signal;

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

    expect(signal.aborted).toBe(true);
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
    expect(query.state.error.name).toBe('TimeoutError');

    query.destroy();
  });
});
