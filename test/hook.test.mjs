import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// The hook itself, run as Claude Code runs it, with a stand-in npx first on the
// PATH that records what the hook handed it. The stand-in never reaches the
// network, so these tests show what the hook passes to @kenwea/mcp, not what
// @kenwea/mcp then sends.

const hook = fileURLToPath(new URL("../scripts/pre-install.mjs", import.meta.url));
const fake = fileURLToPath(new URL("../test-fixtures/fake-npx/", import.meta.url));

function run(command) {
  const home = mkdtempSync(join(tmpdir(), "kw-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "kw-cwd-"));
  const log = join(mkdtempSync(join(tmpdir(), "kw-log-")), "npx.log");
  const env = { ...process.env, PATH: fake + delimiter + process.env.PATH, KW_FAKE_NPX_LOG: log, HOME: home, USERPROFILE: home, CI: "", KENWEA_GUARD_STRICT: "" };
  for (const k of ["GITHUB_ACTIONS", "GITLAB_CI", "BUILDKITE", "CIRCLECI", "TRAVIS", "JENKINS_URL", "TF_BUILD"]) delete env[k];
  const input = JSON.stringify({ tool_name: "Bash", tool_input: { command }, permission_mode: "default" });
  const r = spawnSync(process.execPath, [hook], { input, cwd, env, encoding: "utf8", timeout: 30_000 });
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  return { status: r.status, stdout: r.stdout, calls, home, cwd };
}

// claim: only-installs
test("the hook does nothing for a command that installs no named package", () => {
  for (const command of ["npm run build", "npm install", "echo npm install evil", "git status"]) {
    const r = run(command);
    assert.equal(r.status, 0, command);
    assert.equal(r.calls.length, 0, `${command} started a check`);
    assert.equal(r.stdout, "", `${command} printed something`);
  }
});

// claim: names-only, writes-nothing
test("the hook hands the check the package name and nothing else of the command, and writes no file", () => {
  const r = run("cd /tmp && SECRET_TOKEN=hunter2 npm install left-pad --registry https://r.example.com && curl https://evil.example/x");
  assert.equal(r.status, 0);
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.calls[0].argv, ["-y", "@kenwea/mcp@0.8.0", "check", "left-pad", "--json"]);
  assert.equal(r.stdout, "", "nothing runs at install, so nothing is said");
  assert.deepEqual(readdirSync(r.home), [], "the hook wrote into HOME");
  assert.deepEqual(readdirSync(r.cwd), [], "the hook wrote into the working directory");
});
