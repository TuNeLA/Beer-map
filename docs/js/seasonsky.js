/* PintsNow — SEASON SKY (lane seasons, owner I-115 / I-117 / I-120 A4: "we should take our own snow"). window.PNSky.
   One 2D canvas over the map, under every DOM marker (own pane "season", z 370: under the people pins, my pins, faces,
   arena chips; over the GL map). Scenes (screen space, every one has an end):
     snow   falls DOWN in 3 depths (far small slow, near big soft fast), a slow wind, a few glints. Light 90 / normal 190 /
            heavy 380 flakes by the weather code (js/seasonclock.js). Fade in 2 s, out 5 s, 30 s in all.
     rain   streaks at 9 degrees (falls down-right, the same way as the snow wind; the streak points along the fall, I-131), small rings where drops land, the air a little darker. 30 s.
     leaves October: 30 leaves drift down with a pendulum swing and a shadow, 10 s.
     fog    TRIAL (owner 15 Nov: "just to try it out"): 3 soft layers at their own speed, thinner in the middle; 20 s, then
            still; weak. Off: ?fog=0 or PN.CFG.fog === false. Fireworks + northern lights: js/seasonfw.js (same canvas).
   - NOTHING covers a pin: after each frame every bar icon + name (GLBARS.rects), my marker and the GL crowd lanterns get a
     soft hole (destination-out). The DOM pins (people, faces, my pins) are above this pane anyway.
   - "Levande karta: av" (pn_alive_off) = no scene at all. Reduced motion = ONE still frame per scene (then it clears at its
     end). Light version (PNSeason.light()): half the pieces, 2 depths, no glints / splashes, 30 fps. Tab hidden = stopped.
   - When: the map opens (GL ready), the weather level changes, or the app comes back after 15 min. No new network call. */
