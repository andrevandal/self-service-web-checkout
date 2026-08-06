import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db/client.server";
import { recordPing } from "../../lib/example";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const ping = await recordPing(db);
        return Response.json({
          ok: true,
          ping: {
            id: ping.id,
            createdAt: ping.createdAt.toISOString(),
          },
        });
      },
    },
  },
});
