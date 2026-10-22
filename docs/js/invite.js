/* Öl Nu v28 — 📨 INBJUDNINGAR + 👥 VÄNLISTA (CONTRACT "v28 INBJUDNINGAR", migrations 0080–0083).
   1. 👥 Vänner: the bottom "Grupper" sheet gets a segmented control "Grupper | Vänner" (last tab remembered,
      olnu.gtab). The Vänner tab = the near.js friends block (requests, add by code / QR, my code, find-me switches)
      with ONE merged list from friend_list(): accepted friends + everyone who shares a group with me, each with
      name, demonym (0033), "🍺 ute nu i <stad>" / "🌙 int' ute", shared groups, 🧭 and "📨 Bjud in". ⚙️ "Vänner"
      opens the same tab (near.js openFriends → INVITE.openFriendsTab), so there is one place.
   2. 📨 Inbjudningar: start from an event (🏆 rows, bar sheet line), from ANY bar ("📨 Bjud in hit" in the bar sheet,
      date/time, default tonight 20:00), from a friend row, or from a map long-press (mapmenu.js). Friend picker with
      search, checkboxes and "👥 Hela gruppen X". Title auto ("🧠 Pubquiz på Pitchers" / "🍺 Pitchers"), place, start,
      optional note, "📍 Här där jag är". Invitees can invite more of THEIR friends. Push via notify-group
      {event:"invite"} / {event:"invite_yes"} (batched on the server) / {event:"invite_due"} (fallback; the cron
      .github/workflows/reminders.yml is the main sender). Answers ✅ Kommer / 🤔 Kanske / ❌ Kan inte.
      Invite sheet: who said what, 🧭 route link, time + countdown, "📨 Bjud in fler", creator: "Ställ in".
      Private: only participants can read an invite (server). Map: a small 📨 pin for each live invite I am in.
   3. ⏳ ONE HUD chip for my next accepted invite within 48 h ("⏳ 2 tim till Pubquiz"); urgent (closed pill) only
      from 1 h before until 1 h after the start (app.js picks .inv-chip.hx-urgent).
   4. Ticker: event + invite lines (24 dalmål lines). On a quiet night about 1 in 4 lines is an event line (1 or 2
      of 6), never two in a row (also across refills). Rides on NEWS.build; events.js keeps its own kinds.
   5. Map legend in the ⓘ popover: what the glow, the grey dashed rings (👻 förra veckan) and 📨 mean.
   Hooks (app.js mods): init, onAuthed, onPoll, applyText, groupsSheet, hudChipsHTML, hudClick, barPopupHTML,
   openInviteLink(id, answer) (?inv=<id>[&ans=yes|no]; ?invite=1 is the old app-share link). Public: INVITE.openCreate(o), INVITE.open(id), INVITE.openFriendsTab(),
   INVITE.friendsMore(listBox, friends, reload, friendRow) (near.js), INVITE.evButton(e) (events.js).
   A missing RPC (old server, PGRST202) → that part hides quietly. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, esc = U.esc;
  var A = null, off = {}, INV = [], invAt = 0, invBusy = false, firstPoll = true;
  var FL = null, flAt = 0, flP = null;
  var SEEN = "olnu.invSeen", DUE = "olnu.invDue", TAB = "olnu.gtab";
  var CODES = ["invalid_invite", "no_invitees", "too_many", "slow_down", "invite_not_found", "invite_over", "invalid_answer",
    "not_member", "not_authenticated"];

  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(key, a) {
    if (!a || !a.length) return "";
    var i = Math.floor(Math.random() * a.length);
    if (a.length > 1 && i === lastPick[key]) i = (i + 1) % a.length;
    lastPick[key] = i; return a[i];
  }
  function fill(s, o) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? String(o[k]) : m; }); }

  /* ---------- texts (dalmål "ä" for é, military) ---------- */
  var KIND = { quiz: "🧠", live: "🎸", dj: "🎧", karaoke: "🎤", sport: "📺", standup: "🎭", party: "🎉", other: "📅",
    beer: "🍺", forfest: "🏠", grill: "🔥", home: "🏠", spot: "📍" };
  var MY_KINDS = [["beer", "🍺 Öl", "🍺 Beer"], ["forfest", "🏠 Förfest", "🏠 Pre-party"], ["grill", "🔥 Grill", "🔥 BBQ"],
    ["party", "🎉 Fest", "🎉 Party"], ["quiz", "🧠 Quiz", "🧠 Quiz"], ["sport", "📺 Sport", "📺 Sports"], ["karaoke", "🎤 Karaoke", "🎤 Karaoke"],
    ["other", "📅 Annat", "📅 Other"]];
  var T = {
    sent: ["📨 Inbjudan ä ute! Nu väntar vi på svar från fronten.", "📨 Brevduvorna ä släppta. {n} kamrater har fått ordern.",
      "📨 Skickat till {n} st. Generalstaben ä nöjd.", "📨 Kallelsen gick ut till {n}. Den som kommer sist bjuder.",
      "📨 Ute hos {n} soldater. Håll ställningarna tills svaren kommer.", "📨 Order utskickad. {n} man ä underrättade."],
    yes: ["✅ Du kommer! Truppen räknar med dig.", "✅ Anmäld till tjänstgöring. Skål!", "✅ Noterat i liggaren: du ä med.",
      "✅ Bra soldat. Vi ses där!", "✅ Ja-svaret ä skickat. Putsa kängorna."],
    maybe: ["🤔 Kanske, alltså. Generalen tar det som ett halvt ja.", "🤔 Ett kanske ä bättre än inget. Vi håller en stol varm.",
      "🤔 Noterat: kanske. Bestäm dig före start, korpral.", "🤔 Halvvägs ute. Vi får se."],
    no: ["❌ Kan int'. Inga sura miner – nästa gång!", "❌ Avböjt. Fronten klarar sig, men saknar dig.", "❌ Noterat. Vila ä oxå bra.",
      "❌ Okej, du stannar i baracken den här gången."],
    added: ["📨 {n} till ä inbjudna. Ju fler desto roligare.", "📨 Förstärkning kallad: {n} till.", "📨 {n} nya namn på listan."],
    cancelled: ["Inställd. Truppen ä underrättad i appen.", "Inbjudan ä inställd. Inga problem, soldat."],
    inviteIn: ["📨 {namn} bjöd in dig: {titel}, {nar}", "📨 Ny inbjudan från {namn}: {titel}, {nar}", "📨 {namn} vill ha med dig: {titel}, {nar}"],
    // ticker: events (tonight / tomorrow / later / quiet) + invites (private, only participants see them)
    tkTonight: ["📅 Ikväll {tid}: {title} på {bar}", "📅 Ikväll kl {tid} kör {bar} {title}. Hä ä bara å gå.",
      "🎺 Signal: {title} på {bar} ikväll {tid}. Uppställning i tid!", "📻 Radion sprakar: {title} på {bar}, {tid}. Över.",
      "🪖 Kvällens uppdrag: {title} på {bar} kl {tid}.", "📅 Tyst i stan? Int' på {bar} – {title} kl {tid}.",
      "🥁 Trumman går för {title} på {bar} {tid}. Dalregementet ä kallat."],
    tkTomorrow: ["📅 I morgon: {title} på {bar}", "📅 I morron {tid}: {title} på {bar}. Spara krafterna, soldat.",
      "🗓️ Underrättelse för i morron: {bar} kör {title} kl {tid}.", "📅 Planera fälttåget: {title} på {bar} i morron {tid}."],
    tkLater: ["📅 {Dag}: {title} på {bar} kl {tid}", "🗓️ I almanackan: {title} på {bar}, {dag} {tid}.",
      "📅 Kommande: {title} på {bar} {dag}. Skriv upp dä i kalendern.", "🔭 Spaning framåt: {dag} blir dä {title} på {bar}."],
    tkQuiet: ["📅 Lugnt ikväll? {dag} smäller dä: {title} på {bar}.", "🦗 Tomt på stan nu, men {dag} {tid} ä dä {title} på {bar}."],
    tkInvG: ["📨 {n} i {grupp} ska till {bar} {dag}", "📨 {grupp} samlas {dag} {tid} vid {bar}. {n} har anmält sig."],
    tkInv: ["📨 {n} har sagt ja till {title} {dag}. Ska du med?", "📨 Inbjudan: {title} {dag} {tid} – {n} kommer, {m} kanske.",
      "📨 {title} {dag}: {n} soldater anmälda. Ä du en av dom?", "📨 {bar} {dag} {tid}: {n} ur gänget ä på väg.",
      "📨 {n} ska till {bar} {dag}. Generalen har godkänt."],
    tkSoon: ["⏳ Om {om}: {title}. {n} kommer."]
  };
  function errText(c) {
    var s = { invalid_invite: "Kolla titeln, tiden (inom 30 dagar) och platsen. Inga länkar.", no_invitees: "Välj minst en kompis att bjuda in.",
      too_many: "Max 60 inbjudna per inbjudan. Generalen har int' plats för fler.", slow_down: "Lugn i stormen – max 30 inbjudningar om dan.",
      invite_not_found: "Den inbjudan finns int' (eller så ä du int' med i den).", invite_over: "Inbjudan ä slut eller inställd.",
      not_member: "Du ä int' med i den gruppen.", error: "Dä gick int'. Försök igen." };
    var e = { invalid_invite: "Check title, time (within 30 days) and place.", no_invitees: "Pick at least one friend.", too_many: "Max 60 people per invite.",
      slow_down: "Easy – max 30 invites a day.", invite_not_found: "That invite is gone.", invite_over: "That invite is over.", error: "That did not work." };
    return sv() ? s[c] || s.error : e[c] || e.error;
  }
  function codeOf(err) {
    var m = String((err && (err.message || err.details || err.hint)) || "");
    for (var i = 0; i < CODES.length; i++) if (m.indexOf(CODES[i]) >= 0) return CODES[i];
    return "error";
  }
  function call(name, params) {
    if (!A || !A.LIVE || !A.authed() || off[name]) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) { off[name] = true; r.off = true; }
      return r;
    });
  }
  function push(body) { try { if (A.PUSH_ON && A.invoke) A.invoke("notify-group", body); } catch (e) {} }
  function myName() { try { return A.getName() || null; } catch (e) { return null; } }
  function demonym(town) { try { return town && window.HOMETOWN && window.HOMETOWN.label ? window.HOMETOWN.label(town) : ""; } catch (e) { return ""; } }

  /* ---------- time ---------- */
  var TZ = "Europe/Stockholm";
  function hhmm(iso) {
    var d = new Date(iso); if (!isFinite(d)) return "";
    try { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d); } catch (e) { return d.toTimeString().slice(0, 5); }
  }
  function dayKey(d) { try { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); } catch (e) { return d.toISOString().slice(0, 10); } }
  function eveKey(ms) { return dayKey(new Date(ms - 5 * 3600e3)); }
  function weekday(iso, long) {
    try { return new Intl.DateTimeFormat(sv() ? "sv-SE" : "en-GB", { timeZone: TZ, weekday: long ? "long" : "short" }).format(new Date(iso)); } catch (e) { return ""; }
  }
  function dmy(iso) { try { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, day: "numeric", month: "numeric" }).format(new Date(iso)); } catch (e) { return ""; } }
  // 0 = this evening, 1 = tomorrow, n = days ahead (evening days: 00–05 still belong to the day before).
  function dayDiff(iso) {
    var a = Date.parse(eveKey(Date.parse(iso)) + "T12:00:00Z"), b = Date.parse(eveKey(Date.now()) + "T12:00:00Z");
    return Math.round((a - b) / 864e5);
  }
  function whenText(iso) {
    var dd = dayDiff(iso);
    if (dd === 0) return L("ikväll ", "tonight ") + hhmm(iso);
    if (dd === 1) return L("i morgon ", "tomorrow ") + hhmm(iso);
    return weekday(iso) + " " + dmy(iso) + " " + hhmm(iso);
  }
  function dayPhrase(iso) {
    var dd = dayDiff(iso);
    if (dd === 0) return L("ikväll", "tonight");
    if (dd === 1) return L("i morgon", "tomorrow");
    return L("på ", "on ") + weekday(iso, true);
  }
  function untilText(ms) {
    var m = Math.round(ms / 60000);
    if (m < 1) return L("nu", "now");
    if (m < 60) return m + " min";
    if (m < 1440) return Math.max(1, Math.floor(m / 60)) + L(" tim", " h");
    var d = Math.floor(m / 1440);
    return d + (sv() ? (d === 1 ? " dag" : " dagar") : (d === 1 ? " day" : " days"));
  }
  function localInput(d) { var z = function (n) { return ("0" + n).slice(-2); }; return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(d.getHours()) + ":" + z(d.getMinutes()); }
  // Default start: tonight 20:00; later than 19:30 → the next half hour + 30 min.
  function defaultStart() {
    var d = new Date(), h = d.getHours() + d.getMinutes() / 60;
    if (h < 5) { d.setHours(20, 0, 0, 0); return d; }
    if (h <= 19.5) { d.setHours(20, 0, 0, 0); return d; }
    d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0); d.setMinutes(d.getMinutes() + 30); return d;
  }
  function stripEmoji(s) { return String(s || "").replace(/^[^\p{L}\p{N}]+/u, "").trim(); }
  function shortTitle(inv) {
    var s = stripEmoji(inv.title), i = s.indexOf(" på ");
    if (i > 2) s = s.slice(0, i);
    return s.length > 22 ? s.slice(0, 21) + "…" : s;
  }
  function placeOf(x) {
    var b = null; try { b = x.bar_id && window.BARS && window.BARS.byId(x.bar_id); } catch (e) {}
    return (b && b.name) || x.place || L("okänd plats", "unknown place");
  }

  /* ---------- poll: my_invites ---------- */
  function pollMs() {
    var soon = INV.some(function (x) { var d = Date.parse(x.starts_at) - Date.now(); return d < 2 * 3600e3 && d > -3600e3; });
    return soon ? 30000 : 60000;
  }
  function poll(force) {
    if (!A || !A.LIVE || !A.authed() || off.my_invites || invBusy) return Promise.resolve();
    if (!force && (Date.now() - invAt < pollMs() || document.hidden)) return Promise.resolve();
    invBusy = true; invAt = Date.now();
    return call("my_invites").then(function (r) {
      invBusy = false;
      if (r.error) return;
      var d = A.parseData(r.data);
      var was = chipKey();
      INV = Array.isArray(d.invites) ? d.invites.filter(function (x) { return x && x.id; }) : [];
      drawPins();
      newToasts();
      dueFallback();
      firstPoll = false;
      if (chipKey() !== was) { try { A.updateCounts(); } catch (e) {} }
    }, function () { invBusy = false; });
  }
  function seenList() { return U.ls.getJSON(SEEN, []) || []; }
  function newToasts() {
    var seen = seenList(), changed = false;
    INV.forEach(function (x) {
      if (x.mine || x.my_answer !== "none" || !x.live || seen.indexOf(x.id) >= 0) return;
      seen.push(x.id); changed = true;
      if (Date.parse(x.starts_at) < Date.now() - 3600e3) return;
      A.toast(sv() ? fill(pick("inin", T.inviteIn), { namn: x.creator_name || "Någon", titel: x.title, nar: whenText(x.starts_at) })
        : "📨 " + (x.creator_name || "Someone") + " invited you: " + x.title, {
        action: { label: L("Svara", "Answer"), fn: function () { openInvite(x.id); } }, ms: 10000 });
    });
    if (changed) U.ls.setJSON(SEEN, seen.slice(-80));
  }
  // Fallback for the 1 h reminder (the cron is the main sender): same server claim, so it goes out once.
  function dueFallback() {
    var done = U.ls.getJSON(DUE, []) || [];
    INV.forEach(function (x) {
      if (x.reminded || !x.live || x.status !== "open" || (x.my_answer !== "yes" && x.my_answer !== "maybe")) return;
      var m = (Date.parse(x.starts_at) - Date.now()) / 60000;
      if (m < 51 || m > 69 || done.indexOf(x.id) >= 0) return;
      done.push(x.id); U.ls.setJSON(DUE, done.slice(-40));
      push({ event: "invite_due", invite_id: x.id });
    });
  }

  /* ---------- map pins (only my invites; the server never shows them to anyone else) ---------- */
  var pinLayer = null;
  function drawPins() {
    if (!A || !A.map || !window.L) return;
    var Lf = window.L;
    if (!pinLayer) {
      try { if (!A.map.getPane("invites")) { A.map.createPane("invites"); A.map.getPane("invites").style.zIndex = 645; } } catch (e) {}
      pinLayer = Lf.layerGroup().addTo(A.map);
      A.map.on("zoomend", farClass); farClass();
    }
    pinLayer.clearLayers();
    INV.forEach(function (x) {
      if (!x.live || x.status !== "open" || x.my_answer === "no" || !isFinite(x.lat) || x.lat == null) return;
      var html = '<div class="inv-pin' + (x.my_answer === "yes" ? " yes" : "") + '"><span class="inv-pin-e" aria-hidden="true">📨</span>' +
        '<span class="inv-pin-t"><b>' + esc(shortTitle(x)) + "</b> " + esc(dayDiff(x.starts_at) === 0 ? hhmm(x.starts_at) : whenText(x.starts_at)) + "</span></div>";
      var m = Lf.marker([x.lat, x.lng], { pane: "invites", keyboard: true, title: x.title,
        icon: Lf.divIcon({ html: html, className: "inv-pin-w", iconSize: [0, 0], iconAnchor: x.bar_id ? [-10, 34] : [12, 28] }) });
      m.on("click", function () { openInvite(x.id); });
      m.addTo(pinLayer);
    });
  }
  function farClass() { try { A.map.getPane("invites").classList.toggle("inv-far", A.map.getZoom() < 13); } catch (e) {} }

  /* ---------- ⏳ HUD chip ---------- */
  function nextInvite() {
    var now = Date.now(), best = null;
    INV.forEach(function (x) {
      if (!x.live || x.status !== "open" || (x.my_answer !== "yes" && !x.mine)) return;
      var d = Date.parse(x.starts_at) - now;
      if (d > 48 * 3600e3 || d < -3600e3) return;
      if (!best || Date.parse(x.starts_at) < Date.parse(best.starts_at)) best = x;
    });
    return best;
  }
  function chipText(x) {
    var d = Date.parse(x.starts_at) - Date.now(), nm = shortTitle(x);
    if (d <= 60000) return L("🍻 Nu: ", "🍻 Now: ") + nm;
    return "⏳ " + untilText(d) + L(" till ", " to ") + nm;
  }
  function chipKey() { var x = nextInvite(); return x ? x.id + ":" + chipText(x) + ":" + (Date.parse(x.starts_at) - Date.now() < 3600e3) : ""; }
  function chipHTML() {
    var x = nextInvite(); if (!x) return "";
    var urgent = Date.parse(x.starts_at) - Date.now() <= 3600e3;
    return '<button type="button" class="hx-chip inv-chip' + (urgent ? " hx-urgent" : "") + '" data-hx="inv" data-inv="' + esc(String(x.id)) + '">' + esc(chipText(x)) + "</button>";
  }
  var lastChip = "";
  setInterval(function () { if (!A || document.hidden) return; var k = chipKey(); if (k !== lastChip) { lastChip = k; try { A.updateCounts(); } catch (e) {} } }, 30000);

  /* ---------- 👥 friend list (friend_list: friends + group-mates) ---------- */
  function friends(force) {
    if (!force && FL && Date.now() - flAt < 30000) return Promise.resolve(FL);
    if (flP) return flP;
    flP = call("friend_list", { p_name: myName() }).then(function (r) {
      flP = null;
      var d = r.error ? null : A.parseData(r.data);
      if (d && Array.isArray(d.people)) { FL = d; flAt = Date.now(); }
      return FL;
    });
    return flP;
  }
  function personSub(p) {
    var s = [], dem = demonym(p.home_town);
    if (dem) s.push(dem);
    s.push(p.out ? L("🍺 ute nu", "🍺 out now") + (p.town ? L(" i ", " in ") + p.town : "") : L("🌙 int' ute", "🌙 not out"));
    return s.join(" · ");
  }
  function groupsLine(p) {
    var g = (p.groups || []).map(function (x) { return x.name; }).filter(Boolean);
    if (!g.length) return null;
    return A.el("small", { class: "inv-fg muted", text: "👥 " + (g.length > 3 ? g.slice(0, 3).join(", ") + " +" + (g.length - 3) : g.join(", ")) });
  }
  function inviteBtn(p) {
    var b = A.btn("📨", "btn-small inv-fb", function () { openCreate({ keys: [p.key], who: p.name }); });
    b.setAttribute("aria-label", L("Bjud in ", "Invite ") + (p.name || "")); b.title = L("Bjud in", "Invite");
    return b;
  }
  // near.js renders its list first (my_friends); this replaces it with the merged list when friend_list answers.
  function friendsMore(listBox, fr, reload, friendRow) {
    friends(true).then(function (d) {
      if (!d || !document.body.contains(listBox)) return;
      var people = d.people || [];
      if (!people.length) return;
      var byId = {}; (fr || []).forEach(function (f) { byId[String(f.id)] = f; });
      listBox.innerHTML = "";
      listBox.classList.add("inv-flist");
      people.forEach(function (p) {
        var li, nf = p.friend_id != null ? byId[String(p.friend_id)] : null;
        if (nf && friendRow) {
          li = friendRow(nf, function () { flAt = 0; reload(); });
          li.querySelector(".nr-fmain small") && (li.querySelector(".nr-fmain small").textContent = personSub(p));
        } else {
          li = A.el("li", { class: "nr-frow inv-frow" + (p.out ? " out" : "") }, [
            A.el("span", { class: "st-dot" + (p.out ? " on" : ""), "aria-hidden": "true" }),
            A.el("span", { class: "nr-fmain" }, [A.el("b", { text: p.name || "?" }), A.el("small", { class: "muted", text: personSub(p) })])
          ]);
          if (p.find_key && window.NEAR && window.NEAR.openFinder) {
            var fb = A.btn("🧭", "btn-small nr-find-b", function () { if (window.HITTA && window.HITTA.where) window.HITTA.where(p.find_key, p.name); else window.NEAR.openFinder(p.find_key, p.name); });
            fb.setAttribute("aria-label", L("Hitta ", "Find ") + (p.name || "")); li.appendChild(fb);
          }
        }
        var main = li.querySelector(".nr-fmain"), gl = groupsLine(p);
        if (main && gl) main.appendChild(gl);
        var rm = li.querySelector(".nr-rm-b");
        try { var dmb = window.DM && window.DM.friendBtn ? window.DM.friendBtn(p) : null; if (dmb) li.insertBefore(dmb, rm || null); } catch (e) {}   // 💬 Skriv
        li.insertBefore(inviteBtn(p), rm || null);
        listBox.appendChild(li);
      });
    });
  }
  // Fallback Vänner tab when near.js is missing: the merged list only.
  function plainFriends(box) {
    var list = A.el("ul", { class: "nr-flist" });
    box.appendChild(A.el("h3", { text: L("Mina vänner", "My friends") })); box.appendChild(list);
    list.appendChild(A.el("li", { class: "muted", text: "…" }));
    friends(true).then(function (d) {
      list.innerHTML = "";
      if (!d || !(d.people || []).length) { list.appendChild(A.el("li", { class: "muted", text: L("Inga vänner än. Gå med i en grupp!", "No friends yet.") })); return; }
      friendsMore(list, [], function () { box.innerHTML = ""; plainFriends(box); }, null);
    });
  }

  /* ---------- Grupper | Vänner tabs (groupsSheet hook; INVITE is last in mods, so it wraps the whole sheet) ---------- */
  var wantTab = null;
  function groupsSheet(body) {
    if (!A || !A.LIVE) return;
    var kids = Array.prototype.slice.call(body.childNodes);
    var gPane = A.el("div", { class: "inv-pane", id: "inv-pane-g", role: "tabpanel" }), fPane = A.el("div", { class: "inv-pane", id: "inv-pane-f", role: "tabpanel" });
    kids.forEach(function (k) { gPane.appendChild(k); });
    var tab = wantTab || U.ls.get(TAB, "g") || "g"; wantTab = null;
    if (tab !== "f") tab = "g";
    var bar = A.el("div", { class: "tabs inv-tabs", role: "tablist", "aria-label": L("Grupper eller vänner", "Groups or friends") });
    var built = false;
    function show(t) {
      tab = t; U.ls.set(TAB, t);
      gPane.hidden = t !== "g"; fPane.hidden = t !== "f";
      bar.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-t") === t)); });
      if (t === "f" && !built) {
        built = true;
        try { if (window.NEAR && window.NEAR.buildFriends && window.NEAR.buildFriends(fPane)) return; } catch (e) {}
        plainFriends(fPane);
      }
    }
    [["g", L("👥 Grupper", "👥 Groups")], ["f", L("🤝 Vänner", "🤝 Friends")]].forEach(function (x) {
      bar.appendChild(A.el("button", { type: "button", role: "tab", "data-t": x[0], "aria-controls": "inv-pane-" + x[0], text: x[1], onclick: function () { show(x[0]); } }));
    });
    body.appendChild(bar); body.appendChild(gPane); body.appendChild(fPane);
    show(tab);
  }
  function openFriendsTab() {
    if (!A || !A.LIVE || !A.showGroups) return false;
    wantTab = "f"; U.ls.set(TAB, "f");
    A.showGroups();
    return true;
  }

  /* ---------- friend picker ---------- */
  function picker(box, opts) {
    opts = opts || {};
    var sel = {}, gsel = {};
    (opts.keys || []).forEach(function (k) { sel[k] = true; });
    var head = A.el("div", { class: "inv-pk-head" });
    var count = A.el("span", { class: "inv-pk-n" });
    var search = A.el("input", { class: "inp inv-pk-q", type: "search", placeholder: L("🔎 Sök kompis", "🔎 Search"), "aria-label": L("Sök kompis", "Search friends"), autocomplete: "off" });
    var gRow = A.el("div", { class: "inv-pk-groups" }), list = A.el("ul", { class: "inv-pk-list" });
    head.appendChild(A.el("b", { text: L("Vem bjuder du in?", "Who do you invite?") })); head.appendChild(count);
    box.appendChild(head); box.appendChild(search); box.appendChild(gRow); box.appendChild(list);
    list.appendChild(A.el("li", { class: "muted", text: "…" }));
    var people = [];
    function n() { return Object.keys(sel).filter(function (k) { return sel[k]; }).length; }
    function upd() {
      count.textContent = n() ? n() + L(" valda", " picked") : "";
      list.querySelectorAll("input[type=checkbox]").forEach(function (c) { c.checked = !!sel[c.value]; });
      gRow.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(!!gsel[b.getAttribute("data-g")])); });
      if (opts.onChange) opts.onChange(n());
    }
    function draw() {
      var q = String(search.value || "").toLowerCase().trim();
      list.innerHTML = "";
      var rows = people.filter(function (p) { return !q || String(p.name || "").toLowerCase().indexOf(q) >= 0; });
      if (!rows.length) { list.appendChild(A.el("li", { class: "muted", text: people.length ? L("Ingen med det namnet.", "No match.") : L("Inga vänner än. Gå med i en grupp eller lägg till med vänkod.", "No friends yet.") })); return; }
      rows.forEach(function (p) {
        var id = "inv-pk-" + p.key;
        var cb = A.el("input", { type: "checkbox", id: id, value: p.key });
        cb.checked = !!sel[p.key];
        cb.addEventListener("change", function () { sel[p.key] = cb.checked; upd(); });
        list.appendChild(A.el("li", { class: "inv-pk-row" + (p.out ? " out" : "") }, [
          A.el("label", { for: id }, [cb, A.el("span", { class: "inv-pk-main" }, [A.el("b", { text: p.name || "?" }),
            A.el("small", { class: "muted", text: personSub(p) + ((p.groups || []).length ? " · 👥 " + p.groups.map(function (g) { return g.name; }).slice(0, 2).join(", ") : "") })])])
        ]));
      });
    }
    search.addEventListener("input", draw);
    friends(false).then(function (d) {
      people = d ? d.people || [] : [];
      gRow.innerHTML = "";
      ((d && d.groups) || []).forEach(function (g) {
        var mem = people.filter(function (p) { return (p.groups || []).some(function (x) { return String(x.id) === String(g.id); }); });
        if (!mem.length) return;
        gRow.appendChild(A.el("button", { type: "button", class: "chip inv-pk-g", "data-g": String(g.id), "aria-pressed": "false",
          text: L("👥 Hela ", "👥 All of ") + g.name + " (" + mem.length + ")", onclick: function () {
            var on = !gsel[g.id]; gsel[g.id] = on;
            mem.forEach(function (p) { sel[p.key] = on; });
            upd();
          } }));
      });
      draw(); upd();
    });
    return {
      keys: function () { return Object.keys(sel).filter(function (k) { return sel[k]; }); },
      groupIds: function () { return Object.keys(gsel).filter(function (g) { return gsel[g]; }); },
      count: n
    };
  }

  /* ---------- 📨 create ---------- */
  function nearNamed(lat, lng) {
    try { var n = window.BARS && window.BARS.nearestNamed ? window.BARS.nearestNamed(lat, lng, 60) : null; if (n && n.spot) return n.spot; } catch (e) {}
    try {
      var x = window.BARS.nearby(lat, lng, 60, 1, { places: true, placeM: 60, maxPlaces: 1 })[0];
      return x ? x.bar : null;
    } catch (e) { return null; }
  }
  function isBar(spot) { return !!(spot && spot.id != null && !/^pl_/.test(String(spot.id)) || (spot && spot.type && !/restaurant|fast_food|cafe/.test(spot.type))); }
  function homeLabel() { return L("Hemma hos ", "At ") + (myName() || L("mig", "mine")); }
  function autoTitle(o) {
    if (o.event) return (KIND[o.event.kind] || "📅") + " " + o.event.title + L(" på ", " at ") + placeOf(o.event);
    if (o.bar) return "🍺 " + (o.bar.name || L("Krogen", "The bar"));
    if (o.label) return (/^Hemma|^At /.test(o.label) ? "🏠 " : "📍 ") + o.label;
    return "🍺 " + L("Öl", "Beer");
  }
  function where() {
    try { var l = A.lastLoc && A.lastLoc(); if (l && isFinite(l.lat)) return { lat: +l.lat, lng: +l.lng }; } catch (e) {}
    try { var c = A.map.getCenter(); return { lat: c.lat, lng: c.lng }; } catch (e) {}
    return { lat: 60.1496, lng: 15.1878 };
  }
  // o: {event, bar, lat, lng, label, custom, keys, who, kind}
  function openCreate(o) {
    if (!A || !A.LIVE) return;
    o = o || {};
    if (o.event && !o.bar) { try { o.bar = o.event.bar_id && window.BARS.byId(o.event.bar_id); } catch (e) {} }
    if (!o.bar && !o.event && o.lat != null) {
      var nn = nearNamed(o.lat, o.lng);
      if (nn) { if (isBar(nn) && nn.id != null) o.bar = nn; else o.label = o.label || nn.name; }
    }
    A.withName(function () {
      A.openSheet(o.custom ? L("📨 Skapa event här", "📨 Create an event here") : L("📨 Bjud in", "📨 Invite"), function (body) {
        var el = A.el;
        var st = { lat: null, lng: null, bar: o.bar || null, label: o.label || null, spot: "bar", kind: o.kind || (o.event ? o.event.kind : o.custom ? "party" : "beer"), titleTouched: false };
        if (o.event) { st.lat = o.event.lat; st.lng = o.event.lng; }
        else if (st.bar) { st.lat = st.bar.lat; st.lng = st.bar.lng; }
        else if (o.lat != null) { st.lat = o.lat; st.lng = o.lng; st.spot = "spot"; st.label = st.label || homeLabel(); }
        var title = el("input", { class: "inp inv-title", maxlength: "80", "aria-label": L("Titel", "Title"),
          placeholder: o.custom ? L("t.ex. Grillkväll, Förfest, Kräftskiva", "e.g. BBQ, pre-party") : "" });
        title.addEventListener("input", function () { st.titleTouched = true; });
        function retitle() { if (!st.titleTouched && !o.custom) title.value = autoTitle({ event: o.event, bar: st.bar, label: st.label }); }
        if (o.custom) title.value = ""; else retitle();
        body.appendChild(el("label", { class: "ev-l", text: L("Vad?", "What?") })); body.appendChild(title);
        if (o.custom) {
          var chips = el("div", { class: "ev-kinds" });
          MY_KINDS.forEach(function (k) {
            chips.appendChild(el("button", { type: "button", class: "chip ev-k", "aria-pressed": String(st.kind === k[0]), text: L(k[1], k[2]), onclick: function (ev) {
              st.kind = k[0]; chips.querySelectorAll(".ev-k").forEach(function (x) { x.setAttribute("aria-pressed", String(x === ev.currentTarget)); });
            } }));
          });
          body.appendChild(chips);
        }
        // When
        var at = o.event ? new Date(o.event.starts_at) : defaultStart();
        var when = el("input", { class: "inp", type: "datetime-local", value: localInput(at), "aria-label": L("När?", "When?") });
        body.appendChild(el("label", { class: "ev-l", text: L("När?", "When?") })); body.appendChild(when);
        // Where
        body.appendChild(el("label", { class: "ev-l", text: L("Var?", "Where?") }));
        var whereBox = el("div", { class: "inv-where" }), labelInp = el("input", { class: "inp inv-label", maxlength: "60", "aria-label": L("Platsens namn", "Place name") });
        labelInp.addEventListener("input", function () { st.label = labelInp.value.trim() || homeLabel(); retitle(); });
        body.appendChild(whereBox);
        function drawWhere() {
          whereBox.innerHTML = "";
          if (o.event) { whereBox.appendChild(el("p", { class: "inv-place", text: "📍 " + placeOf(o.event) })); return; }
          var opts = [], p0 = st.lat != null ? { lat: st.lat, lng: st.lng } : where();
          if (st.bar) opts.push({ k: "b:" + st.bar.id, t: "🍺 " + st.bar.name, bar: st.bar });
          else if (st.lat != null) opts.push({ k: "pt", t: "📍 " + (st.label || homeLabel()) });
          opts.push({ k: "gps", t: L("📍 Här där jag ä (GPS)", "📍 Where I am (GPS)") });
          try {
            window.BARS.nearby(p0.lat, p0.lng, 1500, 8, {}).forEach(function (x) {
              if (!st.bar || String(x.bar.id) !== String(st.bar.id)) opts.push({ k: "b:" + x.bar.id, t: "🍺 " + x.bar.name, bar: x.bar });
            });
          } catch (e) {}
          var s = el("select", { class: "inp inv-sel", "aria-label": L("Var?", "Where?") });
          opts.forEach(function (x) { s.appendChild(el("option", { value: x.k, text: x.t })); });
          s.value = opts[0] ? opts[0].k : "gps";
          s.addEventListener("change", function () {
            var x = opts.filter(function (y) { return y.k === s.value; })[0];
            if (!x) return;
            if (x.k === "gps") {
              s.disabled = true;
              A.getPosition().then(function (pos) {
                s.disabled = false;
                st.lat = +pos.coords.latitude.toFixed(5); st.lng = +pos.coords.longitude.toFixed(5);
                var nn = nearNamed(st.lat, st.lng);
                if (nn && isBar(nn) && nn.id != null) { st.bar = nn; st.label = null; st.spot = "bar"; }
                else { st.bar = null; st.label = nn ? nn.name : homeLabel(); st.spot = "here"; }
                retitle(); drawWhere();
              }, function (e) { s.disabled = false; try { A.locError(e); } catch (x2) {} s.value = opts[0].k; });
              return;
            }
            if (x.bar) { st.bar = x.bar; st.lat = x.bar.lat; st.lng = x.bar.lng; st.label = null; st.spot = "bar"; }
            retitle(); drawWhere();
          });
          whereBox.appendChild(s);
          if (!st.bar && st.lat != null) {
            labelInp.value = st.label || homeLabel();
            whereBox.appendChild(labelInp);
            whereBox.appendChild(el("p", { class: "muted inv-hint", text: L("🔒 Privat: bara de inbjudna ser platsen och inbjudan.", "🔒 Private: only invited people see it.") }));
          }
          if (st.lat == null) whereBox.appendChild(el("p", { class: "muted inv-hint", text: L("Välj en krog, eller 📍 Här där jag ä. Tips: långtryck på kartan för valfri plats.", "Pick a bar or your spot. Tip: long-press the map.") }));
        }
        drawWhere();
        // Note
        var note = el("input", { class: "inp", maxlength: "200", placeholder: L("Meddelande (valfritt), t.ex. ”Jag bjuder på första”", "Note (optional)"), "aria-label": L("Meddelande", "Note") });
        body.appendChild(el("label", { class: "ev-l", text: L("Meddelande", "Note") })); body.appendChild(note);
        // People
        var pkBox = el("div", { class: "inv-pk" });
        body.appendChild(pkBox);
        var go = A.btn(L("📨 Skicka inbjudan", "📨 Send invite"), "btn-amber btn-block inv-send", function () { send(); });
        var pk = picker(pkBox, { keys: o.keys, onChange: function (n) { go.textContent = L("📨 Skicka inbjudan", "📨 Send invite") + (n ? " (" + n + ")" : ""); go.disabled = !n; } });
        go.disabled = !(o.keys && o.keys.length);
        body.appendChild(el("p", { class: "muted inv-hint", text: L("Bara dina vänner och gruppkompisar kan bjudas in. De inbjudna kan bjuda in sina vänner.", "Only friends and group-mates. Invited people can invite their friends.") }));
        body.appendChild(go);
        function send() {
          var t = (title.value || "").trim() || (o.custom ? "" : autoTitle({ event: o.event, bar: st.bar, label: st.label }));
          if (!t) { A.toast(L("Skriv vad som händer.", "Write what is happening."), { err: true }); title.focus(); return; }
          if (st.lat == null && !o.event) { A.toast(L("Välj var.", "Pick a place."), { err: true }); return; }
          var d = new Date(when.value);
          var params = { p_title: t.slice(0, 80), p_starts_at: isFinite(d) ? d.toISOString() : null, p_keys: pk.keys(), p_group_ids: pk.groupIds(),
            p_bar_id: st.bar ? String(st.bar.id) : (o.event && o.event.bar_id) || null,
            p_place: String(st.bar ? st.bar.name : o.event ? placeOf(o.event) : st.label || "").slice(0, 60) || null,
            p_lat: st.lat, p_lng: st.lng, p_note: note.value.trim() || null, p_kind: st.kind || null,
            p_event_id: o.event && o.event.id && !o.event.pending ? o.event.id : null,
            p_spot: st.bar || o.event ? "bar" : st.spot === "here" ? "here" : "spot",
            p_group_id: pk.groupIds()[0] || null, p_name: myName() };
          go.disabled = true;
          call("invite_create", params).then(function (r) {
            go.disabled = false;
            if (r.error) { A.toast(r.off ? errText("error") : errText(codeOf(r.error)), { err: true }); return; }
            var j = A.parseData(r.data);
            push({ event: "invite", invite_id: j.id });
            try { window.FX.vibrate([20, 40, 20]); window.FX.sound.clink(); } catch (e) {}
            A.toast(sv() ? fill(pick("sent", T.sent), { n: j.added || pk.count() }) : "📨 Invite sent to " + (j.added || pk.count()) + ".", { cls: "skal" });
            poll(true);
            showInvite(j);
          });
        }
        setTimeout(function () { if (o.custom) title.focus(); }, 60);
      }, { now: true });
    });
  }

  /* ---------- 📨 view ---------- */
  function openInvite(id, answer) {
    if (!A || !A.LIVE) return;
    var go = function () {
      call("invite_get", { p_id: +id }).then(function (r) {
        if (r.error) { A.toast(r.off ? errText("error") : errText(codeOf(r.error)), { err: true }); return; }
        var j = A.parseData(r.data);
        if (answer && /^(yes|no|maybe)$/.test(answer) && j.live && j.my_answer !== answer && !j.mine) { doAnswer(j, answer, true); return; }
        showInvite(j);
      });
    };
    go();
  }
  var viewTimer = null;
  function showInvite(j) {
    A.openSheet((KIND[j.kind] && !/^\p{Extended_Pictographic}/u.test(j.title) ? KIND[j.kind] + " " : "") + j.title, function (body) { drawInvite(body, j); }, {
      now: true, onClose: function () { if (viewTimer) { clearInterval(viewTimer); viewTimer = null; } } });
    if (viewTimer) clearInterval(viewTimer);
    viewTimer = setInterval(function () {
      if (document.hidden || !document.querySelector(".inv-view[data-id='" + j.id + "']")) return;
      call("invite_get", { p_id: j.id }).then(function (r) {
        if (r.error) return;
        var box = document.querySelector(".inv-view[data-id='" + j.id + "']");
        if (box) { var b = box.parentNode; b.innerHTML = ""; drawInvite(b, A.parseData(r.data)); }
      });
    }, 20000);
  }
  function routeUrl(j) { return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(j.lat + "," + j.lng); }
  function drawInvite(body, j) {
    var el = A.el;
    var box = el("div", { class: "inv-view", "data-id": String(j.id) });
    body.appendChild(box);
    var dt = Date.parse(j.starts_at) - Date.now();
    var cd = !j.live ? L("Slut", "Over") : dt > 0 ? L("⏳ om ", "⏳ in ") + untilText(dt) : dt > -6 * 3600e3 ? L("🍻 pågår nu", "🍻 on now") : "";
    if (j.status === "cancelled") cd = L("🚫 Inställd", "🚫 Cancelled");
    box.appendChild(el("div", { class: "inv-when" }, [el("b", { text: whenText(j.starts_at) }), el("span", { class: "inv-cd" + (dt > 0 && dt < 3600e3 ? " soon" : ""), text: cd })]));
    var placeRow = el("div", { class: "inv-placerow" }, [el("span", { class: "inv-place", text: "📍 " + placeOf(j) })]);
    if (isFinite(j.lat) && j.lat != null) {
      placeRow.appendChild(el("a", { class: "btn btn-small inv-route", href: routeUrl(j), target: "_blank", rel: "noopener", text: L("🧭 Vägen dit", "🧭 Route") }));
      placeRow.appendChild(A.btn(L("🗺️ Karta", "🗺️ Map"), "btn-small", function () {
        A.closeSheet();
        var b = null; try { b = j.bar_id && window.BARS.byId(j.bar_id); } catch (e) {}
        if (b && A.openBar) A.openBar(b); else A.flyTo(j.lat, j.lng, 17);
      }));
    }
    box.appendChild(placeRow);
    box.appendChild(el("p", { class: "muted inv-from", text: (j.mine ? L("Din inbjudan", "Your invite") : L("Från ", "From ") + (j.creator_name || "?")) +
      (j.group_name ? " · 👥 " + j.group_name : "") + (j.spot !== "bar" ? L(" · 🔒 privat plats", " · 🔒 private spot") : "") }));
    if (j.note) box.appendChild(el("p", { class: "inv-note", text: "💬 " + j.note }));
    // Answer
    if (j.live && j.status === "open" && !j.mine) {
      var seg = el("div", { class: "tabs inv-ans", role: "radiogroup", "aria-label": L("Ditt svar", "Your answer") });
      [["yes", L("✅ Kommer", "✅ Coming")], ["maybe", L("🤔 Kanske", "🤔 Maybe")], ["no", L("❌ Kan int'", "❌ Can't")]].forEach(function (a) {
        seg.appendChild(el("button", { type: "button", role: "radio", "aria-checked": String(j.my_answer === a[0]), "aria-selected": String(j.my_answer === a[0]),
          "data-a": a[0], text: a[1], onclick: function (ev) { doAnswer(j, a[0], false, ev.currentTarget); } }));
      });
      box.appendChild(seg);
    }
    try { if (window.EVCHAT && window.EVCHAT.inviteBox) window.EVCHAT.inviteBox(box, j); } catch (e) {}
    try { if (window.EVLINK && window.EVLINK.inviteBox) window.EVLINK.inviteBox(box, j); } catch (e) {}   // social2
    // People
    var groups = [["yes", L("✅ Kommer", "✅ Coming")], ["maybe", L("🤔 Kanske", "🤔 Maybe")], ["none", L("⏳ Int' svarat", "⏳ No answer")], ["no", L("❌ Kan int'", "❌ Can't")]];
    groups.forEach(function (g) {
      var ps = (j.people || []).filter(function (p) { return p.answer === g[0]; });
      if (!ps.length) return;
      box.appendChild(el("div", { class: "inv-ppl inv-" + g[0] }, [el("span", { class: "inv-ppl-h", text: g[1] + " " + ps.length }),
        el("span", { class: "inv-ppl-n", text: ps.map(function (p) { return (p.is_me ? L("du", "you") : p.name) + (p.is_creator ? " 👑" : "") + (p.by ? " (" + L("via ", "via ") + p.by + ")" : ""); }).join(", ") })]));
    });
    var row = el("div", { class: "row inv-acts" });
    if (j.can_add) row.appendChild(A.btn(L("📨 Bjud in fler", "📨 Invite more"), "btn-small btn-amber", function () { addMore(j); }));
    if (j.mine && j.live && j.status === "open") {
      var cx = A.btn(L("Ställ in", "Cancel"), "btn-small btn-ghost inv-cancel", function () {
        if (box.querySelector(".confirm")) return;
        box.appendChild(el("div", { class: "confirm" }, [el("p", { text: L("Ställa in " + j.title + "? De inbjudna ser det i appen.", "Cancel " + j.title + "?") }),
          el("div", { class: "row" }, [A.btn(L("Nej", "No"), "btn-small", function (ev) { ev.currentTarget.closest(".confirm").remove(); }),
            A.btn(L("Ja, ställ in", "Yes, cancel"), "btn-small btn-danger", function () {
              call("invite_cancel", { p_id: j.id }).then(function (r) {
                if (r.error) { A.toast(errText(codeOf(r.error)), { err: true }); return; }
                A.toast(pick("cx", sv() ? T.cancelled : ["Cancelled."])); poll(true); A.closeSheet();
              });
            })])]));
      });
      row.appendChild(cx);
    }
    if (row.childNodes.length) box.appendChild(row);
    box.appendChild(el("p", { class: "muted inv-hint", text: L("🔒 Bara de inbjudna ser den här inbjudan. Slutar 6 tim efter start.", "🔒 Only invited people see this. Ends 6 h after the start.") }));
  }
  function doAnswer(j, a, openAfter, b) {
    if (b) b.disabled = true;
    call("invite_answer", { p_id: j.id, p_answer: a }).then(function (r) {
      if (b) b.disabled = false;
      if (r.error) { A.toast(errText(codeOf(r.error)), { err: true }); return; }
      var d = A.parseData(r.data);
      if (d.push_yes) push({ event: "invite_yes", invite_id: j.id });
      A.toast(sv() ? pick("a" + a, T[a]) : a === "yes" ? "✅ You're in!" : a === "maybe" ? "🤔 Maybe." : "❌ Noted.", { cls: a === "yes" ? "skal" : "" });
      try { window.FX.vibrate(a === "yes" ? [20, 40, 20] : 15); } catch (e) {}
      poll(true);
      var box = document.querySelector(".inv-view[data-id='" + j.id + "']");
      if (box && !openAfter) { var p = box.parentNode; p.innerHTML = ""; drawInvite(p, d); }
      else showInvite(d);
    });
  }
  function addMore(j) {
    A.openSheet(L("📨 Bjud in fler", "📨 Invite more"), function (body) {
      body.appendChild(A.el("p", { class: "muted", text: j.title + " · " + whenText(j.starts_at) }));
      var go = A.btn(L("📨 Skicka", "📨 Send"), "btn-amber btn-block", function () {
        go.disabled = true;
        call("invite_add", { p_id: j.id, p_keys: pk.keys(), p_group_ids: pk.groupIds(), p_name: myName() }).then(function (r) {
          go.disabled = false;
          if (r.error) { var c = codeOf(r.error); A.toast(c === "no_invitees" ? L("Dom ä redan inbjudna.", "Already invited.") : errText(c), { err: true }); return; }
          var d = A.parseData(r.data);
          push({ event: "invite", invite_id: j.id });
          A.toast(sv() ? fill(pick("add", T.added), { n: d.added || 0 }) : "📨 " + (d.added || 0) + " more invited.");
          showInvite(d);
        });
      });
      var pk = picker(body, { onChange: function (n) { go.disabled = !n; go.textContent = L("📨 Skicka", "📨 Send") + (n ? " (" + n + ")" : ""); } });
      go.disabled = true;
      body.appendChild(A.el("p", { class: "muted inv-hint", text: L("Redan inbjudna hoppas över.", "Already invited people are skipped.") }));
      body.appendChild(go);
    }, { now: true });
  }

  /* ---------- bar sheet: "📨 Bjud in hit" + 📅 Kommande + my invites here ---------- */
  function evRows() { try { return (window.EVENTS && window.EVENTS._cache && window.EVENTS._cache().rows) || []; } catch (e) { return []; } }
  function barHTML(bar) {
    if (!A || !A.LIVE || !bar || bar.id == null || off.invite_create) return "";
    var id = String(bar.id), h = "";
    var mineHere = INV.filter(function (x) { return x.live && x.status === "open" && String(x.bar_id || "") === id && x.my_answer !== "no"; })[0];
    var up = evRows().filter(function (e) { return String(e.bar_id || "") === id && !e.pending && dayDiff(e.starts_at) >= 1; }).slice(0, 3);
    var left = mineHere ? '<button type="button" class="inv-lnk" data-invopen="' + esc(String(mineHere.id)) + '">📨 ' +
        esc(whenText(mineHere.starts_at) + " · " + mineHere.yes + L(" kommer", " coming")) + "</button>"
      : up.length ? '<span class="inv-up-h">' + esc(L("📅 Kommande här", "📅 Coming up here")) + "</span>" : "";
    h += '<div class="ev-line inv-line' + (left ? "" : " solo") + '"><div class="inv-top"><span class="ev-l-t">' + left + "</span>" +
      '<button type="button" class="btn btn-small inv-here" data-invbar="' + esc(id) + '">' + esc(L("📨 Bjud in hit", "📨 Invite here")) + "</button></div>";
    if (up.length) {
      if (mineHere) h += '<span class="inv-up-h">' + esc(L("📅 Kommande här", "📅 Coming up here")) + "</span>";
      h += up.map(function (e) {
        return '<span class="inv-up-r"><span>' + esc(weekday(e.starts_at) + " " + hhmm(e.starts_at) + " · " + (KIND[e.kind] || "📅") + " " + e.title) + "</span>" +
          '<button type="button" class="btn btn-small inv-ev" data-invev="' + esc(String(e.id)) + '" aria-label="' + esc(L("Bjud in till ", "Invite to ") + e.title) + '">📨</button></span>';
      }).join("");
    }
    h += "</div>";
    return h;
  }
  function evById(id) { return evRows().filter(function (e) { return String(e.id) === String(id); })[0] || null; }
  function evButton(e) {
    if (!A || !A.LIVE || off.invite_create || !e || e.pending) return null;
    var b = A.btn("📨", "btn-small inv-ev", function (ev) { ev.stopPropagation(); openCreate({ event: e }); });
    b.setAttribute("aria-label", L("Bjud in till ", "Invite to ") + e.title); b.title = L("Bjud in", "Invite");
    return b;
  }
  function onDocClick(e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-invbar], [data-invev], [data-invopen]") : null;
    if (!t || !A) return;
    e.preventDefault(); e.stopPropagation();
    try { A.map.closePopup(); } catch (x) {}
    if (t.hasAttribute("data-invopen")) { openInvite(t.getAttribute("data-invopen")); return; }
    if (t.hasAttribute("data-invev")) { var ev = evById(t.getAttribute("data-invev")); if (ev) openCreate({ event: ev }); return; }
    var bar = null; try { bar = window.BARS.byId(t.getAttribute("data-invbar")); } catch (x) {}
    if (bar) openCreate({ bar: bar });
  }

  /* ---------- ticker: events + invites, ~1 in 4 on a quiet night, never two in a row ---------- */
  var cycle = 0, lastWasEv = false, tkUsed = [];
  function isEv(x) { return /^(ev|inv)/.test(String(x && x.k || "")); }
  function quietNight(beers, ctx) {
    var c = ctx && ctx.center, n = 0;
    (beers || []).forEach(function (b) { if (!c || U.haversine(c.lat, c.lng, b.lat, b.lng) <= 5000) n++; });
    return n < 5;
  }
  function tkLine(key, list, d) { var s = fill(pick(key, list), d); return s.replace("{Dag}", ""); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function tickerPool(quiet) {
    var out = [], now = Date.now();
    if (!sv()) return out;
    evRows().forEach(function (e) {
      if (e.pending) return;
      var st = Date.parse(e.starts_at); if (!(st > now - 2 * 3600e3)) return;
      var dd = dayDiff(e.starts_at), d = { title: e.title, bar: placeOf(e), tid: hhmm(e.starts_at), dag: dayPhrase(e.starts_at), Dag: cap(dayPhrase(e.starts_at)) };
      var key = dd === 0 ? "tkTonight" : dd === 1 ? "tkTomorrow" : dd <= 6 ? (quiet && Math.random() < 0.4 ? "tkQuiet" : "tkLater") : null;
      if (!key) return;
      out.push({ k: "evMix", text: fill(pick(key, T[key]), d), cls: "", t: e.title, w: dd === 0 ? 3 : dd === 1 ? 2 : 1 });
    });
    INV.forEach(function (x) {
      if (!x.live || x.status !== "open" || x.my_answer === "no") return;
      var st = Date.parse(x.starts_at); if (!(st > now - 3600e3)) return;
      var d = { title: shortTitle(x), bar: placeOf(x), tid: hhmm(x.starts_at), dag: dayPhrase(x.starts_at), n: x.yes | 0, m: x.maybe | 0, grupp: x.group_name || "", om: untilText(st - now) };
      var key = st - now < 3 * 3600e3 && st > now ? "tkSoon" : x.group_name ? (Math.random() < 0.6 ? "tkInvG" : "tkInv") : "tkInv";
      out.push({ k: "invMix", text: fill(pick(key, T[key]), d), cls: "tk-friend", t: x.title, w: 3 });
    });
    out.sort(function (a, b) { return (tkUsed.indexOf(a.text) >= 0) - (tkUsed.indexOf(b.text) >= 0) || b.w - a.w || Math.random() - 0.5; });
    return out;
  }
  function mixEvents(out, beers, ctx) {
    if (!Array.isArray(out) || !out.length) return out;
    cycle++;
    var quiet = quietNight(beers, ctx), ev = out.filter(isEv), non = out.filter(function (x) { return !isEv(x); });
    var target = quiet ? (out.length >= 4 ? (cycle % 2 ? 2 : 1) : 1) : Math.min(ev.length, 2);
    if (ev.length > target) ev = ev.slice(0, target);
    if (quiet && ev.length < target) {
      var have = {}; out.forEach(function (x) { have[x.text] = 1; });
      tickerPool(true).forEach(function (p) {
        if (ev.length >= target || have[p.text]) return;
        if (ev.some(function (x) { return p.t && String(x.text).indexOf(p.t) >= 0; })) return;
        ev.push({ text: p.text, cls: p.cls, k: p.k }); have[p.text] = 1;
        tkUsed.push(p.text); if (tkUsed.length > 30) tkUsed.shift();
      });
      // Room: replace general filler first, never the last dead-town joke.
      while (non.length + ev.length > 6) {
        var ix = -1;
        for (var i = non.length - 1; i >= 0; i--) if (!/^(townQuiet|calm)$/.test(String(non[i].k)) && !/tk-friend|tk-me/.test(non[i].cls || "")) { ix = i; break; }
        if (ix < 0) ix = non.length - 1;
        non.splice(ix, 1);
      }
    }
    if (!non.length) return ev.slice(0, 1);
    while (ev.length > non.length) ev.pop();
    // Spread: every cycle starts with a normal line, an event line never follows another one.
    var res = [], gap = ev.length ? Math.max(1, Math.floor(non.length / ev.length)) : 0, ei = 0;
    non.forEach(function (x, i) {
      res.push(x);
      if (ei < ev.length && (i + 1) % gap === 0) res.push(ev[ei++]);
    });
    while (ei < ev.length) res.push(ev[ei++]);
    for (var j = 1; j < res.length; j++) if (isEv(res[j]) && isEv(res[j - 1])) { res.splice(j, 1); j--; }
    if (lastWasEv && res.length && isEv(res[0])) res.push(res.shift());
    lastWasEv = res.length ? isEv(res[res.length - 1]) : false;
    return res;
  }
  function wrapNews() {
    var N = window.NEWS;
    if (!N || N._invWrapped || typeof N.build !== "function") return;
    var b0 = N.build;
    N.build = function (beers, ctx) {
      var out = b0.apply(N, arguments);
      try { out = mixEvents(out, beers || [], ctx || {}); } catch (e) {}
      return out;
    };
    N._invWrapped = true;
  }

  /* ---------- ⓘ map legend ---------- */
  function legend() {
    var pop = document.getElementById("attrib-pop");
    if (!pop || pop.querySelector(".inv-legend")) return;
    var d = document.createElement("div");
    d.className = "inv-legend";
    d.innerHTML = "<b>" + esc(L("Kartan", "The map")) + "</b>" +
      '<span><i class="lg-pin" aria-hidden="true"></i>' + esc(L("Pins = folk som dricker just nu", "Pins = people drinking now")) + "</span>" +
      '<span><i class="lg-heat" aria-hidden="true"></i>' + esc(L("🔥 Gul–röd glöd = värme ikväll (live + kvällens spår, försvinner kl 05)", "🔥 Glow = heat tonight (live + tonight's trail, gone at 05:00)")) + "</span>" +
      '<span><i class="lg-ghost" aria-hidden="true"></i>' + esc(L("👻 Grå streckade ringar = förra veckan, int' live (syns när dä ä lugnt, eller med 👻). En halv ring = resten ligger under en pin eller utanför skärmen.",
        "👻 Grey dashed rings = last week (not live). Half rings = cut by the screen edge or a pin.")) + "</span>" +
      "<span>📨 " + esc(L("= din inbjudan (syns bara för de inbjudna)", "= your invite (only invited people see it)")) + "</span>";
    pop.appendChild(d);
  }

  /* ---------- deep link ?invite=<id>[&answer=yes|no] ---------- */
  var linkDone = false;
  function linkFromUrl() {
    if (linkDone) return null;
    var q; try { q = new URLSearchParams(location.search); } catch (e) { return null; }
    var id = q.get("inv"); if (!id) return null;
    linkDone = true;
    var ans = q.get("ans");
    try { q.delete("inv"); if (ans) q.delete("ans"); var s = q.toString(); history.replaceState(null, "", location.pathname + (s ? "?" + s : "") + location.hash); } catch (e) {}
    return { id: id, answer: ans };
  }
  function openLink(id, answer) {
    if (!/^\d{1,15}$/.test(String(id || ""))) return;
    var tries = 0;
    (function step() {
      if (!A || !A.authed()) { if (tries++ < 60) setTimeout(step, 500); return; }
      openInvite(id, answer);
    })();
  }

  window.INVITE = {
    T: T, openCreate: openCreate, open: openInvite, openFriendsTab: openFriendsTab, friendsMore: friendsMore, evButton: evButton,
    _mix: mixEvents, _list: function () { return INV; }, _poll: poll, chipText: chipText,
    init: function (api) {
      A = api;
      document.addEventListener("click", onDocClick, true);
      wrapNews(); setTimeout(wrapNews, 0);
      setTimeout(legend, 0);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(true); });
      setInterval(function () { poll(false); }, 10000);
    },
    onAuthed: function () {
      wrapNews(); legend();
      var l = linkFromUrl();
      poll(true).then(function () { if (l) openLink(l.id, l.answer); });
      friends(true);
    },
    onPoll: function () { wrapNews(); poll(false); },
    applyText: function () { var l = document.querySelector("#attrib-pop .inv-legend"); if (l) { l.remove(); legend(); } },
    groupsSheet: function (body) { groupsSheet(body); },
    hudChipsHTML: function () { return chipHTML(); },
    hudClick: function (action, b) {
      if (action !== "inv") return;
      var id = b && b.getAttribute("data-inv"); if (id) openInvite(id);
    },
    barPopupHTML: function (bar) { try { return barHTML(bar); } catch (e) { return ""; } },
    openInviteLink: function (id, answer) { openLink(id, answer); }
  };
})();