(function () {
  "use strict";
  var W = window, D = W.document, PI = Math.PI, TAU = PI * 2;
  var map = null, pane = null, cv = null, g = null, R = 1, cw = 0, ch = 0, raf = 0, last = 0, scenes = [], holes = [], holesAt = 0, hidAt = 0, sig = "";
  var stats = { frames: 0, scenes: 0, started: [], holes: 0, ended: [] };
  function S() { return W.PNSeason; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function cl(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function gl() { try { var b = W.BASEMAP; return b && b.isMapbox && b.isMapbox() && b.mapbox() ? b.mapbox().getMapboxMap() : null; } catch (e) { return null; } }
  function allowed() { var s = S(); return !!(s && !s.off() && s.alive() && !D.hidden); }

  /* ---------- the canvas ---------- */
  function ensure() {
    if (!map || !map.createPane) return false;
    if (!pane) { pane = map.getPane("season") || map.createPane("season"); pane.style.zIndex = 370; pane.style.pointerEvents = "none"; }
    if (!cv) { cv = D.createElement("canvas"); cv.className = "ss-sky"; cv.setAttribute("aria-hidden", "true"); pane.appendChild(cv); g = cv.getContext("2d"); }
    var c = map.getContainer ? map.getContainer() : null, w = c ? c.clientWidth : W.innerWidth, h = c ? c.clientHeight : W.innerHeight;
    R = Math.min(S().light() ? 1 : 2, W.devicePixelRatio || 1);
    if (w !== cw || h !== ch || cv.width !== Math.round(w * R)) { cw = w; ch = h; cv.width = Math.round(w * R); cv.height = Math.round(h * R); cv.style.width = w + "px"; cv.style.height = h + "px"; }
    return !!g;
  }
  function clear() { if (cv) { cv.width = cv.width; } }   // a full reset (a plain clearRect once left the last frame on screen)

  /* ---------- keep-out: the pins ---------- */
  function readHoles() {
    var out = [];
    try { if (W.GLBARS && W.GLBARS.on && W.GLBARS.on()) out = W.GLBARS.rects().map(function (r) { return [r.l, r.t, r.r, r.b]; }); } catch (e) {}
    try { var me = W.GLBARS && W.GLBARS._me ? W.GLBARS._me() : null; if (me && me.px) out.push([me.px.x - me.px.r - 4, me.px.y - me.px.r - 4, me.px.x + me.px.r + 4, me.px.y + me.px.r + 4]); } catch (e) {}
    holes = out; holesAt = W.performance.now(); stats.holes = out.length;
  }
  function punch() {
    if (!holes.length) return;
    g.save(); g.globalCompositeOperation = "destination-out"; g.fillStyle = "rgba(0,0,0,1)"; g.shadowColor = "rgba(0,0,0,1)"; g.shadowBlur = 8 * R;
    for (var i = 0; i < holes.length; i++) { var h = holes[i], p = 3; g.beginPath(); if (g.roundRect) g.roundRect(h[0] - p, h[1] - p, h[2] - h[0] + 2 * p, h[3] - h[1] + 2 * p, 10); else g.rect(h[0] - p, h[1] - p, h[2] - h[0] + 2 * p, h[3] - h[1] + 2 * p); g.fill(); }
    g.restore();
  }

  /* ---------- sprites ---------- */
  var spr = {};
  function flake(r, soft) {
    var k = "f" + r + soft; if (spr[k]) return spr[k];
    var s = Math.ceil(r * 2 + 4), c = D.createElement("canvas"); c.width = c.height = s * 2; var q = c.getContext("2d"); q.scale(2, 2);
    var gr = q.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, r + 1);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(soft ? 0.25 : 0.55, "rgba(245,250,255,.95)"); gr.addColorStop(1, "rgba(230,240,255,0)");
    q.fillStyle = gr; q.fillRect(0, 0, s, s);
    return (spr[k] = { c: c, s: s });
  }
  function fogTile() {
    if (spr.fog) return spr.fog;
    var s = 512, c = D.createElement("canvas"); c.width = c.height = s; var q = c.getContext("2d");
    for (var i = 0; i < 60; i++) { var x = rnd(0, s), y = rnd(0, s), r = rnd(50, 140);
      [-s, 0, s].forEach(function (dx) { [-s, 0, s].forEach(function (dy) { var gr = q.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r); gr.addColorStop(0, "rgba(220,226,240,.4)"); gr.addColorStop(1, "rgba(220,226,240,0)"); q.fillStyle = gr; q.fillRect(x + dx - r, y + dy - r, r * 2, r * 2); }); }); }
    return (spr.fog = { c: c, s: s });
  }

  /* ---------- scenes ---------- */
  // each: { id, t0 (ms), dur (s), fin (fade-in s), fout (s), draw(t, a) } — t = seconds since start, a = 0..1 fade
  var SC = {
    snow: function (lv, light) {
      var n = [0, 90, 190, 380][lv] || 90, L = light ? 0.5 : 1, layers = light ? [[0.45, 1.9, 30, 0.75], [0.55, 3.4, 75, 0.95]] : [[0.4, 1.7, 28, 0.7], [0.38, 2.9, 58, 0.92], [0.22, 4.8, 110, 1]];
      var fl = [], wind = lv >= 3 ? 34 : 18;
      layers.forEach(function (ly, d) { for (var i = 0; i < Math.round(n * ly[0] * L); i++) fl.push({ x: rnd(0, 1), y: rnd(0, 1), r: ly[1] * rnd(0.75, 1.3), v: ly[2] * rnd(0.8, 1.25), a: ly[3] * rnd(0.7, 1), d: d + 1, ph: rnd(0, TAU), sw: rnd(4, 14) * (d + 1) / 2, gl: !light && Math.random() < 0.03 }); });
      return { id: "snow", dur: 30, fin: 2, fout: 5, still: 6, draw: function (t, a) {
        var wx = wind * (t + 2.5 * Math.sin(t * 0.21)), H = ch + 20, Wd = cw + 40;
        if (lv >= 3) { g.fillStyle = "rgba(235,242,255," + (0.07 * a).toFixed(3) + ")"; g.fillRect(0, 0, cw, ch); }
        for (var i = 0; i < fl.length; i++) { var f = fl[i], y = ((f.y * H + f.v * t) % H) - 10, x = ((f.x * Wd + wx * f.d * 0.6 + Math.sin(t * 0.9 + f.ph) * f.sw) % Wd + Wd) % Wd - 20;
          var sp = flake(Math.round(f.r * 2) / 2, f.d === 3), al = f.a * a; if (f.gl) al *= 0.6 + 0.4 * Math.sin(t * 5 + f.ph);
          g.globalAlpha = al; g.drawImage(sp.c, x - sp.s / 2, y - sp.s / 2, sp.s, sp.s); }
        g.globalAlpha = 1;
      } };
    },
    rain: function (lv, light) {
      var n = [0, 80, 170, 320][lv] || 80, dr = [], sp = [], ang = 9 * PI / 180, sx = Math.sin(ang), cy = Math.cos(ang);
      for (var i = 0; i < Math.round(n * (light ? 0.5 : 1)); i++) { var d = Math.random() < 0.6 ? 1 : 2; dr.push({ x: rnd(0, 1), y: rnd(0, 1), v: d === 1 ? rnd(600, 760) : rnd(880, 1080), l: d === 1 ? rnd(14, 20) : rnd(24, 36), a: d === 1 ? 0.6 : 0.85 }); }
      if (!light) for (i = 0; i < 26; i++) sp.push({ x: rnd(0, 1), y: rnd(0.08, 1), ph: rnd(0, 1), f: rnd(1.6, 2.6) });
      return { id: "rain", dur: 30, fin: 2, fout: 4, still: 4, draw: function (t, a) {
        g.fillStyle = "rgba(8,12,26," + (0.14 * a).toFixed(3) + ")"; g.fillRect(0, 0, cw, ch);
        var H = ch + 60; g.lineCap = "round"; g.lineWidth = 2;
        for (var i = 0; i < dr.length; i++) { var q = dr[i], y = (q.y * H + q.v * t) % H - 30, x = ((q.x * (cw + 80) + (y + 30) * sx) % (cw + 80) + cw + 80) % (cw + 80) - 40;   // rainfix I-131: drops move down-right, along their streak (was down-left = sideways slide)
          g.strokeStyle = "rgba(200,215,240," + (q.a * a).toFixed(3) + ")"; g.beginPath(); g.moveTo(x, y); g.lineTo(x - sx * q.l, y - cy * q.l); g.stroke(); }
        for (i = 0; i < sp.length; i++) { var s = sp[i], u = (t * s.f + s.ph) % 1; g.strokeStyle = "rgba(210,225,250," + (0.5 * (1 - u) * a).toFixed(3) + ")"; g.lineWidth = 1;
          g.beginPath(); g.ellipse(s.x * cw, s.y * ch, 2 + 9 * u, (2 + 9 * u) * 0.35, 0, 0, TAU); g.stroke(); }
      } };
    },
    leaves: function (light) {
      var C = [{ c: "#f07a1a" }, { c: "#d8401a", d: "#7a1a06", c0: "#ff8a4a" }, { c: "#f2b81e", d: "#a86a08", c0: "#ffe07a" }, { c: "#a8561e", d: "#5a2808", c0: "#d68a4a" }], lv = [];
      for (var i = 0; i < (light ? 15 : 30); i++) lv.push({ x: rnd(0, 1), y0: rnd(-0.6, 0), v: rnd(50, 85), sw: rnd(18, 40), f: rnd(0.6, 1.1), ph: rnd(0, TAU), s: rnd(18, 30), c: C[i % 4] });
      return { id: "leaves", dur: 10, fin: 0.6, fout: 2.5, still: 4, draw: function (t, a) {
        for (var i = 0; i < lv.length; i++) { var q = lv[i], y = q.y0 * ch + q.v * t, sw = Math.sin(t * q.f * TAU / 2 + q.ph), x = q.x * cw + sw * q.sw + t * 12;
          if (y < -40 || y > ch + 40) continue; var p = W.PNArt && W.PNArt.get("maple", q.s, q.c); if (!p) continue;
          if (!light) { g.globalAlpha = 0.22 * a; g.fillStyle = "rgba(10,10,20,1)"; g.beginPath(); g.ellipse(x + 10, y + 14, q.s * 0.32, q.s * 0.18, 0, 0, TAU); g.fill(); }
          W.PNArt.put(g, p, x, y, sw * 0.7 + q.ph, 1, a, 0.35 + 0.65 * Math.abs(Math.cos(t * q.f + q.ph))); }
        g.globalAlpha = 1;
      } };
    },
    fog: function (light) {
      var k = 1, ly = light ? [[0.6, 8, 0]] : [[0.5, 6, 0], [0.38, 11, 1.7], [0.3, 17, 3.1]];
      return { id: "fog", dur: 20, fin: 3, fout: 0, hold: true, still: 20, draw: function (t, a) {
        var ft = fogTile(), tt = Math.min(t, 20);
        ly.forEach(function (l) { var ox = (tt * l[1] + l[2] * 100) % ft.s, oy = (tt * l[1] * 0.3 + l[2] * 50) % ft.s; g.globalAlpha = l[0] * k * a;
          for (var x = -ox; x < cw; x += ft.s) for (var y = -oy; y < ch; y += ft.s) g.drawImage(ft.c, x, y); });
        // thinner in the middle (the pins and the number read there)
        g.globalAlpha = 1; g.globalCompositeOperation = "destination-out";
        var gr = g.createRadialGradient(cw / 2, ch * 0.45, 0, cw / 2, ch * 0.45, Math.max(cw, ch) * 0.55); gr.addColorStop(0, "rgba(0,0,0,.65)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr; g.fillRect(0, 0, cw, ch); g.globalCompositeOperation = "source-over";
      } };
    }
  };
  function fogOff() { try { if (/[?&]fog=0(&|$)/.test(W.location.search)) return true; var c = (W.PN && W.PN.CFG) || W.OLNU_CONFIG || {}; return c.fog === false || c.fog === 0; } catch (e) { return false; } }

  /* ---------- the loop ---------- */
  function start(sc) {
    if (!sc || !allowed() || !ensure()) return null;
    scenes = scenes.filter(function (x) { return x.id !== sc.id; });
    sc.t0 = W.performance.now(); sc.rm = S().reduced(); scenes.push(sc); stats.scenes++; stats.started.push(sc.id);
    if (sc.rm) { frame(sc.t0); W.setTimeout(function () { stop(sc.id); }, sc.dur * 1000); return sc; }   // one still frame
    if (!raf) { last = 0; raf = W.requestAnimationFrame(frame); }
    return sc;
  }
  function stop(id) {
    scenes = scenes.filter(function (x) { if (id && x.id !== id) return true; stats.ended.push(x.id); return false; });
    if (!scenes.length) { if (raf) W.cancelAnimationFrame(raf); raf = 0; clear(); } else if (!raf) frame(W.performance.now());
  }
  function frame(now) {
    raf = 0;
    if (!g || D.hidden) { scenes = []; clear(); return; }
    var fps = S().light() ? 30 : 60;
    if (last && now - last < 1000 / fps - 2 && scenes.some(function (s) { return !s.rm; })) { raf = W.requestAnimationFrame(frame); return; }
    last = now; stats.frames++;
    if (now - holesAt > 250) readHoles();
    g.setTransform(R, 0, 0, R, 0, 0); g.clearRect(0, 0, cw, ch);
    var live = [];
    scenes.forEach(function (s) {
      var t = s.rm ? s.still : Math.max(0, (now - s.t0) / 1000);   // swfix B9: a frame stamp from before start() = 0
      if (!s.rm && t > s.dur && !s.hold) { stats.ended.push(s.id); return; }
      var a = s.rm ? 1 : cl(t / s.fin) * (s.fout ? cl((s.dur - t) / s.fout) : 1);
      try { s.draw(s.hold ? Math.min(t, s.dur) : t, a); } catch (e) { stats.ended.push(s.id + "!"); return; }
      live.push(s);
    });
    scenes = live;
    punch();
    if (!scenes.length) { clear(); return; }
    // a held scene (fog) is still after its time: no more frames, it stays until the next start / stop
    if (scenes.some(function (s) { return !s.rm && (!s.hold || (now - s.t0) / 1000 < s.dur); })) raf = W.requestAnimationFrame(frame);
  }
  // the map moved: the holes move with the pins (a still scene draws once more)
  function moved() { holesAt = 0; if (scenes.length && !raf) W.requestAnimationFrame(frame); }

  /* ---------- when ---------- */
  function plan(s, force) {
    if (!map || !gl() || !s) return;
    var wx = s.wx || {}, light = S().light(), g2 = [wx.snow, wx.rain, wx.fog, s.map.autumn].join("|");
    if (g2 === sig && !force) return; sig = g2;
    if (!allowed()) { stop(); return; }
    var want = {};
    if (wx.snow) want.snow = SC.snow(wx.snow, light); else if (wx.rain) want.rain = SC.rain(wx.rain, light);
    if (wx.fog && !fogOff()) want.fog = SC.fog(light);
    if (s.map.autumn && !wx.snow && !wx.rain) want.leaves = SC.leaves(light);
    ["snow", "rain", "fog", "leaves"].forEach(function (id) { if (!want[id] && scenes.some(function (x) { return x.id === id; })) stop(id); });
    Object.keys(want).forEach(function (id) { start(want[id]); });
  }
  function boot() {
    if (!map || !S()) return;
    var tries = 0, t = W.setInterval(function () {
      if (gl() && W.GLBARS && W.GLBARS.on && W.GLBARS.on()) { W.clearInterval(t); sig = ""; plan(S().now(), true); }
      else if (++tries > 120) W.clearInterval(t);
    }, 500);
  }
  W.PNSky = {
    // app.js mods() hook: the map is there
    init: function (api) {
      map = api && api.map; if (!map || !S()) return;
      S().on(function (s) { plan(s, false); });
      try { map.on("moveend zoomend resize", moved); } catch (e) {}
      W.addEventListener("resize", function () { if (cv) ensure(); });
      D.addEventListener("visibilitychange", function () { if (D.hidden) { hidAt = Date.now(); stop(); } else if (hidAt && Date.now() - hidAt > 15 * 60e3) { plan(S().now(), true); } });
      D.addEventListener("basemap:change", function () { W.setTimeout(boot, 300); });
      boot();
    },
    start: function (name, a, b) { var f = SC[name]; return f ? !!start(f(a == null ? 2 : a, b == null ? S().light() : b)) : !!(W.PNSkyFx && W.PNSkyFx[name] && start(W.PNSkyFx[name](a, b))); },
    stop: stop,
    add: start,   // js/seasonfw.js: fireworks + northern lights scenes on the same canvas
    ctx: function () { return ensure() ? { g: g, w: cw, h: ch, R: R } : null; },
    holes: function () { readHoles(); return holes.slice(); },
    active: function () { return scenes.map(function (s) { return s.id; }); },
    stats: stats, _sc: SC, _plan: function () { sig = ""; plan(S().now(), true); }
  };
  if (W.PN && W.PN.mod) W.PN.mod("PNSky");
})();
