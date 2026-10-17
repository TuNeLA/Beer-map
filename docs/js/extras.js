/* Öl Nu v9 — local extras (per phone, localStorage): taxi buttons, water reminder, ghost mode (spökläge),
   badges (märken), the night summary card (Din kväll), and v8 "annan drink" (sidospår) button.
   Storage is always wrapped (U.ls) and every feature works without it. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, t = I.t, esc = U.esc;
  var A = null;
  function $(id) { return document.getElementById(id); }
  function pick(a) { return a && a.length ? a[Math.floor(Math.random() * a.length)] : ""; }

  /* ---------- Toast queue: badge/water toasts after the beer toast, not on top of it ---------- */
  var nextToastAt = 0;
  function toastLater(msg, opts, delay) {
    var at = Math.max(Date.now() + (delay || 0), nextToastAt);
    nextToastAt = at + 1800;
    setTimeout(function () { A.toast(msg, opts || {}); }, at - Date.now());
  }

  /* ---------- Taxi (B) ----------
     Local taxi of the nearest town (≤ 40 km) from js/taxi-data.js; else the nationwide TaxiKurir line.
     Ludvika Taxi stays as the built-in default if the data file is missing. Uber everywhere. */
  var TAXI = { name: "Ludvika Taxi", tel: "+4624013900", text: "0240-139 00", lat: 60.1496, lng: 15.1878 };
  var UBER = "https://m.uber.com/ul/?action=setPickup";
  function taxiFor() {
    var c = A.center(), data = window.TAXI_DATA;
    if (!data || !data.towns || !c) return !c || U.haversine(c.lat, c.lng, TAXI.lat, TAXI.lng) <= 60000 ? TAXI : null;
    var best = null, bestD = 40000;
    data.towns.forEach(function (x) {
      var dd = U.haversine(c.lat, c.lng, x.lat, x.lng);
      if (dd <= bestD) { bestD = dd; best = x; }
    });
    return best || data.fallback || null;
  }
  function taxiHTML(cls) {
    var tx = taxiFor();
    return '<div class="taxi-row">' +
      (tx ? '<a class="' + cls + ' taxi-local" href="tel:' + esc(tx.tel) + '">🚕 ' + esc(tx.name) +
        ' <span class="taxi-num">' + esc(tx.text) + "</span></a>" : "") +
      '<a class="' + cls + ' taxi-uber" href="' + UBER + '" target="_blank" rel="noopener noreferrer">' + esc(t("taxiUber")) + "</a></div>";
  }
  function taxiBlock(container) {
    container.appendChild(A.el("h3", { text: t("taxi") }));
    container.appendChild(A.el("p", { class: "muted", text: t("taxiInfo") }));
    container.appendChild(A.el("div", { html: taxiHTML("btn btn-small taxi-btn") }));
  }
  function showTaxi() {
    A.openSheet(t("taxiTitle"), function (body) {
      body.appendChild(A.el("p", { text: t("taxiInfo") }));
      body.appendChild(A.el("div", { html: taxiHTML("btn taxi-btn") }));
      if (window.SOCIAL && window.SOCIAL.sosBlock) { body.appendChild(A.el("h3", { text: t("safety") })); window.SOCIAL.sosBlock(body); }
    });
  }

  /* ---------- Spökläge (D) ---------- */
  var GHOST_KEY = "olnu.ghostMode";
  function ghostOn() { return U.ls.get(GHOST_KEY, "0") === "1"; }

  /* ---------- Night log (F) + badges (E) ---------- */
  var LOG_KEY = "olnu.nightlog", LAST_KEY = "olnu.nightlast", NIGHTS_KEY = "olnu.nights", BADGE_KEY = "olnu.badges", BARS_KEY = "olnu.barsEver";
  function nightKey(d) { return window.NEWS && window.NEWS.nightKey ? window.NEWS.nightKey(d) : U.next5am(d).toISOString().slice(0, 10); }
  function freshLog() { return { key: nightKey(), beers: 0, others: 0, bars: [], skal: 0, best: 0, badges: [] }; }
  function getLog() {
    var l = U.ls.getJSON(LOG_KEY, null);
    if (!l || typeof l !== "object" || l.key !== nightKey()) {
      // A new night: keep the old one for the summary card ("Din kväll").
      if (l && l.key && ((l.beers | 0) > 0 || (l.others | 0) > 0)) U.ls.setJSON(LAST_KEY, l);
      l = freshLog();
      U.ls.setJSON(LOG_KEY, l);
    }
    if (!Array.isArray(l.bars)) l.bars = [];
    if (!Array.isArray(l.badges)) l.badges = [];
    return l;
  }
  function saveLog(l) { U.ls.setJSON(LOG_KEY, l); }

  var BADGES = [["first", "🍺"], ["newbar", "🗺️"], ["barhop", "🦘"], ["early", "☀️"], ["owl", "🦉"], ["hot", "🔥"], ["med", "🚁"],
    ["survivor", "🩹"], ["home01", "🏠"], ["skalking", "🍻"], ["week", "⚔️"], ["king", "👑"], ["ghost", "👻"], ["chat", "💬"], ["side", "🥃"]];
  function badgeEmoji(id) { for (var i = 0; i < BADGES.length; i++) if (BADGES[i][0] === id) return BADGES[i][1]; return "🎖️"; }
  function badgeName(id) { var m = t("badges") || {}; return (m[id] || [id])[0]; }
  function award(id) {
    var have = U.ls.getJSON(BADGE_KEY, {}) || {};
    if (have[id]) return false;
    have[id] = Date.now();
    U.ls.setJSON(BADGE_KEY, have);
    var l = getLog(); if (l.badges.indexOf(id) < 0) { l.badges.push(id); saveLog(l); }
    if (id === "chat" && MED()) MED().onChat();
    // v11: medals live on the server; their toast comes from medals.js. The local badge stays for the
    // night card and as a fallback on an old database.
    if (MED() && MED().on()) return true;
    toastLater(t("badgeNew", badgeEmoji(id), badgeName(id)), { cls: "badge-toast", ms: 4500 }, 2200);
    setTimeout(function () { window.FX.vibrate([20, 30, 20]); }, 2200);
    return true;
  }
  function addNight(key) {
    var list = U.ls.getJSON(NIGHTS_KEY, []);
    if (!Array.isArray(list)) list = [];
    if (list.indexOf(key) < 0) list.push(key);
    list = list.sort().slice(-14);
    U.ls.setJSON(NIGHTS_KEY, list);
    // Nights with beer during the last 7 days (rolling week).
    var now = Date.now();
    return list.filter(function (k) { var d = Date.parse(k + "T12:00:00Z"); return isFinite(d) && now - d <= 7 * 86400e3; }).length;
  }

  function MED() { return window.MEDALS || null; }
  // v11: "Min uniform" (server medals + rank). Old local badge sheet when medals are not available.
  function showBadges() {
    if (MED() && MED().on()) { MED().showMine(); return; }
    showBadgesLegacy();
  }
  function showBadgesLegacy() {
    A.openSheet(t("badgesBtn"), function (body) {
      var el = A.el, have = U.ls.getJSON(BADGE_KEY, {}) || {};
      var st = window.SOCIAL && window.SOCIAL.stats && window.SOCIAL.stats();
      if (st) {
        var pct = st.nextAt ? Math.max(0, Math.min(100, Math.round(100 * st.total / st.nextAt))) : 100;
        body.appendChild(el("div", { class: "rank-box" }, [
          el("div", { class: "rank-title", text: t("titleHud", st.title, st.total) }),
          el("div", { class: "rank-bar" }, [el("span", { style: "width:" + pct + "%" })]),
          el("div", { class: "muted", text: window.SOCIAL.titleProgress() })
        ]));
      }
      var got = BADGES.filter(function (b) { return have[b[0]]; }).length;
      body.appendChild(el("h3", { text: t("badgesCount", got, BADGES.length) }));
      var grid = el("ul", { class: "badge-grid" });
      var names = t("badges") || {};
      BADGES.forEach(function (b) {
        var on = !!have[b[0]], nm = names[b[0]] || [b[0], ""];
        grid.appendChild(el("li", { class: "badge" + (on ? " on" : "") }, [
          el("span", { class: "bd-e", "aria-hidden": "true", text: on ? b[1] : "🔒" }),
          el("span", { class: "bd-n", text: nm[0] }),
          el("span", { class: "bd-d", text: nm[1] + (on ? "" : "") })
        ]));
      });
      body.appendChild(grid);
    });
  }

  /* ---------- Din kväll: summary card drawn on a canvas (F) ---------- */
  function nightDateLabel(key) {
    var d = Date.parse(key + "T12:00:00Z"); if (!isFinite(d)) return key;
    try {
      return new Intl.DateTimeFormat(I.lang === "en" ? "en-GB" : "sv-SE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(d - 86400e3));
    } catch (e) { return key; }
  }
  function summaryOf(l) {
    var st = window.SOCIAL && window.SOCIAL.stats && window.SOCIAL.stats();
    return { key: l.key, beers: l.beers | 0, others: l.others | 0, bars: (l.bars || []).length, skal: l.skal | 0, best: l.best | 0,
      badges: (l.badges || []).map(badgeEmoji), title: st ? st.title : "" };
  }
  function streakText(n) { return n >= 10 ? "🚁 MEDEVAC" : n >= 5 ? "🔥 HOT STREAK" : n > 0 ? n + " 🍺" : t("nightStreakNone"); }
  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var p = Promise.all(['64px "Black Ops One"', '40px "Share Tech Mono"', '700 40px "Chakra Petch"'].map(function (f) { return document.fonts.load(f).catch(function () {}); }));
    return Promise.race([p, new Promise(function (r) { setTimeout(r, 1500); })]);
  }
  function drawCard(cv, s) {
    var W = 1080, H = 1350, c = cv.getContext("2d");
    cv.width = W; cv.height = H;
    c.fillStyle = "#0a0f1c"; c.fillRect(0, 0, W, H);
    var g = c.createRadialGradient(W / 2, 420, 50, W / 2, 420, 700);
    g.addColorStop(0, "rgba(245,166,35,.22)"); g.addColorStop(1, "rgba(245,166,35,0)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(245,166,35,.07)"; c.lineWidth = 2;
    for (var x = 0; x <= W; x += 54) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (var y = 0; y <= H; y += 54) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    // Corner brackets
    c.strokeStyle = "#f5a623"; c.lineWidth = 8;
    [[40, 40, 1, 1], [W - 40, 40, -1, 1], [40, H - 40, 1, -1], [W - 40, H - 40, -1, -1]].forEach(function (k) {
      c.beginPath(); c.moveTo(k[0], k[1] + 70 * k[3]); c.lineTo(k[0], k[1]); c.lineTo(k[0] + 70 * k[2], k[1]); c.stroke();
    });
    c.textBaseline = "alphabetic";
    c.fillStyle = "#f5a623"; c.font = '64px "Black Ops One", Impact, sans-serif'; c.textAlign = "left";
    c.fillText("ÖL NU", 90, 150);
    c.fillStyle = "#ffe08a"; c.font = '112px "Black Ops One", Impact, sans-serif';
    c.fillText(t("nightHead"), 90, 280);
    c.fillStyle = "#9aa3a0"; c.font = '40px "Share Tech Mono", monospace';
    c.fillText(nightDateLabel(s.key).toUpperCase(), 94, 340);
    // Big number
    c.textAlign = "center"; c.fillStyle = "#ffc24d"; c.font = '330px "Black Ops One", Impact, sans-serif';
    c.fillText(String(s.beers), W / 2 - 90, 690);
    c.font = '190px sans-serif'; c.fillText("🍺", W / 2 + 190, 660);
    // Stat boxes
    var stats = [[t("nightBars"), String(s.bars)], [t("nightSkal"), String(s.skal)], [t("nightStreak"), streakText(s.best)]];
    if (s.others) stats.push([t("nightOther"), s.others + " 🥃"]);
    var bw = (W - 180 - (stats.length - 1) * 24) / stats.length;
    stats.forEach(function (st, i) {
      var bx = 90 + i * (bw + 24), by = 760;
      c.fillStyle = "rgba(16,24,38,.92)"; c.fillRect(bx, by, bw, 170);
      c.strokeStyle = "rgba(245,166,35,.45)"; c.lineWidth = 3; c.strokeRect(bx, by, bw, 170);
      c.fillStyle = "#9aa3a0"; c.font = '30px "Share Tech Mono", monospace'; c.textAlign = "center";
      c.fillText(String(st[0]).toUpperCase(), bx + bw / 2, by + 55);
      c.fillStyle = "#ece6d6"; c.font = (st[1].length > 6 ? "700 38px" : "700 64px") + ' "Chakra Petch", sans-serif';
      c.fillText(st[1], bx + bw / 2, by + 135);
    });
    // Badges + title
    c.textAlign = "center";
    if (s.badges.length) {
      c.fillStyle = "#9aa3a0"; c.font = '32px "Share Tech Mono", monospace';
      c.fillText(t("nightBadges").toUpperCase(), W / 2, 1010);
      c.font = "80px sans-serif"; c.fillText(s.badges.slice(0, 8).join(" "), W / 2, 1100);
    }
    if (s.title) { c.fillStyle = "#ffe08a"; c.font = '56px "Black Ops One", Impact, sans-serif'; c.fillText("🎖️ " + s.title, W / 2, s.badges.length ? 1200 : 1080); }
    c.fillStyle = "#6f7d4f"; c.font = '30px "Share Tech Mono", monospace';
    c.fillText("💧 " + t("care"), W / 2, H - 80);
  }
  function showNight(l) {
    var s = summaryOf(l);
    A.openSheet(t("nightTitle"), function (body) {
      var el = A.el;
      if (!s.beers && !s.others) { body.appendChild(el("p", { class: "muted", text: t("nightNone") })); return; }
      var cv = el("canvas", { class: "night-card", width: "1080", height: "1350", role: "img", "aria-label": t("nightText", s) });
      body.appendChild(cv);
      var row = el("div", { class: "row", style: "margin-top:10px" });
      body.appendChild(row);
      var text = t("nightText", s);
      fontsReady().then(function () {
        try { drawCard(cv, s); } catch (e) {}
        var blobP = new Promise(function (res) { try { cv.toBlob(function (b) { res(b); }, "image/png"); } catch (e) { res(null); } });
        blobP.then(function (blob) {
          if (!document.body.contains(row)) return;
          var file = null;
          try { if (blob && typeof File === "function") file = new File([blob], "olnu-kvall.png", { type: "image/png" }); } catch (e) { file = null; }
          var canFiles = false;
          try { canFiles = !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { canFiles = false; }
          if (canFiles) row.appendChild(A.btn(t("nightShare"), "btn-amber", function () { navigator.share({ files: [file], text: text, title: "Öl Nu" }).catch(function () {}); }));
          else if (blob) row.appendChild(A.btn(t("nightSave"), "btn-amber", function () {
            var url = URL.createObjectURL(blob), a = document.createElement("a");
            a.href = url; a.download = "olnu-kvall.png"; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          }));
          row.appendChild(A.btn(t("nightCopy"), "", function () { A.copyText(text); }));
        });
      });
    });
  }
  function showNightBest() {
    var l = getLog();
    if ((l.beers | 0) > 0 || (l.others | 0) > 0) { showNight(l); return; }
    var last = U.ls.getJSON(LAST_KEY, null);
    showNight(last && last.key ? last : l);
  }

  /* ---------- Annan drink / sidospår (v8, Q) ---------- */
  var OTHER_CD_KEY = "olnu.otherCd", OTHER_MS = 10 * 60 * 1000, OTHER_RING = 2 * Math.PI * 27;
  var otherTimer = null, otherBusy = false, otherMissing = false;
  var KINDS = ["rom", "vin", "cider", "drink", "shot", "whisky", "grogg", "bubbel", "annat"];
  function otherLeft() { var end = +U.ls.get(OTHER_CD_KEY, "0") || 0; return Math.max(0, end - Date.now()); }
  function applyOther() {
    var wrap = $("other-wrap"); if (!wrap) return;
    var on = !!(A && A.LIVE && A.othersOn() && !otherMissing);
    wrap.hidden = !on;
    if (!on) return;
    var left = otherLeft(), b = $("btn-other"), parts = String(t("otherBtn")).split(" ");
    b.classList.toggle("cooldown", left > 0);
    b.classList.toggle("busy", otherBusy);
    $("other-label").innerHTML = left > 0 ? '<span class="ol-t">' + esc(U.mmss(left)) + "</span>" :
      '<span class="ol-e" aria-hidden="true">' + esc(parts[0]) + '</span><span class="ol-t">' + esc(parts.slice(1).join(" ")) + "</span>";
    b.setAttribute("aria-label", left > 0 ? t("otherNextIn", U.mmss(left)) : t("otherAria"));
    $("ocd-ring").style.strokeDashoffset = String(OTHER_RING * (1 - Math.min(1, left / OTHER_MS)));
    if (left > 0 && !otherTimer) otherTimer = setInterval(applyOther, 1000);
    if (left <= 0 && otherTimer) { clearInterval(otherTimer); otherTimer = null; }
  }
  function pickOther() {
    if (otherBusy) return;
    var left = otherLeft();
    if (left > 0) { A.toast(t("otherWait", U.mmss(left))); return; }
    if (navigator.onLine === false) { A.toast(t("offline"), { err: true }); return; }
    var kinds = t("kinds") || {};
    A.openSheet(t("otherTitle"), function (body) {
      body.appendChild(A.el("p", { class: "muted", text: t("otherInfo") }));
      var grid = A.el("div", { class: "kind-grid" });
      KINDS.forEach(function (k) {
        var kk = kinds[k] || ["❓", k];
        grid.appendChild(A.el("button", { type: "button", class: "kind-btn", "data-kind": k, onclick: function () { A.closeSheet(); postOther(k); } }, [
          A.el("span", { class: "kb-e", "aria-hidden": "true", text: kk[0] }), A.el("span", { class: "kb-n", text: kk[1] })
        ]));
      });
      body.appendChild(grid);
    });
  }
  // Random line that was not shown in the last 8 picks for this drink.
  var recentDrink = {};
  function pickFresh(kind, list) {
    var r = recentDrink[kind] || (recentDrink[kind] = []), i, tries = 0;
    do { i = Math.floor(Math.random() * list.length); } while (r.indexOf(i) >= 0 && ++tries < 20);
    r.push(i); if (r.length > Math.min(8, list.length - 1)) r.shift();
    return list[i];
  }
  function postOther(kind) {
    if (otherBusy) return;
    if (!A.authed()) { A.toast(t("connecting")); return; }
    otherBusy = true; applyOther();
    window.FX.unlock(); window.FX.vibrate(20);
    var kinds = t("kinds") || {};
    A.getPosition().then(function (pos) {
      var prm = { p_kind: kind, p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_precise: A.prec() === "exact" };
      // post_other_v2 knows grogg/bubbel (0022). Old server: fall back to post_other ("annat" for the new kinds).
      return A.rpc("post_other_v2", prm).then(function (r) {
        if (r.error && U.missing(r.error)) {
          var old = { p_kind: kind === "grogg" || kind === "bubbel" ? "annat" : kind, p_lat: prm.p_lat, p_lng: prm.p_lng, p_precise: prm.p_precise };
          return A.rpc("post_other", old);
        }
        return r;
      }).then(function (r) {
        if (r.error) {
          if (U.missing(r.error)) { otherMissing = true; A.toast(t("postFail"), { err: true }); return; }
          A.toast(U.errCode(r.error) === "invalid_kind" ? t("invalidKind") : A.errMsg(r.error, t("postFail")), { err: true, ms: 6000 });
          return;
        }
        var d = A.parseData(r.data);
        if (d.accepted === false) {
          var w = Math.max(1, d.wait_seconds | 0) * 1000;
          U.ls.set(OTHER_CD_KEY, String(Date.now() + w));
          A.toast(t("otherWait", U.mmss(w)));
          return;
        }
        var wait = (d.wait_seconds | 0) > 0 ? (d.wait_seconds | 0) * 1000 : OTHER_MS;
        U.ls.set(OTHER_CD_KEY, String(Date.now() + wait));
        var name = (kinds[kind] || ["", kind])[1];
        // Half the time a line made for this drink (rom → pirat), else a general line with the drink's name.
        // Always a line made for this drink: 30 per drink in drink-lines.js (Swedish), else the short i18n list.
        var big = I.lang !== "en" && window.DRINK_LINES ? window.DRINK_LINES[kind] : null;
        var byKind = big && big.length ? big : (t("otherToastsKind") || {})[kind];
        var line = byKind && byKind.length ? pickFresh(kind, byKind) : pick(t("otherToasts"));
        A.toast(line.replace(/\{d\}/g, name), { cls: "hot" });
        window.FX.sound.clink(); window.FX.vibrate([30, 40, 30]);
        var l = getLog(); l.others = Math.max((l.others | 0) + 1, d.other_count | 0); saveLog(l);
        award("side");
        // v14 (owner): all drinks count – HOT STREAK / MEDEVAC at 5 / 10 drinks, water and "ta det lugnt" too.
        var total = Math.max(0, d.beer_count | 0) + Math.max(0, d.other_count | 0);
        if (A.drinkFx && total > 0) A.drinkFx(total, total - 1);
        if (total > 0 && total % 3 === 0) toastLater(pick(t("water")), { cls: "water", ms: 7000,
          action: MED() && MED().on() ? { label: I.lang === "en" ? "💧 Done" : "💧 Druckit vatten", fn: function () { MED().waterTaken(); } } : null }, 2600);
        if (MED() && MED().noteBeer) MED().noteBeer();
        if (ghostOn()) { toastLater(t("ghostToast"), {}, 1500); A.rpc("stop_beer").then(function () { A.refresh(); }); }
        var la = isFinite(d.lat) ? +d.lat : pos.coords.latitude, ln = isFinite(d.lng) ? +d.lng : pos.coords.longitude;
        A.setLastLoc(la, ln); A.map.setView([la, ln], Math.max(A.map.getZoom(), 15));
        A.refresh();
      });
    }, A.locError).catch(function () { A.toast(t("postFail"), { err: true }); })
      .then(function () { otherBusy = false; applyOther(); A.updateCounts(); });
  }

  /* ---------- Public hooks ---------- */
  window.EXTRAS = {
    ghostOn: ghostOn, award: award, showBadges: showBadges, showBadgesLegacy: showBadgesLegacy, showNight: showNightBest, taxiHTML: taxiHTML,
    otherTonight: function () { try { return getLog().others | 0; } catch (e) { return 0; } },

    init: function (api) {
      A = api;
      if (MED()) MED().init(api);
      getLog();   // roll over to a new night if needed (keeps last night for the summary)
      $("btn-other").addEventListener("click", pickOther);
      $("ocd-ring").style.strokeDasharray = String(OTHER_RING);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) applyOther(); });
    },
    applyText: function () { applyOther(); },
    onOthersState: function () { applyOther(); },
    onBeerAccepted: function (d, o) {
      o = o || {};
      var n = d.beer_count | 0, l = getLog();
      l.beers = Math.max(l.beers | 0, n); l.best = Math.max(l.best | 0, n);
      var bar = o.precise && isFinite(d.lat) && isFinite(d.lng) ? window.BARS.nearest(+d.lat, +d.lng) : null;
      if (bar && l.bars.indexOf(bar.id) < 0) l.bars.push(bar.id);
      saveLog(l);
      var nights = addNight(l.key);
      // Water first: it is the important one. Badge toasts queue after it.
      var tot = o.total != null ? o.total | 0 : n;   // v14: all drinks count
      if (tot > 0 && tot % 3 === 0) toastLater(pick(t("water")), { cls: "water", ms: 7000,
        action: MED() && MED().on() ? { label: I.lang === "en" ? "💧 Done" : "💧 Druckit vatten", fn: function () { MED().waterTaken(); } } : null }, 2600);
      if (MED()) MED().onBeerAccepted(d, o);
      award("first");
      if (bar) {
        var ever = U.ls.getJSON(BARS_KEY, []); if (!Array.isArray(ever)) ever = [];
        if (ever.indexOf(bar.id) < 0) { ever.push(bar.id); U.ls.setJSON(BARS_KEY, ever.slice(-500)); award("newbar"); }
      }
      if (l.bars.length >= 3) award("barhop");
      var h = U.hourSthlm();
      if (h >= 5 && h < 18) award("early");
      if (h >= 2 && h < 5) award("owl");
      if (tot >= 5) award("hot");
      if (tot >= 10) award("med");
      if (nights >= 3) award("week");
      if (o.ghost) { award("ghost"); toastLater(t("ghostToast"), {}, 1200); }
      A.updateCounts();
    },
    onAuthed: function () { if (MED()) MED().onAuthed(); },
    onPoll: function (beers) {
      if (MED()) MED().onPoll();
      var mine = A.myBeer(); if (!mine) return;
      var l = getLog(), sk = Math.max(0, mine.skal_count | 0);
      l.skal = Math.max(l.skal | 0, sk);
      l.beers = Math.max(l.beers | 0, mine.beer_count | 0); l.best = Math.max(l.best | 0, mine.beer_count | 0);
      l.others = Math.max(l.others | 0, mine.other_count | 0);
      saveLog(l);
      if (sk >= 10) award("skalking");
    },
    onStopped: function (kind) {
      if (MED()) MED().onStopped(kind);
      if (kind !== "home") return;
      var l = getLog(), night = A.myNight(), n = Math.max(l.beers | 0, night ? night.count | 0 : 0);
      if (n < 1) return;
      var h = U.hourSthlm();
      if (h >= 5 || h < 1) award("home01");
      if (n >= 10) award("survivor");
    },
    // Next open after 05:00: show last night's card once.
    onReadyShow: function () {
      if (!A.LIVE || A.sheetOpen()) return "";
      getLog();
      var last = U.ls.getJSON(LAST_KEY, null);
      if (!last || last.shown || !((last.beers | 0) > 0 || (last.others | 0) > 0)) return "";
      last.shown = true; U.ls.setJSON(LAST_KEY, last);
      showNight(last);
      return "1";
    },
    hudChipsHTML: function (ctx) {
      var h = "";
      if (!(window.SOCIAL && window.SOCIAL.hasTitle && window.SOCIAL.hasTitle())) {
        h += '<button type="button" class="hx-chip hx-badges" data-hx="badges" aria-label="' + esc(t("badgesBtn")) + '">🎖️</button>';
      }
      if (ghostOn()) h += '<span class="hx-chip hx-ghost" role="img" aria-label="' + esc(t("ghostHud")) + '" title="' + esc(t("ghostHud")) + '">👻</span>';
      if ((ctx && ctx.n | 0) >= 5) h += '<button type="button" class="hx-chip hx-taxi" data-hx="taxi">' + esc(t("taxi")) + "</button>";
      return h;
    },
    hudClick: function (action) {
      if (action === "badges") showBadges();
      else if (action === "taxi") showTaxi();
    },
    medevacExtraHTML: function () { return taxiHTML("to-taxi"); },
    stopSheet: function (body) {
      var night = A.myNight(), mine = A.myBeer(), n = mine ? mine.beer_count | 0 : night ? night.count | 0 : 0;
      if (n >= 5) taxiBlock(body);
      if (window.SOCIAL && window.SOCIAL.sosBlock) {
        var box = A.el("div", { class: "sos-wrap" });
        window.SOCIAL.sosBlock(box);
        if (box.children.length) { body.appendChild(A.el("h3", { text: t("safety") })); body.appendChild(box); }
      }
    },
    settingsSheet: function (body) {
      if (!A.LIVE) return;
      var el = A.el;
      body.appendChild(el("h3", { text: t("social") }));
      var sw = el("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(ghostOn()), "aria-label": t("ghostMode") });
      sw.addEventListener("click", function () {
        var on = sw.getAttribute("aria-checked") !== "true";
        U.ls.set(GHOST_KEY, on ? "1" : "0"); sw.setAttribute("aria-checked", String(on)); A.updateCounts();
      });
      body.appendChild(el("div", { class: "toggle-row" }, [el("span", { text: t("ghostMode") }), sw]));
      body.appendChild(el("p", { class: "muted", style: "margin-top:0", text: t("ghostModeInfo") }));
      var st = window.SOCIAL && window.SOCIAL.stats && window.SOCIAL.stats();
      if (st) body.appendChild(el("p", { class: "muted", text: t("titleHud", st.title, st.total) + " — " + window.SOCIAL.titleProgress() }));
      body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [
        A.btn(t("badgesBtn"), "btn-small", showBadges), A.btn(t("nightBtn"), "btn-small", showNightBest)
      ]));
      if (window.SOCIAL && window.SOCIAL.sosBlock) {
        var box = el("div", { style: "margin-top:12px" });
        window.SOCIAL.sosBlock(box);
        if (box.children.length) { body.appendChild(el("h3", { text: t("safety") })); body.appendChild(box); }
      }
    }
  };
})();
