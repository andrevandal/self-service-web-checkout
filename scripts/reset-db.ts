import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const databaseUrl = process.env.DATABASE_URL ?? "file:./.data/local.db";

if (!databaseUrl.startsWith("file:")) {
  console.log(`Skipping local database reset for ${databaseUrl}`);
} else {
  const databasePath = databaseUrl.slice("file:".length).split("?", 1)[0];
  const resolvedPath = resolve(databasePath);
  for (const path of [resolvedPath, `${resolvedPath}-wal`, `${resolvedPath}-shm`]) {
    if (existsSync(path)) {
      unlinkSync(path);
      console.log(`Removed ${path}`);
    }
  }
}
