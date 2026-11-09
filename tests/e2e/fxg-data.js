// fxg-pw.js test data (ds50–ds60): group "Vänner" (16), Milos out at Pitchers (friend, 1 beer), chat runs, members with roles. Mapbox blocked.
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const G = "11111111-2222-3333-4444-555555555555";
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
const AV = (sk, hr, hc, bg, gl) => ({ v: 2, sk, fs: 1, ey: 1, br: 1, mt: 1, hr, hc, fh: 0, hw: 0, gl: gl || 0, up: 1, uc: 3, bg, ms: 1 });
const NAMES = ["Philip", "STRÖM", "Mos", "Ida", "Ida Stina", "Elias swag", "Salle", "Sollén", "Groggen Groth", "Enberg", "Alban"];
const status = () => [
  { name: "oggelito", k: "k1", is_me: false, beers: 0, others: 0, live: false, total: 700, meriter: 818, is_owner: true, is_chief: true, home_town: "Ludvika" },
  { name: "Anton", k: "k0", is_me: true, beers: 0, others: 0, live: false, total: 400, meriter: 420, home_town: "Ludvika" },
  { name: "Robert", k: "k2", is_me: false, beers: 0, others: 0, live: false, total: 300, meriter: 361, home_town: "Ludvika" },
  { name: "Milos", k: "k3", is_me: false, beers: 1, others: 0, live: true, total: 120, meriter: 140, home_town: "Ludvika" },
  ...NAMES.map((n, i) => ({ name: n, k: "kx" + i, is_me: false, beers: 0, others: 0, live: false, total: 50 - i, meriter: 60 - i * 3 }))];
const msgs = [
  { id: 11, name: "oggelito", body: "Var ä ni?", created_at: iso(60), is_me: false },
  { id: 12, name: "oggelito", body: "Jag sitter på Pitchers", created_at: iso(59), is_me: false },
  { id: 13, name: "oggelito", body: "Kom nu!!", created_at: iso(58), is_me: false },
  { id: 14, name: "Anton", body: "Kommer om 10", created_at: iso(50), is_me: true },
  { id: 15, name: "Anton", body: "Ta en stor stark åt mig", created_at: iso(49), is_me: true },
  { id: 16, name: "Milos", body: "Jag ä redan här 🍺", created_at: iso(40), is_me: false },
  { id: 17, name: "Robert", body: "Skål!", created_at: iso(30), is_me: false },
  { id: 18, name: "Robert", body: "Vem tar nästa runda?", created_at: iso(29), is_me: false }];
