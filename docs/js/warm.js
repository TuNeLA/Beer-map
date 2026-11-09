/* PintsNow — WARM (instant screens; owner 2026-11-07: "It should already be loaded … I don't want to feel like anything
   is loading"). Data + render-timing layer only. No new buttons, no new RPC, no extra polling.
   1. Warm cache (stale-while-revalidate) inside app.js rpc(): the last answer of each READ call (stable SQL, no
      writes) is kept per user in memory + localStorage (small, with a timestamp, dropped at 05:00 and after 20 min).
      In a RENDER WINDOW (a tap, a sheet that opens) a READ call with a cached answer resolves AT ONCE from the cache
      (same task → the screen paints complete in its first frame) and the network call runs in the background.
      Outside a render window (polls, timers, after a write) a call goes to the network first, as before, and only
      stores its answer. Any write RPC marks the whole cache "dirty": the next read waits for the server again.
   2. Changed answer: when the background call brings different data, window "olnu:warm" fires
      ({fn, params, data}) and app.js mods("onWarm", fn, params, data) lets a module patch its open screen in place.
   3. Prefetch on intent: a "recipe" = the READ calls a tap made last time (per tap target: #btn-groups, a tab, a
      group card …), kept in localStorage. pointerdown on that target replays the recipe (before the click), an open
      sheet replays the recipes of its tabs and group cards when the browser is idle, and the shared poll wave
      (onPoll) refreshes the Grupper recipes when they are older than 3 min (max one small batch per 3 min).
   4. Hold until complete: a sheet that opens keeps its body at opacity 0 (the sheet frame itself still slides in)
      until its render-window calls are back and the DOM inside is still for 2 frames (max 120 ms warm, 650 ms cold),
      then shows it in one step. The body keeps the height it had last time (min-height) while it waits, so the
      sheet never grows in steps. prefers-reduced-motion: same, without the 120 ms fade.
   5. Old data is never shown as live: an answer older than 2 min shows a quiet "Uppdaterad för N min sedan" pill
      (absolute, no layout) until the fresh answer is in.
   Public: window.WARM = { rpc, get, prefetch, replay, beginSheet, endSheet, onPoll, stats, clear }. */
