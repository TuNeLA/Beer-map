/* Öl Nu — 🎉 SPEL hub (CONTRACT "🎉 SPEL"). ONE way into every game of a group (and of an event group):
   a big "🎉 Spel" card on the group page home (hook groupItem, row .sp-gi), a "🎉 Spel" tile in + (groupActions),
   and one "🎉 Alla spel" button in the Lek sheets (games.js calls SPEL.lekButton(g)). The old Förfest / Partyspel /
   Lek / Duell tiles are hidden on the group page (still reachable from the hub, so nothing is lost).
   This file is the small always-loaded part. The hub + the room screens are lazy: js/spel-ui.js (window.SPEL_UI),
   js/spel-cards.js (window.SPEL_CARDS, the card data) as type="text/x-lazy", spel.css as rel="x-lazy-css".
   Server: 0168–0169 (spel_group, spel_open, spel_state, spel_act, spel_mine). Missing RPC = only the new games hide.
   Public API (also for event groups): SPEL.open(g) = the hub, SPEL.play(g, id) = straight into a game
   (ids: kort vem aldrig hellre · imposter survivor hatten flocken vagen · forfest spin lek duel), SPEL.games().
   Hooks (app.js mods): init, onAuthed, groupItem, groupActions. */
(function () {
  "use strict";
  var I = window.I18N;
  var A = null, loading = null, cssDone = false, off = false, resumed = false;

  var S = {
    sv: { tile: "SPEL", tileSub: "Skämskort, Gängkollen, Kungaleken… {0} spel. Välj och kör!",
      live: "{0} pågår", liveSub: "{0} ä med · Tryck för att hoppa in!", plus: "Spel", plusSub: "alla spelen på ett ställe",
      lek: "🎉 Alla spel", load: "Laddar spelen…", fail: "Spelen kunde int' laddas. Kolla nätet.",
      resume: "{0} · du ä med i ett spel", back: "Tillbaka" },
    en: { tile: "GAMES", tileSub: "Shame Cards, Who in the gang?, Imposter… {0} games. Pick one!",
      live: "{0} is on", liveSub: "{0} in · Tap to jump in!", plus: "Games", plusSub: "every game in one place",
      lek: "🎉 All games", load: "Loading the games…", fail: "Could not load the games. Check the network.",
      resume: "{0} · you are in a game", back: "Back" }
  };
  function T(k) {
    var v = (I && I.lang === "en" && S.en[k] != null) ? S.en[k] : S.sv[k];
    var a = Array.prototype.slice.call(arguments, 1);
    return String(v).replace(/\{(\d)\}/g, function (m, i) { return a[i] != null ? a[i] : ""; });
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") n.textContent = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function data(r) { return r && !r.error ? (A && A.parseData ? A.parseData(r.data) : r.data) : null; }
  function missing(err) { return !!(err && (err.code === "PGRST202" || /could not find the function/i.test(err.message || ""))); }

  // Short names for the live line (the full game list lives in spel-ui.js).
  var NAMES = { kort: "🃏 Skämskort", vem: "👉 Vem i gänget?", aldrig: "🙊 Jag har aldrig", hellre: "⚖️ Hellre eller?", quiz: "🧠 Gängkollen" };
  var N_GAMES = 15;

  /* ---------- ⚖️ OLNU_PEN · the ONE penalty table for every game (store-premium-plan.md 2.2) ---------- */
  // k1 small · k2 big · d3 give out; each = [3rd person, imperative]. Hard limits: max 2 per penalty, max 2 to give out,
  // never shots / "botten upp" / "drick tills". Klassiskt only in the web build (never in a store build).
  var PACKS = {
    utm: { ic: "🎖️", mark: "🎯", name: "Utmaning", sub: "Inga drycker. Knäböj, honnörer och komplimanger.",
      k1: [["gör 5 knäböj", "gör 5 knäböj"], ["gör honnör och säger 'Förlåt, general!'", "gör honnör och säg 'Förlåt, general!'"], ["ger en komplimang till den till vänster", "ge en komplimang till den till vänster"]],
      k2: [["gör 10 stjärnhopp", "gör 10 stjärnhopp"], ["sjunger en strof som gänget väljer", "sjung en strof som gänget väljer"]],
      d3: [["delar ut 3 straffarmhävningar", "dela ut 3 straffarmhävningar"]] },
    skal: { ic: "🥂", mark: "🥂", name: "Skålstraff", sub: "Höj glaset – vatten räknas.",
      rule: "🥂 Skålstraff: höj glaset, säg 'Skål, general!' och ta en skvätt av det du har. Vatten räknas. Läsk räknas. Ingen räknar.",
      k1: [["tar ett Skålstraff", "ta ett Skålstraff"]], k2: [["tar ett dubbelt Skålstraff", "ta ett dubbelt Skålstraff"]], d3: [["delar ut 2 Skålstraff", "dela ut 2 Skålstraff"]] },
    streck: { ic: "📏", mark: "📏", name: "Skamstreck", sub: "Bara poäng. Flest streck hamnar på skamlistan.",
      k1: [["får ett skamstreck", "få ett skamstreck"]], k2: [["får två skamstreck", "få två skamstreck"]], d3: [["delar ut 2 skamstreck", "dela ut 2 skamstreck"]] },
    klunk: { ic: "🍺", mark: "🍺", name: "Klassiskt", sub: "Ta en klunk. Drick lugnt, ta vatten.", web: 1,
      k1: [["tar en klunk", "ta en klunk"]], k2: [["tar två klunkar", "ta två klunkar"]], d3: [["delar ut 2 klunkar", "dela ut 2 klunkar"]] }
  };
  var PACK_ORDER = ["utm", "skal", "streck", "klunk"];
  function isStore() {
    try {
      if (window.OLNU_STORE != null) return !!window.OLNU_STORE;
      if (window.Capacitor) return true;
      if (/[?&]app=(android|ios)\b/.test(location.search) || /^android-app:/.test(document.referrer || "")) { try { localStorage.setItem("olnu.store", "1"); } catch (e) {} return true; }
      return localStorage.getItem("olnu.store") === "1";
    } catch (e) { return false; }
  }
  function packIds() { var st = isStore(); return PACK_ORDER.filter(function (id) { return !(st && PACKS[id].web); }); }
  function packOk(id) { return packIds().indexOf(id) >= 0 ? id : "utm"; }
  function packPref() { try { return packOk(JSON.parse(localStorage.getItem("olnu.pack") || "null") || "utm"); } catch (e) { return "utm"; } }
  function setPackPref(id) { try { localStorage.setItem("olnu.pack", JSON.stringify(packOk(id))); } catch (e) {} }
  // fill {k1} {k2} {d3} {K1} {K2} {D3} {ic} {mark} in a text; seed picks the same Utmaning variant on every phone
  function penFill(text, pack, seed) {
    var p = PACKS[packOk(pack)], n = seed | 0;
    return String(text).replace(/\{(k1|k2|d3|K1|K2|D3|ic|mark)\}/g, function (m, k, at, all) {
      if (k === "ic" || k === "mark") return p[k];
      var list = p[k.toLowerCase()], v = list[Math.abs(n) % list.length], imp = k !== k.toLowerCase(), s = imp ? v[1] : v[0];
      if (imp) { var before = all.slice(0, at).replace(/\s+$/, ""); if (!before || /[.?!:]$/.test(before)) s = s.charAt(0).toUpperCase() + s.slice(1); }
      return s;
    });
  }
  window.OLNU_PEN = { packs: function () { return packIds().map(function (id) { var p = PACKS[id]; return { id: id, ic: p.ic, name: p.name, sub: p.sub, rule: p.rule || null }; }); },
    get: function (id) { return PACKS[packOk(id)]; }, ok: packOk, pref: packPref, setPref: setPackPref, fill: penFill, store: isStore,
    pick: function (id, key, seed) { var l = PACKS[packOk(id)][key] || PACKS.utm.k1; return l[Math.abs(seed | 0) % l.length]; } };

  /* ---------- lazy files ---------- */
  function lazySrc(re, sel, attr) {
    var n = Array.prototype.slice.call(document.querySelectorAll(sel)).filter(function (x) { return re.test(x.getAttribute(attr) || ""); })[0];
    return n ? n.getAttribute(attr) : null;
  }
  function ensureCss() {
    if (cssDone) return; cssDone = true;
    var href = lazySrc(/spel\.css/, 'link[rel="x-lazy-css"]', "href") || "./spel.css";
    if (document.querySelector('link[rel="stylesheet"][href="' + href + '"]')) return;
    var l = el("link", { rel: "stylesheet", href: href });
    // ds.css must stay last (js/ds.js moves it); insert before it when it is there
    var ds = document.querySelector('link[rel="stylesheet"][href*="ds.css"]');
    if (ds && ds.parentNode) ds.parentNode.insertBefore(l, ds); else document.head.appendChild(l);
  }
  function loadScript(re, def, test) {
    if (test()) return Promise.resolve();
    var src = lazySrc(re, 'script[type="text/x-lazy"]', "src") || def;
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script"); s.src = src; s.async = true;
      s.onload = function () { if (test()) resolve(); else reject(new Error("empty")); };
      s.onerror = function () { s.remove(); reject(new Error("load")); };
      document.head.appendChild(s);
    });
  }
  function ensure() {
    ensureCss();
    if (window.SPEL_UI && window.SPEL_CARDS) return Promise.resolve();
    if (loading) return loading;
    loading = Promise.all([
      loadScript(/spel-cards\.js/, "./js/spel-cards.js", function () { return !!window.SPEL_CARDS; }),
      loadScript(/spel-ui\.js/, "./js/spel-ui.js", function () { return !!window.SPEL_UI; })
    ]).then(function () { loading = null; }, function (e) { loading = null; throw e; });
    return loading;
  }

  /* ---------- close the open sheet, then run fn once its history unwind has landed ---------- */
  // SHEETNAV closes a sheet with a deferred history.go(-n). An overlay that pushes its own entry before that lands gets
  // popped (and closed) by it. Shared by forfest.js / party.js (window.OLNU_AFTER_SHEET).
  function afterSheet(fn, who) {
    var api = A;
    var open = false; try { open = !!(api && api.sheetOpen && api.sheetOpen()); } catch (e) {}
    if (!open) { fn(); return; }
    var nav = 0; try { nav = window.SHEETNAV && window.SHEETNAV.depth ? window.SHEETNAV.depth() | 0 : 0; } catch (e) {}
    var done = false, tm = null;
    function go() { if (done) return; done = true; window.removeEventListener("popstate", onPop); clearTimeout(tm); setTimeout(fn, 20); }
    function onPop() { setTimeout(go, 0); }
    if (nav > 0) window.addEventListener("popstate", onPop);
    try { api.closeSheet(who || "spel"); } catch (e) {}
    if (nav > 0) tm = setTimeout(go, 450); else setTimeout(go, 0);
  }
  window.OLNU_AFTER_SHEET = function (fn, who) { if (!A) { fn(); return; } afterSheet(fn, who); };

  /* ---------- open ---------- */
  // what: null = the hub · "kort" … = straight into that game · {room:"uuid"} = back into a running room
  function go(g, what) {
    if (!A) return;
    if (window.OLNU_STRIP && window.OLNU_STRIP.up && window.OLNU_STRIP.up()) { window.OLNU_STRIP.after(function () { go(g, what); }); return; }
    var t0 = setTimeout(function () { try { A.toast(T("load"), { id: "spel-load", ms: 2500 }); } catch (e) {} }, 400);
    ensure().then(function () {
      clearTimeout(t0); try { A.toastClear("spel-load"); } catch (e) {}
      afterSheet(function () { window.SPEL_UI.open(A, g && g.id ? { id: g.id, name: g.name || "", evg: !!g.evg } : null, what || null, { off: off }); }, "spel");
    }, function () {
      clearTimeout(t0);
      try { A.toast(T("fail"), { err: true, id: "spel-load" }); } catch (e) {}
    });
  }

  /* ---------- group page: the big card on home ---------- */
  function liveLine(room, party) {
    if (room) return { t: T("live", NAMES[room.game] || "🎉"), s: T("liveSub", (room.names || []).slice(0, 3).join(", ") + ((room.n | 0) > 3 ? " +" + ((room.n | 0) - 3) : "")) };
    if (party) return { t: T("live", "🎲 Partyspel " + (party.code || "")), s: T("liveSub", (party.n | 0) + " st") };
    return null;
  }
  function paint(row, g) {
    var b = row.querySelector(".sp-gbtn"); if (!b) return;
    var lv = liveLine(row._room, row._party);
    row.classList.toggle("sp-live", !!lv);
    b.querySelector(".sp-gt").textContent = lv ? lv.t : T("tile");
    b.querySelector(".sp-gs").textContent = lv ? lv.s : T("tileSub", N_GAMES);
  }
  function refresh(row, g) {
    if (!A || !A.rpc || A.LIVE === false) return;
    if (!off) A.rpc("spel_group", { p_group_id: g.id }).then(function (r) {
      if (r && r.error) { if (missing(r.error)) off = true; return; }
      var d = data(r); row._room = d && d.room || null; paint(row, g);
    });
    if (window.PARTY) A.rpc("party_group", { p_group_id: g.id }).then(function (r) {
      var d = data(r); row._party = d && d.room || null; paint(row, g);
    });
  }
  function groupItem(g, wrap) {
    if (!g || !g.id || !wrap || wrap.querySelector(":scope > .sp-gi")) return;
    var row = el("div", { class: "sp-gi" });
    var b = el("button", { type: "button", class: "sp-gbtn" }, [
      el("span", { class: "sp-gi-ic", "aria-hidden": "true", text: "🎉" }),
      el("span", { class: "sp-gi-tx" }, [el("b", { class: "sp-gt", text: T("tile") }), el("small", { class: "sp-gs", text: T("tileSub", N_GAMES) })]),
      el("span", { class: "sp-gi-go", "aria-hidden": "true", text: "›" })
    ]);
    b.addEventListener("click", function () {
      if (row._room && row._room.is_in) go(g, { room: row._room.id, game: row._room.game });
      else if (row._room && row._room.game) go(g, { join: row._room.game });   // a live room: straight in (was: the hub + one more tap)
      else go(g, null);
    });
    row.appendChild(b);
    wrap.appendChild(row);
    refresh(row, g);
    var tm = setInterval(function () {
      if (!document.body.contains(row)) { clearInterval(tm); return; }
      if (document.visibilityState === "visible" && row.offsetParent) refresh(row, g);
    }, 20000);
  }
  function lekButton(g) {
    var b = el("button", { type: "button", class: "btn btn-small btn-block btn-amber sp-lek", style: "margin-top:10px", text: T("lek") });
    b.addEventListener("click", function () { go(g && g.id ? g : null, null); });
    return b;
  }

  /* ---------- chat: "🎉 Anna startar 🃏 Skämskort! Hoppa in…" rows get a HOPPA IN button (social.js calls SPEL.chatOpen) ---------- */
  var BYNAME = { "Skämskort": "kort", "Vem i gänget?": "vem", "Jag har aldrig": "aldrig", "Hellre eller?": "hellre", "Gängkollen": "quiz" };
  function chatOpen(g, ctx) {
    if (!g || !g.id || g.ev || g.dm || !ctx || !ctx.list) return;
    var list = ctx.list;
    function scan() {
      var rows = list.querySelectorAll("li.chat-msg:not([data-spc])");
      for (var i = 0; i < rows.length; i++) {
        var li = rows[i], b = li.querySelector(".cm-body"), t = b ? b.textContent || "" : "";
        li.setAttribute("data-spc", "1");
        var m = t.match(/^🎉 .+? (?:startar|starts) \S+ (.+?)! (?:Hoppa in|Jump in)/);
        if (!m) continue;
        var at = Date.parse(li.getAttribute("data-at") || "") || 0;
        if (at && Date.now() - at > 3 * 3600e3) continue;   // a room lives ≤ 3 h
        var id = BYNAME[m[1]] || null;
        var btn = el("button", { type: "button", class: "btn btn-small btn-amber sp-chatjoin", style: "margin-top:6px", text: "🎉 HOPPA IN ›" });
        btn.addEventListener("click", function (id) { return function () { go(g, id ? { join: id } : null); }; }(id));
        if (b && b.nextSibling) li.insertBefore(btn, b.nextSibling); else li.appendChild(btn);
      }
    }
    scan();
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () { if (ctx.alive && !ctx.alive()) { mo.disconnect(); return; } scan(); });
      mo.observe(list, { childList: true });
    }
  }

  /* ---------- resume after a reload ---------- */
  function onAuthed() {
    if (!A || A.LIVE === false || resumed) return;
    resumed = true;
    setTimeout(function () {
      A.rpc("spel_mine").then(function (r) {
        if (r && r.error) { if (missing(r.error)) off = true; return; }
        var d = data(r), room = d && d.room;
        if (!room || (window.SPEL_UI && window.SPEL_UI.isOpen && window.SPEL_UI.isOpen())) return;
        A.toast(T("resume", NAMES[room.game] || "🎉"), { id: "spel-resume", ms: 9000,
          action: { label: T("back"), fn: function () { go({ id: room.group_id, name: "" }, { room: room.id }); } } });
      });
    }, 4500);
  }

  // The old game tiles on the group page are reachable from the hub now: hide them (strong selectors beat the
  // review2 / social2 fold rules). Injected here because spel.css is lazy.
  (function () {
    var css = ".gitem:not(.gcard)>div.gp.gpg.gpg[data-gv]>div.ff-gi.ff-gi.ff-gi[class][class]," +
      ".gitem:not(.gcard)>div.gp.gpg.gpg[data-gv]>div.pt-gi.pt-gi.pt-gi[class][class]," +
      ".gitem:not(.gcard)>div.gp.gpg.gpg[data-gv]>div.gm-gi.gm-gi.gm-gi[class][class]," +
      ".gitem:not(.gcard)>div.gp.gpg.gpg[data-gv]>div.du-gi.du-gi.du-gi[class][class]{display:none !important}" +
      ".sp-gi{grid-column:1 / -1}" +
      ".sp-gbtn{display:flex;align-items:center;gap:12px;width:100%;min-height:72px;padding:12px 14px;border-radius:16px;cursor:pointer;text-align:left;" +
      "color:#241300;background:linear-gradient(135deg,#ffc24d,#f5a623 60%,#e8891a);border:0;box-shadow:0 6px 18px rgba(245,166,35,.25);font:inherit}" +
      ".sp-gbtn:active{transform:scale(.98)}" +
      ".sp-gi-ic{font-size:34px;line-height:1;flex:0 0 auto}" +
      ".sp-gi-tx{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}" +
      ".sp-gt{font:400 20px/1.15 var(--ds-stencil,Impact,sans-serif);letter-spacing:.04em}" +
      ".sp-gs{font-size:13px;line-height:1.3;font-weight:600;opacity:.85}" +
      ".sp-gi-go{font-size:30px;font-weight:700;flex:0 0 auto}" +
      ".sp-gi.sp-live .sp-gbtn{background:linear-gradient(135deg,#4fe08f,#3ddc84 60%,#1fb866);color:#00260f}" +
      "@media (prefers-reduced-motion:reduce){.sp-gbtn:active{transform:none}}";
    try { var s = document.createElement("style"); s.id = "spel-base-css"; s.textContent = css; document.head.appendChild(s); } catch (e) {}
  })();

  window.SPEL = {
    open: function (g) { go(g, null); },
    play: function (g, id) { go(g, id || null); },
    games: function () { return window.SPEL_UI ? window.SPEL_UI.games() : null; },
    lekButton: lekButton,
    chatOpen: function (g, ctx) { try { chatOpen(g, ctx); } catch (e) {} },
    init: function (api) { A = api; },
    onAuthed: function () { onAuthed(); },
    groupItem: function (g, wrap) { try { groupItem(g, wrap); } catch (e) { try { console.warn("olnu spel", e); } catch (x) {} } },
    groupActions: function (g) {
      return { id: "spel", icon: "🎉", label: T("plus"), sub: T("plusSub"), sect: 2, onClick: function () { go(g, null); } };
    }
  };
})();
