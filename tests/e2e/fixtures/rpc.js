// Shared RPC answers for the mocked e2e suite (d2-helpers.js + ds-helpers.js use them before their "default: []").
// One calm Friday night in Ludvika: group "Ludvika Lager" (Anton = me, Oskar, Lisa, Nisse), 2 friends, no film shot yet,
// no game room open. A test that needs other data routes that RPC itself (its page.route wins over these).
// answer(fn, body, ctx) → the JSON to send, or undefined (= not mocked: the helpers record it, rpc-cover-pw.js fails on it).
// Keep the shapes in step with docs/js (the reader of each RPC is named in the comment).
const GID = "11111111-2222-3333-4444-555555555555", GID2 = "22222222-2222-3333-4444-555555555555";
const ME_K = "aaaaaaaaaaaa";

function nightEnd(now) { const d = new Date(now); if (d.getHours() >= 6) d.setDate(d.getDate() + 1); d.setHours(6, 0, 0, 0); return d.toISOString(); }

function build(now) {
  const iso = (m) => new Date(now - m * 60e3).toISOString();
  const members = [   // social.js groupStatus() (v3 = v2 + meriter + rank), spel-ui.js, near.js, hitta.js
    { name: "Oskar", k: "bbbbbbbbbbbb", is_me: false, beers: 11, others: 0, other_kind: null, live: true, total: 312, meriter: 40, rank: 1, home_town: "Ludvika", can_remove: false },
    { name: "Anton", k: ME_K, is_me: true, beers: 6, others: 1, other_kind: "rom", live: true, total: 43, meriter: 12, rank: 2, home_town: "Ludvika", can_remove: false },
    { name: "Lisa", k: "cccccccccccc", is_me: false, beers: 2, others: 2, other_kind: "vin", live: true, total: 18, meriter: 5, rank: 3, home_town: null, can_remove: false },
    { name: "Nisse", k: "dddddddddddd", is_me: false, beers: 0, others: 0, other_kind: null, live: false, total: 1, meriter: 0, rank: 4, home_town: null, can_remove: false }];
  const friends = [{ id: "f1", k: "cccccccccccc", name: "Lisa" }, { id: "f2", k: "bbbbbbbbbbbb", name: "Oskar" }];
  const room = (game) => ({ v: 1, id: "room-1", group_id: GID, game: game || "kort", game_no: 1, round: 0, goal: 5, phase: "lobby", left: null,
    players: members.filter((m) => m.live).map((m) => ({ k: m.k, name: m.name, is_me: m.is_me, on: true, done: false, judge: false, pts: 0 })),
    me: { k: ME_K, name: "Anton", mine: null }, pub: {} });
  return {
    group_status_v3: () => members,
    group_status_v2: () => members.map(({ meriter, rank, ...m }) => m),
    group_friend_states: () => ({ v: 1, states: members.filter((m) => !m.is_me).map((m) => ({ k: m.k, name: m.name, s: friends.some((f) => f.k === m.k) ? "friend" : "none" })) }),   // friends2.js
    my_friends: () => ({ code: "K7Q2MXA", friends, incoming: [], outgoing: [] }),          // profile.js, near.js, warm.js
    friend_list: () => ({ v: 1, people: friends.map((f) => ({ k: f.k, name: f.name, friend: true })), groups: [{ id: GID, name: "Ludvika Lager" }] }),   // hemfolj.js, invite.js, skjuts.js
    friend_suggest: () => ({ v: 1, people: [] }),                                           // suggest.js
    ikvall_status: () => ({ v: 1, night: nightEnd(now), mine: "ute", counts: { ute: 3, kanske: 1, hemma: 0 },   // pnui.js
      people: [{ name: "Lisa", st: "ute", friend: true }, { name: "Oskar", st: "ute", friend: true }, { name: "Ida", st: "kanske", friend: false }] }),
    safety_state: () => ({ v: 1, age_ok: true, terms_ver: 1, terms_at: iso(9999), store: "off", blocks: 0, notices: [] }),   // safety.js
    my_avatar: () => ({ v: 1, spec: null, seed: "5e3a91c2", facts: { r: 8, m: [] } }),     // avatar.js (no spec = the default face)
    avatars_for: () => ({ v: 1, people: members.map((m) => ({ k: m.is_me ? "me" : m.k, name: m.name, is_me: m.is_me })) }),
    // 📸 engångskamera: nobody has shot tonight (cam-pw.js routes its own night)
    film_poll: () => ({ v: 2, now: new Date(now).toISOString(), night: nightEnd(now), develop_at: nightEnd(now), groups: [], rolls: [] }),   // film.js
    film_state: () => ({ now: new Date(now).toISOString(), night: nightEnd(now), develop_at: nightEnd(now), mine: 0, left: 10, max: 10, group_n: 0, group_max: 60, shooters: 0, keeps: false, rolls: [] }),   // filmcam.js
    // 🎉 spel: no room open; opening a room game gives its lobby
    spel_mine: () => ({ v: 1, room: null }),                                                // spel.js
    spel_open: (b) => room(b && b.p_game),                                                  // spel-ui.js setView()
    spel_state: () => ({ same: true }),                                                     // spel-ui.js poll()
    spel_act: () => room("kort"),
    drivers_for: () => ({ v: 1, drivers: [{ name: "Lisa", k: "cccccccccccc", is_me: false }] }),
    pickup_poll: () => ({ v: 1, driving: false, incoming: [], mine: null }),
    my_push_prefs: () => ({ v: 1, off: [], quiet_from: null, quiet_to: null, cap: 0, cap_default: 15, cats: ["ute", "chat", "dm", "plan", "kaos", "bar", "kul", "vanner", "film"], tonight: 2 }),
    // --- Topp, Profil, a bar sheet ---
    meriter_board: () => [{ name: "Oskar", is_me: false, meriter: 40, rank: 1 }, { name: "Anton", is_me: true, meriter: 12, rank: 2 }],   // meriter.js
    kebab_top: () => ({ v: 1, town: "Ludvika", list: [] }),                                  // gang.js
    my_places: () => ({ v: 1, bars_n: 3, towns_n: 1, bars: [], towns: [] }),                  // gw.js
    bar_extra: () => ({ v: 1 }),                                                              // barinfo.js (no override / extra info)
    bar_norm: () => ({ v: 1, bars: {} }),                                                     // pnui.js (no usual crowd known)
    bar_photos: () => ({ v: 1, group: [], public: [] }),                                      // barfoto.js
    crew_dance_bar: () => ({ v: 1 }),                                                         // crew.js
    // --- the group card / group page (warm.js "gcard" recipe) ---
    chief_state: () => ({ v: 1, now: new Date(now).toISOString() }),                          // chief.js (no request open)
    skal_state: () => ({ v: 1, now: new Date(now).toISOString() }),                           // skal.js (no skåltimme)
    squad_group: () => ({ v: 1 }),                                                            // near.js (no squad)
    party_group: () => ({ v: 1, room: null }),                                                // spel.js (no party room)
    rnd_group: () => ({ v: 1 }),                                                              // rundan.js
    spel_group: () => ({ v: 1, room: null }),                                                 // spel.js / spel-ui.js (no room running)
    ikvall_prompt_get: () => ({ v: 1, on: false }),                                           // gw.js (weekend question off)
    // --- polls and lists the main screens ask at boot: a calm night, nothing new (reader in docs/js named) ---
    group_now: () => ({ v: 1, now: new Date(now).toISOString(), members: 4, out: [   // gpage.js paintNow()
      { name: "Oskar", i: "O", place: "La Parma Pub & Restaurang", bar_id: null, drinks: 11, at: iso(4), me: false },
      { name: "Anton", i: "A", place: "Pitchers", bar_id: null, drinks: 6, at: iso(20), me: true },
      { name: "Lisa", i: "L", place: null, bar_id: null, drinks: 2, at: iso(35), me: false }],
      last: { name: "Oskar", kind: "beer", place: "La Parma Pub & Restaurang", at: iso(4), me: false } }),
    my_inbox: () => ({ v: 1, now: new Date(now).toISOString(), items: [] }),                    // inbox.js
    my_dms: () => ({ v: 1, threads: [] }),                                                    // dm.js
    my_event_chats: () => ({ v: 1, chats: [] }),                                              // evchat.js
    my_invites: () => ({ v: 1, invites: [] }),                                                // invite.js
    my_past_events: () => ({ v: 1, events: [] }),                                             // evgroup.js
    events_going: () => ({ v: 1, events: [] }),                                               // evsheet.js
    events_near2: () => ({ v: 1, server_time: new Date(now).toISOString(), events: [] }),     // evsheet.js
    bar_sport_near: () => ({ v: 1, bars: [] }),                                               // sport.js
    ceremony_poll: () => ({ v: 1, groups: [] }),                                              // ceremony.js
    gang_poll: () => ({ v: 1, groups: [] }),                                                  // gang.js
    skal_poll: () => ({ v: 1, now: new Date(now).toISOString(), hours: [], fired: [] }),      // skal.js
    near_poll: () => ({ v: 1, squads: [], friends_in: [], find_in: [] }),                     // near.js
    walk_poll: () => ({ v: 1, mine: null, walks: [] }),                                       // hemfolj.js
    walk_timer_tick: () => ({ v: 1, mine: null, alerts: [], push: [] }),                      // gw.js
    party_mine: () => ({ v: 1, room: null }),                                                 // party.js
    my_board_optin: () => ({ v: 1, on: false, name: null }),                                  // boards.js
    my_home_town: () => ({ v: 1, town: null }),                                               // hometown.js (nf-pw.js routes its own)
    my_passport: () => ({ v: 1, bars: [] }),                                                  // passport.js
    crew_poll: () => null,                                                                    // crew.js (no crew = null)
    game_poll: () => ({ v: 1 }),                                                              // games.js (no "me" = no game tonight)
    duel_poll: () => ({ v: 1 }),                                                              // duel.js
    golden_horse: () => ({ v: 1 }),                                                           // golden.js
    helg_state: () => ({ v: 1 }),                                                             // helg.js
    my_meriter: () => ({ v: 1 }),                                                             // meriter.js (no meriter field = nothing new)
    my_wrapped: () => ({ v: 1 }),                                                             // after.js (warm prefetch)
    rnd_me: () => ({ v: 1 }),                                                                 // rnd.js (warm prefetch)
    guess_night_kind: () => "",                                                               // games.js ("folk" = guess game on)
    mark_seen: () => ({ ok: true }),                                                          // chief.js
    pnlog_ingest: () => ({ ok: true }),                                                       // pnlog.js (telemetry)
    public_config: () => ({ v: 3, support: "support@pintsnow.com", visning: "off", terms_ver: 1, store_mode: "off", mapbox_token: null }),
    account_config: () => ({ v: 1 }),
    my_visibility: () => ({ v: 1, friends_only: false }),                                   // pnvis.js (Alla · Bara vänner · Spöke)
    // spel-ui.js launchSync(): same dates as its PN_LAUNCH fallback, so "Nytt" does not change with the mock
    game_launch_dates: () => ({ v: 1, games: { kort: "2026-11-07", vem: "2026-11-07", aldrig: "2026-11-07", hellre: "2026-11-07", quiz: "2026-11-07", kung: "2026-11-07" } }),
  };
}

