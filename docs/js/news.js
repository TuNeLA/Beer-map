/* LIVE ticker as a funny TV news feed. Builds headlines from the live beer rows.
   Privacy: strangers are always anonymous. Only friends (friend_name) and "Du" are named.
   A single stranger never gets an exact place; a bar name is used only when 2+ people are at that bar. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, t = I.t;
  var REC_KEY = "olnu.records", MAX_NIGHTS = 14, MAX_ITEMS = 6, NEAR_M = 5000;

  /* ---------- Personal records (per phone, localStorage) ---------- */
  // Night key = the date of the 05:00 Stockholm expiry that ends this night, e.g. "2026-10-18".
  function nightKey(d) {
    var x = U.next5am(d || new Date());
    try {
      return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
    } catch (e) { return x.toISOString().slice(0, 10); }
  }
  function prevNightKey(now) { return nightKey(new Date((now || new Date()).getTime() - 86400e3)); }
  function loadRec() {
    var r = U.ls.getJSON(REC_KEY, null);
    return r && typeof r === "object" && !Array.isArray(r) ? r : {};
  }
  function recId(b) { return b.is_mine ? "me" : b.friend_name ? "f:" + b.friend_name : null; }
  // Store the max beer_count seen tonight for "me" and each named friend. Keep the newest 14 nights.
  function update(beers, now) {
    try {
      var rec = loadRec(), key = nightKey(now), night = rec[key] && typeof rec[key] === "object" ? rec[key] : {};
      (beers || []).forEach(function (b) {
        var id = recId(b); if (!id) return;
        var n = b.beer_count | 0;
        if (n > (night[id] | 0)) night[id] = n;
      });
      rec[key] = night;
      var keys = Object.keys(rec).filter(function (k) { return /^\d{4}-\d{2}-\d{2}$/.test(k); }).sort();
      Object.keys(rec).forEach(function (k) { if (keys.indexOf(k) < 0) delete rec[k]; });
      while (keys.length > MAX_NIGHTS) delete rec[keys.shift()];
      U.ls.setJSON(REC_KEY, rec);
    } catch (e) {}
  }
  // {last: max on the previous night, best: max over stored nights before tonight}
  function stats(id, now) {
    var rec = loadRec(), key = nightKey(now), prev = prevNightKey(now), best = 0, last = 0;
    try {
      Object.keys(rec).forEach(function (k) {
        if (k === key || !rec[k]) return;
        var v = rec[k][id] | 0;
        if (v > best) best = v;
        if (k === prev) last = v;
      });
    } catch (e) {}
    return { last: last, best: best };
  }

  var recentUsed = [];   // template ids shown lately (memory only)

