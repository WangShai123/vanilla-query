import type {
  CacheMatcher,
  QueryCacheRecord,
  QueryFilter,
  QueryKey,
} from './types.ts';

export function hashQueryKey(queryKey: QueryKey) {
  return stableHash(queryKey === undefined ? ['query'] : queryKey);
}

type HashSeen = WeakMap<object, number> & { sizeHint?: number };

export function stableHash(
  value: unknown,
  seen = new WeakMap<object, number>() as HashSeen
): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';

  const type = typeof value;
  if (type === 'number') return `number:${Number(value)}`;
  if (type === 'boolean') return `boolean:${value ? 'true' : 'false'}`;
  if (type === 'bigint') return `bigint:${(value as bigint).toString()}`;
  if (type === 'string') return `string:${JSON.stringify(value)}`;
  if (type === 'symbol')
    return `symbol:${String((value as symbol).description)}`;
  if (type === 'function')
    return `function:${(value as Function).name || 'anonymous'}`;
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (value instanceof RegExp) return `regexp:${String(value)}`;
  if (typeof value !== 'object') return `${type}:${JSON.stringify(value)}`;

  if (seen.has(value)) return `[Circular:${seen.get(value)}]`;
  const seenIndex = seen.sizeHint ?? 0;
  seen.set(value, seenIndex);
  seen.sizeHint = seenIndex + 1;

  if (Array.isArray(value)) {
    return `array:[${value.map((item) => stableHash(item, seen)).join(',')}]`;
  }

  if (value instanceof Map) {
    const entries = Array.from(value.entries()).map(([key, item]) => [
      stableHash(key, seen),
      stableHash(item, seen),
    ]);
    entries.sort(([left], [right]) =>
      left > right ? 1 : left < right ? -1 : 0
    );
    return `map:{${entries.map(([key, item]) => `${key}:${item}`).join(',')}}`;
  }

  if (value instanceof Set) {
    const entries = Array.from(value.values()).map((item) =>
      stableHash(item, seen)
    );
    entries.sort();
    return `set:{${entries.join(',')}}`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `object:{${keys
    .map((key) => `${JSON.stringify(key)}:${stableHash(record[key], seen)}`)
    .join(',')}}`;
}

export function createMatcher(filter?: QueryFilter): CacheMatcher {
  if (filter === undefined || filter === null) return () => true;
  if (typeof filter === 'function') return filter as CacheMatcher;
  if (typeof filter === 'string') {
    return (key) => key === filter || key.includes(filter);
  }

  const target = hashQueryKey(filter);
  return (key: string, record?: QueryCacheRecord) =>
    key === target ||
    key.includes(target) ||
    isQueryKeyPrefix(filter, record?.queryKey);
}

export function isQueryKeyPrefix(prefix: QueryKey, queryKey: QueryKey) {
  if (!Array.isArray(prefix) || !Array.isArray(queryKey)) {
    return Object.is(prefix, queryKey);
  }

  if (prefix.length > queryKey.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (stableHash(prefix[index]) !== stableHash(queryKey[index])) {
      return false;
    }
  }

  return true;
}

export function looksHashedKey(value: QueryKey): value is string {
  return (
    typeof value === 'string' &&
    (value.startsWith('array:') ||
      value.startsWith('object:') ||
      value.startsWith('string:') ||
      value.startsWith('number:') ||
      value.startsWith('boolean:') ||
      value.startsWith('undefined') ||
      value.startsWith('null'))
  );
}
