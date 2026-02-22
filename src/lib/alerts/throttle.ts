/**
 * In-memory alert throttle.
 *
 * Intentionally NOT server-only so it can be imported by both server actions
 * and (future) background job runners. The Map lives for the lifetime of the
 * Node.js process — suitable for a single-instance deployment or serverless
 * functions with moderate concurrency.
 *
 * For multi-instance / edge deployments replace the Map with a Redis-backed
 * store while keeping the same canSend / markSent interface.
 */

export const HIGH_RISK_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

// Map<throttleKey, lastSentTimestamp>
const sentAt = new Map<string, number>();

/**
 * Returns true if enough time has passed since the key was last marked as sent.
 *
 * @param key        Unique throttle key, e.g. `"high-risk:userId"`.
 * @param cooldownMs Minimum milliseconds that must elapse before returning true again.
 *                   Defaults to {@link HIGH_RISK_COOLDOWN_MS} (6 hours).
 */
export function canSend(
  key: string,
  cooldownMs: number = HIGH_RISK_COOLDOWN_MS
): boolean {
  const last = sentAt.get(key);
  if (last === undefined) return true;
  return Date.now() - last >= cooldownMs;
}

/**
 * Records the current timestamp for the given key.
 * Call this immediately after successfully dispatching an alert.
 *
 * @param key Unique throttle key, must match the key passed to {@link canSend}.
 */
export function markSent(key: string): void {
  sentAt.set(key, Date.now());
}

/**
 * Clears the throttle record for a key.
 * Useful in tests or when an alert is manually dismissed.
 */
export function clearThrottle(key: string): void {
  sentAt.delete(key);
}