// RPCs where an empty answer ([] / no rows) is the right calm-night answer. They count as mocked.
const EMPTY = new Set(["my_rallies", "live_others", "ghost_points", "ghost_points2", "my_blocks", "group_etas", "bars_gone",
  "beer_reactions", "friend_totals", "my_medals", "award_medals", "member_medals",
  "bar_areas_in", "bar_status", "my_group_flags", "beer_type_stats", "bar_regulars", "city_league", "events_near", "home_status", "knuff_inbox", "medevac_checks", "my_removals", "my_status", "user_places",
  // poll_v2: [] on purpose = "old server", so the app reads live_beers / live_checkins, which the helpers and many tests mock.
  // strip-test.js and speed-pw.js answer poll_v2 themselves (the new path). Do not answer it here without moving those tests.
  "poll_v2"]);

// rpc_bundle2 (app.js bundleGo, 0297): body { p_calls: [{ k, n, a }] } → { <k>: { d: <answer> } | { e: { code, message } } }.
// Each inner call is answered from this table; a name this table does not know gets { e: { code: "not_bundled" } }, so the app
// sends that call alone (and the helpers / the test's own route answer it). d2-helpers / ds-helpers answer rpc_bundle2 before
// this (they send each inner call through the page routes, so a test's own route wins); this one is for other callers.
function bundle(body, ctx) {
  const o = {};
  ((body && body.p_calls) || []).forEach((c) => {
    const a = c && c.n && c.n !== "rpc_bundle2" ? answer(c.n, c.a || {}, ctx) : undefined;
    o[c.k] = a === undefined ? { e: { code: "not_bundled", message: "not_bundled" } } : { d: a };
  });
  return o;
}

function answer(fn, body, ctx) {
  if (fn === "rpc_bundle2") return bundle(body, ctx);
  const t = (ctx && ctx.now) || Date.now();
  const f = build(t)[fn];
  if (f) return f(body || {});
  if (EMPTY.has(fn)) return [];
  return undefined;
}
module.exports = { answer, EMPTY, GID, GID2, ME_K, names: () => Object.keys(build(Date.now())).concat([...EMPTY], ["rpc_bundle2"]) };
