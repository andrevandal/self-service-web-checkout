import type { PaymentMethod, PaymentReceipt } from "#/lib/payment.functions";

export type TerminalOutcome = "approved" | "declined" | "unavailable";
export type TerminalOptions = {
  delayMs?: number;
  expectedAmountCents: number;
  method: PaymentMethod;
  outcome?: TerminalOutcome;
};

const configuredDelayMs = (): number => {
  const value = Number(
    (import.meta as ImportMeta & { env?: { VITE_TERMINAL_DELAY_MS?: string } }).env
      ?.VITE_TERMINAL_DELAY_MS ?? 350,
  );
  return Number.isFinite(value) ? value : 350;
};

// Every payment method is executed through this single function - one
// physical pinpad handling multiple differentiated payment method tokens
// (see PAYMENT_METHOD_TOKENS in #/lib/payment.functions.server).
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
    method: options.method,
    outcome: options.outcome ?? "approved",
  };
};
