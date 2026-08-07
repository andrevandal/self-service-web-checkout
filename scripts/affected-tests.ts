import { hideBin } from "yargs/helpers";
import yargs from "yargs";

export const collectAffectedTests = async (pushFiles: string[]): Promise<string[]> => {
  const affectedTests = new Set<string>();

  for (const pushFile of pushFiles) {
    if (!pushFile.startsWith("src/") && !pushFile.startsWith("scripts/")) {
      continue;
    }
    const candidate = pushFile.endsWith(".test.ts")
      ? pushFile
      : pushFile.endsWith(".ts")
        ? pushFile.replace(/\.ts$/, ".test.ts")
        : undefined;

    if (candidate && (await Bun.file(candidate).exists())) {
      affectedTests.add(candidate);
    }
  }

  return [...affectedTests];
};

if (import.meta.main) {
  const argv = await yargs(hideBin(process.argv)).parse();
  const tests = await collectAffectedTests(argv._.map(String));
  if (tests.length > 0) {
    const result = await Bun.spawn(["bun", "test", ...tests], {
      stderr: "inherit",
      stdin: "inherit",
      stdout: "inherit",
    }).exited;
    process.exit(result);
  }
}
