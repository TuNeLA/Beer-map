/* PintsNow — 🧾 owner panel "Logg" for docs/stats.html (agent lgx, migration 0360, owner_pnlog_x). Same owner key as the other
   panels (sessionStorage olnu.ownerKey, olnu_wd_owner_ok on the server). Shows: active users + KB per person, retention D1/D7,
   funnels (onboarding, invite, anonymous counters), feature use, games, step flows, top errors (+ breadcrumbs), crashes,
   slow RPCs, network, jank + tap delay by device, devices, UX (rage / dead taps, quick closes, scroll depth, screen flow),
   map, notifications, install, settings, all events by class. Sections fold (details). */
(function () {
  "use strict";
  var cfg = window.OLNU_CONFIG || {}, sb = null, days = 7, last = null;
  var $ = function (id) { return document.getElementById(id); };
  function key() { try { return sessionStorage.getItem("olnu.ownerKey") || ""; } catch (e) { return ""; } }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function client() {
    if (!cfg.SUPABASE_URL || !window.supabase) return null;
    return sb || (sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }));
  }
  function css() {
    if ($("plg-css")) return;
    var s = el("style"); s.id = "plg-css";
    s.textContent = ".plg table{width:100%;border-collapse:collapse;font:12px var(--hud,monospace);margin:4px 0 10px}" +
      ".plg th{color:var(--muted,#9aa);font-weight:400;text-align:left;border-bottom:1px solid var(--line-soft,#333);padding:4px 6px 4px 0}" +
      ".plg td{padding:4px 6px 4px 0;border-bottom:1px solid var(--line-soft,#333);font-variant-numeric:tabular-nums;word-break:break-word}" +
      ".plg details{border-top:1px solid var(--line-soft,#333);padding:6px 0}.plg summary{cursor:pointer;font:600 13px var(--body,sans-serif);color:var(--text,#eee);padding:4px 0}" +
      ".plg .chips{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0}.plg .chips button{font:12px var(--hud,monospace);color:var(--muted,#9aa);background:transparent;border:1px solid var(--line-soft,#333);border-radius:14px;padding:5px 10px;cursor:pointer}" +
      ".plg .chips button[aria-pressed=true]{color:var(--night,#000);background:var(--amber,#fb3);border-color:var(--amber,#fb3)}" +
      ".plg .kp{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:6px 0}.plg .kp div{border:1px solid var(--line-soft,#333);border-radius:4px;padding:6px}" +
      ".plg .kp b{display:block;font:20px var(--hud,monospace);color:var(--foam,#fff)}.plg .kp span{font-size:11px;color:var(--muted,#9aa)}" +
      ".plg .bc{font-size:11px;color:var(--muted,#9aa)}.plg .warn{color:var(--red,#f55)}" +
      "@media (max-width:480px){.plg .kp{grid-template-columns:1fr 1fr}}";
    document.head.appendChild(s);
  }
  function table(head, rows) {
    var t = el("table"), tr = el("tr");
    head.forEach(function (h) { tr.appendChild(el("th", null, h)); }); t.appendChild(tr);
    rows.forEach(function (r) { var x = el("tr"); r.forEach(function (c) { var td = el("td"); if (c && c.nodeType) td.appendChild(c); else td.textContent = c == null ? "–" : typeof c === "object" ? JSON.stringify(c) : String(c); x.appendChild(td); }); t.appendChild(x); });
    if (!rows.length) { var e = el("tr"), td = el("td", null, "Inga data än."); td.colSpan = head.length; e.appendChild(td); t.appendChild(e); }
    return t;
  }
  function pct(a, b) { return b ? Math.round(100 * a / b) + " %" : "–"; }
  function r1(v) { return v == null ? null : Math.round(v * 10) / 10; }
  function kp(box, items) { var g = el("div", "kp"); items.forEach(function (x) { var d = el("div"); d.appendChild(el("b", null, x[1] == null ? "–" : String(x[1]))); d.appendChild(el("span", null, x[0])); g.appendChild(d); }); box.appendChild(g); }
  function sec(box, title, open, fill) {
    var d = el("details"); if (open) d.open = true; d.appendChild(el("summary", null, title));
    var b = el("div"); d.appendChild(b); box.appendChild(d);
    try { fill(b); } catch (e) { b.appendChild(el("p", "warn", "Fel i sektionen: " + e.message)); }
  }
  function panel() {
    var p = $("pLogg"); if (p) return p;
    p = el("section", "panel plg"); p.id = "pLogg"; p.hidden = true;
    var h = el("h2", null, "🧾 Logg "); var c = el("span"); c.id = "pLoggN"; h.appendChild(c); p.appendChild(h);
    var box = el("div"); box.id = "pLoggB"; p.appendChild(box);
    p.appendChild(el("p", "note", "Från pnlog.js + pnlog-hooks.js (migration 0360). Klasser: KEEP = diagnostik (skickas också i lite/optin utan ja), USE = användning, HEAVY = mycket användning (tryck, flikar, kartvy; av med flaggan heavy). " +
      "Läge: insert into public.pn_log_opts (key, value) values ('mode','optin') on conflict (key) do update set value = excluded.value; · Heavy av: update public.pn_log_opts set value = 'off' where key = 'heavy';"));
    var after = $("pPnQ") || $("pPnU") || $("pVit");
    if (after && after.parentNode) after.parentNode.insertBefore(p, after.nextSibling); else if ($("main")) $("main").appendChild(p);
    return p;
  }
  function draw(a) {
    last = a;
    var p = panel(), box = $("pLoggB"); box.textContent = ""; p.hidden = false;
    $("pLoggN").textContent = "· läge " + a.mode + (a.heavy ? " + heavy" : " (heavy av)") + " · " + a.days + " dar";
    var ch = el("div", "chips");
    [1, 7, 30].forEach(function (d) { var b = el("button", null, d === 1 ? "I natt" : d + " dar"); b.type = "button"; b.setAttribute("aria-pressed", String(d === days)); b.onclick = function () { days = d; load(); }; ch.appendChild(b); });
    box.appendChild(ch);
    var act = a.active || [], lastN = act[act.length - 1] || {}, cr = a.crash || {};
    kp(box, [["Pers senaste natt", lastN.users], ["Sessioner", act.reduce(function (s, x) { return s + (x.sessions | 0); }, 0)], ["KB/pers (snitt)", lastN.kb_user], ["KB/pers (max)", lastN.kb_max]]);
    kp(box, [["Sessioner utan fel", cr.sessions ? pct(cr.sessions - cr.err_sessions, cr.sessions) : null], ["Omladdning efter fel", cr.reloads], ["Med öl i natt", lastN.beer_users], ["Kanaler", (a.channels || []).map(function (x) { return x.ch + ":" + x.users; }).join(" ")]]);

    sec(box, "👥 Aktiva per natt", true, function (b) {
      b.appendChild(table(["Natt", "Pers", "Sessioner", "Händelser", "KB/pers", "KB max", "Pers med öl"], act.map(function (x) { return [x.day, x.users, x.sessions, x.events, x.kb_user, x.kb_max, x.beer_users]; })));
    });
    sec(box, "🔁 Retention (nya konton)", false, function (b) {
      b.appendChild(table(["Startdag", "Nya", "D1", "D7 (±1)", "Kom tillbaka"], (a.retention || []).map(function (x) { return [x.d0, x.n, x.d1 + " (" + pct(x.d1, x.n) + ")", x.d7 + " (" + pct(x.d7, x.n) + ")", pct(x.back, x.n)]; })));
      b.appendChild(el("p", "note", "Aktiv = loggade händelser, en öl eller en incheckning den natten. D7 = natt 6–8 efter start."));
    });
    sec(box, "🪜 Trattar", true, function (b) {
      var o = a.funnel_ob || {}, pg = a.pings || {};
      b.appendChild(el("h3", null, "Ny användare (personer som såg introt)"));
      b.appendChild(table(["Steg", "Pers", "Andel"], [["Intro visades", o.intro, "100 %"], ["Intro klart", o.done, pct(o.done, o.intro)], ["Första ölen", o.beer, pct(o.beer, o.intro)],
        ["Gick med / skapade grupp", o.group, pct(o.group, o.intro)], ["Bjöd in någon", o.invite, pct(o.invite, o.intro)]]));
      b.appendChild(table(["Intro-steg", "Pers"], (o.steps || []).map(function (x) { return [x.k, x.users]; })));
      b.appendChild(el("h3", null, "Inbjudningslänkar (sessioner)"));
      b.appendChild(table(["Länk", "Öppnade", "Hade konto", "Fick konto", "Gick med"], (a.funnel_inv || []).map(function (x) { return [x.k, x.opened, x.had_acct, x.made_acct, x.joined]; })));
      b.appendChild(el("h3", null, "Utan konto (anonyma räknare, bara antal)"));
      b.appendChild(table(["Nyckel", "Antal"], Object.keys(pg).sort().map(function (k) { return [k, pg[k]]; })));
      b.appendChild(el("h3", null, "Delat / kopierat"));
      b.appendChild(table(["Typ", "Vad", "Resultat", "Antal", "Pers"], (a.shares || []).map(function (x) { return [x.n, x.k, x.r, x.cnt, x.users]; })));
    });
    sec(box, "🧩 Funktioner", true, function (b) {
      b.appendChild(table(["Funktion", "Gånger", "Pers", "Misslyckade"], (a.features || []).map(function (x) { return [x.f, x.cnt, x.users, x.fails]; })));
    });
    sec(box, "🎲 Spel", false, function (b) {
      b.appendChild(table(["Spel", "Start", "Klart", "Avbrutna", "Sek (klart)", "Spelare", "Varför avbrutet"], (a.games || []).map(function (x) { return [x.k, x.starts, x.ends, x.quits, x.sec_end, x.players, x.why ? Object.keys(x.why).join(", ") : ""]; })));
      b.appendChild(el("h3", null, "Steg-flöden (avatar, konto …)"));
      b.appendChild(table(["Flöde", "Startade", "Klara", "Avbrutna", "Avbröt vid"], (a.flows || []).map(function (x) { return [x.f, x.started, x.done, x.quit, (x.quit_at || []).map(function (z) { return z.k + "×" + z.n; }).join(" ")]; })));
    });
    sec(box, "🐞 Fel", true, function (b) {
      b.appendChild(table(["Typ", "Fel", "Var", "Skärm", "Antal", "Pers", "Version", "Senaste tryck före"], (a.errors || []).map(function (x) { return [x.n.replace("err.", ""), x.m, x.f, x.s, x.cnt, x.users, x.ver, el("span", "bc", x.bc || "")]; })));
    });
    sec(box, "🐢 Långsamma serveranrop", false, function (b) {
      b.appendChild(table(["Funktion", "Anrop", "Fel", "p95 (median)", "p95 (max)"], (a.slow_rpc || []).map(function (x) { return [x.fn, x.calls, x.errs, Math.round(x.p95_med), Math.round(x.p95_max)]; })));
    });
    sec(box, "📶 Nät", false, function (b) {
      b.appendChild(table(["Typ", "Anrop", "HTTP-fel", "Avbrutna", "> 3 s", "Försök igen", "p95 ms"], (a.net || []).map(function (x) { return [x.k, x.n, x.f, x.x, x.slow, x.retry, Math.round(x.p95 || 0)]; })));
      b.appendChild(table(["Typ", "Status", "Vad", "Antal", "Pers", "Offline"], (a.net_fail || []).map(function (x) { return [x.k, x.st, x.what, x.cnt, x.users, x.offline]; })));
      var off = a.offline || {}; b.appendChild(el("p", "note", "Offline-perioder: " + (off.n || 0) + (off.p50 != null ? ", median " + Math.round(off.p50) + " s" : "")));
    });
    sec(box, "📱 Hack och fördröjning per enhet", true, function (b) {
      b.appendChild(el("h3", null, "Bildrutor (karta / meny öppnas / scroll)"));
      b.appendChild(table(["System", "Modell", "När", "Sessioner", "Rutor", "Hack %", "FPS", "Värsta ms"], (a.jank || []).map(function (x) { return [x.os, x.mdl, x.c, x.sess, x.frames, x.jank_pct, x.fps, x.worst_ms]; })));
      b.appendChild(el("h3", null, "Tryck-fördröjning (INP, bara ≥ 40 ms)"));
      b.appendChild(table(["System", "Modell", "Var", "Antal", "p75 ms", "> 200 ms"], (a.inp || []).map(function (x) { return [x.os, x.mdl, x.c, x.n, Math.round(x.v), x.n200]; })));
      b.appendChild(el("h3", null, "Kartan syns (ms, p50)"));
      b.appendChild(table(["System", "Modell", "Starter", "ms"], (a.boot_dev || []).map(function (x) { return [x.os, x.mdl, x.n, Math.round(x.map_p50)]; })));
      b.appendChild(el("h3", null, "Enheter"));
      b.appendChild(table(["System", "Version", "Webbläsare", "Modell", "Minne GB", "Sessioner"], (a.devices || []).map(function (x) { return [x.os, x.osv, x.br, x.mdl, x.mem, x.sessions]; })));
    });
    sec(box, "🤔 UX", false, function (b) {
      var u = a.ux || {};
      b.appendChild(el("h3", null, "Arga tryck (3+ på samma ställe < 1 s)"));
      b.appendChild(table(["Skärm", "Knapp", "Antal", "Pers"], (u.rage || []).map(function (x) { return [x.s, x.k, x.n, x.users]; })));
      b.appendChild(el("h3", null, "Döda tryck (inget hände)"));
      b.appendChild(table(["Skärm", "Element", "Antal", "Pers"], (u.dead || []).map(function (x) { return [x.s, x.k, x.n, x.users]; })));
      b.appendChild(el("h3", null, "Trögaste knappar (> 200 ms)"));
      b.appendChild(table(["Knapp", "Var", "Antal", "Värsta ms"], (u.slow || []).map(function (x) { return [x.k, x.c, x.n, x.worst]; })));
      b.appendChild(el("h3", null, "Menyer: stängd snabbt (< 2 s), scroll, tid"));
      b.appendChild(table(["Meny", "Stängd", "Snabbt", "Scroll %", "Sek p50", "Hur"], (u.sheets || []).map(function (x) { return [x.s, x.n, x.quick + " (" + pct(x.quick, x.n) + ")", x.scroll, r1(x.sec50), x.how ? Object.keys(x.how).join(" ") : ""]; })));
      var ch2 = u.close_how || {};
      b.appendChild(el("p", "note", "Stängt med: " + Object.keys(ch2).map(function (k) { return k + " " + ch2[k]; }).join(" · ") + " (x = kryss, bg = utanför, back = tillbaka, swipe = dra, esc, code = appen själv). Tillbaka på kartan: " + (u.back || 0)));
      b.appendChild(el("h3", null, "Skärmflöde (från → till)"));
      b.appendChild(table(["Från", "Till", "Antal", "Sek på förra (p50)"], (u.flow || []).map(function (x) { return [x.fr, x.s, x.n, x.dw50]; })));
      b.appendChild(el("h3", null, "Sökfält"));
      b.appendChild(table(["Skärm", "Fält", "Sökningar", "Tecken (snitt)"], (u.search || []).map(function (x) { return [x.s, x.k, x.n, x.len]; })));
    });
    sec(box, "🗺️ Karta", false, function (b) {
      var m = a.map || {};
      kp(b, [["Sessioner", m.sessions], ["Zoom", m.zooms], ["Panorera", m.pans], ["Nyp", m.pinch]]);
      kp(b, [["Tryck kluster", m.cluster], ["Tryck krog", m.bar], ["Tryck pin", m.pin], ["Långtryck", m.longpress]]);
      b.appendChild(table(["Zoomnivå", "Gånger"], Object.keys(m.zoom || {}).sort(function (x, y) { return x - y; }).map(function (z) { return [z, m.zoom[z]]; })));
      b.appendChild(el("p", "note", "Kartstil: " + JSON.stringify(m.styles || {}) + " · sessioner med spökläge: " + (m.ghost_sess || 0)));
    });
    sec(box, "🔔 Notiser, installation, inställningar", false, function (b) {
      b.appendChild(table(["Händelse", "Typ", "Antal", "Pers"], (a.ntf || []).map(function (x) { return [x.n, x.k, x.cnt, x.users]; })));
      b.appendChild(el("p", "note", "ntf.rx = kom fram, ntf.clk = trycktes, ntf.x = bortsvept, ntf.open = appen öppnades av en notis, ntf.ask = frågan om notiser (svar)."));
      var ins = a.inst || {}; b.appendChild(el("p", null, "Installation: " + (Object.keys(ins).map(function (k) { return k + " " + ins[k]; }).join(" · ") || "–")));
      b.appendChild(table(["Typ", "Inställning", "Värde", "Antal", "Pers"], (a.settings || []).map(function (x) { return [x.n, x.k, x.v, x.cnt, x.users]; })));
    });
    sec(box, "📚 Alla händelser", false, function (b) {
      b.appendChild(table(["Händelse", "Klass", "Antal", "Pers"], (a.events || []).map(function (x) { return [x.n, x.cls, x.cnt, x.users]; })));
    });
  }
  function load() {
    if (!key()) return;
    var c = client(); if (!c) return;
    css();
    c.rpc("owner_pnlog_x", { p_key: key(), p_days: days }).then(function (r) { if (!r.error && r.data && r.data.message !== "forbidden") draw(r.data); }, function () {});
  }
  function start() {
    var main = $("main"); if (!main) return;
    var was = main.hidden;
    new MutationObserver(function () { if (was && !main.hidden) load(); was = main.hidden; }).observe(main, { attributes: true, attributeFilter: ["hidden"] });
    if (!main.hidden) load();
    setInterval(function () { if (document.visibilityState === "visible" && !main.hidden) load(); }, 300000);
  }
  window.PNLOG_LOGG = { load: load, _draw: draw, _last: function () { return last; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
