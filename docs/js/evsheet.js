/* Öl Nu — 📅 EVENT-KNAPPEN (CONTRACT "SPORT + 📅 EVENT-KNAPPEN", migrations 0100 + 0101).
   One clear way in: a small round 📅 button stacked under 🔥 and 🚕 on the right, with a badge = events tonight.
   It opens the "📅 Event" sheet: time chips (Ikväll / Helgen / 7 dagar / Månad; CONTRACT "📅 EVENT MÅNAD": rows grouped
   under sticky day headers "Ikväll", "I morgon", "Lör 25/10"; Månad = events_near3, 31 days, on demand) + one scroll row of type chips (Alla / 🎤 Quiz / 🎸 Live /
   ⚽ Fotboll / 🏒 Hockey / 📺 På TV / 🎉 Fest). Rows by time, then distance: icon, title, place, time, countdown ("om 2 tim").
   Row actions: 📍 Visa (fly to the place / open the bar), 📨 Bjud in (js/invite.js openCreate from the event), 🪖 Vi går!
   (js/events.js go = create_rally + notify-group rally). TV matches (town-less) show "📺 Ikväll på TV: …" and
   "📺 Matchen visas på: Pitchers, O'Learys…" (js/sport.js pubs); their 📍 / 📨 / 🪖 use the nearest pub that shows sport.
   Data: events_near2(lat, lng, 7) at sign-in, max every 10 min, and when the sheet opens (cache 2 min). Old database
   (no events_near2) → falls back to EVENTS' events_near rows (no TV matches). Hooks (app.js mods): init, onAuthed, onPoll. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, busy = false, cache = { at: 0, key: "", rows: [], v2: false }, pollAt = 0, btnEl = null;
  var FILTER_KEY = "olnu.evsFilter";
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(k, a) { var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === lastPick[k]) i = (i + 1) % a.length; lastPick[k] = i; return a[i]; }
  function fill(s, o) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? String(o[k]) : m; }); }

  /* ---------- texts (dalmål + military, ä for é) ---------- */
  var T = {
    title: ["📅 Event", "📅 Events"],
    btn: ["Event", "Events"],
    times: [["tonight", "Ikväll", "Tonight"], ["weekend", "Helgen", "Weekend"], ["week", "7 dagar", "7 days"], ["month", "Månad", "Month"]],
    types: [["all", "Alla", "All"], ["quiz", "🎤 Quiz", "🎤 Quiz"], ["live", "🎸 Live", "🎸 Live"], ["fotboll", "⚽ Fotboll", "⚽ Football"],
      ["hockey", "🏒 Hockey", "🏒 Hockey"], ["tv", "📺 På TV", "📺 On TV"], ["fest", "🎉 Fest", "🎉 Party"]],
    show: ["📍 Visa", "📍 Show"], ticket: ["🎟️ Biljett", "🎟️ Tickets"], inv: ["📨 Bjud in", "📨 Invite"], go: ["🪖 Vi går!", "🪖 We're going!"],
    tip: ["➕ Tipsa om ett event", "➕ Add an event"],
    tvHead: ["📺 Ikväll på TV:", "📺 Tonight on TV:"], tvHeadDay: ["📺 På TV:", "📺 On TV:"],
    tvPubs: ["📺 Matchen visas på: {list}", "📺 Showing at: {list}"],
    tvNoPub: ["📺 Ingen krog ä flaggad för sport än. Tryck 👍 i krogens ruta när du ser en storbild!",
      "📺 No pub flagged for sports yet. Tap 👍 in a bar's sheet when you see a big screen!"],
    noPubAct: ["📺 Ingen sportkrog i närheten än. Flagga en med 👍 i krogens ruta.", "📺 No sports pub nearby yet. Flag one with 👍 in a bar's sheet."],
    now: ["pågår nu", "on now"], starting: ["börjar nu", "starting now"],
    inMin: ["om {n} min", "in {n} min"], inH: ["om {n} tim", "in {n} h"], tomorrow: ["i morgon", "tomorrow"], inD: ["om {n} dar", "in {n} days"],
    pending: ["⏳ väntar på godkännande", "⏳ waiting for approval"],
    src: ["Matchdata: stats.swehockey.se · TheSportsDB · Football data provided by the Football-Data.org API",
      "Match data: stats.swehockey.se · TheSportsDB · Football data provided by the Football-Data.org API"],
    // empty states: {vad} = the filter, {nar} = the time
    empty: ["Hä ä tyst som i en kolmila {nar}. Inga {vad} på kartan – tipsa du, så får hela Dalarna veta.",
      "Spaningen hittade inga {vad} {nar}. Antingen ä det lugnt i stan, eller så har ingen berättat.",
      "Inga {vad} {nar}. Dalregementet föreslår egen underhållning: ”vem ä törstigast?”",
      "Kalendern ä tom {nar}. Int' ens en trubadur i sikte. Tipsa om nåt!",
      "Nä du, inga {vad} {nar}. Gå ut ändå – det ä ju så event uppstår.",
      "Radiotystnad på eventfronten {nar}. Högkvarteret väntar på din rapport."],
    emptyEn: ["Nothing here {nar}. Know of something? Add it below!"],
    whenTxt: { tonight: ["ikväll", "tonight"], tomorrow: ["i morron", "tomorrow"], weekend: ["i helgen", "this weekend"], week: ["den här veckan", "this week"], month: ["den närmaste månaden", "this month"] },
    whatTxt: { all: ["event", "events"], quiz: ["quiz", "quizzes"], live: ["livespelningar", "live gigs"], fotboll: ["fotbollsmatcher", "football matches"],
      hockey: ["hockeymatcher", "hockey games"], tv: ["TV-matcher", "TV matches"], fest: ["fester", "parties"] }
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
  var listBox = null;
  function open() {
    if (!A) return;
    A.openSheet(two("title"), function (body) {
      body.classList.add("evs-body");
      var bar = A.el("div", { class: "evs-bar" });
      var seg = A.el("div", { class: "ds-seg evs-time", role: "tablist", "aria-label": L("När", "When") });
      T.times.forEach(function (t) {
        seg.appendChild(A.el("button", { type: "button", role: "tab", "data-t": t[0], "aria-selected": String(st.time === t[0]), text: L(t[1], t[2]), onclick: function () {
          st.time = t[0]; shown = 80; seg.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-selected", String(x.getAttribute("data-t") === st.time)); }); draw();
          try { body.scrollTop = 0; } catch (x) {}
          if (st.time === "month") load(false, 31).then(function () { if (listBox && document.body.contains(listBox)) draw(); });
        } }));
      });
      var chips = A.el("div", { class: "evs-chips", role: "group", "aria-label": L("Vad", "What") });
      T.types.forEach(function (t) {
        chips.appendChild(A.el("button", { type: "button", class: "ds-chip evs-chip", "data-k": t[0], "aria-pressed": String(st.type === t[0]), text: L(t[1], t[2]), onclick: function () {
          st.type = t[0]; save(); chips.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-k") === st.type)); }); draw();
        } }));
      });
      bar.appendChild(seg); bar.appendChild(chips);
      body.appendChild(bar);
      requestAnimationFrame(function () { stickTop(body, bar); });
      listBox = A.el("div", { class: "evs-list", "aria-live": "polite" });
      body.appendChild(listBox);
      body.appendChild(A.btn(two("tip"), "ds-btn ds-btn-secondary btn-block evs-tip", function () {
        try { if (window.EVENTS && window.EVENTS.tip) window.EVENTS.tip(null); } catch (e) {}
      }));
      body.appendChild(A.el("p", { class: "evs-src", text: two("src") }));
      draw();
      try { if (window.SPORT && window.SPORT.load) window.SPORT.load(false).then(function () { if (document.body.contains(listBox)) draw(); }); } catch (e) {}
      load(false).then(function () { if (listBox && document.body.contains(listBox)) draw(); });
    }, { onClose: function () { listBox = null; } });
  }
  function draw() {
    if (!listBox) return;
    listBox.innerHTML = "";
    var all = sorted(cache.rows.filter(function (e) { return inTime(e, st.time) && inType(e, st.type); }));
    var rows = all.slice(0, shown);
    if (!rows.length) {
      var w = T.whenTxt[st.time], v = T.whatTxt[st.type];
      listBox.appendChild(A.el("p", { class: "ds-empty evs-empty", text: fill(sv() ? pick("empty", T.empty) : T.emptyEn[0], { nar: L(w[0], w[1]), vad: L(v[0], v[1]) }) }));
      return;
    }
    // Sticky day headers ("Ikväll", "I morgon", "Lör 25/10") with the number of rows that day.
    var gk = function (e) { return eveDiff(e.starts_at) <= 0 ? "now" : eveKey(new Date(e.starts_at)); };
    var per = {}; all.forEach(function (e) { var k = gk(e); per[k] = (per[k] || 0) + 1; });
    var last = null;
    rows.forEach(function (e) {
      var k = gk(e);
      if (k !== last) {
        last = k;
        var h = A.el("div", { class: "evs-day" + (k === "now" ? " evs-day-now" : ""), role: "heading", "aria-level": "3", "data-day": k });
        h.appendChild(A.el("span", { text: headOf(eveDiff(e.starts_at), e.starts_at) }));
        h.appendChild(A.el("b", { class: "evs-day-n", text: String(per[k] || "") }));
        listBox.appendChild(h);
      }
      listBox.appendChild(rowEl(e));
    });
    if (all.length > rows.length) listBox.appendChild(A.btn(fill(L("Visa fler ({n} till)", "Show more ({n} more)"), { n: all.length - rows.length }),
      "ds-btn ds-btn-secondary btn-block evs-more", function () { shown += 80; draw(); }));
  }
  var shown = 80;
  var WD = [["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"], ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]];
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
  function refreshPubs() { if (listBox && document.body.contains(listBox)) draw(); }

  function pubsFor() { try { return window.SPORT && window.SPORT.pubs ? window.SPORT.pubs(null, null, 6) : []; } catch (e) { return []; } }
  function placeOf(e) {
    var b = null; try { b = e.bar_id && window.BARS && window.BARS.byId(e.bar_id); } catch (x) {}
    return (b && b.name) || e.place || e.town || "";
  }
  // TV match at a pub → an event-like object with the pub's place (for 📨 / 🪖)
  function atPub(e, pub) {
    var o = {}; for (var k in e) o[k] = e[k];
    o.lat = pub.lat; o.lng = pub.lng; o.bar_id = pub.id; o.place = String(pub.name || "").slice(0, 60);
    o.title = String(e.title || "").slice(0, 70);
    return o;
  }
  function rowEl(e) {
    var tv = !!e.tv, pubs = tv ? pubsFor() : [], place = placeOf(e);
    var card = A.el("div", { class: "ds-card evs-row" + (tv ? " evs-tv" : "") + (e.pending ? " evs-pending" : ""), "data-evs": String(e.id) });
    var top = A.el("div", { class: "evs-top" });
    top.appendChild(A.el("span", { class: "evs-ic", "aria-hidden": "true", text: icon(e) }));
    var txt = A.el("div", { class: "evs-txt" });
    var title = tv ? (eveDiff(e.starts_at) <= 0 ? two("tvHead") : two("tvHeadDay")) + " " + e.title : e.title;
    txt.appendChild(A.el("b", { class: "evs-t", text: title }));
    var sub = [];
    if (e.league) sub.push(e.league);
    if (!tv && place) sub.push(place);
    if (!tv && e.km != null && e.km > 1.5) sub.push(String(e.km).replace(".", ",") + " km");
    if (e.pending) sub.push(two("pending"));
    if (sub.length) txt.appendChild(A.el("span", { class: "evs-sub", text: sub.join(" · ") }));
    top.appendChild(txt);
    var when = A.el("div", { class: "evs-when" });
    when.appendChild(A.el("b", { class: "evs-hh", text: hhmm(e.starts_at) }));   // the day is in the sticky header
    when.appendChild(A.el("span", { class: "evs-cd", text: countdown(e) }));
    top.appendChild(when);
    card.appendChild(top);
    if (tv) {
      var names = pubs.slice(0, 3).map(function (p) { return p.name; }).filter(Boolean);
      var more = pubs.length > 3 ? " +" + (pubs.length - 3) : "";
      card.appendChild(A.el("p", { class: "evs-pubs" + (names.length ? "" : " evs-nopub"), text: names.length ? fill(two("tvPubs"), { list: names.join(", ") + more }) : two("tvNoPub") }));
    }
    var acts = A.el("div", { class: "evs-acts" });
    var pub = tv ? pubs[0] || null : null;
    var target = tv ? (pub ? atPub(e, pub) : null) : e;
    acts.appendChild(A.btn(two("show"), "ds-btn ds-btn-secondary evs-show", function () { show(e, pub); }));
    // 🎟️ (migration 0105: club ticket page / exact Tickster match / a ticket seller's own event link)
    if (e.ticket_url && /^https:\/\//.test(e.ticket_url)) acts.appendChild(A.el("a", { class: "ds-btn ds-btn-secondary evs-tk", href: e.ticket_url, target: "_blank", rel: "noopener nofollow", text: two("ticket") }));
    if (!e.pending && window.INVITE && window.INVITE.openCreate && (!tv || pub)) {
      acts.appendChild(A.btn(two("inv"), "ds-btn ds-btn-secondary evs-inv", function () {
        try { window.INVITE.openCreate({ event: target, bar: pub ? pub.bar || { id: pub.id, name: pub.name, lat: pub.lat, lng: pub.lng } : undefined }); } catch (x) {}
      }));
    }
    if (!e.pending && window.EVENTS && window.EVENTS.go) {
      acts.appendChild(A.btn(two("go"), "ds-btn ds-btn-primary evs-go", function (ev) {
        var t = target;
        if (!t) { t = {}; for (var k in e) t[k] = e[k]; t.lat = null; t.lng = null; t.place = L("📺 framför TV:n", "📺 in front of the TV"); }
        window.EVENTS.go(t, ev.currentTarget);
      }));
    }
    card.appendChild(acts);
    return card;
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

  window.EVSHEET = {
    init: function (api) {
      A = api;
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", makeButton); else makeButton();
    },
    onAuthed: function () { makeButton(); if (btnEl) btnEl.hidden = !(A && A.LIVE); pollAt = Date.now(); load(true); },
    onPoll: function () { if (Date.now() - pollAt < 10 * 60000) return; pollAt = Date.now(); load(true); },
    open: open, refreshPubs: refreshPubs,
    // tests / other modules
    _cache: function () { return cache; }, _load: load, _inTime: inTime, _countdown: countdown, T: T, _dayName: dayName,
    _setTime: function (t) { st.time = t; shown = 80; draw(); }, _head: headOf
  };
})();
