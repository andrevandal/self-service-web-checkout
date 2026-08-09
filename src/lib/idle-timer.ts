export type IdleTimerConfig = {
  idleTimeoutMs: number;
  countdownSeconds: number;
};

export type IdleTimerState =
  | { phase: "inactive" }
  | { phase: "idle"; startedAt: number }
  | { phase: "warning"; startedAt: number; secondsRemaining: number }
  | { phase: "expired"; startedAt: number; expiredAt: number };

export type IdleTimerEvent =
  | { type: "idle_timeout"; now: number }
  | { type: "countdown_tick"; now: number }
  | { type: "interaction"; now: number }
  | { type: "deactivate"; now: number };

export const initialIdleTimerState = (
  active: boolean,
  now: number,
  config: IdleTimerConfig,
): IdleTimerState =>
  active && config.idleTimeoutMs >= 0 && config.countdownSeconds > 0
    ? { phase: "idle", startedAt: now }
    : { phase: "inactive" };

export const transitionIdleTimer = (
  state: IdleTimerState,
  event: IdleTimerEvent,
  config: IdleTimerConfig,
): IdleTimerState => {
  if (event.type === "deactivate") {
    return { phase: "inactive" };
  }

  if (event.type === "interaction") {
    return { phase: "idle", startedAt: event.now };
  }

  if (state.phase === "idle" && event.type === "idle_timeout") {
    return {
      phase: "warning",
      startedAt: state.startedAt,
      secondsRemaining: config.countdownSeconds,
    };
  }

  if (state.phase === "warning" && event.type === "countdown_tick") {
    if (state.secondsRemaining <= 1) {
      return {
        phase: "expired",
        startedAt: state.startedAt,
        expiredAt: event.now,
      };
    }
    return {
      ...state,
      secondsRemaining: state.secondsRemaining - 1,
    };
  }

  return state;
};
