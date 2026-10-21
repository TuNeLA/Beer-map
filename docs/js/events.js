/* Öl Nu v26 — 📅 EVENTS "Ikväll i stan" + 🚩 bar reports (CONTRACT "v26 EXTRAS", migrations 0065 + 0066).
   - events_near(lat, lng, days) → the 🏆 sheet section "📅 Ikväll i stan" (today / 7 days), a line in the bar sheet
     ("🎤 Pubquiz 20:00" + "🪖 Vi går!"), ticker lines (rides on BARSPLUS.newsTemplates/newsCands like after.js).
   - "🪖 Vi går!" = create_rally(group, "📅 <event> <time>", place, bar position) + notify-group {event:"rally"} (no new push).
   - "➕ Tipsa om ett event" → submit_event(); it shows only for the sender ("väntar på godkännande") until the owner
     approves it in stats.html (owner_events / owner_set_event, owner key).
   - Bar sheet "🚩 Fel plats / stängt?" → report_bar() (1 per bar per 7 days, 10 per day). Owner view in stats.html.
   Hooks (app.js mods): init, onAuthed, onPoll, topSheet, barPopupHTML, applyText. Missing RPCs (old database) →
   that part hides quietly. Polls events_near at most every 10 min (and when the 🏆 sheet opens, cached 2 min). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, esc = U.esc;
  var A = null, off = { ev: false, rep: false }, cache = { at: 0, key: "", rows: [] }, busy = false, wrapped = false;
  var SEEN_KEY = "olnu.evSeen", REP_KEY = "olnu.barRep";
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

  /* ---------- texts (dalmål + military, ä for é) ---------- */
  var KIND = { quiz: "🧠", live: "🎸", dj: "🎧", karaoke: "🎤", sport: "📺", standup: "🎭", party: "🎉", other: "📅" };
  var KIND_L = { quiz: ["Quiz", "Quiz"], live: ["Livemusik", "Live music"], dj: ["DJ / klubb", "DJ / club"], karaoke: ["Karaoke", "Karaoke"],
    sport: ["Sport på tv", "Sports on TV"], standup: ["Standup", "Stand-up"], party: ["Fest", "Party"], other: ["Annat", "Other"] };
  var T = {
    head: ["📅 Ikväll i stan", "📅 Tonight in town"],
    week: ["📅 Veckan i stan", "📅 This week in town"],
    empty: ["Inga event inrapporterade i {stad} ikväll. Underrättelsetjänsten sover. Tipsa du!",
      "Tyst på eventfronten i {stad}. Antingen ä det lugnt, eller så har ingen berättat.",
      "Inget på schemat i {stad}. Gör ett eget: säg ”skål” högt nånstans.",
      "Spaningen hittade inga event i {stad} ikväll. Fältet ä öppet för ditt tips.",
      "Kalendern ä tom i {stad}. Dalregementet föreslår egen pubquiz: ”vem ä törstigast?”"],
    emptyEn: ["No events reported in {stad} tonight. Be the first to add one!"],
    tip: ["➕ Tipsa om ett event", "➕ Add an event"],
    go: ["🪖 Vi går!", "🪖 We're going!"],
    pending: ["⏳ väntar på godkännande", "⏳ waiting for approval"],
    open: ["🌐 Läs mer", "🌐 More"],
    goBody: ["📅 {title} {tid}", "📅 {title} {tid}"],
    goOk: ["🪖 Inkallelsen ä ute! Truppen marscherar mot {bar}.", "🪖 Kallat! Nu vet gänget var striden står: {bar}.",
      "📯 Samling vid {bar}! Inkallelsen gick ut.", "🪖 Order skickad: {bar}, {tid}. Den som kommer sist bjuder på vatten.",
      "🥁 Trumman går! Gänget ä kallat till {bar}."],
    pickGroup: ["Vilken grupp kallar du?", "Which group?"],
    noGroup: ["Du behöver en grupp för att kalla in folk. 👥 Grupper → skapa en.", "You need a group to call people. 👥 Groups → create one."],
    sent: ["📅 Tack! Tipset ä hos högkvarteret. Syns för alla när det ä godkänt.", "📅 Inrapporterat! Generalstaben granskar och godkänner.",
      "📅 Mottaget, soldat. Eventet syns för dig nu och för alla efter godkännande.", "📅 Tack för spaningen! Godkännande pågår."],
    sentEn: ["📅 Thanks! It shows for everyone once approved."],
    title: ["Vad händer?", "What's happening?"],
    titlePh: ["t.ex. Pubquiz, Trubadur, Hockey på storbild", "e.g. Pub quiz, live band"],
    when: ["När?", "When?"],
    where: ["Var?", "Where?"],
    link: ["Länk (valfri)", "Link (optional)"],
    send: ["📤 Skicka tips", "📤 Send"],
    noBars: ["Inga krogar i närheten på kartan. Zooma in där eventet ä.", "No bars near the map centre. Zoom in where it is."],
    errs: { invalid_event: ["Kolla titeln (3–80 tecken, inga länkar) och tiden (inom 60 dagar).", "Check the title (3–80 chars, no links) and the time (within 60 days)."],
      slow_down: ["Lugn i stormen – max 5 tips om dan.", "Easy – max 5 tips a day."], outside_sweden: ["Den platsen hittar vi int'.", "Unknown place."],
      error: ["Nåt gick snett. Försök igen.", "Something went wrong. Try again."] },
    // bar report
    rep: ["🚩 Fel plats / stängt?", "🚩 Wrong place / closed?"],
    repTitle: ["🚩 Rapportera krogen", "🚩 Report this bar"],
    repKinds: [["closed", "🚪 Stängt / finns int' mer", "🚪 Closed / gone"], ["wrong_place", "📍 Fel plats på kartan", "📍 Wrong place on the map"],
      ["duplicate", "👯 Dubblett", "👯 Duplicate"], ["not_bar", "🍽️ Ingen krog (bara mat e.d.)", "🍽️ Not a bar"], ["other", "✏️ Annat", "✏️ Other"]],
    repNote: ["Kort förklaring (valfri)", "Short note (optional)"],
    repSend: ["📤 Skicka rapport", "📤 Send report"],
    repOk: ["🚩 Tack! Kartografen ä underrättad.", "🚩 Rapporten ä inne. Vi kollar krogen.", "🚩 Mottaget. Lantmäteriet i Ludvika tar hand om't.",
      "🚩 Tack för spaningen! Fel på kartan ä fiendens bästa vän.", "🚩 Noterat i liggaren. Tack, soldat."],
    repAgain: ["🚩 Du har redan rapporterat den här. Vi uppdaterade din rapport.", "🚩 Updated your earlier report."],
    repErr: { slow_down: ["Lugn – max 10 rapporter om dan.", "Max 10 reports a day."], invalid_msg: ["Max 200 tecken, inga länkar.", "Max 200 chars, no links."] },
    news: ["📅 Ikväll i {stad}: {title} på {bar} kl {tid}.", "🎤 Underrättelse: {title} vid {bar} {tid}. Klä dig för strid.",
      "📅 Kvällens order: {title}, {bar}, {tid}. Uppställning i tid!", "📻 Radion sprakar: {title} på {bar} ikväll ({tid}).",
      "🪖 Rekognosering klar: {bar} kör {title} kl {tid}.", "📅 {bar} laddar för {title} kl {tid}. Dalregementet ä informerat.",
      "🎺 Signal till samling: {title} kl {tid} på {bar}.", "🗓️ Kalendern säger {title} på {bar}. Klockan {tid}. Hä ä bara å gå."],
    newsN: ["📅 {n} event i {stad} ikväll. Kolla 🏆 → Ikväll i stan.", "📅 Underrättelserapport: {n} event i {stad} ikväll. Se 🏆.",
      "📅 Fullt program i {stad}: {n} event ikväll. Välj din front i 🏆."]
  };
  function two(k) { return L(T[k][0], T[k][1]); }
  function errText(code, set) {
    var m = (set || T.errs)[code] || T.errs.error;
    return L(m[0], m[1]);
  }

  /* ---------- time / place ---------- */
  var TZ = "Europe/Stockholm";
  function hhmm(iso) {
    var d = new Date(iso); if (!isFinite(d)) return "";
    try { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d); } catch (e) { return d.toTimeString().slice(0, 5); }
  }
  function dayKey(d) {
    try { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); } catch (e) { return d.toISOString().slice(0, 10); }
  }
  // "Evening" day: 00–05 still belongs to the day before (same rule as the app night).
  function eveKey(d) { return dayKey(new Date(d.getTime() - 5 * 3600e3)); }
  function dayLabel(iso) {
    var d = new Date(iso), now = new Date();
    if (eveKey(d) === eveKey(now)) return L("ikväll", "tonight");
    if (eveKey(d) === eveKey(new Date(now.getTime() + 86400e3))) return L("i morron", "tomorrow");
    try { return new Intl.DateTimeFormat(sv() ? "sv-SE" : "en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric" }).format(d); } catch (e) { return dayKey(d); }
  }
  function tonight(e) { var d = new Date(e.starts_at); return eveKey(d) === eveKey(new Date()) && (!e.ends_at || Date.parse(e.ends_at) > Date.now()); }
  function where() {
    var p = null;
    try {
      var me = A.me && A.me();
      if (me && isFinite(me.lat) && isFinite(me.lng) && me.lat !== null) p = { lat: +me.lat, lng: +me.lng };
      if (!p && A.lastLoc) { var l = A.lastLoc(); if (l && isFinite(l.lat) && isFinite(l.lng)) p = { lat: +l.lat, lng: +l.lng }; }
      if (!p && A.map) { var c = A.map.getCenter(); p = { lat: c.lat, lng: c.lng }; }
    } catch (e) {}
    if (!p) p = { lat: 60.1496, lng: 15.1878 };
    p.lng = ((((p.lng + 180) % 360) + 360) % 360) - 180; p.lat = Math.max(-85, Math.min(85, p.lat));
    return p;
  }
  function townOf(p) { var c = null; try { c = window.CITIES && window.CITIES.nearest(p.lat, p.lng); } catch (e) {} return c ? c.name : ""; }
  function placeOf(e) {
    var b = null; try { b = e.bar_id && window.BARS && window.BARS.byId(e.bar_id); } catch (x) {}
    return (b && b.name) || e.place || e.town || L("okänd plats", "unknown place");
  }

  /* ---------- data ---------- */
  function load(force, days) {
    if (!A || !A.LIVE || off.ev || !A.authed || !A.authed()) return Promise.resolve(cache.rows);
    var p = where(), key = (Math.round(p.lat * 20) / 20) + "," + (Math.round(p.lng * 10) / 10) + ":" + (days || 7);
    if (!force && key === cache.key && Date.now() - cache.at < 120000) return Promise.resolve(cache.rows);
    if (busy) return Promise.resolve(cache.rows);
    busy = true;
    return A.rpc("events_near", { p_lat: p.lat, p_lng: p.lng, p_days: days || 7 }).then(function (r) {
      busy = false;
      if (r.error) { if (U.missing(r.error)) off.ev = true; return cache.rows; }
      cache = { at: Date.now(), key: key, rows: Array.isArray(r.data) ? r.data : [] };
      try { if (A.renderTicker) A.renderTicker(); } catch (e) {}
      return cache.rows;
    });
  }
  function forBar(id) {
    id = String(id || ""); if (!id) return [];
    return cache.rows.filter(function (e) { return String(e.bar_id || "") === id && tonight(e); });
  }

  /* ---------- 🪖 Vi går! ---------- */
  function goFor(e, b) {
    if (!A) return;
    A.rpc("my_groups").then(function (r) {
      var gs = Array.isArray(r.data) ? r.data : [];
      if (!gs.length) { A.toast(two("noGroup"), { err: true }); return; }
      if (gs.length === 1) { rally(e, gs[0], b); return; }
      A.openSheet(two("pickGroup"), function (body) {
        gs.forEach(function (g) { body.appendChild(A.btn("👥 " + g.name, "btn-block ev-g", function () { A.closeSheet(); rally(e, g, null); })); });
      }, { now: true });
    });
  }
  function rally(e, g, b) {
    if (b) b.disabled = true;
    var bar = placeOf(e), tid = hhmm(e.starts_at);
    var body = fill(two("goBody"), { title: e.title, tid: tid }).slice(0, 100);
    var params = { p_group_id: g.id, p_body: body, p_place: String(bar).slice(0, 60) };
    if (isFinite(e.lat) && isFinite(e.lng) && e.lat != null) { params.p_lat = e.lat; params.p_lng = e.lng; }
    A.rpc("create_rally", params).then(function (r) {
      if (b) b.disabled = false;
      if (r.error) { var c = U.errCode(r.error); A.toast(c === "slow_down" ? L("Lugn – en inkallelse per 3 min.", "Easy – one call-out per 3 min.") : errText("error"), { err: true }); return; }
      var j = A.parseData(r.data);
      if (j && j.id) A.invoke("notify-group", { event: "rally", rally_id: j.id });
      A.toast(fill(pick("goOk", sv() ? T.goOk : ["🪖 Called! The squad marches to {bar}."]), { bar: bar, tid: tid }));
      try { window.FX.unlock(); window.FX.sound.clink(); window.FX.vibrate([20, 40, 20]); } catch (x) {}
      try { A.refresh(true); } catch (x) {}
    });
  }

  /* ---------- 🏆 section ---------- */
  function rowEl(e) {
    var li = A.el("li", { class: "ev-row" + (e.pending ? " ev-pending" : "") });
    var main = A.el("button", { type: "button", class: "ev-main", onclick: function () { openOn(e); } }, [
      A.el("span", { class: "ev-time", text: hhmm(e.starts_at) }),
      A.el("span", { class: "ev-txt" }, [
        A.el("b", { text: (KIND[e.kind] || "📅") + " " + e.title }),
        A.el("span", { class: "ev-sub", text: placeOf(e) + (tonight(e) ? "" : " · " + dayLabel(e.starts_at)) + (e.km != null && e.km > 1.5 ? " · " + String(e.km).replace(".", ",") + " km" : "") +
          (e.pending ? " · " + two("pending") : "") })
      ])
    ]);
    li.appendChild(main);
    var acts = A.el("span", { class: "ev-acts" });
    if (!e.pending) acts.appendChild(A.btn(two("go"), "btn-small ev-go", function (ev) { goFor(e, ev.currentTarget); }));
    try { var ib = window.INVITE && window.INVITE.evButton && window.INVITE.evButton(e); if (ib) acts.appendChild(ib); } catch (x) {}
    if (e.url) acts.appendChild(A.el("a", { class: "ev-link", href: e.url, target: "_blank", rel: "noopener nofollow", text: "🌐", title: two("open"), "aria-label": two("open") }));
    li.appendChild(acts);
    return li;
  }
  function openOn(e) {
    var b = null; try { b = e.bar_id && window.BARS.byId(e.bar_id); } catch (x) {}
    if (b && A.openBar) { A.closeSheet(); A.openBar(b); return; }
    if (isFinite(e.lat) && e.lat != null) A.flyTo(e.lat, e.lng, 16);
  }
  var tab = "tonight";
  function section() {
    var p = where(), town = townOf(p) || L("stan", "town");
    var box = A.el("div", { class: "ev-box" });
    var h = A.el("h3", { class: "ev-h", text: two("head") });
    var tabs = A.el("div", { class: "tabs ev-tabs", role: "tablist" });
    var list = A.el("ol", { class: "ev-list" }), note = A.el("p", { class: "muted ev-note" });
    function draw(rows) {
      list.innerHTML = ""; note.textContent = "";
      var show = (rows || []).filter(function (e) { return tab === "tonight" ? tonight(e) : true; }).slice(0, tab === "tonight" ? 12 : 30);
      h.textContent = tab === "tonight" ? two("head") : two("week");
      if (!show.length) { note.textContent = fill(sv() ? pick("empty", T.empty) : T.emptyEn[0], { stad: town }); return; }
      show.forEach(function (e) { list.appendChild(rowEl(e)); });
    }
    [["tonight", L("Ikväll", "Tonight")], ["week", L("7 dagar", "7 days")]].forEach(function (k) {
      tabs.appendChild(A.el("button", { type: "button", role: "tab", "aria-selected": String(tab === k[0]), text: k[1], onclick: function () {
        tab = k[0]; tabs.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-selected", String(x.textContent === k[1])); }); draw(cache.rows);
      } }));
    });
    box.appendChild(h); box.appendChild(tabs); box.appendChild(list); box.appendChild(note);
    box.appendChild(A.btn(two("tip"), "btn-small btn-block ev-tip", function () { tipForm(null); }));
    draw(cache.rows);
    load(false, 7).then(function (rows) { if (off.ev) box.remove(); else if (document.body.contains(box)) draw(rows); });
    return box;
  }

  /* ---------- ➕ submit ---------- */
  function localInput(d) { var z = function (n) { return ("0" + n).slice(-2); }; return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(d.getHours()) + ":" + z(d.getMinutes()); }
  function tipForm(bar) {
    var p = bar ? { lat: bar.lat, lng: bar.lng } : where();
    var near = [];
    try { near = window.BARS.nearby(p.lat, p.lng, 3000, 25, {}).map(function (x) { return x.bar; }); } catch (e) {}
    if (bar && !near.some(function (b) { return String(b.id) === String(bar.id); })) near.unshift(bar);
    A.openSheet(two("tip"), function (body) {
      var title = A.el("input", { class: "inp", maxlength: "80", placeholder: two("titlePh"), "aria-label": two("title") });
      var d0 = new Date(); d0.setHours(d0.getHours() < 18 ? 20 : d0.getHours() + 1, 0, 0, 0);
      var when = A.el("input", { class: "inp", type: "datetime-local", value: localInput(d0), "aria-label": two("when") });
      var sel = A.el("select", { class: "inp", "aria-label": two("where") });
      near.forEach(function (b) { sel.appendChild(A.el("option", { value: String(b.id), text: b.name })); });
      if (bar) sel.value = String(bar.id);
      var kind = "other", chips = A.el("div", { class: "ev-kinds" });
      Object.keys(KIND).forEach(function (k) {
        chips.appendChild(A.el("button", { type: "button", class: "chip ev-k", "data-k": k, "aria-pressed": "false", text: KIND[k] + " " + L(KIND_L[k][0], KIND_L[k][1]), onclick: function (ev) {
          kind = k; chips.querySelectorAll(".ev-k").forEach(function (x) { x.setAttribute("aria-pressed", String(x === ev.currentTarget)); });
        } }));
      });
      var link = A.el("input", { class: "inp", type: "url", maxlength: "300", placeholder: "https://…", "aria-label": two("link") });
      var go = A.btn(two("send"), "btn-green btn-block", function () {
        var at = new Date(when.value);
        var b = near.filter(function (x) { return String(x.id) === sel.value; })[0];
        if (!b) { A.toast(two("noBars"), { err: true }); return; }
        go.disabled = true;
        A.rpc("submit_event", { p_title: title.value, p_starts_at: isFinite(at) ? at.toISOString() : null, p_bar_id: String(b.id),
          p_place: String(b.name || "").slice(0, 60), p_lat: b.lat, p_lng: b.lng, p_kind: kind, p_url: link.value.trim() || null }).then(function (r) {
          go.disabled = false;
          if (r.error) { if (U.missing(r.error)) { off.ev = true; A.closeSheet(); return; } A.toast(errText(code(r.error, ["invalid_event", "slow_down", "outside_sweden"])), { err: true }); return; }
          A.closeSheet(); A.toast(sv() ? pick("sent", T.sent) : T.sentEn[0]);
          load(true, 7);
        });
      });
      body.appendChild(A.el("label", { class: "ev-l", text: two("title") })); body.appendChild(title);
      body.appendChild(A.el("label", { class: "ev-l", text: two("when") })); body.appendChild(when);
      body.appendChild(A.el("label", { class: "ev-l", text: two("where") }));
      if (near.length) body.appendChild(sel); else body.appendChild(A.el("p", { class: "muted", text: two("noBars") }));
      body.appendChild(chips);
      body.appendChild(A.el("label", { class: "ev-l", text: two("link") })); body.appendChild(link);
      body.appendChild(A.el("p", { class: "muted ev-legal", text: L("Bara riktiga event. Inga erbjudanden om billig sprit (alkohollagen). Ägaren godkänner innan det syns för alla.",
        "Real events only. No cheap-drink offers. The owner approves before everyone sees it.") }));
      body.appendChild(go);
    }, { now: true });
  }
  function code(err, list) {
    var m = String((err && (err.message || err.details)) || "");
    for (var i = 0; i < list.length; i++) if (m.indexOf(list[i]) >= 0) return list[i];
    return "error";
  }

  /* ---------- 🚩 report ---------- */
  function reportSheet(bar) {
    if (!A || off.rep) return;
    A.openSheet(two("repTitle"), function (body) {
      body.appendChild(A.el("p", { class: "ev-rep-bar", text: "🍺 " + (bar.name || "?") }));
      try { if (window.BAREA && window.BAREA.reportHook) window.BAREA.reportHook(body, bar); } catch (e) {}   // ✏️ Rita krogens yta
      var kind = "", chips = A.el("div", { class: "ev-kinds" });
      T.repKinds.forEach(function (k) {
        chips.appendChild(A.el("button", { type: "button", class: "chip ev-rk", "aria-pressed": "false", text: L(k[1], k[2]), onclick: function (ev) {
          kind = k[0]; chips.querySelectorAll(".ev-rk").forEach(function (x) { x.setAttribute("aria-pressed", String(x === ev.currentTarget)); }); send.disabled = false;
        } }));
      });
      var note = A.el("textarea", { class: "inp", maxlength: "200", rows: "2", placeholder: two("repNote") });
      var send = A.btn(two("repSend"), "btn-green btn-block", function () {
        if (!kind) return;
        send.disabled = true;
        var me = null; try { me = A.lastLoc && A.lastLoc(); } catch (e) {}
        A.rpc("report_bar", { p_bar_id: String(bar.id), p_bar_name: String(bar.name || "").slice(0, 60), p_kind: kind, p_note: note.value.trim() || null,
          p_lat: me && isFinite(me.lat) ? me.lat : null, p_lng: me && isFinite(me.lng) ? me.lng : null }).then(function (r) {
          send.disabled = false;
          if (r.error) { if (U.missing(r.error)) { off.rep = true; A.closeSheet(); return; } A.toast(errText(code(r.error, ["slow_down", "invalid_msg"]), T.repErr), { err: true }); return; }
          var j = A.parseData(r.data);
          var mine = U.ls.getJSON(REP_KEY, {}) || {}; mine[String(bar.id)] = Date.now(); U.ls.setJSON(REP_KEY, mine);
          A.closeSheet(); A.toast(j && j.already ? two("repAgain") : sv() ? pick("repOk", T.repOk) : "🚩 Thanks! We'll check it.");
        });
      });
      send.disabled = true;
      body.appendChild(chips); body.appendChild(note); body.appendChild(send);
    }, { now: true });
  }

  /* ---------- bar sheet ---------- */
  function barHTML(bar) {
    if (!bar || bar.id == null) return "";
    var h = "", evs = off.ev ? [] : forBar(bar.id).slice(0, 2);
    evs.forEach(function (e) {
      h += '<div class="ev-line"><span class="ev-l-t">' + esc((KIND[e.kind] || "📅") + " " + e.title + " " + hhmm(e.starts_at)) + "</span>" +
        '<button type="button" class="btn btn-small ev-go" data-evgo="' + esc(String(e.id)) + '">' + esc(two("go")) + "</button>" +
        (window.INVITE ? '<button type="button" class="btn btn-small inv-ev" data-invev="' + esc(String(e.id)) + '" aria-label="' + esc(L("Bjud in", "Invite")) + '">📨</button>' : "") + "</div>";
    });
    if (!off.rep && A && A.LIVE && !/^pl_/.test(String(bar.id))) {
      h += '<div class="pp-info ev-rep"><button type="button" class="btn btn-small" data-evrep="' + esc(String(bar.id)) + '">' + esc(two("rep")) + "</button>" +
        '<button type="button" class="btn btn-small" data-evtip="' + esc(String(bar.id)) + '">' + esc(two("tip")) + "</button></div>";
    }
    return h;
  }
  function onDocClick(e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-evgo], [data-evrep], [data-evtip]") : null;
    if (!t || !A) return;
    e.preventDefault(); e.stopPropagation();
    var bar = null, id = t.getAttribute("data-evrep") || t.getAttribute("data-evtip");
    if (id) { try { bar = window.BARS.byId(id); } catch (x) {} if (!bar) return; }
    if (t.hasAttribute("data-evrep")) { A.map.closePopup(); reportSheet(bar); return; }
    if (t.hasAttribute("data-evtip")) { A.map.closePopup(); tipForm(bar); return; }
    var ev = cache.rows.filter(function (x) { return String(x.id) === t.getAttribute("data-evgo"); })[0];
    if (ev) goFor(ev, t);
  }

  /* ---------- ticker (rides on BARSPLUS like after.js) ---------- */
  function newsTemplates() {
    var out = [];
    T.news.forEach(function (line) { out.push({ k: "evTonight", f: function (d) { return fill(line, d); } }); });
    T.newsN.forEach(function (line) { out.push({ k: "evCount", f: function (d) { return fill(line, d); } }); });
    try { if (window.GOLDEN && window.GOLDEN.newsTemplates) out = out.concat(window.GOLDEN.newsTemplates() || []); } catch (e) {}
    return out;
  }
  function newsCands() {
    var out = [];
    if (!off.ev && sv()) {
      var now = Date.now(), p = where(), town = townOf(p) || "stan";
      var tn = cache.rows.filter(function (e) { return tonight(e) && !e.pending && Date.parse(e.starts_at) > now - 2 * 3600e3; });
      tn.slice(0, 2).forEach(function (e, i) { out.push({ k: "evTonight", d: { title: e.title, bar: placeOf(e), tid: hhmm(e.starts_at), stad: town }, imp: i ? 0 : 1 }); });
      if (tn.length >= 3) out.push({ k: "evCount", d: { n: tn.length, stad: town }, imp: 0 });
    }
    try { if (window.GOLDEN && window.GOLDEN.newsCands) out = out.concat(window.GOLDEN.newsCands() || []); } catch (e) {}
    return out;
  }
  function hookNews() {
    var bp = window.BARSPLUS;
    if (!bp || bp._evWrapped) return;
    var t0 = bp.newsTemplates, c0 = bp.newsCands;
    bp.newsTemplates = function () { var a = []; try { a = t0 ? t0.apply(bp, arguments) || [] : []; } catch (e) {} return a.concat(newsTemplates()); };
    bp.newsCands = function (ctx) { var a = []; try { a = c0 ? c0.apply(bp, arguments) || [] : []; } catch (e) {} return a.concat(newsCands(ctx)); };
    bp._evWrapped = true; wrapped = true;
  }

  /* ---------- toasts: an event at my check-in bar tonight (once per event) ---------- */
  function noticeAtBar() {
    var ci = null; try { ci = A.myCheckin && A.myCheckin(); } catch (e) {}
    if (!ci) return;
    var evs = forBar(ci.bar_id || ci.id); if (!evs.length) return;
    var seen = U.ls.getJSON(SEEN_KEY, []) || [], e = evs[0];
    if (seen.indexOf(e.id) >= 0) return;
    seen.push(e.id); U.ls.setJSON(SEEN_KEY, seen.slice(-40));
    A.toast((KIND[e.kind] || "📅") + " " + L("Ikväll här: ", "Tonight here: ") + e.title + " " + hhmm(e.starts_at));
  }

  var pollAt = 0;
  window.EVENTS = {
    init: function (api) {
      A = api;
      document.addEventListener("click", onDocClick, true);
      hookNews(); setTimeout(hookNews, 0);
    },
    onAuthed: function () { pollAt = Date.now(); load(true, 7); },
    onPoll: function () {
      hookNews();
      if (Date.now() - pollAt < 10 * 60000) { noticeAtBar(); return; }
      pollAt = Date.now(); load(true, 7).then(noticeAtBar);
    },
    topSheet: function (body) {
      if (!A || !A.LIVE || off.ev || !A.authed || !A.authed()) return;
      body.appendChild(section());
    },
    barPopupHTML: function (bar) { try { return barHTML(bar); } catch (e) { return ""; } },
    applyText: function () {},
    // tests / other modules
    _cache: function () { return cache; }, _load: load, report: reportSheet, tip: tipForm, go: goFor, hhmm: hhmm, T: T
  };
})();
