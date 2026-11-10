/* PintsNow — DIALEKT: the central string layer for fun copy, per dialect region (D2; research D1, 2026-11-10).
   Sits ON TOP of i18n.js: a call site keeps L(sv, en) and asks DIALEKT for the Swedish part:
     L(DIALEKT.t("grp.empty"), "Nobody out yet – you decide when you go")
   - t(key, vars, def): looks the key up in the region packs in order (chain()):
       scheme B: the kommun's B pack (sv-smaland …) → its A pack (sv-syd …) → "<lang>-neutral" → def → the key itself.
       scheme A (default): A pack → neutral → def → key.   Mode "off": neutral → def → key.
     A value = "text" | ["variant", {t: "variant", not: ["sv-smaland"]}, {t: "…", only: ["sv-gotland"]}] | function(vars).
     Several variants: one is picked by a hash of key + night (05:00–05:00 local) + vars._seed, so a re-render never
     flickers and the same toast says the same thing all night. "{name}" = vars.name (a missing var → "").
     Returns plain text: escape it before you put it in innerHTML.
   - region(): the most specific pack in use = chain()[0] ("sv-dalarna"; "sv-neutral" when off / unknown). area(): {cc, lang, code, name, a, b, src}.
     Sources, first hit wins: preview(code) → setArea() / api.lastLoc() (current position; mods hook) → olnu.pushLoc
     (push.js, < 12 h) → olnu.homeTown (hometown.js, the name) → olnu.home (homezone.js) → olnu.htPos (< 30 d) → neutral.
     No geolocation of its own, no network host of its own.
   - Data: ./zones/dialekt-kommun.json (scripts/dialekt-kommun.py from the D1 CSV; sw.js caches zones/*.json offline):
     290 kommuner (SCB code, name, A and B region), town aliases, a 0.025° × 0.05° lat/lng → kommun grid. Loaded on the
     first t() / region() call or on idle 2 s after load. Until then the last region (localStorage olnu.dialekt.r) is used.
   - Countries: every dataset has a country code (cc) and a language (lang). Norway / Denmark / Finland = one more data
     file + "nb-*" / "da-*" / "fi-*" packs via register(); nothing here says "Sverige".
   - setMode("auto" | "off") (localStorage olnu.dialekt), onChange(cb), settingsRow() (the Inställningar switch row; the
     social lane places it), register(locale, pack). Mods hooks: init(api), onPoll() (only if app.js lists DIALEKT).
   Starter packs below are DRAFT demo lines (Stage 1); the real lines come in Stage 4 and are reviewed by the owner. */
