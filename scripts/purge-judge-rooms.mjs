#!/usr/bin/env node
// Deletes every judge room: all rows of the byom_rooms table, the only place "bring your own Muse" keeps
// anything. Run it when the expo ends. It never touches the demo room or any other table.
//
//   node scripts/purge-judge-rooms.mjs          counts the rooms and deletes nothing
//   node scripts/purge-judge-rooms.mjs --yes    deletes every judge room, then counts again
//
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env (or the environment). The output shows the
// project host and counts only, never a key. Vercel's own request logs are outside this table and are not
// touched by it.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TABLE = "byom_rooms";

// The whole job, with the client passed in so a test can stand in for Supabase.
export async function purgeJudgeRooms(client, { yes }) {
  const counted = await client.from(TABLE).select("room_key", { count: "exact", head: true });
  if (counted.error) throw new Error(`could not count ${TABLE}: ${counted.error.message}`);
  const before = counted.count ?? 0;
  if (!yes) return { before, deleted: 0, after: before, dryRun: true };

  const removed = await client.from(TABLE).delete({ count: "exact" }).neq("room_key", "");
  if (removed.error) throw new Error(`could not delete from ${TABLE}: ${removed.error.message}`);

  const recounted = await client.from(TABLE).select("room_key", { count: "exact", head: true });
  if (recounted.error) throw new Error(`deleted, but could not recount ${TABLE}: ${recounted.error.message}`);
  return { before, deleted: removed.count ?? 0, after: recounted.count ?? 0, dryRun: false };
}

function readEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(new URL("../.env", import.meta.url), "utf8")
      .split("\n")
      .find((entry) => entry.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^"|"$/g, "") : "";
  } catch {
    return "";
  }
}

async function main() {
  const url = readEnv("SUPABASE_URL");
  const key = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set in .env (or the environment).");
    process.exit(1);
  }
  const yes = process.argv.includes("--yes");
  console.log(`project host: ${new URL(url).host}`);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const result = await purgeJudgeRooms(client, { yes });
    if (result.dryRun) {
      console.log(`${result.before} judge room(s) in ${TABLE}. Nothing deleted; run again with --yes to delete them all.`);
    } else {
      console.log(`deleted ${result.deleted} of ${result.before} judge room(s); ${result.after} remain.`);
      if (result.after !== 0) process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
