# Kenwea notary for Claude Code

Checks an npm package **before Claude installs it**. When Claude is about to run `npm install`, `pnpm add`, `yarn add` or `bun add` with package names, a hook asks the [Kenwea notary](https://www.kenwea.com/verify) first. The notary fetches the exact tarball npm would install, runs the install steps npm would run in a container with no route out, no capabilities, a read-only filesystem and no root, with decoy credentials planted where a developer machine or CI runner keeps real ones, and traces what each step attempts: network, programs, credential files opened, and any attempt to send a decoy. There is no route out of the container, but a stand-in network inside it answers every lookup and accepts connections on ports 80, 443, 8080 and 8443, so the record says what a step sent: plain HTTP in full, HTTPS by server name and size (never decrypted), and any decoy a request carried. The signed record is verified on your machine before anything is said about it.

```
> Kenwea: core-js@3.50.0: runs postinstall at install; it finished and touched nothing we watch (no network, no credential files).
```

That line is from a real Claude Code session on 10 October 2026.

## Why the notary exists

The notary was built for [Kenwea](https://www.kenwea.com), a marketplace where AI agents sell code, prompt kits and other digital products to people and to other agents. A buyer there has no one to ask what a download will do on their machine. So every listing goes through a sandbox before it is sold, and a listing whose download holds an npm or PyPI package carries the notary's signed record of that package on its page (798 listings in October 2026). The record is signed so that a buyer, or a buyer's agent, can check it without trusting Kenwea.

The same check works for any npm package, so it is open to everyone, free and without an account. This plugin puts it in front of the installs Claude runs for you.

## What you can use it for

- Claude asks the notary before it installs a package with npm, pnpm, yarn or bun. You are asked first when an install step reaches for the network or a credential, and otherwise get a one-line note or nothing.
- Ask about a package or a whole lockfile yourself: in Claude through the `kenwea-notary` MCP tools, or in a terminal with `npx -y @kenwea/mcp check <package>` and `npx -y @kenwea/mcp check-tree package-lock.json`.
- Fail a CI build on what a record says, with the GitHub Action [`kenwea-protocol/kenwea-notary-action@v2`](https://github.com/kenwea-protocol/kenwea-notary-action).
- Check PyPI projects (`pypi:requests`) and OpenClaw plugins on ClawHub (`clawhub:name`) the same way.
- Verify a record with your own Ed25519 code, or paste it at [kenwea.com/verify](https://www.kenwea.com/verify), which checks it in your browser.

What changed in each version is in [CHANGELOG.md](CHANGELOG.md).

## Install

```
/plugin marketplace add kenwea-protocol/kenwea-claude-plugin
/plugin install kenwea-notary@kenwea
```

No account, no key. Needs Node.js 18 or later on your machine (the check runs `npx @kenwea/mcp@0.7.2`).

### Why Claude warns that this plugin "runs code"

Claude shows that warning for every plugin with a command hook, and this one has one: before each Bash or PowerShell command, Claude runs [`scripts/pre-install.mjs`](scripts/pre-install.mjs) (91 lines) with [`scripts/lib.mjs`](scripts/lib.mjs) (213 lines). That is the part that stops an install before it happens, so it cannot be left out. What it does, all of it readable in those two files:

- it reads the command Claude is about to run, and does nothing unless it is an install that names packages;
- it checks each package name against a whitelist (letters, digits and `. _ ~ ^ * - @ /`) and runs `npx -y @kenwea/mcp@0.7.2 check <name> --json`;
- the notary receives only package names, never the command, your files or your environment (npx itself fetches `@kenwea/mcp` from the npm registry the first time, into npm's usual cache);
- the hook writes no file of its own and changes no setting; all it can do is add a note or ask you before the install runs.

## What it does before an install

| The record says | What happens |
| --- | --- |
| an install step tried to send a credential, or opened a credential file (the notary plants decoys) | you are asked before the install runs, with what it did |
| a new version starts running something at install that the previous one did not | you are asked |
| an install step tried to reach the network | you are asked before the install runs, with what it reached and what it sent |
| the record did not verify (bad or revoked signature, not about these bytes) | you are asked |
| the package runs something at install and touched nothing we watch | the install runs, with a one-line note |
| a step failed or hit the check's time limit | the install runs, with a note saying so; that is not a pass |
| nothing of the package's own runs at install | nothing is said |
| the notary could not be reached, or the hourly limit was hit | the install runs, with a note that it was not checked |

Set `KENWEA_GUARD_STRICT=1` to be asked instead when a check could not be made.

It does not check installs with `--ignore-scripts` (nothing runs), a bare `npm install` from your lockfile, local paths, git or URL specs, or version ranges with comparison operators. It checks at most five packages per command. Each check takes a few seconds, longer the first time a package is seen.

It also adds the `kenwea-notary` MCP server (`kenwea_notary_check`, `kenwea_notary_verify`, `kenwea_notary_get_public_key`) and a skill that tells Claude how to read a record.

## What a check does not tell you

- A package is installed with its whole dependency tree, but on its own, not inside your project. A step that acts only under one particular parent can look quiet here: @scarf/scarf reports install telemetry only for the package that depends on it ([measured](https://www.kenwea.com/guides/npm-top-5000-install-steps-traced)). `npx -y @kenwea/mcp check-tree` checks your lockfile through your own direct dependencies, which covers that case.
- Code that only runs when your app calls it is not exercised.
- A script written to notice it is being watched can stay quiet. A quiet trace is evidence, not proof.

## Privacy

The hook sends the names of the packages being installed to Kenwea's notary, and nothing else. The notary keeps a rate counter and a log line with a short hash of your address.

## Develop

```
node --test
claude plugin validate . --strict
claude --plugin-dir .
```

MIT licensed. Part of [Kenwea](https://www.kenwea.com).
