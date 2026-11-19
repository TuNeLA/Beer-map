/* PintsNow — TILT: the tilted map view (M4; owner 15 Nov 2026, I-115 sheet 4: "we can have tilted on the map"; I-117).
   window.PNTILT. Mapbox GL only. The raster / no-WebGL fallback has no tilt and no button (no errors).
   - Way in and out: the "3D" button above Locate (bottom right, the camera buttons together; the top rail stays as it is),
     and a two-finger drag up / down (Mapbox touchPitch). No rotation (it stays off, as before).
   - Tilted = pitch PITCH. Zoomed far out (Leaflet zoom < MIN_Z) the map goes flat by itself (a tilted region view costs
     many tiles and shows nothing more) and tilts again when you zoom back in. Tap "3D" while zoomed out = zoom in to MIN_Z.
   - The choice is kept per device (localStorage olnu.map.tilt, try/catch: no storage = flat, no error).
   - Reduced motion: the camera jumps (no ease).
   - Northern lights night (js/seasonclock.js: dark, clear, Kp rule; "Levande karta" on): tilted = SKY_PITCH, a little
     more, because js/seasonfw.js draws the aurora only from pitch 60 (the far land under the sky). Other nights: PITCH.
   - Weak phone (the season "light version": < 4 cores, < 4 GB, Data Saver): while tilted, Mapbox's own 3D landmarks are
     off (the heaviest optional layer; frame times in lanes/tilt-DONE.md).
   - mbx.js asks this module for the view maths that pitch changes: bounds (4 corners, not 2), fit-to-bounds
     (cameraForBounds) and "is the map tilted" (screen-space clusters).
   - Season effects that wait for the tilted view (js/seasonmap.js, js/seasonfw.js) read the pitch themselves. */
