/* PintsNow juice: the feel of a tap. Extends window.FX (fx.js) as FX.juice; styles in juice.css.
   - Sound engine: one Web Audio context, one master volume + limiter (never loud), short sounds made in code here
     (self-made, no files, no licence issue), rendered once into buffers. Off when "Ljud" is off (FX.muted) or the page is hidden.
     iPhone: navigator.audioSession.type = "ambient" -> mixes with the user's music and follows the silent switch.
   - Voice: short Swedish clips (docs/audio/voice/*.mp3, Piper TTS voice sv_SE-nst, CC0 model + CC0 NST data, see docs/audio/LICENSE.txt),
     played through Web Audio (so the silent switch and the master volume apply). No clips (offline) -> the best sv-SE phone voice
     with calm rate/pitch, but never on iPhone (its speech ignores the silent switch). Switch "Röst" (olnu.voice).
   - Haptics per action on Android only (navigator.vibrate); iPhone keeps fx.js's switch tick. Switch "Vibration" (olnu.vib).
   - ÖL! press: squash-and-stretch on the button + a foam/bubble burst on a small canvas (max 40 particles, 600 ms).
     No canvas -> fx.js CSS splash (transform only). Reduced motion -> no motion at all.
   API: FX.juice.press(btn) / accepted(level, big) / error() / play(name) / haptic(name) / say() / stats. */
