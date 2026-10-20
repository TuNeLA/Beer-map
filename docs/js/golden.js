/* Öl Nu v26 — 🐴 DEN GYLLENE DALAHÄSTEN (CONTRACT "v26 EXTRAS", migration 0067_golden_horse.sql).
   About once per week per town a golden Dala horse appears at one random bar (an evening Wed–Sat from 19–23 until
   02:00). The first user who checks in at that bar catches it (server trigger on checkins): medal "guldhast" and a
   🐴 badge for 7 days (shown in pin popups of group-mates and in the 🏆 sheet).
   - golden_horse(lat, lng) on sign-in, every 3 min with the app poll, and 3 s / 8 s after a check-in tap.
   - Live horse: a golden pin on the bar (pane "goldhorse", zoom ≥ 11), one toast, ONE HUD chip "🐴 Guldhästen!"
     (urgent while live; tap = open the bar), a line in the bar sheet, ticker lines (via EVENTS → BARSPLUS news hooks).
   - Caught by me: celebration card (sound + vibration; reduced motion = no animation) + medal award.
   Hooks: init, onAuthed, onPoll, hudChipsHTML, hudClick, topSheet, barPopupHTML, beerTitleHTML. Missing RPC = off. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, esc = U.esc;
  var A = null, off = false, st = null, at = 0, busy = false, marker = null, lastCi = "", toastUp = false, SEEN = "olnu.ghSeen";
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function fill(s, o) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? String(o[k]) : m; }); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function reduced() { try { return !!(window.FX && window.FX.reduced && window.FX.reduced()); } catch (e) { return false; } }

  var T = {
    live: ["🐴✨ DEN GYLLENE DALAHÄSTEN har setts vid {bar}! Första som checkar in där tar'n.",
      "🐴✨ Larm från stallet: en gyllene dalahäst står och väntar vid {bar}. Först in vinner!",
      "🐴✨ Underrättelse: guldhästen ä landsatt vid {bar}. Snabba fötter, soldat!",
      "🐴✨ Hä ä int' en övning: Den gyllene dalahästen vid {bar}. Checka in först!",
      "🐴✨ Guld i sikte! Dalahästen glänser vid {bar}. Den som hinner först får medalj."],
    liveEn: ["🐴✨ THE GOLDEN DALA HORSE is at {bar}! First to check in there wins it."],
    mine: ["Du fångade Den gyllene dalahästen! Hela Dalarna bugar.", "Guldhästen ä din! Mora, Leksand och Rättvik skickar gratulationer.",
      "Hästen gnäggar ditt namn. Du ä veckans legend.", "Först på plats! Hästen följer med dig hem (i appen).",
      "Du tog guldhästen. Generalstaben har beställt en ny medaljhylla."],
    mineEn: ["You caught the Golden Dala Horse! All of Dalarna bows."],
    other: ["🐴 Guldhästen ä fångad vid {bar} av {namn}. Nästa vecka ä din chans!", "🐴 För sent! {namn} tog guldhästen vid {bar}.",
      "🐴 Hästen har galopperat hem med {namn}. Vid {bar}, om nån undrar."],
    gone: ["🐴 Guldhästen galopperade vidare från {bar}. Ingen hann. Nästa vecka!"],
    chip: ["🐴 Guldhästen!", "🐴 Golden horse!"],
    head: ["🐴 Den gyllene dalahästen", "🐴 The golden Dala horse"],
    sWait: ["Den gyllene dalahästen dyker upp i {stad} nån kväll den här veckan (ons–lör). Vid en hemlig krog. Håll utkik!",
      "Golden horse comes to {stad} one evening this week (Wed–Sat), at a secret bar. Watch out!"],
    sLive: ["Hästen står vid {bar} JUST NU. Först att checka in där vinner!", "The horse is at {bar} RIGHT NOW. First check-in wins!"],
    sClaim: ["Fångad vid {bar} av {namn}. Nästa häst kommer nästa vecka.", "Caught at {bar} by {namn}. Next horse next week."],
    sMine: ["Du fångade veckans häst vid {bar}! 🐴 i 7 dagar.", "You caught this week's horse at {bar}! 🐴 for 7 days."],
    sGone: ["Veckans häst stod vid {bar}, men ingen hann. Nästa vecka!", "This week's horse was at {bar}; nobody made it."],
    sNone: ["Ingen häst i den här trakten. Hästen gillar städer med krogar.", "No horse around here."],
    badges: ["🐴 Hästfångare (7 dagar): ", "🐴 Horse catchers (7 days): "],
    badge: ["🐴 Guldhästfångare", "🐴 Golden horse catcher"],
    secret: ["en hemlig agent", "a secret agent"],
    sheetLine: ["🐴✨ Den gyllene dalahästen ä här! Checka in först och vinn.", "🐴✨ The golden horse is here! First check-in wins."],
    news: ["🐴✨ Den gyllene dalahästen glänser vid {bar}! Först in vinner.", "🐴 Stallrapport: guldhästen står vid {bar}. Spring!",
      "🐴✨ {bar} har besök av en gyllene häst. Checka in först, soldat."],
    newsCaught: ["🐴 Guldhästen ä fångad vid {bar}. Hästen ä nöjd.", "🐴 Veckans guldhäst tagen vid {bar}. Respekt."]
  };
  function two(k) { return L(T[k][0], T[k][1]); }

  var HORSE = '<svg viewBox="0 0 100 80" aria-hidden="true"><defs><linearGradient id="ghg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2a8"/><stop offset=".45" stop-color="#f2c23c"/><stop offset="1" stop-color="#a8740c"/></linearGradient></defs>' +
    '<path fill="url(#ghg)" stroke="#6b4a00" stroke-width="2" d="M20 30Q20 22 30 22L62 22 66 8Q68 2 74 4L85 10Q89 12 86 17L80 18 76 30Q78 40 72 44L70 72 61 72 61 47 37 47 35 72 26 72 26 44Q17 40 20 30Z"/>' +
    '<path fill="url(#ghg)" stroke="#6b4a00" stroke-width="2" d="M21 28Q7 28 9 48Q13 38 21 36Z"/><path fill="#c8102e" d="M34 23H58Q60 34 46 35Q33 34 34 23Z"/>' +
    '<path fill="none" stroke="#fffbe0" stroke-width="2.2" stroke-linecap="round" d="M36 26Q46 33 56 26M41 40Q46 44 51 40"/><circle cx="76" cy="9" r="1.6" fill="#3b2a00"/></svg>';

  function where() {
    var p = null;
    try {
      var me = A.me && A.me();
      if (me && isFinite(me.lat) && isFinite(me.lng) && me.lat !== null) p = { lat: +me.lat, lng: +me.lng };
      if (!p && A.lastLoc) { var l = A.lastLoc(); if (l && isFinite(l.lat) && isFinite(l.lng)) p = { lat: +l.lat, lng: +l.lng }; }
      if (!p && A.map) { var c = A.map.getCenter(); p = { lat: c.lat, lng: c.lng }; }
    } catch (e) {}
    if (!p) p = { lat: 60.1496, lng: 15.1878 };
    p.lng = ((((p.lng + 180) % 360) + 360) % 360) - 180; p.lat = Math.max(-85, Math.min(85, p.lat));
    return p;
  }
  function seen() { var s = U.ls.getJSON(SEEN, {}); return s && typeof s === "object" ? s : {}; }
  function mark(k) { var s = seen(); s[k] = Date.now(); var ks = Object.keys(s); if (ks.length > 40) delete s[ks[0]]; U.ls.setJSON(SEEN, s); }
  function winner(d) { return d.winner_mine ? L("dig", "you") : d.winner_name || two("secret"); }

  function load(force) {
    if (!A || !A.LIVE || off || busy || !A.authed || !A.authed() || document.hidden) return;
    if (!force && Date.now() - at < 180000) return;
    busy = true; at = Date.now();
    var p = where();
    A.rpc("golden_horse", { p_lat: p.lat, p_lng: p.lng }).then(function (r) {
      busy = false;
      if (r.error) { if (U.missing(r.error)) { off = true; draw(); } return; }
      var prev = st; st = A.parseData(r.data) || null;
      react(prev, st); draw();
      try { A.updateCounts(); } catch (e) {}
    });
  }
  function react(prev, d) {
    if (!d || !d.id) return;
    var k = String(d.id);
    if (d.state === "live" && !seen()[k + ":live"] && !toastUp) {
      // The toast queue may drop it behind other alarms: it counts as seen only once it was really on screen
      // (else the next load tries again; the chip and the map pin stay anyway).
      var el = A.toast(fill(sv() ? pick(T.live) : T.liveEn[0], { bar: d.bar_name }), { ms: 9000, action: { label: L("🗺️ Visa", "🗺️ Show"), fn: function () { openHorse(); } } });
      toastUp = true;
      var tries = 0, onFor = 0, chk = setInterval(function () {
        onFor = el && el.isConnected ? onFor + 1 : 0;
        if (onFor >= 3) { mark(k + ":live"); clearInterval(chk); toastUp = false; }   // ≥ 1.5 s on screen
        else if (++tries > 24) { clearInterval(chk); toastUp = false; }
      }, 500);
    }
    if (d.state === "claimed" && d.winner_mine && !seen()[k + ":won"]) { mark(k + ":won"); celebrate(d); }
    else if (d.state === "claimed" && !d.winner_mine && prev && prev.id === d.id && prev.state === "live" && !seen()[k + ":lost"]) {
      mark(k + ":lost"); A.toast(fill(pick(T.other), { bar: d.bar_name, namn: winner(d) }));
    } else if (d.state === "gone" && prev && prev.id === d.id && prev.state === "live" && !seen()[k + ":gone"]) {
      mark(k + ":gone"); A.toast(fill(T.gone[0], { bar: d.bar_name }));
    }
  }
  function celebrate(d) {
    try { window.FX.unlock(); window.FX.sound.clink(); setTimeout(function () { try { window.FX.sound.clink(); } catch (e) {} }, 260); window.FX.vibrate([40, 50, 40, 50, 120]); } catch (e) {}
    var wrap = document.createElement("div");
    wrap.className = "gh-win" + (reduced() ? " gh-still" : "");
    wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-label", two("head"));
    wrap.innerHTML = '<div class="gh-win-card"><div class="gh-win-horse">' + HORSE + '</div><div class="gh-win-h">' + esc(L("GULDHÄSTEN Ä DIN!", "THE GOLDEN HORSE IS YOURS!")) + "</div>" +
      '<div class="gh-win-t">' + esc(sv() ? pick(T.mine) : T.mineEn[0]) + '</div><div class="gh-win-m">🎖️ ' + esc(L("Ny medalj: Den gyllene dalahästen · 🐴 i 7 dagar", "New medal: The golden Dala horse · 🐴 for 7 days")) +
      '</div><button type="button" class="btn btn-green">' + esc(L("Gnägg! 🐴", "Neigh! 🐴")) + "</button></div>";
    var close = function () { wrap.remove(); };
    wrap.addEventListener("click", close);
    document.body.appendChild(wrap);
    setTimeout(close, 12000);
    try { if (window.MEDALS && window.MEDALS.award) window.MEDALS.award(null, true); } catch (e) {}
  }
  function openHorse() {
    if (!st || !st.bar_id) return;
    var b = null; try { b = window.BARS.byId(st.bar_id); } catch (e) {}
    if (A.openBar) A.openBar(b || { id: st.bar_id, name: st.bar_name, lat: st.lat, lng: st.lng, type: "bar" });
  }
  function zoomVis() { if (!marker) return; var el = marker.getElement(); if (el) el.style.display = A.map.getZoom() >= 11 ? "" : "none"; }
  function draw() {
    if (!A || !A.map || !window.L) return;
    var want = !off && st && st.state === "live" && isFinite(st.lat);
    if (!want) { if (marker) { marker.remove(); marker = null; } return; }
    if (!A.map.getPane("goldhorse")) { A.map.createPane("goldhorse"); A.map.getPane("goldhorse").style.zIndex = 655; }
    var ll = [st.lat, st.lng];
    if (marker) { marker.setLatLng(ll); return; }
    var icon = window.L.divIcon({ className: "gh-pin" + (reduced() ? " gh-still" : ""), html: '<span class="gh-glow"></span><span class="gh-svg">' + HORSE + "</span>", iconSize: [54, 46], iconAnchor: [27, 52] });
    marker = window.L.marker(ll, { icon: icon, pane: "goldhorse", keyboard: false, zIndexOffset: 1200, title: two("head") });
    marker.on("click", openHorse);
    marker.addTo(A.map);
    var z = zoomVis;
    if (!draw._z) { draw._z = true; A.map.on("zoomend", function () { if (marker) zoomVis(); }); }   // review2: one listener
    z();
  }

  function section() {
    var box = A.el("div", { class: "gh-box" }), p = where(), town = "";
    try { var c = window.CITIES.nearest(p.lat, p.lng); town = c ? c.name : ""; } catch (e) {}
    box.appendChild(A.el("h3", { text: two("head") }));
    var line = A.el("p", { class: "gh-state" }), bl = A.el("p", { class: "muted gh-badges" });
    function fillIn(d) {
      if (!d) { line.textContent = "…"; return; }
      var o = { bar: d.bar_name || "", namn: winner(d), stad: d.town || town || L("stan", "town") };
      var k = d.state === "waiting" ? "sWait" : d.state === "live" ? "sLive" : d.state === "claimed" ? (d.winner_mine ? "sMine" : "sClaim") : d.state === "gone" ? "sGone" : "sNone";
      line.textContent = fill(two(k), o);
      line.className = "gh-state gh-s-" + d.state;
      var names = (d.badges || []).map(function (b) { return b.is_me ? L("Du", "You") : b.name || two("secret"); });
      bl.textContent = names.length ? two("badges") + names.join(", ") : "";
    }
    fillIn(st);
    box.appendChild(line); box.appendChild(bl);
    if (st && st.state === "live") box.appendChild(A.btn(L("🗺️ Visa krogen", "🗺️ Show the bar"), "btn-small", function () { A.closeSheet(); openHorse(); }));
    load(true);
    setTimeout(function () { if (off) box.remove(); else fillIn(st); }, 1800);
    return box;
  }
  function badgeNames() { return (st && st.badges || []).map(function (b) { return b.is_me ? "\u0000me" : b.name; }).filter(Boolean); }

  // Medal catalog entry (medals.js finds rows added after load).
  try {
    if (window.MEDALS && window.MEDALS.CAT && !window.MEDALS.CAT.some(function (c) { return c[0] === "guldhast"; }))
      window.MEDALS.CAT.push(["guldhast", "🐴", "Den gyllene dalahästen", "Du hann först till guldhästen. Dalarna kommer prata om det här i generationer.", "", 1, 1]);
  } catch (e) {}

  window.GOLDEN = {
    init: function (api) {
      A = api;
      document.addEventListener("click", function (e) {
        var b = e.target && e.target.closest && e.target.closest("[data-ci], .ci-btn");
        if (b && st && st.state === "live") { setTimeout(function () { load(true); }, 3000); setTimeout(function () { load(true); }, 8000); }
      }, true);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) load(false); });
    },
    onAuthed: function () { load(true); },
    onPoll: function () {
      var ci = null; try { ci = A.myCheckin && A.myCheckin(); } catch (e) {}
      var k = ci ? String(ci.id) + "|" + ci.at : "";
      if (k !== lastCi) { lastCi = k; if (k && st && st.state === "live") { load(true); return; } }
      load(false);
    },
    hudChipsHTML: function () {
      if (off || !st || st.state !== "live") return "";
      return '<button type="button" class="hx-chip hx-urgent gh-chip" data-hx="golden">' + esc(two("chip")) + "</button>";
    },
    hudClick: function (a) { if (a === "golden") openHorse(); },
    topSheet: function (body) { if (A && A.LIVE && !off && A.authed && A.authed()) body.appendChild(section()); },
    barPopupHTML: function (bar) {
      if (off || !st || st.state !== "live" || !bar || String(bar.id) !== String(st.bar_id)) return "";
      return '<div class="ev-line gh-line"><span class="ev-l-t">' + esc(two("sheetLine")) + "</span></div>";
    },
    beerTitleHTML: function (b) {
      if (off || !b) return "";
      var n = badgeNames();
      if ((b.is_mine && n.indexOf("\u0000me") >= 0) || (b.friend_name && n.indexOf(b.friend_name) >= 0)) return '<div class="pp-friend gh-badge">' + esc(two("badge")) + "</div>";
      return "";
    },
    newsTemplates: function () {
      var out = [];
      T.news.forEach(function (l) { out.push({ k: "ghLive", f: function (d) { return fill(l, d); } }); });
      T.newsCaught.forEach(function (l) { out.push({ k: "ghCaught", f: function (d) { return fill(l, d); } }); });
      return out;
    },
    newsCands: function () {
      if (off || !st || !sv()) return [];
      if (st.state === "live") return [{ k: "ghLive", d: { bar: st.bar_name }, imp: 2 }];
      if (st.state === "claimed" && st.claimed_at && Date.now() - Date.parse(st.claimed_at) < 3 * 3600e3) return [{ k: "ghCaught", d: { bar: st.bar_name }, imp: 0 }];
      return [];
    },
    // tests
    state: function () { return st; }, _set: function (d) { var p = st; st = d; react(p, d); draw(); }, _celebrate: celebrate, HORSE: HORSE
  };
})();
