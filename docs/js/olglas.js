/* Öl Nu — ÖLGLASET (owner: "skakar jag telefonen fylls den med öl, och för att få bort ölen måste jag luta telefonen och dricka den").
   Lazy file: index.html names it <script type="text/x-lazy" data-demand> (boot.js skips data-demand files); delight.js loads it
   on the first real shake, on ⚙️ "Testa ölglaset" or on a long-press of ÖL! on a phone without motion sensors.
   The ONE shake detector stays in delight.js (devicemotion): it calls OLGLAS.open() after ~3 peaks in 1 s and
   OLGLAS.peak() for each later peak (more beer + more foam, haptic tick).
   Here: a full-screen <canvas> (one per open, released on close). Beer fills from the bottom, the surface stays level with
   real gravity (deviceorientation beta/gamma → gravity in the screen plane, screen.orientation aware), a damped spring
   wave (24 points) sloshes on tilt, bubbles drift up, white foam head, foam overflow + drips when full, glass highlight.
   Drink: tip the top of the phone towards the face (pitch past vertical ≥ ~20°, i.e. beta > ~110° in portrait, screen
   facing down): the beer slides to the top edge and drains (speed = tilt), "glugg" particles, optional gulp sound (🔊 in
   the overlay, default off, never when the app is muted). Empty → dalmål toast with "🍺 Logga som öl?" = a normal tap on
   #btn-beer (all ÖL! rules, 10-min limit). Nothing is logged by itself. No medals/meriter.
   No sensors (desktop): drag up = drink, drag sideways = tilt, arrow keys = tilt (↑ = drink), S/space = shake.
   Close: ✕, hold anywhere 1 s, page hidden, 90 s idle, or the beer-type strip (OLNU_STRIP) coming up; it never opens on
   top of the strip (waits with OLNU_STRIP.after). The rAF loop stops when nothing moves. prefers-reduced-motion: no
   slosh, no bubbles/particles motion, level jumps. Nothing flashes (all fades ≥ 0.5 s).
   Public: window.OLGLAS = { open(opts), close(), isOpen(), peak(k), state(), lines }. Styles: olglas.css. */
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
    sv: { log: "🍺 Logga som öl?", close: "Stäng ölglaset", snd: "Ljud", hint: "Luta mot munnen för att dricka · håll 1 s för att stänga",
      hintDesk: "Dra uppåt = drick · ←→ = luta · S = skaka · håll 1 s = stäng", wait: "⏳ Glaset ä tomt men ÖL!-timern int'. Vänta lite.",
      glugg: ["glugg", "glugg glugg", "GLUGG", "klunk"] },
    en: { log: "🍺 Log as a beer?", close: "Close the beer glass", snd: "Sound", hint: "Tip it to your mouth to drink · hold 1 s to close",
      hintDesk: "Drag up = drink · ←→ = tilt · S = shake · hold 1 s = close", wait: "⏳ The glass is empty, the ÖL! timer is not. Wait a bit.",
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

  /* ---------- sensors → gravity on the screen ----------
     Device frame (W3C): x right, y towards the top edge, z out of the screen. With R = Rz(α)Rx(β)Ry(γ), gravity in the
     device frame is g = (cosβ·sinγ, −sinβ, −cosβ·cosγ). Canvas: x right, y down → (gx, −gy), then rotated by the screen
     orientation angle. Drink pitch: how far the screen's top edge tips past vertical towards the face (screen facing down). */
  function fromOrientation(beta, gamma) {
    var b = beta * PI / 180, g = gamma * PI / 180;
    return [Math.cos(b) * Math.sin(g), -Math.sin(b), -Math.cos(b) * Math.cos(g)];
  }
  function applyGravity(gd, src) {
    if (!S) return;
    var o = screenAngle() * PI / 180, c = Math.cos(o), s = Math.sin(o);
    // device x/y → screen x/y (the screen's "up" turns with the orientation angle)
    var sx = gd[0] * c - gd[1] * s, sy = gd[0] * s + gd[1] * c;
    var cx = sx, cy = -sy, m = Math.sqrt(cx * cx + cy * cy);
    S.gTilt = m;
    if (m > 0.2) S.tAng = Math.atan2(-cx, cy);           // 0 = gravity straight down on the screen
    // pitch past vertical: top-edge elevation e = −sy, face-up n = −gz
    var e = -sy, n = -gd[2];
    var past = Math.atan2(-n, e) * 180 / PI;             // 0 when upright, + when the screen turns down to the face
    S.drinkSensor = n < -0.05 ? clamp((past - 18) / 47, 0, 1) : 0;
    S.src = src; S.sensAt = now();
    var dd = Math.abs(S.drinkSensor - (S.lastDrink || 0)); S.lastDrink = S.drinkSensor;
    if (Math.abs(angDiff(S.tAng, S.ang)) > 0.004 || dd > 0.005 || S.drinkSensor > 0) wake();
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

  /* ---------- geometry: where is the surface? ----------
     Rotated frame: gravity = +y. The screen rectangle (corners turned by −θ around its centre) ∩ {y ≥ s} must hold
     the wanted area. Clip the polygon with the half-plane and bisect s (cheap: 4 corners, 18 steps). */
  function rotCorners(W, H, th) {
    var c = Math.cos(th), s = Math.sin(th), hw = W / 2, hh = H / 2, p = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    return p.map(function (q) { return [q[0] * c + q[1] * s, -q[0] * s + q[1] * c]; });
  }
  function areaBelow(poly, s) {
    var out = [], n = poly.length;
    for (var i = 0; i < n; i++) {
      var a = poly[i], b = poly[(i + 1) % n], ia = a[1] >= s, ib = b[1] >= s;
      if (ia) out.push(a);
      if (ia !== ib) { var t = (s - a[1]) / (b[1] - a[1]); out.push([a[0] + t * (b[0] - a[0]), s]); }
    }
    var ar = 0;
    for (var j = 0; j < out.length; j++) { var p = out[j], q = out[(j + 1) % out.length]; ar += p[0] * q[1] - q[0] * p[1]; }
    return Math.abs(ar) / 2;
  }
  function surfaceY(poly, frac, W, H) {
    var lo = Infinity, hi = -Infinity;
    poly.forEach(function (p) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); });
    var want = frac * W * H;
    if (frac <= 0) return hi; if (frac >= 1) return lo;
    for (var i = 0; i < 18; i++) { var m = (lo + hi) / 2; if (areaBelow(poly, m) > want) lo = m; else hi = m; }
    return (lo + hi) / 2;
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
    S = { root: root, cv: cv, c2: cv.getContext("2d"), dpr: dpr, W: 0, H: 0, red: red,
      level: 0, target: clamp(opts.level != null ? opts.level : 0.42, 0.05, 1), foam: 0.5, foamT: 0.5,
      ang: 0, tAng: 0, gTilt: 1, drinkSensor: 0, drinkSim: 0, drinkDrag: 0, simB: 90, simG: 0, lat: 0,
      h: new Float32Array(N), v: new Float32Array(N), bubbles: [], parts: [], drips: [], over: 0,
      raf: 0, last: 0, quietAt: now(), touchAt: now(), drank: 0, gluggAt: 0, sensAt: 0, hadOrient: false, src: "",
      holdT: null, drag: null, tick: 0 };
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
    wake(); draw();
  }

  /* ---------- input ---------- */
  function peak(k) {
    if (!S) return;
    k = k || 1;
    S.target = clamp(S.target + 0.085 * k, 0, 1);
    S.foamT = clamp(S.foamT + 0.22 * k, 0, 2.2);
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
    S.drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, g0: S.simG };
    try { S.root.setPointerCapture(e.pointerId); } catch (x) {}
    S.holdEl.classList.add("og-holding");
    S.holdT = setTimeout(function () { if (S && S.drag && !S.drag.moved) close("hold"); }, 1000);
  }
  function pMove(e) {
    if (!S || !S.drag || e.pointerId !== S.drag.id) return;
    var dx = e.clientX - S.drag.x, dy = S.drag.y - e.clientY;
    if (!S.drag.moved && Math.abs(dx) + Math.abs(dy) > 14) { S.drag.moved = true; cancelHold(); }
    if (!S.drag.moved) return;
    S.drinkDrag = clamp((dy - 30) / 220, 0, 1);
    if (!fresh()) { S.simG = clamp(S.drag.g0 + dx / 4, -75, 75); simApply(); }
    S.touchAt = now(); wake();
  }
  function pUp(e) {
    if (!S) return;
    cancelHold(); S.drag = null; S.drinkDrag = 0; wake();
  }
  function cancelHold() { if (!S) return; if (S.holdT) { clearTimeout(S.holdT); S.holdT = null; } S.holdEl.classList.remove("og-holding"); }
  function onKey(e) {
    if (!S) return;
    var k = e.key, used = true;
    if (k === "Escape") close("esc");
    else if (k === "ArrowLeft") S.simG = clamp(S.simG - 10, -80, 80);
    else if (k === "ArrowRight") S.simG = clamp(S.simG + 10, -80, 80);
    else if (k === "ArrowUp") S.simB = clamp(S.simB + 12, -10, 178);
    else if (k === "ArrowDown") S.simB = clamp(S.simB - 12, -10, 178);
    else if (k === "s" || k === "S" || k === " ") peak(1);
    else used = false;
    if (!used) return;
    e.preventDefault(); e.stopPropagation();
    if (S && /^Arrow/.test(k)) simApply();
  }
  function fresh() { return S && S.sensAt && now() - S.sensAt < 600 && S.src !== "sim"; }
  // Mouse / keyboard tilt simulation = the same maths as a real phone.
  // simB = pitch (90 = upright, > 90 = top towards the face), simG = roll in the screen plane (degrees).
  function simApply() {
    if (!S) return;
    var b = S.simB * PI / 180, r = S.simG * PI / 180;
    applyGravity([Math.sin(b) * Math.sin(r), -Math.sin(b) * Math.cos(r), -Math.cos(b)], "sim"); S.drinkSim = S.drinkSensor;
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
    var g = ui("glugg");
    S.parts.push({ t: g[Math.floor(Math.random() * g.length)], x: S.W * (0.25 + Math.random() * 0.5), y: 70 + Math.random() * 60,
      a: 0, life: 0, max: 1.1 + Math.random() * 0.4, rot: (Math.random() - 0.5) * 0.4, sz: 22 + Math.random() * 14, drop: false });
    for (var i = 0; i < 4; i++) S.parts.push({ drop: true, x: S.W * (0.2 + Math.random() * 0.6), y: 30 + Math.random() * 40,
      vx: (Math.random() - 0.5) * 50, vy: -60 - Math.random() * 80, life: 0, max: 0.9, r: 2 + Math.random() * 3 });
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
    draw();
    var t = now();
    if (moving) S.quietAt = t;
    if (t - S.touchAt > 90000 && t - S.sensAt > 2000) { close("idle"); return; }
    if (moving || t - S.quietAt < 250) S.raf = requestAnimationFrame(frame);
  }
  function step(dt) {
    var s = S, red = s.red, moving = false;
    // fill + foam ease
    var dl = s.target - s.level;
    if (Math.abs(dl) > 0.0005) { s.level += red ? dl : dl * Math.min(1, dt * 2.6); moving = true; } else s.level = s.target;
    var df = s.foamT - s.foam;
    if (Math.abs(df) > 0.002) { s.foam += df * Math.min(1, dt * 3); moving = true; }
    if (s.foamT > 0.45) { s.foamT = Math.max(0.45, s.foamT - dt * 0.3); moving = true; }   // the head settles slowly
    // drink: sensor, sim keys or a drag up; the beer slides to the top edge first
    var drink = Math.max(s.drinkSensor, s.drinkDrag, s.src === "sim" ? s.drinkSim : 0);
    var aim = s.tAng;
    if (drink > 0) { var up = aim >= 0 ? PI * 0.98 : -PI * 0.98; aim = aim + angDiff(up, aim) * Math.min(1, Math.sqrt(drink) * 1.6); }
    var da = angDiff(aim, s.ang), prev = s.ang;
    if (Math.abs(da) > 0.0015) { s.ang += red ? da : da * Math.min(1, dt * 9); moving = true; } else s.ang = aim;
    var omega = angDiff(s.ang, prev) / Math.max(dt, 1e-3);
    if (drink > 0.02 && Math.abs(s.ang) > PI * 0.55 && s.target > 0) {
      var rate = (0.06 + 0.32 * drink) * dt;
      s.target = Math.max(0, s.target - rate); s.level = Math.min(s.level, s.target + 0.02);
      s.drank += rate; s.touchAt = now(); moving = true;
      var t = now();
      if (t - s.gluggAt > (red ? 900 : 380)) { s.gluggAt = t; addGlugg(); gulp(); buzz(8); }
      if (s.target <= 0.004 && !s.emptying) { s.target = 0; s.level = 0; s.emptying = true; setTimeout(function () { if (S === s) close("empty"); }, red ? 50 : 450); }
    }
    // spring wave (several surface points, damped), excited by tilt speed + sideways acceleration
    if (!red) {
      var e = 0, k = 60, damp = 2.6, spread = 34, lat = s.lat; s.lat *= Math.pow(0.02, dt);
      var push = clamp(omega, -6, 6) * 22 + lat * 40;
      for (var i = 0; i < N; i++) {
        var xi = i / (N - 1) - 0.5, nb = (i > 0 ? s.h[i - 1] : s.h[i]) + (i < N - 1 ? s.h[i + 1] : s.h[i]) - 2 * s.h[i];
        s.v[i] += (-k * s.h[i] - damp * s.v[i] + spread * nb + push * xi * 6) * dt;
      }
      for (var j = 0; j < N; j++) { s.h[j] += s.v[j] * dt; s.h[j] = clamp(s.h[j], -60, 60); e += Math.abs(s.h[j]) + Math.abs(s.v[j]) * 0.1; }
      if (e > 0.6) moving = true;
      // bubbles rise (d: 0 at the surface, 1 at the bottom); a fresh shake adds more; they stop when calm
      var bs = s.bubbles;
      for (var b = bs.length - 1; b >= 0; b--) { var q = bs[b]; q.d -= q.sp * dt * (1.4 - q.d * 0.4); q.w += dt * 3; if (q.d <= 0.01) bs.splice(b, 1); }
      if (bs.length) moving = true;
      if (now() - s.touchAt < 2500 && Math.random() < dt * 6) addBubble(false);
      // drips (full glass overflow)
      s.over += ((s.level > 0.96 && s.foam > 0.6 ? 1 : 0) - s.over) * Math.min(1, dt * 2);
      if (s.over > 0.5 && now() - s.touchAt < 6000 && s.drips.length < 7 && Math.random() < dt * 1.4) s.drips.push({ x: 10 + Math.random() * (s.W - 20), len: 0, sp: 18 + Math.random() * 30, r: 5 + Math.random() * 5 });
      for (var d = s.drips.length - 1; d >= 0; d--) { var dr = s.drips[d]; dr.len += dr.sp * dt; if (dr.len > s.H * 0.22 || s.over < 0.2) s.drips.splice(d, 1); }
      if (s.drips.length || Math.abs(s.over - Math.round(s.over)) > 0.01) moving = true;
    } else {
      s.over = s.level > 0.96 && s.foam > 0.6 ? 1 : 0;
    }
    // glugg particles
    var ps = s.parts;
    for (var p = ps.length - 1; p >= 0; p--) {
      var o = ps[p]; o.life += dt;
      if (o.drop) { o.vy += 260 * dt; o.x += o.vx * dt; o.y += o.vy * dt; }
      else if (!red) o.y -= 26 * dt;
      if (o.life >= o.max) ps.splice(p, 1);
    }
    if (ps.length) moving = true;
    return moving;
  }

  function draw() {
    var s = S; if (!s || !s.c2) return;
    var c = s.c2, W = s.W, H = s.H, dpr = s.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    // dim the map a little so the glass reads as a glass
    c.fillStyle = "rgba(10,8,20,0.34)"; c.fillRect(0, 0, W, H);
    var vis = s.level * 0.9;                                      // beer area; the head sits on top
    var foamPx = (14 + 30 * s.foam + 50 * s.over) * (s.level > 0.02 ? 1 : 0);
    var poly = rotCorners(W, H, s.ang), sy = surfaceY(poly, vis, W, H);
    var R = Math.sqrt(W * W + H * H) / 2 + 40;
    c.save();
    c.translate(W / 2, H / 2); c.rotate(s.ang);
    if (vis > 0.001) {
      // beer body with a wavy top
      var gr = c.createLinearGradient(0, sy - 10, 0, sy + Math.max(120, H * 0.9));
      gr.addColorStop(0, "#ffd45c"); gr.addColorStop(0.18, "#f7b733"); gr.addColorStop(0.6, "#e08e17"); gr.addColorStop(1, "#b5650c");
      c.fillStyle = gr;
      c.beginPath(); c.moveTo(-R, R);
      for (var i = 0; i < N; i++) c.lineTo(-R + (2 * R) * i / (N - 1), sy - s.h[i]);
      c.lineTo(R, R); c.closePath(); c.fill();
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
      // foam head: a white band with a bumpy top that follows the wave
      if (foamPx > 0) {
        var fg = c.createLinearGradient(0, sy - foamPx, 0, sy + 6);
        fg.addColorStop(0, "#fffdf6"); fg.addColorStop(0.7, "#fff3d6"); fg.addColorStop(0.92, "#ffe6a6"); fg.addColorStop(1, "rgba(255,214,110,0.85)");
        c.fillStyle = fg;
        c.beginPath(); c.moveTo(-R, sy + 6);
        for (var f = 0; f < N; f++) c.lineTo(-R + (2 * R) * f / (N - 1), sy - s.h[f] + 6);
        for (var g = N - 1; g >= 0; g--) c.lineTo(-R + (2 * R) * g / (N - 1), sy - s.h[g] - foamPx);
        c.closePath(); c.fill();
        c.fillStyle = "#fffdf6";
        var step = 26;
        for (var bx2 = -R; bx2 < R; bx2 += step) {
          var idx = Math.round((bx2 + R) / (2 * R) * (N - 1)), r2 = 9 + ((bx2 * 7919) % 7 + 7) % 7;
          c.beginPath(); c.arc(bx2, sy - s.h[idx] - foamPx + 3, r2, 0, 6.283); c.fill();
        }
      }
    }
    c.restore();
    // overflow: foam spills over the top edge and runs down
    if (s.over > 0.02) {
      c.globalAlpha = Math.min(1, s.over);
      c.fillStyle = "#fffdf6";
      c.fillRect(0, 0, W, 16);
      for (var ox = 0; ox < W + 30; ox += 30) { c.beginPath(); c.arc(ox, 14 + (ox * 13 % 9), 14, 0, 6.283); c.fill(); }
      for (var d = 0; d < s.drips.length; d++) {
        var dr = s.drips[d];
        c.beginPath(); c.moveTo(dr.x - dr.r * 0.6, 16); c.lineTo(dr.x - dr.r * 0.6, 16 + dr.len); c.arc(dr.x, 16 + dr.len, dr.r * 0.6, PI, 0, true); c.lineTo(dr.x + dr.r * 0.6, 16); c.fill();
      }
      c.globalAlpha = 1;
    }
    // glugg text + drops
    for (var p = 0; p < s.parts.length; p++) {
      var o = s.parts[p], al = o.life < 0.25 ? o.life / 0.25 : 1 - (o.life - 0.25) / (o.max - 0.25);
      c.globalAlpha = clamp(al, 0, 1);
      if (o.drop) { c.fillStyle = "#ffcf5a"; c.beginPath(); c.arc(o.x, o.y, o.r, 0, 6.283); c.fill(); }
      else {
        c.save(); c.translate(o.x, o.y); c.rotate(o.rot);
        c.font = "400 " + Math.round(o.sz) + "px " + s.font;
        c.textAlign = "center"; c.lineWidth = 4; c.strokeStyle = "rgba(59,36,18,0.85)"; c.strokeText(o.t, 0, 0);
        c.fillStyle = "#fffaf0"; c.fillText(o.t, 0, 0); c.restore();
      }
    }
    c.globalAlpha = 1;
    // glass: soft highlight on both edges + a thin rim line
    var hl = c.createLinearGradient(0, 0, W * 0.16, 0);
    hl.addColorStop(0, "rgba(255,255,255,0.22)"); hl.addColorStop(0.35, "rgba(255,255,255,0.07)"); hl.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = hl; c.fillRect(0, 0, W * 0.16, H);
    var hr = c.createLinearGradient(W, 0, W * 0.9, 0);
    hr.addColorStop(0, "rgba(255,255,255,0.14)"); hr.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = hr; c.fillRect(W * 0.9, 0, W * 0.1, H);
    c.fillStyle = "rgba(255,255,255,0.18)"; c.fillRect(W * 0.055, H * 0.08, 3, H * 0.62);
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

  window.OLGLAS = {
    open: open, close: close, peak: peak, lines: LINES,
    isOpen: function () { return !!S; },
    closedAt: function () { return lastClose; },
    state: function () {
      if (!S) return null;
      return { level: S.level, target: S.target, foam: S.foam, ang: S.ang, tAng: S.tAng, drink: Math.max(S.drinkSensor, S.drinkDrag),
        moving: !!S.raf, over: S.over, drank: S.drank, w: S.cv ? S.cv.width : 0, h: S.cv ? S.cv.height : 0, red: S.red };
    }
  };
})();
