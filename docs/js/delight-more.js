/* Öl Nu v26 — DELIGHT MORE: 16 more rare map events + 8 easter eggs, in the delight.js style. Client only.
   Map events are added to window.DELIGHT.events (the same object delight.js picks from, so the hour-slot seeding,
   "spotted N/M", the tap bonus and the reduced-motion captions all just work). Texts: js/delight-more-content.js.
   Easter eggs (each at most once per 10 min, captions through DELIGHT.caption when present, else a toast):
     1 tap the ticker 5× fast · 2 tap the live counter 4× fast · 3 open the app at 13:37 · 4 at 00:00 (midnight)
     5 zoom out to the whole world · 6 zoom ≥ 18 at the old nightclub Solo in Ludvika (memorial)
     7 "vatten" in a group chat → water drops · 8 "dalarna" in a group chat → the wild Dala horse gallops by
   Respects the delight on/off switch (olnu.dl.off), FX.reduced(), the beer-type strip and open sheets.
   Hooks (app.js mods): init, onPoll. Debug: ?delight=<new event key> works through delight.js. */
(function () {
  "use strict";
  var U = window.U, A = null;
  function C() { return window.DELIGHT_MORE_CONTENT || {}; }
  function D() { return window.DELIGHT || null; }
  function en() { return !!(window.I18N && window.I18N.lang === "en"); }
  function pick(a) { return a && a.length ? a[Math.floor(Math.random() * a.length)] : ""; }
  function reduced() { try { return !!(window.FX && window.FX.reduced && window.FX.reduced()); } catch (e) { return false; } }
  function off() { try { return U.ls.get("olnu.dl.off", "") === "1"; } catch (e) { return false; } }

  /* ---------- 1. map events (same fields as delight.js EV) ---------- */
  var EV = {
    varg: { t: "u", a: "cross", s: "🐺<i>🐺</i><i>🐺</i>", sz: 46, dur: 5600, bob: "walk", h: [20, 4] },
    rav: { t: "c", a: "peek", s: "🦊", side: "r", h: [18, 4] },
    bandy: { t: "c", a: "cross", s: "⛸️<i>🏒</i><i>⛸️</i>", sz: 44, dur: 5200, bob: "ski", m: [11, 3] },
    kanot: { t: "c", a: "cross", s: "🛶", sz: 54, dur: 6000, bob: "walk", m: [5, 9] },
    buss: { t: "c", a: "cross", s: "🚌<b class=\"dl-sign\">HEJA!</b>", sz: 48, dur: 5000, bob: "rumble" },
    blabar: { t: "c", a: "fall", s: "🫐", m: [7, 9] },
    lov: { t: "c", a: "fall", s: "🍂", m: [9, 11] },
    mus: { t: "c", a: "cross", s: "🐁", sz: 34, dur: 3200, bob: "bounce" },
    raket: { t: "r", a: "sat", s: "🚀" },
    hare: { t: "c", a: "cross", s: "🐇", sz: 46, dur: 3600, bob: "bounce", m: [3, 11] },
    fyrverkeri: { t: "c", a: "float", s: "🎆", date: [12, 31, 1, 1] },
    pingvin: { t: "r", a: "cross", s: "🐧", sz: 54, dur: 6000, bob: "walk", m: [11, 3] },
    vasman: { t: "u", a: "rise", s: "🧖", m: [12, 3] },
    fallskarm: { t: "u", a: "fall", s: "🪂" },
    isbjorn: { t: "r", a: "cross", s: "🐻‍❄️", sz: 66, dur: 6000, bob: "walk", m: [12, 2] },
    svamp: { t: "c", a: "float", s: "🍄", m: [8, 10] }
  };
  function addEvents() {
    var d = D(), c = window.DELIGHT_CONTENT, mc = C().events || {};
    if (!d || !d.events || !c) return false;
    c.events = c.events || {};
    Object.keys(EV).forEach(function (k) {
      if (!d.events[k]) d.events[k] = EV[k];
      if (!c.events[k] && mc[k]) c.events[k] = mc[k];
    });
    return true;
  }
  addEvents();

  /* ---------- 2. easter eggs ---------- */
  var lastEgg = {};
  function blocked() {
    try { if (A && A.sheetOpen && A.sheetOpen()) return true; } catch (e) {}
    try { if (window.OLNU_STRIP && window.OLNU_STRIP.up()) return true; } catch (e) {}
    try { var it = document.getElementById("intro"); if (it && !it.hidden) return true; } catch (e) {}
    return document.hidden || !!document.querySelector(".takeover");
  }
  function egg(key, opts) {
    opts = opts || {};
    if (off() && !opts.force) return false;
    if (!opts.force && Date.now() - (lastEgg[key] || 0) < 10 * 60000) return false;
    if (!opts.force && !opts.anySheet && blocked()) return false;
    var e = (C().eggs || {})[key]; if (!e) return false;
    lastEgg[key] = Date.now();
    var head = (e.head && (en() ? e.head.en : e.head.sv)) || "", line = pick(en() ? e.en || e.sv : e.sv);
    try { window.FX.vibrate([20, 40, 20]); window.FX.sound.clink(); } catch (x) {}
    var d = D();
    if (d && d.caption) d.caption({ head: head, text: line, cls: "dl-cap-secret", now: true, ms: 6500 });
    else if (A) A.toast(head + " · " + line, { ms: 6000 });
    return true;
  }
  function taps(sel, n, ms, key) {
    var c = 0, t0 = 0;
    document.addEventListener("click", function (e) {
      if (!e.target || !e.target.closest || !e.target.closest(sel)) return;
      var now = Date.now();
      c = now - t0 > ms ? 1 : c + 1; t0 = now;
      if (c >= n) { c = 0; egg(key, { anySheet: true }); }
    }, true);
  }
  function sthlm() {
    try {
      var o = {};
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).forEach(function (p) { o[p.type] = p.value; });
      return { h: +o.hour % 24, m: +o.minute };
    } catch (e) { var d = new Date(); return { h: d.getHours(), m: d.getMinutes() }; }
  }
  function clockEggs() {
    if (document.hidden) return;
    var s = sthlm(), day = new Date().toDateString();
    var once = function (k) { var v = U.ls.get("olnu.dl2." + k, ""); if (v === day) return false; U.ls.set("olnu.dl2." + k, day); return true; };
    if (s.h === 13 && s.m === 37 && !blocked() && once("leet")) egg("leet");
    if (s.h === 0 && s.m === 0 && !blocked() && once("midnight")) egg("midnight");
  }
  var SOLO = { lat: 60.15071, lng: 15.18664 };
  function mapEggs() {
    if (!A || !A.map) return;
    A.map.on("zoomend", function () {
      var z = A.map.getZoom();
      if (z <= 3) egg("world");
      if (z >= 18) {
        var c = A.map.getCenter();
        if (U.haversine(c.lat, c.lng, SOLO.lat, SOLO.lng) < 120) {
          // hotfix 2026-10-22: rare — at most once per 7 days
          var k = "olnu.eggSoloAt", t = 0; try { t = +localStorage.getItem(k) || 0; } catch (x) {}
          if (Date.now() - t > 7 * 864e5 && egg("solo")) { try { localStorage.setItem(k, String(Date.now())); } catch (x) {} }
        }
      }
    });
  }
  // Chat words: watches the sheet like delight.js "skål" (never edits social.js).
  var chatSeen = typeof WeakSet === "function" ? new WeakSet() : null;
  var WORDS = [[/(^|[^a-zåäö])vatten([^a-zåäö]|$)/i, "vatten"], [/(^|[^a-zåäö])dalarna([^a-zåäö]|$)/i, "dalarna"]];
  function hookChat() {
    var body = document.getElementById("sheet-body"); if (!body || !window.MutationObserver || !chatSeen) return;
    new MutationObserver(function (muts) {
      var sheet = document.getElementById("sheet"); if (!sheet || sheet.hidden) return;
      var now = Date.now();
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes || [], function (n) {
          if (!n || n.nodeType !== 1) return;
          var li = n.classList && n.classList.contains("chat-msg") ? [n] : (n.querySelectorAll ? n.querySelectorAll(".chat-msg") : []);
          Array.prototype.forEach.call(li, function (x) {
            if (chatSeen.has(x)) return; chatSeen.add(x);
            var b = x.querySelector(".cm-body"), at = Date.parse(x.getAttribute("data-at") || "");
            if (!b || (isFinite(at) && now - at > 120000)) return;
            WORDS.forEach(function (w) {
              if (!w[0].test(b.textContent || "")) return;
              if (w[1] === "vatten") { if (egg("vatten", { anySheet: true })) drops(); }
              else if (egg("dalarna", { anySheet: true })) { var d = D(); if (d && d.run && !reduced()) setTimeout(function () { d.run("dalahast"); }, 400); }
            });
          });
        });
      });
    }).observe(body, { childList: true, subtree: true });
  }
  function drops() {
    if (reduced()) return;
    var w = document.createElement("div"); w.className = "dl2-drops"; w.setAttribute("aria-hidden", "true");
    var h = "";
    for (var i = 0; i < 14; i++) h += '<i style="left:' + (Math.random() * 94).toFixed(1) + "%;animation-delay:" + (Math.random() * 900).toFixed(0) + 'ms">💧</i>';
    w.innerHTML = h; document.body.appendChild(w);
    setTimeout(function () { w.remove(); }, 3200);
  }

  window.DELIGHT_MORE = {
    events: EV, egg: egg,
    init: function (api) {
      A = api;
      addEvents();
      taps(".ticker", 5, 1600, "ticker");
      taps("#live-count", 4, 1500, "count");
      mapEggs(); hookChat();
      setInterval(clockEggs, 20000); setTimeout(clockEggs, 4000);
    },
    onPoll: function () { addEvents(); }
  };
})();
