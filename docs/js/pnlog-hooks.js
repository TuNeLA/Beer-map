/* PintsNow — 📊 PNLOG hooks (agent lgx, 2026-11-08). Beta "max logging" until the store launch. ONE file, no module edits:
   it hooks the app from outside at run time (fetch / share / clipboard / camera / Notification wrappers, map events through
   the app api, DOM events, MutationObservers on #intro and the sheet, PerformanceObservers, RPC results through
   PNLOG.onRpc). Every event goes through PNLOG.event(), so the mode + consent + class gate of pnlog.js decides what is sent:
     KEEP  (diagnostics: dev, dev.env, crash.*, net.*, sw.*, perf.ft / perf.inp / perf.mem / net.res) – on, optin, lite
     USE   (usage: ob.*, inv.*, share, copy, set, srch, ux.*, map.sum, game.*, flow.*, ntf.*, inst.*, cam, file, perm …)
     HEAVY (high volume usage: sheet.view, map.cam, set.ls) – also needs the server flag heavy = on
   Privacy: never text, names, ids, codes or urls (only the NAME of a link parameter); the map camera is rounded to 0.01°
   (~1 km) and never sent in ghost mode or near home. Cost: handlers only count into memory; summaries are built on idle at
   the 10-min / hide flush of pnlog.js; our own time is added to perf.self (PNLOG._self). Public: window.PNLOG_HOOKS. */
