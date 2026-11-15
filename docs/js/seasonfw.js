/* PintsNow — FIREWORKS + NORTHERN LIGHTS (lane seasons, owner I-117: "I love the effects of the fireworks now." / "I love the
   northern lights now. Keep the northern lights"). window.PNSkyFx: scenes for the season sky canvas (js/seasonsky.js).
   Fireworks (New Year, 1 Jan 00:00 – 03:00; js/seasonclock.js map.fireworks):
   - At 00:00:00 when the app is open, or when the map opens in that window (at most once per 15 min): the map goes a little
     dark (a veil) and every burst lights it up; 30 s show with a finale, then 3 late single shells; about 45 s in all.
   - Real firework physics: a rocket rises with a tail and bursts; 60-120 stars per shell with drag + gravity, colour change,
     flicker. 5 shell types: peony, ring (+ a small heart of another colour), willow (long hanging gold tails), palm (thick
     green arms), glitter (white crackle).
   - Calm version (weak phones, PNSeason.light()): 3 shells, about 40 stars each, no long tails, no veil holes. Reduced motion:
     ONE still frame (a few open shells), cleared at the end. Pins are never covered (seasonsky.js cuts a hole at each pin).
   Northern lights (only in the tilted view, pitch 60+; dark, clear sky, Kp rule of seasonclock.js; NOAA Kp cached 3 h):
   - Green curtains with rays above the horizon line, a violet top, slow. Moves 40 s, then stands still. */
