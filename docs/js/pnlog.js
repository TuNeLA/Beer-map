/* PintsNow — 📊 PNLOG: usage log + check-in validation (position) log. Migration 0330 (pnlog_ingest). Owner panel: stats-pnlog.js.
   One file for the live app (main) and big-update. Never blocks a tap: events go into an in-memory list (no storage on the
   phone except the two switches + "notice shown"), sent as ONE request per ~60 s (idle time) and at pagehide (fetch keepalive).
   Direct fetch to /rest/v1/rpc/pnlog_ingest with the stored session (not api.rpc: no WARM cache churn, never makes an account).
   A. USAGE (switch "Hjälp till att förbättra appen", default on): app open/hide, taps (stable key: data-* / id / class, never text),
      sheets (known title or emoji + structure, never names), RPC features + failures (function name + code), JS errors, perf
      (boot, load, fcp, lcp, cls, map ready, sheet open ms, long tasks, RPC p95). Errors (no position) are always sent.
   B. POSITION (switch "Spara position för bättre incheckning"): readings max 1/min while visible (only when location is
      already allowed: never a prompt), auto check-in decisions (AUTOCI.listen, big-update), check-ins/outs, beer posts.
      Not in ghost mode; inside the home zone only "home" (no coordinates). One short notice the first time.
   Server flag pn_log_flags.beta_logging: on (beta: A + B on by default) | optin (store: only errors unless the user says yes
   on one screen) | off (errors only) | none. Store builds (OLNU_STORE) act as optin.
   Public: window.PNLOG = { event(name, props), loc(kind, data), flush(), state(), settingsSheet, init, onAuthed, _cfg }. */
