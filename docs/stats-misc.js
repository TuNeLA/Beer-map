/* PintsNow — ⭐ owner panel "Grundare" for docs/stats.html (misc F4, migration 0401).
   Same owner key as the other panels (sessionStorage olnu.ownerKey; checked on the server by olnu_wd_owner_ok).
   Shows the launch cutoff (or "inte satt"), how many accounts are founders, and sets the cutoff ONCE at store launch:
   every account made before it keeps Premium forever (owner_set_founder_cutoff marks them; marks are never taken away).
   Set = an inline confirm step (no browser dialog). Missing RPC → the panel stays hidden. */
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
    return c.rpc(name, params).then(function (r) {
      if (r.error) return { err: String(r.error.message || "error") };
      return !r.data || r.data.message === "forbidden" ? null : { d: r.data };
    }, function () { return null; });
  }
  var nf = new Intl.NumberFormat("sv-SE");
  function when(t) {
    try { return new Intl.DateTimeFormat("sv-SE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Stockholm" }).format(new Date(t)); } catch (e) { return String(t); }
  }
  function localNow() { var d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  function panel() {
    var p = $("pFounders"); if (p) return p;
    p = el("section", "panel"); p.id = "pFounders"; p.hidden = true;
    p.appendChild(el("h2", null, "⭐ Grundare (Premium för alltid)"));
    var box = el("div"); box.id = "xFounders"; p.appendChild(box);
    p.appendChild(el("p", "note", "Sätt lanseringsdatumet EN gång, när appen kommer ut i butikerna. Alla konton som skapats före det blir grundare: " +
      "de får Premium för alltid och ett litet \"Grundare\"-märke i Profil. Märkena tas aldrig bort, även om du flyttar datumet."));
    var anchor = $("pUgc") || $("pWishes") || $("pRep");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(p, anchor.nextSibling); else if ($("main")) $("main").appendChild(p);
    return p;
  }
  function draw(d) {
    var p = panel(), box = $("xFounders"); box.textContent = "";
    box.appendChild(el("div", "x-ev-h", d.cutoff ? "Lanseringsdatum: " + when(d.cutoff) : "Lanseringsdatum: inte satt än (alla räknas som grundare)"));
    box.appendChild(el("div", "x-sub", nf.format(d.founders || 0) + " grundare av " + nf.format(d.users || 0) + " konton · " + nf.format(d.marks || 0) + " märkta" +
      (d.set_at ? " · satt " + when(d.set_at) : "")));
    var row = el("div", "x-acts"), inp = el("input"); inp.type = "datetime-local"; inp.id = "xFoundersAt"; inp.value = localNow();
    inp.setAttribute("aria-label", "Lanseringsdatum");
    var go = el("button", "btn ghost", d.cutoff ? "Flytta datumet" : "Sätt lanseringsdatum"); go.type = "button"; go.setAttribute("data-act", "set");
    var out = el("div", "x-sub"); out.id = "xFoundersOut";
    go.addEventListener("click", function () {
      if (!inp.value) return;
      var at = new Date(inp.value);
      out.textContent = "";
      var q = el("div", "x-acts");
      q.appendChild(el("span", "x-sub", "Säker? Alla konton före " + when(at) + " får Premium för alltid."));
      var yes = el("button", "btn", "Ja, sätt datumet"); yes.type = "button"; yes.setAttribute("data-act", "yes");
      var no = el("button", "btn ghost", "Avbryt"); no.type = "button";
      no.addEventListener("click", function () { out.textContent = ""; });
      yes.addEventListener("click", function () {
        yes.disabled = true; no.disabled = true;
        call("owner_set_founder_cutoff", { p_key: key(), p_at: at.toISOString() }).then(function (r) {
          if (!r || r.err) { out.textContent = r && /invalid_cutoff/.test(r.err) ? "Datumet måste vara inom ett år bakåt eller framåt." : "Det gick int' att spara. Försök igen."; return; }
          out.textContent = "Klart: " + nf.format(r.d.new_marks || 0) + " nya grundare märkta.";
          load();
        });
      });
      q.appendChild(yes); q.appendChild(no); out.appendChild(q);
    });
    row.appendChild(inp); row.appendChild(go);
    box.appendChild(row); box.appendChild(out);
    p.hidden = false;
  }
  function load() { if (!key()) return; call("owner_founders", { p_key: key() }).then(function (r) { if (r && r.d && r.d.v === 1) draw(r.d); }); }
  function start() {
    var main = $("main"); if (!main) return;
    var was = main.hidden;
    new MutationObserver(function () { if (was && !main.hidden) load(); was = main.hidden; }).observe(main, { attributes: true, attributeFilter: ["hidden"] });
    if (!main.hidden) load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.OLNU_STATS_FOUNDERS = { refresh: load };
})();
