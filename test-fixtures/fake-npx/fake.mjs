// Stands in for npx in hook.test.mjs: records what the hook handed it and
// answers as @kenwea/mcp would for a package with nothing to run at install.
import { appendFileSync } from "node:fs";
appendFileSync(process.env.KW_FAKE_NPX_LOG, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + "\n");
process.stdout.write(JSON.stringify({ checked: true, verdict: "manual_review", reasonCode: "no_install_steps", installSteps: [] }) + "\n");
