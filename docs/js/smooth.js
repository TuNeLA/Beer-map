/* Öl Nu — SMOOTH (CONTRACT "SMOOTH: SNABB OCH MJUK APP"). Speed + feel helpers. No data, no new buttons, no RPC of its own
   except the read-only prefetch below. Loaded with defer right after config.js (before every other module).
   1. Intl cache: new Intl.DateTimeFormat(...) with the same locale + options gives back ONE shared formatter
      (a formatter never changes, so sharing is safe). Date#toLocaleTimeString/-DateString with options use it too.
      26 places made a new formatter per call (news nightKey, after.js sthlm, hourNow…) – that was a hot spot at start.
   2. RPC fetch layer (Supabase /rest/v1/rpc/<fn> POST only, READ list only):
      - two identical read calls at the same time share one request;
      - pointerdown on 👥 (Grupper) starts my_groups at once, so the list is there ~100 ms sooner (the click comes after);
      - an answer is reused for max 3 s; ANY other RPC (a write) clears the reuse cache first.
      Headers come from the app's own last RPC call (apikey + token); before that no prefetch is made.
   3. App shell first: SMOOTH.afterPaint(fn) runs fn after the next frame (max 300 ms). app.js runs start() through it,
      so the HUD and the map paint before the ~40 module inits run.
   4. Sheet feel: closing slides the real sheet down (200 ms, WAAPI on #sheet; no copy, no taps while it slides),
      a new content in an open sheet fades in, a lone "…" placeholder becomes a quiet skeleton row.
   5. PN.idle (lane timers): "is the map out of sight" (a full sheet or a hidden page); loops sleep then (see section 5).
      prefers-reduced-motion: no slide, no fade (instant), skeleton without pulse. Styles: smooth.css.
   Public: window.SMOOTH = { afterPaint, sheetOut, prefetch, stats, idle }, PN.idle. Missing parts = no change. */
