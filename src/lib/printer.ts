import type { PaymentReceipt } from "#/lib/payment.functions";

export const printedReceipts: PaymentReceipt[] = [];

export const printReceipt = async (receipt: PaymentReceipt): Promise<void> => {
  printedReceipts.push(receipt);
};
