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

/**
 * Invalidate all cached context for a specific user.
 * Call after any write that affects LLM context:
 * interaction, task, item, person, signal, deal update.
 */
export function invalidateUserCache(userId: string): void {
  const keysToDelete: string[] = [];
  cache.forEach((_, key) => {
    if (key.includes(userId)) keysToDelete.push(key);
  });
  keysToDelete.forEach(key => cache.delete(key));
}

/**
 * Invalidate cached context for a specific deal.
 * Call after any write affecting deal state:
 * interaction created, signal created, deal updated.
 */
export function invalidateDealCache(dealId: string): void {
  invalidateCache(`chat_context_${dealId}`);
}
