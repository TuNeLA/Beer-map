// lane fixS T-01 LIVE check on STAGING only (never live): a full block from the DM really hides the person.
// Usage: node fixs-staging.js        (needs network to the staging project; NOT in run-all.sh / CI on purpose: it makes users)
// Two fresh anonymous users at 68.35 / 18.80 (the test zone). A and B: friends by code + one shared group + a DM.
// A blocks B from the DM the way the app does now (block_user person + DM group, then dm_block). Then, as B: no friend,
// no group-mate pin of A, no "Du kanske känner" A, friend request refused, no DM thread, DM closed; then A unblocks
// (Inställningar → Blockerade → Häv) and the DM-only block is gone too (0470). Clean-up: UPDATE only (stop_beer); the test group and users stay on staging.
const fs = require("fs"), path = require("path");
const SRV = fs.readFileSync(path.join(__dirname, "serve.py"), "utf8");
const URL0 = process.env.PN_STAGING_URL || (SRV.match(/STAGING_URL\s*=\s*os\.environ\.get\("PN_STAGING_URL",\s*"([^"]+)"/) || [])[1];
const KEY = process.env.PN_STAGING_KEY || (SRV.match(/STAGING_KEY\s*=\s*os\.environ\.get\("PN_STAGING_KEY",\s*"([^"]+)"/) || [])[1];
if (!URL0 || !/vdtmzsxajpvzwwbhnfmr/.test(URL0) || !KEY) { console.log("FAIL no staging url/key (this test runs on staging only)"); process.exit(2); }
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : JSON.stringify(i === undefined ? "" : i).slice(0, 500)); c ? pass++ : fail++; };
const LAT = 68.35, LNG = 18.80;
async function http(p, body, tok, method) {
  const r = await fetch(URL0 + p, { method: method || "POST", headers: { apikey: KEY, authorization: "Bearer " + (tok || KEY), "content-type": "application/json" }, body: body == null ? undefined : JSON.stringify(body) });
  const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
  return { ok: r.ok, status: r.status, d };
}
async function user(name) {
  const a = await http("/auth/v1/signup", { data: { test: true, name } });
  if (!a.ok || !a.d || !a.d.access_token) throw new Error("signup failed " + a.status + " " + JSON.stringify(a.d).slice(0, 200));
  return { name, tok: a.d.access_token, id: a.d.user && a.d.user.id };
}
const rpc = (u, fn, args) => http("/rest/v1/rpc/" + fn, args || {}, u.tok);
const box = { p_min_lat: LAT - 0.02, p_min_lng: LNG - 0.04, p_max_lat: LAT + 0.02, p_max_lng: LNG + 0.04, p_since: null, p_heat: false };
const tag = Math.random().toString(36).slice(2, 6);