/* TX PICK START */
  /* tx04: (1) no template twice in one night per phone (olnu.tkNight = {n: night key, u: {kind: [index…]}}); a kind
     starts a new shuffled round only when all its lines were shown tonight. (2) Lines about Ludvika-area places (any kind)
     show only near Ludvika, Dalarna filler lines only in Dalarna. (3) Store builds (OLNU_STORE) skip drink-race kinds (who
     leads, records, beers per hour, "one more to…"). (4) Time of day / weekday / month / real weather / town joke kinds. */
  var TK_NIGHT = "olnu.tkNight", tkNight = null;
  function usedTonight(now) {
    var key = nightKey(now);
    if (!tkNight || tkNight.n !== key) {
      var r = null; try { r = U.ls.getJSON(TK_NIGHT, null); } catch (e) { r = null; }
      tkNight = r && r.n === key && r.u && typeof r.u === "object" ? r : { n: key, u: {} };
    }
    return tkNight;
  }
  function markShown(now, list) {
    try {
      var r = usedTonight(now), ch = false;
      list.forEach(function (x) {
        if (x.uk == null || x.ui == null) return;
        var a = r.u[x.uk] || (r.u[x.uk] = []);
        if (a.indexOf(x.ui) < 0) { a.push(x.ui); ch = true; }
      });
      if (ch) U.ls.setJSON(TK_NIGHT, r);
    } catch (e) {}
  }
  var FILLER_RE = /^(random|general|total|t[1-5]|tMorning|tDay|wd[1-7]|mo\d{1,2})$/;
  var LUDV_RE = /Ludvika|Väsman|Grangärde|Sunnansjö|Ulriksberg|Fredriksberg|Säfsnäs|Blötberget|Grängesberg|Nyhammar|Saxen|Smedjebacken|Brunnsvik/;
  var DAL_RE = /Dalarna|dalmål|Dalälven|[Dd]alahäst|Bergslagen/;
  var LUDV_TOWNS = { "Ludvika": 1, "Smedjebacken": 1, "Grängesberg": 1 };
  var DAL_TOWNS = { "Ludvika": 1, "Smedjebacken": 1, "Grängesberg": 1, "Borlänge": 1, "Falun": 1, "Mora": 1, "Leksand": 1, "Rättvik": 1,
    "Avesta": 1, "Hedemora": 1, "Säter": 1, "Vansbro": 1, "Orsa": 1, "Älvdalen": 1, "Malung": 1, "Sälen": 1, "Fagersta": 1, "Kopparberg": 1 };
  // here = the town of the user's current position (ticker centre: own location, own pin or map centre; never the home
  // town). Live values (names, bars, towns) are taken out first, so only the template's own words are tested.
  function localOk(k, tx, d) {
    var here = d && d.here, t = String(tx);
    ["bar", "bar1", "bar2", "bar3", "name", "group", "stad", "town", "here", "rival", "who", "where"].forEach(function (f) {
      var v = d && d[f]; if (v && typeof v === "string" && v.length > 1) t = t.split(v).join(" ");
    });
    if (!areaOk(t, d) || !timeOk(t)) return false;   // fixM T-14 (town jokes too: "Stureplan" on Söder, "ikväll" at 06:25)
    if (/^townJoke_/.test(k)) return true;   // keyed by town already
    if (LUDV_RE.test(t) && !LUDV_TOWNS[here]) return false;
    if (FILLER_RE.test(k) && DAL_RE.test(t) && !DAL_TOWNS[here]) return false;
    return true;
  }
  var STORE_SKIP = { meBehind: 1, meLead: 1, groupLeader: 1, recNew: 1, recChase: 1, recClose: 1, meRecNew: 1, meRec: 1, barRate: 1, barRateHigh: 1,
    hotClose: 1, medClose: 1, meHotClose: 1, meMedClose: 1 };   // "one more and you hit…" lines push drinking
  function storeSkip(k) { return !!(window.OLNU_STORE && STORE_SKIP[k]); }
  function partsNow(now) {   // evening weekday (1 = Monday) and month: the night belongs to the evening before 05:00
    try {
      var d = new Date(now.getTime() - 5 * 3600e3);
      var f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", weekday: "short", month: "numeric" }).formatToParts(d), wd = "", mo = 0;
      f.forEach(function (p) { if (p.type === "weekday") wd = p.value; if (p.type === "month") mo = +p.value; });
      return { wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd) + 1, mo: mo };
    } catch (e) { var x = new Date(now.getTime() - 5 * 3600e3); return { wd: ((x.getDay() + 6) % 7) + 1, mo: x.getMonth() + 1 }; }
  }
  function wxKind() {   // real weather from js/ute.js (Open-Meteo, cached 30 min); null when unknown
    try {
      var w = window.UTE && window.UTE.current && window.UTE.current(), d = w && w.d;
      if (!d || !isFinite(d.t)) return null;
      var c = d.code | 0, t = Math.round(d.t);
      var k = c >= 95 ? "storm" : (c >= 71 && c <= 77) || c === 85 || c === 86 ? "snow"
        : (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || d.pr > 0 ? "rain" : c === 45 || c === 48 ? "fog"
        : t <= 0 ? "freeze" : t < 10 ? "cold" : t >= 18 ? "warm" : c <= 1 ? "clear" : "mild";
      return { k: k, t: t };
    } catch (e) { return null; }
  }
  /* TX PICK END */
  /* fixM T-14 SNAP START — test teams 11 Nov: the ticker said "Ingen ute i Ludvika än" next to "Nu ä det 9 på Pitchers",
     "X gick in i baren" while X was at home, "Stureplan" for a bar on Söder and "Förfesten pågår" at 06:25.
     1. ONE local snapshot per build (snap): people near the ticker centre = max(pins, check-ins) within 5 km, + live_total.
        Quiet kinds (calm, emptyFirst, townQuiet) need it to be (near) empty; "total" uses live_total (the header's own
        source), never the pins in view, and only from 3.
     2. Districts: a line that names a Stockholm district shows only when its bar (or the centre) is in that district.
     3. Hours (Europe/Stockholm): night words not 05–15, "ikväll / kvällen" not 05–12.
     4. The belt (freshBelt): pieces of the OLD snapshot that are not on screen yet are dropped when a new one comes;
        an old quiet line still on screen fades when the new snapshot has people. */
  var snap = { n: 0, pins: 0, cis: 0, total: null, at: 0 }, curCenter = null, barLL = {};
  // fixMo N-10: people = DISTINCT people in pins + check-ins (the same helper as the bar label: PNCROWD.people)
  function ppl(pins, cis) { pins = pins || []; cis = cis || []; try { if (window.PNCROWD && window.PNCROWD.people) return window.PNCROWD.people(pins, cis); } catch (e) {} return Math.max(pins.length, cis.length); }
  function ciCanon(id) { try { return window.BARS && window.BARS.canonId ? String(window.BARS.canonId(id)) : String(id); } catch (e) { return String(id); } }
  var DISTRICTS = [   // rough boxes [s, w, n, e]; owner: widen here
    { k: "soder", re: /(^|[^A-Za-zÅÄÖåäöé])(Söder|Södermalm|SoFo|Medborgarplatsen|Mariatorget|Nytorget|Hornstull|Skanstull|Mosebacke|Zinkensdamm)(?![a-zåäö])/, b: [59.3045, 18.0200, 59.3225, 18.1090] },
    { k: "ostermalm", re: /(^|[^A-Za-zÅÄÖåäöé])(Stureplan|Östermalm\w*|Ö-malm|Karlaplan|Stureplans?)(?![a-zåäö])/, b: [59.3320, 18.0680, 59.3520, 18.1150] },
    { k: "gamlastan", re: /(^|[^A-Za-zÅÄÖåäöé])(Gamla stan|Västerlånggatan|Stortorget)(?![a-zåäö])/, b: [59.3205, 18.0620, 59.3290, 18.0810] },
    { k: "slussen", re: /(^|[^A-Za-zÅÄÖåäöé])(Slussen)(?![a-zåäö])/, b: [59.3150, 18.0600, 59.3290, 18.0850] },
    { k: "saltsjobaden", re: /(^|[^A-Za-zÅÄÖåäöé])(Saltsjöbaden)(?![a-zåäö])/, b: [59.2700, 18.2700, 59.2950, 18.3300] }
  ];
  function inBox(p, b) { return !!p && p.lat >= b[0] && p.lat <= b[2] && p.lng >= b[1] && p.lng <= b[3]; }
  function areaOk(t, d) {
    var hits = DISTRICTS.filter(function (x) { return x.re.test(t); }); if (!hits.length) return true;
    var bn = d && (d.bar || d.bar1), ref = (bn && barLL[bn]) || curCenter;
    return hits.some(function (x) { return inBox(ref, x.b); });
  }
  var NIGHT_RX = /förfest|midnatt|i ?natt(?![a-zåäö])|nattmat|efterfest|sista beställning|stängningsdags|nattbuss/i, EVE_RX = /i ?kväll|kvällen|kvällens|ikväll/i;
  var hourCur = 20;
  function timeOk(t) {
    if (hourCur >= 5 && hourCur < 15 && NIGHT_RX.test(t)) return false;
    if (hourCur >= 5 && hourCur < 12 && EVE_RX.test(t)) return false;
    return true;
  }
  // "… hissar flaggan." after "en grupp": a sentence never starts with a small letter
  function sentences(t) { return String(t).replace(/((?:^|[^.…])(?:[.!?]|\.["”»])\s+)([a-zåäö])/g, function (m, a, b) { return a + b.toUpperCase(); }); }   // fixC N-19: not after ?” / !” (a quoted question mid-sentence: "skicka ”Ikväll?” till gänget")   // "Asså... vad" (an ellipsis) stays
  // uxfix P1-5: the header says "N ute" (snap.hdr) and no pin has a name → one real line "N ute – gå med i ett gäng för att se namn"
  // tickerfix 1: ONE rule for "N ute – gå med i ett gäng för att se namn" (the ticker, app-ticker.js, and the "Ingen data här" toast,
  // pnds.js): N = others out = the header's number (hdr) without my own live pin; 0 while I am in a gang (gang_poll groups, the
  // cached my_groups, home_status group rows (homeRows) or a pin with a name).
  function hintN(hdr, beers, homeRows) {
    beers = beers || []; hdr = hdr | 0;
    var mine = beers.some(function (b) { return b && b.is_mine; }), n = Math.max(0, hdr - (hdr > 0 && mine ? 1 : 0));
    if (!(n > 0) || (homeRows | 0) > 0 || beers.some(function (b) { return b && !b.is_mine && (b.friend_name || b.is_friend); })) return 0;
    try { var g = window.GANG && window.GANG.data && window.GANG.data(); if (g && Array.isArray(g.groups) && g.groups.length) return 0; } catch (e) {}
    try { var w = window.WARM && window.WARM.get && window.WARM.get("my_groups", {}); if (w && Array.isArray(w.data) && w.data.length) return 0; } catch (e) {}
    return n;
  }
  // N = ctx.namesHint (app-ticker: hintN of the header's number), else the header's number (old callers / tests)
  function namesHint(beers, byKind, ctx) {
    var n = ctx && ctx.namesHint != null ? ctx.namesHint | 0 : snap.hdr;
    if (!(n > 0) || beers.some(function (b) { return b && !b.is_mine && (b.friend_name || b.is_friend); })) return 0;
    byKind.townNames = [function (d) { return d.n + " ute – gå med i ett gäng för att se namn"; }];
    return n;
  }
  /* tickerfix 2 (finalcheck: "Du har fått sina nya streck", "Kalla inte Du vid förnamn", "Namn: Du."): a line whose name is the
     user's own fallback word (t("you") = "Du" / "You") keeps "Du" only as the subject that opens a sentence, followed by a verb;
     there sv "sin / sitt / sina" becomes "din / ditt / dina" and en "has / is / was / their" becomes "have / are / were / your".
     Any other place ("Namn: Du.", "Grattis Du", "Kalla inte Du") = the template is skipped (the next one is tried). */
  var YOU_L = "A-Za-zÅÄÖåäöÉéÜü";
  function youFix(tx, d) {
    var you = t("you"); if (!you || !d || typeof you !== "string") return tx;
    var hit = false; Object.keys(d).forEach(function (k) { if (d[k] === you) hit = true; }); if (!hit) return tx;
    var re = new RegExp("(^|[^" + YOU_L + "])" + you + "(?![" + YOU_L + "])", "g"), m, en = I.lang === "en";
    while ((m = re.exec(tx))) {
      var before = tx.slice(0, m.index + m[1].length), after = tx.slice(m.index + m[0].length);
      var start = new RegExp("^[^" + YOU_L + "0-9]*$").test(before) || new RegExp("[.!?:]\\s+[^" + YOU_L + "0-9]*$").test(before);
      if (!start || !/^ [a-zåäöé]/.test(after)) return "";
      if (en && !/^ (has|is|was|have|are|were|just|got|made|did|can|could|will|would|beat|hit)\b|^ [a-z]+ed\b/.test(after)) return "";
    }
    var sentence = new RegExp("(^|[.!?:]\\s+[^" + YOU_L + "0-9]*|^[^" + YOU_L + "0-9]*)(" + you + " [^.!?]*)", "g");
    return tx.replace(sentence, function (all, a, b) {
      b = en ? b.replace(/^(You) (has|is|was)\b/, function (x, y, v) { return y + " " + ({ has: "have", is: "are", was: "were" })[v]; }).replace(/\btheir\b/g, "your")
        : b.replace(/(^|[^A-Za-zÅÄÖåäö])(sina|sitt|sin)(?![A-Za-zÅÄÖåäö])/g, function (x, p, w) { return p + ({ sina: "dina", sitt: "ditt", sin: "din" })[w]; });
      return a + b;
    });
  }
  /* tickerfix 4 (+ coordinator: CI 08:40 "☕ God morgon! Kartan är tom …" next to "7 ute"): ANY line that says the map / town is
     empty (time-of-day, weekday, filler, dialect packs, not only the QUIET kinds) never shows while the header says N > 0. */
  var EMPTY_RX = /kartan (är|ä) tom|tom karta|tomt på kartan|tomt i (?!gänget|loggboken|röstlådan|rullan)\S|tomt på grupper|tom innerstad|(inte|int'|int’) en (själ|kjäft)(?! i kön)|ingen ute|ingen på kartan|inga prickar|ingen fackla tänd|ingen har tryckt|ingen har varit ute|stranden (är|ä) tom|bara (snön|regnet|måsarna) (är|ä) ute|nobody (is )?out|empty map|map is empty|no one (is )?out|not a soul/i;
  function emptyLine(tx) { return EMPTY_RX.test(String(tx || "")); }
  var QUIET = { calm: 3, emptyFirst: 1, townQuiet: 3 }, quietText = {}, quietN = 0;   // kind -> shown only while snap.n is below this
  function friendAtBar(b) {
    if (b.snap != null || b.bar_id != null) return b.snap === "bar" || (b.bar_id != null && b.snap !== "area" && b.snap !== "home");
    try { return !!(window.BARS && b.precise && window.BARS.describe(b).kind === "at"); } catch (e) { return false; }
  }
  var BELT_CSS = ".tk-item.tk-stale{opacity:0;transition:opacity .25s var(--e-std,ease)}@media (prefers-reduced-motion:reduce){.tk-item.tk-stale{transition:none}}";
  function freshBelt(track) {
    if (!track || !track.parentNode) return 0;
    if (!document.getElementById("news-belt-css") && document.head) { var st = document.createElement("style"); st.id = "news-belt-css"; st.textContent = BELT_CSS; document.head.appendChild(st); }
    var vr = track.parentNode.getBoundingClientRect(), kids = [].slice.call(track.children), cut = 0;
    for (var i = kids.length - 1; i >= 0; i--) {   // from the right end: never a gap in what is on screen
      var r = kids[i].getBoundingClientRect();
      if (r.left < vr.right - 1 || kids[i].classList.contains("tk-kick")) break;
      track.removeChild(kids[i]); cut++;
    }
    // an old quiet line on screen that the NEW snapshot would not allow (its own threshold), or the plain "Lugnt läge" filler
    [].forEach.call(track.querySelectorAll(".tk-item.tk-quiet"), function (e) {
      var lim = quietText[String(e.textContent || "")];
      if ((lim && snap.n >= lim) || (!lim && snap.n >= 3) || snap.hdr > 0) staleOut(e);
    });
    if (snap.hdr > 0) [].forEach.call(track.querySelectorAll(".tk-item"), function (e) { if (emptyLine(e.textContent)) staleOut(e); });   // tickerfix 4: any "empty map" line
    return cut;
  }
  // ownerfix 4a (owner PC shot, 11 Nov): an invisible line that keeps its width = a big gap between "///" on a wide screen.
  // Fade it (250 ms), then fold it shut together with one separator (300 ms) and remove both: the belt closes up smoothly.
  function staleOut(e) {
    if (!e || e.__ofStale) return; e.__ofStale = true;
    e.classList.add("tk-stale");
    var p = e.previousElementSibling, n = e.nextElementSibling;
    var sep = p && p.classList.contains("tk-sep") ? p : n && n.classList.contains("tk-sep") ? n : null;
    var parts = sep ? [e, sep] : [e];
    var gone = function () { parts.forEach(function (x) { if (x.parentNode) x.parentNode.removeChild(x); }); };
    var red = false; try { red = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (x) {}
    if (red) { gone(); return; }
    if (sep) { sep.style.transition = "opacity .25s ease"; sep.style.opacity = "0"; }
    setTimeout(function () {
      parts.forEach(function (x) { x.style.maxWidth = x.offsetWidth + "px"; x.style.overflow = "hidden"; x.style.boxSizing = "border-box"; });
      void e.offsetWidth;
      parts.forEach(function (x) { x.style.transition = "max-width .3s ease, padding .3s ease, opacity .25s ease"; x.style.maxWidth = "0px"; x.style.paddingLeft = "0px"; x.style.paddingRight = "0px"; });
      setTimeout(gone, 330);
    }, 260);
  }
  /* fixM T-14 SNAP END */
  var sideSeen = {}, SIDE_FRESH_MS = 40 * 60 * 1000;   // pin id -> {n: other_count, at: when it went up}

  /* ---------- Helpers ---------- */
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }
  function hourNow(now) {
    try {
      var h = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23" }).format(now);
      return parseInt(h, 10) % 24;
    } catch (e) { return now.getHours(); }
  }
  function townAt(lat, lng) { var c = window.CITIES && window.CITIES.nearest(lat, lng); return c ? c.name : null; }

  // v10: extra Swedish headlines from js/news-more.js (window.NEWS_MORE = {sv: [{k, f}]}). English: none extra.
  function moreTemplates() {
    try {
      var m = window.NEWS_MORE, l = I.lang === "en" ? "en" : "sv";
      return l === "sv" && m && Array.isArray(m.sv) ? m.sv : [];
    } catch (e) { return []; }
  }

  // Polish 2026-10-17: group + town templates from js/news-gt.js (window.NEWS_GT, Swedish only).
  // Owner 2026-10-18: no added "drick vatten" care lines (no warning texts).
  function gtTemplates() {
    try {
      var g = window.NEWS_GT;
      if (I.lang === "en" || !Array.isArray(g)) return [];
      return g.slice();
    } catch (e) { return []; }
  }
  // Friend reaching 5 / 10 (LEVEL_FRIEND_SV, Swedish only).
  function lvFriendTemplates() {
    var f = window.LEVEL_FRIEND_SV, out = [];
    if (I.lang === "en" || !f) return out;
    (f.at5 || []).forEach(function (l) { out.push({ k: "friendLv5", f: function (d) { return l.replace(/\{name\}/g, d.name); } }); });
    (f.at10 || []).forEach(function (l) { out.push({ k: "friendLv10", f: function (d) { return l.replace(/\{name\}/g, d.name); } }); });
    return out;
  }
  // "Befordran" memory per night: name -> title seen, name -> when the title changed (for groupNewRank).
  var RANK_KEY = "olnu.newsRanks";
  function rankNews(now, list) {
    var out = [];
    try {
      var key = nightKey(now), r = U.ls.getJSON(RANK_KEY, null);
      if (!r || r.night !== key) r = { night: key, t: (r && r.t) || {}, fresh: {} };
      list.forEach(function (x) {
        if (!x.name || !x.title) return;
        var was = r.t[x.name];
        if (was && was !== x.title) r.fresh[x.name] = { title: x.title, at: now.getTime() };
        r.t[x.name] = x.title;
      });
      Object.keys(r.fresh).forEach(function (n) {
        var f = r.fresh[n];
        if (now.getTime() - f.at < 90 * 60e3) out.push({ name: n, title: f.title });
      });
      U.ls.setJSON(RANK_KEY, r);
    } catch (e) {}
    return out;
  }

  /* ---------- Categories for the mix ---------- */
  var GENERAL = { random: 1, total: 1, t1: 1, t2: 1, t3: 1, t4: 1, t5: 1, general: 1 };
  var TOWN = { barReport: 1, barRate: 1, barRateHigh: 1, barStranger: 1, checkinCrowd: 1, anon: 1, anonSidetrack: 1,
    calm: 1, forecast: 1, takeover: 1, queueLong: 1, queueNone: 1, hot: 1, med: 1, chaos: 1 };
  function catOf(x) {
    var cls = " " + (x.cls || "") + " ", k = String(x.k || "");
    if (cls.indexOf(" tk-friend ") >= 0 || cls.indexOf(" tk-me ") >= 0 || /^(group|me[A-Z]|friend)/.test(k)) return "group";
    if (GENERAL[k]) return "general";
    if (TOWN[k] || /^town/.test(k)) return "town";
    var d = x.d || {};
    return d.bar || d.stad || d.where ? "town" : "general";
  }

  /* ---------- Group + town candidates (NEWS_GT kinds) ----------
     ctx.home = home_status rows of tonight (every member of my groups: beers, others, was_out, live, home, home_at),
     ctx.rallies = my groups' call-outs, ctx.myName / ctx.myTitle / ctx.myMedals, ctx.titles (friend titles),
     ctx.checkins, pins (friend_name / is_mine with bar_id). Time of day = Europe/Stockholm. */
  function groupTownCands(beers, ctx, now, per, add) {
    var hh = hourNow(now), myName = ctx.myName || t("you");
    // Where is each named person? name -> bar name (pins with a bar, then check-ins).
    var barOfName = {}, skalOfName = {};
    // fixMo N-10: a check-in is the person's own word for where they are: it wins over a snapped pin
    (ctx.checkins || []).forEach(function (c) {
      var nm = c.is_mine ? myName : c.is_friend ? c.name : null;
      if (nm && c.bar_name && !barOfName[nm]) barOfName[nm] = c.bar_name;
    });
    beers.forEach(function (b) {
      var nm = b.is_mine ? myName : b.friend_name; if (!nm) return;
      skalOfName[nm] = (skalOfName[nm] | 0) + (b.skal_count | 0);
      if (!barOfName[nm] && b.bar_id != null && b.snap !== "area" && window.BARS) { var bar = window.BARS.byId(b.bar_id); if (bar && bar.name) barOfName[nm] = bar.name; }
    });
    var groups = {}, order = [];
    (ctx.home || []).forEach(function (r) {
      if (!r || r.group_id == null || !r.group_name) return;
      var g = groups[r.group_id];
      if (!g) { g = groups[r.group_id] = { id: r.group_id, name: r.group_name, m: [] }; order.push(g); }
      g.m.push(r);
    });
    order.forEach(function (g) {
      var nameOf = function (r) { return r.is_me ? myName : r.name; };
      var drinks = function (r) { return Math.max(0, r.beers | 0) + Math.max(0, r.others | 0); };
      var out = g.m.filter(function (r) { return r.live || r.was_out || drinks(r) > 0 || !!barOfName[nameOf(r)]; });   // fixMo N-10: checked in = out
      var total = 0; out.forEach(function (r) { total += drinks(r); });
      var G = g.name;
      if (out.length >= 2 && total >= 2) add("groupTotal", { group: G, n: total, k: out.length }, 1, "tk-friend");
      if (g.m.length >= 3 && out.length === g.m.length) add("groupAllOut", { group: G, k: out.length }, 2, "tk-friend");
      if (out.length === 1 && out[0].live && g.m.length >= 2) add("groupFirstOut", { name: nameOf(out[0]), group: G }, 1, "tk-friend");
      if (!out.length && (hh >= 19 || hh < 3)) add("groupQuiet", { group: G }, 0, "tk-friend");
      var lead = out.slice().sort(function (a, b) { return drinks(b) - drinks(a); });
      if (lead.length >= 2 && drinks(lead[0]) >= 3 && drinks(lead[0]) > drinks(lead[1])) {
        add("groupLeader", { name: nameOf(lead[0]), group: G, n: drinks(lead[0]) }, drinks(lead[0]) >= 8 ? 2 : 1, "tk-friend");
      }
      g.m.forEach(function (r) {
        var at = Date.parse(r.home_at || "") || 0;
        if (r.home && at && now.getTime() - at < 90 * 60e3 && !r.is_me) add("groupHome", { name: nameOf(r), group: G }, 2, "tk-friend");
      });
      var atBar = {}, bars = 0, skal = 0;
      out.forEach(function (r) {
        var b = barOfName[nameOf(r)]; if (b) { if (!atBar[b]) bars++; atBar[b] = (atBar[b] | 0) + 1; }
        skal += skalOfName[nameOf(r)] | 0;
      });
      var best = null; Object.keys(atBar).forEach(function (b) { if (!best || atBar[b] > atBar[best]) best = b; });
      if (best && atBar[best] >= 2) add("groupSameBar", { k: atBar[best], group: G, bar: best }, 2, "tk-friend");
      if (bars >= 2) add("groupSplit", { group: G, bars: bars }, 1, "tk-friend");
      if (skal >= 3) add("groupSkal", { group: G, s: skal }, 1, "tk-friend");
      (ctx.rallies || []).forEach(function (r) {
        if (String(r.group_id) !== String(g.id) || (r.yes | 0) < 1) return;
        add("groupRally", { name: r.is_mine ? myName : (r.name || t("someone")), group: r.group_name || G, k: r.yes | 0 }, 2, "tk-friend");
      });
    });
    // Promotions (titles) tonight: me + friends.
    var tl = [], titles = ctx.titles || {};
    if (ctx.myTitle) tl.push({ name: myName, title: ctx.myTitle });
    beers.forEach(function (b) { if (b.friend_name && titles[b.id]) tl.push({ name: b.friend_name, title: titles[b.id] }); });
    rankNews(now, tl).forEach(function (x) { add("groupNewRank", x, 1, "tk-friend"); });
    // My medals earned in the last 2 h.
    (ctx.myMedals || []).forEach(function (m) { add("groupMedal", { name: myName, medal: m }, 1, "tk-me"); });

    // Town (anonymous): the town of the map/user centre.
    var c = ctx.center, town = c && townAt(c.lat, c.lng);
    if (!town) return;
    var byTown = {}, k = 0, barSet = {}, ranking = [], tP = {}, tC = {};
    // fixMo N-10: people per town = distinct people in pins + check-ins (was pins only)
    beers.forEach(function (b) { var tw = townAt(b.lat, b.lng); if (tw) (tP[tw] = tP[tw] || []).push(b); });
    (ctx.checkins || []).forEach(function (q) { if (!q || !isFinite(q.lat)) return; var tw = townAt(+q.lat, +q.lng); if (tw) (tC[tw] = tC[tw] || []).push(q); });
    Object.keys(tP).concat(Object.keys(tC)).forEach(function (tw) { if (byTown[tw] == null) byTown[tw] = ppl(tP[tw], tC[tw]); });
    k = byTown[town] | 0;
    Object.keys(per || {}).forEach(function (id) {
      var a = per[id]; if (!a.bar || !a.bar.name || townAt(a.bar.lat, a.bar.lng) !== town) return;
      barSet[id] = 1;
      if (a.beers.length >= 2) ranking.push({ bar: a.bar.name, n: a.beers.length });   // a bar name only with 2+ people
    });
    var nb = Object.keys(barSet).length;
    if (k >= 2 && nb >= 1) add("townOut", { town: town, k: k, b: nb }, 2);
    if (k < 3) add("townQuiet", { town: town }, 0, "tk-quiet");
    if (k >= 1 && hh >= 1 && hh < 5) add("townLate", { town: town, k: k }, 2);
    if (k >= 1 && hh >= 15 && hh < 20) add("townEarly", { town: town, k: k }, 1);
    add("townWeather", { town: town }, 0);
    if (Math.random() < 0.3) add("townJoke_" + town, { town: town }, 0);   // tx04: local humour, only in that town
    var wx = (hh >= 15 || hh < 5) && Math.random() < 0.4 ? wxKind() : null;   // tx04: real weather, evenings
    if (wx) add("townWx_" + wx.k, { town: town, t: wx.t }, 0);
    var rival = null;
    Object.keys(byTown).forEach(function (tw) { if (tw !== town && (!rival || byTown[tw] > byTown[rival])) rival = tw; });
    if (rival && k >= 1) add("townCompare", { town: town, k: k, rival: rival, rk: byTown[rival] }, 2);
    ranking.sort(function (a, b) { return b.n - a.n; });
    if (ranking.length >= 3) add("townBarRanking", { town: town, bar1: ranking[0].bar, bar2: ranking[1].bar, bar3: ranking[2].bar }, 2);
    add("general", {}, 0);
  }
  var lastBeers = [], lastCtx = {};

  /* ---------- Build one cycle ---------- */
  // ctx: {center:{lat,lng}, now:Date, prev:[texts of last cycle], titles, others, checkins (v10: live_checkins rows)}
  // Returns [{text, cls}] — max 6, shuffled, no text twice, first item never the last cycle's last item.
  function build(beers, ctx) {
    ctx = ctx || {};
    beers = beers || [];
    var now = ctx.now || new Date(), prev = ctx.prev || [];
    var bp = window.BARSPLUS, bpTpl = [];
    try { bpTpl = bp && bp.newsTemplates ? bp.newsTemplates() || [] : []; } catch (e) { bpTpl = []; }
    var tpl = (t("news") || []).concat(moreTemplates()).concat(gtTemplates()).concat(lvFriendTemplates()).concat(bpTpl), byKind = {};
    lastBeers = beers; lastCtx = ctx;
    tpl.forEach(function (x) {
      if (!x || typeof x.k !== "string" || typeof x.f !== "function") return;
      (byKind[x.k] = byKind[x.k] || []).push(x.f);
    });
    var cand = [];   // {k, d, imp, cls}
    // fixM T-14: the one snapshot this build reads (pins + check-ins near the centre, the header's live_total)
    var c0 = ctx.center || null, nearOf = function (p) { return !c0 || (isFinite(p.lat) && U.haversine(c0.lat, c0.lng, +p.lat, +p.lng) <= NEAR_M); };
    curCenter = c0; hourCur = hourNow(now); barLL = {};
    var nearP = beers.filter(nearOf), nearC = (ctx.checkins || []).filter(function (c) { return c && nearOf(c); });
    snap = { pins: nearP.length, cis: nearC.length, total: ctx.liveTotal != null ? ctx.liveTotal | 0 : null, at: now.getTime(), hdr: ctx.hdrOut | 0 };   // uxfix P1-5: hdr = the header's "N ute"
    snap.n = ppl(nearP, nearC);   // fixMo N-10: distinct people (was max(pins, check-ins))
    (ctx.checkins || []).forEach(function (c) { if (c && c.bar_name && isFinite(c.lat)) barLL[c.bar_name] = { lat: +c.lat, lng: +c.lng }; });
    function add(k, d, imp, cls) {
      if (QUIET[k] && (snap.n >= QUIET[k] || snap.hdr > 0)) return;   // uxfix P1-5: never "Tomt / Int' en själ" while the header says "N ute"   // fixM T-14: no "Ingen ute" next to people / check-ins near
      if (byKind[k] && !storeSkip(k)) cand.push({ k: k, d: d || {}, imp: imp | 0, cls: cls || "" });
    }
    var anon = t("newsAnon") || ["?"];

    // Bars with 2+ people (same assignment as the map: precise pins within 75 m).
    var per = window.BARS ? window.BARS.assign(beers).perBar : {}, busyBar = {}, bars = [];
    Object.keys(per).forEach(function (id) {
      var a = per[id];
      if (a.bar && a.bar.name && isFinite(a.bar.lat)) barLL[a.bar.name] = { lat: a.bar.lat, lng: a.bar.lng };   // fixM T-14: districts
      if (a.beers.length < 2 || !a.bar.name) return;
      bars.push(a);
      a.beers.forEach(function (b) { busyBar[b.id] = a.bar.name; });
    });
    // Place phrase for a hot/med alert. Named people: the normal place text. Strangers: busy bar or town only.
    function whereFor(b) {
      if (b.is_mine || b.friend_name) {
        var d = window.BARS ? window.BARS.describe(b) : { kind: "unknown" };
        return d.kind === "unknown" ? "" : " " + t("where_" + d.kind, d.name);
      }
      if (busyBar[b.id]) return " " + t("where_at", busyBar[b.id]);
      var tw = townAt(b.lat, b.lng);
      return tw ? " " + t("where_town", tw) : "";
    }
    function whoFor(b) { return b.is_mine ? t("you") : b.friend_name || pick(anon); }

    // Streak alerts (important). Highest first, max 3.
    beers.filter(function (b) { return U.level(b.beer_count) > 0; })
      .sort(function (a, b) { return (b.beer_count | 0) - (a.beer_count | 0); })
      .slice(0, 3)
      .forEach(function (b) {
        var med = U.level(b.beer_count) === 2;
        // Strangers' alerts compete with the town news (imp 2); named people stay on top (imp 3).
        add(med ? "med" : "hot", { who: whoFor(b), where: whereFor(b), n: b.beer_count | 0 }, b.friend_name || b.is_mine ? 3 : 2,
          (med ? "tk-med" : "tk-hot") + (b.friend_name ? " tk-friend" : ""));
      });

    // Named people: records, near a streak, skål.
    var me = null, friends = [];
    beers.forEach(function (b) { if (b.is_mine) me = b; else if (b.friend_name) friends.push(b); });
    friends.forEach(function (b) {
      var n = b.beer_count | 0, s = stats(recId(b), now), d = { name: b.friend_name, n: n };
      if (s.best >= 1 && n > s.best) add("recNew", d, 2, "tk-friend");
      else if (s.last >= 2 && s.last > n) {
        var k = s.last - n;
        add(k <= 3 && Math.random() < 0.5 ? "recClose" : "recChase", { name: b.friend_name, n: n, rek: s.last, k: k }, 2, "tk-friend");
      }
      if (n >= 10) add("friendLv10", d, 2, "tk-friend");
      else if (n >= 5) add("friendLv5", d, 2, "tk-friend");
      if (n === 4) add("hotClose", d, 2, "tk-friend");
      if (n === 9) add("medClose", d, 2, "tk-friend");
      if (n >= 1 && n <= 3) add("friendOut", d, 0, "tk-friend");
      if (n >= 1) add("friendBeer", d, 0, "tk-friend");
      var sk = b.skal_count | 0;
      if (sk >= 1) add("skal", { name: b.friend_name, s: sk }, 1, "tk-friend");
    });
    if (me) {
      var mn = me.beer_count | 0, ms = stats("me", now);
      if (ms.best >= 1 && mn > ms.best) add("meRecNew", { n: mn }, 2, "tk-me");
      else if (ms.last >= 2 && ms.last > mn) add("meRec", { n: mn, rek: ms.last }, 1, "tk-me");
      if (mn === 4) add("meHotClose", {}, 2, "tk-me");
      if (mn === 9) add("meMedClose", {}, 2, "tk-me");
      add("meN", { n: mn }, 0, "tk-me");
      if ((me.skal_count | 0) >= 1) add("meSkal", { s: me.skal_count | 0 }, 1, "tk-me");
      var ahead = friends.filter(function (b) { return (b.beer_count | 0) > mn; })
        .sort(function (a, b) { return (b.beer_count | 0) - (a.beer_count | 0); })[0];
      if (ahead) add("meBehind", { name: ahead.friend_name, k: (ahead.beer_count | 0) - mn }, 1, "tk-me");
      else if (mn >= 2 && friends.some(function (b) { return (b.beer_count | 0) >= 1; }) &&
        friends.every(function (b) { return (b.beer_count | 0) < mn; })) add("meLead", {}, 1, "tk-me");   // fixJ T-20: a real lead (strictly ahead, 2+); a tie is no lead
    }

    // v9: friends' titles (ctx.titles: beer id -> title; friends only, from friend_totals).
    var titles = ctx.titles || {};
    friends.forEach(function (b) {
      var ti = titles[b.id];
      if (ti && friendAtBar(b) && Math.random() < 0.5) add("fTitle", { title: ti, name: b.friend_name, n: b.beer_count | 0 }, 1, "tk-friend");
    });
    // v9: side tracks (other drinks). ctx.others = all live pins with other_count/other_kind.
    // A side track is news for ~40 min after the drink (count went up). After that only now and then.
    var nat = t("drinkNat") || {}, sideAnon = 0, nowT = now.getTime();
    (ctx.others || []).forEach(function (b) {
      if (!b || (b.other_count | 0) < 1) return;
      var drink = nat[b.other_kind] || nat.annat || "?";
      // Strangers' ids rotate every 10 min: key them by spot + drink instead.
      var key = b.is_mine || b.friend_name ? String(b.id != null ? b.id : b.beer_id) : "s:" + (b.bar_id || (+b.lat).toFixed(4) + "," + (+b.lng).toFixed(4)) + ":" + (b.other_kind || ""), seen = sideSeen[key];
      if (!seen || (b.other_count | 0) > seen.n) seen = sideSeen[key] = { n: b.other_count | 0, at: nowT };
      var fresh = nowT - seen.at < SIDE_FRESH_MS;
      if (!fresh && Math.random() > 0.12) return;
      var sk = "sidetrack_" + (b.other_kind || "annat");
      if (b.is_mine) add("meSidetrack", { drink: drink }, fresh ? 1 : 0, "tk-me");
      else if (b.friend_name) add(byKind[sk] && Math.random() < 0.5 ? sk : "sidetrack", { name: b.friend_name, drink: drink }, fresh ? 2 : 0, "tk-friend");
      else if (sideAnon < 1) {
        var st = townAt(b.lat, b.lng);
        if (st) { sideAnon++; add("anonSidetrack", { stad: st, anon: pick(anon), drink: drink }, 0); }
      }
    });

    // v10: check-ins (ctx.checkins = live_checkins rows). Friends by name (last 45 min), me, and bars
    // with 2+ check-ins (bar name is fine at 2+; strangers stay anonymous, only a count).
    var cis = ctx.checkins || [], nowMs = now.getTime(), ciFriends = 0, ciBars = {};
    cis.forEach(function (c) {
      if (!c || !c.bar_name) return;
      var at = Date.parse(c.created_at) || 0;
      if (c.is_mine) add("meCheckin", { bar: c.bar_name }, 1, "tk-me");
      else if (c.is_friend && c.name && nowMs - at <= 45 * 60e3 && ciFriends < 2) {
        ciFriends++;
        add("checkin", { name: c.name, bar: c.bar_name }, 2, "tk-friend");
      }
      var key = c.bar_id != null ? ciCanon(c.bar_id) : String(c.bar_name);
      (ciBars[key] = ciBars[key] || { bar: c.bar_name, k: 0, cis: [] }).k++;
      ciBars[key].cis.push(c);
    });
    Object.keys(ciBars).forEach(function (key) { var a = per[key]; ciBars[key].k = ppl(a ? a.beers : [], ciBars[key].cis); });   // fixMo N-10
    Object.keys(ciBars).map(function (k) { return ciBars[k]; })
      .filter(function (x) { return x.k >= 2; })
      .sort(function (a, b) { return b.k - a.k; }).slice(0, 2)
      .forEach(function (x) { add("checkinCrowd", { bar: x.bar, k: x.k }, 1); });

    // v12 KROGARNA (js/barsplus.js): takeovers, queues, offers. Candidates {k, d, imp, cls}.
    try {
      (bp && bp.newsCands ? bp.newsCands(ctx) || [] : []).forEach(function (x) { if (x && x.k) add(x.k, x.d, x.imp, x.cls); });
    } catch (e) {}

    // Bars with 2+ people.
    var cisOfBar = function (a) { var id = a.bar && a.bar.id != null ? ciCanon(a.bar.id) : null; return id ? (ctx.checkins || []).filter(function (c) { return c && c.bar_id != null && ciCanon(c.bar_id) === id; }) : []; };
    bars.forEach(function (a) { a.k = ppl(a.beers, cisOfBar(a)); });   // fixMo N-10: distinct people at the bar
    bars.sort(function (a, b) { return b.k - a.k; }).slice(0, 2).forEach(function (a) {
      add("barReport", { bar: a.bar.name, k: a.k }, 0);
      // Beers per hour at the bar (estimate): each person's beers / hours since their first beer tonight.
      var rate = 0;
      a.beers.forEach(function (b) {
        var h = Math.max(0.75, (now.getTime() - (Date.parse(b.created_at) || now.getTime())) / 3600e3);
        rate += (b.beer_count | 0) / h;
      });
      rate = Math.round(rate);
      if (rate >= 4) add(rate >= 30 ? "barRateHigh" : "barRate", { bar: a.bar.name, r: rate, k: a.k }, rate >= 30 ? 2 : 1);
      var str = a.beers.filter(function (b) { return !b.is_mine && !b.friend_name; })
        .sort(function (x, y) { return (y.beer_count | 0) - (x.beer_count | 0); })[0];
      if (str) add("barStranger", { bar: a.bar.name, n: str.beer_count | 0, anon: pick(anon) }, 0);
    });

    // A stranger with a few beers, in a town (never a place for one person).
    var lone = beers.filter(function (b) { return !b.is_mine && !b.friend_name && !busyBar[b.id] && (b.beer_count | 0) >= 2 && U.level(b.beer_count) === 0; });
    if (lone.length) {
      var lb = pick(lone), lt = townAt(lb.lat, lb.lng);
      if (lt) add("anon", { anon: pick(anon), stad: lt, n: lb.beer_count | 0 }, 0);
    }

    groupTownCands(beers, ctx, now, per, add);

    // Country, local town, forecast, time of day.
    if (snap.total != null && snap.total >= 3) add("total", { n: snap.total }, 0);   // fixM T-14: the header's source, not the pins in view
    var c = ctx.center, stad = (c && townAt(c.lat, c.lng)) || t("newsTown");
    var near = c ? beers.filter(function (b) { return U.haversine(c.lat, c.lng, b.lat, b.lng) <= NEAR_M; }) : beers;
    var hotNear = near.filter(function (b) { return U.level(b.beer_count) > 0; }).length;
    var nearN = c ? snap.n : ppl(beers, ctx.checkins);   // fixMo N-10: distinct people near (pins + check-ins)
    if (nearN < 3 && !hotNear) add("calm", { stad: stad }, beers.length ? 0 : 1, "tk-quiet");
    if (!nearN && c && stad !== t("newsTown")) add("emptyFirst", { stad: stad }, 3, "tk-quiet"); var nh = namesHint(beers, byKind, ctx); if (nh) add("townNames", { n: nh }, 3);   // tickerfix 1: others out (not me)   // tx05: real line first · uxfix P1-5: "N ute – gå med i ett gäng"
    if (nearN >= 1 && (hourNow(now) >= 15 || hourNow(now) < 4)) add("forecast", { stad: stad, n: nearN, p: Math.min(99, nearN * 9 + hotNear * 10) }, 0);
    // Two random "filler" headlines every round: the biggest source of variety.
    add("random", { stad: stad }, 0); add("random", { stad: stad }, 0);
    // tx04: morning 05–11, day 11–17, pre-evening 17–20 (t1 was 05–20: "förfesten har börjat" at breakfast).
    var h = hourNow(now), tk = h >= 5 && h < 11 ? "tMorning" : h >= 11 && h < 17 ? "tDay" : h >= 17 && h < 20 ? "t1" : h >= 20 && h < 23 ? "t2" : h >= 23 || h < 1 ? "t3" : h < 3 ? "t4" : "t5";
    // fixM T-14: no fallback to t1 ("Förfesten pågår") when the morning / day lines are not loaded yet: no time line then
    add(tk, { hh: ("0" + h).slice(-2) }, 0);
    var pn = partsNow(now);
    if (Math.random() < 0.5) add("wd" + pn.wd, { hh: ("0" + h).slice(-2) }, 0);
    if (Math.random() < 0.3) add("mo" + pn.mo, {}, 0);

    // fixM T-14: a gathering line (near.js, kept up to 120 min) only while the group has someone live, and never next to
    // a live count of the same group (groupSameBar / groupTotal from the pins now)
    var liveG = {}, homeG = {}, nowG = {};
    (ctx.home || []).forEach(function (r) { if (r && r.group_name) { homeG[r.group_name] = 1; if (r.live) liveG[r.group_name] = 1; } });
    cand.forEach(function (x) { if ((x.k === "groupSameBar" || x.k === "groupTotal") && x.d && x.d.group) nowG[x.d.group] = 1; });
    cand = cand.filter(function (x) {
      if (x.k !== "groupSquad" && x.k !== "groupSquadNights") return true;
      var g = x.d && x.d.grupp;
      if (x.k === "groupSquad" && g && nowG[g]) return false;
      return homeG[g] ? !!liveG[g] : snap.n > 0;
    });
    // QA #11: the local town for lines that name a place ("stan" when unknown); a stranger's own town wins.
    var here = (c && townAt(c.lat, c.lng)) || "stan";
    cand.forEach(function (x) { if (x.d && x.d.here == null) x.d.here = x.d.stad && x.d.stad !== t("newsTown") ? x.d.stad : here; });
    // Turn candidates into texts. One random template per candidate. Drop duplicates.
    var seen = {}, items = [];
    cand.forEach(function (x) {
      // Prefer templates not used in the last ~60 headlines, then texts not on screen last cycle.
      // tx04: lines not shown tonight first, then lines not shown lately. All shown tonight = a new round for this kind.
      var ids = byKind[x.k].map(function (f, i) { return { f: f, i: i, id: x.k + ":" + i }; });
      var night = usedTonight(now), nu = night.u[x.k] || [];
      if (nu.length >= ids.length) nu = night.u[x.k] = [];
      shuffle(ids);
      ids.forEach(function (o) { o.w = (nu.indexOf(o.i) >= 0 ? 2 : 0) + (recentUsed.indexOf(o.id) >= 0 ? 1 : 0); });
      ids.sort(function (a, b) { return a.w - b.w; });
      var text = "", usedId = null, usedIx = null;
      for (var i = 0; i < ids.length; i++) {
        var tx = "";
        try { tx = String(ids[i].f(x.d)); if (U.n1) tx = U.n1(tx); tx = youFix(tx, x.d); } catch (e) { tx = ""; }   // fixJ T-22: "1 prickar" → "1 prick" · tickerfix 2: "Du" lines in 2nd person
        if (!tx || !tx.trim() || seen[tx] || !localOk(x.k, tx, x.d) || (snap.hdr > 0 && emptyLine(tx))) continue;   // tickerfix 3: never a blank line · tickerfix 4: no "empty map" line (any kind) while the header says N ute
        text = tx; usedId = ids[i].id; usedIx = ids[i].i;
        if (prev.indexOf(tx) < 0) break;
      }
      if (text) text = sentences(text);   // fixM T-14: a sentence never starts with a small letter
      if (!text || seen[text]) return;
      if (usedId) { recentUsed.push(usedId); if (recentUsed.length > 60) recentUsed.shift(); }
      seen[text] = true;
      items.push({ text: text, cls: x.cls, imp: x.imp, k: x.k, d: x.d, old: prev.indexOf(text) >= 0, r: Math.random(), uk: x.k, ui: usedIx });
    });
    // v14 mix (owner): the ticker is MOSTLY about the user's own groups.
    //  group = tk-friend / tk-me items and kinds starting with "group" or "me" → up to ~4 of 6 slots;
    //  town  = things near the user (bars, rates, check-in crowds, chaos, anonymous town lines);
    //  general = random filler, country total, time of day.
    // A quiet group (0–1 items) leaves most slots to town news, then general. No text twice.
    var by = function (a, b) { return b.imp - a.imp || (a.old - b.old) || a.r - b.r; };
    var grp = [], town = [], gen = [];
    items.forEach(function (x) { (catOf(x) === "group" ? grp : catOf(x) === "town" ? town : gen).push(x); });
    grp.sort(by); town.sort(by); gen.sort(function (a, b) { return (a.old - b.old) || a.r - b.r; });
    var out = grp.splice(0, Math.min(grp.length, 4));
    var room = MAX_ITEMS - out.length - (gen.length ? 1 : 0);
    out = out.concat(town.splice(0, Math.max(0, room)));
    [gen, grp, town].forEach(function (list) { while (out.length < MAX_ITEMS && list.length) out.push(list.shift()); });
    out = out.slice(0, MAX_ITEMS);
    shuffle(out);
    // ds40: real events (the gang, the town) first, the jokes after (a stable sort keeps the shuffle inside each part)
    out = out.map(function (x, i) { return { x: x, i: i, g: catOf(x) === "general" ? 1 : 0 }; }).sort(function (a, b) { return a.g - b.g || a.i - b.i; }).map(function (o) { return o.x; });
    var lastText = prev.length ? prev[prev.length - 1] : null;
    if (out.length > 1 && out[0].text === lastText) out.push(out.shift());
    // tx05 (usability): in an empty town the useful real line opens the belt, the jokes come after it.
    for (var ef = 1; ef < out.length; ef++) if (out[ef].k === "emptyFirst" || out[ef].k === "townNames") { out.unshift(out.splice(ef, 1)[0]); break; }
    markShown(now, out);   // tx04: only what is really shown counts as used tonight
    out.forEach(function (x) { if (QUIET[x.k]) { if (++quietN > 400) { quietText = {}; quietN = 0; } quietText[x.text] = QUIET[x.k]; } });   // fixM T-14 (freshBelt)
    return out.map(function (x) { return { text: x.text, cls: (x.cls || "") + (catOf(x) !== "general" ? " tk-real" : ""), k: x.k }; });   // ds40 tk-real = a real event (dot)
  }

  window.NEWS = { build: build, hintN: hintN, emptyLine: emptyLine, update: update, stats: stats, nightKey: nightKey, prevNightKey: prevNightKey,
    freshBelt: freshBelt, snap: function () { return Object.assign({}, snap); }, _areaOk: areaOk, _timeOk: function (t, h) { var o = hourCur; hourCur = h; try { return timeOk(t); } finally { hourCur = o; } },   // fixM T-14
    // last build input (debug / tests): NEWS.build(NEWS.last().beers, NEWS.last().ctx)
    last: function () { return { beers: lastBeers, ctx: lastCtx }; } };
  /* dialect2 (owner 11 Nov): the ticker speaks the dialect of the map area it shows (DIALEKT.tickerArea: the map view, else
     the ticker centre). Only the build runs in that scope; toasts, games and reports keep the phone's region. */
  (function () {
    var b0 = window.NEWS.build;
    window.NEWS.build = function (beers, ctx) {
      var D = window.DIALEKT;
      if (!D || !D.within || !D.tickerArea) return b0(beers, ctx);
      var a = null; try { a = D.tickerArea(ctx && ctx.center ? ctx.center : null); } catch (e) { a = null; }
      return D.within(a, function () { return b0(beers, ctx); });
    };
  })();
})();
