import { expect, mock, test } from "bun:test";

let requestCookie = "";
mock.module("#/env.server", () => ({
  serverEnv: {
    STAFF_COOKIE_SECRET: "staff-secret",
  },
}));
mock.module("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) => (name === "cookie" ? requestCookie : undefined),
  setResponseHeader: () => {},
}));

const { signStaffCookie } = await import("#/lib/staff-cookie.server");
const { kitchenEventDispatcher } = await import("#/lib/kitchen-events.server");
const { Route } = await import("./events");
const getHandler = (Route.options.server?.handlers as { GET?: () => Promise<Response> } | undefined)
  ?.GET;
if (!getHandler) {
  throw new Error("Kitchen events route GET handler is not configured");
}

const staffCookie = () => {
  requestCookie = `staff_session=${signStaffCookie({ issuedAt: 1_754_672_000_000 }, "staff-secret")}`;
};

test("kitchen SSE rejects missing staff authority", async () => {
  requestCookie = "";
  const response = await getHandler();
  expect(response.status).toBe(401);
});

test("kitchen SSE streams dispatcher events and cleans up on cancel", async () => {
  staffCookie();
  const response = await getHandler();
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
  expect(response.body).not.toBeNull();

  const reader = response.body!.getReader();
  const connected = await reader.read();
  expect(new TextDecoder().decode(connected.value)).toBe(": connected\n\n");

  kitchenEventDispatcher.emit({
    type: "order.preparing",
    orderId: "order-sse",
    orderNumber: "A-9",
    status: "preparing",
  });
  const event = await reader.read();
  expect(new TextDecoder().decode(event.value)).toContain(
    'event: order.preparing\ndata: {"type":"order.preparing","orderId":"order-sse","orderNumber":"A-9","status":"preparing"}\n\n',
  );

  await reader.cancel();
  kitchenEventDispatcher.emit({
    type: "order.done",
    orderId: "order-sse",
    orderNumber: "A-9",
    status: "done",
  });
  const afterCancel = await reader.read();
  expect(afterCancel.done).toBe(true);
});
