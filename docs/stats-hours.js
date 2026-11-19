/* PintsNow — owner panel "Öppettider från gästerna" for docs/stats.html (lane places, E4, SQL 0531).
   Same owner key as the other panels (sessionStorage olnu.ownerKey); refreshes when #main shows and every 60 s.
   - Rättelser (last 30 days): per bar the answers Ja / Nej / Rätta (counts only, never who), the most sent fix week and how
     many sent it, and what we show now. [Godkänn] = owner_set_bar_hours(key, bar, that week) → shown for everybody
     (src owner, beats the crowd for 12 months). [Ta bort rättelsen] = back to OpenStreetMap (clear; nothing is removed).
   - Kanske stängt (owner_place_signals, 8 weeks): no check-in for 8 weeks (the bar had some before), an open "Finns inte
     längre" report, 2+ "Nej" on the hours. 2 signals = likely closed: decide in the "Stängda ställen" panel (owner_set_bar_gone).
   A missing function (old server, no 0531) = the panel stays hidden. */
(function () {
  "use strict";
  var cfg = window.OLNU_CONFIG || {}, sb = null;
  var DAYS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
  var $ = function (id) { return document.getElementById(id); };
  function key() { try { return sessionStorage.getItem("olnu.ownerKey") || ""; } catch (e) { return ""; } }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function client() {
    if (!cfg.SUPABASE_URL || !window.supabase) return null;
    return sb || (sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }));
  }
  function call(name, params) {
    var c = client(); if (!c) return Promise.resolve(null);
    return c.rpc(name, params).then(function (r) { return r.error || !r.data || r.data.message === "forbidden" ? null : { d: r.data }; }, function () { return null; });
  }
  function hm(m) { m = ((+m % 1440) + 1440) % 1440; return ("0" + Math.floor(m / 60)).slice(-2) + ":" + ("0" + (m % 60)).slice(-2); }
  function weekTxt(w) {
    if (!Array.isArray(w)) return "–";
    return w.map(function (d, i) {
      if (!d) return DAYS[i] + " stängt";
      return DAYS[i] + " " + String(d).split(",").map(function (p) { var x = p.split("-"); return hm(x[0]) + "–" + hm(x[1]); }).join(", ");
    }).join(" · ");
  }
  function panel() {
    var p = $("pHours"); if (p) return p;
    p = el("section", "panel"); p.id = "pHours"; p.hidden = true;
    p.appendChild(el("h2", null, "Öppettider från gästerna"));
    var box = el("div"); box.id = "xHours"; p.appendChild(box);
    var sig = el("div"); sig.id = "xHoursSig"; p.appendChild(sig);
    p.appendChild(el("p", "note", "Gäster svarar ”Stämmer öppettiderna?” på krogens kort. När 2 olika gäster skickar samma tider visas de för alla. " +
      "Godkänn = du sätter tiderna (gäller före gästerna i 12 månader). Ta bort = tillbaka till OpenStreetMap. Inga namn visas."));
    var anchor = $("pGone") || $("pClub") || $("pArea");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(p, anchor.nextSibling); else if ($("main")) $("main").appendChild(p);
    return p;
  }
  function btn(txt, fn) { var b = el("button", "btn ghost", txt); b.type = "button"; b.addEventListener("click", function () { b.disabled = true; fn().then(load); }); return b; }
  function draw(rows) {
    var p = panel(), box = $("xHours"); box.textContent = "";
    var list = el("ol", "wl");
    (rows || []).forEach(function (a) {
      var li = el("li"); li.setAttribute("data-hours", a.bar_id);
      li.appendChild(el("div", "x-ev-h", (a.name || "(namnlös)") + " · " + a.bar_id));
      li.appendChild(el("div", "x-sub", "Ja " + (a.yes || 0) + " · Nej " + (a.no || 0) + " · Rätta " + (a.fix || 0) + " · senast " + new Date(a.last).toLocaleString("sv-SE")));
      if (a.top && a.top.w) li.appendChild(el("div", "x-sub", "Mest skickat (" + a.top.n + " st): " + weekTxt(a.top.w)));
      if (a.fixed && !a.fixed.cleared) li.appendChild(el("div", "x-sub", "Visas nu (" + (a.fixed.src === "owner" ? "du" : "gästerna") + "): " + weekTxt(a.fixed.w)));
      var row = el("div", "x-acts");
      if (a.top && a.top.w) row.appendChild(btn("Godkänn", function () { return call("owner_set_bar_hours", { p_key: key(), p_bar_id: a.bar_id, p_week: a.top.w, p_clear: false }); }));
      if (a.fixed && !a.fixed.cleared) row.appendChild(btn("Ta bort rättelsen", function () { return call("owner_set_bar_hours", { p_key: key(), p_bar_id: a.bar_id, p_week: null, p_clear: true }); }));
      li.appendChild(row); list.appendChild(li);
    });
    if (!(rows || []).length) box.appendChild(el("p", "note", "Inga svar de senaste 30 dagarna."));
    box.appendChild(list);
    p.hidden = false;
  }
  function drawSig(rows) {
    var box = $("xHoursSig"); if (!box) return; box.textContent = "";
    box.appendChild(el("h3", null, "Kanske stängt (" + (rows || []).length + ")"));
    var list = el("ol", "wl");
    (rows || []).slice(0, 100).forEach(function (a) {
      var s = a.sig || {}, why = [];
      if (s.nock) why.push("ingen incheckning sedan " + new Date(s.last_checkin).toLocaleDateString("sv-SE"));
      if (s.gone) why.push(s.gone + " ”finns inte längre”");
      if (s.no >= 2) why.push(s.no + " ”Nej” på tiderna");
      var li = el("li"); li.appendChild(el("div", "x-ev-h", (a.name || "(namnlös)") + " · " + s.n + " signal" + (s.n === 1 ? "" : "er")));
      li.appendChild(el("div", "x-sub", why.join(" · ")));
      list.appendChild(li);
    });
    box.appendChild(list);
  }
  function load() {
    if (!key()) return Promise.resolve();
    return Promise.all([call("owner_hours_reports", { p_key: key(), p_days: 30 }), call("owner_place_signals", { p_key: key(), p_weeks: 8 })]).then(function (r) {
      if (r[0] && Array.isArray(r[0].d)) draw(r[0].d);
      if (r[0] && r[1] && Array.isArray(r[1].d)) drawSig(r[1].d);
    });
  }
  function refresh() { if (!key() || !$("main") || $("main").hidden) return; load(); }
  function start() {
    var main = $("main"); if (!main) return;
    var was = main.hidden;
    new MutationObserver(function () { if (was && !main.hidden) refresh(); was = main.hidden; }).observe(main, { attributes: true, attributeFilter: ["hidden"] });
    if (!main.hidden) refresh();
    setInterval(function () { if (document.visibilityState === "visible") refresh(); }, 60000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
