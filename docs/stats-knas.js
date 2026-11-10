/* PintsNow — owner panel "Något knas?" for docs/stats.html (lane main X6, migration 0410). owner_knas(p_key) lists the reports
   (text, beta id, version, screen, the log lines folded), "Visa bild" asks owner_knas_shot(p_key, id) for that one picture.
   Status per row: ny · läst · fixad · dold (owner_set_knas). Same owner key as the other panels. Before 0410 runs the RPC is
   missing: the panel stays hidden. */
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
  function panel() {
    var p = $("pKnas"); if (p) return p;
    p = el("section", "panel"); p.id = "pKnas"; p.hidden = true;
    var h = el("h2", null, "🐞 Något knas? "); var c = el("span"); c.id = "xKnasN"; h.appendChild(c); p.appendChild(h);
    var box = el("div"); box.id = "xKnas"; p.appendChild(box);
    p.appendChild(el("p", "note", "Från ⋯ Mer på kartan och Inställningar → Om appen. Skärmbild + senaste 200 loggrader + beta-id. Max 5 per användare och dygn. Testanvändare är markerade med (test)."));
    var anchor = $("pFb") || $("pWishes");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(p, anchor); else if ($("main")) $("main").appendChild(p);
    return p;
  }
  function draw(d) {
    var p = panel(), box = $("xKnas"); box.textContent = ""; p.hidden = false;
    var cn = d.counts || {};
    $("xKnasN").textContent = "· " + (cn.ny || 0) + " nya · " + (cn.day || 0) + " senaste dygnet · " + (cn.all || 0) + " totalt";
    var items = d.items || [];
    if (!items.length) { box.appendChild(el("p", "note", "Inget än.")); return; }
    var ol = el("ol", "wl");
    items.slice(0, 150).forEach(function (x) {
      var li = el("li"); li.setAttribute("data-knas", String(x.id));
      var head = el("div"); head.appendChild(el("b", null, "#" + x.id + (x.test ? " (test)" : "")));
      var m = x.meta || {};
      head.appendChild(document.createTextNode(" · " + String(x.created_at || "").slice(0, 16).replace("T", " ") + " · " + x.status + (x.beta ? " · beta " + x.beta : "") + (m.from ? " · från " + m.from : "")));
      li.appendChild(head);
      li.appendChild(el("div", "wb", x.body || ""));
      li.appendChild(el("div", "note", ["v " + (m.v || "–"), m.screen ? "skärm: " + m.screen : "", m.w ? m.w + "×" + m.h : "", m.net ? "nät: " + m.net : "", m.standalone === "true" ? "installerad" : "webbläsare", m.ua ? m.ua.slice(0, 90) : ""].filter(Boolean).join(" · ")));
      var logs = Array.isArray(x.logs) ? x.logs : [];
      if (logs.length) {
        var det = el("details"); det.appendChild(el("summary", null, "Logg (" + logs.length + " rader)"));
        var pre = el("pre", "knas-log"); pre.textContent = logs.join("\n"); pre.style.cssText = "white-space:pre-wrap;font-size:11px;max-height:260px;overflow:auto";
        det.appendChild(pre); li.appendChild(det);
      }
      var acts = el("div");
      if (x.has_shot) {
        var sb2 = el("button", "btn", "Visa bild"); sb2.type = "button";
        sb2.addEventListener("click", function () {
          sb2.disabled = true;
          call("owner_knas_shot", { p_key: key(), p_id: x.id }).then(function (r) {
            if (r && r.shot && /^data:image\/(jpeg|png);base64,/.test(r.shot)) { var im = el("img", "knas-shot"); im.src = r.shot; im.alt = "Skärmbild #" + x.id; im.style.cssText = "display:block;max-width:240px;margin:8px 0;border-radius:12px"; li.insertBefore(im, acts); sb2.remove(); }
            else sb2.disabled = false;
          });
        });
        acts.appendChild(sb2);
      }
      ["läst", "fixad", "dold"].forEach(function (s) {
        if (s === x.status) return;
        var b = el("button", "btn", s); b.type = "button";
        b.addEventListener("click", function () { b.disabled = true; call("owner_set_knas", { p_key: key(), p_id: x.id, p_status: s }).then(load); });
        acts.appendChild(b);
      });
      li.appendChild(acts); ol.appendChild(li);
    });
    box.appendChild(ol);
  }
  function load() { if (!key()) return; call("owner_knas", { p_key: key() }).then(function (d) { if (d && d.items) draw(d); }); }
  function start() {
    var main = $("main"); if (!main) return;
    var was = main.hidden;
    new MutationObserver(function () { if (was && !main.hidden) load(); was = main.hidden; }).observe(main, { attributes: true, attributeFilter: ["hidden"] });
    if (!main.hidden) load();
    setInterval(function () { if (document.visibilityState === "visible" && !main.hidden) load(); }, 120000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.STATS_KNAS = { load: load };
})();
