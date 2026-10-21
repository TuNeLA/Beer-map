/* Öl Nu — owner panel "📺 Sportkrogar" for docs/stats.html (migration 0101). Same owner key as owner_stats (sessionStorage
   olnu.ownerKey). Lists bars users voted on (👍 / 👎) and lets the owner force "Visar sport" on / off or give it back to the votes,
   plus a name search to mark a bar nobody voted on yet. Missing RPC → the panel stays hidden. Runs when #main is visible. */
(function () {
  "use strict";
  var cfg = window.OLNU_CONFIG || {}, sb = null;
  var $ = function (id) { return document.getElementById(id); };
  var CSS = ".sp-o-row{padding:8px 0;border-bottom:1px solid var(--line-soft)}.sp-o-h{font-weight:600;overflow-wrap:anywhere}" +
    ".sp-o-s{font-size:12px;color:var(--muted);margin-top:2px}.sp-o-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.sp-o-acts .btn{min-height:36px}" +
    ".sp-o-on{color:var(--green)}.sp-o-q{display:flex;gap:6px;margin:8px 0}.sp-o-q input{flex:1;min-height:40px;padding:0 10px;background:var(--night-2);color:inherit;border:1px solid var(--line)}";
  try { var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); } catch (e) {}
  function key() { try { return sessionStorage.getItem("olnu.ownerKey") || ""; } catch (e) { return ""; } }
  function client() {
    if (sb) return sb;
    if (!cfg.SUPABASE_URL || !window.supabase) return null;
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    return sb;
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function call(name, params) {
    var c = client(); if (!c) return Promise.resolve(null);
    return c.rpc(name, params).then(function (r) {
      var d = r.data;
      if (r.error || !d || d.message === "forbidden") return { missing: !!(r.error && /PGRST202|Could not find|does not exist/i.test(String(r.error.message || r.error.code || ""))), d: null };
      return { d: d };
    }, function () { return null; });
  }
  var panel = null, listBox = null, findBox = null;
  function ensure() {
    if (panel || !$("main")) return;
    panel = el("section", "panel"); panel.id = "pSport"; panel.hidden = true;
    panel.appendChild(el("h2", null, "📺 Sportkrogar"));
    var q = el("div", "sp-o-q"), inp = el("input"); inp.placeholder = "Sök krog (namn) för att flagga…"; inp.maxLength = 40; inp.setAttribute("aria-label", "Sök krog");
    var go = el("button", "btn ghost", "🔎 Sök"); go.type = "button";
    go.addEventListener("click", function () { find(inp.value); });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") find(inp.value); });
    q.appendChild(inp); q.appendChild(go); panel.appendChild(q);
    findBox = el("div"); panel.appendChild(findBox);
    listBox = el("div"); panel.appendChild(listBox);
    panel.appendChild(el("p", "note", "”Visar sport” syns i krogens ruta och under TV-matcher i 📅 Event (”📺 Matchen visas på …”). Utan ditt beslut gäller rösterna: minst 1 👍 och fler 👍 än 👎. ”Efter röster” lämnar tillbaka beslutet (ingen rad tas bort)."));
    var after = $("pRep") || $("pPl") || $("pEv");
    if (after && after.parentNode) after.parentNode.insertBefore(panel, after.nextSibling); else $("main").appendChild(panel);
  }
  function row(b, after) {
    var li = el("div", "sp-o-row");
    li.appendChild(el("div", "sp-o-h", (b.shows ? "📺 " : "▫️ ") + (b.name || b.bar_id) + (b.town ? " · " + b.town : "")));
    li.appendChild(el("div", "sp-o-s" + (b.shows ? " sp-o-on" : ""), "👍 " + (b.yes | 0) + " · 👎 " + (b.no | 0) + " · " +
      (b.owner === true ? "ägaren: visar sport" : b.owner === false ? "ägaren: visar inte" : "efter röster") + " · " + b.bar_id));
    var acts = el("div", "sp-o-acts");
    [[true, "✅ Visar sport"], [false, "🚫 Visar inte"], [null, "↩️ Efter röster"]].forEach(function (x) {
      if (b.owner === x[0] || (x[0] === null && b.owner == null)) return;
      var btn = el("button", "btn ghost", x[1]); btn.type = "button";
      btn.addEventListener("click", function () {
        btn.disabled = true;
        call("owner_set_bar_sport", { p_key: key(), p_bar_id: b.bar_id, p_shows: x[0] }).then(function () { load(); if (after) after(); });
      });
      acts.appendChild(btn);
    });
    if (isFinite(b.lat)) { var a = el("a", "btn ghost", "🗺️ OSM"); a.href = "https://www.openstreetmap.org/?mlat=" + b.lat + "&mlon=" + b.lng + "#map=18/" + b.lat + "/" + b.lng; a.target = "_blank"; a.rel = "noopener"; acts.appendChild(a); }
    li.appendChild(acts);
    return li;
  }
  var lastQ = "";
  function find(q) {
    lastQ = String(q || "").trim();
    if (lastQ.length < 2) { findBox.innerHTML = ""; return; }
    call("owner_find_bars", { p_key: key(), p_q: lastQ }).then(function (r) {
      findBox.innerHTML = "";
      if (!r || !r.d) return;
      var bars = r.d.bars || [];
      if (!bars.length) { findBox.appendChild(el("p", "note", "Ingen krog med det namnet.")); return; }
      bars.forEach(function (b) { findBox.appendChild(row(b, function () { find(lastQ); })); });
    });
  }
  function load() {
    ensure(); if (!panel || !key()) return;
    call("owner_sport_bars", { p_key: key() }).then(function (r) {
      if (!r || !r.d) return;
      listBox.innerHTML = "";
      var bars = r.d.bars || [];
      if (!bars.length) listBox.appendChild(el("p", "note", "Inga röster än. Folk röstar med 👍 / 👎 i krogens ruta."));
      bars.forEach(function (b) { listBox.appendChild(row(b)); });
      panel.hidden = false;
    });
  }
  function start() {
    var main = $("main"); if (!main) return;
    var was = main.hidden;
    new MutationObserver(function () { if (was && !main.hidden) load(); was = main.hidden; }).observe(main, { attributes: true, attributeFilter: ["hidden"] });
    if (!main.hidden) load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.OLNU_STATS_SPORT = { refresh: load };
})();
