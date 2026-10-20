// Öl Nu v28 — invite reminder cron (.github/workflows/reminders.yml, every 10 min).
// POST <SUPABASE_URL>/functions/v1/notify-group {event:"invite_due"} with:
//   Authorization / apikey = the PUBLIC anon JWT from docs/config.js (passes the gateway's verify_jwt),
//   x-olnu-cron = SUPABASE_SERVICE_ROLE_KEY (the function checks it against a service-role-only RPC; a wrong key → 403).
// The sb_secret_ key never goes into Authorization (it is not a JWT). Local test: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/remind-invites.mjs
import { readFileSync } from "node:fs";
const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !key) { console.error("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
let anon = process.env.SUPABASE_ANON_KEY || "";
if (!anon) {
  try { anon = (readFileSync(new URL("../docs/config.js", import.meta.url), "utf8").match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/) || [])[1] || ""; } catch (e) {}
}
if (!anon) { console.error("no anon key (docs/config.js)"); process.exit(1); }
const ctl = new AbortController();
const tm = setTimeout(() => ctl.abort(), 60000);
const r = await fetch(url + "/functions/v1/notify-group", {
  method: "POST", signal: ctl.signal,
  headers: { "Content-Type": "application/json", apikey: anon, Authorization: "Bearer " + anon, "x-olnu-cron": key },
  body: JSON.stringify({ event: "invite_due" }),
}).catch((e) => { console.error("fetch failed", e.message); process.exit(1); });
clearTimeout(tm);
const text = await r.text();
console.log(new Date().toISOString(), r.status, text.slice(0, 300));
if (!r.ok) process.exit(1);
