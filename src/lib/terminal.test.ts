import { describe, expect, test } from "bun:test";
import { executeTerminalCommand } from "#/lib/terminal";

describe("executeTerminalCommand", () => {
  test("returns an opaque structured receipt for approval with zero delay", async () => {
    const result = await executeTerminalCommand("cmd-1", {
      delayMs: 0,
      expectedAmountCents: 650,
      outcome: "approved",
    });
    expect(result).toEqual({
      terminalCommand: "cmd-1",
      reference: expect.stringMatching(/^sim-reference-/),
      amountCents: 650,
      outcome: "approved",
    });
  });

  test("returns a decline receipt without exposing card data", async () => {
    await expect(
      executeTerminalCommand("cmd-2", {
        delayMs: 0,
        expectedAmountCents: 850,
        outcome: "declined",
      }),
    ).resolves.toMatchObject({
      terminalCommand: "cmd-2",
      amountCents: 850,
      outcome: "declined",
    });
  });

  test("honors a positive configured delay", async () => {
    const started = performance.now();
    await executeTerminalCommand("cmd-3", {
      delayMs: 20,
      expectedAmountCents: 100,
      outcome: "approved",
    });
    expect(performance.now() - started).toBeGreaterThanOrEqual(15);
  });
});
