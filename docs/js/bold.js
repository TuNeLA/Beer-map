/* PintsNow — BOLD core (agent bold, owner OK 2026-11-08). window.BOLD.
   One entry in app.js mods() for all "bold" features (Hem-läge, Kvällens krog, Skåltimmen v2, Kvällsrepris 2.0, Skål!).
   - Flags: server table bold_flags via RPC bold_flags_get() (migration 0381). All OFF until the release. Read at sign-in and
     every 10 min. A missing RPC (old server) = every flag off = every bold feature hides; the old app runs unchanged.
   - Test override (localhost / 127.0.0.1 only): localStorage "olnu.boldForce" = "bold_hemlage,bold_krog" (or "all").
   - Features register with BOLD.add({ key: "bold_hemlage", init, onAuthed, onPoll, hudChipsHTML, hudClick, barIcoHTML, … }).
     A hook runs only while the feature's flag is on (init and onFlags always run). A broken feature never breaks the app.
   Public: BOLD = { add, on(key), flags(), api(), refresh(), _set(obj) (tests) } + the app.js mods() hooks. */
(function () {
  "use strict";
  var A = null, feats = [], flags = {}, flagsAt = 0, busy = false, off = false;
  var FLAG_MS = 10 * 60e3;
  function local() { try { return /^(localhost|127\.0\.0\.1)$/.test(location.hostname); } catch (e) { return false; } }
  function forced(key) {
    if (!local()) return false;
    try { var f = localStorage.getItem("olnu.boldForce") || ""; return f === "all" || f.split(",").indexOf(key) >= 0; } catch (e) { return false; }
  }
  function on(key) { return !!flags[key] || forced(key); }
  function each(fn, args, all) {
    var out = "";
    feats.forEach(function (f) {
      if (typeof f[fn] !== "function" || (!all && f.key && !on(f.key))) return;
      try { var r = f[fn].apply(f, args || []); if (typeof r === "string") out += r; } catch (e) { try { console.warn("bold " + fn, e); } catch (x) {} }
    });
    return out;
  }
  function loadFlags(force) {
    if (off || busy || !A || !A.rpc || (!force && Date.now() - flagsAt < FLAG_MS)) return;
    try { if (A.authed && !A.authed()) return; } catch (e) {}
    busy = true;
    A.rpc("bold_flags_get").then(function (r) {
      busy = false; flagsAt = Date.now();
      if (r && r.error) { if (window.U && U.missing && U.missing(r.error)) off = true; return; }
      var d = A.parseData(r && r.data) || {}, was = JSON.stringify(flags);
      flags = {}; Object.keys(d).forEach(function (k) { flags[k] = d[k] === true; });
      if (JSON.stringify(flags) !== was) each("onFlags", [flags], true);
    }, function () { busy = false; });
  }
  window.BOLD = {
    add: function (f) { if (f && feats.indexOf(f) < 0) { feats.push(f); if (A && typeof f.init === "function") { try { f.init(A); } catch (e) {} } } return f; },
    on: on, flags: function () { var o = {}; Object.keys(flags).forEach(function (k) { o[k] = flags[k]; }); return o; },
    api: function () { return A; }, refresh: function () { loadFlags(true); },
    _set: function (o) { flags = o || {}; each("onFlags", [flags], true); },
    // app.js mods() hooks
    init: function (api) { A = api; each("init", [api], true); },
    onAuthed: function () { loadFlags(true); each("onAuthed"); },
    onPoll: function (x) { loadFlags(false); each("onPoll", [x]); },
    applyText: function () { each("applyText"); },
    hudChipsHTML: function (x) { return each("hudChipsHTML", [x]); },
    hudClick: function (a) { each("hudClick", [a]); },
    barIcoHTML: function (bar) { return each("barIcoHTML", [bar]); },
    barPopupHTML: function (bar, list) { return each("barPopupHTML", [bar, list]); },
    topSheet: function (body) { each("topSheet", [body]); },
    // js/pnikv.js (Ikväll chip menu): rows from every bold feature that is on. rowFn = pnikv's row(icon, title, sub, onClick).
    menuRows: function (rowFn, closeMenu) {
      var out = [];
      feats.forEach(function (f) {
        if (typeof f.menuRow !== "function" || (f.key && !on(f.key))) return;
        try { var r = f.menuRow(rowFn, closeMenu); if (r) out.push(r); } catch (e) {}
      });
      return out;
    }
  };
})();