(function () {
  "use strict";
  var W = window;
  // Stable (read-only) SQL functions used by the social screens. Checked in the migrations: provolatile 's'.
  var READ = {
    my_groups: 1, my_event_chats: 1, my_dms: 1, my_friends: 1, friend_suggest: 1, friend_list: 1, my_inbox: 1,
    my_group_flags: 1, chief_state: 1, party_group: 1, squad_group: 1, skal_state: 1, group_now: 1, group_msgs: 1,
    rnd_group: 1, drivers_for: 1, ikvall_status: 1, my_wrapped: 1, my_board_optin: 1, rnd_me: 1, avatars_for: 1,
    my_avatar: 1, group_status: 1, group_status_v2: 1, group_status_v3: 1, my_stats: 1, my_medals: 1, my_meriter: 1,
    group_league: 1, bar_regulars: 1, bar_extra: 1, bar_norm: 1, member_medals: 1, my_home_town: 1
  };
  // Calls that never change what these screens show (map poll, counters): they do not make the cache dirty.
  var QUIET = {
    poll_v2: 1, live_beers: 1, live_others: 1, live_checkins: 1, heat_points: 1, ghost_points: 1, bar_kings: 1,
    award_medals: 1, public_config: 1, spel_group: 1, crew_dance_bar: 1, bar_photos: 1, city_league: 1, record_bar: 1, beer_reactions: 1, friend_totals: 1,
    my_rallies: 1, safety_state: 1, pickup_poll: 1, vitals_log: 1, log_vitals: 1, my_push_state: 1
  };
  // ds59: writes that the read-like name rule (…_group) would miss: they always make the cache dirty
  var WRITES = { join_group: 1, create_group: 1, leave_group: 1, rename_group: 1, kick_member: 1, set_display_name: 1, friend_remove: 1, friend_answer: 1, dm_open: 1 };
  var READLIKE = /^(my_|live_|heat|ghost|poll|events_|guess_|golden|bars?_)|(_poll|_state|_status|_near\d*|_get|_preview|_list|_for|_mine|_checks|_etas|_group|_places|_passport|_kind|_in|_feed|_top|_league|_stats)$/;
  var lastGesture = 0;
  ["pointerdown", "keydown"].forEach(function (ev) { document.addEventListener(ev, function (e) { if (e.isTrusted) lastGesture = now(); }, { capture: true, passive: true }); });
  var FRESH_MS = 15000, OLD_MS = 120000, MAX_MS = 20 * 60e3, WIN_MS = 700, IDLE_REFRESH_MS = 300000, SIB_MS = 60000;
  var LS_D = "olnu.warm.d1", LS_R = "olnu.warm.r1", MAX_KEYS = 70, MAX_BYTES = 180000, MAX_RECIPES = 40;
  var stats = { hit: 0, miss: 0, net: 0, reval: 0, changed: 0, dirty: 0, pre: 0, hold: 0, holdMs: 0, dirtyBy: {} };
  var mem = null, recipes = null, inflight = {}, uid = null, uidAt = 0, winUntil = 0, curTrig = null, saveT = 0;
  var oldServed = 0;
  // ds52: these screens patch themselves when the fresh answer comes (gpage.onWarm, app.js my_groups): after a write they
  // may show the cached answer at once (4 s after the write) and always re-fetch it.
  var STALE_OK = { group_now: 1, group_msgs: 1, avatars_for: 1 }, dirtyAt = 0;   // not my_groups: a left / new group must show at once

  function now() { return Date.now(); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function reduced() { try { return !!(W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  // Night key: tonight's data turns over at 05:00 local time.
  function night(t) { var d = new Date(t - 5 * 3600e3); return d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate(); }
  function user() {
    if (uid && now() - uidAt < 5000) return uid;
    uidAt = now();
    try { var s = JSON.parse(lsGet("olnu.auth") || "null"); uid = s && s.user && s.user.id ? String(s.user.id) : null; } catch (e) { uid = null; }
    return uid;
  }
  function stable(v) {
    if (v == null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    return "{" + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ":" + stable(v[k]); }).join(",") + "}";
  }
  function keyOf(fn, params) { var u = user(); if (!u) return null; try { return u.slice(0, 8) + "|" + fn + "|" + stable(params || {}); } catch (e) { return null; } }

  /* ---------- store ---------- */
  function load() {
    if (mem) return mem;
    mem = {};
    try {
      var o = JSON.parse(lsGet(LS_D) || "null"), u = user(), t = now();
      if (o && o.u === u && o.e) Object.keys(o.e).forEach(function (k) { var e = o.e[k]; if (e && t - e.at < MAX_MS && e.n === night(t)) mem[k] = e; });
    } catch (e) { mem = {}; }
    return mem;
  }
  function save() {
    if (saveT) return;
    saveT = setTimeout(function () {
      saveT = 0;
      var t = now(), keys = Object.keys(mem).filter(function (k) { var e = mem[k]; return !e.dirty && t - e.at < MAX_MS && e.n === night(t); })
        .sort(function (a, b) { return mem[b].at - mem[a].at; }).slice(0, MAX_KEYS);
      var out = {}, bytes = 0;
      keys.forEach(function (k) { var e = mem[k]; if (bytes + e.s.length > MAX_BYTES) return; bytes += e.s.length; out[k] = { at: e.at, n: e.n, s: e.s }; });
      lsSet(LS_D, JSON.stringify({ u: user(), e: out }));
    }, 400);
  }
  // Same data? The server clock ("now") changes on every answer: it never counts as a change.
  function canon(s) { return String(s).replace(/"now":"[^"]*",?/g, ""); }
  function put(k, s) {
    load();
    var e = mem[k], changed = !e || canon(e.s) !== canon(s);
    mem[k] = { at: now(), n: night(now()), s: s };
    save();
    return changed;
  }
  function get(fn, params) {
    var k = keyOf(fn, params); if (!k) return null;
    var e = load()[k]; if (!e || e.dirty || now() - e.at >= MAX_MS || e.n !== night(now())) return null;
    try { return { data: JSON.parse(e.s), age: now() - e.at }; } catch (x) { return null; }
  }
  function dirtyAll() { load(); Object.keys(mem).forEach(function (k) { mem[k].dirty = 1; }); stats.dirty++; dirtyAt = now(); }
  function clear() { mem = {}; inflight = {}; lsSet(LS_D, null); }

  /* ---------- recipes (the READ calls one tap made) ---------- */
  function loadR() { if (recipes) return recipes; try { recipes = JSON.parse(lsGet(LS_R) || "{}") || {}; } catch (e) { recipes = {}; } if (recipes.u !== user()) recipes = { u: user(), r: {} }; return recipes; }
  var rSaveT = 0;
  function saveR() { if (rSaveT) return; rSaveT = setTimeout(function () { rSaveT = 0; var r = loadR(), ks = Object.keys(r.r); if (ks.length > MAX_RECIPES) ks.sort(function (a, b) { return r.r[a].at - r.r[b].at; }).slice(0, ks.length - MAX_RECIPES).forEach(function (k) { delete r.r[k]; }); lsSet(LS_R, JSON.stringify(r)); }, 600); }
  function record(fn, params) {
    if (!curTrig) return;
    var r = loadR(), x = r.r[curTrig.k];
    if (!x || x.at < curTrig.at) x = r.r[curTrig.k] = { at: curTrig.at, c: [] };
    var s = stable(params || {});
    if (x.c.length < 14 && !x.c.some(function (c) { return c[0] === fn && c[1] === s; })) { x.c.push([fn, s]); saveR(); }
  }
  // A tap target → a short stable key ("#btn-groups", "tab:f", "gcard:Ludvika Lager", "btn|Profil" …).
  function trigOf(t) {
    var b = t && t.closest ? t.closest("button, [role=button], [role=tab], a[href], li.gcard, summary") : null;
    if (!b) return null;
    if (b.id) return "#" + b.id;
    if (b.classList.contains("gcard")) return "gcard:" + (b.getAttribute("aria-label") || "").slice(0, 40);
    var dt = b.getAttribute("data-t");
    if (dt && b.closest(".inv-tabs")) return "tab:" + dt;
    var cls = String(b.className || "").split(/\s+/).filter(function (c) { return c && !/^(btn|btn-small|on|active|sm-|av)$/.test(c); })[0] || b.tagName.toLowerCase();
    var lab = (b.getAttribute("aria-label") || b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 28);
    return cls + ":" + lab;
  }

  /* ---------- the rpc wrapper (app.js) ---------- */
  function inWin() { return now() < winUntil; }
  function openWin(ms) { winUntil = Math.max(winUntil, now() + (ms || WIN_MS)); }
  function settle(k, p) {
    inflight[k] = p;
    p.then(function () { if (inflight[k] === p) delete inflight[k]; }, function () { if (inflight[k] === p) delete inflight[k]; });
    return p;
  }
  var oldKeys = {};
  function network(fn, params, raw, k) {
    var p = raw(fn, params).then(function (r) {
      if (oldKeys[k]) { delete oldKeys[k]; if (!Object.keys(oldKeys).length) hideOld(); }
      if (r && !r.error && r.data !== undefined) {
        var s; try { s = JSON.stringify(r.data); } catch (e) { s = null; }
        if (s != null && s.length < 60000) {
          var had = load()[k], changed = put(k, s);
          if (changed && had && had.served) { stats.changed++; emit(fn, params, s); }
        }
      }
      return r;
    });
    return settle(k, p);
  }
  function emit(fn, params, s) {
    var d = null; try { d = JSON.parse(s); } catch (e) {}
    try { W.dispatchEvent(new CustomEvent("olnu:warm", { detail: { fn: fn, params: params || null, data: d } })); } catch (e) {}
  }
  function copyRes(r) { if (!r || r.error) return r; try { return { data: JSON.parse(JSON.stringify(r.data)), error: null, status: r.status }; } catch (e) { return r; } }
  function rpc(fn, params, raw) {
    if (!READ[fn]) {
      // A write the USER made (a tap or a key in the last 2.5 s) makes the cache dirty. Background polls and the
      // read-like calls a screen makes while it opens do not (they never change what these screens show).
      if (!QUIET[fn] && (WRITES[fn] || (now() - lastGesture < 2500 && !READLIKE.test(fn)))) { dirtyAll(); stats.dirtyBy[fn] = (stats.dirtyBy[fn] || 0) + 1; }
      return raw(fn, params);
    }
    var k = keyOf(fn, params);
    if (!k) return raw(fn, params);
    if (inWin()) record(fn, params);
    var e = load()[k], t = now();
    var usable = e && (!e.dirty || (STALE_OK[fn] && t - dirtyAt > 4000)) && t - e.at < MAX_MS && e.n === night(t);
    if (usable && inWin()) {
      stats.hit++;
      e.served = 1;
      if (t - e.at > OLD_MS && inWin()) { oldServed = Math.max(oldServed, t - e.at); oldKeys[k] = 1; }
      if ((e.dirty || t - e.at > FRESH_MS) && !inflight[k]) { stats.reval++; network(fn, params, raw, k); }
      var d; try { d = JSON.parse(e.s); } catch (x) { d = null; }
      return Promise.resolve({ data: d, error: null, status: 200, warm: t - e.at });
    }
    if (inflight[k]) { stats.miss++; if (inWin()) pend(inflight[k]); return inflight[k].then(copyRes); }
    stats.miss++; stats.net++;
    var p = network(fn, params, raw, k);
    if (inWin()) pend(p);
    return p;
  }

  /* ---------- prefetch ---------- */
  var RAW = null;   // app.js gives the plain rpc
  function prefetch(fn, params, olderThan) {
    if (!RAW || !READ[fn] || navigator.onLine === false || document.visibilityState === "hidden") return null;
    var k = keyOf(fn, params); if (!k) return null;
    var e = load()[k];
    if (inflight[k]) return inflight[k];
    if (e && !e.dirty && now() - e.at < (olderThan || FRESH_MS) && e.n === night(now())) return null;
    stats.pre++;
    return network(fn, params, RAW, k);
  }
  // First use (no recipe recorded yet): what these screens call today, {gid} / {name} filled in.
  var DEF = {
    "#btn-groups": [["my_groups", "{}"], ["my_event_chats", '{"p_seen":{}}'], ["my_dms", "{}"]],
    "tab:f": [["my_friends", '{"p_name":"{name}"}'], ["friend_suggest", "{}"], ["friend_list", '{"p_name":"{name}"}'], ["avatars_for", '{"p_group_id":null}']],
    "tab:i": [["my_inbox", "{}"]],
    "#btn-settings": [["my_wrapped", '{"p_kind":"year","p_offset":0}'], ["my_groups", "{}"], ["my_friends", '{"p_name":"{name}"}'], ["my_board_optin", "{}"], ["rnd_me", "{}"]],
    "gcard": [["my_group_flags", "{}"], ["chief_state", '{"p_group_id":"{gid}"}'], ["party_group", '{"p_group_id":"{gid}"}'], ["squad_group", '{"p_group_id":"{gid}"}'],
      ["skal_state", '{"p_group_id":"{gid}"}'], ["group_now", '{"p_group_id":"{gid}"}'], ["group_msgs", '{"p_after_id":0,"p_group_id":"{gid}"}'],
      ["rnd_group", '{"p_group_id":"{gid}"}'], ["drivers_for", '{"p_group_id":"{gid}"}'], ["ikvall_status", '{"p_group_id":"{gid}"}'], ["avatars_for", '{"p_group_id":"{gid}"}']]
  };
  function myName() { try { return (localStorage.getItem("olnu.name") || "").trim(); } catch (e) { return ""; } }
  function groupsCached() { var g = get("my_groups", {}); return g && Array.isArray(g.data) ? g.data : null; }
  // The group the Grupper list shows first (app.js sortGroupsByChat: olnu.gact score, then server order).
  function topGroups(n) {
    var gs = groupsCached(); if (!gs || !gs.length) return [];
    var all = {}; try { all = JSON.parse(lsGet("olnu.gact") || "{}") || {}; } catch (e) {}
    var sc = function (r) { return r ? r.s * Math.pow(0.5, (now() - r.t) / (5 * 864e5)) : 0; };
    return gs.map(function (g, i) { return { g: g, i: i, s: sc(all[String(g.id)]) }; }).sort(function (a, b) { return b.s - a.s || a.i - b.i; })
      .slice(0, n).map(function (x) { return x.g; });
  }
  function recipeOf(trig) {
    var x = loadR().r[trig]; if (x && x.c.length) return x.c;
    var m = /^gcard:(.*)$/.exec(trig), d = DEF[m ? "gcard" : trig]; if (!d) return null;
    var gid = "";
    if (m) { var g = (groupsCached() || []).filter(function (g) { return String(g.name).slice(0, 40) === m[1]; })[0]; if (!g) return null; gid = String(g.id); }
    var nm = myName();
    return d.map(function (c) { return [c[0], c[1].replace("{gid}", gid).replace("{name}", JSON.stringify(nm).slice(1, -1))]; })
      .filter(function (c) { return c[1].indexOf('"p_name":""') < 0; });
  }
  // What the idle refresh keeps warm: only what a screen paints first (lists, Nu strip, chat preview, faces).
  var LIGHT = { my_groups: 1, my_event_chats: 1, my_dms: 1, my_friends: 1, friend_suggest: 1, friend_list: 1, my_inbox: 1, group_now: 1,
    group_msgs: 1, avatars_for: 1, ikvall_status: 1, drivers_for: 1 };
  function replay(trig, olderThan, light) {
    var c = recipeOf(trig); if (!c) return 0;
    var n = 0;
    c.forEach(function (x) {
      if (light && !LIGHT[x[0]]) return; var p = null; try { p = JSON.parse(x[1]); } catch (e) {} if (prefetch(x[0], p, olderThan)) n++; });
    return n;
  }
  function idle(fn, ms) { if (W.requestIdleCallback) W.requestIdleCallback(fn, { timeout: ms || 1500 }); else setTimeout(fn, 300); }
  // Siblings of an open sheet: its tabs and the first group cards.
  function siblings() {
    var sh = document.getElementById("sheet"); if (!sh || sh.hidden) return;
    var seen = {};
    [].slice.call(sh.querySelectorAll("[role=tab], .inv-tabs button, li.gcard")).slice(0, 8).forEach(function (b) {
      var t = trigOf(b); if (t && !seen[t]) { seen[t] = 1; replay(t, SIB_MS); }
    });
  }
  var lastIdle = 0;
  function onPoll() {
    if (now() - lastIdle < IDLE_REFRESH_MS || document.visibilityState === "hidden") return;
    lastIdle = now();
    idle(function () {
      ["#btn-groups", "tab:f", "tab:i"].forEach(function (t) { replay(t, IDLE_REFRESH_MS, true); });
      replay("#btn-settings", MAX_MS - 60000);   // Profil changes slowly: only when missing or almost too old
      var top = function () { topGroups(1).forEach(function (g) { replay("gcard:" + String(g.name).slice(0, 40), IDLE_REFRESH_MS, true); }); };
      var p = inflight[keyOf("my_groups", {})];
      if (p) p.then(top, top); else top();
    }, 4000);
  }

  /* ---------- user intent ---------- */
  document.addEventListener("pointerdown", function (e) {
    var t = trigOf(e.target); if (t) replay(t, FRESH_MS);
  }, { capture: true, passive: true });
  document.addEventListener("click", function (e) {
    var t = trigOf(e.target);
    curTrig = t ? { k: t, at: now() } : null;
    openWin();
    if (t) { var r = loadR().r[t]; if (r) r.at = now(); }
    var sh = document.getElementById("sheet");
    if (sh && !sh.hidden && sh.contains(e.target)) tapInSheet();
  }, true);
  // A tap inside an open sheet (a tab, a fold): a part that the tap SHOWS and that waits for the network stays
  // invisible until its data is in (same rules as a sheet), with the height it had last time.
  var paneMO = null, paneRecs = [];
  function tapInSheet() {
    var body = document.getElementById("sheet-body"); if (!body || !W.MutationObserver) return;
    epoch++; pending = 0; paneRecs = [];
    if (!paneMO) paneMO = new MutationObserver(function (r) { paneRecs = paneRecs.concat(r); });
    paneMO.observe(body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
    requestAnimationFrame(function () {
      var recs = paneRecs.concat(paneMO.takeRecords()); paneMO.disconnect(); paneRecs = [];
      var shown = [];
      recs.forEach(function (r) { var el = r.target; if (el.nodeType === 1 && !el.hidden && shown.indexOf(el) < 0 && el.getBoundingClientRect().height > 0) shown.push(el); });
      shown = shown.filter(function (el) { return !shown.some(function (o) { return o !== el && o.contains(el); }); }).slice(0, 3);
      if (!shown.length) return;
      if (pending > 0) holdEls(shown, true, null);
      else rememberPanes(shown);
    });
  }
  function paneKey(el) { return "pane:" + (el.id || String(el.className).split(" ")[0]); }
  function rememberPanes(els) {
    requestAnimationFrame(function () {
      var hh = htsLoad(); els.forEach(function (el) { if (el.isConnected && !el.hidden) hh[paneKey(el)] = Math.round(el.getBoundingClientRect().height); });
      lsSet(HEIGHTS, JSON.stringify(hh));
    });
  }
  function holdEls(els, cold, title) {
    var h = { els: els, t0: now(), done: false };
    var hh = htsLoad();
    els.forEach(function (el) {
      var m = hh[paneKey(el)];
      if (m && m > el.getBoundingClientRect().height) el.style.minHeight = Math.min(m, Math.round(innerHeight * 0.8)) + "px";
      el.classList.add("wm-hold");
    });
    var last = now(), frames = 0;
    var mo = new MutationObserver(function () { last = now(); });
    els.forEach(function (el) { mo.observe(el, { childList: true, subtree: true, characterData: true }); });
    function done() {
      if (h.done) return; h.done = true; mo.disconnect(); clearTimeout(cap);
      stats.hold++; stats.holdMs += now() - h.t0;
      els.forEach(function (el) { el.classList.remove("wm-hold"); if (!reduced()) { el.classList.add("wm-in"); setTimeout(function () { el.classList.remove("wm-in"); }, 160); } });
      rememberPanes(els);
      idle(siblings, 1200);
    }
    function check() {
      if (h.done) return;
      if (pending === 0 && now() - last > 24) { if (++frames >= 2) { done(); return; } } else frames = 0;
      requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
    var cap = setTimeout(done, cold ? 650 : 100);
  }

  /* ---------- hold until complete ---------- */
  var pending = 0, hold = null, epoch = 0;
  function pend(p) {
    pending++;
    var ep = epoch;
    var done = function () { if (ep === epoch) pending = Math.max(0, pending - 1); };
    p.then(done, done);
  }
  var HEIGHTS = "olnu.warm.h1", hts = null;
  function htsLoad() { if (!hts) { try { hts = JSON.parse(lsGet(HEIGHTS) || "{}") || {}; } catch (e) { hts = {}; } } return hts; }
  function sheetKey(title) {
    var t = String(title || "").slice(0, 40), tab = "";
    try { var b = document.querySelector('#sheet-body [role=tab][aria-selected="true"]'); if (b) tab = "|" + (b.getAttribute("data-t") || b.textContent.trim().slice(0, 12)); } catch (e) {}
    return t + tab;
  }
  // Called by app.js openSheet BEFORE the old body is emptied. A sheet that replaces an open sheet keeps at least the
  // old sheet height (a page inside one sheet, like iOS push): the sheet edge never jumps down and up again.
  var prevH = 0;
  function beginSheet() {
    openWin(); epoch++; pending = 0; oldServed = 0; oldKeys = {};
    if (hold) reveal(hold);
    var sh = document.getElementById("sheet"), b = document.getElementById("sheet-body");
    prevH = sh && !sh.hidden ? Math.round(sh.getBoundingClientRect().height) : 0;
    if (b) b.style.minHeight = "";
    if (sh) sh.style.minHeight = "";
    if (oldEl) oldEl.hidden = true;
  }
  function reveal(h) {
    if (!h || h.done) return;
    h.done = true; hold = null;
    try { h.mo.disconnect(); } catch (e) {}
    clearTimeout(h.cap); clearTimeout(h.q);
    var body = h.body;
    stats.hold++; stats.holdMs += now() - h.t0;
    body.classList.remove("wm-hold");
    if (!reduced()) { body.classList.add("wm-in"); setTimeout(function () { body.classList.remove("wm-in"); }, 160); }
    // remember the height for next time (after the reveal frame)
    requestAnimationFrame(function () {
      var sh = document.getElementById("sheet"); if (!sh || sh.hidden) return;
      var k = sheetKey(h.title), hh = htsLoad();
      hh[k] = Math.round(body.scrollHeight);
      var ks = Object.keys(hh); if (ks.length > 40) delete hh[ks[0]];
      lsSet(HEIGHTS, JSON.stringify(hh));
    });
    if (oldServed && Object.keys(oldKeys).length) showOld(oldServed);
    idle(siblings, 1200);
  }
  function endSheet(body, title) {
    if (!body) return;
    if (hold) reveal(hold);
    var h = { body: body, title: title, t0: now(), done: false, quiet: 0 };
    var cold = pending > 0;
    // Remembered height: the body keeps it while the data is on its way (no growing in steps).
    var sh = document.getElementById("sheet");
    var nh = sh ? sh.getBoundingClientRect().height : 0, hh = htsLoad()[sheetKey(title)];
    // Page-like = about as tall as the old sheet (now, or as remembered, or unknown while its data loads).
    var est = hh ? nh - body.scrollHeight + hh : (cold ? prevH : nh);
    if (prevH && sh && nh < prevH - 1 && Math.max(nh, est) >= prevH * 0.6) sh.style.minHeight = Math.min(prevH, Math.round(innerHeight * 0.86)) + "px";
    if (cold && hh && hh > body.scrollHeight) { body.style.minHeight = Math.min(hh, Math.round(innerHeight * 0.86)) + "px"; h.minSet = true; }
    body.classList.add("wm-hold");
    hold = h;
    var last = now();
    h.mo = new MutationObserver(function () { last = now(); });
    h.mo.observe(body, { childList: true, subtree: true, characterData: true });
    h.kick = function () {};
    var frames = 0;
    function check() {
      if (h.done) return;
      if (pending === 0 && now() - last > 24) { frames++; if (frames >= 2) { reveal(h); return; } } else frames = 0;
      requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
    h.cap = setTimeout(function () { reveal(h); }, cold ? 650 : 100);
  }

  /* ---------- "Uppdaterad för N min sedan" ---------- */
  var oldEl = null;
  function showOld(age) {
    var sh = document.getElementById("sheet"); if (!sh || sh.hidden) return;
    var m = Math.max(2, Math.round(age / 60000));
    if (!oldEl) { oldEl = document.createElement("p"); oldEl.className = "wm-age"; oldEl.setAttribute("role", "status"); }
    oldEl.textContent = "Uppdaterad för " + m + " min sedan";
    if (oldEl.parentNode !== sh) sh.appendChild(oldEl);
    oldEl.hidden = false;
  }
  function hideOld() {
    oldServed = 0;
    if (oldEl && !oldEl.hidden) { oldEl.classList.add("wm-age-out"); setTimeout(function () { if (oldEl) { oldEl.hidden = true; oldEl.classList.remove("wm-age-out"); } }, 260); }
  }

  /* ---------- in-place patch: make `a` look like `b`, keep a's nodes (listeners, focus, scroll) where the tag matches ---------- */
  function syncAttrs(x, y) {
    var i, n;
    for (i = x.attributes.length - 1; i >= 0; i--) { n = x.attributes[i].name; if (!y.hasAttribute(n)) x.removeAttribute(n); }
    for (i = 0; i < y.attributes.length; i++) { n = y.attributes[i]; if (x.getAttribute(n.name) !== n.value) x.setAttribute(n.name, n.value); }
  }
  function patch(a, b) {
    var bc = [].slice.call(b.childNodes), n = 0;
    for (var i = 0; i < bc.length; i++) {
      var x = a.childNodes[i], y = bc[i];
      if (x && x.nodeType === y.nodeType && (x.nodeType !== 1 || x.tagName === y.tagName)) {
        if (x.nodeType === 3 || x.nodeType === 8) { if (x.nodeValue !== y.nodeValue) { x.nodeValue = y.nodeValue; n++; } }
        else if (x.nodeType === 1) { syncAttrs(x, y); n += patch(x, y); }
      } else if (x) { a.replaceChild(y, x); n++; }
      else { a.appendChild(y); n++; }
    }
    while (a.childNodes.length > bc.length) { a.removeChild(a.lastChild); n++; }
    return n;
  }

  W.WARM = {
    patch: function (a, b) { var n = 0; try { n = patch(a, b); } catch (e) {} return n; },
    rpc: rpc, get: get, prefetch: prefetch, replay: replay, siblings: siblings, onPoll: onPoll,
    beginSheet: beginSheet, endSheet: endSheet, openWin: openWin, setRaw: function (f) { RAW = f; },
    stats: stats, clear: clear, _mem: function () { return load(); }, _recipes: function () { return loadR(); }, READ: READ
  };
})();
