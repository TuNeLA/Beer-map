/* PintsNow — upd0: service worker registration + the update flow (lane start1, 14 Nov 2026; owner I-107: "it took like
   5 seconds, and then it opened the app again"). The first app script in index.html (right after config.js). window.UPD0.
   Before: sw.js took over at once (skipWaiting + clients.claim) and app.js reloaded the page on "controllerchange" when
   nothing was open. At start nothing is open, so every start after a release showed the app twice.
   Now: a new sw.js installs in the background and WAITS (sw.js "start1"). It takes over
     a) at a cold start: the browser activates it by itself when no page of the app is open. A page that still started on
        the old worker while a new one waits (reload, second tab) says {type:"pn-skip"} and reloads ONCE, only while the
        splash is still up and only for a plain start (no link in the address: a reload would lose it);
     b) when the app comes back after 30 min or more in the background and nothing is open (calm): splash, pn-skip, ONE reload.
        The browser lets the new worker in only when the old one has no request in flight. If that takes longer than
        3 s, or the user has touched the app meanwhile: no reload now ("mixed" below). swfix: kick() below makes the browser
        ask again while the old worker is kept busy by this page;
     c) "Uppdatera nu" in Inställningar (app-settings.js forceUpdate / pnds.js hardUpdate reload to ?v=<time>): that page
        is already the new version from the network, so the waiting worker takes over at once with NO second reload.
   Never while the app is in use. No "Ny version" button on the map any more.
   Loop guard: at most ONE automatic reload per 10 min per tab (sessionStorage "pn.upd.at"); no sessionStorage = no reload.
   "mixed": the worker changed under this page and the page did not ask (another tab, an emergency release with
   TAKE_OVER_NOW) → one guarded reload at the next return from the background.
   Telemetry (PNLOG): upd.ready (a version waits) · upd.take {why} · upd.done {why, ms} on the page after the reload.
   Public: UPD0.state() → { had, ready, waiting, mixed, asked, manual } · UPD0.apply() = take a waiting version now (one
   reload; for a settings button) · UPD0._back(ms) (tests: "the app was hidden for ms"). */
