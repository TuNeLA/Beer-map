/* PintsNow — 📊 owner panels for docs/stats.html: "Användning" (owner_pnlog) and "Auto-incheckning: kvalitet" (owner_pnlog_loc).
   Migration 0330, client docs/js/pnlog.js. Same owner key as the other panels (sessionStorage olnu.ownerKey).
   Quality view: confusion table (what auto check-in did vs. what the user did), per bar, a threshold simulator that replays
   the logged readings with other numbers, a map (SVG, no tiles) of the places where they disagreed, CSV export. */
(function () {
  "use strict";
  var cfg = window.OLNU_CONFIG || {}, sb = null, days = 7, U = null, LOC = null, BARS = null;
  var $ = function (id) { return document.getElementById(id); };
  function key() { try { return sessionStorage.getItem("olnu.ownerKey") || ""; } catch (e) { return ""; } }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function client() {
    if (!cfg.SUPABASE_URL || !window.supabase) return null;
    return sb || (sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }));
  }
  function call(name, params) {
    var c = client(); if (!c) return Promise.resolve(null);
    return c.rpc(name, params).then(function (r) { return r.error || !r.data || r.data.message === "forbidden" ? null : r.data; }, function () { return null; });
  }
  function css() {
    if ($("pnl-css")) return;
    var s = el("style"); s.id = "pnl-css";
    s.textContent = ".pnl table{width:100%;border-collapse:collapse;font:12px var(--hud);margin:4px 0 10px}" +
      ".pnl th{color:var(--muted);font-weight:400;text-align:left;border-bottom:1px solid var(--line-soft);padding:4px 6px 4px 0}" +
      ".pnl td{padding:4px 6px 4px 0;border-bottom:1px solid var(--line-soft);font-variant-numeric:tabular-nums;word-break:break-word}" +
      ".pnl h3{font:600 13px var(--body);color:var(--text);margin:14px 0 4px}" +
      ".pnl .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}" +
      ".pnl .chips button{font:12px var(--hud);color:var(--muted);background:transparent;border:1px solid var(--line-soft);border-radius:14px;padding:5px 10px;cursor:pointer}" +
      ".pnl .chips button[aria-pressed=true]{color:var(--night);background:var(--amber);border-color:var(--amber)}" +
      ".pnl .kp{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:6px 0}" +
      ".pnl .kp div{border:1px solid var(--line-soft);border-radius:4px;padding:6px}.pnl .kp b{display:block;font:20px var(--hud);color:var(--foam)}" +
      ".pnl .kp span{font-size:11px;color:var(--muted)}" +
      ".pnl label.sl{display:grid;grid-template-columns:130px 1fr 44px;gap:8px;align-items:center;font-size:12px;color:var(--muted)}" +
      ".pnl input[type=range]{width:100%;accent-color:var(--amber)}" +
      ".pnl .bar{height:8px;background:var(--amber);border-radius:2px}" +
      ".pnl .good{color:var(--green)}.pnl .bad{color:var(--red)}" +
      ".pnl svg.dmap{width:100%;height:auto;background:var(--night);border:1px solid var(--line-soft);border-radius:4px}" +
      "@media (max-width:480px){.pnl .kp{grid-template-columns:1fr 1fr}.pnl label.sl{grid-template-columns:100px 1fr 40px}}";
    document.head.appendChild(s);
  }
  function table(head, rows) {
    var t = el("table"), tr = el("tr");
    head.forEach(function (h) { tr.appendChild(el("th", null, h)); }); t.appendChild(tr);
    rows.forEach(function (r) { var x = el("tr"); r.forEach(function (c) { var td = el("td"); if (c && c.nodeType) td.appendChild(c); else td.textContent = c == null ? "–" : String(c); x.appendChild(td); }); t.appendChild(x); });
    if (!rows.length) { var e = el("tr"), td = el("td", null, "Inga data än."); td.colSpan = head.length; e.appendChild(td); t.appendChild(e); }
    return t;
  }
  function pct(a, b) { return b ? Math.round(100 * a / b) + " %" : "–"; }
  function kp(box, items) { var g = el("div", "kp"); items.forEach(function (x) { var d = el("div"); d.appendChild(el("b", null, x[1] == null ? "–" : String(x[1]))); d.appendChild(el("span", null, x[0])); g.appendChild(d); }); box.appendChild(g); }
  function csv(name, head, rows) {
    var q = function (v) { v = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var s = "﻿" + [head].concat(rows).map(function (r) { return r.map(q).join(","); }).join("\n");
    var a = el("a"); a.href = URL.createObjectURL(new Blob([s], { type: "text/csv;charset=utf-8" })); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function panel(id, title, note) {
    var p = $(id); if (p) return p;
    p = el("section", "panel pnl"); p.id = id; p.hidden = true;
    var h = el("h2", null, title + " "); var c = el("span"); c.id = id + "N"; h.appendChild(c); p.appendChild(h);
    var box = el("div"); box.id = id + "B"; p.appendChild(box);
    if (note) p.appendChild(el("p", "note", note));
    var anchor = $("pVit") || $("pGone") || $("pClub") || $("pArea");
    var after = $("pPnU") && id !== "pPnU" ? $("pPnU") : anchor;
    if (after && after.parentNode) after.parentNode.insertBefore(p, after.nextSibling); else if ($("main")) $("main").appendChild(p);
    return p;
  }
  function chips(box, cur, set) {
    var r = el("div", "row chips");
    [1, 7, 30].forEach(function (d) { var b = el("button", null, d === 1 ? "I natt" : d + " dar"); b.type = "button"; b.setAttribute("aria-pressed", String(d === cur)); b.onclick = function () { set(d); }; r.appendChild(b); });
    box.appendChild(r);
  }

  /* ---------- 📊 Användning ---------- */
  var MODE_L = { on: "PÅ för alla (beta)", optin: "bara de som sagt ja (butik)", off: "bara felrapporter", none: "av helt" };
  function drawUsage(a) {
    var p = panel("pPnU", "📊 Användning", "Från appen (pnlog.js). Tryck = knappens id i koden, aldrig text. Skärm = menyns titel (bara kända titlar; okända visas som ikon + …). " +
      "Rådata töms efter 30 dagar; dagssummor finns kvar. Byt läge: update public.pn_log_flags set value = 'optin' where key = 'beta_logging';");
    var box = $("pPnUB"); box.textContent = ""; p.hidden = false;
    $("pPnUN").textContent = "· läge: " + (MODE_L[a.mode] || a.mode) + " · " + a.days + " dar";
    chips(box, days, function (d) { days = d; load(); });
    var last = (a.dau || []).slice(-1)[0] || {};
    kp(box, [["Pers senaste natt", last.users], ["Pers 7 dar", a.wau], ["Pers 30 dar", a.mau], ["Händelser", a.events]]);
    kp(box, [["Sessioner", (a.dau || []).reduce(function (s, x) { return s + (x.sessions | 0); }, 0)], ["Session p50 s", a.sess_sec && a.sess_sec.p50 != null ? Math.round(a.sess_sec.p50) : null],
      ["Paket", a.batches], ["KB", Math.round((a.bytes || 0) / 1024)]]);
    box.appendChild(el("h3", null, "Per natt"));
    box.appendChild(table(["Natt", "Pers", "Sessioner", "Händelser", "KB"], (a.dau || []).map(function (x) { return [x.day, x.users, x.sessions, x.events, Math.round((x.bytes || 0) / 1024)]; })));
    var fb = a.funnel_beer || {}, fj = a.funnel_join || {};
    box.appendChild(el("h3", null, "Trattar (sessioner)"));
    box.appendChild(table(["Steg", "Antal", "Andel"], [
      ["Öppnade appen", fb.open, "100 %"], ["Tryckte ÖL!", fb.tap, pct(fb.tap, fb.open)], ["Ölen sparad", fb.post, pct(fb.post, fb.open)],
      ["Tryckte bjud in / dela", fj.invite, "–"], ["Öppnade en inbjudan", fj.preview, "100 %"], ["Gick med", fj.join, pct(fj.join, fj.preview)]]));
    box.appendChild(el("h3", null, "Mest öppnade menyer"));
    box.appendChild(table(["Meny", "Gånger", "Pers", "Öppnas ms (p50)"], (a.screens || []).map(function (x) { return [x.s, x.n, x.users, x.ms50]; })));
    box.appendChild(el("h3", null, "Mest tryckta knappar"));
    box.appendChild(table(["Var", "Knapp", "Tryck", "Pers"], (a.taps || []).slice(0, 40).map(function (x) { return [x.s, x.k, x.n, x.users]; })));
    box.appendChild(el("h3", null, "Funktioner (serveranrop)"));
    box.appendChild(table(["Funktion", "Gånger", "Pers", "Misslyckade"], (a.features || []).map(function (x) { return [x.fn, x.n, x.users, x.fails]; })));
    box.appendChild(el("h3", null, "Fel"));
    box.appendChild(table(["Typ", "Fel", "Var", "Antal", "Pers", "Version"], (a.errors || []).map(function (x) { return [x.n.replace("err.", ""), x.m, x.f, x.cnt, x.users, x.ver]; })));
    box.appendChild(el("h3", null, "Hastighet (ms, CLS utan enhet)"));
    var PL = { "perf.boot": "Start (DOM klar)", "perf.load": "Laddad", "perf.fcp": "Första bild", "perf.lcp": "Största bild", "perf.map": "Kartan syns", "perf.sheet": "Meny öppnas", "perf.cls": "Layout-hopp (CLS)", "perf.long": "Häng per session", "perf.rpc": "Serveranrop p95", "perf.self": "Loggningens egen tid" };
    box.appendChild(table(["Mått", "p50", "p95", "Antal"], (a.perf || []).map(function (x) { var r = function (v) { return v == null ? "–" : x.m === "perf.cls" ? (+v).toFixed(3) : Math.round(v); }; return [PL[x.m] || x.m, r(x.p50), r(x.p95), x.cnt]; })));
    box.appendChild(el("h3", null, "Versioner"));
    box.appendChild(table(["Version", "Kanal", "Pers", "Paket"], (a.versions || []).map(function (x) { return [x.ver, x.ch, x.users, x.batches]; })));
    var ex = el("button", "btn ghost", "Exportera CSV (översikt)"); ex.type = "button";
    ex.onclick = function () {
      var rows = [];
      (a.dau || []).forEach(function (x) { rows.push(["natt", x.day, "", x.users, x.sessions, x.events]); });
      (a.screens || []).forEach(function (x) { rows.push(["meny", x.s, "", x.n, x.users, x.ms50]); });
      (a.taps || []).forEach(function (x) { rows.push(["tryck", x.s, x.k, x.n, x.users, ""]); });
      (a.features || []).forEach(function (x) { rows.push(["funktion", x.fn, "", x.n, x.users, x.fails]); });
      (a.errors || []).forEach(function (x) { rows.push(["fel", x.m, x.f, x.cnt, x.users, x.ver]); });
      (a.perf || []).forEach(function (x) { rows.push(["perf", x.m, "", x.cnt, x.p50, x.p95]); });
      csv("pintsnow-anvandning-" + new Date().toISOString().slice(0, 10) + ".csv", ["typ", "namn", "detalj", "antal", "pers/p50", "extra"], rows);
    };
    box.appendChild(ex);
  }

  /* ---------- 📍 Auto-incheckning: kvalitet ---------- */
  var MIN = 60e3;
  function byUser(rows) { var m = {}; rows.forEach(function (r) { (m[r.u] = m[r.u] || []).push(r); }); Object.keys(m).forEach(function (u) { m[u].sort(function (a, b) { return a.at - b.at; }); }); return m; }
  function nextCi(list, i, ms) { var t = list[i].at; for (var j = i + 1; j < list.length && list[j].at - t <= ms; j++) if (list[j].k === "ci") return list[j]; return null; }
  function posNear(list, i) {   // the closest reading with coordinates (±3 min)
    var best = null, bd = 3 * MIN;
    for (var j = Math.max(0, i - 30); j < Math.min(list.length, i + 30); j++) { var r = list[j]; if (r.la != null && Math.abs(r.at - list[i].at) <= bd) { bd = Math.abs(r.at - list[i].at); best = r; } }
    return best;
  }
  function analyse(rows) {
    var users = byUser(rows), C = {}, perBar = {}, bad = [], ciN = 0, ciCaught = 0, ciWithData = 0;
    var add = function (dec, out) { (C[dec] = C[dec] || {})[out] = (C[dec][out] || 0) + 1; };
    var barAdd = function (b, good) { if (!b) return; var x = perBar[b] = perBar[b] || { n: 0, ok: 0 }; x.n++; if (good) x.ok++; };
    Object.keys(users).forEach(function (u) {
      var L = users[u];
      L.forEach(function (r, i) {
        var d = r.d || {}, later = function (ms, f) { for (var j = i + 1; j < L.length && L[j].at - r.at <= ms; j++) if (f(L[j])) return L[j]; return null; };
        if (r.k === "auto_in") {
          var undo = later(10 * MIN, function (x) { return x.k === "answer" && x.d && x.d.why === "undo"; });
          var other = later(15 * MIN, function (x) { return x.k === "ci" && x.b && x.b !== r.b; });
          var out = undo ? "ångrade" : other ? "bytte krog" : "behöll";
          add("Auto-incheckning", out); barAdd(r.b, out === "behöll");
          if (out !== "behöll") bad.push({ r: r, p: posNear(L, i), why: "Auto → " + out });
        } else if (r.k === "ask") {
          var act = d.act, ans = later(25 * MIN, function (x) { return x.k === "answer" && x.d && (x.d.ans === "accepted" || x.d.ans === "ignored"); });
          var ci = later(25 * MIN, function (x) { return x.k === "ci"; });
          var name = act === "choose" ? "Fråga: A eller B" : act === "switch" ? "Fråga: bytt krog?" : "Fråga: är du på X?";
          var out2 = ans && ans.d.ans === "accepted" ? "ja" : ci && (ci.b === r.b || ci.b === d.b2) ? "ja (själv)" : ci ? "annan krog" : ans ? "ignorerade" : "inget svar";
          add(name, out2); barAdd(r.b, /^ja/.test(out2));
          if (out2 === "annan krog") bad.push({ r: r, p: posNear(L, i), why: name + " → annan krog" });
        } else if (r.k === "auto_out") {
          var back = later(30 * MIN, function (x) { return x.k === "ci" && x.b === r.b; });
          var o3 = back ? "checkade in igen (fel)" : "rätt";
          add("Auto-utcheckning (" + (d.why || "?") + ")", o3); barAdd(r.b, !back);
          if (back) bad.push({ r: r, p: posNear(L, i), why: "Utcheckad men kom tillbaka" });
        } else if (r.k === "ci") {
          ciN++;
          var src = d.src || "hand";
          var had = false, caught = src !== "hand";
          for (var j = i - 1; j >= 0 && r.at - L[j].at <= 20 * MIN; j--) { if (L[j].k === "eval" || L[j].k === "fix") had = true; if ((L[j].k === "ask" || L[j].k === "auto_in") && L[j].b === r.b) caught = true; }
          if (had) { ciWithData++; if (caught) ciCaught++; else { add("Incheckning för hand", "missad av auto"); bad.push({ r: r, p: r.la != null ? r : posNear(L, i), why: "Missad: incheckad för hand" }); } }
          else add("Incheckning för hand", "ingen positionsdata före");
        }
      });
    });
    return { C: C, perBar: perBar, bad: bad, ciN: ciN, ciWithData: ciWithData, ciCaught: ciCaught };
  }
  // replay: the check-in rule of autoci.js with other numbers (in-mode evaluations only)
  function simulate(rows, P) {
    var users = byUser(rows), tp = 0, fp = 0, truthN = 0, caught = {};
    Object.keys(users).forEach(function (u) {
      var L = users[u], run = null;
      L.forEach(function (r, i) {
        if (r.k === "ci") { truthN++; run = null; return; }
        if (r.k !== "eval" || !r.d || r.d.m !== "in") return;
        var s = r.d.s || [], acc = r.d.a == null ? 99 : r.d.a, s1 = s[0], s2 = s[1];
        if (acc > P.acc) return;
        var clear = s1 && s1.m <= P.at && (!s2 || s2.m - s1.m >= Math.max(2 * acc, P.gap));
        var reach = s.filter(function (x) { return x.m <= Math.min(55, P.at + acc); });
        if (!reach.length) { run = null; return; }
        if (!run || !reach.some(function (x) { return x.id === run.id; })) run = { id: (clear ? s1 : reach[0]).id, t0: r.at, n: 0, clear: true, done: false };
        run.n++; run.clear = run.clear && clear && s1.id === run.id;
        if (run.done || run.n < P.n || r.at - run.t0 < P.dwell * MIN) return;
        run.done = true;
        if (!run.clear) return;   // the real app asks instead of auto check-in
        var t = nextCi(L, i, 20 * MIN) || (function () { for (var j = i - 1; j >= 0 && r.at - L[j].at < 5 * MIN; j--) if (L[j].k === "ci") return L[j]; return null; })();
        if (t && t.b === run.id) { tp++; caught[u + ":" + t.at] = 1; } else fp++;
      });
    });
    return { tp: tp, fp: fp, truthN: truthN, prec: tp + fp ? tp / (tp + fp) : null, rec: truthN ? Object.keys(caught).length / truthN : null };
  }
  function dmap(box, bad) {
    var pts = bad.filter(function (x) { return x.p && x.p.la != null; });
    if (!pts.length) { box.appendChild(el("p", "note", "Inga oenigheter med position än.")); return; }
    var la = pts.map(function (x) { return x.p.la; }), ln = pts.map(function (x) { return x.p.ln; });
    var s = Math.min.apply(null, la), n = Math.max.apply(null, la), w = Math.min.apply(null, ln), e = Math.max.apply(null, ln);
    var pad = 0.0015; s -= pad; n += pad; w -= pad * 2; e += pad * 2;
    var k = Math.cos((s + n) / 2 * Math.PI / 180), W = 640, H = Math.max(240, Math.min(640, Math.round(W * (n - s) / ((e - w) * k))));
    var X = function (v) { return ((v - w) / (e - w) * W).toFixed(1); }, Y = function (v) { return ((n - v) / (n - s) * H).toFixed(1); };
    var NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("class", "dmap"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Karta: där auto-incheckning och användaren var oeniga");
    var mk = function (tag, at) { var x = document.createElementNS(NS, tag); Object.keys(at).forEach(function (k2) { x.setAttribute(k2, at[k2]); }); svg.appendChild(x); return x; };
    (BARS || []).forEach(function (b) { if (b.lat < s || b.lat > n || b.lng < w || b.lng > e) return; mk("rect", { x: X(b.lng) - 3, y: Y(b.lat) - 3, width: 6, height: 6, fill: "#9aa3a0", opacity: .7 }).appendChild(document.createElementNS(NS, "title")).textContent = b.name; });
    pts.forEach(function (x) {
      var c = mk("circle", { cx: X(x.p.ln), cy: Y(x.p.la), r: 5, fill: /Missad/.test(x.why) ? "#3ddc84" : /Utcheckad/.test(x.why) ? "#ffc24d" : "#ff3b3b", "fill-opacity": .8, stroke: "#0a0f1c" });
      c.appendChild(document.createElementNS(NS, "title")).textContent = x.why + " · " + new Date(x.r.at).toLocaleString("sv-SE") + (x.r.b ? " · " + x.r.b : "") + (x.p.a != null ? " · ±" + Math.round(x.p.a) + " m" : "");
    });
    box.appendChild(svg);
    box.appendChild(el("p", "note", "Röd = auto/fråga fel, gul = utcheckad fel, grön = missad (incheckad för hand). Grå ruta = krog. Håll över en prick för detaljer."));
  }
  function drawQuality(d) {
    var p = panel("pPnQ", "📍 Auto-incheckning: kvalitet", "Positionslogg (30 dagar). Facit = vad personen gjorde sen: ångra, svara, checka in för hand. Simulatorn spelar upp loggade avläsningar med andra gränser (samma regel som autoci.js, förenklad).");
    var box = $("pPnQB"); box.textContent = ""; p.hidden = false;
    var rows = d.rows || []; LOC = rows;
    $("pPnQN").textContent = "· " + rows.length + " rader, " + Object.keys(byUser(rows)).length + " pers";
    var a = analyse(rows);
    kp(box, [["Incheckningar", a.ciN], ["med positionsdata", a.ciWithData], ["fångade av auto", a.ciCaught], ["Träff (recall)", pct(a.ciCaught, a.ciWithData)]]);
    box.appendChild(el("h3", null, "Vad auto gjorde → vad personen gjorde"));
    var trs = [];
    Object.keys(a.C).sort().forEach(function (dec) { Object.keys(a.C[dec]).sort().forEach(function (o) { trs.push([dec, o, a.C[dec][o]]); }); });
    box.appendChild(table(["Beslut", "Utfall", "Antal"], trs));
    box.appendChild(el("h3", null, "Per krog"));
    box.appendChild(table(["Krog-id", "Beslut", "Rätt", "Andel"], Object.keys(a.perBar).sort(function (x, y) { return a.perBar[y].n - a.perBar[x].n; }).slice(0, 30).map(function (b) {
      var x = a.perBar[b], nm = (BARS || []).filter(function (z) { return String(z.id) === b; })[0];
      return [nm ? nm.name + " (" + b + ")" : b, x.n, x.ok, pct(x.ok, x.n)];
    })));
    box.appendChild(el("h3", null, "Simulator"));
    var P = { at: 30, acc: 25, gap: 15, n: 3, dwell: 5 };
    var out = el("div", "pnl-sim");
    var sl = function (lab, k, min, max, step) {
      var l = el("label", "sl"), i = el("input"), v = el("b", null, String(P[k]));
      i.type = "range"; i.min = min; i.max = max; i.step = step; i.value = P[k];
      i.oninput = function () { P[k] = +i.value; v.textContent = i.value; run(); };
      l.appendChild(el("span", null, lab)); l.appendChild(i); l.appendChild(v); box.appendChild(l);
    };
    sl("Max avstånd (m)", "at", 10, 60, 1); sl("Max osäkerhet (m)", "acc", 10, 60, 1); sl("Lucka till nr 2 (m)", "gap", 0, 40, 1);
    sl("Avläsningar", "n", 1, 6, 1); sl("Väntetid (min)", "dwell", 0, 15, 1);
    box.appendChild(out);
    function run() {
      var r = simulate(rows, P), base = simulate(rows, { at: 30, acc: 25, gap: 15, n: 3, dwell: 5 });
      out.textContent = "";
      kp(out, [["Rätt auto", r.tp], ["Fel auto", r.fp], ["Precision", r.prec == null ? "–" : Math.round(r.prec * 100) + " %"], ["Recall", r.rec == null ? "–" : Math.round(r.rec * 100) + " %"]]);
      out.appendChild(el("p", "note", "Nu i appen (30/25/15/3/5): rätt " + base.tp + ", fel " + base.fp + ", precision " + (base.prec == null ? "–" : Math.round(base.prec * 100) + " %") + ", recall " + (base.rec == null ? "–" : Math.round(base.rec * 100) + " %") + ". Bara tydliga fall räknas som auto (otydliga blir en fråga)."));
      var sweep = [15, 20, 25, 30, 40, 50].map(function (m) { var q = simulate(rows, { at: m, acc: P.acc, gap: P.gap, n: P.n, dwell: P.dwell }); return [m + " m", q.tp, q.fp, q.prec == null ? "–" : Math.round(q.prec * 100) + " %", q.rec == null ? "–" : Math.round(q.rec * 100) + " %"]; });
      out.appendChild(table(["Max avstånd", "Rätt", "Fel", "Precision", "Recall"], sweep));
    }
    run();
    box.appendChild(el("h3", null, "Var var de oeniga?"));
    dmap(box, a.bad);
    var ex = el("button", "btn ghost", "Exportera CSV (positionslogg)"); ex.type = "button";
    ex.onclick = function () {
      csv("pintsnow-positionslogg-" + new Date().toISOString().slice(0, 10) + ".csv", ["person", "tid", "typ", "lat", "lng", "osäkerhet_m", "krog", "incheckad", "detalj"],
        rows.map(function (r) { return [r.u, new Date(r.at).toISOString(), r.k, r.la, r.ln, r.a, r.b, r.ci, r.d]; }));
    };
    box.appendChild(ex);
  }

  function load() {
    if (!key()) return;
    css();
    if (!BARS) fetch("./bars.json").then(function (r) { return r.json(); }).then(function (b) { BARS = b; }, function () { BARS = []; });
    call("owner_pnlog", { p_key: key(), p_days: days }).then(function (a) { if (a) drawUsage(a); });
    call("owner_pnlog_loc", { p_key: key(), p_days: Math.max(days, 7) }).then(function (d) { if (d) drawQuality(d); });
  }
  function start() {
    var main = $("main"); if (!main) return;
    var was = main.hidden;
    new MutationObserver(function () { if (was && !main.hidden) load(); was = main.hidden; }).observe(main, { attributes: true, attributeFilter: ["hidden"] });
    if (!main.hidden) load();
    setInterval(function () { if (document.visibilityState === "visible" && !main.hidden) load(); }, 300000);
  }
  window.PNLOG_STATS = { _analyse: analyse, _simulate: simulate, load: load };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
