/* PintsNow — F2 "LÄSK!" (lane main, 10 Nov; owner: "when Jag kör ikväll is ON, the ÖL! button turns into something fun,
   LÄSK! / chaufför. No alcohol-free menu item").
   While SKJUTS.driving() is true (skjuts.js API, read only) and the button is ready (no cooldown, live):
     - the round button is a soda can colour (lime → teal, tokens --pn-acc-money / --pn-acc-cam), label "LÄSK!" + "chaufför"
     - a tap logs NO drink: a short skål for the driver + a toast with "Jag kör inte" (turns driving off → ÖL! again)
     - lane ride3 (owner 11 Nov 21:26 "then I can't drink my soda when I'm driving"): a tap LOGS A SODA with
       ride_lask_post (0495, its own table ride_lask: never beers / drink_log, so never alcohol anywhere and never a block
       for the driver). 1 per 60 s (server). Toast "Skål i läsk, chaufför! · 2 läsk ikväll"; "Jag kör inte" is a small
       secondary link (ride.css .rd-lask-toast). An older server (no ride_lask_post) = today's no-drink toast.
     - lane ride3 (owner 21:43): ANNAT is hidden while driving (body.mn-drive).
   Cooldown, "coming soon" and the busy state stay as app.js draws them. The label is put back in the same microtask when
   app.js rewrites it (MutationObserver), so it never flickers. Copy: DIALEKT keys "lask.*" (sv-neutral).
   Styles: pnds.css "lane:main" (body.mn-lask). Public: window.LASK = { on(), sync() }. */
