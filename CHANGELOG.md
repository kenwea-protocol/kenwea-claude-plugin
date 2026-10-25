# Changelog

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
