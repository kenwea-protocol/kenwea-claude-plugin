// Kenwea guard for Claude Code: the pure parts, kept apart so they can be tested
// without spawning anything.
//
// parseInstalls reads a shell command the agent is about to run and returns the
// registry packages a package manager would install, so their install steps can be
// checked first. decide turns the checked records into what the hook tells Claude
// Code: allow quietly, allow with a note, or ask the user.

const MANAGERS = {
  npm: new Set(["install", "i", "add", "in", "isntall", "ins", "inst", "insta", "instal", "isnt", "isnta", "isntal"]),
  pnpm: new Set(["add", "install", "i"]),
  yarn: new Set(["add"]),
  bun: new Set(["add", "install", "i", "a"]),
};
// Flags whose next token is a value, not a package. -w takes a workspace name in
// npm and is a plain switch (workspace root) in pnpm, so it is per manager.
const VALUE_FLAGS_ALL = [
  "--registry", "--prefix", "--cache", "--tag", "--filter", "--dir", "-C", "--userconfig",
  "--otp", "--omit", "--include", "--install-strategy", "--cwd", "--network-concurrency", "--save-prefix",
];
const VALUE_FLAGS = {
  npm: new Set([...VALUE_FLAGS_ALL, "-w", "--workspace"]),
  pnpm: new Set(VALUE_FLAGS_ALL),
  yarn: new Set(VALUE_FLAGS_ALL),
  bun: new Set(VALUE_FLAGS_ALL),
};
// An npm spec: optional @scope/, a name, an optional @version, caret or tilde
// range, or tag. Comparison ranges (>=, <, ||, spaces) are deliberately left out:
// the spec goes on a shell line, where < > | and spaces mean something else.
const SPEC = /^(@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*(@[\w.^~*-]+)?$/i;

/** Split a command line into simple commands, then into words, honouring quotes. */
export function splitCommands(line) {
  const commands = [];
  let words = [];
  let word = "";
  let quote = null;
  let inWord = false;
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < line.length) word += line[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === "\\" && i + 1 < line.length) {
      word += line[++i];
      inWord = true;
    } else if (c === " " || c === "\t") {
      endWord();
    } else if (c === ";" || c === "\n" || c === "&" || c === "|" || c === "(" || c === ")") {
      endCommand();
    } else {
      word += c;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}

/**
 * The registry packages a command would install, with the manager and whether
 * scripts were turned off. Local paths, git and URL specs are left out: the
 * notary checks registry packages.
 * @param {string} line
 * @returns {{manager: string, specs: string[], ignoreScripts: boolean, bareInstall: boolean}[]}
 */
export function parseInstalls(line) {
  const out = [];
  for (let words of splitCommands(String(line || ""))) {
    // Skip env assignments and wrappers in front of the manager.
    while (words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || ["sudo", "env", "command", "exec", "time"].includes(words[0]))) {
      words = words.slice(1);
    }
    if (!words.length) continue;
    const manager = words[0].replace(/\.(cmd|exe)$/i, "").split(/[\\/]/).pop();
    if (!MANAGERS[manager]) continue;
    // The verb is the first word that is not a flag (npm --prefix x install y).
    let i = 1;
    while (i < words.length && words[i].startsWith("-")) i += VALUE_FLAGS[manager].has(words[i]) ? 2 : 1;
    const verb = words[i];
    if (!verb || !MANAGERS[manager].has(verb)) continue;
    const specs = [];
    let ignoreScripts = false;
    for (let j = i + 1; j < words.length; j++) {
      const w = words[j];
      if (w === "--ignore-scripts" || w === "--ignore-scripts=true") { ignoreScripts = true; continue; }
      if (w.startsWith("-")) { if (VALUE_FLAGS[manager].has(w)) j++; continue; }
      const spec = registrySpec(w);
      if (spec) specs.push(spec);
    }
    out.push({ manager, specs, ignoreScripts, bareInstall: specs.length === 0 });
  }
  return out;
}