(function () {
  "use strict";
  var W = window;
  function reduced() { try { return !!(W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  var stats = { intlHit: 0, intlNew: 0, rpcShared: 0, rpcPrefetch: 0, slide: 0 };

  /* ---------- 1. Intl cache ---------- */
  (function () {
    var I = W.Intl;
    if (!I || !I.DateTimeFormat || I.DateTimeFormat.__smooth) return;
    var Orig = I.DateTimeFormat, cache = {}, size = 0;
    function key(loc, opt) {
      try { return JSON.stringify([loc === undefined ? null : loc, opt === undefined ? null : opt]); } catch (e) { return null; }
    }
    function get(loc, opt) {
      var k = key(loc, opt);
      if (k === null || k.length > 600) { stats.intlNew++; return new Orig(loc, opt); }
      var f = cache[k];
      if (f) { stats.intlHit++; return f; }
      f = new Orig(loc, opt);   // throws like the original on bad input
      if (size > 200) { cache = {}; size = 0; }
      cache[k] = f; size++; stats.intlNew++;
      return f;
    }
    function DTF(loc, opt) { return get(loc, opt); }   // with or without "new": an object return wins
    DTF.prototype = Orig.prototype;
    DTF.supportedLocalesOf = Orig.supportedLocalesOf;
    DTF.__smooth = true;
    try { Object.defineProperty(DTF, "name", { value: "DateTimeFormat" }); } catch (e) {}
    try { I.DateTimeFormat = DTF; } catch (e) { return; }
    // toLocale*String(loc, opts): same result as a formatter with the same options when a field of that kind is given.
    var TIME = ["hour", "minute", "second", "dayPeriod", "fractionalSecondDigits", "timeStyle"];
    var DATE = ["weekday", "year", "month", "day", "dateStyle"];
    function has(o, list) { for (var i = 0; i < list.length; i++) if (o[list[i]] !== undefined) return true; return false; }
    var DP = Date.prototype, oT = DP.toLocaleTimeString, oD = DP.toLocaleDateString;
    DP.toLocaleTimeString = function (loc, opt) {
      if (opt && typeof opt === "object" && opt.dateStyle === undefined && has(opt, TIME) && isFinite(this.getTime())) {
        try { return get(loc, opt).format(this); } catch (e) {}
      }
      return oT.apply(this, arguments);
    };
    DP.toLocaleDateString = function (loc, opt) {
      if (opt && typeof opt === "object" && opt.timeStyle === undefined && has(opt, DATE) && isFinite(this.getTime())) {
        try { return get(loc, opt).format(this); } catch (e) {}
      }
      return oD.apply(this, arguments);
    };
  })();

  /* ---------- 2. RPC fetch layer ---------- */
  var READ = { my_groups: 1, group_status: 1, my_stats: 1, my_medals: 1, my_event_chats: 1, group_league: 1,
    city_league: 1, bar_kings: 1, my_meriter: 1, my_home_town: 1, public_config: 1 };
  // Only STABLE, write-free SQL functions (checked in pg_proc: provolatile = 's', no insert/update/perform).
  var TTL = 3000;
  var last = { base: "", headers: null }, memo = {};
  var of = W.fetch;
  function rpcOf(url) { var m = /^(https?:\/\/[^?#]+\/rest\/v1\/rpc\/)(\w+)(?:[?#]|$)/.exec(url); return m ? { base: m[1], fn: m[2] } : null; }
  function hdrCopy(h) {
    var o = {};
    try {
      if (!h) return o;
      if (typeof h.forEach === "function" && !Array.isArray(h)) h.forEach(function (v, k) { o[k] = v; });
      else if (Array.isArray(h)) h.forEach(function (p) { o[p[0]] = p[1]; });
      else Object.keys(h).forEach(function (k) { o[k] = h[k]; });
    } catch (e) {}
    return o;
  }
  function sweep() { var now = Date.now(); Object.keys(memo).forEach(function (k) { var m = memo[k]; if (m.until ? m.until < now : now - (m.at || 0) > 8000) delete memo[k]; }); }
  function remember(k, p) {
    var e = { p: p, until: 0, at: Date.now() };
    memo[k] = e;
    p.then(function (res) { if (res && res.ok) e.until = Date.now() + TTL; else if (memo[k] === e) delete memo[k]; },
      function () { if (memo[k] === e) delete memo[k]; });
    return e;
  }
  function answer(e) {
    return e.p.then(function (res) { return res.clone(); });
  }
  if (typeof of === "function") {
    W.fetch = function (input, init) {
      try {
        var url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
        var r = rpcOf(url);
        var method = (init && init.method) || (input && input.method) || "GET";
        if (r && String(method).toUpperCase() === "POST" && typeof input === "string") {
          var h = hdrCopy(init && init.headers);
          if (h.Authorization || h.authorization) { last.base = r.base; last.headers = h; }
          var body = init && typeof init.body === "string" ? init.body : init && init.body == null ? "" : null;
          if (!READ[r.fn] || body === null || (init && init.signal && init.signal.aborted)) {
            memo = {};   // a write (or an odd call): never reuse an older read after it
            return of.apply(this, arguments);
          }
          sweep();
          var k = r.fn + "|" + body + "|" + (h.Authorization || h.authorization || "");
          var hit = memo[k];
          if (hit && (hit.until ? hit.until > Date.now() : Date.now() - (hit.at || 0) < 8000)) { stats.rpcShared++; return answer(hit); }
          var p = of.apply(this, arguments);
          remember(k, p);
          return p.then(function (res) { return res.clone(); });
        }
      } catch (e) {}
      return of.apply(this, arguments);
    };
  }
  // Read-only warm-up of one no-argument RPC (body "{}"), only with the headers the app itself used last.
  function prefetch(fn) {
    try {
      if (!READ[fn] || !last.headers || !last.base || typeof of !== "function") return false;
      if (navigator.onLine === false) return false;
      var h = last.headers, k = fn + "|{}|" + (h.Authorization || h.authorization || "");
      sweep();
      if (memo[k]) return true;
      var p = of.call(W, last.base + fn, { method: "POST", headers: h, body: "{}" });
      remember(k, p); stats.rpcPrefetch++;
      p.catch(function () {});
      return true;
    } catch (e) { return false; }
  }
  var PREFETCH = { "btn-groups": ["my_groups"] };
  document.addEventListener("pointerdown", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("button[id]") : null;
    if (t && PREFETCH[t.id] && !t.disabled) PREFETCH[t.id].forEach(prefetch);
  }, { capture: true, passive: true });

  /* ---------- 3. After the next paint ---------- */
  function afterPaint(fn) {
    var done = false;
    function go() { if (done) return; done = true; fn(); }
    try { if (W.requestAnimationFrame && !document.hidden) W.requestAnimationFrame(function () { setTimeout(go, 0); }); } catch (e) {}
    setTimeout(go, document.hidden ? 0 : 300);   // hidden tab: no frames come, start at once
  }

  /* ---------- 4. Sheet feel ---------- */
  // timers A9 (audit speed #5 / motion #9): the close slides the REAL #sheet down (WAAPI on the sheet itself). Before: a deep
  // clone of the whole sheet in a closed shadow root, with a constructed copy of every page stylesheet (~765 KB of CSS, kept in
  // sync in idle time): 60-100 ms at each close and the copy work in the background. Same look: 200 ms, translateY(60 % of
  // the height, max 520 px) + opacity 1 → 0, the --sm-out curve. #sheet.hidden is true at once (the app logic sees a closed
  // sheet); only the paint stays for the 200 ms: display is held inline, no taps (pointer-events none), focus leaves.
  // The body is cleared at the end of the slide (done callback of the caller). A sheet that opens during the slide wins at once.
  var outA = null, outDone = null;
  function outEnd(reopened) {
    var a = outA, f = outDone; outA = null; outDone = null;
    if (!a) return;
    try { a.cancel(); } catch (e) {}
    var sh = document.getElementById("sheet");
    if (sh) { sh.style.removeProperty("display"); sh.style.removeProperty("pointer-events"); }
    if (f && !reopened) { try { f(); } catch (e) {} }
  }
  // Call BEFORE #sheet is hidden (app-ui.js closeSheet). done = what to run when the slide is over (clear the body).
  // Returns true when the slide runs: then the caller leaves the body as it is and done() clears it.
  function sheetOut(done) {
    try {
      outEnd(false);   // a slide that still runs: end it now
      var sh = document.getElementById("sheet"), bd = document.getElementById("backdrop");
      if (reduced() || !sh || sh.hidden) return false;
      if (bd && !bd.hidden) {
        var bs = getComputedStyle(bd), g2 = document.createElement("div");   // one empty div with the scrim colour (not a copy)
        g2.className = "sm-bd-out"; g2.setAttribute("aria-hidden", "true");
        g2.style.background = bs.backgroundColor; g2.style.zIndex = bs.zIndex;
        document.body.appendChild(g2);
        setTimeout(function () { g2.remove(); }, 260);
      }
      var h = sh.offsetHeight; if (!h || !sh.animate) return false;
      var cs = getComputedStyle(sh), base = cs.transform && cs.transform !== "none" ? cs.transform + " " : "";
      var ae = document.activeElement; if (ae && sh.contains(ae) && ae.blur) ae.blur();
      sh.style.setProperty("display", cs.display, "important"); sh.style.setProperty("pointer-events", "none", "important");
      var a = outA = sh.animate([{ transform: base + "translateY(0)", opacity: 1 }, { transform: base + "translateY(" + Math.min(h, 520) * 0.6 + "px)", opacity: 0 }],
        { duration: 200, easing: "cubic-bezier(.3,0,.8,.15)", fill: "forwards" });
      outDone = typeof done === "function" ? done : null;
      stats.slide++;
      var end = function () { if (outA === a) outEnd(false); };
      a.onfinish = end; setTimeout(end, 600);   // no finish event (a hidden page) or a very late first frame: end anyway
      return true;
    } catch (e) { outEnd(false); return false; }
  }
  function watchSheet() {
    var sh = document.getElementById("sheet"), body = document.getElementById("sheet-body"), title = document.getElementById("sheet-title");
    if (!sh || !body || !W.MutationObserver) return;
    var wasOpen = !sh.hidden, lastTitle = title ? title.textContent : "", swapT = 0;
    // Open → a new sheet replaced the old one while open: fade the new content in (the sheet itself stays).
    new MutationObserver(function () {
      var open = !sh.hidden;
      if (open && wasOpen && title && title.textContent !== lastTitle && !reduced()) {
        body.classList.remove("sm-swap"); void body.offsetWidth; body.classList.add("sm-swap");
        clearTimeout(swapT); swapT = setTimeout(function () { body.classList.remove("sm-swap"); }, 260);
      }
      wasOpen = open; lastTitle = title ? title.textContent : "";
    }).observe(title || sh, { childList: true, characterData: true, subtree: true });
    new MutationObserver(function () {
      wasOpen = !sh.hidden; lastTitle = title ? title.textContent : "";
      if (!sh.hidden && outA) outEnd(true);   // A9: a sheet opened during the close slide: show it at once, keep its new body
    }).observe(sh, { attributes: true, attributeFilter: ["hidden"] });
    // "…" placeholders (a list that is on its way) → skeleton row.
    var skT = 0;
    function skel() {
      skT = 0;
      var n = body.querySelectorAll("li, p, div");
      for (var i = 0; i < n.length && i < 400; i++) {
        var x = n[i];
        if (!x.firstElementChild && x.textContent.trim() === "…" && !x.classList.contains("sm-skel")) x.classList.add("sm-skel");
      }
    }
    new MutationObserver(function () { if (!skT && !sh.hidden) skT = setTimeout(skel, 0); }).observe(body, { childList: true, subtree: true });
  }

  /* ---------- 5. PN.idle: the map is out of sight (lane timers, B10) ---------- */
  // covered = a sheet covers at least half of the screen (#sheet open; the rest of the map is under the dark scrim), or a module
  //   said so for its own full-screen layer: PN.idle.cover(key, true / false). hidden = the page is hidden.
  // While idle:
  //   - PN.idle.every(fn, ms, mode) sleeps (no timer wake-ups). mode "map" (default) = sleep when covered or hidden; "hidden" =
  //     only when hidden. fn runs once at each change: a last look when it goes to sleep, a fresh look at once when the map
  //     comes back. Then every ms again.
  //   - Repeating CSS animations (iterations > 1: glows, pulses, clinks, ambient edges) under the scrim pause (WAAPI) and play
  //     again at once when the map comes back. What is over the scrim (the sheet, toasts, a takeover) keeps moving. A hidden
  //     page paints nothing (the browser stops it), so that part is for "covered" only.
  //   - html.pn-covered (a CSS hook) and the document event "pn:idle" ({ detail: { idle, covered, hidden } }).
  // The map visible = no change at all.
  var IDLE = (function () {
    var de = document.documentElement, covers = {}, subs = [], st = { covered: false, hidden: !!document.hidden }, COVER = 0.5;
    var held = [], scanT = 0;
    function sheetCovers() { var s = document.getElementById("sheet"); return !!(s && !s.hidden && s.offsetHeight >= (W.innerHeight || 1) * COVER); }
    function coveredNow() { if (sheetCovers()) return true; for (var k in covers) if (covers[k]) return true; return false; }
    // z of the outermost ancestor with its own z-index = the layer it paints in
    function under(el, lim, cache) {
      var z = 0;
      for (var e = el; e && e.nodeType === 1 && e !== document.body; e = e.parentElement) {
        var v = cache.get(e); if (v === undefined) { v = getComputedStyle(e).zIndex; cache.set(e, v); }
        if (v !== "auto") z = +v || 0;
      }
      return z < lim;
    }
    function scan() {
      if (!document.getAnimations) return;
      var lim = 1500, cache = new Map(), bd = document.getElementById("backdrop"), sh = document.getElementById("sheet");
      try { var zz = +getComputedStyle(bd && !bd.hidden ? bd : sh).zIndex; if (zz) lim = zz; } catch (e) {}
      document.getAnimations().forEach(function (a) {
        try {
          if (a.playState !== "running" || !a.animationName) return;   // CSS animations only (the ticker belt has its own control)
          var tg = a.effect && a.effect.target;
          if (!(a.effect.getTiming().iterations > 1) || !tg || !under(tg, lim, cache)) return;
          a.pause(); held.push(a);
        } catch (e) {}
      });
    }
    function release() {
      var h = held; held = [];
      h.forEach(function (a) { try { var tg = a.effect && a.effect.target; if (a.playState === "paused" && tg && tg.isConnected) a.play(); } catch (e) {} });
    }
    function check() {
      var c = coveredNow(), h = !!document.hidden;
      if (c === st.covered && h === st.hidden) return;
      st = { covered: c, hidden: h };
      de.classList.toggle("pn-covered", c);
      if (c && !h) { scan(); if (!scanT) scanT = setInterval(scan, 10000); }   // a loop that starts later (a pill drawn again by a poll) pauses too
      else { if (scanT) { clearInterval(scanT); scanT = 0; } if (!c) release(); }
      subs.slice().forEach(function (f) { try { f(st); } catch (e) {} });
      try { document.dispatchEvent(new CustomEvent("pn:idle", { detail: { idle: c || h, covered: c, hidden: h } })); } catch (e) {}
    }
    function every(fn, ms, mode) {
      var map = mode !== "hidden", id = 0, off = false, was = null;
      function sync() {
        if (off) return;
        var s = st.hidden || (map && st.covered);
        if (s && id) { clearInterval(id); id = 0; }
        if (!s && !id) id = setInterval(fn, ms);
        if (was !== null && s !== was) { try { fn(); } catch (e) { setTimeout(function () { throw e; }, 0); } }
        was = s;
      }
      subs.push(sync); sync();
      return { stop: function () { off = true; if (id) clearInterval(id); id = 0; var i = subs.indexOf(sync); if (i >= 0) subs.splice(i, 1); } };
    }
    function start() {
      var sh = document.getElementById("sheet");
      if (sh && W.MutationObserver) new MutationObserver(check).observe(sh, { attributes: true, attributeFilter: ["hidden"] });
      if (sh && W.ResizeObserver) new ResizeObserver(check).observe(sh);   // a sheet that grows when its data comes
      document.addEventListener("visibilitychange", check);
      W.addEventListener("resize", check);
      check();
    }
    return {
      covered: function () { return st.covered; }, hidden: function () { return st.hidden; }, now: function () { return st.covered || st.hidden; },
      cover: function (key, on) { covers[key] = !!on; check(); }, on: function (fn) { subs.push(fn); }, every: every, check: check, start: start,
      _held: function () { return held.length; }
    };
  })();
  (W.PN = W.PN || {}).idle = IDLE;

  function onReady() {
    watchSheet();
    IDLE.start();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady); else onReady();

  W.SMOOTH = { afterPaint: afterPaint, sheetOut: sheetOut, prefetch: prefetch, stats: stats, reduced: reduced, idle: IDLE };
})();
