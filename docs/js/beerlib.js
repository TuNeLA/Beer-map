/* PintsNow — BEERLIB: the beer library (owner I-132, lane beerui, 19 Nov 2026; placement "C + parts of B", owner default A24).
   Loaded on demand by PN.beerlib() (js/barsearch.js) when the Öl tab, a favourite, a bar tap list or a beer tip needs it.
   This file: data (docs/data/beer/*.json, scripts/beer/build-data.mjs), the server layer, favourites + my rating, small
   builders, the Öl tab of Sök, the DM picker and the chat card. js/beerlib-pages.js adds the style page, the beer page and
   "Tipsa en vän". CSS: docs/beerlib.css.
   Server (supabase/migrations/0526_beer_library.sql, applied by the coordinator): beerlib_* RPCs. A missing RPC (PGRST202) or no
   session = "local": favourites and my rating stay on this phone (localStorage), reviews and averages are hidden, nothing breaks.
   Rules: no "beers tried" count, no badge, no goal, no "top rated" list, no "strongest first" sort (alphabetical / style / taste only).
   Store builds (window.OLNU_STORE): the same library; it has no celebration at all (no sound, no confetti). One text pop-up per tap.
   Photos: Open Food Facts, CC BY-SA; every photo shows its credit. Style pictures and texts: our own.
   Lane beer2: the browse list shows only beers with a photo and a real name (search finds all), aliases of duplicate beers,
   chatCards / chatPick for group + event chats (js/gpage.js), friendFavs for the person card (js/profilecard.js), the "Om data" link. */
