import { handle } from "./app.ts";
import { createDb, type Db } from "./db.ts";

const DEFAULT_SCHEMA = "loopbot";
const USER_ID_PATTERN = /^\d+$/;

// Fail at boot, not on the first request, when a secret is missing.
function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing secret: ${name}`);
  return value;
}

// The message is fixed: the error from postgres.js quotes the whole URL, password included.
function allowedUserIds(raw: string): Set<number> {
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const id = Number(part);
      if (!USER_ID_PATTERN.test(part) || !Number.isSafeInteger(id)) throw new Error("invalid LOOPBOT_ALLOWED_USER_IDS");
      return id;
    });
  if (ids.length === 0) throw new Error("invalid LOOPBOT_ALLOWED_USER_IDS");
  return new Set(ids);
}

function connect(dsn: string, schema: string): Db {
  try {
    return createDb(dsn, schema);
  } catch {
    throw new Error("invalid LOOPBOT_DATABASE_URL");
  }
}

const botToken = required("LOOPBOT_BOT_TOKEN");
const allowed = allowedUserIds(required("LOOPBOT_ALLOWED_USER_IDS"));
const schema = Deno.env.get("LOOPBOT_DB_SCHEMA")?.trim() || DEFAULT_SCHEMA;
const db = connect(required("LOOPBOT_DATABASE_URL"), schema);
const deps = {
  botToken,
  allowed,
  db,
  fetch,
  now: () => Math.floor(Date.now() / 1000),
};

Deno.serve((req) => handle(req, deps));
