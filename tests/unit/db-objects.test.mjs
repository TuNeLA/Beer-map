// scripts/db/objects.mjs: which objects a migration touches (for the live snapshot = rollback before an MCP apply).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { objectsOf, argTypes, splitStatements, snapshotSql, guardSql, merge } from "../../scripts/db/objects.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIG = path.join(ROOT, "supabase", "migrations");
const mig = (n) => fs.readFileSync(path.join(MIG, fs.readdirSync(MIG).find((f) => f.startsWith(n + "_"))), "utf8");
const fnKeys = (o) => o.functions.map((f) => `${f.name}(${f.sig ?? "*"})`);
const FORBIDDEN = /\b(delete|drop|truncate)\b/i;

test("argTypes: names, defaults, OUT and multi-word types", () => {
  assert.equal(argTypes("p_a uuid, p_b text default null, out x int"), "uuid,text");
  assert.equal(argTypes("timestamp with time zone, p_t timestamp with time zone = now()"), "timestamp with time zone,timestamp with time zone");
  assert.equal(argTypes("double precision, p_x double precision, variadic p_v text[]"), "double precision,double precision,text[]");
  assert.equal(argTypes(""), "");
});

test("splitStatements: dollar quotes, strings and comments keep ; inside", () => {
  const s = splitStatements("select 'a;b'; -- c;d\ncreate function f() returns int language sql as $x$ select 1; $x$; do $$ begin null; end $$;");
  assert.equal(s.length, 3);
});

test("anchor patches by helper call are found (0430, 0470, 0490)", () => {
  assert.ok(fnKeys(objectsOf(mig("0430"))).includes("live_checkins()"));
  assert.ok(fnKeys(objectsOf(mig("0430"))).includes("poll_v2(double precision,double precision,double precision,double precision,timestamp with time zone,boolean)"));
  assert.deepEqual(fnKeys(objectsOf(mig("0470"))), ["my_friends(text)", "olnu_dm_json(uuid,uuid)", "olnu_sug_rows2(uuid)", "unblock_user(text)"]);
  assert.deepEqual(fnKeys(objectsOf(mig("0490"))), ["group_now(uuid)", "my_groups()"]);
});

test("pg_get_functiondef patches in DO blocks (0440, 0475) and full replaces (0321)", () => {
  assert.ok(fnKeys(objectsOf(mig("0440"))).includes("spel_act(uuid,text,text,jsonb)"));
  assert.deepEqual(fnKeys(objectsOf(mig("0475"))), ["olnu_medal_eval(*)"]);
  assert.deepEqual(fnKeys(objectsOf(mig("0321"))), ["olnu_pins(uuid,double precision,double precision,double precision,double precision)"]);
});

test("triggers, cron jobs, tables, global strip_cr", () => {
  const g = objectsOf(mig("0452"));
  assert.deepEqual(g.triggers, ["olnu_game_start_party", "olnu_game_start_spel"]);
  assert.deepEqual(g.tables.map((t) => t.name), ["party_rooms", "spel_rooms"]);
  assert.deepEqual(objectsOf(mig("0402")).cron, ["olnu-account-deletions"]);
  assert.ok(objectsOf(mig("0495")).triggers.includes("olnu_ride_call_end"));   // CREATE TRIGGER inside a DO block
  assert.deepEqual(objectsOf(mig("0436")).global, ["olnu_strip_cr"]);
});

test("policies in any schema (realtime.messages)", () => {
  const o = objectsOf("do $$ begin if not exists (select 1) then create policy pn_x on realtime.messages for select using (true); end if; end $$;");
  assert.deepEqual(o.policies, ["pn_x"]);
  assert.match(snapshotSql(o, "t"), /policyname = any\(array\['pn_x'\]/);
});

test("every release file in order.txt: parse ok, snapshot + guard SQL hold no row/object-removing word", () => {
  const nums = [...new Set(fs.readFileSync(path.join(ROOT, "supabase/release/order.txt"), "utf8").split("\n")
    .map((l) => l.replace(/#.*/, "").trim().split(/\s+/)).filter((p) => p[0] === "release").map((p) => p[1]))];
  const all = nums.map((n) => objectsOf(mig(n)));
  for (const [i, o] of all.entries()) assert.ok(o.functions.length + o.tables.length > 0, `${nums[i]}: nothing found`);
  const m = merge(all);
  assert.doesNotMatch(snapshotSql(m, "all"), FORBIDDEN);
  assert.doesNotMatch(guardSql(m, "all"), FORBIDDEN);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "scripts/db/objects.mjs"), "utf8"), FORBIDDEN);
});

test("0507 chat live nudge: 3 new functions, 3 triggers, the realtime policy; no grant round on hot tables", () => {
  const o = objectsOf(mig("0507"));
  assert.deepEqual(fnKeys(o), ["olnu_live_can(text)", "olnu_live_msg_tg()", "olnu_live_seen_tg()"]);
  assert.deepEqual(o.triggers, ["olnu_zz_live_msg", "olnu_zz_live_seen_i", "olnu_zz_live_seen_u"]);
  assert.deepEqual(o.policies, ["pn_live_chat_read"]);
  assert.ok(o.other.includes("policy target realtime.messages"));
  assert.deepEqual(o.tables.map((t) => `${t.name}:${t.how.join("+")}`), ["dm_state:trigger", "group_msgs:trigger"]);
  const snap = snapshotSql(o, "0507");
  assert.match(snap, /c\.relname = any\(array\[\]::text\[\]\)/);           // group_msgs / dm_state: no revoke + grant round
  assert.match(snap, /t\.tgname = any\(array\['olnu_zz_live_msg','olnu_zz_live_seen_i','olnu_zz_live_seen_u'\]/);
  assert.match(snap, /'enable replica'/);                                         // trigger enable mode kept (O / D / R / A)
  assert.match(snap, /rollback_md5/);
  assert.match(snap, /null::text as jobname[\s\S]*where false/);               // no cron job named: cron.job is not read
});

test("grants + RLS are restored only for tables whose grants / RLS the file changes; merge joins the how lists", () => {
  const a = objectsOf("grant select on table public.t1 to anon; create index i1 on public.t2 (x);");
  assert.match(snapshotSql(a, "x"), /c\.relname = any\(array\['t1'\]::text\[\]\)/);
  const m = merge([objectsOf("create index i on public.t (x);"), objectsOf("alter table public.t enable row level security;")]);
  assert.deepEqual(m.tables, [{ name: "t", how: ["index", "rls"] }]);
});

