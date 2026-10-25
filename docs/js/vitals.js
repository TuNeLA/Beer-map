/* Öl Nu — 📈 VITALS: anonymous speed log (migration 0161). Invisible, no UI. window.VITALS (app.js mods()).
   Measures, cheaply, in the background: load time, frame rate (2 s rAF samples every 3 min while visible, plus during
   map zooms), long tasks (PerformanceObserver, Chrome/Android) split by what was going on ("ctx": boot, zoom, pan,
   sheet:<title>, idle), errors (count + first message), time to open each sheet (tap → content), and RPC times
   (p90-ish max per function). Sends ONE small report (report_vitals) after ≥ 2 min of use, at most every 3 h,
   when the app goes to the background or after 15 min. No name, no position: phone model, browser, app version, numbers.
   Owner reads it in stats.html (📈 Hastighet, docs/stats-vitals.js). */
(function () {
  "use strict";
  var A = null, t0 = Date.now(), sent = false, lastSend = 0;
  var SENT_KEY = "olnu.vitalsAt";
  try { lastSend = +localStorage.getItem(SENT_KEY) || 0; } catch (e) {}
  var fps = [], fpsZoom = [], longN = 0, longMs = 0, errors = 0, errFirst = null;
  var ctx = "boot", ctxMs = {}, sheetMs = {}, rpcMs = {}, lastDown = 0, sheetOpenAt = 0;
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  /* errors */
  window.addEventListener("error", function (e) { errors++; if (!errFirst) errFirst = String((e && e.message) || "error").slice(0, 180); });
  window.addEventListener("unhandledrejection", function (e) { errors++; if (!errFirst) { var r = e && e.reason; errFirst = String((r && (r.message || r)) || "rejection").slice(0, 180); } });

  /* long tasks by context */
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (en) {
        longN++; longMs += en.duration;
        ctxMs[ctx] = (ctxMs[ctx] || 0) + en.duration;
      });
    }).observe({ type: "longtask", buffered: true });
  } catch (e) {}
  setTimeout(function () { if (ctx === "boot") ctx = "idle"; }, 10000);

  /* frame rate samples */
  function sample(ms, into) {
    if (document.visibilityState !== "visible") return;
    var n = 0, start = now();
    function f() { n++; if (now() - start < ms) requestAnimationFrame(f); else into.push(Math.round(n * 1000 / (now() - start))); }
    requestAnimationFrame(f);
  }
  setInterval(function () { sample(2000, fps); }, 180000);
  setTimeout(function () { sample(2000, fps); }, 15000);

  /* sheets: tap → sheet content, and context while a sheet is open */
  document.addEventListener("pointerdown", function () { lastDown = now(); }, { capture: true, passive: true });
  function watchSheet() {
    var sh = document.getElementById("sheet");
    if (!sh) return;
    var open = false;
    new MutationObserver(function () {
      var isOpen = !sh.hidden && sh.classList.contains("open") || (!sh.hidden && sh.getAttribute("aria-hidden") !== "true" && sh.offsetHeight > 0);
      if (isOpen && !open) {
        open = true; sheetOpenAt = now();
        var tEl = document.getElementById("sheet-title"), title = ((tEl && tEl.textContent) || "sheet").replace(/[^\wåäöÅÄÖ ]/g, "").trim().slice(0, 24) || "sheet";
        ctx = "sheet:" + title;
        if (lastDown && sheetOpenAt - lastDown < 3000) {
          var took = Math.round(sheetOpenAt - lastDown);
          requestAnimationFrame(function () { took = Math.round(now() - lastDown); sheetMs[title] = Math.max(sheetMs[title] || 0, took); });
        }
      } else if (!isOpen && open) { open = false; ctx = "idle"; }
    }).observe(sh, { attributes: true, attributeFilter: ["class", "hidden", "aria-hidden", "style"] });
  }

  /* map: zoom / pan context + fps during zoom */
  function watchMap() {
    var m = A && A.map; if (!m || !m.on) return;
    m.on("zoomstart", function () { ctx = "zoom"; sample(800, fpsZoom); });
    m.on("movestart", function () { if (ctx !== "zoom") ctx = "pan"; });
    m.on("moveend", function () { ctx = "idle"; });
  }

  /* RPC timing: wrap the shared api.rpc once */
  function wrapRpc() {
    if (!A || !A.rpc || A.rpc._vit) return;
    var orig = A.rpc;
    A.rpc = function (name, params) {
      var s = now(), p = orig.apply(this, arguments);
      try { p.then(function () { var d = Math.round(now() - s); if (!rpcMs[name] || d > rpcMs[name]) rpcMs[name] = d; }, function () {}); } catch (e) {}
      return p;
    };
    A.rpc._vit = true;
  }

  /* device info */
  function model() {
    var ua = navigator.userAgent || "", m = ua.match(/;\s*([A-Z]{2,}-[A-Z0-9]+|SM-[A-Z0-9]+|Pixel [^;)]+|moto [^;)]+)/i);
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua)) return "iPad";
    return m ? m[1].trim() : (/Android/.test(ua) ? "Android" : (/Mac/.test(ua) ? "Mac" : (/Windows/.test(ua) ? "Windows" : "?")));
  }
  function browser() {
    var ua = navigator.userAgent || "";
    var m = ua.match(/SamsungBrowser\/(\d+)/) || ua.match(/(?:CriOS|Chrome)\/(\d+)/) || ua.match(/Firefox\/(\d+)/) || ua.match(/Version\/(\d+).*Safari/);
    var n = /SamsungBrowser/.test(ua) ? "Samsung" : /CriOS|Chrome/.test(ua) ? "Chrome" : /Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "?";
    return n + (m ? " " + m[1] : "");
  }
  function ver() { var s = document.querySelector('script[src*="app.js"]'); var v = s && (s.getAttribute("src").match(/v=([\w]+)/) || [])[1]; return v || "?"; }
  function med(a) { if (!a.length) return 0; var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.floor(b.length / 2)]; }
  function loadMs() {
    try { var n = performance.getEntriesByType("navigation")[0]; if (n) return Math.round(n.loadEventEnd || n.domContentLoadedEventEnd || 0); } catch (e) {}
    return 0;
  }
  function topObj(o, k) {
    var out = {}; Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).slice(0, k).forEach(function (x) { out[x] = Math.round(o[x]); }); return out;
  }
  function send(force) {
    if (sent || !A || !A.rpc || !A.LIVE || !A.authed || !A.authed()) return;
    var mins = Math.round((Date.now() - t0) / 60000);
    if (!force && mins < 2) return;
    if (Date.now() - lastSend < 3 * 3600e3) return;
    sent = true; lastSend = Date.now();
    try { localStorage.setItem(SENT_KEY, String(lastSend)); } catch (e) {}
    var all = fps.concat(fpsZoom);
    var p = {
      ver: ver(), model: model(), browser: browser(),
      standalone: !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || !!navigator.standalone,
      w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1,
      load_ms: loadMs(), fps_med: med(fps), fps_min: all.length ? Math.min.apply(null, all) : 0, fps_n: all.length,
      long_n: longN, long_ms: Math.round(longMs), errors: errors, err_first: errFirst,
      mapstyle: (function () { try { return localStorage.getItem("olnu.basemap") || localStorage.getItem("olnu.mapStyle") || ""; } catch (e) { return ""; } })(),
      mins: mins,
      detail: { ctx: topObj(ctxMs, 8), rpc: topObj(rpcMs, 10), sheet: topObj(sheetMs, 10), fps_zoom: med(fpsZoom) }
    };
    try { A.rpc("report_vitals", { p: p }).then(function () {}, function () {}); } catch (e) {}
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") send(false); });
  setTimeout(function () { send(false); }, 15 * 60000);

  window.VITALS = {
    init: function (api) { A = api; wrapRpc(); watchSheet(); setTimeout(watchMap, 1500); },
    _state: function () { return { fps: fps, fpsZoom: fpsZoom, longN: longN, longMs: longMs, errors: errors, ctxMs: ctxMs, rpcMs: rpcMs, sheetMs: sheetMs }; },
    _send: function () { sent = false; lastSend = 0; send(true); }
  };
})();
