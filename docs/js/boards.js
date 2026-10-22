/* Öl Nu v17 TOPPLISTOR. window.BOARDS, called through mods() in app.js (init, topSheet, settingsSheet).
   1 🏆 "<Stad>s törstigaste" – local top list (ikväll / veckan), all drinks count, 20 km around you.
   2 🏛️ "<Stad>s Wall of Fame" – all-time records of the town.
   Names only for people who switched on "Visa mig på topplistan" (default off). Everybody else is
   "Hemlig agent". The server never sends positions. Server: migration 0023 (local_board, wall_of_fame,
   set_board_optin, my_board_optin). Older database: the sections hide quietly. Never breaks the map. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null;
  var off = false;                 // a board RPC is missing on this server → feature off
  var optin = null;                // null = unknown, else { on, name }
  var cache = {};                  // key → { at, rows }
  var CACHE_MS = 60000;
  var tab = "tonight";
  try { tab = localStorage.getItem("olnu.boardTab") === "week" ? "week" : "tonight"; } catch (e) {}

  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  var TXT = {
    hidden: ["Hemlig agent", "Secret agent"],
    you: [" (du)", " (you)"],
    youHidden: ["Du (hemlig)", "You (hidden)"],
    tonight: ["Ikväll", "Tonight"],
    week: ["Veckan", "This week"],
    drinks: [" st", ""],
    nights1: [" kväll", " night"],
    nightsN: [" kvällar", " nights"],
    toggle: ["Visa mig på topplistan", "Show me on the top list"],
    toggleOn: ["🏆 Nu syns du på topplistan. Skärp dig, dä!", "🏆 You are on the top list now."],
    toggleOff: ["🕵️ Du ä en hemlig agent igen.", "🕵️ You are a secret agent again."],
    toggleFail: ["Kunde inte spara. Försök igen.", "Could not save. Try again."],
    toggleNote: ["Av = du syns som \"Hemlig agent\". Ingen plats visas, bara antal.",
      "Off = you show as \"Secret agent\". No place is shown, only counts."],
    load: ["Kunde inte hämta listan.", "Could not load the list."],
    slow: ["Lugn i stormen – vänta en minut.", "Easy – wait a minute."],
    care: ["Allt räknas: öl, vin, grogg och resten. Drick lagom och ta vatten mellan varven.",
      "All drinks count. Drink sensibly and have water in between."],
    wallNote: ["All-time-rekord inom 2 mil. Bara de som valt det syns med namn.",
      "All-time records within 20 km. Only people who opted in show by name."],
    you2: ["Du: ", "You: "]
  };
  function T(k) { var x = TXT[k]; return x ? (sv() ? x[0] : x[1]) : k; }

  var EMPTY = {
    tonight: [
      ["Ingen har druckit nåt än ikväll. Konstigt, dä.", "Nobody has had a drink here tonight."],
      ["Tomt på listan. Hela stan sitter visst hemma och stickar.", "The list is empty tonight."],
      ["Inte en själ. Ölguden väntar på första modiga soldaten.", "Not a soul yet tonight."]
    ],
    week: [
      ["Ingen har varit ute den här veckan. Lugnaste veckan sen 1700-talet.", "Nobody has been out this week."],
      ["Tom vecka. Bryggerierna i Dalarna oroar sig.", "Empty week so far."]
    ],
    wall: [
      ["Inga rekord än. Historien skrivs ikväll, kanske.", "No records yet."],
      ["Wall of Fame ä tom. Spikarna sitter uppe, tavlorna saknas.", "The Wall of Fame is empty."]
    ]
  };
  function emptyLine(k) { var p = pick(EMPTY[k]); return sv() ? p[0] : p[1]; }

  var CATS = {
    best_night: ["🍻", "Bästa kvällen", "Best night", "på en kväll", "in one night"],
    nights: ["🌙", "Flest utekvällar", "Most nights out", "kvällar ute", "nights out"],
    bars: ["🗺️", "Krogkartografen", "Most bars", "olika krogar", "different bars"],
    stammis: ["🪑", "Längsta stammisen", "Longest regular", "kvällar på samma krog", "nights at one bar"],
    skal: ["🥂", "Skålkungen", "Cheers king", "skål utdelade", "cheers given"],
    home: ["🏠", "Kom hem säkert", "Home safe", "kvällar hemma säkert", "nights home safe"]
  };
  var CAT_ORDER = ["best_night", "nights", "bars", "stammis", "skal", "home"];

  /* ---------- Place ---------- */
  function where() {
    var p = null;
    try {
      var me = A.me && A.me();
      if (me && isFinite(me.lat) && isFinite(me.lng) && me.lat !== null) p = { lat: +me.lat, lng: +me.lng };
      if (!p && A.lastLoc) { var l = A.lastLoc(); if (l && isFinite(l.lat) && isFinite(l.lng)) p = { lat: +l.lat, lng: +l.lng }; }
      if (!p && A.map) { var c = A.map.getCenter(); p = { lat: c.lat, lng: c.lng }; }
    } catch (e) {}
    if (!p) p = { lat: 60.1496, lng: 15.1878 };
    // Leaflet may give a wrapped longitude; keep it in -180..180.
    p.lng = ((((p.lng + 180) % 360) + 360) % 360) - 180;
    p.lat = Math.max(-85, Math.min(85, p.lat));
    return p;
  }
  function townOf(p) {
    var c = null;
    try { c = window.CITIES && window.CITIES.nearest(p.lat, p.lng); } catch (e) {}
    return c ? c.name : "";
  }
  // Swedish genitive: Ludvika → Ludvikas, Borås → Borås.
  function gen(name) { return /[sxz]$/i.test(name) ? name : name + "s"; }
  function titleTop(town) {
    if (sv()) return "🏆 " + (town ? gen(town) + " törstigaste" : "Närområdets törstigaste");
    return "🏆 " + (town ? town + "'s thirstiest" : "Thirstiest nearby");
  }
  function titleWall(town) {
    if (sv()) return "🏛️ " + (town ? gen(town) + " Wall of Fame" : "Närområdets Wall of Fame");
    return "🏛️ " + (town ? town + " Wall of Fame" : "Wall of Fame nearby");
  }

  /* ---------- Server ---------- */
  function rows(r) { return r && Array.isArray(r.data) ? r.data : []; }
  function call(name, params) {
    if (!A || !A.LIVE || off) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r && r.error && U.missing(r.error)) { off = true; r.off = true; }
      return r || { data: null, error: { message: "error" } };
    });
  }
  function cached(key, name, params) {
    var c = cache[key];
    if (c && Date.now() - c.at < CACHE_MS) return Promise.resolve({ rows: c.rows });
    return call(name, params).then(function (r) {
      if (r.error) return { error: r.error, off: !!r.off };
      cache[key] = { at: Date.now(), rows: rows(r) };
      return { rows: cache[key].rows };
    });
  }
  // v25 (0033): local_board_v2 / wall_of_fame_v2 add home_town (only when the name is shown). Old server → v1.
  var v2off = {};
  function cached2(key, n2, n1, params) {
    if (v2off[n2]) return cached(key, n1, params);
    var c = cache[key];
    if (c && Date.now() - c.at < CACHE_MS) return Promise.resolve({ rows: c.rows });
    if (!A || !A.LIVE || off) return cached(key, n1, params);
    return A.rpc(n2, params).then(function (r) {
      if (r && r.error && U.missing(r.error)) { v2off[n2] = true; return cached(key, n1, params); }
      if (!r || r.error) return { error: (r && r.error) || { message: "error" } };
      cache[key] = { at: Date.now(), rows: rows(r) };
      return { rows: cache[key].rows };
    });
  }
  function homeOf(x) { try { return x && x.name && x.home_town && window.HOMETOWN ? window.HOMETOWN.label(x.home_town) : ""; } catch (e) { return ""; } }
  function keyOf(kind, p) { return kind + ":" + p.lat.toFixed(2) + ":" + p.lng.toFixed(2); }
  function loadOptin() {
    if (optin) return Promise.resolve(optin);
    return call("my_board_optin").then(function (r) {
      if (r.error) return null;
      var d = A.parseData(r.data);
      optin = { on: !!d.on, name: d.name || null };
      return optin;
    });
  }
  function setOptin(on) {
    var nm = "";
    try { nm = (A.getName && A.getName()) || ""; } catch (e) {}
    var params = { p_on: !!on };
    if (nm && nm.length <= 30) params.p_name = nm;
    return call("set_board_optin", params).then(function (r) {
      if (r.error) {
        // A local name the server does not accept: save the switch without it.
        if (params.p_name && U.errCode(r.error) === "invalid_name") return call("set_board_optin", { p_on: !!on }).then(done);
        return done(r);
      }
      return done(r);
    });
    function done(r) {
      if (r.error) return null;
      var d = A.parseData(r.data);
      optin = { on: !!d.on, name: d.name || null };
      cache = {};
      return optin;
    }
  }

  /* ---------- UI ---------- */
  var switches = [];   // every visible opt-in switch (sheet + settings)
  function syncSwitches() {
    switches = switches.filter(function (s) { return document.body.contains(s); });
    switches.forEach(function (s) { s.setAttribute("aria-checked", String(!!(optin && optin.on))); s.disabled = false; });
  }
  function optinRow() {
    var el = A.el;
    var sw = el("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(!!(optin && optin.on)), "aria-label": T("toggle") });
    switches.push(sw);
    sw.addEventListener("click", function () {
      var on = sw.getAttribute("aria-checked") !== "true";
      sw.disabled = true;
      setOptin(on).then(function (o) {
        if (!o) { A.toast(T("toggleFail"), { err: true }); syncSwitches(); return; }
        syncSwitches();
        A.toast(o.on ? T("toggleOn") : T("toggleOff"));
        redrawAll();
      });
    });
    loadOptin().then(function () { syncSwitches(); });
    var wrap = el("div", { class: "bd-optin" }, [
      el("div", { class: "toggle-row" }, [el("span", { text: T("toggle") }), sw]),
      el("p", { class: "muted bd-note", text: T("toggleNote") })
    ]);
    return wrap;
  }

  var redraws = [];
  function redrawAll() {
    redraws = redraws.filter(function (r) { return document.body.contains(r.node); });
    redraws.forEach(function (r) { r.fn(); });
  }

  function nameOf(x) {
    if (x.name) return x.name + (x.is_me ? T("you") : "");
    return x.is_me ? T("youHidden") : T("hidden");
  }

  function boardSection(p, town) {
    var el = A.el;
    var sec = el("section", { class: "bd-board" });
    var tabs = el("div", { class: "tabs bd-tabs", role: "tablist" });
    var list = el("ol", { class: "toplist bd-list" });
    sec.appendChild(el("h3", { class: "bd-h", text: titleTop(town) }));
    [["tonight", T("tonight")], ["week", T("week")]].forEach(function (k) {
      tabs.appendChild(el("button", { type: "button", role: "tab", "data-k": k[0], text: k[1], onclick: function () {
        tab = k[0]; try { localStorage.setItem("olnu.boardTab", tab); } catch (e) {}
        draw();
      } }));
    });
    sec.appendChild(tabs);
    sec.appendChild(list);
    sec.appendChild(el("p", { class: "muted bd-note", text: T("care") }));
    function draw() {
      tabs.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-k") === tab)); });
      list.innerHTML = "";
      list.appendChild(el("li", { class: "muted top-empty", text: "…" }));
      var my = tab;
      cached2(keyOf("b" + my, p), "local_board_v2", "local_board", { p_lat: p.lat, p_lng: p.lng, p_km: 20, p_period: my }).then(function (r) {
        if (!document.body.contains(list) || my !== tab) return;
        list.innerHTML = "";
        if (r.off) { sec.remove(); return; }
        if (r.error) {
          list.appendChild(el("li", { class: "muted top-empty", text: U.errCode(r.error) === "slow_down" ? T("slow") : T("load") }));
          return;
        }
        if (!r.rows.length) { list.appendChild(el("li", { class: "muted top-empty", text: emptyLine(my) })); return; }
        var lastRank = 0;
        r.rows.forEach(function (x) {
          var rank = x.rank | 0;
          if (lastRank && rank > lastRank + 1 && x.is_me) list.appendChild(el("li", { class: "bd-gap", "aria-hidden": "true", text: "⋯" }));
          lastRank = rank;
          var n = x.total | 0, nn = x.nights | 0;
          var sub = my === "week" ? nn + (nn === 1 ? T("nights1") : T("nightsN")) : "";
          list.appendChild(el("li", {}, [el("div", { class: "top-row bd-row" + (x.is_me ? " mine" : "") + (x.name ? "" : " bd-anon") }, [
            el("span", { class: "top-rank", text: rank ? String(rank).padStart(2, "0") : "–" }),
            el("span", { class: "top-main" }, [el("span", { class: "top-name" }, [document.createTextNode(nameOf(x)),
                homeOf(x) ? el("span", { class: "ht-tag", text: " · " + homeOf(x) }) : null]),
              sub ? el("span", { class: "top-sub", text: sub }) : null]),
            el("span", { class: "top-n", text: n + T("drinks") })
          ])]));
        });
      });
    }
    redraws.push({ node: sec, fn: function () { delete cache[keyOf("b" + tab, p)]; draw(); } });
    draw();
    return sec;
  }

  function wallSection(p, town) {
    var el = A.el;
    var sec = el("section", { class: "bd-wall" });
    var list = el("ol", { class: "toplist bd-wlist" });
    sec.appendChild(el("h3", { class: "bd-h", text: titleWall(town) }));
    sec.appendChild(list);
    sec.appendChild(el("p", { class: "muted bd-note", text: T("wallNote") }));
    function draw() {
      list.innerHTML = "";
      list.appendChild(el("li", { class: "muted top-empty", text: "…" }));
      cached2(keyOf("w", p), "wall_of_fame_v2", "wall_of_fame", { p_lat: p.lat, p_lng: p.lng, p_km: 20 }).then(function (r) {
        if (!document.body.contains(list)) return;
        list.innerHTML = "";
        if (r.off) { sec.remove(); return; }
        if (r.error) {
          list.appendChild(el("li", { class: "muted top-empty", text: U.errCode(r.error) === "slow_down" ? T("slow") : T("load") }));
          return;
        }
        var top = {}, mine = {};
        r.rows.forEach(function (x) { if (x.top) top[x.category] = x; else if (x.is_me) mine[x.category] = x; });
        var any = false;
        CAT_ORDER.forEach(function (k) {
          var x = top[k], c = CATS[k];
          if (!x || !c) return;
          any = true;
          var unit = sv() ? c[3] : c[4];
          var me = mine[k];
          var sub = nameOf(x) + (homeOf(x) ? " (" + homeOf(x) + ")" : "") + " · " + unit + (me ? " · " + T("you2") + (me.value | 0) : "");
          list.appendChild(el("li", {}, [el("div", { class: "top-row bd-wrow" + (x.is_me ? " mine" : "") + (x.name ? "" : " bd-anon") }, [
            el("span", { class: "top-rank bd-ico", text: c[0] }),
            el("span", { class: "top-main" }, [
              el("span", { class: "top-name", text: (sv() ? c[1] : c[2]) }),
              el("span", { class: "top-sub", text: sub })
            ]),
            el("span", { class: "top-n", text: String(x.value | 0) })
          ])]));
        });
        if (!any) list.appendChild(el("li", { class: "muted top-empty", text: emptyLine("wall") }));
      });
    }
    redraws.push({ node: sec, fn: function () { delete cache[keyOf("w", p)]; draw(); } });
    draw();
    return sec;
  }

  window.BOARDS = {
    init: function (api) { A = api; },
    topSheet: function (body) {
      if (!A || !A.LIVE || off || !A.authed || !A.authed()) return;
      var p = where(), town = townOf(p);
      var box = A.el("div", { class: "bd-box" });
      box.appendChild(boardSection(p, town));
      box.appendChild(optinRow());
      box.appendChild(wallSection(p, town));
      body.appendChild(box);
      // A missing server function removes its section; when both are gone, the whole box goes.
      setTimeout(function () { if (off && document.body.contains(box)) box.remove(); }, 4000);
    },
    profileSheet: function (body) {   // 👤 Profil (was settingsSheet)
      if (!A || !A.LIVE || off || !A.authed || !A.authed()) return;
      var h = A.el("h3", { text: L("🏆 Topplistan", "🏆 Top list") });
      var row = optinRow();
      body.appendChild(h); body.appendChild(row);
      loadOptin().then(function (o) { if (o === null && off) { h.remove(); row.remove(); } });
    },
    // For tests / other modules.
    _gen: gen,
    optin: function () { return optin; }
  };
})();