(function () {
  "use strict";
  var FX = window.FX, U = window.U;
  if (!FX || FX.juice) return;
  var VOICE_KEY = "olnu.voice", VIB_KEY = "olnu.vib", MASTER = 0.5, MAXP = 40, BURST_MS = 600;
  var stats = { played: {}, skipped: 0, voice: { clip: 0, tts: 0 }, haptics: [], particles: 0, frames: 0, maxFrameMs: 0, sumFrameMs: 0, presses: 0 };

  function lsGet(k, d) { try { return U.ls.get(k, d); } catch (e) { return d; } }
  function lsSet(k, v) { try { U.ls.set(k, v); } catch (e) {} }
  function isIOS() { try { return U && U.isIOS ? U.isIOS() : /iPad|iPhone|iPod/.test(navigator.userAgent || ""); } catch (e) { return false; } }
  function isAndroid() { return /Android/i.test(navigator.userAgent || ""); }
  function muted() { try { return FX.muted(); } catch (e) { return false; } }
  function reduced() { try { return FX.reduced(); } catch (e) { return false; } }
  function voiceOn() { return lsGet(VOICE_KEY, "1") !== "0"; }
  function vibOn() { return lsGet(VIB_KEY, "1") !== "0"; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function sv() { return !window.I18N || window.I18N.lang !== "en"; }

  /* ================= Sound engine ================= */
  var ctx = null, out = null, bufs = {};
  function unlock() {
    if (muted()) return null;
    try {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        // iOS 17+: mix with other audio (music keeps playing) and follow the ring/silent switch
        try { if (navigator.audioSession) navigator.audioSession.type = "ambient"; } catch (e) {}
        ctx = new AC();
        var lim = ctx.createDynamicsCompressor();   // a soft limiter: no sound can get loud
        lim.threshold.value = -12; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.12;
        out = ctx.createGain(); out.gain.value = MASTER;
        out.connect(lim); lim.connect(ctx.destination);
        setTimeout(warm, 400);
      }
      if (ctx.state === "suspended" && ctx.resume) ctx.resume().catch(function () {});
    } catch (e) { ctx = null; }
    return ctx;
  }
  // Sound recipes: (sample rate) -> Float32Array. Made here, peak ~0.5.
  function env(t, a, tau) { return t < a ? t / a : Math.exp(-(t - a) / tau); }
  function bubble(d, sr, at, f0, amp) {   // one "blip": a sine with a rising pitch and a fast decay (Minnaert bubble)
    var damp = (0.13 * f0 + 0.0072 * Math.pow(f0, 1.5)) * 0.45, i0 = Math.floor(at * sr), n = Math.min(d.length - i0, Math.floor(sr * 6 / damp)), ph = 0;
    for (var i = 0; i < n; i++) { var t = i / sr; ph += 2 * Math.PI * f0 * (1 + 0.1 * damp * t) / sr; d[i0 + i] += amp * Math.sin(ph) * Math.exp(-damp * t) * Math.min(1, t * 4000); }
  }
  function strike(d, sr, at, f0, amp, long) {   // glass: inharmonic partials, a beating pair, a tiny hit click
    var R = [1, 1.0045, 2.61, 4.81, 7.42], A = [1, 0.55, 0.42, 0.22, 0.1], T = [0.42, 0.4, 0.2, 0.09, 0.05], i0 = Math.floor(at * sr);
    for (var p = 0; p < R.length; p++) {
      var f = f0 * R[p], w = 2 * Math.PI * f / sr, tau = T[p] * (long || 1);
      if (f > sr / 2.2) continue;
      for (var i = 0; i0 + i < d.length; i++) { var e = Math.exp(-i / sr / tau); if (e < 0.001) break; d[i0 + i] += amp * A[p] * e * Math.sin(w * i) * Math.min(1, i / (sr * 0.0008)); }
    }
    for (var k = 0; k < sr * 0.003 && i0 + k < d.length; k++) d[i0 + k] += amp * 0.25 * (Math.random() * 2 - 1) * (1 - k / (sr * 0.003));
  }
  function norm(d, peak) {
    var m = 0, i; for (i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    if (m > 0) for (i = 0; i < d.length; i++) d[i] *= peak / m;
    var f = Math.floor(d.length * 0.08); for (i = 0; i < f; i++) d[d.length - 1 - i] *= i / f;   // soft tail end
    return d;
  }
  var RECIPES = {
    tap: function (sr) {   // ÖL! press: a cap "pok" + a short hiss + a few bubbles (220 ms)
      var d = new Float32Array(Math.floor(sr * 0.22)), ph = 0, hp = 0, lp = 0, prev = 0;
      for (var i = 0; i < d.length; i++) {
        var t = i / sr, f = 180 + 720 * Math.exp(-t / 0.012);
        ph += 2 * Math.PI * f / sr; d[i] += 0.7 * Math.sin(ph) * env(t, 0.001, 0.014);
        var n = Math.random() * 2 - 1; hp = 0.82 * (hp + n - prev); prev = n; lp += 0.5 * (hp - lp);
        if (t > 0.008) d[i] += 0.32 * lp * env(t - 0.008, 0.004, 0.05);
      }
      for (var b = 0; b < 4; b++) bubble(d, sr, rnd(0.05, 0.17), rnd(900, 2200), 0.12);
      return norm(d, 0.5);
    },
    fizz: function (sr) {   // carbonation: many tiny bubbles, fading (550 ms)
      var d = new Float32Array(Math.floor(sr * 0.55));
      for (var b = 0; b < 30; b++) { var at = 0.5 * Math.pow(Math.random(), 1.6); bubble(d, sr, at, rnd(1600, 4600), 0.1 * (1 - at)); }
      return norm(d, 0.32);
    },
    clink: function (sr) {   // two glasses: two strikes a little out of tune (700 ms)
      var d = new Float32Array(Math.floor(sr * 0.7)), f = rnd(1750, 2050);
      strike(d, sr, 0, f, 0.5, 1); strike(d, sr, 0.004, f * 1.065, 0.35, 0.9);
      return norm(d, 0.5);
    },
    skal: function (sr) {   // skål: clink - clink (900 ms)
      var d = new Float32Array(Math.floor(sr * 0.9)), f = rnd(1800, 2000);
      strike(d, sr, 0, f, 0.45, 0.8); strike(d, sr, 0.003, f * 1.07, 0.3, 0.8); strike(d, sr, 0.13, f * 1.19, 0.45, 1.1);
      return norm(d, 0.5);
    },
    error: function (sr) {   // a soft low "dunk", not a buzzer (200 ms)
      var d = new Float32Array(Math.floor(sr * 0.2)), ph = 0;
      for (var i = 0; i < d.length; i++) { var t = i / sr; ph += 2 * Math.PI * (210 - 70 * t / 0.2) / sr; d[i] = (Math.sin(ph) + 0.25 * Math.sin(2 * ph)) * env(t, 0.004, 0.055); }
      return norm(d, 0.45);
    },
    hot: function (sr) {   // fire whoosh: noise through a sweeping resonant filter + crackles (1 s)
      var d = new Float32Array(Math.floor(sr * 1.0)), lo = 0, bp = 0;
      for (var i = 0; i < d.length; i++) {
        var t = i / sr, fc = t < 0.5 ? 300 * Math.pow(9, t / 0.5) : 2700 * Math.pow(0.15, (t - 0.5) / 0.5), F = 2 * Math.sin(Math.PI * Math.min(fc, sr / 6) / sr);
        var hi = (Math.random() * 2 - 1) - lo - 0.5 * bp; bp += F * hi; lo += F * bp;
        d[i] = bp * Math.min(1, t / 0.25) * Math.min(1, (1 - t) / 0.4);
        if (Math.random() < 30 / sr) for (var k = 0; k < sr * 0.004 && i + k < d.length; k++) d[i + k] += (Math.random() * 2 - 1) * 0.6 * Math.exp(-k / (sr * 0.0008));
      }
      return norm(d, 0.45);
    },
    medevac: function (sr) {   // a soft hi-lo, not a real siren (1.6 s)
      var d = new Float32Array(Math.floor(sr * 1.6)), ph = 0;
      for (var i = 0; i < d.length; i++) {
        var t = i / sr, s = Math.floor(t / 0.4) % 2, u = (t % 0.4) / 0.02, f = s ? 660 : 880; if (u < 1) f = s ? 880 - 220 * u : 660 + 220 * u;
        ph += 2 * Math.PI * f / sr;
        d[i] = (Math.sin(ph) + 0.3 * Math.sin(3 * ph) + 0.12 * Math.sin(5 * ph)) * Math.min(1, t / 0.05) * Math.min(1, (1.6 - t) / 0.2);
      }
      return norm(d, 0.3);
    }
  };
  function buf(name) {
    if (bufs[name] || !ctx || !RECIPES[name]) return bufs[name] || null;
    try { var d = RECIPES[name](ctx.sampleRate), b = ctx.createBuffer(1, d.length, ctx.sampleRate); b.getChannelData(0).set(d); bufs[name] = b; } catch (e) { return null; }
    return bufs[name];
  }
  // Render the other sounds later, one per idle slot (never all at once in a tap).
  function warm() {
    var todo = Object.keys(RECIPES).filter(function (n) { return !bufs[n]; });
    if (!todo.length || !ctx) { loadClips(); return; }
    buf(todo[0]);
    (window.requestIdleCallback || function (f) { return setTimeout(f, 60); })(warm);
  }
  function play(name, o) {
    o = o || {};
    if (muted() || document.hidden) { stats.skipped++; return false; }
    var c = unlock(), b = c && (o.buffer || buf(name));
    if (!b) { stats.skipped++; return false; }
    try {
      var s = c.createBufferSource(), g = c.createGain();
      s.buffer = b; if (!o.buffer) s.playbackRate.value = rnd(0.95, 1.05);   // a little different every time: no ear fatigue
      g.gain.value = (o.vol == null ? 1 : o.vol) * rnd(0.9, 1);
      s.connect(g); g.connect(out); s.start(c.currentTime + (o.delay || 0));
    } catch (e) { stats.skipped++; return false; }
    stats.played[name] = (stats.played[name] || 0) + 1;
    return true;
  }

  /* ================= Voice ================= */
  // Lines from the dialect packs (fx.VOICE_LINES), written plain so the voice says them well. No line says "drink more".
  var LINES = [["v01", "Skål!"], ["v02", "Hörrö du, skål då!"], ["v03", "Nu jäklar är det fest. Skål!"], ["v04", "Truppen är samlad. Skål!"],
    ["v05", "Det här blir en legendarisk kväll!"], ["v06", "Det här ska firas. Skål!"], ["v07", "Skål, och drick lite vatten nu."],
    ["v08", "Kalasbra det här. Skål!"], ["v09", "Det är fredag i hela kroppen. Skål!"], ["v10", "Hej och hå, nu bär det i väg!"]];
  var clips = {}, clipState = "", lastLine = -1, lastSaid = 0;
  function loadClips() {
    if (clipState || !ctx || !window.fetch || !voiceOn()) return;
    clipState = "loading";
    var left = LINES.length, ok = 0;
    LINES.forEach(function (l) {
      fetch("./audio/voice/" + l[0] + ".mp3").then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.arrayBuffer(); })
        .then(function (a) { return new Promise(function (res, rej) { var p = ctx.decodeAudioData(a, res, rej); if (p && p.then) p.then(res, rej); }); })
        .then(function (b) { clips[l[0]] = b; ok++; }, function () {})
        .then(function () { if (--left === 0) clipState = ok ? "ready" : "fail"; });
    });
  }
  function ttsVoice() {
    try {
      var best = null, bs = -1;
      (window.speechSynthesis.getVoices() || []).forEach(function (v) {
        if (!/^sv/i.test(v.lang)) return;
        var s = (/^sv[-_]SE$/i.test(v.lang) ? 2 : 0) + (/premium|enhanced|neural|natural|wavenet/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.localService === false ? 1 : 0);
        if (s > bs) { bs = s; best = v; }
      });
      return best;
    } catch (e) { return null; }
  }
  function pickLine() {
    var have = LINES.map(function (l, i) { return i; }).filter(function (i) { return clipState === "ready" ? !!clips[LINES[i][0]] : true; });
    var opts = have.filter(function (i) { return i !== lastLine; });
    var i = (opts.length ? opts : have)[Math.floor(Math.random() * (opts.length || have.length))];
    lastLine = i; return i;
  }
  function say(delay) {
    if (muted() || !voiceOn() || document.hidden || Date.now() - lastSaid < 8000) return false;
    if (clipState === "ready") {
      var i = pickLine(); if (i == null) return false;
      if (play("voice", { buffer: clips[LINES[i][0]], delay: (delay || 0) / 1000, vol: 1.6 })) { stats.voice.clip++; lastSaid = Date.now(); return true; }
      return false;
    }
    if (clipState !== "fail" || isIOS() || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return false;
    var v = ttsVoice(); if (!v) return false;
    var line = LINES[pickLine()][1];
    setTimeout(function () {
      try {
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(line); u.voice = v; u.lang = v.lang; u.rate = 1.05; u.pitch = 1; u.volume = 0.9;
        window.speechSynthesis.speak(u); stats.voice.tts++;
      } catch (e) {}
    }, delay || 0);
    lastSaid = Date.now();
    return true;
  }
  try { if (window.speechSynthesis) window.speechSynthesis.getVoices(); } catch (e) {}

  /* ================= Haptics ================= */
  var HAPTIC = { press: [14, 45, 20], accepted: [10, 30, 10, 60, 28], skal: [10, 30, 10, 60, 28], error: [160], level: [30, 40, 30, 40, 70] };
  function haptic(name) {
    var p = HAPTIC[name] || name;
    if (!vibOn() || !p) return false;
    try { if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false; } catch (e) {}
    if (isIOS()) return false;   // no vibrate on iPhone: the ÖL! switch overlay (fx.js) gives the system tick
    if (!isAndroid() || !navigator.vibrate) return false;
    try { navigator.vibrate(p); stats.haptics.push(p); return true; } catch (e) { return false; }
  }

  /* ================= ÖL! press: squash-and-stretch + foam burst ================= */
  var cv = null, g2 = null, sprites = null, raf = 0, ps = [], t0 = 0, last = 0, ring = null;
  function cssVar(n, d) { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch (e) { return d; } }
  function makeSprites() {
    var foam = cssVar("--foam", "rgb(255,250,240)"), gold = cssVar("--gold", "rgb(255,224,138)"), mk = function (fn) { var c = document.createElement("canvas"); c.width = c.height = 32; fn(c.getContext("2d")); return c; };
    return [
      mk(function (x) { var gr = x.createRadialGradient(12, 11, 1, 16, 16, 15); gr.addColorStop(0, "#fff"); gr.addColorStop(0.55, foam); gr.addColorStop(0.9, gold); gr.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = gr; x.beginPath(); x.arc(16, 16, 15, 0, 7); x.fill(); }),
      mk(function (x) { x.strokeStyle = foam; x.lineWidth = 2.2; x.globalAlpha = 0.9; x.beginPath(); x.arc(16, 16, 13, 0, 7); x.stroke(); x.fillStyle = "#fff"; x.beginPath(); x.arc(11, 10, 3, 0, 7); x.fill(); })
    ];
  }
  function canvas() {
    if (cv) return cv;
    var c = document.createElement("canvas"), x = c.getContext && c.getContext("2d");
    if (!x) return null;
    c.className = "jc-cv"; c.setAttribute("aria-hidden", "true");
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(320 * dpr); c.height = Math.round(360 * dpr); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    cv = c; g2 = x; sprites = makeSprites();
    return cv;
  }
  function frame(now) {
    var w0 = performance.now(), dt = Math.min(0.05, (now - last) / 1000), age = now - t0; last = now;
    g2.clearRect(0, 0, 320, 360);
    if (ring && age < 360) { var k = age / 360; g2.globalAlpha = 0.55 * (1 - k); g2.strokeStyle = cssVar("--foam", "#fff"); g2.lineWidth = 4 * (1 - k) + 1; g2.beginPath(); g2.arc(160, 260, ring + 70 * k, 0, 7); g2.stroke(); }
    for (var i = ps.length - 1; i >= 0; i--) {
      var p = ps[i]; p.age += dt;
      if (p.age >= p.life) { ps.splice(i, 1); continue; }
      p.vy += p.ay * dt; p.x += p.vx * dt; p.y += p.vy * dt; var q = p.age / p.life;
      var s = p.size * (p.k ? 1 + 0.4 * q : 1 - 0.5 * q), x = p.x + (p.k ? Math.sin(p.age * 18 + p.ph) * 5 : 0);
      g2.globalAlpha = q < 0.7 ? 1 : (1 - q) / 0.3;
      g2.drawImage(sprites[p.k], x - s / 2, p.y - s / 2, s, s);
    }
    g2.globalAlpha = 1;
    var ms = performance.now() - w0; stats.frames++; stats.sumFrameMs += ms; if (ms > stats.maxFrameMs) stats.maxFrameMs = ms;
    if (age < BURST_MS && (ps.length || age < 360)) raf = requestAnimationFrame(frame);
    else { g2.clearRect(0, 0, 320, 360); ps = []; raf = 0; if (cv.parentNode) cv.remove(); }
  }
  function burst(btn) {
    var c = canvas();
    if (!c) { try { FX.splash(btn, "foam"); } catch (e) {} return; }   // fallback: fx.js CSS splash (transform + opacity only)
    var r = btn.getBoundingClientRect(), R = Math.max(30, r.width / 2);
    c.style.left = Math.round(r.left + r.width / 2 - 160) + "px"; c.style.top = Math.round(r.top + r.height / 2 - 260) + "px";
    if (!c.parentNode) document.body.appendChild(c);
    ps = []; ring = R;
    for (var i = 0; i < 26; i++) {   // foam: thrown up and out, falls back
      var a = rnd(-160, -20) * Math.PI / 180, v = rnd(260, 560);
      ps.push({ k: 0, x: 160 + Math.cos(a) * R * 0.6, y: 260 + Math.sin(a) * R * 0.6, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 1300, size: rnd(7, 17), life: rnd(0.38, 0.58), age: 0, ph: 0 });
    }
    for (var j = 0; j < 14; j++) {   // bubbles: rise and wobble
      ps.push({ k: 1, x: 160 + rnd(-R * 0.7, R * 0.7), y: 260 + rnd(-R * 0.4, R * 0.2), vx: 0, vy: rnd(-300, -150), ay: -120, size: rnd(6, 13), life: rnd(0.42, 0.58), age: 0, ph: rnd(0, 6) });
    }
    if (ps.length > MAXP) ps.length = MAXP;
    stats.particles = ps.length;
    cancelAnimationFrame(raf); t0 = last = performance.now(); raf = requestAnimationFrame(frame);
  }
  function squash(btn) {
    var w = btn.closest(".beer-wrap") || btn;
    w.classList.remove("jc-pop"); void w.offsetWidth; w.classList.add("jc-pop");
    clearTimeout(w._jcT); w._jcT = setTimeout(function () { w.classList.remove("jc-pop"); }, 520);
  }
  function press(btn) {
    stats.presses++;
    unlock();
    play("tap");
    haptic("press");
    if (!btn || reduced() || document.hidden) return;
    squash(btn);
    burst(btn);
  }
  function accepted(level, big) {
    play("fizz"); play("clink", { delay: 0.12 });
    if (!big) haptic(level ? "level" : "accepted");
    say(650);
  }
  function error() { play("error"); haptic("error"); }

  /* ================= Plug into FX (every caller of FX.sound / FX.say / FX.unlock gets the new engine) ================= */
  var oldVibrate = FX.vibrate;
  FX.unlock = unlock;
  FX.say = function () { return say(0); };
  // Same object as fx.js's own "sound": its takeover / levelPop calls get the new sounds too.
  var S = FX.sound || (FX.sound = {});
  S.beer = function () { play("fizz"); play("clink", { delay: 0.12 }); say(650); };
  S.clink = function () { play("skal"); };
  S.hot = function () { play("hot"); };
  S.medevac = function () { play("medevac"); };
  FX.vibrate = function (p) { if (!vibOn()) return; return oldVibrate.apply(FX, arguments); };

  /* Settings: "Röst" and "Vibration" right under the "Ljud" switch (hook settingsSheet). */
  function row(label, on, set) {
    var r = document.createElement("div"), s = document.createElement("span"), b = document.createElement("button");
    r.className = "toggle-row jc-row"; s.textContent = label;
    b.type = "button"; b.className = "switch"; b.setAttribute("role", "switch"); b.setAttribute("aria-label", label); b.setAttribute("aria-checked", String(on()));
    b.addEventListener("click", function () { set(!on()); b.setAttribute("aria-checked", String(on())); });
    r.appendChild(s); r.appendChild(b);
    return r;
  }
  function settingsSheet(body) {
    if (!body || body.querySelector(".jc-row")) return;
    var lab = window.PN && PN.t ? PN.t("soundLabel") : "", sw = null;
    body.querySelectorAll(".toggle-row .switch").forEach(function (b) { if (!sw && b.getAttribute("aria-label") === lab) sw = b; });
    var after = sw ? sw.closest(".toggle-row") : null;
    var rv = row(sv() ? "Röst som säger skål" : "Voice that says cheers", voiceOn, function (v) { lsSet(VOICE_KEY, v ? "1" : "0"); if (v) { unlock(); loadClips(); } });
    var rb = row("Vibration", vibOn, function (v) { lsSet(VIB_KEY, v ? "1" : "0"); if (v) haptic("press"); });
    if (after && after.parentNode) { after.parentNode.insertBefore(rb, after.nextSibling); after.parentNode.insertBefore(rv, rb); }
    else { body.appendChild(rv); body.appendChild(rb); }
  }

  FX.settingsSheet = settingsSheet;
  FX.juice = { press: press, accepted: accepted, error: error, play: play, haptic: haptic, say: say, unlock: unlock, stats: stats,
    voiceOn: voiceOn, vibOn: vibOn, lines: LINES, patterns: HAPTIC, clipState: function () { return clipState; } };
  if (window.PN) PN.mod("FX");
})();
