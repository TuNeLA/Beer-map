/* Öl Nu — 🚪 owner panel "Entré-info att granska" for docs/stats.html (CONTRACT "⏰ ÖPPETTIDER · 🍾 SYSTEMET · 💰 PRIS · 🚪 ENTRÉ · 🌭 NATTMAT",
   migration 0121). Same owner key as the other panels (sessionStorage olnu.ownerKey); refreshes when #main shows and every 60 s.
   Väntar / Godkända / Avvisade / Alla → ✅ Godkänn / 🙈 Avvisa / ⏳ Väntar (owner_set_club_info). Approving replaces the bar's
   earlier approved info. The owner's trusted phone (✏️ Krogytor → "📱 Den här mobilen är min") is approved at once. Missing RPC → hidden. */
(function () {
  "use strict";
  var cfg = window.OLNU_CONFIG || {}, sb = null, status = "pending";
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
  function panel() {
    var p = $("pClub"); if (p) return p;
    p = el("section", "panel"); p.id = "pClub"; p.hidden = true;
    var h = el("h2", null, "🚪 Entré-info "); var c = el("span"); c.id = "xClubCount"; h.appendChild(c); p.appendChild(h);
    var box = el("div"); box.id = "xClub"; p.appendChild(box);
    p.appendChild(el("p", "note", "Användare föreslår åldersgräns, entré och klädkod för klubbar (krogens ℹ️ Info → ✏️ Föreslå entré-info). Godkänd info syns för alla. Avvisa = dold (ingen rad tas bort)."));
    var anchor = $("pArea") || $("pRep") || $("pPl");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(p, anchor.nextSibling); else if ($("main")) $("main").appendChild(p);
    return p;
  }
  function infoText(x) {
    if (!x) return "–";
    var b = [];
    if (x.age) b.push("Ålder " + x.age);
    if (x.fee != null) b.push(x.fee ? "Entré " + x.fee + " kr" : "Fri entré");
    if (x.dress) b.push("Klädkod: " + x.dress);
    return b.join(" · ") || "–";
  }
  function draw(d) {
    var p = panel(), box = $("xClub"); box.textContent = "";
    var c = d.counts || {};
    $("xClubCount").textContent = "· " + (c.pending || 0) + " väntar, " + (c.ok || 0) + " godkända";
    var f = el("div", "wf");
    [["pending", "Väntar"], ["ok", "Godkända"], ["rejected", "Avvisade"], ["all", "Alla"]].forEach(function (s) {
      var b = el("button", "btn ghost" + (s[0] === status ? " on" : ""), s[1]); b.type = "button";
      b.addEventListener("click", function () { status = s[0]; load(); });
      f.appendChild(b);
    });
    box.appendChild(f);
    var list = el("ol", "wl");
    (d.rows || []).forEach(function (a) {
      var li = el("li"); li.setAttribute("data-club", a.id);
      li.appendChild(el("div", "x-ev-h", (a.bar_name || a.bar_id) + (a.bar_type ? " (" + a.bar_type + ")" : "") + " · " + infoText(a)));
      li.appendChild(el("div", "x-sub", new Date(a.created_at).toLocaleString("sv-SE") + " · " + a.status + (a.auto ? " (direkt, ägaren)" : "") +
        (a.superseded ? " · ersatt" : "") + " · nu: " + infoText(a.current) + " · förslagsställaren: " + (a.by_n || 1) + " förslag"));
      var row = el("div", "x-acts");
      var o = el("a", "btn ghost", "🗺️ OSM"); o.href = "https://www.openstreetmap.org/?mlat=" + a.bar_lat + "&mlon=" + a.bar_lng + "#map=18/" + a.bar_lat + "/" + a.bar_lng; o.target = "_blank"; o.rel = "noopener"; row.appendChild(o);
      [["ok", "✅ Godkänn"], ["rejected", "🙈 Avvisa"], ["pending", "⏳ Väntar"]].forEach(function (x) {
        if (x[0] === a.status && !a.superseded) return;
        var b = el("button", "btn ghost", x[1]); b.type = "button"; b.setAttribute("data-set", x[0]);
        b.addEventListener("click", function () { b.disabled = true; call("owner_set_club_info", { p_key: key(), p_id: a.id, p_status: x[0] }).then(function () { load(); }); });
        row.appendChild(b);
      });
      li.appendChild(row); list.appendChild(li);
    });
    if (!(d.rows || []).length) box.appendChild(el("p", "note", "Inga förslag här."));
    box.appendChild(list);
    p.hidden = false;
  }
  function load() { if (!key()) return; call("owner_club_info", { p_key: key(), p_status: status }).then(function (r) { if (r && r.d) draw(r.d); }); }
  function refresh() { if (!key() || !$("main") || $("main").hidden) return; load(); }
  function start() {
    var main = $("main"); if (!main) return;
    var was = main.hidden;
    new MutationObserver(function () { if (was && !main.hidden) refresh(); was = main.hidden; }).observe(main, { attributes: true, attributeFilter: ["hidden"] });
    if (!main.hidden) refresh();
    setInterval(function () { if (document.visibilityState === "visible") refresh(); }, 60000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.OLNU_STATS_CLUB = { refresh: refresh };
})();
