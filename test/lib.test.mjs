import assert from "node:assert/strict";
import test from "node:test";

import { decide, parseInstalls, registrySpec } from "../scripts/lib.mjs";

const specs = (cmd) => parseInstalls(cmd).flatMap((i) => i.specs);

test("finds the packages each manager would install", () => {
  assert.deepEqual(specs("npm install esbuild"), ["esbuild"]);
  assert.deepEqual(specs("npm i -D @types/node@20 typescript"), ["@types/node@20", "typescript"]);
  assert.deepEqual(specs("pnpm add -w zod@^3.23.0"), ["zod@^3.23.0"]);
  assert.deepEqual(specs("yarn add left-pad"), ["left-pad"]);
  assert.deepEqual(specs("bun add hono@latest"), ["hono@latest"]);
  assert.deepEqual(specs("cd app && npm install sharp && npm test"), ["sharp"]);
  assert.deepEqual(specs("NODE_ENV=dev npm --prefix web install axios"), ["axios"]);
  assert.deepEqual(specs('npm install "lodash@4.17.21"'), ["lodash@4.17.21"]);
  assert.deepEqual(specs("npm install --registry https://r.example.com foo"), ["foo"]);
  assert.deepEqual(specs("npm.cmd install chalk"), ["chalk"]);
});

test("leaves out what the notary does not check", () => {
  assert.deepEqual(specs("npm install"), [], "a bare install from the lockfile");
  assert.deepEqual(specs("npm ci"), []);
  assert.deepEqual(specs("npm install ./local-pkg ../x /abs file:../y link:z workspace:*"), []);
  assert.deepEqual(specs("npm install github:user/repo user/repo git+https://x/y.git https://x/y.tgz"), []);
  assert.deepEqual(specs("npm run build"), []);
  assert.deepEqual(specs("echo npm install evil"), []);
  assert.deepEqual(specs("pnpm install"), []);
});

test("an install with scripts off is marked so", () => {
  const [i] = parseInstalls("npm install esbuild --ignore-scripts");
  assert.equal(i.ignoreScripts, true);
});

// The spec goes on a shell line, so anything a shell would read as syntax is out.
test("nothing a shell would interpret survives as a spec", () => {
  for (const bad of ["pkg@>=1.0", "pkg@<2", "a@1 || 2", "x;rm", "x$(id)", "x`id`", "x|y", "x>out", "x&y", "x\"y", "x'y"]) {
    assert.equal(registrySpec(bad), null, bad);
  }
  assert.deepEqual(specs("npm install 'pkg@>=1.0' ok"), ["ok"]);
  assert.equal(registrySpec("alias@npm:real-pkg@1.2.3"), "real-pkg@1.2.3");
});

const rec = (over) => ({ checked: true, verdict: "approved", reasonCode: "ran_ok", installSteps: [], observed: null, ...over });

test("silent when nothing runs at install", () => {
  assert.equal(decide([{ spec: "lodash", code: 0, result: rec({ verdict: "manual_review", reasonCode: "no_install_steps" }) }]).decision, "silent");
});

test("a note when something runs at install and reaches nothing", () => {
  const d = decide([{ spec: "core-js", code: 0, result: rec({ installSteps: ["postinstall"], observed: { dns: [], network: [] } }) }]);
  assert.equal(d.decision, "allow");
  assert.match(d.note, /core-js: runs postinstall at install; it finished and reached for nothing/);
});

test("asks when an install step tried the network, naming what", () => {
  const d = decide([{ spec: "telemetry-pkg", code: 0, result: rec({ verdict: "manual_review", reasonCode: "ran_tried_network", installSteps: ["postinstall"], observed: { dns: ["scarf.sh"], network: [] } }) }]);
  assert.equal(d.decision, "ask");
  assert.match(d.reason, /scarf\.sh/);
});

test("asks when a record did not verify", () => {
  assert.equal(decide([{ spec: "x", code: 4, result: null, error: "it was signed with key 00f55dd04da212b3, which Kenwea has revoked" }]).decision, "ask");
});

test("an unanswered check never blocks, unless strict", () => {
  const c = [{ spec: "x", code: 3, result: null, error: "check refused: rate_limited" }];
  const d = decide(c);
  assert.equal(d.decision, "allow");
  assert.match(d.note, /not checked \(check refused: rate_limited\)/);
  assert.equal(decide(c, { strict: true }).decision, "ask");
});

test("a failed or stopped step is reported with its reason, not as a pass", () => {
  const d = decide([{ spec: "esbuild", code: 0, result: rec({ verdict: "manual_review", reasonCode: "step_timed_out", installSteps: ["postinstall"], observed: { dns: [], network: [] } }) }]);
  assert.equal(d.decision, "allow");
  assert.match(d.note, /15-second limit, so it was not watched to the end/);
});
