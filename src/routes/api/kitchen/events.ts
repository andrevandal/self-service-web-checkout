import { createFileRoute } from "@tanstack/react-router";
import { serverEnv } from "#/env.server";
import { kitchenEventDispatcher } from "#/lib/kitchen-events.server";
import { readStaffCookie } from "#/lib/staff-cookie.server";

export const Route = createFileRoute("/api/kitchen/events")({
  server: {
    handlers: {
      GET: async () => {
        const { STAFF_COOKIE_SECRET } = serverEnv;
        if (!STAFF_COOKIE_SECRET || !readStaffCookie(STAFF_COOKIE_SECRET)) {
          return new Response("Staff session required", { status: 401 });
        }

        const encoder = new TextEncoder();
        let closed = false;
        let unsubscribe = () => {};
        let heartbeat: ReturnType<typeof setInterval> | undefined;

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const enqueue = (value: string) => {
              if (closed) {
                return;
              }
              try {
                controller.enqueue(encoder.encode(value));
              } catch {
                closed = true;
                unsubscribe();
                if (heartbeat) {
                  clearInterval(heartbeat);
                }
              }
            };
            enqueue(": connected\n\n");
            unsubscribe = kitchenEventDispatcher.subscribe((event) => {
              enqueue(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            });
            heartbeat = setInterval(() => enqueue(": heartbeat\n\n"), 5_000);
          },
          cancel() {
            closed = true;
            unsubscribe();
            if (heartbeat) {
              clearInterval(heartbeat);
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "Content-Type": "text/event-stream; charset=utf-8",
          },
        });
      },
    },
  },
});
