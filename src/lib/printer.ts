import type { PaymentReceipt } from "#/lib/payment";

export const printedReceipts: PaymentReceipt[] = [];

export const printReceipt = async (receipt: PaymentReceipt): Promise<void> => {
  printedReceipts.push(receipt);
};