async function routes(page, o = {}) {
  await page.route(/api\.mapbox\.com|events\.mapbox\.com|tiles\.mapbox\.com/, (r) => r.abort());
  await page.route(/\/hours\.json/, async (r) => {
    const res = await r.fetch(); const d = await res.json(); d.bars = d.bars || {}; d.bars["n3472634175"] = Array(7).fill("0-1440");
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
  });
  await page.route(/rest\/v1\/rpc\/(\w+)/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    if (o.log) o.log.push([fn, body]);
    switch (fn) {
      case "my_groups": return J(r, [{ id: G, name: "Vänner", code: "ABC234", member_count: 15, active_count: 1 }, { id: "22222222-2222-3333-4444-555555555555", name: "Jobbet", code: "XYZ789", member_count: 9, active_count: 0 }]);
      case "group_now": return J(r, { v: 1, now: new Date().toISOString(), members: 15, out: [{ name: "Milos", i: "M", place: "Pitchers", bar_id: "n3472634175", drinks: 1, at: iso(150), me: false }],
        last: { name: "Milos", kind: "checkin", place: "Pitchers", at: iso(150), me: false } });
      case "group_status_v3": case "group_status_v2": case "group_status": return J(r, status());
      case "group_msgs": return J(r, body.p_after_id > 0 ? [] : msgs);
      case "avatars_for": return J(r, { v: 1, people: body.p_group_id ? [
        { k: "k0", name: "Anton", is_me: true, a: AV(1, 3, 3, 3, 1) }, { k: "k1", name: "oggelito", is_me: false, a: AV(2, 5, 1, 2) },
        { k: "k3", name: "Milos", is_me: false, a: AV(0, 2, 0, 1) }, { k: "k2", name: "Robert", is_me: false }] :
        [{ k: "me", name: "Anton", is_me: true, a: AV(1, 3, 3, 3, 1) }, { k: "f3", name: "Milos", is_me: false, a: AV(0, 2, 0, 1) }, { k: "f1", name: "oggelito", is_me: false, a: AV(2, 5, 1, 2) }] });
      case "my_avatar": return J(r, { spec: AV(1, 3, 3, 3, 1), facts: { r: 5 } });
      case "my_friends": return J(r, { code: "K7Q2MXA", friends: [{ id: "f1", name: "oggelito", key: "f1", out: false }, { id: "f3", name: "Milos", key: "f3", out: true, town: "Ludvika" }], incoming: [], outgoing: [] });
      case "near_poll": return J(r, { v: 1, friends: [{ id: "f1", name: "oggelito", key: "f1", out: false }, { id: "f3", name: "Milos", key: "f3", out: true, town: "Ludvika" }], incoming: [], outgoing: [], requests: [] });
      case "friend_list": return J(r, { v: 1, people: [], groups: [] });
      case "group_friend_states": return J(r, { v: 1, states: [{ k: "k1", st: "friend" }, { k: "k3", st: "friend" }] });
      case "live_beers": return J(r, [
        { id: 501, lat: 60.14997, lng: 15.18679, beer_count: 1, precise: true, created_at: iso(150), is_mine: false, friend_name: "Milos", skal_count: 0, i_skaled: false },
        { id: 502, lat: 60.14999, lng: 15.18672, beer_count: 3, precise: true, created_at: iso(50), is_mine: false, friend_name: null, skal_count: 0, i_skaled: false },
        { id: 503, lat: 60.14994, lng: 15.18689, beer_count: 2, precise: true, created_at: iso(40), is_mine: false, friend_name: null, skal_count: 0, i_skaled: false }]);
      case "live_checkins": return J(r, [{ bar_id: "n3472634175", bar_name: "Pitchers", lat: 60.14997, lng: 15.18679, name: "Milos", is_mine: false, is_friend: true, created_at: iso(150) }]);
      case "member_medals": return J(r, [...["m1", "m10", "m50", "m100", "b5", "krogrunda", "stammis", "kung", "pluton", "kompani"].map((m) => ({ name: "oggelito", is_me: false, medal: m, earned_at: iso(60), count: 1 })),
        ...["m1", "m10", "pluton", "stammis"].map((m) => ({ name: "Anton", is_me: true, medal: m, earned_at: iso(60), count: 1 })), ...["m1", "m10"].map((m) => ({ name: "Robert", is_me: false, medal: m, earned_at: iso(60), count: 1 }))]);
      case "post_group_msg": return J(r, { id: 99, created_at: new Date().toISOString() });
      case "safety_state": return J(r, { v: 1, age_ok: true, terms_ver: 1, terms_at: new Date().toISOString(), store: "off", blocks: 0, notices: [] });
      case "my_stats": return J(r, { total: 43, week: 6, title: "Löjtnant Lager", next_title: "Premiärlöjtnant Pilsner", next_at: 52 });
      case "pickup_poll": return J(r, { v: 1, driving: false, incoming: [], mine: null });
      case "create_group": return J(r, { id: "44444444-2222-3333-4444-555555555555", name: body.p_name || "Flogsta", code: "FLX234" });
      case "check_in": return J(r, { ok: true, bar_name: body.p_bar_name || "Pitchers" });
      case "dm_open": return J(r, { id: "33333333-2222-3333-4444-555555555555", group_id: "33333333-2222-3333-4444-555555555555", name: body.p_name || "Milos" });
      default: return r.fallback();
    }
  });
}
module.exports = { routes, G, iso, J };
