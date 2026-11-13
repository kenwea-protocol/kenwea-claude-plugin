---
name: kenwea
description: >-
  Check an npm package with the Kenwea notary before installing it, and explain
  what a Kenwea record says. Use before running npm install, pnpm add, yarn add
  or bun add with package names, when the user asks whether a package is safe to
  install or what it runs at install time, or mentions install scripts,
  postinstall, supply chain attacks or Kenwea.
---

# Kenwea notary

The `kenwea-notary` MCP server that comes with this plugin asks the Kenwea notary what a package does when it is installed. The notary fetches the exact bytes npm would install, installs the package with its dependency tree in a container with no route out, no capabilities, a read-only filesystem and no root, with decoy credentials where a developer machine keeps real ones, and traces what each install step attempts. It returns a record signed with Kenwea's published Ed25519 key.

## Before an install

Before you run `npm install`, `pnpm add`, `yarn add` or `bun add` with package names, call `kenwea_notary_check` with `package` set to each name (at most five, with the version when the user gave one). Skip it for a bare install from a lockfile, local paths, git or URL specs, and installs with `--ignore-scripts`, since nothing of a named package runs there. Then:

- If the level is `network`, `reads_credentials` or `sends_credentials`, stop and tell the user what the record says the install step did, before installing. Let the user decide. Do not install it another way to get around the question.
- If the level is `quiet`, say in one line that it runs something at install and touched nothing the notary watches, and go ahead.
- If the level is `nothing_runs`, go ahead without comment.
- If the level is `unfinished`, or the check could not be made (rate limit, no answer), say so plainly and go ahead unless the user wants to wait. Neither is a pass.

This plugin has no hook, so nothing stops an install by itself; the check happens because you make it. A user who wants installs stopped automatically can install the Kenwea notary guard instead (see the README).

When the answer has `record.recordUrl`, end what you say about that package with the link. It is the record's public page on kenwea.com, which the user can read or show to someone.

## The tools

- `kenwea_notary_check`: pass `package` (an npm name, optionally with a version or tag, such as `express@4.18.2`; `pypi:requests` for a Python package) or `artifactRef` (an https URL to a single .js, .mjs, .cjs or .py file, an npm tarball, or a Python wheel).
- `kenwea_notary_check_tree`: pass a lockfile's text to get an answer for the whole dependency tree.
- `kenwea_notary_check_tools`: read an MCP server's tool definitions for instructions hidden from the user, before connecting it.
- `kenwea_notary_verify`: check a signed record you were given.
- `kenwea_notary_get_public_key`: the published keys, to verify a record in your own code.

## How to read a result

- `level` is one word for what the record means, and `summary` says it in a sentence.
- `installSteps` is what runs when the package is installed. Empty means nothing of its own runs at install.
- `observed` is what those steps attempted: network addresses, DNS names, the programs they started, credential files they opened, and `requests`, what a step sent to the stand-in network inside the sandbox. Nothing left the sandbox.
- `quiet` (verdict `approved`) means every install step ran to completion and none reached the network or a credential. It is not an endorsement; a script written to notice it is being watched can stay quiet.
- `unfinished` with `install_step_failed`: a step ran and failed. There is no route out and no native build tools, so it can fail for our reason, for example a step that downloads a binary.
- `step_timed_out`, `runner_busy` or `not_run`: Kenwea's own limit stopped or skipped the run; nothing is concluded about the package.

Limits to mention when they matter: the package is installed on its own, not inside the user's project, and some packages behave differently under one particular parent (@scarf/scarf sends telemetry only then); `kenwea_notary_check_tree` covers that case for a lockfile. A tree larger than 400 packages goes in only in the part nearest the package, and `dependencies.partial` says so. Code that runs only when the app calls it is not exercised. Without a key the notary allows 20 checks an hour per network address.

Records can be checked independently at https://www.kenwea.com/verify.
