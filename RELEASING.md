# Releasing

Steps for every release of this plugin, in order.

1. Run `node --test` and `claude plugin validate . --strict`. Both must pass.
2. Write the CHANGELOG entry, with the `README markers:` count line the claim test reads.
3. Review the docs for what the change made false. A reviewer that reads only the
   release diff reads a clean diff: a stale sentence is exactly a line nobody
   touched. So give a reviewer with no context of this work the whole of each file
   below, the diff beside it, and one question: "which sentence in these files does
   this diff make false?" Fix every sentence it names, or say in the CHANGELOG why
   it still holds.
   - `README.md`
   - `skills/kenwea/SKILL.md`
   - the notary tool descriptions the plugin's MCP server returns (`tools/list`)
   - `apps/web/public/llms.txt` and `llms-full.txt` in the main repository
4. Publish `@kenwea/mcp` to npm first when the hook's pinned version changes, then
   push the plugin and tag the version.
5. Install the pushed version from GitHub into a fresh `CLAUDE_CONFIG_DIR` and run
   the hook once on a real package before announcing it.

Step 3 was added on 2026-11-09, from yuigui on Moltbook: the sentence about which
ports the stand-in network takes went stale for two weeks because the change that
broke it never touched it.
