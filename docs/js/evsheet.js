/* Öl Nu — 📅 EVENT-KNAPPEN + EVENT-ARKET 2 (CONTRACT "SPORT + 📅 EVENT-KNAPPEN", "📅 EVENT MÅNAD", "📅 EVENT-ARKET 2").
   One clear way in: a small round 📅 button stacked under 🔥 and 🚕 on the right, with a badge = events tonight.
   The "📅 Event" sheet ("less menus", owner-approved 2026-10-22):
   - ONE segmented control Ikväll · Helgen · 7 dagar · Månad (Månad = events_near3, 31 days, on demand) with a count per segment.
   - ONE scroll row of type chips, only types that have events in the chosen range, each with a count ("🎤 Quiz 3"); "Alla" first.
   - "👥 Vänner går": events my friends / group mates marked Går, with their initials (events_going, migration 0127).
   - "🗺️ Visa på kartan": the filtered events as pins on the main map (js/arenapin.js arena chips, the bar 🎤/🎸 badge, a small
     chip for loose events), the sheet closes; one quiet HUD chip "📅 ✕" turns it off (auto off after 2 h).
   - Rows under sticky day headers: time + countdown, title, place, friends' initials, ONE "Går" toggle per row.
     Går = event_go (server, visible to friends / group mates) + a ⏰ push 1 h before (notify-group v24 "ev_due", the
     reminders cron) + ONE offer "📣 Säg till gruppen?" (event_go_tell once → a group chat line + the normal msg push).
   - All TV matches of a day fold into one row "📺 12 matcher på TV ikväll" that expands.
   - Tap a row → detail view in the same sheet (slides in): title, place, time + countdown, who goes, JAG GÅR, 📍 Visa,
     🎟️ Biljett (ticket_url), 📨 Bjud in (INVITE.openCreate), 🪖 Vi går! (EVENTS.go = create_rally + notify-group rally),
     "📺 Visas på" (SPORT.pubs) for TV matches.
   Data: events_near2(lat, lng, 7) at sign-in, max every 10 min, and when the sheet opens (cache 2 min). Old database
   (no events_near2) → EVENTS' events_near rows (no TV); no event_go → the row toggle is "🪖 Vi går!" as before; no
   events_going → no faces / strip. Deep link ?evs=<id> (the ⏰ push) opens the detail view.
   Hooks (app.js mods): init, onAuthed, onPoll, hudChipsHTML, hudClick, openEvsLink. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, busy = false, cache = { at: 0, key: "", rows: [], v2: false }, pollAt = 0, btnEl = null;
  var FILTER_KEY = "olnu.evsFilter", ASKED_KEY = "olnu.evsAsked";
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(k, a) { var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === lastPick[k]) i = (i + 1) % a.length; lastPick[k] = i; return a[i]; }
  function fill(s, o) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? String(o[k]) : m; }); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* ---------- texts (dalmål + military, ä for é) ---------- */
  var T = {
    title: ["📅 Event", "📅 Events"],
    btn: ["Event", "Events"],
    times: [["tonight", "Ikväll", "Tonight"], ["weekend", "Helgen", "Weekend"], ["week", "7 dagar", "7 days"], ["month", "Månad", "Month"]],
    types: [["all", "Alla", "All"], ["quiz", "🎤 Quiz", "🎤 Quiz"], ["live", "🎸 Live", "🎸 Live"], ["fotboll", "⚽ Fotboll", "⚽ Football"],
      ["hockey", "🏒 Hockey", "🏒 Hockey"], ["tv", "📺 På TV", "📺 On TV"], ["fest", "🎉 Fest", "🎉 Party"]],
    show: ["📍 Visa", "📍 Show"], ticket: ["🎟️ Biljett", "🎟️ Tickets"], inv: ["📨 Bjud in", "📨 Invite"], go: ["🪖 Vi går!", "🪖 We're going!"],
    gar: ["Går", "Going"], garOn: ["✓ Går", "✓ Going"], garBig: ["JAG GÅR", "I'M GOING"], garBigOn: ["✓ JAG GÅR", "✓ I'M GOING"],
    back: ["‹ Tillbaka", "‹ Back"], mapTg: ["🗺️ Visa på kartan", "🗺️ Show on map"],
    tip: ["➕ Tipsa om ett event", "➕ Add an event"],
    friends: ["👥 Vänner går", "👥 Friends going"],
    tvFold: ["📺 {n} matcher på TV {nar}", "📺 {n} matches on TV {nar}"], tvFoldDay: ["📺 {n} matcher på TV", "📺 {n} matches on TV"],
    tvPubs: ["📺 Visas på: {list}", "📺 Showing at: {list}"],
    tvNoPub: ["📺 Ingen krog ä flaggad för sport än. Tryck 👍 i krogens ruta när du ser en storbild!",
      "📺 No pub flagged for sports yet. Tap 👍 in a bar's sheet when you see a big screen!"],
    noPubAct: ["📺 Ingen sportkrog i närheten än. Flagga en med 👍 i krogens ruta.", "📺 No sports pub nearby yet. Flag one with 👍 in a bar's sheet."],
    now: ["pågår nu", "on now"], starting: ["börjar nu", "starting now"],
    inMin: ["om {n} min", "in {n} min"], inH: ["om {n} tim", "in {n} h"], tomorrow: ["i morgon", "tomorrow"], inD: ["om {n} dar", "in {n} days"],
    pending: ["⏳ väntar på godkännande", "⏳ waiting for approval"],
    src: ["Matchdata: stats.swehockey.se · TheSportsDB · Football data provided by the Football-Data.org API",
      "Match data: stats.swehockey.se · TheSportsDB · Football data provided by the Football-Data.org API"],
    nGo: ["{n} går", "{n} going"], nAll: ["{n} går totalt", "{n} going in total"],
    remind: ["⏰ Vi pockar på dig 1 tim innan.", "⏰ We'll remind you 1 h before."],
    // empty states: {vad} = the filter, {nar} = the time
    empty: ["Hä ä tyst som i en kolmila {nar}. Inga {vad} på kartan – tipsa du, så får hela Dalarna veta.",
      "Spaningen hittade inga {vad} {nar}. Antingen ä det lugnt i stan, eller så har ingen berättat.",
      "Inga {vad} {nar}. Dalregementet föreslår egen underhållning: ”vem ä törstigast?”",
      "Kalendern ä tom {nar}. Int' ens en trubadur i sikte. Tipsa om nåt!",
      "Nä du, inga {vad} {nar}. Gå ut ändå – det ä ju så event uppstår.",
      "Radiotystnad på eventfronten {nar}. Högkvarteret väntar på din rapport."],
    emptyEn: ["Nothing here {nar}. Know of something? Add it below!", "No {vad} {nar}. Quiet in town – or nobody told us yet."],
    jumped: ["Ikväll ä det dödtyst, så hä ä helgen istället.", "Ikväll händer inget – spaningen visar helgen.", "Tomt ikväll. Vi hoppade fram till helgen åt dig."],
    jumpedEn: ["Nothing tonight – here's the weekend instead."],
    whenTxt: { tonight: ["ikväll", "tonight"], tomorrow: ["i morron", "tomorrow"], weekend: ["i helgen", "this weekend"], week: ["den här veckan", "this week"], month: ["den närmaste månaden", "this month"] },
    whatTxt: { all: ["event", "events"], quiz: ["quiz", "quizzes"], live: ["livespelningar", "live gigs"], fotboll: ["fotbollsmatcher", "football matches"],
      hockey: ["hockeymatcher", "hockey games"], tv: ["TV-matcher", "TV matches"], fest: ["fester", "parties"] },
    goOk: ["✓ Du går på {titel}. Anteckna i krigsdagboken!", "✓ Anmäld till {titel}. Uppställning {nar}!", "✓ {titel} – du ä på listan. Ingen återvändo nu.",
      "✓ Klart: {titel} {nar}. Ta på dig dom bra byxorna.", "✓ Du går! {titel} {nar}. Truppen ser att du kommer."],
    goOkEn: ["✓ You're going to {titel}."],
    goOff: ["Avanmäld från {titel}. Vi säger inget till nån.", "Okej, du går int' på {titel}. Soffan vinner idag.", "Struken från listan: {titel}."],
    goOffEn: ["Not going to {titel} any more."],
    tellAsk: ["📣 Säg till gruppen?", "📣 Tell your group?"], tellNo: ["Nä tack", "No thanks"],
    tellMsg: ["📅 Jag går på {titel} {nar} ({plats}). Hänger nån mä?", "📅 {titel} {nar} på {plats} – jag ä där. Vem mer?",
      "🪖 Anmäler mig till {titel} {nar}, {plats}. Följ mä!", "📅 Bokat: {titel} {nar} · {plats}. Kom igen nu!",
      "📅 Ska på {titel} {nar} ({plats}). Den som följer mä får en kall."],
    tellMsgEn: ["📅 I'm going to {titel} {nar} ({plats}). Who's in?"],
    tellOk: ["📣 Sagt till {grupp}!", "📣 {grupp} har fått veta. Nu finns ingen ursäkt."], tellOkEn: ["📣 Told {grupp}!"],
    tellDone: ["Gruppen vet redan 👍", "The group already knows 👍"],
    noGroup: ["Du ä int' med i nån grupp än.", "You're not in a group yet."],
    whoNone: ["Ingen i gänget har sagt Går än – bli först!", "Int' en kotte från gänget än. Visa vägen!", "Inga kompisar anmälda. Någon måste ju gå först."],
    whoNoneEn: ["None of your friends is going yet – be the first!"],
    mapOn: ["🗺️ {n} event på kartan. Stäng av mä 📅-knappen eller chipet.", "🗺️ {n} event utplacerade på kartan. Spana!"],
    mapOnEn: ["🗺️ {n} events on the map."],
    mapNone: ["Inga av dom här eventen har en plats på kartan.", "None of these events has a spot on the map."],
    mapChip: ["📅 ✕ {n} på kartan", "📅 ✕ {n} on map"],
    gone: ["🔗 Hittade int' det eventet – det har nog gått ut.", "🔗 Could not find that event – it has probably ended."],
    slow: ["Lugn i leden – vänta en sekund.", "Easy – wait a second."],
    err: ["Nåt gick snett. Försök igen.", "Something went wrong. Try again."]
  };
  var ICON = { quiz: "🎤", karaoke: "🎤", live: "🎸", dj: "🎧", standup: "🎭", party: "🎉", other: "📅", fotboll: "⚽", hockey: "🏒", sport: "🏟️" };

  /* ---------- time ---------- */
  var TZ = "Europe/Stockholm";
  function hhmm(iso) {
    var d = new Date(iso); if (!isFinite(d)) return "";
    try { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d); } catch (e) { return d.toTimeString().slice(0, 5); }
  }
  function dayKey(d) { try { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); } catch (e) { return d.toISOString().slice(0, 10); } }
  // "Evening" day: 00–05 still belongs to the day before (same rule as events.js).
  function eveKey(d) { return dayKey(new Date(d.getTime() - 5 * 3600e3)); }
  function eveDiff(iso) {
    var a = Date.parse(eveKey(new Date(iso)) + "T12:00:00Z"), b = Date.parse(eveKey(new Date()) + "T12:00:00Z");
    return Math.round((a - b) / 864e5);
  }
  function weekday(iso) { return new Date(eveKey(new Date(iso)) + "T12:00:00Z").getUTCDay(); }
  function dayName(iso) {
    try { return new Intl.DateTimeFormat(sv() ? "sv-SE" : "en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric" }).format(new Date(iso)); } catch (e) { return dayKey(new Date(iso)); }
  }
  function endMs(e) { var s = Date.parse(e.starts_at); return e.ends_at ? Date.parse(e.ends_at) : s + (isSport(e) ? 150 : 180) * 60e3; }
  function countdown(e) {
    var s = Date.parse(e.starts_at), now = Date.now(), m = Math.round((s - now) / 60000);
    if (now >= s && now < endMs(e)) return two("now");
    if (Math.abs(m) <= 5) return two("starting");
    var dd = eveDiff(e.starts_at);
    if (dd === 0 || m < 6 * 60) {
      if (m < 60) return fill(two("inMin"), { n: Math.max(1, m) });
      return fill(two("inH"), { n: Math.round(m / 60) });
    }
    if (dd === 1) return two("tomorrow");
    return fill(two("inD"), { n: dd });
  }
  function inTime(e, t) {
    if (Date.now() >= endMs(e)) return false;
    var dd = eveDiff(e.starts_at);
    if (t === "tonight") return dd <= 0;
    if (t === "tomorrow") return dd === 1;
    if (t === "weekend") {
      // the coming Fri / Sat / Sun evenings (today included when it is one of them), within 7 days
      if (dd < 0 || dd > 6) return false;
      var wd = weekday(e.starts_at), today = weekday(new Date().toISOString());
      var toSun = (7 - today) % 7;   // days until Sunday (0 on Sunday)
      return (wd === 5 || wd === 6 || wd === 0) && dd <= toSun;
    }
    if (t === "month") return dd <= 30;
    return dd <= 7;
  }
  // "ikväll 19:00" / "lör 25/10 19:00" (chat line, detail)
  var WD = [["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"], ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]];
  function whenText(iso) {
    var dd = eveDiff(iso);
    if (dd <= 0) return L("ikväll ", "tonight ") + hhmm(iso);
    if (dd === 1) return L("i morgon ", "tomorrow ") + hhmm(iso);
    return headOf(dd, iso).toLowerCase() + " " + hhmm(iso);
  }

  /* ---------- kinds ---------- */
  function sportOf(e) {
    if (e.sport === "hockey" || e.sport === "fotboll") return e.sport;
    if (e.kind !== "sport") return null;
    var t = String(e.title || "") + " " + String(e.league || "");
    if (/hockey|shl|allsvenskan.*hockey|tre kronor|ishall|\bhc\b|\bhf\b/i.test(t)) return "hockey";
    if (/fotboll|allsvensk|superettan|premier|champions|\bfc\b|\bff\b|\bif\b|\bik\b/i.test(t)) return "fotboll";
    return null;
  }
  function isSport(e) { return e.kind === "sport" || !!e.sport; }
  function inType(e, t) {
    if (t === "all") return true;
    if (t === "quiz") return e.kind === "quiz" || e.kind === "karaoke";
    if (t === "live") return e.kind === "live" || e.kind === "standup";
    if (t === "fest") return e.kind === "party" || e.kind === "dj";
    if (t === "tv") return !!e.tv;
    return sportOf(e) === t;
  }
  function icon(e) { return e.tv ? "📺" : ICON[sportOf(e) || ""] || ICON[e.kind] || "📅"; }

  /* ---------- data ---------- */
  function where() {
    var p = null;
    try {
      var me = A.me && A.me();
      if (me && me.lat != null && isFinite(me.lat) && isFinite(me.lng)) p = { lat: +me.lat, lng: +me.lng };
      if (!p && A.lastLoc) { var l = A.lastLoc(); if (l && isFinite(l.lat) && isFinite(l.lng)) p = { lat: +l.lat, lng: +l.lng }; }
      if (!p && A.map) { var c = A.map.getCenter(); p = { lat: c.lat, lng: c.lng }; }
    } catch (e) {}
    if (!p) p = { lat: 60.1496, lng: 15.1878 };
    p.lng = ((((p.lng + 180) % 360) + 360) % 360) - 180; p.lat = Math.max(-85, Math.min(85, p.lat));
    return p;
  }
  function dedupe(rows) {
    // a TV row for a game that is also a local row near me → keep the local row only
    var local = rows.filter(function (e) { return !e.tv && e.home && e.away; });
    return rows.filter(function (e) {
      if (!e.tv || !e.home) return true;
      return !local.some(function (x) { return x.home === e.home && x.away === e.away && Math.abs(Date.parse(x.starts_at) - Date.parse(e.starts_at)) < 15 * 60e3; });
    });
  }
  // 📅 Månad (migration 0111): 31 days from events_near3 only while the sheet shows Månad; else 7 days (events_near2).
  var off3 = false, wantMore = 0;
  function maxDays() { return off ? 7 : off3 ? 14 : 31; }
  function wantDays() { return listBox && st.time === "month" ? 31 : 7; }
  function load(force, days) {
    days = Math.min(days || wantDays(), maxDays());
    if (!A || !A.LIVE || !A.authed || !A.authed()) return Promise.resolve(cache.rows);
    var p = where(), key = (Math.round(p.lat * 20) / 20) + "," + (Math.round(p.lng * 10) / 10);
    if (!force && key === cache.key && (cache.days || 7) >= days && Date.now() - cache.at < 120000) return Promise.resolve(cache.rows);
    if (busy) { wantMore = Math.max(wantMore, days); return Promise.resolve(cache.rows); }
    busy = true;
    var done = function (rows, v2, d) {
      busy = false; cache = { at: Date.now(), key: key, rows: dedupe(rows || []), v2: v2, days: d || 7 }; badge();
      setTimeout(dueCheck, 0);
      var w = Math.min(wantMore, maxDays()); wantMore = 0;
      if (w > cache.days) setTimeout(function () { load(true, w).then(function () { if (listBox && document.body.contains(listBox)) draw(); }); }, 0);
      return cache.rows;
    };
    if (off) return fallback().then(function (rows) { return done(rows, false, 7); });
    var use3 = days > 14 && !off3, pd = use3 ? days : Math.min(days > 7 ? 14 : 7, 14);
    return A.rpc(use3 ? "events_near3" : "events_near2", { p_lat: p.lat, p_lng: p.lng, p_days: pd }).then(function (r) {
      if (r.error) {
        if (U.missing(r.error)) {
          if (use3) { off3 = true; busy = false; return load(true, days); }
          off = true; return fallback().then(function (rows) { return done(rows, false, 7); });
        }
        busy = false; return cache.rows;
      }
      var d = A.parseData(r.data);
      return done(Array.isArray(d.events) ? d.events : [], true, pd);
    });
  }
  function fallback() {
    try { if (window.EVENTS && window.EVENTS._load) return window.EVENTS._load(true, 7).then(function (rows) { return (rows || []).slice(); }); } catch (e) {}
    return Promise.resolve([]);
  }
  function sorted(rows) {
    return rows.slice().sort(function (a, b) {
      var d = Date.parse(a.starts_at) - Date.parse(b.starts_at);
      if (Math.abs(d) >= 60000) return d;
      var ka = a.km == null ? 999 : +a.km, kb = b.km == null ? 999 : +b.km;
      return ka - kb;
    });
  }
  function tonightRows() { return cache.rows.filter(function (e) { return !e.pending && inTime(e, "tonight"); }); }

  /* ---------- 👥 Går (migration 0127: event_go, event_go_tell, events_going) ---------- */
  // gs.by[id] = {mine, n, total, who:[{name, me}], remind, told}; gs.friends = events friends go to (with event fields)
  var gs = { by: {}, friends: [], at: 0, key: "", off: false, goOff: false, busy: false }, dueSent = {};
  function goState(id) { return gs.by[String(id)] || null; }
  function loadGoing(force) {
    if (gs.off || !A || !A.authed || !A.authed()) return Promise.resolve(gs);
    var ids = cache.rows.filter(function (e) { return !e.pending && e.id != null; }).map(function (e) { return +e.id; }).filter(isFinite).slice(0, 400);
    var key = ids.join(",");
    if (!force && key === gs.key && Date.now() - gs.at < 60000) return Promise.resolve(gs);
    if (gs.busy) return Promise.resolve(gs);
    gs.busy = true;
    return A.rpc("events_going", { p_ids: ids, p_days: 31 }).then(function (r) {
      gs.busy = false;
      if (r.error) { if (U.missing(r.error)) gs.off = true; return gs; }
      var d = A.parseData(r.data) || {}, by = {};
      (Array.isArray(d.events) ? d.events : []).forEach(function (x) { if (x && x.id != null) by[String(x.id)] = x; });
      var fr = (Array.isArray(d.friends) ? d.friends : []).filter(function (x) { return x && x.id != null && Date.now() < endMs(x); });
      fr.forEach(function (x) { if (!by[String(x.id)]) by[String(x.id)] = x; });
      // keep my own optimistic states that the server has not seen yet
      Object.keys(gs.by).forEach(function (k) { if (gs.by[k] && gs.by[k]._local && !by[k]) by[k] = gs.by[k]; });
      gs.by = by; gs.friends = fr; gs.at = Date.now(); gs.key = key;
      setTimeout(dueCheck, 0);
      return gs;
    }, function () { gs.busy = false; return gs; });
  }
  function evById(id) {
    id = String(id);
    return cache.rows.filter(function (e) { return String(e.id) === id; })[0] || gs.friends.filter(function (e) { return String(e.id) === id; })[0] || null;
  }
  function initials(name) {
    var w = String(name || "?").trim().split(/\s+/).filter(Boolean);
    var s = w.length > 1 ? w[0].charAt(0) + w[1].charAt(0) : (w[0] || "?").charAt(0);
    return s.toUpperCase();
  }
  function hue(name) { var h = 0, s = String(name || ""); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function facesEl(who, max) {
    var box = A.el("span", { class: "evs-faces", "aria-hidden": "true" });
    (who || []).slice(0, max || 3).forEach(function (p) {
      box.appendChild(A.el("i", { class: "evs-face" + (p.me ? " evs-face-me" : ""), style: "--h:" + hue(p.name), text: p.me ? L("DU", "ME") : initials(p.name) }));
    });
    return box;
  }
  function whoText(s) {
    var who = (s && s.who) || [], names = who.filter(function (p) { return !p.me; }).map(function (p) { return p.name; }), me = who.some(function (p) { return p.me; });
    var more = Math.max(0, ((s && s.n) || 0) - names.length - (me ? 1 : 0));
    if (!names.length && !me) return "";
    var list = names.slice(0, 3);
    if (names.length > 3) more += names.length - 3;
    if (me) list.push(L("du", "you"));
    var txt = list.length === 1 ? list[0] : list.slice(0, -1).join(", ") + L(" och ", " and ") + list[list.length - 1];
    if (more) txt += " +" + more;
    return txt.charAt(0).toUpperCase() + txt.slice(1) + L(" går", list.length === 1 && !me && !more ? " is going" : " are going");
  }
  function canGo(e) { return e && !e.pending && e.id != null; }
  function setGo(e, on, btn) {
    if (!canGo(e)) return;
    if (gs.goOff) { rally(e, btn); return; }
    var id = String(e.id), prev = gs.by[id] ? Object.assign({}, gs.by[id]) : null;
    var cur = Object.assign({ id: e.id, mine: false, n: 0, total: 0, who: [], remind: false, told: false }, prev || {});
    // optimistic: the row and the detail view flip at once
    var myName = (A.getName && A.getName()) || "";
    cur.mine = on; cur._local = true;
    cur.who = (cur.who || []).filter(function (p) { return !p.me; });
    if (on) { cur.who.unshift({ name: myName, me: true }); cur.n = (cur.n || 0) + 1; cur.total = (cur.total || 0) + 1; }
    else { cur.n = Math.max(0, (cur.n || 1) - 1); cur.total = Math.max(0, (cur.total || 1) - 1); }
    gs.by[id] = cur; repaint();
    try { if (window.FX && FX.haptic) FX.haptic(on ? 16 : 8); } catch (x) {}
    A.rpc("event_go", { p_event_id: +e.id, p_on: on }).then(function (r) {
      if (r.error) {
        if (U.missing(r.error)) { gs.goOff = true; if (prev) gs.by[id] = prev; else delete gs.by[id]; repaint(); if (on) rally(e, btn); return; }
        if (prev) gs.by[id] = prev; else delete gs.by[id]; repaint();
        var c = U.errCode(r.error);
        A.toast(c === "slow_down" ? two("slow") : c === "event_not_found" ? two("gone") : two("err"), { err: true });
        return;
      }
      var d = A.parseData(r.data) || {};
      gs.by[id] = Object.assign(d, { id: e.id });
      repaint();
      var o = { titel: String(e.title || "").slice(0, 50), nar: whenText(e.starts_at) };
      if (on) {
        var msg = fill(sv() ? pick("goOk", T.goOk) : T.goOkEn[0], o) + (d.remind ? " " + two("remind") : "");
        if (!d.told && !asked(id)) offerTell(e, msg); else A.toast(msg);
      } else A.toast(fill(sv() ? pick("goOff", T.goOff) : T.goOffEn[0], o));
    });
  }
  function rally(e, btn) {
    if (!window.EVENTS || !window.EVENTS.go) return;
    var pub = e.tv ? (pubsFor()[0] || null) : null, t = e.tv ? (pub ? atPub(e, pub) : null) : e;
    if (!t) { t = {}; for (var k in e) t[k] = e[k]; t.lat = null; t.lng = null; t.place = L("📺 framför TV:n", "📺 in front of the TV"); }
    window.EVENTS.go(t, btn || null);
  }
  /* "📣 Säg till gruppen?" — offered once per event (olnu.evsAsked + the server told_at); a normal chat line + msg push. */
  function asked(id) { var a = lsGet(ASKED_KEY, []); return Array.isArray(a) && a.indexOf(String(id)) >= 0; }
  function markAsked(id) { var a = lsGet(ASKED_KEY, []); if (!Array.isArray(a)) a = []; if (a.indexOf(String(id)) < 0) a.push(String(id)); lsSet(ASKED_KEY, a.slice(-60)); }
  var tellFor = null;   // event id whose inline "Säg till gruppen?" box is open in the detail view
  function offerTell(e, msg) {
    markAsked(e.id);
    if (detailOpen() && String(detailId) === String(e.id)) { A.toast(msg); tellFor = String(e.id); drawDetail(); return; }
    A.toast(msg, { ms: 7000, action: { label: two("tellAsk"), fn: function () { tellPick(e); } } });
  }
  function tellPick(e) {
    A.rpc("my_groups").then(function (r) {
      var groups = Array.isArray(r.data) ? r.data : [];
      if (!groups.length) { A.toast(two("noGroup"), { err: true }); return; }
      if (groups.length === 1) { tell(e, groups[0]); return; }
      tellFor = String(e.id); groupsCache = groups;
      if (listBox && document.body.contains(listBox)) openDetail(e.id); else { open(); setTimeout(function () { openDetail(e.id); }, 50); }
    });
  }
  var groupsCache = null, groupsBusy = false;
  function tell(e, g) {
    tellFor = null;
    A.rpc("event_go_tell", { p_event_id: +e.id }).then(function (r) {
      if (r.error && !U.missing(r.error)) { A.toast(two("err"), { err: true }); return; }
      var d = r.error ? { first: true } : A.parseData(r.data) || {};
      if (d.first === false) { A.toast(two("tellDone")); if (detailOpen()) drawDetail(); return; }
      var st0 = goState(e.id); if (st0) st0.told = true;
      var plats = e.tv ? L("📺 på TV", "📺 on TV") : placeOf(e) || L("stan", "town");
      var text = fill(sv() ? pick("tellMsg", T.tellMsg) : T.tellMsgEn[0], { titel: String(e.title || "").slice(0, 46), nar: whenText(e.starts_at), plats: String(plats).slice(0, 36) });
      if (text.length > 140) text = text.slice(0, 139) + "…";
      A.rpc("post_group_msg", { p_group_id: g.id, p_body: text }).then(function (r2) {
        if (r2.error) { A.toast(U.errCode(r2.error) === "slow_down" ? two("slow") : two("err"), { err: true }); return; }
        try { A.invoke("notify-group", { event: "msg", group_id: g.id }); } catch (x) {}
        A.toast(fill(sv() ? pick("tellOk", T.tellOk) : T.tellOkEn[0], { grupp: g.name }));
        if (detailOpen()) drawDetail();
      });
    });
  }
  // ⏰ fallback: the reminders cron sends the push; an open app asks once when a Går event is 51–69 min away.
  function dueCheck() {
    if (gs.off || gs.goOff || !A || !A.invoke) return;
    var now = Date.now();
    Object.keys(gs.by).forEach(function (k) {
      var s = gs.by[k], e = evById(k); if (!s || !s.mine || !s.remind || !e || dueSent[k]) return;
      var m = (Date.parse(e.starts_at) - now) / 60000;
      if (m > 51 && m < 69) { dueSent[k] = 1; try { A.invoke("notify-group", { event: "ev_due" }); } catch (x) {} }
    });
  }

  /* ---------- 📅 HUD button (stacked under 🔥 and 🚕) ---------- */
  function makeButton() {
    if (btnEl || !document.body) return;
    btnEl = document.createElement("button");
    btnEl.id = "btn-evs"; btnEl.type = "button"; btnEl.className = "locate-btn evs-btn";
    btnEl.setAttribute("aria-label", two("title")); btnEl.title = two("btn");
    btnEl.innerHTML = '<span aria-hidden="true">📅</span><b class="evs-badge" hidden></b>';
    var taxi = document.getElementById("btn-taxi");
    if (taxi && taxi.parentNode) taxi.parentNode.insertBefore(btnEl, taxi.nextSibling); else document.body.appendChild(btnEl);
    btnEl.addEventListener("click", function () { try { if (window.FX && FX.haptic) FX.haptic(10); } catch (e) {} open(); });
    btnEl.hidden = !(A && A.LIVE);
  }
  function badge() {
    if (!btnEl) return;
    var n = tonightRows().length, b = btnEl.querySelector(".evs-badge");
    b.hidden = !n; b.textContent = n > 9 ? "9+" : String(n);
    btnEl.setAttribute("aria-label", two("title") + (n ? " – " + n + " " + L("ikväll", "tonight") : ""));
  }

  /* ---------- the sheet ---------- */
  var st = { time: "tonight", type: "all" };
  try { var saved = JSON.parse(localStorage.getItem(FILTER_KEY) || "null"); if (saved && saved.type) st.type = saved.type; } catch (e) {}
  function save() { try { localStorage.setItem(FILTER_KEY, JSON.stringify({ type: st.type })); } catch (e) {} }
  function two(k) { return L(T[k][0], T[k][1]); }
  var listBox = null, bodyEl = null, segEl = null, chipsEl = null, toolsEl = null, frEl = null, detailEl = null, detailId = null, detailTimer = 0;
  var tvOpen = {}, jumpedOnce = false, jumpNote = "";
  function open() {
    if (!A) return;
    A.openSheet(two("title"), function (body) {
      bodyEl = body; detailEl = null; detailId = null; tvOpen = {};
      body.classList.add("evs-body");
      var bar = A.el("div", { class: "evs-bar" });
      segEl = A.el("div", { class: "ds-seg evs-time", role: "tablist", "aria-label": L("När", "When") });
      T.times.forEach(function (t) {
        var b = A.el("button", { type: "button", role: "tab", "data-t": t[0], "aria-selected": String(st.time === t[0]), onclick: function () {
          setTime(t[0], true);
        } });
        b.appendChild(A.el("span", { class: "evs-seg-l", text: L(t[1], t[2]) }));
        b.appendChild(A.el("b", { class: "evs-seg-n" }));
        segEl.appendChild(b);
      });
      chipsEl = A.el("div", { class: "evs-chips", role: "group", "aria-label": L("Vad", "What") });
      bar.appendChild(segEl); bar.appendChild(chipsEl);
      body.appendChild(bar);
      requestAnimationFrame(function () { stickTop(body, bar); });
      toolsEl = A.el("div", { class: "evs-tools" });
      body.appendChild(toolsEl);
      frEl = A.el("div", { class: "evs-friends", hidden: "" });
      body.appendChild(frEl);
      listBox = A.el("div", { class: "evs-list", "aria-live": "polite" });
      body.appendChild(listBox);
      body.appendChild(A.btn(two("tip"), "ds-btn ds-btn-ghost btn-block evs-tip", function () {
        try { if (window.EVENTS && window.EVENTS.tip) window.EVENTS.tip(null); } catch (e) {}
      }));
      body.appendChild(A.el("p", { class: "evs-src", text: two("src") }));
      draw();
      try { if (window.SPORT && window.SPORT.load) window.SPORT.load(false).then(function () { if (listBox && document.body.contains(listBox)) repaint(); }); } catch (e) {}
      load(false, st.time === "month" ? 31 : 7).then(function () {
        if (!listBox || !document.body.contains(listBox)) return;
        autoJump(); draw();
        loadGoing(false).then(function () { if (listBox && document.body.contains(listBox)) repaint(); });
      });
    }, { onClose: function () { listBox = null; bodyEl = null; detailEl = null; detailId = null; tellFor = null; clearInterval(detailTimer); } });
  }
  function setTime(t, user) {
    st.time = t; shown = 80; jumpNote = user ? "" : jumpNote;
    if (segEl) segEl.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-selected", String(x.getAttribute("data-t") === st.time)); });
    draw();
    try { if (bodyEl) bodyEl.scrollTop = 0; } catch (x) {}
    if (st.time === "month") load(false, 31).then(function () { if (listBox && document.body.contains(listBox)) { draw(); loadGoing(false).then(repaint); } });
  }
  // Research 3.3: never show an empty "Ikväll" first when the weekend / week has something (once per page life).
  function autoJump() {
    if (jumpedOnce || st.time !== "tonight") return;
    jumpedOnce = true;
    var c = function (t) { return cache.rows.filter(function (e) { return inTime(e, t) && inType(e, st.type); }).length; };
    if (c("tonight")) return;
    var to = c("weekend") ? "weekend" : c("week") ? "week" : null;
    if (!to) return;
    jumpNote = sv() ? pick("jumped", T.jumped) : T.jumpedEn[0];
    setTime(to, false);
  }
  function counts() {
    var per = { all: 0 }, tt = { tonight: 0, weekend: 0, week: 0, month: 0 };
    cache.rows.forEach(function (e) {
      T.times.forEach(function (t) { if (inTime(e, t[0])) tt[t[0]]++; });
      if (!inTime(e, st.time)) return;
      per.all++;
      T.types.forEach(function (t) { if (t[0] !== "all" && inType(e, t[0])) per[t[0]] = (per[t[0]] || 0) + 1; });
    });
    return { per: per, tt: tt };
  }
  function drawBar() {
    if (!segEl || !chipsEl) return;
    var c = counts(), full = (cache.days || 7) >= 31 || off3 || off;
    segEl.querySelectorAll("button").forEach(function (b) {
      var k = b.getAttribute("data-t"), n = c.tt[k] || 0, nEl = b.querySelector(".evs-seg-n");
      var known = k !== "month" || full;
      if (nEl) { nEl.textContent = known && n ? (n > 99 ? "99+" : String(n)) : ""; nEl.hidden = !(known && n); }
    });
    chipsEl.innerHTML = "";
    T.types.forEach(function (t) {
      var n = c.per[t[0]] || 0;
      if (t[0] !== "all" && !n && st.type !== t[0]) return;   // only types with events in this range (+ the chosen one)
      var b = A.el("button", { type: "button", class: "ds-chip evs-chip", "data-k": t[0], "aria-pressed": String(st.type === t[0]), onclick: function () {
        st.type = t[0]; save(); draw();
      } });
      b.appendChild(A.el("span", { class: "evs-chip-l", text: L(t[1], t[2]) }));
      if (n) b.appendChild(A.el("b", { class: "evs-chip-n", text: String(n) }));
      chipsEl.appendChild(b);
    });
  }
  function filtered() { return sorted(cache.rows.filter(function (e) { return inTime(e, st.time) && inType(e, st.type); })); }
  function drawTools(all) {
    if (!toolsEl) return;
    toolsEl.innerHTML = "";
    var txt = A.el("span", { class: "evs-sum", text: jumpNote || (all.length ? fill(L("{n} event", "{n} events"), { n: all.length }) : "") });
    toolsEl.appendChild(txt);
    var onMap = !!mapFocus();
    var pinable = all.filter(hasSpot).length;
    var tg = A.el("button", { type: "button", class: "evs-maptg", role: "switch", "aria-checked": String(onMap), onclick: function () { toggleMap(); } });
    tg.appendChild(A.el("span", { text: two("mapTg") }));
    tg.appendChild(A.el("i", { class: "evs-sw", "aria-hidden": "true" }));
    if (!pinable && !onMap) tg.disabled = true;
    toolsEl.appendChild(tg);
  }
  function drawFriends() {
    if (!frEl) return;
    var fr = gs.friends.filter(function (e) { var s = goState(e.id) || e; return s && (s.who || []).some(function (p) { return !p.me; }); });
    frEl.innerHTML = "";
    frEl.hidden = !fr.length;
    if (!fr.length) return;
    frEl.appendChild(A.el("div", { class: "evs-fr-h", text: two("friends") }));
    var row = A.el("div", { class: "evs-fr-row" });
    fr.slice(0, 10).forEach(function (e) {
      var s = goState(e.id) || e;
      var c = A.el("button", { type: "button", class: "evs-frc" + (s.mine ? " evs-frc-me" : ""), "data-evs": String(e.id), onclick: function () { openDetail(e.id); } });
      var top = A.el("span", { class: "evs-frc-top" });
      top.appendChild(facesEl((s.who || []).filter(function (p) { return !p.me; }), 3));
      var others = (s.who || []).filter(function (p) { return !p.me; }).length;
      top.appendChild(A.el("b", { class: "evs-frc-n", text: String(Math.max(others, (s.n || 0) - (s.mine ? 1 : 0))) }));
      c.appendChild(top);
      c.appendChild(A.el("b", { class: "evs-frc-t", text: icon(e) + " " + String(e.title || "") }));
      c.appendChild(A.el("span", { class: "evs-frc-s", text: [whenText(e.starts_at), e.tv ? "" : placeOf(e)].filter(Boolean).join(" · ") }));
      row.appendChild(c);
    });
    frEl.appendChild(row);
  }
  function draw() {
    if (!listBox) return;
    drawBar();
    listBox.innerHTML = "";
    var all = filtered();
    drawTools(all); drawFriends();
    var rows = all.slice(0, shown);
    if (!rows.length) {
      var w = T.whenTxt[st.time], v = T.whatTxt[st.type] || T.whatTxt.all;
      listBox.appendChild(A.el("p", { class: "ds-empty evs-empty", text: fill(sv() ? pick("empty", T.empty) : pick("emptyEn", T.emptyEn), { nar: L(w[0], w[1]), vad: L(v[0], v[1]) }) }));
      return;
    }
    // Sticky day headers ("Ikväll", "I morgon", "Lör 25/10") with the number of rows that day; TV matches of a day fold into one row.
    var gk = function (e) { return eveDiff(e.starts_at) <= 0 ? "now" : eveKey(new Date(e.starts_at)); };
    var groups = [], by = {};
    rows.forEach(function (e) { var k = gk(e); if (!by[k]) { by[k] = { k: k, iso: e.starts_at, rows: [] }; groups.push(by[k]); } by[k].rows.push(e); });
    var per = {}; all.forEach(function (e) { var k = gk(e); per[k] = (per[k] || 0) + 1; });
    groups.forEach(function (g) {
      var h = A.el("div", { class: "evs-day" + (g.k === "now" ? " evs-day-now" : ""), role: "heading", "aria-level": "3", "data-day": g.k });
      h.appendChild(A.el("span", { text: headOf(eveDiff(g.iso), g.iso) }));
      h.appendChild(A.el("b", { class: "evs-day-n", text: String(per[g.k] || "") }));
      listBox.appendChild(h);
      var tv = st.type === "tv" ? [] : g.rows.filter(function (e) { return e.tv; });
      var fold = tv.length >= 2;
      g.rows.forEach(function (e) { if (!fold || !e.tv) listBox.appendChild(rowEl(e)); });
      if (fold) listBox.appendChild(tvFoldEl(g, tv));
    });
    if (all.length > rows.length) listBox.appendChild(A.btn(fill(L("Visa fler ({n} till)", "Show more ({n} more)"), { n: all.length - rows.length }),
      "ds-btn ds-btn-secondary btn-block evs-more", function () { shown += 80; draw(); }));
  }
  function repaint() {
    if (detailOpen()) drawDetail();
    if (listBox && document.body.contains(listBox)) {
      var y = bodyEl ? bodyEl.scrollTop : 0;
      draw();
      try { if (bodyEl) bodyEl.scrollTop = y; } catch (e) {}
    }
  }
  var shown = 80;
  function headOf(dd, iso) {
    if (dd <= 0) return L("Ikväll", "Tonight");
    if (dd === 1) return L("I morgon", "Tomorrow");
    if (!iso) return "d" + dd;
    var d = new Date(eveKey(new Date(iso)) + "T12:00:00Z");
    return WD[sv() ? 0 : 1][d.getUTCDay()] + " " + d.getUTCDate() + "/" + (d.getUTCMonth() + 1);
  }
  // The sticky day headers sit right under the sticky chip bar.
  function stickTop(body, bar) {
    try { var h = bar.getBoundingClientRect().height; if (h) body.style.setProperty("--evs-bar-h", Math.round(h) + "px"); } catch (e) {}
  }
  function refreshPubs() { repaint(); }

  function pubsFor() { try { return window.SPORT && window.SPORT.pubs ? window.SPORT.pubs(null, null, 6) : []; } catch (e) { return []; } }
  function placeOf(e) {
    var b = null; try { b = e.bar_id && window.BARS && window.BARS.byId(e.bar_id); } catch (x) {}
    return (b && b.name) || e.place || e.town || "";
  }
  function hasSpot(e) { return e && e.lat != null && e.lng != null && isFinite(e.lat) && isFinite(e.lng) && !e.tv; }
  // TV match at a pub → an event-like object with the pub's place (for 📨 / 🪖)
  function atPub(e, pub) {
    var o = {}; for (var k in e) o[k] = e[k];
    o.lat = pub.lat; o.lng = pub.lng; o.bar_id = pub.id; o.place = String(pub.name || "").slice(0, 60);
    o.title = String(e.title || "").slice(0, 70);
    return o;
  }
  function garBtn(e, big) {
    var s = goState(e.id), on = !!(s && s.mine);
    var lbl = gs.goOff ? (big ? two("go") : "🪖") : big ? (on ? two("garBigOn") : two("garBig")) : (on ? two("garOn") : two("gar"));
    var b = A.el("button", { type: "button", class: (big ? "ds-btn ds-btn-primary evs-dgar" : "evs-gar") + (on ? " evs-on" : ""),
      "aria-pressed": String(on), "aria-label": (on ? two("garOn") : two("gar")) + ": " + String(e.title || ""), text: lbl,
      onclick: function (ev) { ev.stopPropagation(); if (gs.goOff) { rally(e, ev.currentTarget); return; } setGo(e, !on, ev.currentTarget); } });
    return b;
  }
  function rowEl(e) {
    var tv = !!e.tv, place = placeOf(e), s = goState(e.id);
    var card = A.el("div", { class: "ds-card evs-row" + (tv ? " evs-tv" : "") + (e.pending ? " evs-pending" : "") + (s && s.mine ? " evs-going" : ""),
      "data-evs": String(e.id), role: "button", tabindex: "0", "aria-label": String(e.title || "") + ", " + whenText(e.starts_at) });
    var open1 = function (ev) { if (ev.target && ev.target.closest && ev.target.closest(".evs-gar")) return; openDetail(e.id); };
    card.addEventListener("click", open1);
    card.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openDetail(e.id); } });
    var when = A.el("div", { class: "evs-when" });
    when.appendChild(A.el("b", { class: "evs-hh", text: hhmm(e.starts_at) }));   // the day is in the sticky header
    when.appendChild(A.el("span", { class: "evs-cd", text: countdown(e) }));
    card.appendChild(when);
    var txt = A.el("div", { class: "evs-txt" });
    var tl = A.el("span", { class: "evs-tl" });
    tl.appendChild(A.el("span", { class: "evs-ic", "aria-hidden": "true", text: icon(e) }));
    tl.appendChild(A.el("b", { class: "evs-t", text: String(e.title || "") }));
    txt.appendChild(tl);
    var sub = [];
    if (e.league) sub.push(e.league);
    if (!tv && place) sub.push(place);
    if (!tv && e.km != null && e.km > 1.5) sub.push(String(e.km).replace(".", ",") + " km");
    if (tv) { var ps = pubsFor(); sub.push(ps.length ? fill(two("tvPubs"), { list: ps.slice(0, 2).map(function (p) { return p.name; }).join(", ") + (ps.length > 2 ? " +" + (ps.length - 2) : "") }) : L("📺 på TV", "📺 on TV")); }
    if (e.pending) sub.push(two("pending"));
    if (sub.length) txt.appendChild(A.el("span", { class: "evs-sub", text: sub.join(" · ") }));
    if (s && (s.n || s.total)) {
      var fr = A.el("span", { class: "evs-fr" });
      var others = (s.who || []).filter(function (p) { return !p.me; });
      if (others.length) fr.appendChild(facesEl(others, 3));
      fr.appendChild(A.el("span", { text: fill(two("nGo"), { n: Math.max(s.total || 0, s.n || 0) }) }));
      txt.appendChild(fr);
    }
    card.appendChild(txt);
    if (canGo(e) && (!gs.goOff || window.EVENTS)) card.appendChild(garBtn(e, false));
    return card;
  }
  function tvFoldEl(g, tv) {
    var openNow = !!tvOpen[g.k];
    var box = A.el("div", { class: "evs-tvfold" + (openNow ? " evs-open" : "") });
    var nar = g.k === "now" ? L("ikväll", "tonight") : "";
    var lbl = nar ? fill(two("tvFold"), { n: tv.length, nar: nar }) : fill(two("tvFoldDay"), { n: tv.length });
    var mine = tv.filter(function (e) { var s = goState(e.id); return s && s.mine; }).length;
    var head = A.el("button", { type: "button", class: "ds-card evs-tvh", "aria-expanded": String(openNow), onclick: function () { tvOpen[g.k] = !tvOpen[g.k]; repaint(); } });
    head.appendChild(A.el("b", { class: "evs-tvh-t", text: lbl }));
    head.appendChild(A.el("span", { class: "evs-tvh-s", text: (mine ? "✓ " + mine + " · " : "") + tv.slice(0, 2).map(function (e) { return hhmm(e.starts_at); }).join(", ") + (tv.length > 2 ? "…" : "") }));
    head.appendChild(A.el("i", { class: "evs-chev", "aria-hidden": "true", text: "▾" }));
    box.appendChild(head);
    if (openNow) {
      var inner = A.el("div", { class: "evs-tvlist" });
      tv.forEach(function (e) { inner.appendChild(rowEl(e)); });
      box.appendChild(inner);
    }
    return box;
  }

  /* ---------- detail view (same sheet, slides in) ---------- */
  function detailOpen() { return !!(detailEl && bodyEl && document.body.contains(detailEl)); }
  function openDetail(id) {
    var e = evById(id);
    if (!e) { A.toast(two("gone"), { err: true }); return false; }
    if (!bodyEl || !document.body.contains(bodyEl)) { open(); }
    if (!bodyEl) return false;
    detailId = String(e.id);
    if (!detailEl || !document.body.contains(detailEl)) {
      detailEl = A.el("div", { class: "evs-detail", role: "region", "aria-label": String(e.title || "") });
      bodyEl.appendChild(detailEl);
    }
    bodyEl.classList.add("evs-in-detail");
    try { bodyEl.scrollTop = 0; } catch (x) {}
    drawDetail();
    clearInterval(detailTimer);
    detailTimer = setInterval(function () { if (!detailOpen()) { clearInterval(detailTimer); return; } var c = detailEl.querySelector(".evs-d-cd"), ev = evById(detailId); if (c && ev) c.textContent = countdown(ev); }, 30000);
    if (!gs.off && Date.now() - gs.at > 60000) loadGoing(false).then(function () { if (detailOpen()) drawDetail(); });
    return true;
  }
  function closeDetail() {
    clearInterval(detailTimer); tellFor = null;
    if (detailEl && detailEl.parentNode) detailEl.parentNode.removeChild(detailEl);
    detailEl = null; detailId = null;
    if (bodyEl) bodyEl.classList.remove("evs-in-detail");
    repaint();
  }
  function drawDetail() {
    if (!detailEl) return;
    var e = evById(detailId); if (!e) { closeDetail(); return; }
    var s = goState(e.id), tv = !!e.tv, pubs = tv ? pubsFor() : [], pub = tv ? pubs[0] || null : null, place = placeOf(e);
    detailEl.innerHTML = "";
    detailEl.appendChild(A.btn(two("back"), "ds-btn ds-btn-ghost evs-back", closeDetail));
    var hd = A.el("div", { class: "evs-d-head" });
    hd.appendChild(A.el("span", { class: "evs-d-ic", "aria-hidden": "true", text: icon(e) }));
    var ht = A.el("div", { class: "evs-d-ht" });
    ht.appendChild(A.el("div", { class: "evs-d-t", role: "heading", "aria-level": "3", text: String(e.title || "") }));
    if (e.league) ht.appendChild(A.el("span", { class: "evs-d-lg", text: e.league }));
    hd.appendChild(ht);
    detailEl.appendChild(hd);
    var facts = A.el("div", { class: "evs-d-facts" });
    var tline = A.el("p", { class: "evs-d-when" });
    tline.appendChild(A.el("b", { text: (eveDiff(e.starts_at) <= 0 ? L("Ikväll", "Tonight") : eveDiff(e.starts_at) === 1 ? L("I morgon", "Tomorrow") : headOf(eveDiff(e.starts_at), e.starts_at)) + " " + hhmm(e.starts_at) }));
    tline.appendChild(A.el("span", { class: "evs-d-cd", text: countdown(e) }));
    facts.appendChild(tline);
    if (!tv && (place || e.km != null)) facts.appendChild(A.el("p", { class: "evs-d-pl", text: "📍 " + [place, e.km != null ? String(e.km).replace(".", ",") + " km" : ""].filter(Boolean).join(" · ") }));
    if (tv) {
      var pl = A.el("div", { class: "evs-d-pubs" });
      if (pubs.length) {
        pl.appendChild(A.el("span", { class: "evs-d-pubs-l", text: L("📺 Visas på:", "📺 Showing at:") }));
        pubs.slice(0, 5).forEach(function (p) { pl.appendChild(A.btn(p.name + (p.km != null ? " · " + String(Math.round(p.km * 10) / 10).replace(".", ",") + " km" : ""), "ds-chip evs-pub", function () { show(e, p); })); });
      } else pl.appendChild(A.el("p", { class: "evs-nopub", text: two("tvNoPub") }));
      facts.appendChild(pl);
    }
    if (e.pending) facts.appendChild(A.el("p", { class: "evs-d-pend", text: two("pending") }));
    detailEl.appendChild(facts);
    // who goes
    if (!gs.off && canGo(e)) {
      var who = A.el("div", { class: "evs-d-who" });
      var wt = whoText(s);
      if (s && (s.who || []).length) who.appendChild(facesEl(s.who, 6));
      who.appendChild(A.el("span", { class: "evs-d-wt", text: wt || (sv() ? pick("whoNone", T.whoNone) : T.whoNoneEn[0]) }));
      if (s && s.total && s.total > (s.n || 0)) who.appendChild(A.el("span", { class: "evs-d-tot", text: fill(two("nAll"), { n: s.total }) }));
      detailEl.appendChild(who);
    }
    if (canGo(e)) {
      detailEl.appendChild(garBtn(e, true));
      if (s && s.mine && s.remind) detailEl.appendChild(A.el("p", { class: "evs-d-rem", text: two("remind") }));
    }
    if (tellFor === String(e.id) && s && s.mine && !s.told) detailEl.appendChild(tellBox(e));
    var acts = A.el("div", { class: "evs-d-acts" });
    acts.appendChild(A.btn(two("show"), "ds-btn ds-btn-secondary evs-show", function () { show(e, pub); }));
    if (e.ticket_url && /^https:\/\//.test(e.ticket_url)) acts.appendChild(A.el("a", { class: "ds-btn ds-btn-secondary evs-tk", href: e.ticket_url, target: "_blank", rel: "noopener nofollow", text: two("ticket") }));
    if (!e.pending && window.INVITE && window.INVITE.openCreate && (!tv || pub)) {
      var target = tv ? atPub(e, pub) : e;
      acts.appendChild(A.btn(two("inv"), "ds-btn ds-btn-secondary evs-inv", function () {
        try { window.INVITE.openCreate({ event: target, bar: pub ? pub.bar || { id: pub.id, name: pub.name, lat: pub.lat, lng: pub.lng } : undefined }); } catch (x) {}
      }));
    }
    if (!e.pending && window.EVENTS && window.EVENTS.go && !gs.goOff) acts.appendChild(A.btn(two("go"), "ds-btn ds-btn-secondary evs-go", function (ev) { rally(e, ev.currentTarget); }));
    detailEl.appendChild(acts);
  }
  function tellBox(e) {
    var box = A.el("div", { class: "evs-tell" });
    box.appendChild(A.el("b", { text: two("tellAsk") }));
    var row = A.el("div", { class: "evs-tell-row" });
    box.appendChild(row);
    var fillRow = function (groups) {
      row.innerHTML = "";
      groups.slice(0, 6).forEach(function (g) { row.appendChild(A.btn("👥 " + g.name, "ds-chip evs-tell-g", function () { tell(e, g); })); });
      row.appendChild(A.btn(two("tellNo"), "ds-chip evs-tell-no", function () { tellFor = null; drawDetail(); }));
    };
    if (groupsCache) fillRow(groupsCache);
    else if (!groupsBusy) {
      groupsBusy = true;
      A.rpc("my_groups").then(function (r) {
        groupsBusy = false;
        groupsCache = Array.isArray(r.data) ? r.data : [];
        if (!groupsCache.length) { tellFor = null; A.toast(two("noGroup"), { err: true }); }
        if (detailOpen()) drawDetail();
      }, function () { groupsBusy = false; });
    }
    return box;
  }
  function show(e, pub) {
    var lat = e.lat, lng = e.lng, bar = null;
    if (e.tv) {
      if (!pub) { A.toast(two("noPubAct")); return; }
      lat = pub.lat; lng = pub.lng; bar = pub.bar;
      if (!bar) { try { bar = window.BARS.byId(pub.id); } catch (x) {} }
    } else { try { bar = e.bar_id && window.BARS.byId(e.bar_id); } catch (x) {} }
    A.closeSheet();
    if (bar && A.openBar) { try { A.openBar(bar); return; } catch (x) {} }
    if (lat != null && isFinite(lat)) A.flyTo(lat, lng, 16);
  }

  /* ---------- 🗺️ Visa på kartan (js/arenapin.js draws: arena chips, bar badges, loose chips) ---------- */
  var focus = null;   // {ids: {id: 1}, n, until}
  function mapFocus() {
    if (focus && Date.now() > focus.until) { focus = null; mapRedraw(); }
    return focus;
  }
  function mapRedraw() {
    try { if (A && A.render) A.render(); } catch (e) {}
    try { if (window.ARENAPIN && window.ARENAPIN._draw) window.ARENAPIN._draw(true); } catch (e) {}
    try { if (A && A.updateCounts) A.updateCounts(); } catch (e) {}
  }
  function toggleMap() {
    if (mapFocus()) { focus = null; mapRedraw(); if (listBox) draw(); return; }
    var list = filtered().filter(function (e) { return hasSpot(e) && !e.pending; });
    if (!list.length) { A.toast(two("mapNone")); return; }
    var ids = {}; list.forEach(function (e) { ids[String(e.id)] = 1; });
    focus = { ids: ids, n: list.length, until: Date.now() + 2 * 3600e3 };
    A.closeSheet();
    mapRedraw();
    try {
      var map = A.map, pts = list.map(function (e) { return [+e.lat, +e.lng]; });
      if (map && window.L) {
        if (pts.length === 1) map.flyTo(pts[0], Math.max(map.getZoom(), 15), { duration: 0.8 });
        else map.flyToBounds(window.L.latLngBounds(pts).pad(0.15), { maxZoom: 15, duration: 0.8, paddingTopLeft: [24, 90], paddingBottomRight: [24, 150] });
        map.once("moveend", function () { mapRedraw(); });
      }
    } catch (e) {}
    A.toast(fill(sv() ? pick("mapOn", T.mapOn) : T.mapOnEn[0], { n: list.length }));
  }

  /* ---------- deep link ?evs=<id> (the ⏰ push) ---------- */
  var linkId = null;
  try {
    var q0 = new URLSearchParams(location.search), l0 = q0.get("evs");
    if (l0 && /^\d{1,15}$/.test(l0)) {
      linkId = l0; q0.delete("evs");
      var s0 = q0.toString(); history.replaceState(null, "", location.pathname + (s0 ? "?" + s0 : "") + location.hash);
    }
  } catch (e) {}
  function openLink(id) {
    if (!/^\d{1,15}$/.test(String(id || ""))) return;
    var tries = 0;
    (function step() {
      if (!A || !A.authed || !A.authed()) { if (tries++ < 60) setTimeout(step, 500); return; }
      load(false, 31).then(function () { return loadGoing(true); }).then(function () {
        var e = evById(id);
        if (!e) { A.toast(two("gone"), { err: true }); return; }
        var t = inTime(e, "tonight") ? "tonight" : inTime(e, "week") ? "week" : "month";
        st.time = t;
        open();
        setTimeout(function () { openDetail(id); }, 30);
      });
    })();
  }

  window.EVSHEET = {
    init: function (api) {
      A = api;
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", makeButton); else makeButton();
    },
    onAuthed: function () {
      makeButton(); if (btnEl) btnEl.hidden = !(A && A.LIVE); pollAt = Date.now();
      load(true).then(function () { return loadGoing(true); }).then(dueCheck);
      if (linkId) { var l = linkId; linkId = null; openLink(l); }
    },
    onPoll: function () {
      dueCheck();
      if (Date.now() - pollAt < 10 * 60000) return; pollAt = Date.now();
      load(true).then(function () { return loadGoing(true); }).then(dueCheck);
    },
    hudChipsHTML: function () {
      var f = mapFocus(); if (!f) return "";
      var t = fill(two("mapChip"), { n: f.n });
      return '<button type="button" class="hx-chip evs-mapchip" data-hx="evsmap" aria-label="' + U.esc(L("Ta bort eventen från kartan", "Remove the events from the map")) + '">' + U.esc(t) + "</button>";
    },
    hudClick: function (action) { if (action === "evsmap") { focus = null; mapRedraw(); } },
    openEvsLink: function (id) { openLink(id); },
    open: open, openDetail: function (id) { if (!listBox) open(); return openDetail(id); }, refreshPubs: refreshPubs,
    // js/arenapin.js: the events chosen with "🗺️ Visa på kartan" ({ids, n, until} or null)
    mapFocus: mapFocus,
    // tests / other modules
    _cache: function () { return cache; }, _load: load, _inTime: inTime, _countdown: countdown, T: T, _dayName: dayName,
    _setTime: function (t) { st.time = t; shown = 80; draw(); }, _head: headOf, _going: function () { return gs; }, _loadGoing: loadGoing,
    _setFocus: function (f) { focus = f; mapRedraw(); }
  };
})();
