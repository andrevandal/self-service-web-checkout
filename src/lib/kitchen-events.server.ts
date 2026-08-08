export type KitchenOrderItem = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  variants: Array<{
    id: string;
    optionId: string;
    optionName: string;
    priceDeltaCents: number;
  }>;
  addons: Array<{
    id: string;
    addonId: string;
    addonName: string;
    priceDeltaCents: number;
  }>;
};

export type KitchenOrder = {
  id: string;
  orderNumber: string;
  status: "paid" | "preparing";
  subtotalCents: number;
  totalAmountCents: number;
  createdAt: string;
  paidAt: string;
  items: KitchenOrderItem[];
};

export type OrderStatusEvent = {
  type: "order.preparing" | "order.done";
  orderId: string;
  orderNumber: string;
  status: "preparing" | "done";
};

export type KitchenOrderEvent =
  | {
      type: "order.paid";
      orderId: string;
      orderNumber: string;
      status: "paid";
      order: KitchenOrder;
    }
  | OrderStatusEvent;

type KitchenEventListener = (event: KitchenOrderEvent) => void;

export class KitchenEventDispatcher {
  private readonly listeners = new Set<KitchenEventListener>();

  subscribe(listener: KitchenEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: KitchenOrderEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}

export const kitchenEventDispatcher = new KitchenEventDispatcher();
