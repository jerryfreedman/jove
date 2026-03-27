// In-memory context cache for deal context assembly.
// Lives at module level — persists across requests within a warm
// serverless function instance. TTL: 60 seconds.
// This is best-effort caching — a cold start will miss the cache.
// Never cache sensitive data — only assembled context strings.

interface CacheEntry {
  value:     string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCached(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCached(key: string, value: string, ttlMs = 60000): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidateCache(prefix: string): void {
  const keysToDelete: string[] = [];
  cache.forEach((_, key) => {
    if (key.startsWith(prefix)) keysToDelete.push(key);
  });
  keysToDelete.forEach(key => cache.delete(key));
}
