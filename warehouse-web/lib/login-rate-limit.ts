import { ApiError } from "@/lib/api-response";

const failureWindowMs = 10 * 60 * 1000;
const lockDurationMs = 15 * 60 * 1000;
const maximumFailures = 5;

type FailureState = {
  failures: number;
  firstFailureAt: number;
  lockedUntil?: number;
};

const states = new Map<string, FailureState>();

export function assertLoginAllowed(key: string) {
  cleanupExpiredStates();
  const state = states.get(key);
  if (state?.lockedUntil && state.lockedUntil > Date.now()) {
    throw new ApiError("登录尝试过于频繁，请 15 分钟后再试", 429);
  }
}

export function recordLoginFailure(key: string) {
  const now = Date.now();
  const previous = states.get(key);
  const state = !previous || now - previous.firstFailureAt > failureWindowMs
    ? { failures: 1, firstFailureAt: now }
    : { ...previous, failures: previous.failures + 1 };

  if (state.failures >= maximumFailures) {
    state.lockedUntil = now + lockDurationMs;
  }
  states.set(key, state);
}

export function clearLoginFailures(key: string) {
  states.delete(key);
}

export function loginAttemptKey(request: Request, username: string) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  return `${ip}:${username.trim().toLowerCase()}`;
}

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [key, state] of states) {
    const expiredLock = !state.lockedUntil || state.lockedUntil <= now;
    if (expiredLock && now - state.firstFailureAt > failureWindowMs) states.delete(key);
  }
}
