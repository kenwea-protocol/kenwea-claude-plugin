# Changelog

## 1.5.0 (2026-10-26)

The note "not checked" read like an alarm, or like something was wrong with the package, and for a check that did run it was not even true. The note now says what happened. When the notary could not be reached or its hourly limit was hit, it says `no Kenwea record yet (the notary could not be reached; the install went ahead)`. When the check ran but could not see what runs at install, it says `checked, but the result is inconclusive` with the reason. Errors are said in plain words instead of `check failed: fetch failed`. With `KENWEA_GUARD_STRICT=1` and no record, the question you are asked now starts "Kenwea could not check this install" instead of saying it was checked and signed. What gets asked and what goes ahead is unchanged.

## 1.4.0 (2026-10-25)

A package with no install step of its own, whose dependency runs one, was checked with its whole tree but reported as "not checked". It now says which step ran in its dependencies and what it did, for example `eslint-config-next@15.5.27: nothing of its own runs at install; unrs-resolver@1.12.2 postinstall in its dependencies ran, finished and touched nothing we watch`. When such a step reaches for the network or a credential you are still asked first, and the message names the dependency's step instead of saying the package's own step did it. The hook now runs `@kenwea/mcp` 0.7.2 instead of 0.4.0; its output for a check is the same.

## 1.3.0 (2026-10-16)

The sandbox now has a stand-in network inside it. It answers every lookup and accepts connections on ports 80, 443, 8080 and 8443, so a record says what an install step sent, not only that it tried: plain HTTP in full, HTTPS by server name and size (never decrypted), and any decoy credential a request carried. The note Claude shows includes what was sent.

## 1.2.0 (2026-10-15)

Install steps are traced with eBPF from the host's kernel instead of strace, so they run at normal speed and code with a short timer of its own behaves as it would on your machine. The package is installed with its whole dependency tree, every install step in the tree runs, and the package is loaded once after the install, as an application would load it.

## 1.1.0 (2026-10-15)

Decoy credentials (an npm token, a GitHub token, AWS keys, an SSH key and CI variables) sit where a developer machine keeps real ones. You are asked before the install when a step reads or tries to send one, and when a new version runs something at install that the previous version did not.

## 1.0.2 (2026-10-15)

The decision to ask, note or stay quiet reads the reason code inside the signed record, not the unsigned copy beside it.

## 1.0.1 (2026-10-10)

A plain SVG icon and a privacy policy link.

## 1.0.0 (2026-10-10)

First release: a hook that checks npm packages before Claude installs them, the `kenwea-notary` MCP server, and a skill that tells Claude how to read a record.