/** A registry spec the notary can check, or null. Aliases resolve to the real package. */
export function registrySpec(word) {
  let w = word.trim();
  if (!w || /^[.~/]|^[a-z]:[\\/]|:\/\/|^(file|link|workspace|git|git\+\w+|github|gitlab|bitbucket|portal|patch):/i.test(w)) return null;
  const alias = w.match(/^(?:@[^/@]+\/)?[^@]+@npm:(.+)$/);
  if (alias) w = alias[1];
  if (w.includes("/") && !w.startsWith("@")) return null; // user/repo shorthand is GitHub
  return SPEC.test(w) ? w : null;
}

// One plain line per outcome that is neither a pass nor a network attempt.
const OUTCOME = {
  install_step_failed: "the step failed in the sandbox, often for want of a dependency the check does not install (evidence neither way)",
  step_timed_out: "the step was still running at the check's 15-second limit, so it was not watched to the end",
  implicit_install_not_run: "npm would build it with node-gyp, which the check does not run",
  run_incomplete: "the run ended before reporting that it finished, so it was not watched to the end",
  trace_unavailable: "it ran, but what it attempted could not be observed",
  runner_busy: "the notary was busy and did not run it",
  not_run: "the notary did not run it",
  extract_failed: "the notary could not open the archive",
  no_manifest: "the archive had no package.json",
  report_unreliable: "the run's report could not be trusted",
  too_large: "the package is larger than the notary checks",
};

// The CLI's error, said plainly when it is one we know.
function plainError(e) {
  if (!e) return "no answer from the notary";
  if (/rate_limited|hourly/i.test(e)) return "the notary's hourly limit was reached";
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timed? ?out/i.test(e)) return "the notary could not be reached";
  return e;
}

/**
 * What the hook says, from the checked records.
 * @param {{spec: string, code: number, result: any, error?: string}[]} checks
 * @param {{strict?: boolean}} [opts]
 * @returns {{decision: "allow"|"ask"|"silent", reason: string, note: string}}
 */
/** The record's signed payload as an object, or null. */
export function signedFacts(result) {
  const p = result && result.signedAttestation && result.signedAttestation.payload;
  if (typeof p !== "string") return null;
  try {
    return JSON.parse(p);
  } catch {
    return null;
  }
}

