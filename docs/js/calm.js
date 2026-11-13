/* Öl Nu — 🧘 CALM: one start-up rule for everything that pops up by itself (owner 2026-10-22: "3 things pop up, crowded").
   window.CALM, in app.js mods() right after SOCIAL (init). Client only, no RPC, no new buttons. Rules:
   - Nothing that pops up by itself in the first QUIET_MS (4 s) after start (automatic sheets wait until then).
   - After that at most ONE non-urgent automatic thing during the start (first START_MS = 60 s), then at most one per GAP_MS.
     Functional things (an automatic sheet, a calm info toast) are never held after that, but they take the slot; the fun
     things (delight captions, map events, a 👑 promo toast, the radar card) only show when the slot is free.
   - "Automatic" = no tap / key from the user in the last USER_MS. A thing the user just tapped for always shows at once.
   - Urgent things always show: errors, toasts with a button, alarms (app.js toast rank ≥ 1), deep links (?join= …).
   - Held things wait in a priority queue and show when the slot is free, the user is idle for a moment, no sheet is open
     and the beer-type strip is not up. Each has a max wait; then it is dropped (calm news gets old).
   Hooks used by small patches: app.js openSheet → CALM.sheet(), app.js toast() → CALM.toast(), delight.js caption() →
   CALM.caption(), delight.js checkEmpty() → CALM.radar() (the "◎ INGA KONTAKTER" card: max once per night, only after the
   user has been idle on the map, small, top of the map, 5 s), basemap.js never auto-opens the ⓘ map sources.
   📜 Town cards: zooming in on a town may show ONE card per day: the 🕯️ MINNESPLATS (Solo, Ludvika: max once per week)
   or a "📜 VISSTE DU?" fact from js/town-facts.js (window.TOWN_FACTS, keyed by town). Same card as delight.js captions.
   Storage (this phone only): olnu.calm = { night, radar, day, town, mem: {place: ms}, seen: {town: [i]} }.
   Debug: CALM._state(), CALM._reset(), CALM.fact(true) shows a fact now. */
