import assert from "node:assert/strict";
import test from "node:test";

import { decide, parseInstalls, registrySpec, changedBehavior } from "../scripts/lib.mjs";

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
  assert.match(d.note, /core-js: runs postinstall at install; it finished and touched nothing we watch/);
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
  assert.match(d.note, /no Kenwea record yet \(the notary's hourly limit was reached; the install went ahead\)/);
  assert.doesNotMatch(d.note, /not checked/);
  const strict = decide(c, { strict: true });
  assert.equal(strict.decision, "ask");
  assert.match(strict.reason, /^Kenwea could not check this install/);
  assert.doesNotMatch(strict.reason, /Signed and verified/);
  assert.match(decide([{ spec: "x", code: 3, result: null, error: "check failed: fetch failed" }]).note, /\(the notary could not be reached; the install went ahead\)/);
});

// 1.6.1: the published keys are on another host than the notary. When only they are
// down, @kenwea/mcp 0.7.3 exits 3, and that is a note, said as what it is; a record
// that did not verify against keys that were read still asks (above).
test("published keys that could not be read are a note, not a question", () => {
  const d = decide([{ spec: "x@1.0.0", code: 3, result: null, error: "the record could not be verified, so nothing is claimed about it: could not read the published keys at https://www.kenwea.com/.well-known/kenwea-attestation-keys.json: fetch failed" }]);
  assert.equal(d.decision, "allow");
  assert.match(d.note, /no Kenwea record yet \(Kenwea's published keys could not be read, so its record could not be checked; the install went ahead\)/);
  assert.doesNotMatch(d.note, /notary could not be reached/);
  const timedOut = decide([{ spec: "x@1.0.0", code: 3, result: null, error: "the check did not finish within 140 s" }]);
  assert.match(timedOut.note, /no Kenwea record yet \(the check did not finish within 140 s; the install went ahead\)/);
});

test("a failed or stopped step is reported with its reason, not as a pass", () => {
  const d = decide([{ spec: "esbuild", code: 0, result: rec({ verdict: "manual_review", reasonCode: "step_timed_out", installSteps: ["postinstall"], observed: { dns: [], network: [] } }) }]);
  assert.equal(d.decision, "allow");
  assert.match(d.note, /15-second limit, so it was not watched to the end/);
});

test("decide: no steps without no_install_steps is not silence", () => {
  const rec = (facts) => ({ spec: "x@1.0.0", code: 0, result: { installSteps: [], signedAttestation: { payload: JSON.stringify(facts) } } });
  assert.equal(decide([rec({ installSteps: [], reasonCode: "no_install_steps", verdict: "manual_review" })]).decision, "silent");
  const forged = decide([rec({ installSteps: [], reasonCode: "extract_failed", verdict: "manual_review" })]);
  assert.equal(forged.decision, "allow");
  assert.match(forged.note, /checked, but the result is inconclusive \(the notary could not open the archive\)/);
  assert.match(decide([rec({ installSteps: [], reasonCode: "runner_busy", verdict: "manual_review" })]).note, /no Kenwea record yet \(the notary was busy and did not run it\)/);
  assert.equal(decide([rec({ installSteps: [], reasonCode: "report_unreliable", verdict: "manual_review" })], { strict: true }).decision, "ask");
});

test("decide: reads the signed facts, not the unsigned copy", () => {
  const r = { installSteps: [], signedAttestation: { payload: JSON.stringify({ installSteps: ["postinstall"], reasonCode: "ran_tried_network", verdict: "manual_review", observed: { dns: ["evil.example"], network: [] } }) } };
  assert.equal(decide([{ spec: "x@1.0.0", code: 0, result: r }]).decision, "ask");
});

test("decide: decoy credentials and a new install step ask first", () => {
  const signed = (facts, extra = {}) => ({ spec: "x@2.0.0", code: 0, result: { ...extra, signedAttestation: { payload: JSON.stringify(facts) } } });
  const ran = { installSteps: ["postinstall"], reasonCode: "ran_ok", verdict: "approved", observed: { dns: [], network: [] } };
  const sent = decide([signed({ ...ran, verdict: "rejected", reasonCode: "sent_credentials", observed: { dns: [], network: [], credentialsSent: ["npm token in data it sent"] } })]);
  assert.equal(sent.decision, "ask");
  assert.match(sent.reason, /send a credential/);
  assert.match(decide([signed({ ...ran, reasonCode: "read_credentials", verdict: "manual_review", observed: { dns: [], network: [], credentialsRead: ["~/.ssh (SSH private key)"] } })]).reason, /credential files/);
  const fresh = decide([signed(ran, { sincePrevious: { previous: "1.9.0", added: ["postinstall"], removed: [], changed: [] } })]);
  assert.equal(fresh.decision, "ask");
  assert.match(fresh.reason, /new since 1\.9\.0, postinstall runs at install/);
  assert.equal(decide([signed(ran)]).decision, "allow");
});

// 1.4.0: a package with no step of its own whose dependency runs one was
// checked, with its whole tree, and must not be called "not checked". The facts
// are those of the real records of eslint-config-next 15.5.27 and
// swagger-ui-express 5.0.1 (October 2026).
test("decide: a step in the dependency tree is reported as checked, and as the dependency's", () => {
  const signed = (facts) => ({ spec: "x@1.0.0", code: 0, result: { signedAttestation: { payload: JSON.stringify(facts) } } });
  const quiet = decide([signed({ installSteps: [], reasonCode: "ran_ok", verdict: "approved", observed: { dns: [], network: [] }, dependencies: { installSteps: ["unrs-resolver@1.12.2 postinstall"] } })]);
  assert.equal(quiet.decision, "allow");
  assert.doesNotMatch(quiet.note, /inconclusive|no Kenwea record/);
  assert.match(quiet.note, /unrs-resolver@1\.12\.2 postinstall in its dependencies ran, finished and touched nothing we watch/);
  const net = decide([signed({ installSteps: [], reasonCode: "ran_tried_network", verdict: "manual_review", observed: { dns: ["scarf.sh"], network: [] }, dependencies: { installSteps: ["@scarf/scarf@1.4.0 postinstall"] } })]);
  assert.equal(net.decision, "ask");
  assert.match(net.reason, /an install step in its dependencies \(@scarf\/scarf@1\.4\.0 postinstall\) tried to reach the network/);
  // Nothing runs anywhere in the tree: still silent.
  assert.equal(decide([signed({ installSteps: [], reasonCode: "no_install_steps", verdict: "manual_review" })]).decision, "silent");
});

// 1.6.0: sincePrevious.behavior, from the notary's records of both versions.
test("decide: a new install step in the tree asks; other differences are said beside the record", () => {
  const signed = (since, level = "quiet") => ({ spec: "x@2.0.0", code: 0, result: { sincePrevious: since, signedAttestation: { payload: JSON.stringify({ installSteps: [], reasonCode: "ran_ok", verdict: "approved", level, observed: { dns: [], network: [] }, dependencies: { installSteps: ["dep@1.0.0 postinstall"] } }) } } });
  const base = { known: true, worse: true, sameChecker: true, previous: "1.9.0", previousLevel: "quiet", level: "quiet" };

  const step = decide([signed({ previous: "1.9.0", added: [], behavior: { ...base, newDependencySteps: ["evil-dep postinstall"] } })]);
  assert.equal(step.decision, "ask");
  assert.match(step.reason, /x@2\.0\.0: compared with 1\.9\.0, new install steps in its dependencies: evil-dep postinstall, which our record of 1\.9\.0 does not show/);

  // The puppeteer shape (25.15.0 vs 25.16.0, 2026-10-29): a new host is said, not asked for by itself.
  const host = decide([signed({ previous: "1.9.0", added: [], behavior: { ...base, newlyReached: ["storage.googleapis.com"] } })]);
  assert.equal(host.decision, "allow");
  assert.match(host.note, /compared with 1\.9\.0, it first reaches storage\.googleapis\.com, which our record of 1\.9\.0 does not show/);

  // An older checker: never asked, and said so.
  const older = decide([signed({ previous: "1.9.0", added: [], behavior: { ...base, sameChecker: false, newDependencySteps: ["evil-dep postinstall"] } })]);
  assert.equal(older.decision, "allow");
  assert.match(older.note, /older checker, so the difference may be ours/);

  // Not worse (swagger-ui-express: varies between runs), unknown, or absent: nothing more is said.
  const varies = { previous: "5.0.0", added: [], behavior: { known: true, worse: false, sameChecker: true, previous: "5.0.0", previousLevel: "quiet", level: "network", variesBetweenRuns: ["scarf.sh"] } };
  const unknown = { previous: "5.0.0", added: [], behavior: { known: false, queued: true, worse: false, previous: "5.0.0" } };
  for (const since of [varies, unknown, { previous: "5.0.0", added: [] }]) {
    const r = decide([signed(since)]);
    assert.notEqual(r.decision, "ask");
    assert.doesNotMatch(r.note || "", /compared with/);
  }
});

test("changedBehavior: credentials come first and the clause names the earlier record", () => {
  assert.equal(
    changedBehavior({ known: true, worse: true, previous: "1.0.0", newCredentialsSent: ["npm token in data it sent"], newlyReached: ["a.example"] }),
    "it tries to send a credential it found (npm token in data it sent; ours were decoys); it first reaches a.example, which our record of 1.0.0 does not show"
  );
  assert.equal(changedBehavior({ known: true, worse: false, previous: "1.0.0", newlyReached: ["a.example"] }), "");
  assert.equal(changedBehavior(null), "");
});
