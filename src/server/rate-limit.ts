/**
 * Minimal in-memory fixed-window rate limiter. Good enough to stop casual
 * brute-force/enumeration (login, signup, instructor passcode, join-code
 * guessing) on the single-instance deploy this app actually runs on — not a
 * substitute for a distributed limiter at real multi-instance scale.
 */
import "server-only";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Returns true if this call is allowed, false if the key has hit its limit within the current window. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}
