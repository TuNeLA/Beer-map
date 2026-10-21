/* Öl Nu — 🏟️ ARENAPIN: arenas on the map (CONTRACT "ARENOR · matchpins, glöd och incheckning").
   window.ARENAPIN, in app.js mods(): init, onAuthed, onPoll, barPopupHTML, barIcoHTML, applyText. No RPC of its own, no new buttons.
   - Arenas = docs/arenas.json (scripts/arena-outlines.mjs, OSM outlines), loaded by js/bars.js as check-in places of type
     "arena" (BARS.arenas()). app.js draws NO bar marker for them; this module draws them instead:
       · the WHOLE outline glows (own pane "arenaglow", z 410: above every base map, barlit 380 and the heat canvas 400 (so a busy arena still glows), under all
         marker panes): icy blue 🏒 / grass green ⚽. Soft when a match is ≤ 7 days away, stronger on match day,
         a slow pulse (0.5 Hz) during the match. A wide faint halo stroke keeps it readable at zoom 12–13. Reduced motion = no pulse.
       · a small dark chip (pane "arenapins", z 580, under the bar markers 590): "🏒 tor 19:00", "ikväll 19:00", "om 45 min",
         "🔴 PÅGÅR" (≤ 1 Hz ring), a count badge when more matches are coming, "· 🍺 12" when people are there.
         Zoom ≥ 12 with a match; zoom ≥ 11 when people are there; zoom ≥ 13 a quiet 🏟️ chip (check-ins work every day).
     Tap the chip or the glow → the normal bar sheet (app.js barPopup: Checka in, Folk här …) with the match table on top
     (barPopupHTML, class ev-line): date/time, home – away, league, countdown, 🎟️ Biljett, 📨 Bjud in, 🪖 Vi går!, plus
     "🍺 Närmaste krog" (BARS) and "📺 Visas på" (SPORT.pubs).
   - Matches = EVSHEET's cached events_near2 rows (EVSHEET._cache(), no second fetch): local rows (not tv) with a sport, from
     7 days before the start until 2.5 h after it, at an arena ≤ 400 m away (or the same name ≤ 3 km away).
   - Other events (quiz, live …): at a known bar → a tiny 🎤 / 🎸 badge on that bar's icon (barIcoHTML) on the event day only;
     with a place but no bar / arena → a small event chip on the event day (zoom ≥ 13); tap = a small sheet (🎟️ / 📨 / 🪖).
   - 🎟️: events_near2 field ticket_url (migration 0105; club ticket page or the exact Tickster match). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, L = window.L, esc = U.esc;
  var A = null, map = null, glowLayer = null, pinLayer = null, glowR = null, timer = 0, drawKey = "", evAt = 0, reduce = false;
  var MATCH_Z = 12, CROWD_Z = 11, QUIET_Z = 13, EV_Z = 13, ARENA_M = 400, WEEK = 7 * 864e5, AFTER = 150 * 60e3;
  try { reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  function sv() { return !I || I.lang !== "en"; }
  function two(a) { return sv() ? a[0] : a[1]; }
  var lastPick = {};
  function pick(k, a) { var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === lastPick[k]) i = (i + 1) % a.length; lastPick[k] = i; return a[i]; }
  function fill(s, o) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? String(o[k]) : m; }); }

  /* ---------- texts (dalmål + military, ä for é) ---------- */
  var T = {
    live: ["🔴 PÅGÅR", "🔴 LIVE"], tonight: ["ikväll", "tonight"], today: ["idag", "today"],
    inMin: ["om {n} min", "in {n} min"],
    wd: [["sön", "mån", "tis", "ons", "tor", "fre", "lör"], ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]],
    head: [["🏒 Matchdags vid sargen", "🏒 Game time at the rink"], ["⚽ Matchdags på vallen", "⚽ Match day at the ground"]],
    kick: [
      ["Truppen samlas vid sargen. Ta med halsduken, lämna förståndet hemma.", "The squad gathers by the boards."],
      ["Hä ä match! Den som kommer sist bjuder på korven.", "Match on! Last one there buys the hot dogs."],
      ["Uppställning i läktarsektionen. Rösten ä ditt vapen.", "Line up in the stands. Your voice is your weapon."],
      ["Spaningen bekräftar: det blir match. Marschorder utfärdad.", "Recon confirms: there's a match. Marching orders issued."],
      ["Kläm in dig på läktarn – eller krigsrådet på krogen efteråt.", "Squeeze into the stands – or the war council at the pub after."],
      ["Dalregementet rekommenderar: värm upp rösten, int' bara ölen.", "Regiment advice: warm up your voice, not just your beer."]
    ],
    liveKick: [
      ["🔴 Matchen pågår! Hör du vrålet ända hit?", "🔴 Game on! Can you hear the roar?"],
      ["🔴 Det ä igång. Sitter du int' på läktarn, sitt på krogen.", "🔴 It's on. Not in the stands? Then at the pub."],
      ["🔴 Pågår just nu – rapportera ställningen till truppen!", "🔴 Live right now – report the score to the squad!"]
    ],
    noMatch: [["Ingen match den här veckan. Arenan vilar – men incheckning funkar alltid.", "No match this week. Check-ins work any day."]],
    ticket: ["🎟️ Biljett", "🎟️ Tickets"], inv: ["📨 Bjud in", "📨 Invite"], go: ["🪖 Vi går!", "🪖 We're going!"],
    pub: ["🍺 Närmaste krog: {name} ({m})", "🍺 Nearest pub: {name} ({m})"],
    tv: ["📺 Visas på: {list}", "📺 Showing at: {list}"],
    more: ["+{n} matcher till", "+{n} more matches"],
    evHead: ["📅 Ikväll här", "📅 Tonight here"],
    noTicket: ["Ingen biljettlänk – betala i dörrn, som förr.", "No ticket link – pay at the door."]
  };

  /* ---------- time ---------- */
  var TZ = "Europe/Stockholm";
  function parts(ms) {
    var p = {};
    try { new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
      .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; }); } catch (e) {}
    if (!p.hour) { var d = new Date(ms); p = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() }; }
    return p;
  }
  function hhmm(ms) { var p = parts(ms); return ("0" + (+p.hour % 24)).slice(-2) + ":" + ("0" + +p.minute).slice(-2); }
  function dayKey(ms) { var p = parts(ms); return p.year + "-" + p.month + "-" + p.day; }
  function eveKey(ms) { return dayKey(ms - 5 * 3600e3); }   // 00–05 still belongs to the evening before
  function wday(ms) { var p = parts(ms); var i = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday); return i < 0 ? new Date(ms).getDay() : i; }
  function stateOf(e, now) {
    var s = Date.parse(e.starts_at), end = e.ends_at ? Date.parse(e.ends_at) : s + AFTER;
    if (!isFinite(end) || end < s) end = s + AFTER;
    if (now >= s && now < end) return "live";
    if (s - now <= 3600e3 && s > now) return "soon";
    if (eveKey(s) === eveKey(now)) return "today";
    return "week";
  }
  function label(e, now) {
    var s = Date.parse(e.starts_at), st = stateOf(e, now);
    if (st === "live") return two(T.live);
    if (st === "soon") return fill(two(T.inMin), { n: Math.max(1, Math.round((s - now) / 60000)) });
    if (st === "today") return (+parts(s).hour >= 16 ? two(T.tonight) : two(T.today)) + " " + hhmm(s);
    return two(T.wd)[wday(s)] + " " + hhmm(s);
  }
  function cdText(e) { try { return window.EVSHEET && window.EVSHEET._countdown ? window.EVSHEET._countdown(e) : ""; } catch (x) { return ""; } }
  function dayText(ms, now) {
    if (eveKey(ms) === eveKey(now)) return +parts(ms).hour >= 16 ? two(T.tonight) : two(T.today);
    var p = parts(ms); return two(T.wd)[wday(ms)] + " " + (+p.day) + "/" + (+p.month);
  }

  /* ---------- data ---------- */
  function arenas() { try { return window.BARS && window.BARS.arenas ? window.BARS.arenas() : []; } catch (e) { return []; } }
  function rows() { try { var c = window.EVSHEET && window.EVSHEET._cache && window.EVSHEET._cache(); return c && Array.isArray(c.rows) ? c.rows : []; } catch (e) { return []; } }
  function nrm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
  function sportOf(e) {
    if (e.sport === "hockey" || e.sport === "fotboll") return e.sport;
    return null;
  }
  function isMatch(e) { return e && !e.tv && !e.pending && !!sportOf(e) && e.lat != null && isFinite(e.lat) && isFinite(e.lng); }
  function arenaFor(e, list) {
    var best = null, bd = ARENA_M, pn = nrm(e.place);
    for (var i = 0; i < list.length; i++) {
      var a = list[i], d = U.haversine(e.lat, e.lng, a.lat, a.lng);
      if (pn && nrm(a.name) === pn && d <= 3000) return a;
      if (d <= bd) { bd = d; best = a; }
    }
    return best;
  }
  // arena id → { arena, matches: [rows, by start] } for matches from 7 days before to 2.5 h after the start
  function matchMap(now) {
    var list = arenas(), out = {};
    if (!list.length) return out;
    rows().forEach(function (e) {
      if (!isMatch(e)) return;
      var s = Date.parse(e.starts_at); if (!isFinite(s)) return;
      var end = e.ends_at ? Date.parse(e.ends_at) : s + AFTER; if (!isFinite(end) || end < s) end = s + AFTER;
      if (now >= end || s - now > WEEK) return;
      var a = arenaFor(e, list); if (!a) return;
      (out[a.id] || (out[a.id] = { arena: a, matches: [] })).matches.push(e);
    });
    Object.keys(out).forEach(function (k) { out[k].matches.sort(function (x, y) { return Date.parse(x.starts_at) - Date.parse(y.starts_at); }); });
    return out;
  }
  function crowdAt(id) {
    var n = 0;
    try { var agg = window.BARS.assign(A.beers()).perBar[id]; if (agg) n = agg.beers.length; } catch (e) {}
    try {
      var cid = window.BARS.canonId(id), ci = (A.checkins && A.checkins()) || [];
      ci.forEach(function (c) { if (window.BARS.canonId(c.bar_id) === cid) n++; });
    } catch (e) {}
    return n;
  }
  function sportOfArena(a, mm) { var m = mm && mm.matches[0]; return (m && sportOf(m)) || a.s || null; }
  function ico(sp) { return sp === "hockey" ? "🏒" : sp === "fotboll" ? "⚽" : "🏟️"; }

  /* ---------- look ---------- */
  var CSS =
    ".leaflet-arenaglow-pane path.ap-g{stroke-linejoin:round;stroke-linecap:round;transition:fill-opacity .4s,stroke-opacity .4s}" +
    ".leaflet-arenaglow-pane path.ap-g-live{animation:ap-glow 2s ease-in-out infinite}" +
    ".leaflet-arenaglow-pane path.ap-h-live{animation:ap-halo 2s ease-in-out infinite}" +
    "@keyframes ap-glow{0%,100%{fill-opacity:.3;stroke-opacity:.85}50%{fill-opacity:.5;stroke-opacity:1}}" +
    "@keyframes ap-halo{0%,100%{stroke-opacity:.22}50%{stroke-opacity:.42}}" +
    ".ap-mk{background:none;border:0}" +
    ".ap-pin{position:absolute;left:0;top:0;transform:translate(-50%,calc(-100% - 9px));display:flex;align-items:center;gap:4px;white-space:nowrap;" +
      "height:26px;padding:0 9px 0 6px;border-radius:999px;background:rgba(10,15,28,.92);color:var(--ds-text,#eef0ec);" +
      "font:700 12px/1 var(--ds-sans,system-ui,sans-serif);letter-spacing:.01em;border:1.5px solid var(--ap-c,#8fd8ff);" +
      "box-shadow:0 1px 2px rgba(0,0,0,.55),0 3px 10px rgba(0,0,0,.4),0 0 0 3px rgba(10,15,28,.25);cursor:pointer;user-select:none;-webkit-user-select:none}" +
    ".ap-pin::after{content:'';position:absolute;inset:-9px -4px -14px}" +
    ".ap-pin::before{content:'';position:absolute;left:50%;bottom:-6px;width:8px;height:8px;margin-left:-4px;background:inherit;border:inherit;border-top:0;border-left:0;transform:rotate(45deg);border-radius:0 0 2px 0}" +
    ".ap-pin .ap-i{font-size:14px;line-height:1}" +
    ".ap-pin .ap-c{color:var(--ds-amber-t,#ffc24d);font-weight:700}" +
    ".ap-pin .ap-n{position:absolute;right:-7px;top:-8px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:var(--ap-c,#8fd8ff);" +
      "color:#03121c;font:700 11px/17px var(--ds-sans,system-ui,sans-serif);text-align:center;box-shadow:0 0 0 1.5px #0a0f1c;font-style:normal}" +
    ".ap-hockey{--ap-c:#8fd8ff}.ap-fotboll{--ap-c:#6fe07a}.ap-none{--ap-c:rgba(238,240,236,.35)}" +
    ".ap-pin.ap-today{background:rgba(12,20,36,.96);box-shadow:0 1px 2px rgba(0,0,0,.55),0 3px 12px rgba(0,0,0,.45),0 0 10px var(--ap-c)}" +
    ".ap-pin.ap-live{border-color:#ff5a52;box-shadow:0 1px 2px rgba(0,0,0,.55),0 0 0 0 rgba(255,90,82,.6);animation:ap-ring 1.6s ease-out infinite}" +
    "@keyframes ap-ring{0%{box-shadow:0 1px 2px rgba(0,0,0,.55),0 0 0 0 rgba(255,90,82,.55)}100%{box-shadow:0 1px 2px rgba(0,0,0,.55),0 0 0 9px rgba(255,90,82,0)}}" +
    ".ap-pin.ap-quiet{height:22px;padding:0 5px;opacity:.82;font-size:11px;gap:3px;transform:translate(-50%,-50%)}" +
    ".ap-pin.ap-quiet::before{display:none}" +
    ".ap-pin.ap-quiet .ap-i{font-size:12px}" +
    ".ap-pin.ap-ev{--ap-c:var(--ds-amber,#f5a623);height:24px}" +
    ".bi-ev{position:absolute;left:-9px;top:-10px;font-size:11px;line-height:1;filter:drop-shadow(0 1px 1px #000) drop-shadow(0 0 2px #000);pointer-events:none}" +
    ".cm.cm-quiet .bi-ev{font-size:10px;left:-8px;top:-9px}" +
    ".ev-line.ap-sec{display:block;margin:8px 0 10px;padding:10px 12px;border-radius:12px;background:rgba(143,216,255,.07);border:1px solid rgba(143,216,255,.28)}" +
    ".ev-line.ap-sec.ap-sec-fotboll{background:rgba(111,224,122,.07);border-color:rgba(111,224,122,.22)}" +
    ".ap-sec .ap-h{font-weight:700;font-size:14px;margin:0 0 2px}" +
    ".ap-sec .ap-k{font-size:12px;color:var(--ds-text-2,#c9d0cd);margin:0 0 8px}" +
    ".ap-tab{display:flex;flex-direction:column;gap:8px}" +
    ".ap-row{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;align-items:start;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}" +
    ".ap-row:first-child{border-top:0;padding-top:0}" +
    ".ap-when{font-weight:700;font-size:13px;min-width:58px;line-height:1.25}" +
    ".ap-when small{display:block;font-weight:600;font-size:11px;color:var(--ds-muted,#a7b0ac)}" +
    ".ap-when .ap-lv{color:#ff7b73}" +
    ".ap-who b{display:block;font-size:14px;line-height:1.3}" +
    ".ap-who span{font-size:12px;color:var(--ds-muted,#a7b0ac)}" +
    ".ap-acts{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}" +
    ".ap-acts .btn,.ap-acts a.ap-tk{min-height:36px;padding:0 12px;font-size:13px;border-radius:999px;display:inline-flex;align-items:center;text-decoration:none}" +
    ".ap-acts a.ap-tk{background:var(--ds-amber,#f5a623);color:var(--ds-on-amber,#241300);font-weight:700}" +
    ".ap-foot{font-size:12px;color:var(--ds-text-2,#c9d0cd);margin-top:8px;display:flex;flex-direction:column;gap:3px}" +
    "@media (prefers-reduced-motion:reduce){.leaflet-arenaglow-pane path.ap-g-live,.leaflet-arenaglow-pane path.ap-h-live,.ap-pin.ap-live{animation:none !important}}";

  // Glow styles: [halo, outline] per strength; the halo is a wide faint stroke (readable at zoom 12–13).
  var COL = { hockey: { s: "#9be0ff", f: "#4ab8ff" }, fotboll: { s: "#7ff08a", f: "#33c24f" } };
  function glowStyle(sp, st, z) {
    var c = COL[sp] || COL.hockey, live = st === "live", day = live || st === "today" || st === "soon", town = z <= 13;
    return {
      // town zoom: the hall is only a few px, so the halo is wider and the outline never thinner than 2.5 px
      halo: { color: c.s, weight: (day ? 14 : 10) + (town ? 10 : 0), opacity: (day ? 0.32 : 0.2) + (town ? 0.16 : 0), fill: false, className: "ap-h" + (live && !reduce ? " ap-h-live" : "") },
      line: { color: c.s, weight: (day ? 3 : 2) + (town ? 1 : 0), opacity: day ? 1 : 0.85, fillColor: c.f, fillOpacity: (live ? 0.42 : day ? 0.34 : 0.18) + (town ? 0.2 : 0),
        className: "ap-g ap-g-" + (st === "soon" ? "today" : st) + (live && !reduce ? " ap-g-live" : "") }
    };
  }
  function ringsOf(a) { return (a.g || []).map(function (ring) { return ring.map(function (p) { return [p[1], p[0]]; }); }); }

  /* ---------- draw ---------- */
  function ensure() {
    if (!map || glowLayer) return !!glowLayer;
    if (!map.getPane("arenaglow")) { map.createPane("arenaglow"); map.getPane("arenaglow").style.zIndex = 410; }
    if (!map.getPane("arenapins")) { map.createPane("arenapins"); map.getPane("arenapins").style.zIndex = 580; }
    glowR = L.svg({ pane: "arenaglow", padding: 0.3 });
    glowLayer = L.layerGroup().addTo(map); pinLayer = L.layerGroup().addTo(map);
    var st = document.createElement("style"); st.id = "arenapin-css"; st.textContent = CSS; document.head.appendChild(st);
    return true;
  }
  function draw(force) {
    if (!A || !map || !ensure()) return;
    var now = Date.now(), z = map.getZoom(), mm = matchMap(now), list = arenas();
    var b = map.getBounds().pad(0.3), parts0 = [z <= 13 ? 1 : 0, z >= MATCH_Z ? 1 : 0, z >= QUIET_Z ? 1 : 0, z >= CROWD_Z ? 1 : 0, sv() ? "s" : "e", Math.floor(now / 30000)];
    var items = [];
    list.forEach(function (a) {
      if (!b.contains([a.lat, a.lng])) return;
      var m = mm[a.id], n = z >= CROWD_Z ? crowdAt(a.id) : 0, next = m ? m.matches[0] : null;
      var st = next ? stateOf(next, now) : null;
      var show = (m && z >= MATCH_Z) || (n > 0 && z >= CROWD_Z) || z >= QUIET_Z;
      if (!show) return;
      items.push({ a: a, m: m, n: n, st: st, lbl: next ? label(next, now) : "" });
    });
    var evs = z >= EV_Z ? loosePins(now, list) : [];
    var key = parts0.join("|") + "#" + items.map(function (x) { return x.a.id + ":" + x.n + ":" + x.st + ":" + x.lbl + ":" + (x.m ? x.m.matches.length : 0); }).join(",") +
      "#" + evs.map(function (e) { return e.id; }).join(",");
    if (!force && key === drawKey) return;
    drawKey = key;
    glowLayer.clearLayers(); pinLayer.clearLayers();
    items.forEach(function (x) {
      var a = x.a, sp = sportOfArena(a, x.m);
      if (x.m && a.g && a.g.length && z >= 11) {
        var gs = glowStyle(sp, x.st, z), ll = ringsOf(a);
        L.polygon(ll, Object.assign({ pane: "arenaglow", renderer: glowR, interactive: false }, gs.halo)).addTo(glowLayer);
        var poly = L.polygon(ll, Object.assign({ pane: "arenaglow", renderer: glowR, interactive: true, bubblingMouseEvents: false }, gs.line)).addTo(glowLayer);
        poly.on("click", function (ev) { if (ev.originalEvent) L.DomEvent.stop(ev.originalEvent); openArena(a); });
      }
      pinLayer.addLayer(pinMarker(x, sp));
    });
    evs.forEach(function (e) { pinLayer.addLayer(evMarker(e, now)); });
  }
  function pinMarker(x, sp) {
    var a = x.a, cls = "ap-pin ap-" + (sp || "none") + (x.m ? " ap-" + (x.st === "soon" ? "today" : x.st) : x.n ? "" : " ap-quiet");
    var h = '<div class="' + cls + '" role="button" aria-label="' + esc(a.name + (x.lbl ? " – " + x.lbl : "")) + '">' +
      '<span class="ap-i" aria-hidden="true">' + ico(sp) + "</span>";
    if (x.lbl) h += "<span>" + esc(x.lbl) + "</span>";
    if (x.n) h += '<span class="ap-c">' + (x.lbl ? "· " : "") + "🍺 " + x.n + "</span>";
    if (x.m && x.m.matches.length > 1) h += '<i class="ap-n" aria-hidden="true">' + x.m.matches.length + "</i>";
    h += "</div>";
    var mk = L.marker(x.m || x.n ? topOf(a) : [a.lat, a.lng], { pane: "arenapins", keyboard: false, riseOnHover: true,
      icon: L.divIcon({ html: h, className: "ap-mk", iconSize: [0, 0], iconAnchor: [0, 0] }),
      zIndexOffset: x.st === "live" ? 300 : x.m ? 200 : x.n ? 100 : 0 });
    mk.on("click", function () { openArena(a); });
    return mk;
  }
  // The chip's tail points at the top edge of the outline (the hall itself stays visible under it).
  function topOf(a) {
    if (a._top) return a._top;
    var t = [a.lat, a.lng];
    try {
      var ring = a.g && a.g[0], top = -90, x0 = 180, x1 = -180;
      if (ring && ring.length > 3) {
        ring.forEach(function (p) { if (p[1] > top) top = p[1]; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; });
        if (U.haversine(top, a.lng, a.lat, a.lng) < 250) t = [top, Math.max(x0, Math.min(x1, a.lng))];
      }
    } catch (e) {}
    a._top = t; return t;
  }
  function phone() { try { return window.matchMedia("(max-width: 600px)").matches; } catch (e) { return false; } }
  function openArena(a) {
    try { if (window.FX && FX.haptic) FX.haptic(10); } catch (e) {}
    if (A.barPopup) {
      L.popup({ className: "olnu-bar", offset: L.point(0, -12), autoPan: !phone(), maxWidth: Math.min(320, (window.innerWidth || 360) - 40) })
        .setLatLng([a.lat, a.lng]).setContent(A.barPopup(a)).openOn(map);
      return;
    }
    if (A.openBar) A.openBar(a);
  }

  /* ---------- the match table (inside the bar sheet) ---------- */
  function evById(id) { id = String(id); return rows().filter(function (e) { return String(e.id) === id; })[0] || null; }
  function tableHTML(a) {
    var now = Date.now(), m = matchMap(now)[a.id], sp = sportOfArena(a, m), h = "";
    if (!m) return '<div class="ev-line ap-sec ap-sec-' + (sp || "hockey") + '"><p class="ap-k">' + esc(two(T.noMatch[0])) + "</p></div>";
    var live = stateOf(m.matches[0], now) === "live";
    h += '<div class="ev-line ap-sec ap-sec-' + (sp || "hockey") + '" data-aparena="' + esc(String(a.id)) + '">';
    h += '<p class="ap-h">' + esc(two(T.head[sp === "fotboll" ? 1 : 0])) + "</p>";
    h += '<p class="ap-k">' + esc(sv() ? pick(live ? "lk" : "k", (live ? T.liveKick : T.kick).map(function (x) { return x[0]; })) : (live ? T.liveKick : T.kick)[0][1]) + "</p>";
    h += '<div class="ap-tab" role="list">';
    m.matches.slice(0, 6).forEach(function (e) {
      var s = Date.parse(e.starts_at), st = stateOf(e, now);
      var who = e.home && e.away ? e.home + " – " + e.away : e.title;
      h += '<div class="ap-row" role="listitem">' +
        '<div class="ap-when">' + esc(hhmm(s)) + "<small" + (st === "live" ? ' class="ap-lv"' : "") + ">" + esc(st === "live" ? two(T.live) : dayText(s, now)) + "</small>" +
        (st !== "live" ? "<small>" + esc(cdText(e)) + "</small>" : "") + "</div>" +
        '<div class="ap-who"><b>' + esc(who) + "</b><span>" + esc([e.league, e.place].filter(Boolean).join(" · ")) + "</span></div>" +
        '<div class="ap-acts">' +
        (e.ticket_url && /^https:\/\//.test(e.ticket_url) ? '<a class="ap-tk" href="' + esc(e.ticket_url) + '" target="_blank" rel="noopener nofollow">' + esc(two(T.ticket)) + "</a>" : "") +
        (window.INVITE && window.INVITE.openCreate ? '<button type="button" class="btn btn-small" data-apinv="' + esc(String(e.id)) + '">' + esc(two(T.inv)) + "</button>" : "") +
        (window.EVENTS && window.EVENTS.go ? '<button type="button" class="btn btn-small btn-green" data-apgo="' + esc(String(e.id)) + '">' + esc(two(T.go)) + "</button>" : "") +
        "</div></div>";
    });
    h += "</div>";
    if (m.matches.length > 6) h += '<p class="ap-k">' + esc(fill(two(T.more), { n: m.matches.length - 6 })) + "</p>";
    var foot = [], pub = nearestPub(a), tv = tvPubs(a);
    if (pub) foot.push(fill(two(T.pub), { name: pub.bar.name, m: pub.d < 1000 ? Math.round(pub.d / 10) * 10 + " m" : (Math.round(pub.d / 100) / 10).toString().replace(".", ",") + " km" }));
    if (tv.length) foot.push(fill(two(T.tv), { list: tv.join(", ") }));
    if (foot.length) h += '<div class="ap-foot">' + foot.map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("") + "</div>";
    return h + "</div>";
  }
  // Nearest bar / pub (not restaurants, not arenas) within 3 km → { bar, d }
  function nearestPub(a) {
    try {
      var box = L.latLngBounds([a.lat - 0.027, a.lng - 0.055], [a.lat + 0.027, a.lng + 0.055]), best = null;
      (window.BARS.inBounds(box, 4000) || []).forEach(function (b) {
        if (!b || b.arena || b.place || !b.name || !/^(bar|pub|nightclub|biergarten)$/.test(String(b.type || "bar"))) return;
        var d = U.haversine(a.lat, a.lng, b.lat, b.lng);
        if (d <= 3000 && (!best || d < best.d)) best = { bar: b, d: d };
      });
      return best;
    } catch (e) { return null; }
  }
  function tvPubs(a) {
    try {
      return (window.SPORT && window.SPORT.pubs ? window.SPORT.pubs(a.lat, a.lng, 6) : []).filter(function (p) { return p.km <= 5; }).slice(0, 3).map(function (p) { return p.name; }).filter(Boolean);
    } catch (e) { return []; }
  }
  function onDocClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest("[data-apinv],[data-apgo],[data-apevinv],[data-apevgo]") : null;
    if (!t || !A) return;
    ev.preventDefault(); ev.stopPropagation();
    var id = t.getAttribute("data-apinv") || t.getAttribute("data-apgo") || t.getAttribute("data-apevinv") || t.getAttribute("data-apevgo");
    var e = evById(id); if (!e) return;
    if (t.hasAttribute("data-apgo") || t.hasAttribute("data-apevgo")) { try { window.EVENTS.go(e, t); } catch (x) {} return; }
    try { map.closePopup(); } catch (x) {}
    try { window.INVITE.openCreate({ event: e }); } catch (x) {}
  }

  /* ---------- other events: bar badge + loose event chips ---------- */
  var EV_ICO = { quiz: "🎤", karaoke: "🎤", live: "🎸", standup: "🎭", dj: "🎧", party: "🎉" };
  function evTonight(e, now) {
    if (!e || e.tv || e.pending || sportOf(e) || e.kind === "sport" || !EV_ICO[e.kind]) return false;
    var s = Date.parse(e.starts_at), end = e.ends_at ? Date.parse(e.ends_at) : s + 3 * 3600e3;
    return isFinite(s) && now < end && eveKey(s) === eveKey(now);
  }
  function barEvents(bar) {
    if (!bar || bar.id == null || bar.arena) return [];
    var now = Date.now(), id;
    try { id = window.BARS.canonId(bar.id); } catch (e) { id = String(bar.id); }
    return rows().filter(function (e) {
      if (!evTonight(e, now) || e.bar_id == null) return false;
      try { return window.BARS.canonId(e.bar_id) === id; } catch (x) { return String(e.bar_id) === id; }
    });
  }
  function loosePins(now, list) {
    var b = map.getBounds().pad(0.2), seen = {};
    return rows().filter(function (e) {
      if (!evTonight(e, now) || e.lat == null || !isFinite(e.lat) || !b.contains([e.lat, e.lng])) return false;
      var bar = null; try { bar = e.bar_id != null && window.BARS.byId(e.bar_id); } catch (x) {}
      if (bar) return false;                                  // at a known bar: the badge on its icon instead
      if (arenaFor(e, list)) return false;                    // at an arena: its sheet lists it
      var k = Math.round(e.lat * 2000) + "_" + Math.round(e.lng * 1000); if (seen[k]) return false; seen[k] = 1;
      return true;
    }).slice(0, 20);
  }
  function evMarker(e, now) {
    var s = Date.parse(e.starts_at), live = now >= s;
    var h = '<div class="ap-pin ap-ev" role="button" aria-label="' + esc(e.title) + '"><span class="ap-i" aria-hidden="true">' + (EV_ICO[e.kind] || "📅") + "</span><span>" +
      esc(live ? two(T.live) : hhmm(s)) + "</span></div>";
    var mk = L.marker([e.lat, e.lng], { pane: "arenapins", keyboard: false, icon: L.divIcon({ html: h, className: "ap-mk", iconSize: [0, 0], iconAnchor: [0, 0] }) });
    mk.on("click", function () { evSheet(e); });
    return mk;
  }
  function evSheet(e) {
    var s = Date.parse(e.starts_at);
    A.openSheet((EV_ICO[e.kind] || "📅") + " " + String(e.title || "").slice(0, 40), function (body) {
      body.appendChild(A.el("p", { class: "ap-k", text: [e.place, hhmm(s), cdText(e)].filter(Boolean).join(" · ") }));
      var acts = A.el("div", { class: "ap-acts" });
      if (e.ticket_url && /^https:\/\//.test(e.ticket_url)) acts.appendChild(A.el("a", { class: "ap-tk", href: e.ticket_url, target: "_blank", rel: "noopener nofollow", text: two(T.ticket) }));
      if (window.INVITE && window.INVITE.openCreate) acts.appendChild(A.btn(two(T.inv), "btn-small", function () { try { window.INVITE.openCreate({ event: e }); } catch (x) {} }));
      if (window.EVENTS && window.EVENTS.go) acts.appendChild(A.btn(two(T.go), "btn-small btn-green", function (ev) { try { window.EVENTS.go(e, ev.currentTarget); } catch (x) {} }));
      body.appendChild(acts);
    });
  }
  function barIcoHTML(bar) {
    var l = barEvents(bar); if (!l.length) return "";
    return '<span class="bi-ev" aria-hidden="true">' + (EV_ICO[l[0].kind] || "📅") + "</span>";
  }

  /* ---------- wiring ---------- */
  // EVSHEET rows changed → bar badges need a marker redraw (once), arena pins redraw themselves.
  function evChanged() {
    var c = null; try { c = window.EVSHEET && window.EVSHEET._cache && window.EVSHEET._cache(); } catch (e) {}
    if (!c || !c.at || c.at === evAt) return false;
    evAt = c.at;
    try { if (A.render) A.render(); } catch (e) {}
    return true;
  }
  function soon() { clearTimeout(timer); timer = setTimeout(function () { draw(false); }, 120); }
  window.ARENAPIN = {
    init: function (api) {
      A = api; map = api && api.map; if (!map || !L) return;
      document.addEventListener("click", onDocClick, true);
      map.on("zoomend moveend", soon);
      setInterval(function () { if (document.visibilityState !== "hidden") { evChanged(); draw(false); } }, 30000);
      try { if (window.BARS && window.BARS.onArenas) window.BARS.onArenas(function () { draw(true); }); } catch (e) {}
      setTimeout(function () { draw(true); }, 1500);
    },
    onAuthed: function () { setTimeout(function () { evChanged(); draw(true); }, 2500); },
    onPoll: function () { evChanged(); draw(false); },
    barPopupHTML: function (bar) { try { return bar && bar.arena ? tableHTML(bar) : ""; } catch (e) { return ""; } },
    barIcoHTML: function (bar) { try { return barIcoHTML(bar); } catch (e) { return ""; } },
    applyText: function () { draw(true); },
    // tests
    _matches: function () { return matchMap(Date.now()); }, _label: label, _state: stateOf, _draw: draw, T: T
  };
})();
