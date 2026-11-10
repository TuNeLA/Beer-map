// lane ride (F1): the REAL race on STAGING (never live). Two fresh anonymous drivers call ride_take over HTTP at the same
// moment, N rounds. PASS = in every round exactly one gets ok:true and the other gets {ok:false, code:"taken", name}.
// Needs 0420 on staging. Step 1: `node ride-race-staging.js` signs up two anonymous users and prints {a:{id,jwt}, b:{id,jwt}}.
// Step 2 (SQL, staging, postgres): insert N open v2 rows with to_users = [a.id, b.id], e.g.
//   insert into pickup_reqs (user_id, kind, to_users, v2, status, opened_at, ends_at, pax, pk_lat, pk_lng, pk_place)
//   select '<any user id>', 'skjuts', array['<a.id>','<b.id>']::uuid[], true, 'open', now(), now() + interval '20 minutes', 1, 68.35, 18.80, 'Racetest'
//   from generate_series(1, 12) returning id;
// Step 3: `node ride-race-staging.js go <id,id,…> <a.jwt> <b.jwt>`. Clean up with UPDATE (status 'cancelled', ended_at now()).
const URL = process.env.PN_STAGING_URL || "https://vdtmzsxajpvzwwbhnfmr.supabase.co";
const KEY = process.env.PN_STAGING_KEY || (() => { const s = require("fs").readFileSync(__dirname + "/serve.py", "utf8"); const m = s.match(/STAGING_KEY\s*=\s*os\.environ\.get\("PN_STAGING_KEY",\s*"([^"]+)"/); return m && m[1]; })();
if (/wcdskpcevbhouvbytkhv/.test(URL)) { console.log("FAIL refusing to run against live"); process.exit(1); }
const H = (jwt) => ({ apikey: KEY, authorization: "Bearer " + (jwt || KEY), "content-type": "application/json" });
async function anon() {
  const r = await fetch(URL + "/auth/v1/signup", { method: "POST", headers: H(), body: JSON.stringify({ data: {} }) });
  const j = await r.json(); if (!j.access_token) throw new Error("signup: " + JSON.stringify(j).slice(0, 200));
  return { id: j.user.id, jwt: j.access_token };
}
const take = (jwt, id) => fetch(URL + "/rest/v1/rpc/ride_take", { method: "POST", headers: H(jwt), body: JSON.stringify({ p_id: id }) }).then((r) => r.json());
(async () => {
  const [mode, ids, ja, jb] = process.argv.slice(2);
  if (mode !== "go") { const a = await anon(), b = await anon(); console.log(JSON.stringify({ a, b })); return; }
  let pass = 0, fail = 0;
  for (const id of ids.split(",").map(Number)) {
    const [x, y] = await Promise.all([take(ja, id), take(jb, id)]);
    const wins = [x, y].filter((v) => v && v.ok === true).length;
    const lose = [x, y].find((v) => v && v.ok === false);
    const good = wins === 1 && lose && lose.code === "taken" && !!lose.name;
    console.log((good ? "PASS" : "FAIL") + " race round req " + id + ": one winner, loser sees 'taken' + name", JSON.stringify([x.ok, x.code || "", y.ok, y.code || "", lose && lose.name]));
    good ? pass++ : fail++;
  }
  console.log(`races: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL " + e.message); process.exit(1); });
