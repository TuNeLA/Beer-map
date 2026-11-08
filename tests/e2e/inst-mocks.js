// INST mocks: a full social backend (groups, friends, inbox, avatars, ikväll) with optional RPC latency.
// Used by measure.js and inst-pw.js. lat(fn) → ms delay (deterministic per call number).
const GID = "11111111-2222-3333-4444-555555555555", G2 = "22222222-2222-3333-4444-555555555555";
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const T0 = Date.now();   // server times are stable between calls (only "now" moves)
const iso = (m) => new Date(T0 - m * 60e3).toISOString();
const SEEDS = { Anton: "5e3a91c2", Oskar: "0b77aa10", Lisa: "c4d2e9f1", Nisse: "77aa0012", Ida: "a1b2c3d4" };
const AV = { Oskar: { v: 1, sk: 1, fs: 2, ey: 2, br: 4, mt: 1, hr: 4, hc: 3, fh: 5, hw: 7, gl: 0, up: 4, uc: 0, bg: 8 } };
const person = (n, k) => ({ k, name: n, is_me: n === "Anton", seed: SEEDS[n], a: AV[n] || null, r: n === "Oskar" ? 13 : 4, md: ["m1"] });
function data(fn, body, st) {
  switch (fn) {
    case "my_groups": return [{ id: GID, name: "Ludvika Lager", code: "ABC234", member_count: 5, active_count: st.active == null ? 3 : st.active }, { id: G2, name: "Jobbet", code: "XYZ789", member_count: 9, active_count: 0 }];
    case "group_status_v3": case "group_status_v2": case "group_status": return [
      { name: "Anton", k: "k0", is_me: true, beers: 3, others: 0, live: true, total: 40, meriter: 12 },
      { name: "Lisa", k: "k1", is_me: false, beers: 2, others: 0, live: true, total: 18, meriter: 5 },
      { name: "Oskar", k: "k2", is_me: false, beers: 5 + st.bump, others: 0, live: true, total: 120, meriter: 30 },
      { name: "Nisse", k: "k3", is_me: false, beers: 0, others: 0, live: false, total: 3, meriter: 1 }];
    case "group_msgs": return body.p_after_id > 0 ? [] : [
      { id: 1, name: "Lisa", body: "Va ä ni?", created_at: iso(50), is_me: false },
      { id: 2, name: "Oskar", body: "La Parma!", created_at: iso(40), is_me: false },
      { id: 3, name: "Anton", body: "Kommer", created_at: iso(30), is_me: true }];
    case "group_now": return { v: 1, now: new Date().toISOString(), members: 5, out: [
      { name: "Oskar", i: "O", place: "La Parma Pub & Restaurang", bar_id: null, drinks: 11, at: iso(4), me: false },
      { name: "Anton", i: "A", place: "Pitchers", bar_id: null, drinks: 6, at: iso(20), me: true },
      { name: "Lisa", i: "L", place: null, bar_id: null, drinks: 2, at: iso(35), me: false }],
      last: { name: "Oskar", kind: "beer", place: "La Parma Pub & Restaurang", at: iso(4), me: false } };
    case "my_friends": return { code: "K7Q2MXA", friends: [{ id: "f1", name: "Lisa" }, { id: "f2", name: "Oskar" }, { id: "f3", name: "Ida" }], incoming: [], outgoing: [] };
    case "friend_list": return { v: 1, people: [
      { key: "fk-oskar", name: "Oskar", out: true, friend_id: 1, friend: true, groups: ["Ludvika Lager"] },
      { key: "fk-lisa", name: "Lisa", out: true, friend_id: 2, friend: true, groups: ["Ludvika Lager"] },
      { key: "fk-ida", name: "Ida", out: false, friend_id: 3, friend: true, groups: [] }], groups: [] };
    case "avatars_for":
      if (!body.p_group_id) return { v: 1, people: [person("Anton", "me"), person("Oskar", "fk-oskar"), person("Lisa", "fk-lisa"), person("Ida", "fk-ida")] };
      return { v: 1, people: [person("Anton", "k0"), person("Lisa", "k1"), person("Oskar", "k2"), person("Nisse", "k3")] };
    case "my_avatar": return { v: 1, spec: null, seed: SEEDS.Anton, facts: { mer: 30, r: 5, n: 42, title: "Korpral Korkskruv", next_title: "Skumsergeant", next_at: 40, s: 1, b: 2, t: 1, e: 0, m: ["kung", "m10"] } };
    case "ikvall_status": return { v: 1, night: "2026-11-07", mine: null, counts: { ute: 2, kanske: 1, hemma: 0 }, people: [{ name: "Lisa", st: "ute", friend: true }, { name: "Oskar", st: "ute", friend: true }, { name: "Ida", st: "kanske", friend: true }] };
    case "my_inbox": case "inbox_v1": return { v: 1, now: new Date().toISOString(), items: [
      { k: "friend:5", type: "friend", id: 5, name: "Kalle", home_town: null, at: iso(3) },
      { k: "rally:77", type: "rally", id: 77, group_id: GID, group_name: "Ludvika Lager", name: "Oskar", body: "Alla till La Parma!", place: "La Parma", yes: 2, at: iso(6) },
      { k: "inv:9", type: "inv", id: 9, title: "Pubquiz på Pitchers", starts_at: new Date(Date.now() + 3 * 3600e3).toISOString(), place: "Pitchers", from: "Lisa", group_name: null, at: iso(30) }] };
    case "friend_suggest": return { v: 1, people: [{ k: "0123456789abcdef", name: "Maja", mutual: 3 }, { k: "fedcba9876543210", name: "Erik", mutual: 1 }] };
    case "drivers_for": return { v: 1, drivers: [{ name: "Lisa", k: "k1", is_me: false }] };
    case "pickup_poll": return { v: 1, driving: false, incoming: [], mine: null };
    case "safety_state": return { v: 1, age_ok: true, terms_ver: 1, terms_at: new Date().toISOString(), store: "off", blocks: 0, notices: [] };
    default: return null;
  }
}
// opt: { lat: [min,max] ms or 0, log: array to push [t, fn], bump: () => number (changes Oskar's beers) }
async function routes(page, opt = {}) {
  const st = { n: 0, bump: 0 };
  const L = opt.lat || 0;
  await page.route(/rest\/v1\/rpc\/(\w+)/, async (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    const d = data(fn, body, { bump: opt.bump ? opt.bump() : 0, active: opt.active ? opt.active() : null });
    if (opt.log) opt.log.push([Date.now(), fn]);
    const slow = (opt.latFn ? opt.latFn() : L) && !/^(poll_v2|live_beers|live_others|live_checkins|heat_points|ghost_points)$/.test(fn);
    if (slow) { st.n++; const ms = Array.isArray(L) ? L[0] + ((st.n * 7919) % (L[1] - L[0] + 1)) : L; await new Promise((res) => setTimeout(res, ms)); }
    try { if (d === null) await r.fallback(); else await J(r, d); } catch (e) {}
  });
}
module.exports = { routes, GID, G2 };