export function decide(checks, opts = {}) {
  const asks = [];
  const notes = [];
  for (const c of checks) {
    const r = c.result || {};
    if (c.code === 4) {
      asks.push(`${c.spec}: the Kenwea record did not verify (${c.error || "bad or revoked signature, or not about these bytes"})`);
      continue;
    }
    if (c.code !== 0 && c.code !== 1) {
      // 1.5.0: "not checked" read as an alarm or a fault in the package; say
      // what happened instead, and that the install was not held up.
      const why = plainError(c.error);
      (opts.strict ? asks : notes).push(`${c.spec}: no Kenwea record yet (${why}${opts.strict ? "" : "; the install went ahead"})`);
      continue;
    }
    if (r.checked === false) {
      (opts.strict ? asks : notes).push(`${c.spec}: no Kenwea record yet (${r.reason || "the notary could not download it"})`);
      continue;
    }
    // The signed facts, which @kenwea/mcp has already verified (exit 0 or 1),
    // rather than the unsigned copy beside them.
    const f = signedFacts(r) || r;
    const steps = Array.isArray(f.installSteps) ? f.installSteps : [];
    // Install steps that ran in the package's dependency tree (1.4.0). A package
    // with no step of its own whose dependency runs one (eslint-config-next,
    // unrs-resolver's postinstall) was checked, and was once said to be unchecked.
    const depSteps = f.dependencies && Array.isArray(f.dependencies.installSteps) ? f.dependencies.installSteps : [];
    const who = !steps.length && depSteps.length ? `an install step in its dependencies (${depSteps.join(", ")})` : "its install step";
    const o = f.observed && typeof f.observed === "object" ? f.observed : null;
    // requests: what a step sent to the stand-in network inside the sandbox (2026-10-16).
    const reached = o ? [...(o.dns || []), ...(o.network || []), ...(o.requests || [])] : [];
    const sent = o && Array.isArray(o.credentialsSent) ? o.credentialsSent : [];
    const read = o && Array.isArray(o.credentialsRead) ? o.credentialsRead : [];
    // Registry metadata beside the record: a trusted package that starts running
    // something at install is the most common shape of an attack.
    const since = r.sincePrevious && typeof r.sincePrevious === "object" ? r.sincePrevious : null;
    const added = since && Array.isArray(since.added) ? since.added : [];
    if (added.length && steps.length) {
      asks.push(`${c.spec}: new since ${since.previous}, ${added.join(", ")} runs at install`);
    }
    if (sent.length) {
      asks.push(`${c.spec}: ${who} tried to send a credential it found (${sent.join("; ")}; ours were decoys)`);
    } else if (read.length) {
      asks.push(`${c.spec}: ${who} opened credential files (${read.join(", ")}; ours held decoys)`);
    } else if (reached.length) {
      asks.push(`${c.spec}: ${who} tried to reach the network (${reached.join(", ")})`);
    } else if (!steps.length && depSteps.length && f.verdict === "approved") {
      notes.push(`${c.spec}: nothing of its own runs at install; ${depSteps.join(", ")} in its dependencies ran, finished and touched nothing we watch (no network, no credential files)`);
    } else if (!steps.length && depSteps.length) {
      notes.push(`${c.spec}: nothing of its own runs at install; ${depSteps.join(", ")} in its dependencies ran; ${OUTCOME[f.reasonCode] || f.reasonCode || f.verdict}`);
    } else if (!steps.length && f.reasonCode === "no_install_steps") {
      // Runs nothing at install: nothing to say.
    } else if (!steps.length) {
      // No steps for any other reason means the check did not find out what runs
      // (extract_failed, no_manifest, report_unreliable, our limits), not that
      // nothing does (2026-10-15).
      // A check that never ran has no result to call inconclusive.
      const why = OUTCOME[f.reasonCode] || f.reasonCode || "the check did not find out what runs at install";
      const ran = f.reasonCode !== "runner_busy" && f.reasonCode !== "not_run";
      (opts.strict ? asks : notes).push(ran ? `${c.spec}: checked, but the result is inconclusive (${why})` : `${c.spec}: no Kenwea record yet (${why})`);
    } else if (f.verdict === "approved") {
      notes.push(`${c.spec}: runs ${steps.join(", ")} at install; it finished and touched nothing we watch (no network, no credential files)`);
    } else {
      notes.push(`${c.spec}: runs ${steps.join(", ")} at install; ${OUTCOME[f.reasonCode] || f.reasonCode || f.verdict}`);
    }
  }
  const suffix = "Signed and verified by the Kenwea notary: https://www.kenwea.com/verify";
  // Strict mode asks when there is no record; that is not a check, so say so.
  if (asks.length && asks.every((a) => a.includes(": no Kenwea record yet ("))) {
    return { decision: "ask", reason: `Kenwea could not check this install, and KENWEA_GUARD_STRICT is set. ${asks.join("; ")}.${notes.length ? ` Also: ${notes.join("; ")}.` : ""}`, note: "" };
  }
  if (asks.length) {
    return { decision: "ask", reason: `Kenwea checked this install before it runs. ${asks.join("; ")}.${notes.length ? ` Also: ${notes.join("; ")}.` : ""} ${suffix}`, note: "" };
  }
  if (notes.length) return { decision: "allow", reason: "", note: `Kenwea: ${notes.join("; ")}.` };
  return { decision: "silent", reason: "", note: "" };
}