(function () {
  "use strict";
  var P = window.PNLOG;
  if (!P || !P.event || window.PNLOG_HOOKS) return;
  var off = false;
  try { off = (localStorage.getItem("olnu.logMode") || "") === "none"; } catch (e) {}
  if (off) { window.PNLOG_HOOKS = { init: function () {}, off: true }; return; }

  var A = null, T0 = Date.now();
  var CFG = window.OLNU_CONFIG || {};
  function pnow() { return window.performance && performance.now ? performance.now() : Date.now(); }
  function cost(t) { try { P._self(pnow() - t); } catch (e) {} }
  function ev(n, p) { try { P.event(n, p || {}); } catch (e) {} }
  function can(c) { try { return P.allowed(c); } catch (e) { return false; } }
  function scr() { try { return P.screen(); } catch (e) { return "?"; } }
  function key(el) { try { return P._key(el); } catch (e) { return "?"; } }
  function idle(fn) { if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 3000 }); else setTimeout(fn, 250); }
  function $(id) { return document.getElementById(id); }
  function inc(o, k, n) { o[k] = (o[k] || 0) + (n || 1); }
  function pct(arr, q) { if (!arr.length) return null; var s = arr.slice().sort(function (a, b) { return a - b; }); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * q))]); }
  var lastDown = 0, lastDownEl = null;
  var closeSig = { h: "", at: 0 }, sdMax = 0, sdOn = false, views = 0, curView = "", flow = null, sheetT0 = 0;
  function sig(h) { closeSig = { h: h, at: pnow() }; }

  /* ---------- anonymous counters before an account exists (pnlog_ping: day + key + count, no user, no id) ---------- */
  var pings = 0;
  function ping(k) {
    if (pings >= 12 || !can("use") || !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) return;
    try { if (P.state().authed) return; } catch (e) {}
    pings++;
    try {
      OF(CFG.SUPABASE_URL + "/rest/v1/rpc/pnlog_ping", { method: "POST", keepalive: true, credentials: "omit",
        headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + CFG.SUPABASE_ANON_KEY },
        body: JSON.stringify({ p_k: k }) }).catch(function () {});
    } catch (e) {}
  }

  /* ---------- 1. device (KEEP) ---------- */
  function dev() {
    var t = pnow(), n = navigator, ua = n.userAgent || "", p = {}, q = {};
    var os = /Android/.test(ua) ? "android" : /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && n.maxTouchPoints > 1) ? "ios" : /Windows/.test(ua) ? "win" : /CrOS/.test(ua) ? "cros" : /Mac OS X/.test(ua) ? "mac" : /Linux/.test(ua) ? "linux" : "other";
    var m = os === "android" ? ua.match(/Android (\d+(?:\.\d+)?)/) : os === "ios" ? ua.match(/OS (\d+)[_.](\d+)/) : null;
    p.os = os; p.osv = m ? (os === "ios" ? m[1] + "." + m[2] : m[1]) : "";
    var b = ua.match(/SamsungBrowser\/(\d+)/) ? ["samsung", RegExp.$1] : ua.match(/EdgA?\/(\d+)/) ? ["edge", RegExp.$1] : ua.match(/(?:Firefox|FxiOS)\/(\d+)/) ? ["firefox", RegExp.$1]
      : ua.match(/OPR\/(\d+)/) ? ["opera", RegExp.$1] : ua.match(/(?:Chrome|CriOS)\/(\d+)/) ? ["chrome", RegExp.$1] : ua.match(/Version\/(\d+).*Safari/) ? ["safari", RegExp.$1] : ["other", ""];
    p.br = b[0]; p.brv = b[1]; p.mob = /Mobi|Android|iPhone|iPad/.test(ua);
    try { p.scw = screen.width; p.sch = screen.height; p.dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100; } catch (e) {}
    if (n.deviceMemory) p.mem = n.deviceMemory;
    if (n.hardwareConcurrency) p.cpu = n.hardwareConcurrency;
    try { p.sa = !!(window.matchMedia && matchMedia("(display-mode: standalone)").matches) || !!n.standalone; } catch (e) {}
    var c = n.connection;
    if (c) { if (c.effectiveType) q.ct = c.effectiveType; if (c.rtt != null) q.rtt = c.rtt; if (c.downlink != null) q.dl = c.downlink; if (c.saveData) q.sd = true; }
    q.lng = String(n.language || "").slice(0, 5);
    try { q.np = window.Notification ? Notification.permission : "na"; } catch (e) {}
    try { q.rm = matchMedia("(prefers-reduced-motion: reduce)").matches; q.dk = matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) {}
    try { var nv = performance.getEntriesByType("navigation")[0]; q.nav = nv ? nv.type : ""; } catch (e) {}
    q.swc = !!(n.serviceWorker && n.serviceWorker.controller);
    q.tz = -new Date().getTimezoneOffset();
    q.tch = n.maxTouchPoints || 0;
    // data minimisation: without usage consent only system + browser (+ connection type); model, memory, screen, CPU,
    // language, time zone … only when usage logging is on
    var send = function () {
      if (!can("use")) { ev("dev", { os: p.os, osv: p.osv, br: p.br, brv: p.brv, mob: p.mob, sa: p.sa }); if (q.ct) ev("dev.env", { ct: q.ct, nav: q.nav, swc: q.swc }); return; }
      ev("dev", p); ev("dev.env", q);
    };
    try {
      if (n.permissions && n.permissions.query) n.permissions.query({ name: "geolocation" }).then(function (s) { gp = s.state; s.onchange = function () { ev("perm", { k: "geo", v: s.state, s: scr() }); gp = s.state; }; }, function () {});
    } catch (e) {}
    if (n.userAgentData && n.userAgentData.getHighEntropyValues) {
      n.userAgentData.getHighEntropyValues(["model", "platformVersion"]).then(function (v) {
        if (v && v.model) p.mdl = String(v.model).slice(0, 24);
        if (v && v.platformVersion && os !== "ios") p.osv = String(v.platformVersion).split(".").slice(0, 2).join(".");
        send();
      }, send);
    } else {
      var mm = os === "android" ? ua.match(/Android [\d.]+; ([^;)]{2,24})[;)]/) : null;
      if (mm && mm[1] !== "K") p.mdl = mm[1].trim(); else if (os === "ios") p.mdl = /iPad/.test(ua) ? "iPad" : "iPhone";
      send();
    }
    cost(t);
  }
  var gp = "";
  // 🔋 battery (USE): level at start and end of the session, charging
  var bat0 = null;
  function battery(final) {
    if (!navigator.getBattery || !can("use")) return;
    navigator.getBattery().then(function (b) {
      var lv = Math.round(b.level * 100);
      if (!final) { if (bat0 == null) bat0 = { lv: lv, at: Date.now() }; return; }
      if (bat0) ev("pw.bat", { l0: bat0.lv, l1: lv, chg: b.charging, min: Math.round((Date.now() - bat0.at) / 60000) });
      bat0 = { lv: lv, at: Date.now() };
    }, function () {});
  }

  /* ---------- 2. crash-like reloads (KEEP) ---------- */
  function errMark() { try { var t = Date.now(); if (t - (+sessionStorage.getItem("olnu.logErrAt") || 0) > 3000) sessionStorage.setItem("olnu.logErrAt", String(t)); } catch (e) {} }
  (function () {
    try {
      var nv = performance.getEntriesByType("navigation")[0], at = +sessionStorage.getItem("olnu.logErrAt") || 0;
      if (nv && nv.type === "reload" && at && Date.now() - at < 15000) ev("crash.reload", { sec: Math.round((Date.now() - at) / 1000) });
      if (at) sessionStorage.removeItem("olnu.logErrAt");
    } catch (e) {}
  })();

  /* ---------- 3. network (KEEP): fetch wrapper → net.sum / net.fail; offline; connection changes ---------- */
  var OF = window.fetch ? window.fetch.bind(window) : null, NET = {}, lastFail = {}, failN = {}, inflight = 0, fetchAt = 0;
  function nk(u) {
    if (/\/rest\/v1\/rpc\//.test(u)) return "rpc";
    if (/\/rest\/v1\//.test(u)) return "rest";
    if (/\/auth\/v1\//.test(u)) return "auth";
    if (/\/functions\/v1\//.test(u)) return "fn";
    if (/\/storage\/v1\//.test(u)) return "stor";
    if (/arcgisonline|cartocdn|openfreemap|mapbox|tiles\./.test(u)) return "tile";
    if (/\.json(\?|$)/.test(u)) return "data";
    if (/jsdelivr|cdnjs|googleapis|gstatic/.test(u)) return "cdn";
    return "other";
  }
  function rec(k, u, ms, st, xn) {
    var t = pnow(), a = NET[k] || (NET[k] = { n: 0, f: 0, x: 0, s: 0, r: 0, ms: [] });
    a.n++; if (a.ms.length < 150) a.ms.push(ms); if (ms > 3000) a.s++;
    var path = u.split("?")[0], bad = !st || st >= 400;
    if (lastFail[path] && Date.now() - lastFail[path] < 15000) a.r++;
    if (bad) {
      if (st) a.f++; else a.x++;
      lastFail[path] = Date.now();
      var fk = k + ":" + (st || xn || "x");
      if ((failN[fk] = (failN[fk] || 0) + 1) <= 2) {
        var p = { k: k, st: st || 0, on: navigator.onLine !== false, ms: Math.round(ms) };
        if (!st && xn) p.x = String(xn).slice(0, 20);
        if (k === "rpc") p.fn = (path.match(/rpc\/(\w+)/) || [])[1] || "";
        ev("net.fail", p);
      }
    } else delete lastFail[path];
    cost(t);
  }
  if (OF) {
    var wf = function (input, init) {
      var u = typeof input === "string" ? input : input && input.url ? input.url : String(input || "");
      if (/pnlog_ingest|pnlog_ping/.test(u)) return OF(input, init);
      var t0 = pnow(), k = nk(u), pr = OF(input, init);
      fetchAt = t0; inflight++;
      try { pr.then(function (r) { inflight--; rec(k, u, pnow() - t0, r.status); }, function (e) { inflight--; rec(k, u, pnow() - t0, 0, e && e.name); }); } catch (e) {}
      return pr;
    };
    wf._pnlog = 1;
    try { window.fetch = wf; } catch (e) {}
  }
  var offAt = 0, ctAt = 0;
  window.addEventListener("offline", function () { offAt = Date.now(); });
  window.addEventListener("online", function () { if (offAt) ev("net.off", { sec: Math.round((Date.now() - offAt) / 1000), s: scr() }); offAt = 0; });
  try {
    var NC = navigator.connection;
    if (NC && NC.addEventListener) NC.addEventListener("change", function () {
      if (Date.now() - ctAt < 60000) return; ctAt = Date.now();
      ev("net.ct", { ct: NC.effectiveType || "", rtt: NC.rtt, dl: NC.downlink, sd: !!NC.saveData });
    });
  } catch (e) {}
  // resources (KEEP): count, cache hits (same origin: transferSize 0 + body), kB, slow. The observer only keeps the entries;
  // the sorting runs in summary() (idle time).
  var RES = {}, RAW = [];
  try {
    new PerformanceObserver(function (l) { var x = l.getEntries(); if (RAW.length < 3000) RAW.push.apply(RAW, x); }).observe({ type: "resource", buffered: true });
  } catch (e) {}
  function resSort() {
    var list = RAW; RAW = [];
    list.forEach(function (r) {
      var u = r.name || "";
      if (/rest\/v1|auth\/v1|functions\/v1/.test(u)) return;   // counted by the fetch wrapper
      var ty = /\.js(\?|$)/.test(u) ? "js" : /\.css(\?|$)/.test(u) ? "css" : /\.json(\?|$)/.test(u) ? "json" : nk(u) === "tile" ? "tile" : /\.(png|jpe?g|webp|svg|gif)(\?|$)/.test(u) ? "img" : /\.(woff2?|ttf)(\?|$)/.test(u) ? "font" : "other";
      var a = RES[ty] || (RES[ty] = { n: 0, hit: 0, kb: 0, s: 0, ms: 0 });
      a.n++; a.ms += r.duration; if (r.duration > 2000) a.s++;
      if (r.transferSize === 0 && r.decodedBodySize > 0) a.hit++;
      a.kb += (r.transferSize || 0) / 1024;
    });
  }

  /* ---------- 4. service worker (KEEP) + notification lifecycle (USE) ---------- */
  try {
    var SWC = navigator.serviceWorker;
    if (SWC) {
      SWC.addEventListener("controllerchange", function () { ev("sw.upd", { sec: Math.round((Date.now() - T0) / 1000) }); });
      SWC.addEventListener("message", function (e) {
        var d = e && e.data || {};
        if (d.type === "pn-kanal-fell") ev("sw.fell", {});
        if (d.type === "olnu-open") ev("ntf.open", { k: lkind(String(d.url || "")), live: 1 });
      });
      if (SWC.getRegistration) setTimeout(function () {
        SWC.getRegistration().then(function (r) {
          if (!r) return;
          if (r.waiting) ev("sw.wait", {});
          r.addEventListener("updatefound", function () { ev("sw.new", {}); });
        }, function () {});
      }, 8000);
    }
  } catch (e) {}
  function lkind(u) { var m = String(u).match(/[?&]([a-z_]{2,12})=/); return m ? m[1] : "home"; }
  // sw.js counts pushes / clicks / closes per kind in Cache "olnu-pending" ./__pnlog_ntf; we read + clear it when visible
  function ntfRead() {
    if (!window.caches || !can("use")) return;
    caches.open("olnu-pending").then(function (c) {
      return c.match("./__pnlog_ntf").then(function (r) {
        if (!r) return;
        return r.json().then(function (j) {
          c.delete("./__pnlog_ntf");
          ["rx", "clk", "x"].forEach(function (w) { var o = j && j[w] || {}; Object.keys(o).slice(0, 12).forEach(function (k) { ev("ntf." + w, { k: k, n: o[k] }); }); });
          var a = j && j.act || {}; Object.keys(a).slice(0, 6).forEach(function (k) { ev("ntf.act", { k: k, n: a[k] }); });
          if (j && j.lastClk && Date.now() - j.lastClk.at < 30000 && Date.now() - T0 < 30000) ev("ntf.open", { k: j.lastClk.k, cold: 1 });
        });
      });
    }).catch(function () {});
  }
  try {
    if (window.Notification && Notification.requestPermission && !Notification.requestPermission._pnlog) {
      var orq = Notification.requestPermission.bind(Notification), was = Notification.permission;
      Notification.requestPermission = function () {
        var s = scr(), t0 = Date.now();
        was = Notification.permission;
        var pr = orq.apply(null, arguments);
        if (pr && pr.then) pr.then(function (r) { ev("ntf.ask", { r: r, was: was, s: s, sec: Math.round((Date.now() - t0) / 1000) }); }, function () { ev("ntf.ask", { r: "err", s: s }); });
        return pr;
      };
      Notification.requestPermission._pnlog = 1;
    }
    if (window.PushManager && PushManager.prototype.subscribe && !PushManager.prototype.subscribe._pnlog) {
      var osub = PushManager.prototype.subscribe;
      PushManager.prototype.subscribe = function () {
        var pr = osub.apply(this, arguments);
        pr.then(function () { ev("ntf.sub", { ok: true }); }, function (e) { ev("ntf.sub", { ok: false, x: e && e.name || "" }); });
        return pr;
      };
      PushManager.prototype.subscribe._pnlog = 1;
    }
  } catch (e) {}

  /* ---------- 5. install prompt (USE) ---------- */
  window.addEventListener("beforeinstallprompt", function (e) {
    ev("inst.prompt", { s: scr() });
    try { if (e.userChoice) e.userChoice.then(function (c) { ev("inst.res", { r: c && c.outcome || "?" }); }, function () {}); } catch (x) {}
  });
  window.addEventListener("appinstalled", function () { ev("inst.ok", {}); });

  /* ---------- 6. share / copy / camera / files (USE) ---------- */
  function skind(x) {
    var s = typeof x === "string" ? x : x ? String((x.url || "") + " " + (x.text || "")) : "";
    var m = s.match(/[?&](join|ev|invite|inv|duel|party|friend|flytt|rally|film|find)=/);
    if (m) return m[1];
    if (/flytta/.test(s)) return "flytt";
    if (x && x.files && x.files.length) return "file";
    if (/https?:\/\//.test(s)) return "link";
    return "text";
  }
  try {
    if (navigator.share && !navigator.share._pnlog) {
      var osh = navigator.share.bind(navigator);
      var wsh = function (d) {
        var s = scr(), k = skind(d), pr = osh(d);
        try { pr.then(function () { ev("share", { s: s, k: k, r: "ok" }); }, function (e) { ev("share", { s: s, k: k, r: e && e.name === "AbortError" ? "cancel" : "err" }); }); } catch (e) {}
        return pr;
      };
      wsh._pnlog = 1; navigator.share = wsh;
    }
  } catch (e) {}
  try {
    var CB = navigator.clipboard;
    if (CB && CB.writeText && !CB.writeText._pnlog) {
      var owt = CB.writeText.bind(CB);
      var wwt = function (txt) { ev("copy", { s: scr(), k: skind(String(txt || "")) }); return owt(txt); };
      wwt._pnlog = 1; CB.writeText = wwt;
    }
  } catch (e) {}
  try {
    var MD = navigator.mediaDevices;
    if (MD && MD.getUserMedia && !MD.getUserMedia._pnlog) {
      var ogum = MD.getUserMedia.bind(MD);
      var wg = function (c) {
        var s = scr(), v = c && c.video ? 1 : 0, au = c && c.audio ? 1 : 0, t0 = pnow(), pr = ogum(c);
        pr.then(function () { ev("cam", { s: s, a: "ok", v: v, au: au, ms: Math.round(pnow() - t0) }); },
          function (e) { ev("cam", { s: s, a: e && /NotAllowed|Security/.test(e.name) ? "deny" : "err", x: e && e.name || "", v: v, au: au }); });
        return pr;
      };
      wg._pnlog = 1; MD.getUserMedia = wg;
    }
  } catch (e) {}
  document.addEventListener("change", function (e) {
    var el = e.target; if (!el || el.tagName !== "INPUT") return;
    var t = pnow();
    if (el.type === "file") {
      var fs = el.files || [], kb = 0, ty = "";
      for (var i = 0; i < fs.length; i++) { kb += fs[i].size / 1024; ty = ty || String(fs[i].type || "").split("/")[0]; }
      ev("file", { s: scr(), k: key(el), n: fs.length, kb: Math.round(kb), ty: ty, cap: el.hasAttribute("capture") });
    } else if (/^(checkbox|radio|range)$/.test(el.type)) {
      ev("set", { s: scr(), k: key(el), v: el.type === "range" ? +el.value : el.checked ? "on" : "off" });
    }
    cost(t);
  }, { capture: true, passive: true });
  document.addEventListener("change", function (e) {
    var el = e.target; if (!el || el.tagName !== "SELECT") return;
    ev("set", { s: scr(), k: key(el), v: el.selectedIndex });
  }, { capture: true, passive: true });

  /* ---------- 7. settings: switches (USE) + olnu.* storage keys changed right after a tap (HEAVY set.ls) ---------- */
  var VOCAB = /^(0|1|true|false|on|off|yes|no|auto|light|dark|sv|en|beta|stable|\d{1,3})$/;
  var NOKEY = /name|nick|mail|phone|code|swish|home|addr|town|city|auth|uid|token|text|msg|note|draft|log|night|seen|at$|asked|nudge|last|cache|warm|pending/i;
  var lsSeen = 0;
  try {
    var SP = Storage.prototype, osi = SP.setItem;
    if (!osi._pnlog) {
      var wsi = function (k, v) {
        var r = osi.apply(this, arguments);
        try {
          if (this === window.localStorage && typeof k === "string" && k.indexOf("olnu.") === 0) {
            if (k.indexOf("olnu.log") === 0) { try { P._lsDirty(k); } catch (e) {} }
            else if (pnow() - lastDown < 2000 && lsSeen < 40 && !NOKEY.test(k.slice(5))) {
              var sv = String(v); lsSeen++;
              ev("set.ls", { k: k.slice(5, 29), v: VOCAB.test(sv) ? sv : sv.length <= 16 && /^[a-z][a-z0-9-]{1,15}$/.test(sv) && /style|mode|lang|theme|tab|kanal/i.test(k) ? sv : "*" });
            }
          }
        } catch (e) {}
        return r;
      };
      wsi._pnlog = 1; SP.setItem = wsi;
      var ori = SP.removeItem;
      SP.removeItem = function (k) { var r = ori.apply(this, arguments); try { if (this === window.localStorage && typeof k === "string" && k.indexOf("olnu.log") === 0) P._lsDirty(k); } catch (e) {} return r; };
    }
  } catch (e) {}

  /* ---------- 8. rage taps + dead taps (USE), back button ---------- */
  var downs = [], DEAD = {}, deadN = 0, rageAt = 0;
  var INTER = "button, a, input, select, textarea, label, summary, [role], [onclick], [tabindex], [data-pn], [data-act], [data-hx], [data-id], [data-k], .pill, .leaflet-interactive, .leaflet-marker-icon, .marker-cluster";
  // ONE pointerdown + ONE click listener for all hooks (cheap checks first; the dead-tap watch only for non-buttons)
  document.addEventListener("pointerdown", function (e) {
    var t = pnow(), el = e.target;
    lastDown = t; lastDownEl = el;
    try {
      if (el && el.closest) {
        if (el.closest("#sheet-close")) sig("x"); else if (el.id === "backdrop") sig("bg"); else if (el.closest(".sheet-grip, .sheet-head")) sig("swipe");
      }
      if (can("use")) {
        var x = e.clientX, y = e.clientY;
        downs.push({ t: t, x: x, y: y }); if (downs.length > 4) downs.shift();
        var n = 0; for (var i = 0; i < downs.length; i++) if (t - downs[i].t < 1000 && Math.abs(downs[i].x - x) < 30 && Math.abs(downs[i].y - y) < 30) n++;
        if (n >= 3 && t - rageAt > 2000) { rageAt = t; ev("ux.rage", { s: scr(), k: key(el), n: n, map: !!(el.closest && el.closest("#map")) }); }
      }
    } catch (x2) {}
    cost(t);
  }, { capture: true, passive: true });
  document.addEventListener("click", function (e) {
    var t = pnow(), el = e.target;
    try {
      if (!el || !el.closest || el === document.body || !can("use")) return;
      var btn = el.closest("button, a, input, select, label, [role]");
      if (btn) {
        if (btn.getAttribute("role") === "switch") setTimeout(function () { var v = btn.getAttribute("aria-checked"); ev("set", { s: scr(), k: key(btn), v: v === "true" ? "on" : v === "false" ? "off" : "?" }); }, 0);
        return;
      }
      if (deadN > 60 || el.closest("#map, " + INTER)) return;
      var k = key(el), s = scr(), seen = false, mo = new MutationObserver(function () { seen = true; mo.disconnect(); }), f0 = fetchAt;
      mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "aria-expanded", "open"] });
      setTimeout(function () { mo.disconnect(); if (!seen && fetchAt === f0) { deadN++; inc(DEAD, s + "|" + k); } }, 800);
    } catch (x) {} finally { cost(t); }
  }, { capture: true, passive: true });
  var popAt = 0;
  window.addEventListener("popstate", function () {   // a real back gesture / button has no tap right before it (the app's own history.back() follows a tap)
    popAt = pnow(); var s = scr();
    if (s === "map" && can("use") && popAt - lastDown > 800) ev("nav.back", { s: s });
  });

  /* ---------- 9. sheet: how it was closed, scroll depth, sub-views, step flows (avatar, account) ---------- */
  // closeSig / sig: declared at the top (the shared pointerdown listener uses them)
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") sig("esc"); }, { capture: true, passive: true });
  window.addEventListener("popstate", function () { if (!(closeSig.h && pnow() - closeSig.at < 800) && pnow() - lastDown > 800) sig("back"); });
  var scT = 0;
  document.addEventListener("scroll", function (e) {
    var el = e.target; if (!el || !el.closest || !el.closest("#sheet")) return;
    frStart("scroll", 400);
    if (scT) return;
    scT = setTimeout(function () {
      scT = 0;
      var t = pnow();
      try { if (el.scrollHeight > el.clientHeight + 40) { sdOn = true; var d = Math.round(100 * (el.scrollTop + el.clientHeight) / el.scrollHeight); if (d > sdMax) sdMax = d; } } catch (x) {}
      cost(t);
    }, 250);
  }, { capture: true, passive: true });
  function closeInfo(msOpen) {   // pnlog.js adds this to sheet.close
    var p = {}, t = pnow();
    p.h = closeSig.h && t - closeSig.at < 800 ? closeSig.h : "code";
    if (sdOn) p.sd = Math.min(100, sdMax);
    if (msOpen < 2000) p.qk = 1;
    if (views > 1) p.vw = views;
    if (flow && !flow.done) { ev("flow.quit", { f: flow.f, k: flow.k, n: flow.n, sec: Math.round((Date.now() - flow.t0) / 1000) }); flow = null; }
    sdMax = 0; sdOn = false; views = 0; curView = "";
    return p;
  }
  function onSheet(open, s) { if (open) { sheetT0 = Date.now(); sdMax = 0; sdOn = false; views = 1; curView = ""; frStart("sheet", 1200); viewCheck(); } }
  var vPend = false;
  function tabKey(t) {   // data-tab / data-t / aria-controls, else the position in its row ("i2")
    var a = t.getAttribute("data-tab") || t.getAttribute("data-t") || t.getAttribute("data-k") || t.getAttribute("aria-controls") || "";
    a = String(a).replace(/[^\w-]/g, "").slice(0, 24);
    if (a && !/\d{4,}/.test(a)) return a;
    var i = 0, n = t; while ((n = n.previousElementSibling)) i++;
    return "i" + i;
  }
  function viewCheck() {
    vPend = false;
    var t = pnow(), b = $("sheet-body"), sh = $("sheet");
    if (!b || !sh || sh.hidden) return;
    try {
      var bk = P._bodyKey ? P._bodyKey() : "", tab = b.querySelector("[role=tab][aria-selected=true], [aria-pressed=true], .seg .on, .tabs .on, .tabs .active");
      var tk = tab ? tabKey(tab) : "", v = bk + (tk ? "/" + tk : "");
      if (v !== curView) {
        if (curView) { views++; ev("sheet.view", { s: scr(), k: bk, tab: tk, ms: Date.now() - sheetT0 }); }
        curView = v;
      }
      var st = b.querySelector("[data-step]");
      if (st) {
        var f = (st.className && String(st.className).split(/\s+/)[0]) || "flow", k = st.getAttribute("data-step") || "";
        f = /avw|av-|avatar/.test(f) ? "avatar" : /acct/.test(f) ? "account" : f.slice(0, 16);
        if (!flow || flow.f !== f) flow = { f: f, k: "", n: 0, t0: Date.now(), done: false };
        if (k !== flow.k) { flow.k = k; flow.n++; ev("flow.step", { f: f, k: k, i: flow.n, ms: Date.now() - flow.t0 }); if (/done|klar|finish|saved|ok$/i.test(k)) flow.done = true; }
      }
    } catch (x) {}
    cost(t);
  }
  function watchBody() {
    var b = $("sheet-body"); if (!b || b._pnlogx) return; b._pnlogx = 1;
    new MutationObserver(function () { if (!vPend) { vPend = true; setTimeout(viewCheck, 60); } })   // not idle: the sheet may be closed by then
      .observe(b, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-step", "aria-selected", "aria-pressed"] });
  }

  /* ---------- 10. onboarding: #intro steps (USE + anonymous ping before the account) ---------- */
  var obStep = "", obT0 = 0, obN = 0;
  function introStep() {
    var b = $("intro-body"); if (!b) return "";
    if (b.querySelector(".intro-brand")) return "welcome";
    if (b.querySelector(".intro-privtext")) return "priv";
    var ac = b.querySelector(".acct-flow"); if (ac) return "acct_" + String(ac.getAttribute("data-step") || "").slice(0, 10);
    var big = b.querySelector(".intro-big");
    if (big) return /📍/.test(big.textContent) ? "loc" : /🔞/.test(big.textContent) ? "age" : "other";
    if (b.querySelector("#age-cb")) return "age";
    return b.children.length ? "other" : "";
  }
  function watchIntro() {
    var root = $("intro"), body = $("intro-body"); if (!root || !body || root._pnlogx) return; root._pnlogx = 1;
    var check = function () {
      var t = pnow();
      if (!root.hidden) {
        var s = introStep();
        if (s && s !== obStep) {
          if (!obT0) obT0 = Date.now();
          obStep = s; obN++;
          ev("ob.step", { k: s, i: obN, ms: Date.now() - obT0 });
          if (s === "priv") { try { P._privInto(body.querySelector(".intro-privtext")); } catch (e) {} }   // the 📊 log block also in the intro
          ping("ob." + s.replace(/[^a-z_]/g, ""));
        }
      } else if (obT0 && obStep) {
        ev("ob.done", { k: obStep, n: obN, sec: Math.round((Date.now() - obT0) / 1000), gp: gp || "" });
        ping("ob.done");
        obStep = ""; obT0 = 0; obN = 0;
      }
      cost(t);
    };
    new MutationObserver(function () { idle(check); }).observe(root, { attributes: true, attributeFilter: ["hidden"] });
    new MutationObserver(function () { idle(check); }).observe(body, { childList: true });
    check();
  }

  /* ---------- 11. links: invite / notification / other deep links (USE) ---------- */
  var INV = /^(join|ev|invite|inv|duel|party|friend)$/, inv = null;
  (function () {
    try {
      var ks = []; location.search.replace(/[?&]([a-z_]{2,12})=/g, function (m, k) { ks.push(k); });
      var ik = ks.filter(function (k) { return INV.test(k); })[0], lk = ks.filter(function (k) { return !/^(v|api|key|t|by|app)$/.test(k); })[0];
      var authed = false; try { authed = !!P.state().authed; } catch (e) {}
      if (ik) { inv = { k: ik, at: Date.now(), acct: authed }; ev("inv.open", { k: ik, acct: authed }); ping("inv.open." + ik); }
      else if (lk) ev("link.open", { k: lk, acct: authed });
      if (!authed) ping("pub.open");
    } catch (e) {}
  })();

  /* ---------- 12. map behaviour (USE map.sum, HEAVY map.cam) + frame times (KEEP perf.ft) ---------- */
  var MS = { zh: {}, zm: 0, pan: 0, pz: 0, tap: {} }, camLast = "", camAt = 0, moving = false;
  function hookMap(map) {
    if (!map || !map.on || map._pnlogx) return; map._pnlogx = 1;
    var z0 = null;
    try { z0 = map.getZoom(); } catch (e) {}
    map.on("movestart", function () { moving = true; frStart("map", 10000); });
    map.on("zoomstart", function () { frStart("map", 10000); });
    map.on("moveend", function () {
      var t = pnow(); moving = false; frStop("map", 250);
      try {
        var z = Math.round(map.getZoom());
        if (z0 != null && z !== z0) { MS.zm++; inc(MS.zh, z); } else MS.pan++;
        z0 = z;
      } catch (e) {}
      cost(t);
    });
    map.on("popupopen", function () { inc(MS.tap, "pop"); });
    try {
      var c = map.getContainer ? map.getContainer() : $("map");
      if (c) {
        c.addEventListener("touchstart", function (e) { if (e.touches && e.touches.length >= 2) { MS.pz++; frStart("map", 10000); } }, { passive: true });
        c.addEventListener("contextmenu", function () { inc(MS.tap, "lp"); }, { passive: true });
        c.addEventListener("click", function (e) {
          var el = e.target, k = !el || !el.closest ? "bg" : el.closest(".marker-cluster, .olnu-cl") ? "cl" : el.closest(".olnu-bar, .leaflet-bars-pane, .leaflet-hotbars-pane") ? "bar"
            : el.closest(".pl-mk, .ap-mk") ? "place" : el.closest(".pill, .leaflet-marker-icon, .leaflet-interactive") ? "pin" : el.closest(".leaflet-popup") ? "popup" : el.closest(".leaflet-control") ? "ctrl" : "bg";
          inc(MS.tap, k);
        }, { capture: true, passive: true });
      }
    } catch (e) {}
    setInterval(function () { if (!document.hidden) idle(function () { cam(map); }); }, 60000);
  }
  function cam(map) {
    if (!can("heavy")) return;
    var t = pnow();
    try {
      var c = map.getCenter(), z = Math.round(map.getZoom() * 10) / 10, la = Math.round(c.lat * 100) / 100, ln = Math.round(c.lng * 100) / 100;
      var k = la + "," + ln + "," + Math.round(z);
      if (k !== camLast && !(P._hide && P._hide(c.lat, c.lng))) { camLast = k; ev("map.cam", { z: z, cy: la, cx: ln }); }
    } catch (e) {}
    cost(t);
  }
  function mapSum() {
    var tp = MS.tap, any = MS.zm + MS.pan + MS.pz + Object.keys(tp).length;
    if (!any) return;
    var zh = Object.keys(MS.zh).sort(function (a, b) { return a - b; }).map(function (z) { return z + ":" + MS.zh[z]; }).join(",");
    var sty = ""; try { sty = String(localStorage.getItem("olnu.mapStyle") || "").replace(/[^a-z0-9-]/g, "").slice(0, 16); } catch (e) {}
    var gh = false; try { gh = !!(window.EXTRAS && window.EXTRAS.ghostOn && window.EXTRAS.ghostOn()); } catch (e) {}
    ev("map.sum", { zh: zh.slice(0, 64), zm: MS.zm, pan: MS.pan, pz: MS.pz, cl: tp.cl || 0, bar: tp.bar || 0, pin: (tp.pin || 0) + (tp.place || 0), bg: tp.bg || 0, lp: tp.lp || 0, pop: tp.pop || 0, sty: sty, gh: gh });
    MS = { zh: {}, zm: 0, pan: 0, pz: 0, tap: {} };
  }
  // frame-time histograms while the map moves, a sheet opens or a sheet scrolls: <20, <25, <34, <50, <100, ≥100 ms
  var FT = {}, fr = null;
  function frStart(c, ms) {
    if (!can("keep") || document.hidden) return;
    var until = pnow() + ms;
    if (fr) { if (fr.c === c || c === "map") { fr.c = c; fr.until = Math.max(fr.until, until); } return; }
    fr = { c: c, last: 0, until: until }; requestAnimationFrame(frTick);
  }
  function frStop(c, ms) { if (fr && fr.c === c) fr.until = pnow() + ms; }
  function frTick(t) {
    var r = fr; if (!r) return;
    if (r.last) {
      var d = t - r.last, h = FT[r.c] || (FT[r.c] = { b: [0, 0, 0, 0, 0, 0], n: 0, mx: 0, sum: 0 });
      h.b[d < 20 ? 0 : d < 25 ? 1 : d < 34 ? 2 : d < 50 ? 3 : d < 100 ? 4 : 5]++; h.n++; h.sum += d; if (d > h.mx) h.mx = d;
    }
    r.last = t;
    if (t < r.until && !document.hidden) requestAnimationFrame(frTick); else fr = null;
  }
  function ftSum() {
    Object.keys(FT).forEach(function (c) {
      var h = FT[c]; if (h.n < 5) return;
      var avg = h.sum / h.n;
      ev("perf.ft", { c: c, n: h.n, b: h.b.join(","), mx: Math.round(h.mx), avg: Math.round(avg * 10) / 10, fps: Math.round(1000 / avg), dr: Math.round(100 * (h.b[3] + h.b[4] + h.b[5]) / h.n) });
    });
    FT = {};
  }

  /* ---------- 13. interaction latency (KEEP perf.inp) + memory ---------- */
  var IX = {}, IXn = 0;
  function ctxOf(el) {
    try {
      if (!el || !el.closest) return "other";
      return el.closest("#map") ? "map" : el.closest("#sheet") ? "sheet" : el.closest("#intro") ? "intro" : el.closest("#toasts") ? "toast" : el.closest(".hud-left, #hud-x, .hud, [class*=hud]") ? "hud" : "other";
    } catch (e) { return "other"; }
  }
  try {
    new PerformanceObserver(function (l) {
      var t = pnow();
      l.getEntries().forEach(function (e) {
        if (!e.interactionId) return;
        var x = IX[e.interactionId];
        if (!x) { if (IXn > 400) return; IXn++; x = IX[e.interactionId] = { d: 0, t: /key/.test(e.name) ? "key" : "tap", c: ctxOf(e.target), k: "" }; }
        if (e.duration > x.d) { x.d = e.duration; if (e.duration > 200 && can("use")) x.k = key(e.target); }
      });
      cost(t);
    }).observe({ type: "event", durationThreshold: 40, buffered: true });
  } catch (e) {}
  function inpSum() {
    var g = {}, worst = null;
    Object.keys(IX).forEach(function (id) { var x = IX[id], k = x.t + ":" + x.c; (g[k] = g[k] || []).push(x.d); if (!worst || x.d > worst.d) worst = x; });
    Object.keys(g).forEach(function (k) {
      var a = g[k], p = { t: k.split(":")[0], c: k.split(":")[1], n: a.length, p75: pct(a, 0.75), v: pct(a, 0.98), mx: Math.round(Math.max.apply(null, a)), n200: a.filter(function (d) { return d > 200; }).length };
      ev("perf.inp", p);
    });
    if (worst && worst.k && worst.d > 200) ev("ux.slow", { k: worst.k, c: worst.c, v: Math.round(worst.d) });
    IX = {}; IXn = 0;
  }
  function memSum() {
    try {
      var m = performance.memory;
      if (m && m.usedJSHeapSize) ev("perf.mem", { v: Math.round(m.usedJSHeapSize / 1048576), lim: Math.round(m.jsHeapSizeLimit / 1048576), dom: document.getElementsByTagName("*").length });
    } catch (e) {}
  }

  /* ---------- 14. search fields (USE: length bucket only, never the text) ---------- */
  var SR = null;
  document.addEventListener("input", function (e) {
    var el = e.target; if (!el || el.tagName !== "INPUT") return;
    if (!(el.type === "search" || el.getAttribute("role") === "searchbox" || /sök|search|hitta|filtrera/i.test(el.getAttribute("placeholder") || "") || /search|sok|filter/i.test(el.id || el.className || ""))) return;
    if (!SR || SR.el !== el) SR = { el: el, t0: Date.now(), n: 0, max: 0 };
    SR.n++; SR.max = Math.max(SR.max, (el.value || "").length);
  }, { capture: true, passive: true });
  document.addEventListener("focusout", function (e) {
    if (!SR || e.target !== SR.el) return;
    var L = SR.max;
    ev("srch", { s: scr(), k: key(SR.el), len: L === 0 ? 0 : L < 3 ? 2 : L < 6 ? 5 : L < 11 ? 10 : 99, n: SR.n, sec: Math.round((Date.now() - SR.t0) / 1000) });
    SR = null;
  }, { capture: true, passive: true });

  /* ---------- 15. games (USE): start / end / quit + players + time, from spel_* / party_* answers ---------- */
  var G = {};
  function gQuit(r, why) { if (!r.t0 || r.end) return; r.end = 1; ev("game.quit", { k: r.k, sec: Math.round((Date.now() - r.t0) / 1000), np: r.np, ph: r.ph, why: why }); }
  function onRpc(fn, params, d, ok) {
    var t = pnow();
    try {
      // invite funnel: account made after an invite link; join done
      if (inv && !inv.acct) { var au = false; try { au = !!P.state().authed; } catch (e) {} if (au) { inv.acct = true; ev("inv.acct", { k: inv.k, sec: Math.round((Date.now() - inv.at) / 1000) }); } }
      if (inv && ok && /^(join_group|ev_join|party_join|duel_accept_token|friend_answer|invite_answer)$/.test(fn) && !inv.join) { inv.join = 1; ev("inv.join", { k: inv.k, fn: fn, sec: Math.round((Date.now() - inv.at) / 1000) }); }
      if (ok && fn === "set_my_avatar" && flow && flow.f === "avatar") { flow.done = true; ev("flow.done", { f: "avatar", n: flow.n, sec: Math.round((Date.now() - flow.t0) / 1000) }); }
      var kind = /^spel_/.test(fn) ? "spel" : /^party_/.test(fn) ? "party" : null;
      if (!kind || !ok || !d || typeof d !== "object") return;
      var room = d.room && typeof d.room === "object" ? d.room : d;
      if (!room || !room.id || !room.game) return;
      var r = G[room.id];
      if (r && r.g !== room.game) { gQuit(r, "switch"); r = null; }
      if (!r) r = G[room.id] = { k: (kind + ":" + String(room.game)).slice(0, 30), g: room.game, ph: "", t0: 0, np: 0, end: 0 };
      var np = Array.isArray(d.players) ? d.players.length : (room.n | 0);
      if (np > r.np) r.np = np;
      var ph = String(room.phase || "");
      r.seen = Date.now();
      if (r.end && ph === "lobby") { r.end = 0; r.t0 = 0; }   // a new round in the same room
      if (ph && ph !== "lobby" && !r.t0) { r.t0 = Date.now(); ev("game.start", { k: r.k, np: r.np, host: !!(d.me && d.me.is_host) }); }
      else if ((ph === "end" || ph === "final") && r.t0 && !r.end) { r.end = 1; ev("game.end", { k: r.k, sec: Math.round((Date.now() - r.t0) / 1000), np: r.np, rd: room.round | 0 }); }
      else if (ph === "lobby" && r.t0 && !r.end) gQuit(r, "lobby");
      if (/_act$/.test(fn) && params && params.p_act === "leave") gQuit(r, "leave");
      r.ph = ph;
    } catch (e) {}
    cost(t);
  }
  function gameSum(final) { Object.keys(G).forEach(function (id) { var r = G[id]; if (r.t0 && !r.end && (final || Date.now() - (r.seen || 0) > 600e3)) gQuit(r, final ? "close" : "idle"); }); }

  /* ---------- summaries (called by pnlog.js every 10 min and when the app hides) ---------- */
  function summary(hide) {
    var t = pnow();
    try {
      Object.keys(NET).forEach(function (k) { var a = NET[k]; if (a.n) ev("net.sum", { k: k, n: a.n, f: a.f, x: a.x, s: a.s, r: a.r, p50: pct(a.ms, 0.5), p95: pct(a.ms, 0.95) }); });
      NET = {};
      resSort();
      Object.keys(RES).forEach(function (k) { var a = RES[k]; if (a.n) ev("net.res", { k: k, n: a.n, hit: a.hit, kb: Math.round(a.kb), s: a.s, avg: Math.round(a.ms / a.n) }); });
      RES = {};
      ftSum(); inpSum(); memSum(); mapSum();
      Object.keys(DEAD).sort(function (a, b) { return DEAD[b] - DEAD[a]; }).slice(0, 8).forEach(function (k) { var x = k.split("|"); ev("ux.dead", { s: x[0], k: x[1], n: DEAD[k] }); });
      DEAD = {};
      gameSum(hide === "close");
      if (hide) battery(true);
    } catch (e) {}
    cost(t);
  }

  window.addEventListener("pagehide", function (e) { if (!e.persisted) gameSum(true); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { setTimeout(ntfRead, 1500); } });

  window.PNLOG_HOOKS = {
    init: function (api) {
      A = api;
      try { hookMap(A && A.map); } catch (e) {}
      watchIntro(); watchBody();
      try { P.onRpc(onRpc); } catch (e) {}
      setTimeout(function () { idle(dev); }, 1500);
      setTimeout(function () { battery(false); ntfRead(); }, 4000);
    },
    onAuthed: function () { onRpc("_auth", {}, null, true); },
    closeInfo: closeInfo, onSheet: onSheet, onErr: errMark, summary: summary,
    _sum: summary, _ms: function () { return MS; }, _ft: function () { return FT; }, _frStart: frStart
  };
})();
