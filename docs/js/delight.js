/* Öl Nu — DELIGHT: small surprises on every open. Client only, no server.
   1. Rare map events (deterministic per town + evening date + hour, so friends in the same town see the same one).
   2. Boot lines while the app connects. 3. Empty-state jokes (map caption + ticker "calm" lines).
   4. Easter eggs: logo ×7 → Ölguden, long-press ÖL! 3 s in cooldown, shake → foam, "skål" in chat → clink.
   5. Weekday greeting on the first open of the day + sunrise at 05:00. 6. Kapsylsamlingen (one cap per day, local only).
   Hooks from app.js mods(): init, onPoll, hudChipsHTML, hudClick, settingsSheet, applyText.
   Texts: js/delight-content.js (window.DELIGHT_CONTENT). Styles: delight.css. Effects: window.FX (sound, vibrate, reduced).
   Debug: ?delight=<event key> | boot | empty | gud | secret | shake | skal | sunrise | greet | cap
   Rules: animations use transform/opacity only; nothing runs while the page is hidden; FX.reduced() → captions only. */
(function () {
  "use strict";
  var U = window.U;
  var A = null;
  var KEY = { seen: "olnu.dl.seen", spot: "olnu.dl.spot", caps: "olnu.dl.caps", greet: "olnu.dl.greet", boot: "olnu.dl.boot",
    off: "olnu.dl.off", shake: "olnu.dl.shake", sun: "olnu.dl.sun", gud: "olnu.dl.gud" };
  var P_EVENT = 0.5;                     // chance that an hour slot in a town has an event (one view per slot per phone)
  var W = { c: 10, u: 5, r: 2 };         // weights per tier: common, uncommon, rare (~1 % of opens each)
  var FORCE = "";
  try { FORCE = (new URLSearchParams(location.search).get("delight") || "").toLowerCase().replace(/[^a-z0-9]/g, ""); } catch (e) {}

  /* ---------- small helpers ---------- */
  function C() { return window.DELIGHT_CONTENT || {}; }
  function $(id) { return document.getElementById(id); }
  function en() { return !!(window.I18N && window.I18N.lang === "en"); }
  function lng() { return en() ? "en" : "sv"; }
  function ui(k) { var u = C().ui || {}; var o = u[lng()] || u.sv || {}; return o[k] != null ? o[k] : (u.sv || {})[k]; }
  function esc(s) { return U && U.esc ? U.esc(s) : String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function fill(s, d) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return d && d[k] != null ? d[k] : m; }); }
  function pick(list, r) { if (!list || !list.length) return ""; return list[Math.floor((r ? r() : Math.random()) * list.length) % list.length]; }
  function asList(x) { return Array.isArray(x) ? x : x == null ? [] : [x]; }
  function txt(o) { if (!o) return []; return asList(en() ? (o.en != null ? o.en : o.sv) : o.sv); }
  function reduced() { try { return !!(window.FX && window.FX.reduced && window.FX.reduced()); } catch (e) { return false; } }
  function sound(k) { try { if (window.FX && window.FX.sound && window.FX.sound[k]) window.FX.sound[k](); } catch (e) {} }
  function buzz(p) { try { if (window.FX && window.FX.vibrate) window.FX.vibrate(p); } catch (e) {} }
  function lsGet(k, d) { return U && U.ls ? U.ls.getJSON(k, d) : d; }
  function lsSet(k, v) { if (U && U.ls) U.ls.setJSON(k, v); }
  function lsStr(k, d) { return U && U.ls ? U.ls.get(k, d) : d; }
  function lsPut(k, v) { if (U && U.ls) U.ls.set(k, v); }
  function mk(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function later(fn, ms) { return setTimeout(function () { try { fn(); } catch (e) { try { console.warn("olnu delight", e); } catch (x) {} } }, ms); }
  // deterministic RNG (FNV-1a hash → mulberry32)
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // Stockholm wall clock (DST-safe through Intl).
  var DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  function sthlm(d) {
    d = d || new Date();
    try {
      var o = {};
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
      return { y: +o.year, m: +o.month, d: +o.day, h: (+o.hour) % 24, min: +o.minute, dow: DOW[o.weekday] || 1 };
    } catch (e) {
      return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), min: d.getMinutes(), dow: d.getDay() || 7 };
    }
  }
  // "Evening" day: before 05:00 still counts as the day before (same as the app's night).
  function evening(s) {
    s = s || sthlm();
    if (s.h >= 5) return s;
    var dt = new Date(Date.UTC(s.y, s.m - 1, s.d - 1, 12));
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: s.h, min: s.min, dow: s.dow === 1 ? 7 : s.dow - 1 };
  }
  function dayKey(s) { var e = evening(s); return e.y + "-" + ("0" + e.m).slice(-2) + "-" + ("0" + e.d).slice(-2); }

  /* ---------- where am I (town for captions and the event seed) ---------- */
  function here() {
    var p = null;
    try { p = A && A.lastLoc ? A.lastLoc() : null; } catch (e) {}
    if (!p || !isFinite(p.lat)) { try { var c = A.map.getCenter(); p = { lat: c.lat, lng: c.lng }; } catch (e) { p = { lat: 60.1496, lng: 15.1878 }; } }
    return p;
  }
  function town() {
    var p = here(), c = null;
    try { c = window.CITIES && window.CITIES.nearest ? window.CITIES.nearest(p.lat, p.lng) : null; } catch (e) {}
    if (c) return { name: c.name, seed: c.name };
    return { name: en() ? "Unknown" : "Okänd", seed: "g" + (Math.round(p.lat * 2) / 2) + "," + (Math.round(p.lng * 2) / 2) };
  }

  /* ---------- 1. Rare map events ---------- */
  // t: tier, a: animation, s: sprite html, m: [fromMonth, toMonth] (wraps), h: [fromHour, toHour] (wraps, inclusive), date: [m1, d1, m2, d2]
  var DALA_SVG = '<svg viewBox="0 0 100 80" class="dl-svg" aria-hidden="true"><path fill="#c8102e" stroke="#5a0610" stroke-width="2" d="M20 30Q20 22 30 22L62 22 66 8Q68 2 74 4L85 10Q89 12 86 17L80 18 76 30Q78 40 72 44L70 72 61 72 61 47 37 47 35 72 26 72 26 44Q17 40 20 30Z"/><path fill="#c8102e" stroke="#5a0610" stroke-width="2" d="M21 28Q7 28 9 48Q13 38 21 36Z"/><path fill="#1d5fa8" d="M34 23H58Q60 34 46 35Q33 34 34 23Z"/><path fill="none" stroke="#ffe08a" stroke-width="2.2" stroke-linecap="round" d="M36 26Q46 33 56 26M41 40Q46 44 51 40M64 12L70 18"/><circle cx="46" cy="29" r="2.6" fill="#ffe08a"/><circle cx="31" cy="38" r="2.2" fill="#2e7d32"/><circle cx="62" cy="38" r="2.2" fill="#2e7d32"/><circle cx="76" cy="9" r="1.6" fill="#fff"/></svg>';
  var EV = {
    alg: { t: "c", a: "cross", s: "🫎", sz: 72, dur: 6000, bob: "walk" },
    ufo: { t: "r", a: "ufo", h: [20, 4] },
    vasa: { t: "u", a: "cross", s: "⛷️", sz: 56, dur: 4800, bob: "ski", diag: 1, m: [12, 3] },
    bjorn: { t: "u", a: "peek", s: "🐻", side: "l", m: [4, 10] },
    traktor: { t: "c", a: "cross", s: "🚜<i>🚗</i><i>🚙</i><i>🚗</i>", sz: 44, dur: 6000, bob: "rumble" },
    ander: { t: "c", a: "flock", s: "🦆", m: [3, 10] },
    norrsken: { t: "u", a: "aurora", m: [9, 4], h: [18, 5] },
    spelman: { t: "c", a: "cross", s: "🎻<i>🪗</i><i>🎺</i><b class=\"dl-note\">♪</b><b class=\"dl-note dl-n2\">♫</b>", sz: 42, dur: 6000, bob: "march" },
    malmtag: { t: "c", a: "cross", s: "🚂🚃🚃🚃🚃🚃", sz: 40, dur: 5600, bob: "rumble" },
    epa: { t: "c", a: "cross", s: "🛵<i>🚗</i>", sz: 46, dur: 3800, bob: "bounce" },
    gadda: { t: "c", a: "jump", s: "🐟", m: [4, 10] },
    ballong: { t: "c", a: "float", s: "🎈", m: [5, 9], h: [6, 23] },
    snow: { t: "c", a: "fall", s: "❄️", m: [10, 3] },
    aska: { t: "u", a: "flash", m: [6, 8] },
    korv: { t: "c", a: "cross", s: "🌭<b class=\"dl-sign\">KORV!</b>", sz: 50, dur: 5600, bob: "rumble", h: [19, 4] },
    spoke: { t: "c", a: "float", s: "👻", date: [10, 24, 11, 2] },
    tomte: { t: "c", a: "cross", s: "🎅<i>🛵</i>", sz: 50, dur: 4600, bob: "bounce", date: [12, 1, 12, 26] },
    dalahast: { t: "r", a: "cross", s: DALA_SVG, sz: 110, dur: 3800, bob: "gallop", svg: 1 },
    olguden: { t: "r", a: "gud" },
    mygg: { t: "c", a: "swarm", s: "🦟", m: [6, 8] },
    troll: { t: "u", a: "cross", s: "🧌", sz: 64, dur: 6000, bob: "walk", h: [0, 4] },
    kebab: { t: "u", a: "orbit", s: "🥙", h: [22, 4] },
    glitch: { t: "r", a: "glitch" },
    satellit: { t: "c", a: "sat", s: "🛰️" },
    uggla: { t: "c", a: "peek", s: "🦉", side: "r", h: [21, 5] },
    odjur: { t: "r", a: "rise", s: "🦕" },
    lucia: { t: "c", a: "cross", s: "🕯️<i>👱‍♀️</i><i>🕯️</i><i>🕯️</i><i>⭐</i>", sz: 40, dur: 6000, bob: "march", date: [12, 8, 12, 15] },
    kraftor: { t: "c", a: "cross", s: "🦞<i>🦞</i><i>🦞</i>", sz: 40, dur: 5000, bob: "walk", m: [8, 8] }
  };
  function inRange(v, a, b) { return a <= b ? v >= a && v <= b : v >= a || v <= b; }
  function eligible(ev, s) {
    if (ev.m && !inRange(s.m, ev.m[0], ev.m[1])) return false;
    if (ev.h && !inRange(s.h, ev.h[0], ev.h[1])) return false;
    if (ev.date) {
      var v = s.m * 100 + s.d, a = ev.date[0] * 100 + ev.date[1], b = ev.date[2] * 100 + ev.date[3];
      if (!inRange(v, a, b)) return false;
    }
    return true;
  }
  // The event of this hour slot in this town (or null). Same answer on every phone in the same town.
  function slot(s, seedTown) {
    s = s || sthlm();
    var id = (seedTown || town().seed) + "|" + dayKey(s) + "|" + s.h;
    var r = rng(hash(id));
    if (r() >= P_EVENT) return { id: id, key: null };
    var list = Object.keys(EV).filter(function (k) { return eligible(EV[k], s); }), tot = 0;
    list.forEach(function (k) { tot += W[EV[k].t] || 1; });
    var x = r() * tot, key = null;
    for (var i = 0; i < list.length; i++) { x -= W[EV[list[i]].t] || 1; if (x < 0) { key = list[i]; break; } }
    return { id: id, key: key || list[list.length - 1] || null };
  }

  /* stage + band (the strip between the ticker and the dock, so nothing sits over the ÖL! button) */
  function stage() {
    var s = $("dl-stage");
    if (!s) { s = mk("div", "dl-stage"); s.id = "dl-stage"; s.setAttribute("aria-hidden", "true"); document.body.appendChild(s); }
    return s;
  }
  function band() {
    var vh = window.innerHeight || 700, vw = window.innerWidth || 390, top = 150, bot = vh - 280;
    try { var tk = document.querySelector(".ticker"); if (tk) top = tk.getBoundingClientRect().bottom + 56; } catch (e) {}
    try { var dk = document.querySelector(".dock"); if (dk) bot = dk.getBoundingClientRect().top - 120; } catch (e) {}
    if (bot - top < 140) { top = vh * 0.2; bot = vh * 0.62; }
    return { top: top, bot: bot, w: vw, h: vh };
  }
  function px(v) { return Math.round(v) + "px"; }
  function emoji(s, sz) { var e = mk("span", "dl-spr", s); if (sz) e.style.fontSize = px(sz); return e; }

  function build(key, ev, r) {
    var b = band(), root = mk("div", "dl-ev dl-a-" + ev.a + " dl-k-" + key), hit = null, ms = 6000;
    root.style.setProperty("--dur", (ev.dur || 6000) + "ms");
    var y = b.top + r() * Math.max(10, b.bot - b.top - 80);
    if (ev.a === "cross" || ev.a === "sat") {
      if (ev.a === "sat") y = b.top - 10;
      root.style.top = px(y);
      var mv = mk("div", "dl-move" + (ev.diag ? " dl-diag" : "")), bob = mk("div", "dl-bob dl-bob-" + (ev.bob || "walk"));
      hit = emoji(ev.s, ev.sz || 48); if (ev.svg) { hit.classList.add("dl-svgspr"); hit.style.width = px(ev.sz); }
      bob.appendChild(hit); mv.appendChild(bob);
      if (ev.a === "sat") { hit.innerHTML = ev.s; hit.style.fontSize = "44px"; mv.appendChild(mk("div", "dl-scan")); root.style.setProperty("--dur", "6000ms"); }
      root.appendChild(mv); ms = ev.a === "sat" ? 6000 : (ev.dur || 6000);
    } else if (ev.a === "flock") {
      root.style.top = px(b.top + r() * 40);
      var mv2 = mk("div", "dl-move"), V = [[0, 0], [34, -20], [34, 20], [68, -40], [68, 40], [102, -60]];
      V.forEach(function (p, i) {
        var d = emoji("🦆", 34); d.classList.add("dl-duck"); d.style.left = px(p[0]); d.style.top = px(p[1]);
        d.style.animationDelay = (i * 90) + "ms"; mv2.appendChild(d);
      });
      hit = mv2; root.appendChild(mv2); root.style.setProperty("--dur", "5600ms"); ms = 5600;
    } else if (ev.a === "ufo") {
      var x = b.w * (0.25 + r() * 0.5);
      root.style.left = px(x); root.style.top = px(Math.max(b.top, y - 60));
      var path = mk("div", "dl-ufo-path");
      path.appendChild(mk("div", "dl-beam"));
      path.appendChild(mk("span", "dl-lift", "🍺"));
      hit = emoji("🛸", 64); hit.classList.add("dl-saucer"); path.appendChild(hit);
      root.appendChild(path);
    } else if (ev.a === "peek" || ev.a === "gud") {
      var side = ev.side || "l";
      root.classList.add("dl-side-" + side);
      root.style.top = px(ev.a === "gud" ? b.bot - 180 : y);
      var pk = mk("div", "dl-peek");
      if (ev.a === "gud") { hit = mk("div", "dl-gud-fish", gudSVG(true)); }
      else { hit = emoji(ev.s, 76); hit.classList.add("dl-wave"); }
      pk.appendChild(hit); root.appendChild(pk);
    } else if (ev.a === "jump" || ev.a === "rise") {
      var jx = b.w * (0.3 + r() * 0.4);
      root.style.left = px(jx); root.style.top = px(Math.min(b.bot - 40, y + 100));
      root.appendChild(mk("div", "dl-ripple")); root.appendChild(mk("div", "dl-ripple dl-r2"));
      var arc = mk("div", ev.a === "jump" ? "dl-arc" : "dl-rise");
      hit = emoji(ev.s, ev.a === "jump" ? 54 : 84); arc.appendChild(hit);
      if (ev.a === "rise") { var wt = mk("div", "dl-water"); wt.appendChild(arc); root.appendChild(wt); } else root.appendChild(arc);
    } else if (ev.a === "float") {
      root.style.left = px(b.w * (0.2 + r() * 0.6)); root.style.top = px(b.bot);
      root.style.setProperty("--rise", px(-(b.bot - b.top + 60)));
      var fl = mk("div", "dl-float"), sw = mk("div", "dl-sway");
      hit = emoji(ev.s, 58); sw.appendChild(hit); fl.appendChild(sw); root.appendChild(fl);
    } else if (ev.a === "fall") {
      root.classList.add("dl-full");
      for (var i = 0; i < 22; i++) {
        var f = emoji(ev.s, 12 + r() * 16); f.classList.add("dl-flake");
        f.style.left = (r() * 96).toFixed(1) + "%";
        f.style.setProperty("--d", (3600 + r() * 2000).toFixed(0) + "ms");
        f.style.setProperty("--sx", (r() * 60 - 30).toFixed(0) + "px");
        f.style.animationDelay = (r() * 1200).toFixed(0) + "ms";
        root.appendChild(f);
      }
    } else if (ev.a === "swarm") {
      root.style.left = px(b.w * (0.25 + r() * 0.5)); root.style.top = px(y);
      var sw2 = mk("div", "dl-swarm");
      for (var j = 0; j < 8; j++) {
        var q = emoji("🦟", 20 + r() * 8); q.classList.add("dl-mygg");
        q.style.left = px(r() * 90 - 45); q.style.top = px(r() * 70 - 35);
        q.style.setProperty("--d", (380 + r() * 300).toFixed(0) + "ms"); q.style.animationDelay = (r() * 300).toFixed(0) + "ms";
        sw2.appendChild(q);
      }
      hit = sw2; root.appendChild(sw2);
    } else if (ev.a === "aurora") {
      root.classList.add("dl-full");
      var au = mk("div", "dl-aurora");
      au.appendChild(mk("i", "dl-au1")); au.appendChild(mk("i", "dl-au2")); au.appendChild(mk("i", "dl-au3"));
      root.appendChild(au);
    } else if (ev.a === "flash") {
      root.classList.add("dl-full");
      root.appendChild(mk("div", "dl-flash"));
      var cl = mk("div", "dl-cloud"); cl.style.top = px(b.top - 20); hit = emoji("🌩️", 64); cl.appendChild(hit); root.appendChild(cl);
    } else if (ev.a === "orbit") {
      root.style.left = px(b.w / 2); root.style.top = px((b.top + b.bot) / 2);
      var ob = mk("div", "dl-orbit"), arm = mk("div", "dl-arm");
      hit = emoji(ev.s, 50); arm.appendChild(hit); ob.appendChild(arm); root.appendChild(ob);
      root.appendChild(mk("div", "dl-orbit-ring"));
    } else if (ev.a === "glitch") {
      root.classList.add("dl-full");
      var g = mk("div", "dl-glitch");
      g.innerHTML = '<div class="dl-gl-bar"></div><div class="dl-gl-bar dl-b2"></div><div class="dl-gl-txt" data-t="SYSTEMFEL">SYSTEMFEL</div>';
      root.appendChild(g); ms = 1600;
    }
    if (hit) hit.classList.add("dl-hit");
    return { root: root, hit: hit, ms: Math.min(ms, 6000) };
  }

  var active = null;   // {key, root, tapped}
  function stopEvent() {
    if (!active) return;
    try { active.root.remove(); } catch (e) {}
    clearTimeout(active.tm); active = null;
  }
  function eventCaption(key) {
    var e = (C().events || {})[key]; if (!e) return { cap: "", tap: [] };
    var o = en() ? e.en : e.sv, cap = asList(o ? o.cap : []), tap = asList(o ? o.tap : []);
    return { cap: pick(cap), tap: tap };
  }
  function runEvent(key, opts) {
    var ev = EV[key]; if (!ev) return false;
    opts = opts || {};
    stopEvent();
    var tn = town(), tx = eventCaption(key), r = rng(hash(key + "|" + Date.now()));
    var spot = lsGet(KEY.spot, {}); spot[key] = (spot[key] | 0) + 1; lsSet(KEY.spot, spot);
    var bonus = function () {
      if (!active || active.key !== key) { if (tx.tap.length) caption({ head: headOf(key, tn), text: fill(pick(tx.tap), { sektor: tn.name, stad: tn.name }), cls: "dl-cap-bonus", now: true, ev: key }); return; }
      if (active.tapped) return;
      active.tapped = true;
      sound("clink"); buzz(25);
      if (active.hit) active.hit.classList.add("dl-hit-on");
      caption({ head: headOf(key, tn), text: fill(pick(tx.tap), { sektor: tn.name, stad: tn.name }), cls: "dl-cap-bonus", now: true, ev: key });
    };
    if (!reduced()) {
      var bld = build(key, ev, r);
      stage().appendChild(bld.root);
      active = { key: key, root: bld.root, hit: bld.hit, tapped: false };
      if (bld.hit) bld.hit.addEventListener("click", function (e) { e.stopPropagation(); bonus(); });
      active.tm = later(function () { if (active && active.root === bld.root) stopEvent(); }, bld.ms + 150);
      if (key === "ufo" || key === "dalahast" || key === "odjur") buzz([20, 40, 20]);
    }
    caption({ head: headOf(key, tn), text: fill(tx.cap, { sektor: tn.name, stad: tn.name }), onTap: tx.tap.length ? bonus : null,
      ms: reduced() ? 7000 : 6500, cls: ev.t === "r" ? "dl-cap-rare" : "", ev: key });
    return true;
  }
  function headOf(key, tn) {
    var ev = EV[key] || {}, tier = ev.t === "r" ? (en() ? "RARE · " : "SÄLLSYNT · ") : "";
    return "⚠ " + tier + ui("contact") + " · " + ui("sector") + " " + String(tn.name).toUpperCase();
  }
  function eventsOff() { return lsStr(KEY.off, "") === "1"; }
  function blocked() {
    try { var it = $("intro"); if (it && !it.hidden) return true; } catch (e) {}
    try { if (A && A.sheetOpen && A.sheetOpen()) return true; } catch (e) {}
    if (document.querySelector(".takeover")) return true;
    try { if (window.OLNU_STRIP && window.OLNU_STRIP.up()) return true; } catch (e) {}   // never over the beer-type strip
    return document.hidden;
  }
  // One possible event per "open". Seen slots are remembered, so the same hour shows nothing new.
  function maybeEvent(tries) {
    tries = tries | 0;
    if (FORCE && EV[FORCE]) { if (blocked() && tries < 8) { later(function () { maybeEvent(tries + 1); }, 2500); return; } var k = FORCE; FORCE = ""; runEvent(k); return; }
    if (eventsOff()) return;
    var sl = slot();
    if (!sl.key) return;
    var seen = lsGet(KEY.seen, {});
    if (seen[sl.id]) return;
    if (blocked()) { if (tries < 10) later(function () { maybeEvent(tries + 1); }, 6000); return; }
    seen[sl.id] = Date.now();
    var ks = Object.keys(seen); if (ks.length > 60) { ks.sort(function (a, b) { return seen[a] - seen[b]; }); ks.slice(0, ks.length - 60).forEach(function (k) { delete seen[k]; }); }
    lsSet(KEY.seen, seen);
    runEvent(sl.key);
  }

  /* ---------- caption banner (own HUD strip above the dock; never over the ÖL! button) ---------- */
  var capQ = [], capCur = null;
  function caption(o) {
    if (!o || !o.text) return;
    if (o.ev) {
      capQ = capQ.filter(function (x) { return !x.ev; });             // a new map event replaces older event captions
      if (capCur && !capCur.ev && !o.now) { clearTimeout(capCur.tm); capQ.unshift(capCur); capShow(o); return; }   // greeting etc. waits
    }
    if (capCur && (o.now || (o.ev && capCur.ev))) { capShow(o); return; }
    if (capCur) { if (capQ.length < 3) capQ.push(o); return; }
    capShow(o);
  }
  function capShow(o) {
    var box = $("dl-cap");
    if (!box) {
      box = mk("div", "dl-cap"); box.id = "dl-cap"; box.setAttribute("role", "status"); box.setAttribute("aria-live", "polite");
      box.addEventListener("click", function () {
        var c = capCur; if (!c) return;
        if (c.onTap) { var f = c.onTap; c.onTap = null; f(); return; }
        capNext();
      });
      document.body.appendChild(box);
    }
    if (capCur && capCur.tm) clearTimeout(capCur.tm);
    capCur = o;
    box.className = "dl-cap " + (o.cls || "") + (o.onTap ? " dl-cap-tap" : "");
    box.innerHTML = (o.head ? '<div class="dl-cap-h">' + esc(o.head) + "</div>" : "") + '<div class="dl-cap-t">' + esc(o.text) + "</div>" +
      (o.onTap ? '<div class="dl-cap-more" aria-hidden="true">' + (en() ? "TAP ▸" : "TRYCK ▸") + "</div>" : "");
    box.hidden = false;
    capPlace(box);
    void box.offsetWidth; box.classList.add("dl-in");
    var ms = o.ms || Math.max(4800, Math.min(9000, String(o.text).length * 75));
    o.tm = setTimeout(capNext, ms);
  }
  // Stay clear of bottom panels of other modules (e.g. the beer-type strip above the dock).
  function capPlace(box) {
    var top = Infinity;
    document.querySelectorAll(".bp-strip").forEach(function (x) {
      if (x.hidden || !x.getClientRects().length) return;
      var r = x.getBoundingClientRect(); if (r.height && r.top < top) top = r.top;
    });
    box.style.bottom = top < Infinity ? Math.round(window.innerHeight - top + 10) + "px" : "";
  }
  function capNext() {
    var box = $("dl-cap");
    if (capCur && capCur.tm) clearTimeout(capCur.tm);
    capCur = null;
    if (capQ.length) { capShow(capQ.shift()); return; }
    if (box) { box.classList.remove("dl-in"); later(function () { if (!capCur && box) box.hidden = true; }, 260); }
  }

  /* ---------- 2. Boot lines ---------- */
  var boot = { el: null, iv: null, start: 0, done: false, lines: 0 };
  function bootShow() {
    if (boot.el || boot.done) return;
    var list = txt(C().boot), el = mk("div", "dl-boot");
    if (!list.length) return;
    el.id = "dl-boot"; el.setAttribute("role", "status");
    el.innerHTML = '<div class="dl-boot-h"><span class="dl-boot-dot"></span>' + esc(ui("bootHead")) + ' · ÖL NU</div><div class="dl-boot-l"></div>';
    document.body.appendChild(el);
    boot.el = el; boot.start = Date.now();
    var last = +lsStr(KEY.boot, "-1"), order = list.map(function (x, i) { return i; }).sort(function () { return Math.random() - 0.5; });
    if (order[0] === last && order.length > 1) order.push(order.shift());
    lsPut(KEY.boot, String(order[0]));
    var i = 0;
    var step = function () {
      if (!boot.el || document.hidden) return;
      var box = boot.el.querySelector(".dl-boot-l"), prev = box.lastElementChild;
      if (prev) prev.classList.add("dl-ok");
      var ln = mk("div", "dl-bl", "&gt; " + esc(list[order[i % order.length]]) + ' <b>' + esc(txt((C().boot || {}).ok)[0] || "OK") + "</b>");
      box.appendChild(ln); i++; boot.lines++;
      while (box.children.length > 3) box.firstElementChild.remove();
    };
    step();
    boot.iv = setInterval(step, 620);
    later(function () { if (!boot.done) bootHide(true); }, 15000);
  }
  function bootHide(slow) {
    if (boot.done) return;
    boot.done = true;
    var el = boot.el; if (!el) return;
    var wait = Math.max(0, 1300 - (Date.now() - boot.start)) + (FORCE === "boot" ? 8000 : 0);
    later(function () {
      clearInterval(boot.iv); boot.iv = null;
      var box = el.querySelector(".dl-boot-l"), prev = box && box.lastElementChild;
      if (prev) prev.classList.add("dl-ok");
      if (box) {
        var d = (C().boot || {}).done, line = slow ? (en() ? "📡 Weak signal – carrying on." : "📡 Svag signal – vi kör ändå.") : pick(txt(d));
        box.appendChild(mk("div", "dl-bl dl-done", esc(line)));
        while (box.children.length > 3) box.firstElementChild.remove();
      }
      later(function () { el.classList.add("dl-out"); later(function () { el.remove(); boot.el = null; }, 400); }, 750);
    }, wait);
  }

  /* ---------- 3. Empty state ---------- */
  var emptyAt = 0, emptyTown = "";
  function checkEmpty(beers, force) {
    if (!A || !A.map) return;
    var p = here(), z = 0;
    try { z = A.map.getZoom(); } catch (e) {}
    var near = 0;
    (beers || []).forEach(function (b) { if (b && isFinite(b.lat) && U.haversine(p.lat, p.lng, b.lat, b.lng) <= 4000 && U.drinks(b) >= 1) near++; });
    var tn = town();
    if (!force && (near > 0 || z < 9)) { hideEmpty(); return; }
    if (!force && blocked()) return;
    if (!force && Date.now() - emptyAt < 10 * 60000 && emptyTown === tn.name) return;
    emptyAt = Date.now(); emptyTown = tn.name;
    var box = $("dl-empty");
    if (!box) { box = mk("div", "dl-empty"); box.id = "dl-empty"; box.setAttribute("role", "status"); document.body.appendChild(box); }
    var line = fill(pick(txt(C().empty)), { stad: tn.name });
    box.innerHTML = '<div class="dl-radar" aria-hidden="true"><i></i></div><div class="dl-empty-h">◎ ' + esc(ui("empty")) + " · 4 KM</div><div class=\"dl-empty-t\">" + esc(line) + "</div>";
    box.hidden = false; void box.offsetWidth; box.classList.add("dl-in");
    clearTimeout(box._tm); box._tm = setTimeout(hideEmpty, 9000);
  }
  function hideEmpty() {
    var box = $("dl-empty"); if (!box || box.hidden) return;
    box.classList.remove("dl-in"); clearTimeout(box._tm);
    later(function () { if (!box.classList.contains("dl-in")) box.hidden = true; }, 500);
  }
  function hookTicker() {
    var nm = window.NEWS_MORE, list = (C().empty || {}).sv;
    if (!nm || !Array.isArray(nm.sv) || nm._dlEmpty || !Array.isArray(list)) return;
    nm._dlEmpty = true;
    list.forEach(function (line) {
      nm.sv.push({ k: "calm", f: function (d) { return fill(line, { stad: (d && d.stad) || "stan" }); } });
    });
  }

  /* ---------- 4. Easter eggs ---------- */
  function capTeeth(cx, cy, r1, r2, n) {
    var p = [];
    for (var i = 0; i < n * 2; i++) { var a = Math.PI * i / n, r = i % 2 ? r2 : r1; p.push((cx + r * Math.cos(a)).toFixed(1) + "," + (cy + r * Math.sin(a)).toFixed(1)); }
    return p.join(" ");
  }
  // Ölguden: an original barrel god — foam beard, bottle-cap crown, Dala flower on the belly.
  function gudSVG(fishing) {
    var beard = [[38, 92, 11], [50, 98, 12], [62, 100, 12], [74, 98, 12], [86, 92, 11], [44, 108, 11], [60, 112, 12], [76, 108, 11], [52, 120, 9], [68, 120, 9], [60, 127, 7], [32, 84, 8], [92, 84, 8]];
    var h = '<svg class="dl-gud-svg" viewBox="0 0 124 170" aria-hidden="true">' +
      '<ellipse cx="62" cy="164" rx="40" ry="5" fill="rgba(0,0,0,.35)"/>' +
      '<ellipse cx="44" cy="160" rx="11" ry="6" fill="#3b2412"/><ellipse cx="80" cy="160" rx="11" ry="6" fill="#3b2412"/>' +
      '<path d="M22 52Q8 104 22 156H102Q116 104 102 52Z" fill="#9a6532" stroke="#4a2d12" stroke-width="3"/>' +
      '<path d="M40 54Q34 104 40 156M62 52V156M84 54Q90 104 84 156" stroke="#6e4420" stroke-width="2" fill="none"/>' +
      '<path d="M16 72Q62 82 108 72M14 140Q62 150 110 140" stroke="#2b2f36" stroke-width="7" fill="none"/>' +
      '<path d="M16 72Q62 82 108 72M14 140Q62 150 110 140" stroke="#7d8a96" stroke-width="2" fill="none"/>' +
      '<ellipse cx="13" cy="104" rx="7" ry="13" fill="#9a6532" stroke="#4a2d12" stroke-width="2.5" class="dl-gud-arm"/>' +
      '<ellipse cx="111" cy="104" rx="7" ry="13" fill="#9a6532" stroke="#4a2d12" stroke-width="2.5" class="dl-gud-arm dl-gud-arm2"/>' +
      '<g class="dl-gud-eyes"><ellipse cx="48" cy="66" rx="10" ry="11" fill="#fffaf0"/><ellipse cx="76" cy="66" rx="10" ry="11" fill="#fffaf0"/>' +
      '<circle cx="50" cy="68" r="4.5" fill="#111"/><circle cx="74" cy="68" r="4.5" fill="#111"/><circle cx="51.5" cy="66" r="1.5" fill="#fff"/><circle cx="75.5" cy="66" r="1.5" fill="#fff"/></g>' +
      '<path d="M37 52Q47 47 56 53M68 53Q77 47 87 52" stroke="#3b2412" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
      '<g class="dl-gud-beard">';
    beard.forEach(function (c) { h += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + c[2] + '" fill="#fffaf0"/>'; });
    h += '<circle cx="56" cy="102" r="3" fill="#f3e6c8"/><circle cx="70" cy="112" r="2.5" fill="#f3e6c8"/></g>' +
      '<path d="M54 86Q62 91 70 86" stroke="#7a3b10" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
      '<g transform="translate(62 140)"><circle r="6" fill="#c8102e"/><circle r="2.2" fill="#ffe08a"/><ellipse cx="-10" cy="1" rx="5" ry="2.6" fill="#2e7d32"/><ellipse cx="10" cy="1" rx="5" ry="2.6" fill="#2e7d32"/></g>' +
      '<g class="dl-gud-crown"><polygon points="' + capTeeth(62, 30, 20, 17, 21) + '" fill="#e2b33c" stroke="#8a6d00" stroke-width="1.5"/>' +
      '<circle cx="62" cy="30" r="13" fill="#ffd54f" stroke="#b8860b" stroke-width="1.5"/><text x="62" y="35.5" font-size="15" text-anchor="middle" font-family="Black Ops One, Impact, sans-serif" fill="#8a3d06">Ö</text></g>';
    if (fishing) h += '<path d="M116 98L122 4" stroke="#5d4037" stroke-width="3" stroke-linecap="round"/><path d="M122 4Q132 40 128 90" stroke="rgba(255,255,255,.6)" stroke-width="1" fill="none"/>';
    h += "</svg>";
    if (fishing) h += '<span class="dl-bobber" aria-hidden="true"></span>';
    return h;
  }
  function showGud() {
    if ($("dl-gud")) return;
    var C2 = C().gud || {}, line = pick(txt(C2)), wrap = mk("div", "dl-gud");
    wrap.id = "dl-gud"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-label", txt(C2.title)[0] || "Ölguden");
    var last = lsStr(KEY.gud, ""); if (line === last) line = pick(txt(C2));
    lsPut(KEY.gud, line);
    wrap.innerHTML = '<div class="dl-gud-glow" aria-hidden="true"></div><div class="dl-gud-drop">' + gudSVG(false) + '</div>' +
      '<div class="dl-gud-say"><div class="dl-gud-h">' + esc(txt(C2.title)[0] || "") + '</div><div class="dl-gud-t">”' + esc(line) + '”</div><div class="dl-gud-x">' + esc(txt(C2.tap)[0] || "") + "</div></div>";
    var close = function () { wrap.classList.add("dl-out"); later(function () { wrap.remove(); }, 350); };
    wrap.addEventListener("click", close);
    document.body.appendChild(wrap);
    sound("clink"); buzz([20, 60, 20, 60, 60]);
    later(function () { if (wrap.parentNode) close(); }, 9000);
  }
  function hookLogo() {
    var logo = document.querySelector(".brand-name"); if (!logo || logo._dl) return;
    logo._dl = true; logo.style.cursor = "default";
    var n = 0, t0 = 0;
    logo.addEventListener("click", function () {
      var now = Date.now();
      n = now - t0 > 1500 ? 1 : n + 1; t0 = now;
      if (n >= 3 && n < 7 && !reduced()) { logo.classList.remove("dl-wiggle"); void logo.offsetWidth; logo.classList.add("dl-wiggle"); }
      if (n >= 7) { n = 0; showGud(); }
    });
  }
  // Long-press ÖL! for 3 s while it counts down → a secret line. Listens on the document (the button is disabled then).
  function hookLongPress() {
    var tm = null, sx = 0, sy = 0;
    function onBeer(e) {
      var b = $("btn-beer"); if (!b) return false;
      var r = b.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    }
    function cancel() { if (tm) { clearTimeout(tm); tm = null; } var b = $("btn-beer"); if (b) b.classList.remove("dl-press"); }
    var lastStart = 0;
    function start(e) {
      var now = Date.now();
      if (tm && now - lastStart < 400) return;          // pointer + touch for the same press
      cancel();
      var b = $("btn-beer"); if (!b || !b.classList.contains("cooldown") || !onBeer(e)) return;
      sx = e.clientX; sy = e.clientY; lastStart = now;
      b.classList.add("dl-press");
      tm = setTimeout(function () { tm = null; b.classList.remove("dl-press"); secret(); }, 3000);
    }
    function move(e) { if (tm && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 24) cancel(); }
    function touchPt(e) { var t = e.touches && e.touches[0]; return t ? { clientX: t.clientX, clientY: t.clientY } : null; }
    document.addEventListener("pointerdown", start, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", cancel, true);
    document.addEventListener("pointercancel", cancel, true);
    // iOS WebKit may skip pointer events on a disabled button; touch events still arrive.
    document.addEventListener("touchstart", function (e) { var p = touchPt(e); if (p) start(p); }, { capture: true, passive: true });
    document.addEventListener("touchmove", function (e) { var p = touchPt(e); if (p) move(p); }, { capture: true, passive: true });
    document.addEventListener("touchend", cancel, { capture: true, passive: true });
    document.addEventListener("touchcancel", cancel, { capture: true, passive: true });
  }
  function secret() {
    var list = txt(C().secret); if (!list.length) return;
    buzz([30, 50, 30, 50, 90]); sound("clink");
    caption({ head: en() ? "🔒 CLASSIFIED" : "🔒 HEMLIGSTÄMPLAT", text: pick(list), cls: "dl-cap-secret", now: true, ms: 7000 });
  }
  // Shake → foam. iPhone needs a permission asked from a tap (settings). Android/desktop: on unless switched off.
  // ÖLGLASET (js/olglas.js, loaded on demand): this is the ONE shake detector. ~3 peaks in 1 s open the glass, every later
  // peak fills it more. iPhone: motion + orientation permission asked once from a tap (⚙️ toggle sheet / "Testa ölglaset").
  var motion = { on: false, hits: [], last: 0, lx: null, seen: false, pk: 0 };
  var ogLoading = null, OG_PERM = "olnu.og.perm";
  function og() { return window.OLGLAS || null; }
  function ogLoad() {
    if (og()) return Promise.resolve(og());
    if (ogLoading) return ogLoading;
    var pickAttr = function (sel, re, at) { var n = [].filter.call(document.querySelectorAll(sel), function (x) { return re.test(x.getAttribute(at) || ""); })[0]; return n ? n.getAttribute(at) : null; };
    var href = pickAttr('link[rel="x-lazy-css"]', /olglas\.css/, "href") || "./olglas.css";
    if (!document.querySelector('link[rel="stylesheet"][href="' + href + '"]')) { var l = mk("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l); }
    var src = pickAttr('script[type="text/x-lazy"]', /olglas\.js/, "src") || "./js/olglas.js";
    ogLoading = new Promise(function (res, rej) {
      var s = mk("script"); s.src = src; s.async = true;
      s.onload = function () { if (og()) res(og()); else rej(new Error("olglas empty")); };
      s.onerror = function () { s.remove(); rej(new Error("olglas load")); };
      document.head.appendChild(s);
    }).then(function (G) { ogLoading = null; return G; }, function (e) { ogLoading = null; throw e; });
    return ogLoading;
  }
  function glass(o) {
    o = o || {}; o.api = A;
    return ogLoad().then(function (G) { G.open(o); return G; }, function () { foam(); return null; });
  }
  function needPerm() {
    var DM = window.DeviceMotionEvent, DO = window.DeviceOrientationEvent;
    return !!((DM && typeof DM.requestPermission === "function") || (DO && typeof DO.requestPermission === "function"));
  }
  // Call inside a tap. Both requests start in the same gesture (iOS shows one "Motion & Orientation" prompt).
  function askPerm() {
    var DM = window.DeviceMotionEvent, DO = window.DeviceOrientationEvent, ps = [];
    try { if (DM && typeof DM.requestPermission === "function") ps.push(DM.requestPermission()); } catch (e) { ps.push(Promise.reject(e)); }
    try { if (DO && typeof DO.requestPermission === "function") ps.push(DO.requestPermission()); } catch (e) { ps.push(Promise.reject(e)); }
    return Promise.all(ps).then(function (r) { var ok = r.every(function (s) { return s === "granted"; }); lsPut(OG_PERM, ok ? "1" : "0"); return ok; },
      function () { lsPut(OG_PERM, "0"); return false; });
  }
  function hookGlassPress() {
    // No motion sensors (desktop, or no events yet): long-press ÖL! 0.7 s = fill the glass. The click that follows is
    // swallowed, so a long-press never logs a beer. During the cooldown the 3 s secret (hookLongPress) keeps the button.
    var tm = null, sx = 0, sy = 0, eatUntil = 0;
    function onBtn(e) { var b = $("btn-beer"); return !!(b && e.target && e.target.closest && e.target.closest("#btn-beer")); }
    function cancel() { if (tm) { clearTimeout(tm); tm = null; } }
    document.addEventListener("pointerdown", function (e) {
      cancel();
      var b = $("btn-beer");
      if (!onBtn(e) || motion.seen || !shakeWanted() || b.disabled || b.classList.contains("cooldown")) return;
      sx = e.clientX; sy = e.clientY;
      tm = setTimeout(function () { tm = null; eatUntil = Date.now() + 1500; buzz(20); glass({ level: 0.5 }); }, 700);
    }, true);
    document.addEventListener("pointermove", function (e) { if (tm && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 16) cancel(); }, true);
    document.addEventListener("pointerup", cancel, true);
    document.addEventListener("pointercancel", cancel, true);
    document.addEventListener("click", function (e) {
      if (Date.now() < eatUntil && onBtn(e)) { eatUntil = 0; e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    document.addEventListener("contextmenu", function (e) { if (onBtn(e) && (tm || Date.now() < eatUntil)) e.preventDefault(); }, true);
  }
  function shakeWanted() {
    var v = lsStr(KEY.shake, "");
    if (U.isIOS && U.isIOS()) return v === "1";
    return v !== "0";
  }
  function onMotion(e) {
    var a = e.accelerationIncludingGravity || e.acceleration; if (!a || a.x == null) return;
    var now = Date.now(), cur = { x: a.x || 0, y: a.y || 0, z: a.z || 0 };
    motion.seen = true;   // this phone has motion sensors (no long-press fallback)
    if (motion.lx) {
      var d = Math.abs(cur.x - motion.lx.x) + Math.abs(cur.y - motion.lx.y) + Math.abs(cur.z - motion.lx.z);
      if (d > 32) {
        if (now - motion.pk < 110) { motion.lx = cur; return; }   // one swing = one peak
        motion.pk = now;
        var G = og();
        if (G && G.isOpen()) { G.peak(1); motion.lx = cur; return; }   // the glass ticks the haptic itself
        buzz(12);
        motion.hits = motion.hits.filter(function (t) { return now - t < 1000; }); motion.hits.push(now);
        if (motion.hits.length >= 3 && now - motion.last > 3000 && (!G || Date.now() - G.closedAt() > 2500)) { motion.last = now; motion.hits = []; glass({ level: 0.4 }); }
      }
    }
    motion.lx = cur;
  }
  function motionSync() {
    var want = shakeWanted() && !document.hidden && "DeviceMotionEvent" in window;
    if (want && !motion.on) { window.addEventListener("devicemotion", onMotion, { passive: true }); motion.on = true; }
    else if (!want && motion.on) { window.removeEventListener("devicemotion", onMotion); motion.on = false; motion.lx = null; }
  }
  function askShake(btnEl) {
    var turnOn = function () { lsPut(KEY.shake, "1"); motionSync(); if (A) A.toast(txt((C().shake || {}).on)[0] || "📳"); setShakeBtn(btnEl); };
    var denied = function () { if (A) A.toast(txt((C().shake || {}).denied)[0] || "📳", { err: true }); };
    if (shakeWanted()) { lsPut(KEY.shake, "0"); motionSync(); setShakeBtn(btnEl); return; }
    if (!needPerm() || lsStr(OG_PERM, "") === "1") { turnOn(); return; }
    // iPhone: a friendly sheet first; its button is the tap that asks the system once.
    var sh = C().shake || {};
    A.openSheet(txt(sh.askT)[0] || "📳", function (body) {
      body.appendChild(A.el("p", { text: txt(sh.ask)[0] || "" }));
      body.appendChild(A.el("div", { class: "row", style: "flex-wrap:wrap;gap:8px" }, [
        A.btn(txt(sh.askOk)[0] || "OK", "btn-amber", function () {
          askPerm().then(function (ok) { A.closeSheet(); if (ok) turnOn(); else denied(); });
        }),
        A.btn(txt(sh.askNo)[0] || "–", "btn-small", function () { A.closeSheet(); })
      ]));
    }, { now: true });
  }
  function testGlass() {
    A.closeSheet();
    var go = function () { setTimeout(function () { glass({ level: 0.55 }); }, 120); };
    if (needPerm() && lsStr(OG_PERM, "") !== "1") askPerm().then(function (ok) { if (ok) { lsPut(KEY.shake, "1"); motionSync(); } go(); });
    else go();
  }
  function setShakeBtn(b) {
    if (!b) return;
    b.textContent = (txt((C().shake || {}).setting)[0] || "📳") + ": " + (shakeWanted() ? ui("eventsOn") : ui("eventsOff"));
    b.setAttribute("aria-pressed", String(shakeWanted()));
  }
  function foam() {
    var tn = town(), line = fill(pick(txt(C().shake)), { stad: tn.name });
    buzz([40, 30, 40, 30, 80]); sound("clink");
    if (reduced() || document.hidden) { caption({ text: line, now: true }); return; }
    var old = $("dl-foam"); if (old) old.remove();
    var f = mk("div", "dl-foam"); f.id = "dl-foam"; f.setAttribute("aria-hidden", "true");
    var h = '<div class="dl-foam-sea"><div class="dl-foam-top"></div></div>';
    for (var i = 0; i < 16; i++) h += '<span class="dl-fb" style="left:' + (Math.random() * 96).toFixed(1) + "%;--s:" + (8 + Math.random() * 18).toFixed(0) + "px;animation-delay:" + (Math.random() * 900).toFixed(0) + 'ms"></span>';
    h += '<div class="dl-foam-t">' + esc(line) + "</div>";
    f.innerHTML = h;
    document.body.appendChild(f);
    later(function () { f.remove(); }, 3000);
  }
  // "skål" in a group chat → glasses clink over the new message. Watches the sheet; never edits social.js.
  var skalSeen = typeof WeakSet === "function" ? new WeakSet() : null, skalAt = 0;
  var SKAL_RE = /(^|[^a-zåäöA-ZÅÄÖ])(sk[åa]l|cheers)([^a-zåäöA-ZÅÄÖ]|$)/i;
  function hookChat() {
    var body = $("sheet-body"); if (!body || !window.MutationObserver || !skalSeen) return;
    new MutationObserver(function (muts) {
      if ($("sheet").hidden) return;
      var fresh = [];
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes || [], function (n) {
          if (!n || n.nodeType !== 1) return;
          var li = n.classList && n.classList.contains("chat-msg") ? [n] : (n.querySelectorAll ? n.querySelectorAll(".chat-msg") : []);
          Array.prototype.forEach.call(li, function (x) { if (!skalSeen.has(x)) { skalSeen.add(x); fresh.push(x); } });
        });
      });
      var now = Date.now();
      for (var i = fresh.length - 1; i >= 0; i--) {
        var li = fresh[i], b = li.querySelector(".cm-body"), at = Date.parse(li.getAttribute("data-at") || "");
        if (!b || !SKAL_RE.test(b.textContent || "")) continue;
        if (isFinite(at) && now - at > 120000) continue;     // history: no clink
        if (now - skalAt < 2500) break;
        skalAt = now; clink(li); break;
      }
    }).observe(body, { childList: true, subtree: true });
  }
  function clink(anchor) {
    sound("clink"); buzz(30);
    var r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: innerWidth / 2 - 50, top: innerHeight / 2, width: 100, height: 0 };
    var line = pick(txt(C().skal)) || "🥂";
    if (reduced()) { if (A) A.toast(line, { cls: "skal", ms: 2500 }); return; }
    var c = mk("div", "dl-clink"); c.setAttribute("aria-hidden", "true");
    c.style.left = px(Math.max(110, Math.min(innerWidth - 110, r.left + r.width / 2)));
    c.style.top = px(Math.max(90, Math.min(innerHeight - 110, r.top + r.height / 2 - 10)));
    var h = '<span class="dl-mug dl-mug-l">🍺</span><span class="dl-mug dl-mug-r">🍺</span>';
    for (var i = 0; i < 8; i++) h += '<i style="--a:' + (i * 45) + 'deg"></i>';
    h += '<b class="dl-clink-t">' + esc(line.replace(/^\S+\s/, "")) + "</b>";
    c.innerHTML = h;
    document.body.appendChild(c);
    later(function () { c.remove(); }, 1700);
  }

  /* ---------- 5. Moods: greeting + sunrise ---------- */
  var DAYN = { sv: ["", "MÅNDAG", "TISDAG", "ONSDAG", "TORSDAG", "FREDAG", "LÖRDAG", "SÖNDAG"], en: ["", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] };
  function greet(force) {
    var s = sthlm(), e = evening(s), dk = dayKey(s);
    if (!force && lsStr(KEY.greet, "") === dk) return false;
    lsPut(KEY.greet, dk);
    var G = C().greet || {}, set = (en() ? G.en : G.sv) || G.sv || {}, list = set[e.dow] || (G.sv || {})[e.dow] || [];
    var line = pick(list); if (!line) return false;
    if (s.h >= 1 && s.h < 5) line += txt(G.late)[0] || "";
    var nm = ""; try { nm = A && A.getName ? A.getName() : ""; } catch (x) {}
    caption({ head: "📋 " + ui("greetHead") + " · " + DAYN[lng()][e.dow] + (nm ? " · " + nm.toUpperCase() : ""), text: line, cls: "dl-cap-greet", ms: 6500 });
    return true;
  }
  function sunrise(force) {
    var s = sthlm(), dk = s.y + "-" + s.m + "-" + s.d;
    if (!force && (s.h !== 5 || s.min > 20 || lsStr(KEY.sun, "") === dk)) return;
    if (!force && blocked() && !document.hidden) return;
    if (document.hidden) return;
    lsPut(KEY.sun, dk);
    var tn = town();
    caption({ head: "🌅 05:00 · " + (en() ? "NIGHT OVER" : "NATTEN SLUT"), text: fill(pick(txt(C().sunrise)), { stad: tn.name }), cls: "dl-cap-sun", now: true, ms: 7000 });
    if (reduced()) return;
    var o = mk("div", "dl-sunrise"); o.setAttribute("aria-hidden", "true");
    o.innerHTML = '<div class="dl-sky"></div><div class="dl-sun"><div class="dl-rays"></div></div>';
    document.body.appendChild(o);
    var map = $("map"); if (map) map.classList.add("dl-lanterns");
    later(function () { o.classList.add("dl-out"); later(function () { o.remove(); }, 900); }, 5600);
  }

  /* ---------- 6. Kapsylsamlingen ---------- */
  function caps() { return C().caps || []; }
  function capById(id) { var l = caps(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function capState() { var s = lsGet(KEY.caps, null); if (!s || typeof s !== "object") s = {}; s.owned = s.owned || {}; return s; }
  function capCount(st) { st = st || capState(); return Object.keys(st.owned).filter(function (k) { return capById(k); }).length; }
  // One cap per evening day. Legendary 3 %, rare 17 %, else common. Pity: rare (or better) at least every 10 days.
  function rollCap(force) {
    var st = capState(), dk = dayKey(), list = caps();
    if (!list.length) return null;
    if (st.last === dk && !force) return null;
    st.last = dk; st.days = (st.days | 0) + 1; st.since = (st.since | 0) + 1;
    var x = Math.random(), tier = x < 0.03 ? "l" : x < 0.2 ? "r" : "c";
    if (tier === "c" && st.since >= 10) tier = "r";
    if (tier !== "c") st.since = 0;
    var pool = list.filter(function (c) { return c.r === tier; }), fresh = pool.filter(function (c) { return !st.owned[c.id]; });
    var c = pick(fresh.length && Math.random() < 0.8 ? fresh : pool) || list[0];
    st.owned[c.id] = (st.owned[c.id] | 0) + 1; st.pending = c.id; st.lastId = c.id;
    lsSet(KEY.caps, st);
    try { if (A && A.updateCounts) A.updateCounts(); } catch (e) {}
    return c;
  }
  function capHTML(c, big) {
    if (!c) return '<span class="dl-capx dl-cap-none' + (big ? " dl-big" : "") + '"><span class="dl-cap-m">?</span></span>';
    return '<span class="dl-capx dl-r-' + c.r + (big ? " dl-big" : "") + '" style="--c1:' + esc(c.c1) + ";--c2:" + esc(c.c2) + '">' +
      '<span class="dl-cap-m">' + esc(c.m) + "</span>" + (c.r === "l" ? '<span class="dl-shine"></span>' : "") + "</span>";
  }
  // The 🧢 HUD chip can sit inside a closed panel: also say it once in the caption strip (tap = open).
  function capNotice() {
    var st = capState(); if (!st.pending) return;
    caption({ head: "🧢 " + (en() ? "BOTTLE CAPS" : "KAPSYLSAMLINGEN"), text: ui("capWait"), onTap: openCaps, ms: 6000 });
  }
  function openCaps() {
    if (!A || !A.openSheet) return;
    if (capCur && capCur.onTap === openCaps) capNext();
    var st = capState(), pend = st.pending ? capById(st.pending) : null;
    if (st.pending) { delete st.pending; lsSet(KEY.caps, st); try { A.updateCounts(); } catch (e) {} }
    A.openSheet(ui("capTitle"), function (body) {
      var h = "";
      if (pend) {
        var lines = (C().capLines || {})[pend.r] || {};
        h += '<div class="dl-reveal' + (reduced() ? "" : " dl-anim") + '">' + capHTML(pend, true) +
          '<div class="dl-rv-n">' + esc(pend.n) + '</div><div class="dl-rv-r dl-rr-' + pend.r + '">' + esc((ui("rarity") || {})[pend.r] || "") +
          (st.owned[pend.id] > 1 ? " · ×" + st.owned[pend.id] : "") + '</div><div class="dl-rv-l">' + esc(pick(txt(lines))) + "</div></div>";
        if (pend.r !== "c") buzz([30, 40, 60]);
        sound("clink");
      }
      var n = capCount(st), m = caps().length;
      h += '<div class="dl-cap-sum"><b>' + esc(fill(ui("capOf"), { n: n, m: m })) + '</b><div class="dl-bar"><i style="width:' + Math.round(100 * n / Math.max(1, m)) + '%"></i></div>' +
        '<div class="muted">' + esc(ui("capHint")) + (st.days ? " " + esc(fill(ui("capPity"), { n: Math.max(1, 10 - (st.since | 0)) })) + "." : "") + "</div></div>";
      h += '<div class="dl-grid">';
      caps().forEach(function (c) {
        var own = st.owned[c.id] | 0;
        h += '<div class="dl-cell' + (own ? "" : " dl-miss") + '" title="' + esc(own ? c.n : ui("capMissing")) + '">' + capHTML(own ? c : null, false) +
          '<span class="dl-cell-n">' + esc(own ? c.n : ui("capMissing")) + (own > 1 ? " ×" + own : "") + "</span></div>";
      });
      h += "</div>";
      var spot = lsGet(KEY.spot, {}), sn = Object.keys(spot).filter(function (k) { return EV[k]; }).length;
      h += '<p class="dl-spot muted">' + esc(fill(ui("spotted"), { n: sn, m: Object.keys(EV).length })) + "</p>";
      body.innerHTML = '<div class="dl-caps">' + h + "</div>";
    });
  }

  /* ---------- open / visibility flow ---------- */
  var started = false, hiddenAt = 0, tickIv = null;
  function afterData() {
    if (started) return;
    started = true;
    bootHide(false);
    var cap = (lsStr("olnu.intro", "") === "1" || FORCE) ? rollCap(FORCE === "cap") : null;
    var t = 2600, greeted = false;
    later(function () {
      if (FORCE === "greet") greeted = greet(true);
      else if (!blocked()) greeted = greet(false);
      if (cap && FORCE !== "cap") capNotice();
    }, t);
    later(function () {
      if (FORCE === "gud") showGud();
      else if (FORCE === "secret") secret();
      else if (FORCE === "shake") glass({ level: 0.5 });
      else if (FORCE === "skal") clink(null);
      else if (FORCE === "sunrise") sunrise(true);
      else if (FORCE === "empty") checkEmpty([], true);
      else if (FORCE === "cap") openCaps();
      else later(function () { maybeEvent(0); }, greeted ? 2500 : 0);
    }, FORCE ? 1200 : t + 4200);
  }
  function tick() {
    if (document.hidden) return;
    sunrise(false);
  }
  function onVis() {
    if (document.hidden) {
      hiddenAt = Date.now();
      stopEvent();
      if (tickIv) { clearInterval(tickIv); tickIv = null; }
      if (boot.iv) { clearInterval(boot.iv); boot.iv = null; }
      motionSync();
      return;
    }
    motionSync();
    if (!tickIv) tickIv = setInterval(tick, 20000);
    tick();
    if (hiddenAt && Date.now() - hiddenAt > 3 * 60000 && started) {
      later(function () {
        if (rollCap(false)) later(capNotice, 7000);
        if (!greet(false)) later(function () { maybeEvent(0); }, 300); else later(function () { maybeEvent(0); }, 5000);
      }, 1500);
    }
    hiddenAt = 0;
  }

  /* ---------- hooks (app.js mods()) ---------- */
  window.DELIGHT = {
    // debug / tests
    events: EV, slot: slot, run: runEvent, caption: caption, gud: showGud, foam: foam, glass: glass, clink: clink, sunrise: function () { sunrise(true); },
    greet: function () { return greet(true); }, rollCap: rollCap, openCaps: openCaps, empty: function () { checkEmpty([], true); },
    init: function (api) {
      A = api;
      try { bootShow(); } catch (e) {}
      hookLogo(); hookLongPress(); hookChat(); hookGlassPress();
      later(hookTicker, 0);
      // news-more.js may load lazily after start (js/boot.js): add the empty-state ticker lines when it arrives.
      document.addEventListener("olnu:lazy", function () { try { hookTicker(); } catch (e) {} });
      try { if (window.OLNU_LAZY && window.OLNU_LAZY.then) window.OLNU_LAZY.then(function () { try { hookTicker(); } catch (e) {} }, function () {}); } catch (e) {}
      motionSync();
      document.addEventListener("visibilitychange", onVis);
      tickIv = setInterval(tick, 20000);
      // No data path (coming soon / slow server): start anyway.
      later(function () { if (!started) afterData(); }, A.LIVE ? 12000 : 2600);
    },
    onPoll: function (beers) {
      var map = $("map"); if (map && map.classList.contains("dl-lanterns")) map.classList.remove("dl-lanterns");
      if (!started) afterData();
      try { checkEmpty(beers, false); } catch (e) {}
    },
    hudChipsHTML: function () {
      var st = capState(); if (!st.pending) return "";
      return '<button type="button" class="hx-chip dl-cap-chip" data-hx="dlcap" aria-label="' + esc(ui("capChip")) + '" title="' + esc(ui("capChip")) + '">🧢</button>';
    },
    hudClick: function (action) { if (action === "dlcap") openCaps(); },
    settingsSheet: function (body) {
      if (!A || !A.el) return;
      var st = capState(), m = caps().length;
      body.appendChild(A.el("h3", { text: ui("settings") }));
      var evBtn = A.btn("", "btn-small", function () {
        lsPut(KEY.off, eventsOff() ? "" : "1"); setEv();
        if (!eventsOff()) runEvent(pick(Object.keys(EV).filter(function (k) { return EV[k].t !== "r" && eligible(EV[k], sthlm()); })) || "alg");
      });
      var setEv = function () { evBtn.textContent = ui("events") + ": " + (eventsOff() ? ui("eventsOff") : ui("eventsOn")); evBtn.setAttribute("aria-pressed", String(!eventsOff())); };
      setEv();
      var shBtn = A.btn("", "btn-small", function () { askShake(shBtn); });
      setShakeBtn(shBtn);
      var row = [A.btn(fill(ui("capBtn"), { n: capCount(st), m: m }), "btn-small", function () { A.closeSheet(); setTimeout(openCaps, 50); }), evBtn];
      if ("DeviceMotionEvent" in window) row.push(shBtn);
      row.push(A.btn(txt((C().shake || {}).test)[0] || "🍺", "btn-small", testGlass));   // ÖLGLASET: works without sensors too
      body.appendChild(A.el("div", { class: "row", style: "flex-wrap:wrap;gap:8px" }, row));
    },
    applyText: function () {}
  };
})();
