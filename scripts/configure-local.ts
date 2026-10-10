import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
const root = path.resolve(import.meta.dirname, "..");
const local = path.join(root, ".local"); mkdirSync(local, { recursive: true });
const file = path.join(root, ".env");
if (!existsSync(file)) {
  const password = randomBytes(24).toString("hex");
  writeFileSync(file, ["NODE_ENV=development", "AIHOT_ENVIRONMENT=development", "DEV_AUTH_ROLE=admin", "DEV_AUTH_DISPLAY_NAME=本地研究者",
    `DATABASE_URL=postgres://paperpulse:${password}@127.0.0.1:5545/paper_pulse`, "API_PORT=4321", "WEB_PORT=5320", "API_HOST=127.0.0.1", "WEB_HOST=127.0.0.1",
    "API_BASE_URL=http://127.0.0.1:4321", "SITE_URL=http://127.0.0.1:5320", `SESSION_SECRET=${randomBytes(32).toString("hex")}`,
    `IMG_PROXY_SIGN_SECRET=${randomBytes(32).toString("hex")}`, "COLLECT_ENABLED=false", "MODEL_CALLS_ENABLED=false", "FEISHU_CONTENT_PUSH_ENABLED=false",
    "INDEXNOW_SUBMIT_ENABLED=false", "TRUST_PROXY=false", "AIHOT_RELEASE=paperpulse-reading-1", ""].join("\n"));
}
const contents = readFileSync(file, "utf8"); const env = parseEnv(contents);
const db = new URL(env.DATABASE_URL!);
// This helper belongs to the isolated localhost development deployment only.
if (db.hostname !== "127.0.0.1" || db.port !== "5545" || db.pathname !== "/paper_pulse") throw new Error("Local setup expects the independent localhost:5545/paper_pulse database");
if (!existsSync(path.join(local, "db.env"))) writeFileSync(path.join(local, "db.env"), `POSTGRES_USER=${decodeURIComponent(db.username)}\nPOSTGRES_PASSWORD=${decodeURIComponent(db.password)}\nPOSTGRES_DB=paper_pulse\n`);
if (!existsSync(path.join(root, ".env.test"))) writeFileSync(path.join(root, ".env.test"), `DATABASE_URL=${env.DATABASE_URL!.replace(/\/paper_pulse$/, "/paper_pulse_test")}\nNODE_ENV=test\n`);
console.log("Local configuration ready (credentials not printed)");