(function () {
  "use strict";
  var QUIET_MS = 4000, START_MS = 60000, GAP_MS = 45000, USER_MS = 8000, IDLE_MS = 2500;
  var RADAR_IDLE_MS = 20000, RADAR_AFTER_MS = 25000, FACT_P = 0.25, MEM_WEEK = 7 * 864e5, KEY = "olnu.calm";
  var t0 = Date.now(), lastUser = 0, lastMove = Date.now(), lastAuto = 0, autoN = 0, A = null, q = [], pumpIv = null, log = [];
  document.addEventListener("visibilitychange", function () { if (!document.hidden && q.length && !pumpIv) pumpIv = setInterval(pump, 1000); });
  var deep = false;
  try { deep = /[?&](join|j|inv|invite|i|chat|c|rally|r|bar|b|sos|focus|f|ev|e|g|dm|acct|code)=/.test(location.search); } catch (e) {}

  function now() { return Date.now(); }
  function ls() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  function lsSet(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
  function nightId() { var d = new Date(now() - 5 * 3600e3); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function dayId() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function st() {
    var o = ls(), n = nightId(), d = dayId();
    if (o.night !== n) { o.night = n; o.radar = 0; }
    if (o.day !== d) { o.day = d; o.town = 0; }
    o.mem = o.mem || {}; o.seen = o.seen || {};
    return o;
  }
  ["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (ev) {
    document.addEventListener(ev, function () { lastUser = now(); }, { capture: true, passive: true });
  });
  function isUser() { return now() - lastUser < USER_MS; }
  function sheetUp() { var s = document.getElementById("sheet"); return !!(s && !s.hidden); }
  function stripUp() { try { return !!(window.OLNU_STRIP && window.OLNU_STRIP.up()); } catch (e) { return false; } }
  function introUp() { var i = document.getElementById("intro"); return !!(i && !i.hidden); }
  function inStart() { return now() - t0 < START_MS; }
  // May one automatic, non-urgent thing show now? (true = yes, and the slot is used)
  function slot(kind, o) {
    o = o || {};
    if (o.urgent) return true;
    if (isUser() && !o.auto) return true;
    if (deep && now() - t0 < 30000 && kind === "sheet") return true;
    var t = now();
    if (t - t0 < QUIET_MS) return false;
    if (autoN && inStart()) return false;                  // at most ONE automatic thing during the start
    if (lastAuto && t - lastAuto < GAP_MS) return false;   // then spaced out
    take(kind, o.what);
    return true;
  }
  function take(kind, what) {
    var t = now(); lastAuto = t; autoN++;
    log.push(((t - t0) / 1000).toFixed(1) + "s " + kind + (what ? " " + String(what).slice(0, 40) : ""));
  }
  // Functional things (sheet / toast): only the 4 s quiet start holds them; when they show they take the slot.
  function quietHold(kind) { return !isUser() && !(deep && kind === "sheet") && now() - t0 < QUIET_MS; }
  function hold(kind, prio, maxMs, run, what, fn) {
    q.push({ kind: kind, prio: prio, until: now() + maxMs, run: run, what: what, at: now(), fn: !!fn });
    q.sort(function (a, b) { return b.prio - a.prio || a.at - b.at; });
    if (q.length > 12) q.length = 12;
    if (!pumpIv && !document.hidden) pumpIv = setInterval(pump, 1000);
  }
  function pump() {
    if (document.hidden) { clearInterval(pumpIv); pumpIv = null; return; }   // ⚡ SPEED: sleeps while hidden
    var t = now();
    q = q.filter(function (x) { return x.until > t; });
    if (!q.length) { clearInterval(pumpIv); pumpIv = null; return; }
    var x = q.filter(function (y) { return y.fn; })[0];   // functional: right after the quiet start
    if (x && t - t0 >= QUIET_MS) { q.splice(q.indexOf(x), 1); take(x.kind, x.what); try { x.run(); } catch (e) {} return; }
    if (document.hidden || sheetUp() || stripUp() || introUp() || t - lastUser < IDLE_MS) return;
    x = q[0];
    if (!slot(x.kind, { auto: true, what: x.what })) return;
    q.shift();
    try { x.run(); } catch (e) { try { console.warn("olnu calm", e); } catch (y) {} }
  }

  /* ---------- the three gates (called from small patches) ---------- */
  // app.js openSheet: true = CALM holds it (opens later through A.openSheet again with opts.calm).
  function sheet(title, build, opts) {
    opts = opts || {};
    if (opts.calm || opts.now || opts.lock || !A) return false;
    if (!quietHold("sheet")) { if (!isUser()) take("sheet", title); return false; }
    hold("sheet", 3, 10 * 60000, function () { A.openSheet(title, build, Object.assign({}, opts, { calm: 1 })); }, title, true);
    return true;
  }
  // app.js toast (rank 0 = calm news, or a promo nobody tapped for): true = held. Calm news is the app's own info queue
  // (max one visible): it shows, and takes the slot. A promo (👑 "Du ä kung av …") is fun: it waits for the slot.
  function toast(msg, opts) {
    opts = opts || {};
    if (opts.calm || opts.err || opts.action || opts.urgent || opts.keep || !A) return false;
    if (!/\bpromo\b/.test(opts.cls || "")) { if (!isUser()) take("toast", msg); return false; }
    if (slot("toast", { what: msg })) return false;
    hold("toast", 2, 3 * 60000, function () { A.toast(msg, Object.assign({}, opts, { calm: 1 })); }, msg);
    return true;
  }
  // delight.js caption(o): true = held. Map events are fresh only for a short while.
  function caption(o, show) {
    if (!o || o.calm) return false;
    if (slot("caption", { what: o.head, auto: !o.now })) return false;
    var c = Object.assign({}, o, { calm: 1 });
    hold("caption", o.ev ? 0 : 1, o.ev ? 90000 : 5 * 60000, function () { show(c); }, o.head);
    return true;
  }
  // delight.js checkEmpty: may the "◎ INGA KONTAKTER" radar card show now? Max once per night, only after the user has
  // been idle on the map for a while (not at start), and it takes the automatic slot.
  function radar() {
    var t = now(), s = st();
    if (s.radar >= 1) return false;
    if (t - t0 < RADAR_AFTER_MS || t - lastUser < RADAR_IDLE_MS || t - lastMove < RADAR_IDLE_MS) return false;
    if (sheetUp() || stripUp() || document.hidden) return false;
    if (!slot("radar", { auto: true })) return false;
    s.radar = 1; lsSet(s);
    return true;
  }

  /* ---------- calm2 (I-79 / I-84 / I-82, owner 13 Nov: "too many pop-ups, they are in the way"; spec POPUP-RULES.md) ----------
     filter(msg, opts) runs first in app.js toast(). true = no toast of its own:
     - "+1 merit" (cls mer-toast): off (the count still goes up where it is shown).
     - medal / mission news (cls medal-toast, badge-toast, pn-news): into ONE bucket. The bucket shows ONE quiet line
       ("3 nya medaljer · Visa" with the medal icon, one medal = its name, a burst >= 5 = "N medaljer upplåsta") only when idle on the map.
     - "Ingen data här" (id pn-nodata): never when the header already says nobody is out, max once per night per phone.
     - any other toast nobody tapped for (rank 0): the same text max once per night.
     Not requested pop-ups (the news line, the unlock sheet) share one budget: not in the first 10 s, max 1 per 2 min,
     max 3 per 10 min, only idle on the map (no sheet, no input focused, no tap in the last 4 s, no toast up).
     unlock(run, n): the "Du låste upp" sheet: same idle rule, max one per start; more = a dot on the profile button. */
  var AUTO_QUIET = 10000, AUTO_GAP = 120000, AUTO_WIN = 600000, AUTO_MAX = 3, NEWS_IDLE = 4000, NEWS_SETTLE = 2500;
  var news = [], newsFirst = 0, autoAt = [], newsIv = null, unl = { shown: 0, run: null, extra: 0 }, NODATA_KEY = "olnu.calm.nd", SEEN_KEY = "olnu.calm.tx";
  function L2(s, e) { return en() ? e : s; }
  function typing() { var a = document.activeElement; return !!(a && a !== document.body && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)); }
  function toastUp() { var b = document.getElementById("toasts"); return !!(b && Array.prototype.some.call(b.children, function (x) { return !x.hasAttribute("data-keep"); })); }
  function idleMap() {
    return !document.hidden && !sheetUp() && !stripUp() && !introUp() && !typing() && !toastUp() && now() - lastUser >= NEWS_IDLE &&
      !document.querySelector(".takeover, .mx-pop, .leaflet-popup, .mapboxgl-popup") && medalsCalm();
  }
  // medals.js calm window (60 s after a beer, the "Befordrad!" card, the strip): the news line waits for it too
  function medalsCalm() { try { var M = window.MEDALS; return !(M && M.calm) || M.calm(); } catch (e) { return true; } }
  function budget() {   // may one not requested pop-up show now? (does not take it)
    var t = now(); autoAt = autoAt.filter(function (x) { return t - x < AUTO_WIN; });
    if (t - t0 < AUTO_QUIET) return false;
    if (autoAt.length >= AUTO_MAX || (autoAt.length && t - autoAt[autoAt.length - 1] < AUTO_GAP)) return false;
    return idleMap();
  }
  function spend(what) { autoAt.push(now()); take("auto", what); }
  function headerQuiet() {
    var lc = document.getElementById("live-count"); if (!lc) return false;
    var o = lc.getAttribute("data-out");
    return (o != null && o !== "" && +o === 0) || /lugnt|quiet|ingen ute|nobody/i.test(lc.textContent || "");
  }
  function lsGetS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSetS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function seenTonight(msg) {   // same text max once per night (not requested toasts)
    var n = nightId(), o = null; try { o = JSON.parse(lsGetS(SEEN_KEY) || "null"); } catch (e) { o = null; }
    if (!o || o.n !== n || !Array.isArray(o.t)) o = { n: n, t: [] };
    var k = String(msg).slice(0, 80); if (o.t.indexOf(k) >= 0) return true;
    o.t.push(k); if (o.t.length > 80) o.t = o.t.slice(-80); lsSetS(SEEN_KEY, JSON.stringify(o));
    return false;
  }
  function filter(msg, opts) {
    opts = opts || {};
    if (opts.calm || opts.err || opts.urgent || opts.keep) return false;
    var cls = opts.cls || "";
    if (/\bmer-toast\b/.test(cls)) { take("drop", msg); return true; }
    if (/\b(medal-toast|badge-toast|pn-news)\b/.test(cls) && !opts.action) { newsAdd(msg, opts); return true; }
    if (opts.id === "pn-nodata" && /^Ingen data|^No data/.test(String(msg))) {
      if (headerQuiet() || lsGetS(NODATA_KEY) === nightId()) { take("drop", msg); return true; }
      lsSetS(NODATA_KEY, nightId());
      return false;
    }
    return false;
  }
  function seenRank0(msg, opts) { return !(opts && (opts.calm || opts.err || opts.action || opts.urgent || opts.keep)) && seenTonight(msg); }
  function newsAdd(msg, opts) {
    var m = String(msg || ""), medal = /\b(medal-toast|badge-toast)\b/.test(opts.cls || "");
    var mN = /(\d+) medalj/i.exec(m);   // the first-run summary "Din uniform har fått 13 medaljer" counts as 13
    news.push({ msg: m, medal: medal, n: medal && mN ? Math.max(1, +mN[1]) : 1 });
    if (news.length > 60) news = news.slice(-60);
    if (!newsFirst) newsFirst = now();
    if (!newsIv) newsIv = setInterval(newsPump, 1000);
  }
  function newsLine() {
    var med = news.filter(function (x) { return x.medal; }), oth = news.filter(function (x) { return !x.medal; });
    var n = med.reduce(function (s, x) { return s + x.n; }, 0), parts = [];
    var ic = med.length ? (/^\s*(\S+)\s/.exec(med[0].msg) || ["", ""])[1] : "";   // the medal's own icon (medals.js text)
    var pre = ic ? ic + " " : "";
    if (n === 1 && med.length === 1) parts.push(med[0].msg.replace(/!$/, ""));
    else if (n >= 5) parts.push(pre + L2(n + " medaljer upplåsta", n + " medals unlocked"));
    else if (n > 1) parts.push(pre + L2(n + " nya medaljer", n + " new medals"));
    if (oth.length === 1 && !parts.length) parts.push(oth[0].msg);
    else if (oth.length) parts.push(L2(oth.length + (oth.length === 1 ? " uppdrag klart" : " uppdrag klara"), oth.length + (oth.length === 1 ? " mission done" : " missions done")));
    var s = parts.join(" · ");
    return s.length > 64 ? s.slice(0, 62).replace(/\s+\S*$/, "") + "…" : s;
  }
  function newsPump() {
    if (!news.length) { clearInterval(newsIv); newsIv = null; return; }
    if (now() - newsFirst < NEWS_SETTLE || !A || !budget()) return;   // a burst settles first: one line for all of it
    var line = newsLine(), medal = news.some(function (x) { return x.medal; });
    news = []; newsFirst = 0; clearInterval(newsIv); newsIv = null;
    spend(line);
    var o = { calm: 1, cls: "pn-news-line", ms: medal ? 7000 : 4000 };
    if (medal && window.MEDALS && window.MEDALS.showMine) o.action = { label: L2("Visa", "Show"), fn: function () { try { window.MEDALS.showMine(); } catch (e) {} } };
    try { A.toast(line, o); } catch (e) {}
  }
  function unlock(run, n) {
    if (unl.shown || unl.run) { unl.extra += n || 1; dot(); return true; }
    unl.run = run;
    if (!newsIv) newsIv = setInterval(newsPump, 1000);
    var iv = setInterval(function () {
      if (!unl.run) { clearInterval(iv); return; }
      if (news.length || !budget()) return;
      var r = unl.run; unl.run = null; unl.shown = 1; clearInterval(iv);
      spend("unlock"); try { r(); } catch (e) {}
    }, 1000);
    return true;
  }
  function dot() {
    var b = document.getElementById("btn-settings"); if (!b || b.querySelector(".pn-unl-dot")) return;
    var d = document.createElement("span"); d.className = "pn-unl-dot"; d.setAttribute("aria-hidden", "true"); b.appendChild(d);
    b.setAttribute("data-unl", String(unl.extra));
    b.addEventListener("click", function () { d.remove(); b.removeAttribute("data-unl"); unl.extra = 0; }, { once: true });
  }

  /* ---------- 📜 town cards: memorial (rare) or a true fact (rare) ---------- */
  var MEM = [{ key: "solo", id: "n1471185136", lat: 60.15071, lng: 15.18664, r: 120, z: 18, old: "olnu.eggSoloAt" }];   // old: hotfix key
  function hav(a, b, c, d) { try { return window.U.haversine(a, b, c, d); } catch (e) { return Infinity; } }
  function en() { return !!(window.I18N && window.I18N.lang === "en"); }
  function dlOff() { try { return localStorage.getItem("olnu.dl.off") === "1"; } catch (e) { return false; } }
  function card(head, text, cls) {
    var d = window.DELIGHT;
    if (d && d.caption) d.caption({ head: head, text: text, cls: cls || "dl-cap-secret", now: true, ms: 7500, calm: 1 });
    else if (A) A.toast(head + " · " + text, { ms: 7000, calm: 1 });
  }
  function townAt(c) {
    var T = window.TOWN_FACTS || {}, best = null;
    Object.keys(T).forEach(function (k) { var x = T[k], d = hav(c.lat, c.lng, x.lat, x.lng); if (x && d <= (x.r || 3000) && (!best || d < best.d)) best = { k: k, t: x, d: d }; });
    return best;
  }
  function pickFact(k, t, s) {
    var list = (en() && t.en && t.en.length ? t.en : t.sv) || []; if (!list.length) return null;
    var seen = (s.seen[k + (en() ? ".en" : "")] || []).filter(function (i) { return i < list.length; });
    if (seen.length >= list.length) seen = [];
    var free = []; for (var i = 0; i < list.length; i++) if (seen.indexOf(i) < 0) free.push(i);
    var ix = free[Math.floor(Math.random() * free.length)];
    seen.push(ix); s.seen[k + (en() ? ".en" : "")] = seen;
    return list[ix];
  }
  function onZoom() {
    if (!A || !A.map || !isUser() || dlOff() || sheetUp() || stripUp() || now() - t0 < QUIET_MS) return;
    var z = A.map.getZoom(), c = A.map.getCenter(), s = st();
    if (z < 16 || s.town >= 1) return;                     // max one town card per day
    for (var i = 0; i < MEM.length; i++) {
      var m = MEM[i];
      if (z >= m.z && hav(c.lat, c.lng, m.lat, m.lng) < m.r) {
        var was = s.mem[m.key] || 0; try { was = Math.max(was, +localStorage.getItem(m.old) || 0); } catch (x) {}
        if (now() - was < MEM_WEEK) break;   // this place: max once per week
        var e = ((window.DELIGHT_MORE_CONTENT || {}).eggs || {})[m.key]; if (!e) break;
        var lines = en() ? e.en || e.sv : e.sv;
        s.mem[m.key] = now(); s.town = 1; lsSet(s); try { localStorage.setItem(m.old, String(now())); } catch (x) {}
        card((e.head && (en() ? e.head.en : e.head.sv)) || "🕯️", lines[Math.floor(Math.random() * lines.length)], "dl-cap-secret");
        return;
      }
    }
    if (Math.random() > FACT_P) return;
    fact(false);
  }
  function fact(force) {
    if (!A || !A.map) return false;
    var tn = townAt(A.map.getCenter()); if (!tn) return false;
    var s = st(); if (!force && s.town >= 1) return false;
    var line = pickFact(tn.k, tn.t, s); if (!line) return false;
    s.town = 1; lsSet(s);
    card(en() ? "📜 DID YOU KNOW?" : "📜 VISSTE DU?", line, "dl-cap-secret dl-cap-fact");
    return true;
  }

  window.CALM = {
    sheet: sheet, toast: toast, caption: caption, radar: radar, townCard: true, fact: fact, slot: slot,
    filter: filter, seen: seenRank0, unlock: unlock, idle: idleMap, typing: typing,   // calm2
    _news: function () { return { news: news.length, auto: autoAt.slice(), unl: { shown: unl.shown, wait: !!unl.run, extra: unl.extra } }; },
    radarMs: 5000,
    init: function (api) {
      A = api;
      try {
        // The radar card: small, under the top HUD (never over the map centre / your dot, never over the dock or strip).
        var css = document.createElement("style"); css.id = "calm-css";
        css.textContent = ".dl-empty{top:calc(var(--sat,0px) + 232px);transform:translate(-50%,-6px);width:min(calc(100vw - 150px),250px);" +
          "padding:7px 10px 8px 34px;text-align:left;border-radius:10px}" +
          ".dl-empty.dl-in{transform:translate(-50%,0)}" +
          ".dl-empty .dl-radar{left:8px;top:50%;width:20px;height:20px;margin:-10px 0 0}" +
          ".dl-empty-h{font-size:9px;margin-bottom:2px}.dl-empty-t{font-size:12.5px;line-height:1.3}" +
          ".dl-cap-fact .dl-cap-h{color:var(--amber-2,#ffc24d)}" +
          "#btn-settings{position:relative}.pn-unl-dot{position:absolute;top:2px;right:2px;width:10px;height:10px;border-radius:50%;" +
          "background:var(--ds-amber,#ffb21e);box-shadow:0 0 0 2px var(--ds-bg,#0d1326);pointer-events:none}";   // calm2: more unlocks wait here
        document.head.appendChild(css);
      } catch (e) {}
      try {
        if (A && A.map) {
          A.map.on("movestart zoomstart", function () { lastMove = now(); });
          A.map.on("zoomend", function () { setTimeout(onZoom, 400); });
        }
      } catch (e) {}
    },
    // tests
    _state: function () { return { t: now() - t0, autoN: autoN, held: q.map(function (x) { return x.kind + ":" + String(x.what || "").slice(0, 30); }), log: log.slice(), ls: st() }; },
    _reset: function () { t0 = now() - START_MS - GAP_MS; lastAuto = 0; autoN = 0; q = []; lsSet({}); autoAt = []; news = []; newsFirst = 0; unl = { shown: 0, run: null, extra: 0 }; },
    _idle: function (ms) { lastUser = now() - ms; lastMove = now() - ms; }
  };
})();
