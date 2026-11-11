/* PintsNow — X8 weak-signal mode (lane x8, 11 Nov 2026; PLAN-TUESDAY "X8"). Loaded before app.js. window.X8.
   1. ÖL! outbox: a beer tap that can not reach the server (offline, timeout, fetch error, 5xx) is kept here and sent later.
      localStorage "olnu.x8.outbox" (memory fallback when storage fails), max 5 items, each dropped 90 min after the tap.
      Item = { id (made on the phone), at (tap time), lat, lng, precise, home, ghost, sent (1st send time), tries, next }.
      Flush: on 'online', on the next good poll (app.js), on app start (app.js, after sign-in) and on its own timer.
      One item at a time (oldest first), one tab at a time (20 s lease), never while "Jag kör ikväll" is on (LÄSK!).
      NO double log: post_beer_v2 takes no client id, so the dedupe is on the phone (no server change):
        a) poll_v2 "me".beer_at (server clock, skew from server_time) at/after the item's first send → it landed → drop;
        b) a re-send answered accepted:false (10-min server cooldown) whose last beer is at/after the first send → drop;
        c) else accepted:false = the server's 10-min rule (another beer) → wait wait_seconds, then send (pacing).
   2. Stale mode: 2 failed polls in a row, or the browser is offline → the last map, pins and counts stay and ONE calm
      caption "Senast uppdaterad 22:14" shows under the HUD row (p#x8-stale; place + look: pnds.css "lane:x8"). The next good poll hides it. Poll back-off
      (app.js schedulePoll asks delay()): 5, 10, 20, 40, 60 s (+/- 20 %), offline: one try per 60 s. No red banner, no loop.
   3. Snapshot: the last good poll_v2 answer (≤ 300 pins, ≤ 3 h, same user) so a cold start with no net still shows the
      last map (app.js draws it when the first poll fails).
   Copy: DIALEKT keys "x8.*" (sv-neutral + en-neutral). No notifications, no browser dialogs.
   Public: window.X8 = { bind, add, list, count, flush, isNet, say, pollOk, pollFail, stale, delay, snapSave, snapGet, _s }. */
