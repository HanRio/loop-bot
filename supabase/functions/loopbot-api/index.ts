import { handle, parseUsernames } from "./app.ts";
import { createDb, type Db } from "./db.ts";

const DEFAULT_SCHEMA = "loopbot";
const USER_ID_PATTERN = /^\d+$/;

// Fail at boot, not on the first request, when a secret is missing.
function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing secret: ${name}`);
  return value;
}

// The message names only the variable: the error from postgres.js quotes the whole URL, password included.
function parseUserIds(raw: string, name: string): number[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const id = Number(part);
      if (!USER_ID_PATTERN.test(part) || !Number.isSafeInteger(id)) throw new Error(`invalid ${name}`);
      return id;
    });
}

function allowedUserIds(raw: string): Set<number> {
  const ids = parseUserIds(raw, "LOOPBOT_ALLOWED_USER_IDS");
  if (ids.length === 0) throw new Error("invalid LOOPBOT_ALLOWED_USER_IDS");
  return new Set(ids);
}

// Optional like the usernames: unset or blank means no admins.
function adminUserIds(): Set<number> {
  return new Set(parseUserIds(Deno.env.get("LOOPBOT_ADMIN_USER_IDS") ?? "", "LOOPBOT_ADMIN_USER_IDS"));
}

// Optional: usernames allowed in addition to the ids. Unset or blank means ids only.
function allowedUsernames(): Set<string> {
  return parseUsernames(Deno.env.get("LOOPBOT_ALLOWED_USERNAMES") ?? "");
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
  allowedUsernames: allowedUsernames(),
  admins: adminUserIds(),
  db,
  fetch,
  now: () => Math.floor(Date.now() / 1000),
};

Deno.serve((req) => handle(req, deps));