(function () {
  "use strict";
  var W = window, SW = navigator.serviceWorker;
  var KEY = "pn.upd.at", WHY = "pn.upd.why", GAP = 10 * 60e3, HIDE_MS = 30 * 60e3, BOOT_MS = 1500, CHECK_MS = 10 * 60e3, T0 = Date.now();
  var st = { had: !!(SW && SW.controller), ready: false, asked: "", mixed: false, reloading: false, hiddenAt: 0,
    manual: /[?&]v=\d{12,}(&|$)/.test(location.search), plain: !location.search && location.hash.length < 2 };
  var reg = null, coverEl = null, coverT = 0, askedAt = 0, touched = false, BACK_MS = 3000, KICK_MS = 900, KICKS = 3;
  ["pointerdown", "keydown"].forEach(function (ev) { document.addEventListener(ev, function () { touched = true; }, { capture: true, passive: true }); });
  function log(ev, o) { try { if (W.PNLOG && W.PNLOG.event) W.PNLOG.event(ev, o || {}); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); return sessionStorage.getItem(k) === v || v == null; } catch (e) { return false; } }
  // may this tab reload by itself now? (peek: no mark yet)
  function guardOk() { return ssSet("pn.upd.t", "1") && !(Date.now() - (+ssGet(KEY) || 0) < GAP); }
  function splashUp() { var s = document.getElementById("pn-splash"); return !!s && !/\bpn-splash-out\b/.test(s.className); }
  function inBoot() { return splashUp() || performance.now() < BOOT_MS; }
  // I-25: nothing under the user's hands. Calm = no typing, nothing busy, no sheet / intro / takeover / undo button, no live
  // ride and no live Följ mig hem.
  function calm() {
    try {
      var PN = W.PN, a = document.activeElement, live = false;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return false;
      try { live = !!((W.RIDE && W.RIDE.live && W.RIDE.live()) || (W.HEMFOLJ && W.HEMFOLJ._mine && (W.HEMFOLJ._mine() || {}).live)); } catch (e) {}
      var sheet = document.getElementById("sheet"), intro = document.getElementById("intro");
      return !(live || (PN && PN.s && (PN.s.busy || PN.s.undoEl)) || (sheet && !sheet.hidden) || (intro && !intro.hidden) || document.querySelector(".takeover"));
    } catch (e) { return false; }
  }
  // The start splash again (same element id = the inline style in index.html), so the reload looks like one normal start.
  function cover() {
    if (coverEl || document.getElementById("pn-splash")) return;
    var d = document.createElement("div"), i = document.createElement("img"), b = document.createElement("b");
    d.id = "pn-splash"; d.setAttribute("aria-hidden", "true"); d.setAttribute("data-upd", "1");
    i.src = "./icons/icon-192.png"; i.alt = ""; i.width = 96; i.height = 96; b.textContent = "PintsNow";
    d.appendChild(i); d.appendChild(b); document.body.appendChild(d);
    coverEl = d;
    clearTimeout(coverT); coverT = setTimeout(uncover, 1500);   // the worker did not take over at once: give the app back
  }
  function uncover() {
    clearTimeout(coverT);
    if (coverEl && coverEl.parentNode && !st.reloading) coverEl.parentNode.removeChild(coverEl);
    coverEl = null;
  }
  function reload(why) {
    if (st.reloading) return true;
    if (!guardOk() || !ssSet(KEY, String(Date.now()))) return false;
    st.reloading = true;
    ssSet(WHY, why + "|" + Date.now());
    log("upd.take", { why: why });
    location.reload();
    return true;
  }
  // Tell the waiting worker to take over. "controllerchange" does the rest.
  function take(why) {
    var w = reg && reg.waiting;
    if (!w || st.asked) return false;
    st.asked = why; askedAt = Date.now(); touched = false;
    try { w.postMessage({ type: "pn-skip" }); } catch (e) { st.asked = ""; return false; }
    return true;
  }
  // swfix (A4b part 2): after pn-skip Chromium lets the waiting worker in only when the old worker is idle, and it cuts the old
  // worker's idle wait to 0 only if the old worker runs at the moment of the ask. When the old worker is stopped and started
  // again by this page's requests (resume burst, polls), that short wait is lost: 30 s of full quiet or never (lane swfix
  // measured "back" with no DevTools: no switch in 45 s). A navigation makes the browser ask again
  // (service_worker_controllee_request_handler.cc: ActivateWaitingVersionWhenReady). So: a hidden frame loads a small
  // precached file, up to 3 times, until the new worker is in. No reload, nothing on the screen; the normal
  // "controllerchange" path above does the rest.
  function kick(why, n) {
    n = n || 0;
    setTimeout(function () {
      if (st.asked !== why || st.reloading || n >= KICKS || !(reg && reg.waiting)) return;
      try {
        var f = document.createElement("iframe"), gone = function () { if (f.parentNode) f.parentNode.removeChild(f); };
        f.hidden = true; f.tabIndex = -1; f.setAttribute("aria-hidden", "true"); f.title = "";
        f.onload = gone; setTimeout(gone, 3000);
        f.src = "./icons/badge-96.png?swkick=" + n;
        document.body.appendChild(f);
      } catch (e) {}
      kick(why, n + 1);
    }, n ? KICK_MS : 400);
  }
  function manualNow() { return st.manual && Date.now() - T0 < 120e3; }
  function watch(r) {
    if (!r || r.__upd0) return;
    r.__upd0 = 1;
    var seen = function (w) {
      if (!w) return;
      w.addEventListener("statechange", function () {
        if (w.state !== "installed" || !r.waiting || !SW.controller) return;   // first install: no controller, nothing waits
        st.ready = true; log("upd.ready", {});
        if (manualNow()) take("manual");
      });
    };
    seen(r.installing);
    r.addEventListener("updatefound", function () { seen(r.installing); });
  }
  // Back from the background. away = ms hidden.
  function back(away) {
    if (st.reloading || st.asked || !st.had) return;
    var waiting = !!(reg && reg.waiting);
    if (!(st.mixed || (waiting && away >= HIDE_MS))) return;
    if (!calm() || !guardOk()) return;
    cover();
    if (st.mixed) { if (!reload("mixed")) uncover(); return; }
    if (!take("back")) { uncover(); return; }
    kick("back");
  }

  W.UPD0 = {
    state: function () { return { had: st.had, ready: st.ready, waiting: !!(reg && reg.waiting), mixed: st.mixed, asked: st.asked, manual: st.manual }; },
    // a settings button: the waiting version now (the user asked: no calm check). false = nothing waits.
    apply: function () { if (!(reg && reg.waiting)) { try { if (reg) reg.update().catch(function () {}); } catch (e) {} return false; } if (st.asked) st.asked = ""; cover(); if (take("now")) { kick("now"); return true; } uncover(); return false; },
    _back: back
  };
  if (!SW) return;

  SW.addEventListener("controllerchange", function () {
    if (!st.had) { st.had = true; return; }   // first install (clients.claim): this page is already that version
    var why = st.asked;
    st.asked = ""; st.ready = false;
    if (why === "manual" || manualNow()) return;   // c) this page came from the network after "Uppdatera nu": already new
    // swfix: the browser let the new worker in during this start without an ask (the start's own navigation asked): same as
    // a): still under the splash, a plain start → the one reload now (was: "mixed", the old page ran on until the next return)
    if ((why === "boot" || (!why && st.plain)) && inBoot() && reload("boot")) return;
    if (why === "back" && !touched && Date.now() - askedAt < BACK_MS && calm() && (cover(), reload("back"))) return;
    if (why === "now" && reload("now")) return;
    uncover();
    st.mixed = true;   // not asked for, too late for the splash, or the loop guard said no
  });

  // a) the page started on the old worker and a new version waits
  if (st.had && SW.getRegistration) {
    SW.getRegistration().then(function (r) {
      if (!r) return;
      reg = reg || r; watch(r);
      if (!r.waiting) return;
      st.ready = true;
      if (st.manual) { take("manual"); return; }
      if (st.plain && inBoot() && guardOk() && take("boot")) kick("boot");
    }, function () {});
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { st.hiddenAt = Date.now(); return; }
    var away = st.hiddenAt ? Date.now() - st.hiddenAt : 0;
    st.hiddenAt = 0;
    back(away);
  });

  window.addEventListener("load", function () {
    var w = ssGet(WHY);
    if (w) { ssSet(WHY, null); var p = w.split("|"); setTimeout(function () { log("upd.done", { why: p[0], ms: Math.max(0, T0 - (+p[1] || T0)) }); }, 3000); }
    // Always check for a new sw.js (updateViaCache none: GitHub Pages sends max-age=600).
    SW.register("./sw.js", { scope: "./", updateViaCache: "none" }).then(function (r) {
      reg = r; watch(r);
      var check = function () { if (r && r.update) r.update().catch(function () {}); };
      var lastCheck = 0;   // ⚡ SPEED: not in the resume burst, max once per 30 min
      document.addEventListener("visibilitychange", function () { if (!document.hidden && Date.now() - lastCheck > 30 * 60000) { lastCheck = Date.now(); setTimeout(check, 8000); } });
      setInterval(check, CHECK_MS);
    }).catch(function () {});
  });
})();
