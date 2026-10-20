/* Öl Nu — 🎲 PARTYSPEL UI (window.PARTY_UI). A type="text/x-lazy" file, loaded by js/party.js on the first open.
   One full-screen overlay (#pt, z-index 2150 like Förfestläget: above sheets and toasts, below the intro). It opens
   only after the beer-type strip (party.js waits for OLNU_STRIP), so it never covers it.
   The room engine: party_create / party_join, then party_state polled every 1.2 s ONLY while this overlay is open and
   the page is visible (same v -> a tiny {same:true} answer), party_act for every move. The server holds the secret
   state (0071); this file only draws what party_state gives this phone: the host phone draws the big shared screen,
   every other phone its private controls. The host can peek at their own card ("🤫 Min lapp").
   Content (words, prompts) comes from window.PARTY_CONTENT; the host phone sends the list at start and the SERVER
   picks the secret word / imposters / targets. Screen Wake Lock while a room is open. Reduced motion = no motion,
   no flashing anywhere (reveals are slow steps, ≥ 1 s apart). */
(function () {
  "use strict";
  // boot.js loads every text/x-lazy file after the load event, party.js may have loaded this one already: one copy only
  if (window.PARTY_UI) return;
  var U = window.U, I = window.I18N;
  var A = null, C = null, root = null, R = null, pollT = null, wl = null, rotT = null, autoT = null;
  var POLL_MS = 1200, LS = "olnu.party", USED = "olnu.partyUsed";
  var reduced = false;
  try { reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  var GAMES = {
    imposter: { emo: "🕵️", name: "Imposter", sub: "Alla utom en ser det hemliga ordet. Ett ord var, högt. Hitta impostern!", n: "3–16 spelare", t: "5–10 min",
      how: ["Alla ser ordet på sin lur, utom impostern.", "Säg ETT ord var om ordet, i tur och ordning. 1–3 varv.", "Rösta på lurarna. Åker impostern dit får hen en chans att gissa ordet och stjäla segern."] },
    survivor: { emo: "🔥", name: "Östra lägret", sub: "Utmaning, prat, hemlig röstning. En åker ut varje runda. Juryn utser vinnaren.", n: "3–16 spelare", t: "15–25 min",
      how: ["Värdens skärm visar en utmaning. Prata, övertyga, smickra.", "Rösta i hemlighet. Flest röster åker ut och blir jury.", "När två ä kvar röstar juryn fram vinnaren."] },
    hatten: { emo: "🎩", name: "Namn i hatten", sub: "Alla svarar på sin lur. Lapparna dras en och en på storskärmen.", n: "3–16 spelare", t: "10–20 min",
      how: ["Värden visar en fråga: \"Vem i gruppen…?\" eller \"Skriv ett påhittat svar\".", "Alla svarar i hemlighet på sin lur.", "Lapparna dras en och en. Rösta på bästa svaret, poäng till den som skrev."] },
    flocken: { emo: "🐑", name: "Flocken", sub: "Svara som de flesta. Flocken får poäng, den ensamma får kossan 🐄.", n: "3–16 spelare", t: "~10 min",
      how: ["Värden visar en fråga, t.ex. \"Bästa ölen?\"", "Alla skriver ETT svar på sin lur.", "Störst grupp får +1. Den enda som svarade annorlunda får kossan och kan int' vinna."] },
    vagen: { emo: "🔮", name: "Vågen", sub: "Siaren ser målet på skalan och säger en ledtråd. Alla drar reglaget.", n: "3–12 spelare", t: "10–15 min",
      how: ["En siare per runda ser var målet ligger mellan två ytterligheter (Kallt–Varmt).", "Siaren säger EN ledtråd högt.", "Alla andra drar reglaget på sin lur. Närmast målet får mest poäng."] }
  };
  var ORDER = ["imposter", "survivor", "hatten", "flocken", "vagen"];

  var ERR = {
    room_not_found: "Hittar int' rummet. Kolla koden (4 bokstäver).", invalid_name: "Skriv ditt namn först.",
    too_few: "För få spelare. Minst 3 (5 för två impostrar).", slow_down: "Lugn i stormen! Vänta lite.",
    not_host: "Bara värden kan göra dä.", room_full: "Rummet ä fullt (16).", room_closed: "Rummet ä stängt.",
    own_answer: "Du kan int' rösta på ditt eget svar!", invalid_vote: "Den rösten går int'.", invalid_answer: "Skriv ett svar först.",
    not_in_room: "Du ä int' med i rummet längre.", not_member: "Du ä int' med i gruppen.", invalid_content: "Innehållet kunde int' laddas.",
    not_your_turn: "Int' din tur än.", busy: "Prova igen."
  };

  /* ---------- helpers ---------- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") n.textContent = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function btn(text, cls, fn, attrs) {
    var b = el("button", Object.assign({ type: "button", class: "pt-b " + (cls || "") }, attrs || {}), [text]);
    b.addEventListener("click", function (e) { e.preventDefault(); if (b.disabled) return; fn && fn(b); });
    return b;
  }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function ssGet(k, d) { try { var v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function rnd(a) { return a[Math.floor(Math.random() * a.length)]; }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function prefs() { return lsGet(LS, {}); }
  function setPref(k, v) { var p = prefs(); p[k] = v; lsSet(LS, p); }
  function cleanName(s) { return String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 20); }
  function myName() { try { return cleanName(A && A.getName ? A.getName() : ""); } catch (e) { return ""; } }
  function errCode(e) {
    var m = (e && (e.message || e.details || e.hint || String(e))) || "";
    for (var k in ERR) if (m.indexOf(k) >= 0) return k;
    if (/could not find the function|PGRST202/i.test(m) || (e && e.code === "PGRST202")) return "missing";
    if (m.indexOf("not_now") >= 0) return "not_now";
    return "";
  }
  function toast(msg, opts) { try { A.toast(msg, opts || {}); } catch (e) {} }
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 30); } catch (e) {} }
  var lastLine = {};
  function line(key, name) {
    var list = (C && C.lines && C.lines[key]) || [""];
    var used = lastLine[key] || [], cands = list.filter(function (x, i) { return used.indexOf(i) < 0; });
    if (!cands.length) { used = []; cands = list; }
    var pick = rnd(cands), idx = list.indexOf(pick);
    used.push(idx); if (used.length > Math.max(1, list.length - 2)) used.shift(); lastLine[key] = used;
    return String(pick).replace(/\{n\}/g, name || "");
  }
  // A stable line per screen (does not change on every poll redraw).
  function stLine(key, name, slot) {
    R.lines = R.lines || {};
    var id = key + ":" + (slot || "") + ":" + (name || "");
    if (!R.lines[id]) R.lines[id] = line(key, name);
    return R.lines[id];
  }
  function pick(listId, arr, n) {
    var used = ssGet(USED, {}), u = used[listId] || [], idx = [];
    for (var i = 0; i < arr.length; i++) if (u.indexOf(i) < 0) idx.push(i);
    if (idx.length < n) { u = []; idx = arr.map(function (x, i) { return i; }); }
    shuffle(idx); idx = idx.slice(0, n);
    used[listId] = u.concat(idx).slice(-600); ssSet(USED, used);
    return idx.map(function (i) { return arr[i]; });
  }

  /* ---------- overlay ---------- */
  function ensureRoot() {
    if (root && document.body.contains(root)) return root;
    root = el("div", { id: "pt", class: "pt", role: "dialog", "aria-modal": "true", "aria-label": "Partyspel", hidden: true });
    document.body.appendChild(root);
    root.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); close(); } });
    return root;
  }
  window.addEventListener("popstate", function () { if (root && !root.hidden && !closing) close(true); });
  var closing = false;
  function isOpen() { return !!(root && !root.hidden); }
  function open(api, opts) {
    A = api; C = window.PARTY_CONTENT || { cats: [], lines: {} };
    ensureRoot();
    var was = isOpen();
    root.hidden = false; closing = false;
    document.documentElement.classList.add("pt-on");
    if (!was) { try { history.pushState({ pt: 1 }, ""); } catch (e) {} }
    opts = opts || {};
    R = null; stopPoll();
    if (opts.room) { attach(opts.room); return; }
    if (opts.code) { renderStart(opts.group || null, opts.code); return; }
    renderLoading();
    A.rpc("party_mine").then(function (r) {
      if (!isOpen() || R) return;
      var d = r && !r.error ? A.parseData(r.data) : null;
      if (d && d.room && (!opts.group || !d.room.group_id || d.room.group_id === opts.group.id)) attach(d.room.id);
      else renderStart(opts.group || null, null);
    });
  }
  function close(fromPop) {
    if (!fromPop) { try { if (history.state && history.state.pt) { closing = true; history.back(); } } catch (e) {} }
    stopPoll(); lockOff(); stopAuto();
    if (rotT) { clearInterval(rotT); rotT = null; }
    if (R && R.anim && R.anim.timer) clearTimeout(R.anim.timer);
    R = null;
    if (root) { root.hidden = true; root.innerHTML = ""; root.className = "pt"; }
    document.documentElement.classList.remove("pt-on");
    setTimeout(function () { closing = false; }, 400);
  }

  /* ---------- wake lock ---------- */
  function lockOn() {
    if (wl || !R || document.visibilityState !== "visible") return;
    try {
      if (!navigator.wakeLock || !navigator.wakeLock.request) return;
      navigator.wakeLock.request("screen").then(function (l) {
        if (!R) { try { l.release(); } catch (e) {} return; }
        wl = l; l.addEventListener("release", function () { if (wl === l) wl = null; });
      }).catch(function () {});
    } catch (e) {}
  }
  function lockOff() { var l = wl; wl = null; if (l) { try { l.release(); } catch (e) {} } }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && R) { lockOn(); poll(); }
  });

  /* ---------- server ---------- */
  function attach(id) {
    R = { id: id, v: 0, d: null, busy: false, anim: null, peek: false, menu: false, draft: {}, lines: {} };
    renderLoading();
    poll(true);
    startPoll();
    lockOn();
  }
  function startPoll() { stopPoll(); pollT = setInterval(function () { poll(false); }, POLL_MS); }
  function stopPoll() { if (pollT) { clearInterval(pollT); pollT = null; } }
  function poll(force) {
    if (!R || !R.id || (R.inflight && !force) || (!force && document.visibilityState === "hidden")) return;
    R.inflight = true;
    var id = R.id;
    A.rpc("party_state", { p_room: id, p_v: R.v }).then(function (r) {
      if (!R || R.id !== id) return;
      R.inflight = false;
      if (r.error) {
        var c = errCode(r.error);
        if (c === "not_in_room" || c === "room_not_found") { var g = groupOf(); R = null; stopPoll(); toast(ERR[c]); renderStart(g, null); }
        else if (c === "missing") { close(); }
        else { R.net = (R.net | 0) + 1; markNet(); }
        return;
      }
      R.net = 0; markNet();
      var d = A.parseData(r.data);
      if (d.closed) { renderClosed(d); return; }
      if (d.same) {
        if (R.d && !!R.d.host_away !== !!d.host_away) { R.d.host_away = d.host_away; R.d.me.can_host = R.d.me.is_host || !!d.host_away; render(); }
        return;
      }
      setView(d);
    });
  }
  function setView(d) {
    if (!R) return;
    var prev = R.d;
    R.v = d.v; R.d = d;
    if (prev && (prev.phase !== d.phase || prev.round !== d.round || prev.game_no !== d.game_no)) {
      R.lines = {};
      if (!d.me.is_host) buzz(prev.phase === "lobby" ? [40, 60, 40] : 30);
      if (prev.phase !== d.phase) R.cardOpen = false;
    }
    render();
  }
  function act(a, val, data) {
    if (!R || R.busy) return Promise.resolve(null);
    R.busy = true; if (root) root.classList.add("pt-busy");
    var id = R.id;
    return A.rpc("party_act", { p_room: id, p_act: a, p_val: val == null ? null : String(val), p_data: data || null }).then(function (r) {
      if (!R || R.id !== id) return null;
      R.busy = false; if (root) root.classList.remove("pt-busy");
      if (r.error) {
        var c = errCode(r.error);
        if (c === "not_now") { poll(true); return null; }
        toast(ERR[c] || (A.errMsg ? A.errMsg(r.error) : "Något gick fel."), { err: true, id: "party-err" });
        if (c === "not_in_room" || c === "room_closed") poll(true);
        return null;
      }
      var d = A.parseData(r.data);
      if (d.left) { var g = groupOf(); R = null; stopPoll(); renderStart(g, null); return d; }
      if (d.closed) { renderClosed(d); return d; }
      setView(d);
      return d;
    });
  }
  function groupOf() { return R && R.d && R.d.group_id ? { id: R.d.group_id, name: "" } : null; }

  /* ---------- frame ---------- */
  function keepFocus() {
    var a = document.activeElement, k = a && root.contains(a) && a.getAttribute && a.getAttribute("data-key");
    return k ? { k: k, s: a.selectionStart, e: a.selectionEnd } : null;
  }
  function restoreFocus(f) {
    if (!f) return;
    var n = root.querySelector('[data-key="' + f.k + '"]');
    if (n) { try { n.focus({ preventScroll: true }); if (n.setSelectionRange && f.s != null) n.setSelectionRange(f.s, f.e); } catch (e) {} }
  }
  function frame(cls) {
    root.className = "pt " + (cls || "");
    root.innerHTML = "";
    var body = el("div", { class: "pt-body" });
    root.appendChild(body);
    return body;
  }
  function topBar(body, d) {
    var bar = el("div", { class: "pt-top" });
    if (d) {
      var g = GAMES[d.game] || GAMES.imposter;
      bar.appendChild(el("span", { class: "pt-code", "aria-label": "Rumskod " + d.code, text: "🎲 " + d.code }));
      bar.appendChild(el("span", { class: "pt-tt", text: d.phase === "lobby" ? "Lobby" : g.emo + " " + g.name }));
      bar.appendChild(el("span", { class: "pt-net", hidden: true, title: "Dåligt nät", text: "📡" }));
      bar.appendChild(btn("⋯", "pt-ib", function () { R.menu = !R.menu; render(); }, { "aria-label": "Meny" }));
    } else bar.appendChild(el("span", { class: "pt-kick", text: "🎲 PARTYSPEL" }));
    bar.appendChild(btn("✕", "pt-ib", function () { close(); }, { "aria-label": "Stäng" }));
    body.appendChild(bar);
    if (d && R.menu) {
      var m = el("div", { class: "pt-menu" });
      if (d.me.can_host && d.phase !== "lobby") m.appendChild(btn("↩️ Avbryt spelet, till lobbyn", "", function () { R.menu = false; act("lobby"); }));
      if (d.me.is_host) m.appendChild(btn("🛑 Stäng rummet för alla", "pt-warn", function () { R.menu = false; act("close"); }));
      m.appendChild(btn("🚪 Lämna rummet", "", function () { R.menu = false; act("leave"); }));
      m.appendChild(btn("Stäng menyn", "pt-ghost", function () { R.menu = false; render(); }));
      body.appendChild(m);
    }
  }
  function markNet() { var n = root && root.querySelector(".pt-net"); if (n) n.hidden = !(R && R.net >= 3); }
  function renderLoading() {
    var body = frame("pt-s");
    topBar(body, null);
    body.appendChild(el("div", { class: "pt-center" }, [el("div", { class: "pt-spin", "aria-hidden": "true", text: "🎲" }), el("p", { text: "Laddar rummet…" })]));
  }
  function renderClosed(d) {
    stopPoll(); lockOff();
    var g = groupOf(); R = null;
    var body = frame("pt-s");
    topBar(body, null);
    body.appendChild(el("div", { class: "pt-center" }, [
      el("div", { class: "pt-big-emo", text: "🏁" }),
      el("h2", { class: "pt-h", text: d && d.expired ? "Rummet har gått ut (3 timmar)." : "Rummet ä stängt." }),
      el("p", { class: "pt-p", text: "Tack för spelet, soldat. Starta ett nytt när truppen vill." }),
      btn("🎲 Nytt rum", "pt-go", function () { renderStart(g, null); }),
      btn("Stäng", "pt-ghost", function () { close(); })
    ]));
  }

  /* ---------- start / join ---------- */
  function renderStart(group, code) {
    var body = frame("pt-s");
    topBar(body, null);
    body.appendChild(el("div", { class: "pt-hero" }, [
      el("h1", { class: "pt-h1", text: "PARTYSPEL" }),
      el("p", { class: "pt-tag", text: "Alla spelar på sin egen lur. Värdens lur ä storskärmen: ställ den mitt på bordet." })
    ]));
    var nameInp = el("input", { class: "pt-inp", type: "text", maxlength: "20", placeholder: "Ditt namn", "aria-label": "Ditt namn", autocomplete: "nickname", enterkeyhint: "done", "data-key": "name" });
    nameInp.value = myName();
    var nameRow = el("label", { class: "pt-field" }, [el("span", { text: "Ditt namn" }), nameInp]);
    function nm() {
      var n = cleanName(nameInp.value);
      if (!n) { toast(ERR.invalid_name, { err: true, id: "party-err" }); nameInp.focus(); return null; }
      try { if (!myName() && U && U.ls) U.ls.set("olnu.name", n); } catch (e) {}
      return n;
    }
    var codeInp = el("input", { class: "pt-inp pt-codein", type: "text", maxlength: "4", placeholder: "KOD", "aria-label": "Rumskod", autocapitalize: "characters", autocomplete: "off", spellcheck: "false", enterkeyhint: "go", "data-key": "code" });
    if (code) codeInp.value = code;
    codeInp.addEventListener("input", function () { codeInp.value = codeInp.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4); });
    var join = function () {
      var n = nm(); if (!n) return;
      var c = codeInp.value.replace(/[^A-Za-z]/g, "").toUpperCase();
      if (c.length !== 4) { toast("Koden ä 4 bokstäver.", { err: true, id: "party-err" }); codeInp.focus(); return; }
      jb.disabled = true;
      A.rpc("party_join", { p_code: c, p_name: n }).then(function (r) {
        jb.disabled = false;
        if (r.error) { toast(ERR[errCode(r.error)] || "Gick int' att gå med.", { err: true, id: "party-err" }); return; }
        var d = A.parseData(r.data);
        attachView(d);
      });
    };
    var jb = btn(code ? "🔑 GÅ MED I " + code : "🔑 Gå med", "pt-go" + (code ? " pt-xl" : ""), join);
    codeInp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); join(); } });
    var create = btn("🎲 SKAPA RUM" + (group && group.name ? " · " + group.name : ""), code ? "pt-alt" : "pt-go pt-xl", function () {
      var n = nm(); if (!n) return;
      create.disabled = true;
      A.rpc("party_create", { p_group_id: group && group.id ? group.id : null, p_name: n, p_game: prefs().game || "imposter" }).then(function (r) {
        create.disabled = false;
        if (r.error) { toast(ERR[errCode(r.error)] || "Gick int' att skapa rummet.", { err: true, id: "party-err" }); return; }
        attachView(A.parseData(r.data));
      });
    });
    body.appendChild(nameRow);
    var joinSec = el("section", { class: "pt-card" }, [el("h2", { class: "pt-h2", text: "🔑 Har du en kod?" }), el("div", { class: "pt-row" }, [codeInp, jb])]);
    if (code) { body.appendChild(joinSec); body.appendChild(el("p", { class: "pt-or", text: "eller" })); body.appendChild(create); }
    else { body.appendChild(create); body.appendChild(el("p", { class: "pt-sub", text: "Du blir värd. Kompisarna går med med koden eller QR-koden." })); body.appendChild(joinSec); }
    var list = el("section", { class: "pt-games", "aria-label": "Spelen" });
    ORDER.forEach(function (k) {
      var g = GAMES[k];
      list.appendChild(el("div", { class: "pt-gcard g-" + k }, [
        el("span", { class: "pt-ge", "aria-hidden": "true", text: g.emo }),
        el("span", { class: "pt-gb" }, [el("b", { text: g.name }), el("span", { text: g.sub }), el("small", { text: g.n + " · " + g.t })])
      ]));
    });
    body.appendChild(list);
    body.appendChild(el("p", { class: "pt-fine", text: "⭐ Meriter: +2 per spel, +3 per vinst (max 3 per natt). Drick lugnt, ta vatten. 18+." }));
    if (code) setTimeout(function () { (nameInp.value ? jb : nameInp).focus(); }, 50);
  }
  function attachView(d) {
    R = { id: d.id, v: 0, d: null, busy: false, anim: null, peek: false, menu: false, draft: {}, lines: {} };
    setView(d);
    startPoll(); lockOn();
  }

  /* ---------- render ---------- */
  function render() {
    if (!R || !R.d || !root || root.hidden) return;
    if (R.hold) { R.pending = true; return; }
    var f = keepFocus();
    var d = R.d, me = d.me, host = me.is_host && !R.peek;
    var body = frame((host ? "pt-host" : "pt-pl") + " g-" + d.game + " ph-" + d.phase + (R.busy ? " pt-busy" : ""));
    topBar(body, d);
    if (!me.is_host && me.can_host && d.host_away) {
      body.appendChild(el("div", { class: "pt-away" }, [
        el("span", { text: "📡 Värden " + (d.host_name || "") + " verkar borta. Du kan styra." }),
        d.phase !== "lobby" ? btn("Nästa ›", "pt-small", function () { act("next"); }) : null
      ]));
    }
    if (me.is_host && R.peek) body.appendChild(btn("📺 Tillbaka till storskärmen", "pt-peekb on", function () { R.peek = false; render(); }));
    var main = el("div", { class: "pt-main" });
    body.appendChild(main);
    var foot = el("div", { class: "pt-foot" });
    try {
      if (d.phase === "lobby") (host ? lobbyHost : lobbyPlayer)(main, d, foot);
      else if (!host && me.status === "wait") waitScreen(main, d, "wait");
      else if (!host && me.status === "tv") waitScreen(main, d, "lookUp");
      else (G[d.game] || G.imposter)[host ? "h" : "p"](main, d, foot);
    } catch (e) { try { console.warn("party render", e); } catch (x) {} main.appendChild(el("p", { text: "Hoppsan, något gick snett. Vänta lite…" })); }
    if (host && d.phase !== "lobby" && d.phase !== "end" && me.in_game && me.status !== "tv") {
      foot.appendChild(btn("🤫 Min lapp", "pt-peekb", function () { R.peek = true; R.cardOpen = false; render(); }, { "aria-label": "Visa min hemliga vy" }));
    }
    if (foot.childNodes.length) body.appendChild(foot);
    markNet();
    restoreFocus(f);
  }

  /* ---------- shared pieces ---------- */
  function H(text, cls) { return el("h2", { class: "pt-h " + (cls || ""), text: text }); }
  function P(text, cls) { return el("p", { class: "pt-p " + (cls || ""), text: text }); }
  function players(d, filter) { return d.players.filter(filter || function (p) { return p.status !== "left"; }); }
  function inPlayers(d) { return players(d, function (p) { return p.status === "in"; }); }
  function byK(d, k) { return d.players.filter(function (p) { return p.k === k; })[0] || null; }
  function progress(d) {
    var need = players(d, function (p) { return p.need; }), done = need.filter(function (p) { return p.done; });
    var box = el("div", { class: "pt-prog" }, [el("div", { class: "pt-pn", text: done.length + " / " + need.length })]);
    var chips = el("div", { class: "pt-chips" });
    need.forEach(function (p) { chips.appendChild(el("span", { class: "pt-chip" + (p.done ? " ok" : ""), text: (p.done ? "✓ " : "… ") + p.name })); });
    box.appendChild(chips);
    return box;
  }
  function nameButtons(list, cur, fn, opts) {
    opts = opts || {};
    var box = el("div", { class: "pt-names" });
    list.forEach(function (p) {
      var dis = opts.disable && opts.disable(p);
      var b = btn((p.is_me ? p.name + " (du)" : p.name), "pt-nb" + (cur === p.k ? " on" : ""), function () { fn(p); }, { "aria-pressed": String(cur === p.k), disabled: dis || null });
      box.appendChild(b);
    });
    return box;
  }
  function lookUp(main, extra) {
    main.appendChild(el("div", { class: "pt-look" }, [el("div", { class: "pt-big-emo", "aria-hidden": "true", text: "👀" }), H(stLine("lookUp", "", "look"))]));
    if (extra) main.appendChild(typeof extra === "string" ? P(extra) : extra);
  }
  function rotating(key, name) {
    var p = el("p", { class: "pt-rot", "aria-live": "polite", text: line(key, name) });
    if (rotT) clearInterval(rotT);
    rotT = setInterval(function () {
      if (!document.body.contains(p)) { clearInterval(rotT); rotT = null; return; }
      p.textContent = line(key, name);
    }, 9000);
    return p;
  }
  function waitScreen(main, d, kind) {
    var emo = kind === "jury" ? "⚖️" : kind === "out" ? "🪦" : kind === "lookUp" ? "📺" : "⏳";
    main.appendChild(el("div", { class: "pt-wait k-" + kind }, [
      el("div", { class: "pt-big-emo", "aria-hidden": "true", text: emo }),
      H(kind === "jury" ? "JURYN" : kind === "out" ? "UTSLAGEN" : kind === "lookUp" ? "Du ä storskärmen" : "I RESERVEN"),
      rotating(kind === "lookUp" ? "lookUp" : kind, ""),
      kind === "jury" || kind === "out" ? P("👀 Följ dramat på värdens skärm.", "pt-mute") : null
    ]));
  }
  function scoreboard(d, title) {
    var ps = players(d, function (p) { return p.in_game && p.status !== "left"; }).slice().sort(function (a, b) { return b.score - a.score || b.wins - a.wins; });
    var box = el("div", { class: "pt-score" }, [title ? el("h3", { class: "pt-h3", text: title }) : null]);
    ps.forEach(function (p, i) {
      box.appendChild(el("div", { class: "pt-sr" + (p.is_me ? " me" : "") }, [
        el("span", { class: "pt-sn", text: (i + 1) + "." }), el("span", { class: "pt-sname", text: p.name }),
        el("span", { class: "pt-swn", text: p.wins ? "🏆" + p.wins : "" }), el("b", { class: "pt-sp", text: String(p.score) })
      ]));
    });
    return box;
  }
  function winnerBanner(d, text) {
    var ws = (d.pub && d.pub.winners) || [];
    var names = ws.map(function (w) { return w.name; }).join(", ");
    return el("div", { class: "pt-win" }, [
      el("div", { class: "pt-big-emo", "aria-hidden": "true", text: "👑" }),
      el("div", { class: "pt-wl", text: text || (ws.length ? "VINNARE" : "INGEN VINNARE") }),
      names ? el("div", { class: "pt-wn", text: names }) : null
    ]);
  }
  function iWon(d) { return ((d.pub && d.pub.winners) || []).some(function (w) { return w.k === d.me.k; }); }
  function endPlayer(main, d, extra) {
    var won = iWon(d);
    main.appendChild(el("div", { class: "pt-end " + (won ? "won" : "lost") }, [
      el("div", { class: "pt-big-emo", "aria-hidden": "true", text: won ? "🏆" : "🍺" }),
      H(won ? "DU VANN!" : "Int' den här gången"),
      P(stLine(won ? "win" : "lose", "", "end"))
    ]));
    if (extra) main.appendChild(extra);
    main.appendChild(scoreboard(d, "Ställning"));
    main.appendChild(P("Värden startar nästa spel…", "pt-mute"));
  }
  function endHostFoot(foot, d) {
    foot.appendChild(btn("🔁 Spela igen", "pt-go", function () { startGame(d.game); }));
    foot.appendChild(btn("🎲 Byt spel", "pt-alt", function () { act("lobby"); }));
  }
  function textInput(key, max, placeholder, onSend, cur) {
    var ta = el("textarea", { class: "pt-ta", maxlength: String(max), rows: max > 40 ? "2" : "1", placeholder: placeholder, "data-key": key, enterkeyhint: "send", "aria-label": placeholder });
    ta.value = R.draft[key] != null ? R.draft[key] : (cur || "");
    ta.addEventListener("input", function () { R.draft[key] = ta.value; });
    var send = function () { var v = ta.value.replace(/\s+/g, " ").trim(); if (!v) { ta.focus(); return; } onSend(v); };
    ta.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); send(); } });
    return el("div", { class: "pt-write" }, [ta, btn(cur ? "✏️ Ändra" : "📨 Skicka", "pt-go", send)]);
  }

  /* Vote reveal on the big screen: votes come out one at a time (≥ 1.1 s apart), then the final line. */
  function voteReveal(main, d, key, finalBox) {
    var t = (d.pub && d.pub.tally) || { votes: [], counts: [] }, votes = t.votes || [];
    if (!R.anim || R.anim.key !== key) {
      if (R.anim && R.anim.timer) clearTimeout(R.anim.timer);
      R.anim = { key: key, i: reduced ? votes.length : 0, done: reduced, timer: null, last: "" };
    }
    var a = R.anim, counts = {}, order = [];
    for (var i = 0; i < a.i; i++) { var v = votes[i]; if (!counts[v.k]) { counts[v.k] = 0; order.push(v); } counts[v.k]++; }
    var box = el("div", { class: "pt-reveal" });
    if (!a.i && votes.length) box.appendChild(H(stLine("count", "", key), "pt-pulse"));
    if (a.i > 0 && a.i <= votes.length) {
      var cur = votes[a.i - 1];
      var txt = counts[cur.k] > 1 ? line("oneMore", cur.name) : "En röst på… " + cur.name + "!";
      if (a.last && a.lastI === a.i) txt = a.last; else { a.last = txt; a.lastI = a.i; }
      box.appendChild(el("div", { class: "pt-slip", "aria-live": "polite", text: txt }));
    }
    if (!votes.length) box.appendChild(H("Inga röster…", "pt-mute"));
    var bars = el("div", { class: "pt-bars" }), max = 1;
    order.forEach(function (v) { max = Math.max(max, counts[v.k]); });
    order.slice().sort(function (x, y) { return counts[y.k] - counts[x.k]; }).forEach(function (v) {
      bars.appendChild(el("div", { class: "pt-bar" }, [
        el("span", { class: "pt-bn", text: v.name }),
        el("span", { class: "pt-bt" }, [el("i", { style: "width:" + Math.round(100 * counts[v.k] / max) + "%" })]),
        el("b", { text: String(counts[v.k]) })
      ]));
    });
    box.appendChild(bars);
    main.appendChild(box);
    if (a.done) { if (finalBox) main.appendChild(finalBox()); }
    else if (!a.timer) {
      a.timer = setTimeout(function () {
        if (!R || R.anim !== a) return;
        a.timer = null;
        if (a.i < votes.length) { a.i++; buzz(15); }
        else a.done = true;
        render();
      }, a.i === 0 ? 1600 : a.i >= votes.length ? 1300 : 1150);
    }
    return a.done;
  }

  /* ---------- lobby ---------- */
  function lobbyHost(main, d, foot) {
    var link = location.origin + location.pathname + "?party=" + d.code;
    var qr = el("div", { class: "pt-qr", "aria-hidden": "true" });
    main.appendChild(el("section", { class: "pt-join" }, [
      el("div", { class: "pt-jl" }, [
        el("div", { class: "pt-jk", text: "Gå med: skanna eller skriv koden" }),
        el("div", { class: "pt-bigcode", "aria-label": "Kod " + d.code.split("").join(" "), text: d.code }),
        el("div", { class: "pt-row" }, [
          btn("📋 Kopiera länk", "pt-small", function () { try { A.copyText(link); } catch (e) {} }),
          navigator.share ? btn("📤 Dela", "pt-small", function () { navigator.share({ title: "Öl Nu Partyspel", text: "Hoppa in i partyrum " + d.code + " 🎲", url: link }).catch(function () {}); }) : null
        ])
      ]), qr
    ]));
    try { if (window.QRCode) new window.QRCode(qr, { text: link, width: 132, height: 132, colorDark: "#0b1030", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M }); else qr.remove(); } catch (e) { qr.remove(); }

    var ps = players(d), active = ps.filter(function (p) { return p.status !== "tv"; });
    var sec = el("section", { class: "pt-card" }, [el("h2", { class: "pt-h2", text: "👥 Med i rummet (" + ps.length + ")" })]);
    var chips = el("div", { class: "pt-chips big" });
    ps.forEach(function (p) {
      var c = el("span", { class: "pt-chip big" + (p.on ? "" : " off") }, [(p.is_host ? "👑 " : "") + p.name]);
      if (!p.is_host) {
        var x = el("button", { type: "button", class: "pt-kx", "aria-label": "Ta bort " + p.name, text: "✕" });
        x.addEventListener("click", function () {
          if (R.kick === p.k) { R.kick = null; act("kick", p.k); } else { R.kick = p.k; toast("Tryck ✕ igen för att ta bort " + p.name + ".", { id: "party-kick", ms: 3000 }); }
        });
        c.appendChild(x);
      }
      chips.appendChild(c);
    });
    sec.appendChild(chips);
    if (ps.length < 3) sec.appendChild(P("Minst 3 spelare. Visa koden för kompisarna!", "pt-warnp"));
    main.appendChild(sec);

    var gs = el("section", { class: "pt-card" }, [el("h2", { class: "pt-h2", text: "Välj spel" })]);
    var grid = el("div", { class: "pt-pick" });
    ORDER.forEach(function (k) {
      var g = GAMES[k];
      grid.appendChild(btn(g.emo + " " + g.name, "pt-pg g-" + k + (d.game === k ? " on" : ""), function () { if (d.game !== k) { setPref("game", k); act("game", k); } }, { "aria-pressed": String(d.game === k) }));
    });
    gs.appendChild(grid);
    var g = GAMES[d.game];
    gs.appendChild(el("p", { class: "pt-sub", text: g.sub + " " + g.t + "." }));
    gs.appendChild(optionsUI(d.game, active.length));
    main.appendChild(gs);

    var tv = !!prefs().tv;
    var cb = el("input", { type: "checkbox", id: "pt-tv" }); cb.checked = tv;
    cb.addEventListener("change", function () { setPref("tv", cb.checked); render(); });
    main.appendChild(el("label", { class: "pt-sw", for: "pt-tv" }, [cb, el("span", {}, [el("b", { text: "📺 Min lur ä bara storskärmen" }), el("small", { text: "Värden spelar int' själv (t.ex. en platta på bordet)." })])]));

    var n = active.length - (tv ? 1 : 0), min = d.game === "imposter" && (prefs().imp | 0) === 2 ? 5 : 3;
    foot.appendChild(btn("▶ STARTA " + g.name.toUpperCase(), "pt-go pt-xl", function () { startGame(d.game); }, { disabled: n < min ? true : null }));
  }
  function chipOpt(label, key, vals, cur, fmt) {
    var row = el("div", { class: "pt-opt" }, [el("span", { class: "pt-ol", text: label })]);
    var box = el("div", { class: "pt-ov" });
    vals.forEach(function (v) {
      box.appendChild(btn(fmt ? fmt(v) : String(v), "pt-oc" + (cur === v ? " on" : ""), function () { setPref(key, v); render(); }, { "aria-pressed": String(cur === v) }));
    });
    row.appendChild(box);
    return row;
  }
  function optionsUI(game, n) {
    var p = prefs(), box = el("div", { class: "pt-opts" });
    if (game === "imposter") {
      var cat = p.cat || "rnd";
      var cats = el("div", { class: "pt-cats" });
      [{ id: "rnd", emo: "🎲", name: "Slump" }].concat(C.cats || []).forEach(function (c) {
        cats.appendChild(btn(c.emo + " " + c.name, "pt-oc" + (cat === c.id ? " on" : ""), function () { setPref("cat", c.id); render(); }, { "aria-pressed": String(cat === c.id) }));
      });
      box.appendChild(el("div", { class: "pt-opt col" }, [el("span", { class: "pt-ol", text: "Kategori" }), cats]));
      box.appendChild(chipOpt("Impostrar", "imp", [1, 2], (p.imp | 0) || 1, function (v) { return v === 2 ? "2 (5+ spelare)" : "1"; }));
      box.appendChild(chipOpt("Varv med ord", "rounds", [1, 2, 3], (p.rounds | 0) || 2));
      box.appendChild(chipOpt("Ledtråd till impostern", "hint", [true, false], p.hint !== false, function (v) { return v ? "På" : "Av"; }));
      box.appendChild(chipOpt("Utslagning (längre spel)", "elim", [false, true], !!p.elim, function (v) { return v ? "På" : "Av"; }));
    } else if (game === "hatten") {
      box.appendChild(chipOpt("Rundor", "hrounds", [3, 5, 7, 10], (p.hrounds | 0) || 5));
      box.appendChild(chipOpt("Frågor", "hmix", ["mix", "w", "t"], p.hmix || "mix", function (v) { return v === "w" ? "Vem i gruppen" : v === "t" ? "Påhittat svar" : "Blandat"; }));
    } else if (game === "flocken") {
      box.appendChild(chipOpt("Rundor", "frounds", [5, 7, 10], (p.frounds | 0) || 7));
    } else if (game === "vagen") {
      box.appendChild(chipOpt("Rundor", "vrounds", [0, 6, 10], p.vrounds == null ? 0 : p.vrounds | 0, function (v) { return v ? String(v) : "1 var (" + Math.max(3, Math.min(12, n)) + ")"; }));
    } else if (game === "survivor") {
      box.appendChild(P("Inga val. Bara ren lägerpolitik.", "pt-mute"));
    }
    return box;
  }
  function startGame(game) {
    var d = R.d, p = prefs(), names = players(d, function (x) { return x.status !== "tv"; }).map(function (x) { return x.name; });
    var data = { game: game, opts: { tv: !!p.tv }, list: [] };
    if (game === "imposter") {
      var cats = C.cats || [], cat = cats.filter(function (c) { return c.id === p.cat; })[0] || rnd(cats);
      data.list = cat.words.slice();
      data.opts.cat = cat.name; data.opts.emo = cat.emo;
      data.opts.imp = (p.imp | 0) === 2 && names.length >= 5 ? 2 : 1;
      data.opts.rounds = (p.rounds | 0) || 2; data.opts.hint = p.hint !== false; data.opts.elim = !!p.elim;
    } else if (game === "survivor") {
      data.list = pick("survivor", C.survivor || [], 15);
    } else if (game === "hatten") {
      var n = (p.hrounds | 0) || 5, mix = p.hmix || "mix", all = C.hatten || [];
      var w = pick("hatten-w", all.filter(function (x) { return x.slice(0, 2) === "w|"; }), n);
      var t = pick("hatten-t", all.filter(function (x) { return x.slice(0, 2) === "t|"; }), n);
      var out = [];
      for (var i = 0; i < n; i++) out.push(mix === "w" ? w[i] : mix === "t" ? t[i] : (i % 2 ? t[i] : w[i]));
      data.list = out.filter(Boolean).map(function (x) { return x.replace(/\{namn\}/g, function () { return rnd(names) || "Någon"; }); });
    } else if (game === "flocken") {
      data.list = pick("flocken", C.flocken || [], (p.frounds | 0) || 7);
    } else if (game === "vagen") {
      data.list = pick("vagen", C.vagen || [], 12);
      data.opts.rounds = p.vrounds ? p.vrounds | 0 : Math.max(3, Math.min(12, names.length));
    }
    setPref("game", game);
    R.anim = null; R.draft = {};
    return act("start", null, data);
  }
  function lobbyPlayer(main, d) {
    var g = GAMES[d.game] || GAMES.imposter;
    main.appendChild(el("div", { class: "pt-hello" }, [
      el("div", { class: "pt-big-emo", "aria-hidden": "true", text: "🎉" }),
      H("Du ä med, " + d.me.name + "!"),
      P(stLine("lobby", d.host_name || "värden", "lobby"))
    ]));
    var how = el("ol", { class: "pt-how" });
    g.how.forEach(function (x) { how.appendChild(el("li", { text: x })); });
    main.appendChild(el("section", { class: "pt-card g-" + d.game }, [el("h2", { class: "pt-h2", text: g.emo + " " + g.name }), el("p", { class: "pt-sub", text: g.n + " · " + g.t }), how]));
    var chips = el("div", { class: "pt-chips" });
    players(d).forEach(function (p) { chips.appendChild(el("span", { class: "pt-chip" + (p.is_me ? " ok" : ""), text: (p.is_host ? "👑 " : "") + p.name })); });
    main.appendChild(el("section", { class: "pt-card" }, [el("h2", { class: "pt-h2", text: "👥 " + players(d).length + " i rummet" }), chips]));
  }

  /* ---------- games ---------- */
  var G = {};

  /* ===== IMPOSTER ===== */
  function impCard(d, compact) {
    var pr = d.priv || {}, pub = d.pub || {}, open = !!R.cardOpen;
    var card = el("button", { type: "button", class: "pt-secret" + (open ? " open" : "") + (pr.imp ? " imp" : "") + (compact ? " compact" : ""), "aria-pressed": String(open) });
    card.addEventListener("click", function () { R.cardOpen = !R.cardOpen; render(); });
    if (!open) {
      card.appendChild(el("span", { class: "pt-sk", text: "🤫 Ditt hemliga kort" }));
      card.appendChild(el("span", { class: "pt-sw2", text: "👆 Tryck för att visa" }));
      card.appendChild(el("span", { class: "pt-sc", text: (pub.emo || "") + " " + (pub.cat || "") }));
    } else if (pr.imp) {
      card.appendChild(el("span", { class: "pt-sk", text: "🕵️" }));
      card.appendChild(el("span", { class: "pt-sw2 big", text: "Du ä IMPOSTERN" }));
      card.appendChild(el("span", { class: "pt-sc", text: "Kategori: " + (pub.emo || "") + " " + (pub.cat || "") }));
      if (pr.hint) card.appendChild(el("span", { class: "pt-hint", text: "Ledtråd: " + pr.hint }));
      if (pr.imp_n > 1) card.appendChild(el("span", { class: "pt-hint", text: "Ni ä två impostrar. Vem ä den andra?" }));
      if (!compact) card.appendChild(el("span", { class: "pt-sm", text: stLine("impYou", "", "imp") }));
      card.appendChild(el("span", { class: "pt-sm", text: "Tryck för att dölja" }));
    } else {
      card.appendChild(el("span", { class: "pt-sk", text: "Ditt ord" }));
      card.appendChild(el("span", { class: "pt-sw2 big", text: pr.word || "?" }));
      card.appendChild(el("span", { class: "pt-sc", text: "Kategori: " + (pub.emo || "") + " " + (pub.cat || "") }));
      if (!compact) card.appendChild(el("span", { class: "pt-sm", text: stLine("crewYou", "", "crew") }));
      card.appendChild(el("span", { class: "pt-sm", text: "Tryck för att dölja" }));
    }
    return card;
  }
  G.imposter = {
    p: function (main, d) {
      var pub = d.pub || {}, me = d.me, pr = d.priv || {};
      if (d.phase === "guess" && pub.guesser_k === me.k) {
        main.appendChild(el("div", { class: "pt-alarm" }, [el("div", { class: "pt-big-emo", text: "🕵️" }), H("AVSLÖJAD!"), P("En chans att stjäla segern: gissa ordet!")]));
        main.appendChild(textInput("guess", 40, "Ordet ä…", function (v) { act("guess", v); }, pr.mine));
        return;
      }
      if (d.phase === "end") {
        endPlayer(main, d, P("Ordet var: " + (pub.word || "?") + " · Impostern: " + (pub.imps || []).map(function (x) { return x.name; }).join(", ")));
        return;
      }
      if (me.status === "out") {
        waitScreen(main, d, "out");
        if (d.phase !== "guessed" && !pr.imp) main.appendChild(impCard(d, true));
        return;
      }
      if (d.phase === "roles") {
        main.appendChild(impCard(d, false));
        var mine = !!pr.mine;
        main.appendChild(btn(mine ? "✅ Klart! Väntar på de andra" : "✅ Jag har sett mitt kort", "pt-go pt-xl" + (mine ? " done" : ""), function () { if (!mine) { R.cardOpen = false; act("ready"); } }, { disabled: mine ? true : null }));
      } else if (d.phase === "clue") {
        if (pub.turn_k === me.k) {
          main.appendChild(el("div", { class: "pt-myturn" }, [el("div", { class: "pt-big-emo", text: "🎤" }), H(stLine("myTurn", "", "turn" + d.step))]));
          main.appendChild(btn("✅ KLAR", "pt-go pt-xxl", function () { act("done"); }));
        } else {
          main.appendChild(el("div", { class: "pt-turn" }, [el("span", { text: "🎤 Nu säger" }), el("b", { text: pub.turn_name || "?" }), el("span", { text: "sitt ord" })]));
          main.appendChild(P("Varv " + (pub.clue_round || 1) + " av " + ((pub.cycle | 0) > 1 ? 1 : pub.rounds || 1), "pt-mute"));
        }
        main.appendChild(impCard(d, true));
      } else if (d.phase === "vote") {
        main.appendChild(H(stLine("voteNow", "", "vote" + pub.cycle)));
        main.appendChild(nameButtons(inPlayers(d).filter(function (p) { return !p.is_me; }), pr.mine, function (p) { act("vote", p.k); }));
        main.appendChild(P(pr.mine ? "✅ Röst lagd på " + ((byK(d, pr.mine) || {}).name || "?") + ". Du kan byta tills alla röstat." : "Tryck på den du misstänker.", "pt-mute"));
        main.appendChild(impCard(d, true));
      } else if (d.phase === "result") {
        lookUp(main, pub.out_k === me.k ? P("…och det ä DU som åker ut! 😱") : null);
      } else if (d.phase === "guess") {
        lookUp(main, P("🕵️ " + (pub.guesser_name || "?") + " gissar ordet… 🤞"));
      } else {
        lookUp(main, null);
      }
    },
    h: function (main, d, foot) {
      var pub = d.pub || {};
      var head = el("div", { class: "pt-cat" }, [el("span", { text: (pub.emo || "🕵️") + " " + (pub.cat || "Imposter") }), el("span", { text: (pub.imp_n > 1 ? "2 impostrar" : "1 imposter") + (pub.elim ? " · utslagning" : "") })]);
      if (d.phase === "roles") {
        main.appendChild(head);
        main.appendChild(el("div", { class: "pt-stage" }, [el("div", { class: "pt-big-emo", text: "🤫" }), H("Kolla era lurar i hemlighet!", "xl"), P("Alla utom impostern ser ordet. Visa int' skärmen för nån.")]));
        main.appendChild(progress(d));
        foot.appendChild(btn("▶ Starta orden", "pt-go pt-xl", function () { act("next"); }));
      } else if (d.phase === "clue") {
        main.appendChild(head);
        var ord = pub.order || [], n = Math.max(1, ord.length), pos = d.step % n;
        main.appendChild(el("div", { class: "pt-stage" }, [
          el("div", { class: "pt-kick2", text: "🎤 Säg ETT ord" }),
          el("div", { class: "pt-huge", text: pub.turn_name || "?" }),
          P("Varv " + (pub.clue_round || 1) + " av " + ((pub.cycle | 0) > 1 ? 1 : pub.rounds || 1) + " · tur " + (pos + 1) + "/" + n, "pt-mute")
        ]));
        var row = el("div", { class: "pt-order" });
        ord.forEach(function (o, i) { row.appendChild(el("span", { class: "pt-oi" + (i === pos ? " cur" : i < pos ? " past" : ""), text: o.name })); });
        main.appendChild(row);
        foot.appendChild(btn("Nästa ›", "pt-go pt-xl", function () { act("next"); }));
        foot.appendChild(btn("🗳️ Rösta nu", "pt-alt", function () { act("tovote"); }));
      } else if (d.phase === "vote") {
        main.appendChild(head);
        main.appendChild(el("div", { class: "pt-stage" }, [el("div", { class: "pt-big-emo", text: "🗳️" }), H("RÖSTA PÅ ERA LURAR!", "xl"), P("Vem ä impostern? Diskutera högt, rösta tyst.")]));
        main.appendChild(progress(d));
        foot.appendChild(btn("Räkna rösterna ›", "pt-go pt-xl", function () { act("next"); }));
      } else if (d.phase === "result") {
        var key = "imp:" + d.game_no + ":" + pub.cycle;
        var done = voteReveal(main, d, key, function () {
          if (!pub.out_k) return el("div", { class: "pt-final tie" }, [H("OAVGJORT!", "xl"), P(pub.after === "clue" ? "Ingen åker ut. Ett varv till!" : "Ingen åkte ut… impostern kommer undan!")]);
          var box = el("div", { class: "pt-final " + (pub.out_imp ? "good" : "bad") }, [el("div", { class: "pt-huge", text: pub.out_name }), H("ÅKER UT!", "xl")]);
          box.appendChild(el("p", { class: "pt-verdict", text: pub.out_imp ? "…och VAR impostern! 🕵️" : "…och var INTE impostern 😬" }));
          if (!pub.out_imp && pub.after === "end") box.appendChild(P("Impostern vinner!"));
          if (!pub.out_imp && pub.after === "clue") box.appendChild(P("Spelet fortsätter. Ett varv till!"));
          return box;
        });
        foot.appendChild(btn(done ? "Vidare ›" : "Hoppa över ›", done ? "pt-go pt-xl" : "pt-alt", function () {
          if (!R.anim || R.anim.done) act("next"); else { if (R.anim.timer) clearTimeout(R.anim.timer); R.anim.timer = null; R.anim.i = (pub.tally && pub.tally.votes || []).length; R.anim.done = true; render(); }
        }));
      } else if (d.phase === "guess") {
        main.appendChild(el("div", { class: "pt-stage" }, [el("div", { class: "pt-big-emo", text: "🕵️" }), el("div", { class: "pt-huge", text: pub.guesser_name || "?" }),
          H("får EN chans att gissa ordet!", "xl"), P("Rätt gissning = impostern stjäl segern. Tystnad i lokalen!")]));
        foot.appendChild(btn("Hoppa över gissningen ›", "pt-alt", function () { act("next"); }));
      } else if (d.phase === "guessed") {
        main.appendChild(el("div", { class: "pt-stage" }, [
          P((pub.guesser_name || "Impostern") + " gissade:", "pt-mute"),
          el("div", { class: "pt-huge", text: "«" + (pub.guess || "…") + "»" }),
          el("div", { class: "pt-verdict " + (pub.guess_ok ? "good" : "bad"), text: pub.guess_ok ? (pub.accepted ? "✅ GODKÄNT AV VÄRDEN!" : "✅ RÄTT!") : "❌ FEL!" }),
          pub.after === "clue" ? P("Men det finns en imposter kvar… Ett varv till!") : null
        ]));
        if (!pub.guess_ok && pub.guess) foot.appendChild(btn("✅ Godkänn ändå", "pt-alt", function () { act("accept"); }));
        foot.appendChild(btn("Vidare ›", "pt-go pt-xl", function () { act("next"); }));
      } else if (d.phase === "end") {
        main.appendChild(winnerBanner(d, pub.win === "imp" ? "IMPOSTERN VANN 🕵️" : "TRUPPEN VANN 🎉"));
        main.appendChild(el("div", { class: "pt-reveal-word" }, [el("span", { text: "Ordet var" }), el("b", { text: pub.word || "?" }),
          el("span", { text: "Imposter: " + (pub.imps || []).map(function (x) { return x.name; }).join(", ") })]));
        main.appendChild(scoreboard(d, "Ställning"));
        endHostFoot(foot, d);
      }
    }
  };

  /* ===== ÖSTRA LÄGRET ===== */
  G.survivor = {
    p: function (main, d) {
      var pub = d.pub || {}, me = d.me, pr = d.priv || {};
      if (d.phase === "end") { endPlayer(main, d); return; }
      if (d.phase === "final") {
        if (me.status === "out" && me.in_game) {
          main.appendChild(H("⚖️ FINALEN! Rösta fram vinnaren"));
          main.appendChild(nameButtons(pub.finalists || [], pr.mine, function (p) { act("vote", p.k); }));
          main.appendChild(P(pr.mine ? "✅ Juryröst lagd. Du kan byta tills alla röstat." : "Juryn bestämmer. Vem förtjänar det?", "pt-mute"));
        } else {
          main.appendChild(el("div", { class: "pt-stage" }, [el("div", { class: "pt-big-emo", text: "🏝️" }), H("Du ä i FINALEN!"), P("Övertyga juryn. Smicker, mutor och tårar ä tillåtet.")]));
        }
        return;
      }
      if (me.status === "out") { waitScreen(main, d, "jury"); return; }
      if (d.phase === "challenge") {
        main.appendChild(el("div", { class: "pt-stage" }, [el("div", { class: "pt-kick2", text: "🔥 Runda " + d.round }), el("p", { class: "pt-prompt", text: pub.prompt || "" })]));
        main.appendChild(P("Prata, övertyga, smickra. Snart röstar ni.", "pt-mute"));
      } else if (d.phase === "vote") {
        main.appendChild(H("🔥 Vem ska ut ur lägret?"));
        main.appendChild(nameButtons(inPlayers(d).filter(function (p) { return !p.is_me; }), pr.mine, function (p) { act("vote", p.k); }));
        main.appendChild(P(pr.mine ? "✅ Röst lagd på " + ((byK(d, pr.mine) || {}).name || "?") + ". Hemlig. Du kan byta." : "Rösten ä hemlig.", "pt-mute"));
      } else if (d.phase === "result") {
        lookUp(main, pub.out_k === me.k ? P("…det ä DU som åker ut! ⚖️ Välkommen till juryn.") : null);
      }
    },
    h: function (main, d, foot) {
      var pub = d.pub || {};
      var jury = players(d, function (p) { return p.in_game && p.status === "out"; });
      if (d.phase === "challenge") {
        main.appendChild(el("div", { class: "pt-stage" }, [el("div", { class: "pt-kick2", text: "🔥 ÖSTRA LÄGRET · RUNDA " + d.round }), el("p", { class: "pt-prompt xl", text: pub.prompt || "" })]));
        main.appendChild(el("div", { class: "pt-chips" }, inPlayers(d).map(function (p) { return el("span", { class: "pt-chip ok", text: "🔥 " + p.name }); })));
        foot.appendChild(btn("🗳️ Till omröstningen ›", "pt-go pt-xl", function () { act("next"); }));
      } else if (d.phase === "vote") {
        main.appendChild(el("div", { class: "pt-stage" }, [el("div", { class: "pt-big-emo", text: "🔥" }), H("RÅDSLAG: RÖSTA UT NÅGON", "xl"), P("Hemlig röst på er lur.")]));
        main.appendChild(progress(d));
        foot.appendChild(btn("Räkna rösterna ›", "pt-go pt-xl", function () { act("next"); }));
      } else if (d.phase === "result") {
        var done = voteReveal(main, d, "sv:" + d.game_no + ":" + d.round, function () {
          return el("div", { class: "pt-final bad" }, [el("div", { class: "pt-huge", text: pub.out_name || "?" }), H("ÅKER UT UR LÄGRET 🔥", "xl"),
            pub.tie ? P("Oavgjort! Lotten avgjorde.") : null, P(pub.after === "final" ? "Två kvar: dags för FINALEN!" : "Nästa runda väntar.")]);
        });
        if (jury.length) main.appendChild(P("⚖️ Juryn: " + jury.map(function (p) { return p.name; }).join(", "), "pt-mute"));
        foot.appendChild(btn(done ? (pub.after === "final" ? "🏆 Till finalen ›" : "Nästa runda ›") : "Hoppa över ›", done ? "pt-go pt-xl" : "pt-alt", function () {
          if (!R.anim || R.anim.done) act("next"); else { if (R.anim.timer) clearTimeout(R.anim.timer); R.anim.timer = null; R.anim.i = (pub.tally && pub.tally.votes || []).length; R.anim.done = true; render(); }
        }));
      } else if (d.phase === "final") {
        var f = pub.finalists || [];
        main.appendChild(el("div", { class: "pt-stage" }, [el("div", { class: "pt-kick2", text: "🏆 FINALEN" }),
          el("div", { class: "pt-vs" }, [el("b", { text: (f[0] || {}).name || "?" }), el("span", { text: "mot" }), el("b", { text: (f[1] || {}).name || "?" })]),
          P("Finalisterna har 30 sekunder var att övertyga juryn. Sen röstar juryn!")]));
        main.appendChild(progress(d));
        foot.appendChild(btn("Räkna juryns röster ›", "pt-go pt-xl", function () { act("next"); }));
      } else if (d.phase === "end") {
        var done2 = voteReveal(main, d, "svf:" + d.game_no, function () { return winnerBanner(d, "VINNER ÖSTRA LÄGRET"); });
        if (done2) main.appendChild(scoreboard(d, "Ställning"));
        endHostFoot(foot, d);
      }
    }
  };

  /* ===== NAMN I HATTEN ===== */
  function slipList(slips, upto, showBy) {
    var box = el("div", { class: "pt-slips" });
    slips.slice(0, upto).forEach(function (s, i) {
      box.appendChild(el("div", { class: "pt-sl" }, [el("span", { class: "pt-sli", text: String(i + 1) }), el("span", { class: "pt-slt", text: s.t }),
        showBy && s.by ? el("small", { text: "· " + s.by + (s.n ? " · " + s.n + " röst" + (s.n > 1 ? "er" : "") : "") }) : null]));
    });
    return box;
  }
  G.hatten = {
    p: function (main, d) {
      var pub = d.pub || {}, pr = d.priv || {}, me = d.me;
      if (d.phase === "end") { endPlayer(main, d); return; }
      if (d.phase === "write") {
        main.appendChild(el("div", { class: "pt-stage" }, [el("div", { class: "pt-kick2", text: "🎩 Runda " + d.round + "/" + (pub.rounds || "?") }), el("p", { class: "pt-prompt", text: pub.prompt || "" })]));
        if (pub.pk === "w") {
          main.appendChild(nameButtons(players(d, function (p) { return p.status === "in" || p.status === "out"; }), pr.mine, function (p) { act("answer", p.k); }));
          main.appendChild(P(pr.mine ? "✅ Lappen ä i hatten: " + ((byK(d, pr.mine) || {}).name || "?") + ". Du kan byta." : "Tryck på ett namn. Ingen ser vem som skrev vad.", "pt-mute"));
        } else {
          main.appendChild(textInput("ans" + d.round, 60, "Ditt svar…", function (v) { R.draft["ans" + d.round] = null; act("answer", v); }, pr.mine));
          if (pr.mine) main.appendChild(P("✅ I hatten: «" + pr.mine + "»", "pt-mute"));
        }
      } else if (d.phase === "vote") {
        main.appendChild(H("🗳️ Rösta på bästa svaret!"));
        var box = el("div", { class: "pt-names col" });
        (pub.slips || []).forEach(function (s, i) {
          var own = pr.my_slip === i;
          box.appendChild(btn(s.t + (own ? " (ditt)" : ""), "pt-nb" + (pr.mine === String(i) ? " on" : ""), function () { act("best", i); }, { disabled: own ? true : null }));
        });
        main.appendChild(box);
      } else if (d.phase === "score") {
        lookUp(main, P("Dina poäng: " + me.score));
      } else lookUp(main, P("🎩 Lapparna dras ur hatten…"));
    },
    h: function (main, d, foot) {
      var pub = d.pub || {}, slips = pub.slips || [];
      var kick = el("div", { class: "pt-kick2", text: "🎩 NAMN I HATTEN · RUNDA " + d.round + "/" + (pub.rounds || "?") });
      if (d.phase === "write") {
        main.appendChild(el("div", { class: "pt-stage" }, [kick, el("p", { class: "pt-prompt xl", text: pub.prompt || "" }),
          P(pub.pk === "w" ? "Tryck på ett namn på er lur." : "Skriv ett svar på er lur. Ju roligare desto bättre.", "pt-mute")]));
        main.appendChild(progress(d));
        foot.appendChild(btn("🎩 Dra lapparna ›", "pt-go pt-xl", function () { act("next"); }));
      } else if (d.phase === "reveal") {
        var n = pub.slip_n | 0, shown = slips.length;
        main.appendChild(el("div", { class: "pt-stage sm" }, [kick, el("p", { class: "pt-prompt", text: pub.prompt || "" })]));
        if (!shown) main.appendChild(el("div", { class: "pt-hat" }, [el("div", { class: "pt-big-emo", text: "🎩" }), H(n + " lappar i hatten…", "xl")]));
        else {
          var cur = slips[shown - 1];
          if (pub.pk === "w") {
            var cnt = slips.filter(function (s) { return s.tk === cur.tk; }).length;
            var key = "hat:" + d.game_no + ":" + d.round + ":" + shown;
            if (!R.lines[key]) R.lines[key] = cnt > 1 ? line("oneMore", cur.t) : line("hatOne", cur.t);
            main.appendChild(el("div", { class: "pt-slip big", "aria-live": "polite", text: R.lines[key] }));
            var counts = {}, order = [];
            slips.forEach(function (s) { if (!counts[s.tk]) { counts[s.tk] = 0; order.push(s); } counts[s.tk]++; });
            var max = 1; order.forEach(function (s) { max = Math.max(max, counts[s.tk]); });
            var bars = el("div", { class: "pt-bars" });
            order.sort(function (a, b) { return counts[b.tk] - counts[a.tk]; }).forEach(function (s) {
              bars.appendChild(el("div", { class: "pt-bar" }, [el("span", { class: "pt-bn", text: s.t }), el("span", { class: "pt-bt" }, [el("i", { style: "width:" + Math.round(100 * counts[s.tk] / max) + "%" })]), el("b", { text: String(counts[s.tk]) })]));
            });
            main.appendChild(bars);
          } else {
            main.appendChild(el("div", { class: "pt-slip big", "aria-live": "polite", text: "«" + cur.t + "»" }));
            main.appendChild(slipList(slips, shown - 1, false));
          }
        }
        main.appendChild(P("Lapp " + shown + " av " + n, "pt-mute"));
        if (shown < n) {
          foot.appendChild(btn("🎩 Nästa lapp ›", "pt-go pt-xl", function () { stopAuto(); act("next"); }));
          foot.appendChild(btn(autoT ? "⏸ Pausa" : "▶ Spela upp alla", "pt-alt", function () { if (autoT) stopAuto(); else runAuto(); render(); }));
        } else {
          stopAuto();
          foot.appendChild(btn(pub.pk === "w" ? "📊 Räkna ihop ›" : "🗳️ Rösta på bästa ›", "pt-go pt-xl", function () { act("next"); }));
        }
      } else if (d.phase === "vote") {
        main.appendChild(el("div", { class: "pt-stage sm" }, [kick, H("🗳️ RÖSTA PÅ BÄSTA SVARET", "xl")]));
        main.appendChild(slipList(slips, slips.length, false));
        main.appendChild(progress(d));
        foot.appendChild(btn("🏆 Visa vinnaren ›", "pt-go pt-xl", function () { act("next"); }));
      } else if (d.phase === "score") {
        if (pub.pk === "w") {
          var top = pub.top || [];
          main.appendChild(el("div", { class: "pt-final good" }, [P("Hatten har talat:", "pt-mute"), el("div", { class: "pt-huge", text: top.map(function (x) { return x.name; }).join(" & ") || "?" }), P(pub.prompt || "")]));
          main.appendChild(P("+1 till alla som skrev " + (top.length > 1 ? "någon av dem" : (top[0] || {}).name || "") + ".", "pt-mute"));
        } else {
          var best = (pub.best || [])[0];
          if (best) main.appendChild(el("div", { class: "pt-final good" }, [P("Bästa svaret (" + best.n + " röst" + (best.n === 1 ? "" : "er") + "):", "pt-mute"), el("div", { class: "pt-huge sm", text: "«" + best.t + "»" }), H("skrivet av " + best.by)]));
          main.appendChild(slipList((pub.best || []).slice(1), 99, true));
        }
        main.appendChild(scoreboard(d, "Ställning"));
        foot.appendChild(btn(d.round >= (pub.rounds | 0) ? "🏁 Till resultatet ›" : "Nästa runda ›", "pt-go pt-xl", function () { act("next"); }));
      } else if (d.phase === "end") {
        main.appendChild(winnerBanner(d, "HATTENS MÄSTARE 🎩"));
        main.appendChild(scoreboard(d, "Slutställning"));
        endHostFoot(foot, d);
      }
    }
  };
  function runAuto() {
    stopAuto();
    autoT = setInterval(function () {
      if (!R || !R.d || R.d.game !== "hatten" || R.d.phase !== "reveal" || (R.d.pub.slips || []).length >= (R.d.pub.slip_n | 0)) { stopAuto(); if (R) render(); return; }
      act("next");
    }, 2600);
  }
  function stopAuto() { if (autoT) { clearInterval(autoT); autoT = null; } }

  /* ===== FLOCKEN ===== */
  function herdGroups(main, d, big) {
    var pub = d.pub || {}, gs = pub.groups || [], max = 1;
    gs.forEach(function (g) { max = Math.max(max, g.n); });
    var box = el("div", { class: "pt-herd" + (big ? " big" : "") });
    gs.forEach(function (g, i) {
      box.appendChild(el("div", { class: "pt-hg" + (pub.herd === i ? " win" : "") + (pub.cow_new && g.n === 1 && g.who[0] && g.who[0].k === pub.cow_k ? " cow" : "") }, [
        el("div", { class: "pt-ha" }, [el("b", { text: g.a }), el("span", { text: "×" + g.n + (pub.herd === i ? "  🐑 +1" : "") })]),
        el("div", { class: "pt-bt" }, [el("i", { style: "width:" + Math.round(100 * g.n / max) + "%" })]),
        el("small", { text: g.who.map(function (w) { return w.name; }).join(", ") })
      ]));
    });
    main.appendChild(box);
  }
  G.flocken = {
    p: function (main, d) {
      var pub = d.pub || {}, pr = d.priv || {}, me = d.me;
      if (d.phase === "end") { endPlayer(main, d); return; }
      if (d.phase === "write") {
        main.appendChild(el("div", { class: "pt-stage" }, [el("div", { class: "pt-kick2", text: "🐑 Runda " + d.round + "/" + (pub.rounds || "?") + " · Tänk som flocken!" }), el("p", { class: "pt-prompt", text: pub.prompt || "" })]));
        main.appendChild(textInput("fl" + d.round, 30, "Ett svar…", function (v) { R.draft["fl" + d.round] = null; act("answer", v); }, pr.mine));
        if (pr.mine) main.appendChild(P("✅ Ditt svar: «" + pr.mine + "»", "pt-mute"));
      } else {
        var mine = (pub.groups || []).filter(function (g) { return g.who.some(function (w) { return w.k === me.k; }); })[0];
        var inHerd = pub.herd === 0 && mine === (pub.groups || [])[0];
        main.appendChild(el("div", { class: "pt-stage" }, [el("div", { class: "pt-big-emo", text: pub.cow_k === me.k ? "🐄" : inHerd ? "🐑" : "🤷" }),
          H(pub.cow_k === me.k ? "Du fick KOSSAN!" : inHerd ? "+1! Du tänkte som flocken" : "Ingen poäng den här gången"),
          P("Dina poäng: " + me.score)]));
      }
    },
    h: function (main, d, foot) {
      var pub = d.pub || {};
      var kick = el("div", { class: "pt-kick2", text: "🐑 FLOCKEN · RUNDA " + d.round + "/" + (pub.rounds || "?") });
      if (d.phase === "write") {
        main.appendChild(el("div", { class: "pt-stage" }, [kick, el("p", { class: "pt-prompt xl", text: pub.prompt || "" }), P("Skriv det du tror att DE FLESTA skriver.", "pt-mute")]));
        main.appendChild(progress(d));
        foot.appendChild(btn("Visa svaren ›", "pt-go pt-xl", function () { act("next"); }));
      } else if (d.phase === "score") {
        main.appendChild(el("div", { class: "pt-stage sm" }, [kick, el("p", { class: "pt-prompt", text: pub.prompt || "" })]));
        herdGroups(main, d, true);
        if (pub.cow_new && pub.cow_name) main.appendChild(el("div", { class: "pt-cow", text: stLine("cow", pub.cow_name, "cow" + d.round) }));
        else if (pub.herd == null) main.appendChild(P("Ingen tydlig flock den här gången. Inga poäng!", "pt-mute"));
        main.appendChild(scoreboard(d, "Ställning"));
        foot.appendChild(btn(d.round >= (pub.rounds | 0) ? "🏁 Till resultatet ›" : "Nästa fråga ›", "pt-go pt-xl", function () { act("next"); }));
      } else if (d.phase === "end") {
        main.appendChild(winnerBanner(d, "FLOCKLEDARE 🐑"));
        if (pub.cow_name) main.appendChild(P("🐄 Kossan: " + pub.cow_name + " (kossan kan int' vinna)", "pt-mute"));
        main.appendChild(scoreboard(d, "Slutställning"));
        endHostFoot(foot, d);
      }
    }
  };

  /* ===== VÅGEN ===== */
  function scale(pub, opt) {
    opt = opt || {};
    var sc = pub.scale || ["?", "?"];
    var track = el("div", { class: "pt-track" });
    if (opt.target != null) {
      track.appendChild(el("div", { class: "pt-zone", style: "left:" + Math.max(0, opt.target - 9) + "%;width:" + (Math.min(100, opt.target + 9) - Math.max(0, opt.target - 9)) + "%" }));
      track.appendChild(el("div", { class: "pt-tgt", style: "left:" + opt.target + "%", "aria-label": "Mål " + opt.target }));
    }
    (opt.guesses || []).forEach(function (g) {
      track.appendChild(el("div", { class: "pt-gm", style: "left:" + g.val + "%" }, [el("span", { text: g.name + (g.pts ? " +" + g.pts : "") })]));
    });
    return el("div", { class: "pt-scale" + (opt.big ? " big" : "") }, [
      el("div", { class: "pt-ends" }, [el("b", { text: "◀ " + sc[0] }), el("b", { text: sc[1] + " ▶" })]), track
    ]);
  }
  G.vagen = {
    p: function (main, d) {
      var pub = d.pub || {}, pr = d.priv || {}, me = d.me;
      var kick = el("div", { class: "pt-kick2", text: "🔮 Runda " + d.round + "/" + (pub.rounds || "?") });
      if (d.phase === "end") { endPlayer(main, d); return; }
      if (pr.target != null) {
        main.appendChild(el("div", { class: "pt-stage" }, [kick, H("🔮 DU ÄR SIAREN")]));
        main.appendChild(scale(pub, { target: pr.target, big: true }));
        if (d.phase === "clue") {
          main.appendChild(P("Säg EN ledtråd högt som pekar dit på skalan. Inga siffror!"));
          main.appendChild(btn("✅ Ledtråden ä sagd", "pt-go pt-xl", function () { act("done"); }));
        } else main.appendChild(P("Nu gissar de… håll pokeransiktet.", "pt-mute"));
        return;
      }
      if (d.phase === "clue") {
        main.appendChild(el("div", { class: "pt-stage" }, [kick, el("div", { class: "pt-turn" }, [el("span", { text: "🔮 Siaren" }), el("b", { text: pub.psy_name || "?" }), el("span", { text: "säger en ledtråd" })])]));
        main.appendChild(scale(pub, {}));
        main.appendChild(P("Lyssna noga!", "pt-mute"));
      } else if (d.phase === "guess") {
        var val = R.slide != null && R.slideKey === d.round ? R.slide : (pr.mine != null ? +pr.mine : 50);
        main.appendChild(el("div", { class: "pt-stage sm" }, [kick, H("Dra dit ledtråden pekar!")]));
        var sc = scale(pub, {});
        var rng = el("input", { type: "range", min: "0", max: "100", step: "1", class: "pt-range", "aria-label": "Din gissning", "data-key": "slide" });
        rng.value = String(val);
        var out = el("div", { class: "pt-rv", text: String(val) });
        rng.addEventListener("input", function () { R.slide = +rng.value; R.slideKey = d.round; out.textContent = rng.value; });
        // no redraw while a finger is on the slider (a poll would cut the drag)
        rng.addEventListener("pointerdown", function () { R.hold = true; });
        var up = function () { if (!R) return; R.hold = false; if (R.pending) { R.pending = false; setTimeout(render, 0); } };
        rng.addEventListener("pointerup", up); rng.addEventListener("pointercancel", up); rng.addEventListener("blur", up);
        sc.appendChild(rng);
        main.appendChild(sc);
        main.appendChild(out);
        main.appendChild(btn(pr.mine != null ? "🔒 Låst på " + pr.mine + " · Ändra" : "🔒 LÅS GISSNING", "pt-go pt-xl", function () { act("slide", Math.round(+rng.value)); }));
      } else if (d.phase === "score") {
        var mine = (pub.guesses || []).filter(function (g) { return g.k === me.k; })[0];
        main.appendChild(el("div", { class: "pt-stage" }, [el("div", { class: "pt-big-emo", text: mine && mine.pts >= 3 ? "🎯" : "🔮" }),
          H(mine ? "+" + mine.pts + " poäng" : (pub.psy_k === me.k ? "+" + (pub.psy_pts | 0) + " som siare" : "Kolla skärmen")), P("Dina poäng: " + me.score)]));
      }
    },
    h: function (main, d, foot) {
      var pub = d.pub || {};
      var kick = el("div", { class: "pt-kick2", text: "🔮 VÅGEN · RUNDA " + d.round + "/" + (pub.rounds || "?") });
      if (d.phase === "clue") {
        main.appendChild(el("div", { class: "pt-stage" }, [kick, P("Siare:", "pt-mute"), el("div", { class: "pt-huge", text: pub.psy_name || "?" }), P("ser målet på sin lur och säger EN ledtråd.")]));
        main.appendChild(scale(pub, { big: true }));
        foot.appendChild(btn("Alla gissar ›", "pt-go pt-xl", function () { act("next"); }));
      } else if (d.phase === "guess") {
        main.appendChild(el("div", { class: "pt-stage sm" }, [kick, H("Dra reglaget på er lur!", "xl")]));
        main.appendChild(scale(pub, { big: true }));
        main.appendChild(progress(d));
        foot.appendChild(btn("🎯 Visa målet ›", "pt-go pt-xl", function () { act("next"); }));
      } else if (d.phase === "score") {
        main.appendChild(el("div", { class: "pt-stage sm" }, [kick, H("Målet var " + pub.target, "xl")]));
        main.appendChild(scale(pub, { target: pub.target, guesses: pub.guesses || [], big: true }));
        main.appendChild(P("Siaren " + (pub.psy_name || "") + " får +" + (pub.psy_pts | 0) + ".", "pt-mute"));
        main.appendChild(scoreboard(d, "Ställning"));
        foot.appendChild(btn(d.round >= (pub.rounds | 0) ? "🏁 Till resultatet ›" : "Nästa siare ›", "pt-go pt-xl", function () { act("next"); }));
      } else if (d.phase === "end") {
        main.appendChild(winnerBanner(d, "TANKELÄSARE 🔮"));
        main.appendChild(scoreboard(d, "Slutställning"));
        endHostFoot(foot, d);
      }
    }
  };

  window.PARTY_UI = { open: open, close: close, isOpen: isOpen, _state: function () { return R; }, GAMES: GAMES };
})();
