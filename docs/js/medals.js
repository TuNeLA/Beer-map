/* Öl Nu v11 — MEDALS & RANKS (CONTRACT "v11 MEDALS & RANKS").
   Medals live on the server (user_medals) so group-mates can see them. This file has:
   the medal catalog (names + funny texts), award/claim calls, the "Uniform" sheet (rank + all medals),
   the medal row for the group view, the level-up popup and the "Ta det lugnt" nudge.
   It is driven from extras.js / social.js hooks (app.js mods() does not know this file).
   Every RPC may be missing on an older database: medals then fall back to the old local badges. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, esc = U.esc;
  var A = null;
  var off = {};
  function sv() { return I.lang !== "en"; }
  function L(s, e) { return sv() ? s : (e || s); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  /* ---------- Catalog: [id, emoji, name, funny line (earned), how to get it, stacks, secret] ---------- */
  var CAT = [
    ["m1", "🍺", "Första kapsylen", "Det började här. Mamma vore stolt (typ).", "Drick din första öl i appen."],
    ["m10", "🔟", "Tian", "Tio öl i tjänst. Du har ett rykte nu.", "10 öl totalt."],
    ["m50", "🪙", "Femtiolappen", "Femtio öl. Kapsylerna räcker till ett halsband.", "50 öl totalt."],
    ["m100", "💯", "Hundringen", "Hundra öl. Grangärde pratar om dig.", "100 öl totalt."],
    ["m250", "🛢️", "Kvartstusen", "Ett helt fat, i lugna omgångar. Respekt.", "250 öl totalt."],
    ["m500", "🏺", "Halvtusen", "500 öl. Arkeologer kommer att hitta dina kapsyler.", "500 öl totalt."],
    ["m1000", "🏛️", "Tusenåringen", "Tusen öl. Någon borde resa ett monument.", "1000 öl totalt."],
    ["n5", "🌙", "Nattpatrull", "Fem kvällar ute. Dörrvakterna nickar åt dig.", "Var ute 5 kvällar."],
    ["n25", "🦇", "Nattveteran", "25 kvällar. Månen hälsar på dig.", "Var ute 25 kvällar."],
    ["n100", "🌌", "Hundra nätter", "Hundra kvällar ute. En saga i sig.", "Var ute 100 kvällar."],
    ["b5", "🗺️", "Krogturist", "Fem olika barer. Du har pass nu.", "Checka in på 5 olika barer."],
    ["b15", "🧭", "Kartläsare", "15 barer. Du hittar dit i mörker.", "Checka in på 15 olika barer."],
    ["b40", "📜", "Krogkartograf", "40 barer. Lantmäteriet vill anställa dig.", "Checka in på 40 olika barer."],
    ["krogrunda", "🦘", "Krogrunda", "Tre barer på en kväll. Det är en turné!", "Checka in på 3 barer samma kväll.", 1],
    ["stammis", "🪑", "Stammis", "Bartendern vet redan vad du ska ha.", "Samma bar 5 olika kvällar.", 1],
    ["sg10", "🥂", "Skålbroder", "Tio skål till andra. Generös själ.", "Skåla med andra 10 gånger."],
    ["sg100", "🎉", "Skålkanonen", "Hundra skål! Kvällens värd, varje kväll.", "Skåla med andra 100 gånger."],
    ["sr10", "🍻", "Folkkär", "Tio skål till dig. Folket älskar dig.", "Få 10 skål."],
    ["sr100", "🧲", "Skålmagneten", "100 skål. Glasen dras till dig.", "Få 100 skål."],
    ["inryckt", "🪖", "Inryckt", "Du svarade ja på en inkallelse. Plikten kallade!", "Svara ja på en inkallelse."],
    ["alltid", "🫡", "Alltid redo", "Tio inkallelser, tio ja. Pålitlig som kyrkklockan.", "Svara ja på 10 inkallelser."],
    ["trumslag", "📯", "Trumslagaren", "Du blåste till samling. Folket kom.", "Skicka en inkallelse."],
    ["hemvarn", "🏠", "Hemvärnet", "Du sa ”jag är hemma”. Klokt, soldat.", "Tryck ”Jag är hemma” en kväll.", 1],
    ["komhem", "🛡️", "Kom hem säkert", "Fem kvällar hem i god ordning. Finaste medaljen.", "Tryck ”Jag är hemma” 5 kvällar.", 1],
    ["vatten", "💧", "Vattenbäraren", "Du drack vatten när appen sa till. Legend.", "Tryck ”💧 Druckit vatten” vid en vattenpåminnelse.", 1],
    ["dagsljus", "☀️", "Dagsljusdivisionen", "Öl medan solen står på himlen.", "En öl före kl 16.", 1],
    ["uggla", "🦉", "Nattugglan", "Sent ute. Ugglan nickar gillande.", "En öl mellan 01 och 05.", 1],
    ["tisdag", "🌮", "Tisdagstörst", "En helt vanlig tisdag. Eller?", "En öl en tisdag.", 1],
    ["fortrupp", "🚩", "Förtruppen", "Först ute i gruppen. Någon måste ju.", "Var först ute i din grupp en kväll.", 1],
    ["kung", "👑", "Barkungen", "Kung av en bar en hel vecka. Kronan klär dig.", "Bli Kung av baren.", 1],
    ["liga", "🥇", "Ligamästare", "Din grupp vann veckan. Ära åt plutonen!", "Vinn grupp-ligan en vecka.", 1],
    ["pluton", "🫂", "Plutonen", "Du har ett gäng. Ingen dricker ensam.", "Gå med i en grupp."],
    ["kompani", "🏰", "Kompanichef", "Din grupp har fem man eller fler.", "Skapa en grupp med 5+ medlemmar.", 1],
    ["radio", "💬", "Radiokontakt", "Första meddelandet i chatten. Över.", "Skriv i gruppchatten."],
    ["signal", "📻", "Signalisten", "50 meddelanden. Radion glöder.", "Skriv 50 meddelanden i chatten."],
    ["valborg", "🪵", "Valborgsveteran", "Ute på Valborg. Brasan och du.", "Var ute på Valborg (30 april).", 1],
    ["midsommar", "🌼", "Midsommarsoldat", "Midsommarafton i tjänst. Små grodorna applåderar.", "Var ute på midsommarafton.", 1],
    ["lucia", "🕯️", "Luciatåget", "Ute på Lucia. Ett ljus i mörkret.", "Var ute på Lucia (13 dec).", 1],
    ["nyar", "🎆", "Nyårssmällen", "Nyårsafton i tjänst. Gott nytt öl!", "Var ute på nyårsafton.", 1],
    ["faltresa", "🚂", "Fältresa", "Öl i en helt annan trakt. Nästan utlandstjänst.", "Ta en öl i en annan trakt (~50 km bort).", 1],
    ["sidospar", "🥃", "Sidospår", "Du tog nåt annat än öl. Ölguden förlåter.", "Logga en annan drink.", 1],
    ["spoke", "👻", "Spökpatrullen", "Du drack i hemlighet. Ingen vet. Utom vi.", "Drick en öl i spökläge.", 1],
    // v12 KROGARNA (0014)
    ["kospanare", "🚶", "Köspanaren", "Fem kö-rapporter. Dörrvakten har sett dig med kikare.", "Rapportera kön på en krog 5 gånger."],
    ["sommelier", "⭐", "Ölsommelieren", "Fem olika ölsorter. Du säger ”fruktiga toner” nu. Förlåt oss.", "Välj 5 olika ölsorter efter ÖL!."],
    ["erovrare", "🏰", "Erövraren", "Din grupp tog över en krog. Flaggan vajar i Dalarna!", "Ta över en krog med din grupp (flest incheckade).", 1],
    ["tipsare", "📣", "Kunskapsspridaren", "Tre krogtips. Du är gruppens egen nöjesguide.", "Tipsa gruppen om en krog 3 gånger."],
    // "Varit med om": hidden until earned, caring text, never a goal.
    ["het", "🔥", "Varit med om: het kväll", "Du har varit med om en het kväll. Drick vatten och ta det lugnt nästa gång.", "", 1, 1],
    ["medevac", "🚁", "Varit med om: medevac", "Du har varit med om en medevac-kväll. Vi är glada att du kom hem. Ta det lugnt. 💧", "", 1, 1]
  ];
  var BY = {};
  CAT.forEach(function (c, i) { BY[c[0]] = { id: c[0], e: c[1], name: c[2], line: c[3], how: c[4], stack: !!c[5], secret: !!c[6], i: i }; });
  function info(id) { return BY[id] || { id: id, e: "🎖️", name: id, line: "", how: "", i: 999 }; }

  // Old local badges (extras.js) -> server medals the client may claim once.
  var LEGACY = { early: "dagsljus", owl: "uggla", home01: "hemvarn", chat: "radio", side: "sidospar", ghost: "spoke", barhop: "krogrunda" };

  /* ---------- RPC ---------- */
  function call(name, params) {
    if (!A || !A.LIVE || !A.authed() || off[name]) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) { off[name] = true; r.off = true; }
      return r;
    });
  }
  function on() { return !!(A && A.LIVE && !off.my_medals && !off.award_medals); }

  var mine = null;   // id -> {count, at}
  function setMine(rows) {
    var m = {};
    (rows || []).forEach(function (r) { if (r && r.medal) m[r.medal] = { count: Math.max(1, r.count | 0), at: r.earned_at }; });
    mine = m;
  }
  function loadMine() {
    return call("my_medals").then(function (r) { if (!r.error) setMine(r.data); return mine; });
  }

  /* ---------- New medal toast (queued, after the beer toast) ---------- */
  var nextAt = 0;
  function later(fn, delay) {
    var at = Math.max(Date.now() + (delay || 0), nextAt);
    nextAt = at + 2000;
    setTimeout(fn, at - Date.now());
  }
  function announce(rows, quiet) {
    (rows || []).forEach(function (r) {
      if (!r || !r.medal) return;
      var had = mine && mine[r.medal];
      if (!mine) mine = {};
      mine[r.medal] = { count: Math.max(1, r.count | 0), at: r.earned_at || (had && had.at) };
      if (quiet) return;
      var m = info(r.medal);
      if (m.secret) {   // "Varit med om": no fanfare, just the caring line, once.
        if (r.is_new) later(function () { A.toast(m.e + " " + m.line, { cls: "water", ms: 6000 }); }, 2400);
        return;
      }
      var msg = r.is_new ? L("🎖️ Ny medalj: ", "🎖️ New medal: ") + m.e + " " + m.name + "!"
        : m.stack ? L("🎖️ ", "🎖️ ") + m.e + " " + m.name + " ×" + (r.count | 0) : "";
      if (!msg) return;
      later(function () {
        A.toast(msg, { cls: "badge-toast medal-toast", ms: 5000 });
        window.FX.unlock(); window.FX.sound.clink(); window.FX.vibrate([20, 30, 20, 30, 60]);
      }, 2400);
    });
  }

  var lastAward = 0, awardBusy = false, awardAgain = null, SEED_KEY = "olnu.medalsSeeded";
  function award(ev, force) {
    if (!A || !A.LIVE || !A.authed() || off.award_medals) return Promise.resolve();
    if (awardBusy) { awardAgain = ev || awardAgain || ""; return Promise.resolve(); }
    if (!force && !ev && Date.now() - lastAward < 20000) return Promise.resolve();
    awardBusy = true; lastAward = Date.now();
    // First award on this phone (right after the v11 update): old achievements get stored all at
    // once. One summary toast instead of a toast storm.
    var first = U.ls.get(SEED_KEY, "") !== "1";
    var p = mine === null ? loadMine() : Promise.resolve();
    return p.then(function () {
      return call("award_medals", ev ? { p_event: ev } : {});
    }).then(function (r) {
      if (!r || r.error) return;
      var rows = r.data || [];
      U.ls.set(SEED_KEY, "1");
      if (first && rows.length > 1) {
        announce(rows, true);
        later(function () {
          A.toast(L("🎖️ Din uniform har fått " + rows.length + " medaljer! Tryck på din grad och kika.", "🎖️ Your uniform got " + rows.length + " medals!"), { cls: "badge-toast medal-toast", ms: 6500 });
          window.FX.unlock(); window.FX.sound.clink(); window.FX.vibrate([20, 30, 60]);
        }, 2400);
      } else announce(rows, false);
    }).then(function () {
      awardBusy = false;
      if (awardAgain !== null) { var e = awardAgain; awardAgain = null; award(e || null, true); }
      migrate();
    }, function () { awardBusy = false; });
  }
  function claim(id) {
    if (!A || !A.LIVE || !A.authed() || off.claim_medal) return Promise.resolve();
    return call("claim_medal", { p_medal: id }).then(function (r) { if (!r.error) announce(r.data); });
  }
  // Once: old local badges -> server medals (whitelisted, low stakes). Quiet (no toasts).
  var MIG_KEY = "olnu.medalsMigrated";
  function migrate() {
    if (U.ls.get(MIG_KEY, "") === "1" || off.claim_medal || !mine) return;
    U.ls.set(MIG_KEY, "1");
    var have = U.ls.getJSON("olnu.badges", {}) || {};
    Object.keys(LEGACY).forEach(function (k) {
      var id = LEGACY[k];
      if (have[k] && !mine[id]) call("claim_medal", { p_medal: id }).then(function (r) { if (!r.error) announce(r.data, true); });
    });
  }

  /* ---------- Rank helpers ---------- */
  function rankOf(total) {
    var S = window.SOCIAL;
    return S && S.titleFor ? S.titleFor(total) : { title: "", next: null, nextAt: null };
  }
  function rankStart(total) {
    var T = (window.SOCIAL && window.SOCIAL.TITLES) || [[0, ""]], at = 0;
    T.forEach(function (x) { if (total >= x[0]) at = x[0]; });
    return at;
  }
  function rankIndex(title) {
    var T = (window.SOCIAL && window.SOCIAL.TITLES) || [];
    for (var i = 0; i < T.length; i++) if (T[i][1] === title) return i + 1;
    return 0;
  }
  function chevrons(n) { return n >= 30 ? "★★★★" : n >= 22 ? "★★★" : n >= 15 ? "★★" : n >= 8 ? "★" : n >= 4 ? "︽︽" : "︽"; }

  /* ---------- Uniform sheet ---------- */
  function sortedEarned(m) {
    return Object.keys(m || {}).map(function (id) { return { m: info(id), count: m[id].count, at: m[id].at }; })
      .sort(function (a, b) { return a.m.i - b.m.i; });
  }
  function medalRowHTML(m, max) {
    var list = sortedEarned(m), shown = list.slice(0, max || 8), more = list.length - shown.length;
    if (!list.length) return "";
    return shown.map(function (x) {
      return '<span class="md-pip" title="' + esc(x.m.name) + '">' + x.m.e + (x.count > 1 ? "<sub>" + x.count + "</sub>" : "") + "</span>";
    }).join("") + (more > 0 ? '<span class="md-more">+' + more + "</span>" : "");
  }
  // o: {name, isMe, total (lifetime beers or null), medals {id:{count,at}}, back: fn|null}
  function showUniform(o) {
    var el = A.el;
    A.openSheet(o.isMe ? L("🎖️ Min uniform", "🎖️ My uniform") : L("🎖️ Uniform", "🎖️ Uniform"), function (body) {
      if (o.back) body.appendChild(el("div", { class: "row", style: "margin-bottom:6px" }, [A.btn(A.t("back"), "btn-small", o.back)]));
      var total = o.total == null ? null : Math.max(0, o.total | 0);
      var box = el("div", { class: "uni-box" });
      body.appendChild(box);
      var name = o.name || (o.isMe ? A.t("you") : A.t("someone"));
      var h = '<div class="uni-name">' + esc(name) + "</div>";
      if (total != null) {
        var r = rankOf(total), idx = rankIndex(r.title), start = rankStart(total);
        var pct = r.nextAt ? Math.max(0, Math.min(100, Math.round(100 * (total - start) / Math.max(1, r.nextAt - start)))) : 100;
        h += '<div class="uni-chev" aria-hidden="true">' + chevrons(idx) + "</div>" +
          '<div class="uni-rank">' + esc(r.title) + "</div>" +
          '<div class="uni-sub">' + esc(L("Grad ", "Rank ") + idx + "/" + ((window.SOCIAL && window.SOCIAL.TITLES) || []).length + " · " + total + L(" öl totalt", " beers total")) + "</div>" +
          '<div class="rank-bar"><span style="width:' + pct + '%"></span></div>' +
          '<div class="uni-next">' + esc(r.next && r.nextAt ? L(Math.max(0, r.nextAt - total) + " öl kvar till " + r.next, Math.max(0, r.nextAt - total) + " beers left to " + r.next) : L("Högsta grad. Ölguden själv.", "Highest rank.")) + "</div>";
      }
      var m = o.medals || {}, earned = sortedEarned(m);
      h += '<div class="uni-ribbon" aria-label="' + esc(L("Medaljer", "Medals")) + '">' + (earned.length ? medalRowHTML(m, 99) : '<span class="muted">' + esc(L("Inga medaljer än. Uniformen är ren och fin.", "No medals yet.")) + "</span>") + "</div>";
      box.innerHTML = h;

      var visible = CAT.filter(function (c) { return !c[6] || m[c[0]]; });
      body.appendChild(el("h3", { text: L(earned.length + " av " + visible.length + " medaljer", earned.length + " of " + visible.length + " medals") }));
      var grid = el("ul", { class: "medal-grid" });
      earned.forEach(function (x) {
        grid.appendChild(el("li", { class: "medal on" + (x.m.secret ? " soft" : "") }, [
          el("span", { class: "md-e", "aria-hidden": "true", text: x.m.e }),
          el("span", { class: "md-n", text: x.m.name + (x.count > 1 ? " ×" + x.count : "") }),
          el("span", { class: "md-d", text: x.m.line })
        ]));
      });
      CAT.forEach(function (c) {
        if (m[c[0]] || c[6]) return;
        grid.appendChild(el("li", { class: "medal" }, [
          el("span", { class: "md-e", "aria-hidden": "true", text: c[1] }),
          el("span", { class: "md-n", text: c[2] }),
          el("span", { class: "md-d", text: "🔒 " + c[4] })
        ]));
      });
      body.appendChild(grid);
      if (o.isMe) body.appendChild(el("p", { class: "muted", style: "margin-top:10px", text: L("Medaljerna syns för dina gruppkompisar. Inga medaljer för att dricka snabbt — bara för att vara med.", "Your group-mates can see your medals. No medals for drinking fast.") }));
    });
  }
  function showMine() {
    if (!A || !A.LIVE || !A.authed() || off.my_medals) { if (window.EXTRAS && window.EXTRAS.showBadgesLegacy) window.EXTRAS.showBadgesLegacy(); return; }
    var st = window.SOCIAL && window.SOCIAL.stats && window.SOCIAL.stats();
    var me = { name: A.getName() || A.t("you"), isMe: true, total: st ? st.total : null, medals: mine || {} };
    showUniform(me);
    award(null, true).then(function () {
      return loadMine();
    }).then(function (m) {
      if (off.my_medals) return;
      // Repaint only if this sheet is still the uniform.
      var h = document.querySelector(".uni-box");
      if (h && document.body.contains(h)) { me.medals = m || {}; showUniform(me); }
    });
  }

  // Group members' medals (cached 60 s per group). Resolves {byName: {name: medals}, me: medals}.
  var memberCache = {};
  function memberMedals(gid) {
    var c = memberCache[gid];
    if (c && Date.now() - c.at < 60000) return Promise.resolve(c.v);
    return call("member_medals", { p_group_id: gid }).then(function (r) {
      if (r.error) return null;
      var v = { byName: {}, me: {} };
      (r.data || []).forEach(function (x) {
        if (!x || !x.medal) return;
        var tgt = x.is_me ? v.me : (v.byName[x.name || ""] || (v.byName[x.name || ""] = {}));
        tgt[x.medal] = { count: Math.max(1, x.count | 0), at: x.earned_at };
      });
      memberCache[gid] = { at: Date.now(), v: v };
      return v;
    });
  }
  function openMember(g, m, back) {
    var who = { name: m.name, isMe: !!m.is_me, total: m.total != null ? m.total : null, medals: {}, back: back || null };
    if (who.isMe && mine) who.medals = mine;
    memberMedals(g.id).then(function (v) {
      if (v) who.medals = who.isMe ? (mine && Object.keys(mine).length >= Object.keys(v.me).length ? mine : v.me) : (v.byName[m.name || ""] || {});
      showUniform(who);
    });
  }

  /* ---------- Popup (level-up, "ta det lugnt") ---------- */
  var popQ = [], popOpen = false;
  function popup(o) { popQ.push(o); if (!popOpen) setTimeout(nextPop, o.delay || 0); }
  function nextPop() {
    if (popOpen) return;
    var o = popQ.shift(); if (!o) return;
    // Wait for the HOT STREAK / MEDEVAC takeover to finish.
    if (document.querySelector(".takeover")) { popQ.unshift(o); setTimeout(nextPop, 900); return; }
    popOpen = true;
    var wrap = document.createElement("div");
    wrap.className = "mx-pop " + (o.cls || "");
    wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-modal", "false"); wrap.setAttribute("aria-label", o.title || "");
    wrap.innerHTML = '<div class="mx-card"><div class="mx-icon" aria-hidden="true">' + esc(o.icon || "🎖️") + "</div>" +
      '<div class="mx-title">' + esc(o.title || "") + "</div>" + (o.html || "") +
      '<div class="mx-line">' + esc(o.line || "") + '</div><div class="mx-btns"></div></div>';
    var btns = wrap.querySelector(".mx-btns"), timer = null;
    function close() {
      if (!wrap.parentNode) return;
      clearTimeout(timer); wrap.classList.add("out");
      setTimeout(function () { wrap.remove(); popOpen = false; setTimeout(nextPop, 400); }, 200);
    }
    (o.buttons || []).forEach(function (b) {
      var x = document.createElement("button"); x.type = "button"; x.className = "btn btn-small " + (b.cls || "");
      x.textContent = b.label; x.addEventListener("click", function (e) { e.stopPropagation(); close(); if (b.fn) b.fn(); });
      btns.appendChild(x);
    });
    var ok = document.createElement("button"); ok.type = "button"; ok.className = "btn btn-small btn-amber";
    ok.textContent = o.ok || "OK"; ok.addEventListener("click", function (e) { e.stopPropagation(); close(); });
    btns.appendChild(ok);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
    timer = setTimeout(close, o.ms || 9000);
    if (o.fx) o.fx();
  }
  // Random line without repeating the last 10 (per list, per phone).
  function freshLine(key, list) {
    var seen = U.ls.getJSON(key, []); if (!Array.isArray(seen)) seen = [];
    var pool = [];
    for (var i = 0; i < list.length; i++) if (seen.indexOf(i) < 0) pool.push(i);
    var k = pool.length ? pick(pool) : Math.floor(Math.random() * list.length);
    seen.push(k); U.ls.setJSON(key, seen.slice(-10));
    return list[k];
  }

  var LEVEL_LINES = [
    "⬆️ Du har levlat din dryckesegenskap! Nu é du {ny}.",
    "📈 +1 i Törst. +2 i Charm. −1 i Balans.",
    "📜 Ny skill upplåst: öppna kapsyl med tändare. Chans att lyckas: 34 %.",
    "🎲 Du slog en naturlig 20 på törstslaget!",
    "🧙 Byns gamla vise nickar långsamt. Han har sett det här förut.",
    "🗡️ Du hittade: Rostig Kapsylöppnare (+3 mot pilsner).",
    "⚔️ Uppdrag klart: ”Släck törsten i Dalarna”. Belöning: ny grad, inget guld.",
    "🛡️ Din rustning är nu gjord av ölbackar. Försvar +4.",
    "🐴 Dalahästen gnäggar stolt. Den har aldrig gnäggat förut.",
    "✨ XP-mätaren svämmade över. Det luktar humle.",
    "🎺 Fanfar från Grangärde! Ingen vet vem som spelar.",
    "🧭 Ny karta upplåst: Vägen hem (ritad på en servett).",
    "🍺 Bärförmåga +1. Du kan nu bära två glas utan att spilla. Nästan.",
    "🧪 Bryggalkemi nivå höjd. Du kan skilja lager från pilsner. Ibland.",
    "🗺️ Snabbresa upplåst: soffan.",
    "📊 Statistik: Törst 17, Visdom 9, Dansförmåga ???.",
    "👑 Kungen av Väsman skickar en hälsning. Han är en gädda.",
    "🌲 Skogsrået blinkar åt dig. Hon gillar folk med grad.",
    "🥾 Dina stövlar har nu +2 mot halt underlag.",
    "🎒 Du plockade upp: Kall Öl. Den försvann direkt.",
    "🔥 Passiv förmåga: Ölaura. Folk runt dig blir lite gladare.",
    "🧔 Skägg-slot nr 2 upplåst.",
    "🏹 Träffsäkerhet mot pantburken +5.",
    "🗣️ Ny dialog upplåst: ”Ska vi ta en till? …Nä, vatten först.”",
    "🐻 En björn i Säfsnäs hörde om din befordran. Den bryr sig inte. Men ändå.",
    "🎖️ Generalstaben har beslutat. Kaffet var kallt men beslutet varmt.",
    "📯 Budbäraren springer genom Ludvika: ”{ny}! {ny}!”",
    "🍀 Tur +1. Du hittade en tia i jackfickan.",
    "⛏️ Du har fått Järnvilja (direkt från Grängesbergs gruva).",
    "🎮 Achievement unlocked: {ny}. 0,00 % av spelarna är så här coola.",
    "🧊 Frostresistens +3. Krogkön i januari biter inte på dig nu.",
    "🎤 Karaoke-skicklighet höjd. Grannarna har inte bett om det.",
    "🛶 Du kan nu paddla över Väsman. I teorin.",
    "🌭 Ny förmåga: Korvtajming. Du vet exakt när den behövs.",
    "🧠 Intelligens −1, Karisma +3. Bra byte.",
    "⏳ Tålamod +2. Tio minuter mellan ölen känns som ingenting nu.",
    "🪓 Dalkarlen i dig vaknade. Den vill hugga ved och sen ta en öl.",
    "📣 ”Givakt!” ropar någon på krogen. Det var nog till dig.",
    "🎆 Hela Dalarna firar. Eller ja, nån i Smedjebacken visslade.",
    "📋 Questlog uppdaterad: ”Drick vatten mellan ölen” (sidouppdrag, ger bonus-XP).",
    "👁️ Ölguden ser dig. Hen är imponerad men säger inget.",
    "🪙 Du fick 0 guld och 100 % respekt.",
    "🛡️ Ny passiv: Skålsköld. Du blir aldrig ensam med glaset.",
    "💪 Styrka +1. Du kan nu bära hem en hel back. Från affären."
  ];
  function levelUp(oldTitle, newTitle, total) {
    if (!A || !newTitle) return;
    var line = freshLine("olnu.lvlSeen", LEVEL_LINES).replace(/\{ny\}/g, newTitle).replace(/\{gammal\}/g, oldTitle || "");
    var r = rankOf(total | 0);
    popup({
      cls: "mx-level", icon: "⬆️", delay: 2600, ms: 10000,
      title: L("BEFORDRAN!", "PROMOTED!"),
      html: '<div class="mx-ranks">' + (oldTitle ? '<span class="mx-old">' + esc(oldTitle) + '</span><span class="mx-arrow" aria-hidden="true">➜</span>' : "") +
        '<span class="mx-new">' + esc(newTitle) + "</span></div>" +
        (r.next && r.nextAt ? '<div class="mx-sub">' + esc(L("Nästa: " + r.next + " vid " + r.nextAt + " öl", "Next: " + r.next + " at " + r.nextAt)) + "</div>" : ""),
      line: line,
      ok: L("Givakt! 🫡", "Salute! 🫡"),
      buttons: [{ label: L("🎖️ Uniform", "🎖️ Uniform"), fn: showMine }],
      fx: function () {
        window.FX.unlock(); window.FX.sound.hot(); setTimeout(function () { window.FX.sound.clink(); }, 450);
        window.FX.vibrate([60, 40, 60, 40, 160]);
      }
    });
  }

  /* ---------- "Ta det lugnt": a friendly nudge when beers come fast (not a ban) ---------- */
  var CALM_LINES = [
    "🐢 Lugna ner dig lite, innan du blir stammis på Systembolaget.",
    "💧 Ölen springer inte iväg. Ta ett glas vatten, pojk.",
    "🐌 Snigeltempo är också ett tempo. Det bästa tempot.",
    "⏸️ Paus-knappen finns. Den är gratis.",
    "🚦 Gult ljus, kompis. Sakta in lite.",
    "🌲 Skogen står kvar imorgon. Ölen med.",
    "🐴 Även Dalahästen tar det i skritt ibland.",
    "🧘 Andas in. Andas ut. Lite vatten. Sen fortsätter vi.",
    "🍕 Har du ätit nåt? Pizza är också en strategi.",
    "⏳ Kvällen är lång. Fördela krafterna, soldat.",
    "🧊 Kyl ner tempot. Inte bara ölen.",
    "🎖️ Order från staben: ta det lugnt. Det är en order.",
    "🥨 Ta en kringla. Eller en korv. Nåt fast i magen.",
    "🐻 Björnen går i ide för att den har vett. Var som björnen. Fast vaken.",
    "🚶 Gå en sväng. Frisk luft är också en drink.",
    "💧 Ett glas vatten nu = en bättre morgon. Lovar.",
    "🛶 Ro lugnt över Väsman. Ingen vinner på att paddla i cirklar.",
    "📉 Tempot går fortare än börsen 2008. Bromsa lite.",
    "🗣️ Prata lite med folk mellan ölen. Det är ju det som är grejen.",
    "🧓 Farfar i Grangärde säger: ”Int’ ska du skynda, pôjk.”",
    "🦉 Ugglan är klok för att den tar det lugnt. Bli en uggla.",
    "🧭 Vägen hem blir längre ju fortare du kör nu.",
    "🏁 Det här är inget race. Ingen får medalj för fart. Vi har kollat.",
    "🔋 Spara lite batteri till senare ikväll.",
    "🎻 Följ spelmännen. De spelar i lugnt tempo.",
    "🥤 Mellanlanda med en läsk. Piloter gör så.",
    "🐢 Sköldpaddan vann loppet. Kom ihåg det.",
    "😌 Lugn i stugan. Ölen finns kvar om tio minuter också.",
    "🌙 Natten är ung. Ingen brådska, kompis.",
    "🫖 Ingen säger att du ska dricka te. Men lite långsammare kanske?",
    "🪵 Elda lagom, så håller brasan hela kvällen.",
    "🧯 Lite för mycket fart i lägret. Vi kyler ner.",
    "🕰️ Kyrkklockan går långsamt. Följ den.",
    "💃 Dansa en låt mellan ölen. Det räknas som träning.",
    "🎣 Fiske kräver tålamod. Öl också.",
    "🛑 Halt! Vattenpaus vid nästa vägskäl.",
    "📻 Radio Dalarna rapporterar: högt tempo i området. Sänk farten.",
    "🍔 Mat först, öl sen. Klassisk taktik.",
    "🏔️ Det är maraton, inte sprint. Även i Dalarna.",
    "🤝 Kolla läget med kompisarna. Dags för en vattenrunda?",
    "🧃 Vill du imponera? Beställ ett glas vatten. Ingen ser det komma.",
    "🐿️ Ekorren samlar krafter inför vintern. Gör som ekorren."
  ];
  var CALM_WATER = [1, 15];   // lines with a "💧 Jag tar vatten" button
  var TIMES_KEY = "olnu.beerTimes", CALM_KEY = "olnu.calmAt";
  function noteBeer() {
    var now = Date.now(), list = U.ls.getJSON(TIMES_KEY, []);
    if (!Array.isArray(list)) list = [];
    list = list.filter(function (x) { return typeof x === "number" && now - x < 3 * 3600e3; });
    list.push(now); list = list.slice(-12);
    U.ls.setJSON(TIMES_KEY, list);
    var in40 = list.filter(function (x) { return now - x <= 40 * 60e3; }).length;
    var in100 = list.filter(function (x) { return now - x <= 100 * 60e3; }).length;
    if (in40 < 3 && in100 < 5) return;
    var last = +U.ls.get(CALM_KEY, "0") || 0;
    if (now - last < 30 * 60e3) return;
    U.ls.set(CALM_KEY, String(now));
    calmDown();
  }
  function calmDown() {
    var line = freshLine("olnu.calmSeen", CALM_LINES), idx = CALM_LINES.indexOf(line);
    var water = CALM_WATER.indexOf(idx) >= 0;
    popup({
      cls: "mx-calm", icon: "🐢", delay: 3200, ms: 12000,
      title: L("TA DET LUGNT", "EASY THERE"), line: line, ok: L("Okej, okej 😅", "Okay, okay 😅"),
      buttons: water ? [{ label: L("💧 Jag tar vatten", "💧 I'll have water"), cls: "btn-green", fn: function () { waterTaken(); } }] : [],
      fx: function () { window.FX.vibrate([30, 60, 30]); }
    });
  }
  function waterTaken() {
    A.toast(L("💧 Bra jobbat, soldat!", "💧 Well done, soldier!"), { cls: "water", ms: 3500 });
    claim("vatten");
  }

  /* ---------- Public ---------- */
  window.MEDALS = {
    CAT: CAT, info: info, on: on, award: award, claim: claim, showMine: showMine, showUniform: showUniform,
    memberMedals: memberMedals, openMember: openMember, medalRowHTML: medalRowHTML,
    levelUp: levelUp, calmDown: calmDown, waterTaken: waterTaken, noteBeer: noteBeer,
    LEVEL_LINES: LEVEL_LINES, CALM_LINES: CALM_LINES,
    mine: function () { return mine; },
    init: function (api) {
      A = api;
      // Skål and rally answers have no hook: award a little later when those buttons are tapped.
      document.addEventListener("click", function (e) {
        var b = e.target && e.target.closest && e.target.closest(".skal-btn, [data-ans], .rl-ans, .rally-ans");
        if (b) setTimeout(function () { award(null, true); }, 2500);
      }, true);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) award(null); });
    },
    onAuthed: function () { award(null, true); },
    onBeerAccepted: function (d, o) {
      if ((d.beer_count | 0) > 0) noteBeer();
      if (o && o.ghost) setTimeout(function () { claim("spoke"); }, 1200);
      setTimeout(function () { award(null, true); }, 1500);
    },
    onPoll: function () {
      if (!A || !A.authed()) return;
      var ci = A.myCheckin && A.myCheckin(), key = ci ? String(ci.bar_id || ci.id || "") + "|" + (ci.at || ci.created_at || ci.name || "") : "";
      if (key && key !== lastCi) { lastCi = key; award(null, true); return; }
      if (Date.now() - lastAward > 5 * 60000) award(null, true);
    },
    onStopped: function (kind) { if (kind === "home") award("home", true); },
    onChat: function () { setTimeout(function () { award(null, true); }, 800); }
  };
  var lastCi = "";
})();
