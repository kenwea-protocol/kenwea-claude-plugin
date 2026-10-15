---
name: kenwea
description: >-
  Read and explain Kenwea notary results about npm packages, and check a package or
  file before installing or running it. Use when a Kenwea note or question appears
  before an install, when the user asks whether a package is safe to install or what
  it runs at install time, or mentions install scripts, postinstall, supply chain
  attacks or Kenwea.
---

# Kenwea notary

This plugin checks npm packages before you install them. When you are about to run `npm install`, `pnpm add`, `yarn add` or `bun add` with package names, a hook asks the Kenwea notary first. The notary fetches the exact bytes npm would install, runs the install steps npm would run in a container with no network, no capabilities, a read-only filesystem and no root, traces what each step attempts, and returns a record signed with Kenwea's published Ed25519 key. The record is verified on this machine before anything is said about it.

What the hook does:

- If an install step tried to reach the network, or a record did not verify, the user is asked before the install runs. Explain what the note says and let the user decide. Do not retry the install another way to get around the question.
- If the package runs something at install but reached for nothing, the install goes ahead with a one-line Kenwea note. Mention it to the user when it matters.
- If nothing of the package's own runs at install, the hook says nothing.
- If the notary could not be reached, the install goes ahead with a note that it was not checked. Say so plainly; it is not a pass.

## Checking something yourself

The `kenwea-notary` MCP server comes with this plugin:

- `kenwea.notary.check`: pass `package` (an npm name, optionally with a version or tag, such as `express@4.18.2`) or `artifactRef` (an https URL to a single .js, .mjs, .cjs or .py file, an npm tarball, or a Python wheel or zip).
- `kenwea.notary.verify`: check a signed record you were given.
- `kenwea.notary.getPublicKey`: the published keys, to verify a record in your own code.

From a shell the same check is `npx -y @kenwea/mcp@0.3.1 check <package>`; add `--fail-on install-scripts,network` to make it fail when the package runs anything at install or tries the network.

## How to read a result

- `installSteps` is what runs when the package is installed. Empty means nothing of its own runs at install.
- `observed` is what those steps attempted: network addresses, DNS names and the programs they started.
- `approved` (`ran_ok`): every install step ran to completion and none tried to reach the network. Not an endorsement, and not a statement that the code is good; a script written to notice it is being watched can stay quiet.
- `manual_review` with `ran_tried_network`: a step tried to reach the network. Tell the user what it reached.
- `manual_review` with `install_step_failed`: a step ran and failed. Dependencies are not installed in the check, so this is often for want of one; it is evidence neither way.
- `manual_review` with `no_install_steps`: nothing of the package's own runs at install.
- `manual_review` with `step_timed_out`, `runner_busy` or `not_run`: Kenwea's own limit stopped or skipped the run; nothing is concluded about the package.
- `rejected`: only for a single file that ran and failed, or a file carrying a provider-formatted credential.

Limits to mention when they matter: the check runs the package on its own, not inside your dependency tree, and some packages behave differently as a dependency (@scarf/scarf sends telemetry only then). Code that runs only when your app calls it is not exercised. Without a key the notary allows 20 checks an hour per network address.

Records can be checked independently at https://www.kenwea.com/verify.
