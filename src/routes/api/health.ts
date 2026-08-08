import { createFileRoute } from "@tanstack/react-router";
import { db } from "#/db/client.server";
import { checkHealth } from "#/lib/example";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const result = await checkHealth(db);
        return Response.json(result, { status: result.status === "ok" ? 200 : 503 });
      },
    },
  },
});
