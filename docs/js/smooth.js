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
   4. Sheet feel: closing slides the old sheet down (200 ms, a copy in a closed shadow root that nothing can query or tap),
      a new content in an open sheet fades in, a lone "…" placeholder becomes a quiet skeleton row.
      prefers-reduced-motion: no slide, no fade (instant), skeleton without pulse. Styles: smooth.css.
   Public: window.SMOOTH = { afterPaint, sheetOut, prefetch, stats }. Missing parts = no change. */
(function () {
  "use strict";
  var W = window;
  function reduced() { try { return !!(W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  var stats = { intlHit: 0, intlNew: 0, rpcShared: 0, rpcPrefetch: 0, ghost: 0, cssSync: 0, cssAdd: 0 };

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
  var sheetCSS = null, cssBusy = false, cssAgain = false, cssMap = typeof WeakMap === "function" ? new WeakMap() : null;
  function cssCan() { return !!cssMap && typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in Document.prototype; }
  // The ghost's shadow root needs the page's CSS. sheetCSS = one constructed copy per stylesheet of the page, in page order.
  // speed1 (audit speed #5): each stylesheet is copied ONCE (cssMap: page sheet -> its copy). Before: ONE copy of all CSS
  // (~765 KB), made again 2.5 s after load and again for every node that came into <head> (lazy scripts too): 443 ms at start,
  // 189 ms in idle, 293 ms in a map pan. Now cssSync() walks the page's sheets: a known sheet = its copy is used again; a new
  // one (a module's <style>, a lazy CSS file) = one small copy. The old list stays in use until the new one is ready.
  function cssCopy(sh) {
    var txt = [];
    try { var r = sh.cssRules; for (var j = 0; j < r.length; j++) txt.push(r[j].cssText); } catch (e) {}   // a cross-origin sheet: empty
    var cs = new CSSStyleSheet(); cs.replaceSync(txt.join("\n").replace(/@import[^;]+;/g, ""));
    return cs;
  }
  function cssSync() {
    if (!cssCan()) return;
    if (cssBusy) { cssAgain = true; return; }
    cssBusy = true;
    // ds37: in slices of ≤ 8 ms per idle period (was ONE ~330 ms long task on a phone)
    var list = Array.prototype.slice.call(document.styleSheets), out = [], i = 0;
    var done = function () { cssBusy = false; if (cssAgain) { cssAgain = false; cssSync(); } };
    var step = function () {
      var t = performance.now();
      try {
        while (i < list.length && performance.now() - t < 8) {
          var c = cssMap.get(list[i]);
          if (!c) { c = cssCopy(list[i]); cssMap.set(list[i], c); stats.cssAdd++; }
          out.push(c); i++;
        }
      } catch (e) { done(); return; }   // the old list stays
      if (i < list.length) { idle(step, 3000); return; }
      sheetCSS = out; stats.cssSync++; done();
    };
    step();
  }
  function idle(fn, ms) {
    if (W.requestIdleCallback) W.requestIdleCallback(fn, { timeout: ms || 4000 }); else setTimeout(fn, 1200);
  }
  var cssVer = 0;
  // ds37: never during start (it was the biggest long task of the first 2 s): after "pn:calm" (js/pnds.js), then idle
  function afterCalm(fn) { if (W.__pnCalm) fn(); else { document.addEventListener("pn:calm", function () { fn(); }, { once: true }); setTimeout(fn, 9000); } }
  function cssLater() { var v = ++cssVer; afterCalm(function () { idle(function () { if (v === cssVer) cssSync(); }, 6000); }); }
  var MAX_NODES = 900;
  // Call BEFORE #sheet is hidden and its body emptied (app.js closeSheet).
  function sheetOut() {
    try {
      if (reduced()) return;
      var sh = document.getElementById("sheet"), bd = document.getElementById("backdrop");
      if (!sh || sh.hidden) return;
      if (bd && !bd.hidden) {
        var bs = getComputedStyle(bd), g2 = document.createElement("div");
        g2.className = "sm-bd-out"; g2.setAttribute("aria-hidden", "true");
        g2.style.background = bs.backgroundColor; g2.style.zIndex = bs.zIndex;
        document.body.appendChild(g2);
        setTimeout(function () { g2.remove(); }, 260);
      }
      if (!sheetCSS || sh.getElementsByTagName("*").length > MAX_NODES) return;
      var r = sh.getBoundingClientRect(); if (!r.height) return;
      var body = document.getElementById("sheet-body"), top = body ? body.scrollTop : 0;
      var host = document.createElement("div");
      host.className = "sm-ghost-host"; host.setAttribute("aria-hidden", "true");
      try { host.inert = true; } catch (e) {}
      host.style.cssText = "position:fixed;left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;z-index:" +
        (getComputedStyle(sh).zIndex || 1600) + ";pointer-events:none;contain:strict";
      var root = host.attachShadow({ mode: "closed" });
      root.adoptedStyleSheets = sheetCSS;
      var c = sh.cloneNode(true);
      c.hidden = false; c.removeAttribute("aria-modal"); c.setAttribute("role", "presentation");
      c.style.cssText += ";position:absolute;left:0;top:0;right:auto;bottom:auto;width:100%;height:100%;max-height:none;margin:0;animation:none;transition:none";
      root.appendChild(c);
      document.body.appendChild(host);
      var cb = c.querySelector(".sheet-body"); if (cb && top) cb.scrollTop = top;
      stats.ghost++;
      var a = host.animate ? host.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(" + Math.min(r.height, 520) * 0.6 + "px)", opacity: 0 }],
        { duration: 200, easing: "cubic-bezier(.3,0,.8,.15)", fill: "forwards" }) : null;
      var gone = function () { host.remove(); };
      if (a) a.onfinish = gone;
      setTimeout(gone, 400);
    } catch (e) {}
  }
  afterCalm(function () { idle(function () { if (!sheetCSS) cssSync(); }, 6000); });   // ds37   // ds10: the style copy exists before the first close, so the first close slides too
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
    new MutationObserver(function () { wasOpen = !sh.hidden; lastTitle = title ? title.textContent : ""; }).observe(sh, { attributes: true, attributeFilter: ["hidden"] });
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

  function onReady() {
    watchSheet();
    // Rebuild the ghost CSS when a lazy stylesheet arrives (boot.js x-lazy-css, module CSS).
    // speed1: only a stylesheet node counts (lazy <script> tags come into <head> too); a <link> is read when it has loaded.
    function isCss(n) { return !!n && n.nodeType === 1 && (n.tagName === "STYLE" || (n.tagName === "LINK" && /(^|\s)stylesheet(\s|$)/i.test(n.rel || ""))); }
    try {
      new MutationObserver(function (ms) {
        var hit = false;
        ms.forEach(function (m) {
          [].forEach.call(m.addedNodes, function (n) { if (!isCss(n)) return; hit = true; if (n.tagName === "LINK" && !n.sheet) n.addEventListener("load", cssLater, { once: true }); });
          [].forEach.call(m.removedNodes, function (n) { if (isCss(n)) hit = true; });
        });
        if (hit) cssLater();
      }).observe(document.head, { childList: true });
    } catch (e) {}
    W.addEventListener("load", function () { setTimeout(cssLater, 2500); });
    if (document.readyState === "complete") setTimeout(cssLater, 2500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady); else onReady();

  W.SMOOTH = { afterPaint: afterPaint, sheetOut: sheetOut, prefetch: prefetch, stats: stats, reduced: reduced };
})();