(function () {
  "use strict";
  var KEY = "olnu.x8.outbox", LAST = "olnu.x8.last", SNAP = "olnu.x8.snap";
  var MAX = 5, TTL = 90 * 60e3, LEASE = 20e3, COOL = 10 * 60e3, SKEW_OK = 5e3, SNAP_MS = 3 * 3600e3, SNAP_EVERY = 60e3;
  var P = {
    "x8.pending": "🍺 Skål! Ölen räknas…",
    "x8.queued": "📡 Ölen ä sparad. Skickas när du har täckning.",
    "x8.queuedN": "📡 {n} öl sparade. Skickas när du har täckning.",
    "x8.full": "📡 Fem öl väntar redan på täckning. Ta det lugnt en stund!",
    "x8.sent": "📡 Ölen från {time} ä skickad",
    "x8.stale": "Senast uppdaterad {time}",
    "x8.nonet": "Ingen täckning just nu",
    "x8.busy": "Det är mycket nu"   // perf: the server is overloaded (busy back-off)
  };
  var PEN = {
    "x8.pending": "🍺 Cheers! Counting your beer…",
    "x8.queued": "📡 Beer saved. It is sent when you have signal.",
    "x8.queuedN": "📡 {n} beers saved. They are sent when you have signal.",
    "x8.full": "📡 Five beers are already waiting for signal. Take it easy for a bit!",
    "x8.sent": "📡 Your beer from {time} is sent",
    "x8.stale": "Last updated {time}",
    "x8.nonet": "No signal right now",
    "x8.busy": "Lots going on right now"
  };
  try { if (window.DIALEKT && window.DIALEKT.register) { window.DIALEKT.register("sv-neutral", P); window.DIALEKT.register("en-neutral", PEN); } } catch (e) {}
  function lang() { try { return window.I18N && window.I18N.lang === "en" ? "en" : "sv"; } catch (e) { return "sv"; } }
  function say(k, vars) {
    var def = (lang() === "en" ? PEN : P)[k] || P[k] || k, out = null;
    try { if (window.DIALEKT && window.DIALEKT.t) out = window.DIALEKT.t(k, vars || {}, def); } catch (e) { out = null; }
    if (!out || out === k) out = def.replace(/\{(\w+)\}/g, function (m, v) { return vars && vars[v] != null ? String(vars[v]) : ""; });
    return String(out);
  }
  function hhmm(ms) { var d = new Date(ms); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  function now() { return Date.now(); }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  var trail = [];   // the last 20 outbox events (tests, Något knas?)
  function log(ev, o) {
    trail.push([Date.now() % 1e7, ev, o || {}]); if (trail.length > 20) trail.shift();
    try { if (window.PNLOG && window.PNLOG.event) window.PNLOG.event("x8." + ev, o || {}); } catch (e) {}
  }

  /* ---------- outbox store ---------- */
  var mem = null, tab = Math.random().toString(36).slice(2, 10), A = null;
  function load() {
    var q = lsGet(KEY);
    if (!Array.isArray(q)) q = mem ? mem.slice() : [];
    var t = now();
    return q.filter(function (x) { return x && x.id && isFinite(x.at) && t - x.at < TTL && t - x.at > -60e3 && isFinite(x.lat) && isFinite(x.lng); });
  }
  // memory copy only while storage fails (private mode / quota): the outbox then lives for this page only
  function save(q) { var ok = q.length ? lsSet(KEY, q) : lsSet(KEY, null); mem = ok ? null : q.slice(); }
  function uid() { return "x8-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
  // spot = { lat, lng, precise, home }; ghost = spökläge at the tap; at = tap time (default now); sentAt = when the tap's own
  // post_beer_v2 went out (online network error: the server may have it → dedupe from that time). Returns { ok, n, full, id }.
  function add(spot, ghost, at, sentAt) {
    var q = load();
    if (!spot || !isFinite(spot.lat) || !isFinite(spot.lng)) return { ok: false, n: q.length };
    if (q.length >= MAX) { log("full", { n: q.length }); return { ok: false, full: true, n: q.length }; }
    var it = { id: uid(), at: isFinite(at) && at > 0 ? +at : now(), lat: +spot.lat, lng: +spot.lng, precise: !!spot.precise, home: !!spot.home, ghost: !!ghost, sent: 0, tries: 0, next: 0 };
    if (isFinite(sentAt) && sentAt > 0) { it.sent = +sentAt; it.tries = 1; it.next = now() + backoff(1); it.hold = "net"; }
    q.push(it); save(q); log("queue", { n: q.length });
    arm();
    return { ok: true, n: q.length, id: it.id };
  }
  function list() { return load(); }
  function count() { return load().length; }
  function drop(id, why) { save(load().filter(function (x) { return x.id !== id; })); log("drop", { why: why }); }
  function patch(id, f) { var q = load(); q.forEach(function (x) { if (x.id === id) f(x); }); save(q); }

  /* ---------- flush ---------- */
  var send = null, live = false, busy = false, timer = null, me = null, skew = 0, bootAt = now();
  function driving() { try { return !!(window.SKJUTS && window.SKJUTS.driving && window.SKJUTS.driving()); } catch (e) { return false; } }
  function serverMs(clientMs) { return clientMs + skew; }
  // a) the server's last beer (poll "me") is at/after this item's first send → it landed
  function landed(it) {
    if (!it.sent || !me || !me.beer_at) return false;
    var b = Date.parse(me.beer_at);
    return isFinite(b) && b >= serverMs(it.sent) - SKEW_OK;
  }
  function arm() {
    clearTimeout(timer); timer = null;
    var q = load(); if (!q.length || !live) return;
    var t = now(), soon = Infinity;
    q.forEach(function (x) { soon = Math.min(soon, Math.max(x.next || 0, t + 1500)); });
    var ms = Math.min(Math.max(1500, soon - t), 5 * 60e3);
    timer = setTimeout(function () { timer = null; flush("timer"); }, ms);
  }
  function backoff(tries) { return Math.min(5 * 60e3, 15e3 * Math.pow(2, Math.max(0, tries - 1))); }
  function flush(why) {
    if (!send || !live || busy) return Promise.resolve(false);
    var q = load();
    if (!q.length) { save(q); return Promise.resolve(false); }
    if (navigator.onLine === false || driving()) { arm(); return Promise.resolve(false); }
    var t = now();
    q.sort(function (a, b) { return a.at - b.at; });
    var it = q[0];
    if (it.lease && it.lease.by !== tab && it.lease.until > t) { arm(); return Promise.resolve(false); }   // another tab sends it
    // a back-off after a network error ends early when the net is back (online event, good poll); the server's 10-min wait never does
    if (it.next && it.next > t && (it.hold === "cool" || (why !== "online" && why !== "poll"))) { arm(); return Promise.resolve(false); }
    if (landed(it)) { drop(it.id, "landed"); arm(); return Promise.resolve(true); }
    // sent before (answer lost, page reloaded): wait for the first good poll's "me" (max 20 s), so a) can drop it without a call
    if (it.sent && !me && t - bootAt < 20e3) { arm(); return Promise.resolve(false); }
    var firstSent = it.sent || 0;
    patch(it.id, function (x) { x.sent = x.sent || t; x.tries = (x.tries | 0) + 1; x.lease = { by: tab, until: t + LEASE }; });
    busy = true;
    var ghost = !!it.ghost;
    try { if (window.EXTRAS && window.EXTRAS.ghostOn && window.EXTRAS.ghostOn()) ghost = true; } catch (e) {}   // spökläge now OR at the tap
    var item = { id: it.id, at: it.at, lat: it.lat, lng: it.lng, precise: it.precise, home: it.home, ghost: ghost };
    log("send", { why: why, tries: (it.tries | 0) + 1 });
    return Promise.resolve().then(function () { return send(item); }).then(function (res) {
      busy = false;
      var k = res && res.kind;
      if (k === "ok" || k === "refused") {
        drop(it.id, k);
        // the next queued beer: after the server's 10-min rule
        if (k === "ok") { var rest = load(); rest.forEach(function (x) { x.next = Math.max(x.next || 0, now() + COOL + 2000); x.hold = "cool"; }); save(rest); }
      } else if (k === "cooldown") {
        var w = Math.max(1, +res.wait || 1) * 1000, last = now() - (COOL - w);
        // b) sent before, and the server's last beer is at/after that first send → it landed (lost answer, reload)
        if (firstSent && last >= firstSent - SKEW_OK) drop(it.id, "dedupe");
        else patch(it.id, function (x) { x.next = now() + w + 1500; x.hold = "cool"; x.lease = null; });
      } else {   // "net" | "skip": try again later (online / next good poll / back-off timer)
        patch(it.id, function (x) { x.next = now() + (k === "skip" ? 15e3 : backoff(x.tries | 0)); x.hold = "net"; x.lease = null; });
      }
      arm();
      return k === "ok";
    }, function () {
      busy = false;
      patch(it.id, function (x) { x.next = now() + backoff(x.tries | 0); x.hold = "net"; x.lease = null; });
      arm();
      return false;
    });
  }
  // A network failure (the beer may or may not have reached the server) vs a server refusal.
  function isNet(err, status) {
    if (navigator.onLine === false) return true;
    if (!err) return false;
    var msg = String((err && (err.message || err.details)) || err), code = String((err && err.code) || "");
    if (/timeout|failed to fetch|fetch|network|load failed|abort|internet|disconnected|ERR_/i.test(msg)) return true;
    if (status === 0 && !code) return true;
    if (status >= 500 && !/^(P0|22|23|42|PGRST)/.test(code)) return true;   // gateway / paused project, not a PG error
    return false;
  }

  /* ---------- stale mode ---------- */
  var fails = 0, lastGood = 0, staleOn = false, capEl = null, hideT = 0;
  (function () { var l = lsGet(LAST); if (l && isFinite(l.at)) lastGood = +l.at; })();
  function capText() { return busyN >= 2 ? say("x8.busy") : lastGood ? say("x8.stale", { time: hhmm(lastGood) }) : say("x8.nonet"); }
  function show() {
    if (!live) return;
    if (!capEl) {
      capEl = document.createElement("p"); capEl.id = "x8-stale"; capEl.className = "x8-stale"; capEl.setAttribute("role", "status");
      var ic = ""; try { ic = window.PNI && window.PNI.svg ? window.PNI.svg("clock", "pi x8-stale-i") : ""; } catch (e) {}
      capEl.innerHTML = ic + "<span></span>";
      document.body.appendChild(capEl);
    }
    clearTimeout(hideT);
    capEl.querySelector("span").textContent = capText();
    capEl.classList.remove("x8-stale-out"); capEl.hidden = false;
    if (!staleOn) { staleOn = true; document.body.classList.add("x8-stale-on"); log("stale", { fails: fails }); }
  }
  function hide() {
    if (!staleOn || busyN >= 2) return;
    staleOn = false; document.body.classList.remove("x8-stale-on");
    if (capEl) { capEl.classList.add("x8-stale-out"); clearTimeout(hideT); hideT = setTimeout(function () { if (capEl && !staleOn) capEl.hidden = true; }, 160); }
  }
  // app.js after a good poll. info = { me, server_time } (poll_v2) or null (old server)
  function pollOk(info) {
    fails = 0; lastGood = now(); lsSet(LAST, { at: lastGood });
    busyEnd();
    if (info && info.me && typeof info.me === "object") {
      me = info.me;
      var st = info.server_time ? Date.parse(info.server_time) : NaN;
      if (isFinite(st)) skew = st - now();
    }
    hide();
    if (count()) setTimeout(function () { flush("poll"); }, 600);
  }
  function pollFail() { fails++; if (fails >= 2 || navigator.onLine === false) show(); }
  // ms until the next poll after failures (null = the normal schedule)
  function delay() {
    if (busyN >= 2) return Math.max(5e3, busyUntil - now());   // perf: busy → the next map poll is the probe, after the back-off
    if (navigator.onLine === false) return 60e3;
    if (!fails) return null;
    return Math.round(Math.min(60e3, 5e3 * Math.pow(2, fails - 1)) * (0.8 + Math.random() * 0.4));
  }
  window.addEventListener("offline", function () { if (live) show(); });
  window.addEventListener("online", function () { setTimeout(function () { flush("online"); }, 1500); });
  window.addEventListener("storage", function (e) { if (e && e.key === KEY) arm(); });

  /* ---------- perf: busy back-off (load REPORT fix 6) ---------- */
  // app.js rpcNet1 calls netSeen(answer) for every request; busyHold(name) asks hold(name) for each background poll.
  var BUSY_MIN = 60e3, BUSY_JIT = 60e3, busyN = 0, busyUntil = 0, probeAt = 0, busyHits = 0;
  function isBusy(r) {
    var e = r && r.error; if (!e) return false;
    var st = +(r.status || e.status || 0), code = String(e.code || ""), msg = String(e.message || "");
    if (code === "busy") return false;   // our own quiet answer
    return st === 504 || st === 503 || code === "PGRST003" || msg === "timeout" || /PGRST003|upstream request timeout|gateway time-?out/i.test(msg);
  }
  function netSeen(r) {
    if (!r) return;
    if (isBusy(r)) {
      busyN++; probeAt = 0;
      if (busyN >= 2) {
        busyUntil = now() + BUSY_MIN + Math.round(Math.random() * BUSY_JIT);
        if (busyN === 2) { busyHits++; log("busy", { n: busyN }); }
        show();
      }
      return;
    }
    var e = r.error, st = +(r.status || (e && e.status) || 0);
    if (e && (e.code === "busy" || !st || st >= 500)) return;   // no network / odd 5xx: says nothing either way
    busyEnd();
  }
  function busyEnd() {
    if (busyN < 2) { busyN = 0; return; }
    busyN = 0; busyUntil = 0; probeAt = 0; log("calm", {});
    if (staleOn && !fails) hide();
    else if (capEl && staleOn) capEl.querySelector("span").textContent = capText();
  }
  function busyMode() { return busyN >= 2; }   // (not "busy": x8 already has a var busy = the outbox flush flag)
  // a background poll while busy: hold it (true), except ONE probe after the back-off (then the answer decides)
  function hold() {
    if (busyN < 2) return false;
    var t = now();
    if (t >= busyUntil && (!probeAt || t - probeAt > 20e3)) { probeAt = t; return false; }
    return true;
  }

  /* ---------- snapshot of the last good poll (cold start with no net) ---------- */
  var snapAt = 0;
  function who() { try { var s = JSON.parse(localStorage.getItem("olnu.auth") || "null"); return s && s.user && s.user.id ? String(s.user.id).slice(0, 8) : ""; } catch (e) { return ""; } }
  function snapSave(d) {
    if (!d || !Array.isArray(d.pins) || now() - snapAt < SNAP_EVERY) return;
    snapAt = now();
    try {
      var o = { at: now(), u: who(), pins: d.pins.slice(0, 300), live_total: d.live_total == null ? null : d.live_total, checkins: (d.checkins || []).slice(0, 80) };
      var s = JSON.stringify(o);
      if (s.length < 160000) localStorage.setItem(SNAP, s);
    } catch (e) {}
  }
  function snapGet() {
    var o = lsGet(SNAP);
    if (!o || !Array.isArray(o.pins) || !isFinite(o.at) || now() - o.at > SNAP_MS || o.u !== who()) return null;
    lastGood = Math.max(lastGood, +o.at);
    return o;
  }

  // app.js: bind({ send: function (item) → Promise<{ kind: "ok"|"refused"|"cooldown"|"net"|"skip", wait }>, live: LIVE })
  function bind(o) {
    o = o || {};
    if (typeof o.send === "function") send = o.send;
    if (o.live != null) live = !!o.live;
    A = o.api || A;
    if (live && navigator.onLine === false) setTimeout(show, 0);
    arm();
  }

  window.X8 = {
    bind: bind, add: add, list: list, count: count, flush: flush, isNet: isNet, say: say, hhmm: hhmm,
    pollOk: pollOk, pollFail: pollFail, stale: function () { return staleOn; }, staleShow: show, delay: delay,
    netSeen: netSeen, busy: busyMode, hold: hold, busyLeft: function () { return busyN >= 2 ? Math.max(0, busyUntil - now()) : 0; },
    _busy: function (o) { if (o && o.min != null) { BUSY_MIN = +o.min; BUSY_JIT = +(o.jit || 0); } return { n: busyN, until: busyUntil, hits: busyHits, probeAt: probeAt }; },
    snapSave: snapSave, snapGet: snapGet,
    _s: function () { return { fails: fails, lastGood: lastGood, stale: staleOn, busy: busy, skew: skew, me: me, q: load(), trail: trail.slice() }; }
  };
})();
