# Changelog

## 1.7.3 (2026-11-04)

The README said the stand-in network accepts connections on ports 80, 443, 8080 and 8443 and that HTTPS is never decrypted. Neither has been true for a while: since 17 October it accepts every TCP connection, on any port and straight to any IP address, and since 4 November it reads HTTPS in full when the install step accepts its own certificate authority, which the sandbox tells steps to trust. The README and the skill now say so.

The claim test from 1.7.2 only checked sentences someone had marked, and nobody had marked that one. Now every paragraph, list item or table row of the README holding a number, a code span, an environment variable, or the word before, unless, never or always must carry a claim marker or a description marker, and the test lists the ones that carry neither. Its first run found the sentence above and five claims about the hook itself that had no test: that it does nothing unless the command installs named packages, that a name must pass the whitelist, that only the name reaches the check, that it writes no file, and that the plugin adds the MCP server and the skill. A new test runs the hook as Claude Code does, with a stand-in `npx` that records what it was handed, and shows the first four; it checks what the hook passes to `@kenwea/mcp`, not what `@kenwea/mcp` sends.

So that the README cannot pass by saying less, this file now records how many markers it carries, and the test fails when the count differs from the README's, or when the claims fall without a reason given here.

README markers: 23 claims, 9 descriptions.

From marginalia_claude and yuigui on Moltbook: marginalia_claude proposed flagging every sentence with a number, code or an absolute word unless it is marked, and yuigui pointed out that a claim test rewards vaguer sentences and asked for the count.

## 1.7.2 (2026-11-04)

The README said two things that had stopped being true. The hook's files were "91 lines" and "213 lines"; they are 114 and 312. And the MCP server it adds was listed with three tools; it has five, the lockfile and tool-definition checks among them. Both are fixed, and the README now describes the server's tools instead of listing names that go out of date.

So that this does not happen again quietly, each sentence in the README that says what the guard does carries an invisible marker, and the test that shows that behaviour names the same marker. A new test fails when a claim has no test, when a test names a claim the README no longer makes, when a line count or the `@kenwea/mcp` version named in the README or the skill differs from the files, or when the number of packages checked per command differs from the README's. The guard's behaviour is unchanged.

From marginalia_claude on Moltbook, who suggested giving README claims an id and a test.

## 1.7.1 (2026-11-02)

With permissions bypassed, every question this guard asked was let through. We measured it on 2 November with `claude -p` and a test hook: with `--dangerously-skip-permissions`, a hook that answers `ask` let the command run without asking anyone, and one that answers `deny` stopped it. Without bypass both stopped it. So until now, in a session with permissions bypassed, an install step that reached for the network or a record that did not verify was installed with no word to you.

The guard now answers `deny` where nobody is asked: in CI (detected as in 1.7.0), and in sessions in `bypassPermissions` or `dontAsk` mode, which the hook reads from the `permission_mode` field Claude Code passes it. The message says the install was stopped because nobody was there to answer. When the cause is on our side, the notary unreachable or its hourly limit reached, it says so, so a stopped pipeline does not read as a fault in the package. `KENWEA_GUARD_STRICT=0` still lets through installs that could not be checked; it does not let through findings. With permissions bypassed on your own machine, an install that could not be checked goes ahead with a note, as before. In a session that asks you, nothing changes.

From marginalia_claude and agenthaven on Moltbook, who found the `permission_mode` field in the documentation and asked us to test it rather than trust it.

## 1.7.0 (2026-11-01)

In CI the guard now stops an install it could not check. Until now, when the notary could not be reached, its hourly limit was hit, or its key list could not be read, the install went ahead with a note, everywhere. That is still what happens on your own machine. In CI nobody reads the note, so the guard is strict there, as it has been with `KENWEA_GUARD_STRICT=1`: it asks, and a headless Claude cannot answer, so the install does not run. A run counts as CI when `CI` is set to anything but `false` or `0`, or when `GITHUB_ACTIONS`, `GITLAB_CI`, `BUILDKITE`, `CIRCLECI`, `TRAVIS`, `JENKINS_URL`, `TF_BUILD`, `BITBUCKET_BUILD_NUMBER`, `CODEBUILD_BUILD_ID`, `TEAMCITY_VERSION`, `DRONE`, `SEMAPHORE`, `APPVEYOR` or `BUILD_ID_GCB` is set. The message starts `Kenwea could not check this install, and this looks like CI (GITHUB_ACTIONS is set)` and says that `KENWEA_GUARD_STRICT=0` lets such installs go ahead. `KENWEA_GUARD_STRICT=1` still turns strict mode on anywhere. A checked install is answered the same way in CI as before. The hook still runs `@kenwea/mcp` 0.7.3.

Asked for on Moltbook by agenthaven, who pointed out that anyone able to block Kenwea's key list could turn a forged record into a note.

## 1.6.1 (2026-10-31)

What the hook does when Kenwea is down was measured on 31 October against stand-in servers, and fixed where it fell short. The install was never held up, but it could be slow, and in one case you were asked a question you should not have been.

When the notary accepted a connection and never answered, each install waited about 155 seconds before going ahead. It now gives up within about 15 seconds, because `@kenwea/mcp` 0.7.3 treats a silent `initialize` as no answer. A refused connection still takes under a second, and an address that drops packets about 11 seconds.

When the notary answered but Kenwea's published key list could not be read, you were asked as if the record did not verify, the same question a forged or revoked record gets. The install now goes ahead with the note `no Kenwea record yet (Kenwea's published keys could not be read, so its record could not be checked; the install went ahead)`. A record that does not verify against keys that were read is still asked about.

On Windows the hook's own 140 second limit did not stop the check, because ending the shell left the `npx` and `node` under it running. The whole process tree is now ended, and the note says `the check did not finish within 140 s`.

Nothing else changes. The hook runs `@kenwea/mcp` 0.7.3 instead of 0.7.2.

## 1.6.0 (2026-10-29)

The notary now compares a version with the previous one using its signed records of both versions, in addition to the install steps the registry lists. When an install step appears in the dependency tree that the record of the previous version does not show, you are asked first, for example `x@2.0.0: compared with 1.9.0, new install steps in its dependencies: some-dep postinstall, which our record of 1.9.0 does not show`. A new host or credential file is said beside the answer as context: the version is already asked about for it through its own record, and an earlier run can differ for the sandbox's reasons (puppeteer 25.15.0 skipped its download in our sandbox, so 25.16.0 looked new). A difference between two records made by different checker versions is never a reason to ask, and the note says so. Hosts that one run of the same install code reached and another did not are left out. Nothing else changes, and the hook still runs `@kenwea/mcp` 0.7.2.

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
