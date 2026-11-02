import { handle } from "./app.ts";
import { createDb } from "./db.ts";

const SCHEMA = "loopbot";

// Fail at boot, not on the first request, when a secret is missing.
function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing secret: ${name}`);
  return value;
}

const botToken = required("LOOPBOT_BOT_TOKEN");
const allowed = new Set(required("LOOPBOT_ALLOWED_USER_IDS").split(",").map((id) => Number(id.trim())));
const db = createDb(required("LOOPBOT_DATABASE_URL"), SCHEMA);
const deps = {
  botToken,
  allowed,
  db,
  fetch,
  now: () => Math.floor(Date.now() / 1000),
};

Deno.serve((req) => handle(req, deps));
