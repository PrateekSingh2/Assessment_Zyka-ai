// Enterprise-grade Sliding Window Rate Limiter (In-Memory for Demo / Redis-ready)
interface WindowStore {
  [key: string]: number[];
}

const windowStore: WindowStore = {};

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  currentCount: number;
}

export function checkSlidingWindowRateLimit(
  key: string,
  limit: number = 5,
  windowMs: number = 60000
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  if (!windowStore[key]) {
    windowStore[key] = [];
  }

  // Filter timestamps outside current sliding window
  windowStore[key] = windowStore[key].filter((timestamp) => timestamp > windowStart);

  const currentCount = windowStore[key].length;

  if (currentCount >= limit) {
    // Oldest timestamp in current window determines when a slot clears
    const oldestTimestamp = windowStore[key][0] || now;
    const resetSeconds = Math.max(1, Math.ceil((oldestTimestamp + windowMs - now) / 1000));

    return {
      success: false,
      limit,
      remaining: 0,
      resetSeconds,
      currentCount,
    };
  }

  // Append current request timestamp
  windowStore[key].push(now);

  const oldestTimestamp = windowStore[key][0];
  const resetSeconds = Math.max(1, Math.ceil((oldestTimestamp + windowMs - now) / 1000));

  return {
    success: true,
    limit,
    remaining: limit - windowStore[key].length,
    resetSeconds,
    currentCount: windowStore[key].length,
  };
}
