/* PintsNow — 🧯 crash reports only (STORE build). scripts/strip-logging.py puts this file in place of js/pnlog.js and removes
   js/pnlog-hooks.js, so the store app and the stable web app after the store launch carry NO usage logging code at all.
   Sends only: err.js (message + file:line), err.rej (message), err.rpc (function name + error code). Each with the screen
   type (map / sheet / intro) and seconds since start. No taps, no screens by name, no position, no device data.
   Max 3 of the same error per app start, max 50 per start; ONE request per minute at most, the rest at pagehide.
   Same server function as the beta (pnlog_ingest; class "err" is accepted in every mode except "none").
   Same public shape as pnlog.js so app.js mods(), vitals.js and other callers keep working:
   window.PNLOG = { init, onAuthed, onPoll, settingsSheet (nothing), event (err.* only), loc (nothing), flush, state, cls, allowed, onRpc }. */
(function () {
  "use strict";
  var CFG = window.OLNU_CONFIG || {}, A = null, Q = [], seen = {}, total = 0, sq = 0, sent = 0, dead = false, lastSend = 0, T = 0;
  var sess = (function () { var s = ""; for (var i = 0; i < 10; i++) s += "abcdefghijkmnpqrstuvwxyz23456789".charAt(Math.floor(Math.random() * 32)); return s; })();
  function mode() { try { return localStorage.getItem("olnu.logMode") || "on"; } catch (e) { return "on"; } }
  function scrub(s, max) {
    return String(s == null ? "" : s).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "#")
      .replace(/\S+@\S+/g, "#").replace(/@/g, " ").replace(/\d{4,}/g, "#").replace(/\s+/g, " ").trim().slice(0, max || 60);
  }
  function where() {
    try {
      var i = document.getElementById("intro"), s = document.getElementById("sheet");
      return i && !i.hidden ? "intro" : s && !s.hidden ? "sheet" : "map";
    } catch (e) { return "?"; }
  }
  function push(n, p) {
    if (dead || mode() === "none" || total >= 50) return;
    var k = n + (p.m || "") + (p.f || "") + (p.fn || "") + (p.c || "");
    seen[k] = (seen[k] || 0) + 1; if (seen[k] > 3) return;
    total++;
    p.s = where(); p.age = Math.round((window.performance && performance.now ? performance.now() : 0) / 1000);
    Q.push({ at: Date.now(), n: n, p: p });
    if (!T) T = setTimeout(function () { T = 0; flush(false); }, Math.max(2000, 60000 - (Date.now() - lastSend)));
  }
  function ch() { try { return window.OLNU_STORE ? "store" : "stable"; } catch (e) { return "stable"; } }
  function ver() { try { var s = ([].slice.call(document.querySelectorAll('script[src*="app.bundle"]')).pop() || document.querySelector('script[src*="app.js"]')); /* left-T25 */ return (s && (s.getAttribute("src").match(/v=([\w]+)/) || [])[1]) || "?"; } catch (e) { return "?"; } }
  function token() {
    try {
      var a = JSON.parse(localStorage.getItem("olnu.auth") || "null"), s = a && (a.currentSession || a);
      if (!s || !s.access_token || s.expires_at && s.expires_at * 1000 < Date.now() + 5000) return null;
      return s.access_token;
    } catch (e) { return null; }
  }
  function flush(beacon) {
    if (dead || !Q.length) return Promise.resolve(false);
    var tok = token(); if (!tok || !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) return Promise.resolve(false);
    var evs = Q.splice(0, 50), t0 = evs[0].at;
    var body = JSON.stringify({ p: { v: 1, t0: t0, ver: ver(), ch: ch(), sess: sess, sq: ++sq, cons: false,
      ev: evs.map(function (e) { return { t: e.at - t0, n: e.n, p: e.p }; }), loc: [] } });
    lastSend = Date.now(); sent++;
    var opt = { method: "POST", keepalive: true, credentials: "omit", headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + tok }, body: body };
    try {
      return fetch(CFG.SUPABASE_URL + "/rest/v1/rpc/pnlog_ingest", opt).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (d && d.mode === "none") { dead = true; Q = []; }
        try { if (d && d.mode) localStorage.setItem("olnu.logMode", d.mode); } catch (e) {}
        return !!d;
      }, function () { Q = evs.concat(Q).slice(-50); return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  window.addEventListener("error", function (e) {
    if (!e || e.target && e.target !== window && e.target.tagName) return;   // a broken image is not an app error
    var f = String(e.filename || "").split("?")[0].split("/").pop();
    push("err.js", { m: scrub(e.message || "error", 140), f: f ? scrub(f + ":" + (e.lineno || 0), 64) : "" });
  }, true);
  window.addEventListener("unhandledrejection", function (e) { var r = e && e.reason; push("err.rej", { m: scrub((r && (r.message || r)) || "rejection", 140) }); });
  window.addEventListener("pagehide", function () { flush(true); });
  document.addEventListener("visibilitychange", function () { if (document.hidden) flush(true); });
  function wrapClient() {
    var c = null; try { c = A && A.client ? A.client() : null; } catch (e) {}
    if (!c || typeof c.rpc !== "function" || c.rpc._pnlog) return;
    var orig = c.rpc;
    var w = function (name, params) {
      var q = orig.apply(this, arguments);
      try {
        if (q && typeof q.then === "function" && name !== "pnlog_ingest") {
          var ot = q.then;
          q.then = function (res, rej) {
            return ot.call(q, function (r) {
              try { if (r && r.error) { var c2 = String(r.error.code || r.error.message || "error"); push("err.rpc", { fn: String(name).slice(0, 40), c: /^[A-Z0-9_]{1,10}$/i.test(c2) ? c2 : scrub(c2, 40) }); } } catch (x) {}
              return res ? res(r) : r;
            }, rej);
          };
        }
      } catch (e) {}
      return q;
    };
    w._pnlog = 1; c.rpc = w;
  }
  window.PNLOG = {
    init: function (api) { A = api; wrapClient(); },
    onAuthed: wrapClient, onPoll: wrapClient,
    settingsSheet: function () {},
    event: function (n, p) { if (/^err\.[a-z0-9_.]{1,30}$/.test(String(n))) { var o = {}; if (p && typeof p === "object") Object.keys(p).slice(0, 6).forEach(function (k) { var v = p[k]; if (/^[a-z]{1,8}$/.test(k) && (typeof v === "number" || typeof v === "boolean")) o[k] = v; else if (/^[a-z]{1,8}$/.test(k) && typeof v === "string") o[k] = scrub(v, 64); }); push(String(n), o); } },
    loc: function () {},
    flush: function () { return flush(false); },
    state: function () { return { q: Q.length, l: 0, sent: sent, selfMs: 0, mode: mode(), full: false, loc: false, keep: false, heavy: false, crashOnly: true, authed: !!token(), sess: sess, screen: where(), dead: dead }; },
    cls: function (n) { return String(n).indexOf("err.") === 0 ? "err" : "off"; },
    allowed: function (c) { return c === "err"; },
    onRpc: function () {}, screen: where, crumbs: function () { return ""; }
  };
})();
