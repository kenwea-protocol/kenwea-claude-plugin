# Releasing

This is the edition Anthropic's plugin directory serves. The directory takes no hook and no script from an organization it has not verified, so this folder holds only Markdown, JSON and a PNG.

1. Run `node --test` (the policy test) and `claude plugin validate . --strict`.
2. Write the CHANGELOG entry.
3. Read README.md and skills/kenwea/SKILL.md against the change and fix what it made false.
4. Export without the tests, push to kenwea-protocol/kenwea-claude-plugin and tag the version:
   `git archive HEAD:packages/claude-plugin -- . ':!test'`
5. In claude.ai/directory/manage, wait for the version to pass the directory policy and the scan, then click Publish update. A reviewer at Anthropic makes it live.

The hook lives in packages/claude-guard, published as kenwea-notary-guard.
