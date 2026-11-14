/* PintsNow — FASTPOS (I-104, owner 14 Nov 2026 20:17 + 20:22: "ÖL! loads 5–10 s before it registers. It should be
   immediate; any loading should be in the background"). window.FASTPOS.
   Cause: the ÖL! tap asked for a NEW high-accuracy GPS fix (up to 12 s) before anything happened.
   1. Every position the app gets (any module: locate, autoci sampler, walks, the tap itself) is kept here with its time.
   2. While the app is visible and location is already allowed, one quiet fix is taken at start / on resume and at most
      every 2 min after, so a fresh position is ready BEFORE the tap. (One getCurrentPosition, not a running watch:
      a watch makes other calls wait for its next fix in Chromium, see autoci.js.)
   3. FASTPOS.forTap(): a fix < 2 min old → at once (and a new one in the background). Else a quick network fix
      (Wi-Fi/cell, max 2.5 s, may be 5 min old), and only if that fails the old exact GPS wait.
   Never asks for permission itself (only when the browser says "granted"). */
(function () {
  "use strict";
  var W = window, N = W.navigator, g = N && N.geolocation;
  var F = W.FASTPOS = { last: null, fresh: fresh, forTap: forTap, warm: warm };
  if (!g) return;
  var FRESH_MS = 2 * 60e3, WARM_GAP = 2 * 60e3, warmAt = 0, warming = false;
  function keep(p) { try { if (p && p.coords && isFinite(p.coords.latitude)) F.last = { pos: p, at: Date.now() }; } catch (e) {} }
  try {
    var gc = g.getCurrentPosition.bind(g), wp = g.watchPosition.bind(g);
    g.getCurrentPosition = function (ok, err, o) { return gc(function (p) { keep(p); if (ok) ok(p); }, err, o); };
    g.watchPosition = function (ok, err, o) { return wp(function (p) { keep(p); if (ok) ok(p); }, err, o); };
  } catch (e) {}
  function fresh(ms) {
    var l = F.last;
    return l && Date.now() - l.at <= (ms || FRESH_MS) ? l.pos : null;
  }
  function ask(o) {
    return new Promise(function (res, rej) { try { g.getCurrentPosition(res, rej, o); } catch (e) { rej({ code: 2 }); } });
  }
  function granted() {
    try {
      if (!N.permissions || !N.permissions.query) return Promise.resolve(false);
      return N.permissions.query({ name: "geolocation" }).then(function (s) { return s.state === "granted"; }, function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  function warm(force) {
    if (warming || document.hidden || (!force && Date.now() - warmAt < WARM_GAP)) return;
    warming = true;
    granted().then(function (ok) {
      if (!ok) { warming = false; return; }
      warmAt = Date.now();
      ask({ enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }).then(function () { warming = false; }, function () { warming = false; });
    });
  }
  // the position for an ÖL! tap, as fast as possible
  function forTap(exact) {
    var p = fresh();
    if (p) { setTimeout(function () { warm(true); }, 50); return Promise.resolve(p); }
    return ask({ enableHighAccuracy: false, timeout: 2500, maximumAge: 5 * 60e3 }).then(function (q) {
      setTimeout(function () { warm(true); }, 50);
      return q;
    }, function (e) {
      if (e && e.code === 1) throw e;   // location denied: the normal "turn location on" answer
      return exact();
    });
  }
  function start() { warm(true); setInterval(function () { warm(false); }, 30e3); }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) warm(true); });
  if (document.readyState === "complete") setTimeout(start, 1500);
  else W.addEventListener("load", function () { setTimeout(start, 1500); });
})();
