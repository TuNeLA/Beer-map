/* Öl Nu — ✏️ owner panel "Krogytor att granska" for docs/stats.html (CONTRACT "BAREA · krogens yta", migration 0095).
   Same owner key as the other panels (sessionStorage olnu.ownerKey), loaded after stats-extra.js, refreshes with it
   (every 60 s while #main is visible). Missing RPC → the panel stays hidden.
   - List of drawn bar areas (Väntar / Godkända / Avvisade / Alla) with a mini map: OSM tiles at zoom 19, the drawn area
     (amber), the automatic lit part (blue) and the whole house (white, dashed) from docs/buildings, the bar point.
   - ✅ Godkänn / 🙈 Avvisa / ⏳ Väntar → owner_set_bar_area. Approving replaces the bar's earlier approved area.
   - "📱 Den här mobilen är min": owner_trust_me(owner key) sent WITH the app's own session from this browser
     (same origin: localStorage "olnu.auth"), so areas drawn in the app on this phone are approved at once. */
(function () {
  "use strict";
  var cfg = window.OLNU_CONFIG || {}, sb = null, status = "pending";
  var $ = function (id) { return document.getElementById(id); };
  var CSS = ".ba-map{position:relative;width:240px;height:240px;max-width:100%;overflow:hidden;border:1px solid var(--line-soft);border-radius:12px;background:#223;margin:6px 0}" +
    ".ba-map img{position:absolute;width:256px;height:256px;max-width:none}.ba-map svg{position:absolute;left:0;top:0}" +
    ".ba-leg{font-size:12px;color:var(--muted)}.ba-leg b{display:inline-block;width:10px;height:10px;margin:0 4px 0 8px;vertical-align:middle}" +
    ".ba-trust{margin:8px 0 12px}.ba-trust .btn{min-height:44px}";
  try { var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); } catch (e) {}
  function key() { try { return sessionStorage.getItem("olnu.ownerKey") || ""; } catch (e) { return ""; } }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function client(token) {
    if (!cfg.SUPABASE_URL || !window.supabase) return null;
    var o = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    if (token) { o.global = { headers: { Authorization: "Bearer " + token } }; return window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, o); }
    return sb || (sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, o));
  }
  function call(name, params, token) {
    var c = client(token); if (!c) return Promise.resolve(null);
    return c.rpc(name, params).then(function (r) {
      if (r.error || !r.data || r.data.message === "forbidden") return { missing: !!(r.error && /PGRST202|Could not find|does not exist/i.test(String(r.error.message || r.error.code || ""))), err: r.error, d: null };
      return { d: r.data };
    }, function () { return null; });
  }
  function panel() {
    var p = $("pArea"); if (p) return p;
    p = el("section", "panel"); p.id = "pArea"; p.hidden = true;
    var h = el("h2", null, "✏️ Krogytor "); var c = el("span"); c.id = "xAreaCount"; h.appendChild(c); p.appendChild(h);
    var box = el("div"); box.id = "xArea"; p.appendChild(box);
    p.appendChild(el("p", "note", "Användare ritar krogens egen yta (🚩 Fel plats → ✏️ Rita krogens yta). Godkänd yta ersätter den automatiska delen av huset för alla. Avvisa = dold (ingen rad tas bort)."));
    var anchor = $("pRep") || $("pPl");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(p, anchor.nextSibling); else if ($("main")) $("main").appendChild(p);
    return p;
  }

  /* ---------- mini map (web mercator, zoom 19) ---------- */
  var Z = 19, W = 240;
  function px(lat, lng) {
    var n = 256 * Math.pow(2, Z), s = Math.sin(lat * Math.PI / 180);
    return [(lng + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  }
  var tileCache = {};
  function bTile(lat, lng) {
    var k = Math.floor(lat / 0.05) + "_" + Math.floor(lng / 0.1);
    if (!tileCache[k]) tileCache[k] = fetch("./buildings/" + k + ".json").then(function (r) { return r.ok ? r.json() : { features: [] }; }).catch(function () { return { features: [] }; });
    return tileCache[k];
  }
  function miniMap(a) {
    var box = el("div", "ba-map"), c = px(a.bar_lat, a.bar_lng), x0 = c[0] - W / 2, y0 = c[1] - W / 2;
    for (var tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + W) / 256); tx++) for (var ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + W) / 256); ty++) {
      var im = el("img"); im.alt = ""; im.loading = "lazy"; im.referrerPolicy = "no-referrer-when-downgrade";
      im.src = "https://tile.openstreetmap.org/" + Z + "/" + tx + "/" + ty + ".png";
      im.style.left = (tx * 256 - x0) + "px"; im.style.top = (ty * 256 - y0) + "px"; box.appendChild(im);
    }
    var NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", W); svg.setAttribute("height", W); svg.setAttribute("viewBox", "0 0 " + W + " " + W);
    var path = function (rings, attrs) {
      var d = rings.map(function (r) { return "M" + r.map(function (p) { var q = px(p[1], p[0]); return (q[0] - x0).toFixed(1) + "," + (q[1] - y0).toFixed(1); }).join("L") + "Z"; }).join("");
      var e = document.createElementNS(NS, "path"); e.setAttribute("d", d); e.setAttribute("fill-rule", "evenodd");
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); svg.appendChild(e); return e;
    };
    var auto = document.createElementNS(NS, "g"); svg.appendChild(auto);
    bTile(a.bar_lat, a.bar_lng).then(function (fc) {
      (fc.features || []).forEach(function (f) {
        var p = f.properties || {}, ids = p.bldg ? p.of || [] : [p.bar_id].concat(p.also || []);
        if (ids.indexOf(a.bar_id) < 0 || !f.geometry) return;
        var polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
        polys.forEach(function (rings) {
          var e = path(rings, p.bldg ? { fill: "none", stroke: "#fff", "stroke-width": 1.5, "stroke-dasharray": "4 4" } : { fill: "rgba(74,163,255,.25)", stroke: "#4aa3ff", "stroke-width": 1.5 });
          auto.appendChild(e);
        });
      });
    });
    path([a.polygon], { fill: "rgba(255,176,46,.35)", stroke: "#ffb02e", "stroke-width": 3 });
    var dot = document.createElementNS(NS, "circle"); dot.setAttribute("cx", W / 2); dot.setAttribute("cy", W / 2); dot.setAttribute("r", 5);
    dot.setAttribute("fill", "#ff3b3b"); dot.setAttribute("stroke", "#fff"); dot.setAttribute("stroke-width", 2); svg.appendChild(dot);
    box.appendChild(svg);
    return box;
  }

  /* ---------- 📱 trust this phone ---------- */
  function appSession() {
    try {
      var s = JSON.parse(localStorage.getItem("olnu.auth") || "null");
      if (s && s.currentSession) s = s.currentSession;
      if (!s || !s.access_token) return null;
      if (s.expires_at && s.expires_at * 1000 < Date.now() + 60e3) return { expired: true };
      return s;
    } catch (e) { return null; }
  }
  function trustRow(d) {
    var row = el("div", "ba-trust"), s = appSession();
    var txt = el("p", "note", (d.trusted ? "Betrodda konton: " + d.trusted + ". " : "") +
      "Rita du själv i appen? Tryck här på mobilen där du använder appen, så godkänns dina egna ytor direkt.");
    var b = el("button", "btn ghost", "📱 Den här mobilen är min (godkänn mina ytor direkt)"); b.type = "button";
    if (!s || s.expired) { b.disabled = true; txt.textContent += " (Öppna appen på den här mobilen först, sedan den här sidan.)"; }
    b.addEventListener("click", function () {
      var ss = appSession(); if (!ss || ss.expired) return;
      b.disabled = true;
      call("owner_trust_me", { p_key: key(), p_on: true }, ss.access_token).then(function (r) {
        b.textContent = r && r.d && r.d.ok ? "✅ Klart – ytor du ritar på den här mobilen godkänns direkt" + (r.d.approved ? " (" + r.d.approved + " väntande godkända nu)" : "") : "Gick inte (logga in i appen igen och försök)";
        if (r && r.d && r.d.ok) load();
      });
    });
    row.appendChild(b); row.appendChild(txt);
    return row;
  }

  function draw(d) {
    var p = panel(), box = $("xArea"); box.textContent = "";
    var c = d.counts || {};
    $("xAreaCount").textContent = "· " + (c.pending || 0) + " väntar, " + (c.ok || 0) + " godkända";
    box.appendChild(trustRow(d));
    var f = el("div", "wf");
    [["pending", "Väntar"], ["ok", "Godkända"], ["rejected", "Avvisade"], ["all", "Alla"]].forEach(function (s) {
      var b = el("button", "btn ghost" + (s[0] === status ? " on" : ""), s[1]); b.type = "button";
      b.addEventListener("click", function () { status = s[0]; load(); });
      f.appendChild(b);
    });
    box.appendChild(f);
    var list = el("ol", "wl");
    (d.areas || []).forEach(function (a) {
      var li = el("li"); li.setAttribute("data-area", a.id);
      li.appendChild(el("div", "x-ev-h", (a.bar_name || a.bar_id) + " · " + Math.round(a.area_m2) + " m² · " + a.n_pts + " hörn"));
      li.appendChild(el("div", "x-sub", new Date(a.created_at).toLocaleString("sv-SE") + " · " + a.status + (a.auto ? " (direkt, ägaren)" : "") +
        (a.superseded ? " · ersatt" : "") + " · id " + a.bar_id + " · ritaren har ritat " + (a.by_n || 1) + (a.others ? " · " + a.others + " andra ytor för krogen" : "")));
      li.appendChild(miniMap(a));
      var leg = el("div", "ba-leg"); leg.innerHTML = '<b style="background:#ffb02e"></b>ritad<b style="background:#4aa3ff"></b>automatisk<b style="border:1px dashed #fff"></b>huset';
      li.appendChild(leg);
      var row = el("div", "x-acts");
      var o = el("a", "btn ghost", "🗺️ OSM"); o.href = "https://www.openstreetmap.org/?mlat=" + a.bar_lat + "&mlon=" + a.bar_lng + "#map=19/" + a.bar_lat + "/" + a.bar_lng; o.target = "_blank"; o.rel = "noopener"; row.appendChild(o);
      [["ok", "✅ Godkänn"], ["rejected", "🙈 Avvisa"], ["pending", "⏳ Väntar"]].forEach(function (x) {
        if (x[0] === a.status && !a.superseded) return;
        var b = el("button", "btn ghost", x[1]); b.type = "button"; b.setAttribute("data-set", x[0]);
        b.addEventListener("click", function () { b.disabled = true; call("owner_set_bar_area", { p_key: key(), p_id: a.id, p_status: x[0] }).then(function () { load(); }); });
        row.appendChild(b);
      });
      li.appendChild(row); list.appendChild(li);
    });
    if (!(d.areas || []).length) box.appendChild(el("p", "note", "Inga ritade ytor här."));
    box.appendChild(list);
    p.hidden = false;
  }
  function load() {
    if (!key()) return;
    call("owner_bar_areas", { p_key: key(), p_status: status }).then(function (r) { if (r && r.d) draw(r.d); });
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
  window.OLNU_STATS_AREAS = { refresh: refresh, _miniMap: miniMap };
})();