(function () {
  "use strict";
  var W = window, D = document;
  var KEY = "olnu.map.tilt", PITCH = 50, SKY_PITCH = 62, MAXP = 65, MIN_Z = 14, EASE = 600;
  var gl = null, lm = null, mode = false, lowOff = false, userP = false;   // userP: the pitch is the user's own two-finger tilt
  var stats = { attach: 0, toggles: 0, auto: 0, gesture: 0 };

  function sv() { return !W.I18N || W.I18N.lang !== "en"; }
  function reduced() { try { return W.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function read() { try { return W.localStorage.getItem(KEY) === "1"; } catch (e) { return false; } }
  function save(v) { try { W.localStorage.setItem(KEY, v ? "1" : "0"); } catch (e) {} }
  function S() { return W.PNSeason; }
  function weak() {
    try { if (S() && S().light) return !!S().light(); } catch (e) {}
    var n = navigator.hardwareConcurrency || 8, m = navigator.deviceMemory || 8; return n < 4 || m < 4;
  }
  function skyNight(m) {   // the same rule as js/seasonfw.js maybe(): the aurora shows tonight if the map is tilted far enough
    try {
      var s = S(), now = s && s.now(); if (!now || s.off() || !s.alive()) return false;
      var c = m.getCenter(), A = W.ALIVE, dark = !(A && A._isNight) || A._isNight(s.clock(), c.lat, c.lng);
      return !!(dark && s.auroraOK(now.kp, c.lat, now.wx));
    } catch (e) { return false; }
  }
  function live() {   // the GL map that drives the main map right now (null = raster fallback)
    try { var b = W.BASEMAP; if (!gl || !lm || lm._gl !== gl || (b && b.isMapbox && !b.isMapbox())) return null; return gl; } catch (e) { return null; }
  }
  function lz(m) { return m.getZoom() + 1; }   // Leaflet zoom scale (the app's zoom numbers)
  function pitchOf(m) { try { return m.getPitch(); } catch (e) { return 0; } }

  /* ---------- camera ---------- */
  function ease(m, cam) {
    if (reduced()) { m.jumpTo(cam); return; }
    cam.duration = EASE; cam.essential = true; m.easeTo(cam);
  }
  function tiltTo(m) { return skyNight(m) ? SKY_PITCH : PITCH; }
  function want(m) { return mode && lz(m) >= MIN_Z - 0.01 ? tiltTo(m) : 0; }
  function heavy(m) {   // weak phone + tilted: Mapbox's 3D landmarks off; back on when flat
    var off = weak() && pitchOf(m) > 5;
    if (off === lowOff) return;
    lowOff = off;
    try { m.setConfigProperty("basemap", "show3dLandmarks", !off); } catch (e) {}
  }
  function onZoomEnd() {
    var m = live(); if (!m || !mode) return;
    var p = pitchOf(m), w = want(m);
    if (w === 0 && p > 1) { stats.auto++; userP = false; ease(m, { pitch: 0 }); }
    else if (w > 0 && p < 1) { stats.auto++; ease(m, { pitch: w }); }
  }
  function onMoveEnd() {   // a jump (setView / flyTo of another module) can stop the tilt ease half way: finish it
    var m = live(); if (!m || !mode || userP || m.isMoving()) return;
    var w = want(m); if (Math.abs(pitchOf(m) - w) > 1) { stats.auto++; ease(m, { pitch: w }); }
  }
  function onPitchEnd(e) {
    var m = live(); if (!m) return;
    heavy(m);
    if (e && e.originalEvent) {   // the user's two-finger tilt: that is the choice now
      var on = pitchOf(m) > 15;
      stats.gesture++; userP = on;
      if (on !== mode) { mode = on; save(on); }
    }
    paint();
  }
  function onSeason() {   // the Kp / weather came in: a northern lights night tilts a little more (and back)
    var m = live(); if (!m || !mode || m.isMoving()) return;
    var p = pitchOf(m), w = want(m);
    if (w > 0 && (Math.abs(p - PITCH) < 1 || Math.abs(p - SKY_PITCH) < 1) && Math.abs(p - w) >= 1) ease(m, { pitch: w });
  }
  function set(on) {
    mode = !!on; save(mode); stats.toggles++; userP = false;
    var m = live();
    if (m) {
      var cam = { pitch: mode ? tiltTo(m) : 0 };
      if (mode && lz(m) < MIN_Z) cam.zoom = MIN_Z - 1;
      ease(m, cam);
    }
    paint();
    return mode;
  }

  /* ---------- the button ---------- */
  function btn() {
    var b = D.getElementById("pn-tilt"); if (b) return b;
    if (!D.body) return null;
    b = D.createElement("button"); b.type = "button"; b.id = "pn-tilt"; b.className = "pn-rail pn-tilt"; b.hidden = true;
    b.innerHTML = '<span class="pt-3d" aria-hidden="true">3D</span>';
    b.addEventListener("click", function (e) { e.stopPropagation(); set(!mode); });
    var loc = D.getElementById("btn-locate");
    // AFTER Locate: the top rail buttons stay first in the page order (tests and pnikv.js read "the first .pn-rail" as the rail)
    if (loc && loc.parentNode) loc.parentNode.insertBefore(b, loc.nextSibling); else D.body.appendChild(b);
    return b;
  }
  function paint() {
    var b = btn(); if (!b) return;
    var m = live();
    b.hidden = !m;
    b.setAttribute("aria-pressed", mode ? "true" : "false");
    var l = sv() ? (mode ? "Lutad karta (3D): på. Tryck för platt karta." : "Lutad karta (3D): av. Tryck för att luta kartan.")
      : (mode ? "Tilted map (3D): on. Tap for a flat map." : "Tilted map (3D): off. Tap to tilt the map.");
    b.setAttribute("aria-label", l); b.title = sv() ? "Lutad karta (3D)" : "Tilted map (3D)";
    D.documentElement.toggleAttribute("data-pn-tilt", !!(m && pitchOf(m) > 5));
  }

  /* ---------- attach (mbx.js _attachGL calls this; again after a parked fallback) ---------- */
  function attach(m, L) {
    if (!m || !m.setMaxPitch) return;
    gl = m; lm = L || (W.MBX && W.MBX.main) || null; stats.attach++;
    try { m.setMaxPitch(MAXP); } catch (e) {}
    try { if (m.touchPitch) m.touchPitch.enable(); } catch (e) {}
    if (!m._pnTilt) {
      m._pnTilt = true;
      try { if (S() && S().on) S().on(onSeason); } catch (e) {}
      m.on("zoomend", onZoomEnd);
      m.on("pitchend", onPitchEnd);
      m.on("moveend", function () { setTimeout(onMoveEnd, 0); });
      m.on("style.load", function () { lowOff = false; setTimeout(function () { var q = live(); if (q) heavy(q); }, 0); });   // basemap.js sets the config again
    }
    mode = read();
    var w = want(m);
    if (Math.abs(pitchOf(m) - w) > 0.5) { try { m.jumpTo({ pitch: w }); } catch (e) {} }
    heavy(m);
    paint();
  }
  function detach() { paint(); }

  /* ---------- view maths for mbx.js (only when tilted; flat = null = mbx's own maths) ---------- */
  function pitched(L) { var m = L && L._gl; return !!(m && pitchOf(m) > 1); }
  function bounds(L) {   // the 4 screen corners (a tilted view is a trapezoid: the far edge is wider)
    if (!pitched(L)) return null;
    try { var b = L._gl.getBounds(); return W.L.latLngBounds([b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]); } catch (e) { return null; }
  }
  function boundsView(L, b, pd, o) {   // fitBounds / flyToBounds: Mapbox's own camera maths knows the pitch
    if (!pitched(L)) return null;
    try {
      var m = L._gl, opt = { padding: { top: pd.top, bottom: pd.bottom, left: pd.left, right: pd.right }, pitch: pitchOf(m) };
      if (o && o.maxZoom != null) opt.maxZoom = o.maxZoom - 1;
      var c = m.cameraForBounds([[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], opt);
      if (!c || !c.center) return null;
      var ll = W.L.latLng(c.center.lat != null ? c.center.lat : c.center[1], c.center.lng != null ? c.center.lng : c.center[0]);
      return { c: ll, z: L._clampZ(Math.floor((c.zoom + 1) * 4) / 4) };
    } catch (e) { return null; }
  }

  function boot() {
    btn();
    var L = W.MBX && W.MBX.main;
    if (L && L._gl) attach(L._gl, L); else paint();
    D.addEventListener("basemap:change", function () { setTimeout(paint, 0); });
  }
  W.PNTILT = { attach: attach, detach: detach, on: function () { return mode; }, set: set, toggle: function () { return set(!mode); },
    pitched: pitched, bounds: bounds, boundsView: boundsView, stats: stats, PITCH: PITCH, SKY_PITCH: SKY_PITCH, MAXP: MAXP, MIN_Z: MIN_Z,
    _weak: weak, _sky: function () { var m = live(); return !!(m && skyNight(m)); }, _season: onSeason };
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", boot); else boot();
  if (W.PN && W.PN.mod) W.PN.mod("PNTILT");
})();
