import { beforeEach, expect, test } from "bun:test";
import { createDatabase } from "#/db/client";
import { checkHealth, type Database } from "./example";

let db: Database;
beforeEach(() => {
  db = createDatabase("file::memory:");
});
test("checkHealth reports ok status when the database responds", async () => {
  const result = await checkHealth(db);
  expect(result.status).toBe("ok");
  if (result.status === "ok") {
    expect(typeof result.uptime).toBe("number");
    expect(result.timestamp).toBeDefined();
  }
});
test("checkHealth reports error status when the database throws", async () => {
  const brokenDb = {
    run: () => {
      throw new Error("down");
    },
  } as unknown as Database;
  expect(await checkHealth(brokenDb)).toEqual({
    status: "error",
    message: "Database connection failed",
  });
});
