/* Öl Nu — 🚫 owner panel "Stängda ställen" for docs/stats.html (CONTRACT "🚫 STÄNGT FÖR GOTT", migrations 0147–0148).
   Same owner key as the other panels (sessionStorage olnu.ownerKey); refreshes when #main shows and every 60 s.
   Dolda / Väntar (1 rapport) / Bekräftade / Ångrade / Alla. Dolda: ✅ Bekräfta / ↩️ Ångra (shows the place again; only
   newer reports count after that). Väntar: 🚫 Dölj nu. Ångrade: 🚫 Dölj igen. owner_bars_gone / owner_set_bar_gone.
   The owner's trusted phone (✏️ Krogytor → "📱 Den här mobilen är min") hides a place with ONE report. Missing RPC → hidden. */
(function () {
  "use strict";
  var cfg = window.OLNU_CONFIG || {}, sb = null, status = "hidden";
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
  var TYPE = { bar: "bar", pub: "pub", nightclub: "nattklubb", biergarten: "ölträdgård", restaurant: "restaurang", cafe: "kafé", fast_food: "gatukök", arena: "arena" };
  var WHY = { crowd: "2 användare", trusted: "din mobil", owner: "du" };
  function panel() {
    var p = $("pGone"); if (p) return p;
    p = el("section", "panel"); p.id = "pGone"; p.hidden = true;
    var h = el("h2", null, "🚫 Stängda ställen "); var c = el("span"); c.id = "xGoneCount"; h.appendChild(c); p.appendChild(h);
    var box = el("div"); box.id = "xGone"; p.appendChild(box);
    p.appendChild(el("p", "note", "Användare trycker ”🚫 Finns inte längre” i krogens ℹ️ Info. 2 olika användare – eller 1 rapport från din betrodda mobil – döljer stället för alla. " +
      "Bekräfta = stängt för gott. Ångra = syns igen (bara nyare rapporter räknas sen). docs/bars-closed.json gäller fortfarande; ingen rad tas bort."));
    var anchor = $("pClub") || $("pArea") || $("pRep") || $("pPl");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(p, anchor.nextSibling); else if ($("main")) $("main").appendChild(p);
    return p;
  }
  function draw(d) {
    var p = panel(), box = $("xGone"); box.textContent = "";
    var c = d.counts || {};
    $("xGoneCount").textContent = "· " + (c.hidden || 0) + " dolda, " + (c.pending || 0) + " väntar, " + (c.confirmed || 0) + " bekräftade";
    var f = el("div", "wf");
    [["hidden", "Dolda"], ["pending", "Väntar (1 rapport)"], ["confirmed", "Bekräftade"], ["undone", "Ångrade"], ["all", "Alla"]].forEach(function (s) {
      var b = el("button", "btn ghost" + (s[0] === status ? " on" : ""), s[1]); b.type = "button";
      b.addEventListener("click", function () { status = s[0]; load(); });
      f.appendChild(b);
    });
    box.appendChild(f);
    var list = el("ol", "wl");
    (d.rows || []).forEach(function (a) {
      var li = el("li"); li.setAttribute("data-gone", a.bar_id);
      li.appendChild(el("div", "x-ev-h", (a.name || "(namnlös)") + " · " + (TYPE[a.type] || a.type || "ställe") + " · " + a.bar_id));
      li.appendChild(el("div", "x-sub", ({ hidden: "dold", confirmed: "bekräftad", undone: "ångrad", pending: "väntar" })[a.status] + (a.reason ? " av " + (WHY[a.reason] || a.reason) : "") +
        " · " + (a.reports || 0) + " rapport" + (a.reports === 1 ? "" : "er") + " · " + new Date(a.at).toLocaleString("sv-SE")));
      var row = el("div", "x-acts");
      var o = el("a", "btn ghost", "🗺️ OSM"); o.href = "https://www.openstreetmap.org/?mlat=" + a.lat + "&mlon=" + a.lng + "#map=19/" + a.lat + "/" + a.lng; o.target = "_blank"; o.rel = "noopener"; row.appendChild(o);
      var acts = a.status === "hidden" ? [["confirmed", "✅ Bekräfta"], ["undone", "↩️ Ångra"]] : a.status === "confirmed" ? [["undone", "↩️ Ångra"]] :
        a.status === "pending" ? [["hidden", "🚫 Dölj nu"]] : [["hidden", "🚫 Dölj igen"]];
      acts.forEach(function (x) {
        var b = el("button", "btn ghost", x[1]); b.type = "button"; b.setAttribute("data-set", x[0]);
        b.addEventListener("click", function () { b.disabled = true; call("owner_set_bar_gone", { p_key: key(), p_bar_id: a.bar_id, p_status: x[0] }).then(function () { load(); }); });
        row.appendChild(b);
      });
      li.appendChild(row); list.appendChild(li);
    });
    if (!(d.rows || []).length) box.appendChild(el("p", "note", "Inga ställen här."));
    box.appendChild(list);
    p.hidden = false;
  }
  function load() { if (!key()) return; call("owner_bars_gone", { p_key: key(), p_status: status }).then(function (r) { if (r && r.d) draw(r.d); }); }
  function refresh() { if (!key() || !$("main") || $("main").hidden) return; load(); }
  function start() {
    var main = $("main"); if (!main) return;
    var was = main.hidden;
    new MutationObserver(function () { if (was && !main.hidden) refresh(); was = main.hidden; }).observe(main, { attributes: true, attributeFilter: ["hidden"] });
    if (!main.hidden) refresh();
    setInterval(function () { if (document.visibilityState === "visible") refresh(); }, 60000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.OLNU_STATS_GONE = { refresh: refresh };
})();
