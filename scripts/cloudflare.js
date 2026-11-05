import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const config = process.env.XDG_CONFIG_HOME || `${root}.local/cloudflare-config`;
mkdirSync(config, { recursive: true });
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
    ),
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      XDG_CONFIG_HOME: config,
      WRANGLER_LOG_PATH: `${root}.local/wrangler-logs`,
      WRANGLER_SEND_METRICS: "false",
    },
  },
);
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
