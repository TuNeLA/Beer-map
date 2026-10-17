/* Öl Nu — tap effects: vibration, generated sound (Web Audio, no files), foam splash, full-screen takeover. */
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

  var sound = {
    beer: function () {
      var c = ready(); if (!c) return;
      try {
        var out = master(c, 0.55), t0 = c.currentTime + 0.02;
        pssh(c, t0, out); ping(c, t0 + 0.28, 2350, out); ping(c, t0 + 0.4, 2900, out, 0.28);
      } catch (e) {}
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

  // Foam splash from an element (the ÖL! button).
  function splash(anchor) {
    if (!anchor || reduced()) return;
    var r = anchor.getBoundingClientRect();
    var box = document.createElement("div");
    box.className = "foam-splash"; box.setAttribute("aria-hidden", "true");
    box.style.left = (r.left + r.width / 2) + "px"; box.style.top = (r.top + r.height / 2) + "px";
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

  // Full-screen takeover. level 1 = HOT STREAK, 2 = MEDEVAC. opts: {title, sub, hint}
  var current = null;
  function takeover(level, opts) {
    opts = opts || {};
    if (current) current.remove();
    var rm = reduced();
    var el = document.createElement("div");
    el.className = "takeover " + (level === 2 ? "tk-medevac" : "tk-hot") + (rm ? " still" : "");
    el.setAttribute("role", "alert");
    var html = "";
    if (level === 2) {
      if (!rm) html += '<div class="to-strobe" aria-hidden="true"></div>';
      html += '<div class="to-heli" aria-hidden="true">🚁</div>';
    } else {
      html += '<div class="to-flames" aria-hidden="true">';
      for (var i = 0; i < 9; i++) html += '<span style="--i:' + i + '">🔥</span>';
      html += "</div>";
    }
    html += '<div class="to-core"><div class="to-icon" aria-hidden="true">' + (level === 2 ? "🚁" : "🔥") + "</div>" +
      '<div class="to-title">' + U.esc(opts.title || "") + "</div>" +
      '<div class="to-sub">' + U.esc(opts.sub || "") + "</div>" +
      '<div class="to-hint">' + U.esc(opts.hint || "") + "</div></div>";
    el.innerHTML = html;
    var done = function () { if (el.parentNode) { el.classList.add("out"); setTimeout(function () { el.remove(); }, 220); } if (current === el) current = null; };
    el.addEventListener("click", done);
    document.body.appendChild(el);
    current = el;
    setTimeout(done, opts.ms || 1800);
    if (level === 2) { vibrate([200, 80, 200, 80, 400]); sound.medevac(); }
    else { vibrate([120, 60, 120, 60, 240]); sound.hot(); }
  }

  window.FX = { vibrate: vibrate, unlock: unlock, sound: sound, splash: splash, takeover: takeover,
    muted: muted, setMuted: setMuted, reduced: reduced };
})();
