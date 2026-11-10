/* PintsNow — 🚩 owner panel "Anmälningar" for docs/stats.html (SAFE, migrations 0206 + 0208).
   Same owner key as the other panels (sessionStorage olnu.ownerKey; checked on the server by olnu_wd_owner_ok).
   Refreshes when #main shows and every 60 s. Apple 1.2 wants "timely responses": the head shows the oldest open
   report in hours (aim: < 24 h). Actions per report: ✅ OK (ingen åtgärd) · 🗑️ Ta bort (+ meddelande till avsändaren,
   DSA art. 17) · ⚠️ Varna · 🧹 Ta bort allt från personen ikväll. Photos open on demand (owner_report_photo).
   Also a word-filter test box (owner_mask_test). Missing RPC → the panel stays hidden.
   misc F3 (0400): engångskamerans film photos come from owner_film_reports and sit in the same list (kind "film",
   actions owner_film_act, photo owner_film_photo). Missing film RPCs = chat reports only. */
(function () {
  "use strict";
  var cfg = window.OLNU_CONFIG || {}, sb = null, status = "new";
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
  var KIND = { msg: "💬 chatt", dm: "✉️ DM", photo: "📷 bild", voice: "🎙️ röstklipp", person: "👤 person", name: "🏷️ namn", avatar: "🧑‍🎨 avatar",
    invite: "📨 inbjudan", event: "📅 event", offer: "🍺 tips", film: "🎞️ filmbild" };
  var WHY = { hat: "hat/kränkning", hot: "hot/trakasserier", sex: "sexuellt/naket", minor: "minderårig", drog: "droger/försäljning", spam: "spam/bluff", annat: "annat" };
  var ST = { "new": "ny", dismissed: "OK", hidden: "borttagen", warned: "varnad" };
  function ago(t) { var h = (Date.now() - Date.parse(t)) / 3600e3; return h < 1 ? Math.max(1, Math.round(h * 60)) + " min" : Math.round(h) + " h"; }
  function panel() {
    var p = $("pUgc"); if (p) return p;
    p = el("section", "panel"); p.id = "pUgc"; p.hidden = true;
    var h = el("h2", null, "🚩 Anmälningar "); var c = el("span"); c.id = "xUgcCount"; h.appendChild(c); p.appendChild(h);
    var box = el("div"); box.id = "xUgc"; p.appendChild(box);
    p.appendChild(el("p", "note", "Användare trycker länge på ett inlägg → 🚩 Anmäl (chatt, bild, röstklipp, DM, namn, avatar, inbjudan, event, tips). " +
      "Engångskamerans bilder anmäls i bildvisaren: 2 olika anmälare döljer bilden för alla direkt (✅ OK tar tillbaka den). " +
      "3 olika anmälare döljer en chattrad, bild eller ett röstklipp direkt. Svara inom 24 h. Ta bort = innehållet försvinner och avsändaren får ett kort meddelande om varför."));
    var t = el("div", "x-acts"), inp = el("input"); inp.placeholder = "Testa ordfiltret…"; inp.maxLength = 300; inp.style.flex = "1";
    var go = el("button", "btn ghost", "🧪 Testa"); go.type = "button";
    var out = el("span", "x-sub"); out.id = "xUgcMask";
    go.addEventListener("click", function () { call("owner_mask_test", { p_key: key(), p_text: inp.value }).then(function (r) { out.textContent = r && r.d ? "→ " + r.d.out + " (" + r.d.words + " ord i listan)" : "–"; }); });
    t.appendChild(inp); t.appendChild(go); p.appendChild(t); p.appendChild(out);
    var anchor = $("pWishes") || $("pRep") || $("pPl");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(p, anchor); else if ($("main")) $("main").appendChild(p);
    return p;
  }
  function act(r, action, li) {
    var note = null;
    if (action === "hide" || action === "hide_all") note = window.prompt("Meddelande till avsändaren (tomt = standardtext):", "") || null;
    li.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
    (r.kind === "film" ? call("owner_film_act", { p_key: key(), p_photo_id: r.film_id, p_action: action, p_notice: note })
      : call("owner_report_act", { p_key: key(), p_id: r.id, p_action: action, p_notice: note })).then(function () { load(); });
  }
  function draw(d) {
    var p = panel(), box = $("xUgc"); box.textContent = "";
    $("xUgcCount").textContent = "· " + (d.open || 0) + " öppna" + (d.oldest_open_h != null ? ", äldsta " + String(d.oldest_open_h).replace(".", ",") + " h" : "");
    $("xUgcCount").style.color = d.oldest_open_h != null && d.oldest_open_h >= 20 ? "#ff6b6b" : "";
    var f = el("div", "wf");
    [["new", "Öppna"], ["hidden", "Borttagna"], ["warned", "Varnade"], ["dismissed", "OK"], ["all", "Alla"]].forEach(function (s) {
      var b = el("button", "btn ghost" + (s[0] === status ? " on" : ""), s[1]); b.type = "button";
      b.addEventListener("click", function () { status = s[0]; load(); });
      f.appendChild(b);
    });
    box.appendChild(f);
    var list = el("ol", "wl");
    (d.reports || []).forEach(function (r) {
      var li = el("li"); li.setAttribute("data-rep", (r.kind === "film" ? "f" : "") + String(r.id));
      li.appendChild(el("div", "x-ev-h", (KIND[r.kind] || r.kind) + " · " + (WHY[r.reason] || r.reason || "–") + " · " + ago(r.created_at) + " sedan" +
        (r.same > 1 ? " · " + r.same + " anmälare" : "") + (r.author_30d > 1 ? " · personen: " + r.author_30d + " anmälningar/30 d" : "")));
      if (r.excerpt) li.appendChild(el("div", "x-sub", "”" + r.excerpt + "”"));
      if (r.note) li.appendChild(el("div", "x-sub", "Anmälarens kommentar: " + r.note));
      li.appendChild(el("div", "x-sub", "Status: " + (ST[r.status] || r.status) + (r.author ? " · person #" + r.author : "")));
      if (r.kind === "film") li.appendChild(el("div", "x-sub", r.auto_hidden ? "Dold för alla efter 2 anmälare. ✅ OK tar tillbaka den." : r.live ? "Bilden syns för gänget." : "Bilden syns int' längre."));
      var row = el("div", "x-acts");
      if (r.photo_id || r.film_id) {
        var ph = el("button", "btn ghost", "📷 Visa bild"); ph.type = "button";
        ph.addEventListener("click", function () {
          ph.disabled = true;
          (r.film_id ? call("owner_film_photo", { p_key: key(), p_photo_id: r.film_id })
            : call("owner_report_photo", { p_key: key(), p_photo_id: r.photo_id })).then(function (x) {
            if (!x || !x.d || !x.d.ok) { ph.textContent = "Bilden finns int' kvar"; return; }
            var img = el("img"); img.src = "data:" + (x.d.mime || "image/jpeg") + ";base64," + x.d.b64; img.alt = "Anmäld bild";
            img.style.maxWidth = "100%"; img.style.maxHeight = "320px"; img.style.display = "block"; img.style.margin = "6px 0";
            li.insertBefore(img, row); ph.remove();
          });
        });
        row.appendChild(ph);
      }
      if (r.status === "new") {
        [["dismiss", "✅ OK"], ["hide", "🗑️ Ta bort"], ["warn", "⚠️ Varna"], ["hide_all", "🧹 Allt från personen"]].forEach(function (a) {
          var b = el("button", "btn ghost", a[1]); b.type = "button"; b.setAttribute("data-act", a[0]);
          b.addEventListener("click", function () { act(r, a[0], li); });
          row.appendChild(b);
        });
      }
      li.appendChild(row); list.appendChild(li);
    });
    if (!(d.reports || []).length) box.appendChild(el("p", "note", status === "new" ? "Inga öppna anmälningar. 👍" : "Inget här."));
    box.appendChild(list);
    p.hidden = false;
  }
  // misc F3: chat reports + film photo reports in one list, newest first; the head counts both.
  function merge(a, f) {
    if (!f || !Array.isArray(f.reports)) return a;
    a = a || { open: 0, oldest_open_h: null, reports: [] };
    var old = [a.oldest_open_h, f.oldest_open_h].filter(function (v) { return v != null; });
    return { open: (a.open || 0) + (f.open || 0), oldest_open_h: old.length ? Math.max.apply(null, old.map(Number)) : null,
      reports: (a.reports || []).concat(f.reports).sort(function (p, q) { return Date.parse(q.created_at) - Date.parse(p.created_at); }) };
  }
  function load() {
    if (!key()) return;
    Promise.all([call("owner_reports", { p_key: key(), p_status: status }), call("owner_film_reports", { p_key: key(), p_status: status })]).then(function (x) {
      var d = merge(x[0] && x[0].d, x[1] && x[1].d);
      if (d) draw(d);
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
  window.OLNU_STATS_UGC = { refresh: refresh };
})();