(function () {
  "use strict";
  var W = window, D = W.document, PI = Math.PI, TAU = PI * 2;
  function S() { return W.PNSeason; }
  function sky() { return W.PNSky; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function cl(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function eo(x) { x = cl(x); return 1 - Math.pow(1 - x, 2.4); }
  function mv(x0, v0, a, d, t) { return d > 0 ? x0 + (v0 - a / d) * (1 - Math.exp(-d * t)) / d + a * t / d : x0 + v0 * t + 0.5 * a * t * t; }
  var COL = { gold: "255,196,90", red: "255,80,70", pink: "255,110,190", blue: "110,180,255", green: "110,240,150", white: "245,248,255", violet: "190,130,255", silver: "220,228,240" };
  function sp(c, s) { return W.PNArt.get("spark", s, { c: COL[c] || c }); }

  /* ---------- one shell ---------- */
  // type: peony | ring | willow | palm | glitter. x, y = burst point (px); t0 = burst time (s). Returns { t0, stars, x, y, c, glowR }
  function shell(type, x, y, t0, k, light) {
    var n = Math.round((type === "palm" ? 7 : type === "willow" ? 70 : type === "ring" ? 64 : 96) * k * (light ? 0.4 : 1)), st = [], c1, c2;
    var pal = [["gold", "red"], ["pink", "violet"], ["blue", "white"], ["green", "gold"], ["white", "silver"], ["red", "gold"]][Math.floor(rnd(0, 6))];
    c1 = type === "willow" ? "gold" : type === "palm" ? "green" : type === "glitter" ? "white" : pal[0]; c2 = type === "willow" ? "gold" : type === "glitter" ? "silver" : pal[1];
    var tilt = rnd(0.35, 0.8), rot = rnd(0, PI);
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU + rnd(-0.05, 0.05), v, vx, vy, life, d = 1.6, g = 70, sz = 22, tail = 5;
      if (type === "ring") { v = 300; var cx = Math.cos(a) * v, cy = Math.sin(a) * v * tilt; vx = cx * Math.cos(rot) - cy * Math.sin(rot); vy = cx * Math.sin(rot) + cy * Math.cos(rot); life = 1.6; }
      else if (type === "willow") { v = rnd(180, 290) * Math.sqrt(rnd(0.3, 1)); vx = Math.cos(a) * v; vy = Math.sin(a) * v; d = 1.2; g = 110; life = rnd(2.8, 3.6); sz = 18; tail = light ? 3 : 9; }
      else if (type === "palm") { v = rnd(300, 350); vx = Math.cos(a) * v; vy = Math.sin(a) * v - 40; d = 1.1; g = 120; life = 2.2; sz = 32; tail = light ? 4 : 12; }
      else { v = rnd(200, 340) * (type === "glitter" ? 0.9 : 1) * Math.sqrt(rnd(0.55, 1)); vx = Math.cos(a) * v; vy = Math.sin(a) * v; life = rnd(1.5, 2.1); }
      st.push({ vx: vx, vy: vy, d: d, g: g, life: life, sz: sz, tail: light ? Math.min(tail, 3) : tail, fl: type === "glitter" ? 1 : rnd(0, 0.3), ph: rnd(0, 6) });
    }
    if (type === "ring") for (i = 0; i < Math.round(14 * k); i++) { var a2 = rnd(0, TAU), v2 = rnd(30, 70); st.push({ vx: Math.cos(a2) * v2, vy: Math.sin(a2) * v2, d: 1.6, g: 60, life: 1.3, sz: 14, tail: 2, fl: 0, ph: 0, c: pal[1] === "white" ? "pink" : "white" }); }
    return { type: type, t0: t0, x: x, y: y, st: st, c1: c1, c2: c2, glow: COL[c1] };
  }
  function drawShell(g, s, t, light) {
    var u = t - s.t0; if (u < 0) return false;
    var alive = false, A = W.PNArt;
    for (var i = 0; i < s.st.length; i++) {
      var q = s.st[i]; if (u > q.life) continue; alive = true;
      var k = u / q.life, al = (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3) * (q.fl ? 0.55 + 0.45 * Math.sin(u * 38 + q.ph * 9) : 1), col = q.c || (k < 0.45 ? s.c1 : s.c2);
      var pc = sp(col, q.sz), n = q.tail;
      for (var j = n; j >= 0; j--) { var tt = Math.max(0, u - j * 0.035); var x = s.x + mv(0, q.vx, 0, q.d, tt), y = s.y + mv(0, q.vy, q.g, q.d, tt);
        A.put(g, j ? sp(s.c2 === "gold" || s.type === "willow" ? "gold" : col, Math.max(6, q.sz * 0.6)) : pc, x, y, 0, j ? 1 - j / (n + 1) * 0.7 : 1, al * (j ? 0.5 * (1 - j / (n + 1)) : 1)); }
    }
    if (s.type === "glitter" && u > 1.0 && u < 2.0) for (i = 0; i < s.st.length; i += 3) { var q2 = s.st[i]; if (Math.sin(u * 50 + i) > 0.6) A.put(g, sp("white", 8), s.x + mv(0, q2.vx, 0, q2.d, u) + rnd(-4, 4), s.y + mv(0, q2.vy, q2.g, q2.d, u) + rnd(-4, 4), 0, 1, 0.9); }
    return alive;
  }
  function rocket(g, x0, y0, x1, y1, t, t0, t1) {
    var u = t - t0; if (u < 0 || t > t1) return;
    var k = eo(u / (t1 - t0)), A = W.PNArt;
    for (var j = 6; j >= 0; j--) { var kk = eo(Math.max(0, u - j * 0.03) / (t1 - t0)); A.put(g, sp("gold", j ? 10 : 18), x0 + (x1 - x0) * kk + Math.sin((u - j * 0.03) * 30) * 1.5, y0 + (y1 - y0) * kk, 0, 1, j ? 0.6 * (1 - j / 7) : 1); }
  }

  /* ---------- the show ---------- */
  // plan: [{ t (launch s), x, y (burst px), type, k }]
  function plan(w, h, light, tilt) {
    var P = [], T = ["peony", "ring", "willow", "palm", "glitter"], top = tilt ? 0.08 : 0.12, bot = tilt ? 0.36 : 0.48;
    var add = function (t, type, k) { P.push({ t: t, x: rnd(0.16, 0.84) * w, y: rnd(top, bot) * h, type: type || T[Math.floor(rnd(0, 5))], k: k || 1 }); };
    if (light) { add(0.2, "peony"); add(2.2, "ring"); add(4.4, "willow"); return P; }
    add(0.1, "peony", 1.2);
    for (var t = 1.2; t < 23; t += rnd(0.55, 1.25)) { add(t); if (Math.random() < 0.3) add(t + rnd(0.05, 0.3)); }
    for (t = 23.5; t < 29.5; t += rnd(0.18, 0.4)) add(t, null, 0.9);   // the finale
    add(33, "willow"); add(37.5, "ring"); add(42, "peony", 1.1);   // three late shells
    return P;
  }
  function fireworks(opt) {
    var c = sky() && sky().ctx(); if (!c) return null;
    var light = S().light(), m = glm(), tilt = !!(m && m.getPitch() > 30), P = plan(c.w, c.h, light, tilt), shells = [], dur = light ? 9 : 46;
    P.forEach(function (p) { p.t1 = p.t + rnd(1.0, 1.35); p.x0 = p.x + rnd(-40, 40); p.y0 = c.h + 10; shells.push(shell(p.type, p.x, p.y, p.t1, p.k, light)); });
    return { id: "fireworks", dur: dur, fin: 1.2, fout: 3, still: 6.5, draw: function (t, a) {
      var g = sky().ctx().g, w = sky().ctx().w, h = sky().ctx().h;
      // the veil: the map goes a little dark for the show; every young burst lights a hole in it
      if (!light) {
        g.fillStyle = "rgba(4,6,18," + (0.42 * a).toFixed(3) + ")"; g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = "destination-out";
        shells.forEach(function (s) { var u = t - s.t0; if (u < 0 || u > 1.4) return; var r = 260 * (0.5 + u), al = (1 - u / 1.4) * 0.85; var gr = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, r); gr.addColorStop(0, "rgba(0,0,0," + al + ")"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(s.x - r, s.y - r, r * 2, r * 2); });
        g.globalCompositeOperation = "source-over";
      }
      g.globalCompositeOperation = "lighter";
      shells.forEach(function (s) { var u = t - s.t0; if (u >= 0 && u < 0.5) { var r = 160 * (0.4 + u), gr = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, r); gr.addColorStop(0, "rgba(" + s.glow + "," + (0.4 * (1 - u / 0.5) * a).toFixed(3) + ")"); gr.addColorStop(1, "rgba(" + s.glow + ",0)"); g.fillStyle = gr; g.fillRect(s.x - r, s.y - r, r * 2, r * 2); } });
      P.forEach(function (p) { rocket(g, p.x0, p.y0, p.x, p.y, t, p.t, p.t1); });
      g.globalAlpha = a; shells.forEach(function (s) { drawShell(g, s, t, light); }); g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    } };
  }

  /* ---------- northern lights ---------- */
  function glm() { try { return W.BASEMAP.mapbox().getMapboxMap(); } catch (e) { return null; } }
  function horizon(m, h) { try { var y = m.transform && m.transform.horizonLineFromTop ? m.transform.horizonLineFromTop() : null; if (isFinite(y)) return y; } catch (e) {} return h * (0.42 - (m.getPitch() - 60) * 0.012); }
  function aurora() {
    var c = sky() && sky().ctx(), m = glm(); if (!c || !m) return null;
    var light = S().light(), n = light ? 50 : 130, rays = [];
    for (var i = 0; i < n; i++) rays.push({ x: i / n, h: rnd(0.6, 1), ph: rnd(0, TAU), w: rnd(0.6, 1.4) });
    return { id: "aurora", dur: 40, fin: 4, fout: 0, hold: true, still: 12, draw: function (t, a) {
      var g = sky().ctx().g, w = sky().ctx().w, h = sky().ctx().h; if (m.getPitch() < 60) return;
      // the curtains stand on the far, hazy land just under the horizon line (the top bar covers the thin sky above it)
      var hy = Math.max(horizon(m, h) + 150, h * 0.3); if (hy < 40) return;
      g.globalCompositeOperation = "lighter";
      for (var i = 0; i < rays.length; i++) {
        var r = rays[i], x = r.x * w + Math.sin(t * 0.18 + r.x * 7) * 26, wave = Math.sin(r.x * 9 + t * 0.25) * 14 + Math.sin(r.x * 23 - t * 0.4) * 6;
        var base = hy - 14 + wave, top = base - (70 + 110 * r.h) * (0.75 + 0.25 * Math.sin(t * 0.6 + r.ph)), al = (0.22 + 0.14 * Math.sin(t * 0.9 + r.ph * 2)) * a;
        if (base < 6) continue;
        var gr = g.createLinearGradient(0, base, 0, Math.max(0, top));
        gr.addColorStop(0, "rgba(90,255,160,0)"); gr.addColorStop(0.08, "rgba(90,255,160," + al.toFixed(3) + ")"); gr.addColorStop(0.55, "rgba(70,220,170," + (al * 0.6).toFixed(3) + ")"); gr.addColorStop(1, "rgba(170,110,255,0)");
        g.fillStyle = gr; g.fillRect(x - 3 * r.w, Math.max(0, top), 6 * r.w, base - Math.max(0, top));
      }
      g.globalCompositeOperation = "source-over";
    } };
  }

  /* ---------- when ---------- */
  var lastShow = 0, midT = 0, auroraOn = false;
  function maybe(s) {
    if (!sky() || !s || S().off() || !S().alive()) return;
    var now = S().clock();
    // fireworks: in the window, at most once per 15 min; and exactly at 00:00:00 if the app is open in the last minute
    if (s.map.fireworks && now - lastShow > 15 * 60e3) { lastShow = now; sky().add(fireworks()); }
    var p = s.p; if (p && p.mo === 12 && p.d === 31 && p.h === 23 && p.mi >= 58 && !midT) { var ms = 60e3 - (now % 60e3) + (p.mi === 58 ? 60e3 : 0); midT = W.setTimeout(function () { midT = 0; S().check(); }, ms + 50); }
    // northern lights: dark, clear, Kp rule; the Kp is read (cached 3 h) only on dark clear nights
    var m = glm(); if (!m) return;
    var c = m.getCenter(), dark = !(W.ALIVE && W.ALIVE._isNight) || W.ALIVE._isNight(now, c.lat, c.lng);
    if (dark && s.wx && s.wx.clear) S().loadKp();
    var ok = dark && S().auroraOK(s.kp, c.lat, s.wx) && m.getPitch() >= 60;
    if (ok && !auroraOn) { auroraOn = true; sky().add(aurora()); } else if (!ok && auroraOn) { auroraOn = false; sky().stop("aurora"); }
  }
  W.PNSkyFx = { fireworks: fireworks, aurora: aurora, _maybe: maybe, _plan: plan };
  function boot() {
    if (!S() || !sky()) return;
    S().on(maybe);
    var n = 0, t = W.setInterval(function () { var m = glm(); if (m && W.GLBARS && W.GLBARS.on && W.GLBARS.on()) { W.clearInterval(t); W.setTimeout(function () { maybe(S().now()); }, 1500); m.on("pitchend", function () { maybe(S().now()); }); } else if (++n > 120) W.clearInterval(t); }, 500);
  }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", boot); else boot();
})();
