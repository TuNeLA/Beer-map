/* PintsNow — owner panel "Nyckeltal" for docs/stats.html (lane kpi, X9, migration 0460 owner_kpi).
   Per night (05:00 → 05:00) for the last 14 nights + the last 7 nights together: new users (anon / e-post), groups made,
   nights out, returning users D2 / D7 (cohort = sign-up night), beers per user per night (median, owner only),
   crashes per user (pnlog err.js / err.rej / crash.reload), push share, "Bjud in" invitations sent / yes.
   Counts only; the server sends 1 or 2 as "<3". Same owner key as the other panels. A wrong key or an old server
   (no owner_kpi before 0460) = the panel stays hidden. No emoji in this panel (ds12). */
(function () {
  "use strict";
  var cfg = window.OLNU_CONFIG || {}, sb = null, busy = false;
  var $ = function (id) { return document.getElementById(id); };
  var nf = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 });
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
  // v: number | "<3" | null
  function v(x, unit) {
    if (x === "<3") return "<3";
    if (x == null || x === "" || isNaN(Number(x))) return "–";
    return nf.format(Number(x)) + (unit || "");
  }
  // counts: 1 or 2 is "<3" here too (the server already sends "<3"; this guards an old or wrong answer)
  function c(x) { return typeof x === "number" && x > 0 && x < 3 ? "<3" : v(x); }
  function ret(n, pct) { var a = c(n); if (a === "–" || a === "<3") return a; var p = v(pct, " %"); return p === "–" ? a : a + " · " + p; }
  var WD = ["sön", "mån", "tis", "ons", "tor", "fre", "lör"];
  function dayName(s, today) {
    var p = String(s || "").split("-"); if (p.length !== 3) return String(s || "");
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return (s === today ? "ikväll " : WD[d.getUTCDay()] + " ") + (+p[2]) + "/" + (+p[1]);
  }
  function css() {
    if ($("kpiCss")) return;
    var st = document.createElement("style"); st.id = "kpiCss";
    st.textContent = ".kpi-week{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;margin-bottom:10px}" +
      "@media (min-width:560px){.kpi-week{grid-template-columns:repeat(4,1fr)}}" +
      ".kpi-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -4px;padding:0 4px}" +
      ".kpi-tbl{min-width:760px}.kpi-tbl th{white-space:nowrap}.kpi-tbl td{white-space:nowrap;font-family:var(--hud)}" +
      ".kpi-tbl tr.today td{color:var(--amber-2)}.kpi-tbl td.mask{color:var(--muted)}";
    document.head.appendChild(st);
  }
  function panel() {
    var p = $("pKpi"); if (p) return p;
    css();
    p = el("section", "panel"); p.id = "pKpi"; p.hidden = true;
    var h = el("h2", null, "Nyckeltal "); var c = el("span"); c.id = "xKpiN"; h.appendChild(c); p.appendChild(h);
    var box = el("div"); box.id = "xKpi"; p.appendChild(box);
    var main = $("main"), first = main && main.querySelector("section.panel");
    if (first && first.parentNode) first.parentNode.insertBefore(p, first); else if (main) main.appendChild(p);
    return p;
  }
  function stat(k, val, sub) {
    var s = el("div", "stat"); s.appendChild(el("span", "k", k)); s.appendChild(el("span", "v", val));
    if (sub) s.appendChild(el("span", "k", sub));
    return s;
  }
  var COLS = [
    ["Natt", null],
    ["Nya anon", function (r) { return c(r.su_anon); }],
    ["Nya e-post", function (r) { return c(r.su_email); }],
    ["Grupper", function (r) { return c(r.groups); }],
    ["Ute", function (r) { return c(r.out); }],
    ["Aktiva", function (r) { return c(r.act); }],
    ["Tillbaka D2", function (r) { return ret(r.d2, r.d2_pct); }],
    ["Tillbaka D7", function (r) { return ret(r.d7, r.d7_pct); }],
    ["Öl/pers (median)", function (r) { return v(r.beers_med); }],
    ["Krascher", function (r) { return c(r.crashes); }],
    ["Krasch/anv", function (r) { return v(r.cpu); }],
    ["Push", function (r) { return v(r.push, " %"); }],
    ["Inbjudna", function (r) { return c(r.inv_sent); }],
    ["Ja", function (r) { return c(r.inv_yes); }]
  ];
  function draw(d) {
    var p = panel(), box = $("xKpi"); box.textContent = ""; p.hidden = false;
    var rows = Array.isArray(d.rows) ? d.rows : [], w = d.week || {};
    $("xKpiN").textContent = "· " + rows.length + " nätter, 05–05";
    box.appendChild(el("h3", null, "Senaste 7 nätterna"));
    var g = el("div", "kpi-week");
    g.appendChild(stat("Nya användare", c(w.su_anon) + " anon · " + c(w.su_email) + " e-post"));
    g.appendChild(stat("Grupper skapade", c(w.groups)));
    g.appendChild(stat("Kvällar ute", c(w.out), c(w.people_out) + " olika personer"));
    g.appendChild(stat("Tillbaka D2", ret(w.d2, w.d2_pct), "av " + c(w.coh2) + " nya"));
    g.appendChild(stat("Tillbaka D7", ret(w.d7, w.d7_pct), "av " + c(w.coh7) + " nya"));
    g.appendChild(stat("Öl per person och natt", v(w.beers_med), "median, bara här"));
    g.appendChild(stat("Krascher per användare", v(w.cpu), c(w.crashes) + " krascher"));
    g.appendChild(stat("Push på", v(w.push, " %"), "av " + c(w.act) + " aktiva"));
    g.appendChild(stat("Inbjudningar", c(w.inv_sent), c(w.inv_yes) + " svarade ja"));
    box.appendChild(g);
    box.appendChild(el("h3", null, "Per natt"));
    var wrap = el("div", "kpi-scroll"), t = el("table", "kpi-tbl"), tr = el("tr");
    COLS.forEach(function (c) { tr.appendChild(el("th", null, c[0])); }); t.appendChild(tr);
    rows.forEach(function (r) {
      var x = el("tr"); if (r.day === d.today) x.className = "today";
      COLS.forEach(function (c) {
        var txt = c[1] ? c[1](r) : dayName(r.day, d.today), td = el("td", null, txt);
        if (txt === "<3") td.className = "mask";
        x.appendChild(td);
      });
      t.appendChild(x);
    });
    wrap.appendChild(t); box.appendChild(wrap);
    var notes = ["Natt = 05:00 till 05:00 svensk tid. Ikväll är inte klar än. Testanvändare räknas inte.",
      "Bara antal. 1 eller 2 visas som <3. Inga namn, inga platser, inga användar-id.",
      "Ute = minst en öl, annan dryck eller incheckning. Aktiva = appen öppen (logg) eller en dryck den natten.",
      "Tillbaka D2 / D7 = av de som började den natten: aktiva natten efter / samma natt veckan efter. – = inte känt än. " +
        "7 nätter: D2 för de 7 senaste kvällarna som har svar, D7 för nätterna 7–13 dagar bakåt.",
      "Krascher = err.js, err.rej och crash.reload i loggen, per användare med logg den natten. Push = andel av de aktiva som har push på nu.",
      "Inbjudna = personer inbjudna med Bjud in (inte den som bjöd). Öl per person visas aldrig för användarna."];
    if (d.log_mode && d.log_mode !== "on") notes.unshift("Loggen står på \"" + d.log_mode + "\": aktiva, tillbaka och krascher blir för låga.");
    notes.forEach(function (n) { box.appendChild(el("p", "note", n)); });
  }
  function load() {
    if (!key() || busy) return;
    busy = true;
    call("owner_kpi", { p_key: key(), p_days: 14 }).then(function (d) {
      busy = false;
      if (d && Array.isArray(d.rows)) draw(d);
      else { var p = $("pKpi"); if (p) p.hidden = true; }
    });
  }
  function start() {
    var main = $("main"); if (!main) return;
    var was = main.hidden;
    new MutationObserver(function () { if (was && !main.hidden) load(); was = main.hidden; }).observe(main, { attributes: true, attributeFilter: ["hidden"] });
    if (!main.hidden) load();
    setInterval(function () { if (document.visibilityState === "visible" && !main.hidden) load(); }, 300000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
