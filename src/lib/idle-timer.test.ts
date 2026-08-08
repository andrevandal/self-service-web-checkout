import { describe, expect, test } from "bun:test";
import { initialIdleTimerState, transitionIdleTimer, type IdleTimerConfig } from "#/lib/idle-timer";

const config: IdleTimerConfig = { idleTimeoutMs: 100, countdownSeconds: 3 };

describe("idle timer state machine", () => {
  test("does not start when cart is inactive", () => {
    expect(initialIdleTimerState(false, 0, config)).toEqual({ phase: "inactive" });
  });

  test("moves active cart from idle to warning after threshold", () => {
    const idle = initialIdleTimerState(true, 0, config);
    expect(transitionIdleTimer(idle, { type: "idle_timeout", now: 100 }, config)).toEqual({
      phase: "warning",
      startedAt: 0,
      secondsRemaining: 3,
    });
  });

  test("interaction resets warning to a fresh idle period", () => {
    const warning = { phase: "warning" as const, startedAt: 100, secondsRemaining: 2 };
    expect(transitionIdleTimer(warning, { type: "interaction", now: 150 }, config)).toEqual({
      phase: "idle",
      startedAt: 150,
    });
  });

  test("countdown expires exactly at zero", () => {
    const warning = { phase: "warning" as const, startedAt: 100, secondsRemaining: 1 };
    expect(transitionIdleTimer(warning, { type: "countdown_tick", now: 1_100 }, config)).toEqual({
      phase: "expired",
      startedAt: 100,
      expiredAt: 1_100,
    });
  });

  test("deactivation always returns to inactive", () => {
    const warning = { phase: "warning" as const, startedAt: 100, secondsRemaining: 2 };
    expect(transitionIdleTimer(warning, { type: "deactivate", now: 150 }, config)).toEqual({
      phase: "inactive",
    });
  });
});
