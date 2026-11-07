/* PintsNow — ⚡ SPEED (CONTRACT "SPEED"; owner 2026-11-07). window.SPEED, app.js mods(): init.
   - iPhone: CSS animations pause while the map pans / zooms / pinches or a sheet / list scrolls (html.anim-pause, removed
     220 ms after the last move). iOS Safari composites every running CSS animation (ticker, pill glows, foam, chips) on
     each frame of a gesture; paused they cost nothing. Only iOS (iPhone / iPad, also iPad "desktop" mode); localStorage
     olnu.animPause = "1" turns it on anywhere (tests), "0" off.
   - No RPC, no timer while idle (one 220 ms timeout per gesture end). */
(function () {
  "use strict";
  var A = null, de = document.documentElement, offT = 0, n = 0;
  function flag() { try { return localStorage.getItem("olnu.animPause"); } catch (e) { return null; } }
  var ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var ON = flag() === "1" || (flag() !== "0" && ios);
  var CSS = "html.anim-pause *,html.anim-pause *::before,html.anim-pause *::after{animation-play-state:paused!important}";
  function pause() {
    if (!ON) return;
    clearTimeout(offT); offT = 0;
    if (!de.classList.contains("anim-pause")) { de.classList.add("anim-pause"); n++; }
  }
  function resumeSoon() {
    if (!ON) return;
    clearTimeout(offT);
    offT = setTimeout(function () { offT = 0; de.classList.remove("anim-pause"); }, 220);
  }
  function moving() { pause(); resumeSoon(); }   // scroll: no "end" event → every scroll event pushes the end out
  if (ON) {
    var st = document.createElement("style"); st.id = "speed-css"; st.textContent = CSS; document.head.appendChild(st);
    document.addEventListener("scroll", moving, { capture: true, passive: true });
    document.addEventListener("touchmove", moving, { capture: true, passive: true });
  }
  window.SPEED = {
    init: function (api) {
      A = api; if (!ON || !api || !api.map) return;
      api.map.on("movestart zoomstart", pause);
      api.map.on("moveend zoomend", resumeSoon);
    },
    on: function () { return ON; },
    stats: function () { return { on: ON, pauses: n, paused: de.classList.contains("anim-pause") }; }
  };
})();
