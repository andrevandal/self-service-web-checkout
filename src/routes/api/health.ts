import { createFileRoute } from "@tanstack/react-router";
import { env as serverEnv } from "virtual:env/server";

export { serverEnv };

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => Response.json({ ok: false }, { status: 503 }),
    },
  },
});
