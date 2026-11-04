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
const described = [...readme.matchAll(/<!-- description: [^>]+ -->/g)].length;
const direct = new Set(["line-counts", "cli-pin", "gives-up-15s", "adds-mcp-and-skill"]);

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

// claim: adds-mcp-and-skill. The plugin adds the notary MCP server and the skill.
test("the plugin adds the kenwea-notary MCP server and the skill the README names", () => {
  const servers = JSON.parse(read(".mcp.json")).mcpServers;
  assert.equal(servers["kenwea-notary"]?.url, "https://mcp.kenwea.com/notary/v1");
  assert.match(read("skills/kenwea/SKILL.md"), /^---\r?\n[\s\S]*?^name: kenwea\r?$/m);
});

// Nothing goes unmarked by accident (2026-11-04, marginalia_claude on
// Moltbook). A paragraph, list item or table row of the README that holds a
// number, a code span, an environment variable, or one of the words before,
// unless, never or always must carry either a claim marker or a
// <!-- description: why --> marker. A marker covers the block it ends. So a
// sentence nobody thought of as a claim, like the line counts once were, is
// either given a test or written down as description, where review can
// challenge it.
function blocks(md) {
  const out = [];
  let cur = [];
  let code = false;
  const flush = () => cur.length && (out.push(cur.join(" ")), (cur = []));
  for (const line of md.replace(/\r/g, "").split("\n")) {
    if (line.startsWith("```")) { flush(); code = !code; continue; }
    if (code) continue;
    if (!line.trim()) { flush(); continue; }
    if (/^\s*[-|#]/.test(line)) { flush(); out.push(line); continue; }
    cur.push(line);
  }
  flush();
  // Headings and the table's header and rule are not statements.
  return out.filter((b) => !/^#/.test(b) && !/^\|[\s|:-]+\|$/.test(b) && !/^\| The record says/.test(b));
}
const RISKY = [
  ["a number", /\d/],
  ["a code span", /`[^`]+`/],
  ["an environment variable", /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/],
  ["before, unless, never or always", /\b(before|unless|never|always)\b/i],
];
test("every README block with a number, code, a variable or an absolute word is marked", () => {
  const unmarked = [];
  for (const b of blocks(readme)) {
    if (/<!-- (claim:[a-z0-9-]+|description: [^>]+) -->/.test(b)) continue;
    const text = b.replace(/\]\([^)]*\)/g, "]");
    const why = RISKY.filter(([, re]) => re.test(text)).map(([w]) => w);
    if (why.length) unmarked.push(`${why.join(", ")}: ${b.slice(0, 90)}`);
  }
  assert.deepEqual(unmarked, [], "mark these as a claim with a test, or as description");
});

// The README must not retreat unnoticed (2026-11-04, yuigui on Moltbook). The
// easy way to pass the claim test is a sentence too vague to be a claim. So the
// newest CHANGELOG entry that counts the README's markers must hold today's
// count, and the claim count may only fall when that entry says why.
test("the CHANGELOG records how many claims the README makes, and a fall is explained", () => {
  const counts = [...read("CHANGELOG.md").matchAll(/README markers: (\d+) claims, (\d+) descriptions\.( Fewer claims because [^\n]+)?/g)];
  assert.ok(counts.length, "no CHANGELOG entry records the README's markers");
  const [latest, previous] = counts;
  assert.equal(Number(latest[1]), claimed.size, `the README has ${claimed.size} claims, the CHANGELOG says ${latest[1]}`);
  assert.equal(Number(latest[2]), described, `the README has ${described} descriptions, the CHANGELOG says ${latest[2]}`);
  if (previous && Number(latest[1]) < Number(previous[1])) {
    assert.ok(latest[3], `claims fell from ${previous[1]} to ${latest[1]} and the CHANGELOG does not say why`);
  }
});
