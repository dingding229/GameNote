const attemptWindowMs = 15 * 60 * 1000;
const maximumAttempts = 8;
type Attempt = { count: number; resetAt: number };

const globalAttempts = globalThis as typeof globalThis & {
  gamenoteLoginAttempts?: Map<string, Attempt>;
};
const attempts = (globalAttempts.gamenoteLoginAttempts ??= new Map());

export function loginRateLimitKey(ip: string, username: string) {
  return `${ip || "unknown"}:${username.toLowerCase()}`;
}

export function checkLoginRateLimit(key: string) {
  pruneExpiredAttempts();
  const attempt = attempts.get(key);
  if (!attempt || attempt.resetAt <= Date.now()) return { allowed: true, retryAfter: 0 };
  return attempt.count < maximumAttempts
    ? { allowed: true, retryAfter: 0 }
    : { allowed: false, retryAfter: Math.ceil((attempt.resetAt - Date.now()) / 1000) };
}

export function recordFailedLogin(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  attempts.set(
    key,
    current && current.resetAt > now
      ? { ...current, count: current.count + 1 }
      : { count: 1, resetAt: now + attemptWindowMs },
  );
}

export function clearFailedLogins(key: string) {
  attempts.delete(key);
}

function pruneExpiredAttempts() {
  if (attempts.size < 1_000) return;
  const now = Date.now();
  for (const [key, attempt] of attempts) {
    if (attempt.resetAt <= now) attempts.delete(key);
  }
}
