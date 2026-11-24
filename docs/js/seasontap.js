/* PintsNow — SEASON TAP EFFECTS (lane seasons, owner I-115 / I-117: "make the effects also go after what kind of season it
   is ... 5 different effects, so that it is a little bit different all the time"; "for normal days, you can have the effects
   on normal days as well"). window.PNTapFx.
   - js/mycount.js burst() calls PNTapFx.play(host, calm): ONE of the 5 effects of today's family (js/seasonclock.js: xmas,
     newyear, midsummer, valborg, spring = normal 5 + 3 spring, autumn, normal; snow weather adds the snowflake burst), picked by
     chance, never the same one twice in a row. A canvas inside the burst, BEHIND the number (after .pm-back): it never covers
     the number or "ikväll". 1.5 s, then the canvas is gone (every motion ends). When the number flies off (land), the canvas
     moves to <body> (z 2399, under any new burst) for the rest of its time.
   - The same joy for beer 1 and beer 7: nothing depends on the count. From 8 drinks and with reduced motion: no effect, only
     ONE tiny still season mark next to "ikväll" (calm). Store builds (OLNU_STORE): nothing (the burst is off there anyway).
   - Light version (PNSeason.light(): weak phones): half the pieces, no glow passes.
   - Kill switch: PN.CFG.tapfx === false or ?tapfx=0 → the old burst bits. ?tapfx=<id> (test builds) forces one effect,
     e.g. ?tapfx=c1 = one of the "cooler" effects c1 / c2 / c3.
   - tapmix (owner 17 Nov 20:20, A6: "Use all of them. Just random ... I want it to be different every time"): c1 golden
     shockwave, c2 liquid crown and c3 neon zip are in EVERY family (each season = its own 5 + these 3). Pick = a shuffle bag:
     every effect of the pool plays once before any one comes back, and never the same one twice in a row (also across bags
     and app starts: the last id is kept in localStorage). */
