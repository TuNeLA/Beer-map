// X10 load test: simulated PintsNow users on STAGING (never live). One process = one shard of users.
// The call mix is copied from a real app session (capture.js -> capture.json, app at big-update):
//   start burst ~45 calls; then per 30 s poll: poll_v2 + rpc_bundle2 (alternating 12-13 calls / 4 calls, plus a 2-call
//   bundle); every 60 s pnlog_ingest + near_poll; group page open: group_msgs every 10 s, group_now every 30 s;
//   game room open: spel_state every 1.5 s. Rates per user per hour: 2-5 beers, 1-3 chat msgs, 1-2 check-ins, 1 game.
// env: USERS, SHARD, START_AT (ms epoch), END_AT (ms epoch), OUT (jsonl), POOL (optional jsonl of {id,jwt,rt,exp}),
//      SPREAD_S (start spread, default 60), VIS (share of time the app is open, default 0.6)
const fs = require("fs"), os = require("os");
const { URL, H } = require("./common.js");
const BARS = require("./bars.json");
const N = +process.env.USERS || 5, SHARD = process.env.SHARD || "L";
const START_AT = +process.env.START_AT || Date.now() + 5000, END_AT = +process.env.END_AT || START_AT + 180000;
const SPREAD = (+process.env.SPREAD_S || 60) * 1000, VIS = +(process.env.VIS || 0.6);
const OUT = process.env.OUT || __dirname + "/out-" + SHARD + ".jsonl";
const TIMEOUT = 15000;
const out = fs.createWriteStream(OUT, { flags: "a" });
const rec = (o) => out.write(JSON.stringify(o) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const CITIES = [["Stockholm", 59.3326, 18.0649, 0.5], ["Borlange", 60.4858, 15.4371, 0.25], ["Ludvika", 60.1496, 15.1878, 0.25]];
let inflight = 0;

async function http(u, path, body, name) {
  const t0 = Date.now(), ac = new AbortController(); inflight++;
  const tm = setTimeout(() => ac.abort(), TIMEOUT);
  let status = 0, err = null, data = null, appErr = null;
  try {
    const r = await fetch(URL + path, { method: "POST", headers: H(u && u.jwt), body: JSON.stringify(body || {}), signal: ac.signal });
    status = r.status; const txt = await r.text();
    try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
    if (status >= 400) appErr = (data && (data.message || data.msg || data.error_code)) || String(status);
  } catch (e) { err = ac.signal.aborted ? "timeout" : "net:" + String(e.cause && e.cause.code || e.message).slice(0, 60); }
  clearTimeout(tm); inflight--;
  const ms = Date.now() - t0;
  rec({ t: t0, s: SHARD, u: u ? u.i : -1, n: name, ms, st: status, e: err, ae: appErr ? String(appErr).slice(0, 80) : undefined });
  return { status, data, err, appErr, ms };
}
const rpc = (u, n, p) => http(u, "/rest/v1/rpc/" + n, p || {}, n);
async function bundle(u, calls, label) {
  // like the app: one rpc_bundle2 per poll; ~10 % of the time the calls go alone (the "user just tapped" path), which
  // also gives a latency per inner RPC
  if (calls.length < 2 || Math.random() < 0.1) { await Promise.all(calls.map(([n, a]) => rpc(u, n, a))); return; }
  const r = await http(u, "/rest/v1/rpc/rpc_bundle2", { p_calls: calls.map(([n, a]) => ({ k: n + "|" + JSON.stringify(a || {}), n, a: a || {} })) }, "rpc_bundle2" + (label || ""));
  if (r.data && typeof r.data === "object") for (const k of Object.keys(r.data)) {
    const it = r.data[k]; if (it && it.e) rec({ t: Date.now(), s: SHARD, u: u.i, n: "inner:" + k.split("|")[0], ie: String(it.e.code || "") + " " + String(it.e.message || "").slice(0, 60) });
  }
}

async function signUp(i) {
  for (let a = 0; a < 3; a++) {
    const r = await fetch(URL + "/auth/v1/signup", { method: "POST", headers: H(), body: JSON.stringify({ data: { lt: "x10" } }) });
    const j = await r.json().catch(() => ({}));
    if (j.access_token) return { i, id: j.user.id, jwt: j.access_token, rt: j.refresh_token, exp: j.expires_at };
    rec({ t: Date.now(), s: SHARD, u: i, n: "auth_signup", st: r.status, ae: JSON.stringify(j).slice(0, 120) });
    if (r.status === 429) return null;
    await sleep(2000);
  }
  return null;
}
async function refreshTok(u) {
  if (u.exp && u.exp * 1000 - Date.now() > 5 * 60000) return;
  const t0 = Date.now();
  const r = await fetch(URL + "/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: H(), body: JSON.stringify({ refresh_token: u.rt }) }).catch((e) => ({ status: 0 }));
  const j = r.json ? await r.json().catch(() => ({})) : {};
  rec({ t: t0, s: SHARD, u: u.i, n: "auth_refresh", ms: Date.now() - t0, st: r.status });
  if (j.access_token) { u.jwt = j.access_token; u.rt = j.refresh_token; u.exp = j.expires_at; }
}

// ---------- setup: users, names, groups of 3-7 inside the shard ----------
async function setup() {
  let users = [];
  if (process.env.POOL) {
    const lines = fs.readFileSync(process.env.POOL, "utf8").trim().split("\n").map(JSON.parse);
    users = lines.slice(+process.env.POOL_SKIP || 0, (+process.env.POOL_SKIP || 0) + N).map((x, i) => Object.assign({ i }, x, { exp: 0 }));
    for (const u of users) await refreshTok(u);
  } else {
    for (let i = 0; i < N; i++) { const u = await signUp(i); if (!u) break; users.push(u); }
  }
  users = users.filter((u) => u.jwt);
  for (const u of users) {
    const r0 = Math.random(), c = r0 < 0.5 ? CITIES[0] : r0 < 0.75 ? CITIES[1] : CITIES[2];
    u.city = c; u.bars = BARS[c[0]] && BARS[c[0]].length ? BARS[c[0]] : [{ id: "lt-" + c[0], name: c[0] + " bar", lat: c[1], lng: c[2] }];
    u.name = "LT " + SHARD + "-" + u.i;
    await rpc(u, "set_display_name", { p_display_name: u.name });
  }
  // groups: same city, sizes 3-7
  const groups = []; let rest = users.slice();
  while (rest.length) {
    let size = Math.round(rnd(3, 7)); if (rest.length - size < 3 && rest.length - size > 0) size = rest.length;
    const mem = rest.slice(0, size); rest = rest.slice(size);
    const city = mem[0].city; mem.forEach((m) => { m.city = city; m.bars = mem[0].bars; });
    const r = await rpc(mem[0], "create_group", { p_name: "LT x10 " + SHARD + "-" + groups.length, p_display_name: mem[0].name });
    const g = r.data && (r.data.id ? r.data : (typeof r.data === "string" ? JSON.parse(r.data) : null));
    if (!g || !g.id) { rec({ t: Date.now(), s: SHARD, n: "setup_group_fail", ae: JSON.stringify(r.data).slice(0, 120) }); continue; }
    for (const m of mem.slice(1)) await rpc(m, "join_group", { p_code: g.code, p_display_name: m.name });
    mem.forEach((m) => { m.gid = g.id; m.group = mem; });
    groups.push({ id: g.id, mem });
  }
  rec({ t: Date.now(), s: SHARD, n: "setup_done", users: users.length, groups: groups.length });
  return { users, groups };
}

// ---------- one simulated phone ----------
function box(u) {
  const la = u.city[1] + rnd(-0.01, 0.01), ln = u.city[2] + rnd(-0.01, 0.01);
  return { p_min_lat: la - 0.018, p_min_lng: ln - 0.017, p_max_lat: la + 0.018, p_max_lng: ln + 0.017, p_since: null, p_heat: false };
}
const ll = (u) => ({ p_lat: u.city[1], p_lng: u.city[2] });
const BUNDLE_FULL = (u) => [["bar_status"], ["group_etas"], ["medevac_checks"], ["crew_poll", ll(u)], ["my_status"], ["duel_poll"], ["ceremony_poll"],
  ["helg_state"], ["my_meriter", { p_after_id: 0 }], ["near_poll", { p_name: null }], ["golden_horse", ll(u)], ["skal_poll"], ["film_poll"],
  ["my_invites"], ["my_inbox"], ["my_dms"], ["walk_poll"], ["ikvall_status", { p_group_id: u.gid }], ["safety_state", { p_seen: false }],
  ["game_poll"], ["gang_poll"], ["home_status", { p_last: false }], ["ghost_points2"]];
const BUNDLE_A = (u) => [["bar_status"], ["group_etas"], ["game_poll"], ["gang_poll"], ["crew_poll", ll(u)], ["my_status"], ["my_meriter", { p_after_id: 0 }],
  ["skal_poll"], ["film_poll"], ["my_invites"], ["my_inbox"], ["my_dms"]];
const BUNDLE_B = [["group_etas"], ["my_status"], ["duel_poll"], ["my_dms"]];

async function startBurst(u) {
  const c = ll(u);
  await Promise.all([rpc(u, "account_config"), rpc(u, "public_config")]);
  await Promise.all([rpc(u, "poll_v2", box(u)), ...["my_medals", "bars_gone", "guess_night_kind", "after_flags_get", "mark_seen", "my_removals", "my_home_town",
    "ride_flags_get", "my_avatar", "walk_timer_tick", "bold_flags_get", "my_visibility", "award_medals", "my_account_deletion"].map((n) => rpc(u, n)),
    rpc(u, "city_league", { p_week_offset: 0 }), rpc(u, "events_near", Object.assign({ p_days: 7 }, c)), rpc(u, "my_event_chats", { p_seen: {} }),
    rpc(u, "friend_list", { p_name: null }), rpc(u, "bar_sport_near", c), rpc(u, "events_near2", Object.assign({ p_days: 7 }, c)), rpc(u, "my_past_events", { p_limit: 20 })]);
  await Promise.all([bundle(u, BUNDLE_FULL(u), ":full"), rpc(u, "my_passport"), rpc(u, "events_going", { p_ids: [], p_days: 31 }), rpc(u, "user_places", c), rpc(u, "my_groups")]);
  await Promise.all([bundle(u, [["pickup_poll"], ["ghost_points2"]]), rpc(u, "party_mine"), rpc(u, "friend_suggest"), rpc(u, "my_wrapped", { p_kind: "year", p_offset: 0 }),
    rpc(u, "my_board_optin"), rpc(u, "rnd_me"), rpc(u, "group_now", { p_group_id: u.gid }), rpc(u, "group_msgs", { p_group_id: u.gid, p_after_id: 0 }),
    rpc(u, "drivers_for", { p_group_id: u.gid }), rpc(u, "spel_mine")]);
  await bundle(u, [["knuff_inbox"], ["avatars_for", { p_group_id: u.gid }], ["ikvall_status", { p_group_id: u.gid }], ["avatars_for", { p_group_id: null }]]);
}

async function runUser(u, game) {
  const start = START_AT + Math.random() * SPREAD;
  await sleep(start - Date.now());
  if (Date.now() > END_AT) return;
  rec({ t: Date.now(), s: SHARD, u: u.i, n: "user_start" });
  const dur = END_AT - Date.now(), hours = dur / 3600000;
  // event times over this user's run (rates per hour, scaled to the run length)
  const nBeer = Math.max(1, Math.round(rnd(2, 5) * hours)), nChat = Math.max(1, Math.round(rnd(1, 3) * hours));
  const at = (k) => Array.from({ length: k }, () => Date.now() + rnd(0.05, 0.95) * dur).sort((a, b) => a - b);
  const beers = at(nBeer), chats = at(nChat), ciAt = at(Math.max(1, Math.round(1.5 * hours))), coAt = Date.now() + rnd(0.6, 0.95) * dur;
  let visible = true, phaseEnd = Date.now() + rnd(3, 8) * 60000, groupOpen = Math.random() < 0.3;
  let nextPoll = Date.now() + 30000, nextMin = Date.now() + 60000, nextMsgs = Date.now() + 10000, nextNow = Date.now() + 30000, cyc = 0, sq = 1, lastMsg = 0;
  try { await startBurst(u); } catch (e) {}
  while (Date.now() < END_AT) {
    const now = Date.now();
    await refreshTok(u);
    // game: every member of the group joins the room at the group's game time (u.game = shared object)
    if (game && now >= game.at && !u.gameDone) { u.gameDone = true; await playGame(u, game); continue; }
    if (now >= phaseEnd) {
      visible = !visible; phaseEnd = now + (visible ? rnd(3, 8) : rnd(2, 6) * (1 - VIS) / 0.4) * 60000;
      groupOpen = visible && Math.random() < 0.3;
      // back in the app: a warm resume = poll_v2 + the full bundle; ~30 % are cold starts (Android killed the PWA) = the whole start burst
      if (visible) { if (Math.random() < 0.3) await startBurst(u); else await Promise.all([rpc(u, "poll_v2", box(u)), bundle(u, BUNDLE_FULL(u), ":full")]); nextPoll = Date.now() + 30000; }
    }
    if (beers.length && now >= beers[0]) {
      beers.shift(); const b = pick(u.bars);
      await rpc(u, "post_beer_v2", { p_lat: b.lat + rnd(-0.0003, 0.0003), p_lng: b.lng + rnd(-0.0003, 0.0003), p_precise: Math.random() < 0.5, p_hidden: false });
      await rpc(u, "poll_v2", box(u)); visible = true; phaseEnd = Math.max(phaseEnd, Date.now() + 60000);
    }
    if (ciAt.length && now >= ciAt[0]) { ciAt.shift(); const b = pick(u.bars); await rpc(u, "check_in", { p_bar_id: String(b.id), p_bar_name: b.name.slice(0, 60), p_lat: b.lat, p_lng: b.lng }); }
    if (coAt && now >= coAt && !u.co) { u.co = true; await rpc(u, "check_out"); }
    if (chats.length && now >= chats[0]) {
      chats.shift(); const r = await rpc(u, "post_group_msg", { p_group_id: u.gid, p_body: pick(["Skål!", "Var är ni?", "Kommer om 10", "Bärs nu", "En till?", "Kebab sen?"]) });
      if (r.data && r.data.id) lastMsg = r.data.id; await rpc(u, "group_msgs", { p_group_id: u.gid, p_after_id: 0 });
    }
    if (visible) {
      if (now >= nextPoll) {
        nextPoll = now + 30000; cyc++;
        await rpc(u, "poll_v2", box(u));
        await sleep(rnd(1500, 2800));
        if (cyc % 2) { await bundle(u, BUNDLE_A(u), ":a"); await sleep(1500); await bundle(u, [["walk_poll"], ["pickup_poll"]]); }
        else await bundle(u, BUNDLE_B, ":b");
      }
      if (now >= nextMin) {
        nextMin = now + 60000;
        await rpc(u, "pnlog_ingest", { p: { v: 1, t0: now, ver: "loadtest", ch: "beta", sess: "lt" + SHARD + u.i, sq: sq++, cons: false, ev: [{ t: 0, n: "map.cam", p: { z: 14 } }] } });
        await rpc(u, "near_poll", { p_name: null });
      }
      if (groupOpen && now >= nextMsgs) { nextMsgs = now + 10000; await rpc(u, "group_msgs", { p_group_id: u.gid, p_after_id: lastMsg }); }
      if (groupOpen && now >= nextNow) { nextNow = now + 30000; await rpc(u, "group_now", { p_group_id: u.gid }); }
    }
    await sleep(500);
  }
  rec({ t: Date.now(), s: SHARD, u: u.i, n: "user_end" });
}

async function playGame(u, game) {
  const host = game.host === u;
  const r = await rpc(u, "spel_open", { p_group_id: u.gid, p_game: host ? "vem" : null });
  const room = r.data && (r.data.id || (r.data.room && r.data.room.id));
  if (!room) return;
  let v = 0; const end = Date.now() + game.len;
  if (host) { await sleep(8000); await rpc(u, "spel_act", { p_room: room, p_act: "start", p_val: null, p_data: null }); }
  let acts = 0;
  while (Date.now() < end && Date.now() < END_AT) {
    const s = await rpc(u, "spel_state", { p_room: room, p_v: v });
    if (s.data && s.data.v != null) v = s.data.v;
    if (Math.random() < 0.03 && acts < 8) {
      acts++; const ids = (u.group || []).map((m) => m.id);
      await rpc(u, "spel_act", { p_room: room, p_act: "vote", p_val: pick(ids), p_data: null });
      if (host && Math.random() < 0.4) await rpc(u, "spel_act", { p_room: room, p_act: "next", p_val: null, p_data: null });
    }
    await sleep(1500);
  }
  await rpc(u, "spel_act", { p_room: room, p_act: "leave", p_val: null, p_data: null });
}

(async () => {
  if (/wcdskpcevbhouvbytkhv/.test(URL)) process.exit(1);
  let cpu0 = process.cpuUsage(), t0 = Date.now();
  const cpuT = setInterval(() => {
    const c = process.cpuUsage(cpu0), dt = (Date.now() - t0) * 1000; cpu0 = process.cpuUsage(); t0 = Date.now();
    rec({ t: Date.now(), s: SHARD, n: "client_cpu", pct: +(100 * (c.user + c.system) / dt).toFixed(1), load1: os.loadavg()[0], inflight, ncpu: os.cpus().length });
  }, 10000);
  const { users, groups } = await setup();
  // one game per group, 5-8 min, at a random time in the run
  const games = new Map();
  for (const g of groups) {
    const gm = { at: START_AT + SPREAD + rnd(0.1, 0.7) * (END_AT - START_AT - SPREAD), len: rnd(5, 8) * 60000, host: g.mem[0] };
    g.mem.forEach((m) => games.set(m, gm));
  }
  await Promise.all(users.map((u) => runUser(u, games.get(u)).catch((e) => rec({ t: Date.now(), s: SHARD, u: u.i, n: "user_crash", ae: String(e).slice(0, 120) }))));
  clearInterval(cpuT);
  // test data marker for clean-up: the group ids + user ids
  rec({ t: Date.now(), s: SHARD, n: "ids", users: users.map((u) => u.id), groups: groups.map((g) => g.id) });
  out.end(); await new Promise((r) => out.on("finish", r));
})();
