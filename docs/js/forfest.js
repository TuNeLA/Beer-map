/* Öl Nu — 🎉 FÖRFESTLÄGET (CONTRACT "FÖRFESTLÄGET"). A pre-party card game on ONE phone that is passed around.
   Ways in: the "🎉 Förfest" tile on the group page (hook groupItem) and the Lek sheet (games.js calls
   window.FORFEST.lekButton(g)). Players = the group members (group_status, cached per group for offline use),
   tick who is here, add guests by name. 3 modes: Uppvärmning (u), Kaos (k), Skyttegraven (s).
   Cards: js/forfest-content.js (window.FORFEST_CONTENT), a type="text/x-lazy" file; loaded here on demand when it
   is not there yet. Styles: forfest.css, named in index.html as <link rel="x-lazy-css"> (not loaded at start;
   the service worker still precaches it) and added here on the first open.
   No server writes, no migrations. Works offline. Screen Wake Lock while a game runs (where supported).
   No repeated card in one session (sessionStorage olnu.ffUsed). Virus rules last N cards, then an end card. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null;
  var C = null;                         // FORFEST_CONTENT when loaded
  var root = null, st = null, wl = null, cssDone = false, loading = null;
  var LS_KEY = "olnu.ff", NAMES_KEY = "olnu.ffNames", USED_KEY = "olnu.ffUsed";
  var TYPES_ALL = ["mest", "aldrig", "utm", "kat", "virus", "rost", "duo", "kapten", "order"];
  var WATER_EVERY = 22;                 // a water card every 22 cards
  var reduced = false;
  try { reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  /* ---------- UI strings (Swedish first, English fallback) ---------- */
  var S = {
    sv: {
      tile: "🎉 Förfest", lek: "🎉 Förfestläget", kicker: "🎉 En telefon · hela truppen",
      title: "FÖRFESTLÄGET", tag: "Ställ telefonen mitt på bordet, läs kortet högt och skicka runt. Inga konton, inget nät.",
      who: "Vilka ä med?", whoN: "{0} med", guest: "Gästens namn", add: "+ Lägg till", guestTag: "gäst",
      group: "Grupp", noPlayers: "Bocka i minst 2 som ä med (eller lägg till gäster).",
      pick: "Välj läge", cards: "{0} kort", nodrink: "🥤 Utan dricka", nodrinkSub: "Straffen blir knäböj, armhävningar och komplimanger.",
      fine: "Drick lugnt och ta vatten emellan. Ingen måste dricka: säg pass och gör ett annat straff. 18+.",
      loading: "Laddar korten…", loadFail: "Korten kunde int' laddas. Öppna appen med nät en gång, sen funkar dä offline.",
      next: "Nästa ›", prev: "‹", hint: "Tryck eller svep för nästa kort", back: "‹ Lägen", close: "Stäng",
      again: "🔀 Blanda om", toStart: "Till startsidan", awake: "Skärmen hålls vaken", left: "{0} kvar",
      virusLeft: "{0} kort kvar", svOnly: "",
      modes: {
        u: ["Uppvärmning", "Lugn start. Lär känna varandra, kategorier och 'Jag har aldrig'."],
        k: ["Kaos", "Allt kan hända. Virus, duos och vilda utmaningar."],
        s: ["Skyttegraven", "Armé-tema. Order från Generalen, givakt och honnör."]
      },
      types: { mest: "Mest troligt", aldrig: "Jag har aldrig", utm: "Utmaning", kat: "Kategori", virus: "Virus", virusEnd: "Virus slut",
        rost: "Omröstning", duo: "Duo", kapten: "Kapten", order: "Order från Generalen", water: "Vattenpaus", end: "Slut" }
    },
    en: {
      tile: "🎉 Pre-party", lek: "🎉 Pre-party mode", kicker: "🎉 One phone · the whole squad",
      title: "FÖRFESTLÄGET", tag: "Put the phone on the table, read the card out loud and pass it on. No accounts, no network.",
      who: "Who is here?", whoN: "{0} in", guest: "Guest name", add: "+ Add", guestTag: "guest",
      group: "Group", noPlayers: "Tick at least 2 players (or add guests).",
      pick: "Pick a mode", cards: "{0} cards", nodrink: "🥤 No drinks", nodrinkSub: "Penalties become squats, push-ups and compliments.",
      fine: "Drink slowly and have water in between. Nobody has to drink: say pass and do another penalty. 18+.",
      loading: "Loading the cards…", loadFail: "Could not load the cards. Open the app online once, then it works offline.",
      next: "Next ›", prev: "‹", hint: "Tap or swipe for the next card", back: "‹ Modes", close: "Close",
      again: "🔀 Shuffle again", toStart: "To the start", awake: "Screen stays on", left: "{0} left",
      virusLeft: "{0} cards left", svOnly: "The cards are in Swedish (Dalarna dialect).",
      modes: {
        u: ["Uppvärmning", "Warm-up. Get to know each other, categories and 'Never have I ever'."],
        k: ["Kaos", "Chaos. Anything goes: viruses, duos and wild challenges."],
        s: ["Skyttegraven", "The trench. Army theme: orders from the General, attention and salutes."]
      },
      types: { mest: "Most likely", aldrig: "Never have I ever", utm: "Challenge", kat: "Category", virus: "Virus", virusEnd: "Virus over",
        rost: "Vote", duo: "Duo", kapten: "Captain", order: "Order from the General", water: "Water break", end: "The end" }
    }
  };
  var EMO = { mest: "🤔", aldrig: "🙊", utm: "🎤", kat: "🗂️", virus: "🦠", virusEnd: "💉", rost: "🗳️", duo: "👯", kapten: "🎖️", order: "🪖", water: "💧", end: "🏁" };
  var MODE_EMO = { u: "🌅", k: "🌪️", s: "🪖" }, MODE_HEAT = { u: 1, k: 3, s: 2 };
  function en() { return !!(I && I.lang === "en"); }
  function T(k) {
    var v = en() && S.en[k] != null ? S.en[k] : S.sv[k];
    var args = Array.prototype.slice.call(arguments, 1);
    return typeof v === "string" ? v.replace(/\{(\d)\}/g, function (m, i) { return args[i] != null ? args[i] : ""; }) : v;
  }

  /* ---------- small helpers ---------- */
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
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function ssGet(k, d) { try { var v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function rnd(a) { return a[Math.floor(Math.random() * a.length)]; }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function cleanName(s) { return String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 20); }
  function myName() { try { return cleanName(A && A.getName ? A.getName() : ""); } catch (e) { return ""; } }

  /* ---------- lazy files ---------- */
  function lazySrc(re, sel, attr) {
    var n = Array.prototype.slice.call(document.querySelectorAll(sel)).filter(function (x) { return re.test(x.getAttribute(attr) || ""); })[0];
    return n ? n.getAttribute(attr) : null;
  }
  function ensureCss() {
    if (cssDone) return; cssDone = true;
    var href = lazySrc(/forfest\.css/, 'link[rel="x-lazy-css"]', "href") || "./forfest.css";
    if (document.querySelector('link[rel="stylesheet"][href="' + href + '"]')) return;
    document.head.appendChild(el("link", { rel: "stylesheet", href: href }));
  }
  function ensureContent() {
    if (window.FORFEST_CONTENT) { C = window.FORFEST_CONTENT; return Promise.resolve(C); }
    if (loading) return loading;
    var src = lazySrc(/forfest-content\.js/, 'script[type="text/x-lazy"]', "src") || "./js/forfest-content.js";
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement("script"); s.src = src; s.async = true;
      s.onload = function () { C = window.FORFEST_CONTENT || null; if (C) resolve(C); else { loading = null; reject(new Error("empty")); } };
      s.onerror = function () { s.remove(); loading = null; reject(new Error("load")); };
      document.head.appendChild(s);
    });
    return loading;
  }

  /* ---------- wake lock ---------- */
  function lockOn() {
    if (!st || !st.playing || wl || document.visibilityState !== "visible") return;
    try {
      if (!navigator.wakeLock || !navigator.wakeLock.request) return;
      navigator.wakeLock.request("screen").then(function (l) {
        if (!st || !st.playing) { try { l.release(); } catch (e) {} return; }
        wl = l; markAwake(true);
        l.addEventListener("release", function () { if (wl === l) { wl = null; markAwake(false); } });
      }).catch(function () {});
    } catch (e) {}
  }
  function lockOff() { var l = wl; wl = null; markAwake(false); if (l) { try { l.release(); } catch (e) {} } }
  function markAwake(on) { var n = root && root.querySelector(".ff-awake"); if (n) n.hidden = !on; }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") lockOn(); });

  /* ---------- players ---------- */
  function namesFor(gid) { var m = lsGet(NAMES_KEY, {}); return (gid && m[gid]) || []; }
  function saveNames(gid, names) {
    if (!gid) return;
    var m = lsGet(NAMES_KEY, {}); m[gid] = names.slice(0, 40);
    var keys = Object.keys(m); if (keys.length > 12) delete m[keys[0]];
    lsSet(NAMES_KEY, m);
  }
  function buildPlayers() {
    var pref = lsGet(LS_KEY, {}), offList = (pref.off && pref.off[st.gid || "-"]) || [];
    var seen = {}, out = [];
    function add(n, guest) {
      n = cleanName(n); if (!n) return; var k = n.toLowerCase(); if (seen[k]) return; seen[k] = 1;
      out.push({ name: n, guest: !!guest, on: offList.indexOf(n) < 0 });
    }
    var me = myName();
    if (me) add(me, false);
    st.members.forEach(function (n) { add(n, false); });
    (pref.guests || []).forEach(function (n) { add(n, true); });
    st.players = out;
  }
  function savePrefs() {
    var pref = lsGet(LS_KEY, {});
    pref.gid = st.gid || null; pref.nodrink = !!st.nodrink;
    pref.guests = st.players.filter(function (p) { return p.guest; }).map(function (p) { return p.name; }).slice(0, 12);
    pref.off = pref.off || {};
    pref.off[st.gid || "-"] = st.players.filter(function (p) { return !p.on; }).map(function (p) { return p.name; });
    lsSet(LS_KEY, pref);
  }
  function loadMembers(gid) {
    if (!gid || !A || !A.rpc) return;
    A.rpc("group_status", { p_group_id: gid }).then(function (r) {
      if (!st || st.gid !== gid || !r || r.error || !Array.isArray(r.data)) return;
      var me = myName(), names = [];
      r.data.forEach(function (x) { var n = cleanName(x && (x.is_me && me ? me : x.name)); if (n) names.push(n); });
      if (!names.length) return;
      saveNames(gid, names);
      st.members = names;
      var before = st.players.map(function (p) { return p.name; }).join("|");
      buildPlayers();
      if (!st.playing && before !== st.players.map(function (p) { return p.name; }).join("|")) renderStart();
    });
  }
  function active() { return st.players.filter(function (p) { return p.on; }); }

  /* ---------- deck ---------- */
  function parse(type, line, i) {
    var p = String(line).split("|");
    var c = { id: type + ":" + i, type: type, modes: p[0], text: p[1] || "" };
    if (p.length >= 4) { c.end = p[2]; c.n = Math.max(2, parseInt(p[3], 10) || 6); }
    c.two = /\{b\}/.test(line);
    return c;
  }
  function allCards() {
    var out = [];
    TYPES_ALL.forEach(function (t) { (C[t] || []).forEach(function (line, i) { out.push(parse(t, line, i)); }); });
    return out;
  }
  function modeCount(m) { return C ? allCards().filter(function (c) { return c.modes.indexOf(m) >= 0; }).length : 0; }
  function buildDeck() {
    var used = ssGet(USED_KEY, []);
    st.deck = shuffle(allCards().filter(function (c) { return c.modes.indexOf(st.mode) >= 0 && used.indexOf(c.id) < 0; }));
  }
  // Mode flavour: Skyttegraven prefers army-only cards, Kaos prefers the wild ones (no "u").
  function special(c) {
    if (st.mode === "s") return c.modes === "s";
    if (st.mode === "k") return c.modes.indexOf("u") < 0;
    return c.modes.indexOf("u") >= 0 && c.modes.length === 1;
  }
  function pickIndex() {
    var n = Math.min(st.deck.length, 14), last = st.lastTypes, cands = [];
    for (var i = 0; i < n; i++) {
      var c = st.deck[i];
      if (last.indexOf(c.type) >= 0 && st.deck.length > 6) continue;
      if (c.type === "virus" && (st.viruses.length >= 2 || st.count - st.lastVirus < 4)) continue;
      if (c.type === "kapten" && st.count - st.lastKapten < 5) continue;
      if (c.two && active().length < 2) continue;
      cands.push(i);
    }
    if (!cands.length) return st.deck.length ? 0 : -1;
    var pref = st.mode === "s" ? 0.5 : st.mode === "k" ? 0.45 : 0.25;
    if (Math.random() < pref) { for (var j = 0; j < cands.length; j++) if (special(st.deck[cands[j]])) return cands[j]; }
    return cands[0];
  }
  function markUsed(id) { var u = ssGet(USED_KEY, []); if (u.indexOf(id) < 0) { u.push(id); ssSet(USED_KEY, u.slice(-2000)); } }

  // Two different players, the least named first (fair turns), random among equals.
  function pickPlayers() {
    var ps = shuffle(active().slice());
    ps.sort(function (x, y) { return (st.named[x.name] | 0) - (st.named[y.name] | 0); });
    return [ps[0] ? ps[0].name : "?", ps[1] ? ps[1].name : (ps[0] ? ps[0].name : "?")];
  }
  function pen(key) {
    var set = st.nodrink ? C.nodrink : C.drink;
    return rnd((set && set[key]) || [["tar en klunk", "ta en klunk"]]);
  }
  // Text with tokens -> parts [{t}|{name}|{pen}] (built as DOM later, never as HTML).
  function fill(text, a, b, n) {
    var parts = [], re = /\{(a|b|n|k1|k2|d3|K1|K2|D3)\}/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parts.push({ t: text.slice(last, m.index) });
      var k = m[1];
      if (k === "a") parts.push({ name: a });
      else if (k === "b") parts.push({ name: b });
      else if (k === "n") parts.push({ t: String(n || "") });
      else {
        var p = pen(k.toLowerCase()), imp = k !== k.toLowerCase();
        var s = imp ? p[1] : p[0];
        if (imp) {
          var before = parts.map(function (x) { return x.t || x.name || x.pen || ""; }).join("").replace(/\s+$/, "");
          if (!before || /[.?!:]$/.test(before)) s = s.charAt(0).toUpperCase() + s.slice(1);
        }
        parts.push({ pen: s });
      }
      last = re.lastIndex;
    }
    if (last < text.length) parts.push({ t: text.slice(last) });
    return parts;
  }
  function makeCard(c) {
    var ab = pickPlayers(), a = ab[0], b = ab[1];
    if (/\{a\}/.test(c.text + (c.end || ""))) st.named[a] = (st.named[a] | 0) + 1;
    if (/\{b\}/.test(c.text + (c.end || ""))) st.named[b] = (st.named[b] | 0) + 1;
    var card = { type: c.type, id: c.id, parts: fill(c.text.replace(/^VIRUS:\s*/, ""), a, b, c.n), rule: null };
    var rules = C.rules && C.rules[c.type];
    if (rules && rules.length && !/\{(k1|k2|d3|K1|K2|D3)\}/.test(c.text)) card.rule = fill(rnd(rules), a, b);
    else if (c.type === "rost" && rules) card.rule = fill(rnd(rules), a, b);
    if (c.end) {
      card.virusN = c.n;
      st.viruses.push({ id: c.id, left: c.n, label: labelOf(c.text, a, b), end: fill(c.end, a, b), type: c.type });
      if (c.type === "virus") st.lastVirus = st.count;
    }
    if (c.type === "kapten") st.lastKapten = st.count;
    return card;
  }
  function labelOf(text, a, b) {
    var s = text.replace(/^VIRUS:\s*/, "").replace(/\{a\}/g, a).replace(/\{b\}/g, b).replace(/\{[A-Za-z0-9]+\}/g, "…");
    s = s.split(/[.?!]/)[0];
    return s.length > 34 ? s.slice(0, 33) + "…" : s;
  }
  function draw() {
    // 1. A virus that ran out ends first.
    var endIdx = -1;
    for (var i = 0; i < st.viruses.length; i++) if (st.viruses[i].left <= 0) { endIdx = i; break; }
    if (endIdx >= 0) {
      var v = st.viruses.splice(endIdx, 1)[0];
      return { type: "virusEnd", parts: v.end, rule: null, from: v.type };
    }
    var card;
    if (st.count > 0 && st.count % WATER_EVERY === 0 && !st.waterAt[st.count]) {
      st.waterAt[st.count] = 1;
      card = { type: "water", parts: [{ t: rnd(C.water || ["💧"]) }], rule: null };
    } else {
      var idx = pickIndex();
      if (idx < 0) return { type: "end", parts: [{ t: rnd(C.empty || ["Slut!"]) }], rule: null, empty: true };
      var c = st.deck.splice(idx, 1)[0];
      markUsed(c.id);
      card = makeCard(c);
      st.lastTypes.push(c.type); if (st.lastTypes.length > 2) st.lastTypes.shift();
    }
    st.count++;
    // Every other running virus counts this card.
    st.viruses.forEach(function (v) { if (v.id !== card.id) v.left--; });
    return card;
  }

  /* ---------- overlay ---------- */
  function ensureRoot() {
    if (root && document.body.contains(root)) return root;
    root = el("div", { id: "ff", class: "ff", role: "dialog", "aria-modal": "true", "aria-label": T("title"), hidden: true });
    document.body.appendChild(root);
    root.addEventListener("keydown", function (e) {
      if (!st) return;
      if (e.key === "Escape") { e.preventDefault(); if (st.playing) toStart(); else close(); }
      else if (st.playing && (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") && !(e.target && /INPUT|BUTTON/.test(e.target.tagName))) { e.preventDefault(); next(); }
      else if (st.playing && e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    });
    return root;
  }
  window.addEventListener("popstate", function () {
    if (!root || root.hidden || !st) return;
    if (st.playing && !st.closing) { toStart(); try { history.pushState({ ff: 1 }, ""); } catch (e) {} }
    else close(true);
  });
  function open(g) {
    if (window.OLNU_STRIP && window.OLNU_STRIP.up && window.OLNU_STRIP.up()) { window.OLNU_STRIP.after(function () { open(g); }); return; }
    ensureCss();
    var pref = lsGet(LS_KEY, {});
    var gid = (g && g.id) || pref.gid || null, gname = (g && g.name) || "";
    st = { gid: gid, gname: gname, members: namesFor(gid), players: [], nodrink: !!pref.nodrink, mode: null, playing: false,
      deck: [], hist: [], pos: -1, viruses: [], count: 0, lastTypes: [], named: {}, lastVirus: -99, lastKapten: -99, waterAt: {} };
    buildPlayers();
    try { if (A && A.sheetOpen && A.sheetOpen()) A.closeSheet("forfest"); } catch (e) {}
    ensureRoot().hidden = false;
    document.documentElement.classList.add("ff-on");
    try { history.pushState({ ff: 1 }, ""); } catch (e) {}
    renderStart();
    loadMembers(gid);
    ensureContent().then(function () { if (st && !st.playing) renderStart(); }, function () { if (st && !st.playing) renderStart(); });
  }
  function close(fromPop) {
    if (!fromPop && st) { try { if (history.state && history.state.ff) { st.closing = true; var s0 = st; history.back(); setTimeout(function () { if (st === s0) close(true); }, 500); return; } } catch (e) {} }
    lockOff();
    if (st) savePrefs();
    st = null;
    if (root) { root.hidden = true; root.innerHTML = ""; root.className = "ff"; }
    document.documentElement.classList.remove("ff-on");
  }

  /* ---------- start screen ---------- */
  function renderStart() {
    if (!st || !root) return;
    st.playing = false; lockOff();
    root.className = "ff ff-s";
    root.innerHTML = "";
    var wrap = el("div", { class: "ff-start" });
    wrap.appendChild(el("div", { class: "ff-bar" }, [
      el("span", { class: "ff-kick", text: T("kicker") }),
      el("button", { type: "button", class: "ff-x", "aria-label": T("close"), text: "✕", onclick: function () { close(); } })
    ]));
    wrap.appendChild(el("div", { class: "ff-hero" }, [
      el("h1", { class: "ff-h1", text: T("title") }),
      el("p", { class: "ff-tag", text: T("tag") }),
      T("svOnly") ? el("p", { class: "ff-tag ff-sv", text: T("svOnly") }) : null
    ]));

    // Players
    var ps = st.players, onN = active().length;
    var sec = el("section", { class: "ff-sec", "aria-label": T("who") });
    sec.appendChild(el("div", { class: "ff-sh" }, [
      el("h2", { text: T("who") }),
      el("span", { class: "ff-n" + (onN < 2 ? " low" : ""), text: T("whoN", onN) + (st.gname ? " · " + st.gname : "") })
    ]));
    var chips = el("div", { class: "ff-chips" });
    ps.forEach(function (p) {
      var b = el("button", { type: "button", class: "ff-chip" + (p.on ? " on" : "") + (p.guest ? " guest" : ""), "aria-pressed": String(p.on) }, [
        el("span", { class: "ff-ck", "aria-hidden": "true", text: p.on ? "✓" : "" }), el("span", { class: "ff-cn", text: p.name }),
        p.guest ? el("span", { class: "ff-gt", text: T("guestTag") }) : null
      ]);
      b.addEventListener("click", function () { p.on = !p.on; savePrefs(); renderStart(); });
      chips.appendChild(b);
    });
    sec.appendChild(chips);
    var inp = el("input", { class: "ff-inp", type: "text", maxlength: "20", placeholder: T("guest"), "aria-label": T("guest"), enterkeyhint: "done", autocomplete: "off" });
    var form = el("form", { class: "ff-add" }, [inp, el("button", { type: "submit", class: "ff-addb", text: T("add") })]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var n = cleanName(inp.value); if (!n) return;
      var hit = st.players.filter(function (p) { return p.name.toLowerCase() === n.toLowerCase(); })[0];
      if (hit) hit.on = true; else if (st.players.filter(function (p) { return p.guest; }).length < 12) st.players.push({ name: n, guest: true, on: true });
      savePrefs(); renderStart();
      var ni = root.querySelector(".ff-inp"); if (ni) ni.focus();
    });
    sec.appendChild(form);
    if (onN < 2) sec.appendChild(el("p", { class: "ff-warn", role: "status", text: T("noPlayers") }));
    wrap.appendChild(sec);

    // Modes
    var ms = el("section", { class: "ff-modes", "aria-label": T("pick") });
    ms.appendChild(el("h2", { class: "ff-mh", text: T("pick") }));
    ["u", "k", "s"].forEach(function (m) {
      var info = T("modes")[m], cnt = C ? modeCount(m) : 0;
      var heat = el("span", { class: "ff-heat", "aria-hidden": "true" });
      for (var i = 0; i < 3; i++) heat.appendChild(el("i", { class: i < MODE_HEAT[m] ? "on" : "" }));
      var b = el("button", { type: "button", class: "ff-mode m-" + m, disabled: !C || onN < 2 ? true : null }, [
        el("span", { class: "ff-me", "aria-hidden": "true", text: MODE_EMO[m] }),
        el("span", { class: "ff-mb" }, [
          el("span", { class: "ff-mn", text: info[0] }),
          el("span", { class: "ff-ms", text: info[1] }),
          el("span", { class: "ff-mf" }, [heat, el("span", { class: "ff-mc", text: C ? T("cards", cnt) : T("loading") })])
        ]),
        el("span", { class: "ff-go", "aria-hidden": "true", text: "›" })
      ]);
      b.addEventListener("click", function () { start(m); });
      ms.appendChild(b);
    });
    if (!C && !loading) ms.appendChild(el("p", { class: "ff-warn", text: T("loadFail") }));
    wrap.appendChild(ms);

    // No-drink switch
    var cb = el("input", { type: "checkbox", class: "ff-cb", id: "ff-nodrink" });
    cb.checked = !!st.nodrink;
    cb.addEventListener("change", function () { st.nodrink = cb.checked; savePrefs(); });
    wrap.appendChild(el("label", { class: "ff-sw", for: "ff-nodrink" }, [
      cb, el("span", { class: "ff-swt" }, [el("b", { text: T("nodrink") }), el("small", { text: T("nodrinkSub") })])
    ]));
    wrap.appendChild(el("p", { class: "ff-fine", text: T("fine") }));
    root.appendChild(wrap);
  }

  /* ---------- game ---------- */
  function start(m) {
    if (!C || active().length < 2) return;
    st.mode = m; st.playing = true; savePrefs();
    st.hist = []; st.pos = -1; st.viruses = []; st.count = 0; st.lastTypes = []; st.lastVirus = -99; st.lastKapten = -99; st.waterAt = {};
    buildDeck();
    renderGame();
    st.hist.push({ type: "intro", parts: [{ t: rnd(C.intro || ["Nu kör vi!"]) }], rule: null });
    st.pos = 0;
    showCard(0);
    lockOn();
  }
  function toStart() { renderStart(); }
  function renderGame() {
    root.className = "ff ff-g";
    root.innerHTML = "";
    var info = T("modes")[st.mode];
    var top = el("div", { class: "ff-top" }, [
      el("button", { type: "button", class: "ff-tb ff-back", text: T("back"), onclick: function () { toStart(); } }),
      el("span", { class: "ff-tm" }, [el("span", { text: MODE_EMO[st.mode] + " " + info[0] }), el("span", { class: "ff-cnt" })]),
      el("span", { class: "ff-awake", title: T("awake"), "aria-label": T("awake"), hidden: true, text: "🔆" }),
      el("button", { type: "button", class: "ff-tb ff-x", "aria-label": T("close"), text: "✕", onclick: function () { close(); } })
    ]);
    root.appendChild(top);
    root.appendChild(el("div", { class: "ff-vir", "aria-live": "polite" }));
    var stage = el("div", { class: "ff-stage" });
    root.appendChild(stage);
    var foot = el("div", { class: "ff-foot" }, [
      el("button", { type: "button", class: "ff-tb ff-prev", "aria-label": en() ? "Previous card" : "Förra kortet", text: T("prev"), onclick: function () { prev(); } }),
      el("span", { class: "ff-hint", text: T("hint") }),
      el("button", { type: "button", class: "ff-nb", text: T("next"), onclick: function () { next(); } })
    ]);
    root.appendChild(foot);
    swipe(stage);
    if (wl) markAwake(true);
  }
  function swipe(stage) {
    var x0 = 0, y0 = 0, t0 = 0, down = false, card = null, moved = false;
    stage.addEventListener("pointerdown", function (e) {
      if (e.button > 0) return;
      if (e.target.closest && e.target.closest("button")) return;
      down = true; moved = false; x0 = e.clientX; y0 = e.clientY; t0 = Date.now(); card = stage.querySelector(".ff-card");
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
    });
    stage.addEventListener("pointermove", function (e) {
      if (!down || !card) return;
      var dx = e.clientX - x0;
      if (Math.abs(dx) > 8) moved = true;
      if (!reduced && moved) card.style.transform = "translateX(" + dx + "px) rotate(" + (dx / 40) + "deg)";
    });
    function end(e) {
      if (!down) return; down = false;
      var dx = e.clientX - x0, dy = e.clientY - y0;
      if (card) card.style.transform = "";
      if (e.type === "pointercancel") return;
      if (dx < -60 && Math.abs(dx) > Math.abs(dy)) next();
      else if (dx > 60 && Math.abs(dx) > Math.abs(dy)) prev();
      else if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && Date.now() - t0 < 600) next();
    }
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
  }
  function next() {
    if (!st || !st.playing) return;
    var cur = st.hist[st.pos];
    if (cur && cur.empty && st.pos === st.hist.length - 1) return;
    if (st.pos < st.hist.length - 1) { st.pos++; showCard(1); return; }
    st.hist.push(draw());
    if (st.hist.length > 400) st.hist.shift();
    st.pos = st.hist.length - 1;
    showCard(1);
  }
  function prev() {
    if (!st || !st.playing || st.pos <= 0) return;
    st.pos--; showCard(-1);
  }
  function partsDom(parts, cls) {
    var p = el("p", { class: cls });
    (parts || []).forEach(function (x) {
      if (x.name != null) p.appendChild(el("b", { class: "ff-who", text: x.name }));
      else if (x.pen != null) p.appendChild(el("b", { class: "ff-pen", text: x.pen }));
      else p.appendChild(document.createTextNode(x.t || ""));
    });
    return p;
  }
  function showCard(dir) {
    var c = st.hist[st.pos]; if (!c) return;
    var tp = c.type === "intro" ? "intro" : c.type;
    root.className = "ff ff-g t-" + tp + " m-" + st.mode;
    var stage = root.querySelector(".ff-stage"); if (!stage) return;
    var names = T("types");
    var label = tp === "intro" ? MODE_EMO[st.mode] + " " + T("modes")[st.mode][0] : (EMO[tp] || "") + " " + (names[tp] || "");
    var art = el("article", { class: "ff-card" + (dir && !reduced ? (dir > 0 ? " in-r" : " in-l") : ""), "aria-live": "polite", "aria-roledescription": "kort" }, [
      el("div", { class: "ff-type", text: label }),
      partsDom(c.parts, "ff-text" + (lenOf(c.parts) > 140 ? " long" : "")),
      c.rule ? partsDom(c.rule, "ff-rule") : null,
      c.virusN ? el("p", { class: "ff-vn", text: "🦠 " + T("virusLeft", c.virusN) }) : null
    ]);
    if (c.empty) {
      art.appendChild(el("div", { class: "ff-endb" }, [
        el("button", { type: "button", class: "ff-nb", text: T("again"), onclick: function (e) { e.stopPropagation(); reshuffle(); } }),
        el("button", { type: "button", class: "ff-tb", text: T("toStart"), onclick: function (e) { e.stopPropagation(); toStart(); } })
      ]));
    }
    stage.innerHTML = "";
    stage.appendChild(art);
    var cnt = root.querySelector(".ff-cnt");
    if (cnt) cnt.textContent = " · #" + st.count + " · " + T("left", st.deck.length);
    var pb = root.querySelector(".ff-prev"); if (pb) pb.disabled = st.pos <= 0;
    var vir = root.querySelector(".ff-vir");
    if (vir) {
      vir.innerHTML = "";
      st.viruses.forEach(function (v) {
        vir.appendChild(el("span", { class: "ff-vc" + (v.type === "kapten" ? " cap" : ""), text: (v.type === "kapten" ? "🎖️ " : "🦠 ") + v.label + " · " + Math.max(0, v.left) }));
      });
    }
  }
  function lenOf(parts) { return (parts || []).reduce(function (n, x) { return n + String(x.t || x.name || x.pen || "").length; }, 0); }
  function reshuffle() {
    var ids = allCards().filter(function (c) { return c.modes.indexOf(st.mode) >= 0; }).map(function (c) { return c.id; });
    ssSet(USED_KEY, ssGet(USED_KEY, []).filter(function (id) { return ids.indexOf(id) < 0; }));
    var m = st.mode; start(m);
  }

  /* ---------- entry points ---------- */
  function lekButton(g) {
    var b = el("button", { type: "button", class: "btn btn-small btn-block ff-lek", style: "margin-top:10px", text: T("lek") });
    b.addEventListener("click", function () { open(g && g.id ? { id: g.id, name: g.name || "" } : null); });
    return b;
  }
  function groupItem(g, wrap) {
    if (!g || !g.id || !wrap) return;
    var row = el("div", { class: "ff-gi" });
    var b = el("button", { type: "button", class: "btn btn-small btn-block ff-gbtn" }, [el("span", { class: "ff-gl", text: T("tile") })]);
    b.addEventListener("click", function () { open({ id: g.id, name: g.name || "" }); });
    row.appendChild(b);
    wrap.appendChild(row);
  }

  window.FORFEST = {
    open: open, close: close, lekButton: lekButton,
    _state: function () { return st; },
    init: function (api) { A = api; },
    groupItem: function (g, wrap) { groupItem(g, wrap); }
  };
})();
