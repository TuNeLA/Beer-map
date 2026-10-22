/* Öl Nu — 📸 owner panel "Krogbilder" for docs/stats.html (CONTRACT "📸 KROGBILDER · ☀️ UTEVÄDER · 🏠 FÖLJ MIG HEM · 🔍 HITTA KOMPIS",
   migration 0140). Same owner key as the other panels (sessionStorage olnu.ownerKey); refreshes when #main shows and every 60 s.
   Lists photos a photographer shared with everyone at a bar ("🌍 Dela med alla på krogen", 7 days, no name):
   Publika / Anmälda / Dolda / Alla → 👁️ Visa (loads the image) · 🙈 Dölj (owner_set_bar_photo hidden) · ✅ Visa igen (ok).
   3 user reports hide a photo by themselves; the owner can show it again. Nothing is ever removed. Missing RPC → hidden. */
(function () {
  "use strict";
  var cfg = window.OLNU_CONFIG || {}, sb = null, status = "reported";
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
    var p = $("pBarFoto"); if (p) return p;
    p = el("section", "panel"); p.id = "pBarFoto"; p.hidden = true;
    var h = el("h2", null, "📸 Krogbilder "); var c = el("span"); c.id = "xBfCount"; h.appendChild(c); p.appendChild(h);
    var box = el("div"); box.id = "xBf"; p.appendChild(box);
    p.appendChild(el("p", "note", "Bilder som fotografen själv delat med alla på krogen (7 dagar, inget namn). 3 anmälningar döljer en bild automatiskt. Dölj = syns inte för nån (ingen rad tas bort). Gruppbilder syns aldrig här."));
    var anchor = $("pClub") || $("pArea") || $("pRep");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(p, anchor.nextSibling); else if ($("main")) $("main").appendChild(p);
    return p;
  }
  function when(s) { try { return new Date(s).toLocaleString("sv-SE"); } catch (e) { return ""; } }
  function draw(d) {
    var p = panel(), box = $("xBf"); box.textContent = "";
    var c = d.counts || {};
    $("xBfCount").textContent = "· " + (c.public || 0) + " publika, " + (c.reported || 0) + " anmälda, " + (c.hidden || 0) + " dolda · " + (c.tagged_7d || 0) + " taggade 7 d";
    var f = el("div", "wf");
    [["reported", "Anmälda"], ["public", "Publika"], ["hidden", "Dolda"], ["all", "Alla"]].forEach(function (s) {
      var b = el("button", "btn ghost" + (s[0] === status ? " on" : ""), s[1]); b.type = "button";
      b.addEventListener("click", function () { status = s[0]; load(); });
      f.appendChild(b);
    });
    box.appendChild(f);
    var list = el("ol", "wl");
    (d.rows || []).forEach(function (a) {
      var li = el("li"); li.setAttribute("data-bf", a.id);
      li.appendChild(el("div", "x-ev-h", (a.bar_name || a.bar_id) + " · " + (a.kind === "film" ? "🎞️ engångskamera" : "💬 chattbild") + " · 🚩 " + (a.reports || 0)));
      li.appendChild(el("div", "x-sub", "Tagen " + when(a.taken_at) + " · delad " + when(a.public_at) + " · " + (a.live ? "syns till " + when(a.public_until) : "slut") +
        (a.hidden_at ? " · DOLD (" + (a.hidden_by === "owner" ? "av dig" : "anmälningar") + ")" : "") +
        ((a.reasons || []).length ? " · skäl: " + a.reasons.join(", ") : "") + " · fotografen har delat " + (a.by_n || 1)));
      var img = el("div", "x-bf-img");
      var row = el("div", "x-acts");
      if (a.has_img) {
        var v = el("button", "btn ghost", "👁️ Visa"); v.type = "button";
        v.addEventListener("click", function () {
          v.disabled = true;
          call("owner_bar_photo", { p_key: key(), p_id: a.id }).then(function (r) {
            if (!r || !r.d || !r.d.b64) { v.disabled = false; return; }
            var im = new Image(); im.alt = ""; im.style.maxWidth = "220px"; im.style.maxHeight = "220px"; im.style.borderRadius = "8px";
            im.src = "data:" + (r.d.mime || "image/jpeg") + ";base64," + r.d.b64; img.textContent = ""; img.appendChild(im);
          });
        });
        row.appendChild(v);
      }
      var o = el("a", "btn ghost", "🗺️ Krogen"); o.href = "./?bar=" + encodeURIComponent(a.bar_id); o.target = "_blank"; o.rel = "noopener"; row.appendChild(o);
      [["hidden", "🙈 Dölj"], ["ok", "✅ Visa igen"]].forEach(function (x) {
        if (x[0] === "hidden" && a.hidden_at && a.hidden_by === "owner") return;
        if (x[0] === "ok" && !a.hidden_at) return;
        var b = el("button", "btn ghost", x[1]); b.type = "button"; b.setAttribute("data-set", x[0]);
        b.addEventListener("click", function () { b.disabled = true; call("owner_set_bar_photo", { p_key: key(), p_id: a.id, p_status: x[0] }).then(function () { load(); }); });
        row.appendChild(b);
      });
      li.appendChild(row); li.appendChild(img); list.appendChild(li);
    });
    if (!(d.rows || []).length) box.appendChild(el("p", "note", "Inga bilder här."));
    box.appendChild(list);
    p.hidden = false;
  }
  function load() { if (!key()) return; call("owner_bar_photos", { p_key: key(), p_status: status }).then(function (r) { if (r && r.d) draw(r.d); }); }
  function refresh() { if (!key() || !$("main") || $("main").hidden) return; load(); }
  function start() {
    var main = $("main"); if (!main) return;
    var was = main.hidden;
    new MutationObserver(function () { if (was && !main.hidden) refresh(); was = main.hidden; }).observe(main, { attributes: true, attributeFilter: ["hidden"] });
    if (!main.hidden) refresh();
    setInterval(function () { if (document.visibilityState === "visible") refresh(); }, 60000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.OLNU_STATS_BARFOTO = { refresh: refresh };
})();
