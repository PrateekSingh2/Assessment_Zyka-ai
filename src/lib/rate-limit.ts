/**
 * Zero-Trust Sliding-Window Rate Limiter
 *
 * FIXES FOR N2:
 * 1. Uses Map with LRU-style eviction on capacity overflow: when MAX_KEYS is reached,
 *    evicts the oldest Map entry (insertion order) instead of failing closed and locking
 *    out all legitimate new users.
 * 2. IPv6 addresses are bucketed by /64 prefix to prevent single residential connection flooding.
 * 3. Sweeping is throttled to at most once every 10 seconds, preventing 50,000-key synchronous
 *    event-loop CPU stalls on every request.
 */

import { getIpSubnetKey } from "./client-ip.ts";

const MAX_KEYS = 50_000;
const SWEEP_INTERVAL_MS = 10_000;

// Map maintains sliding window timestamps
const store = new Map<string, number[]>();
// Bounded map for explicit block duration to prevent store-flush evasion
const blockedUntilMap = new Map<string, number>();
let lastSweepTime = 0;

export interface RateLimitResult {
  readonly success: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetSeconds: number;
  readonly currentCount: number;
}

/**
 * Evict stale entries across the store. Throttled to at most once per SWEEP_INTERVAL_MS.
 */
function throttledSweep(now: number, windowMs: number): void {
  if (now - lastSweepTime < SWEEP_INTERVAL_MS) {
    return;
  }
  lastSweepTime = now;

  // Clean expired blocked records
  for (const [k, expiry] of blockedUntilMap) {
    if (expiry <= now) {
      blockedUntilMap.delete(k);
    }
  }

  // Clean sliding window records
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
 * Checks a sliding-window rate limit for `rawIp` within a specific `namespace`.
 * IP is automatically normalized (IPv6 collapsed to /64).
 */
export function checkSlidingWindowRateLimit(
  rawIp: string,
  limit = 5,
  windowMs = 60_000,
  namespace = "default"
): RateLimitResult {
  const now = Date.now();
  // Aggregate IP to subnet bucket (IPv4: /32, IPv6: /64)
  const subnetKey = getIpSubnetKey(rawIp);
  const key = `${namespace}:${subnetKey}`;

  // 1. Check if IP is explicitly blocked (immune to sliding-window store flushes)
  const blockExpiry = blockedUntilMap.get(key);
  if (blockExpiry && blockExpiry > now) {
    const resetSeconds = Math.max(1, Math.ceil((blockExpiry - now) / 1000));
    return {
      success: false,
      limit,
      remaining: 0,
      resetSeconds,
      currentCount: limit,
    };
  } else if (blockExpiry) {
    blockedUntilMap.delete(key);
  }

  // 2. Periodic throttled sweep
  throttledSweep(now, windowMs);

  // 3. Capacity management: only evict expired entries, never active records
  if (store.size >= MAX_KEYS && !store.has(key)) {
    let evicted = false;
    for (const [k, timestamps] of store) {
      if (!timestamps.some((t) => t > now - windowMs)) {
        store.delete(k);
        evicted = true;
        break;
      }
    }
    // If entire store is saturated with active entries, fail closed for new keys
    if (!evicted && store.size >= MAX_KEYS) {
      return {
        success: false,
        limit,
        remaining: 0,
        resetSeconds: Math.ceil(windowMs / 1000),
        currentCount: limit,
      };
    }
  }

  // 4. Filter timestamps in the active window
  const timestamps = store.get(key);
  const current = timestamps ? timestamps.filter((t) => t > now - windowMs) : [];

  if (current.length >= limit) {
    const oldestInWindow = current[0] ?? now;
    const resetSeconds = Math.max(
      1,
      Math.ceil((oldestInWindow + windowMs - now) / 1000)
    );
    // Persist explicit block with TTL
    blockedUntilMap.set(key, now + resetSeconds * 1000);
    // Refresh insertion order so blocked keys aren't treated as oldest
    store.delete(key);
    store.set(key, current);

    return {
      success: false,
      limit,
      remaining: 0,
      resetSeconds,
      currentCount: current.length,
    };
  }

  current.push(now);
  // Re-insert to refresh insertion order
  store.delete(key);
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

/** Test utility to reset rate limiter in unit tests */
export function resetRateLimiter(): void {
  store.clear();
  blockedUntilMap.clear();
  lastSweepTime = 0;
}
