/* PintsNow — SEASON ART (lane seasons, I-117). window.PNArt. Small drawn pieces for the ÖL! tap effects, the calm mark and
   the map decorations: canvas paths only (no emoji, no image files, no network). Each piece is drawn ONCE into an offscreen
   canvas at the phone's pixel ratio and kept (PNArt.get(name, size)); the effects only call drawImage. Every draw function
   draws centred on (0, 0) inside a box of s × s px. */
(function () {
  "use strict";
  var W = window, D = W.document, PI = Math.PI, TAU = PI * 2;
  var R = Math.min(2, Math.max(1, W.devicePixelRatio || 1)), cache = {}, n = 0;

  /* ---------- helpers ---------- */
  function rg(g, x, y, r, stops) { var q = g.createRadialGradient(x, y, 0, x, y, r); stops.forEach(function (s) { q.addColorStop(s[0], s[1]); }); return q; }
  function lg(g, x0, y0, x1, y1, stops) { var q = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(function (s) { q.addColorStop(s[0], s[1]); }); return q; }
  function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, TAU); }
  function star(g, x, y, n, r1, r2, rot) {
    g.beginPath();
    for (var i = 0; i < n * 2; i++) { var a = rot + i * PI / n, r = i % 2 ? r2 : r1; g[i ? "lineTo" : "moveTo"](x + Math.cos(a) * r, y + Math.sin(a) * r); }
    g.closePath();
  }
  function glow(g, s, col, a) { g.fillStyle = rg(g, 0, 0, s / 2, [[0, col], [0.25, col], [1, "rgba(0,0,0,0)"]]); g.globalAlpha = a == null ? 1 : a; g.fillRect(-s / 2, -s / 2, s, s); g.globalAlpha = 1; }
  function heartPath(g, w, h) {
    g.beginPath(); g.moveTo(0, h * 0.42);
    g.bezierCurveTo(-w * 0.62, -h * 0.02, -w * 0.38, -h * 0.58, 0, -h * 0.2);
    g.bezierCurveTo(w * 0.38, -h * 0.58, w * 0.62, -h * 0.02, 0, h * 0.42); g.closePath();
  }

  /* ---------- the pieces ---------- */
  var ART = {
    // light pieces
    glow: function (g, s, o) { glow(g, s, o.c || "rgba(255,200,90,1)"); },
    spark: function (g, s, o) {   // a small hot point with a soft glow
      var c = o.c || "255,214,120";
      g.fillStyle = rg(g, 0, 0, s / 2, [[0, "rgba(255,255,255,1)"], [0.14, "rgba(" + c + ",1)"], [0.4, "rgba(" + c + ",.35)"], [1, "rgba(" + c + ",0)"]]);
      g.fillRect(-s / 2, -s / 2, s, s);
    },
    twinkle: function (g, s, o) {   // 4-point twinkle with a glow
      var c = o.c || "255,226,150";
      glow(g, s, "rgba(" + c + ",.55)", 0.8);
      g.fillStyle = "rgba(255,255,255,.96)"; star(g, 0, 0, 4, s * 0.48, s * 0.07, -PI / 2); g.fill();
      g.fillStyle = "rgba(" + c + ",.9)"; star(g, 0, 0, 4, s * 0.26, s * 0.06, -PI / 4); g.fill();
    },
    star: function (g, s, o) {   // a fat 5-point star, gold by default, with a shine
      var c1 = o.c1 || "#ffe9a3", c2 = o.c2 || "#ffb02e", c3 = o.c3 || "#b9620b";
      glow(g, s, o.halo || "rgba(255,190,60,.55)", 0.9);
      star(g, 0, s * 0.03, 5, s * 0.36, s * 0.16, -PI / 2);
      g.fillStyle = lg(g, 0, -s * 0.36, 0, s * 0.33, [[0, c1], [0.55, c2], [1, c3]]); g.fill();
      g.lineWidth = Math.max(1, s * 0.03); g.strokeStyle = "rgba(90,40,0,.55)"; g.stroke();
      g.fillStyle = "rgba(255,255,255,.55)"; star(g, -s * 0.05, -s * 0.06, 5, s * 0.12, s * 0.05, -PI / 2); g.fill();
    },
    snowflake: function (g, s, o) {
      var r = s * 0.42, c = o.c || "#e8f6ff";
      glow(g, s, "rgba(150,210,255,.5)", 0.7);
      g.strokeStyle = c; g.lineCap = "round"; g.lineWidth = Math.max(1.2, s * 0.065);
      g.shadowColor = "rgba(120,190,255,.9)"; g.shadowBlur = s * 0.08 * R;
      for (var i = 0; i < 6; i++) {
        g.save(); g.rotate(i * PI / 3);
        g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -r);
        [0.45, 0.72].forEach(function (k, j) { var b = r * (j ? 0.2 : 0.28); g.moveTo(0, -r * k); g.lineTo(-b, -r * k - b); g.moveTo(0, -r * k); g.lineTo(b, -r * k - b); });
        g.stroke(); g.restore();
      }
      g.shadowBlur = 0; g.fillStyle = "#ffffff"; circ(g, 0, 0, s * 0.07); g.fill();
    },
    bell: function (g, s) {
      var w = s * 0.62, h = s * 0.62;
      g.save(); g.translate(0, s * 0.04);
      g.fillStyle = "rgba(60,30,0,.35)"; g.beginPath(); g.ellipse(0, h * 0.5, w * 0.55, h * 0.08, 0, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(-w * 0.12, -h * 0.5);
      g.bezierCurveTo(-w * 0.42, -h * 0.48, -w * 0.38, h * 0.1, -w * 0.62, h * 0.38); g.lineTo(w * 0.62, h * 0.38);
      g.bezierCurveTo(w * 0.38, h * 0.1, w * 0.42, -h * 0.48, w * 0.12, -h * 0.5); g.closePath();
      g.fillStyle = lg(g, -w * 0.6, 0, w * 0.6, 0, [[0, "#8a4f06"], [0.25, "#ffd46b"], [0.45, "#fff4c4"], [0.7, "#e9a320"], [1, "#7a4204"]]); g.fill();
      g.fillStyle = lg(g, 0, h * 0.3, 0, h * 0.46, [[0, "#c9861a"], [1, "#6d3a04"]]);
      g.beginPath(); g.ellipse(0, h * 0.38, w * 0.64, h * 0.09, 0, 0, TAU); g.fill();
      g.fillStyle = "#5a3004"; circ(g, 0, h * 0.47, s * 0.07); g.fill();
      // the red bow on top
      g.fillStyle = "#d62a2a"; g.beginPath(); g.ellipse(-s * 0.13, -h * 0.56, s * 0.13, s * 0.07, -0.4, 0, TAU); g.ellipse(s * 0.13, -h * 0.56, s * 0.13, s * 0.07, 0.4, 0, TAU); g.fill();
      g.fillStyle = "#a01414"; circ(g, 0, -h * 0.55, s * 0.05); g.fill();
      g.restore();
    },
    bow: function (g, s) {   // a big red gift bow
      var r = s * 0.5;
      g.save(); g.lineJoin = "round";
      var red = lg(g, 0, -r, 0, r, [[0, "#ff5a5a"], [0.5, "#d81f2a"], [1, "#8e0b15"]]);
      // tails
      g.fillStyle = "#b5121f";
      g.beginPath(); g.moveTo(-r * 0.08, 0); g.lineTo(-r * 0.5, r * 0.9); g.lineTo(-r * 0.3, r * 0.82); g.lineTo(-r * 0.22, r * 0.98); g.lineTo(r * 0.06, r * 0.1); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(r * 0.08, 0); g.lineTo(r * 0.5, r * 0.9); g.lineTo(r * 0.3, r * 0.82); g.lineTo(r * 0.22, r * 0.98); g.lineTo(-r * 0.06, r * 0.1); g.closePath(); g.fill();
      // loops
      g.fillStyle = red;
      [-1, 1].forEach(function (k) {
        g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(k * r * 0.3, -r * 0.75, k * r * 1.05, -r * 0.55, k * r * 0.92, -r * 0.05);
        g.bezierCurveTo(k * r * 0.85, r * 0.3, k * r * 0.35, r * 0.15, 0, 0); g.fill();
        g.strokeStyle = "rgba(255,190,190,.6)"; g.lineWidth = Math.max(1, s * 0.03);
        g.beginPath(); g.moveTo(k * r * 0.18, -r * 0.18); g.quadraticCurveTo(k * r * 0.55, -r * 0.55, k * r * 0.8, -r * 0.2); g.stroke();
      });
      g.fillStyle = "#c4141f"; g.beginPath(); g.ellipse(0, -r * 0.02, r * 0.17, r * 0.2, 0, 0, TAU); g.fill();
      g.fillStyle = "rgba(255,255,255,.35)"; g.beginPath(); g.ellipse(-r * 0.04, -r * 0.08, r * 0.06, r * 0.08, 0, 0, TAU); g.fill();
      g.restore();
    },
    ginger: function (g, s) {   // a gingerbread man with white icing
      var k = s / 100;
      g.save(); g.scale(k, k);
      g.fillStyle = "#b8682b"; g.strokeStyle = "#7c3f12"; g.lineWidth = 3;
      g.beginPath(); circ(g, 0, -28, 16); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-14, -14); g.lineTo(-38, -6); g.quadraticCurveTo(-44, 4, -34, 8); g.lineTo(-16, 4); g.lineTo(-22, 34); g.quadraticCurveTo(-22, 46, -10, 42);
      g.lineTo(0, 22); g.lineTo(10, 42); g.quadraticCurveTo(22, 46, 22, 34); g.lineTo(16, 4); g.lineTo(34, 8); g.quadraticCurveTo(44, 4, 38, -6); g.lineTo(14, -14); g.closePath();
      g.fill(); g.stroke();
      g.strokeStyle = "#fff8ee"; g.lineWidth = 3; g.lineCap = "round";
      g.beginPath(); g.moveTo(-36, 0); g.lineTo(-30, -4); g.lineTo(-26, 2); g.moveTo(36, 0); g.lineTo(30, -4); g.lineTo(26, 2);
      g.moveTo(-20, 36); g.lineTo(-14, 32); g.moveTo(20, 36); g.lineTo(14, 32); g.stroke();
      g.beginPath(); g.arc(0, -26, 8, 0.2 * PI, 0.8 * PI); g.stroke();
      g.fillStyle = "#3a1d08"; circ(g, -6, -32, 2.6); g.fill(); circ(g, 6, -32, 2.6); g.fill();
      g.fillStyle = "#e23a3a"; circ(g, 0, -2, 3.5); g.fill(); g.fillStyle = "#3fae5a"; circ(g, 0, 9, 3.5); g.fill();
      g.restore();
    },
    cookie: function (g, s) {   // a heart cookie with icing
      g.save();
      g.fillStyle = "#b8682b"; heartPath(g, s * 0.84, s * 0.78); g.fill();
      g.strokeStyle = "#7c3f12"; g.lineWidth = Math.max(1, s * 0.035); g.stroke();
      g.save(); g.scale(0.78, 0.78); heartPath(g, s * 0.84, s * 0.78); g.restore();
      g.strokeStyle = "#fff8ee"; g.lineWidth = Math.max(1, s * 0.045); g.setLineDash([s * 0.06, s * 0.05]); g.stroke(); g.setLineDash([]);
      g.restore();
    },
    flower: function (g, s, o) {   // n petals around a centre: daisy, buttercup, cornflower, pink
      var np = o.n || 8, pc = o.c || "#ffffff", cc = o.cc || "#ffc928", r = s * 0.44;
      g.save();
      for (var i = 0; i < np; i++) {
        g.save(); g.rotate(i * TAU / np);
        g.fillStyle = lg(g, 0, 0, 0, -r, [[0, o.c2 || pc], [1, pc]]);
        g.beginPath(); g.ellipse(0, -r * 0.52, r * (o.wide || 0.24), r * 0.5, 0, 0, TAU); g.fill();
        if (o.fringe) { g.fillStyle = pc; star(g, 0, -r * 0.88, 3, r * 0.16, r * 0.06, -PI / 2); g.fill(); }
        g.restore();
      }
      g.fillStyle = rg(g, -r * 0.06, -r * 0.06, r * 0.28, [[0, "#fff6b0"], [0.5, cc], [1, o.cc2 || "#c98a00"]]); circ(g, 0, 0, r * 0.24); g.fill();
      g.restore();
    },
    leaf: function (g, s, o) {   // a birch / summer leaf (serrated edge, midrib)
      var c = o.c || "#8fd34a", d = o.d || "#4f9a22", r = s * 0.46;
      g.save(); g.rotate(-0.5);
      g.beginPath(); g.moveTo(0, -r);
      for (var i = 0; i <= 8; i++) { var t = i / 8, y = -r + t * r * 1.8, w = Math.sin(t * PI) * r * 0.55 * (1 - t * 0.25); g.lineTo(w + (i % 2 ? r * 0.04 : 0), y); }
      for (i = 8; i >= 0; i--) { t = i / 8; y = -r + t * r * 1.8; w = Math.sin(t * PI) * r * 0.55 * (1 - t * 0.25); g.lineTo(-w - (i % 2 ? r * 0.04 : 0), y); }
      g.closePath(); g.fillStyle = lg(g, -r * 0.5, 0, r * 0.5, 0, [[0, d], [0.5, c], [1, d]]); g.fill();
      g.strokeStyle = "rgba(40,80,10,.55)"; g.lineWidth = Math.max(1, s * 0.03); g.beginPath(); g.moveTo(0, -r * 0.9); g.lineTo(0, r * 0.95); g.stroke();
      g.restore();
    },
    maple: function (g, s, o) {   // a 5-lobed maple leaf (autumn)
      var c = o.c || "#f07a1a", d = o.d || "#a8370a", r = s * 0.46;
      var pts = [[0, -1], [0.18, -0.55], [0.5, -0.72], [0.4, -0.32], [0.95, -0.38], [0.7, -0.05], [0.88, 0.18], [0.42, 0.2], [0.5, 0.5], [0.1, 0.32], [0.04, 0.62]];
      g.save(); g.beginPath();
      pts.forEach(function (p, i) { g[i ? "lineTo" : "moveTo"](p[0] * r, p[1] * r); });
      for (var i = pts.length - 1; i >= 0; i--) g.lineTo(-pts[i][0] * r, pts[i][1] * r);
      g.closePath(); g.fillStyle = rg(g, 0, -r * 0.1, r * 1.1, [[0, o.c0 || "#ffc04a"], [0.45, c], [1, d]]); g.fill();
      g.strokeStyle = "rgba(90,20,0,.5)"; g.lineWidth = Math.max(1, s * 0.025);
      g.beginPath(); g.moveTo(0, r * 0.95); g.lineTo(0, -r * 0.85); g.moveTo(0, -r * 0.05); g.lineTo(r * 0.75, -r * 0.3); g.moveTo(0, -r * 0.05); g.lineTo(-r * 0.75, -r * 0.3);
      g.moveTo(0, r * 0.15); g.lineTo(r * 0.45, r * 0.38); g.moveTo(0, r * 0.15); g.lineTo(-r * 0.45, r * 0.38); g.stroke();
      g.restore();
    },
    frog: function (g, s) {
      var k = s / 100;
      g.save(); g.scale(k, k);
      g.fillStyle = "#2f8f2e"; g.beginPath(); g.ellipse(-26, 26, 18, 9, -0.3, 0, TAU); g.ellipse(26, 26, 18, 9, 0.3, 0, TAU); g.fill();
      g.fillStyle = lg(g, 0, -30, 0, 34, [[0, "#7ee05a"], [1, "#2e9a2f"]]); g.beginPath(); g.ellipse(0, 8, 34, 28, 0, 0, TAU); g.fill();
      g.fillStyle = "#d9f7a8"; g.beginPath(); g.ellipse(0, 16, 20, 16, 0, 0, TAU); g.fill();
      [-1, 1].forEach(function (q) {
        g.fillStyle = "#5fcf44"; circ(g, q * 17, -18, 13); g.fill();
        g.fillStyle = "#ffffff"; circ(g, q * 17, -19, 9); g.fill();
        g.fillStyle = "#14240e"; circ(g, q * 18, -18, 5); g.fill();
        g.fillStyle = "#ffffff"; circ(g, q * 16, -21, 1.8); g.fill();
        g.fillStyle = "#3fb03a"; g.beginPath(); g.ellipse(q * 22, 34, 11, 6, 0, 0, TAU); g.fill();
      });
      g.strokeStyle = "#1f5a17"; g.lineWidth = 2.4; g.lineCap = "round"; g.beginPath(); g.arc(0, -2, 12, 0.15 * PI, 0.85 * PI); g.stroke();
      g.fillStyle = "rgba(255,120,120,.45)"; circ(g, -20, 0, 4); g.fill(); circ(g, 20, 0, 4); g.fill();
      g.restore();
    },
    strawberry: function (g, s) {
      var k = s / 100;
      g.save(); g.scale(k, k);
      g.beginPath(); g.moveTo(0, 44); g.bezierCurveTo(-40, 20, -42, -26, -14, -30); g.quadraticCurveTo(0, -34, 14, -30); g.bezierCurveTo(42, -26, 40, 20, 0, 44); g.closePath();
      g.fillStyle = rg(g, -10, -10, 60, [[0, "#ff6b6b"], [0.6, "#e01e2c"], [1, "#9c0c16"]]); g.fill();
      g.fillStyle = "#ffe48a";
      [[-16, -12], [0, -16], [16, -12], [-22, 4], [-6, 2], [10, 2], [24, 4], [-14, 18], [2, 18], [16, 18], [-4, 32], [8, 30]].forEach(function (p) { g.beginPath(); g.ellipse(p[0], p[1], 1.8, 2.8, 0, 0, TAU); g.fill(); });
      g.fillStyle = "#3f9a2c";
      for (var i = 0; i < 5; i++) { g.save(); g.translate(0, -30); g.rotate(-PI / 2 + (i - 2) * 0.55); g.beginPath(); g.ellipse(12, 0, 13, 5, 0, 0, TAU); g.fill(); g.restore(); }
      g.fillStyle = "#2f7a20"; g.fillRect(-2, -44, 4, 12);
      g.fillStyle = "rgba(255,255,255,.4)"; g.beginPath(); g.ellipse(-16, -8, 5, 9, 0.4, 0, TAU); g.fill();
      g.restore();
    },
    cap: function (g, s) {   // the Swedish student cap (white crown, black band, black peak, gold badge)
      var k = s / 100;
      g.save(); g.scale(k, k);
      g.fillStyle = "rgba(0,0,0,.3)"; g.beginPath(); g.ellipse(0, 30, 42, 8, 0, 0, TAU); g.fill();
      g.fillStyle = "#14161c"; g.beginPath(); g.ellipse(4, 22, 38, 12, 0.05, 0, PI); g.fill();   // the peak
      g.fillStyle = lg(g, 0, -34, 0, 14, [[0, "#ffffff"], [1, "#d9dde6"]]);
      g.beginPath(); g.ellipse(0, -10, 46, 22, 0, 0, TAU); g.fill();
      g.strokeStyle = "rgba(120,130,150,.6)"; g.lineWidth = 1.6; g.beginPath(); g.ellipse(0, -10, 46, 22, 0, 0, TAU); g.stroke();
      g.fillStyle = "#1c1f27"; g.beginPath(); g.moveTo(-40, -2); g.lineTo(40, -2); g.lineTo(38, 14); g.quadraticCurveTo(0, 22, -38, 14); g.closePath(); g.fill();
      g.fillStyle = "#e0b43c"; circ(g, 0, 4, 6); g.fill(); g.fillStyle = "#fff0b0"; circ(g, -1.5, 2.5, 2); g.fill();
      g.restore();
    },
    tussilago: function (g, s) { ART.flower(g, s, { n: 22, c: "#ffd21c", c2: "#ffb300", cc: "#ffb000", cc2: "#d27a00", wide: 0.09 }); },
    crocus: function (g, s) {
      var k = s / 100; g.save(); g.scale(k, k);
      g.fillStyle = "#5aa83c"; g.fillRect(-2, 6, 4, 40);
      [[-14, -0.35], [14, 0.35], [0, 0]].forEach(function (p, i) {
        g.save(); g.translate(p[0] * 0.6, 6); g.rotate(p[1]);
        g.fillStyle = lg(g, 0, -40, 0, 4, [[0, i === 2 ? "#c9a2ff" : "#b383ff"], [1, "#6a2fc4"]]);
        g.beginPath(); g.moveTo(0, 2); g.bezierCurveTo(-16, -6, -12, -36, 0, -42); g.bezierCurveTo(12, -36, 16, -6, 0, 2); g.fill(); g.restore();
      });
      g.fillStyle = "#ffb000"; g.fillRect(-1.5, -18, 3, 12);
      g.restore();
    },
    scilla: function (g, s) { ART.flower(g, s, { n: 6, c: "#4f7cff", c2: "#2a4fd6", cc: "#1d2f8a", cc2: "#0c1a5a", wide: 0.2 }); },
    note: function (g, s, o) {   // a beamed pair of music notes
      var k = s / 100; g.save(); g.scale(k, k);
      g.fillStyle = o.c || "#ffffff"; g.strokeStyle = o.c || "#ffffff"; g.lineWidth = 6;
      g.shadowColor = "rgba(255,255,255,.7)"; g.shadowBlur = 6 * R;
      g.beginPath(); g.ellipse(-22, 28, 13, 9, -0.4, 0, TAU); g.fill(); g.beginPath(); g.ellipse(22, 20, 13, 9, -0.4, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(-11, 26); g.lineTo(-11, -32); g.moveTo(33, 18); g.lineTo(33, -40); g.stroke();
      g.lineWidth = 12; g.beginPath(); g.moveTo(-11, -30); g.lineTo(33, -38); g.stroke();
      g.restore();
    },
    mushroom: function (g, s, o) {   // kind: "kant" chanterelle, "sopp" porcini, "flug" fly agaric
      var k = s / 100, kind = o.kind || "flug"; g.save(); g.scale(k, k);
      g.fillStyle = "rgba(0,0,0,.28)"; g.beginPath(); g.ellipse(0, 40, 30, 7, 0, 0, TAU); g.fill();
      if (kind === "kant") {
        g.fillStyle = lg(g, 0, -30, 0, 40, [[0, "#ffd34d"], [1, "#e89a12"]]);
        g.beginPath(); g.moveTo(-36, -18); g.quadraticCurveTo(0, -36, 36, -18); g.quadraticCurveTo(30, -6, 10, 4); g.lineTo(8, 38); g.quadraticCurveTo(0, 42, -8, 38); g.lineTo(-10, 4);
        g.quadraticCurveTo(-30, -6, -36, -18); g.fill();
        g.strokeStyle = "rgba(170,90,0,.6)"; g.lineWidth = 1.6; for (var i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(i * 2, 30); g.lineTo(i * 8, -14); g.stroke(); }
      } else {
        g.fillStyle = lg(g, -10, 0, 10, 0, [[0, "#efe6d2"], [1, "#d6c7a6"]]); g.beginPath(); g.moveTo(-12, -4); g.quadraticCurveTo(-18, 30, -10, 40); g.lineTo(10, 40); g.quadraticCurveTo(18, 30, 12, -4); g.fill();
        var top = kind === "sopp" ? ["#b67a3c", "#6e3d14"] : ["#ff4a3a", "#b0140c"];
        g.fillStyle = rg(g, -8, -22, 46, [[0, top[0]], [1, top[1]]]); g.beginPath(); g.moveTo(-40, 0); g.bezierCurveTo(-40, -40, 40, -40, 40, 0); g.quadraticCurveTo(0, 8, -40, 0); g.fill();
        if (kind === "flug") { g.fillStyle = "#fff8ec"; [[-20, -10], [0, -22], [18, -12], [-6, -6], [28, -2], [-30, -2]].forEach(function (p) { circ(g, p[0], p[1], 3.6); g.fill(); }); }
        else { g.fillStyle = "rgba(255,230,190,.35)"; g.beginPath(); g.ellipse(-12, -18, 12, 6, -0.3, 0, TAU); g.fill(); }
      }
      g.restore();
    },
    lantern: function (g, s) {   // a warm lantern in a big soft glow (the box is mostly glow)
      var k = s / 100; g.save(); g.scale(k, k);
      g.fillStyle = rg(g, 0, 4, 50, [[0, "rgba(255,214,120,.9)"], [0.3, "rgba(255,160,50,.45)"], [1, "rgba(255,120,20,0)"]]); g.fillRect(-50, -50, 100, 100);
      g.scale(0.62, 0.62);
      g.strokeStyle = "#2b2016"; g.lineWidth = 4; g.beginPath(); g.arc(0, -44, 8, PI, 0); g.stroke();
      g.fillStyle = "#2b2016"; g.beginPath(); g.moveTo(-20, -30); g.lineTo(0, -42); g.lineTo(20, -30); g.closePath(); g.fill(); g.fillRect(-18, 28, 36, 8);
      g.fillStyle = rg(g, 0, 2, 26, [[0, "#ffffff"], [0.25, "#fff2b0"], [0.6, "#ffb43a"], [1, "#d8640c"]]); g.beginPath(); g.moveTo(-16, -30); g.lineTo(16, -30); g.lineTo(19, 28); g.lineTo(-19, 28); g.closePath(); g.fill();
      g.strokeStyle = "rgba(43,32,22,.85)"; g.lineWidth = 3; g.beginPath(); g.moveTo(-16, -30); g.lineTo(-19, 28); g.moveTo(16, -30); g.lineTo(19, 28); g.moveTo(0, -30); g.lineTo(0, 28); g.stroke();
      g.restore();
    },
    acorn: function (g, s) {
      var k = s / 100; g.save(); g.scale(k, k); g.rotate(0.3);
      g.fillStyle = rg(g, -8, 6, 40, [[0, "#d99a52"], [1, "#8a4a14"]]); g.beginPath(); g.ellipse(0, 10, 22, 28, 0, 0, TAU); g.fill();
      g.fillStyle = "#6b4520"; g.beginPath(); g.ellipse(0, -10, 27, 16, 0, PI, TAU); g.lineTo(27, -6); g.quadraticCurveTo(0, 2, -27, -6); g.fill();
      g.strokeStyle = "rgba(40,20,5,.5)"; g.lineWidth = 1.5; for (var i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * 9 - 6, -20); g.lineTo(i * 9 + 6, -6); g.stroke(); }
      g.fillStyle = "#4a2e12"; g.fillRect(-2, -36, 4, 12);
      g.fillStyle = "rgba(255,255,255,.3)"; g.beginPath(); g.ellipse(-9, 8, 4, 10, 0.2, 0, TAU); g.fill();
      g.restore();
    },
    rowan: function (g, s) {   // a bunch of rowan berries
      var k = s / 100; g.save(); g.scale(k, k);
      g.strokeStyle = "#6b3a1a"; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, -38); g.lineTo(0, -10); g.moveTo(0, -24); g.lineTo(-18, -4); g.moveTo(0, -24); g.lineTo(18, -6); g.stroke();
      [[-20, 0], [-6, 4], [8, 2], [22, 0], [-14, 16], [0, 18], [14, 16], [-6, 30], [8, 30]].forEach(function (p) {
        g.fillStyle = rg(g, p[0] - 3, p[1] - 3, 11, [[0, "#ff7a3a"], [0.6, "#e0301a"], [1, "#9a1508"]]); circ(g, p[0], p[1], 9); g.fill();
        g.fillStyle = "#3a0d04"; circ(g, p[0], p[1] + 6, 1.6); g.fill();
      });
      g.restore();
    },
    foam: function (g, s) {   // a cream foam ball
      var r = s * 0.42;
      g.fillStyle = "rgba(60,30,0,.22)"; circ(g, r * 0.08, r * 0.12, r); g.fill();
      g.fillStyle = rg(g, -r * 0.3, -r * 0.35, r * 1.3, [[0, "#ffffff"], [0.45, "#fff3d6"], [0.85, "#f1d39a"], [1, "#d9ae66"]]); circ(g, 0, 0, r); g.fill();
      g.fillStyle = "rgba(255,255,255,.9)"; g.beginPath(); g.ellipse(-r * 0.35, -r * 0.38, r * 0.22, r * 0.14, -0.6, 0, TAU); g.fill();
    },
    bubble: function (g, s) {
      var r = s * 0.42;
      g.fillStyle = rg(g, 0, 0, r, [[0, "rgba(255,230,160,.04)"], [0.8, "rgba(255,220,140,.14)"], [1, "rgba(255,240,200,.55)"]]); circ(g, 0, 0, r); g.fill();
      g.strokeStyle = "rgba(255,248,225,.85)"; g.lineWidth = Math.max(1, r * 0.09); circ(g, 0, 0, r * 0.95); g.stroke();
      g.fillStyle = "rgba(255,255,255,.95)"; g.beginPath(); g.ellipse(-r * 0.38, -r * 0.4, r * 0.2, r * 0.12, -0.7, 0, TAU); g.fill();
      g.fillStyle = "rgba(255,255,255,.6)"; circ(g, r * 0.42, r * 0.38, r * 0.07); g.fill();
    },
    drop: function (g, s) {   // an amber drop of beer
      var r = s * 0.3;
      g.save(); g.translate(0, s * 0.08);
      g.beginPath(); g.moveTo(0, -r * 1.9); g.bezierCurveTo(r * 0.5, -r * 0.9, r * 1.05, -r * 0.2, r, r * 0.3); g.arc(0, r * 0.3, r, 0, PI); g.bezierCurveTo(-r * 1.05, -r * 0.2, -r * 0.5, -r * 0.9, 0, -r * 1.9);
      g.fillStyle = rg(g, -r * 0.3, 0, r * 2, [[0, "#ffe08a"], [0.5, "#ffad1f"], [1, "#b8600a"]]); g.fill();
      g.fillStyle = "rgba(255,255,255,.75)"; g.beginPath(); g.ellipse(-r * 0.38, 0, r * 0.18, r * 0.36, 0.3, 0, TAU); g.fill();
      g.restore();
    },
    bottlecap: function (g, s, o) {   // a crimped bottle cap (gold or silver) with a star
      var r = s * 0.44, n = 21, c = o.silver ? ["#ffffff", "#c9d2de", "#6f7a88"] : ["#fff1b5", "#f2b52a", "#8a5404"];
      g.beginPath();
      for (var i = 0; i < n * 2; i++) { var a = i * PI / n, rr = i % 2 ? r * 0.9 : r; g[i ? "lineTo" : "moveTo"](Math.cos(a) * rr, Math.sin(a) * rr); }
      g.closePath(); g.fillStyle = lg(g, -r, -r, r, r, [[0, c[0]], [0.5, c[1]], [1, c[2]]]); g.fill();
      g.fillStyle = lg(g, r, r, -r, -r, [[0, c[0]], [0.5, c[1]], [1, c[2]]]); circ(g, 0, 0, r * 0.72); g.fill();
      g.fillStyle = o.silver ? "#c8202a" : "#7a1a12"; star(g, 0, r * 0.03, 5, r * 0.36, r * 0.15, -PI / 2); g.fill();
    },
    wreath: function (g, s) {   // the Midsummer wreath: leaves + small flowers in a ring (seen a little from the side)
      var r = s * 0.4;
      g.save(); g.scale(1, 0.45);
      g.strokeStyle = "#3f8f2a"; g.lineWidth = s * 0.08; circ(g, 0, 0, r); g.stroke();
      for (var i = 0; i < 16; i++) {
        var a = i * TAU / 16, x = Math.cos(a) * r, y = Math.sin(a) * r;
        g.save(); g.translate(x, y); g.rotate(a + PI / 2); g.fillStyle = i % 2 ? "#6cc04a" : "#4ea036"; g.beginPath(); g.ellipse(0, 0, s * 0.05, s * 0.1, 0.6, 0, TAU); g.fill(); g.restore();
        if (i % 2 === 0) { g.fillStyle = ["#ffffff", "#ffd21c", "#5f86ff", "#ff7fb8"][(i / 2) % 4]; circ(g, x, y - s * 0.02, s * 0.045); g.fill(); g.fillStyle = "#ffcc33"; circ(g, x, y - s * 0.02, s * 0.018); g.fill(); }
      }
      g.restore();
    }
  };

  // a piece at size s (css px) → { c: canvas, s } (cached). o = colour options (part of the key).
  function get(name, s, o) {
    o = o || {}; s = Math.max(4, Math.round(s));
    var k = name + "|" + s + "|" + JSON.stringify(o);
    if (cache[k]) return cache[k];
    var f = ART[name]; if (!f) return null;
    var c = D.createElement("canvas"); c.width = c.height = Math.ceil(s * R);
    var g = c.getContext("2d"); if (!g) return null;
    g.scale(R, R); g.translate(s / 2, s / 2);
    try { f(g, s, o); } catch (e) {}
    cache[k] = { c: c, s: s }; n++;
    return cache[k];
  }
  // draw a piece at (x, y) with rotation a, scale k, alpha al, and flip fx (-1..1 = coin flip)
  function put(g, p, x, y, a, k, al, fx) {
    if (!p || al <= 0.002 || k <= 0.001) return;
    g.save(); g.globalAlpha = Math.min(1, al); g.translate(x, y); if (a) g.rotate(a);
    g.scale(k * (fx == null ? 1 : fx), k); g.drawImage(p.c, -p.s / 2, -p.s / 2, p.s, p.s); g.restore();
  }
  W.PNArt = { get: get, put: put, names: function () { return Object.keys(ART); }, star: star, rg: rg, lg: lg, R: R, size: function () { return n; } };
})();
