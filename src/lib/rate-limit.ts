/**
 * Zero-Trust Sliding-Window Rate Limiter
 *
 * SECURITY FIXES over original:
 * 1. Uses Map instead of plain `{}` — eliminates __proto__ / constructor /
 *    toString prototype pollution crashes (TypeError: windowStore[key].filter
 *    is not a function).
 * 2. Bounded at MAX_KEYS entries with a sweep on overflow — prevents OOM from
 *    attacker rotating spoofed IPs (500k keys ≈ 146 MB in original).
 * 3. Returns readonly result to prevent accidental mutation by callers.
 * 4. Sets Retry-After semantics via resetSeconds on the result.
 *
 * For multi-instance / production use replace with Redis + sliding-window Lua.
 */

const MAX_KEYS = 50_000;

// Map has no prototype keys — safe to key on attacker-controlled strings
const store = new Map<string, number[]>();

export interface RateLimitResult {
  readonly success: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetSeconds: number;
  readonly currentCount: number;
}

/**
 * Evict stale entries to reclaim memory.
 * Called only when store.size >= MAX_KEYS.
 */
function sweep(now: number, windowMs: number): void {
  for (const [k, timestamps] of store) {
    const fresh = timestamps.filter((t) => t > now - windowMs);
    if (fresh.length === 0) {
      store.delete(k);
    } else {
      store.set(k, fresh);
    }
  }
}

/**
 * Checks a sliding-window rate limit for `key`.
 *
 * @param key     Opaque rate-limit bucket identifier (e.g. resolved client IP)
 * @param limit   Maximum requests allowed in `windowMs`
 * @param windowMs Window duration in milliseconds (default 60 s)
 */
export function checkSlidingWindowRateLimit(
  key: string,
  limit = 5,
  windowMs = 60_000
): RateLimitResult {
  const now = Date.now();

  // Bounded capacity guard — sweep before admitting new keys
  if (store.size >= MAX_KEYS && !store.has(key)) {
    sweep(now, windowMs);
    // Still at capacity after sweep — fail closed on unknown keys
    if (store.size >= MAX_KEYS) {
      return {
        success: false,
        limit,
        remaining: 0,
        resetSeconds: Math.ceil(windowMs / 1000),
        currentCount: limit,
      };
    }
  }

  // Filter out timestamps outside the current window
  const current = (store.get(key) ?? []).filter((t) => t > now - windowMs);

  if (current.length >= limit) {
    store.set(key, current);
    const oldestInWindow = current[0] ?? now;
    const resetSeconds = Math.max(
      1,
      Math.ceil((oldestInWindow + windowMs - now) / 1000)
    );
    return {
      success: false,
      limit,
      remaining: 0,
      resetSeconds,
      currentCount: current.length,
    };
  }

  current.push(now);
  store.set(key, current);

  const oldestInWindow = current[0] ?? now;
  const resetSeconds = Math.max(
    1,
    Math.ceil((oldestInWindow + windowMs - now) / 1000)
  );

  return {
    success: true,
    limit,
    remaining: limit - current.length,
    resetSeconds,
    currentCount: current.length,
  };
}
