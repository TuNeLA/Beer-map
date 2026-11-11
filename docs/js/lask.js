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
  var tn = 0;
  function tap(e) {
    var b = e.target && e.target.closest ? e.target.closest("#btn-beer") : null; if (!b || !on() || b.disabled) return;
    e.stopImmediatePropagation(); e.preventDefault();
    var A = api();
    b.classList.remove("mn-lask-pop"); void b.offsetWidth; b.classList.add("mn-lask-pop");
    try { if (window.FX && window.FX.vibrate) window.FX.vibrate(12); } catch (x) {}
    var msg = T("lask.toast"); try { if (window.DIALEKT && window.DIALEKT.t) msg = window.DIALEKT.t("lask.toast", { _seed: tn++ }, P["lask.toast"][0]); } catch (x) {}
    // the toast shows at once (as before); ride3: the soda is logged in the background and the count is added to it
    var el = null;
    try {
      if (A && A.toast) el = A.toast(msg, { id: "mn-lask", ms: 4500, cls: "rd-lask-toast", action: { label: T("lask.off"), fn: function () { try { window.SKJUTS.setDriver(false); } catch (x) {} setTimeout(sync, 900); } } });
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
    setInterval(sync, 1000);   // driving changes come from skjuts.js polls / the Ikväll menu switch (cheap: reads + writes on change)
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.LASK = { on: on, sync: sync };
})();
