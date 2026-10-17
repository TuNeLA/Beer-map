/* Öl Nu — tap effects: vibration, generated sound (Web Audio, no files), beer tap effects, HOT/MEDEVAC takeovers, ambient edge glow. Styles: fx.css. */
(function () {
  "use strict";
  var U = window.U;
  var MUTE_KEY = "olnu.mute";
  var ctx = null;

  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
  }
  function muted() { return U.ls.get(MUTE_KEY, "0") === "1"; }
  function setMuted(v) { U.ls.set(MUTE_KEY, v ? "1" : "0"); }

  function vibrate(p) {
    // Before the first tap the browser blocks vibration (and logs an error): skip it then.
    try { if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {}
  }

  // Call inside a user tap. Makes (or wakes) the audio context.
  function unlock() {
    if (muted()) return null;
    try {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === "suspended" && ctx.resume) ctx.resume().catch(function () {});
    } catch (e) { ctx = null; }
    return ctx;
  }
  function ready() { return !muted() && ctx && ctx.state !== "closed" ? ctx : null; }

  function master(c, vol) {
    var g = c.createGain(); g.gain.value = vol; g.connect(c.destination); return g;
  }
  function noiseBuf(c, sec) {
    var len = Math.max(1, Math.floor(c.sampleRate * sec)), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // Bottle opener "pssh": filtered noise burst.
  function pssh(c, at, out) {
    var src = c.createBufferSource(); src.buffer = noiseBuf(c, 0.4);
    var hp = c.createBiquadFilter(); hp.type = "bandpass"; hp.Q.value = 0.8;
    hp.frequency.setValueAtTime(5200, at); hp.frequency.exponentialRampToValueAtTime(1800, at + 0.32);
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.9, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    src.connect(hp); hp.connect(g); g.connect(out);
    src.start(at); src.stop(at + 0.4);
  }
  // Glass clink: a few high sine partials with fast decay.
  function ping(c, at, f, out, vol) {
    [1, 2.76, 5.4].forEach(function (m, i) {
      var o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.value = f * m;
      var v = (vol || 0.35) / (i + 1);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(v, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5 / (i + 1));
      o.connect(g); g.connect(out); o.start(at); o.stop(at + 0.55);
    });
  }
  function whoosh(c, at, out) {
    var src = c.createBufferSource(); src.buffer = noiseBuf(c, 1.0);
    var lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 2;
    lp.frequency.setValueAtTime(300, at); lp.frequency.exponentialRampToValueAtTime(3000, at + 0.5);
    lp.frequency.exponentialRampToValueAtTime(400, at + 0.95);
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.7, at + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.0);
    src.connect(lp); lp.connect(g); g.connect(out); src.start(at); src.stop(at + 1.0);
  }
  function siren(c, at, out) {
    var o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = "triangle"; lp.type = "lowpass"; lp.frequency.value = 2200;
    for (var i = 0; i < 4; i++) {
      o.frequency.setValueAtTime(620, at + i * 0.4);
      o.frequency.linearRampToValueAtTime(940, at + i * 0.4 + 0.2);
      o.frequency.linearRampToValueAtTime(620, at + i * 0.4 + 0.4);
    }
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.28, at + 0.05);
    g.gain.setValueAtTime(0.28, at + 1.45); g.gain.exponentialRampToValueAtTime(0.0001, at + 1.65);
    o.connect(lp); lp.connect(g); g.connect(out); o.start(at); o.stop(at + 1.7);
  }

  // Voice: the phone's own Swedish voice says a random line, with a random "character"
  // (pitch/tempo). Off when sound is muted, or when the phone has no Swedish voice.
  var VOICE_LINES = [
    // Spelled the way it sounds in dalmål, so the phone voice says it with a Dalarna touch.
    "Skååål!", "Skål på däj!", "Hörrö du, skål då!", "Nu jäklar ä dä fest. Skål!", "Ja men skål för sjutton!",
    "Ner mä'n!", "Botten opp, pojk!", "Dä ä la klart vi ska ha en öl!", "En te, en te!",
    "Int' kan man la säj nej?", "Dä hära ska firas. Skål!", "Nu går ä undan i byn!",
    "Ja ja, dä ä bra dä. Skål!", "Gutår, gutår!", "Ja men ta mäj tusan. Skål!", "Skål, å drick lite vatten no.",
    "Hej å hå, nu bär ä i väg!", "Såntdära gillar vi i Dalarna. Skål!", "Kalasbra dä hära. Skål!", "Va gör du då? Skål!",
    "Int' sitt hemma no, kom ut!", "Dä ä fredag i hela kroppen. Skål!", "Ölen ä din bäste kompis. Skål!", "Nu ä dä slut på vattnet. Skål!"
  ];
  var VOICES = [
    { rate: 1.15, pitch: 0.7 },   // sergeanten
    { rate: 0.8, pitch: 0.55 },   // gubben från Dalarna
    { rate: 1.0, pitch: 1.0 },    // nyhetsuppläsaren
    { rate: 1.25, pitch: 1.5 },   // den glada
    { rate: 0.9, pitch: 1.2 }     // den lugna
  ];
  var lastVoiceLine = -1;
  function svVoice() {
    try {
      var vs = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      for (var i = 0; i < vs.length; i++) if (/^sv/i.test(vs[i].lang)) return vs[i];
    } catch (e) {}
    return null;
  }
  try { if (window.speechSynthesis) window.speechSynthesis.getVoices(); } catch (e) {}
  function say() {
    if (muted() || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    var v = svVoice(); if (!v) return;
    var i = Math.floor(Math.random() * VOICE_LINES.length);
    if (i === lastVoiceLine) i = (i + 1) % VOICE_LINES.length;
    lastVoiceLine = i;
    var ch = VOICES[Math.floor(Math.random() * VOICES.length)];
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(VOICE_LINES[i]);
      u.voice = v; u.lang = v.lang; u.rate = ch.rate; u.pitch = ch.pitch; u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  var sound = {
    beer: function () {
      var c = ready(); if (!c) return;
      try {
        var out = master(c, 0.55), t0 = c.currentTime + 0.02;
        pssh(c, t0, out); ping(c, t0 + 0.28, 2350, out); ping(c, t0 + 0.4, 2900, out, 0.28);
      } catch (e) {}
      setTimeout(say, 650);
    },
    clink: function () {
      var c = ready(); if (!c) return;
      try { var out = master(c, 0.5), t0 = c.currentTime + 0.01; ping(c, t0, 2600, out); ping(c, t0 + 0.09, 3150, out, 0.25); } catch (e) {}
    },
    hot: function () {
      var c = ready(); if (!c) return;
      try { var out = master(c, 0.5); whoosh(c, c.currentTime + 0.02, out); } catch (e) {}
    },
    medevac: function () {
      var c = ready(); if (!c) return;
      try { var out = master(c, 0.5); siren(c, c.currentTime + 0.02, out); } catch (e) {}
    }
  };

  /* ================= Visual effects (styles in fx.css) ================= */
  var DOC = document.documentElement;
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pickOne(list) { return list[Math.floor(Math.random() * list.length)]; }
  // Random pick from a list, never the same name twice in a row (remembered on this phone).
  var LAST_KEY = "olnu.fxLast";
  function pickNoRepeat(slot, list) {
    var last = U.ls.getJSON(LAST_KEY, {}) || {};
    var opts = list.filter(function (v) { return v !== last[slot]; });
    var v = pickOne(opts.length ? opts : list);
    last[slot] = v; U.ls.setJSON(LAST_KEY, last);
    return v;
  }
  function mk(cls, parent, html) {
    var d = document.createElement("div"); d.className = cls;
    if (html) d.innerHTML = html;
    if (parent) parent.appendChild(d);
    return d;
  }
  function centerOf(id) {
    var b = document.getElementById(id);
    if (b) { var r = b.getBoundingClientRect(); if (r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    return { x: window.innerWidth / 2, y: window.innerHeight - 110 };
  }
  // Pause CSS effects while the page is hidden (rAF stops by itself).
  document.addEventListener("visibilitychange", function () { DOC.classList.toggle("fx-hidden", document.hidden); });

  /* ---------- Canvas particle system: glow sprites, additive blend, max 250, stops itself ---------- */
  var MAXP = 250, sprites = null;
  function sprite(r, g, b, core) {
    var c = document.createElement("canvas"); c.width = c.height = 64;
    var x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(" + r + "," + g + "," + b + ",1)");
    gr.addColorStop(core, "rgba(" + r + "," + g + "," + b + ",.45)");
    gr.addColorStop(1, "rgba(" + r + "," + g + "," + b + ",0)");
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return c;
  }
  function getSprites() {
    // 0 white-hot, 1 yellow, 2 orange, 3 red, 4 ember (small bright core)
    if (!sprites) sprites = [sprite(255, 244, 200, .3), sprite(255, 196, 60, .35), sprite(255, 112, 18, .4), sprite(200, 34, 8, .45), sprite(255, 210, 120, .15)];
    return sprites;
  }
  // cfg: {emitFor: s, emit(ps, dt, t, W, H, room)}. Particle: x y vx vy ax ay drag life size grow a c (sprite or -1 = by age) k (1 = orbit)
  function particles(host, cfg) {
    var cv = document.createElement("canvas"); cv.className = "fx-cv"; cv.setAttribute("aria-hidden", "true");
    host.appendChild(cv);
    var W = window.innerWidth, H = window.innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    // Soft glow sprites look the same at 1 canvas px per CSS px: half the pixels to fill on 2x phones (big fps win).
    dpr = Math.min(dpr, 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var g = cv.getContext("2d"), sp = getSprites(), ps = [], t0 = performance.now(), last = t0, raf = 0, dead = false;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    function stop() { dead = true; cancelAnimationFrame(raf); if (cv.parentNode) cv.remove(); }
    function frame(now) {
      if (dead || !cv.isConnected) { stop(); return; }
      var dt = Math.min(0.05, (now - last) / 1000), t = (now - t0) / 1000; last = now;
      if (t < cfg.emitFor && ps.length < MAXP) cfg.emit(ps, dt, t, W, H, MAXP - ps.length);
      g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = "lighter";
      for (var i = ps.length - 1; i >= 0; i--) {
        var p = ps[i]; p.age += dt;
        if (p.age >= p.life) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
        var f = p.age / p.life;
        if (p.k === 1) { // orbit (flame tornado)
          p.th += p.w * dt; p.y += p.vy * dt;
          var r = p.r0 + (H - p.y) * 0.4, cx = p.cx(t);
          p.x = cx + Math.cos(p.th) * r;
          var depth = 0.55 + 0.45 * Math.sin(p.th);
          var s1 = p.size * (1 + p.grow * f) * (0.7 + 0.3 * depth);
          g.globalAlpha = p.a * (1 - f) * depth;
          g.drawImage(sp[f < .2 ? 1 : f < .6 ? 2 : 3], p.x - s1 / 2, p.y - s1 / 2, s1, s1);
          continue;
        }
        if (p.drag) { var k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; }
        p.vx += (p.ax || 0) * dt; p.vy += (p.ay || 0) * dt;
        if (p.wob) p.vx += Math.sin(t * p.wob + p.ph) * 40 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        var s = p.size * (1 + p.grow * f);
        if (s < 0.5) continue;
        var a = p.a * (1 - f);
        if (p.c === 4) a *= 0.65 + 0.35 * Math.sin(t * 30 + p.ph); // ember flicker
        g.globalAlpha = a > 1 ? 1 : a;
        var h = s * (p.st || 1); // flames are drawn taller than wide
        g.drawImage(sp[p.c >= 0 ? p.c : f < .18 ? 0 : f < .42 ? 1 : f < .72 ? 2 : 3], p.x - s / 2, p.y - h * 0.6, s, h);
      }
      if (t >= cfg.emitFor && !ps.length) { stop(); return; }
      if (t > cfg.emitFor + 4) { stop(); return; } // hard stop
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return stop;
  }
  // Emission helper: n per second, fractional carry.
  function rate(st, perSec, dt, room) { st.acc = (st.acc || 0) + perSec * dt; var n = Math.floor(st.acc); st.acc -= n; return Math.min(n, room); }
  function flame(x, y, o) {
    o = o || {};
    return { x: x, y: y, vx: rnd(-25, 25), vy: -rnd(o.v0 || 140, o.v1 || 300), ay: -rnd(20, 80), age: 0, life: rnd(o.l0 || .7, o.l1 || 1.4),
      size: rnd(o.s0 || 28, o.s1 || 70), grow: -0.6, a: o.a || 0.75, c: -1, ph: Math.random() * 6, st: o.st || 1.6 };
  }
  function ember(x, y, o) {
    o = o || {};
    return { x: x, y: y, vx: rnd(-60, 60), vy: -rnd(o.v0 || 160, o.v1 || 420), ay: o.ay || -20, age: 0, life: rnd(o.l0 || 1.4, o.l1 || 2.6),
      size: rnd(o.s0 || 4, o.s1 || 9), grow: -0.3, a: 1, c: 4, wob: rnd(2, 5), ph: Math.random() * 6 };
  }

  /* ---------- HOT STREAK variants ---------- */
  var HOT = {
    // (a) Flames rise from the whole bottom edge, edges glow.
    wall: function (el, L) {
      mk("fx-edges", L, "<i class=\"e-b\"></i><i class=\"e-l\"></i><i class=\"e-r\"></i><i class=\"e-t\"></i>");
      var st = {}, se = {};
      return particles(L, { emitFor: 3.6, emit: function (ps, dt, t, W, H, room) {
        var ramp = Math.min(1, 0.35 + t), n = rate(st, 190 * ramp, dt, room);
        for (var i = 0; i < n; i++) ps.push(flame(Math.random() * W, H + 20, { v0: 160 + H * 0.12, v1: 300 + H * 0.2 }));
        n = rate(se, 22, dt, MAXP - ps.length);
        for (i = 0; i < n; i++) ps.push(ember(Math.random() * W, H - rnd(0, 120)));
      } });
    },
    // (b) Inferno: heat shimmer on the map + embers all over.
    inferno: function (el, L) {
      mk("fx-edges soft", L, "<i class=\"e-b\"></i><i class=\"e-l\"></i><i class=\"e-r\"></i>");
      mk("fx-heat", L);
      DOC.classList.add("fx-shimmer");
      var st = {}, sf = {};
      var stop = particles(L, { emitFor: 3.8, emit: function (ps, dt, t, W, H, room) {
        var n = rate(st, 75, dt, room);
        for (var i = 0; i < n; i++) ps.push(ember(Math.random() * W, H * rnd(0.35, 1.05), { v0: 50, v1: 220, l0: 2, l1: 3.2, s0: 3, s1: Math.random() < .15 ? 16 : 8 }));
        n = rate(sf, 60, dt, MAXP - ps.length);
        for (i = 0; i < n; i++) ps.push(flame(Math.random() * W, H + 30, { v0: 60, v1: 140, s0: 40, s1: 90, a: 0.45, l0: 1, l1: 1.8 }));
      } });
      return function () { DOC.classList.remove("fx-shimmer"); stop(); };
    },
    // (c) Fireball from the ÖL! button: blast, shockwave rings, screen shake.
    fireball: function (el, L) {
      var c = centerOf("btn-beer");
      var sh = mk("fx-shock", L, "<i></i><i></i><i class=\"core\"></i>");
      sh.style.left = c.x + "px"; sh.style.top = c.y + "px";
      el.classList.add("fx-shake"); DOC.classList.add("fx-shaking");
      var tm = setTimeout(function () { el.classList.remove("fx-shake"); DOC.classList.remove("fx-shaking"); }, 700);
      var burst = false, st = {};
      var stop = particles(L, { emitFor: 3.4, emit: function (ps, dt, t, W, H, room) {
        if (!burst) {
          burst = true;
          var sc = Math.max(W, H) / 700;
          for (var i = 0; i < Math.min(170, room); i++) {
            var a = rnd(-Math.PI, 0.15) - (Math.random() < .2 ? Math.PI * .1 : 0), v = rnd(250, 1000) * sc;
            ps.push({ x: c.x, y: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: -60, drag: 2.4, age: 0, life: rnd(.6, 1.4),
              size: rnd(20, 64), grow: 1.1, a: 0.85, c: -1, ph: 0 });
          }
          for (i = 0; i < 30 && ps.length < MAXP; i++) {
            var b = rnd(-Math.PI, 0), w = rnd(300, 700) * sc;
            ps.push({ x: c.x, y: c.y, vx: Math.cos(b) * w, vy: Math.sin(b) * w, ay: 380, drag: 1, age: 0, life: rnd(1.4, 2.4), size: rnd(4, 8), grow: -.4, a: 1, c: 4, ph: Math.random() * 6 });
          }
          return;
        }
        if (t > 0.5) {
          var n = rate(st, 45, dt, room);
          for (var j = 0; j < n; j++) ps.push(flame(c.x + rnd(-40, 40), c.y + 20, { v0: 80, v1: 200, s0: 20, s1: 50, l0: .6, l1: 1.1 }));
        }
      } });
      return function () { clearTimeout(tm); DOC.classList.remove("fx-shaking"); stop(); };
    },
    // (d) The title letters catch fire one by one.
    burn: function (el, L) {
      var letters = el.querySelectorAll(".to-title .bl"), rects = null;
      function measure() { // once, after the title slam animation (.45 s)
        rects = [];
        for (var i = 0; i < letters.length; i++) {
          var r = letters[i].getBoundingClientRect();
          if (r.width > 4) rects.push({ x: r.left, y: r.top + r.height * 0.15, w: r.width, at: 0.5 + (+letters[i].style.getPropertyValue("--i") || i) * 0.12 });
        }
      }
      mk("fx-edges soft", L, "<i class=\"e-b\"></i>");
      var st = {}, sb = {};
      return particles(L, { emitFor: 4, emit: function (ps, dt, t, W, H, room) {
        if (!rects) { if (t < 0.5) return; measure(); }
        var lit = 0; for (var k = 0; k < rects.length; k++) if (t >= rects[k].at) lit++;
        var n = rate(st, 26 * lit, dt, room);
        for (var j = 0; j < n; j++) {
          var R = rects[Math.floor(Math.random() * lit)]; if (!R) break;
          ps.push(flame(R.x + Math.random() * R.w, R.y + rnd(0, 18), { v0: 60, v1: 150, s0: 12, s1: 34, l0: .45, l1: .9, a: .8 }));
        }
        n = rate(sb, 70, dt, MAXP - ps.length);
        for (j = 0; j < n; j++) ps.push(flame(Math.random() * W, H + 20, { s0: 24, s1: 50, a: .6 }));
      } });
    },
    // (e) Lava cracks spread from the middle, embers rise from them.
    lava: function (el, L) {
      var W = window.innerWidth, H = window.innerHeight, cx = W / 2, cy = H * 0.55, pts = [], d = "";
      var n = 7 + Math.floor(Math.random() * 3), reach = Math.hypot(W, H) * 0.6;
      for (var i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2 + rnd(-.25, .25), x = cx, y = cy, seg = "M" + x.toFixed(0) + " " + y.toFixed(0), len = 0;
        while (len < reach) {
          a += rnd(-.5, .5); var s = rnd(30, 70); x += Math.cos(a) * s; y += Math.sin(a) * s; len += s;
          seg += " L" + x.toFixed(0) + " " + y.toFixed(0);
          if (Math.random() < .45) pts.push({ x: x, y: y, d: len / reach });
          if (Math.random() < .12) { // short branch
            var bx = x + Math.cos(a + 1) * 45, by = y + Math.sin(a + 1) * 45;
            seg += " M" + bx.toFixed(0) + " " + by.toFixed(0) + " L" + x.toFixed(0) + " " + y.toFixed(0);
          }
        }
        d += '<path class="lg" d="' + seg + '"/><path class="lc" d="' + seg + '"/>'; // one path per crack: all grow at once
      }
      var svg = mk("fx-lava", L, '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none">' + d + "</svg>");
      svg.style.setProperty("--len", Math.ceil(reach + 200) + "px");
      el.classList.add("fx-shake"); DOC.classList.add("fx-shaking");
      var tm = setTimeout(function () { el.classList.remove("fx-shake"); DOC.classList.remove("fx-shaking"); }, 700);
      var st = {};
      var stop = particles(L, { emitFor: 3.8, emit: function (ps, dt, t, W2, H2, room) {
        var open = Math.min(1, t / 1.3), cand = pts.filter(function (p) { return p.d <= open; });
        if (!cand.length) return;
        var k = rate(st, 90, dt, room);
        for (var j = 0; j < k; j++) {
          var p = pickOne(cand);
          ps.push(Math.random() < .6 ? ember(p.x, p.y, { v0: 40, v1: 200, l0: 1, l1: 2 }) : flame(p.x, p.y, { v0: 40, v1: 120, s0: 18, s1: 40, l0: .5, l1: 1 }));
        }
      } });
      return function () { clearTimeout(tm); DOC.classList.remove("fx-shaking"); stop(); };
    },
    // (f) A flame tornado spins up through the middle of the screen.
    tornado: function (el, L) {
      mk("fx-edges soft", L, "<i class=\"e-b\"></i><i class=\"e-l\"></i><i class=\"e-r\"></i>");
      var W = window.innerWidth, base = W / 2, sway = W * 0.13, st = {}, dir = Math.random() < .5 ? 1 : -1;
      var cx = function (t) { return base + Math.sin(t * 1.4) * sway; };
      return particles(L, { emitFor: 3.8, emit: function (ps, dt, t, W2, H, room) {
        var n = rate(st, 170 * Math.min(1, 0.3 + t * 0.8), dt, room);
        for (var i = 0; i < n; i++) {
          var vy = -rnd(260, 460);
          ps.push({ k: 1, x: base, y: H + 10, vy: vy, th: Math.random() * 6.3, w: dir * rnd(5, 8), r0: rnd(14, 40), cx: cx,
            age: 0, life: (H + 40) / -vy, size: rnd(22, 48), grow: -0.2, a: 0.8 });
        }
      } });
    }
  };
  var HOT_LIST = ["wall", "inferno", "fireball", "burn", "lava", "tornado"];

  /* ---------- MEDEVAC variants (soft sweeps and pulses, never > 2 Hz, no white strobe) ---------- */
  function heli(L) {
    var h = mk("fx-heli" + (Math.random() < .5 ? " rtl" : ""), L, "<span>🚁</span>");
    h.style.top = rnd(10, 26).toFixed(0) + "%";
    return h;
  }
  var MED = {
    // Light bar across the top, red and blue sides glow in turn.
    lightbar: function (el, L) {
      mk("fx-glow2", L, '<i class="g-r"></i><i class="g-b"></i>');
      var bar = "";
      for (var i = 0; i < 8; i++) bar += '<i class="' + (i < 4 ? "r" : "b") + '"></i>';
      mk("fx-lbar", L, bar);
      heli(L);
    },
    // Rotating beacons in the two top corners.
    beacons: function (el, L) {
      mk("fx-beacon r", L, "<i></i>"); mk("fx-beacon b", L, "<i></i>");
      mk("fx-glow2 low", L, '<i class="g-r"></i><i class="g-b"></i>');
      heli(L);
    },
    // A searchlight sweeps over the map from the helicopter, soft edge pulses.
    searchlight: function (el, L) {
      mk("fx-search", L, "<i></i>");
      mk("fx-glow2 low", L, '<i class="g-r"></i><i class="g-b"></i>');
      heli(L);
    },
    // Emergency stripes slide along the top and bottom, side pulses.
    stripes: function (el, L) {
      mk("fx-stripes t", L, "<i></i>"); mk("fx-stripes b", L, "<i></i>");
      mk("fx-glow2", L, '<i class="g-r"></i><i class="g-b"></i>');
      heli(L);
    }
  };
  var MED_LIST = ["lightbar", "beacons", "searchlight", "stripes"];

  /* ---------- Ambient: edge glow over the map, under HUD and dock ---------- */
  var AMB_MS = { 1: 3 * 60e3, 2: 5 * 60e3 }, amb = null;
  function ambientStop(fast) {
    if (!amb) return;
    var a = amb; amb = null; clearTimeout(a.timer);
    if (fast) { a.el.remove(); return; }
    a.el.classList.add("out");
    setTimeout(function () { a.el.remove(); }, 1600);
  }
  function ambient(level, ms) {
    level = level | 0;
    if (!level) { ambientStop(); return; }
    ms = ms > 0 ? ms : AMB_MS[level] || 60e3;
    var end = Date.now() + ms;
    if (amb && amb.level > level) return;          // keep the bigger one
    if (amb && amb.level === level) { if (end > amb.end) { amb.end = end; clearTimeout(amb.timer); amb.timer = setTimeout(function () { ambientStop(); }, ms); } return; }
    ambientStop(true);
    var el = document.createElement("div");
    el.className = "fx-amb " + (level === 2 ? "amb-med" : "amb-hot") + (reduced() ? " still" : "");
    el.setAttribute("aria-hidden", "true");
    var h;
    if (level === 2) h = '<i class="a-l"></i><i class="a-r"></i><i class="a-sweep"></i>';
    else {
      h = '<i class="a-b"></i><i class="a-l"></i><i class="a-r"></i><i class="a-t"></i>';
      if (!reduced()) for (var i = 0; i < 7; i++)
        h += '<b style="left:' + rnd(3, 97).toFixed(1) + "%;--d:" + rnd(4, 7.5).toFixed(2) + "s;--w:" + rnd(-30, 30).toFixed(0) + "px;animation-delay:-" + rnd(0, 7).toFixed(2) + 's"></b>';
    }
    el.innerHTML = h;
    document.body.appendChild(el);
    amb = { el: el, level: level, end: end, timer: setTimeout(function () { ambientStop(); }, ms) };
  }

  /* ---------- Night memory: when HOT / MEDEVAC was first reached tonight ---------- */
  var REACH_KEY = "olnu.fxReached";
  function nightKey() { try { return U.next5am().toISOString().slice(0, 10); } catch (e) { return ""; } }
  function reachedGet() {
    var r = U.ls.getJSON(REACH_KEY, null), k = nightKey();
    if (!r || r.night !== k) r = { night: k, hot: 0, med: 0 };
    return r;
  }
  function markReached(level) { // returns the earlier time if there was one (else 0)
    var r = reachedGet(), f = level === 2 ? "med" : "hot", old = r[f] || 0;
    if (!old) { r[f] = Date.now(); if (level === 2 && !r.hot) r.hot = r.med; U.ls.setJSON(REACH_KEY, r); }
    return old;
  }

  /* ---------- Full-screen takeover. level 1 = HOT STREAK, 2 = MEDEVAC ----------
     opts: {title, sub, hint, extraHTML, ms, variant (test), noAmbient (test)} */
  var current = null, lastTk = { level: 0, at: 0 };
  function takeover(level, opts) {
    opts = opts || {};
    level = level === 2 ? 2 : 1;
    if (current) current.kill(true);
    var rm = reduced(), list = level === 2 ? MED_LIST : HOT_LIST;
    var variant = list.indexOf(opts.variant) >= 0 ? opts.variant : pickNoRepeat(level === 2 ? "med" : "hot", list);
    var el = document.createElement("div");
    el.className = "takeover fx-tk " + (level === 2 ? "tk-medevac" : "tk-hot") + " fxv-" + variant + (rm ? " still" : "");
    el.setAttribute("role", "alert");
    var title = String(opts.title || "");
    var titleHTML = U.esc(title);
    if (variant === "burn" && !rm) {
      var ci = 0;
      titleHTML = title.split(" ").map(function (w) {
        var h = Array.from(w).map(function (ch) { return '<span class="bl" style="--i:' + (ci++) + '">' + U.esc(ch) + "</span>"; }).join("");
        ci++;
        return '<span class="bw">' + h + "</span>";
      }).join(" ");
    }
    el.innerHTML = '<div class="fx-layer" aria-hidden="true"></div>' +
      '<div class="to-core"><div class="to-icon" aria-hidden="true">' + (level === 2 ? "🚁" : "🔥") + "</div>" +
      '<div class="to-title">' + titleHTML + "</div>" +
      '<div class="to-sub">' + U.esc(opts.sub || "") + "</div>" +
      // extraHTML: trusted HTML built by the app (e.g. taxi buttons). Its links work; a tap elsewhere closes.
      (opts.extraHTML ? '<div class="to-extra">' + opts.extraHTML + "</div>" : "") +
      '<div class="to-hint">' + U.esc(opts.hint || "") + "</div></div>";
    document.body.appendChild(el);
    var layer = el.firstChild, cleanup = null;
    if (rm) mk("fx-still-glow", layer);
    else {
      try { cleanup = (level === 2 ? MED : HOT)[variant](el, layer); } catch (e) { cleanup = null; }
    }
    var closed = false, timer = 0;
    function kill(now) {
      if (closed) return; closed = true; clearTimeout(timer);
      if (typeof cleanup === "function") { try { cleanup(); } catch (e) {} }
      if (current === ctl) current = null;
      if (now) el.remove();
      else { el.classList.add("out"); setTimeout(function () { el.remove(); }, 260); }
    }
    function done() {
      if (closed) return;
      kill(false);
      if (!opts.noAmbient) ambient(level, AMB_MS[level]);
    }
    var ctl = { el: el, kill: kill };
    el.addEventListener("click", done);
    current = ctl;
    var dur = Math.max(opts.ms || 0, level === 2 ? 5200 : 4300);
    timer = setTimeout(done, dur);
    lastTk = { level: level, at: Date.now() };
    if (!opts.noAmbient) markReached(level);
    if (level === 2) { vibrate([200, 80, 200, 80, 400]); sound.medevac(); }
    else { vibrate([120, 60, 120, 60, 240]); sound.hot(); }
    return variant;
  }

  /* ---------- Small effects for a normal beer (own ÖL! tap), < 1 s ---------- */
  function boxAt(anchor, cls) {
    var r = anchor.getBoundingClientRect(), box = document.createElement("div");
    box.className = "foam-splash " + cls; box.setAttribute("aria-hidden", "true");
    box.style.left = (r.left + r.width / 2) + "px"; box.style.top = (r.top + r.height / 2) + "px";
    return { box: box, r: r };
  }
  function foam(anchor) {
    var b = boxAt(anchor, ""), box = b.box;
    var ring = document.createElement("span"); ring.className = "foam-ring"; box.appendChild(ring);
    for (var i = 0; i < 14; i++) {
      var d = document.createElement("span"); d.className = "foam-drop";
      var a = (-160 + Math.random() * 140) * Math.PI / 180, dist = 60 + Math.random() * 70, s = 6 + Math.random() * 10;
      d.style.setProperty("--dx", (Math.cos(a) * dist).toFixed(1) + "px");
      d.style.setProperty("--dy", (Math.sin(a) * dist).toFixed(1) + "px");
      d.style.width = d.style.height = s.toFixed(1) + "px";
      d.style.animationDelay = (Math.random() * 60).toFixed(0) + "ms";
      box.appendChild(d);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 1000);
  }
  function bubbles(anchor) {
    var b = boxAt(anchor, "fx-bub"), box = b.box, w = b.r.width || 100;
    for (var i = 0; i < 12; i++) {
      var d = document.createElement("span"), s = rnd(6, 16);
      d.style.width = d.style.height = s.toFixed(1) + "px";
      d.style.left = rnd(-w * 0.35, w * 0.35).toFixed(0) + "px";
      d.style.setProperty("--rise", (-rnd(90, 190)).toFixed(0) + "px");
      d.style.setProperty("--sw", rnd(-24, 24).toFixed(0) + "px");
      d.style.animationDelay = rnd(0, 180).toFixed(0) + "ms";
      box.appendChild(d);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 1000);
  }
  function clinkFx(anchor) {
    var b = boxAt(anchor, "fx-clink"), box = b.box;
    var h = '<span class="mugs">🍻</span>';
    for (var i = 0; i < 8; i++) h += '<i style="--a:' + (i * 45 + rnd(-10, 10)).toFixed(0) + 'deg"></i>';
    box.innerHTML = h;
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 950);
  }
  var BEER_FX = { foam: foam, bubbles: bubbles, clink: clinkFx };
  function splash(anchor, kind) {
    if (!anchor || reduced()) return;
    var fn = BEER_FX[kind] || BEER_FX[pickNoRepeat("beer", ["foam", "bubbles", "clink"])];
    fn(anchor);
  }

  /* ---------- Watch #my-streak (class " hot" / " medevac" set by app.js) ---------- */
  var LOAD_AT = Date.now(), seenLevel = 0;
  function streakLevel(st) {
    if (!st || st.hidden) return 0;
    return st.classList.contains("medevac") ? 2 : st.classList.contains("hot") ? 1 : 0;
  }
  function onStreak(st) {
    var L = streakLevel(st);
    if (L === seenLevel) return;
    var prev = seenLevel; seenLevel = L;
    if (L < prev) { if (amb && amb.level > L) { ambientStop(); if (L) ambient(L, 10000); } return; }
    if (!L) return;
    // A takeover for this level just ran (or is about to): it starts the long ambient itself.
    setTimeout(function () {
      if (seenLevel !== L) return;
      if (lastTk.level >= L && Date.now() - lastTk.at < 20000) return;
      var old = markReached(L), win = AMB_MS[L], ms;
      if (old) ms = Math.max(10000, old + win - Date.now());       // reached earlier tonight (app reopened)
      else ms = Date.now() - LOAD_AT < 20000 ? 10000 : win;        // first seen right after open / new now
      ambient(L, ms);
    }, 1200);
  }
  function watch() {
    var st = document.getElementById("my-streak");
    if (!st || !window.MutationObserver) return;
    new MutationObserver(function () { onStreak(st); }).observe(st, { attributes: true, attributeFilter: ["class", "hidden"] });
    onStreak(st);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();

  window.FX = { vibrate: vibrate, unlock: unlock, sound: sound, splash: splash, takeover: takeover,
    muted: muted, setMuted: setMuted, reduced: reduced, say: say,
    ambient: ambient, ambientStop: ambientStop,
    variants: { 1: HOT_LIST.slice(), 2: MED_LIST.slice(), beer: ["foam", "bubbles", "clink"] } };
})();
