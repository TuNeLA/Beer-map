/* PintsNow — MAP EMPTY STATE (mapfix5 D4, product audit A3 #4 + A5 #3; DESIGN rule 8 "every data screen has loading,
   empty, error"). PN.mapEmpty (no new window global).
   Before: with nobody in view the map showed bar icons only: no text, no next step.
   Now: ONE calm card above the dock (the bottom banner place, --pn-ban-b), only when ALL of these are true:
     - the last poll worked less than 3 min ago and the phone is online (else we do not know: no claim);
     - the map is at town or street zoom (Leaflet z >= 12) and nothing else is open (sheet, pop-up, bottom banner);
     - no pin (PN.s.beers) and no check-in (PN.s.checkins) is in the view.
   Line 1 "Inga pins här just nu", line 2 "Kartan visar bara folk som delar sin plats." (true even when the top pill says
   "12 ute": people can be out without a pin; no claim that the town is quiet). If the poll knows a pin outside the view, one row
   "Närmast folk: 1,2 km bort" flies there (a row, not a second primary: ÖL! stays the one primary). ✕ hides the card until
   pins come back in view. Never fake pins, never a drinking push (people, not drinks). Text in sv and en.
   Checked again after each map move and every 5 s while the app is visible (no loop while hidden). */
(function () {
  "use strict";
  var PN = window.PN = window.PN || {};
  var MIN_Z = 12, POLL_OK_MS = 3 * 60e3, EVERY = 5000;
  var map = null, card = null, timer = 0, closed = false, near = null, cssDone = false;
  function sv() { var I = window.I18N; return !I || I.lang !== "en"; }
  function two(s, e) { return sv() ? s : e; }
  function dist(m) { return m < 950 ? Math.max(100, Math.round(m / 100) * 100) + " m" : (sv() ? (Math.round(m / 100) / 10).toString().replace(".", ",") : (Math.round(m / 100) / 10).toString()) + " km"; }
  function hav(a, b, c, d) {
    var R = 6371e3, r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r;
    var h = Math.sin(x / 2) * Math.sin(x / 2) + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) * Math.sin(y / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function css() {
    if (cssDone) return; cssDone = true;
    var st = document.createElement("style"); st.id = "pn-mapempty-css";
    st.textContent =
      ".pn-me-card{position:fixed;z-index:1003;left:calc(var(--sal,0px) + var(--pn-edge,12px));right:calc(var(--sar,0px) + var(--pn-edge,12px));" +
      "bottom:var(--pn-ban-b,calc(var(--dock-h,180px) + 24px));max-width:420px;margin:0 auto;box-sizing:border-box;" +
      "display:grid;grid-template-columns:20px 1fr 44px;column-gap:var(--sp-3,12px);align-items:start;padding:var(--sp-3,12px) var(--sp-1,4px) var(--sp-3,12px) var(--sp-4,16px);" +
      "background:var(--pn-float);border:1px solid var(--ds-border-2,var(--ds-border));border-radius:var(--r-lg,16px);box-shadow:var(--ds-sh-1);color:var(--ds-text)}" +
      ".pn-me-card[hidden]{display:none}" +
      ".pn-me-ic{color:var(--ds-amber-t);padding-top:2px}.pn-me-ic svg{width:20px;height:20px;display:block}" +
      ".pn-me-t{font:600 var(--fs-16)/22px var(--ds-sans,inherit);margin:0;padding-top:0}" +
      ".pn-me-s{font:400 var(--fs-14)/20px var(--ds-sans,inherit);color:var(--ds-muted);margin:var(--sp-0,2px) 0 0}" +
      ".pn-me-x{width:44px;height:44px;margin:calc(-1 * var(--sp-2,8px)) 0;display:grid;place-items:center;border:0;background:none;color:var(--ds-muted);border-radius:var(--r-pill,999px);cursor:pointer}" +
      ".pn-me-x svg{width:16px;height:16px}" +
      ".pn-me-go{grid-column:2 / 4;display:flex;align-items:center;justify-content:space-between;gap:var(--sp-2,8px);min-height:44px;margin:var(--sp-2,8px) var(--sp-3,12px) calc(-1 * var(--sp-1,4px)) 0;" +
      "padding:0 var(--sp-3,12px);border:1px solid var(--ds-border-2,var(--ds-border));border-radius:var(--r-md,12px);background:var(--ds-card);color:var(--ds-text);font:600 var(--fs-14)/20px var(--ds-sans,inherit);cursor:pointer;text-align:left}" +
      ".pn-me-go svg{width:16px;height:16px;color:var(--ds-muted);flex:none}" +
      ".pn-me-go[hidden]{display:none}" +
      ".pn-me-x:focus-visible,.pn-me-go:focus-visible{outline:2px solid var(--ds-amber-t);outline-offset:2px}" +
      "@media (prefers-reduced-motion:no-preference){.pn-me-card{animation:pnMeIn var(--m-2,200ms) ease-out}}" +
      "@keyframes pnMeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}";
    document.head.appendChild(st);
  }
  function icon(n) { try { return window.PNI ? window.PNI.svg(n) : ""; } catch (e) { return ""; } }
  function build() {
    if (card) return card;
    css();
    card = document.createElement("div");
    card.className = "pn-me-card"; card.hidden = true; card.setAttribute("role", "status");
    card.innerHTML = '<span class="pn-me-ic" aria-hidden="true">' + icon("moon") + '</span><div><p class="pn-me-t"></p><p class="pn-me-s"></p></div>' +
      '<button type="button" class="pn-me-x">' + icon("x") + '</button><button type="button" class="pn-me-go" hidden><span></span>' + icon("chev-right") + "</button>";
    card.querySelector(".pn-me-x").addEventListener("click", function (e) { e.stopPropagation(); closed = true; hide(); });
    card.querySelector(".pn-me-go").addEventListener("click", function (e) {
      e.stopPropagation(); if (!near || !map) return;
      var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      hide();
      if (still || !map.flyTo) map.setView([near.lat, near.lng], Math.max(15, map.getZoom()), { animate: false });
      else map.flyTo([near.lat, near.lng], Math.max(15, map.getZoom()), { duration: 1.2 });
    });
    document.body.appendChild(card);
    return card;
  }
  function hide() { if (card) card.hidden = true; }
  function busy() {
    if (PN.s && PN.s.sheetCur) return true;
    var els = document.querySelectorAll(".leaflet-popup, .hf-banner, .sk-banner, .fm-banner, #intro:not([hidden]), .intro-ov");
    for (var i = 0; i < els.length; i++) { var r = els[i].getBoundingClientRect(); if (!els[i].hidden && r.width > 0 && r.height > 0 && getComputedStyle(els[i]).visibility !== "hidden") return true; }   // shown, not only in the DOM
    return /\b(sk-on|chief-on|fm-on)\b/.test(document.body.className);
  }
  function pts() {
    var s = PN.s || {}, out = [];
    (s.beers || []).forEach(function (b) { if (b && isFinite(b.lat) && isFinite(b.lng)) out.push({ lat: +b.lat, lng: +b.lng }); });
    (s.checkins || []).forEach(function (c) { if (c && isFinite(c.lat) && isFinite(c.lng)) out.push({ lat: +c.lat, lng: +c.lng }); });
    return out;
  }
  // what the card should show now: null = no card, else { near: { lat, lng, d } | null }
  function state() {
    var s = PN.s;
    if (!map || !s || !s.firstLoadDone || !s.lastPollAt || Date.now() - s.lastPollAt > POLL_OK_MS) return null;
    if (navigator.onLine === false || document.hidden || map.getZoom() < MIN_Z || busy()) return null;
    var b = map.getBounds(), list = pts(), inView = list.some(function (p) { return b.contains([p.lat, p.lng]); });
    if (inView) { closed = false; return null; }   // life in view: no card (and a ✕ is forgotten)
    if (closed) return null;
    var c = map.getCenter(), best = null;
    list.forEach(function (p) { var d = hav(c.lat, c.lng, p.lat, p.lng); if (!best || d < best.d) best = { lat: p.lat, lng: p.lng, d: d }; });
    return { near: best && best.d < 300e3 ? best : null };
  }
  function check() {
    var st = null; try { st = state(); } catch (e) { st = null; }
    if (!st) { hide(); return; }
    build();
    near = st.near;
    card.querySelector(".pn-me-t").textContent = two("Inga pins här just nu", "No pins here right now");
    card.querySelector(".pn-me-s").textContent = two("Kartan visar bara folk som delar sin plats.", "The map only shows people who share their place.");
    card.querySelector(".pn-me-x").setAttribute("aria-label", two("Stäng", "Close"));
    var go = card.querySelector(".pn-me-go");
    go.hidden = !near;
    if (near) go.querySelector("span").textContent = two("Närmast folk: ", "Nearest people: ") + dist(near.d) + two(" bort", " away");
    card.hidden = false;
  }
  function loop() {
    clearTimeout(timer);
    if (document.hidden) return;
    check();
    timer = setTimeout(loop, EVERY);
  }
  function start() {
    map = PN.map || window.__map || null;
    if (!map || !map.on) { setTimeout(start, 500); return; }
    map.on("movestart", hide);
    map.on("moveend", function () { setTimeout(check, 300); });
    document.addEventListener("visibilitychange", function () { if (document.hidden) { clearTimeout(timer); hide(); } else loop(); });
    loop();
  }
  PN.mapEmpty = { check: check, _state: state, _reset: function () { closed = false; } };
  if (document.readyState === "complete") setTimeout(start, 1500);
  else window.addEventListener("load", function () { setTimeout(start, 1500); });
})();
