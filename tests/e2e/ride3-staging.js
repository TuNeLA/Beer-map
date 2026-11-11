// lane ride3: a REAL two-user ride on STAGING (never live) over HTTP, with the app's poll rhythm (ride v3, 0495):
// an idle "Jag kör" driver asks ride_stamp_get every 5 s; an open request / offer asks it every 2.5 s; a live ride polls
// ride_poll every 2.5 s on both sides. It measures, in real time, how long each change takes to show on the other side.
// Step 1: `node ride3-staging.js setup` → signs up two anonymous users, prints {r:{id,jwt}, d:{id,jwt}}.
// Step 2 (SQL, staging, postgres): make them friends + ride flags on, e.g.
//   insert into friendships (a, b, requester, status, via, accepted_at) values (least(r,d), greatest(r,d), r, 'accepted', 'code', now());
//   update ride_flags set on_ = true where key in ('ride_v2','ride_v2_more');
// Step 3: `node ride3-staging.js go <r.jwt> <d.jwt>`. Positions at 68.35 / 18.80 (test area). Clean up with UPDATE only
// (flags back off; the ride ends itself with Klar).
const URL = process.env.PN_STAGING_URL || "https://vdtmzsxajpvzwwbhnfmr.supabase.co";
const KEY = process.env.PN_STAGING_KEY || (() => { const s = require("fs").readFileSync(__dirname + "/serve.py", "utf8"); const m = s.match(/STAGING_KEY\s*=\s*os\.environ\.get\("PN_STAGING_KEY",\s*"([^"]+)"/); return m && m[1]; })();
if (/wcdskpcevbhouvbytkhv/.test(URL)) { console.log("FAIL refusing to run against live"); process.exit(1); }
const H = (jwt) => ({ apikey: KEY, authorization: "Bearer " + (jwt || KEY), "content-type": "application/json" });
async function anon() {
  const r = await fetch(URL + "/auth/v1/signup", { method: "POST", headers: H(), body: JSON.stringify({ data: {} }) });
  const j = await r.json(); if (!j.access_token) throw new Error("signup: " + JSON.stringify(j).slice(0, 200));
  return { id: j.user.id, jwt: j.access_token };
}
const rpc = (jwt, fn, b) => fetch(URL + "/rest/v1/rpc/" + fn, { method: "POST", headers: H(jwt), body: JSON.stringify(b || {}) }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(fn + ": " + JSON.stringify(j).slice(0, 200)); return j; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const T = {};
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, i === undefined ? "" : JSON.stringify(i)); c ? pass++ : fail++; };
// one phone: a loop with the app's rhythm. tick = stamp mode; full = ride_poll. Returns the latest ride answer.
function phone(jwt, args) {
  const p = { last: null, stamp: null, mode: "idle", stop: false, polls: 0, stamps: 0 };
  p.full = async () => { const j = await rpc(jwt, "ride_poll", args); p.polls++; p.last = j.ride; return j.ride; };
  (async () => {
    while (!p.stop) {
      const live = p.mode === "live", ms = live ? 2000 : p.mode === "open" ? 2000 : 5000;
      await sleep(ms); if (p.stop) break;
      try {
        if (live) await p.full();
        else { const s = await rpc(jwt, "ride_stamp_get"); p.stamps++; if (s.s !== p.stamp) { p.stamp = s.s; await p.full(); } }
      } catch (e) { console.log("poll error", e.message); }
    }
  })();
  return p;
}
async function until(p, f, max) { const t0 = Date.now(); while (Date.now() - t0 < (max || 20000)) { if (p.last && f(p.last)) return Date.now() - t0; await sleep(50); } return -1; }

(async () => {
  const [mode, jr, jd] = process.argv.slice(2);
  if (mode !== "go") { const r = await anon(), d = await anon(); console.log(JSON.stringify({ r, d })); return; }
  await rpc(jd, "driver_set", { p_on: true });
  const D = phone(jd, { p_lat: 68.351, p_lng: 18.801, p_ghost: false }), R = phone(jr, { p_lat: null, p_lng: null, p_ghost: false });
  await D.full(); await R.full(); D.stamp = (await rpc(jd, "ride_stamp_get")).s; R.stamp = (await rpc(jr, "ride_stamp_get")).s;
  await sleep(1000 + Math.random() * 4000);   // the request comes at a random point of the driver's 5 s rhythm
  // request with a destination
  let t0 = Date.now();
  const req = await rpc(jr, "ride_request2", { p_lat: 68.3500, p_lng: 18.8000, p_place: "Testkrogen", p_pax: 2, p_note: null, p_name: "Lisa (test)",
    p_dest_lat: 68.3620, p_dest_lng: 18.8400, p_dest_name: "Hem", p_dest_area: "Testområdet", p_dest_kind: "home" });
  R.mode = "open"; T.request_ms = Date.now() - t0;
  const id = req.id;
  const seen = await until(D, (r) => (r.offers || []).some((o) => o.id === id && o.can_take));
  T.request_to_driver_ms = seen < 0 ? -1 : seen + T.request_ms;
  const off = (D.last.offers || []).find((o) => o.id === id) || {};
  ok("staging: an idle 'Jag kör' driver sees the request ≤ 5.5 s (stamp every 5 s)", seen >= 0 && T.request_to_driver_ms <= 5500, { ms: T.request_to_driver_ms });
  ok("staging: the offer shows the destination AREA + trip, not the exact point or name", off.dest && off.dest.area === "Testområdet" && off.dest.lat == null && off.dest.name == null && off.dest.trip_m > 0, off.dest);
  D.mode = "open";
  // take → rider
  t0 = Date.now(); await rpc(jd, "ride_take", { p_id: id }); D.mode = "live";
  T.take_to_rider_ms = await until(R, (r) => r.mine && r.mine.id === id && r.mine.status === "taken"); R.mode = "live";
  // steps → rider
  for (const [st, key] of [["enroute", "enroute_to_rider_ms"], ["arrived", "arrived_to_rider_ms"]]) {
    await sleep(1000 + Math.random() * 2000);
    await rpc(jd, "ride_step", { p_id: id, p_step: st });
    T[key] = await until(R, (r) => r.mine && r.mine.status === st);
  }
  // rider chat + "Jag sitter i bilen" → driver
  await sleep(1200);
  await rpc(jr, "ride_msg", { p_id: id, p_text: "Står vid ingången" });
  T.msg_to_driver_ms = await until(D, (r) => r.drive && (r.drive.msgs || []).some((m) => !m.me && m.body === "Står vid ingången"));
  await sleep(900);
  await rpc(jr, "ride_step", { p_id: id, p_step: "picked" });
  T.picked_to_driver_ms = await until(D, (r) => r.drive && r.drive.step_at && !!r.drive.step_at.picked);
  await sleep(1500);
  await rpc(jd, "ride_step", { p_id: id, p_step: "done" });
  T.done_to_rider_ms = await until(R, (r) => r.mine && r.mine.status === "done");
  for (const k of ["take_to_rider_ms", "enroute_to_rider_ms", "arrived_to_rider_ms", "msg_to_driver_ms", "picked_to_driver_ms", "done_to_rider_ms"])
    ok("staging: " + k.replace(/_ms$/, "").replace(/_/g, " ") + " ≤ 3 s", T[k] >= 0 && T[k] <= 3000, { ms: T[k] });
  D.stop = R.stop = true;
  await rpc(jd, "driver_set", { p_on: false });
  console.log("TIMINGS " + JSON.stringify(T) + " calls " + JSON.stringify({ d_polls: D.polls, d_stamps: D.stamps, r_polls: R.polls, r_stamps: R.stamps }));
  console.log(`ride3-staging: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL " + e.message); process.exit(1); });