(function () {
  "use strict";
  var LS = "olnu.dialekt", LS_R = "olnu.dialekt.r";
  var DATA = ["./zones/dialekt-kommun.json"];
  var NIGHT_H = 5, LOC_MS = 12 * 3600e3, HT_MS = 30 * 864e5;
  // B pack → its usual A pack (only used for preview(); real lookups use the kommun's own A code from the data)
  var PARENT = { "sv-smaland": "sv-syd", "sv-varmland": "sv-vast", "sv-norr-ovre": "sv-norr", "sv-norr-mitt": "sv-norr", "sv-gotland": "sv-neutral" };
  var NAME = { "sv-neutral": "Neutral", "sv-syd": "Syd", "sv-vast": "Väst", "sv-sthlm": "Stockholm", "sv-dalarna": "Dalarna", "sv-norr": "Norrland",
    "sv-smaland": "Småland", "sv-varmland": "Värmland", "sv-norr-ovre": "Övre Norrland", "sv-norr-mitt": "Mitt-Norrland", "sv-gotland": "Gotland" };

  var packs = {}, sets = [], dataP = null, failAt = 0, api = null, explicit = null, area = null, lastSig = "", lastLL = "", subs = [], rows = [];
  var nowFn = function () { return Date.now(); };
  var stats = { loads: 0, loadMs: null, resolves: 0, missVars: 0, miss: {}, err: null };

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var st = lsGet(LS) || {}; if (st.mode !== "off") st.mode = "auto";
  (function () { var c = lsGet(LS_R); if (c && c.a && c.lang) area = c; })();
  function save() { lsSet(LS, { mode: st.mode, force: st.force || null, scheme: st.scheme || null }); }

  function lang() { try { var l = window.I18N && window.I18N.lang; return l ? String(l) : "sv"; } catch (e) { return "sv"; } }
  function neutral() { return lang() + "-neutral"; }
  function scheme() { return st.scheme || (sets[0] && sets[0].scheme) || "A"; }

  /* ---------- norm: same as scripts/dialekt-kommun.py norm() (å ä ö stay: Habo ≠ Håbo) ---------- */
  function norm(s) {
    s = String(s == null ? "" : s).replace(/\([^)]*\)/g, " ").toLowerCase().trim().replace(/\s+kommun$/, "");
    if (s.normalize) s = s.normalize("NFC");
    return s.replace(/[^a-z0-9åäö]/g, function (c) { return c.normalize ? c.normalize("NFD").replace(/[^a-z0-9]/g, "") : ""; });
  }

  /* ---------- data ---------- */
  function addSet(d) {
    if (!d || !d.k || !d.codes) return;
    var s = { cc: d.cc || "", lang: d.lang || "sv", scheme: d.scheme || "A", codes: d.codes, k: d.k, byCode: {}, byName: {}, alias: d.alias || {}, grid: d.grid || null, rowsC: {} };
    d.k.forEach(function (x, i) { s.byCode[x[0]] = i; s.byName[norm(x[1])] = i; });
    sets.push(s);
  }
  function load() {
    if (dataP || sets.length) return dataP;
    if (failAt && nowFn() - failAt < 60e3) return null;
    var t0 = performance.now(); stats.loads++;
    dataP = Promise.all(DATA.map(function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error("dialekt " + r.status); return r.json(); }); }))
      .then(function (all) { all.forEach(addSet); stats.loadMs = Math.round(performance.now() - t0); resolve(); return true; })
      .catch(function (e) { stats.err = String(e && e.message || e); failAt = nowFn(); dataP = null; return false; });
    return dataP;
  }
  function ensure() { if (!sets.length && !dataP) load(); }
  function entry(s, i, src) {
    var x = s.k[i]; if (!x) return null;
    return { cc: s.cc, lang: s.lang, code: x[0], name: x[1], a: s.codes[x[2]], b: s.codes[x[3]], src: src };
  }
  function gridRow(s, r) {
    if (s.rowsC[r]) return s.rowsC[r];
    var out = [], tok = (s.grid.rows[r] || "").split(",");
    for (var i = 0; i < tok.length; i++) {
      var p = tok[i].split("*"), v = p[0] === "-" ? -1 : parseInt(p[0], 36), n = p[1] ? parseInt(p[1], 36) : 1;
      for (var j = 0; j < n; j++) out.push(v);
    }
    return (s.rowsC[r] = out);
  }
  function fromLL(lat, lng, src) {
    lat = +lat; lng = +lng; if (!isFinite(lat) || !isFinite(lng)) return null;
    for (var i = 0; i < sets.length; i++) {
      var s = sets[i], g = s.grid; if (!g) continue;
      var r = Math.floor((lat - g.lat0) / g.dlat), c = Math.floor((lng - g.lng0) / g.dlng);
      if (r < 0 || c < 0 || r >= g.rows.length) continue;
      var v = gridRow(s, r)[c];
      if (v != null && v >= 0) return entry(s, v, src);
    }
    return null;
  }
  function fromName(name, src) {
    var n = norm(name); if (!n) return null;
    for (var i = 0; i < sets.length; i++) {
      var s = sets[i], k = s.byName[n];
      if (k == null && s.alias[n]) k = s.byCode[s.alias[n]];
      if (k != null) return entry(s, k, src);
    }
    return null;
  }
  function fromCode(code, cc, src) {
    for (var i = 0; i < sets.length; i++) { var s = sets[i]; if (cc && s.cc !== cc) continue; var k = s.byCode[String(code)]; if (k != null) return entry(s, k, src); }
    return null;
  }
  function fromAny(x, src) {
    if (!x) return null;
    if (x.code != null) return fromCode(x.code, x.cc, src);
    if (isFinite(x.lat) && isFinite(x.lng)) return fromLL(x.lat, x.lng, src);
    if (x.name) return fromName(x.name, src);
    return null;
  }

  /* ---------- region detection (the app's own data, first hit wins) ---------- */
  function detect() {
    var now = nowFn(), a = null, ll, v;
    if (explicit && now - explicit.at < LOC_MS) a = fromAny(explicit.x, "set");
    if (!a && api && api.lastLoc) { try { ll = api.lastLoc(); } catch (e) { ll = null; } if (ll) { a = fromLL(ll.lat, ll.lng, "loc"); lastLL = llKey(ll); } }
    if (!a) { v = lsGet("olnu.pushLoc"); if (v && v.c && now - (v.t || 0) < LOC_MS) { var p = String(v.c).split(","); a = fromLL(+p[0] / 100, +p[1] / 100, "push"); } }
    if (!a) {
      var town = null; try { town = (window.HOMETOWN && window.HOMETOWN.mine && window.HOMETOWN.mine()) || localStorage.getItem("olnu.homeTown"); } catch (e) {}
      if (town) a = fromName(town, "hometown");
    }
    if (!a) { v = lsGet("olnu.home"); if (v && isFinite(v.lat)) a = fromLL(v.lat, v.lng, "homezone"); }
    if (!a) { v = lsGet("olnu.htPos"); if (v && isFinite(v.lat) && now - (v.at || 0) < HT_MS) a = fromLL(v.lat, v.lng, "htpos"); }
    return a;
  }
  function llKey(ll) { return ll ? (Math.round(ll.lat * 100) + "," + Math.round(ll.lng * 100)) : ""; }
  function resolve() {
    if (!sets.length) return;
    stats.resolves++;
    var a = detect();
    area = a; lsSet(LS_R, a ? { cc: a.cc, lang: a.lang, code: a.code, name: a.name, a: a.a, b: a.b, src: a.src, at: nowFn() } : null);
    emit();
  }

  /* ---------- lookup ---------- */
  function chain() {
    var N = neutral(), out = [];
    function add(c) { if (c && out.indexOf(c) < 0) out.push(c); }
    if (st.mode === "off") return [N];
    if (st.force) { add(st.force); add(PARENT[st.force]); add(N); return out; }
    if (area && area.lang === lang()) {
      // scheme B: the B code decides (a B code "neutral" = neutral, e.g. Gästrikland); a missing key falls back to A
      if (scheme() === "B" && area.b) { add(area.b); if (area.b !== N) add(area.a); }
      else add(area.a);
    }
    add(N);
    return out;
  }
  // the most specific pack in use: the A code (scheme A), the B code (scheme B), the preview code, or neutral
  function region() { ensure(); return chain()[0]; }
  // codes a variant's not/only lists are checked against: the kommun's A and B code (B even in scheme A), or the preview
  function ctxCodes() {
    if (st.mode === "off") return [neutral()];
    if (st.force) return [st.force, PARENT[st.force]].filter(Boolean);
    return area ? [area.a, area.b].filter(Boolean) : [];
  }
  function night() {
    var d = new Date(nowFn() - NIGHT_H * 3600e3);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function hash(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
  function okVar(v, cs) {
    if (!v || typeof v !== "object") return true;
    if (v.not && v.not.some(function (c) { return cs.indexOf(c) >= 0; })) return false;
    if (v.only && !v.only.some(function (c) { return cs.indexOf(c) >= 0; })) return false;
    return true;
  }
  function pick(key, v, vars, cs) {
    if (typeof v === "function") { try { v = v(vars || {}); } catch (e) { return null; } }
    if (v == null) return null;
    if (!Array.isArray(v)) v = [v];
    var ok = v.filter(function (x) { return okVar(x, cs); });
    if (!ok.length) return null;
    var x = ok.length === 1 ? ok[0] : ok[hash(key + "|" + night() + "|" + (vars && vars._seed != null ? vars._seed : "")) % ok.length];
    if (x && typeof x === "object") x = x.t;
    return x == null ? null : String(x);
  }
  function fill(s, vars) {
    return s.replace(/\{([A-Za-z_][\w]*)\}/g, function (m, k) {
      if (vars && vars[k] != null) return String(vars[k]);
      stats.missVars++; return "";
    });
  }
  function t(key, vars, def) {
    ensure();
    var ch = chain(), cs = ctxCodes(), s;
    for (var i = 0; i < ch.length; i++) {
      var p = packs[ch[i]]; if (!p || !Object.prototype.hasOwnProperty.call(p, key)) continue;
      s = pick(key, p[key], vars, cs); if (s != null) return fill(s, vars);
    }
    if (def != null) { s = pick(key, def, vars, cs); if (s != null) return fill(s, vars); }
    stats.miss[key] = (stats.miss[key] || 0) + 1;
    return String(key);
  }
  function register(locale, pack) {
    if (!locale || !pack) return;
    var p = packs[locale] || (packs[locale] = {});
    Object.keys(pack).forEach(function (k) { p[k] = pack[k]; });
  }

  /* ---------- change events ---------- */
  function sig() { return [st.mode, st.force || "", scheme(), area ? area.code + area.a + area.b : "", lang()].join("|"); }
  function emit() {
    var s = sig(); if (s === lastSig) return; lastSig = s;
    var info = { region: region(), area: area, mode: st.mode, chain: chain() };
    subs.slice().forEach(function (cb) { try { cb(info); } catch (e) { try { console.warn("dialekt onChange", e); } catch (x) {} } });
    rows.forEach(paintRow);
    try { window.dispatchEvent(new CustomEvent("dialekt:change", { detail: info })); } catch (e) {}
  }
  function onChange(cb) {
    if (typeof cb !== "function") return function () {};
    subs.push(cb);
    return function () { var i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1); };
  }

  /* ---------- settings row (DESIGN ds17: an on/off setting = a row with a switch; state in the sub-line) ---------- */
  var CSS = ".dk-set .pn-sw-l{display:flex;flex-direction:column;min-width:0;text-align:left}" +
    ".dk-set .dk-sub{display:block;font-size:var(--ds-fs-14,14px);line-height:var(--ds-lh-14,20px);font-weight:400;color:var(--ds-muted,#9aa6bd);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}";
  function sv() { return lang() !== "en"; }
  function sub() {
    if (st.mode === "off") return sv() ? "Av · rikssvenska överallt" : "Off · standard Swedish";
    var r = region(), n = NAME[r] || r;
    if (st.force) return (sv() ? "Förhandsvisning · " : "Preview · ") + (NAME[st.force] || st.force);
    return "Auto · " + n + (area && area.name ? " (" + area.name + ")" : sv() ? " · ingen ort än" : " · no town yet");
  }
  function paintRow(row) {
    var b = row.querySelector(".dk-sw"), on = st.mode !== "off";
    if (!b) return;
    b.setAttribute("aria-checked", String(on));
    var sw = b.querySelector(".switch"); if (sw) sw.setAttribute("aria-checked", String(on));
    var s = b.querySelector(".dk-sub"); if (s) s.textContent = sub();
  }
  function settingsRow() {
    ensure();
    if (!document.getElementById("dk-css")) { var c = document.createElement("style"); c.id = "dk-css"; c.textContent = CSS; document.head.appendChild(c); }
    var ic = ""; try { ic = window.PNI ? window.PNI.svg("chat", "pi-lead") : ""; } catch (e) {}
    var row = document.createElement("div"); row.className = "row dk-set";
    var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-block pn-swb dk-sw"; b.setAttribute("role", "switch");
    b.innerHTML = ic + '<span class="pn-sw-l">' + (sv() ? "Dialekt" : "Dialect") + '<small class="dk-sub"></small></span><span class="switch" aria-hidden="true"></span>';
    b.addEventListener("click", function () { setMode(st.mode === "off" ? "auto" : "off"); paintRow(row); });
    row.appendChild(b); rows.push(row); rows = rows.slice(-4); paintRow(row);   // the sheet is rebuilt often: keep the last few
    return row;
  }

  function setMode(m) { m = m === "off" ? "off" : "auto"; if (m === st.mode) return; st.mode = m; save(); emit(); }

  /* ---------- DRAFT starter packs (Stage 1 demo keys; Stage 4 writes the real lines; owner + friends review) ----------
     From the D1 research sample line (grp.empty) and its word lists. Not shown anywhere yet: no call site uses them. */
  var DRAFT = { _meta: { draft: true, src: "D1-dialects.md 2026-11-10" } };
  register("sv-neutral", {
    _meta: DRAFT._meta,
    "grp.empty": "Ingen ute än – du bestämmer när ni drar.",
    "live.quiet": ["Lugnt i stan än så länge.", "Tyst på kartan. Någon måste börja."],
    "kaos.head": "KAOS på {bar}! Folk väller in.",
    "toast.skal": ["Skål, {name}!", "Skål på dig, {name}!"],
    "rank.up": "Befordrad till {rank}. Bra jobbat, soldat.",
    "loc.far": "Du är för långt bort. Gå närmare krogen först.",
    "game.card": "Den som kom sist berättar kvällens pinsammaste grej."
  });
  register("sv-syd", {
    _meta: DRAFT._meta,
    "grp.empty": "Ente en kotte ute än, hörru – du bestämmer när vi drar.",
    "live.quiet": ["Lugnt i stan, hörru. Ente en kotte.", { t: "Ente en påg eller tös ute än.", not: ["sv-smaland"] }],
    "kaos.head": "KAOS på {bar}, hörru! Folk väller in.",
    "toast.skal": "Skål, {name}! Dä bler en bra kväll.",
    "rank.up": "{rank} nu, hörru. Snyggt jobbat.",
    "loc.far": "Du ä för långt bort, hörru. Gå närmare krogen."
  });
  register("sv-vast", {
    _meta: DRAFT._meta,
    "grp.empty": "Ingen ute än, tjommen – du bestämmer när vi drar. Gôtt änna.",
    "live.quiet": ["Lugnt i stan, tjommen.", "Ingen ute och tjötar än. Gôtt änna."],
    "kaos.head": "KAOS på {bar}! Gôtt läge, tjommen.",
    "toast.skal": "Skål, {name}! Gôtt.",
    "rank.up": "{rank}, tjommen. Gôrgôtt.",
    "loc.far": "Du ä för långt bort, tjommen. Gå närmare krogen änna."
  });
  register("sv-sthlm", {
    _meta: DRAFT._meta,
    "grp.empty": "Asså, ingen ute än – du bestämmer när vi drar. Söder eller Söder?",
    "live.quiet": ["Asså, typ helt tomt i stan.", "Lugnt på stan. Typ."],
    "kaos.head": "KAOS på {bar}, asså! Folk väller in.",
    "toast.skal": "Skål, {name}! Asså, fett.",
    "rank.up": "{rank}, typ. Snyggt.",
    "loc.far": "Asså, du ä för långt bort. Ta tuben närmare krogen."
  });
  register("sv-dalarna", {
    _meta: DRAFT._meta,
    "grp.empty": "Dä ä int' nån ute än – du bestämmer när vi drar. Sulla int' nu.",
    "live.quiet": ["Hä ä lugnt i stan. Int' en själ.", "Dä ä int' mycke folk ute än."],
    "kaos.head": "KAOS på {bar}! Hä ä fullt.",
    "toast.skal": "Skål, {name}! Sulla int'.",
    "rank.up": "{rank} nu. Hä va' int' dåligt.",
    "loc.far": "Du ä för långt bort. Gå närmre krogen, int' bara i tanken."
  });
  register("sv-norr", {
    _meta: DRAFT._meta,
    "grp.empty": "Hä ä int' nån ute än – du bestämmer när vi drar. Jo.",
    "live.quiet": ["Hä ä lugnt. Jo.", "Int' en kjäft ute än. Jo."],
    "kaos.head": "KAOS på {bar}! Hä ä fullt. Jo.",
    "toast.skal": "Skål, {name}. Jo.",
    "rank.up": "{rank}. Hä va' int' illa. Jo.",
    "loc.far": "Du ä för långt bort. Ids int' gå? Gå närmare krogen."
  });

  // lazy: the data loads on the first t()/region() call, or on idle 2 s after the page load
  function idle() {
    var go = function () { try { (window.requestIdleCallback || function (f) { return setTimeout(f, 1); })(function () { load(); }, { timeout: 5000 }); } catch (e) { load(); } };
    if (document.readyState === "complete") setTimeout(go, 2000); else window.addEventListener("load", function () { setTimeout(go, 2000); }, { once: true });
  }
  idle();
  lastSig = sig();   // the cached region is the start state: onChange fires only on a real change

  window.DIALEKT = {
    t: t, region: region, chain: chain, register: register, onChange: onChange, settingsRow: settingsRow, setMode: setMode,
    mode: function () { return st.mode; },
    area: function () { ensure(); return area ? Object.assign({}, area) : null; },
    // explicit position / kommun from a call site: {lat, lng} | {code, cc} | {name}; null clears it
    setArea: function (x) { explicit = x ? { x: x, at: nowFn() } : null; if (sets.length) resolve(); else ensure(); },
    preview: function (code) { st.force = code || null; save(); emit(); },
    setScheme: function (s) { st.scheme = s === "B" ? "B" : s === "A" ? "A" : null; save(); emit(); },
    scheme: scheme,
    ready: function () { ensure(); return dataP || Promise.resolve(!!sets.length); },
    names: function () { return Object.assign({}, NAME); },
    // mods hooks (app.js mods() list): the app's own last position, re-checked when it moves ~1 km
    init: function (a) { api = a || null; if (sets.length) resolve(); },   // no load here: start-up stays light (idle loads it)
    onPoll: function () { if (!api || !sets.length) return; var k = ""; try { k = llKey(api.lastLoc()); } catch (e) {} if (k && k !== lastLL) resolve(); },
    stats: stats,
    // test hooks
    _norm: norm, _night: night, _packs: function () { return packs; }, _sets: function () { return sets; },
    _setNow: function (ms) { nowFn = ms == null ? function () { return Date.now(); } : function () { return ms; }; },
    _resolve: function () { resolve(); return area; }
  };
})();
