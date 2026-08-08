import type { PaymentReceipt } from "#/lib/payment";

export type TerminalOutcome = "approved" | "declined" | "unavailable";
export type TerminalOptions = {
  delayMs?: number;
  expectedAmountCents: number;
  outcome?: TerminalOutcome;
};

const configuredDelayMs = (): number => {
  const value = Number(
    (import.meta as ImportMeta & { env?: { VITE_TERMINAL_DELAY_MS?: string } }).env
      ?.VITE_TERMINAL_DELAY_MS ?? 350,
  );
  return Number.isFinite(value) ? value : 350;
};

export const executeTerminalCommand = async (
  command: string,
  options: TerminalOptions,
): Promise<PaymentReceipt> => {
  const requestedDelay = options.delayMs ?? configuredDelayMs();
  const delayMs = Math.max(0, Number.isFinite(requestedDelay) ? requestedDelay : 0);
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  return {
    terminalCommand: command,
    reference: `sim-reference-${crypto.randomUUID()}`,
    amountCents: options.expectedAmountCents,
    outcome: options.outcome ?? "approved",
  };
};