(async () => {
  const A = await user("FixsA" + tag), B = await user("FixsB" + tag);
  console.log("users", A.id, B.id);
  let grp = null, dm = null;
  try {
    // friends by code
    await rpc(A, "my_friends", { p_name: A.name });
    const fc = await rpc(A, "my_friend_code", {});
    const code = fc.d && (fc.d.code || (typeof fc.d === "string" ? fc.d : null));
    const fr = await rpc(B, "friend_request", { p_code: code, p_name: B.name });
    let fid = fr.d && fr.d.id;
    if (fr.d && fr.d.status !== "accepted") { const ans = await rpc(A, "friend_answer", { p_id: fid, p_accept: true, p_name: A.name }); ok("setup: A accepts B", ans.ok, ans.d); }
    const fb0 = await rpc(B, "my_friends", { p_name: B.name });
    ok("setup: B has A in Mina vänner", fb0.ok && (fb0.d.friends || []).some((f) => f.name === A.name), fb0.d);
    // one shared group + A's pin in the test zone
    const cg = await rpc(A, "create_group", { p_name: "Fixs " + tag, p_display_name: A.name });
    grp = cg.d && (cg.d.id || (Array.isArray(cg.d) && cg.d[0] && cg.d[0].id)); const gcode = cg.d && (cg.d.code || (Array.isArray(cg.d) && cg.d[0] && cg.d[0].code));
    const jg = await rpc(B, "join_group", { p_code: gcode, p_display_name: B.name });
    ok("setup: B joins A's group", cg.ok && jg.ok, { cg: cg.d, jg: jg.d });
    const pb = await rpc(A, "post_beer_v2", { p_lat: LAT, p_lng: LNG, p_precise: true, p_hidden: false });
    ok("setup: A has a pin at 68.35/18.80", pb.ok, pb.d);
    const p0 = await rpc(B, "poll_v2", box);
    const seen0 = p0.ok && (p0.d.pins || []).some((p) => p.friend_name === A.name);
    ok("setup: B sees A's pin with the name (group mate)", seen0, p0.ok ? (p0.d.pins || []).filter((p) => Math.abs(p.lat - LAT) < 0.01).slice(0, 3) : p0.d);
    // the DM, then the block the way the app does it now (dm.js setBlock(true, true))
    const fl = await rpc(A, "friend_list", { p_name: A.name });
    const bkey = ((fl.d && fl.d.people) || []).filter((p) => p.name === B.name).map((p) => p.key)[0];
    const op = await rpc(A, "dm_open", { p_key: bkey, p_name: A.name });
    dm = op.d && op.d.group_id;
    ok("setup: A opens a DM with B", !!dm, op.d);
    const bu = await rpc(A, "block_user", { p_kind: "person", p_ref: null, p_group: dm, p_k: null, p_on: true });
    const db = await rpc(A, "dm_block", { p_group_id: dm, p_on: true });
    ok("T-01 A blocks B from the DM: block_user + dm_block ok", bu.ok && db.ok, { bu: bu.d, db: db.d });
    // as B
    const fb = await rpc(B, "my_friends", { p_name: B.name });
    ok("T-01 B: A is not in Mina vänner (friendship ended)", fb.ok && !(fb.d.friends || []).some((f) => f.name === A.name), fb.d);
    const flb = await rpc(B, "friend_list", { p_name: B.name });
    ok("T-01 B: A is not in friend_list (friends + group mates)", flb.ok && !((flb.d && flb.d.people) || []).some((p) => p.name === A.name), flb.d);
    const p1 = await rpc(B, "poll_v2", box);
    ok("T-01 B: no pin of A any more (also not as a group mate)", p1.ok && !(p1.d.pins || []).some((p) => p.friend_name === A.name), p1.ok ? (p1.d.pins || []).filter((p) => Math.abs(p.lat - LAT) < 0.01).slice(0, 3) : p1.d);
    const sg = await rpc(B, "friend_suggest", {});
    ok("T-01 B: A is not in Du kanske känner", sg.ok && !JSON.stringify(sg.d).includes(A.name), sg.d);
    const rq = await rpc(B, "friend_request", { p_code: code, p_name: B.name });
    ok("T-01 B: a new friend request to A is refused (not 'accepted already')", !rq.ok && /friend_not_found/.test(JSON.stringify(rq.d)), rq);
    const md = await rpc(B, "my_dms", {});
    ok("T-01 B: the DM thread is gone from Meddelanden", md.ok && !((md.d && md.d.threads) || []).some((t) => t.group_id === dm), md.d);
    const ds = await rpc(B, "dm_seen", { p_group_id: dm, p_last_id: 0 });
    ok("T-01/T-23 B: the DM is closed for B (can_write false, blocked_me)", ds.ok && ds.d.can_write === false && ds.d.blocked_me === true, ds.d);
    const da = await rpc(A, "dm_seen", { p_group_id: dm, p_last_id: 0 });
    ok("0470 A: the DM knows it is a full block (full_block true)", da.ok && da.d.blocked_by_me === true && da.d.full_block === true, da.d);
    // A: Inställningar → Blockerade → Häv
    const mb = await rpc(A, "my_blocks", {});
    const bid = ((mb.d && mb.d.blocks) || []).filter((b) => b.name === B.name).map((b) => b.id)[0];
    const ub = await rpc(A, "unblock_user", { p_id: bid });
    const da2 = await rpc(A, "dm_seen", { p_group_id: dm, p_last_id: 0 });
    ok("T-01 Häv works and also opens the DM-only block (0470)", ub.ok && da2.ok && da2.d.blocked_by_me === false, { ub: ub.d, dm: da2.d });
    const p2 = await rpc(B, "poll_v2", box);
    ok("T-01 after Häv: B sees A's group-mate pin again", p2.ok && (p2.d.pins || []).some((p) => p.friend_name === A.name), p2.ok ? (p2.d.pins || []).length : p2.d);
  } catch (e) { ok("crash " + (e && e.message), false); }
  finally {
    // clean-up: UPDATE only (the pin off); the anon users and their test group stay (staging, test zone)
    try { await rpc(A, "stop_beer", {}); } catch (e) {}
  }
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
