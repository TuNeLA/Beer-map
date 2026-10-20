/* Öl Nu v26 — owner extras for docs/stats.html (migrations 0065, 0066, 0068). Same owner key as owner_stats
   (sessionStorage olnu.ownerKey). Panels: 💾 Databas (DB size, storage per table, media, egress estimate, warnings at
   60 % / 80 % of the free plan: 500 MB DB, 5 GB egress), 📅 Event att godkänna, 🚩 Barrapporter.
   Runs when #main is visible; refreshes every 60 s while the page is visible. Missing RPC → that panel stays hidden. */
(function () {
  "use strict";
  var cfg = window.OLNU_CONFIG || {}, sb = null, timer = null;
  var $ = function (id) { return document.getElementById(id); };
  var nf = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 1 });
  var CSS = ".x-meter{margin:8px 0 12px}.x-mtop{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:13px}" +
    ".x-mtop span{font-family:var(--hud);color:var(--muted)}.x-bar{height:10px;background:var(--night-3);border:1px solid var(--line-soft);margin-top:4px}" +
    ".x-bar i{display:block;height:100%;background:var(--green)}.x-warn .x-bar i{background:var(--amber)}.x-bad .x-bar i{background:var(--red)}" +
    ".x-sub{font-size:12px;color:var(--muted);margin-top:3px;overflow-wrap:anywhere}.x-alert{padding:8px 10px;margin:0 0 8px;border:1px solid}" +
    ".x-alert.x-warn{border-color:var(--amber);color:var(--amber-2)}.x-alert.x-bad{border-color:var(--red);color:#ffb3b3}" +
    ".x-t{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0}.x-t th,.x-t td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--line-soft)}" +
    ".x-t td:not(:first-child),.x-t th:not(:first-child){text-align:right;font-family:var(--hud)}.x-ev-h{font-weight:600;overflow-wrap:anywhere}" +
    ".x-note{font-size:12px;font-style:italic;margin-top:2px}.x-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.x-acts .btn{min-height:36px}" +
    "#pDb .x-t{display:block;overflow-x:auto}";
  try { var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); } catch (e) {}
  function key() { try { return sessionStorage.getItem("olnu.ownerKey") || ""; } catch (e) { return ""; } }
  function client() {
    if (sb) return sb;
    if (!cfg.SUPABASE_URL || !window.supabase) return null;
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    return sb;
  }
  function mb(b) { b = +b || 0; return b >= 1073741824 ? nf.format(b / 1073741824) + " GB" : b >= 1048576 ? nf.format(b / 1048576) + " MB" : nf.format(b / 1024) + " kB"; }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function call(name, params) {
    var c = client(); if (!c) return Promise.resolve(null);
    return c.rpc(name, params).then(function (r) {
      var d = r.data;
      if (r.error || !d || d.message === "forbidden") return { missing: !!(r.error && /PGRST202|Could not find|does not exist/i.test(String(r.error.message || r.error.code || ""))), d: null };
      return { d: d };
    }, function () { return null; });
  }

  /* ---------- 💾 DB ---------- */
  function level(p) { return p >= 80 ? "bad" : p >= 60 ? "warn" : "ok"; }
  function meter(label, used, lim, pct, sub) {
    var w = el("div", "x-meter x-" + level(pct));
    var top = el("div", "x-mtop"); top.appendChild(el("b", null, label)); top.appendChild(el("span", null, mb(used) + " / " + mb(lim) + " · " + nf.format(pct) + " %"));
    var bar = el("div", "x-bar"), fillEl = el("i"); fillEl.style.width = Math.min(100, pct) + "%"; bar.appendChild(fillEl);
    w.appendChild(top); w.appendChild(bar); if (sub) w.appendChild(el("div", "x-sub", sub));
    return w;
  }
  function drawDb(d) {
    var box = $("xDb"); if (!box) return;
    box.textContent = "";
    var warn = [];
    var dbp = +d.db_pct || 0, eg = d.egress || {}, ep = +eg.pct || 0;
    if (dbp >= 80) warn.push("🚨 Databasen är över 80 % av gratisgränsen (500 MB). Töm gamla bilder/röster eller uppgradera planen nu.");
    else if (dbp >= 60) warn.push("⚠️ Databasen är över 60 % av gratisgränsen (500 MB). Håll koll – grupper som sparar chatten växer för alltid.");
    if (ep >= 80) warn.push("🚨 Uppskattad trafik (egress) är över 80 % av 5 GB/månad. Kolla Usage i Supabase-panelen.");
    else if (ep >= 60) warn.push("⚠️ Uppskattad trafik (egress) är över 60 % av 5 GB/månad.");
    warn.forEach(function (w) { box.appendChild(el("div", "x-alert x-" + (/🚨/.test(w) ? "bad" : "warn"), w)); });
    box.appendChild(meter("Databas", d.db_bytes, d.limit_db_bytes, dbp));
    box.appendChild(meter("Egress (uppskattning, 30 d)", eg.est_bytes_30d, eg.limit_bytes, ep,
      "Media " + mb(eg.media_bytes_30d) + " + app " + mb(eg.api_bytes_30d) + " (" + nf.format(eg.user_nights_30d || 0) + " användarkvällar × 1,4 MB). Riktig siffra: Supabase → Usage."));
    var m = d.media || {}, mt = el("table", "x-t");
    var hr = mt.insertRow(); ["Media", "Lagrat", "Rader", "Live", "Sparas för alltid"].forEach(function (h) { var th = document.createElement("th"); th.textContent = h; hr.appendChild(th); });
    [["📷 Bilder", m.photos], ["🎙️ Röster", m.voices], ["📸 Kamera (lägesrapport)", m.camera]].forEach(function (x) {
      if (!x[1]) return;
      var r = mt.insertRow();
      [x[0], mb(x[1].bytes), nf.format(x[1].rows || 0), x[1].live_rows != null ? nf.format(x[1].live_rows) : "–", x[1].kept_rows != null ? nf.format(x[1].kept_rows) : "–"].forEach(function (v) { r.insertCell().textContent = v; });
    });
    box.appendChild(mt);
    var tt = el("table", "x-t");
    var h2 = tt.insertRow(); ["Tabell", "Totalt", "Data", "Index", "Toast", "≈ rader"].forEach(function (h) { var th = document.createElement("th"); th.textContent = h; h2.appendChild(th); });
    (d.tables || []).forEach(function (t) {
      var r = tt.insertRow();
      var c0 = r.insertCell(); c0.textContent = t.name; c0.className = "mono";
      [mb(t.bytes), mb(t.table_bytes), mb(t.index_bytes), mb(t.toast_bytes), nf.format(t.rows_est || 0)].forEach(function (v) { r.insertCell().textContent = v; });
    });
    var det = el("details"); det.appendChild(el("summary", null, "Lagring per tabell (topp 25)")); det.appendChild(tt);
    box.appendChild(det);
    $("pDb").hidden = false;
  }

  /* ---------- 📅 events ---------- */
  var evStatus = "pending";
  function drawEvents(d) {
    var box = $("xEv"); if (!box) return;
    box.textContent = "";
    var c = d.counts || {};
    $("xEvCount").textContent = "· " + (c.pending || 0) + " väntar, " + (c.ok || 0) + " godkända";
    var f = el("div", "wf");
    [["pending", "Väntar"], ["ok", "Godkända"], ["hidden", "Dolda"], ["all", "Alla"]].forEach(function (s) {
      var b = el("button", "btn ghost" + (s[0] === evStatus ? " on" : ""), s[1]); b.type = "button";
      b.addEventListener("click", function () { evStatus = s[0]; loadEvents(); });
      f.appendChild(b);
    });
    box.appendChild(f);
    var list = el("ol", "wl");
    (d.events || []).forEach(function (e) {
      var li = el("li");
      var t = new Date(e.starts_at);
      li.appendChild(el("div", "x-ev-h", t.toLocaleString("sv-SE", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) + " · " + e.title));
      li.appendChild(el("div", "x-sub", [e.place || "", e.town || "", e.source, e.status].filter(Boolean).join(" · ") + (e.url ? " · " + e.url : "")));
      var row = el("div", "x-acts");
      [["ok", "✅ Godkänn"], ["hidden", "🙈 Dölj"], ["pending", "⏳ Väntar"]].forEach(function (a) {
        if (a[0] === e.status) return;
        var b = el("button", "btn ghost", a[1]); b.type = "button";
        b.addEventListener("click", function () {
          b.disabled = true;
          call("owner_set_event", { p_key: key(), p_id: e.id, p_status: a[0] }).then(function () { loadEvents(); });
        });
        row.appendChild(b);
      });
      li.appendChild(row); list.appendChild(li);
    });
    if (!(d.events || []).length) box.appendChild(el("p", "note", "Inga event här."));
    box.appendChild(list);
    $("pEv").hidden = false;
  }
  function loadEvents() { call("owner_events", { p_key: key(), p_status: evStatus }).then(function (r) { if (r && r.d) drawEvents(r.d); }); }

  /* ---------- 🚩 bar reports ---------- */
  var KIND = { closed: "🚪 stängt", wrong_place: "📍 fel plats", duplicate: "👯 dubblett", not_bar: "🍽️ ingen krog", other: "✏️ annat" };
  function drawReports(d) {
    var box = $("xRep"); if (!box) return;
    box.textContent = "";
    $("xRepCount").textContent = "· " + (d.total_new || 0) + " nya";
    var list = el("ol", "wl");
    (d.bars || []).forEach(function (b) {
      var li = el("li");
      li.appendChild(el("div", "x-ev-h", (b.bar_name || b.bar_id) + " · " + b.users + " pers." + (b.active === false ? " · (redan avstängd)" : "")));
      var kinds = Object.keys(b.kinds || {}).map(function (k) { return (KIND[k] || k) + " ×" + b.kinds[k]; }).join(", ");
      li.appendChild(el("div", "x-sub", kinds + " · id " + b.bar_id + (b.lat ? " · " + (+b.lat).toFixed(5) + ", " + (+b.lng).toFixed(5) : "")));
      (b.notes || []).forEach(function (n) { li.appendChild(el("div", "x-note", "”" + n + "”")); });
      if ((b.user_pos || []).length) li.appendChild(el("div", "x-sub", "Användare stod vid: " + b.user_pos.map(function (p) { return p[0] + ", " + p[1]; }).join(" · ")));
      var row = el("div", "x-acts");
      if (b.lat) { var a = el("a", "btn ghost", "🗺️ OSM"); a.href = "https://www.openstreetmap.org/?mlat=" + b.lat + "&mlon=" + b.lng + "#map=19/" + b.lat + "/" + b.lng; a.target = "_blank"; a.rel = "noopener"; row.appendChild(a); }
      [["close", "🚫 Stäng av krogen"], ["ignore", "🙈 Ignorera"]].concat(b.active === false ? [["reopen", "↩️ Slå på igen"]] : []).forEach(function (x) {
        var btn = el("button", "btn ghost", x[1]); btn.type = "button";
        btn.addEventListener("click", function () {
          btn.disabled = true;
          call("owner_bar_action", { p_key: key(), p_bar_id: b.bar_id, p_action: x[0] }).then(function () { loadReports(); });
        });
        row.appendChild(btn);
      });
      li.appendChild(row); list.appendChild(li);
    });
    if (!(d.bars || []).length) box.appendChild(el("p", "note", "Inga nya rapporter."));
    box.appendChild(list);
    box.appendChild(el("p", "note", "”Stäng av” sätter bars_lite.active = false direkt. Lägg också id:t i docs/bars-closed.json (eller kör scripts/clean-bars.mjs --write) så att nästa bars.json-import håller den borta."));
    $("pRep").hidden = false;
  }
  function loadReports() { call("owner_bar_reports", { p_key: key() }).then(function (r) { if (r && r.d) drawReports(r.d); }); }

  function refresh() {
    if (!key() || !$("main") || $("main").hidden) return;
    call("owner_db_stats", { p_key: key() }).then(function (r) { if (r && r.d) drawDb(r.d); });
    loadEvents(); loadReports();
  }
  function start() {
    var main = $("main"); if (!main) return;
    var was = main.hidden;
    new MutationObserver(function () { if (was && !main.hidden) refresh(); was = main.hidden; }).observe(main, { attributes: true, attributeFilter: ["hidden"] });
    if (!main.hidden) refresh();
    timer = setInterval(function () { if (document.visibilityState === "visible") refresh(); }, 60000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.OLNU_STATS_X = { refresh: refresh };
})();
