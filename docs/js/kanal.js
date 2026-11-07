/* PintsNow — 🧪 Betaversion (beta channel). CONTRACT "BETAKANAL". Swedish only.
   Like a Chrome/Discord beta channel: the SAME installed app (same URL, same home-screen icon, same storage, same account)
   runs the code of the beta build (OLNU_CONFIG.BETA_URL, made from branch big-update by TuNeLA/pintsnow-beta).
   - The service worker (sw.js) is the launcher. This file only stores the choice and talks to it:
     record {ch: "beta"|"stable", url, at, fell, fellShown} in Cache Storage "olnu-pending" ./__kanal (a worker has no
     localStorage) + message "pn-kanal-set". Then the page reloads.
   - Boot signal: "pn-kanal-alive" when this file runs, "pn-kanal-ok" when app.js has started the modules (mods init).
     No ok in time = the worker goes back to stable by itself (safety net) and the stable app shows a toast.
   - Inställningar (tab Inställningar, section Om & hjälp): switch "Betaversion".
   - The version tag at the top is the beta build's own "BETA <sha>" badge (beta/transform.py).
   - ?kanal=stabil: the worker forces stable; this file cleans the URL and says so.
   Public: window.KANAL = { init, settingsSheet, sha, running, direct }. */
(function () {
  "use strict";
  var CFG = window.OLNU_CONFIG || {};
  var KEY = "./__kanal", A = null;
  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function slash(u) { u = String(u || ""); return u && u.charAt(u.length - 1) !== "/" ? u + "/" : u; }
  // Tests on localhost may point to a local beta build (olnu.betaUrl); never on a real address.
  var BETA = slash((LOCAL && lsGet("olnu.betaUrl")) || CFG.BETA_URL || "");
  var direct = !!BETA && location.href.indexOf(BETA) === 0;   // the beta build opened at its own address
  function badge() { return document.getElementById("olnu-beta"); }
  function sha() {
    if (window.PN_BETA) return String(window.PN_BETA).slice(0, 12);
    var b = badge(); return b ? String(b.textContent || "").replace(/^\s*BETA\s*/, "").trim().slice(0, 12) : "";
  }
  function isBetaCode() { return !!(window.PN_BETA || badge()); }
  function running() { return isBetaCode() && !direct; }   // beta code inside the normal app (through the launcher)
  function sw() { try { return navigator.serviceWorker && navigator.serviceWorker.controller; } catch (e) { return null; } }
  function post(msg, wait) {
    var c = sw(); if (!c) return Promise.resolve(false);
    return new Promise(function (ok) {
      var done = false, fin = function (v) { if (!done) { done = true; ok(v); } };
      try {
        var ch = new MessageChannel();
        ch.port1.onmessage = function () { fin(true); };
        c.postMessage(msg, [ch.port2]);
      } catch (e) { try { c.postMessage(msg); } catch (x) {} fin(false); }
      setTimeout(function () { fin(false); }, wait || 1500);
    });
  }
  function readRec() {
    try {
      if (!window.caches) return Promise.resolve(null);
      return caches.open("olnu-pending").then(function (c) { return c.match(KEY); }).then(function (r) { return r ? r.json() : null; }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function writeRec(rec) {
    try {
      if (!window.caches) return Promise.resolve();
      return caches.open("olnu-pending").then(function (c) { return c.put(KEY, new Response(JSON.stringify(rec), { headers: { "Content-Type": "application/json" } })); }).catch(function () {});
    } catch (e) { return Promise.resolve(); }
  }
  // Store the choice (cache + worker memory). The worker answers when it has saved it.
  function setRec(rec) {
    return writeRec(rec).then(function () { return post({ type: "pn-kanal-set", rec: rec }, 2000); });
  }
  function toast(m, o) { try { if (A && A.toast) A.toast(m, o || {}); } catch (e) {} }

  /* ---------- boot signals (beta code through the launcher) ---------- */
  if (running()) post({ type: "pn-kanal-alive", sha: sha() }, 500);
  // ?kanal=stabil (the worker already served the stable app): clean the URL
  var forced = /[?&]kanal=stabil\b/.test(location.search || "");
  if (forced) {
    try {
      var q = new URLSearchParams(location.search); q.delete("kanal");
      var qs = q.toString(); history.replaceState(history.state, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    } catch (e) {}
    if (!sw()) writeRec({ ch: "stable", at: Date.now(), by: "url" });   // no worker yet: nothing else will store it
  }

  /* ---------- Inställningar: switch "Betaversion" ---------- */
  function ic(n) { try { return window.PNI ? window.PNI.svg(n, "pi-lead") : ""; } catch (e) { return ""; } }
  function row(on) {
    var s = sha();
    var sub = on && running() && s ? "Du kör beta " + s + ". Kan ha buggar." : "Få nya funktioner först. Kan ha buggar.";
    var label = document.createElement("span");
    label.innerHTML = ic("sparkle");
    label.appendChild(document.createTextNode("Betaversion"));
    var sm = document.createElement("small"); sm.textContent = sub; label.appendChild(sm);
    var swb = document.createElement("button");
    swb.type = "button"; swb.className = "switch"; swb.setAttribute("role", "switch");
    swb.setAttribute("aria-checked", String(!!on)); swb.setAttribute("aria-label", "Betaversion");
    var r = document.createElement("div"); r.className = "toggle-row pn-kanal"; r.setAttribute("data-kanal", on ? "beta" : "stable");
    r.appendChild(label); r.appendChild(swb);
    swb.addEventListener("click", function () { flip(swb); });
    return r;
  }
  var busy = false;
  function flip(swb) {
    if (busy) return;
    var on = swb.getAttribute("aria-checked") === "true";
    if (!sw()) { toast("Betan går att slå på när appen har laddat klart. Försök igen om en stund.", { err: true, ms: 6000 }); return; }
    busy = true; swb.disabled = true;
    var undo = function (msg) { busy = false; swb.disabled = false; swb.setAttribute("aria-checked", String(on)); if (msg) toast(msg, { err: true, ms: 6000 }); };
    swb.setAttribute("aria-checked", String(!on));
    if (on) {   // → stable
      setRec({ ch: "stable", at: Date.now(), by: "user" }).then(function () {
        try { if (window.caches) caches.delete("olnu-beta"); } catch (e) {}
        toast("Du kör vanliga versionen. Laddar om…", { ms: 3000 });
        setTimeout(function () { location.reload(); }, 600);
      });
      return;
    }
    // → beta: only when the beta build answers (else the user would get the safety net at once)
    var ac = typeof AbortController === "function" ? new AbortController() : null;
    var tm = setTimeout(function () { try { if (ac) ac.abort(); } catch (e) {} }, 8000);
    fetch(BETA + "index.html", { mode: "cors", credentials: "omit", cache: "no-store", signal: ac ? ac.signal : undefined }).then(function (r) {
      clearTimeout(tm);
      if (!r.ok) throw new Error("beta " + r.status);
      return r.text();
    }).then(function (html) {
      if (!/id="olnu-beta"/.test(html)) throw new Error("not a beta");
      return setRec({ ch: "beta", url: BETA, at: Date.now(), by: "user" }).then(function (saved) {
        if (!saved) { undo("Det gick inte att slå på betan. Uppdatera appen och försök igen."); return writeRec({ ch: "stable", at: Date.now() }); }
        toast("Startar betan…", { ms: 3000 });
        setTimeout(function () { location.reload(); }, 600);
      });
    }).catch(function () { clearTimeout(tm); undo("Betan går inte att nå just nu. Försök igen senare."); });
  }
  function settingsSheet(body) {
    if (!BETA || direct || !body || body.querySelector(".pn-kanal")) return;
    if (!("serviceWorker" in navigator) || !window.caches) return;
    var r = row(running());
    body.appendChild(r);
    readRec().then(function (rec) {   // the stored choice (beta may be chosen but not running: offline, safety net)
      var on = running() || !!(rec && rec.ch === "beta");
      var swb = r.querySelector(".switch"); if (swb && !busy) swb.setAttribute("aria-checked", String(on));
      r.setAttribute("data-kanal", on ? "beta" : "stable");
    });
  }

  /* ---------- after start ---------- */
  function init(api) {
    A = api;
    if (running()) { setTimeout(function () { post({ type: "pn-kanal-ok", sha: sha() }, 1500); }, 0); return; }
    if (direct) return;
    if (forced) { setTimeout(function () { toast("Du kör vanliga versionen.", { ms: 4000 }); }, 1200); return; }
    // the worker fell back to stable (safety net): say it once
    readRec().then(function (rec) {
      if (!rec || !rec.fell || rec.fellShown) return;
      rec.fellShown = Date.now();
      setRec(rec);
      setTimeout(function () { toast("Betan kunde inte starta – du kör vanliga versionen", { err: true, ms: 8000, id: "kanal" }); }, 1500);
    });
  }

  window.KANAL = { init: init, settingsSheet: settingsSheet, sha: function () { return isBetaCode() ? sha() : ""; }, running: running, direct: function () { return direct; } };
})();
