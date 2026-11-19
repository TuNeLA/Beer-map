/* PintsNow — Öppen ikväll (P-088, lane dating2): the pure rules of the client. No DOM, no network.
   Loaded lazily with dating-core.js (beta channel only, see dating.js) and by tests/unit/dating.test.mjs (node).
   - screen(state, local): which screen the server state means for this phone (the reveal state machine).
   - score(type, answers, round): "Ni tänker lika: x av y" from the answers both can see.
   - filter(text): the same chat filter as the server (olnu_oi_filter in 0530), for a hint before sending.
   - nightEnd(now): the next 06:00 Europe/Stockholm (owner A32: night rows expire then); untilText for the hint.
   - items(type): items per round (A D E 4, B 3, C 3), the same numbers as the server.
   - endText(pair, on): the ONE neutral text the other side of a no / Stopp / block / report / timeout sees.
   Nothing here knows a count of open people, a place or a distance: the server never sends them. */
(function (root) {
  "use strict";
  var ITEMS = { A: 4, B: 3, C: 3, D: 4, E: 4 };
  function items(t) { return ITEMS[t] || 4; }

  // the round plan entry {t, q} of round r (1..3)
  function planOf(pair, r) { var p = pair && pair.plan; return p && p[(r || pair.round) - 1] || null; }
  function ans(pair, r, i) { var a = pair && pair.answers; return (a && a[r + "." + i]) || {}; }
  function myCount(pair, r) { var n = 0, t = planOf(pair, r); if (!t) return 0; for (var i = 0; i < items(t.t); i++) if (ans(pair, r, i).me != null) n++; return n; }

  /* screen(state, local) → { name, ... }
     local = { seenStep: highest reveal the user has looked at, codeSeen: bool, ended: id already shown }
     names: off | open | notice | waitOffer | play | waitThem | decide | waitStep | reveal | chat | code | ended */
  function screen(st, local) {
    local = local || {};
    var p = st && st.pair;
    if (!p) return { name: st && st.on ? "open" : "off" };
    if (p.state === "ended" || p.ended) return { name: "ended", phase: p.phase === "game" ? "game" : "offer", id: p.id, seen: local.ended === p.id };
    if (p.state === "offered") return p.mine === true ? { name: "waitOffer", left: p.left_s | 0 } : { name: "notice", left: p.left_s | 0 };
    var seen = local.seenStep | 0;
    if ((p.step | 0) > seen) return { name: "reveal", step: p.step | 0 };
    if (p.state === "chat") return p.meet && p.meet.code ? (local.codeSeen ? { name: "chat", code: p.meet.code } : { name: "code", code: p.meet.code }) : { name: "chat" };
    var t = planOf(p, p.round);
    if (!t) return { name: "play", round: p.round | 0, item: 0 };
    var n = items(t.t), mine = myCount(p, p.round);
    if (mine < n) {
      // B: the guess (item 2) needs the other's three lines first
      if (t.t === "B" && mine === 2 && !ans(p, p.round, 0).them) return { name: "waitThem", round: p.round, item: 2 };
      return { name: "play", round: p.round, item: nextItem(p, p.round, n), type: t.t };
    }
    if (!p.complete) return { name: "waitThem", round: p.round };
    if ((p.my_step | 0) >= (p.round | 0)) return { name: "waitStep", round: p.round };
    return { name: "decide", round: p.round, step: p.round };
  }
  function nextItem(p, r, n) { for (var i = 0; i < n; i++) if (ans(p, r, i).me == null) return i; return n; }

  /* score: [hits, of] for one round, from the answers both see.  A D: same choice (skip = not counted).
     E: my guess (2nd letter) about them = their own answer (1st letter), both ways.  B: the guessed line = the lie, both ways.
     C: the guessed glass = their glass, both ways. */
  function score(pair, r) {
    var t = planOf(pair, r); if (!t) return [0, 0];
    var hit = 0, of = 0, i, a, b, c;
    if (t.t === "A" || t.t === "D") {
      for (i = 0; i < items(t.t); i++) { a = ans(pair, r, i); if (a.me && a.them && a.me !== "s" && a.them !== "s") { of++; if (a.me === a.them) hit++; } }
    } else if (t.t === "E") {
      for (i = 0; i < 4; i++) {
        a = ans(pair, r, i); if (!a.me || !a.them || a.me === "s" || a.them === "s") continue;
        of += 2; if (a.me.charAt(1) === a.them.charAt(0)) hit++; if (a.them.charAt(1) === a.me.charAt(0)) hit++;
      }
    } else if (t.t === "B") {
      a = ans(pair, r, 1); b = ans(pair, r, 2);
      if (a.them != null && b.me != null) { of++; if (b.me === a.them) hit++; }
      if (a.me != null && b.them != null) { of++; if (b.them === a.me) hit++; }
    } else if (t.t === "C") {
      a = ans(pair, r, 0); c = ans(pair, r, 1);
      if (a.them != null && c.me != null) { of++; if (c.me === a.them) hit++; }
      if (a.me != null && c.them != null) { of++; if (c.them === a.me) hit++; }
    }
    return [hit, of];
  }

  // the same rules as olnu_oi_filter (0530): 'ok' | phone | mail | link | handle | word
  var RX = {
    phoneShape: /\d[\d\s().+\/-]{5,}\d/,
    mail: /[^\s@]+@[^\s@]+\.[a-z]{2,}/,
    link: /(https?:|www\.|(^|[^a-z0-9])[a-z0-9-]+\.(se|com|nu|net|org|io|me|app|ly|gg|tv|link|xyz)($|[^a-z0-9]))/,
    handle: /(^|[^a-z0-9])@[a-z0-9_.]{2,}/,
    apps: /(^|[^a-zåäö0-9])(snapchat|instagram|insta|whatsapp|telegram|kik|onlyfans|swish)($|[^a-zåäö0-9])/,
    word: /(^|[^a-zåäö0-9])(knulla|knull|kuk|fitta|hora|horor|slyna|nudes|nakenbild|nakenbilder|sexa|ligga med|runka|porr|cp)($|[^a-zåäö0-9])/
  };
  function filter(text) {
    var v = String(text == null ? "" : text).toLowerCase();
    if (v.replace(/[^0-9]/g, "").length >= 7 && RX.phoneShape.test(v)) return "phone";
    if (RX.mail.test(v)) return "mail";
    if (RX.link.test(v)) return "link";
    if (RX.handle.test(v) || RX.apps.test(v)) return "handle";
    if (RX.word.test(v)) return "word";
    return "ok";
  }

  // next 06:00 in Europe/Stockholm after `now` (ms). Uses Intl to read the Stockholm wall clock (DST safe).
  function stockholmParts(ms) {
    try {
      var f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
      var o = {}; f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = +p.value; });
      return o;
    } catch (e) { var d = new Date(ms); return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() }; }
  }
  function offsetAt(ms) {   // Stockholm wall clock − UTC, in ms, at the moment ms
    var p = stockholmParts(ms);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  }
  // 06:00 Stockholm on the Stockholm calendar day of `ms`, as UTC ms (the offset is taken AT 06:00: DST safe)
  function sixOf(ms) {
    var p = stockholmParts(ms), guess = Date.UTC(p.year, p.month - 1, p.day, 6, 0, 0);
    var t = guess - offsetAt(guess - offsetAt(ms));
    return guess - offsetAt(t);
  }
  function nightEnd(now) {
    now = now == null ? Date.now() : now;
    var t = sixOf(now);
    return t > now ? t : sixOf(now + 24 * 3600e3);
  }
  // is a stored "on tonight" record still valid?
  function stillOn(rec, now) { now = now == null ? Date.now() : now; return !!(rec && rec.until && now < rec.until && rec.until <= nightEnd(now)); }

  // the ONE neutral end text key: the same for a no, a timeout, Stopp, block, report, check-out (DESIGN §2 rules)
  function endKey(phase, on) { return phase === "game" ? "endGame" : on ? "endOfferOpen" : "endOffer"; }

  // poll interval (ms): quiet while only open, quick while a game screen is up, none when hidden or off
  function pollMs(st, sheetUp, hidden) {
    if (hidden) return 0;
    var p = st && st.pair;
    if (p && p.state !== "ended") return sheetUp ? 3000 : 8000;
    if (st && st.on) return 20000;
    return 0;
  }

  var API = { items: items, screen: screen, score: score, filter: filter, nightEnd: nightEnd, stillOn: stillOn, endKey: endKey, pollMs: pollMs, planOf: planOf, ans: ans };
  if (typeof module === "object" && module.exports) module.exports = API;
  else { root.PN = root.PN || {}; root.PN.oiLogic = API; }
})(typeof window !== "undefined" ? window : this);
