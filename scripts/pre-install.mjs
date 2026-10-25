#!/usr/bin/env node
// Kenwea guard: a Claude Code PreToolUse hook on Bash and, on Windows, PowerShell.
//
// Before the agent runs an install (npm install, pnpm add, yarn add, bun add), the
// packages it names are checked by the Kenwea notary: their install steps are run
// in a no-network sandbox, traced, and the signed record is verified on this
// machine by @kenwea/mcp. The hook then
//   - asks the user when an install step tried to reach the network, or a record
//     did not verify;
//   - lets the install run with a one-line note when the package runs something
//     at install;
//   - stays silent when nothing of the package's own runs at install.
// A check that cannot be made (rate limit, no connection) never blocks the work:
// it is noted, unless KENWEA_GUARD_STRICT=1, which asks instead.
//
// Nothing is sent but the package names. Installs with --ignore-scripts, and a
// bare `npm install` from a lockfile, are not checked here.

import { spawn } from "node:child_process";
import { parseInstalls, decide } from "./lib.mjs";

const CLI = "@kenwea/mcp@0.7.2";
const MAX_PACKAGES = 5;
const CHECK_TIMEOUT_MS = 140_000;

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
  });
}

function check(spec) {
  return new Promise((resolve) => {
    // The spec has passed registrySpec's whitelist (letters, digits and . _ ~ ^ * - @ /),
    // and it is double-quoted so cmd.exe keeps a caret. A shell is needed on Windows,
    // where npx is a .cmd shim.
    const child = spawn(`npx -y ${CLI} check "${spec}" --json`, { shell: true, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    const timer = setTimeout(() => child.kill(), CHECK_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      let result = null;
      try {
        result = JSON.parse(out.trim().split("\n").pop() || "null");
      } catch {
        result = null;
      }
      const lastErr = err.trim().split("\n").filter((l) => l.startsWith("[kenwea-mcp]")).pop() || "";
      resolve({ spec, code: code ?? 3, result, error: lastErr.replace(/^\[kenwea-mcp\]\s*/, "").slice(0, 200) });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ spec, code: 3, result: null, error: String(e.message || e) });
    });
  });
}

async function main() {
  let input = {};
  try {
    input = JSON.parse(await readStdin());
  } catch {
    return; // not something we understand: stay out of the way
  }
  if (input.tool_name !== "Bash" && input.tool_name !== "PowerShell") return;
  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== "string") return;

  const installs = parseInstalls(command).filter((i) => !i.ignoreScripts);
  const specs = [...new Set(installs.flatMap((i) => i.specs))].slice(0, MAX_PACKAGES);
  if (!specs.length) return;

  const checks = await Promise.all(specs.map(check));
  const { decision, reason, note } = decide(checks, { strict: process.env.KENWEA_GUARD_STRICT === "1" });
  if (decision === "silent") return;
  const out =
    decision === "ask"
      ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason }, systemMessage: reason }
      : { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: note }, systemMessage: note };
  process.stdout.write(JSON.stringify(out));
}

main().catch(() => {
  // A broken guard must not break the agent's work.
});