(function () {
  "use strict";
  var W = window, D = W.document, PI = Math.PI, TAU = PI * 2;
  function A() { return W.PNArt; }
  function S() { return W.PNSeason; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function cl(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function eo(x) { x = cl(x); return 1 - Math.pow(1 - x, 3); }   // ease out
  function eio(x) { x = cl(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function back(x) { x = cl(x); var c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }   // overshoot pop

  /* ---------- particles ---------- */
  // o: { p (art piece), x, y, vx, vy, ax, ay, d (drag), a, va, k0, k1, pop, t0, life, fi, fo, flip, wob, wf, orient, burst, path(t) }
  function P(o) { return Object.assign({ x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, d: 0, a: 0, va: 0, k0: 1, k1: 1, t0: 0, life: 1.3, fi: 0.05, fo: 0.3 }, o); }
  function mv(x0, v0, a, d, t) { return d > 0 ? x0 + (v0 - a / d) * (1 - Math.exp(-d * t)) / d + a * t / d : x0 + v0 * t + 0.5 * a * t * t; }
  function drawP(g, q, t, G) {
    var u = t - q.t0; if (u < 0 || u > q.life) return;
    var x, y, a, k, al = cl(u / q.fi) * (u > q.life * (1 - q.fo) ? 1 - (u - q.life * (1 - q.fo)) / (q.life * q.fo) : 1), fx = null;
    if (q.path) { var r = q.path(u); x = r[0]; y = r[1]; a = r[2] || 0; k = r[3] == null ? (q.pop ? q.k1 * back(u / q.pop) : q.k1) : r[3]; if (r[4] != null) al *= r[4]; }
    else {
      x = mv(q.x, q.vx, q.ax, q.d, u); y = mv(q.y, q.vy, q.ay, q.d, u); a = q.a + q.va * u;
      k = q.pop ? q.k1 * back(u / q.pop) : q.k0 + (q.k1 - q.k0) * cl(u / q.life);
      if (q.orient) { var vx = (q.vx - q.ax / (q.d || 1)) * Math.exp(-(q.d || 0) * u) + q.ax / (q.d || 1), vy = q.d ? (q.vy - q.ay / q.d) * Math.exp(-q.d * u) + q.ay / q.d : q.vy + q.ay * u; a = Math.atan2(vy, vx) + PI / 2; }
    }
    if (q.wob) x += Math.sin(u * q.wf * TAU + q.t0 * 7) * q.wob;
    if (q.flip) fx = Math.cos(u * q.flip + q.a);
    if (q.burst && u > q.life - q.burst) { var b = (u - (q.life - q.burst)) / q.burst; k *= 1 + 0.9 * b; }
    if (q.rect) { g.save(); g.globalAlpha = al * G; g.translate(x, y); g.rotate(a); g.scale(fx == null ? 1 : fx, 1); g.fillStyle = q.rect; g.fillRect(-q.w / 2, -q.h / 2, q.w, q.h); g.restore(); return; }
    A().put(g, q.p, x, y, a, k, al * G, fx);
  }
  // n pieces flying out from the middle (angle spread around a ring)
  function radial(n, f) { var out = []; for (var i = 0; i < n; i++) out.push(P(f(i, (i / n) * TAU + rnd(-0.18, 0.18)))); return out; }
  function glowArc(g, r, a0, a1, w, col, core, blur) {
    g.save(); g.lineCap = "round"; g.strokeStyle = col; g.lineWidth = w; g.shadowColor = col; g.shadowBlur = blur || 0;
    g.beginPath(); g.arc(0, 0, r, a0, a1); g.stroke();
    if (core) { g.shadowBlur = 0; g.strokeStyle = core; g.lineWidth = Math.max(1, w * 0.35); g.beginPath(); g.arc(0, 0, r, a0, a1); g.stroke(); }
    g.restore();
  }
  function poly(g, pts, w, col, blur, core) {
    if (pts.length < 2) return;
    g.save(); g.lineCap = g.lineJoin = "round"; g.strokeStyle = col; g.lineWidth = w; if (blur) { g.shadowColor = col; g.shadowBlur = blur; }
    g.beginPath(); pts.forEach(function (p, i) { g[i ? "lineTo" : "moveTo"](p[0], p[1]); }); g.stroke();
    if (core) { g.shadowBlur = 0; g.strokeStyle = core; g.lineWidth = Math.max(1, w * 0.35); g.stroke(); }
    g.restore();
  }
  function fadeOut(t, a, b) { return t < a ? 1 : 1 - cl((t - a) / (b - a)); }

  /* ---------- the families (sheets 5-10, audit/maplook3) ---------- */
  var G = A;   // short name inside the variants
  var V = {
    // Christmas and winter (sheet 5)
    x1: function (e) {   // snowflake burst
      return { ps: radial(Math.round(26 * e.L), function (i, a) { var sp = rnd(380, 640);
        return { p: G().get("snowflake", rnd(22, 40)), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, d: 2.6, ay: 60, va: rnd(-3, 3), pop: 0.25, k1: 1, life: rnd(1.1, 1.45), t0: (i % 3) * 0.03 }; })
        .concat(radial(Math.round(10 * e.L), function (i, a) { var sp = rnd(160, 300); return { p: G().get("twinkle", 26, { c: "170,220,255" }), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, d: 2, pop: 0.2, life: 0.9, t0: 0.12 + i * 0.03 }; })) };
    },
    x2: function (e) {   // a red ribbon goes round the number and ties a bow
      var bow = G().get("bow", 96), R0 = 116;
      return { ps: [P({ p: bow, x: 0, y: -R0 - 8, pop: 0.3, t0: 0.5, life: 1.0, fo: 0.3 })].concat(radial(Math.round(8 * e.L), function (i, a) {
        return { p: G().get("twinkle", 24), x: Math.cos(a) * R0, y: Math.sin(a) * R0, pop: 0.2, t0: 0.55 + i * 0.03, life: 0.6 }; })),
        fx: function (g, t) {
          var p = eio(t / 0.55), a0 = -PI / 2, al = fadeOut(t, 1.15, 1.5); if (al <= 0) return;
          g.save(); g.globalAlpha = al;
          glowArc(g, R0, a0, a0 + p * TAU, 17, "#b0101c", null, 0);
          glowArc(g, R0, a0, a0 + p * TAU, 11, "#e8323c", null, 0);
          glowArc(g, R0 - 2.5, a0, a0 + p * TAU, 3, "rgba(255,190,190,.85)", null, 0);
          g.restore();
        } };
    },
    x3: function (e) {   // two gold bells swing in and ring
      var bell = G().get("bell", 76), out = [];
      [-1, 1].forEach(function (s) {
        out.push(P({ p: bell, life: 1.4, fo: 0.25, path: function (u) { var k = eo(u / 0.35), sw = u > 0.3 ? 0.55 * Math.exp(-3.2 * (u - 0.3)) * Math.sin((u - 0.3) * 13) : 0;
          return [s * (240 - 135 * k), -230 + 130 * k, s * (0.5 * (1 - k)) + sw, 1]; } }));
        for (var i = 0; i < Math.round(6 * e.L); i++) out.push(P({ p: G().get("twinkle", 22), x: s * 105, y: -95, vx: s * rnd(40, 200), vy: rnd(-220, 60), d: 2, pop: 0.2, t0: 0.38 + i * 0.05, life: 0.7 }));
      });
      return { ps: out, fx: function (g, t) {   // the ring of sound
        [-1, 1].forEach(function (s) { for (var k = 0; k < 3; k++) { var u = t - 0.38 - k * 0.14; if (u < 0 || u > 0.6) continue;
          g.save(); g.globalAlpha = (1 - u / 0.6) * 0.8; g.strokeStyle = "#ffd76a"; g.lineWidth = 3; g.beginPath(); g.arc(s * 105, -88, 34 + u * 90, s > 0 ? -0.9 : PI - 0.6, s > 0 ? 0.6 : PI + 0.9); g.stroke(); g.restore(); } });
      } };
    },
    x4: function (e) {   // hearts, stars and gingerbread men pop up
      var kinds = ["ginger", "cookie", "star", "ginger", "cookie", "star", "ginger", "cookie", "ginger", "star"], n = Math.round(10 * e.L), out = [];
      for (var i = 0; i < n; i++) { var a = -PI / 2 + (i / n) * TAU + rnd(-0.15, 0.15), r = rnd(125, 165), k = kinds[i % kinds.length];
        out.push(P({ p: G().get(k, k === "star" ? 42 : 58), x: Math.cos(a) * r, y: Math.sin(a) * r * 0.92, vy: -26, a: rnd(-0.35, 0.35), va: rnd(-0.6, 0.6), pop: 0.28, t0: i * 0.055, life: 1.3 - i * 0.03, fo: 0.3 })); }
      return { ps: out };
    },
    x5: function (e) {   // a bright star flies round and leaves small stars
      var head = G().get("star", 52, { halo: "rgba(255,240,180,.8)" }), sm = G().get("star", 18), tw = G().get("twinkle", 20), out = [];
      var path = function (u) { var q = eio(u / 1.05), th = -PI * 0.85 + q * TAU * 1.08, r = 150 - 25 * q; return [Math.cos(th) * r, Math.sin(th) * r * 0.86]; };
      for (var i = 0; i < Math.round(26 * e.L); i++) { var tb = i * 0.04, p0 = path(tb);
        out.push(P({ p: i % 3 ? sm : tw, x: p0[0], y: p0[1], vy: 30, vx: rnd(-20, 20), d: 1, t0: tb, life: 0.55, pop: 0.15, va: rnd(-2, 2) })); }
      out.push(P({ p: head, life: 1.25, fo: 0.25, path: function (u) { var q = path(u); return [q[0], q[1], u * 4, 1]; } }));
      return { ps: out };
    },
    // New Year (sheet 6)
    n1: function (e) {   // three small rockets go up from the button and burst
      var out = [], cols = ["255,200,80", "255,110,190", "120,190,255"], tg = [[-125, -135], [130, -150], [0, -215]];
      tg.forEach(function (T, j) {
        var t1 = 0.42 + j * 0.08, x0 = e.bx + (j - 1) * 26, y0 = e.by - 30, sp = G().get("spark", 18, { c: cols[j] });
        out.push(P({ p: G().get("spark", 22, { c: "255,230,170" }), life: t1, fo: 0.05, t0: j * 0.08, path: function (u) { var k = eo(u / (t1 - j * 0.08)); return [x0 + (T[0] - x0) * k, y0 + (T[1] - y0) * k, 0, 1]; } }));
        for (var k = 0; k < 7; k++) { var kk = k / 7; out.push(P({ p: sp, x: x0 + (T[0] - x0) * kk, y: y0 + (T[1] - y0) * kk, t0: j * 0.08 + kk * (t1 - j * 0.08), life: 0.3, k1: 0.6, vy: 40 })); }
        out = out.concat(radial(Math.round(34 * e.L), function (i, a) { var v = rnd(150, 270);
          return { p: sp, x: T[0], y: T[1], vx: Math.cos(a) * v, vy: Math.sin(a) * v, d: 1.8, ay: 140, t0: t1, life: rnd(0.75, 1.0), fo: 0.5, k0: 1.2, k1: 0.5 }; }));
        out.push(P({ p: G().get("glow", 120, { c: "rgba(" + cols[j] + ",.7)" }), x: T[0], y: T[1], t0: t1, life: 0.35, fo: 0.8, k0: 0.6, k1: 1.4 }));
      });
      return { ps: out };
    },
    n2: function (e) {   // two cannons shoot confetti from the sides
      var out = [], cols = ["#ffd24a", "#e9edf5", "#ff6fb0", "#5fb4ff", "#ffffff", "#ffb02e"];
      [-1, 1].forEach(function (s) { for (var i = 0; i < Math.round(42 * e.L); i++) { var sp = rnd(620, 1050), a = s < 0 ? rnd(-1.25, -0.55) : PI - rnd(-1.25, -0.55);
        out.push(P({ rect: pick(cols), w: rnd(6, 9), h: rnd(10, 16), x: s * (e.w / 2 + 10), y: 70, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, d: 1.9, ay: 560, a: rnd(0, 6), va: rnd(-9, 9), flip: rnd(8, 18), t0: rnd(0, 0.12), life: rnd(1.2, 1.45), fo: 0.3 })); } });
      return { ps: out };
    },
    n3: function (e) {   // two lights run round the clock and meet at 12
      var R0 = 126, burst = radial(Math.round(16 * e.L), function (i, a) { var v = rnd(120, 260); return { p: G().get("spark", 20, { c: "255,226,140" }), x: 0, y: -R0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, d: 2, ay: 80, t0: 0.72, life: 0.7 }; });
      burst.push(P({ p: G().get("twinkle", 90), x: 0, y: -R0, t0: 0.7, pop: 0.18, life: 0.75, fo: 0.5 }));
      return { ps: burst, fx: function (g, t) {
        var al = fadeOut(t, 1.05, 1.5); if (al <= 0) return; g.save(); g.globalAlpha = al * cl(t / 0.15);
        for (var i = 0; i < 12; i++) { var a = i * TAU / 12, big = i % 3 === 0; g.strokeStyle = big ? "rgba(255,240,200,.95)" : "rgba(255,240,200,.6)"; g.lineWidth = big ? 4 : 2.5;
          g.beginPath(); g.moveTo(Math.cos(a) * (R0 - (big ? 14 : 8)), Math.sin(a) * (R0 - (big ? 14 : 8))); g.lineTo(Math.cos(a) * R0, Math.sin(a) * R0); g.stroke(); }
        var p = eio((t - 0.05) / 0.68), a0 = PI / 2;
        if (p > 0) { glowArc(g, R0 + 8, a0 - p * PI, a0, 4, "rgba(255,206,90,.95)", "#fff6dc", 10); glowArc(g, R0 + 8, a0, a0 + p * PI, 4, "rgba(255,206,90,.95)", "#fff6dc", 10);
          [-1, 1].forEach(function (s) { var a = a0 + s * p * PI; A().put(g, G().get("spark", 30, { c: "255,236,180" }), Math.cos(a) * (R0 + 8), Math.sin(a) * (R0 + 8), 0, 1, 1); }); }
        g.restore();
      } };
    },
    n4: function (e) {   // paper streamers: gold, silver, pink and blue
      var cols = [["#f2b52a", "#ffe9a8"], ["#c9d2de", "#ffffff"], ["#ff5fa8", "#ffc4df"], ["#4aa3ff", "#bfe0ff"]], n = Math.round(8 * e.L), st = [];
      for (var i = 0; i < n; i++) st.push({ a: -PI / 2 + (i / n) * TAU + rnd(-0.2, 0.2), c: cols[i % 4], f: rnd(2.2, 3.4), ph: rnd(0, 6), L: rnd(170, 230), t0: rnd(0, 0.1) });
      return { ps: [], fx: function (g, t) {
        var al = fadeOut(t, 1.0, 1.5); if (al <= 0) return; g.save(); g.globalAlpha = al;
        st.forEach(function (s) { var u = t - s.t0; if (u <= 0) return; var len = s.L * eo(u / 0.45), pts = [], c = Math.cos(s.a), sn = Math.sin(s.a);
          for (var d = 0; d <= len; d += 6) { var w = Math.sin(d / 40 * s.f + s.ph + u * 6) * 13, r = 64 + d, x = c * r - sn * w, y = sn * r + c * w + 0.5 * 380 * Math.pow(u, 2) * (d / s.L); pts.push([x, y]); }
          poly(g, pts, 6, s.c[0], 0, s.c[1]); });
        g.restore();
      } };
    },
    n5: function (e) {   // a sparkler draws a ring of light
      var R0 = 128, out = [];
      for (var i = 0; i < Math.round(46 * e.L); i++) { var tb = i * 0.018, th = -PI / 2 + eio(tb / 0.82) * TAU, a = rnd(0, TAU), v = rnd(120, 260);
        out.push(P({ p: G().get("spark", 12, { c: "255,214,120" }), x: Math.cos(th) * R0, y: Math.sin(th) * R0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, d: 3, ay: 200, t0: tb, life: 0.32, fo: 0.6, orient: false })); }
      out.push(P({ p: G().get("twinkle", 46, { c: "255,240,200" }), life: 0.95, fo: 0.15, path: function (u) { var th = -PI / 2 + eio(u / 0.82) * TAU; return [Math.cos(th) * R0, Math.sin(th) * R0, u * 9, 1]; } }));
      return { ps: out, fx: function (g, t) { var al = fadeOut(t, 1.0, 1.5); if (al <= 0) return; g.save(); g.globalAlpha = al;
        var p = eio(t / 0.82); glowArc(g, R0, -PI / 2, -PI / 2 + p * TAU, 4.5, "rgba(255,190,70,.9)", "#fff4d2", 14); g.restore(); } };
    },
    // Midsummer (sheet 7)
    m1: function (e) {   // flowers grow into a crown, one by one
      var F = [["flower", { n: 9, c: "#ffffff" }], ["flower", { n: 5, c: "#ffd21c", c2: "#ffb300", cc: "#ff9f00" }], ["flower", { n: 8, c: "#5f86ff", c2: "#3554d6", cc: "#1d2f8a", fringe: 1 }],
        ["flower", { n: 6, c: "#ff8cc0", c2: "#ff5fa8", cc: "#ffd84a" }]], n = 14, out = [];
      for (var i = 0; i < n; i++) { var a = -PI / 2 + i * TAU / n, f = F[i % 4];
        (function (a, i) {
          out.push(P({ p: G().get("leaf", 30, { c: "#7fcf4a" }), t0: i * 0.045, pop: 0.2, life: 1.45 - i * 0.045, path: function (u) { var r = a + 0.1 * (i * 0.045 + u) + TAU / n / 2; return [Math.cos(r) * 124, Math.sin(r) * 112, r + PI, null]; } }));
          out.push(P({ p: G().get(f[0], 40, f[1]), t0: i * 0.045, pop: 0.22, life: 1.45 - i * 0.045, path: function (u) { var r = a + 0.1 * (i * 0.045 + u); return [Math.cos(r) * 122, Math.sin(r) * 110, r, null]; } }));
        })(a, i);
      }
      return { ps: out };
    },
    m2: function (e) {   // three small frogs hop once
      var fr = G().get("frog", 62), out = [], L = [[-150, 30], [150, 20], [0, -170]];
      L.forEach(function (T, j) { var x0 = T[0] * 0.35, y0 = 230, t0 = j * 0.12, fl = 0.55;
        out.push(P({ p: fr, t0: t0, life: 1.35 - t0, fo: 0.25, path: function (u) { var k = cl(u / fl), h = 170 + j * 40;
          var x = x0 + (T[0] - x0) * k, y = y0 + (T[1] - y0) * k - Math.sin(k * PI) * h, sq = u > fl ? 1 + 0.18 * Math.exp(-9 * (u - fl)) * Math.cos((u - fl) * 25) : 1;
          return [x, y, (T[0] - x0) * 0.0015 * (1 - k), sq]; } }));
        for (var i = 0; i < 5; i++) out.push(P({ p: G().get("leaf", 16, { c: "#9be05a" }), x: x0, y: y0, vx: rnd(-160, 160), vy: rnd(-260, -120), ay: 500, d: 1, va: rnd(-6, 6), t0: t0, life: 0.6 }));
      });
      return { ps: out };
    },
    m3: function (e) {   // strawberries and white flowers fly out
      return { ps: radial(Math.round(18 * e.L), function (i, a) { var sp = rnd(360, 620), sb = i % 3 !== 2;
        return { p: sb ? G().get("strawberry", rnd(34, 46)) : G().get("flower", 34, { n: 9, c: "#ffffff" }), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, d: 2.3, ay: 240, va: rnd(-4, 4), a: rnd(-1, 1), pop: 0.22, t0: (i % 4) * 0.025, life: rnd(1.15, 1.4) }; }) };
    },
    m4: function (e) {   // the blue and the yellow ribbon wind round; a wreath lands on top
      var wr = G().get("wreath", 170);
      return { ps: [P({ p: wr, life: 0.95, t0: 0.5, fo: 0.35, path: function (u) { var k = eo(u / 0.3); return [0, -120 - 60 * (1 - k), 0, 1.5 - 0.5 * k + 0.06 * Math.sin(u * 20) * Math.exp(-6 * u), k]; } })],
        fx: function (g, t) { var al = fadeOut(t, 1.1, 1.5); if (al <= 0) return; g.save(); g.globalAlpha = al;
          [["#1f5fe0", "#6f9bff", 0], ["#f5c400", "#fff08a", PI]].forEach(function (c) {
            var p = eio(t / 0.6), pts = []; for (var q = 0; q <= p * 1.1; q += 0.01) { var th = -PI / 2 + c[2] + q * TAU, r = 128 + 14 * Math.sin(q * TAU * 4 + c[2]); pts.push([Math.cos(th) * r, Math.sin(th) * r * 0.9]); }
            poly(g, pts, 12, c[0], 0, c[1]); });
          g.restore(); } };
    },
    m5: function (e) {   // the sun that does not set: rays round the number
      var n = 18;
      return { ps: radial(Math.round(6 * e.L), function (i, a) { return { p: G().get("twinkle", 30, { c: "255,230,120" }), x: Math.cos(a) * 190, y: Math.sin(a) * 170, pop: 0.2, t0: 0.25 + i * 0.07, life: 0.8 }; }),
        fx: function (g, t) { var al = fadeOut(t, 1.0, 1.5) * cl(t / 0.12); if (al <= 0) return; g.save(); g.globalAlpha = al;
          g.fillStyle = A().rg(g, 0, 0, 230, [[0, "rgba(255,214,90,.55)"], [0.5, "rgba(255,180,40,.2)"], [1, "rgba(255,160,20,0)"]]); g.beginPath(); g.arc(0, 0, 230, 0, TAU); g.fill();
          g.rotate(t * 0.35);
          for (var i = 0; i < n; i++) { var a = i * TAU / n, L = (i % 2 ? 120 : 170) * eo(t / 0.4), w = i % 2 ? 0.07 : 0.1;
            g.fillStyle = A().lg(g, Math.cos(a) * 78, Math.sin(a) * 78, Math.cos(a) * (78 + L), Math.sin(a) * (78 + L), [[0, "rgba(255,236,140,.95)"], [1, "rgba(255,190,40,0)"]]);
            g.beginPath(); g.moveTo(Math.cos(a - w) * 78, Math.sin(a - w) * 78); g.lineTo(Math.cos(a) * (78 + L), Math.sin(a) * (78 + L)); g.lineTo(Math.cos(a + w) * 78, Math.sin(a + w) * 78); g.closePath(); g.fill(); }
          g.restore(); } };
    },
    // Valborg and spring (sheet 8)
    v1: function (e) {   // bonfire sparks rise on both sides
      var out = [];
      [-1, 1].forEach(function (s) {
        out.push(P({ p: G().get("glow", 150, { c: "rgba(255,130,30,.75)" }), x: s * 150, y: 175, life: 1.45, fo: 0.35, path: function (u) { return [s * 150, 175, 0, 0.9 + 0.12 * Math.sin(u * 23 + s), null]; } }));
        for (var i = 0; i < Math.round(24 * e.L); i++) out.push(P({ p: G().get("spark", rnd(10, 18), { c: i % 3 ? "255,160,50" : "255,220,120" }), x: s * rnd(120, 180), y: rnd(150, 200), vy: rnd(-330, -190), vx: rnd(-30, 30), d: 0.6, ay: -40, wob: rnd(8, 22), wf: rnd(2, 5), t0: rnd(0, 0.6), life: rnd(0.7, 1.0), fo: 0.5, k0: 1.1, k1: 0.4 }));
      });
      return { ps: out };
    },
    v2: function (e) {   // white student caps fly up
      var out = []; for (var i = 0; i < Math.round(6 * e.L); i++) out.push(P({ p: G().get("cap", rnd(54, 68)), x: rnd(-60, 60), y: 230, vx: rnd(-320, 320), vy: rnd(-1250, -980), ay: 1500, d: 0.25, va: rnd(-7, 7), flip: rnd(3, 7), t0: i * 0.06, life: 1.35 - i * 0.04, fo: 0.25 }));
      return { ps: out };
    },
    v3: function (e) {   // tussilago, crocus and scilla come up in a row
      var kinds = ["tussilago", "crocus", "scilla"], n = 9, out = [];
      for (var i = 0; i < n; i++) { var x = -152 + i * 38, h = rnd(18, 34), k = kinds[i % 3];
        (function (x, h, k, i) { out.push(P({ p: G().get(k, 38), t0: 0.12 + i * 0.05, life: 1.3 - i * 0.04, fo: 0.3, path: function (u) { var q = back(u / 0.3); return [x, 150 - h * eo(u / 0.25), Math.sin(u * 3 + i) * 0.1, q * (k === "crocus" ? 1.1 : 0.85)]; } })); })(x, h, k, i);
      }
      return { ps: out, fx: function (g, t) { var al = fadeOut(t, 1.05, 1.45); if (al <= 0) return; g.save(); g.globalAlpha = al; g.strokeStyle = "#57b03a"; g.lineWidth = 3; g.lineCap = "round";
        for (var i = 0; i < n; i++) { var u = t - 0.05 - i * 0.05; if (u <= 0) continue; var x = -152 + i * 38; g.beginPath(); g.moveTo(x, 182); g.lineTo(x, 182 - 32 * eo(u / 0.25)); g.stroke(); }
        g.restore(); } };
    },
    v4: function (e) {   // spring songs: notes float up
      var out = []; for (var i = 0; i < Math.round(11 * e.L); i++) { var s = i % 2 ? 1 : -1; out.push(P({ p: G().get("note", rnd(30, 44), { c: i % 3 ? "#ffffff" : "#fff1a8" }), x: s * rnd(110, 170), y: rnd(20, 130), vy: rnd(-230, -150), d: 0.3, wob: rnd(10, 22), wf: rnd(1.2, 2.2), a: s * 0.2, va: s * rnd(-0.6, 0.2), pop: 0.25, t0: i * 0.07, life: 1.15 - i * 0.02 })); }
      return { ps: out };
    },
    v5: function (e) {   // light green birch leaves in a whirl
      var out = []; for (var i = 0; i < Math.round(22 * e.L); i++) { var th0 = rnd(0, TAU), w = rnd(3.2, 4.4), r0 = rnd(50, 80);
        (function (th0, w, r0) { out.push(P({ p: G().get("leaf", rnd(22, 32), { c: "#b4ec5c", d: "#6cbf2c" }), t0: rnd(0, 0.2), life: 1.25, fo: 0.35, path: function (u) { var th = th0 + w * u, r = r0 + 150 * u; return [Math.cos(th) * r, Math.sin(th) * r * 0.85 - 70 * u, th * 1.6, 1]; } })); })(th0, w, r0); }
      return { ps: out.concat(radial(Math.round(5 * e.L), function (i, a) { return { p: G().get("twinkle", 22, { c: "220,255,170" }), x: Math.cos(a) * 140, y: Math.sin(a) * 120, pop: 0.2, t0: 0.3 + i * 0.08, life: 0.6 }; })) };
    },
    // Autumn (sheet 9)
    a1: function (e) {   // leaves turn round the number, then fall
      var C = [{ c: "#f07a1a" }, { c: "#d8401a", d: "#7a1a06", c0: "#ff8a4a" }, { c: "#f2b81e", d: "#a86a08", c0: "#ffe07a" }, { c: "#a8561e", d: "#5a2808", c0: "#d68a4a" }], out = [];
      for (var i = 0; i < Math.round(18 * e.L); i++) { var th0 = i / 18 * TAU, r = rnd(118, 150), sw = rnd(2.5, 4);
        (function (th0, r, sw, i) { out.push(P({ p: G().get("maple", rnd(28, 40), C[i % 4]), t0: i * 0.012, life: 1.45, fo: 0.3, path: function (u) {
          var th = th0 + 3.0 * Math.min(u, 0.7), f = Math.max(0, u - 0.7); return [Math.cos(th) * r + Math.sin(f * sw * 2) * 26 * cl(f * 3), Math.sin(th) * r * 0.9 + 0.5 * 420 * f * f, th + Math.sin(f * sw * 2) * 0.6, 1]; } })); })(th0, r, sw, i); }
      return { ps: out };
    },
    a2: function (e) {   // chanterelles and friends pop up
      var K = ["kant", "sopp", "flug", "kant", "flug"], X = [-150, -78, 0, 78, 150], out = [];
      X.forEach(function (x, i) { out.push(P({ p: G().get("mushroom", i === 2 ? 64 : 52, { kind: K[i] }), t0: 0.08 + i * 0.07, life: 1.35 - i * 0.05, fo: 0.3, path: function (u) { var q = back(u / 0.3); return [x, 150 - (i === 2 ? 6 : 0), Math.sin(u * 9) * 0.08 * Math.exp(-3 * u), q]; } })); });
      return { ps: out, fx: function (g, t) { var al = fadeOut(t, 1.05, 1.45) * cl(t / 0.2); if (al <= 0) return; g.save(); g.globalAlpha = al * 0.85;
        g.fillStyle = A().rg(g, 0, 178, 210, [[0, "rgba(90,150,60,.75)"], [1, "rgba(60,110,40,0)"]]); g.beginPath(); g.ellipse(0, 178, 210, 18, 0, 0, TAU); g.fill(); g.restore(); } };
    },
    a3: function (e) {   // warm lanterns and small lights
      var P0 = [[-150, -40], [150, -60], [-110, 110], [115, 100], [-30, -175], [60, -170]], out = [];
      P0.slice(0, Math.max(4, Math.round(6 * e.L))).forEach(function (p, i) { out.push(P({ p: G().get("lantern", 50), t0: i * 0.08, pop: 0.3, life: 1.4 - i * 0.05, fo: 0.3, path: function (u) { return [p[0], p[1] - 30 * u, Math.sin(u * 4 + i) * 0.14, null, 0.85 + 0.15 * Math.sin(u * 31 + i * 2)]; } })); });
      for (var i = 0; i < Math.round(14 * e.L); i++) out.push(P({ p: G().get("spark", 12, { c: "255,190,90" }), x: rnd(-170, 170), y: rnd(-160, 140), vy: rnd(-60, -20), wob: 8, wf: 1.5, t0: rnd(0, 0.5), life: 0.9, fo: 0.5 }));
      return { ps: out };
    },
    a4: function (e) {   // acorns and rowan berries fly out
      return { ps: radial(Math.round(15 * e.L), function (i, a) { var sp = rnd(380, 640);
        return { p: G().get(i % 2 ? "acorn" : "rowan", rnd(34, 44)), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, d: 2.0, ay: 420, va: rnd(-5, 5), a: rnd(-1, 1), pop: 0.22, t0: (i % 3) * 0.03, life: rnd(1.1, 1.4) }; }) };
    },
    a5: function (e) {   // a gust of wind takes leaves past
      var C = [{ c: "#f07a1a" }, { c: "#d8401a", d: "#7a1a06", c0: "#ff8a4a" }, { c: "#f2b81e", d: "#a86a08", c0: "#ffe07a" }], out = [], wl = [];
      for (var i = 0; i < Math.round(18 * e.L); i++) { var y0 = rnd(-200, 170), t0 = rnd(0, 0.35), sp = rnd(e.w + 120, e.w + 300), f = rnd(3, 6);
        (function (y0, sp, f) { out.push(P({ p: G().get("maple", rnd(24, 36), C[i % 3]), t0: t0, life: 1.1, fo: 0.15, path: function (u) { return [-e.w / 2 - 40 + sp * eo(u / 1.1) , y0 + Math.sin(u * f) * 30 + 40 * u, u * f * 2, 1]; } })); })(y0, sp, f); }
      for (i = 0; i < 6; i++) wl.push({ y: rnd(-190, 170), t0: rnd(0, 0.4), L: rnd(140, 240), f: rnd(0.008, 0.02) });
      return { ps: out, fx: function (g, t) { g.save(); wl.forEach(function (w) { var u = t - w.t0; if (u < 0 || u > 0.9) return; var hx = -e.w / 2 + (e.w + w.L) * eo(u / 0.9), pts = [];
        for (var x = hx - w.L; x <= hx; x += 8) pts.push([x, w.y + Math.sin(x * w.f) * 14]); g.globalAlpha = Math.sin(u / 0.9 * PI) * 0.7; poly(g, pts, 2.5, "rgba(255,255,255,.85)"); }); g.restore(); } };
    },
    // Normal days (sheet 10)
    o1: function (e) {   // foam balls fly out and pop + amber stars
      return { ps: radial(Math.round(22 * e.L), function (i, a) { var sp = rnd(380, 620); return { p: G().get("foam", rnd(18, 34)), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, d: 2.5, ay: 60, pop: 0.2, t0: (i % 3) * 0.03, life: rnd(0.9, 1.2), fo: 0.18, burst: 0.18 }; })
        .concat(radial(Math.round(8 * e.L), function (i, a) { var sp = rnd(250, 420); return { p: G().get("star", 30), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, d: 2.2, va: rnd(-3, 3), pop: 0.2, t0: 0.1 + i * 0.03, life: 1.2 }; })) };
    },
    o2: function (e) {   // amber stars, one after the other, in a ring
      var n = 12; return { ps: radial(n, function (i) { var a = -PI / 2 + i * TAU / n; return { p: G().get("star", i % 3 ? 34 : 46), x: Math.cos(a) * 130, y: Math.sin(a) * 118, a: rnd(-0.3, 0.3), va: 1.2, pop: 0.22, t0: i * 0.06, life: 1.4 - i * 0.06, fo: 0.3 }; })
        .concat(radial(Math.round(6 * e.L), function (i, a) { return { p: G().get("twinkle", 26), x: Math.cos(a) * 160, y: Math.sin(a) * 140, pop: 0.15, t0: 0.4 + i * 0.07, life: 0.5 }; })) };
    },
    o3: function (e) {   // a crown of beer drops
      var out = radial(Math.round(22 * e.L), function (i, a) { var r = 70, sp = rnd(480, 680);
        return { p: G().get("drop", rnd(22, 30)), x: Math.cos(a) * r, y: 70 + Math.sin(a) * r * 0.32, vx: Math.cos(a) * rnd(90, 200), vy: -sp, ay: 1300, d: 0.3, orient: true, t0: rnd(0, 0.06), life: rnd(0.95, 1.15), fo: 0.25 }; });
      return { ps: out, fx: function (g, t) { var al = fadeOut(t, 0.6, 1.1); if (al <= 0) return; g.save(); g.globalAlpha = al;
        var r = 70 + 150 * eo(t / 0.9); g.strokeStyle = "rgba(255,184,58,.9)"; g.lineWidth = 7 * (1 - t / 1.2); g.shadowColor = "rgba(255,160,30,.8)"; g.shadowBlur = 10;
        g.beginPath(); g.ellipse(0, 72, r, r * 0.3, 0, 0, TAU); g.stroke(); g.restore(); } };
    },
    o4: function (e) {   // bubbles rise from the button
      var out = []; for (var i = 0; i < Math.round(26 * e.L); i++) out.push(P({ p: G().get("bubble", rnd(18, 34)), x: e.bx + rnd(-45, 45), y: e.by - 40, vy: rnd(-760, -460), d: 0.9, ay: -60, wob: rnd(6, 16), wf: rnd(1.5, 3), k0: 0.4, k1: 1.15, t0: rnd(0, 0.45), life: rnd(0.9, 1.15), fo: 0.12, burst: 0.12 }));
      return { ps: out };
    },
    o5: function (e) {   // bottle caps flip like coins
      return { ps: radial(Math.round(12 * e.L), function (i, a) { var sp = rnd(420, 640); a = -PI / 2 + (a - PI) * 0.55;
        return { p: G().get("bottlecap", rnd(34, 44), { silver: i % 3 === 0 }), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, ay: 900, d: 1.2, flip: rnd(10, 18), a: rnd(-0.5, 0.5), va: rnd(-2, 2), pop: 0.15, t0: (i % 4) * 0.03, life: rnd(1.15, 1.4) }; }) };
    },

    /* ---------- the "cooler" ÖL! tap: 3 candidates for the owner (NOT in the random pool; ?tapfx=c1|c2|c3) ---------- */
    c1: function (e) {   // golden shockwave: a flash, two shock rings, light rays and a rain of sparks
      var out = radial(Math.round(64 * e.L), function (i, a) { var sp = rnd(650, 1150);
        return { p: G().get("spark", rnd(14, 24), { c: i % 4 ? "255,196,70" : "255,248,220" }), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, d: 2.4, ay: 520, t0: rnd(0, 0.05), life: rnd(1.0, 1.6), fo: 0.5, k0: 1.2, k1: 0.5 }; });
      for (var i = 0; i < 6; i++) out.push(P({ p: G().get("twinkle", rnd(36, 60)), x: rnd(-170, 170), y: rnd(-210, 170), pop: 0.18, t0: 0.25 + i * 0.12, life: 0.6 }));
      var rays = []; for (i = 0; i < 26; i++) rays.push({ a: i * TAU / 26 + rnd(-0.05, 0.05), L: rnd(0.6, 1), w: rnd(0.025, 0.05) });
      return { dur: 2.0, ps: out, fx: function (g, t) {
        g.save();
        var f = cl(1 - t / 0.28); if (f > 0) { g.globalAlpha = f; g.fillStyle = A().rg(g, 0, 0, 420, [[0, "rgba(255,255,240,1)"], [0.25, "rgba(255,210,110,.75)"], [1, "rgba(255,150,30,0)"]]); g.fillRect(-e.w, -e.h, e.w * 2, e.h * 2); }
        var ra = fadeOut(t, 0.7, 1.5) * cl(t / 0.08); if (ra > 0) { g.globalAlpha = ra * 0.85; g.rotate(t * 0.25);
          rays.forEach(function (r) { var L = 520 * r.L * eo(t / 0.5); g.fillStyle = A().lg(g, 0, 0, Math.cos(r.a) * L, Math.sin(r.a) * L, [[0, "rgba(255,228,150,.0)"], [0.25, "rgba(255,214,120,.55)"], [1, "rgba(255,170,40,0)"]]);
            g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(r.a - r.w) * L, Math.sin(r.a - r.w) * L); g.lineTo(Math.cos(r.a + r.w) * L, Math.sin(r.a + r.w) * L); g.closePath(); g.fill(); });
          g.rotate(-t * 0.25); }
        [0, 0.12].forEach(function (d, j) { var u = t - d; if (u < 0 || u > 0.9) return; var r = 60 + 620 * eo(u / 0.9); g.globalAlpha = (1 - u / 0.9) * (j ? 0.6 : 0.95);
          g.strokeStyle = j ? "rgba(255,255,255,.9)" : "rgba(255,190,60,1)"; g.lineWidth = (j ? 4 : 14) * (1 - u / 0.9) + 1; g.shadowColor = "rgba(255,170,40,1)"; g.shadowBlur = 18; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); g.shadowBlur = 0; });
        g.restore();
      } };
    },
    c2: function (e) {   // liquid crown: a golden splash with long drops, a foam wave and rising bubbles
      var out = radial(Math.round(34 * e.L), function (i, a) { var sp = rnd(700, 1050), up = Math.abs(Math.sin(a)) * 0.4 + 0.6;
        return { p: G().get("drop", rnd(24, 36)), x: Math.cos(a) * 60, y: 40, vx: Math.cos(a) * rnd(160, 380), vy: -sp * up, ay: 1700, d: 0.35, orient: true, t0: rnd(0, 0.08), life: rnd(1.0, 1.35), fo: 0.25 }; });
      for (var i = 0; i < Math.round(24 * e.L); i++) out.push(P({ p: G().get("bubble", rnd(12, 26)), x: rnd(-140, 140), y: rnd(80, 200), vy: rnd(-420, -260), d: 0.6, wob: 10, wf: 2, k0: 0.5, k1: 1.1, t0: rnd(0.2, 0.8), life: 1.0, fo: 0.15, burst: 0.12 }));
      out = out.concat(radial(Math.round(14 * e.L), function (j, a) { var sp = rnd(900, 1300); return { p: G().get("foam", rnd(30, 52)), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, d: 4.2, t0: 0.05, life: 1.7, fo: 0.35, k0: 0.5, k1: 1.25 }; }));
      return { dur: 2.2, ps: out, fx: function (g, t) {
        g.save(); var u = cl(t / 1.1), r = 80 + 260 * eo(u), al = 1 - u;
        if (al > 0) { g.globalAlpha = al; g.fillStyle = A().rg(g, 0, 60, r, [[0.6, "rgba(255,170,30,0)"], [0.85, "rgba(255,200,90,.55)"], [0.95, "rgba(255,248,225,.9)"], [1, "rgba(255,248,225,0)"]]);
          g.beginPath(); g.ellipse(0, 60, r, r * 0.34, 0, 0, TAU); g.fill(); }
        var f = cl(1 - t / 0.35); if (f > 0) { g.globalAlpha = f * 0.8; g.fillStyle = A().rg(g, 0, 20, 300, [[0, "rgba(255,214,120,.9)"], [1, "rgba(255,150,20,0)"]]); g.beginPath(); g.arc(0, 20, 300, 0, TAU); g.fill(); }
        g.restore();
      } };
    },
    c3: function (e) {   // neon zip: light trails race in from the screen edges, wrap the number in a neon ring, burst
      var tr = [], n = 6, R0 = 126;
      for (var i = 0; i < n; i++) { var a = -PI / 2 + i * TAU / n + 0.4, far = Math.hypot(e.w, e.h) * 0.6; tr.push({ x0: Math.cos(a) * far, y0: Math.sin(a) * far, a: a, c: i % 2 ? "rgba(255,190,60,1)" : "rgba(255,240,200,1)", bend: rnd(-1.4, 1.4) }); }
      var out = radial(Math.round(48 * e.L), function (j, a) { var sp = rnd(400, 800); return { p: G().get("spark", rnd(12, 20), { c: j % 3 ? "255,200,80" : "255,250,230" }), x: Math.cos(a) * R0, y: Math.sin(a) * R0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, d: 2.4, ay: 300, t0: 0.5, life: rnd(0.8, 1.2), fo: 0.5 }; });
      return { dur: 2.0, ps: out, fx: function (g, t) {
        g.save();
        tr.forEach(function (s) { var k0 = cl((t - 0.02) / 0.5); if (k0 <= 0 || t > 0.75) return; var pts = [], tail = 0.35;
          for (var q = Math.max(0, k0 - tail); q <= k0; q += 0.02) { var e2 = eio(q), th = s.a + s.bend * (1 - e2), r = R0 + (Math.hypot(s.x0, s.y0) - R0) * (1 - e2); pts.push([Math.cos(th) * r, Math.sin(th) * r]); }
          g.globalAlpha = t > 0.5 ? 1 - (t - 0.5) / 0.25 : 1; poly(g, pts, 7, s.c, 22, "#ffffff"); });
        if (t > 0.45) { var al = fadeOut(t, 1.3, 2.0), fl = t < 0.9 ? 0.75 + 0.25 * Math.sin(t * 70) : 1; g.globalAlpha = al * fl;
          glowArc(g, R0, 0, TAU, 8, "rgba(255,180,50,1)", "#fff6dc", 26); glowArc(g, R0 + 16, 0, TAU, 2.5, "rgba(255,236,180,.8)", null, 10);
          var u = t - 0.5; if (u > 0 && u < 0.7) { g.globalAlpha = 1 - u / 0.7; g.strokeStyle = "rgba(255,214,120,1)"; g.lineWidth = 6 * (1 - u / 0.7) + 1; g.beginPath(); g.arc(0, 0, R0 + 500 * eo(u / 0.7), 0, TAU); g.stroke(); } }
        g.restore();
      } };
    }
  };
  var COOL = ["c1", "c2", "c3"];   // tapmix: the 3 "cooler" effects join every family (owner A6, 17 Nov)
  var FAM = {
    xmas: ["x1", "x2", "x3", "x4", "x5"].concat(COOL), newyear: ["n1", "n2", "n3", "n4", "n5"].concat(COOL), midsummer: ["m1", "m2", "m3", "m4", "m5"].concat(COOL),
    valborg: ["v1", "v2", "v3", "v4", "v5"].concat(COOL), spring: ["o1", "o2", "o3", "o4", "o5", "v3", "v4", "v5"].concat(COOL), autumn: ["a1", "a2", "a3", "a4", "a5"].concat(COOL),
    normal: ["o1", "o2", "o3", "o4", "o5"].concat(COOL)
  };
  // the ring / edge colour and the calm mark of each family
  var MARK = { xmas: ["snowflake", {}], newyear: ["twinkle", {}], midsummer: ["flower", { n: 9, c: "#ffffff" }], valborg: ["tussilago", {}], spring: ["tussilago", {}], autumn: ["maple", {}], normal: ["star", {}] };

  /* ---------- engine ---------- */
  var last = {}, running = [], stats = { plays: 0, frames: 0, last: "", fam: "", marks: 0 };
  function killed() {
    try { if (/[?&]tapfx=0(&|$)/.test(W.location.search)) return true; var c = (W.PN && W.PN.CFG) || W.OLNU_CONFIG || {}; if (c.tapfx === false || c.tapfx === 0) return true; } catch (e) {}
    return !W.PNArt || !S() || S().off();
  }
  function forced() { try { var m = /[?&]tapfx=([a-z]\d)(&|$)/.exec(W.location.search); return m && V[m[1]] && S().testBuild() ? m[1] : W.__PN_TAPFX && V[W.__PN_TAPFX] ? W.__PN_TAPFX : ""; } catch (e) { return ""; } }
  function family() {
    var s = S().now(), f = s.tap || "normal";
    if (!FAM[f]) f = "normal";
    return { f: f, snow: s.wx && s.wx.snow > 0 && f === "normal" };
  }
  var LS_LAST = "pn.tapfx.last", bag = {};
  function lastGet() { try { return W.localStorage.getItem(LS_LAST) || ""; } catch (e) { return ""; } }
  function lastSet(id) { try { W.localStorage.setItem(LS_LAST, id); } catch (e) {} }
  // tapmix: a shuffle bag per pool. All effects play once (random order) before the bag refills; the first of a new bag
  // is never the one that just played (also after an app start).
  function choose(fam) {
    var pool = FAM[fam.f].slice(); if (fam.snow) pool.push("x1");   // snow weather: the snowflake burst joins the normal days
    var k = fam.f + (fam.snow ? "+s" : ""), prev = last[k] || lastGet();
    if (!bag[k] || !bag[k].length) {
      var b = pool.slice();
      for (var i = b.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = b[i]; b[i] = b[j]; b[j] = t; }
      if (b.length > 1 && b[b.length - 1] === prev) { var z = b[0]; b[0] = b[b.length - 1]; b[b.length - 1] = z; }   // pop() takes the end
      bag[k] = b;
    }
    var id = bag[k].pop();
    last[k] = id; lastSet(id);
    return id;
  }
  function btnXY(ox, oy) { var b = D.getElementById("btn-beer"); if (!b) return [0, 260]; var r = b.getBoundingClientRect(); return [r.left + r.width / 2 - ox, r.top + r.height / 2 - oy]; }
  function mark(host, f) {
    var sub = host.querySelector(".pm-sub"), m = MARK[f] || MARK.normal; if (!sub) return;
    var p = W.PNArt && W.PNArt.get(m[0], 22, m[1]); if (!p) return;
    var c = D.createElement("canvas"); c.className = "ss-mark"; c.width = p.c.width; c.height = p.c.height; c.setAttribute("aria-hidden", "true");
    try { c.getContext("2d").drawImage(p.c, 0, 0); } catch (e) {}
    sub.appendChild(c); stats.marks++;
  }
  // mycount.js burst(): returns { out() } (the number flies off: the canvas moves to <body>) or null
  function play(host, calm) {
    if (!host || W.OLNU_STORE || killed()) return null;
    var fam = family(); host.setAttribute("data-fam", fam.f);
    if (calm) { mark(host, fam.f); return null; }   // 8+ drinks / reduced motion: one still season mark, nothing moves
    var id = forced() || choose(fam), L = S().light() ? 0.5 : 1;
    var vw = W.innerWidth || 390, vh = W.innerHeight || 844, ox = vw / 2, oy = vh * 0.42, bxy = btnXY(ox, oy);
    var e = { w: vw, h: vh, bx: bxy[0], by: bxy[1], L: L }, fx;
    try { fx = V[id](e); } catch (x) { return null; }
    var R = Math.min(2, W.devicePixelRatio || 1), c = D.createElement("canvas");
    c.className = "ss-tap"; c.width = Math.round(vw * R); c.height = Math.round(vh * R); c.setAttribute("aria-hidden", "true"); c.setAttribute("data-fx", id);
    var back = host.querySelector(".pm-back"); if (back && back.nextSibling) host.insertBefore(c, back.nextSibling); else host.insertBefore(c, host.firstChild);
    var g = c.getContext("2d"), dur = fx.dur || 1.5, t0 = W.performance.now(), raf = 0, done = false;
    stats.plays++; stats.last = id; stats.fam = fam.f;
    function stop() { if (done) return; done = true; W.cancelAnimationFrame(raf); if (c.parentNode) c.parentNode.removeChild(c); running = running.filter(function (h) { return h !== H; }); }
    function frame(now) {
      if (done) return;
      var t = Math.max(0, (now - t0) / 1000); if (t > dur || !c.isConnected) { stop(); return; }   // swfix B9: a frame stamp from before play() = 0
      stats.frames++;
      g.setTransform(R, 0, 0, R, 0, 0); g.clearRect(0, 0, vw, vh); g.translate(ox, oy);
      try { if (fx.fx) fx.fx(g, t); for (var i = 0; i < fx.ps.length; i++) drawP(g, fx.ps[i], t, 1); } catch (x) { stop(); return; }
      raf = W.requestAnimationFrame(frame);
    }
    raf = W.requestAnimationFrame(frame);
    var H = { id: id, out: function () { if (done || !c.parentNode) return; c.classList.add("ss-tap-out"); D.body.appendChild(c); }, stop: stop };
    running.push(H);
    W.setTimeout(stop, dur * 1000 + 600);   // never stuck
    return H;
  }
  W.PNTapFx = {
    play: function (host, calm) { try { return play(host, calm); } catch (e) { return null; } },
    families: function () { return JSON.parse(JSON.stringify(FAM)); },
    ids: function () { return Object.keys(V); },
    running: function () { return running.length; },
    on: function () { return !W.OLNU_STORE && !killed(); },
    stats: stats,
    _choose: choose,
    _reset: function () { bag = {}; }   // tests: start a fresh shuffle bag
  };
})();
