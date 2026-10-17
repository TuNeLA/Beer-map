/* Öl Nu v9 — social features on the server (CONTRACT "v7 SOCIAL" + v8 group_status):
   titles, kings of the bar, league, group chat, group status, "Kom hit!", reactions, ghost pins, SOS,
   plus bar crowd labels and bar info in the popup.
   Every RPC may be missing on an older database: that feature then hides quietly. Never breaks the map. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, t = I.t;
  var A = null;              // app api (set in init)
  var v7 = null;             // null = not known yet, true = social RPCs exist, false = old database
  var off = {};              // rpc name -> true when it is missing
  var esc = U.esc;

  function call(name, params) {
    if (!A || !A.LIVE || off[name]) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) { off[name] = true; r.off = true; onMissing(name); }
      return r;
    });
  }
  function onMissing(name) {
    if (name === "my_stats") { v7 = false; A.updateCounts(); applyGhost(); }
    if (name === "ghost_points") applyGhost();
  }
  function codeOf(err) { return U.errCode(err); }

  /* ---------- Titles (v11, 36 steps; same ladder as SQL olnu_titles() in 0012 and notify-group TITLES) ---------- */
  var TITLES = [[0, "Rekryt"], [3, "Mönstrad Mellanöl"], [5, "Menig Mjöd"], [7, "Vicekorpral Kapsyl"],
    [10, "Kapsylkorpral från Grangärde"], [13, "Skumsergeant"], [17, "Furir Flaskhals"],
    [22, "Överfurir Fatkran"], [28, "Fanjunkare Flasköppnare"], [35, "Fänrik Fatöl"],
    [43, "Löjtnant Lager"], [52, "Premiärlöjtnant Pilsner"], [62, "Kapten Kaggen"],
    [75, "Ryttmästare Humle"], [90, "Major Malt från Smedjebacken"], [110, "Överstelöjtnant Ölstop"],
    [130, "Överste Ölkorv"], [155, "Brigadgeneral Bärs"], [180, "Generalmajor Gambrinus"],
    [210, "Generallöjtnant Guldskum"], [245, "General Dalabärs"], [285, "Fältmarskalk Fradga"],
    [330, "Riksmarskalk Rundtur"], [380, "Baron av Bryggstugan"], [430, "Hertig av Humlegården"],
    [490, "Ärkehertig av Ölkranen"], [560, "Kung Kapsyl av Dalarna"], [640, "Ölkejsaren"],
    [730, "Bryggerilegenden"], [830, "Halvguden från Väsman"], [920, "Myten från Grängesberg"],
    [1000, "Legenden från Ludvika"], [1100, "Sagofiguren från Säfsnäs"], [1200, "Oraklet i Ölstugan"],
    [1300, "Överbefälhavare Öl"], [1500, "Ölguden"]];
  function titleFor(total) {
    total = Math.max(0, total | 0);
    var i = 0; while (i + 1 < TITLES.length && total >= TITLES[i + 1][0]) i++;
    var nx = TITLES[i + 1] || null;
    return { title: TITLES[i][1], next: nx ? nx[1] : null, nextAt: nx ? nx[0] : null };
  }

  var stats = null, statsAt = 0, statsDone = null;
  var statsReady = new Promise(function (r) { statsDone = r; });
  var TITLE_KEY = "olnu.title", TOTAL_KEY = "olnu.titleTotal", LADDER_KEY = "olnu.ladder";
  function loadStats() {
    if (!A || !A.authed() || off.my_stats) { if (statsDone) statsDone(); return Promise.resolve(); }
    statsAt = Date.now();
    return call("my_stats").then(function (r) {
      if (r.error) return;   // missing → v7=false (onMissing); network error → try again later
      var d = A.parseData(r.data);
      v7 = true;
      var total = Math.max(0, d.total | 0), tf = titleFor(total);
      stats = { total: total, week: d.week | 0, title: d.title || tf.title,
        next: d.next_title !== undefined ? d.next_title : tf.next, nextAt: d.next_at !== undefined ? d.next_at : tf.nextAt };
      var before = U.ls.get(TITLE_KEY, ""), beforeTotal = U.ls.get(TOTAL_KEY, "");
      var ladderNew = U.ls.get(LADDER_KEY, "") !== "11";
      U.ls.set(TITLE_KEY, stats.title); U.ls.set(TOTAL_KEY, String(total)); U.ls.set(LADDER_KEY, "11");
      A.updateCounts();
      // v11: a real promotion = more beers than last time AND a new title. A title that changed only
      // because the ladder changed (app update) gets a quiet "new ranks" toast instead.
      var grew = beforeTotal !== "" && total > (+beforeTotal || 0);
      if (before && before !== stats.title && (grew || !ladderNew)) promoted(stats.title, before, total);
      else if (ladderNew && before && before !== stats.title) A.toast(t("ladderNew", stats.title), { cls: "promo", ms: 6500 });
    }).then(function () { if (statsDone) { statsDone(); statsDone = null; } });
  }
  function promoted(title, oldTitle, total) {
    if (window.MEDALS && window.MEDALS.levelUp) {
      window.MEDALS.levelUp(oldTitle, title, total);
      setTimeout(function () { window.FX.splash(document.querySelector(".hx-title")); }, 2700);
      return;
    }
    A.toast(t("promoted", title), { cls: "promo", ms: 6500 });
    window.FX.unlock(); window.FX.sound.hot(); window.FX.vibrate([60, 40, 60, 40, 140]);
    setTimeout(function () { window.FX.splash(document.querySelector(".hx-title")); }, 50);
  }
  function titleProgress() {
    if (!stats) return "";
    return stats.next && stats.nextAt ? t("titleNext", Math.max(0, stats.nextAt - stats.total), stats.next) : t("titleMax");
  }

  // Friends' lifetime totals (beer id -> total). Strangers are never returned by the server.
  var totals = {}, totalsAt = 0, totalsIds = "";
  function loadTotals(force) {
    if (v7 !== true || off.friend_totals) return;
    var ids = A.beers().filter(function (b) { return b.friend_name; }).map(function (b) { return b.id; }).sort().join(",");
    if (!force && ids === totalsIds && Date.now() - totalsAt < 120000) return;
    totalsIds = ids; totalsAt = Date.now();
    call("friend_totals").then(function (r) {
      if (r.error) return;
      var m = {};
      (r.data || []).forEach(function (x) { if (x && x.beer_id != null) m[x.beer_id] = Math.max(0, x.total | 0); });
      totals = m;
    });
  }
  function titlesByBeer() {
    var out = {};
    A.beers().forEach(function (b) { if (b.friend_name && totals[b.id] != null) out[b.id] = titleFor(totals[b.id]).title; });
    return out;
  }

  /* ---------- Bar crowd label + bar info (A, G) ---------- */
  function crowdLevel(n) { return n >= 8 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0; }
  function safeUrl(s) {
    s = String(s || "").trim().split(/[;\s]/)[0];
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) { if (/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(s)) s = "https://" + s; else return null; }
    try { var u = new URL(s); return u.protocol === "http:" || u.protocol === "https:" ? u.href : null; } catch (e) { return null; }
  }
  function safeTel(s) {
    var text = String(s || "").split(";")[0].trim().slice(0, 30);
    var href = text.replace(/[^\d+]/g, "");
    return href.length >= 5 ? { text: text, href: href } : null;
  }
  function barInfoHTML(bar) {
    var h = "", oh = bar.opening_hours || bar.hours;
    if (oh) h += '<div class="pp-info">🕒 ' + esc(t("barOpen")) + ": " + esc(String(oh).slice(0, 120)) + "</div>";
    var web = safeUrl(bar.website), tel = safeTel(bar.phone);
    if (web || tel) {
      h += '<div class="pp-links">' +
        (web ? '<a href="' + esc(web) + '" target="_blank" rel="noopener noreferrer">🌐 ' + esc(t("barWeb")) + "</a>" : "") +
        (tel ? '<a href="tel:' + esc(tel.href) + '">☎ ' + esc(tel.text) + "</a>" : "") + "</div>";
    }
    return h;
  }

  /* ---------- Kung av baren (H) ---------- */
  var kings = {}, kingsKnown = {}, kingsAt = 0, kingsTimer = null;
  var KING_KEY = "olnu.kingOf", KINGS_MS = 60000;
  function viewBarIds() {
    var m = A.map, z = m.getZoom(); if (z < 11) return [];
    var bnd = m.getBounds().pad(0.1), ids = {};
    if (z >= 13) window.BARS.inBounds(bnd, 500).forEach(function (b) { ids[b.id] = 1; });
    var per = window.BARS.assign(A.beers()).perBar;
    Object.keys(per).forEach(function (id) { var b = per[id].bar; if (bnd.contains([b.lat, b.lng])) ids[id] = 1; });
    return Object.keys(ids).slice(0, 500);
  }
  function loadKings() {
    if (v7 !== true || off.bar_kings) return;
    var wait = KINGS_MS - (Date.now() - kingsAt);
    if (wait > 0) { if (!kingsTimer) kingsTimer = setTimeout(function () { kingsTimer = null; loadKings(); }, wait); return; }
    var ids = viewBarIds(); if (!ids.length) return;
    kingsAt = Date.now();
    call("bar_kings", { p_bar_ids: ids }).then(function (r) {
      if (r.error) return;
      var got = {}, changed = false;
      (r.data || []).forEach(function (row) { if (row && row.bar_id != null) got[String(row.bar_id)] = row; });
      ids.forEach(function (id) {
        var nv = got[id] || null, ov = kings[id] || null;
        if (JSON.stringify(nv) !== JSON.stringify(ov)) changed = true;
        if (nv) kings[id] = nv; else delete kings[id];
        kingsKnown[id] = 1;
      });
      checkMyKing(ids);
      if (changed) A.render();
    });
  }
  function checkMyKing(ids) {
    var mine = U.ls.getJSON(KING_KEY, {}) || {}, dirty = false;
    ids.forEach(function (id) {
      var k = kings[id];
      if (k && k.is_me && !mine[id]) {
        mine[id] = Date.now(); dirty = true;
        var bar = window.BARS.byId(id), name = (bar && bar.name) || t("unnamedBar");
        A.toast(t("kingYou", name), { cls: "promo", ms: 6000 });
        window.FX.sound.clink(); window.FX.vibrate([40, 40, 80]);
        if (window.EXTRAS && window.EXTRAS.award) window.EXTRAS.award("king");
      } else if ((!k || !k.is_me) && mine[id]) { delete mine[id]; dirty = true; }
    });
    if (dirty) U.ls.setJSON(KING_KEY, mine);
  }
  function kingLineHTML(bar) {
    if (v7 !== true || off.bar_kings) return "";
    var k = kings[bar.id];
    if (k) return '<div class="pp-king">' + esc(t("kingLine", k.is_me ? t("you") : k.king_name || t("kingSecret"), k.king_n | 0)) + "</div>";
    return kingsKnown[bar.id] ? '<div class="pp-king none">' + esc(t("kingNone")) + "</div>" : "";
  }

  /* ---------- Reaktioner (L) ---------- */
  var RX = ["🔥", "😂", "💀", "💪"], rx = {};
  function loadRx() {
    if (v7 !== true || off.beer_reactions) return;
    call("beer_reactions").then(function (r) {
      if (r.error) return;
      var m = {};
      (r.data || []).forEach(function (x) {
        if (!x || RX.indexOf(x.emoji) < 0) return;
        var o = m[x.beer_id] || (m[x.beer_id] = {});
        o[x.emoji] = { n: Math.max(0, x.n | 0), mine: !!x.mine };
      });
      rx = m; updateOpenRx();
    });
  }
  function topRx(id) {
    var o = rx[id] || {}, best = null;
    RX.forEach(function (e) { if (o[e] && o[e].n > 0 && (!best || o[e].n > best.n)) best = { e: e, n: o[e].n }; });
    return best;
  }
  function rxInner(b) {
    var o = rx[b.id] || {}, top = topRx(b.id), h = "";
    if (b.is_mine) {
      var parts = RX.filter(function (e) { return o[e] && o[e].n > 0; }).map(function (e) { return e + " " + o[e].n; });
      return parts.length ? '<div class="pp-rx-got">' + esc(t("rxGot")) + esc(parts.join(" · ")) + "</div>" : "";
    }
    h += '<div class="rx-row">' + RX.map(function (e) {
      var x = o[e] || { n: 0, mine: false };
      return '<button type="button" class="rx-btn' + (x.mine ? " on" : "") + '" data-e="' + esc(e) + '" aria-pressed="' + x.mine + '" aria-label="' + esc(t("rxAria", e)) + '">' +
        e + '<span class="rx-n">' + (x.n > 0 ? x.n : "") + "</span></button>";
    }).join("") + "</div>";
    if (top) h += '<div class="rx-top">' + esc(t("rxTop", top.e, top.n)) + "</div>";
    return h;
  }
  function rxHTML(b) {
    if (v7 !== true || off.beer_reactions) return "";
    return '<div class="rx-wrap" data-rx="' + esc(String(b.id)) + '">' + rxInner(b) + "</div>";
  }
  function beerById(id) { var l = A.beers(); for (var i = 0; i < l.length; i++) if (String(l[i].id) === String(id)) return l[i]; return null; }
  function updateOpenRx() {
    document.querySelectorAll(".rx-wrap[data-rx]").forEach(function (w) {
      var b = beerById(w.getAttribute("data-rx"));
      if (b) w.innerHTML = rxInner(b);
    });
  }
  function doReact(button) {
    var w = button.closest(".rx-wrap"); if (!w) return;
    var id = w.getAttribute("data-rx"), e = button.getAttribute("data-e"), b = beerById(id);
    if (!b || button.disabled || off.react) return;
    button.disabled = true;
    window.FX.unlock();
    call("react", { p_beer_id: b.id, p_emoji: e }).then(function (r) {
      button.disabled = false;
      if (r.error) {
        var c = codeOf(r.error);
        A.toast(c === "own_beer" ? t("skalOwn") : c === "beer_not_found" ? t("skalGone") : t("rxFail"), { err: true });
        if (c === "beer_not_found") A.refresh();
        return;
      }
      var d = A.parseData(r.data), counts = d.counts || {}, mine = Array.isArray(d.mine) ? d.mine : [];
      var o = {};
      RX.forEach(function (x) { var n = Math.max(0, counts[x] | 0); if (n || mine.indexOf(x) >= 0) o[x] = { n: n, mine: mine.indexOf(x) >= 0 }; });
      rx[b.id] = o;
      updateOpenRx();
      if (mine.indexOf(e) >= 0) { window.FX.vibrate(15); window.FX.sound.clink(); }
    });
  }

  /* ---------- Spökpins: last week's beers as faint grey dots (M) ---------- */
  var ghostLayer = null, ghostRenderer = null, ghostPts = null, ghostAt = 0, ghostUser = null;
  function ghostAuto() {
    var c = A.center(), near = 0;
    A.beerOnly().forEach(function (b) { if (U.haversine(c.lat, c.lng, b.lat, b.lng) <= 5000) near++; });
    return near < 3;
  }
  function ghostShown() { return ghostUser != null ? ghostUser : ghostAuto(); }
  function loadGhosts() {
    if (v7 !== true || off.ghost_points) return;
    if (ghostPts && Date.now() - ghostAt < 10 * 60000) return;
    ghostAt = Date.now();
    call("ghost_points").then(function (r) {
      if (r.error) { applyGhost(); return; }
      ghostPts = (r.data || []).filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lng) && p.w > 0; }).slice(0, 3000);
      drawGhosts(); applyGhost();
    });
  }
  function drawGhosts() {
    if (!ghostLayer) return;
    ghostLayer.clearLayers();
    (ghostPts || []).forEach(function (p) {
      L.circleMarker([+p.lat, +p.lng], { renderer: ghostRenderer, pane: "ghosts", radius: Math.min(15, 4 + Math.sqrt(+p.w) * 2.4),
        color: "#c8ced9", weight: 1, opacity: 0.4, dashArray: "2 3", fillColor: "#c8ced9", fillOpacity: 0.12, interactive: false }).addTo(ghostLayer);
    });
  }
  function applyGhost() {
    if (!A) return;
    var b = document.getElementById("btn-ghostpins");
    var avail = !!(A.LIVE && v7 === true && !off.ghost_points && ghostPts && ghostPts.length);
    b.hidden = !avail;
    document.body.classList.toggle("ghost-chip-on", avail);
    if (!avail) { if (ghostLayer && A.map.hasLayer(ghostLayer)) A.map.removeLayer(ghostLayer); return; }
    var on = ghostShown();
    b.textContent = t("ghostPins");
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", t("ghostPinsAria"));
    b.title = t("ghostPinsAria");
    if (on && !A.map.hasLayer(ghostLayer)) ghostLayer.addTo(A.map);
    if (!on && A.map.hasLayer(ghostLayer)) A.map.removeLayer(ghostLayer);
  }

  /* ---------- League (I) ---------- */
  function drawLeague(list, note) {
    var el = A.el;
    list.appendChild(el("li", { class: "muted top-empty", text: "…" }));
    call("group_league").then(function (r) {
      if (!document.body.contains(list)) return;
      list.innerHTML = "";
      if (r.error) { list.appendChild(el("li", { class: "muted top-empty", text: t("fail") })); return; }
      var rows = (r.data || []).slice().sort(function (a, b) { return (a.rank | 0) - (b.rank | 0); });
      note.textContent = t("leagueNote");
      if (!rows.length) { list.appendChild(el("li", { class: "muted top-empty", text: t("leagueEmpty") })); return; }
      rows.forEach(function (g) {
        var rank = g.rank | 0;
        list.appendChild(el("li", {}, [el("div", { class: "top-row league-row" + (g.is_mine ? " mine" : "") }, [
          el("span", { class: "top-rank", text: String(rank).padStart(2, "0") }),
          el("span", { class: "top-main" }, [
            el("span", { class: "top-name", text: g.name || t("leagueGroup", rank) }),
            el("span", { class: "top-sub", text: (g.is_mine ? t("leagueMine") + " · " : "") + t("leagueSub", g.members | 0) })
          ]),
          el("span", { class: "top-n", text: (g.total | 0) + " 🍺" })
        ])]));
      });
    });
  }

  /* ---------- Group chat (J) ---------- */
  // Bright colours that read well on the dark chat background. Gold is kept for "me".
  var CHAT_COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#a78bfa", "#22d3ee", "#fb923c", "#f87171", "#a3e635", "#34d399", "#c084fc", "#38bdf8", "#e879f9"];
  // Colours are unique inside one chat (up to 12 people): start at the name's hash, skip colours in use.
  var chatColAssigned = {}, chatColUsed = {};
  function chatColor(name) {
    var key = String(name).toLowerCase();
    if (chatColAssigned[key]) return chatColAssigned[key];
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    var n = CHAT_COLORS.length, ix = Math.abs(h) % n;
    for (var k = 0; k < n && chatColUsed[CHAT_COLORS[ix]]; k++) ix = (ix + 1) % n;
    chatColUsed[CHAT_COLORS[ix]] = 1;
    return (chatColAssigned[key] = CHAT_COLORS[ix]);
  }
  /* ---------- 🎵 Spotify Jam (hemmafest) ----------
     Spotify has no public API to start a Jam, so the host starts it in Spotify, copies the invite link
     and shares it here. The app posts it in the group chat; the chat shows a big "Gå med i Jam" button. */
  function jamLink(text) {
    var m = String(text || "").match(/https:\/\/(?:open\.spotify\.com|spotify\.link|spotify\.app\.link)\/[^\s"'<>]+/i);
    return m ? m[0] : null;
  }
  function hostJam(g) {
    var el = A.el;
    A.openSheet(t("jamTitle"), function (body) {
      body.appendChild(el("ol", { class: "jam-steps" }, (t("jamSteps") || []).map(function (x) { return el("li", { text: x }); })));
      body.appendChild(el("div", { class: "row", style: "margin:8px 0" }, [el("a", { class: "btn btn-block jam-btn", href: "https://open.spotify.com/", target: "_blank", rel: "noopener noreferrer", text: t("jamOpen") })]));
      var inp = el("input", { class: "inp", maxlength: "120", placeholder: "https://spotify.link/…", "aria-label": t("jamPaste"), autocomplete: "off" });
      var paste = A.btn(t("jamPaste"), "btn-small", function () {
        try { navigator.clipboard.readText().then(function (x) { if (jamLink(x)) inp.value = jamLink(x); else A.toast(t("jamBad"), { err: true }); }, function () {}); } catch (e) {}
      });
      body.appendChild(el("div", { style: "display:flex;gap:8px" }, [inp, paste]));
      body.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [A.btn(t("jamShare"), "btn-green btn-block", function () {
        var link = jamLink(inp.value);
        if (!link) { A.toast(t("jamBad"), { err: true }); return; }
        var text = t("jamMsg", link);
        call("post_group_msg", { p_group_id: g.id, p_body: text.length <= 140 ? text : link }).then(function (r) {
          if (r.error) { A.toast(t("chatFail"), { err: true }); return; }
          A.invoke("notify-group", { event: "msg", group_id: g.id });
          A.toast(t("jamDone")); openChat(g);
        });
      })]));
    });
  }
  function chatOn() { return v7 === true && !off.group_msgs && !off.post_group_msg; }
  function openChat(g) {
    if (!chatOn() || !g || !g.id) return;
    var el = A.el;
    chatColAssigned = {}; chatColUsed = {};
    A.openSheet(t("chatTitle", g.name || ""), function (body) {
      var list = el("ul", { class: "chat-list", "aria-live": "polite" });
      var inp = el("input", { class: "inp chat-inp", id: "chat-inp", maxlength: "140", enterkeyhint: "send", autocomplete: "off",
        placeholder: t("chatPh"), "aria-label": t("chatPh") });
      var lastId = 0, seen = {}, timer = null, sending = false, loading = false;
      // Rank + beers now per member (from group_status). Every chat row shows "🎖️ Sergeant Skum Oskar · 4 🍺".
      var stats = {}, meStat = null, heads = [];
      function statOf(m) { return m.is_me ? meStat : stats[m.name || ""] || null; }
      function headText(m) {
        var s = statOf(m), nm = m.name || (m.is_me ? t("you") : t("someone"));
        return s ? t("chatWho", titleFor(s.total).title, nm) : nm;
      }
      function beersText(m) {
        var s = statOf(m); if (!s) return "";
        return s.beers + " 🍺" + (s.others ? " · " + s.others + " 🥃" : "");
      }
      function paintHeads() {
        heads.forEach(function (h) { h.name.textContent = headText(h.m); h.n.textContent = beersText(h.m); });
      }
      function loadStats() {
        if (!statusOn() || !alive()) return;
        call("group_status", { p_group_id: g.id }).then(function (r) {
          if (r.error || !alive()) return;
          stats = {}; meStat = null;
          (r.data || []).forEach(function (x) {
            var s = { beers: Math.max(0, x.beers | 0), others: Math.max(0, x.others | 0), total: Math.max(0, x.total | 0) };
            if (x.is_me) meStat = s;
            if (x.name) stats[x.name] = s;
          });
          paintHeads();
        });
      }
      var sendBtn = A.btn(t("chatSend"), "btn-amber chat-send", go);
      body.appendChild(el("div", { class: "row", style: "margin-bottom:8px" }, [A.btn(t("back"), "btn-small", function () { A.showGroups(); })]));
      body.appendChild(list);
      body.appendChild(el("div", { class: "chat-input" }, [inp, sendBtn]));
      body.appendChild(el("p", { class: "muted chat-note", text: t("chatNote") }));
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      function alive() { return document.body.contains(list); }
      function add(m) {
        if (!m || seen[m.id]) return;
        seen[m.id] = 1;
        var empty = list.querySelector(".chat-empty"); if (empty) empty.remove();
        var nmEl = el("span", { class: "cm-name", text: headText(m) }), nEl = el("span", { class: "cm-beers", text: beersText(m) });
        heads.push({ m: m, name: nmEl, n: nEl });
        if (medalsOn() && (m.name || m.is_me)) {
          nmEl.classList.add("cm-tap"); nmEl.setAttribute("role", "button"); nmEl.setAttribute("tabindex", "0");
          var openU = function () { var s = statOf(m); window.MEDALS.openMember(g, { name: m.name, is_me: m.is_me, total: s ? s.total : null }, function () { openChat(g); }); };
          nmEl.addEventListener("click", openU);
          nmEl.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openU(); } });
        }
        // Each person gets their own colour (same name = same colour every time). Me = gold (CSS).
        var col = m.is_me ? null : chatColor(m.name || "");
        if (col) nmEl.style.color = col;
        list.appendChild(el("li", { class: "chat-msg" + (m.is_me ? " me" : ""), style: col ? "border-left-color:" + col : "" }, [
          el("div", { class: "cm-head" }, [nmEl, nEl,
            el("span", { class: "cm-time", text: U.timeHM(m.created_at) })]),
          el("div", { class: "cm-body", text: String(m.body || "") }),
          jamLink(m.body) ? el("a", { class: "btn btn-block jam-btn", href: jamLink(m.body), target: "_blank", rel: "noopener noreferrer", text: t("jamJoin") }) : null
        ]));
      }
      function load() {
        if (!alive()) { clearInterval(timer); return; }
        if (loading || document.visibilityState === "hidden") return;
        loading = true;
        call("group_msgs", { p_group_id: g.id, p_after_id: lastId }).then(function (r) {
          loading = false;
          if (!alive()) return;
          if (r.error) {
            if (codeOf(r.error) === "not_member") { clearInterval(timer); A.toast(t("chatNotMember"), { err: true }); A.showGroups(); }
            else if (!list.children.length) list.appendChild(el("li", { class: "muted chat-empty", text: t("chatLoadFail") }));
            return;
          }
          var rows = (r.data || []).slice().sort(function (a, b) { return a.id - b.id; });
          var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
          rows.forEach(function (m) { add(m); if (m.id > lastId) lastId = m.id; });
          if (!list.children.length) list.appendChild(el("li", { class: "muted chat-empty", text: t("chatEmpty") }));
          if (rows.length && (nearBottom || rows.length === list.children.length)) list.scrollTop = list.scrollHeight;
        });
      }
      function go() {
        if (sending) return;
        var text = String(inp.value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
        if (!text || text.length > 140) { A.toast(t("chatInvalid"), { err: true }); return; }
        sending = true; sendBtn.disabled = true;
        call("post_group_msg", { p_group_id: g.id, p_body: text }).then(function (r) {
          sending = false; sendBtn.disabled = false;
          if (r.error) {
            var c = codeOf(r.error);
            A.toast(c === "not_member" ? t("chatNotMember") : c === "invalid_msg" ? t("chatInvalid") : c === "slow_down" ? t("chatSlow") : t("chatFail"), { err: true });
            return;
          }
          inp.value = "";
          A.invoke("notify-group", { event: "msg", group_id: g.id });   // fire-and-forget
          if (window.EXTRAS && window.EXTRAS.award) window.EXTRAS.award("chat");
          load(); loadStats();
        });
      }
      var tick = 0;
      timer = setInterval(function () { load(); if (++tick % 3 === 0) loadStats(); }, 10000);
      load(); loadStats();
    });
  }
  function openChatLink(id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""))) return;
    statsReady.then(function () {
      if (!chatOn()) return;
      A.withName(function () {
        A.rpc("my_groups").then(function (r) {
          var g = null;
          (r.data || []).forEach(function (x) { if (x && String(x.id).toLowerCase() === String(id).toLowerCase()) g = x; });
          if (g) openChat(g); else if (!r.error) A.toast(t("chatNotMember"), { err: true });
        });
      });
    });
  }

  /* ---------- Group status (v8, P) ---------- */
  function medalsOn() { return !!(window.MEDALS && window.MEDALS.on()); }
  function statusOn() { return A.othersOn() && !off.group_status; }
  function showStatus(g) {
    var el = A.el;
    A.openSheet(g.name || "", function (body) {
      var list = el("ul", { class: "st-list" });
      body.appendChild(el("div", { class: "row", style: "margin-bottom:6px" }, [A.btn(t("back"), "btn-small", function () { A.showGroups(); })]));
      body.appendChild(el("h3", { text: t("members") }));
      body.appendChild(list);
      if (chatOn()) body.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [A.btn(t("chat"), "btn-amber btn-block", function () { openChat(g); })]));
      list.appendChild(el("li", { class: "muted", text: "…" }));
      call("group_status", { p_group_id: g.id }).then(function (r) {
        if (!document.body.contains(list)) return;
        list.innerHTML = "";
        if (r.error) {
          if (r.off) { A.showGroups(); return; }
          list.appendChild(el("li", { class: "muted", text: codeOf(r.error) === "not_member" ? t("chatNotMember") : t("statusFail") }));
          return;
        }
        var kinds = t("kindLow") || {}, rowsByName = {}, meRow = null;
        (r.data || []).forEach(function (m) {
          var beers = Math.max(0, m.beers | 0), others = Math.max(0, m.others | 0), parts = [];
          if (beers) parts.push(beers + " 🍺");
          if (others) parts.push(others + " 🥃 " + (kinds[m.other_kind] || kinds.annat || ""));
          var tf = titleFor(m.total | 0);
          var medEl = el("span", { class: "st-medals", "aria-hidden": "true" });
          var row = el("li", { class: "st-row" + (m.is_me ? " me" : "") }, [
            el("span", { class: "st-dot" + (m.live ? " on" : ""), title: m.live ? t("statusLive") : "", "aria-label": m.live ? t("statusLive") : "" }),
            el("span", { class: "st-main" }, [
              el("span", { class: "st-name", text: (m.is_me ? t("you") + " · " : "") + (m.name || t("someone")) }),
              el("span", { class: "st-title", text: "🎖️ " + tf.title }),
              medEl
            ]),
            el("span", { class: "st-n", text: parts.length ? parts.join(" · ") : t("statusNone") })
          ]);
          list.appendChild(row);
          if (m.is_me) meRow = medEl; else if (m.name) (rowsByName[m.name] = rowsByName[m.name] || []).push(medEl);
          if (medalsOn()) {
            row.classList.add("st-tap"); row.setAttribute("role", "button"); row.setAttribute("tabindex", "0");
            row.setAttribute("aria-label", (m.name || t("someone")) + " — " + t("uniform"));
            var openU = function () { window.MEDALS.openMember(g, m, function () { showStatus(g); }); };
            row.addEventListener("click", openU);
            row.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openU(); } });
          }
        });
        if (medalsOn()) window.MEDALS.memberMedals(g.id).then(function (v) {
          if (!v || !document.body.contains(list)) return;
          if (meRow) meRow.innerHTML = window.MEDALS.medalRowHTML(v.me, 8);
          Object.keys(rowsByName).forEach(function (nm) {
            rowsByName[nm].forEach(function (x) { x.innerHTML = window.MEDALS.medalRowHTML(v.byName[nm] || {}, 8); });
          });
        });
      });
    });
  }

  /* ---------- Kom hit! (K) ---------- */
  var COME_KEY = "olnu.comeAt", COME_MS = 10 * 60 * 1000;
  function comeLeft() { var at = +U.ls.get(COME_KEY, "0") || 0; return Math.max(0, at + COME_MS - Date.now()); }
  function comeOn() {
    var ghost = window.EXTRAS && window.EXTRAS.ghostOn && window.EXTRAS.ghostOn();
    return v7 === true && !!A.myBeer() && !ghost;
  }
  function comeHere(button) {
    if (comeLeft() > 0) { A.toast(t("comeWait", Math.ceil(comeLeft() / 60000))); return; }
    var mine = A.myBeer();
    if (!mine) { A.toast(t("comeNoBeer"), { err: true }); return; }
    var body = { event: "comehere", lat: mine.lat, lng: mine.lng };
    if (mine.precise) { var bar = window.BARS.nearest(mine.lat, mine.lng); if (bar && bar.name) body.bar_name = bar.name; }
    if (button) button.disabled = true;
    A.invoke("notify-group", body).then(function (r) {
      var d = r.data || {};
      if (button) button.disabled = false;
      if (r.error) { A.toast(t("comeFail"), { err: true }); return; }
      if (d.reason === "no_beer") A.toast(t("comeNoBeer"), { err: true });
      else if (d.reason === "no_group") A.toast(t("noGroup"), { err: true });
      else {
        U.ls.set(COME_KEY, String(Date.now()));
        A.toast(d.reason === "slow_down" ? t("comeWait", 10) : t("comeSent"));
        if (d.reason !== "slow_down") window.FX.vibrate(30);
      }
      A.updateCounts();
    });
  }
  function comeBtn(cls) {
    var left = comeLeft();
    return '<button type="button" class="' + cls + '" data-hx="come"' + (left ? ' aria-disabled="true" title="' + esc(t("comeWait", Math.ceil(left / 60000))) + '"' : "") + ">" +
      esc(t("comeHere")) + (left ? " · " + Math.ceil(left / 60000) + "′" : "") + "</button>";
  }

  /* ---------- SOS (N) ---------- */
  function sosOn() { return !!(A && A.LIVE && v7 === true); }
  function sosBlock(container) {
    if (!sosOn()) return;
    var el = A.el, wrap = el("div", { class: "sos-block" });
    var b = A.btn(t("sos"), "btn-danger btn-block sos-btn", function () {
      if (wrap.querySelector(".confirm")) return;
      var box = el("div", { class: "confirm" }, [
        el("p", { html: "<b>" + esc(t("sosQ")) + "</b>" }),
        el("p", { class: "muted", text: t("sosInfo") }),
        el("div", { class: "row" }, [
          A.btn(t("cancel"), "btn-small", function () { box.remove(); }),
          A.btn(t("sosYes"), "btn-small btn-danger", function () { box.remove(); sendSos(); })
        ])
      ]);
      wrap.appendChild(box);
    });
    wrap.appendChild(b);
    container.appendChild(wrap);
  }
  var sosBusy = false;
  function sendSos() {
    if (sosBusy) return;
    sosBusy = true;
    A.toast(t("sosGetting"), { id: "sos" });
    A.getPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }).then(function (pos) {
      var la = Math.round(pos.coords.latitude * 1e5) / 1e5, ln = Math.round(pos.coords.longitude * 1e5) / 1e5;
      if (!A.inSweden(la, ln)) { A.toastClear("sos"); A.toast(t("outside"), { err: true }); return; }
      return A.invoke("notify-group", { event: "sos", lat: la, lng: ln }).then(function (r) {
        A.toastClear("sos");
        var d = r.data || {};
        if (r.error) A.toast(t("sosFail"), { err: true, ms: 8000 });
        else if (d.reason === "slow_down") A.toast(t("sosSlow"), { err: true });
        else if (d.reason === "no_group") A.toast(t("noGroup"), { err: true });
        else if (d.reason === "bad_location") A.toast(t("outside"), { err: true });
        else { A.toast(t("sosSent"), { ms: 6000 }); window.FX.vibrate([80, 40, 80]); }
      });
    }, function (err) { A.toastClear("sos"); A.locError(err); }).then(function () { sosBusy = false; }, function () { sosBusy = false; });
  }
  var sosMarker = null;
  function showSosLink(s) {
    var p = String(s || "").split(","), la = parseFloat(p[0]), ln = parseFloat(p[1]);
    if (!isFinite(la) || !isFinite(ln) || !A.inSweden(la, ln)) return;
    var show = function () {
      if (sosMarker) A.map.removeLayer(sosMarker);
      sosMarker = L.marker([la, ln], { zIndexOffset: 5000, keyboard: false, title: t("sosHere"),
        icon: L.divIcon({ className: "", iconSize: [0, 0], iconAnchor: [0, 0],
          html: '<div class="sos-mk"><span class="sos-ring"></span><span class="sos-dot"></span><span class="sos-lbl">' + esc(t("sosHere")) + "</span></div>" }) });
      sosMarker.on("click", function () { if (sosMarker) { A.map.removeLayer(sosMarker); sosMarker = null; } });
      sosMarker.addTo(A.map);
      A.map.setView([la, ln], 16, { animate: false });
      setTimeout(function () { if (sosMarker) { A.map.removeLayer(sosMarker); sosMarker = null; } }, 60 * 60 * 1000);
    };
    show();
    // A quiet "center on me" at start may move the map: bring the SOS spot back once.
    setTimeout(function () { if (sosMarker && !A.map.getBounds().contains([la, ln])) A.map.setView([la, ln], 16); }, 2500);
  }

  /* ---------- Public hooks (called from app.js through mods()) ---------- */
  window.SOCIAL = {
    titleFor: titleFor, TITLES: TITLES, titlesByBeer: titlesByBeer, sosBlock: function (c) { sosBlock(c); },
    stats: function () { return stats; }, titleProgress: titleProgress, hasTitle: function () { return !!stats; },
    leagueOn: function () { return v7 === true && !off.group_league; },
    drawLeague: drawLeague, openChat: openChat,

    init: function (api) {
      A = api;
      var map = A.map;
      map.createPane("ghosts");
      map.getPane("ghosts").style.zIndex = 380;
      map.getPane("ghosts").style.pointerEvents = "none";
      ghostRenderer = L.canvas({ pane: "ghosts", padding: 0.3 });
      ghostLayer = L.layerGroup();
      document.getElementById("btn-ghostpins").addEventListener("click", function () {
        ghostUser = !ghostShown(); applyGhost();
      });
      // Reaction buttons live in popups. Leaflet stops click bubbling at the popup, so listen on each popup.
      map.on("popupopen", function (e) {
        var root = e.popup && e.popup.getElement && e.popup.getElement();
        if (!root || root._olnuRx) return;
        root._olnuRx = true;
        root.addEventListener("click", function (ev) {
          var b = ev.target.closest && ev.target.closest(".rx-btn");
          if (b) { ev.preventDefault(); ev.stopPropagation(); doReact(b); }
        });
      });
      map.on("moveend", U.debounce(function () { loadKings(); applyGhost(); }, 800));
    },
    applyText: function () { applyGhost(); },
    onAuthed: function () {
      loadStats().then(function () { if (v7 === true) window.SOCIAL.onPoll(); });
    },
    onPoll: function () {
      if (!A) return;
      if (v7 === null && A.authed() && !off.my_stats && Date.now() - statsAt > 60000) loadStats();
      if (v7 !== true) return;
      loadRx(); loadKings(); loadTotals(false); loadGhosts(); applyGhost();
      if (Date.now() - statsAt > 5 * 60000) loadStats();
    },
    onBeerAccepted: function (d, o) {
      if (v7 !== true) return;
      if (o && o.precise && !o.ghost && isFinite(d.lat) && isFinite(d.lng)) {
        var bar = window.BARS.nearest(+d.lat, +d.lng);
        if (bar) call("record_bar", { p_bar_id: String(bar.id), p_bar_name: bar.name || null, p_lat: bar.lat, p_lng: bar.lng });
      }
      setTimeout(loadStats, 1500);
      setTimeout(loadKings, 2500);
    },
    hudChipsHTML: function (ctx) {
      var h = "";
      if (stats) h += '<button type="button" class="hx-chip hx-title" data-hx="badges">' + esc(t("titleHud", stats.title, stats.total)) + "</button>";
      if (comeOn()) h += comeBtn("hx-chip hx-come");
      return h;
    },
    hudClick: function (action, button) {
      if (action === "come") comeHere(button);
    },
    beerTitleHTML: function (b) {
      if (v7 !== true) return "";
      if (b.friend_name && totals[b.id] != null) return '<div class="pp-rank">🎖️ ' + esc(titleFor(totals[b.id]).title) + "</div>";
      if (b.is_mine && stats) return '<div class="pp-rank">🎖️ ' + esc(stats.title) + "</div>";
      return "";
    },
    beerPopupHTML: function (b) { return rxHTML(b); },
    barPopupHTML: function (bar, list) {
      var h = "", n = (list || []).length, c = crowdLevel(n);
      if (c) h += '<div class="pp-crowd c' + c + '">' + esc(t("crowd" + c)) + "</div>";
      h += kingLineHTML(bar);
      h += barInfoHTML(bar);
      return h;
    },
    barBadgeHTML: function (bar, list, zoom) {
      var h = "";
      if (kings[bar.id]) h += '<span class="bm-king" aria-hidden="true">👑</span>';
      var c = crowdLevel((list || []).length);
      if (c && zoom >= 16) h += '<span class="bm-crowd c' + c + '">' + esc(t("crowd" + c)) + "</span>";
      return h;
    },
    barIcoHTML: function (bar) { return kings[bar.id] ? '<span class="bi-king" aria-hidden="true">👑</span>' : ""; },
    groupsSheet: function (body) {
      if (!comeOn()) return;
      var b = A.el("button", { type: "button", class: "btn btn-block btn-green", html: esc(t("comeHere")) });
      b.addEventListener("click", function () { comeHere(b); });
      body.appendChild(A.el("div", { class: "row", style: "margin-top:8px" }, [b]));
    },
    groupItem: function (g, wrap, main) {
      if (statusOn()) {
        main.classList.add("gtap");
        main.setAttribute("role", "button"); main.setAttribute("tabindex", "0");
        main.setAttribute("aria-label", (g.name || "") + " — " + t("members"));
        main.addEventListener("click", function () { showStatus(g); });
        main.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showStatus(g); } });
      }
      if (chatOn()) wrap.appendChild(A.el("div", { class: "row", style: "margin-top:8px" }, [A.btn(t("chat"), "btn-small btn-block", function () { openChat(g); })]));
      if (chatOn()) wrap.appendChild(A.el("div", { class: "row", style: "margin-top:8px" }, [A.btn(t("jamHost"), "btn-small btn-block jam-host", function () { hostJam(g); })]));
    },
    openChatLink: openChatLink,
    showSosLink: function (s) { showSosLink(s); }
  };
})();
