export {};

type Command = [string, ...string[]];

const dryRun = Bun.argv.includes("--dry-run");
const vendoredSkills = [
  "setup-matt-pocock-skills",
  "tdd",
  "diagnosing-bugs",
  "codebase-design",
  "code-review",
];

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

let successful = true;
successful =
  runWhenAvailable("OMP marketplace registration", "omp", [
    "omp",
    "plugin",
    "marketplace",
    "add",
    "obra/superpowers-marketplace",
  ]) && successful;
successful =
  runWhenAvailable("OMP Superpowers installation", "omp", [
    "omp",
    "plugin",
    "install",
    "--scope",
    "project",
    "superpowers@superpowers-marketplace",
  ]) && successful;
successful =
  runWhenAvailable("Gemini CLI Superpowers installation", "gemini", [
    "gemini",
    "extensions",
    "install",
    "https://github.com/obra/superpowers",
  ]) && successful;
successful =
  runWhenAvailable("GitHub Copilot CLI marketplace registration", "copilot", [
    "copilot",
    "plugin",
    "marketplace",
    "add",
    "obra/superpowers-marketplace",
  ]) && successful;
successful =
  runWhenAvailable("GitHub Copilot CLI Superpowers installation", "copilot", [
    "copilot",
    "plugin",
    "install",
    "superpowers@superpowers-marketplace",
  ]) && successful;
successful =
  runWhenAvailable("Factory Droid marketplace registration", "droid", [
    "droid",
    "plugin",
    "marketplace",
    "add",
    "https://github.com/obra/superpowers",
  ]) && successful;
successful =
  runWhenAvailable("Factory Droid Superpowers installation", "droid", [
    "droid",
    "plugin",
    "install",
    "superpowers@superpowers",
  ]) && successful;

console.log("Interactive installation prompts (run inside the named harness):");
console.log("Claude Code: /plugin marketplace add obra/superpowers-marketplace");
console.log("Claude Code: /plugin install superpowers@superpowers-marketplace");
console.log("Codex CLI: /plugins, search for superpowers, then select Install Plugin");
console.log(
  "OpenCode: Fetch and follow instructions from https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/.opencode/INSTALL.md",
);
console.log("Cursor Agent: /add-plugin superpowers");

console.log("Vendored OpenCode skills status:");
for (const skill of vendoredSkills) {
  const path = `.agents/skills/${skill}/SKILL.md`;
  const status = await Bun.file(path).exists();
  console.log(`- ${skill}: ${status ? "present" : "missing"}`);
}

if (!successful) {
  process.exitCode = 1;
}
