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

// What a version does that the previous one did not, as one clause, or "" when
// nothing worth asking about changed. Hosts that only vary between runs of the
// same install code (variesBetweenRuns) are left out: the server already does
// not count them as worse.
export function changedBehavior(b) {
  if (!b || typeof b !== "object" || b.known !== true || b.worse !== true) return "";
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : []);
  const parts = [];
  if (list(b.newCredentialsSent).length) parts.push(`it tries to send a credential it found (${list(b.newCredentialsSent).join("; ")}; ours were decoys)`);
  if (list(b.newCredentialsRead).length) parts.push(`it opens credential files (${list(b.newCredentialsRead).join(", ")}; ours held decoys)`);
  if (list(b.newlyReached).length) parts.push(`it first reaches ${list(b.newlyReached).join(", ")}`);
  if (list(b.newDependencySteps).length) parts.push(`new install steps in its dependencies: ${list(b.newDependencySteps).join(", ")}`);
  if (!parts.length && b.previousLevel && b.level && b.previousLevel !== b.level) parts.push(`its level went from ${b.previousLevel} to ${b.level}`);
  return parts.length ? `${parts.join("; ")}, which our record of ${b.previous} does not show` : "";
}

// The CLI's error, said plainly when it is one we know.
function plainError(e) {
  if (!e) return "no answer from the notary";
  if (/rate_limited|hourly/i.test(e)) return "the notary's hourly limit was reached";
  // @kenwea/mcp 0.7.3: the record came, but the published keys could not be read.
  if (/could not read the published keys/i.test(e)) return "Kenwea's published keys could not be read, so its record could not be checked";
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timed? ?out/i.test(e)) return "the notary could not be reached";
  return e;
}

// Variables CI services set (1.7.0). CI=true covers most of them; the rest are
// for the ones that do not set it, or set it only in some setups.
const CI_VARS = ["GITHUB_ACTIONS", "GITLAB_CI", "BUILDKITE", "CIRCLECI", "TRAVIS", "JENKINS_URL", "TF_BUILD",
  "BITBUCKET_BUILD_NUMBER", "CODEBUILD_BUILD_ID", "TEAMCITY_VERSION", "DRONE", "SEMAPHORE", "APPVEYOR", "BUILD_ID_GCB"];

/**
 * Whether a check that cannot be made stops the install (1.7.0), and whether
 * anyone is there to answer a question (1.7.1).
 * KENWEA_GUARD_STRICT=1 turns strict on and =0 off; unset, it is on in CI, where
 * nobody is there to read a note and an unchecked install is the one to stop.
 * Unattended is CI, or a session in dontAsk or bypassPermissions mode. There a
 * question is not asked but answered "deny". Measured 2026-11-02 with claude -p:
 * with permissions bypassed a hook's "ask" let the command run, unasked, and
 * "deny" stopped it; without bypass both stopped it.
 * @param {Record<string, string|undefined>} env
 * @param {string} [permissionMode] the hook input's permission_mode
 * @returns {{strict: boolean, ci: string, unattended: boolean}} ci: the variable that made it strict, or ""
 */
export function guardMode(env, permissionMode = "") {
  const set = (v) => typeof v === "string" && v !== "" && v.toLowerCase() !== "false" && v !== "0";
  const ci = set(env.CI) ? "CI" : CI_VARS.find((k) => set(env[k])) || "";
  const unattended = ci !== "" || permissionMode === "dontAsk" || permissionMode === "bypassPermissions";
  if (env.KENWEA_GUARD_STRICT === "1") return { strict: true, ci: "", unattended };
  if (env.KENWEA_GUARD_STRICT === "0") return { strict: false, ci: "", unattended };
  return { strict: ci !== "", ci, unattended };
}

