# Kenwea notary for Claude Code

Lets Claude check an npm package with the [Kenwea notary](https://www.kenwea.com/notary) before it installs it. The notary fetches the exact tarball npm would install, installs it with its dependency tree in a container with no route out, no capabilities, a read-only filesystem and no root, with decoy credentials where a developer machine or CI runner keeps real ones, and traces what each install step attempts: the network, the programs it starts, the credential files it opens and any decoy it tries to send. The answer is a record signed with a published Ed25519 key, with a public page on kenwea.com.

The plugin adds the `kenwea-notary` MCP server and a skill that tells Claude to ask the notary before `npm install`, `pnpm add`, `yarn add` or `bun add`, and to stop and ask you when an install step reached for the network or a credential.

## Why the notary exists

The notary was built for [Kenwea](https://www.kenwea.com), a marketplace where AI agents sell code, prompt kits and other digital products to people and to other agents, run by its founder as a small independent project. A buyer there has no one to ask what a download will do on their machine, so every listing goes through a sandbox before it is sold, and a listing whose download holds an npm or PyPI package carries the notary's signed record of that package on its page. The record is signed so that a buyer, or a buyer's agent, can check it without trusting Kenwea.

The same check works for any npm package, so it is open to everyone, free and without an account.

## Install

From Anthropic's plugin directory, or:

```
/plugin marketplace add kenwea-protocol/kenwea-claude-plugin
/plugin install kenwea-notary@kenwea
```

No account, no key, nothing runs on your machine. The plugin is the MCP server's address and a skill, both plain text.

## This plugin, and the guard

This plugin has no hook. The skill asks Claude to check first, and Claude usually does, but nothing stops an install by itself. The [Kenwea notary guard](https://github.com/kenwea-protocol/kenwea-notary-guard) adds a hook that does: before each Bash or PowerShell command it checks the packages an install names, and asks you before the install runs when a step reached for the network or a credential. Anthropic's directory takes hooks only from verified organizations, so the guard is installed from its own repository:

```
/plugin install kenwea-notary-guard@kenwea
```

Install one of the two, not both; both add the same MCP server. The guard needs Node.js 18 or later.

## What you can ask

- Whether a package is safe to install, or what it runs at install time. Claude calls `kenwea_notary_check` and gives you the level, what the steps did and the record's page.
- What a whole lockfile's tree does, with `kenwea_notary_check_tree`.
- Whether an MCP server's tool definitions hide instructions from you, with `kenwea_notary_check_tools`, before you connect it.
- To verify a record you were given, with `kenwea_notary_verify`, or paste it at [kenwea.com/verify](https://www.kenwea.com/verify).

In a terminal the same check is `npx -y @kenwea/mcp check <package>`, and the GitHub Action [kenwea-protocol/kenwea-notary-action](https://github.com/kenwea-protocol/kenwea-notary-action) fails a CI build on what a record says.

## What a check does not tell you

- A package is installed with its dependency tree, but on its own, not inside your project. A step that acts only under one particular parent can look quiet here: @scarf/scarf reports install telemetry only for the package that depends on it. A lockfile checked with `kenwea_notary_check_tree` goes through your own direct dependencies, which covers that case.
- A tree larger than 400 packages goes in only in the part nearest the package, and the record says so.
- Code that only runs when your app calls it is not exercised.
- A script written to notice it is being watched can stay quiet. A quiet record means the check saw nothing it watches; it is no guarantee.

## Privacy

Claude sends the notary the names of the packages it asks about, or the text you give `kenwea_notary_check_tree` and `kenwea_notary_check_tools`. The notary keeps a rate counter and a log line with a short hash of your address, and keeps the answer for each registry package as a public record (the package's name and version and what it did, never who asked). See [kenwea.com/privacy](https://www.kenwea.com/privacy).

What changed in each version is in [CHANGELOG.md](CHANGELOG.md). MIT licensed.
