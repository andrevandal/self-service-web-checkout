import { createFileRoute } from "@tanstack/react-router";
import { serverEnv } from "../../env.server";

export { serverEnv };

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => Response.json({ ok: false }, { status: 503 }),
    },
  },
});
