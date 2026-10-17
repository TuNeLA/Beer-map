/* Öl Nu — Inkallelse (rally / call-out), CONTRACT "v9 INKALLELSE".
   A member calls the group ("🪖 Behöver män till skyttegraven!"). Others answer yes / maybe / no.
   Banner under the HUD from my_rallies() (polled with the normal poll). Missing RPCs → feature off, UI hidden.
   v22 (owner, 2026-10-18): call-outs of ONE group that point to the same place (same bar id, or ≤ 60 m, or the same
   place text when neither has a position) are drawn as ONE "stack": one row / card / flag / banner with every sender,
   one combined "på väg" count (distinct names) and one ✅ Kommer. The heading gets more serious with each call-out on
   the stack (1 Förstärkning begärd … 4+ TOTALMOBILISERING), with ≥ 15 lines per level and no repeat in one night.
   "✅ Kommer" on a stack answers EVERY call-out of the stack that is not mine (each sender sees me coming and gets
   their own rally_yes push). No server change: answer_rally per call-out, 2 h expiry unchanged (0025). */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, t = I.t, esc = U.esc;
  var A = null;
  var state = "unknown";          // "unknown" | "on" | "off"
  var rallies = [];               // newest first (my_rallies)
  var HIDE_KEY = "olnu.rallyHidden", ANS_KEY = "olnu.rallyAnsweredAt", HEAD_KEY = "olnu.rallyHeads", FLAG_MS = 60 * 60 * 1000;
  var loading = false;
  function $(id) { return document.getElementById(id); }
  function en() { return I && I.lang === "en"; }

  /* ---------- Stack headings: more call-outs on one place = more serious ---------- */
  var HEADS = {
    sv: {
      1: ["Förstärkning begärd", "En soldat kallar på hjälp", "Truppen behöver folk", "Ensam vid fronten – kom!",
        "Signal från fältet", "Nån behöver sällskap", "Radion sprakar: förstärkning", "En tropp söker manskap",
        "Lägesrapport: ensam soldat på post", "Dä behövs en till", "Flaggan ä hissad", "Posten ä bemannad – av en",
        "Kallelse till fronten", "Uppdrag: anslut", "Lugnt läge, men kom gärna", "Spaning: en vän väntar"],
      2: ["Två trupper kallar – det brinner", "Dubbel inkallelse – nu ä dä allvar", "Två flaggor på samma ställe",
        "Andra signalen – hä händer grejer", "Två röster i radion – kom nu", "Dä ä två som ropar, pojk",
        "Två trupper håller ställningen", "Förstärkning ×2 begärd", "Läget trappas upp – två kallar",
        "Andra vågen kallar", "Två soldater, en krog – häng på", "Dubbelt upp på fronten", "Två larm på samma plats",
        "Hä växer dä – två kallar", "Två mot världen – kom och jämna ut", "Andra trumpeten har blåst"],
      3: ["LARM: hela plutonen behövs", "Trefaldigt larm – alla man till posten", "Tre trupper kallar – stridsberedskap",
        "Röd flagg: tre inkallelser", "Plutonen samlas – ä du med?", "Larmet går! Tre ropar på samma ställe",
        "Högsta beredskap i kvarteret", "Tre man på radion – nu gäller dä", "Allvar nu: plutonen kallas in",
        "Sirenerna tjuter – tre kallar", "Tredje signalen – ingen sitter hemma", "Krigsrådet har talat: kom",
        "Fältet brinner – plutonen behövs", "Tre flaggor i backen – mönstra på", "LARM LARM – samling vid flaggan",
        "Plutonchefen tittar på klockan"],
      4: ["TOTALMOBILISERING", "ALLMÄN MOBILISERING – hela Dalarna", "KOD RÖD: alla trupper hit",
        "FULL MOBILISERING – nu ä dä skarpt läge", "Hela armén kallas in", "Varenda soldat till fronten",
        "Krigsmakten samlas – nu, pojk", "Generalstaben kallar ALLA", "Ingen stannar hemma ikväll",
        "Släpp allt – totalmobilisering", "Hela bataljonen ropar", "Ölgudens order: alla man på däck",
        "Dalregementet kallas in", "Sista linjen – alla behövs", "Högkvarteret har tryckt på den röda knappen",
        "Hela regementet marscherar"]
    },
    en: {
      1: ["Back-up requested", "One soldier calls for help", "The squad needs people", "Alone at the front – come!", "Signal from the field", "Someone wants company"],
      2: ["Two squads calling – it's on fire", "Double call-out – this is serious", "Two flags on one spot", "Second signal – things are happening", "Two voices on the radio – come now", "Back-up ×2 requested"],
      3: ["ALARM: the whole platoon is needed", "Triple alarm – all hands to the post", "Three squads calling – battle stations", "Red flag: three call-outs", "Sirens wailing – three calling", "The platoon assembles – are you in?"],
      4: ["TOTAL MOBILISATION", "GENERAL MOBILISATION – all of Dalarna", "CODE RED: all troops here", "The whole army is called in", "Every soldier to the front", "Headquarters pressed the red button"]
    }
  };
  function nightKey() { var d = new Date(Date.now() - 5 * 3600e3); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  // Stable per stack + level (no flicker between polls); a new pick never repeats a line already used tonight.
  function headFor(c) {
    var lv = Math.min(4, Math.max(1, c.n | 0)), lang = en() ? "en" : "sv", list = HEADS[lang][lv];
    var s = U.ls.getJSON(HEAD_KEY, null);
    if (!s || s.night !== nightKey()) s = { night: nightKey(), used: {}, pick: {} };
    var pk = lang + ":" + c.key + ":" + lv;
    var i = s.pick[pk];
    if (i == null || i >= list.length) {
      var uk = lang + lv, used = s.used[uk] || [], free = [];
      for (var j = 0; j < list.length; j++) if (used.indexOf(j) < 0) free.push(j);
      if (!free.length) { used = []; free = list.map(function (x, k) { return k; }); }
      // Level 1-4 start with the line the owner named, the first time tonight.
      i = used.length === 0 && free.indexOf(0) >= 0 ? 0 : free[Math.floor(Math.random() * free.length)];
      used.push(i); s.used[uk] = used; s.pick[pk] = i;
      var keys = Object.keys(s.pick); if (keys.length > 200) delete s.pick[keys[0]];
      U.ls.setJSON(HEAD_KEY, s);
    }
    return list[i];
  }
  function headIcon(n) { return n >= 4 ? "🚨" : n === 3 ? "📯" : n === 2 ? "🔥" : "🪖"; }

  function call(name, params) {
    if (!A || !A.LIVE || state === "off") return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) { state = "off"; r.off = true; rallies = []; renderBanner(); A.updateCounts(); }
      return r;
    });
  }
  function code(err) {
    var m = String((err && (err.message || err.details || err.hint)) || "");
    var list = ["not_member", "invalid_msg", "slow_down", "invalid_answer", "rally_not_found"];
    for (var i = 0; i < list.length; i++) if (m.indexOf(list[i]) >= 0) return list[i];
    return U.errCode(err);
  }
  function load() {
    if (!A || !A.authed() || state === "off" || loading) return Promise.resolve();
    loading = true;
    return call("my_rallies").then(function (r) {
      loading = false;
      if (r.error) return;
      var was = state;
      state = "on";
      rallies = (r.data || []).filter(function (x) { return x && x.id != null; });
      renderBanner(); drawFlags();
      if (was !== "on") A.updateCounts();
      refreshOpenSheet();
    });
  }
  // v13 poll_v2 carries the my_rallies rows: no extra call per poll.
  var fromPoll = false;
  function fromPollData(d) {
    if (!d || !Array.isArray(d.rallies)) { fromPoll = false; return; }
    fromPoll = true;
    var was = state;
    state = "on";
    rallies = d.rallies.filter(function (x) { return x && x.id != null; });
    renderBanner(); drawFlags();
    if (was !== "on") A.updateCounts();
    refreshOpenSheet();
  }
  function hidden() { var h = U.ls.getJSON(HIDE_KEY, []); return Array.isArray(h) ? h : []; }
  function hide(id) { var h = hidden(); if (h.indexOf(String(id)) < 0) h.push(String(id)); U.ls.setJSON(HIDE_KEY, h.slice(-50)); }
  function byId(id) { for (var i = 0; i < rallies.length; i++) if (String(rallies[i].id) === String(id)) return rallies[i]; return null; }

  /* ---------- Stacks (v22) ---------- */
  var STACK_M = 60;
  function normPlace(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); }
  // list: newest first. Returns stacks, newest first (by their newest call-out).
  function stacksOf(list) {
    var out = [];
    list.forEach(function (r) {
      var w = whereOf(r), bar = null;
      try { bar = w ? barOf(r) : null; } catch (e) { bar = null; }
      var bid = bar && bar.id != null ? String(bar.id) : null, pl = normPlace(r.place), c = null;
      for (var i = 0; i < out.length && !c; i++) {
        var x = out[i];
        if (String(x.group_id) !== String(r.group_id)) continue;
        if (bid && x.barId === bid) c = x;
        else if (w && x.where && U.haversine(w.lat, w.lng, x.where.lat, x.where.lng) <= STACK_M) c = x;
        else if (!w && !x.where && pl.length >= 3 && pl === x.place) c = x;
      }
      if (!c) { c = { group_id: r.group_id, group_name: r.group_name, barId: bid, bar: bar, where: w, place: pl, placeText: r.place || "", rallies: [] }; out.push(c); }
      c.rallies.push(r);
    });
    out.forEach(finishStack);
    return out;
  }
  function finishStack(c) {
    var rs = c.rallies, names = [], anyNames = false, maxYes = 0, others = [];
    rs.forEach(function (r) {
      maxYes = Math.max(maxYes, r.yes | 0);
      if (Array.isArray(r.yes_names)) { anyNames = true; r.yes_names.forEach(function (n) { if (n && names.indexOf(n) < 0) names.push(n); }); }
      if (!r.is_mine) others.push(r);
      if (!c.placeText && r.place) c.placeText = r.place;
    });
    var oldest = rs[rs.length - 1];
    c.n = rs.length;
    c.id = rs[0].id;                                  // newest call-out: links, ETA, proxy button
    c.key = String(c.group_id) + ":" + oldest.id;     // stable while the oldest one lives
    c.ids = rs.map(function (r) { return String(r.id); });
    c.yes_names = names;
    c.yes = anyNames ? Math.max(names.length, maxYes) : maxYes;
    c.others = others;
    c.is_mine = others.length === 0;
    c.any_mine = others.length < rs.length;
    c.my_answer = !others.length ? "yes" : others.every(function (r) { return r.my_answer === "yes"; }) ? "yes" : (others[0].my_answer || null);
    c.created_at = rs[0].created_at;
    c.first_at = oldest.created_at;
    c.head = headFor(c);
    c.icon = headIcon(c.n);
    return c;
  }
  function senderName(r) { return r.is_mine ? t("you") : (r.name || t("someone")); }
  function sendersText(c) {
    var seen = [];
    c.rallies.slice().reverse().forEach(function (r) { var n = senderName(r); if (seen.indexOf(n) < 0) seen.push(n); });
    return seen.join(", ");
  }
  function stackOfId(id, list) {
    var ss = stacksOf(list || rallies);
    for (var i = 0; i < ss.length; i++) if (ss[i].ids.indexOf(String(id)) >= 0) return ss[i];
    return null;
  }

  /* ---------- Banner ---------- */
  function setH() {
    var b = $("rally"), h = b.hidden ? 0 : b.offsetHeight + 6;
    document.documentElement.style.setProperty("--rally-h", h + "px");
    requestAnimationFrame(padPopups);
  }
  // Keep map popups clear of the whole top HUD (ticker, kaos + rally banners, HUD lines).
  function padPopups() {
    try {
      var hl = document.querySelector(".hud-left"), bottom = hl ? hl.getBoundingClientRect().bottom : 0;
      var top = Math.max(150, Math.round(bottom + 8));
      if (top > window.innerHeight * 0.5) top = Math.round(window.innerHeight * 0.5);
      L.Popup.prototype.options.autoPanPaddingTopLeft = L.point(10, top);
    } catch (e) {}
  }
  function lineOf(c) {
    var r = c.rallies[0];
    if (c.n === 1) return "🪖 " + senderName(r) + ": " + (r.body || t("rallyDefault")) +
      (r.place ? " · 📍 " + r.place : "") + " — " + t("rallyOnWay", c.yes | 0);
    return c.icon + " " + c.head + " · " + sendersText(c) + (c.placeText ? " · 📍 " + c.placeText : "") + " — " + t("rallyOnWay", c.yes | 0);
  }
  function renderBanner() {
    var box = $("rally"); if (!box) return;
    var h = hidden(), c = null, ss = stacksOf(rallies);
    for (var i = 0; i < ss.length; i++) if (ss[i].ids.some(function (id) { return h.indexOf(id) < 0; })) { c = ss[i]; break; }
    box.hidden = !c;
    box.classList.remove("rl-lv2", "rl-lv3", "rl-lv4");
    if (c) {
      if (c.n > 1) box.classList.add("rl-lv" + Math.min(4, c.n));
      var btns = c.is_mine ? "" : ["yes", "maybe", "no"].map(function (a) {
        return '<button type="button" class="rl-a rl-' + a + (c.my_answer === a ? " on" : "") + '" data-ans="' + a + '" aria-pressed="' + (c.my_answer === a) + '">' +
          esc(t(a === "yes" ? "rallyYes" : a === "maybe" ? "rallyMaybe" : "rallyNo")) + "</button>";
      }).join("");
      box.setAttribute("data-id", String(c.id));
      box.innerHTML = '<button type="button" class="rl-txt" data-open="1">' +
        (c.n > 1 ? '<b class="rl-head">' + esc(c.icon + " " + c.head) + "</b> " + esc("· " + sendersText(c) + (c.placeText ? " · 📍 " + c.placeText : "") + " — " + t("rallyOnWay", c.yes | 0))
          : esc(lineOf(c))) + "</button>" +
        '<button type="button" class="rl-x" data-hide="1" aria-label="' + esc(t("rallyHide")) + '">✕</button>' +
        (btns ? '<div class="rl-btns">' + btns + "</div>" : "");
    }
    setH();
  }

  /* ---------- Answer ---------- */
  // One call-out (old path) or a whole stack: every call-out of the stack that is not mine gets the answer.
  function answer(id, ans, quiet, noFly) {
    var c = stackOfId(id), targets = c ? c.others.map(function (r) { return r.id; }) : [id];
    if (!targets.length) targets = [id];
    return answerMany(targets, ans, quiet, noFly, c);
  }
  function answerMany(ids, ans, quiet, noFly, c) {
    var r = byId(ids[0]);
    return Promise.all(ids.map(function (id) {
      return call("answer_rally", { p_rally_id: +id, p_answer: ans }).then(function (res) { return { id: id, res: res }; });
    })).then(function (all) {
      var ok = all.filter(function (x) { return !x.res.error; });
      if (!ok.length) {
        var cd = code(all[0].res.error);
        A.toast(cd === "rally_not_found" ? t("rallyGone") : cd === "not_member" ? t("chatNotMember") : t("rallyFail"), { err: true });
        if (cd === "rally_not_found") load();
        return false;
      }
      ok.forEach(function (x) {
        var d = A.parseData(x.res.data), rr = byId(x.id);
        if (rr) { rr.yes = d.yes | 0; rr.no = d.no | 0; rr.maybe = d.maybe | 0; rr.my_answer = d.mine || ans; }
        if ((d.mine || ans) === "yes") A.invoke("notify-group", { event: "rally_yes", rally_id: +x.id });
      });
      if (!quiet) {
        var E = ans === "yes" && r && !r.is_mine ? etaApi() : null;
        // v18: after "✅ Kommer" offer the ETA chips ("Hur långt bort ä du?") in the rally sheet.
        A.toast(t(ans === "yes" ? "rallyYesToast" : ans === "maybe" ? "rallyMaybeToast" : "rallyNoToast"),
          E && openId == null ? { ms: 7000, action: { label: E.text("rallyBtn"), fn: function () { var x = stackOfId(ids[0]); if (A.map) A.map.closePopup(); if (x) openRally(x); } } } : undefined);
        window.FX.vibrate(ans === "yes" ? [30, 40, 30] : 20);
      }
      renderBanner(); refreshOpenSheet();
      // After an answer the banner goes away. The flag stays on the map (1 h after the answer).
      if (!quiet && r) {
        var allIds = c ? c.ids : ids.map(String);
        var marks = U.ls.getJSON(ANS_KEY, {}) || {};
        allIds.forEach(function (id) { hide(id); marks[String(id)] = Date.now(); });
        U.ls.setJSON(ANS_KEY, marks);
        renderBanner(); drawFlags();
        var w = whereOf(r);
        if (w && ans !== "no" && !noFly) {
          if (openId == null) { A.closeSheet(); A.map.flyTo([w.lat, w.lng], 16, { duration: 1 }); }
          A.toast(t("rallyFlagHint"), { ms: 6000 });
        }
      }
      setTimeout(load, 800);   // fresh yes_names
      return true;
    });
  }

  /* ---------- Detail sheet (one stack) ---------- */
  var openId = null, openIds = [], openBody = null, flagLayer = null;
  function refreshOpenSheet() {
    // openBody is the shared #sheet-body: only refill while it still shows this call-out (another sheet clears it).
    if (openId == null || !openBody || !document.body.contains(openBody) || !openBody.querySelector(".rl-big")) { openId = null; openIds = []; openBody = null; return; }
    var ss = stacksOf(rallies), c = null;
    for (var i = 0; i < ss.length && !c; i++) if (ss[i].ids.some(function (id) { return openIds.indexOf(id) >= 0; })) c = ss[i];
    if (c) { openId = c.id; openIds = c.ids.slice(); fillDetail(openBody, c); }
  }
  function fillDetail(body, c) {
    var el = A.el, r0 = c.rallies[0];
    body.innerHTML = "";
    var head = el("div", { class: "rl-head-box rl-n" + Math.min(4, c.n) });
    if (c.n > 1) head.appendChild(el("div", { class: "rl-stack-h", text: c.icon + " " + c.head }));
    head.appendChild(el("div", { class: "rl-who", text: (c.n === 1 ? (r0.is_mine ? t("rallyMine") : (r0.name || t("someone"))) : sendersText(c)) +
      (c.group_name ? " · " + t("rallyIn", c.group_name) : "") }));
    if (c.placeText) head.appendChild(el("div", { class: "rl-place", text: "📍 " + c.placeText }));
    body.appendChild(head);
    // Every sender and message, compact, oldest first.
    var ul = el("ul", { class: "rl-msgs" });
    c.rallies.slice().reverse().forEach(function (r) {
      var li = el("li", { class: "rl-msg" + (r.is_mine ? " me" : "") }, [
        el("b", { text: senderName(r) + ": " }),
        el("span", { text: r.body || t("rallyDefault") }),
        el("small", { class: "muted", text: " " + U.timeHM(r.created_at) })
      ]);
      if (r.is_mine) {
        var x = el("button", { type: "button", class: "rl-msg-x", text: c.n > 1 ? "✕" : t("rallyClose"), "aria-label": t("rallyClose") });
        x.addEventListener("click", function () { closeOne(r); });
        li.appendChild(x);
      }
      ul.appendChild(li);
    });
    body.appendChild(ul);
    body.appendChild(el("div", { class: "rl-big", text: t("rallyOnWay", c.yes | 0) }));
    var y = 0, m = 0, n = 0;
    c.rallies.forEach(function (r) { y = Math.max(y, r.yes | 0); m = Math.max(m, r.maybe | 0); n = Math.max(n, r.no | 0); });
    body.appendChild(el("p", { class: "muted", text: t("rallyCounts", c.yes | 0, m, n) }));
    var names = c.yes_names || [];
    body.appendChild(el("p", { class: "rl-names", text: names.length ? t("rallyGoing", names.join(", ")) : t("rallyNobody") }));
    etaPart(body, c);
    if (!c.is_mine) {
      var row = el("div", { class: "row rl-ans-row" });
      ["yes", "maybe", "no"].forEach(function (a) {
        var b = A.btn(t(a === "yes" ? "rallyYes" : a === "maybe" ? "rallyMaybe" : "rallyNo"), "btn-small rl-ans" + (c.my_answer === a ? " on" : ""), function () { answer(c.id, a); });
        b.setAttribute("aria-pressed", String(c.my_answer === a));
        row.appendChild(b);
      });
      body.appendChild(row);
      if (c.n > 1) body.appendChild(el("p", { class: "muted rl-all-note", text: en() ? "Your answer goes to all " + c.n + " who called." : "Svaret går till alla " + c.n + " som kallat." }));
    }
    var wh = c.where || whereOf(r0);
    if (wh) {
      // Walking directions in the phone's own map app (Apple Maps on iPhone, Google Maps elsewhere).
      if (!c.is_mine) {
        var go = el("a", { class: "btn btn-block rl-route" + (c.my_answer === "yes" ? " btn-green" : ""), href: dirUrl(wh),
          target: "_blank", rel: "noopener noreferrer", text: t("rallyRoute") });
        body.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [go]));
        var dist = el("p", { class: "muted rl-dist", text: "" });
        body.appendChild(dist);
        distTo(wh, function (txt) { dist.textContent = txt; });
      }
      body.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [A.btn(t("rallyShowMap"), "btn-block", function () { showFlag(c, wh); })]));
    }
  }
  function closeOne(r) {
    call("close_rally", { p_rally_id: +r.id }).then(function (res) {
      if (res.error) { A.toast(code(res.error) === "rally_not_found" ? t("rallyGone") : t("rallyFail"), { err: true }); return; }
      A.toast(t("rallyClosed"));
      rallies = rallies.filter(function (x) { return String(x.id) !== String(r.id); });
      openIds = openIds.filter(function (x) { return x !== String(r.id); });
      if (!openIds.length) A.closeSheet(); else refreshOpenSheet();
      renderBanner(); drawFlags(); load();
    });
  }
  /* ---------- v18 ETA in the rally sheet (engine in barsplus.js: BARSPLUS.eta) ---------- */
  function etaApi() { var E = window.BARSPLUS && window.BARSPLUS.eta; return E && E.on && E.on() ? E : null; }
  // Where to send the ETA: the bar the call-out resolves to, else its point + place text, else only the rally.
  function etaTarget(r) {
    var bar = null; try { bar = barOf(r); } catch (e) { bar = null; }
    if (bar && bar.id != null) return { bar_id: String(bar.id), bar_name: bar.name || r.place || null, lat: bar.lat, lng: bar.lng };
    var w = whereOf(r);
    return { bar_id: null, bar_name: r.place || null, lat: w ? w.lat : null, lng: w ? w.lng : null };
  }
  // "På väg: Anton (7 min), Lisa (✅)" + after "✅ Kommer": "Hur långt bort ä du?" chips or my countdown.
  // A stack: ETAs of all its call-outs (one line per person); my ETA goes to the newest call-out that is not mine.
  function etaPart(body, c) {
    var E = etaApi(); if (!E) return;
    var el = A.el;
    E.onChange(refreshOpenSheet);
    var list = [], seen = {};
    c.rallies.forEach(function (r) {
      (E.forRally(r.id) || []).forEach(function (x) { var k = E.nameOf(x); if (!seen[k]) { seen[k] = 1; list.push(x); } });
    });
    body.appendChild(el("p", { class: "rl-eta-list", text: list.length
      ? E.fill(E.text("rallyOnWay"), { list: list.map(function (x) { return E.nameOf(x) + " (" + (x.arrived ? "✅" : E.minText(x)) + ")"; }).join(", ") })
      : E.text("rallyNone") }));
    if (c.is_mine || c.my_answer !== "yes") return;
    var tr = c.others[0] || c.rallies[0];
    var me = E.mine(), box = el("div", { class: "rl-eta" });
    if (me && c.ids.indexOf(String(me.rally_id)) >= 0) {
      if (me.arrived) box.appendChild(el("div", { class: "eta-me arr", text: E.text("mineArr") }));
      else {
        var line = el("div", { class: "eta-me" });
        if (E.msLeft(me) > 0) {
          line.appendChild(document.createTextNode(E.text("rallyMine")));
          line.appendChild(el("b", { class: "eta-cd", "data-until": String(Date.parse(me.eta_at)), text: E.cdText(me) }));
        } else line.textContent = E.text("mineLate");
        box.appendChild(line);
        var here = A.btn(E.text("here"), "btn-small btn-green", function () { here.disabled = true; E.end(true); });
        var stop = A.btn(E.text("cancel"), "btn-small", function () { stop.disabled = true; E.end(false); });
        box.appendChild(el("div", { class: "row eta-acts" }, [here, stop]));
        E.tick();
      }
    } else {
      box.appendChild(el("div", { class: "eta-q", text: E.text("rallyQ") }));
      var chips = el("div", { class: "eta-chips" });
      E.MINUTES.forEach(function (n) {
        var ch = el("button", { type: "button", class: "eta-chip", "data-eta-min": String(n), text: E.fill(E.text("chip"), { n: n }) });
        ch.addEventListener("click", function () {
          chips.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
          E.set(etaTarget(tr), n, tr.id).then(function () { chips.querySelectorAll("button").forEach(function (x) { x.disabled = false; }); });
        });
        chips.appendChild(ch);
      });
      box.appendChild(chips);
    }
    body.appendChild(box);
  }
  function dirUrl(r) {
    var ll = (+r.lat).toFixed(5) + "," + (+r.lng).toFixed(5);
    return U.isIOS() ? "https://maps.apple.com/?daddr=" + ll + "&dirflg=w"
      : "https://www.google.com/maps/dir/?api=1&destination=" + ll + "&travelmode=walking";
  }
  // "ca 650 m · ca 8 min att gå" from the phone's last known position (no new GPS prompt if it fails).
  function distTo(r, cb) {
    try {
      navigator.geolocation.getCurrentPosition(function (p) {
        var m = U.haversine(p.coords.latitude, p.coords.longitude, +r.lat, +r.lng);
        cb(t("rallyDist", m < 1000 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1).replace(".", ",") + " km",
          Math.max(1, Math.round(m * 1.25 / 80))));
      }, function () {}, { maximumAge: 300000, timeout: 8000, enableHighAccuracy: false });
    } catch (e) {}
  }
  // Where is the call-out? Its own coords, else a known bar/place whose name matches the place text
  // (nearest one to the map centre, within 60 km). Returns {lat, lng} or null.
  var placeCache = {};
  function whereOf(r) {
    if (r.lat != null && r.lng != null && isFinite(r.lat) && isFinite(r.lng)) return { lat: +r.lat, lng: +r.lng };
    var name = String(r.place || "").trim().toLowerCase();
    if (name.length < 3 || !window.BARS || !window.BARS.inBounds || !window.L || !A || !A.map) return null;
    if (placeCache[name] !== undefined) return placeCache[name];
    var c = A.map.getCenter(), best = null, bestD = 60000;
    var all = window.BARS.inBounds(L.latLngBounds([[c.lat - 0.6, c.lng - 1.2], [c.lat + 0.6, c.lng + 1.2]]), 5000);
    all.forEach(function (b) {
      var n = String(b.name || "").toLowerCase(); if (!n) return;
      if (n === name || n.indexOf(name) === 0 || name.indexOf(n) === 0 || n.indexOf(" " + name) >= 0) {
        var d = U.haversine(c.lat, c.lng, b.lat, b.lng);
        if (d < bestD) { bestD = d; best = { lat: b.lat, lng: b.lng }; }
      }
    });
    placeCache[name] = best;
    return best;
  }
  // Which call-outs are shown at all (same rule for the flag pin and the bar badge).
  function visibleRallies() {
    var marks = U.ls.getJSON(ANS_KEY, {}) || {}, nowMs = Date.now();
    return rallies.filter(function (r) {
      if (r.my_answer === "no") return false;                 // answered "no": nothing on the map
      var at = marks[String(r.id)];
      return !(at && nowMs - at > FLAG_MS && !r.is_mine);      // yes/maybe: 1 h after the answer; not answered: while active
    });
  }
  // Polish (one marker per bar): a call-out placed at/near a bar (≤ 60 m) becomes the 🪖 badge on that bar's
  // composite marker (app.js) from zoom 11; elsewhere (or zoomed further out) it keeps its own small pin.
  var BADGE_M = 60, BADGE_ZOOM = 11;
  function barOf(r) {
    var w = whereOf(r); if (!w || !window.BARS || !window.BARS.nearby) return null;
    // Bars within 60 m. A restaurant/café only when the call-out names it (a home party next to a pizzeria stays a pin).
    var near = window.BARS.nearby(w.lat, w.lng, BADGE_M, 3, { places: true, placeM: BADGE_M, maxPlaces: 3 });
    var pl = String(r.place || "").trim().toLowerCase();
    for (var i = 0; i < near.length; i++) {
      if (!near[i].place) return near[i].bar;
      var n = String(near[i].bar.name || "").toLowerCase();
      if (pl.length >= 3 && n && (n.indexOf(pl) >= 0 || pl.indexOf(n) >= 0)) return near[i].bar;
    }
    return null;
  }
  // Bar badges for app.js: per bar id {bar, rallies, stacks}. "rallies" holds ONE light row per stack
  // ({id, yes = combined count, my_answer}), so app.js draws "🪖 <combined>" and its dot only for 2+ groups.
  function barBadges(z) {
    var out = {};
    if (state !== "on" || (z != null && z < BADGE_ZOOM)) return out;
    stacksOf(visibleRallies()).forEach(function (c) {
      var bar = c.bar; if (!bar || bar.id == null) return;
      var id = String(bar.id), x = out[id] || (out[id] = { bar: bar, rallies: [], stacks: [] });
      x.stacks.push(c);
      x.rallies.push({ id: c.id, yes: c.yes, my_answer: c.my_answer, is_mine: c.is_mine, n: c.n, group_id: c.group_id });
    });
    return out;
  }
  function badgeKey() {
    var b = barBadges(A && A.map ? A.map.getZoom() : 0);
    return Object.keys(b).sort().map(function (id) {
      return id + ":" + b[id].stacks.map(function (c) { return c.ids.join("+") + "/" + (c.yes | 0) + "/" + (c.my_answer || ""); }).join(",");
    }).join("|");
  }
  // "Inkallelser" section of a bar popup: one row per stack (heading element first, so app.js keeps it as written).
  function barSectionHTML(barId) {
    var b = barBadges(null)[String(barId)]; if (!b) return "";
    return b.stacks.map(function (c) {
      var r0 = c.rallies[0], w = c.where || whereOf(r0);
      var h = '<div class="pp-rl-row rl-n' + Math.min(4, c.n) + '" data-rl-id="' + esc(String(c.id)) + '" data-rl-ids="' + esc(c.ids.join(",")) + '">' +
        '<button type="button" class="pp-rl-txt" data-rl-open="1">';
      if (c.n === 1) h += "🪖 " + esc(senderName(r0) + ": " + (r0.body || t("rallyDefault")));
      else {
        h += '<b class="pp-rl-head">' + esc(c.icon + " " + c.head) + "</b>" +
          c.rallies.slice().reverse().map(function (r) { return '<span class="pp-rl-m"><b>' + esc(senderName(r)) + ":</b> " + esc(r.body || t("rallyDefault")) + "</span>"; }).join("");
      }
      h += "<small>" + esc(t("rallyOnWay", c.yes | 0) + " · " + U.timeHM(c.created_at)) + "</small></button>";
      if (!c.is_mine) {
        h += '<div class="pp-rl-btns"><button type="button" data-rl-ans="yes" class="' + (c.my_answer === "yes" ? "on" : "") + '" aria-pressed="' + (c.my_answer === "yes") + '">' + esc(t("rallyYes")) + "</button>" +
          (w ? '<a class="pp-rl-route" href="' + esc(dirUrl(w)) + '" target="_blank" rel="noopener noreferrer">' + esc(t("rallyRoute")) + "</a>" : "") + "</div>";
      }
      return h + "</div>";
    }).join("");
  }
  // Every active call-out with a place stays on the map: as a badge on its bar, or as a small pin "🪖 3" (one per stack).
  var flagsLayer = null, flagZoomHooked = false, lastBadgeKey = "";
  function drawFlags() {
    if (!A || !A.map || !window.L) return;
    if (!flagsLayer) flagsLayer = L.layerGroup().addTo(A.map);
    flagsLayer.clearLayers();
    if (!flagZoomHooked) {
      flagZoomHooked = true;
      var zc = function () { var el = A.map.getContainer(); el.classList.toggle("rl-zoomed", A.map.getZoom() >= 16); };
      A.map.on("zoomend", zc); zc();
      A.map.on("zoomend", function () { drawFlags(); });
    }
    var z = A.map.getZoom(), onBar = {};
    var bb = barBadges(z);
    Object.keys(bb).forEach(function (id) { bb[id].stacks.forEach(function (c) { c.ids.forEach(function (x) { onBar[x] = true; }); }); });
    // The bars' composite markers carry the badge: redraw them when the badges changed.
    var key = badgeKey();
    if (key !== lastBadgeKey) { lastBadgeKey = key; try { A.render(); } catch (e) {} }
    stacksOf(visibleRallies()).forEach(function (c) {
      if (c.ids.some(function (x) { return onBar[x]; })) return;
      var w = c.where; if (!w) return;
      var me = c.my_answer === "yes" && !c.is_mine ? " ✅" : c.my_answer === "maybe" ? " 🤔" : "";
      var lbl = c.n > 1 ? c.head : senderName(c.rallies[0]) + (c.placeText ? " · " + c.placeText : "");
      var m = L.marker([w.lat, w.lng], { keyboard: false, zIndexOffset: 3500 + Math.min(4, c.n) * 10,
        icon: L.divIcon({ className: "", iconSize: [0, 0], iconAnchor: [0, 0],
          // Small pin: 🪖 + people on the way (+ ×n when several call-outs are stacked). Label only when zoomed in (≥ 16).
          html: '<div class="rl-pin rl-n' + Math.min(4, c.n) + (c.my_answer === "yes" && !c.is_mine ? " me" : "") + '"><span>' + (c.n > 1 ? c.icon : "🪖") + "</span>" +
 "<i>" + (c.yes | 0) + me +
            '</i><b class="rl-pin-lbl">' + esc(lbl) + "</b></div>" }) });
      m.on("click", function () { openRally(stackOfId(c.id) || c); });
      flagsLayer.addLayer(m);
    });
  }
  // Accepts a stack or a single call-out row (old callers).
  function openRally(x) {
    var c = x && x.rallies ? x : (x ? stackOfId(x.id) : null);
    if (!c && x) c = finishStack({ group_id: x.group_id, group_name: x.group_name, where: whereOf(x), placeText: x.place || "", rallies: [x] });
    if (!c) return;
    A.openSheet(c.n > 1 ? c.icon + " " + c.head : t("rallyTitle"), function (body) { openId = c.id; openIds = c.ids.slice(); openBody = body; fillDetail(body, c); });
  }
  function showFlag(c, w) {
    var r0 = c.rallies ? c.rallies[0] : c;
    w = w || whereOf(r0); if (!w) return;
    A.closeSheet();
    if (flagLayer) A.map.removeLayer(flagLayer);
    flagLayer = L.marker([w.lat, w.lng], { keyboard: false, zIndexOffset: 4000,
      icon: L.divIcon({ className: "", iconSize: [0, 0], iconAnchor: [0, 0],
        html: '<div class="rl-flag"><span>🪖</span><b>' + esc((c.placeText || r0.place) || r0.body || t("rallyTitle")) + "</b></div>" }) }).addTo(A.map);
    flagLayer.on("click", function () { if (flagLayer) { A.map.removeLayer(flagLayer); flagLayer = null; } });
    A.map.flyTo([w.lat, w.lng], 16, { duration: 1 });
  }

  /* ---------- Create form ---------- */
  function startCreate(group) {
    A.withName(function () {
      if (group) { form([group], group); return; }
      A.rpc("my_groups").then(function (res) {
        var gs = (res && res.data) || [];
        if (res.error) { A.toast(t("fail"), { err: true }); return; }
        if (!gs.length) { A.toast(t("noGroup"), { err: true }); return; }
        form(gs, gs[0]);
      });
    });
  }
  function form(groups, sel) {
    var el = A.el, mine = A.myBeer(), bar = null;
    if (mine && mine.precise) { var b = window.BARS.nearest(mine.lat, mine.lng); if (b && b.name) bar = b.name; }
    A.openSheet(t("rallyTitle"), function (body) {
      var gid = sel.id, place = bar || null, useLoc = false, sending = false;
      if (groups.length > 1) {
        body.appendChild(el("label", { class: "fld", text: t("rallyGroup") }));
        var gr = el("div", { class: "chips" });
        groups.forEach(function (g) {
          var c = el("button", { type: "button", class: "chip-btn", "aria-pressed": String(g.id === gid), text: g.name });
          c.addEventListener("click", function () { gid = g.id; gr.querySelectorAll(".chip-btn").forEach(function (x) { x.setAttribute("aria-pressed", String(x === c)); }); });
          gr.appendChild(c);
        });
        body.appendChild(gr);
      }
      body.appendChild(el("label", { class: "fld", for: "rally-inp", text: t("rallyWhat") }));
      var inp = el("input", { class: "inp rl-inp", id: "rally-inp", maxlength: "100", enterkeyhint: "send", autocomplete: "off", placeholder: t("rallyPh") });
      body.appendChild(inp);
      body.appendChild(el("label", { class: "fld", text: t("rallyPlace") }));
      var pr = el("div", { class: "chips" });
      var other = el("input", { class: "inp rl-inp", maxlength: "60", autocomplete: "off", placeholder: t("rallyPlacePh"), "aria-label": t("rallyPlace") });
      other.hidden = true;
      var loc = el("input", { type: "checkbox", id: "rally-loc" });
      var opts = [], spot = null, cen = A.lastLoc && A.lastLoc() || A.map.getCenter();
      if (bar) opts.push(["bar", t("rallyBarX", bar), bar]);
      // Bars near me (or the map centre): picking one sends its exact spot, so everyone gets the route.
      var near = window.BARS && window.BARS.nearby ? window.BARS.nearby(cen.lat, cen.lng, 3000, 6) : [];
      near.forEach(function (x) { if (x.bar.name !== bar) opts.push(["spot", "🍺 " + x.bar.name, x.bar.name, x.bar]); });
      opts.push(["home", t("rallyHome"), t("rallyHomeVal")]);
      opts.push(["other", t("rallyOther"), null]);
      opts.forEach(function (o, i) {
        var c = el("button", { type: "button", class: "chip-btn", "aria-pressed": String(i === 0 && !!bar), text: o[1] });
        c.addEventListener("click", function () {
          var on = c.getAttribute("aria-pressed") !== "true";
          pr.querySelectorAll(".chip-btn").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
          c.setAttribute("aria-pressed", String(on));
          other.hidden = !(on && o[0] === "other");
          place = on ? o[2] : null;
          spot = on && o[3] ? o[3] : null;
          if (o[0] === "bar" && on && mine) spot = { lat: mine.lat, lng: mine.lng };
          // "Hemma hos mig" needs my position, else nobody can find the way.
          if (o[0] === "home") { loc.checked = on; useLoc = on; }
          if (!other.hidden) setTimeout(function () { other.focus(); }, 30);
        });
        pr.appendChild(c);
      });
      body.appendChild(pr);
      body.appendChild(other);
      loc.addEventListener("change", function () { useLoc = loc.checked; });
      body.appendChild(el("label", { class: "age-row rl-loc", for: "rally-loc" }, [loc, el("span", { text: t("rallyUseLoc") })]));
      var go = A.btn(t("rallySend"), "btn-amber btn-block", function () {
        if (sending) return;
        var text = String(inp.value || "").trim(), pl = !other.hidden ? String(other.value || "").trim() : place;
        if (text.length > 100 || (pl && pl.length > 60)) { A.toast(t("rallyInvalid"), { err: true }); return; }
        sending = true; go.disabled = true;
        var posP = useLoc ? A.getPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }).then(function (p) {
          return { lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 };
        }, function (err) { A.locError(err); return null; }) : Promise.resolve(null);
        posP.then(function (pos) {
          var params = { p_group_id: gid, p_body: text || t("rallyDefault"), p_place: pl || null };
          if (pos) { params.p_lat = pos.lat; params.p_lng = pos.lng; }
          else if (spot && isFinite(spot.lat)) { params.p_lat = +(+spot.lat).toFixed(5); params.p_lng = +(+spot.lng).toFixed(5); }
          return call("create_rally", params).then(function (res) {
            sending = false; go.disabled = false;
            if (res.error) {
              var c = code(res.error);
              A.toast(c === "slow_down" ? t("rallySlow") : c === "invalid_msg" ? t("rallyInvalid") : c === "not_member" ? t("chatNotMember") : t("rallyFail"), { err: true });
              return;
            }
            var d = A.parseData(res.data);
            if (d.id != null) A.invoke("notify-group", { event: "rally", rally_id: +d.id });
            A.toast(t("rallySent"), { ms: 5000 });
            window.FX.unlock(); window.FX.sound.hot(); window.FX.vibrate([40, 60, 40]);
            A.closeSheet();
            load();
          });
        });
      });
      body.appendChild(el("div", { class: "row", style: "margin-top:12px" }, [go]));
      setTimeout(function () { inp.focus(); }, 50);
    });
  }

  /* ---------- Deep link ?rally=<id>[&answer=…] ---------- */
  function openLink(id, ans) {
    if (!/^\d{1,18}$/.test(String(id || ""))) return;
    var tries = 0;
    (function step() {
      if (state === "off") return;
      if (!A.authed()) { if (tries++ < 60) setTimeout(step, 500); return; }
      load().then(function () {
        if (state !== "on") { if (state === "unknown" && tries++ < 60) setTimeout(step, 700); return; }
        var r = byId(id);
        if (!r) { A.toast(t("rallyGone"), { err: true }); return; }
        var h = hidden().filter(function (x) { return x !== String(id); }); U.ls.setJSON(HIDE_KEY, h);
        renderBanner();
        var a = String(ans || "").toLowerCase();
        // A push button answers that one call-out; the sheet then shows its whole stack.
        if (["yes", "no", "maybe"].indexOf(a) >= 0 && !r.is_mine) answerMany([r.id], a).then(function () { openRally(stackOfId(id) || r); });
        else openRally(stackOfId(id) || r);
      });
    })();
  }

  window.RALLY = {
    on: function () { return state === "on"; },
    init: function (api) {
      A = api;
      var box = $("rally");
      box.addEventListener("click", function (e) {
        var id = box.getAttribute("data-id"), b = e.target.closest("button"); if (!b || !id) return;
        if (b.hasAttribute("data-ans")) answer(id, b.getAttribute("data-ans"));
        else if (b.hasAttribute("data-hide")) { var c = stackOfId(id); (c ? c.ids : [id]).forEach(hide); renderBanner(); }
        else if (b.hasAttribute("data-open")) { var s = stackOfId(id); if (s) openRally(s); }
      });
      window.addEventListener("resize", U.debounce(setH, 150));
      // Bar popup "Inkallelser" section: Kommer (whole stack) / open the stack.
      if (A.map) A.map.on("popupopen", function (e) {
        var root = e.popup && e.popup.getElement(); if (!root) return;
        root.querySelectorAll(".pp-rl-row").forEach(function (row) {
          var id = row.getAttribute("data-rl-id");
          row.querySelectorAll("[data-rl-ans]").forEach(function (b) {
            b.addEventListener("click", function (ev) {
              ev.preventDefault(); ev.stopPropagation();
              if (b.disabled) return; b.disabled = true;
              answer(id, b.getAttribute("data-rl-ans"), false, true).then(function () { b.disabled = false; });
            });
          });
          row.querySelectorAll("[data-rl-open]").forEach(function (b) {
            b.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); var c = stackOfId(id); if (c) { A.map.closePopup(); openRally(c); } });
          });
        });
      });
    },
    applyText: function () { renderBanner(); },
    onAuthed: function () {},   // v14: the first poll brings the rallies (poll_v2) or onPoll loads them
    onPollData: function (d) { if (A && state !== "off") fromPollData(d); else fromPoll = false; },
    onPoll: function () { if (!fromPoll) load(); padPopups(); },
    hudChipsHTML: function () {
      return state === "on" ? '<button type="button" class="hx-chip hx-rally" data-hx="rally">' + esc(t("rallyBtn")) + "</button>" : "";
    },
    hudClick: function (action) { if (action === "rally") startCreate(null); },
    groupItem: function (g, wrap) {
      if (state !== "on") return;
      // Active call-outs of this group, one card per place (stack). Tap → details (route, who comes).
      stacksOf(rallies.filter(function (r) { return String(r.group_id) === String(g.id); })).forEach(function (c) {
        var mine = c.is_mine ? "" : c.my_answer === "yes" ? " · ✅" : c.my_answer === "maybe" ? " · 🤔" : "";
        var card = A.el("button", { type: "button", class: "rl-group-item rl-n" + Math.min(4, c.n), onclick: function () { openRally(stackOfId(c.id) || c); } });
        if (c.n === 1) {
          var r = c.rallies[0];
          card.textContent = "🪖 " + senderName(r) + ": " + (r.body || t("rallyDefault")) + (r.place ? " · 📍 " + r.place : "") + " — " + t("rallyOnWay", c.yes | 0) + mine;
        } else {
          card.appendChild(A.el("b", { class: "rl-gi-head", text: c.icon + " " + c.head }));
          if (c.placeText) card.appendChild(A.el("span", { class: "rl-gi-place", text: "📍 " + c.placeText }));
          c.rallies.slice().reverse().forEach(function (r) {
            card.appendChild(A.el("span", { class: "rl-gi-m" }, [A.el("b", { text: senderName(r) + ": " }), document.createTextNode(r.body || t("rallyDefault"))]));
          });
          card.appendChild(A.el("span", { class: "rl-gi-n", text: t("rallyOnWay", c.yes | 0) + mine }));
        }
        wrap.appendChild(card);
        if (!c.is_mine && c.my_answer !== "yes") {
          var yb = A.btn(t("rallyYes") + (c.others.length > 1 ? " (" + c.others.length + ")" : ""), "btn-small btn-green btn-block rl-gi-yes", function () { yb.disabled = true; answer(c.id, "yes", false, true).then(function () { yb.disabled = false; }); });
          wrap.appendChild(yb);
        }
      });
      wrap.appendChild(A.el("div", { class: "row", style: "margin-top:8px" }, [A.btn(t("rallyBtn"), "btn-small btn-block", function () { startCreate(g); })]));
    },
    openLink: openLink,
    barBadges: barBadges, barSectionHTML: barSectionHTML,
    list: function () { return state === "on" ? rallies.slice() : []; },
    stacks: function () { return state === "on" ? stacksOf(rallies) : []; },
    _heads: HEADS,
    drawFlags: function () { drawFlags(); }
  };
})();
