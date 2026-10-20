/* Öl Nu boot helpers (perf). Loaded with defer, before the app modules.
   1. window.QRCode stand-in: qrcode.min.js is not in the start path any more. The stand-in has the same
      API (new QRCode(el, opts), QRCode.CorrectLevel); the first call loads the library and draws the code.
      The library is also loaded when the browser is idle after start, so normally the real one is there.
   2. Content files that nothing reads during start are written in index.html as
      <script type="text/x-lazy" src="…"> (the browser does not fetch those). They load in order after
      the page "load" event (+3 s, when the browser is idle). Then window.OLNU_LAZY resolves and the event
      "olnu:lazy" fires on document (app code can redraw the ticker then). */
(function () {
  "use strict";
  var QR_URL = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function () { s.remove(); reject(new Error("load " + src)); };
      document.head.appendChild(s);
    });
  }

  /* ---------- 1. QRCode stand-in ---------- */
  var qrLoading = null;
  function loadQR() {
    if (window.QRCode && !window.QRCode.__olnuStub) return Promise.resolve();
    if (qrLoading) return qrLoading;
    qrLoading = loadScript(QR_URL).then(function () {
      var Real = window.QRCode;
      if (!Real || Real.__olnuStub) throw new Error("no QRCode");
      queue.splice(0).forEach(function (q) {
        try { if (document.documentElement.contains(q[0])) new Real(q[0], q[1]); } catch (e) {}
      });
    }).catch(function () { qrLoading = null; queue.length = 0; if (!window.QRCode) window.QRCode = Stub; });
    return qrLoading;
  }
  var queue = [];
  function Stub(el, opts) { if (el) queue.push([el, opts]); loadQR(); }
  Stub.__olnuStub = true;
  Stub.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };   // same values as qrcodejs QRErrorCorrectLevel
  if (!window.QRCode) window.QRCode = Stub;
  window.OLNU_LOAD_QR = loadQR;

  /* ---------- 2. Lazy content files ---------- */
  var done;
  window.OLNU_LAZY = new Promise(function (r) { done = r; });
  window.OLNU_LAZY_NOW = function () {   // review2: openSheet() calls it; never before the load event
    if (document.readyState === "complete") startLazy(); else window.addEventListener("load", function () { setTimeout(startLazy, 0); });
    return window.OLNU_LAZY;
  };
  var started = false;
  function startLazy() {
    if (started) return;
    started = true;
    // review2: sheet-only stylesheets (<link rel="x-lazy-css" data-boot>) load here too (forfest.css stays on demand).
    Array.prototype.forEach.call(document.querySelectorAll('link[rel="x-lazy-css"][data-boot][href]'), function (n) {
      var href = n.getAttribute("href");
      if (document.querySelector('link[rel="stylesheet"][href="' + href + '"]')) return;
      var l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l);
    });
    var list = Array.prototype.slice.call(document.querySelectorAll('script[type="text/x-lazy"][src]'))
      .map(function (n) { return n.getAttribute("src"); })
      // review2: a module may have loaded its lazy file on demand already (forfest.js): do not run it twice
      .filter(function (src) { return !document.querySelector('script[src="' + src + '"]:not([type="text/x-lazy"])'); });
    // Order is kept (async = false); a missing file does not stop the others.
    Promise.all(list.map(function (src) { return loadScript(src).catch(function () {}); }))
      .then(function () {
        done();
        try { document.dispatchEvent(new Event("olnu:lazy")); } catch (e) {}
        idle(loadQR);
      });
  }
  function idle(fn) {
    if (window.requestIdleCallback) window.requestIdleCallback(function () { fn(); }, { timeout: 3000 });
    else setTimeout(fn, 300);
  }
  // 3 s after load: the first poll and the first pins come first, then this parse work.
  function later() { setTimeout(function () { idle(startLazy); }, 3000); }
  if (document.readyState === "complete") later();
  else window.addEventListener("load", later);
  // Never wait for ever on a slow map tile: start at the latest 10 s after the document is parsed.
  document.addEventListener("DOMContentLoaded", function () { setTimeout(startLazy, 10000); });
})();