(function () {
  "use strict";
  var W = window, D = document;
  var BASE = "./data/beer/", FAV_N = 3, LS_FAV = "olnu.beer.favs", LS_RATE = "olnu.beer.rate", LS_UP = "olnu.beer.favUp";
  var data = null, dataP = null, srv = { off: null }, favs = null, favP = null, uid = 0;
  var subs = [];

  function tl(sv, en) { return W.I18N && W.I18N.lang === "en" ? en : sv; }
  function en() { return !!(W.I18N && W.I18N.lang === "en"); }
  function ic(n, c) { try { return W.PNI && W.PNI.svg ? W.PNI.svg(n, c || "") : ""; } catch (e) { return ""; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function mk(tag, cls, html) { var e = D.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function lsGet(k, d) { try { var v = JSON.parse(W.localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { W.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function toast(t, o) { try { if (W.PN && PN.toast) PN.toast(t, o || {}); } catch (e) {} }
  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "o").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim();
  }
  function num(x, d) { var s = (Math.round(x * 10) / 10).toFixed(d == null ? 1 : d); return en() ? s : s.replace(".", ","); }
  function numT(x) { return num(x, x % 1 ? 1 : 0); }
  // no break before %. Lane beerlist (24 Nov): an alcohol-free beer always SAYS it ("Alkoholfri 0,0 %"): "A ship full of IPA" is the
  // alcohol-free bottle but showed "IPA (amerikansk) · 0,0 %", which read like a normal IPA with a wrong number. A number only
  // when it fits the mark (alcohol-free 0–0,5 %, else 0,6–16 %); scripts/beer/checks.mjs keeps the data clean, this is the second lock.
  function abvText(b) {
    var a = b.abv, ok = typeof a === "number" && isFinite(a) && (b.af ? a >= 0 && a <= 0.5 : a >= 0.6 && a <= 16);
    var w = b.af ? tl("Alkoholfri", "Alcohol-free") : "";
    return ok ? (w ? w + " " : "") + num(a) + "\u00a0%" : w;
  }
  function dayText(iso) { var t = Date.parse(iso || ""); if (!isFinite(t)) return ""; try { return new Date(t).toLocaleDateString(en() ? "en-GB" : "sv-SE", { day: "numeric", month: "short" }); } catch (e) { return ""; } }

  /* ---------- taste groups (the chips) = groups of the styles' taste tags ---------- */
  var FL = [
    ["frisk", "Frisk", "Crisp", "--bl-f-fresh", ["crisp", "dry"]],
    ["besk", "Besk", "Bitter", "--bl-f-bitter", ["bitter", "hoppy", "piney"]],
    ["fruktig", "Fruktig", "Fruity", "--bl-f-fruit", ["fruity", "citrus", "tropical", "dark-fruit"]],
    ["maltig", "Maltig", "Malty", "--bl-f-malt", ["malty", "bready", "caramel", "toffee", "nutty"]],
    ["rostad", "Rostad", "Roasty", "--bl-f-roast", ["roasty", "coffee", "chocolate", "smoky"]],
    ["syrlig", "Syrlig", "Sour", "--bl-f-sour", ["sour", "funky", "salty"]],
    ["sot", "Söt", "Sweet", "--bl-f-sweet", ["sweet", "creamy"]],
    ["kryddig", "Kryddig", "Spicy", "--bl-f-spice", ["spicy", "herbal", "floral"]]
  ];
  var FLK = {}; FL.forEach(function (f) { FLK[f[0]] = f; });
  function flName(k) { var f = FLK[k]; return f ? (en() ? f[2] : f[1]) : k; }
  function tagGroup(t) { for (var i = 0; i < FL.length; i++) if (FL[i][4].indexOf(t) >= 0) return FL[i][0]; return null; }
  function styleScore(st, g) { var f = FLK[g]; return f ? st.tags.filter(function (t) { return f[4].indexOf(t) >= 0; }).length : 0; }
  function styleGroups(st) {
    var c = {}; st.tags.forEach(function (t) { var g = tagGroup(t); if (g) c[g] = (c[g] || 0) + 1; });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; });
  }
  function dot(g) { var f = FLK[g]; return f ? '<i class="bl-dot" style="--c:var(' + f[3] + ')" aria-hidden="true"></i>' : ""; }

  /* ---------- data ---------- */
  function getJSON(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); }); }
  function load() {
    if (data) return Promise.resolve(data);
    if (dataP) return dataP;
    dataP = Promise.all([getJSON(BASE + "styles.json"), getJSON(BASE + "beers.json")]).then(function (r) {
      var s = r[0], b = r[1], d = { styles: s.styles || [], tags: s.tags || {}, fam: s.families || {}, glasses: s.glasses || {}, st: {}, beers: [], byId: {}, src: b.src || "" };
      d.styles.forEach(function (x) { x.tags = x.tags || []; x._n = norm(x.sv + " " + x.en + " " + x.id.replace(/-/g, " ")); d.st[x.id] = x; });
      var C = b.cols || [];
      (b.rows || []).forEach(function (row) {
        var o = {}; C.forEach(function (c, i) { o[c] = row[i]; });
        if (!o.id || !o.name) return;
        o.id = String(o.id); o._n = norm(o.name + " " + (o.brewery || ""));
        d.beers.push(o); d.byId[o.id] = o;
      });
      var al = b.alias || {};   // a duplicate beer (beer2 data pass): old chat tips and favourites still find the kept one
      Object.keys(al).forEach(function (a) { var k = d.byId[String(al[a])]; if (k && !d.byId[a]) d.byId[a] = k; });
      data = d; return d;
    });
    dataP.catch(function () { dataP = null; });
    return dataP;
  }
  function styleName(id) { var s = data && data.st[id]; return s ? (en() ? s.en : s.sv) : ""; }
  function oneLine(st) { var t = en() ? st.text_en : st.text_sv; var m = String(t || "").match(/^[^.!?]+[.!?]/); return m ? m[0] : t || ""; }
  function beerStyle(b) { return b && b.style && data ? data.st[b.style] || null : null; }
  function styleLine(b) {
    var s = styleName(b.style), a = abvText(b), out = [];
    if (s) out.push(s + (b.conf < 3 ? " " + tl("(gissning)", "(guess)") : ""));
    if (s && b.style === "alkoholfri" && b.af) a = a.replace(tl("Alkoholfri", "Alcohol-free"), "").trim();   // not "Alkoholfri öl · Alkoholfri"
    if (a) out.push(a);
    return out.join(" · ");
  }

  /* ---------- pictures ---------- */
  function styleImg(id, alt) { return '<img src="' + BASE + "styles/" + esc(id) + '.svg" alt="' + esc(alt || "") + '" loading="lazy" decoding="async">'; }
  function photoUrl(b) { return BASE + "img/" + encodeURIComponent(b.id) + ".jpg"; }
  // the beer's photo (lazy) or its style picture; a broken photo falls back to the style picture
  function pic(b, cls) {
    var st = beerStyle(b), alt = "";
    // I-142: the big picture (cls "bl-big") gets a blurred copy of the same file behind it (one download: same URL)
    var bg = /\bbl-big\b/.test(cls || "") ? '<img class="bl-pic-bg" src="' + photoUrl(b) + '" alt="" aria-hidden="true" decoding="async">' : "";
    if (b.photo) return '<span class="bl-pic ph ' + (cls || "") + '">' + bg + '<img src="' + photoUrl(b) + '" alt="' + esc(alt) + '" loading="lazy" decoding="async" data-bl-st="' + esc(st ? st.id : "") + '"></span>';
    if (st) return '<span class="bl-pic ' + (cls || "") + '">' + styleImg(st.id, "") + "</span>";
    return '<span class="bl-pic ' + (cls || "") + '" aria-hidden="true">' + ic("beer") + "</span>";
  }
  function fixPics(root) {
    [].forEach.call(root.querySelectorAll("img[data-bl-st]"), function (im) {
      if (im.__bl) return; im.__bl = 1;
      im.addEventListener("error", function () {
        var s = im.getAttribute("data-bl-st"), p = im.parentNode;
        if (p) { p.classList.remove("ph"); p.innerHTML = s ? styleImg(s, "") : ic("beer"); }
      });
    });
  }
  function credit(b) {
    if (!b.photo) return "";
    var who = b.credit ? " / " + esc(b.credit) : "";
    return '<p class="bl-credit"><a href="https://world.openfoodfacts.org/product/' + encodeURIComponent(b.id) + '" target="_blank" rel="noopener noreferrer">' +
      esc(tl("Bild: Open Food Facts", "Photo: Open Food Facts")) + who + ", CC BY-SA</a></p>";
  }

  /* ---------- server ---------- */
  function api() { return W.PN && PN.rpc ? PN : null; }
  function authed() { var P = api(); return !!(P && P.LIVE && P.s && P.s.authed); }
  function missing(err) { try { return W.U && W.U.missing ? W.U.missing(err) : /PGRST202|Could not find the function/i.test(String(err && (err.code || "") + " " + (err.message || ""))); } catch (e) { return false; } }
  function parse(d) { try { return PN.parseData ? PN.parseData(d) : d; } catch (e) { return d; } }
  // { data, error, off }. off = the beer tables are not on this server (yet): the caller uses the local path.
  function call(fn, p) {
    if (srv.off === true || !authed()) return Promise.resolve({ data: null, error: { message: "local" }, off: true });
    return PN.rpc(fn, p || {}).then(function (r) {
      r = r || {};
      if (r.error && missing(r.error)) { srv.off = true; emit(); return { data: null, error: r.error, off: true }; }
      if (!r.error) { if (srv.off !== false) { srv.off = false; } }
      return { data: r.error ? null : parse(r.data), error: r.error || null, off: false };
    }, function (e) { return { data: null, error: e || { message: "net" }, off: false }; });
  }
  function online() { return srv.off === false; }
  function emit() { saveMini(); subs.forEach(function (f) { try { f(); } catch (e) {} }); }
  // I-143: a small copy of my favourites (id, name, photo, strip kind) for the "Vilken sort?" strip after ÖL! (js/barsplus.js):
  // the ÖL! tap must not load this library or the beer files. Written each time the favourites are known or change; [] = none.
  var LS_MINI = "olnu.beer.favMini";
  function saveMini() {
    if (!favs) return;
    if (favs.some(Boolean) && !data) { load().then(saveMini, function () {}); return; }
    var l = []; favs.forEach(function (id) { var b = id && data && data.byId[id]; if (b) l.push({ id: b.id, n: String(b.name).slice(0, 60), p: b.photo ? 1 : 0, t: stripKind(b), lk: lookOf(b) }); });
    lsSet(LS_MINI, { at: Date.now(), l: l });
  }
  // lane mybeer (I-147): the look of a beer for the ÖL! button and the pin (short name, bottle / can, 2 colours, beer colour)
  function lookOf(b) { try { var st = beerStyle(b); return W.MYBEER_LOOK ? W.MYBEER_LOOK.look(b, st && st.hex, stripKind(b)) : null; } catch (e) { return null; } }
  // a library style -> one of the strip's 10 kinds (barsplus.js TYPES; the server's set_beer_type knows only these)
  var KIND_ID = { "tysk-pilsner": "pilsner", "tjeckisk-pilsner": "pilsner", "apa": "apa", "baltisk-porter": "stout", "alkoholfri": "alkfri",
    "blond-ale": "ale", "golden-ale": "ale", "bitter": "ale" };
  var KIND_FAM = { lager: "lager", wheat: "vete", "pale-ipa": "ipa", "british-ale": "ale", hybrid: "ale", belgian: "ale", dark: "stout", sour: "sour" };
  function stripKind(b) {
    if (b.af) return "alkfri";
    var st = beerStyle(b);
    if (!st) return "annan";
    return KIND_ID[st.id] || KIND_FAM[st.fam] || "annan";
  }
  function on(f) { subs.push(f); return function () { subs = subs.filter(function (x) { return x !== f; }); }; }

  /* ---------- favourites (max 3, slots 1..3) ---------- */
  function localFavs() { var l = lsGet(LS_FAV, []); l = Array.isArray(l) ? l : []; var o = []; for (var i = 0; i < FAV_N; i++) o.push(typeof l[i] === "string" && l[i] ? l[i] : null); return o; }
  function fromSrv(rows) {
    var o = [null, null, null];
    (Array.isArray(rows) ? rows : []).forEach(function (r) { var s = (r && r.slot) | 0; if (s >= 1 && s <= FAV_N && r.beer) o[s - 1] = String(r.beer); });
    return o;
  }
  function loadFavs(force) {
    if (favs && !force) return Promise.resolve(favs);
    if (favP && !force) return favP;
    favP = call("beerlib_favs_mine").then(function (r) {
      favP = null;
      if (r.off) { favs = localFavs(); return favs; }
      if (r.error) { favs = favs || localFavs(); return favs; }
      favs = fromSrv(r.data);
      return upload().then(function () { return favs; });
    }).then(function (f) { saveMini(); return f; });
    return favP;
  }
  // once: favourites saved on this phone before the server had the tables go up when the server list is empty
  function upload() {
    var loc = localFavs(), any = loc.some(Boolean);
    if (!any || favs.some(Boolean) || lsGet(LS_UP, 0)) return Promise.resolve();
    lsSet(LS_UP, 1);
    return loc.reduce(function (p, id, i) { return id ? p.then(function () { return call("beerlib_fav_set", { p_slot: i + 1, p_beer: id }); }) : p; }, Promise.resolve())
      .then(function () { favs = loc.slice(); });
  }
  function favSlot(id) { return favs ? favs.indexOf(String(id)) + 1 : 0; }
  function setSlot(slot, id) {
    var next = (favs || localFavs()).slice(); next[slot - 1] = id || null;
    var apply = function () { favs = next; if (!online()) lsSet(LS_FAV, next); emit(); return favs; };
    if (!online()) return Promise.resolve(apply());
    return call("beerlib_fav_set", { p_slot: slot, p_beer: id || null }).then(function (r) {
      if (r.off) return apply();
      if (r.error) { toast(tl("Det gick inte att spara. Försök igen.", "Could not save. Try again."), { err: true }); return favs; }
      if (Array.isArray(r.data)) { favs = fromSrv(r.data); emit(); return favs; }
      return apply();
    });
  }
  // the heart on a beer page: on = the first free slot; full = one short pop-up, nothing changes
  function toggleFav(id) {
    return loadFavs().then(function (f) {
      var s = f.indexOf(String(id)) + 1;
      if (s) return setSlot(s, null);
      var free = f.indexOf(null) + 1;
      if (!free) { toast(tl("Du har redan 3 favoriter. Ta bort en först.", "You already have 3 favourites. Remove one first.")); return f; }
      return setSlot(free, String(id));
    });
  }

  /* ---------- my rating (1–5; one per beer; tap the same star again = no rating) ---------- */
  function localRate(id) { var m = lsGet(LS_RATE, {}); return m && m[id] ? m[id] | 0 : 0; }
  function setLocalRate(id, n) { var m = lsGet(LS_RATE, {}); if (!m || typeof m !== "object") m = {}; if (n) m[id] = n; else delete m[id]; lsSet(LS_RATE, m); }
  function rate(id, n) {
    n = n | 0; if (n < 0 || n > 5) n = 0;
    if (!online()) { setLocalRate(id, n); return Promise.resolve({ stars: n, local: true }); }
    return call("beerlib_rate", { p_beer: String(id), p_stars: n || null }).then(function (r) {
      if (r.off) { setLocalRate(id, n); return { stars: n, local: true }; }
      if (r.error) { toast(tl("Betyget gick inte att spara.", "Could not save the rating."), { err: true }); return null; }
      return r.data || { stars: n };
    });
  }

  /* ---------- small builders ---------- */
  function chipsHTML(sel) {
    return '<div class="bl-chips" role="group" aria-label="' + esc(tl("Smak", "Taste")) + '">' + FL.map(function (f) {
      var on = sel === f[0];
      return '<button type="button" class="bl-chip" data-bl-fl="' + f[0] + '" aria-pressed="' + on + '">' + dot(f[0]) + esc(en() ? f[2] : f[1]) + "</button>";
    }).join("") + "</div>";
  }
  // I-141 (lane beerlist, owner default "A3 with A1 cards"): one style card = the glass on a glow in the style's own beer colour
  // (styles.json hex), the family line, the name, one line of text and up to 2 flavour tags WITH words. Cards in a row have one height.
  function famName(k) { var f = data && data.fam[k]; return f ? String(en() ? f.en : f.sv).replace(/ \(.*\)/, "") : ""; }
  function tagHTML(g) { var f = FLK[g]; return f ? '<span class="bl-tag" style="--c:var(' + f[3] + ')">' + dot(g) + esc(flName(g)) + "</span>" : ""; }
  function tileHTML(st) {
    var sc = /^#[0-9a-fA-F]{3,8}$/.test(st.hex || "") ? ' style="--bl-sc:' + st.hex + '"' : "";
    return '<button type="button" class="bl-tile bl-f-' + esc(st.fam || "x") + '" data-bl-style="' + esc(st.id) + '"' + sc + '><span class="bl-stage">' + styleImg(st.id, "") +
      '</span><span class="bl-body"><span class="bl-fam">' + esc(famName(st.fam)) + "</span><b>" + esc(en() ? st.en : st.sv) + "</b><small>" + esc(oneLine(st)) +
      '</small><span class="bl-dots">' + styleGroups(st).slice(0, 2).map(tagHTML).join("") + "</span></span></button>";
  }
  // fixC P-11: in a list row a guessed style gets one small "?" chip (the list says once what it means), not "(gissning)" on most rows
  function guessChip() { return '<i class="bl-guess" role="img" aria-label="' + esc(tl("gissning", "guess")) + '">?</i>'; }
  function styleLineHTML(b) {
    var s = styleName(b.style), a = abvText(b), out = [];
    if (s) out.push(esc(s) + (b.conf < 3 ? " " + guessChip() : ""));
    if (s && b.style === "alkoholfri" && b.af) a = a.replace(tl("Alkoholfri", "Alcohol-free"), "").trim();
    if (a) out.push(esc(a));
    return out.join(" · ");
  }
  function guessNote(list) {
    return list.some(function (b) { return b.style && b.conf < 3; }) ? '<p class="bl-guess-n">' + guessChip() + esc(tl("= stilen är en gissning från namnet.", "= the style is a guess from the name.")) + "</p>" : "";
  }
  function rowHTML(b) {
    return '<button type="button" class="bl-row" data-bl-beer="' + esc(b.id) + '">' + pic(b) + "<span><b>" + esc(b.name) + "</b>" +
      (b.brewery ? "<small>" + esc(b.brewery) + "</small>" : "") + "<small>" + (styleLineHTML(b) || esc(tl("Stil okänd", "Style unknown"))) + "</small></span>" + ic("chev-right", "bl-chev") + "</button>";
  }
  function starsHTML(n, mini) {
    var o = "";
    for (var i = 1; i <= 5; i++) o += mini ? ic("star", i <= n ? "on" : "") :
      '<button type="button" class="bl-star' + (i <= n ? " on" : "") + '" data-bl-star="' + i + '" role="radio" aria-checked="' + (i === n) + '" aria-label="' + i + esc(tl(" av 5", " of 5")) + '">' + ic("star") + "</button>";
    return mini ? '<span class="bl-mini-st" role="img" aria-label="' + n + esc(tl(" av 5", " of 5")) + '">' + o + "</span>" :
      '<div class="bl-stars" role="radiogroup" aria-label="' + esc(tl("Mitt betyg", "My rating")) + '">' + o + "</div>";
  }
  // one click handler for a container: style tiles, beer rows, chips (cb)
  function wire(root, o) {
    o = o || {};
    root.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target : null; if (!t) return;
      var s = t.closest("[data-bl-style]"), b = t.closest("[data-bl-beer]"), f = t.closest("[data-bl-fl]"), m = t.closest("[data-bl-more]");
      if (t.closest("[data-bl-about]")) { if (B.about) B.about(); return; }
      if (f && o.chip) { o.chip(f.getAttribute("data-bl-fl")); return; }
      if (m && o.more) { o.more(m.getAttribute("data-bl-more")); return; }
      if (b) { (o.beer || openBeer)(b.getAttribute("data-bl-beer")); return; }
      if (s) { (o.style || openStyle)(s.getAttribute("data-bl-style")); }
    });
  }
  function openStyle(id) { if (B.style) B.style(id); }
  // beer2: the door to the "Om data" page (js/beerlib-pages.js about()); one per screen, at the bottom
  function aboutLink() { return '<button type="button" class="bl-about" data-bl-about="1">' + ic("info") + esc(tl("Om data och licenser", "About the data and licences")) + "</button>"; }
  function openBeer(id) { if (B.beer) B.beer(id); }

  /* ---------- search ---------- */
  function matchStyles(q, g) {
    var qn = norm(q), out = data.styles.filter(function (s) {
      if (g && !styleScore(s, g)) return false;
      if (!qn) return true;
      return qn.split(" ").every(function (w) { return s._n.indexOf(w) >= 0; });
    });
    if (g) out.sort(function (a, b) { return styleScore(b, g) - styleScore(a, g) || (a.sv < b.sv ? -1 : 1); });
    return out;
  }
  function matchBeers(q, g) {
    var qn = norm(q), ws = qn ? qn.split(" ") : [], okSt = null;
    if (g) { okSt = {}; data.styles.forEach(function (s) { if (styleScore(s, g)) okSt[s.id] = 1; }); }
    var sid = null; if (qn) data.styles.forEach(function (s) { if (!sid && norm(s.sv) === qn || norm(s.en) === qn) sid = s.id; });
    var out = data.beers.filter(function (b) {
      if (okSt && !okSt[b.style]) return false;
      if (!ws.length) return true;
      if (sid && b.style === sid) return true;
      return ws.every(function (w) { return b._n.indexOf(w) >= 0; });
    });
    if (!qn) out = out.filter(function (b) { return b.photo && !b.nn; });   // beer2: the browse list = a photo + a real name; search finds all
    // Swedish first; fixC P-11: then a photo, then a known style (a sure style before a guess), then A–Ö (stable). No strength, no rating.
    var rank = function (b) { return (b.photo ? 0 : 4) + (b.style ? (b.conf < 3 ? 1 : 0) : 2); };
    if (!qn && !g) out = out.slice().sort(function (a, b) { return (a.group | 0) - (b.group | 0) || rank(a) - rank(b); });
    else if (!sid) out = out.slice().sort(function (a, b) { return rank(a) - rank(b); });
    return out;
  }

  /* ---------- the Öl tab of Sök (js/barsearch.js calls tab()) ----------
     I-141 (lane beerlist, 24 Nov; owner default "A3 with A1 cards", pictures lanes/d-beerlook-shots/A-contact-sheet.png):
     "Mina favoriter" (3 slots) on top, the Smak chips, then one sideways row per beer family (Lager, Veteöl, Pale ale och IPA …),
     each with its family colour, then the beers. An empty slot "+ Lägg till" = pick mode: the beer list + the Sök field pick
     the favourite (no style rows, no chips); Avbryt or a pick ends it. A beer or style opened here keeps the I-139 back (‹):
     barsearch.js fromBeer() keeps the field + scroll place, tabSt keeps the chip and each row's sideways place. */
  var FAM_ORDER = ["lager", "wheat", "pale-ipa", "dark", "sour", "belgian", "british-ale", "hybrid", "nordic", "class"];
  var tabSt = { g: null, nBeer: 30, q: "", pick: 0, sx: {}, opts: {} };
  function famsHTML(sts, g) {
    var by = {}, order = FAM_ORDER.slice();
    sts.forEach(function (s) { (by[s.fam] = by[s.fam] || []).push(s); if (order.indexOf(s.fam) < 0) order.push(s.fam); });
    order = order.filter(function (k) { return by[k]; });
    if (g) order.sort(function (a, b) { return styleScore(by[b][0], g) - styleScore(by[a][0], g); });   // the family with the most "fruktig" first
    return order.map(function (k) {
      var nm = famName(k) || tl("Övrigt", "Other");
      return '<section class="bl-fs bl-f-' + esc(k) + '"><h4 class="bl-fh">' + esc(nm) + "<em>" + by[k].length + "</em></h4>" +
        '<div class="bl-car" role="group" aria-label="' + esc(nm) + '" data-bl-car="' + esc(k) + '">' + by[k].map(tileHTML).join("") + "</div></section>";
    }).join("");
  }
  function favsHTML() {
    var f = favs || localFavs(), o = "";
    for (var i = 0; i < FAV_N; i++) {
      var b = f[i] && data.byId[f[i]];
      o += b ? '<button type="button" class="bl-fav" data-bl-beer="' + esc(b.id) + '"><span class="bl-fav-p">' + pic(b) + '<i class="bl-fav-n" aria-hidden="true">' + (i + 1) + "</i></span><b>" +
          esc(b.name) + "</b><small>" + esc(b.af && b.style !== "alkoholfri" ? tl("Alkoholfri", "Alcohol-free") : styleName(b.style) || abvText(b) || "") + "</small></button>"
        : '<button type="button" class="bl-fav empty" data-bl-add="' + (i + 1) + '" aria-label="' + esc(tl("Lägg till favorit nr " + (i + 1), "Add favourite no. " + (i + 1))) +
          '"><span class="bl-fav-p"><span class="bl-pic">' + ic("plus") + "</span></span><b>" + esc(tl("Lägg till", "Add")) + "</b><small>" + esc(tl("Plats " + (i + 1), "Slot " + (i + 1))) + "</small></button>";
    }
    return '<h3 class="bl-h">' + esc(tl("Mina favoriter", "My favourites")) + '</h3><div class="bl-favs">' + o + "</div>" +
      (f.some(Boolean) ? '<p class="bl-note">' + esc(privText()) + "</p>" : "");
  }
  function pickHTML() {
    return '<div class="bl-pickbar" role="status"><span class="bl-pb-i" aria-hidden="true">' + ic("star") + "</span><span><b>" + esc(tl("Välj favorit nr " + tabSt.pick, "Pick favourite no. " + tabSt.pick)) +
      "</b><small>" + esc(tl("Sök i fältet ovan eller tryck på en öl.", "Search in the field above or tap a beer.")) + '</small></span><button type="button" class="bl-pb-x" data-bl-pickx="1">' +
      esc(tl("Avbryt", "Cancel")) + "</button></div>";
  }
  function msgHTML(icon, text, more) {
    return '<div class="bl-empty" role="status">' + ic(icon) + "<p>" + esc(text) + "</p>" + (more ? "<small>" + esc(more) + "</small>" : "") + "</div>";
  }
  function skelHTML() {   // loading: the shape of the list, still (no motion), plus the words for screen readers
    var card = '<span class="bl-sk-c"></span>', row = '<span class="bl-sk-h"></span><span class="bl-sk-r">' + card + card + card + "</span>";
    return '<p class="bl-msg" role="status">' + esc(tl("Laddar ölen …", "Loading the beers …")) + '</p><div class="bl-skel" aria-hidden="true">' + row + row + "</div>";
  }
  function tabInput() { return D.getElementById("bs-q"); }
  function setField(v) {   // the Sök field is barsearch.js's: set it and let its own input handler paint (it calls tab())
    var i = tabInput(); if (!i || i.value === v) return false;
    i.value = v; try { i.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
    return true;
  }
  function tabTop(box) { var e = box; while (e && e.scrollHeight <= e.clientHeight + 2) e = e.parentElement; if (e) e.scrollTop = 0; }
  function startPick(box, slot) {
    tabSt.pick = slot; tabSt.nBeer = 30;
    tab(box, tabSt.q, tabSt.opts); tabTop(box);
    var i = tabInput(); try { if (i) i.focus({ preventScroll: true }); } catch (e) {}
  }
  function endPick(box) { tabSt.pick = 0; if (!setField("")) tab(box, tabSt.q, tabSt.opts); tabTop(box); }
  // fixC P-14: pick mode that came from Profil goes back there when it ends (after the save or Avbryt)
  function pickBack() { var f = tabSt.opts && tabSt.opts.pickDone; if (f) { tabSt.opts.pickDone = null; f(); } }
  function pickFav(box, id) {
    var slot = tabSt.pick, f = favs || localFavs();
    if (f.indexOf(String(id)) >= 0) { toast(tl("Den ölen är redan en av dina favoriter.", "That beer is already one of your favourites.")); return; }
    endPick(box);
    setSlot(slot, String(id)).then(function (now) {
      if (now && now[slot - 1] === String(id)) toast(tl("Sparad som favorit nr " + slot + ".", "Saved as favourite no. " + slot + "."));
      if (tabSt.opts && tabSt.opts.pickDone) { pickBack(); return; }
      if (box.isConnected) tab(box, tabSt.q, tabSt.opts);
    });
  }
  function tabWire(box) {
    wire(box, {
      chip: function (k) { tabSt.g = tabSt.g === k ? null : k; tabSt.nBeer = 30; tabSt.sx = {}; tab(box, tabSt.q, tabSt.opts); },
      more: function () { tabSt.nBeer += 60; tab(box, tabSt.q, tabSt.opts); },
      beer: function (id) { if (tabSt.pick) pickFav(box, id); else (tabSt.opts.beer || openBeer)(id); },
      style: function (id) { (tabSt.opts.style || openStyle)(id); }
    });
    box.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target : null; if (!t) return;
      var a = t.closest("[data-bl-add]");
      if (a) { startPick(box, +a.getAttribute("data-bl-add") || 1); return; }
      if (t.closest("[data-bl-pickx]")) { endPick(box); pickBack(); }
    });
    // each family row keeps its sideways place (a back from a style page paints the tab again)
    box.addEventListener("scroll", function (e) { var c = e.target; if (c && c.getAttribute && c.getAttribute("data-bl-car")) tabSt.sx[c.getAttribute("data-bl-car")] = c.scrollLeft; }, true);
    var off = on(function () { if (!box.isConnected) { off(); return; } if (data && !tabSt.pick && !tabSt.q) tab(box, tabSt.q, tabSt.opts); });   // favourites changed
  }
  function tabBody(q) {
    var g = tabSt.pick ? null : tabSt.g, sts = tabSt.pick ? [] : matchStyles(q, g), bs = matchBeers(q, g), h = "";
    if (tabSt.pick) h += pickHTML();
    else {
      if (!q) h += favsHTML();
      h += '<h3 class="bl-h">' + esc(tl("Smak", "Taste")) + "</h3>" + chipsHTML(g);
      if (sts.length) h += '<h3 class="bl-h">' + esc(q ? tl("Stilar", "Styles") : tl("Stilar per familj", "Styles by family")) + "<b>" +
        (g ? esc(tl("Mest " + flName(g).toLowerCase() + " först", "Most " + flName(g).toLowerCase() + " first")) : sts.length) + "</b></h3>" + famsHTML(sts, g);
    }
    h += '<h3 class="bl-h">' + esc(tl("Öl", "Beers")) + "<b>" + bs.length + "</b></h3>";
    if (bs.length) h += guessNote(bs.slice(0, tabSt.nBeer)) + '<div class="bl-list">' + bs.slice(0, tabSt.nBeer).map(rowHTML).join("") + "</div>" +
      (bs.length > tabSt.nBeer ? '<button type="button" class="bl-more" data-bl-more="beer">' + esc(tl("Visa fler öl", "Show more beers")) + "</button>" : "");
    else h += q ? msgHTML("search", tl("Ingen öl med det namnet än.", "No beer with that name yet."), tl("Prova ett kortare ord, en stil (till exempel IPA) eller skanna burken.", "Try a shorter word, a style (for example IPA) or scan the can."))
      : msgHTML("beer", tl("Inga öl här än.", "No beers here yet."), g ? tl("Tryck på smaken igen för att se alla.", "Tap the taste again to see all.") : "");
    return h + '<p class="bl-note">' + esc(tl("Bilder och öldata: Open Food Facts (CC BY-SA, ODbL). Stilen är ofta en gissning. Texterna om stilar skriver vi själva.",
      "Photos and beer data: Open Food Facts (CC BY-SA, ODbL). The style is often a guess. We write the style texts ourselves.")) + "</p>" + aboutLink();
  }
  function tab(box, q, opts) {
    tabSt.opts = opts || tabSt.opts || {};
    if (q !== tabSt.q) { tabSt.q = q; tabSt.nBeer = 30; tabSt.sx = {}; }
    if (!box.__bl) { box.__bl = 1; tabSt.pick = (opts && opts.pick) | 0; tabWire(box); if (!favs) loadFavs().then(function () { if (box.isConnected && data && !tabSt.q && !tabSt.pick) tab(box, tabSt.q, tabSt.opts); }, function () {}); }
    if (!data) {
      box.innerHTML = skelHTML();
      load().then(function () { if (box.isConnected) tab(box, tabSt.q, tabSt.opts); }, function () {
        if (!box.isConnected) return;
        box.innerHTML = msgHTML("info", tl("Ölen gick inte att ladda.", "Could not load the beers."), tl("Kolla nätet och försök igen.", "Check the network and try again.")) +
          '<button type="button" class="bl-more" data-bl-retry="1">' + ic("refresh") + esc(tl("Försök igen", "Try again")) + "</button>";
        box.querySelector("[data-bl-retry]").addEventListener("click", function () { tab(box, tabSt.q, tabSt.opts); });
      });
      return;
    }
    box.innerHTML = tabBody(q); fixPics(box);
    [].forEach.call(box.querySelectorAll("[data-bl-car]"), function (c) { var x = tabSt.sx[c.getAttribute("data-bl-car")]; if (x) c.scrollLeft = x; });
  }

  /* ---------- DM: inline picker (js/dm.js) + the beer card in a chat row ---------- */
  var TIP_RE = /^(?:Öltips|Beer tip): (.{1,90}?) \[öl:([0-9A-Za-z_-]{1,40})\](?: ([\s\S]*))?$/;
  function parseTip(text) { var m = TIP_RE.exec(String(text || "").trim()); return m ? { name: m[1], id: m[2], line: (m[3] || "").trim() } : null; }
  function tipText(b, line, max) {
    max = max || 140;
    var name = String(b.name).slice(0, 60), head = tl("Öltips: ", "Beer tip: ") + name + " [öl:" + b.id + "]";
    var l = String(line || "").replace(/\s+/g, " ").trim();
    return l ? (head + " " + l).slice(0, max) : head.slice(0, max);
  }
  function picker(box, onPick, onClose) {
    box.innerHTML = '<div class="bl-dmp-h"><b>' + esc(tl("Tipsa om en öl", "Recommend a beer")) + '</b><button type="button" class="bl-x" aria-label="' + esc(tl("Stäng", "Close")) + '">' + ic("x") + "</button></div>" +
      '<input class="bl-q" type="search" enterkeyhint="search" autocomplete="off" aria-label="' + esc(tl("Sök öl", "Search beer")) + '" placeholder="' + esc(tl("Sök öl eller bryggeri", "Search beer or brewery")) + '">' +
      '<div class="bl-list" role="listbox"></div>';
    var inp = box.querySelector(".bl-q"), list = box.querySelector(".bl-list"), t = 0;
    box.querySelector(".bl-x").addEventListener("click", function () { if (onClose) onClose(); });
    function paint() {
      if (!data) { list.innerHTML = '<p class="bl-msg" style="padding:0 var(--sp-4)">' + esc(tl("Laddar ölen …", "Loading the beers …")) + "</p>"; load().then(paint, function () {}); return; }
      var l = matchBeers(inp.value, null).slice(0, 20);
      list.innerHTML = l.length ? l.map(rowHTML).join("") : '<p class="bl-msg" style="padding:0 var(--sp-4)">' + esc(tl("Ingen öl med det namnet än.", "No beer with that name yet.")) + "</p>";
      fixPics(list);
    }
    inp.addEventListener("input", function () { clearTimeout(t); t = setTimeout(paint, 150); });
    list.addEventListener("click", function (e) { var r = e.target.closest && e.target.closest("[data-bl-beer]"); if (r && data) onPick(data.byId[r.getAttribute("data-bl-beer")]); });
    paint();
    return inp;
  }
  // the card that takes the place of a tip text in a chat row
  function chatCard(tip, who) {
    var b = data && data.byId[tip.id], el = mk("div", "bl bl-chatcard");
    var nm = b ? b.name : tip.name;
    el.innerHTML = '<div class="bl-cm">' + (b ? pic(b) : '<span class="bl-pic" aria-hidden="true">' + ic("beer") + "</span>") + "<span>" +
      "<small>" + esc(who ? tl(who + " tipsar om", who + " recommends") : tl("Tips om en öl", "A beer tip")) + "</small><b>" + esc(nm) + "</b>" +
      (b && styleLine(b) ? "<small>" + esc(styleLine(b)) + "</small>" : "") +
      (tip.line ? '<div class="ln">' + esc(tip.line) + "</div>" : "") +
      (b ? '<button type="button" class="bl-link" data-bl-beer="' + esc(b.id) + '">' + esc(tl("Visa ölen", "Show the beer")) + ic("chev-right") + "</button>" : "") + "</span></div>";
    wire(el, {});
    el.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("[data-bl-beer]")) e.stopPropagation(); });   // not the chat row's tap menu
    fixPics(el);
    return el;
  }

  // beer2: tip lines in any chat list (group, event; js/gpage.js wires it) -> the same card as in DM. Rows are social.js chat rows.
  function chatCards(list) {
    [].forEach.call(list.querySelectorAll("li.chat-msg[data-mid]"), function (li) {
      var body = li.querySelector(".cm-body"), tip = body && !li.querySelector(".bl-chatcard") ? parseTip(body.textContent || "") : null;
      if (!tip) return;
      var nmEl = li.querySelector(".cm-name, .cm-head b"), who = li.classList.contains("me") ? "" : (nmEl ? String(nmEl.textContent || "").trim() : "");
      body.classList.add("bl-raw"); li.classList.add("bl-has-card");
      body.parentNode.insertBefore(chatCard(tip, who), body.nextSibling);
    });
  }
  // beer2: the beer button of a group / event chat opens this picker; the pick goes out through the chat's own send button
  function chatPick(btn, box, inp, send) {
    var shut = function () { box.hidden = true; box.innerHTML = ""; btn.setAttribute("aria-expanded", "false"); };
    if (!box.hidden) { shut(); return; }
    box.hidden = false; btn.setAttribute("aria-expanded", "true");
    var q = picker(box, function (beer) { if (!beer) return; shut(); inp.value = tipText(beer, "", 140); send.click(); }, shut);
    try { q.focus(); } catch (e) {}
  }

  /* ---------- beer2: a friend's favourites on the person card (js/profilecard.js asks beerlib_favs_for; the server follows the
     friend's Synlighet: spöke = nobody, vänner = friends only). Only filled beers, in slot order; no count, no score. ---------- */
  function whose(name) {
    var n = String(name || "").trim();
    if (en()) return n + "\u2019s favourite beers";
    return n + (/[sxz]$/i.test(n) ? "" : "s") + " favoritöl";
  }
  function friendFavs(box, name, rows) {
    var ids = fromSrv(rows).filter(Boolean), l = data ? ids.map(function (id) { return data.byId[id]; }).filter(Boolean) : [];
    if (!l.length) { box.hidden = true; return false; }
    box.className = "bl bl-pcf";
    box.innerHTML = "<h3>" + esc(whose(name)) + '</h3><div class="bl-pcf-g">' + l.map(function (b) {
      return '<button type="button" class="bl-pcf-t" data-bl-beer="' + esc(b.id) + '">' + pic(b) + "<b>" + esc(b.name) + "</b><small>" + esc(styleName(b.style) || abvText(b) || "") + "</small></button>";
    }).join("") + "</div>";
    fixPics(box); box.hidden = false;
    return true;
  }

  /* ---------- profile: "Mina favoritöl" (js/profile.js makes the section, this fills it) ---------- */
  var LS_PRIV = "olnu.beer.privSent";
  function visMode() { try { return W.PNVIS && W.PNVIS.mode ? W.PNVIS.mode() : "alla"; } catch (e) { return "alla"; } }
  function privText() {
    if (!online()) return tl("Sparas bara på den här telefonen tills vidare.", "Saved on this phone only for now.");
    var m = visMode();
    return m === "spoke" ? tl("Spökläge: bara du ser dem.", "Ghost mode: only you see them.") : m === "vanner" ? tl("Syns bara för dina vänner.", "Seen by your friends only.") :
      tl("Syns för dina vänner och grupper.", "Seen by your friends and groups.");
  }
  // the server shows my favourites to friends / group mates by my Synlighet (never to strangers): tell it when the mode changed
  // 3 s later, not in the tap: js/warm.js takes a non-read RPC within 2.5 s of a tap for a user write and marks every cached screen dirty
  var privT = 0;
  function syncPrivacy() {
    clearTimeout(privT);
    privT = setTimeout(function () {
      if (!online()) return;
      var m = visMode(); if (lsGet(LS_PRIV, "") === m) return;
      call("beerlib_privacy", { p_mode: m }).then(function (r) { if (!r.error) lsSet(LS_PRIV, m); });
    }, 3000);
  }
  // the view js/profile.js draws (and keeps on this phone): 3 tiles {id, n name, s style, img, ph photo} + the privacy line
  function favViewOf(f) {
    return { t: f.map(function (id) {
      var b = id && data ? data.byId[id] : null; if (!b) return null;
      var st = beerStyle(b);
      return { id: b.id, n: b.name, s: styleName(b.style) || abvText(b) || "", img: b.photo ? photoUrl(b) : st ? BASE + "styles/" + st.id + ".svg" : "", ph: b.photo ? 1 : 0 };
    }), p: privText() };
  }
  function favCard(sec) {
    if (typeof sec.__blPaint !== "function") return sec;
    function paint() {
      var f = favs || localFavs();
      if (f.some(Boolean) && !data) { load().then(paint, function () {}); return; }   // no half card: wait for the names
      sec.__blPaint(favViewOf(f));
    }
    var off = on(function () { if (!sec.isConnected) { off(); return; } paint(); });
    loadFavs(true).then(function () { paint(); syncPrivacy(); });
    return sec;
  }

  /* ---------- bar card: "På kran" (js/placecard.js puts a hidden slot in the card; shown only when the bar has a list) ---------- */
  var taps = null, tapsP = null;
  function loadTaps() {
    if (taps) return Promise.resolve(taps);
    if (!tapsP) tapsP = getJSON(BASE + "taps.json").then(function (t) { taps = t && t.bars ? t : { bars: {} }; return taps; }, function () { taps = { bars: {} }; return taps; });
    return tapsP;
  }
  function tapRow(slot, barId) {
    return loadTaps().then(function (t) {
      var e = t.bars[String(barId)], ids = Array.isArray(e) ? e : e && Array.isArray(e.beers) ? e.beers : [];
      if (!ids.length) { slot.hidden = true; return false; }
      return load().then(function (d) {
        var l = ids.map(function (id) { return d.byId[String(id)]; }).filter(Boolean);
        if (!l.length || !slot.isConnected) { slot.hidden = true; return false; }
        var upd = e && e.updated ? dayText(e.updated) : "";
        slot.className = "bl bl-tap";
        slot.innerHTML = '<h3 class="bl-h" style="margin-top:0">' + esc(tl("På kran", "On tap")) + "<b>" + esc(tl(l.length + " öl", l.length + " beers")) + "</b></h3>" +
          '<div class="bl-tap-row">' + l.map(function (b) { return '<button type="button" class="bl-tc" data-bl-beer="' + esc(b.id) + '">' + pic(b) + "<b>" + esc(b.name) + "</b><small>" + esc(styleLine(b)) + "</small></button>"; }).join("") + "</div>" +
          '<div class="bl-src">' + ic("info") + "<span>" + esc(tl("Listan kommer från krogen", "The list comes from the bar") + (upd ? tl(" · uppdaterad " + upd, " · updated " + upd) : "")) + "</span></div>";
        if (!slot.__bl) { slot.__bl = 1; wire(slot, {}); }
        fixPics(slot); slot.hidden = false;
        return true;
      });
    });
  }

  var B = W.BEERLIB = {
    load: load, data: function () { return data; }, call: call, online: online, on: on, srv: srv,
    favs: loadFavs, favSlot: favSlot, toggleFav: toggleFav, setSlot: setSlot, rate: rate, localRate: localRate,
    tab: tab, picker: picker, chatCard: chatCard, parseTip: parseTip, tipText: tipText, favCard: favCard, tapRow: tapRow,
    chatCards: chatCards, chatPick: chatPick, friendFavs: friendFavs,
    // builders for js/beerlib-pages.js and the hooks in profile / placecard
    h: { tl: tl, en: en, ic: ic, esc: esc, mk: mk, num: num, numT: numT, abvText: abvText, styleName: styleName, styleLine: styleLine, oneLine: oneLine,
      beerStyle: beerStyle, styleImg: styleImg, pic: pic, dayText: dayText, fixPics: fixPics, credit: credit, rowHTML: rowHTML, tileHTML: tileHTML, starsHTML: starsHTML,
      wire: wire, dot: dot, styleGroups: styleGroups, flName: flName, FL: FL, toast: toast, aboutLink: aboutLink, uid: function () { return ++uid; } },
    // Off until a lawyer has checked the Systembolaget link rules (LEGAL.md (e), KOVFS 2023:1; coordinator 19 Nov). Code is ready.
    flags: { systembolaget: false },
    // Untappd: no API key yet. A later module may set BEERLIB.untappd = function (beer) -> Promise<{rating, count}>; nothing is shown before.
    untappd: null,
    _kind: function (b) { return stripKind(b); }, lookOf: lookOf,
    _reset: function () { data = null; dataP = null; srv.off = null; favs = null; favP = null; taps = null; tapsP = null; tabSt = { g: null, nBeer: 30, q: "", pick: 0, sx: {}, opts: {} }; }
  };
  if (W.PN) PN.mod("BEERLIB");
})();
