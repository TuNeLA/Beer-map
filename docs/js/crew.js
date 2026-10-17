/* Öl Nu v20 TRUPPEN (crew pack). window.CREW, called through mods() in app.js.
   Hooks: init, onAuthed, onPoll, onStopped, hudChipsHTML (max ONE chip), hudClick, groupItem, barPopupHTML,
   topSheet, stopSheet, applyText. Texts: js/crew-content.js (window.CREW_CONTENT). Styles: crew.css.
   Server: supabase/migrations/0027_crew.sql. A missing RPC (old server, PGRST202) = that feature hides, no error.
   1 🚌 Avgångstavlan  2 🗓️ Vilken kväll?  3 👋 Ingen lämnas kvar  4 🕺 Dansgolvsmätaren (bar popup)
   5 🔥 Skålstafetten  6 📼 Kvällsrepris  7 💬 Hur mår truppen?   In-app only (no pushes). */
(function () {
  "use strict";
  var U = window.U, A = null;
  var off = {};            // RPC name -> true when missing on the server
  var P = null;            // last crew_poll answer
  var loadAt = 0, loading = false, firstDone = false;
  var view = null;         // open Truppen sheet: { gid, name, tab, g, torch }
  var lastIdx = {};        // pick(): last line index per list
  var timers = {};         // departure T-5 / go timers by dep id
  var danceCache = {};     // bar id -> {n, avg, level, at, wait_seconds, t}
  var torchLayer = null, torchKey = "";
  var RP = null;           // running replay
  var SEEN_KEY = "olnu.crewSeen";

  /* ---------- small helpers ---------- */
  function en() { return !!(window.I18N && window.I18N.lang === "en"); }
  function L(sv, e) { return en() ? e : sv; }
  function CC() { var c = window.CREW_CONTENT || {}; return { sv: c.sv || {}, en: c.en || {} }; }
  function T(key) {
    var c = CC(), parts = key.split("."), a = en() ? c.en : c.sv, b = c.sv;
    for (var i = 0; i < parts.length; i++) { a = a && a[parts[i]]; b = b && b[parts[i]]; }
    return a != null ? a : b;
  }
  function fill(s, o) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? String(o[k]) : m; }); }
  function pick(key, o) {
    var arr = T(key); if (!arr) return ""; if (typeof arr === "string") return fill(arr, o);
    var n = arr.length, i = Math.floor(Math.random() * n);
    if (n > 1 && i === lastIdx[key]) i = (i + 1) % n;
    lastIdx[key] = i;
    return fill(arr[i], o);
  }
  function esc(s) { return U.esc(s == null ? "" : String(s)); }
  function el(tag, attrs, kids) { return A.el(tag, attrs, kids); }
  function hm(iso) { return iso ? U.timeHM(iso) : ""; }
  function on() { return !!(A && A.LIVE && A.authed && A.authed() && !off.crew_poll); }
  function call(name, params) {
    if (off[name]) return Promise.resolve({ data: null, error: { message: "missing" }, missing: true });
    return A.rpc(name, params || {}).then(function (r) {
      if (r.error && U.missing(r.error)) { off[name] = true; r.missing = true; }
      if (!r.error) r.data = A.parseData(r.data);
      return r;
    });
  }
  function err(r, fallback) {
    if (!r || !r.error || r.missing) return;
    var c = U.errCode(r.error), m = {
      slow_down: L("⏳ Lugn i stormen, vänta en stund.", "⏳ Easy, wait a moment."),
      invalid_time: L("⏰ Välj en tid inom 12 timmar.", "⏰ Pick a time within 12 hours."),
      board_full: L("🚌 Tavlan ä full (4 avgångar).", "🚌 The board is full (4 departures)."),
      invalid_dates: L("🗓️ Välj 2–5 kvällar.", "🗓️ Pick 2–5 evenings."),
      too_far: T("danceFar"), torch_pending: L("🔥 Facklan ä redan på väg.", "🔥 The torch is already on its way."),
      no_offer: L("🔥 Erbjudandet hann gå ut.", "🔥 The offer ran out."), not_out: L("🔥 Nån i gruppen måste vara ute i stan.", "🔥 Someone in the group must be out in town."),
      no_town: L("📍 Checka in eller släpp en pin först.", "📍 Check in or drop a pin first."),
      invalid_target: L("🔥 Den gruppen ä int' ute längre.", "🔥 That group is not out any more.")
    }[c];
    A.toast(m || A.errMsg(r.error, fallback), { err: true });
  }
  function groupOf(id) {
    if (!P || !P.groups) return null;
    for (var i = 0; i < P.groups.length; i++) if (String(P.groups[i].id) === String(id)) return P.groups[i];
    return null;
  }
  function lbl(l, bar) {
    if (l && l.name) return l.name;
    return bar ? fill(T("anonAt"), { bar: bar }) : T("anonTown");
  }
  function hug(s) { return /^[A-Za-zÅÄÖåäöÉé]/.test(s) ? "🫂 " + s : s; }
  function minsTo(iso) { return Math.round((new Date(iso).getTime() - Date.now()) / 60000); }
  function dayLabel(d) {   // "fre 24/10" from YYYY-MM-DD
    var p = String(d).split("-"), dt = new Date(+p[0], +p[1] - 1, +p[2]);
    var days = en() ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["sön", "mån", "tis", "ons", "tor", "fre", "lör"];
    return days[dt.getDay()] + " " + dt.getDate() + "/" + (dt.getMonth() + 1);
  }
  function ymd(dt) { return dt.getFullYear() + "-" + ("0" + (dt.getMonth() + 1)).slice(-2) + "-" + ("0" + dt.getDate()).slice(-2); }

  /* ---------- seen (toasts never repeat after a reload) ---------- */
  function seenGet() {
    var s = U.ls.getJSON(SEEN_KEY, null);
    if (!s || !P || s.n !== P.night) s = { n: P ? P.night : "", ids: [] };
    return s;
  }
  function seenHas(id) { return seenGet().ids.indexOf(id) >= 0; }
  function seenAdd(id) {
    var s = seenGet(); if (s.ids.indexOf(id) >= 0) return false;
    s.ids.push(id); if (s.ids.length > 300) s.ids = s.ids.slice(-300);
    U.ls.setJSON(SEEN_KEY, s); return true;
  }

  /* ---------- poll ---------- */
  function load(force) {
    if (!on() || loading) return;
    if (!force && Date.now() - loadAt < 40000) return;
    if (document.visibilityState === "hidden") return;
    loading = true; loadAt = Date.now();
    var ll = A.lastLoc && A.lastLoc();
    call("crew_poll", { p_lat: ll ? ll.lat : null, p_lng: ll ? ll.lng : null }).then(function (r) {
      loading = false;
      if (r.error) { if (r.missing) { P = null; drawTorch(); hud(); } return; }
      P = r.data || null;
      process();
      drawTorch();
      hud();
    });
  }
  function soon(ms) { setTimeout(function () { load(true); }, ms || 1500); }
  function hud() { try { A.updateCounts(); } catch (e) {} }

  // Toasts for changes; the first poll after opening shows max 2.
  function process() {
    if (!P) return;
    var out = [];   // [prio, text, opts]
    (P.groups || []).forEach(function (g) {
      (g.deps || []).forEach(function (d) {
        schedule(g, d);
        if (!d.is_mine && seenAdd("d" + d.id)) out.push([2, pick("depNew", { namn: d.by || "?", tid: hm(d.leave_at), bar: d.bar_name || L("stan", "town") }),
          { ms: 7000, action: { label: L("🙋 Med!", "🙋 I'm in"), fn: function () { join(d.id, true); } } }]);
      });
      if (g.mood && !g.mood.is_mine && !g.mood.my && seenAdd("m" + g.mood.id))
        out.push([3, pick("moodAsk", { namn: g.mood.by || "?" }), { ms: 9000, action: { label: L("Svara", "Answer"), fn: function () { openSheet(g.id, g.name, "laget"); } } }]);
      if (g.alone && seenAdd("a" + g.id + ":" + g.alone.k)) {
        if (g.alone.is_me) out.push([4, pick("aloneMe"), { ms: 10000, cls: "cr-care" }]);
        else out.push([4, fill(T("aloneToast"), { namn: g.alone.name, bar: g.alone.bar_name || L("stan", "town") }),
          { ms: 10000, cls: "cr-care", action: { label: L("Visa", "Show"), fn: function () { openSheet(g.id, g.name, "laget"); } } }]);
      }
      if (g.dates && !g.dates.is_mine && !g.dates.closed && !g.dates.i_voted && seenAdd("p" + g.dates.id))
        out.push([1, pick("datesNew", { namn: g.dates.by || "?" }), { ms: 7000, action: { label: L("Rösta", "Vote"), fn: function () { openSheet(g.id, g.name, "dates"); } } }]);
    });
    (P.offers || []).forEach(function (t) {
      if (!t.pending || !t.pending.to_group) return;
      if (seenAdd("o" + t.id + ":" + t.pending.at)) out.push([5, pick("torch.offer", { grupp: lbl(t.pending.from, t.holder_bar) }),
        { ms: 12000, action: { label: L("🔥 Ta emot", "🔥 Accept"), fn: function () { torchAnswer(t.pending.to_group, true); } } }]);
    });
    var tc = P.torch;
    if (tc && tc.id && tc.holder && tc.holder.mine && (tc.hops || []).length) {
      var last = tc.hops[tc.hops.length - 1];
      if (seenAdd("h" + tc.id + ":" + tc.passes)) {
        var k = last.how === "light" ? "torch.lit" : last.how === "random" ? "torch.random" : "torch.got";
        if (firstDone) out.push([1, pick(k, { grupp: tc.holder.name || "", stad: tc.town || L("stan", "town") }), { ms: 6000 }]);
      }
    }
    out.sort(function (a, b) { return b[0] - a[0]; });
    if (!firstDone) out = out.slice(0, 2);
    firstDone = true;
    out.forEach(function (x, i) { setTimeout(function () { A.toast(x[1], x[2]); }, i * 900); });
    if (view && A.sheetOpen() && document.getElementById("cr-root")) refreshView(false);
  }
  // T-5 and departure toasts (for everyone in the group who has the app open).
  function schedule(g, d) {
    var at = new Date(d.leave_at).getTime(), now = Date.now();
    var bar = d.bar_name || L("stan", "town");
    if (timers[d.id]) return;
    if (at - now > 75 * 60000 || at - now < -60000) return;
    timers[d.id] = [];
    var t5 = at - 5 * 60000 - now, t0 = at - now;
    if (t5 > -60000 && t0 > 60000) timers[d.id].push(setTimeout(function () {
      if (stillLive(g.id, d.id) && seenAdd("t5" + d.id)) A.toast(pick("depT5", { bar: bar }), { ms: 12000, cls: "cr-dep-toast" });
    }, Math.max(0, t5)));
    timers[d.id].push(setTimeout(function () {
      if (stillLive(g.id, d.id) && seenAdd("go" + d.id)) A.toast(pick("depGo", { bar: bar }), { ms: 12000, cls: "cr-dep-toast" });
    }, Math.max(0, t0)));
  }
  function stillLive(gid, did) {
    var g = groupOf(gid); if (!g) return false;
    return (g.deps || []).some(function (x) { return x.id === did; });
  }

  /* ---------- HUD: max ONE chip ---------- */
  function chipState() {
    if (!on() || !P) return null;
    var o = (P.offers || []).filter(function (t) { return t.pending && t.pending.to_group; })[0];
    if (o) return { kind: "offer", gid: o.pending.to_group, html: "🔥 " + esc(L("Ta emot!", "Accept!")), cls: "cr-chip-fire" };
    var best = null;
    (P.groups || []).forEach(function (g) {
      (g.deps || []).forEach(function (d) {
        var m = minsTo(d.leave_at);
        if (m <= 30 && m >= -5 && (!best || m < best.m)) best = { m: m, g: g };
      });
    });
    if (best) return { kind: "dep", gid: best.g.id, html: "🚌 " + (best.m > 0 ? best.m + " min" : esc(L("Avgång!", "Go!"))), cls: "cr-chip-dep" };
    var mg = (P.groups || []).filter(function (g) { return g.mood && !g.mood.my; })[0];
    if (mg) return { kind: "mood", gid: mg.id, html: "💬 " + esc(L("Läget?", "Status?")), cls: "" };
    return null;
  }

  /* ---------- group list row ---------- */
  function groupItem(g, wrap) {
    if (!A || !A.LIVE || off.crew_poll || off.crew_group || !g || !g.id) return;
    var pg = groupOf(g.id), row = el("div", { class: "cr-gi" });
    if (pg && pg.alone) {
      var tx = pg.alone.is_me ? pick("aloneMe") : pick(pg.alone.bar_name ? "alone" : "aloneNoBar", { namn: pg.alone.name, bar: pg.alone.bar_name });
      row.appendChild(el("div", { class: "cr-alone", role: "status", text: hug(tx) }));
    }
    var sum = [];
    if (pg) {
      var d = (pg.deps || [])[0];
      if (d) sum.push("🚌 " + hm(d.leave_at));
      if (pg.dates && pg.dates.winner) sum.push("🗓️ " + dayLabel(pg.dates.winner));
      else if (pg.dates && !pg.dates.closed) sum.push("🗓️ " + L("rösta", "vote"));
      if (pg.mood && !pg.mood.my) sum.push("💬 ?");
      if (pg.gone_n) sum.push("👋 " + pg.gone_n);
      if (P && P.torch && P.torch.holder_group === g.id) sum.push("🔥");
      if (pg.replay) sum.push("📼");
    }
    var b = el("button", { type: "button", class: "btn btn-small btn-block cr-gbtn" }, [
      el("span", { class: "cr-gl", text: L("🎖️ Truppen", "🎖️ Squad") }),
      sum.length ? el("span", { class: "cr-gs", text: sum.join(" · ") }) : null
    ]);
    b.addEventListener("click", function () { openSheet(g.id, g.name, null); });
    row.appendChild(b);
    wrap.appendChild(row);
  }

  /* ---------- Truppen sheet ---------- */
  var TABS = [["dep", "🚌", "Avgång", "Depart"], ["dates", "🗓️", "Kväll?", "Night?"], ["laget", "👋", "Läget", "Status"],
              ["torch", "🔥", "Facklan", "Torch"], ["replay", "📼", "Repris", "Replay"]];
  function defaultTab(gid) {
    var g = groupOf(gid);
    if (P && (P.offers || []).some(function (t) { return t.pending && t.pending.to_group === gid; })) return "torch";
    if (g && g.replay && !(g.deps || []).length) return "replay";
    if (g && (g.alone || (g.mood && !g.mood.my))) return "laget";
    if (g && !(g.deps || []).length && g.dates && !g.dates.closed && !g.dates.i_voted) return "dates";
    return "dep";
  }
  function openSheet(gid, name, tab) {
    if (!A) return;
    view = { gid: gid, name: name || (groupOf(gid) || {}).name || "", tab: tab || defaultTab(gid), g: groupOf(gid), torch: null };
    A.openSheet("🎖️ " + (view.name || L("Truppen", "Squad")), function (body) {
      var root = el("div", { class: "cr", id: "cr-root" });
      var tabs = el("div", { class: "cr-tabs", role: "tablist" });
      TABS.forEach(function (x) {
        var b = el("button", { type: "button", class: "cr-tab", role: "tab", "data-tab": x[0], "aria-selected": String(view.tab === x[0]) }, [
          el("span", { class: "cr-te", "aria-hidden": "true", text: x[1] }), el("span", { class: "cr-tl", text: en() ? x[3] : x[2] })]);
        b.addEventListener("click", function () {
          view.tab = x[0];
          tabs.querySelectorAll(".cr-tab").forEach(function (t) { t.setAttribute("aria-selected", String(t.getAttribute("data-tab") === view.tab)); });
          refreshView(true);
        });
        tabs.appendChild(b);
      });
      root.appendChild(tabs);
      root.appendChild(el("div", { class: "cr-pane", id: "cr-pane" }));
      body.appendChild(root);
    }, { onClose: function () { view = null; } });
    renderPane();
    refreshView(true);
  }
  function refreshView(withTorch) {
    if (!view) return;
    var gid = view.gid, v = view;
    call("crew_group", { p_group_id: gid }).then(function (r) {
      if (view !== v) return;
      if (r.error) { if (!r.missing) err(r); return; }
      v.g = r.data;
      if (v.tab !== "torch") renderPane();
    });
    if (v.tab === "torch") loadTorchView(v);
  }
  function pane() { return document.getElementById("cr-pane"); }
  function renderPane() {
    var p = pane(); if (!p || !view) return;
    var st = p.scrollTop;
    p.innerHTML = "";
    var g = view.g;
    if (!g) { p.appendChild(el("p", { class: "muted cr-wait", text: L("Hämtar order …", "Fetching orders …") })); return; }
    if (view.tab === "dep") paneDep(p, g);
    else if (view.tab === "dates") paneDates(p, g);
    else if (view.tab === "laget") paneLaget(p, g);
    else if (view.tab === "torch") paneTorch(p, view.torch);
    else if (view.tab === "replay") paneReplay(p, g);
    p.scrollTop = st;
  }

  /* --- 1 🚌 Avgångstavlan --- */
  function flip(s) {
    return '<span class="cr-flip">' + String(s).split("").map(function (c) {
      return c === ":" ? '<i class="cr-colon">:</i>' : '<b>' + esc(c) + "</b>";
    }).join("") + "</span>";
  }
  function depStatus(d) {
    var m = minsTo(d.leave_at);
    if (m > 59) return L("OM ", "IN ") + Math.floor(m / 60) + " H " + (m % 60) + " MIN";
    if (m > 0) return L("OM ", "IN ") + m + " MIN";
    if (m > -1) return L("AVGÅR", "BOARDING");
    return L("AVGICK", "LEFT");
  }
  function paneDep(p, g) {
    var board = el("div", { class: "cr-board" });
    board.appendChild(el("div", { class: "cr-board-h", html: "<span>" + esc(L("AVGÅNGAR", "DEPARTURES")) + "</span><span>" + esc(L("TRUPPEN", "SQUAD")) + "</span>" }));
    var deps = g.deps || [];
    if (!deps.length) board.appendChild(el("div", { class: "cr-board-empty", text: T("depNone") }));
    deps.forEach(function (d) {
      var row = el("div", { class: "cr-dep" + (minsTo(d.leave_at) <= 5 ? " soon" : "") });
      row.appendChild(el("div", { class: "cr-dep-top", html: flip(hm(d.leave_at)) +
        '<span class="cr-dep-to">' + esc((d.bar_name || L("Hemlig destination", "Secret destination")).toUpperCase()) + "</span>" +
        '<span class="cr-dep-st" data-cr-cd="' + esc(d.leave_at) + '">' + esc(depStatus(d)) + "</span>" }));
      var names = (d.going_names || []);
      row.appendChild(el("div", { class: "cr-dep-sub", text: L("av ", "by ") + (d.by || "?") + (names.length ? " · 🙋 " + names.join(", ") : "") }));
      var acts = el("div", { class: "cr-row" });
      var med = A.btn((d.i_going ? "✅ " : "🙋 ") + L("Med!", "I'm in") + " (" + (d.going_n | 0) + ")", "btn-small cr-med" + (d.i_going ? " on" : ""), function () { join(d.id, !d.i_going); });
      med.setAttribute("aria-pressed", String(!!d.i_going));
      acts.appendChild(med);
      if (d.lat != null && d.lng != null) acts.appendChild(A.btn("🗺️", "btn-small", function () { A.closeSheet(); A.flyTo(d.lat, d.lng, 17, null); }));
      if (d.is_mine) acts.appendChild(A.btn("✖️ " + L("Ställ in", "Cancel"), "btn-small btn-ghost", function () {
        call("crew_dep_cancel", { p_dep_id: d.id }).then(function (r) { if (r.error) return err(r); refreshView(); soon(); });
      }));
      row.appendChild(acts);
      board.appendChild(row);
    });
    p.appendChild(board);
    p.appendChild(depForm());
  }
  function join(id, onOff) {
    call("crew_dep_join", { p_dep_id: id, p_on: !!onOff }).then(function (r) {
      if (r.error) return err(r);
      A.toast(pick(onOff ? "medJa" : "medNej"));
      if (view) refreshView(); soon();
    });
  }
  function nearBars() {
    var out = [], seen = {};
    var ci = A.myCheckin && A.myCheckin();
    if (ci && ci.name) { out.push({ id: ci.id || ci.bar_id, name: ci.name, lat: ci.lat, lng: ci.lng }); seen[ci.name] = 1; }
    try {
      var c = A.map.getCenter(), list = window.BARS && window.BARS.nearby ? window.BARS.nearby(c.lat, c.lng, 1500, 6) : [];
      list.forEach(function (x) { if (x.bar && x.bar.name && !seen[x.bar.name] && out.length < 5) { seen[x.bar.name] = 1; out.push(x.bar); } });
    } catch (e) {}
    return out;
  }
  function depForm() {
    var box = el("div", { class: "cr-form" });
    box.appendChild(el("div", { class: "cr-h", text: L("🚌 Ny avgång", "🚌 New departure") }));
    var d0 = new Date(Date.now() + 30 * 60000); d0.setMinutes(Math.ceil(d0.getMinutes() / 5) * 5, 0, 0);
    var tin = el("input", { type: "time", class: "inp cr-time", value: ("0" + d0.getHours()).slice(-2) + ":" + ("0" + d0.getMinutes()).slice(-2), "aria-label": L("Tid", "Time") });
    var quick = el("div", { class: "cr-chips" });
    [15, 30, 45, 60, 90].forEach(function (m) {
      quick.appendChild(el("button", { type: "button", class: "cr-chip", text: "+" + m, onclick: function () {
        var d = new Date(Date.now() + m * 60000); d.setSeconds(0, 0);
        tin.value = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
      } }));
    });
    box.appendChild(el("div", { class: "cr-row cr-timerow" }, [tin, quick]));
    var chosen = null, bars = el("div", { class: "cr-chips cr-bars" });
    var opts = [{ id: null, name: L("Bara tid", "Time only") }].concat(nearBars());
    opts.forEach(function (b, i) {
      var c = el("button", { type: "button", class: "cr-chip" + (i === 0 ? " on" : ""), "aria-pressed": String(i === 0), text: (b.id ? "🍺 " : "⏱️ ") + b.name });
      c.addEventListener("click", function () {
        chosen = b.id ? b : null;
        bars.querySelectorAll(".cr-chip").forEach(function (x) { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
        c.classList.add("on"); c.setAttribute("aria-pressed", "true");
      });
      bars.appendChild(c);
    });
    box.appendChild(el("div", { class: "cr-lbl", text: L("Vart?", "Where to?") }));
    box.appendChild(bars);
    box.appendChild(A.btn(L("🚌 Sätt avgång", "🚌 Set departure"), "btn-amber btn-block", function (ev) {
      var m = /^(\d{1,2}):(\d{2})/.exec(tin.value || "");
      if (!m) { A.toast(L("⏰ Välj en tid.", "⏰ Pick a time."), { err: true }); return; }
      var at = new Date(); at.setHours(+m[1], +m[2], 0, 0);
      if (at.getTime() < Date.now() - 60000) at = new Date(at.getTime() + 86400000);
      var bt = ev && ev.currentTarget; if (bt) bt.disabled = true;
      call("crew_dep_set", { p_group_id: view.gid, p_leave_at: at.toISOString(), p_bar_id: chosen ? String(chosen.id) : null,
        p_bar_name: chosen ? chosen.name : null, p_lat: chosen ? chosen.lat : null, p_lng: chosen ? chosen.lng : null }).then(function (r) {
        if (bt) bt.disabled = false;
        if (r.error) return err(r);
        seenAdd("d" + r.data.id);
        A.toast(pick("depSet", { tid: hm(r.data.leave_at), bar: chosen ? chosen.name : L("äventyret", "adventure") }), { ms: 5000 });
        refreshView(); soon();
      });
    }));
    return box;
  }

  /* --- 2 🗓️ Vilken kväll? --- */
  function paneDates(p, g) {
    var dp = g.dates;
    if (dp) {
      var box = el("div", { class: "cr-dates" });
      box.appendChild(el("div", { class: "cr-h", text: "🗓️ " + (dp.title || L("Vilken kväll?", "Which night?")) }));
      box.appendChild(el("div", { class: "cr-sub", text: L("av ", "by ") + (dp.by || "?") + " · " + (dp.voters | 0) + L(" har röstat", " voted") + (dp.closed ? " · 🔒 " + L("stängd", "closed") : "") }));
      if (dp.winner) box.appendChild(el("div", { class: "cr-win", text: pick("datesWin", { dag: dayLabel(dp.winner) }) }));
      (dp.dates || []).forEach(function (o) {
        var row = el("div", { class: "cr-drow" + (dp.winner === o.d ? " win" : "") });
        row.appendChild(el("div", { class: "cr-dday", text: (dp.winner === o.d ? "🏆 " : "") + dayLabel(o.d) }));
        var bs = el("div", { class: "cr-dbtns" });
        [["kan", "✅", L("Kan", "Yes")], ["kanske", "🤔", L("Kanske", "Maybe")], ["nej", "❌", L("Kan inte", "No")]].forEach(function (a) {
          var b = el("button", { type: "button", class: "cr-dbtn a-" + a[0] + (o.my === a[0] ? " on" : ""), "aria-pressed": String(o.my === a[0]),
            "aria-label": a[2] + " " + dayLabel(o.d), text: a[1] + " " + (o[a[0]] | 0) });
          if (dp.closed) b.disabled = true;
          b.addEventListener("click", function () {
            call("crew_dates_vote", { p_poll_id: dp.id, p_date: o.d, p_answer: a[0] }).then(function (r) {
              if (r.error) return err(r);
              if (!dp.i_voted) A.toast(pick("datesVoted"));
              refreshView(); soon(2500);
            });
          });
          bs.appendChild(b);
        });
        row.appendChild(bs);
        if ((o.kan_names || []).length) row.appendChild(el("div", { class: "cr-dnames", text: "✅ " + o.kan_names.join(", ") }));
        box.appendChild(row);
      });
      if (dp.is_mine && !dp.closed) box.appendChild(A.btn("🔒 " + L("Stäng omröstningen", "Close the poll"), "btn-small btn-ghost", function () {
        call("crew_dates_close", { p_poll_id: dp.id }).then(function (r) { if (r.error) return err(r); refreshView(); soon(); });
      }));
      p.appendChild(box);
      var more = el("details", { class: "cr-more" }, [el("summary", { text: L("🗓️ Ny omröstning", "🗓️ New poll") })]);
      more.appendChild(datesForm());
      p.appendChild(more);
    } else {
      p.appendChild(el("p", { class: "cr-sub", text: L("Fredag eller lördag? Lägg ut 2–5 kvällar och låt truppen rösta.", "Friday or Saturday? Pick 2–5 evenings and let the squad vote.") }));
      p.appendChild(datesForm());
    }
  }
  function datesForm() {
    var box = el("div", { class: "cr-form" }), picked = [];
    var chips = el("div", { class: "cr-chips cr-days" });
    var base = new Date(); if (base.getHours() < 5) base = new Date(base.getTime() - 86400000);
    for (var i = 0; i < 14; i++) (function (i) {
      var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i), key = ymd(d);
      var c = el("button", { type: "button", class: "cr-chip" + (d.getDay() === 5 || d.getDay() === 6 ? " we" : ""), "aria-pressed": "false",
        text: i === 0 ? L("ikväll", "tonight") : dayLabel(key) });
      c.addEventListener("click", function () {
        var at = picked.indexOf(key);
        if (at >= 0) picked.splice(at, 1);
        else { if (picked.length >= 5) { A.toast(L("Max 5 kvällar.", "Max 5 evenings.")); return; } picked.push(key); }
        c.classList.toggle("on", picked.indexOf(key) >= 0); c.setAttribute("aria-pressed", String(picked.indexOf(key) >= 0));
      });
      chips.appendChild(c);
    })(i);
    box.appendChild(chips);
    var title = el("input", { class: "inp", maxlength: "40", placeholder: L("Rubrik (valfri), t.ex. Nästa raid", "Title (optional), e.g. Next raid") });
    box.appendChild(title);
    box.appendChild(A.btn(L("🗳️ Starta omröstning", "🗳️ Start poll"), "btn-amber btn-block", function () {
      if (picked.length < 2) { A.toast(L("Välj minst 2 kvällar.", "Pick at least 2 evenings."), { err: true }); return; }
      call("crew_dates_create", { p_group_id: view.gid, p_dates: picked.slice().sort(), p_title: (title.value || "").trim() || null }).then(function (r) {
        if (r.error) return err(r);
        seenAdd("p" + r.data.id);
        A.toast(L("🗓️ Omröstningen ä ute. Nu väntar vi på truppen.", "🗓️ Poll is out. Waiting for the squad."));
        refreshView(); soon();
      });
    }));
    return box;
  }

  /* --- 3 👋 Ingen lämnas kvar + 7 💬 Hur mår truppen? --- */
  var ST = { out: ["🟢", "ute", "out"], left: ["👋", "drog", "left"], home: ["🏠", "hemma", "home"], quiet: ["💤", "tyst", "quiet"], none: ["⚪", "int' ute", "not out"] };
  function paneLaget(p, g) {
    if (g.alone) {
      p.appendChild(el("div", { class: "cr-alone big", role: "status", text: hug(g.alone.is_me ? pick("aloneMe") :
        pick(g.alone.bar_name ? "alone" : "aloneNoBar", { namn: g.alone.name, bar: g.alone.bar_name })) }));
    }
    var left = g.me_state === "left";
    p.appendChild(A.btn(left ? L("↩️ Jag ä kvar ändå", "↩️ I'm still out") : L("👋 Hej då – jag drar hem", "👋 Bye – I'm heading home"),
      "btn-block " + (left ? "btn-ghost" : "btn-green") + " cr-bye", function () { bye(!left); }));
    // members
    var ul = el("ul", { class: "cr-mem" });
    (g.members || []).slice().sort(function (a, b) {
      var o = { out: 0, left: 1, home: 2, quiet: 3, none: 4 }; return (o[a.state] - o[b.state]) || String(a.name).localeCompare(String(b.name));
    }).forEach(function (m) {
      var s = ST[m.state] || ST.none, txt = en() ? s[2] : s[1];
      if (m.state === "out" && m.bar_name) txt += " · " + m.bar_name;
      if ((m.state === "left" || m.state === "home") && m.left_at) txt += " " + hm(m.left_at);
      ul.appendChild(el("li", { class: "st-" + m.state }, [el("span", { class: "cr-me", text: s[0] }),
        el("b", { text: m.is_me ? L("Du", "You") : m.name }), el("span", { class: "cr-ms", text: txt })]));
    });
    p.appendChild(el("div", { class: "cr-h", text: L("👥 Truppen ikväll", "👥 Squad tonight") + " · " + (g.out_n | 0) + L(" ute", " out") }));
    p.appendChild(ul);
    // mood
    p.appendChild(moodBox(g));
  }
  function bye(onOff) {
    call("crew_bye", { p_on: !!onOff }).then(function (r) {
      if (r.error) return err(r);
      A.toast(onOff ? pick("bye") : T("byeUndo"), { ms: 6000 });
      refreshView(); soon(1000);
    });
  }
  function moodBox(g) {
    var box = el("div", { class: "cr-mood" }), md = g.mood;
    box.appendChild(el("div", { class: "cr-h", text: L("💬 Hur mår truppen?", "💬 How's the squad?") }));
    if (!md) {
      box.appendChild(A.btn(L("💬 Fråga truppen", "💬 Ask the squad"), "btn-block", function () {
        call("crew_mood_start", { p_group_id: view.gid }).then(function (r) {
          if (r.error) return err(r);
          seenAdd("m" + r.data.id);
          A.toast(L("📻 Frågan ä ute. Svara själv också!", "📻 Question sent. Answer yourself too!"));
          refreshView(); soon();
        });
      }));
      return box;
    }
    box.appendChild(el("div", { class: "cr-sub", text: pick("moodAsk", { namn: md.is_mine ? L("Du", "You") : md.by || "?" }) + " · " + L("till ", "until ") + hm(md.ends_at) }));
    var row = el("div", { class: "cr-mbtns" });
    [["bra", "👍", L("Bra", "Good")], ["snurr", "😵", L("Snurrigt", "Dizzy")], ["hem", "🏠", L("Hem snart", "Home soon")]].forEach(function (a) {
      var b = el("button", { type: "button", class: "cr-mbtn m-" + a[0] + (md.my === a[0] ? " on" : ""), "aria-pressed": String(md.my === a[0]) }, [
        el("span", { class: "cr-mbe", text: a[1] }), el("span", { text: a[2] }), el("b", { text: String(md[a[0]] | 0) })]);
      b.addEventListener("click", function () {
        call("crew_mood_answer", { p_mood_id: md.id, p_answer: a[0] }).then(function (r) {
          if (r.error) return err(r);
          A.toast(pick(a[0] === "bra" ? "moodBra" : a[0] === "snurr" ? "moodSnurr" : "moodHem"), { ms: 6000 });
          refreshView(); soon();
        });
      });
      row.appendChild(b);
    });
    box.appendChild(row);
    var tot = (md.bra | 0) + (md.snurr | 0) + (md.hem | 0);
    if (tot) {
      var k = md.snurr ? "moodSum.snurr" : md.hem ? "moodSum.hem" : md.bra === tot ? "moodSum.allBra" : "moodSum.mixed";
      box.appendChild(el("div", { class: "cr-msum", text: pick(k, { n: md.snurr ? md.snurr : md.hem }) + (md.waiting ? " · " + md.waiting + L(" har int' svarat", " not answered") : "") }));
    }
    var ans = md.answers || [];
    if (ans.length) box.appendChild(el("div", { class: "cr-mans", text: ans.map(function (a) {
      return (a.answer === "bra" ? "👍 " : a.answer === "snurr" ? "😵 " : "🏠 ") + (a.is_me ? L("Du", "You") : a.name);
    }).join(" · ") }));
    var dz = ans.filter(function (a) { return a.answer === "snurr"; });
    if (dz.length) {
      var care = el("div", { class: "cr-care-box" });
      dz.forEach(function (a) {
        var near = (a.near || []).filter(function (n) { return n; });
        care.appendChild(el("div", { class: "cr-care-who", text: "😵 " + (a.is_me ? L("Du", "You") : a.name) + (a.bar_name ? " @ " + a.bar_name : "") + " · " +
          (near.length ? L("nära: ", "near: ") + near.join(", ") : L("ingen i truppen nära", "nobody from the squad near")) }));
      });
      var tips = el("ul", { class: "cr-tips" });
      (T("snurrTips") || []).forEach(function (t) { tips.appendChild(el("li", { text: t })); });
      care.appendChild(tips);
      var acts = el("div", { class: "cr-row cr-care-acts" });
      if (window.EXTRAS && window.EXTRAS.taxiHTML) acts.appendChild(el("div", { html: window.EXTRAS.taxiHTML("btn btn-small taxi-btn") }));
      if (window.AFTER && window.AFTER.showKebab) acts.appendChild(A.btn(L("🌯 Mat nära", "🌯 Food nearby"), "btn-small", function () { window.AFTER.showKebab(); }));
      care.appendChild(acts);
      box.appendChild(care);
    }
    return box;
  }

  /* --- 5 🔥 Skålstafetten --- */
  function loadTorchView(v) {
    var ll = A.lastLoc && A.lastLoc();
    call("crew_torch", { p_lat: ll ? ll.lat : null, p_lng: ll ? ll.lng : null }).then(function (r) {
      if (view !== v) return;
      if (r.error) { v.torch = { error: true, missing: !!r.missing }; } else v.torch = r.data || {};
      if (v.tab === "torch") renderPane();
    });
  }
  function paneTorch(p, t) {
    var gid = view.gid;
    if (!t) { p.appendChild(el("p", { class: "muted cr-wait", text: L("Letar efter facklan …", "Looking for the torch …") })); return; }
    if (t.error) { p.appendChild(el("p", { class: "muted", text: t.missing ? L("Facklan finns int' på servern än.", "The torch is not on the server yet.") : L("Kunde int' hämta facklan.", "Could not load the torch.") })); return; }
    p.appendChild(el("p", { class: "cr-sub", text: L("En fackla per stad och kväll. Ge den till en annan grupp som ä ute — de har 10 min att ta emot, annars vandrar den vidare själv.",
      "One torch per town per night. Pass it to another group that is out — they have 10 min to accept, or it wanders on.") }));
    if (t.no_town) { p.appendChild(el("div", { class: "cr-torch none", text: L("📍 Checka in eller släpp en pin så vet vi vilken stad du ä i.", "📍 Check in or drop a pin so we know your town.") })); return; }
    var stad = t.town || L("närområdet", "the area");
    var mineOut = (t.my_groups || []).some(function (x) { return x.id === gid; });
    if (!t.lit) {
      var c0 = el("div", { class: "cr-torch none" }, [el("div", { class: "cr-flame off", text: "🕯️" }), el("div", { text: pick("torch.none", { stad: stad }) })]);
      p.appendChild(c0);
      if (mineOut) p.appendChild(A.btn(L("🔥 Tänd facklan", "🔥 Light the torch"), "btn-amber btn-block", function () {
        var ll = A.lastLoc && A.lastLoc();
        call("crew_torch_light", { p_group_id: gid, p_lat: ll ? ll.lat : null, p_lng: ll ? ll.lng : null }).then(function (r) {
          if (r.error) return err(r);
          A.toast(r.data.already ? L("🔥 Nån hann före! Facklan brinner redan.", "🔥 Someone was first! The torch is already lit.") : pick("torch.lit", { stad: stad, grupp: view.name }), { ms: 6000 });
          loadTorchView(view); soon();
        });
      }));
      else p.appendChild(el("p", { class: "muted", text: fill(L("Nån i gruppen måste vara ute i {stad} (incheckad eller med pin).", "Someone in the group must be out in {stad} (checked in or with a pin)."), { stad: stad }) }));
      return;
    }
    var holderMine = t.holder_group === gid;
    var card = el("div", { class: "cr-torch" + (holderMine ? " mine" : "") });
    card.appendChild(el("div", { class: "cr-flame", text: "🔥" }));
    card.appendChild(el("div", { class: "cr-torch-t" }, [
      el("div", { class: "cr-torch-h", text: (holderMine ? L("Ni bär facklan!", "You carry the torch!") : L("Facklan bärs av ", "Torch carried by ") + lbl(t.holder, t.holder_bar)) }),
      el("div", { class: "cr-sub", text: stad + " · " + (t.passes | 0) + L(" överlämningar", " handovers") + (t.holder_bar ? " · " + t.holder_bar : "") })
    ]));
    p.appendChild(card);
    if (t.pending) {
      var left = Math.max(0, new Date(t.pending.until).getTime() - Date.now());
      p.appendChild(el("div", { class: "cr-pend", html: "⏳ " + esc(L("På väg till ", "On its way to ") + lbl(t.pending.to)) + ' · <span data-cr-mmss="' + esc(t.pending.until) + '">' + esc(U.mmss(left)) + "</span>" }));
      if (t.pending.to_group === gid) {
        p.appendChild(el("div", { class: "cr-offer", text: pick("torch.offer", { grupp: lbl(t.pending.from) }) }));
        p.appendChild(el("div", { class: "cr-row" }, [
          A.btn(L("🔥 Ta emot", "🔥 Accept"), "btn-amber", function () { torchAnswer(gid, true); }),
          A.btn(L("Låt den gå vidare", "Let it go"), "btn-ghost", function () { torchAnswer(gid, false); })
        ]));
      }
    } else if (holderMine) {
      p.appendChild(el("div", { class: "cr-sub", text: pick("torch.held") }));
      var cands = t.cands || [];
      if (!cands.length) p.appendChild(el("div", { class: "cr-sub muted", text: pick("torch.lonely") }));
      cands.forEach(function (c) {
        p.appendChild(el("div", { class: "cr-cand" }, [
          el("span", { text: "🍻 " + lbl(c.label, c.bar_name) + (c.label && c.label.name && c.bar_name ? " · " + c.bar_name : "") }),
          A.btn(L("🔥 Ge facklan", "🔥 Pass"), "btn-small btn-amber", function () {
            call("crew_torch_pass", { p_group_id: gid, p_key: c.key }).then(function (r) {
              if (r.error) return err(r);
              A.toast(pick("torch.sent"), { ms: 5000 });
              loadTorchView(view); soon();
            });
          })
        ]));
      });
    }
    var hops = t.hops || [];
    if (hops.length) {
      p.appendChild(el("div", { class: "cr-h", text: pick("torch.route", { stad: stad, n: Math.max(0, hops.length - 1) }) }));
      p.appendChild(routeList(hops));
      if (hops.some(function (h) { return h.lat != null; })) p.appendChild(A.btn(L("🗺️ Visa vägen på kartan", "🗺️ Show route on map"), "btn-small btn-block", function () {
        A.closeSheet(); fitTorch(hops);
      }));
    }
  }
  function routeList(hops) {
    var ol = el("ol", { class: "cr-route" });
    hops.forEach(function (h) {
      var ic = h.how === "light" ? "🕯️" : h.how === "random" ? "🎲" : "➡️";
      ol.appendChild(el("li", {}, [el("span", { class: "cr-rt", text: hm(h.at) }), el("span", { text: ic + " " + lbl(h.to, h.bar_name) +
        (h.to && h.to.name && h.bar_name ? " @ " + h.bar_name : "") + (h.by ? " (" + h.by + ")" : "") })]));
    });
    return ol;
  }
  function torchAnswer(gid, yes) {
    call("crew_torch_answer", { p_group_id: gid, p_accept: !!yes }).then(function (r) {
      if (r.error) { err(r); soon(); return; }
      A.toast(yes ? pick("torch.got", { grupp: (groupOf(gid) || {}).name || "", stad: "" }) : pick("torch.declined"), { ms: 6000 });
      if (view && view.tab === "torch") loadTorchView(view);
      soon(800);
    });
  }
  // Map: the torch's route tonight as a dotted line between bar points (never homes) + a flame at the end.
  function drawTorch() {
    if (!A || !A.map) return;
    var t = P && P.torch, pts = [];
    if (t && t.id) (t.hops || []).forEach(function (h) { if (h.lat != null && h.lng != null) pts.push([h.lat, h.lng]); });
    var key = JSON.stringify(pts) + (A.map.getZoom() >= 11 ? "z" : "");
    if (key === torchKey) return;
    torchKey = key;
    if (torchLayer) { A.map.removeLayer(torchLayer); torchLayer = null; }
    if (!pts.length || A.map.getZoom() < 11) return;
    if (!A.map.getPane("crewtorch")) { A.map.createPane("crewtorch"); A.map.getPane("crewtorch").style.zIndex = 585; }
    torchLayer = window.L.layerGroup();
    if (pts.length > 1) {
      window.L.polyline(pts, { pane: "crewtorch", color: "#2a1200", weight: 6, opacity: 0.55, interactive: false }).addTo(torchLayer);
      window.L.polyline(pts, { pane: "crewtorch", color: "#ff7a1a", weight: 3, dashArray: "1 9", lineCap: "round", opacity: 0.95, interactive: false }).addTo(torchLayer);
    }
    pts.slice(0, -1).forEach(function (q) { window.L.circleMarker(q, { pane: "crewtorch", radius: 3, color: "#ff7a1a", weight: 1, fillColor: "#ffc24d", fillOpacity: 0.9, interactive: false }).addTo(torchLayer); });
    var lastPt = pts[pts.length - 1];
    window.L.marker(lastPt, { pane: "crewtorch", interactive: true, keyboard: false,
      icon: window.L.divIcon({ className: "cr-torch-mk", html: '<span aria-hidden="true">🔥</span>', iconSize: [26, 26], iconAnchor: [13, 22] }),
      title: L("Skålstafetten", "The torch relay") }).on("click", function () { openTorchFromMap(); }).addTo(torchLayer);
    torchLayer.addTo(A.map);
  }
  function openTorchFromMap() {
    var g = (P && P.groups || [])[0];
    if (g) openSheet(g.id, g.name, "torch");
  }
  function fitTorch(hops) {
    var pts = hops.filter(function (h) { return h.lat != null; }).map(function (h) { return [h.lat, h.lng]; });
    if (!pts.length) return;
    if (pts.length === 1) A.map.setView(pts[0], 16); else A.map.fitBounds(pts, { padding: [60, 60], maxZoom: 16 });
  }

  /* --- 6 📼 Kvällsrepris --- */
  function paneReplay(p, g) {
    p.appendChild(el("div", { class: "cr-rp-intro", html: '<div class="cr-rp-ic" aria-hidden="true">📼</div><div>' +
      esc(L("Gårdagens kväll som film: truppens incheckningar och pins på kartan, minut för minut. Bara krogpunkter och grova områden — aldrig hem.",
        "Last night as a film: the squad's check-ins and pins on the map, minute by minute. Bar points and rough areas only — never homes.")) + "</div>" }));
    if (g.replay) p.appendChild(A.btn(L("▶️ Spela upp kvällen", "▶️ Play the night"), "btn-amber btn-block cr-play", function () { startReplay(view.gid); }));
    else p.appendChild(el("p", { class: "muted", text: T("replayClosed") }));
  }
  var COLORS = ["#ffc24d", "#3ddc84", "#4aa3ff", "#ff7a1a", "#d9b8ff", "#ff5c8a", "#9aa66e", "#fffaf0"];
  function startReplay(gid) {
    call("crew_replay", { p_group_id: gid }).then(function (r) {
      if (r.error) return err(r);
      var d = r.data || {};
      if (!d.available) { A.toast(d.empty ? T("replayEmpty") : T("replayClosed")); return; }
      A.closeSheet();
      runReplay(d);
    });
  }
  function stopReplay() {
    if (!RP) return;
    cancelAnimationFrame(RP.raf); if (RP.layer) A.map.removeLayer(RP.layer);
    if (RP.panel) RP.panel.remove();
    document.body.classList.remove("cr-replaying");
    RP = null;
  }
  function runReplay(d) {
    stopReplay();
    var pts = (d.points || []).map(function (x) { return { k: x.k, t: new Date(x.at).getTime(), lat: x.lat, lng: x.lng, bar: x.bar_name, kind: x.kind }; });
    if (!pts.length) { A.toast(T("replayEmpty")); return; }
    var mem = {}, order = [];
    (d.members || []).forEach(function (m, i) { mem[m.k] = { k: m.k, name: m.name, is_me: m.is_me, color: COLORS[i % COLORS.length], pts: [],
      end: m.bye_at || m.home_at ? new Date(m.home_at || m.bye_at).getTime() : null }; order.push(m.k); });
    pts.forEach(function (q) { if (mem[q.k]) mem[q.k].pts.push(q); });
    var t0 = pts[0].t - 5 * 60000, t1 = pts[pts.length - 1].t + 10 * 60000;
    var dur = Math.max(20000, Math.min(40000, 20000 + pts.length * 600));
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) dur = 20000;
    if (!A.map.getPane("crewreplay")) { A.map.createPane("crewreplay"); A.map.getPane("crewreplay").style.zIndex = 660; }
    var layer = window.L.layerGroup().addTo(A.map);
    order.forEach(function (k) {
      var m = mem[k]; if (!m.pts.length) return;
      m.line = window.L.polyline([], { pane: "crewreplay", color: m.color, weight: 3, opacity: 0.75, dashArray: "4 6", interactive: false }).addTo(layer);
      m.dot = window.L.marker([m.pts[0].lat, m.pts[0].lng], { pane: "crewreplay", interactive: false, keyboard: false,
        icon: window.L.divIcon({ className: "cr-rp-dot", html: '<span style="--c:' + m.color + '">' + esc((m.is_me ? L("Du", "You") : m.name || "?").slice(0, 2)) + "</span>", iconSize: [28, 28], iconAnchor: [14, 14] }) });
      m.shown = false; m.nextIdx = 0;
    });
    var bounds = pts.map(function (q) { return [q.lat, q.lng]; });
    if (bounds.length === 1) A.map.setView(bounds[0], 15);
    else A.map.fitBounds(bounds, { paddingTopLeft: [40, 140], paddingBottomRight: [40, 230], maxZoom: 16 });
    // panel
    var panel = el("div", { class: "cr-rp", role: "region", "aria-label": L("Kvällsrepris", "Night replay") });
    var timeEl = el("div", { class: "cr-rp-time", text: hm(new Date(t0).toISOString()) });
    var slider = el("input", { type: "range", min: "0", max: "1000", value: "0", class: "cr-rp-slider", "aria-label": L("Tid", "Time") });
    var playB = el("button", { type: "button", class: "btn btn-small cr-rp-pp", text: "⏸️", "aria-label": L("Paus", "Pause") });
    var closeB = el("button", { type: "button", class: "btn btn-small btn-ghost cr-rp-x", text: "✕", "aria-label": L("Stäng", "Close") });
    var legend = el("div", { class: "cr-rp-leg" });
    order.forEach(function (k) { var m = mem[k]; if (m.pts.length) legend.appendChild(el("span", { style: "--c:" + m.color, text: m.is_me ? L("Du", "You") : m.name })); });
    var endBox = el("div", { class: "cr-rp-end", hidden: "hidden" });
    panel.appendChild(el("div", { class: "cr-rp-top" }, [el("b", { text: "📼 " + L("Kvällsrepris", "Night replay") + " · " + dayLabel(d.evening) }), timeEl, closeB]));
    panel.appendChild(el("div", { class: "cr-rp-ctl" }, [playB, slider]));
    panel.appendChild(legend);
    panel.appendChild(endBox);
    document.body.appendChild(panel);
    document.body.classList.add("cr-replaying");
    RP = { layer: layer, panel: panel, raf: 0, pos: 0, playing: true, last: performance.now(), dur: dur };
    function at(m, t) {
      var a = m.pts, i = -1;
      for (var j = 0; j < a.length; j++) if (a[j].t <= t) i = j; else break;
      if (i < 0) return null;
      if (m.end && t > m.end + 60000 && i === a.length - 1) return { gone: true, p: [a[i].lat, a[i].lng], i: i };
      if (i === a.length - 1) return { p: [a[i].lat, a[i].lng], i: i };
      var b = a[i + 1], moveStart = Math.max(a[i].t, b.t - 15 * 60000);
      if (t < moveStart) return { p: [a[i].lat, a[i].lng], i: i };
      var f = (t - moveStart) / Math.max(1, b.t - moveStart);
      return { p: [a[i].lat + (b.lat - a[i].lat) * f, a[i].lng + (b.lng - a[i].lng) * f], i: i };
    }
    function burst(q, color) {
      var mk = window.L.marker([q.lat, q.lng], { pane: "crewreplay", interactive: false, keyboard: false,
        icon: window.L.divIcon({ className: "cr-rp-burst", html: '<span style="--c:' + color + '">' + (q.kind === "ci" ? "📍" : "✨") + "</span>", iconSize: [36, 36], iconAnchor: [18, 18] }) }).addTo(layer);
      setTimeout(function () { try { layer.removeLayer(mk); } catch (e) {} }, 1400);
    }
    function draw(pos, live) {
      var t = t0 + (t1 - t0) * pos;
      timeEl.textContent = hm(new Date(t).toISOString());
      order.forEach(function (k) {
        var m = mem[k]; if (!m.pts.length) return;
        var s = at(m, t);
        if (!s || s.gone) { if (m.shown) { layer.removeLayer(m.dot); m.shown = false; } }
        else { m.dot.setLatLng(s.p); if (!m.shown) { m.dot.addTo(layer); m.shown = true; } }
        var path = m.pts.filter(function (q) { return q.t <= t; }).map(function (q) { return [q.lat, q.lng]; });
        if (s && !s.gone) path.push(s.p);
        m.line.setLatLngs(path);
        if (live) while (m.nextIdx < m.pts.length && m.pts[m.nextIdx].t <= t) { burst(m.pts[m.nextIdx], m.color); m.nextIdx++; }
        else { m.nextIdx = 0; while (m.nextIdx < m.pts.length && m.pts[m.nextIdx].t <= t) m.nextIdx++; }
      });
    }
    function frame(now) {
      if (!RP) return;
      if (RP.playing) {
        RP.pos = Math.min(1, RP.pos + (now - RP.last) / RP.dur);
        slider.value = String(Math.round(RP.pos * 1000));
        draw(RP.pos, true);
        if (RP.pos >= 1) { RP.playing = false; playB.textContent = "🔁"; showEnd(); }
      }
      RP.last = now;
      RP.raf = requestAnimationFrame(frame);
    }
    function showEnd() {
      var s = d.summary || {}, parts = [];
      parts.push("👥 " + (s.members_out | 0) + L(" ute", " out"));
      if (s.bars) parts.push("📍 " + s.bars + L(" ställen", " places"));
      if (s.checkins) parts.push("✅ " + s.checkins + L(" incheckningar", " check-ins"));
      if (s.first_at && s.last_at) parts.push("⏱️ " + hm(s.first_at) + "–" + hm(s.last_at));
      if (s.torch) parts.push("🔥 " + L("bar facklan ×", "carried the torch ×") + s.torch);
      var homes = (d.members || []).filter(function (m) { return m.home_at; }).map(function (m) { return "🏠 " + (m.is_me ? L("Du", "You") : m.name) + " " + hm(m.home_at); });
      endBox.innerHTML = "";
      endBox.appendChild(el("div", { class: "cr-rp-endh", text: pick("replayEnd") }));
      endBox.appendChild(el("div", { class: "cr-rp-stats", text: parts.join(" · ") }));
      if (s.top_bar) endBox.appendChild(el("div", { class: "cr-rp-stats", text: L("🏆 Kvällens högkvarter: ", "🏆 HQ of the night: ") + s.top_bar }));
      if (homes.length) endBox.appendChild(el("div", { class: "cr-rp-stats", text: homes.join(" · ") }));
      endBox.hidden = false;
    }
    playB.addEventListener("click", function () {
      if (!RP) return;
      if (RP.pos >= 1) { RP.pos = 0; endBox.hidden = true; draw(0, false); }
      RP.playing = !RP.playing; RP.last = performance.now();
      playB.textContent = RP.playing ? "⏸️" : "▶️"; playB.setAttribute("aria-label", RP.playing ? L("Paus", "Pause") : L("Spela", "Play"));
    });
    slider.addEventListener("input", function () {
      if (!RP) return;
      RP.pos = (+slider.value || 0) / 1000; RP.playing = false; playB.textContent = "▶️";
      endBox.hidden = RP.pos < 1; draw(RP.pos, false); if (RP.pos >= 1) showEnd();
    });
    closeB.addEventListener("click", stopReplay);
    draw(0, false);
    RP.raf = requestAnimationFrame(frame);
  }

  /* --- 4 🕺 Dansgolvsmätaren (bar popup) --- */
  function danceInner(id) {
    var c = danceCache[id], lv = T("danceLv"), em = T("danceEmoji"), h = "";
    if (c && c.n > 0 && c.level != null) {
      var ago = c.at ? Math.max(0, Math.round((Date.now() - new Date(c.at).getTime()) / 60000)) : 0;
      h += '<div class="cr-meter lv' + c.level + '" role="img" aria-label="' + esc(lv[c.level]) + '"><i></i><i></i><i></i></div>' +
        '<div class="cr-dl"><b>' + esc((c.level >= 1 ? "🕺 " : "") + lv[c.level]) + "</b> · " + esc(c.n + L(" rapp. · ", " rep. · ") + ago + " min") + "</div>";
    } else h += '<div class="cr-dl muted">' + esc(c ? T("danceNone") : L("Kollar dansgolvet …", "Checking the dance floor …")) + "</div>";
    if (c && c.wait_seconds > 0) h += '<div class="cr-dl muted">✓ ' + esc(L("Du har rapporterat · igen om ", "You reported · again in ") + Math.ceil(c.wait_seconds / 60) + " min") + "</div>";
    else h += '<div class="cr-dbtns2">' + [0, 1, 2].map(function (i) {
      return '<button type="button" class="cr-dance-b" data-crlv="' + i + '">' + esc(em[i] + " " + lv[i]) + "</button>";
    }).join("") + "</div>";
    return h;
  }
  function barPopupHTML(bar) {
    if (!A || !A.LIVE || off.crew_dance_bar || !bar || bar.id == null) return "";
    if (bar.type && /restaurant|fast_food|cafe/.test(bar.type)) return "";
    var id = String(bar.id);
    return '<div class="cr-dance pp-sec" data-crd="' + esc(id) + '" data-lat="' + esc(bar.lat) + '" data-lng="' + esc(bar.lng) + '" data-name="' + esc(bar.name || "") + '">' +
      '<div class="pp-sec-h">' + esc(L("🪩 Dansgolvet", "🪩 Dance floor")) + '</div><div class="cr-dance-in">' + danceInner(id) + "</div></div>";
  }
  function wireDance(root) {
    root.querySelectorAll(".cr-dance[data-crd]").forEach(function (box) {
      var id = box.getAttribute("data-crd");
      var c = danceCache[id];
      if (!c || Date.now() - c.t > 60000) call("crew_dance_bar", { p_bar_id: id }).then(function (r) {
        if (r.error) { if (r.missing) box.remove(); return; }
        danceCache[id] = Object.assign({ t: Date.now() }, r.data || {});
        var inn = box.querySelector(".cr-dance-in"); if (inn) inn.innerHTML = danceInner(id);
      });
      if (box._crw) return; box._crw = true;
      box.addEventListener("click", function (ev) {
        var b = ev.target && ev.target.closest && ev.target.closest(".cr-dance-b"); if (!b) return;
        ev.preventDefault(); ev.stopPropagation();
        report(box, id, +b.getAttribute("data-crlv"), b);
      });
    });
  }
  function report(box, id, lv, b) {
    var blat = +box.getAttribute("data-lat"), blng = +box.getAttribute("data-lng"), name = box.getAttribute("data-name");
    function send(lat, lng) {
      if (U.haversine(lat, lng, blat, blng) > 300) { A.toast(T("danceFar"), { err: true }); return; }
      if (b) b.disabled = true;
      call("crew_dance_report", { p_bar_id: id, p_bar_name: name, p_bar_lat: blat, p_bar_lng: blng, p_lat: lat, p_lng: lng, p_level: lv }).then(function (r) {
        if (b) b.disabled = false;
        if (r.error) return err(r);
        danceCache[id] = Object.assign({ t: Date.now() }, r.data || {});
        if (r.data && r.data.ok) { danceCache[id].wait_seconds = Math.max(danceCache[id].wait_seconds | 0, 600); A.toast(pick("danceThanks")); }
        var inn = box.querySelector(".cr-dance-in"); if (inn) inn.innerHTML = danceInner(id);
      });
    }
    var ll = A.lastLoc && A.lastLoc();
    if (ll && U.haversine(ll.lat, ll.lng, blat, blng) <= 300) return send(ll.lat, ll.lng);
    A.getPosition().then(function (pos) {
      var la = pos.coords.latitude, ln = pos.coords.longitude;
      try { A.setLastLoc(la, ln); } catch (e) {}
      send(la, ln);
    }, function (e) { A.toast(A.locError ? A.locError(e) : T("danceFar"), { err: true }); });
  }

  /* --- 🏆 sheet: torch summary --- */
  function topSheet(body) {
    if (!on() || !P || !P.torch) return;
    var t = P.torch, stad = t.town || L("närområdet", "the area");
    body.appendChild(el("h3", { text: L("🔥 Skålstafetten · ", "🔥 Torch relay · ") + stad }));
    if (!t.id) { body.appendChild(el("p", { class: "muted", text: pick("torch.none", { stad: stad }) })); return; }
    body.appendChild(el("p", { class: "cr-sub", text: L("Facklan bärs av ", "Carried by ") + lbl(t.holder, t.holder_bar) + " · " + (t.passes | 0) + L(" överlämningar", " handovers") }));
    var hops = (t.hops || []).slice(-6);
    if (hops.length) body.appendChild(routeList(hops));
  }

  /* ---------- live countdowns inside the sheet ---------- */
  setInterval(function () {
    if (!view || !document.getElementById("cr-root")) return;
    document.querySelectorAll("[data-cr-cd]").forEach(function (x) { x.textContent = depStatus({ leave_at: x.getAttribute("data-cr-cd") }); });
    document.querySelectorAll("[data-cr-mmss]").forEach(function (x) { x.textContent = U.mmss(new Date(x.getAttribute("data-cr-mmss")).getTime() - Date.now()); });
  }, 1000);
  setInterval(function () { if (view && A && A.sheetOpen() && document.getElementById("cr-root")) refreshView(false); }, 20000);
  setInterval(function () { if (A && P) hud(); }, 30000);   // chip countdown

  /* ---------- public hooks ---------- */
  window.CREW = {
    state: function () { return P; }, open: openSheet, replay: runReplay, stopReplay: stopReplay,
    init: function (api) {
      A = api;
      A.map.on("popupopen", function (e) {
        var root = e.popup && e.popup.getElement && e.popup.getElement();
        if (root) wireDance(root);
      });
      A.map.on("zoomend", function () { drawTorch(); });
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") load(false); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && RP) stopReplay(); });
    },
    applyText: function () { torchKey = ""; drawTorch(); },
    onAuthed: function () { load(true); },
    onPoll: function () { load(false); },
    onStopped: function (kind) { if (kind === "home") soon(2500); },
    hudChipsHTML: function () {
      var s = chipState(); if (!s) return "";
      return '<button type="button" class="hx-chip cr-chip ' + s.cls + '" data-hx="crew" data-crk="' + s.kind + '">' + s.html + "</button>";
    },
    hudClick: function (action) {
      if (action !== "crew") return;
      var s = chipState(); if (!s) return;
      openSheet(s.gid, (groupOf(s.gid) || {}).name, s.kind === "offer" ? "torch" : s.kind === "dep" ? "dep" : "laget");
    },
    groupItem: function (g, wrap) { groupItem(g, wrap); },
    barPopupHTML: barPopupHTML,
    topSheet: topSheet,
    // "Sluta dricka / Jag är hemma" sheet: one quiet "Hej då" button for the groups.
    stopSheet: function (body) {
      if (!on() || !P || !(P.groups || []).length || (P.me && P.me.bye_at)) return;
      body.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [A.btn(L("👋 Säg hej då till truppen", "👋 Say bye to the squad"), "btn-block", function () { A.closeSheet(); bye(true); })]));
    }
  };
})();