(function () {
  "use strict";
  var CFG = window.OLNU_CONFIG || {};
  var K_EV = "olnu.logEv", K_LOC = "olnu.logLoc", K_NOTE = "olnu.logNote", K_CONS = "olnu.logCons", K_MODE = "olnu.logMode";
  var FLUSH_MS = 60e3, MAX_BATCH = 200, MAX_Q = 400, MAX_L = 60, FIX_MS = 55e3, OWN_FIX_MS = 60e3;
  var A = null, T0 = Date.now(), sess = rnd(), sq = 0, Q = [], L = [], dropped = 0, dead = false;
  var selfMs = 0, sent = 0, lastFlush = 0, flushing = false, lastDown = 0, lastFixAt = 0, lastFix = null, errSeen = {};
  var rpcAgg = {}, longN = 0, longMs = 0, cls = 0, lcp = 0, hiddenAt = 0, visStart = Date.now(), screen = "map", sheetAt = 0, mapAt = 0;
  var OPTS = { flushMs: FLUSH_MS }, lastSum = Date.now();
  var TITLES = /*PNLOG_TITLES*/["Byt namn", "Chefens val", "Din inloggning gick ut", "Ditt namn (anropssignal)", "Eventet", "Flytta konto", "God morgon!", "Grupper", "Gå med", "Ikväll?", "Kvällens uppdrag", "Lägg PintsNow på hemskärmen", "Mer på kartan", "Min karaktär", "Mina ställen", "PintsNow", "Profil", "Rapportera erbjudande", "Rapportera fel", "Rita krogrunda", "Skapa grupp", "Sluta dricka", "Topplista ikväll", "Truppen", "Var dricker du? 🍺", "Vem går du ut med?", "Vilken grupp delar taxin?", "gruppen", "☀️ Uteväder", "⚔️ Duell · {0}", "⚔️ {0} utmanar er!", "✉️ Byt e-post", "✏️ Entré-info", "➕ Bjud in", "➕ Lägg till ställe här", "🆘 Hämta mig", "🌅 Kom alla hem?", "🌭 Nattmat öppet nu", "🌯 Kebabtoppen", "🌯 Öppet nu", "🍻 Skåltimmen", "🍾 Systemet", "🎁 Öl Wrapped · …", "🎉 Förfestläget", "🎉 Skoj & överraskningar", "🎖️ Hur får jag meriter?", "🎖️ Medaljceremonin", "🎖️ Min uniform", "🎖️ Uniform", "🎖️ …", "🎞️ Engångskameran", "🎲 Vem fixar nästa?", "🎵 Spotify Jam – du ä DJ:n", "🏠 Följ mig hem", "🏠 Hemzon", "👑 Roller", "👥 Vänner & 🧭 Hitta", "💰 Rapportera pris", "📊 Din kväll", "📊 Min kväll", "📋 Lägesrapport", "📍 Din hemstad", "📍 Kom hit!", "📍 Ställen nära dig", "📣 Tipsa gruppen", "📥 Jag har en flyttkod", "📨 Bjud in", "📨 Bjud in fler", "📨 Inbjudan", "📨 Skapa event här", "📰 Kvällens tidning", "📱 Mitt Swish-nummer", "📲 Bjud in vänner", "📸 Engångskamera", "📸 Vem fotar ikväll?", "🔐 Spara kontot", "🔑 Logga in", "🔒 Integritet", "🔔 Vet när gänget drar ut", "🔥 Helgstreak", "🕐 När stänger dom ikväll?", "🗂️ Tidigare event", "🗑️ Radera mitt konto", "🗺️ …", "🚑 Kompisvakt", "🚕 Dela taxin", "🚕 Hemfärd", "🚕 Ta dig hem säkert", "🚪 Logga ut", "🛂 Ölpasset", "🟢 Ute nu i ", "🤕 Bakisrapporten", "🤝 Bli vänner?", "🥃 Sidospår", "🧢 Kapsylsamlingen", "🧭 Hitta ", "🧭 Hitta kompisen", "🧭 Vem vill du hitta?", "🪖 Inkallelse", "Hjälp till?"]/*END*/;   // known sheet titles (exact) and title prefixes ("…" at the end), made by the patch script

  function rnd() { var s = ""; for (var i = 0; i < 10; i++) s += "abcdefghijkmnpqrstuvwxyz23456789".charAt(Math.floor(Math.random() * 32)); return s; }
  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function pnow() { return window.performance && performance.now ? performance.now() : Date.now(); }
  function store() {   // config.js sets OLNU_STORE (big-update); the live app (main) may not have it yet: same test as safety.js
    if (window.OLNU_STORE != null) return !!window.OLNU_STORE;
    try { return !!window.Capacitor || /[?&]app=(android|ios)\b/.test(location.search) || /^android-app:/.test(document.referrer || "") || ls("olnu.store") === "1"; } catch (e) { return false; }
  }
  function mode() {   // effective server mode for this phone
    var m = ls(K_MODE) || "on";
    if (store() && m === "on") m = "optin";
    return m;
  }
  function cons() { return ls(K_CONS) === "1"; }
  function fullOn() {   // usage events
    var m = mode(); if (m === "none" || m === "off") return false;
    if (ls(K_EV) === "0") return false;
    return m === "on" || cons();
  }
  function locOn() {
    var m = mode(); if (m === "none" || m === "off") return false;
    if (ls(K_LOC) === "0") return false;
    return m === "on" || cons();
  }
  function errOn() { return mode() !== "none"; }
  function ch() {
    if (store()) return "store";
    try { if (window.PN_BETA || document.getElementById("olnu-beta")) return "beta"; } catch (e) {}
    return "stable";
  }
  function ver() {
    try { var s = document.querySelector('script[src*="app.js"]'); var v = s && (s.getAttribute("src").match(/v=([\w]+)/) || [])[1]; return (window.PN_BETA ? String(window.PN_BETA).slice(0, 8) : v) || "?"; } catch (e) { return "?"; }
  }

  /* ---------- privacy guard: no text, no ids, no e-mail, no positions in usage props ---------- */
  var BLOCK = { lat: 1, lng: 1, lon: 1, name: 1, text: 1, msg: 1, body: 1, email: 1, phone: 1, code: 1, title: 1, q: 1, uid: 1, user: 1 };
  function scrub(s, max) {
    return String(s == null ? "" : s).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "#")
      .replace(/\S+@\S+/g, "#").replace(/@/g, " ").replace(/\d{4,}/g, "#").replace(/\s+/g, " ").trim().slice(0, max || 60);
  }
  function clean(p) {
    var o = {}, n = 0;
    if (!p || typeof p !== "object") return o;
    Object.keys(p).forEach(function (k) {
      if (n >= 12 || BLOCK[k] || !/^[a-z][a-z0-9_]{0,15}$/.test(k)) return;
      var v = p[k];
      if (typeof v === "number") { if (isFinite(v)) { o[k] = Math.round(v * 100) / 100; n++; } }
      else if (typeof v === "boolean") { o[k] = v; n++; }
      else if (typeof v === "string") { o[k] = scrub(v, k === "m" ? 140 : 64); n++; }
    });
    return o;
  }

  /* ---------- queue ---------- */
  function push(name, p, force) {
    if (dead) return;
    var isErr = name.indexOf("err.") === 0;
    if (!(isErr ? errOn() : fullOn()) && !force) return;
    var t = pnow();
    Q.push({ at: Date.now(), n: name, p: clean(p) });
    if (Q.length > MAX_Q) {   // memory cap: drop the oldest taps first, then the oldest of anything
      var i = 0; while (i < Q.length && Q[i].n !== "tap") i++;
      Q.splice(i < Q.length ? i : 0, 1); dropped++;
    }
    if (Q.length >= MAX_BATCH) soon();
    selfMs += pnow() - t;
  }
  function event(name, props) {   // public, generic (other modules: PNLOG.event("pf.start", {…}))
    try { if (/^[a-z][a-z0-9_.:-]{0,39}$/.test(String(name))) push(String(name), props); } catch (e) {}
  }
  function locRow(kind, x) {
    if (dead || !locOn()) return;
    var t = pnow();
    var r = { at: Date.now(), k: kind };
    if (x) {
      if (isFinite(x.la) && isFinite(x.ln)) { r.la = Math.round(x.la * 1e6) / 1e6; r.ln = Math.round(x.ln * 1e6) / 1e6; }
      if (isFinite(x.a)) r.a = Math.round(x.a);
      if (x.b != null) r.b = String(x.b).slice(0, 64);
      if (x.d && typeof x.d === "object") r.d = x.d;
    }
    var c = myCi(); if (c) r.ci = c;
    L.push(r);
    if (L.length > 240) L.splice(0, L.length - 240);
    if (L.length >= MAX_L) soon();
    selfMs += pnow() - t;
    noticeOnce();
  }
  function myCi() { try { var c = A && A.myCheckin ? A.myCheckin() : null; return c ? String(c.id) : null; } catch (e) { return null; } }

  /* ---------- sending ---------- */
  function token() {
    try {
      var a = JSON.parse(localStorage.getItem("olnu.auth") || "null"), s = a && (a.currentSession || a);
      if (!s || !s.access_token) return null;
      if (s.expires_at && s.expires_at * 1000 < Date.now() + 5000) return null;
      return s.access_token;
    } catch (e) { return null; }
  }
  var soonT = 0;
  function soon() {
    if (soonT) return;
    soonT = setTimeout(function () { soonT = 0; idle(function () { flush(false); }); }, 50);
  }
  function idle(fn) {
    if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 5000 }); else setTimeout(fn, 200);
  }
  function rpcSummary() {   // RPC timings since the last batch → perf.rpc events (max 15 functions)
    Object.keys(rpcAgg).sort(function (a, b) { return rpcAgg[b].n - rpcAgg[a].n; }).slice(0, 15).forEach(function (fn) {
      var x = rpcAgg[fn], s = x.ms.sort(function (a, b) { return a - b; });
      push("perf.rpc", { fn: fn, n: x.n, v: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], e: x.e });
    });
    rpcAgg = {};
  }
  function build(max) {
    var base = Date.now();
    var evs = Q.splice(0, max || MAX_BATCH), locs = L.splice(0, MAX_L);
    var t0 = Math.min.apply(null, [base].concat(evs.map(function (e) { return e.at; }), locs.map(function (l) { return l.at; })));
    var b = { v: 1, t0: t0, ver: ver(), ch: ch(), sess: sess, sq: ++sq, cons: cons(),
      ev: evs.map(function (e) { return { t: e.at - t0, n: e.n, p: e.p }; }),
      loc: locs.map(function (l) { var o = { t: l.at - t0, k: l.k }; ["la", "ln", "a", "b", "ci", "d"].forEach(function (k) { if (l[k] != null) o[k] = l[k]; }); return o; }) };
    if (dropped) { b.ev.push({ t: base - t0, n: "log.drop", p: { v: dropped } }); dropped = 0; }
    return { b: b, evs: evs, locs: locs };
  }
  function flush(beacon) {
    if (dead || flushing && !beacon) return Promise.resolve(false);
    var t = pnow();
    if (!beacon && Date.now() - lastSum > 600e3) { rpcSummary(); lastSum = Date.now(); }   // RPC timings: every 10 min + at hide
    if (!Q.length && !L.length) return Promise.resolve(false);
    var tok = token();
    if (!tok || !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) return Promise.resolve(false);   // no account yet: keep the events (capped)
    var x = build(), body = JSON.stringify({ p: x.b });
    while (body.length > 60000 && x.b.ev.length > 20) {   // keepalive limit 64 KB: send fewer, keep the rest
      var back = x.evs.splice(Math.floor(x.evs.length / 2)); Q = back.concat(Q);
      x.b.ev = x.b.ev.slice(0, x.evs.length); body = JSON.stringify({ p: x.b });
    }
    lastFlush = Date.now(); sent++;
    var url = CFG.SUPABASE_URL + "/rest/v1/rpc/pnlog_ingest";
    var opt = { method: "POST", keepalive: true, credentials: "omit",
      headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + tok }, body: body };
    selfMs += pnow() - t;
    if (beacon) { try { fetch(url, opt).catch(function () {}); } catch (e) {} return Promise.resolve(true); }
    flushing = true;
    return fetch(url, opt).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      flushing = false;
      if (d && d.mode) { lsSet(K_MODE, d.mode); if (d.mode === "none") { dead = true; Q = []; L = []; } }
      if (d && d.ok === false && d.reason === "too_soon") { Q = x.evs.concat(Q).slice(-MAX_Q); L = x.locs.concat(L).slice(-240); }
      return !!d;
    }, function () { flushing = false; Q = x.evs.concat(Q).slice(-MAX_Q); L = x.locs.concat(L).slice(-240); return false; });
  }
  setInterval(function () { if (!document.hidden) idle(function () { flush(false); }); }, OPTS.flushMs);
  function bye() {
    if (hiddenAt) return;
    hiddenAt = Date.now();
    push("app.hide", { sec: Math.round((hiddenAt - visStart) / 1000) });
    if (cls) push("perf.cls", { v: Math.round(cls * 1000) / 1000 });
    if (lcp) { push("perf.lcp", { v: Math.round(lcp) }); lcp = 0; }
    if (longN) { push("perf.long", { v: Math.round(longMs), n: longN }); longN = 0; longMs = 0; }
    push("perf.self", { v: Math.round(selfMs * 10) / 10 });
    rpcSummary();
    flush(true);
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) bye();
    else if (hiddenAt) { push("app.show", { away: Math.round((Date.now() - hiddenAt) / 1000) }); hiddenAt = 0; visStart = Date.now(); }
  });
  window.addEventListener("pagehide", bye);

  /* ---------- taps ---------- */
  var GENERIC = /^(btn|btn-[\w-]+|active|on|off|open|sel|selected|row|small|big|pn-swb|ds-item|pi-lead|muted|switch|chip|hidden|is-[\w-]+|has-[\w-]+)$/;
  function safeKey(v) { return scrub(v, 40).replace(/[^\w.:#\-]/g, "").slice(0, 40); }
  function keyOf(el) {
    for (var i = 0, n = el; n && n !== document.body && i < 6; i++, n = n.parentElement) {
      var a = n.getAttribute && (n.getAttribute("data-pn") || n.getAttribute("data-act") || n.getAttribute("data-hx") || n.getAttribute("data-tab") || n.getAttribute("data-k"));
      if (a) return safeKey(a);
      if (n.id && !/^(sheet-body|sheet|map|app)$/.test(n.id)) return safeKey(n.id);
      var c = n.classList ? [].filter.call(n.classList, function (x) { return !GENERIC.test(x) && /^[a-z][a-z0-9_-]{1,30}$/i.test(x); })[0] : null;
      if (c) return safeKey(c);
      var di = n.getAttribute && n.getAttribute("data-id");
      if (di) return "id:" + safeKey(di);
    }
    return el.tagName ? el.tagName.toLowerCase() : "?";
  }
  document.addEventListener("pointerdown", function () { lastDown = pnow(); }, { capture: true, passive: true });
  document.addEventListener("click", function (e) {
    if (!fullOn()) return;
    var t = pnow();
    try {
      var el = e.target && e.target.closest ? e.target.closest("button, a, [role=button], [role=switch], [role=tab], .pill, input, select, label, [data-pn], [data-act], [data-hx]") : null;
      if (el) push("tap", { s: screen, k: keyOf(el) });
    } catch (x) {}
    selfMs += pnow() - t;
  }, { capture: true, passive: true });

  /* ---------- sheets (screens) ---------- */
  var EMO = null; try { EMO = new RegExp("^(\\p{Extended_Pictographic}|\\p{Emoji_Presentation})\\uFE0F?", "u"); } catch (e) {}
  function titleKey(t) {
    t = String(t || "").replace(/\s+/g, " ").trim();
    if (!t) return "?";
    for (var i = 0; i < TITLES.length; i++) {
      var w = TITLES[i];
      if (w.slice(-1) === "…") { var pre = w.slice(0, -1); if (pre.length >= 2 && t.indexOf(pre) === 0) return w; }
      else if (t === w) return w;
    }
    var em = EMO ? t.match(EMO) : null;
    return (em ? em[0] : "") + "…";
  }
  function bodyKey() {
    var b = document.getElementById("sheet-body"); if (!b) return "";
    for (var c = b.firstElementChild, i = 0; c && i < 4; c = c.nextElementSibling, i++) {
      var k = c.classList ? [].filter.call(c.classList, function (x) { return !GENERIC.test(x) && /^[a-z][a-z0-9_-]{1,30}$/i.test(x); })[0] : null;
      if (k) return safeKey(k);
    }
    return "";
  }
  function watchSheet() {
    var sh = document.getElementById("sheet"), ti = document.getElementById("sheet-title");
    if (!sh || sh._pnlog) return; sh._pnlog = 1;
    var open = false, cur = "";
    var check = function () {
      var isOpen = !sh.hidden;
      var key = isOpen ? titleKey(ti && ti.textContent) : "";
      if (isOpen && (!open || key !== cur)) {
        if (open) push("sheet.close", { s: cur, sec: Math.round((Date.now() - sheetAt) / 1000) });
        open = true; cur = key; sheetAt = Date.now(); screen = key;
        var ms = lastDown && pnow() - lastDown < 3000 ? Math.round(pnow() - lastDown) : null;
        var bk = bodyKey(), p = { s: key }; if (bk) p.k = bk; if (ms != null) { p.ms = ms; }
        push("sheet.open", p);
        if (ms != null) push("perf.sheet", { s: key, v: ms });
        if (/Integritet/.test(ti && ti.textContent || "")) setTimeout(privBlock, 0);
      } else if (!isOpen && open) {
        push("sheet.close", { s: cur, sec: Math.round((Date.now() - sheetAt) / 1000) });
        open = false; cur = ""; screen = "map";
      }
    };
    new MutationObserver(check).observe(sh, { attributes: true, attributeFilter: ["hidden"] });
    if (ti) new MutationObserver(check).observe(ti, { childList: true, characterData: true, subtree: true });
  }

  // 🔒 Integritet sheet (v14.js): one more block, the same words as integritet.html
  function privText() {
    var m = mode();
    if (m === "none") return null;
    if (m === "off") return ["Felrapporter (fel i appen, appversion, ingen position) sparas i 30 dagar för att hitta buggar."];
    var pre = m === "on" ? "Under betan, om du int' stänger av det: " : "Bara om du har sagt ja: ";
    return [pre + "vad du trycker på, vilka menyer du öppnar, fel och hur snabb appen ä. Inga texter, inga namn.",
      pre + "din position max 1 gång/min när appen ä öppen, och dina in- och utcheckningar – för att göra automatisk incheckning bättre. Inte i spökläge, inte i hemzonen.",
      "Sparas i 30 dagar, sen tas det bort. Bara vi (PintsNow) ser det. Inga andra företag.",
      "Stäng av i ⚙️ Inställningar → Integritet. Stänger du av positionen tar vi bort det sparade. Felrapporter (utan position) skickas alltid."];
  }
  function privBlock() {
    var b = document.getElementById("sheet-body"); if (!b || b.querySelector(".pnlog-priv") || !A || !A.el) return;
    var items = privText(); if (!items) return;
    var box = A.el("div", { class: "pnlog-priv" }, [A.el("h3", { text: "📊 Användning och position" }),
      A.el("ul", { class: "priv-list" }, items.map(function (x) { return A.el("li", { text: x }); }))]);
    var anchor = [].filter.call(b.querySelectorAll("h3"), function (h) { return /Det gör vi|Radera/.test(h.textContent); })[0];
    if (anchor) b.insertBefore(box, anchor); else b.appendChild(box);
  }

  /* ---------- errors ---------- */
  function errOnce(name, p) {
    var k = name + (p.m || "") + (p.f || "");
    errSeen[k] = (errSeen[k] || 0) + 1;
    if (errSeen[k] <= 3) push(name, p);
  }
  window.addEventListener("error", function (e) {
    if (!e || e.target && e.target !== window && e.target.tagName) return;   // a broken image etc. is not an app error
    var f = String(e.filename || "").split("?")[0].split("/").pop();
    errOnce("err.js", { m: String(e.message || "error"), f: f ? f + ":" + (e.lineno || 0) : "" });
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason; errOnce("err.rej", { m: String((r && (r.message || r)) || "rejection") });
  });

  /* ---------- RPCs: wrap the supabase client once (never runs a request twice) ---------- */
  var FEATURE = /^(post_|check_in|check_out|join_|ev_join|ev_preview|create_|skal|react|set_|add_|report_|send_|rally|invite|stop_beer|undo|guess_|vote|pickup|skjuts|delete_my|account_|film_|party_|spel_)/;
  function wrapClient() {
    var c = null; try { c = A && A.client ? A.client() : null; } catch (e) {}
    if (!c || typeof c.rpc !== "function" || c.rpc._pnlog) return;
    var orig = c.rpc;
    var w = function (name, params) {
      var q = orig.apply(this, arguments), s = pnow();
      try {
        if (q && typeof q.then === "function") {
          var ot = q.then;
          q.then = function (res, rej) {
            return ot.call(q, function (r) { try { seen(name, params, r, pnow() - s); } catch (e) {} return res ? res(r) : r; }, rej);
          };
        }
      } catch (e) {}
      return q;
    };
    w._pnlog = 1; c.rpc = w;
  }
  function seen(fn, params, r, ms) {
    if (fn === "pnlog_ingest") return;
    var err = r && r.error, a = rpcAgg[fn] || (rpcAgg[fn] = { n: 0, e: 0, ms: [] });
    a.n++; if (a.ms.length < 200) a.ms.push(Math.round(ms)); if (err) a.e++;
    var d = null; try { d = !err && A && A.parseData ? A.parseData(r.data) : null; } catch (e) {}
    var ok = !err && !(d && d.ok === false);
    if (err) errOnce("err.rpc", { fn: fn, c: String(err.code || err.message || "error").slice(0, 40) });
    if (FEATURE.test(fn) && !/(_mine|_state|_status|_poll|_list|_get|_feed|_group)$/.test(fn)) push("rpc", { fn: fn, ok: ok, ms: Math.round(ms) });
    if (!ok) return;
    params = params || {};
    if (fn === "check_in") locRow("ci", withFix({ b: params.p_bar_id, d: { src: autoSrc() } }));
    else if (fn === "check_out") locRow("co", withFix({ d: { src: autoSrc() } }));
    else if (/^post_beer/.test(fn)) locRow("beer", { la: +params.p_lat, ln: +params.p_lng, d: { pr: params.p_precise === false ? 0 : 1, gh: params.p_hidden ? 1 : 0 } });
  }
  var acSrc = null;
  function autoSrc() { var s = acSrc && Date.now() - acSrc.at < 8000 ? acSrc.s : "hand"; acSrc = null; return s; }
  function withFix(x) {
    var f = lastFix; if (!f) { try { var st = window.AUTOCI && window.AUTOCI.state ? window.AUTOCI.state().last : null; if (st) f = { la: st.lat, ln: st.lng, a: st.acc, at: st.t }; } catch (e) {} }
    if (f && Date.now() - f.at < 3 * 60e3 && !hidePos(f.la, f.ln)) { x.la = f.la; x.ln = f.ln; x.a = f.a; x.d = x.d || {}; x.d.age = Math.round((Date.now() - f.at) / 1000); }
    return x;
  }
  function ghost() { try { return !!(window.EXTRAS && window.EXTRAS.ghostOn && window.EXTRAS.ghostOn()); } catch (e) { return false; } }
  function atHome(la, ln) { try { return !!(window.PRIVACY && window.PRIVACY.inHome && window.PRIVACY.inHome(la, ln)); } catch (e) { return false; } }
  function hidePos(la, ln) { return ghost() || atHome(la, ln); }

  /* ---------- position readings ---------- */
  function fix(la, ln, acc, src) {
    if (!locOn() || !isFinite(la) || !isFinite(ln)) return;
    var now = Date.now();
    lastFix = { la: la, ln: ln, a: acc, at: now };
    if (now - lastFixAt < FIX_MS) return;
    lastFixAt = now;
    if (ghost()) return;
    if (atHome(la, ln)) { locRow("fix", { d: { home: 1, src: src } }); return; }
    locRow("fix", { la: la, ln: ln, a: acc, d: { src: src } });
  }
  var permOk = false, ownT = 0, asking = false;
  function perm() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return;
      navigator.permissions.query({ name: "geolocation" }).then(function (p) { permOk = p.state === "granted"; p.onchange = function () { permOk = p.state === "granted"; }; }, function () {});
    } catch (e) {}
  }
  function ownSampler() {   // main (no autoci): one reading per minute while visible, only if already allowed
    if (ownT) return;
    perm();
    ownT = setInterval(function () {
      if (document.hidden || !permOk || asking || !locOn() || !A || !A.authed || !A.authed() || !navigator.geolocation) return;
      if (window.AUTOCI && window.AUTOCI.listen) return;
      asking = true;
      try {
        navigator.geolocation.getCurrentPosition(function (p) { asking = false; fix(+p.coords.latitude, +p.coords.longitude, +p.coords.accuracy, "own"); },
          function () { asking = false; }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 });
      } catch (e) { asking = false; }
    }, OWN_FIX_MS);
  }
  function hookAutoci() {   // big-update: autoci.js tells us every reading and decision (it keeps its own thresholds)
    var AC = window.AUTOCI; if (!AC || !AC.listen || AC._pnlog) return false;
    AC._pnlog = 1;
    AC.listen(function (type, x) {
      x = x || {};
      if (type === "fix") fix(x.lat, x.lng, x.acc, "ac");
      else if (type === "eval") locRow("eval", { d: { m: x.mode, s: (x.spots || []).slice(0, 5), w: x.win || null, n: x.n || 0, cl: x.clear ? 1 : 0, a: x.acc != null ? Math.round(x.acc) : null } });
      else if (type === "decide") {
        if (x.act === "auto") { acSrc = { s: "auto", at: Date.now() }; locRow("auto_in", { b: x.b, d: { act: "auto" } }); }
        else if (x.act === "checkout") { acSrc = { s: "auto_" + x.why, at: Date.now() }; locRow(x.why === "undo" ? "answer" : "auto_out", { b: x.b, d: { act: "checkout", why: x.why } }); }
        else locRow("ask", { b: x.b, d: { act: x.act, b2: x.b2 || null } });
      } else if (type === "answer") {
        if (x.ans === "accepted" || x.ans === "picked") acSrc = { s: "ask", at: Date.now() };
        locRow("answer", { b: x.b || null, d: { ans: x.ans, ids: x.ids || null } });
      }
      if (type !== "fix") push("ac." + type, { act: x.act || x.ans || x.mode || "", why: x.why || "" });
    });
    return true;
  }

  /* ---------- notice (beta: info only) and the one-screen ask (store / optin) ---------- */
  var noted = false;
  function noticeOnce() {
    if (noted || ls(K_NOTE) === "1" || mode() !== "on" || !A || !A.toast) return;
    noted = true;
    // wait for a calm moment: no sheet, no toast, no tap for 20 s (never on top of the ÖL! strip, a takeover or a question)
    var calmT = setInterval(function () {
      if (document.hidden || (A.sheetOpen && A.sheetOpen()) || pnow() - lastDown < 20000) return;
      var tb = document.getElementById("toasts"); if (tb && tb.children.length) return;
      if (document.querySelector(".takeover:not([hidden]), .mx-pop, .bt-strip:not([hidden]), #intro:not([hidden])")) return;
      clearInterval(calmT); showNote();
    }, 5000);
  }
  function showNote() {
    if (ls(K_NOTE) === "1") return;
    lsSet(K_NOTE, "1");
    (function () {
      try {
        A.toast("Under betan sparar vi din position under kvällen för att förbättra incheckningen (30 dagar). Stäng av i Inställningar.",
          { id: "pnlog-note", ms: 12000, cls: "pnlog-note", action: { label: "Ändra", fn: function () { var b = document.getElementById("btn-settings"); if (b) b.click(); } } });
      } catch (e) {}
      push("log.notice", {});
    })();
  }
  function askOnce() {
    if (mode() !== "optin" || ls(K_CONS) != null || !A || !A.openSheet || !A.authed || !A.authed()) return;
    if (A.sheetOpen && A.sheetOpen()) return;
    if (pnow() - lastDown < 10000) return;
    var tb = document.getElementById("toasts"); if (tb && tb.children.length) return;
    var intro = document.getElementById("intro"); if (intro && !intro.hidden) return;
    showAsk();
  }
  function showAsk() {
    var el = A.el;
    A.openSheet("Hjälp till?", function (body) {
      body.classList.add("pnlog-ask");
      body.appendChild(el("p", { text: "Vill du hjälpa oss göra appen bättre? Då sparar vi:" }));
      var ul = el("ul", { class: "pnlog-list" });
      ["Vad du trycker på i appen och hur snabb den är. Inga texter, inga namn.",
        "Din position under kvällen (max 1 gång/min när appen är öppen) och dina in- och utcheckningar. Så kan vi göra automatisk incheckning bättre."]
        .forEach(function (t) { ul.appendChild(el("li", { text: t })); });
      body.appendChild(ul);
      body.appendChild(el("p", { class: "muted", text: "Vi sparar det i 30 dagar. Ingen annan ser det. Du kan ändra dig när du vill i Inställningar." }));
      var yes = el("button", { type: "button", class: "btn btn-amber btn-block pnlog-yes", text: "Ja, hjälp till" });
      var no = el("button", { type: "button", class: "btn btn-block pnlog-no", text: "Nej tack" });
      yes.addEventListener("click", function () { setCons(true); A.closeSheet(); A.toast("Tack! Du kan ändra det i Inställningar.", { id: "pnlog-ask", ms: 3000 }); });
      no.addEventListener("click", function () { setCons(false); A.closeSheet(); });
      body.appendChild(el("div", { class: "row pnlog-btns" }, [yes, no]));
    }, { onClose: function () { if (ls(K_CONS) == null) lsSet(K_CONS, "0"); } });
  }
  function setCons(b) { lsSet(K_CONS, b ? "1" : "0"); if (b) { lsSet(K_EV, null); lsSet(K_LOC, null); } }

  /* ---------- ⚙️ settings ---------- */
  function swRow(label, on, icon, onToggle) {
    var el = A.el, b;
    if (window.PNI && window.PNI.svg) {   // big-update design system: .pn-swb row
      b = el("button", { type: "button", class: "btn btn-block pn-swb pnlog-row", role: "switch", "aria-checked": String(on) });
      b.innerHTML = window.PNI.svg(icon, "pi-lead") + '<span class="pn-sw-l"></span><span class="switch" aria-hidden="true" aria-checked="' + on + '"></span>';
      b.querySelector(".pn-sw-l").textContent = label;
      b.addEventListener("click", function () {
        var v = b.getAttribute("aria-checked") !== "true";
        b.setAttribute("aria-checked", String(v)); var d = b.querySelector(".switch"); if (d) d.setAttribute("aria-checked", String(v));
        onToggle(v);
      });
      return el("div", { class: "row pnlog-set" }, [b]);
    }
    b = el("button", { type: "button", class: "switch pnlog-switch", role: "switch", "aria-checked": String(on), "aria-label": label });   // main: toggle-row
    b.addEventListener("click", function () { var v = b.getAttribute("aria-checked") !== "true"; b.setAttribute("aria-checked", String(v)); onToggle(v); });
    return el("div", { class: "toggle-row pnlog-set" }, [el("span", { text: label }), b]);
  }
  function settingsSheet(body) {
    if (!A || !A.el || mode() === "none") return;
    var el = A.el, m = mode();
    body.appendChild(el("h3", { text: "Integritet – förbättra appen" }));
    var evNow = m === "on" ? ls(K_EV) !== "0" : cons() && ls(K_EV) !== "0";
    var locNow = m === "on" ? ls(K_LOC) !== "0" : cons() && ls(K_LOC) !== "0";
    if (m === "off") { body.appendChild(el("p", { class: "muted pnlog-hint", text: "Vi sparar bara felrapporter (utan position) just nu." })); return; }
    body.appendChild(swRow("Hjälp till att förbättra appen", evNow, "bulb", function (v) {
      lsSet(K_EV, v ? null : "0"); if (v && m !== "on") lsSet(K_CONS, "1");
      if (!v) { Q = Q.filter(function (e) { return e.n.indexOf("err.") === 0; }); }
      A.toast(v ? "Tack! Vi sparar hur appen används (inga texter, inga namn)." : "Av. Vi sparar bara felrapporter.", { id: "pnlog-set", ms: 3000 });
    }));
    body.appendChild(el("p", { class: "muted pnlog-hint", text: "Vad du trycker på och hur snabb appen är. Inga texter, inga namn. Sparas 30 dagar. Felrapporter (utan position) skickas alltid." }));
    body.appendChild(swRow("Spara position för bättre incheckning", locNow, "pin", function (v) {
      lsSet(K_LOC, v ? null : "0"); if (v && m !== "on") lsSet(K_CONS, "1");
      if (!v) {
        L = [];
        var tok = token();
        if (tok && CFG.SUPABASE_URL) {
          try { fetch(CFG.SUPABASE_URL + "/rest/v1/rpc/pnlog_forget_loc", { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + tok }, body: "{}" }).catch(function () {}); } catch (e) {}
        }
      }
      A.toast(v ? "På. Vi sparar din position under kvällen (30 dagar)." : "Av. Din sparade positionslogg är borttagen.", { id: "pnlog-set", ms: 3500 });
    }));
    body.appendChild(el("p", { class: "muted pnlog-hint", text: (m === "on" ? "Under betan: " : "") + "din position max 1 gång/min när appen är öppen, och dina in- och utcheckningar. Bara för att göra automatisk incheckning bättre. Sparas 30 dagar. Av = vi tar bort det sparade." }));
  }

  /* ---------- perf ---------- */
  function perfBoot() {
    try {
      var n = performance.getEntriesByType("navigation")[0];
      if (n) { if (n.domContentLoadedEventEnd) push("perf.boot", { v: Math.round(n.domContentLoadedEventEnd) }); if (n.loadEventEnd) push("perf.load", { v: Math.round(n.loadEventEnd) }); }
      var f = performance.getEntriesByName("first-contentful-paint")[0]; if (f) push("perf.fcp", { v: Math.round(f.startTime) });
    } catch (e) {}
  }
  try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (en) { if (!en.hadRecentInput) cls += en.value; }); }).observe({ type: "layout-shift", buffered: true }); } catch (e) {}
  try { new PerformanceObserver(function (l) { var x = l.getEntries(); if (x.length) lcp = x[x.length - 1].startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); } catch (e) {}
  try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (en) { longN++; longMs += en.duration; }); }).observe({ type: "longtask", buffered: true }); } catch (e) {}
  function mapReady() {
    var tries = 0, t = setInterval(function () {
      tries++;
      if (document.querySelector(".mapboxgl-canvas, .leaflet-tile-loaded, canvas.maplibregl-canvas")) { clearInterval(t); mapAt = Math.round(pnow()); push("perf.map", { v: mapAt }); }
      else if (tries > 60) clearInterval(t);
    }, 500);
  }

  function opened() {
    var sa = false; try { sa = !!(window.matchMedia && matchMedia("(display-mode: standalone)").matches) || !!navigator.standalone; } catch (e) {}
    push("app.open", { sa: sa, ch: ch(), w: Math.round(window.innerWidth / 10) * 10, h: Math.round(window.innerHeight / 10) * 10, ev: fullOn(), loc: locOn(), mode: mode() });
  }

  window.PNLOG = {
    init: function (api) {
      A = api; wrapClient(); watchSheet(); opened(); mapReady();
      if (document.readyState === "complete") perfBoot(); else window.addEventListener("load", function () { setTimeout(perfBoot, 0); });
      if (!hookAutoci()) { setTimeout(hookAutoci, 3000); ownSampler(); }
      var tries = 0, askT = setInterval(function () { if (++tries > 20 || ls(K_CONS) != null || mode() !== "optin") { if (tries > 1 || mode() !== "optin") clearInterval(askT); return; } askOnce(); }, 20000);
    },
    onAuthed: function () { wrapClient(); perm(); },
    onPoll: function () { wrapClient(); },
    settingsSheet: settingsSheet,
    event: event,
    loc: function (kind, x) { try { if (/^(fix|eval|ask|answer|auto_in|auto_out|ci|co|beer|notice)$/.test(kind)) locRow(kind, x); } catch (e) {} },
    flush: function () { return flush(false); },
    state: function () { return { q: Q.length, l: L.length, sent: sent, selfMs: Math.round(selfMs * 10) / 10, mode: mode(), full: fullOn(), loc: locOn(), sess: sess, screen: screen, dead: dead }; },
    _cfg: function (o) { if (o && o.fixMs != null) FIX_MS = o.fixMs; if (o && o.titles) TITLES = o.titles; return { FIX_MS: FIX_MS }; },
    _ask: function () { showAsk(); },
    _bye: bye,
    _fix: fix
  };
})();
