/* Öl Nu — ÖLGLASET (owner: "skakar jag telefonen fylls den med öl" + "den ska bete sig som ett riktigt glas").
   Lazy file: index.html names it <script type="text/x-lazy" data-demand> (boot.js skips data-demand files); delight.js loads it
   on the first real shake, on ⚙️ "Testa ölglaset" or on a long-press of ÖL! on a phone without motion sensors.
   The ONE shake detector stays in delight.js (devicemotion): it calls OLGLAS.open() after ~3 peaks in 1 s and
   OLGLAS.peak() for each later peak (+14 % beer up to the brim 0.97, more foam, haptic tick; 6–8 shakes = full).
   A REAL GLASS seen from the side: the screen's top edge (current orientation) is the open rim, the other 3 edges are walls.
   The beer is a constant volume A; the surface is always perpendicular to gravity (deviceorientation, else
   accelerationIncludingGravity, screen.orientation aware) and its offset is solved so the beer below it = A (closed-form
   box/half-space volume + bisection, every frame). If that level stands above the lowest rim point the beer runs out there
   (weir flow ∝ head^1.5, faster with more tilt) until A = what the tipped glass can hold: a half glass needs a big tilt, a
   full one spills at ~15°, upside down empties in < 1 s. Tipping the top towards the face (screen facing down) gives the
   glass depth, so the beer runs over the top edge = drinking. Pour = bright tongue + foam lumps on the wet rim, drops
   thrown over it, streaks running to it, glugg text + optional gulp sound (🔊, default off, never when muted), gentle buzz.
   Slosh: 24-point damped spring wave pushed by tilt speed / sideways shakes; a crest that reaches the rim splashes over.
   Foam head on the tilted surface; when it stands above the rim it runs over (band + drips on that part of the rim).
   Empty (A ≈ 0 after pouring) → dalmål toast with "🍺 Logga som öl?" = a normal tap on #btn-beer (all ÖL! rules, 10-min
   limit). Nothing is logged by itself. No medals/meriter.
   No sensors (desktop): arrow keys / drag turn the simulated gravity (←→ / sideways = roll, ↑↓ / drag up = tip the top
   towards the face), S/space = shake.
   Close: ✕, hold anywhere 1 s, page hidden, 90 s idle, or the beer-type strip (OLNU_STRIP) coming up; it never opens on
   top of the strip (waits with OLNU_STRIP.after). The rAF loop stops when nothing moves. prefers-reduced-motion: no
   wave, no particle motion, the level and the pour still work. Nothing flashes (all fades ≥ 0.5 s).
   Public: window.OLGLAS = { open(opts), close(), isOpen(), peak(k), state(), closedAt(), lines, _state() (tests: A, angle,
   spill rate, capacity, visible area) }. Styles: olglas.css. */