(function () {
  "use strict";
  var P = {
    "lask.label": "LÄSK!", "lask.sub": "chaufför", "lask.aria": "LÄSK! Du kör ikväll. Ingen öl räknas.",
    "lask.toast": ["Skål i läsk, chaufför! Gänget kommer hem tack vare dig.", "Läsken ä din, ratten ä din. Respekt.", "Chaufförens skål! Ingen öl räknas när du kör."],
    "lask.off": "Jag kör inte", "lask.n": ["{n} läsk ikväll", "{n} läskar ikväll"], "lask.slow": "En läsk i minuten räcker, chaufför."
  };
  try { if (window.DIALEKT && window.DIALEKT.register) window.DIALEKT.register("sv-neutral", P); } catch (e) {}
  function T(k) { try { if (window.DIALEKT && window.DIALEKT.t) return window.DIALEKT.t(k, {}, Array.isArray(P[k]) ? P[k][0] : P[k]); } catch (e) {} return Array.isArray(P[k]) ? P[k][0] : P[k]; }
  function $(id) { return document.getElementById(id); }
  function api() { try { var D = window.PNDS; return D && D._A ? D._A() : null; } catch (e) { return null; } }
  function driving() { try { return !!(window.SKJUTS && window.SKJUTS.driving && window.SKJUTS.driving()); } catch (e) { return false; } }
  function ready(b) { return b && !b.classList.contains("cooldown") && !b.classList.contains("soon"); }
  var state = null, saved = null, busyWrite = false;
  function on() { var b = $("btn-beer"); return driving() && ready(b); }
  function label() {
    var b = $("btn-beer"), l = $("beer-label"); if (!b || !l) return;
    var want = on();
    if (want) {
      if (l.textContent !== T("lask.label")) { busyWrite = true; saved = l.textContent; l.textContent = T("lask.label"); busyWrite = false; }
      if (b.getAttribute("aria-label") !== T("lask.aria")) b.setAttribute("aria-label", T("lask.aria"));
      l.setAttribute("data-sub", T("lask.sub"));
    } else {   // back to ÖL!: only undo what we wrote
      if (l.textContent === T("lask.label")) { busyWrite = true; l.textContent = saved && saved !== T("lask.label") ? saved : "ÖL!"; busyWrite = false; }
      if (b.getAttribute("aria-label") === T("lask.aria")) b.removeAttribute("aria-label");
      l.removeAttribute("data-sub");
    }
  }
  var drv = null;
  function sync() {
    // ride3 (owner 21:43): while "Jag kör ikväll" is on, ANNAT (#btn-other, other drinks) is HIDDEN, not only disabled
    // (body.mn-drive, ride.css), so a driver cannot log alcohol by mistake. Back at once when driving is off.
    var d = driving();
    if (d !== drv) { document.body.classList.toggle("mn-drive", d); drv = d; var o = $("btn-other"); if (o) { if (d) o.setAttribute("aria-hidden", "true"); else o.removeAttribute("aria-hidden"); } }
    var want = on();
    if (want !== state) { document.body.classList.toggle("mn-lask", want); state = want; }
    label();
  }
  /* ---------- fixB P-01 (polish sweep 24 Nov; coordinator default = BLOCK, owner can change) ----------
     "Jag kör ikväll" turned on with 6 beers logged, and the LÄSK! toast then praised the driver. Now:
     - driverBlock(): skjuts.js setDriver(true) asks it first. Drinks logged tonight (the server's "me" row, the rail count,
       my pin, or the ride poll's "drinking") → ONE calm sheet "Kör inte ikväll", driver mode stays off. The way out of a
       wrong tap is Ångra (PN.beerUndo, the server's 2-min window); then the switch works again. The server says the same
       (0538: driver_set raises 'drinking').
     - a LÄSK! tap while drinks are logged (driving was on before the beer, or on another phone): the soda is still logged
       (never a drink), but the toast is plain information + "Stäng av Jag kör", never praise. */
  function sv() { return !window.I18N || window.I18N.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function drinksTonight() {   // > 0 = the count the app knows; -1 = the ride poll says "drank tonight" but gives no number
    var n = 0, U = window.U;
    try { var P = window.PN, me = P && P.s && P.s.meState; if (me && U && U.drinks) n = Math.max(n, U.drinks(me)); } catch (x) {}
    try { var s = window.MYCOUNT && window.MYCOUNT._state ? window.MYCOUNT._state() : null; if (s) n = Math.max(n, s.shown | 0, s.want | 0); } catch (x) {}
    try { var A = api(), b = A && A.myBeer ? A.myBeer() : null; if (b && U && U.drinks) n = Math.max(n, U.drinks(b)); } catch (x) {}
    if (!n) { try { var R = window.RIDE && window.RIDE._state ? window.RIDE._state() : null; if (R && R.drinking) n = -1; } catch (x) {} }
    return n;
  }
  function drankTxt(n) {
    if (n < 0) return L("Du har loggat dryck ikväll.", "You have logged a drink tonight.");
    return n === 1 ? L("Du har loggat 1 dryck ikväll.", "You have logged 1 drink tonight.") : L("Du har loggat " + n + " drycker ikväll.", "You have logged " + n + " drinks tonight.");
  }
  function blockSheet(n) {
    var A = api(); if (!A || !A.openSheet || !A.el) return;
    var BU = window.PN && window.PN.beerUndo, canUndo = !!(BU && BU.open && BU.open());
    A.openSheet(L("Kör inte ikväll", "Do not drive tonight"), function (body) {
      var ic = window.PNI && window.PNI.svg ? window.PNI.svg("block", "") : "";
      body.appendChild(A.el("div", { class: "rd-drunk mn-block", role: "alert" }, [A.el("span", { class: "rd-ic", "aria-hidden": "true", html: ic }),
        A.el("b", { text: drankTxt(n) + " " + L("Då kör du inte bil.", "So you do not drive.") })]));
      body.appendChild(A.el("p", { class: "muted mn-block-sub", text: L("Jag kör ikväll är av. Ta en taxi, eller åk med någon som inte har druckit.", "I'm driving tonight stays off. Take a taxi, or ride with someone who has not been drinking.") }));
      if (window.EXTRAS && window.EXTRAS.taxiHTML) body.appendChild(A.el("div", { class: "mn-block-taxi", html: window.EXTRAS.taxiHTML("btn btn-small taxi-btn") }));
      if (canUndo) {
        body.appendChild(A.el("p", { class: "muted mn-block-sub", text: L("Tryckte du fel? Ångra ölen. Sen kan du slå på Jag kör ikväll.", "Wrong tap? Undo the beer. Then you can turn on I'm driving tonight.") }));
        var u = A.el("button", { type: "button", class: "btn btn-block mn-block-undo", text: L("Ångra senaste ölen", "Undo the last beer") });
        u.addEventListener("click", function () { BU.run(u, function (ok) { if (ok) { try { A.closeSheet(); } catch (x) {} } }); });
        body.appendChild(u);
      } else {
        body.appendChild(A.el("p", { class: "muted mn-block-sub", text: L("Tryckte du fel? Du kan ångra en öl bara i 2 minuter.", "Wrong tap? You can undo a beer only for 2 minutes.") }));
      }
      var c = A.el("button", { type: "button", class: "btn btn-block btn-ghost mn-block-ok", text: L("Okej", "OK") });
      c.addEventListener("click", function () { try { A.closeSheet(); } catch (x) {} });
      body.appendChild(c);
    });
    try { if (window.PNLOG && window.PNLOG.event) window.PNLOG.event("lask.block", {}); } catch (x) {}
  }
  // the count through window.LASK, so a test of the driver flow can stand for a sober driver (LASK.drinksTonight = () => 0)
  function cnt() { try { return window.LASK && window.LASK.drinksTonight ? window.LASK.drinksTonight() | 0 : drinksTonight(); } catch (x) { return drinksTonight(); } }
  function driverBlock() {
    var n = cnt(); if (!n) return false;
    blockSheet(n); return true;
  }
  var tn = 0;
  function tap(e) {
    var b = e.target && e.target.closest ? e.target.closest("#btn-beer") : null; if (!b || !on() || b.disabled) return;
    e.stopImmediatePropagation(); e.preventDefault();
    var A = api(), drank = cnt();
    if (!drank) { b.classList.remove("mn-lask-pop"); void b.offsetWidth; b.classList.add("mn-lask-pop"); }
    try { if (window.FX && window.FX.vibrate) window.FX.vibrate(12); } catch (x) {}
    var msg = T("lask.toast"); try { if (window.DIALEKT && window.DIALEKT.t) msg = window.DIALEKT.t("lask.toast", { _seed: tn++ }, P["lask.toast"][0]); } catch (x) {}
    if (drank) msg = L("Läsk loggad. ", "Soda logged. ") + drankTxt(drank) + " " + L("Kör inte bil.", "Do not drive.");   // P-01: information, no praise
    // the toast shows at once (as before); ride3: the soda is logged in the background and the count is added to it
    var el = null;
    try {
      if (A && A.toast) el = A.toast(msg, { id: "mn-lask", ms: drank ? 7000 : 4500, cls: "rd-lask-toast", action: { label: drank ? L("Stäng av Jag kör", "Turn off driving") : T("lask.off"), fn: function () { try { window.SKJUTS.setDriver(false); } catch (x) {} setTimeout(sync, 900); } } });
    } catch (x) {}
    // ride3: log the soda (its own table ride_lask, never a drink). No server / older server = the toast only, as before.
    var l = null; try { l = A && A.lastLoc && A.lastLoc(); } catch (x) {}
    if (A && A.rpc && A.LIVE) {
      A.rpc("ride_lask_post", { p_lat: l && isFinite(l.lat) ? +(+l.lat).toFixed(3) : null, p_lng: l && isFinite(l.lng) ? +(+l.lng).toFixed(3) : null }).then(function (r) {
        var e = r && r.error, d = null; try { d = !e && A.parseData ? A.parseData(r.data) : null; } catch (x) {}
        var sp = el && el.querySelector ? el.querySelector("span") : null;
        if (e && /slow_down/.test(String(e.message || ""))) { if (sp) sp.textContent = T("lask.slow"); return; }
        var n = d && d.n ? +d.n : 0;
        if (n && sp) sp.textContent = msg + " · " + (n === 1 ? P["lask.n"][0] : P["lask.n"][1]).replace("{n}", n);
      }, function () {});
    }
    try { if (window.PNLOG && window.PNLOG.event) window.PNLOG.event("lask.tap", {}); } catch (x) {}
  }
  function start() {
    document.addEventListener("click", tap, true);   // capture: before app.js beerTap (no drink is logged while driving)
    var l = $("beer-label"), b = $("btn-beer");
    if (window.MutationObserver && l && b) {
      new MutationObserver(function () { if (!busyWrite) sync(); }).observe(l, { childList: true, characterData: true, subtree: true });
      new MutationObserver(function () { sync(); }).observe(b, { attributes: true, attributeFilter: ["class", "disabled"] });
    }
    sync();
    // driving changes come from skjuts.js polls / the Ikväll menu switch (cheap: reads + writes on change); timers B10: sleeps while the map is out of sight
    if (window.PN && PN.idle) PN.idle.every(sync, 1000); else setInterval(sync, 1000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.LASK = { on: on, sync: sync, driverBlock: driverBlock, drinksTonight: drinksTonight };
})();
