/* PintsNow — Öppen ikväll (P-088, lane dating2, owner 19 Nov 12:39: "Create the whole dating feature ... Put it in the beta").
   THE HOOK. This small file is the only dating code that every channel loads. It decides, and loads the rest on demand:
   - Allowed only in BETA code (window.PN_BETA from beta.js, or the #olnu-beta badge of the beta build) and NEVER in a store
     build (window.OLNU_STORE, same fallback as safety.js). Stable / live / store: init() returns at once; nothing is fetched,
     nothing is drawn, no RPC is called. The lazy files are not named in index.html on purpose, so the stable service worker
     does not precache them either.
   - Beta: a checked-in bar sheet (Krogkortet with "Checka ut", .bs .ci-out[data-ciout]) gets the "Ikväll" section. The first
     time one shows, js/dating-logic.js + dating-content.js + dating-core.js and dating.css load (PN.load). The game screens
     (js/dating-ui.js) load only when the switch is on and a game shows. "?b=<beta sha>" keeps the copy fresh per beta build.
   - Self-mounting: a MutationObserver (beta only, one rAF per burst) puts the section into the bar sheet, because the bar
     sheet files belong to other lanes (app-pins.js, pnds.js).
   - Inställningar → Integritet & synlighet: one row "Öppen ikväll" (class mn-vis-srow = that page) → the safety page
     (consent, withdraw, report from the last 7 days, hide the feature).
   - HUD: one chip "Matchspel pågår" while a game runs (hudChipsHTML / hudClick "oi").
   - A missing server (PGRST202) or the server flag off (feature_off) = the feature hides for this session (dating-core.js).
   Public: window.DATING = { init, settingsSheet, hudChipsHTML, hudClick, allowed, ensure, _loaded }. */
(function () {
  "use strict";
  var W = window, D = document, A = null, core = null, loading = null, obs = null, pend = false, on = false;
  function ls(k) { try { return W.localStorage.getItem(k); } catch (e) { return null; } }
  function tl(sv, en) { return W.I18N && W.I18N.lang === "en" ? en : sv; }
  function beta() { try { return !!(W.PN_BETA || D.getElementById("olnu-beta")); } catch (e) { return false; } }
  function store() {
    try {
      if (W.OLNU_STORE != null) return !!W.OLNU_STORE;
      return !!W.Capacitor || /[?&]app=(android|ios)\b/.test(location.search) || /^android-app:/.test(D.referrer || "") || ls("olnu.store") === "1";
    } catch (e) { return false; }
  }
  // the ONE gate: beta code, not a store build, and the server has not said "missing" in this session
  function allowed() {
    if (!beta() || store()) return false;
    try { if (W.sessionStorage.getItem("olnu.oi.gone") === "1") return false; } catch (e) {}
    return true;
  }
  function sha() { try { return String(W.PN_BETA || (W.KANAL && W.KANAL.sha && W.KANAL.sha()) || "").replace(/[^\w]/g, "").slice(0, 12); } catch (e) { return ""; } }
  function src(name) { var s = sha(); return "./" + name + (s ? "?b=" + s : ""); }
  function css() {
    if (D.getElementById("oi-css")) return;
    var l = D.createElement("link"); l.id = "oi-css"; l.rel = "stylesheet"; l.href = src("dating.css"); D.head.appendChild(l);
  }
  // load the lazy files (in order) once; resolves with PN.oiCore
  function ensure(withUi) {
    if (!allowed()) return Promise.reject(new Error("not allowed"));
    var P = W.PN || {};
    if (!loading) {
      css();
      var ld = function (f, test) { return P.load ? P.load(src("js/" + f), { test: test }) : Promise.reject(new Error("no loader")); };
      loading = ld("dating-logic.js", function () { return !!(W.PN && W.PN.oiLogic); })
        .then(function () { return ld("dating-content.js", function () { return !!(W.PN && W.PN.oiText); }); })
        .then(function () { return ld("dating-core.js", function () { return !!(W.PN && W.PN.oiCore); }); })
        .then(function () { core = W.PN.oiCore; core.start(A, api); return core; })
        .catch(function (e) { loading = null; throw e; });
    }
    if (!withUi) return loading;
    return loading.then(function (c) { return c.ui().then(function () { return c; }); });
  }
  // the bar sheets that show my check-in here and have no section yet
  function scan() {
    pend = false;
    if (!on || ls("olnu.oi.hide") === "1") return;
    var outs = D.querySelectorAll(".bs .ci-out[data-ciout]");
    for (var i = 0; i < outs.length; i++) {
      var bs = outs[i].closest(".bs");
      if (!bs || bs.querySelector(".oi-sec")) continue;
      (function (bs, bar) { ensure().then(function (c) { if (bs.isConnected && !bs.querySelector(".oi-sec")) c.mount(bs, bar); }, function () {}); })(bs, outs[i].getAttribute("data-ciout"));
    }
  }
  function watch() {
    if (obs || !W.MutationObserver || !D.body) return;
    obs = new MutationObserver(function () { if (pend) return; pend = true; (W.requestAnimationFrame || setTimeout)(scan); });
    obs.observe(D.body, { childList: true, subtree: true });
  }
  function stop() { on = false; if (obs) { obs.disconnect(); obs = null; } [].forEach.call(D.querySelectorAll(".oi-sec, .oi-set"), function (n) { n.remove(); }); }
  var api = { stop: stop, scan: function () { scan(); } };

  W.DATING = {
    init: function (app) {
      A = app;
      if (!allowed()) return;
      on = true;
      watch(); scan();
      // the switch was on tonight (reload, app killed): resume the quiet poll so a notice still arrives
      var rec = null; try { rec = JSON.parse(ls("olnu.oi.on") || "null"); } catch (e) { rec = null; }
      if (rec && rec.until > Date.now()) setTimeout(function () { ensure().then(function (c) { c.resume(); }, function () {}); }, 1500);
    },
    settingsSheet: function (stage) {
      if (!on || !allowed() || !stage || stage.querySelector(".oi-set")) return;
      var b = D.createElement("button"); b.type = "button"; b.className = "ds-row pn-row mn-vis-srow oi-set";
      var ic = ""; try { ic = W.PNI ? W.PNI.svg("heart") : ""; } catch (e) {}
      b.innerHTML = '<span class="ds-row-i" aria-hidden="true">' + ic + '</span><span class="ds-row-t"><span></span><small></small></span><span class="ds-chev" aria-hidden="true"></span>';
      b.querySelector(".ds-row-t > span").textContent = tl("Öppen ikväll", "Open tonight");
      b.querySelector(".ds-row-t > small").textContent = tl("Samtycke, säkerhet, anmäl", "Consent, safety, report");
      b.addEventListener("click", function () { ensure(true).then(function (c) { c.openSafety(); }, function () {}); });
      stage.appendChild(b);
    },
    hudChipsHTML: function () { try { return on && core ? core.chipHTML() : ""; } catch (e) { return ""; } },
    hudClick: function (action) { if (action === "oi" && core) core.openGame(); },
    allowed: allowed, ensure: ensure, _loaded: function () { return !!core; }
  };
  if (W.PN && W.PN.mod) W.PN.mod("DATING");
})();