(function () {
  "use strict";
  var SND_KEY = "olnu.og.snd";
  var PI = Math.PI, N = 24;
  var A = null;          // app api (delight passes it)
  var S = null;          // open state
  var lastClose = 0;

  /* ---------- texts ---------- */
  var LINES = {
    sv: [
      "🍺 Skål! Den gick ner som en dalahäst i nyförsnö.",
      "🍺 Tomt! Hä gick fortare än Vasaloppets första backe.",
      "🍺 Glaset ä tomt. Uppdraget utfört, korpral.",
      "🍺 Dä va gött, dä. Int' en droppe kvar.",
      "🍺 Skål! Väsman blev just lite lägre.",
      "🍺 Ner i ett svep. Mora-Nisse hade varit stolt.",
      "🍺 Målet neutraliserat. Glaset säkrat. Inga förluster.",
      "🍺 Hä rann ner som Dalälven i maj.",
      "🍺 Skål! Telefonen ä nu nykter igen. Det ä int' du.",
      "🍺 Tomt som Ludvika torg en tisdag i februari.",
      "🍺 Kurbitsen dansar. Glaset ä tomt.",
      "🍺 Glugg glugg – klart! Snyggt jobbat, menig.",
      "🍺 Hä va int' en öl, hä va en operation. Lyckad.",
      "🍺 Skål! Det där va ren dalakraft.",
      "🍺 Tom tank. Begär påfyllning? Skaka igen.",
      "🍺 Ner gick den, som en masugn i Grängesberg.",
      "🍺 Rapport: noll centiliter kvar. Över.",
      "🍺 Skål på dig, du dricker som en hel spelmansstämma.",
      "🍺 Den gick ner lättare än en falukorv på midsommar.",
      "🍺 Uppdrag 'Torrlägg skärmen' – slutfört.",
      "🍺 Tomt! Siljan ä avundsjuk på din klunk.",
      "🍺 Hä syntes int' ens att den fanns. Proffs.",
      "🍺 Skål! Skummet hälsar från andra sidan.",
      "🍺 Glaset ä tömt. Telefonen kräver respekt nu.",
      "🍺 Dä ä int' varje dag man dricker ur en mobil. Skål!",
      "🍺 Klunk bekräftad. Skärmen ä torr. Bra jobbat.",
      "🍺 Tomt som en fäbod i november.",
      "🍺 Skål! Den gick ner som snö från ett ladutak i mars.",
      "🍺 Ölguden nickar. Hä va snyggt drucket.",
      "🍺 Fyllt, skakat, drucket. Hela kedjan klar.",
      "🍺 Skål! Den gick ner rakare än en tall i Orsa finnmark.",
      "🍺 Hä va dä godaste du druckit ur en skärm. Garanterat.",
      "🍺 Tomt! Nästa runda kostar bara en skakning.",
      "🍺 Ner i ett andetag. Dalarnas eget specialförband."
    ],
    en: [
      "🍺 Cheers! Down like a Dala horse in fresh snow.",
      "🍺 Empty! Mission complete, corporal.",
      "🍺 Not a drop left. Smooth.",
      "🍺 Target neutralised. Glass secured.",
      "🍺 Glug glug – done. Shake for a refill.",
      "🍺 That was not a beer, that was an operation. Success.",
      "🍺 Screen is dry again. Respect.",
      "🍺 Cheers! The foam says goodbye."
    ]
  };
  var UI = {
    sv: { log: "🍺 Logga som öl?", close: "Stäng ölglaset", snd: "Ljud", hint: "Luta glaset för att hälla ut · mot munnen = drick · håll 1 s = stäng",
      hintDesk: "Dra / pilar = luta och häll · uppåt = drick · S = skaka · håll 1 s = stäng", wait: "⏳ Glaset ä tomt men ÖL!-timern int'. Vänta lite.",
      glugg: ["glugg", "glugg glugg", "GLUGG", "klunk"] },
    en: { log: "🍺 Log as a beer?", close: "Close the beer glass", snd: "Sound", hint: "Tilt the glass to pour · to your mouth = drink · hold 1 s = close",
      hintDesk: "Drag / arrows = tilt and pour · up = drink · S = shake · hold 1 s = close", wait: "⏳ The glass is empty, the ÖL! timer is not. Wait a bit.",
      glugg: ["glug", "glug glug", "GLUG", "gulp"] }
  };
  function en() { return !!(window.I18N && window.I18N.lang === "en"); }
  function ui(k) { return (en() ? UI.en : UI.sv)[k]; }
  var lastLine = -1;
  function line() {
    var l = en() ? LINES.en : LINES.sv, i = Math.floor(Math.random() * l.length);
    if (i === lastLine) i = (i + 1) % l.length;
    lastLine = i; return l[i];
  }

  /* ---------- helpers ---------- */
  function reduced() { try { return !!(window.FX && window.FX.reduced ? window.FX.reduced() : matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function buzz(p) { try { if (window.FX && window.FX.vibrate) window.FX.vibrate(p); else if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function angDiff(a, b) { var d = a - b; while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI; return d; }
  function stripUp() { try { return !!(window.OLNU_STRIP && window.OLNU_STRIP.up && window.OLNU_STRIP.up()); } catch (e) { return false; } }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function mk(tag, cls, attrs) {
    var e = document.createElement(tag); if (cls) e.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function screenAngle() {
    try { if (screen.orientation && typeof screen.orientation.angle === "number") return screen.orientation.angle; } catch (e) {}
    return typeof window.orientation === "number" ? window.orientation : 0;
  }

  /* ---------- sensors → gravity in glass coordinates ----------
     Device frame (W3C): x right, y towards the top edge, z out of the screen. With R = Rz(α)Rx(β)Ry(γ), gravity in the
     device frame is g = (cosβ·sinγ, −sinβ, −cosβ·cosγ). Glass frame: x right, y down (canvas), z INTO the phone; the
     device x/y are first turned by the screen orientation angle. In-plane part (cx, cy) gives the surface angle; the
     z part counts only when the screen faces down (tipping the top towards the face): then the glass has depth DEPTH·H
     and the beer runs to the screen wall and over the top edge = drinking. Screen facing up = a flat (2-D) glass. */
  function fromOrientation(beta, gamma) {
    var b = beta * PI / 180, g = gamma * PI / 180;
    return [Math.cos(b) * Math.sin(g), -Math.sin(b), -Math.cos(b) * Math.cos(g)];
  }
  function applyGravity(gd, src) {
    if (!S) return;
    var o = screenAngle() * PI / 180, c = Math.cos(o), s = Math.sin(o);
    var sx = gd[0] * c - gd[1] * s, sy = gd[0] * s + gd[1] * c;
    var L = Math.sqrt(sx * sx + sy * sy + gd[2] * gd[2]) || 1;
    var cx = sx / L, cy = -sy / L, cz = -gd[2] / L, m = Math.sqrt(cx * cx + cy * cy);
    S.gTilt = m;
    if (m > 0.12) S.tAng = Math.atan2(-cx, cy);            // 0 = gravity straight down on the screen
    S.tNz = cz < 0 ? cz : 0;                                // screen facing down → depth counts
    S.src = src; S.sensAt = now();
    if (Math.abs(angDiff(S.tAng, S.ang)) > 0.002 || Math.abs(S.tNz - S.nz) > 0.002) wake();
  }
  function onOrient(e) {
    if (!S || e.beta == null || e.gamma == null) return;
    S.hadOrient = true;
    applyGravity(fromOrientation(e.beta, e.gamma), "o");
  }
  function onMotion(e) {
    if (!S) return;
    var a = e.acceleration;
    if (a && a.x != null && !reduced()) { S.lat = clamp(-(a.x || 0) / 12, -1.5, 1.5); if (Math.abs(S.lat) > 0.08) wake(); }
    if (S.hadOrient && now() - S.sensAt < 400) return;   // deviceorientation wins when it works
    var g = e.accelerationIncludingGravity; if (!g || g.x == null) return;
    var ios = !!(window.U && window.U.isIOS && window.U.isIOS());
    var k = (ios ? 1 : -1) / 9.81;                       // Android reports the reaction (+9.8 up), iOS the gravity
    var lp = S.gLp || (S.gLp = [g.x * k, g.y * k, g.z * k]);   // low-pass: a shake must not throw the surface around
    lp[0] += (g.x * k - lp[0]) * 0.15; lp[1] += (g.y * k - lp[1]) * 0.15; lp[2] += (g.z * k - lp[2]) * 0.15;
    applyGravity(lp, "m");
  }

  /* ---------- physics: a real glass ----------
     Box [0,W]×[0,H]×[0,D] (D = 0 while the screen faces up). Gravity unit n. Beer = {p : n·p ≥ s}, volume fraction A.
     Fraction of the box with n·p ≤ t is the CDF of a sum of 3 uniforms (widths a=|nx|W, b=|ny|H, c=|nz|D), closed form.
     Solve s for A by bisection. The open rim is the top face y = 0; its highest n·p ("crest") is max(0, nx·W) (z = 0,
     the screen wall, because nz ≤ 0). capacity = fraction above the crest. A > capacity → the beer stands above the rim
     by head = crest − s (px along gravity) and runs out like a weir: dA/dt ∝ head^1.5, never below the capacity. */
  var DEPTH = 1.5, EPS = 0.05;
  function cub(x) { return x > 0 ? x * x * x : 0; }
  function cdf3(u, a, b, c) {
    if (u <= 0) return 0;
    if (u >= a + b + c) return 1;
    var v = cub(u) - cub(u - a) - cub(u - b) - cub(u - c) + cub(u - a - b) + cub(u - a - c) + cub(u - b - c) - cub(u - a - b - c);
    return clamp(v / (6 * a * b * c), 0, 1);
  }
  function solve() {
    var s = S, W = s.W, H = s.H; if (!W || !H) return null;
    var D = DEPTH * H, nz = s.nz, m2 = Math.sqrt(Math.max(0, 1 - nz * nz));
    var nx = -Math.sin(s.ang) * m2, ny = Math.cos(s.ang) * m2;
    var a = Math.max(EPS, Math.abs(nx) * W), b = Math.max(EPS, Math.abs(ny) * H), c = Math.max(EPS, Math.abs(nz) * D);
    var m0 = Math.min(0, nx * W) + Math.min(0, ny * H) + Math.min(0, nz * D), tot = a + b + c;
    var above = function (t) { return 1 - cdf3(t - m0, a, b, c); };
    var A = clamp(s.A, 0, 1), lo = m0, hi = m0 + tot, sv;
    if (A <= 0) sv = hi; else if (A >= 1) sv = lo;
    else { for (var i = 0; i < 34; i++) { var md = (lo + hi) / 2; if (above(md) > A) lo = md; else hi = md; } sv = (lo + hi) / 2; }
    var crest = Math.max(0, nx * W), cap = above(crest), head = crest - sv;
    var mm = Math.max(m2, 0.02), ux = nx / mm, uy = ny / mm, s2 = sv / mm;      // screen wall: ux·x + uy·y ≥ s2
    // wet part of the rim (top edge, screen wall) = where the beer leaves the glass
    var r0 = 1, r1 = 0;
    if (Math.abs(nx) < 1e-4) { if (sv <= 0) { r0 = 0; r1 = W; } }
    else if (nx > 0) { r0 = clamp(sv / nx, 0, W); r1 = W; if (sv / nx > W) r0 = 1, r1 = 0; }
    else { r0 = 0; r1 = clamp(sv / nx, 0, W); if (sv / nx < 0) r0 = 1, r1 = 0; }
    var P = { nx: nx, ny: ny, nz: nz, m2: m2, ux: ux, uy: uy, s: sv, s2: s2, crest: crest, cap: cap, head: head,
      margin: (sv - crest) / mm, sy: s2 - (ux * W / 2 + uy * H / 2), r0: r0, r1: r1,
      cosT: ny, axis: Math.acos(clamp(ny, -1, 1)) };
    s.P = P;
    return P;
  }
  // visible beer area on the screen (polygon clip of the screen rectangle), a fraction of W·H
  function screenArea(P) {
    var W = S.W, H = S.H, pts = [[0, 0], [W, 0], [W, H], [0, H]], out = [];
    var f = function (p) { return P.ux * p[0] + P.uy * p[1] - P.s2; };
    for (var i = 0; i < 4; i++) {
      var p = pts[i], q = pts[(i + 1) % 4], fp = f(p), fq = f(q);
      if (fp >= 0) out.push(p);
      if ((fp >= 0) !== (fq >= 0)) { var t = fp / (fp - fq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
    }
    var ar = 0;
    for (var j = 0; j < out.length; j++) { var u = out[j], v = out[(j + 1) % out.length]; ar += u[0] * v[1] - v[0] * u[1]; }
    return Math.abs(ar) / 2 / (W * H);
  }

  /* ---------- open / close ---------- */
  function open(opts) {
    opts = opts || {};
    if (opts.api) A = opts.api;
    if (S) { if (opts.level) peak(1); return true; }
    if (document.hidden) return false;
    if (stripUp()) { try { window.OLNU_STRIP.after(function () { open(opts); }); } catch (e) {} return false; }
    var red = reduced();
    var root = mk("div", "og" + (red ? " og-red" : ""), { role: "dialog", "aria-label": en() ? "Beer glass" : "Ölglaset" });
    var cv = mk("canvas", "og-cv", { "aria-hidden": "true" });
    var x = mk("button", "og-x", { type: "button", "aria-label": ui("close") }); x.textContent = "✕";
    var snd = mk("button", "og-snd", { type: "button", "aria-pressed": String(sndOn()), "aria-label": ui("snd") });
    var hint = mk("div", "og-hint"); hint.textContent = (window.matchMedia && matchMedia("(pointer: fine)").matches) ? ui("hintDesk") : ui("hint");
    var hold = mk("div", "og-hold", { "aria-hidden": "true" });
    root.appendChild(cv); root.appendChild(hold); root.appendChild(hint); root.appendChild(snd); root.appendChild(x);
    document.body.appendChild(root);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var lv = clamp(opts.level != null ? opts.level : 0.42, 0.05, AMAX);
    S = { root: root, cv: cv, c2: cv.getContext("2d"), dpr: dpr, W: 0, H: 0, red: red,
      A: red ? lv : 0, pend: red ? 0 : lv, foam: 0.5, foamT: 0.5,
      ang: 0, tAng: 0, nz: 0, tNz: 0, gTilt: 1, simB: 90, simG: 0, lat: 0, rate: 0, P: null,
      h: new Float32Array(N), v: new Float32Array(N), bubbles: [], parts: [], drips: [], over: 0,
      raf: 0, last: 0, quietAt: now(), touchAt: now(), drank: 0, gluggAt: 0, buzzAt: 0, sensAt: 0, hadOrient: false, src: "",
      holdT: null, drag: null };
    try { S.font = (getComputedStyle(document.documentElement).getPropertyValue("--display") || "").trim() || "Impact, sans-serif"; } catch (e) { S.font = "Impact, sans-serif"; }
    S.x = x; S.snd = snd; S.hint = hint; S.holdEl = hold;
    setSnd();
    size();
    for (var i = 0; i < (red ? 0 : 26); i++) addBubble(true);
    x.addEventListener("click", function (e) { e.stopPropagation(); close("x"); });
    snd.addEventListener("click", function (e) { e.stopPropagation(); lsSet(SND_KEY, sndOn() ? "0" : "1"); setSnd(); if (sndOn()) audio(true); });
    root.addEventListener("pointerdown", pDown);
    root.addEventListener("pointermove", pMove);
    root.addEventListener("pointerup", pUp);
    root.addEventListener("pointercancel", pUp);
    root.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    window.addEventListener("deviceorientation", onOrient, { passive: true });
    window.addEventListener("devicemotion", onMotion, { passive: true });
    window.addEventListener("resize", size);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("visibilitychange", onVis);
    setTimeout(function () { if (S && S.hint) S.hint.classList.add("og-hint-off"); }, 4500);
    S.watch = setInterval(function () { if (S && stripUp()) close("strip"); }, 400);   // the loop may sleep: never stay over the strip
    buzz(18);
    wake();
    return true;
  }
  function close(why) {
    if (!S) return;
    var s = S; S = null; lastClose = Date.now();
    if (s.raf) cancelAnimationFrame(s.raf);
    if (s.holdT) clearTimeout(s.holdT);
    if (s.watch) clearInterval(s.watch);
    window.removeEventListener("deviceorientation", onOrient);
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("resize", size);
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("visibilitychange", onVis);
    // release the canvas memory now (Samsung): a 0×0 backing store, then drop every reference
    try { s.cv.width = 0; s.cv.height = 0; } catch (e) {}
    s.c2 = null; s.bubbles = s.parts = s.drips = null;
    s.root.classList.add("og-out");
    setTimeout(function () { try { s.root.remove(); } catch (e) {} s.root = s.cv = null; }, s.red ? 0 : 260);
    if (why === "empty") emptyToast();
    try { document.dispatchEvent(new CustomEvent("olglas:close", { detail: { why: why || "" } })); } catch (e) {}
  }
  function onVis() { if (document.hidden) close("hidden"); }
  function size() {
    if (!S) return;
    var W = window.innerWidth, H = window.innerHeight;
    S.W = W; S.H = H;
    S.cv.width = Math.round(W * S.dpr); S.cv.height = Math.round(H * S.dpr);
    S.cv.style.width = W + "px"; S.cv.style.height = H + "px";
    solve(); wake(); draw();
  }

  /* ---------- input ---------- */
  var AMAX = 0.97, PEAK = 0.14;
  function peak(k) {
    if (!S) return;
    k = k || 1;
    var add = Math.max(0, Math.min(PEAK * k, AMAX - S.A - S.pend));
    if (S.red) S.A += add; else S.pend += add;
    S.foamT = clamp(S.foamT + 0.24 * k + (add < PEAK * k * 0.5 ? 0.25 : 0), 0, 2.4);   // full glass: the head grows and runs over
    buzz(12);
    if (!S.red) {
      for (var i = 0; i < N; i++) S.v[i] += (Math.random() - 0.5) * 9 * k;
      for (var j = 0; j < 14; j++) addBubble(false);
    }
    S.touchAt = now();
    wake();
  }
  function pDown(e) {
    if (!S || e.target === S.x || e.target === S.snd) return;
    S.drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, g0: S.simG, b0: S.simB };
    try { S.root.setPointerCapture(e.pointerId); } catch (x) {}
    S.holdEl.classList.add("og-holding");
    S.holdT = setTimeout(function () { if (S && S.drag && !S.drag.moved) close("hold"); }, 1000);
  }
  function pMove(e) {
    if (!S || !S.drag || e.pointerId !== S.drag.id) return;
    var dx = e.clientX - S.drag.x, dy = S.drag.y - e.clientY;
    if (!S.drag.moved && Math.abs(dx) + Math.abs(dy) > 14) { S.drag.moved = true; cancelHold(); }
    if (!S.drag.moved) return;
    // drag = turn the simulated gravity: sideways = roll in the screen plane, up = tip the top towards the face (drink)
    if (!fresh()) { S.simG = clamp(S.drag.g0 + dx / 3, -180, 180); S.simB = clamp(S.drag.b0 + Math.max(0, dy - 20) * 0.38, -10, 270); simApply(); }
    S.touchAt = now(); wake();
  }
  function pUp() {
    if (!S) return;
    cancelHold(); S.drag = null; wake();
  }
  function cancelHold() { if (!S) return; if (S.holdT) { clearTimeout(S.holdT); S.holdT = null; } S.holdEl.classList.remove("og-holding"); }
  function onKey(e) {
    if (!S) return;
    var k = e.key, used = true;
    if (k === "Escape") close("esc");
    else if (k === "ArrowLeft") S.simG = clamp(S.simG - 10, -180, 180);
    else if (k === "ArrowRight") S.simG = clamp(S.simG + 10, -180, 180);
    else if (k === "ArrowUp") S.simB = clamp(S.simB + 12, -10, 270);
    else if (k === "ArrowDown") S.simB = clamp(S.simB - 12, -10, 270);
    else if (k === "s" || k === "S" || k === " ") peak(1);
    else used = false;
    if (!used) return;
    e.preventDefault(); e.stopPropagation();
    if (S && /^Arrow/.test(k)) { S.touchAt = now(); simApply(); }
  }
  function fresh() { return S && S.sensAt && now() - S.sensAt < 600 && S.src !== "sim"; }
  // Mouse / keyboard = the same maths as a real phone. simB = pitch (90 = upright, > 90 = top towards the face,
  // 180 = face down, 270 = upside down), simG = roll in the screen plane (degrees, + = right side down).
  function simApply() {
    if (!S) return;
    var b = S.simB * PI / 180, r = S.simG * PI / 180;
    applyGravity([Math.sin(b) * Math.sin(r), -Math.sin(b) * Math.cos(r), -Math.cos(b)], "sim");
  }

  /* ---------- particles ---------- */
  function addBubble(any) {
    if (!S || S.bubbles.length > 90) return;
    // in the rotated frame: x across, y below the surface
    S.bubbles.push({ x: (Math.random() - 0.5) * 1.1, d: any ? Math.random() : 0.85 + Math.random() * 0.25, r: 1 + Math.random() * 2.6,
      sp: 0.16 + Math.random() * 0.22, w: Math.random() * 6.28 });
  }
  function addGlugg() {
    if (!S || S.red && S.parts.length) return;
    var g = ui("glugg"), P = S.P, x = P && P.r1 > P.r0 ? (P.r0 + P.r1) / 2 : S.W / 2;
    S.parts.push({ t: g[Math.floor(Math.random() * g.length)], x: clamp(x + (Math.random() - 0.5) * 80, 60, S.W - 60), y: 80 + Math.random() * 60,
      a: 0, life: 0, max: 1.1 + Math.random() * 0.4, rot: (Math.random() - 0.5) * 0.4, sz: 22 + Math.random() * 14, kind: "t" });
  }
  // the pour: drops thrown over the rim, streaks running to the rim, foam lumps on the lip
  function addPour(P, rate, dt) {
    var s = S, W = s.W, gx = -Math.sin(s.ang), gy = Math.cos(s.ang);
    if (s.parts.length > 220) return;
    var n = Math.min(10, rate * dt * 700 + (Math.random() < rate * dt * 300 ? 1 : 0));
    var span = Math.max(14, P.r1 - P.r0), v0 = 140 + 260 * Math.sqrt(Math.max(0, P.head) / 120);
    for (var i = 0; i < n; i++) {
      var x = clamp(P.r0 + Math.random() * span, 0, W);
      var side = P.nx > 0.05 ? 1 : P.nx < -0.05 ? -1 : 0;
      // most drops fly out over the lip; some splash back inwards so the spray shows on the screen
      var back = Math.random() < 0.45 ? -1 : 1;
      s.parts.push({ kind: "d", x: x, y: 4 + Math.random() * 18, vx: (side || (Math.random() < 0.5 ? -1 : 1)) * back * v0 * (0.15 + Math.random() * 0.5) + (Math.random() - 0.5) * 80,
        vy: back > 0 ? -v0 * (0.4 + Math.random() * 0.6) : v0 * (0.1 + Math.random() * 0.4), gx: gx, gy: gy, life: 0, max: 0.5 + Math.random() * 0.5, r: 2.5 + Math.random() * 5 });
    }
    // streaks: inside the beer, just under the surface, running along it to the rim
    var ns = Math.min(4, rate * dt * 260 + (Math.random() < 0.3 ? 1 : 0));
    var px = (P.r0 + P.r1) / 2, tx = -P.uy, ty = P.ux;                // along the surface
    var dir = (tx * (W / 2 - px) + ty * (S.H / 2)) > 0 ? 1 : -1;      // tangent pointing from the rim into the glass
    for (var j = 0; j < ns; j++) {
      var k = 30 + Math.random() * 220, dep = 6 + Math.random() * 46;
      var sx = px + tx * dir * k + P.ux * dep, sy = 0 + ty * dir * k + P.uy * dep;
      // put the start on the surface line: project onto ux·x + uy·y = s2 + dep
      var off = P.ux * sx + P.uy * sy - (P.s2 + dep); sx -= P.ux * off; sy -= P.uy * off;
      s.parts.push({ kind: "s", x: sx, y: sy, tx: px, ty: 0, life: 0, max: 0.45 + Math.random() * 0.35, len: 10 + Math.random() * 16 });
    }
  }

  /* ---------- sound (optional, default off) ---------- */
  var actx = null;
  function sndOn() { return lsGet(SND_KEY) === "1" && !(window.FX && window.FX.muted && window.FX.muted()); }
  function setSnd() { if (!S) return; var on = sndOn(); S.snd.textContent = on ? "🔊" : "🔇"; S.snd.setAttribute("aria-pressed", String(on)); }
  function audio(make) {
    try {
      if (!actx && make) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
      if (actx && actx.state === "suspended" && actx.resume) actx.resume().catch(function () {});
    } catch (e) { actx = null; }
    return actx && actx.state === "running" ? actx : null;
  }
  function gulp() {
    if (!sndOn()) return;
    var c = audio(false); if (!c) return;
    try {
      var t = c.currentTime, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = "sine"; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.16);
      f.type = "lowpass"; f.frequency.value = 600;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(f); f.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.22);
    } catch (e) {}
  }

  /* ---------- loop ---------- */
  function wake() { if (S && !S.raf) { S.last = 0; S.raf = requestAnimationFrame(frame); } }
  function frame(ts) {
    if (!S) return;
    S.raf = 0;
    if (stripUp()) { close("strip"); return; }
    var dt = S.last ? Math.min(0.05, (ts - S.last) / 1000) : 1 / 60; S.last = ts;
    var moving = step(dt);
    if (!S) return;
    draw();
    var t = now();
    if (moving) S.quietAt = t;
    if (t - S.touchAt > 90000 && t - S.sensAt > 2000) { close("idle"); return; }
    if (moving || t - S.quietAt < 250) S.raf = requestAnimationFrame(frame);
  }
  var K_FLOW = 0.9, RATE_MAX = 1.3;
  function step(dt) {
    var s = S, red = s.red, moving = false;
    // beer poured in by a shake runs in over ~0.4 s
    if (s.pend > 0) { var inn = Math.min(s.pend, dt * 1.4); s.A = Math.min(1, s.A + inn); s.pend -= inn; if (s.pend < 1e-4) s.pend = 0; moving = true; }
    var df = s.foamT - s.foam;
    if (Math.abs(df) > 0.002) { s.foam += df * Math.min(1, dt * 3); moving = true; }
    if (s.foamT > 0.45) { s.foamT = Math.max(0.45, s.foamT - dt * 0.3); moving = true; }   // the head settles slowly
    // the surface turns with gravity (a short ease = inertia; the wave below gives the slosh)
    var da = angDiff(s.tAng, s.ang), prev = s.ang;
    if (Math.abs(da) > 0.0015) { s.ang += red ? da : da * Math.min(1, dt * 9); moving = true; } else s.ang = s.tAng;
    var dz = s.tNz - s.nz;
    if (Math.abs(dz) > 0.001) { s.nz += red ? dz : dz * Math.min(1, dt * 9); moving = true; } else s.nz = s.tNz;
    var omega = angDiff(s.ang, prev) / Math.max(dt, 1e-3);
    var P = solve();
    // spill over the rim: weir flow ∝ head^1.5, faster the more the glass is tipped; never below the capacity
    s.rate = 0;
    if (P && s.A > P.cap + 1e-5 && P.head > 0.2) {
      var hn = P.head / (0.25 * Math.min(s.W, s.H));
      var rate = Math.min(RATE_MAX, K_FLOW * Math.pow(hn, 1.5) * (0.55 + 0.45 * Math.sin(P.axis)));
      var nA = Math.max(P.cap, s.A - rate * dt), lost = s.A - nA;
      s.A = nA; s.drank += lost; s.rate = lost / dt; moving = true; s.touchAt = now();
      s.foamT = Math.max(0.45, s.foamT - dt * 0.6);
    }
    // Last drops: when the glass is tipped so far that it holds almost nothing, the rest runs out too
    // (a real glass leaves a film, but the owner wants "drink it" to finish the beer).
    if (P && s.A > 0 && s.A < 0.08 && P.cap < 0.12 && s.drank > 0.05) {
      var r2 = Math.min(s.A, 0.22 * dt);
      s.A -= r2; s.drank += r2; s.rate = Math.max(s.rate, r2 / dt); moving = true; s.touchAt = now();
    }
    // slosh: a damped spring chain on the surface, pushed by turning speed and sideways shakes
    if (!red) {
      var e = 0, k = 60, damp = 2.6, spread = 34, lat = s.lat; s.lat *= Math.pow(0.02, dt);
      var push = clamp(omega, -6, 6) * 22 + lat * 40;
      for (var i = 0; i < N; i++) {
        var xi = i / (N - 1) - 0.5, nb = (i > 0 ? s.h[i - 1] : s.h[i]) + (i < N - 1 ? s.h[i + 1] : s.h[i]) - 2 * s.h[i];
        s.v[i] += (-k * s.h[i] - damp * s.v[i] + spread * nb + push * xi * 6) * dt;
      }
      for (var j = 0; j < N; j++) { s.h[j] += s.v[j] * dt; s.h[j] = clamp(s.h[j], -60, 60); e += Math.abs(s.h[j]) + Math.abs(s.v[j]) * 0.1; }
      if (e > 0.6) moving = true;
      // a wave crest that reaches the rim splashes over it (nearly full glass + shaking / quick tilts)
      if (P && s.A > 0.02 && P.margin > -1) {
        var wi = waveIdx(P), wh = wi >= 0 ? s.h[wi] : 0;
        if (wh > P.margin + 2) {
          var sl = Math.min(0.06, (wh - P.margin) * 0.0025) * dt * 10;
          s.A = Math.max(0, s.A - sl); s.drank += sl; s.rate = Math.max(s.rate, sl / dt); moving = true;
          if (s.splashAt == null || now() - s.splashAt > 120) { s.splashAt = now(); splash(P); }
        }
      }
      // bubbles rise (d: 0 at the surface, 1 at the bottom); a fresh shake adds more; they stop when calm
      var bs = s.bubbles;
      for (var b = bs.length - 1; b >= 0; b--) { var q = bs[b]; q.d -= q.sp * dt * (1.4 - q.d * 0.4); q.w += dt * 3; if (q.d <= 0.01) bs.splice(b, 1); }
      if (bs.length) moving = true;
      if (now() - s.touchAt < 2500 && Math.random() < dt * 6) addBubble(false);
      if (s.rate > 0.004 && P) addPour(P, s.rate, dt);
    }
    // foam over the rim: the head stands higher than the lowest rim point
    var fpx = foamPx(), fov = P && s.A > 0.02 && fpx > P.margin + 2 ? 1 : 0;
    if (red) s.over = fov; else s.over += (fov - s.over) * Math.min(1, dt * 2);
    if (!red) {
      if (s.over > 0.5 && s.drips.length < 7 && Math.random() < dt * 1.6 && P) {
        var fx = foamRim(P, fpx);
        if (fx[1] > fx[0]) s.drips.push({ x: clamp(fx[0] + Math.random() * (fx[1] - fx[0]), 8, s.W - 8), len: 0, sp: 18 + Math.random() * 30, r: 5 + Math.random() * 5 });
      }
      for (var d = s.drips.length - 1; d >= 0; d--) { var dr = s.drips[d]; dr.len += dr.sp * dt; if (dr.len > s.H * 0.22 || s.over < 0.2) s.drips.splice(d, 1); }
      if (s.drips.length || Math.abs(s.over - Math.round(s.over)) > 0.01) moving = true;
    }
    // pour feedback: gentle buzz, glugg + gulp
    if (s.rate > 0.03) {
      var t = now();
      if (s.hint && !s.hintOff) { s.hintOff = true; s.hint.classList.add("og-hint-off"); }   // never hide the pour
      if (t - s.buzzAt > 300) { s.buzzAt = t; buzz(6); }
      if (s.rate > 0.06 && t - s.gluggAt > (red ? 900 : 420)) { s.gluggAt = t; if (P && P.nz < -0.3 || P && P.r1 - P.r0 > s.W * 0.6) addGlugg(); gulp(); }
    }
    // empty
    if (s.A <= 0.012 && s.drank > 0.03 && !s.emptying) {
      s.A = 0; s.pend = 0; s.emptying = true;
      setTimeout(function () { if (S === s) close("empty"); }, red ? 50 : 450);
    }
    // particles
    var ps = s.parts;
    for (var p = ps.length - 1; p >= 0; p--) {
      var o = ps[p]; o.life += dt;
      if (o.kind === "d") { o.vx += o.gx * 1400 * dt; o.vy += o.gy * 1400 * dt; o.x += o.vx * dt; o.y += o.vy * dt; if (o.x < -20 || o.x > s.W + 20 || o.y < -20 || o.y > s.H + 20) o.life = o.max; }
      else if (o.kind === "s") { var ddx = o.tx - o.x, ddy = o.ty - o.y, dl = Math.sqrt(ddx * ddx + ddy * ddy) || 1, sp = 380 * dt; if (dl < sp) o.life = o.max; else { o.x += ddx / dl * sp; o.y += ddy / dl * sp; } }
      else if (!red) o.y -= 26 * dt;
      if (o.life >= o.max) ps.splice(p, 1);
    }
    if (ps.length) moving = true;
    return moving;
  }
  function foamPx() { return S.A > 0.02 ? 14 + 30 * S.foam : 0; }
  // the rim part the foam head covers
  function foamRim(P, fpx) {
    var t = P.s - fpx * P.m2, W = S.W;
    if (Math.abs(P.nx) < 1e-4) return t <= 0 ? [0, W] : [1, 0];
    var x = t / P.nx;
    return P.nx > 0 ? [clamp(x, 0, W), x > W ? 0 : W] : [0, x < 0 ? -1 : clamp(x, 0, W)];
  }
  // which wave point sits at the lowest rim point
  function waveIdx(P) {
    var W = S.W, H = S.H, R = Math.sqrt(W * W + H * H) / 2 + 40;
    var cx = P.nx > 1e-4 ? W : P.nx < -1e-4 ? 0 : W / 2, dx = cx - W / 2, dy = -H / 2;
    var X = dx * Math.cos(S.ang) + dy * Math.sin(S.ang);
    return clamp(Math.round((X + R) / (2 * R) * (N - 1)), 0, N - 1);
  }
  function splash(P) {
    var s = S; if (!s || s.red) return;
    var x = P.nx > 1e-4 ? s.W - 10 : P.nx < -1e-4 ? 10 : s.W * (0.2 + Math.random() * 0.6);
    for (var i = 0; i < 6; i++) s.parts.push({ kind: "d", x: x + (Math.random() - 0.5) * 30, y: 4, vx: (Math.random() - 0.5) * 220, vy: -160 - Math.random() * 200,
      gx: -Math.sin(s.ang), gy: Math.cos(s.ang), life: 0, max: 0.7, r: 2 + Math.random() * 3 });
    buzz(8);
  }

  function draw() {
    var s = S; if (!s || !s.c2) return;
    var c = s.c2, W = s.W, H = s.H, dpr = s.dpr, P = s.P || solve();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    // dim the map a little so the glass reads as a glass
    c.fillStyle = "rgba(10,8,20,0.34)"; c.fillRect(0, 0, W, H);
    var fpx = foamPx();
    var R = Math.sqrt(W * W + H * H) / 2 + 40;
    if (P && s.A > 0.001) {
      var sy = P.sy;
      c.save();
      c.translate(W / 2, H / 2); c.rotate(s.ang);
      // beer body = the screen rectangle below the surface line (the canvas edge does the clip), wavy top
      var gr = c.createLinearGradient(0, sy - 10, 0, sy + Math.max(120, H * 0.9));
      gr.addColorStop(0, "#ffd45c"); gr.addColorStop(0.18, "#f7b733"); gr.addColorStop(0.6, "#e08e17"); gr.addColorStop(1, "#b5650c");
      c.fillStyle = gr;
      c.beginPath(); c.moveTo(-R, R + Math.max(0, sy));
      for (var i = 0; i < N; i++) c.lineTo(-R + (2 * R) * i / (N - 1), sy - s.h[i]);
      c.lineTo(R, R + Math.max(0, sy)); c.closePath(); c.fill();
      // bubbles (rotated frame: up = −y)
      if (!s.red) {
        c.strokeStyle = "rgba(255,248,225,0.75)"; c.lineWidth = 1;
        var depth = Math.max(60, R - sy);
        for (var b = 0; b < s.bubbles.length; b++) {
          var q = s.bubbles[b], bx = q.x * W + Math.sin(q.w) * 2, by = sy + q.d * depth;
          if (by > R) continue;
          c.beginPath(); c.arc(bx, by, q.r, 0, 6.283); c.stroke();
        }
      } else {
        c.fillStyle = "rgba(255,248,225,0.35)";
        for (var z = 0; z < 14; z++) { c.beginPath(); c.arc(((z * 73) % 100 / 100 - 0.5) * W, sy + 30 + (z * 47 % 100) / 100 * (H * 0.5), 2, 0, 6.283); c.fill(); }
      }
      // foam head: a white band on the (tilted) surface, bumpy top following the wave
      if (fpx > 0) {
        var fg = c.createLinearGradient(0, sy - fpx, 0, sy + 6);
        fg.addColorStop(0, "#fffdf6"); fg.addColorStop(0.7, "#fff3d6"); fg.addColorStop(0.92, "#ffe6a6"); fg.addColorStop(1, "rgba(255,214,110,0.85)");
        c.fillStyle = fg;
        c.beginPath(); c.moveTo(-R, sy + 6);
        for (var f = 0; f < N; f++) c.lineTo(-R + (2 * R) * f / (N - 1), sy - s.h[f] + 6);
        for (var g = N - 1; g >= 0; g--) c.lineTo(-R + (2 * R) * g / (N - 1), sy - s.h[g] - fpx);
        c.closePath(); c.fill();
        c.fillStyle = "#fffdf6";
        for (var bx2 = -R; bx2 < R; bx2 += 26) {
          var idx = Math.round((bx2 + R) / (2 * R) * (N - 1)), r2 = 9 + ((bx2 * 7919) % 7 + 7) % 7;
          c.beginPath(); c.arc(bx2, sy - s.h[idx] - fpx + 3, r2, 0, 6.283); c.fill();
        }
      }
      c.restore();
    }
    // the pour: a bright tongue of beer on the wet part of the rim + foam lumps on the lip
    if (P && s.rate > 0.004 && P.r1 > P.r0) {
      var st = clamp(s.rate / 0.3, 0.3, 1), x0 = P.r0, x1 = P.r1, th = 12 + 30 * st;
      if (x1 - x0 < 40) { if (x1 >= W - 1) x0 = W - 40; else x1 = 40; }
      var lg = c.createLinearGradient(0, 0, 0, th * 2);
      lg.addColorStop(0, "rgba(255,226,140,0.95)"); lg.addColorStop(1, "rgba(247,183,51,0)");
      c.fillStyle = lg; c.fillRect(x0, 0, x1 - x0, th * 2);
      c.fillStyle = "rgba(255,253,246,0.92)";
      var tt = now() / 1000, n = Math.max(2, Math.round((x1 - x0) / 22));
      for (var k2 = 0; k2 <= n; k2++) {
        var fx = x0 + (x1 - x0) * k2 / n, rr = (7 + 11 * st) * (0.7 + 0.3 * Math.sin(k2 * 2.1 + (s.red ? 0 : tt * 5)));
        c.beginPath(); c.arc(fx, 2 + rr * 0.4, rr, 0, 6.283); c.fill();
      }
    }
    // foam over the rim: a white band on the covered rim part, drips run down
    if (s.over > 0.02 && P) {
      var fr = foamRim(P, fpx);
      if (fr[1] > fr[0]) {
        c.globalAlpha = Math.min(1, s.over);
        c.fillStyle = "#fffdf6";
        c.fillRect(fr[0], 0, fr[1] - fr[0], 16);
        for (var ox = fr[0]; ox < fr[1] + 15; ox += 30) { c.beginPath(); c.arc(Math.min(ox, fr[1]), 14 + (ox * 13 % 9), 14, 0, 6.283); c.fill(); }
        for (var d = 0; d < s.drips.length; d++) {
          var dr = s.drips[d];
          c.beginPath(); c.moveTo(dr.x - dr.r * 0.6, 16); c.lineTo(dr.x - dr.r * 0.6, 16 + dr.len); c.arc(dr.x, 16 + dr.len, dr.r * 0.6, PI, 0, true); c.lineTo(dr.x + dr.r * 0.6, 16); c.fill();
        }
        c.globalAlpha = 1;
      }
    }
    // particles: drops, streaks, glugg text
    for (var p = 0; p < s.parts.length; p++) {
      var o = s.parts[p], al = o.life < 0.15 ? o.life / 0.15 : 1 - (o.life - 0.15) / (o.max - 0.15);
      c.globalAlpha = clamp(al, 0, 1);
      if (o.kind === "d") {
        c.fillStyle = "#ffcf5a"; c.beginPath(); c.arc(o.x, o.y, o.r, 0, 6.283); c.fill();
        c.fillStyle = "rgba(255,255,255,0.7)"; c.beginPath(); c.arc(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.35, 0, 6.283); c.fill();
      } else if (o.kind === "s") {
        var ex = o.tx - o.x, ey = o.ty - o.y, el = Math.sqrt(ex * ex + ey * ey) || 1;
        c.strokeStyle = "rgba(255,240,190,0.85)"; c.lineWidth = 2.5; c.lineCap = "round";
        c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(o.x - ex / el * o.len, o.y - ey / el * o.len); c.stroke();
      } else {
        c.save(); c.translate(o.x, o.y); c.rotate(o.rot);
        c.font = "400 " + Math.round(o.sz) + "px " + s.font;
        c.textAlign = "center"; c.lineWidth = 4; c.strokeStyle = "rgba(59,36,18,0.85)"; c.strokeText(o.t, 0, 0);
        c.fillStyle = "#fffaf0"; c.fillText(o.t, 0, 0); c.restore();
      }
    }
    c.globalAlpha = 1;
    // glass: soft highlight on both side walls, a thin closed bottom line, the open rim marked at the top
    var hl = c.createLinearGradient(0, 0, W * 0.16, 0);
    hl.addColorStop(0, "rgba(255,255,255,0.22)"); hl.addColorStop(0.35, "rgba(255,255,255,0.07)"); hl.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = hl; c.fillRect(0, 0, W * 0.16, H);
    var hr = c.createLinearGradient(W, 0, W * 0.9, 0);
    hr.addColorStop(0, "rgba(255,255,255,0.14)"); hr.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = hr; c.fillRect(W * 0.9, 0, W * 0.1, H);
    c.fillStyle = "rgba(255,255,255,0.18)"; c.fillRect(W * 0.055, H * 0.08, 3, H * 0.62);
    c.fillStyle = "rgba(255,255,255,0.28)"; c.fillRect(0, H - 3, W, 3); c.fillRect(0, 0, 3, H); c.fillRect(W - 3, 0, 3, H);
  }

  /* ---------- empty glass → toast (+ optional real beer) ---------- */
  function emptyToast() {
    var msg = line();
    var act = { label: ui("log"), fn: function () {
      var b = document.getElementById("btn-beer");
      if (!b) return;
      if (b.disabled || b.classList.contains("cooldown")) { toast(ui("wait"), {}); return; }
      b.click();                                   // the normal ÖL! path: same rules, same 10-min limit
    } };
    toast(msg, { action: act, ms: 8000, cls: "og-toast" });
  }
  function toast(m, o) {
    try { if (A && A.toast) return A.toast(m, o); } catch (e) {}
    try { var t = document.getElementById("toasts"); if (!t) return; var d = mk("div", "toast"); d.textContent = m; t.appendChild(d); setTimeout(function () { d.remove(); }, 4000); } catch (e) {}
  }

  function dbg() {
    if (!S) return null;
    var P = S.P || solve();
    return { A: S.A, pend: S.pend, ang: S.ang, tAng: S.tAng, nz: S.nz, spill: S.rate, cap: P ? P.cap : null, head: P ? P.head : null,
      margin: P ? P.margin : null, area: P ? screenArea(P) : null, rim: P ? [P.r0, P.r1] : null, over: S.over, foam: S.foam,
      drank: S.drank, parts: S.parts.length, moving: !!S.raf, red: S.red, W: S.W, H: S.H };
  }
  window.OLGLAS = {
    open: open, close: close, peak: peak, lines: LINES,
    isOpen: function () { return !!S; },
    closedAt: function () { return lastClose; },
    state: function () {
      if (!S) return null;
      return { level: S.A, target: Math.min(1, S.A + S.pend), foam: S.foam, ang: S.ang, tAng: S.tAng, drink: S.rate,
        moving: !!S.raf, over: S.over, drank: S.drank, w: S.cv ? S.cv.width : 0, h: S.cv ? S.cv.height : 0, red: S.red };
    },
    _state: dbg
  };
})();
