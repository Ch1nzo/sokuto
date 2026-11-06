// Production deploy: apply D1 migrations and deploy the Worker.
//
// wrangler.jsonc carries no resource IDs, so `wrangler deploy` finds the D1
// database by name (creating it on the first deploy) and creates or inherits
// the KV namespace. Migrations need the database to exist, so:
// - database already exists: migrate first, then deploy (new code never runs
//   against an old schema);
// - first deploy: deploy (which creates the database), then migrate.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const dbName = config.match(/"database_name"\s*:\s*"([^"]+)"/)?.[1];
if (!dbName) throw new Error("database_name not found in wrangler.jsonc");

const databases = JSON.parse(
  execSync("wrangler d1 list --json", { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
);
const migrate = "wrangler d1 migrations apply DB --remote";

if (databases.some((db) => db.name === dbName)) {
  run(migrate);
  run("wrangler deploy");
} else {
  console.log(`D1 database "${dbName}" does not exist yet; it will be created by wrangler deploy.`);
  run("wrangler deploy");
  run(migrate);
}