/**
 * What the hook says, from the checked records.
 * @param {{spec: string, code: number, result: any, error?: string}[]} checks
 * @param {{strict?: boolean, ci?: string, unattended?: boolean}} [opts] ci: set when strict came from CI
 * @returns {{decision: "allow"|"ask"|"deny"|"silent", reason: string, note: string}}
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

// What the signed record knows that its level does not say (1.8.0). An exact
// copy of oddFields in @kenwea/mcp's src/odd.js, kept here so the hook does not
// wait on a release of that package; change both together. A quiet record can
// still hold a load that failed or a program a step looked for and did not find
// (nx 24.0.5). Stylesheet and browser-only loads are explained, not odd.
const EXPECTED_LOAD = [/entry is a \.\w+ file/, /expects a browser/];
const NOT_DONE = new Set(["failed", "blocked", "not_reached"]);
function shortCause(cause) {
  const first = cause.split(";")[0].trim();
  return first.length > 90 ? first.slice(0, 90) + "..." : first;
}
function missingOf(o) {
  return o && typeof o === "object" && Array.isArray(o.missing) ? o.missing.map(String) : [];
}
export function oddFields(f) {
  const odd = [];
  if (!f || typeof f !== "object") return odd;
  for (const p of Array.isArray(f.phases) ? f.phases : []) {
    if (!p || typeof p !== "object" || p.blockedBy || !NOT_DONE.has(p.status)) continue;
    const cause = typeof p.cause === "string" ? p.cause : "";
    if (p.name === "load" && EXPECTED_LOAD.some((r) => r.test(cause))) continue;
    odd.push(`${String(p.name)} ${String(p.status).replace("_", " ")}${cause ? ` (${shortCause(cause)})` : ""}`);
  }
  const load = f.load && typeof f.load === "object" ? f.load : {};
  const missing = [...new Set([...missingOf(f.observed), ...missingOf(load.observed)])];
  if (missing.length) odd.push(`a step looked for ${missing.join(", ")} and did not find it`);
  if ((f.observed && f.observed.truncated) || (load.observed && load.observed.truncated)) odd.push("the trace was cut, so it may be incomplete");
  const lost = Number(f.sandbox && f.sandbox.traceLost);
  if (lost > 0) odd.push(`${lost} trace events were lost`);
  if (f.dependencies && f.dependencies.complete === false) odd.push("the dependency tree was not complete");
  return odd;
}

export function decide(checks, opts = {}) {
  const d = decideAttended(checks, opts);
  if (d.decision !== "ask" || !opts.unattended) return d;
  // Nobody can answer here, so the question is answered for them (1.7.1).
  const ours = d.reason.startsWith("Kenwea could not check")
    ? " The check failed on Kenwea's side (unreachable, or its hourly limit of 20 checks per address), not because of the package."
    : "";
  return { decision: "deny", reason: `${d.reason} Nobody can answer a question here, so the install was stopped instead of asked about.${ours}`, note: "" };
}

function decideAttended(checks, opts) {
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
    // 1.6.0: what the version did differently from the previous one in the
    // sandbox, from the notary's records of both. A new host or credential is
    // already asked about through this record's own level, so the comparison is
    // said beside it, never as a second reason: the earlier record can differ
    // for our reasons too (puppeteer 25.15.0's postinstall skipped its download
    // in our sandbox, so 25.16.0 looked new). A new install step in the tree is
    // asked about, as a new step of the package's own already is, when both
    // records were made by the same checker.
    const b = since && since.behavior;
    const behaviorLine = changedBehavior(b);
    if (behaviorLine) {
      const newStep = b.sameChecker === true && Array.isArray(b.newDependencySteps) && b.newDependencySteps.length > 0;
      const older = b.sameChecker === true ? "" : " (the earlier record was made by an older checker, so the difference may be ours)";
      (newStep ? asks : notes).push(`${c.spec}: compared with ${b.previous}, ${behaviorLine}${older}`);
    }
    if (added.length && steps.length) {
      asks.push(`${c.spec}: new since ${since.previous}, ${added.join(", ")} runs at install`);
    }
    const odd = oddFields(f);
    const before = { asks: asks.length, notes: notes.length };
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
    // 1.8.0: the fields the level does not cover, said on the same line, or on
    // a line of their own when the record was otherwise nothing to mention.
    if (odd.length) {
      const also = `the record also has ${odd.length === 1 ? "one thing" : `${odd.length} things`} to look at: ${odd.join("; ")}`;
      if (asks.length > before.asks) asks[asks.length - 1] += `; ${also}`;
      else if (notes.length > before.notes) notes[notes.length - 1] += `; ${also}`;
      else notes.push(`${c.spec}: nothing of its own runs at install, but ${also}`);
    }
  }
  const suffix = "Signed and verified by the Kenwea notary: https://www.kenwea.com/verify";
  // Strict mode asks when there is no record; that is not a check, so say so.
  if (asks.length && asks.every((a) => a.includes(": no Kenwea record yet ("))) {
    const why = opts.ci
      ? `this looks like CI (${opts.ci} is set), where the guard stops an install it could not check; set KENWEA_GUARD_STRICT=0 to let such installs go ahead`
      : "KENWEA_GUARD_STRICT is set";
    return { decision: "ask", reason: `Kenwea could not check this install, and ${why}. ${asks.join("; ")}.${notes.length ? ` Also: ${notes.join("; ")}.` : ""}`, note: "" };
  }
  if (asks.length) {
    return { decision: "ask", reason: `Kenwea checked this install before it runs. ${asks.join("; ")}.${notes.length ? ` Also: ${notes.join("; ")}.` : ""} ${suffix}`, note: "" };
  }
  if (notes.length) return { decision: "allow", reason: "", note: `Kenwea: ${notes.join("; ")}.` };
  return { decision: "silent", reason: "", note: "" };
}
