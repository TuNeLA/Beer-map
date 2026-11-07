/* PintsNow — 💬 owner panel "Feedback" for docs/stats.html (migration 0215, js/pnui.js). owner_feedback(p_key):
   🐞 bug reports and 💡 wishes from Profil → Hjälp oss bli bättre, the morning question ("Vad saknade du igår?") and
   tonight's "Ikväll?" status counts. Status per row: ny · läst · fixad · dold (owner_set_feedback). Same owner key. */
(function () {
  "use strict";
  var cfg = window.OLNU_CONFIG || {}, sb = null;
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
  var KIND = { bug: "🐞 Fel", wish: "💡 Önskan", morning: "☀️ Morgonfråga" };
  var ANS = { kompisar: "Fler kompisar på kartan", enklare: "Att det va enklare", mer_att_gora: "Mer att göra", inget: "Inget, det va bra" };
  function panel() {
    var p = $("pFb"); if (p) return p;
    p = el("section", "panel"); p.id = "pFb"; p.hidden = true;
    var h = el("h2", null, "💬 Feedback "); var c = el("span"); c.id = "xFbN"; h.appendChild(c); p.appendChild(h);
    var box = el("div"); box.id = "xFb"; p.appendChild(box);
    p.appendChild(el("p", "note", "Från Profil → Hjälp oss bli bättre (Rapportera fel) och morgonfrågan dagen efter en utekväll (max 1 gång per 14 dagar). Testanvändare är markerade med (test)."));
    var anchor = $("pWishes");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(p, anchor); else if ($("main")) $("main").appendChild(p);
    return p;
  }
  function draw(d) {
    var p = panel(), box = $("xFb"); box.textContent = ""; p.hidden = false;
    var cn = d.counts || {};
    $("xFbN").textContent = "· " + (cn.bug || 0) + " fel · " + (cn.morning || 0) + " morgonsvar" + (d.ikvall ? " · Ikväll?: " + (d.ikvall.tonight || 0) + " svar, " + (d.ikvall.ute || 0) + " ute" : "");
    var mo = d.morning || {}, keys = Object.keys(mo);
    if (keys.length) {
      box.appendChild(el("h3", null, "Vad saknade du igår? (30 d)"));
      var tot = keys.reduce(function (a, k) { return a + (mo[k] | 0); }, 0) || 1;
      var ul = el("ul", "fb-bars");
      keys.sort(function (a, b) { return mo[b] - mo[a]; }).forEach(function (k) {
        var li = el("li"); li.appendChild(el("span", null, (ANS[k] || k) + " · " + mo[k]));
        var bar = el("i"); bar.style.width = Math.round(100 * mo[k] / tot) + "%"; li.appendChild(bar); ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    var items = d.items || [];
    box.appendChild(el("h3", null, "Senaste"));
    if (!items.length) { box.appendChild(el("p", "note", "Inget än.")); return; }
    var ol = el("ol", "wl");
    items.slice(0, 120).forEach(function (x) {
      var li = el("li");
      var head = el("div"); head.appendChild(el("b", null, (KIND[x.kind] || x.kind) + (x.test ? " (test)" : "")));
      head.appendChild(document.createTextNode(" · " + String(x.created_at || "").slice(0, 16).replace("T", " ") + " · " + x.status));
      li.appendChild(head);
      if (x.answer) li.appendChild(el("div", null, "Svar: " + (ANS[x.answer] || x.answer)));
      if (x.body) li.appendChild(el("div", null, x.body));
      var m = x.meta || {};
      if (m.v || m.ua || m.err) li.appendChild(el("div", "note", ["v " + (m.v || "–"), m.screen ? "skärm: " + m.screen : "", m.err ? "fel: " + m.err : "", m.ua ? m.ua.slice(0, 90) : ""].filter(Boolean).join(" · ")));
      var acts = el("div");
      ["läst", "fixad", "dold"].forEach(function (s) {
        if (s === x.status) return;
        var b = el("button", "btn", s); b.type = "button";
        b.addEventListener("click", function () { b.disabled = true; call("owner_set_feedback", { p_key: key(), p_id: x.id, p_status: s }).then(load); });
        acts.appendChild(b);
      });
      li.appendChild(acts); ol.appendChild(li);
    });
    box.appendChild(ol);
  }
  function load() { if (!key()) return; call("owner_feedback", { p_key: key() }).then(function (d) { if (d && d.items) draw(d); }); }
  function start() {
    var main = $("main"); if (!main) return;
    var was = main.hidden;
    new MutationObserver(function () { if (was && !main.hidden) load(); was = main.hidden; }).observe(main, { attributes: true, attributeFilter: ["hidden"] });
    if (!main.hidden) load();
    setInterval(function () { if (document.visibilityState === "visible" && !main.hidden) load(); }, 120000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
