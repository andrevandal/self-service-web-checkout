import { hideBin } from "yargs/helpers";
import yargs from "yargs";

type Command = [string, ...string[]];

const { dryRun } = await yargs(hideBin(process.argv))
  .option("dry-run", { type: "boolean", default: false })
  .parse();

const runCommand = (label: string, command: Command): boolean => {
  console.log(`${dryRun ? "[dry-run] " : ""}${label}: ${command.join(" ")}`);
  if (dryRun) {
    return true;
  }

  const result = Bun.spawnSync(command);
  if (result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
  if (result.exitCode !== 0) {
    console.error(`${label} exited with status ${result.exitCode}`);
    return false;
  }
  return true;
};

const runWhenAvailable = (label: string, executable: string, command: Command): boolean => {
  if (dryRun || Bun.which(executable)) {
    return runCommand(label, command);
  }
  console.log(`${label}: ${executable} not detected; skipped.`);
  return true;
};

console.log(
  "Supported harnesses: OMP, Gemini CLI, GitHub Copilot CLI, Factory Droid, Claude Code, Codex, OpenCode, Cursor",
);

let successful = runCommand("Vendored OpenCode skills update", ["bunx", "skills", "update"]);
successful =
  runWhenAvailable("OMP Superpowers upgrade", "omp", [
    "omp",
    "plugin",
    "upgrade",
    "superpowers@superpowers-marketplace",
  ]) && successful;
successful =
  runWhenAvailable("Gemini CLI Superpowers update", "gemini", [
    "gemini",
    "extensions",
    "update",
    "superpowers",
  ]) && successful;
successful =
  runWhenAvailable("GitHub Copilot CLI Superpowers update", "copilot", [
    "copilot",
    "plugin",
    "update",
    "superpowers@superpowers-marketplace",
  ]) && successful;
successful =
  runWhenAvailable("Factory Droid Superpowers update", "droid", [
    "droid",
    "plugin",
    "update",
    "superpowers@superpowers",
  ]) && successful;

console.log("Interactive update prompts (run inside the named harness):");
console.log(
  "Claude Code: /plugin marketplace update superpowers-marketplace; then /plugin update superpowers@superpowers-marketplace",
);
console.log("Codex CLI: /plugins, search for superpowers, then select Update Plugin");
console.log(
  "OpenCode: Fetch and follow instructions from https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/.opencode/INSTALL.md",
);
console.log("Cursor Agent: /add-plugin superpowers");
console.log(
  "Ponytail: compare the embedded AGENTS.md ruleset with https://github.com/DietrichGebert/ponytail/blob/main/README.md",
);

if (!successful) {
  process.exitCode = 1;
}
