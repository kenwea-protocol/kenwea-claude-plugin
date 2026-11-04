import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// README claims tied to tests (2026-11-04, marginalia on Moltbook). A sentence in
// the README that says what the guard does carries an invisible
// <!-- claim:ID --> marker, and a test that shows it carries "// claim: ID". A
// claim with no test, or a test naming a claim the README no longer makes, fails
// here, so a change of behaviour cannot leave the README saying the old thing
// unnoticed, as "dependencies are not installed" once did. A few claims are facts
// about the files themselves and are checked below directly.

const root = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const readme = read("README.md");

const claimed = new Set([...readme.matchAll(/<!-- claim:([a-z0-9-]+) -->/g)].map((m) => m[1]));
const direct = new Set(["line-counts", "cli-pin", "gives-up-15s"]);

function tested() {
  const out = new Map();
  for (const f of readdirSync(new URL("test/", root))) {
    if (!f.endsWith(".test.mjs") || f === "claims.test.mjs") continue;
    for (const m of read("test/" + f).matchAll(/\/\/ claim: ([a-z0-9, -]+)/g)) {
      for (const id of m[1].split(",").map((x) => x.trim()).filter(Boolean)) out.set(id, f);
    }
  }
  return out;
}

test("every README claim has a test, and every tagged test a claim", () => {
  assert.ok(claimed.size >= 10, "the README lost its claim markers");
  const t = tested();
  for (const id of claimed) {
    assert.ok(t.has(id) || direct.has(id), `README claim "${id}" has no test`);
  }
  for (const id of t.keys()) {
    assert.ok(claimed.has(id), `a test names claim "${id}", which the README no longer makes`);
  }
});

// claim: line-counts. The README tells a reader how long the hook's two files
// are, so they can judge reading them.
test("the line counts the README gives are the files' own", () => {
  for (const m of readme.matchAll(/\[`(scripts\/[a-z-]+\.mjs)`\]\([^)]+\) \((\d+) lines\)/g)) {
    const lines = read(m[1]).replace(/\r?\n$/, "").split(/\r?\n/).length;
    assert.equal(Number(m[2]), lines, `${m[1]} is ${lines} lines, the README says ${m[2]}`);
  }
});

// claim: cli-pin, gives-up-15s. Every place that names the @kenwea/mcp version
// names the one the hook runs, and that version gives up after 15 s of silence
// (it came in 0.7.3).
test("the @kenwea/mcp version named everywhere is the one the hook runs", () => {
  const pin = read("scripts/pre-install.mjs").match(/const CLI = "@kenwea\/mcp@(\d+\.\d+\.\d+)"/)[1];
  for (const f of ["README.md", "skills/kenwea/SKILL.md"]) {
    for (const m of read(f).matchAll(/@kenwea\/mcp@(\d+\.\d+\.\d+)/g)) {
      assert.equal(m[1], pin, `${f} names @kenwea/mcp@${m[1]}, the hook runs ${pin}`);
    }
  }
  const [a, b, c] = pin.split(".").map(Number);
  assert.ok(a > 0 || b > 7 || (b === 7 && c >= 3), `${pin} predates the 15 s give-up (0.7.3)`);
});

// claim: not-checked-specs. "It checks at most five packages per command."
test("the hook checks at most as many packages as the README says", () => {
  const max = Number(read("scripts/pre-install.mjs").match(/const MAX_PACKAGES = (\d+);/)[1]);
  const words = { five: 5, three: 3, ten: 10 };
  const said = readme.match(/checks at most (\w+) packages per command/);
  assert.ok(said, "the README no longer says how many packages are checked");
  assert.equal(words[said[1]], max);
});
