/* Öl Nu — 📈 owner panel "Hastighet" for docs/stats.html (migration 0161, docs/js/vitals.js).
   owner_vitals: per phone model (fps, load time, errors), per hour, top errors. owner_vitals_slow: what was going on
   during slow moments (ctx), slowest RPCs and slowest sheets. Same owner key as the other panels. */
(function () {
  "use strict";
  var cfg = window.OLNU_CONFIG || {}, sb = null, days = 7;
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
  var CTX = { boot: "appstart", zoom: "zoom på kartan", pan: "flytta kartan", idle: "kartan stilla" };
  function ctxName(k) { return CTX[k] || (k.indexOf("sheet:") === 0 ? "meny: " + k.slice(6) : k); }
  function table(head, rows) {
    var t = el("table", "tbl"), tr = el("tr");
    head.forEach(function (h) { tr.appendChild(el("th", null, h)); }); t.appendChild(tr);
    rows.forEach(function (r) { var x = el("tr"); r.forEach(function (c) { x.appendChild(el("td", null, c == null ? "–" : String(c))); }); t.appendChild(x); });
    return t;
  }
  function panel() {
    var p = $("pVit"); if (p) return p;
    p = el("section", "panel"); p.id = "pVit"; p.hidden = true;
    var h = el("h2", null, "📈 Hastighet (telefonerna) "); var c = el("span"); c.id = "xVitN"; h.appendChild(c); p.appendChild(h);
    var box = el("div"); box.id = "xVit"; p.appendChild(box);
    p.appendChild(el("p", "note", "Anonym mätning från appen, max 1 rapport per telefon var 3:e timme. fps = bilder per sekund (60 = flytande, under 25 = hackigt). " +
      "”Segt när” = hur många ms appen hängde, uppdelat på vad som hände då."));
    var anchor = $("pGone") || $("pClub") || $("pArea");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(p, anchor.nextSibling); else if ($("main")) $("main").appendChild(p);
    return p;
  }
  function draw(a, s) {
    var p = panel(), box = $("xVit"); box.textContent = ""; p.hidden = false;
    $("xVitN").textContent = "· " + (a.total || 0) + " rapporter, " + days + " dar";
    box.appendChild(el("h3", null, "Per telefon"));
    box.appendChild(table(["Telefon", "Rapporter", "Pers", "fps (median)", "fps (sämst)", "Laddtid ms", "Fel", "Häng ms"],
      (a.by_model || []).map(function (x) { return [x.model, x.n, x.users, x.fps_med, x.fps_min, x.load_ms, x.errors, x.long_ms]; })));
    box.appendChild(el("h3", null, "Segt när…"));
    box.appendChild(table(["Vad hände", "Häng ms totalt", "Rapporter"], ((s && s.ctx) || []).map(function (x) { return [ctxName(x.ctx), x.ms, x.n]; })));
    box.appendChild(el("h3", null, "Långsammaste serveranrop (p90 ms)"));
    box.appendChild(table(["Anrop", "ms", "Rapporter"], ((s && s.rpc) || []).map(function (x) { return [x.fn, x.p90, x.n]; })));
    box.appendChild(el("h3", null, "Menyer: tryck → öppen (median ms)"));
    box.appendChild(table(["Meny", "ms", "Rapporter"], ((s && s.sheets) || []).map(function (x) { return [x.sheet, x.p50, x.n]; })));
    box.appendChild(el("h3", null, "Per timme"));
    box.appendChild(table(["Kl", "Rapporter", "fps", "Fel"], (a.by_hour || []).map(function (x) { return [x.h + ":00", x.n, x.fps_med, x.errors]; })));
    if ((a.errors || []).length) {
      box.appendChild(el("h3", null, "Vanligaste felen"));
      box.appendChild(table(["Fel", "Antal", "Version"], a.errors.map(function (x) { return [x.err_first, x.n, x.ver]; })));
    }
  }
  function load() {
    if (!key()) return;
    Promise.all([call("owner_vitals", { p_key: key(), p_days: days }), call("owner_vitals_slow", { p_key: key(), p_days: days })])
      .then(function (r) { if (r[0]) draw(r[0], r[1]); });
  }
  function start() {
    var main = $("main"); if (!main) return;
    var was = main.hidden;
    new MutationObserver(function () { if (was && !main.hidden) load(); was = main.hidden; }).observe(main, { attributes: true, attributeFilter: ["hidden"] });
    if (!main.hidden) load();
    setInterval(function () { if (document.visibilityState === "visible" && !main.hidden) load(); }, 120000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
