// sec X7: notify-group crashAlertCron sends ONE push to the owner only, and only when crash_alert_claim says send.
// Run: node --experimental-strip-types supabase/tests/sec-crash-alert.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../functions/notify-group/index.ts"), "utf8");
const start = src.indexOf("// ---- sec X7 crash alert (0435) ----");
assert.ok(start >= 0, "crash alert block not found (run sec-patches/02 first)");
const end = src.indexOf("async function cronDue(", start);
const fn = src.slice(start, end);
assert.ok(/const crash = await crashAlertCron\(admin, key\);/.test(src), "cronDue does not call crashAlertCron");
assert.ok(/crash_alert: crash \}\);/.test(src), "cronDue answer has no crash_alert");

const stub = `
type Admin = any;
export const calls: any = { subsOf: [], sendAll: [] };
export let claim: any = null;
export function setClaim(x: any) { claim = x; }
async function keyRpc(_k: string, name: string, _b: unknown) { calls.rpc = name; return { ok: true, status: 200, data: claim }; }
function isUuid(x: unknown): x is string { return typeof x === "string" && /^[0-9a-f-]{36}$/.test(x); }
function cutCp(s: string, n: number): string { return [...s].slice(0, n).join(""); }
async function subsOf(_a: Admin, ids: string[]) { calls.subsOf.push(ids); return ids.map((u, i) => ({ id: i, user_id: u, endpoint: "e" + i, p256dh: "p", auth: "a" })); }
async function sendAll(_a: Admin, jobs: any[], ttl: number, raw: boolean) { calls.sendAll.push({ jobs, ttl, raw }); return { sent: jobs.length, failed: 0 }; }
`;
const tmp = join(mkdtempSync(join(tmpdir(), "seccrash-")), "m.ts");
writeFileSync(tmp, stub + fn.replace("async function crashAlertCron", "export async function crashAlertCron"));
const m = await import(pathToFileURL(tmp).href);
const OWNER = "11111111-2222-4333-8444-555555555555";
let passed = 0;
const t = async (name, f) => { await f(); passed++; console.log("ok -", name); };

await t("claim says no (flag off / below / cooldown) = no push, no subscription read", async () => {
  for (const c of [{ send: false, why: "off" }, { send: false, why: "below", users: 3 }, { send: false, why: "cooldown" }, null, []]) {
    m.setClaim(c);
    assert.equal(await m.crashAlertCron({}, "k"), 0);
  }
  assert.equal(m.calls.rpc, "crash_alert_claim");
  assert.equal(m.calls.subsOf.length, 0);
  assert.equal(m.calls.sendAll.length, 0);
});
await t("send = true: exactly one recipient, the owner, raw (not paced), tag olnu-crash-alert", async () => {
  m.setClaim({ send: true, owner: OWNER, users: 7, top: "TypeError: x is undefined" });
  assert.equal(await m.crashAlertCron({}, "k"), 1);
  assert.deepEqual(m.calls.subsOf.at(-1), [OWNER]);
  const s = m.calls.sendAll.at(-1);
  assert.equal(s.raw, true);
  assert.equal(s.jobs.length, 1);
  const p = JSON.parse(s.jobs[0].payload);
  assert.equal(p.tag, "olnu-crash-alert");
  assert.match(p.title, /7 kraschar/);
  assert.match(p.body, /TypeError/);
});
await t("a bad owner value never sends", async () => {
  const before = m.calls.sendAll.length;
  for (const o of [null, "", "not-a-uuid", 42]) { m.setClaim({ send: true, owner: o, users: 9 }); assert.equal(await m.crashAlertCron({}, "k"), 0); }
  assert.equal(m.calls.sendAll.length, before);
});
console.log(`sec-crash-alert: ${passed} passed`);
