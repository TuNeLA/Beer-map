/* Öl Nu — 🍺 BARINFO: hours, prices and entré on the bar sheet (CONTRACT "⏰ ÖPPETTIDER · 🍾 SYSTEMET · 💰 PRIS · 🚪 ENTRÉ · 🌭 NATTMAT").
   window.BARINFO, in app.js mods(): init, onAuthed, barPopupHTML, barIcoHTML, settingsSheet. Server: migrations 0119–0122
   (bar_extra, report_bar_close, report_bar_price, bar_prices_in, suggest_club_info). Hours logic: js/oppet.js (window.OPPET).
   Bar sheet (no new buttons on the map):
   - ONE short line under the title (.ev-line, app.js lifts it): "🕐 Öppet till 01:00 · 🍺 72 kr" (+ clubs: "🚪 Kö: kort · 20 år · 100 kr").
   - In the ℹ️ Info fold: today's hours + "🕐 Fel tider?" (tonight's real closing time, newest report wins), prices per kind with
     "uppdaterat 3 dar sen" + "💰 Rapportera pris", and for clubs the queue buttons (they press the v12 BARSPLUS queue buttons,
     same server rule) + approved entré info + "✏️ Föreslå entré-info" (owner approves in stats.html).
   - LEGAL (Alkohollagen 7 kap., måttfullhet): prices are neutral info. No push, no ticker, no "cheapest" ranking, no medal.
   - ⚙️ "💰 Visa ölpriser på kartan" (localStorage olnu.prices, default off): a small "72 kr" tag on bar markers at zoom ≥ 14.
   A missing RPC (old database, PGRST202) = that part hides. Never breaks the map. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = {}, cache = {}, busy = {}, TTL = 90000;
  var PKEY = "olnu.prices", tags = {}, tagBoxes = {}, tagTimer = 0, TAG_Z = 14, TAG_TTL = 600000;
  var DRINK = { bar: 1, pub: 1, nightclub: 1, biergarten: 1 };
  var KINDS = ["stor", "cider", "drink"];
  var CODES = ["invalid_bar", "invalid_time", "invalid_kind", "invalid_price", "invalid_info", "slow_down", "not_authenticated"];

  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function esc(s) { return U.esc(s); }
  var lastPick = {};
  function pick(k, a) { if (!a || !a.length) return ""; var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === lastPick[k]) i = (i + 1) % a.length; lastPick[k] = i; return a[i]; }
  function O() { return window.OPPET || null; }
  function kindName(k) { return { stor: L("Stor stark", "Large beer"), cider: "Cider", drink: "Drink" }[k] || k; }
  function kindEmo(k) { return { stor: "🍺", cider: "🍏", drink: "🍸" }[k] || "🍺"; }
  function ago(ts) {
    var d = Date.parse(ts); if (!isFinite(d)) return "";
    var days = Math.floor((Date.now() - d) / 86400000);
    if (days <= 0) return L("i dag", "today");
    if (days === 1) return L("i går", "yesterday");
    return L(days + " dar sen", days + " days ago");
  }
  function codeOf(err) {
    var m = String((err && (err.message || err.details || err.hint)) || "");
    for (var i = 0; i < CODES.length; i++) if (m.indexOf(CODES[i]) >= 0) return CODES[i];
    return "error";
  }
  function call(name, params) {
    if (!A || !A.LIVE || !A.authed() || off[name]) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) { if (r.error && U.missing(r.error)) { off[name] = true; r.off = true; } return r; });
  }
  function isDrink(bar) { return !!(bar && DRINK[bar.type] && !bar.place); }
  function isClub(bar) { return !!(bar && bar.type === "nightclub"); }
  function qState(id) {
    try { var s = window.BARSPLUS && window.BARSPLUS.status ? window.BARSPLUS.status()[id] : null; return s && s.queue ? s : null; } catch (e) { return null; }
  }
  var QN = { none: ["ingen", "none"], short: ["kort", "short"], long: ["lång", "long"] };

  /* ---------- bar sheet ---------- */
  function lineHTML(bar) {
    var id = String(bar.id), d = cache[id] && cache[id].d, parts = [], o = O();
    var st = o ? o.barStatus(bar) : null, lb = o && st ? o.label(st) : null;
    if (lb) parts.push('<span class="' + lb.cls + '">' + esc(lb.t) + "</span>");
    var p = d && d.prices && d.prices.stor;
    if (p && isDrink(bar)) parts.push('<span class="bi-pr">🍺 ' + (p.kr | 0) + " kr</span>");
    if (isClub(bar)) {
      var q = qState(id); if (q) parts.push('<span class="bi-q q-' + esc(q.queue) + '">🚪 ' + esc(L("Kö: ", "Queue: ") + (QN[q.queue] || [q.queue, q.queue])[sv() ? 0 : 1]) + "</span>");
      var c = clubOf(bar, d);
      if (c && (c.age || c.fee != null)) parts.push("<span>" + esc([c.age ? c.age + L(" år", "+") : "", c.fee != null ? (c.fee ? c.fee + " kr" : L("fri entré", "free entry")) : ""].filter(Boolean).join(" · ")) + "</span>");
    }
    return '<div class="ev-line bi-line" data-bi="' + esc(id) + '"' + (parts.length ? "" : " hidden") + ">" + parts.join('<i class="bi-dot">·</i>') + "</div>";
  }
  function clubOf(bar, d) {
    var c = d && d.club ? d.club : null, o = O();
    if (!c && o && o.clubAge(bar.id)) c = { age: o.clubAge(bar.id), osm: true };
    return c;
  }
  function weekHTML(bar) {
    var o = O(); if (!o) return "";
    var w = o.hoursFor(bar); if (!w) return "";
    var today = o.wall(Date.now()).dow, parts = o.day(w, today);
    var txt = parts.length ? parts.map(function (x) { return o.hhmm(x[0]) + "–" + (x[1] === 1440 ? "24:00" : o.hhmm(x[1])); }).join(", ") : L("stängt", "closed");
    return '<div class="bi-r">' + esc(L("Idag: ", "Today: ") + txt) + ' <span class="muted">(OpenStreetMap)</span></div>';
  }
  function infoHTML(bar) {
    var id = String(bar.id), d = cache[id] && cache[id].d, live = A && A.LIVE && A.authed(), h = "";
    var o = O(), st = o ? o.barStatus(bar) : null;
    // hours
    var hh = weekHTML(bar);
    if (d && d.close) hh += '<div class="bi-r">' + esc(d.close.closed ? L("Rapporterat: stängt ikväll", "Reported: closed tonight") :
      L("Rapporterat ikväll: stänger ", "Reported tonight: closes ") + o.hhmm(d.close.min)) + ' <span class="muted">(' + esc(L(d.close.n + " rapport" + (d.close.n === 1 ? "" : "er"), d.close.n + " report" + (d.close.n === 1 ? "" : "s"))) + ")</span></div>";
    if (!hh && st == null) hh = '<div class="bi-r muted">' + esc(L("Inga öppettider i kartdatan.", "No opening hours in the map data.")) + "</div>";
    if (live && !off.report_bar_close) hh += '<button type="button" class="bi-btn" data-bia="close">🕐 ' + esc(L("Fel tider?", "Wrong hours?")) + "</button>";
    h += '<div class="bi-sec"><div class="bi-h">' + esc(L("🕐 Öppettider", "🕐 Opening hours")) + "</div>" + hh + "</div>";
    // prices (bars only)
    if (isDrink(bar) && !off.bar_extra) {
      var ph = "", pr = (d && d.prices) || {};
      KINDS.forEach(function (k) {
        var p = pr[k]; if (!p) return;
        ph += '<div class="bi-r">' + kindEmo(k) + " " + esc(kindName(k)) + ": <b>" + (p.kr | 0) + " kr</b> " +
          '<span class="muted">· ' + esc(L("uppdaterat ", "updated ") + ago(p.at)) + (p.n > 1 ? esc(L(" · " + p.n + " rapporter", " · " + p.n + " reports")) : "") + "</span></div>";
      });
      if (!ph) ph = '<div class="bi-r muted">' + esc(d ? L("Inget pris rapporterat än.", "No price reported yet.") : L("Laddar…", "Loading…")) + "</div>";
      if (live && !off.report_bar_price) ph += '<button type="button" class="bi-btn" data-bia="price">💰 ' + esc(L("Rapportera pris", "Report price")) + "</button>";
      ph += '<div class="bi-note">' + esc(L("Användarnas egna uppgifter. Drick lagom.", "Reported by users. Drink in moderation.")) + "</div>";
      h += '<div class="bi-sec"><div class="bi-h">' + esc(L("💰 Pris", "💰 Price")) + "</div>" + ph + "</div>";
    }
    // clubs: queue now + entré
    if (isClub(bar) || (d && d.club)) {
      var ch = "", q = qState(id), c = clubOf(bar, d);
      if (isClub(bar)) {
        ch += '<div class="bi-r">' + esc(L("Kö nu: ", "Queue now: ")) + "<b>" + esc(q ? (QN[q.queue] || [q.queue, q.queue])[sv() ? 0 : 1] : L("okänt", "unknown")) + "</b></div>";
        if (live && window.BARSPLUS) ch += '<div class="bi-qs">' + ["none", "short", "long"].map(function (k) {
          return '<button type="button" class="bi-qb q-' + k + '" data-biq="' + k + '">' + esc((QN[k] || [k, k])[sv() ? 0 : 1]) + "</button>";
        }).join("") + "</div>";
      }
      if (c) {
        var bits = [];
        if (c.age) bits.push(L("Åldersgräns ", "Age ") + c.age);
        if (c.fee != null) bits.push(c.fee ? L("Entré ", "Entry ") + c.fee + " kr" : L("Fri entré", "Free entry"));
        if (c.dress) bits.push(L("Klädkod: ", "Dress code: ") + c.dress);
        ch += '<div class="bi-r">' + esc(bits.join(" · ")) + (c.osm ? ' <span class="muted">(OpenStreetMap)</span>' : "") + "</div>";
      }
      if (live && !off.suggest_club_info) ch += d && d.club_pending ? '<div class="bi-r muted">' + esc(L("⏳ Ditt förslag väntar på Generalen.", "⏳ Your suggestion waits for review.")) + "</div>" :
        '<button type="button" class="bi-btn" data-bia="club">✏️ ' + esc(L("Föreslå entré-info", "Suggest entry info")) + "</button>";
      h += '<div class="bi-sec"><div class="bi-h">' + esc(L("🚪 Kö och entré", "🚪 Queue and entry")) + "</div>" + ch + "</div>";
    }
    return '<div class="bi-info" data-bi="' + esc(id) + '">' + h + "</div>";
  }
  function barPopupHTML(bar) {
    if (!bar || bar.id == null || bar.type === "arena") return "";
    if (!isDrink(bar) && !(O() && O().hoursFor(bar))) return "";
    return lineHTML(bar) + infoHTML(bar);
  }
  function refreshDom(id) {
    var bar = barOf(id); if (!bar) return;
    var sel = '[data-bi="' + String(id).replace(/["\\]/g, "") + '"]';
    document.querySelectorAll(".bi-line" + sel).forEach(function (x) { x.outerHTML = lineHTML(bar); });
    document.querySelectorAll(".bi-info" + sel).forEach(function (x) { x.outerHTML = infoHTML(bar); });
  }
  var seen = {};
  function barOf(id) { return seen[id] || (window.BARS && window.BARS.byId(id)) || null; }
  function fetchExtra(id, force) {
    if (off.bar_extra || busy[id]) return;
    if (!force && cache[id] && Date.now() - cache[id].at < TTL) return;
    busy[id] = true;
    call("bar_extra", { p_bar_id: id }).then(function (r) {
      busy[id] = false;
      if (r.error) return;
      var d = A.parseData(r.data);
      cache[id] = { d: d, at: Date.now() };
      try { if (O()) O().setOverride(id, d.close); } catch (e) {}
      refreshDom(id);
    });
  }

  /* ---------- sheets ---------- */
  function errToast(r) {
    var c = codeOf(r.error);
    var m = { slow_down: L("Lugn i stormen – vänta lite och försök igen.", "Slow down – try again soon."),
      invalid_price: L("Priset ska vara 20–300 kr.", "Price must be 20–300 kr."), invalid_time: L("Ange en tid mellan 16:00 och 06:00.", "Pick a time between 16:00 and 06:00."),
      invalid_info: L("Kolla uppgifterna (ålder 18–30, inga länkar eller nummer).", "Check the info (age 18–30, no links or numbers).") }[c];
    A.toast(m || L("Gick int' att skicka. Försök igen.", "Could not send. Try again."), { err: true, ms: 4500 });
  }
  function seg(el, list, cur, onPick) {
    var box = el("div", { class: "ds-seg bi-seg", role: "tablist" });
    list.forEach(function (x) {
      var b = el("button", { type: "button", role: "tab", "aria-selected": String(x[0] === cur), text: x[1] });
      b.addEventListener("click", function () { box.querySelectorAll("button").forEach(function (y) { y.setAttribute("aria-selected", String(y === b)); }); onPick(x[0]); });
      box.appendChild(b);
    });
    return box;
  }
  function priceSheet(bar) {
    var id = String(bar.id), d = cache[id] && cache[id].d, kind = "stor";
    A.map.closePopup();
    A.openSheet(L("💰 Rapportera pris", "💰 Report a price"), function (body) {
      var el = A.el;
      body.appendChild(el("p", { class: "muted", text: (bar.name || "") + " · " + L("Vad kostar det här ikväll?", "What does it cost here tonight?") }));
      var inp = el("input", { class: "inp bi-kr", type: "number", inputmode: "numeric", min: "20", max: "300", step: "1", "aria-label": L("Pris i kronor", "Price in kronor") });
      function preset() { var p = (d && d.mine && d.mine[kind]) || (d && d.prices && d.prices[kind] && d.prices[kind].kr) || (kind === "stor" ? 70 : kind === "cider" ? 75 : 120); inp.value = String(p); }
      body.appendChild(seg(el, KINDS.map(function (k) { return [k, kindEmo(k) + " " + kindName(k)]; }), kind, function (k) { kind = k; preset(); }));
      preset();
      var minus = A.btn("−5", "btn-small", function () { inp.value = String(Math.max(20, (+inp.value || 0) - 5)); });
      var plus = A.btn("+5", "btn-small", function () { inp.value = String(Math.min(300, (+inp.value || 0) + 5)); });
      body.appendChild(el("div", { class: "row bi-krrow" }, [minus, inp, el("span", { class: "bi-kr-u", text: "kr" }), plus]));
      body.appendChild(el("p", { class: "muted", text: L("20–300 kr. En rapport per sort och dag (ny rapport samma dag rättar den gamla). Visas som info, inte som reklam.",
        "20–300 kr. One report per kind and day (a new one the same day corrects it). Shown as info, not as an ad.") }));
      var send = A.btn(L("✅ Skicka", "✅ Send"), "btn-amber btn-block", function () {
        var kr = Math.round(+inp.value);
        if (!(kr >= 20 && kr <= 300)) { A.toast(L("Priset ska vara 20–300 kr.", "Price must be 20–300 kr."), { err: true }); return; }
        send.disabled = true;
        call("report_bar_price", { p_bar_id: id, p_kind: kind, p_kr: kr }).then(function (r) {
          send.disabled = false;
          if (r.error) { if (!r.off) errToast(r); return; }
          A.closeSheet();
          A.toast(pick("price", sv() ? ["💰 Prisrapport mottagen. Underrättelsetjänsten tackar.", "💰 Noterat i fältboken. Tack, spanare!",
            "💰 Priset ä inrapporterat. Kamraterna vet nu vad dä kostar.", "💰 Rapport inne. Bra spaning, soldat."] : ["💰 Price saved. Thanks!"]), { cls: "skal", ms: 4000 });
          fetchExtra(id, true); tagBoxes = {}; loadTags();
        });
      });
      body.appendChild(send);
    });
  }
  function timeSheet(bar) {
    var id = String(bar.id), val = null;
    A.map.closePopup();
    A.openSheet(L("🕐 När stänger dom ikväll?", "🕐 When do they close tonight?"), function (body) {
      var el = A.el;
      body.appendChild(el("p", { class: "muted", text: (bar.name || "") + " · " + L("Den senaste rapporten gäller för alla i natt.", "The newest report counts for everyone tonight.") }));
      var box = el("div", { class: "bi-times" });
      [["closed", L("🔒 Stängt ikväll", "🔒 Closed tonight")], ["22:00"], ["23:00"], ["00:00"], ["01:00"], ["02:00"], ["03:00"]].forEach(function (x) {
        var b = el("button", { type: "button", class: "ds-chip", "aria-pressed": "false", text: x[1] || x[0] });
        b.addEventListener("click", function () { val = x[0]; tm.value = ""; box.querySelectorAll("button").forEach(function (y) { y.setAttribute("aria-pressed", String(y === b)); }); });
        box.appendChild(b);
      });
      body.appendChild(box);
      var tm = el("input", { class: "inp bi-tm", type: "time", "aria-label": L("Annan tid", "Other time") });
      tm.addEventListener("input", function () { val = tm.value || null; box.querySelectorAll("button").forEach(function (y) { y.setAttribute("aria-pressed", "false"); }); });
      body.appendChild(el("label", { class: "bi-tml" }, [el("span", { text: L("Annan tid: ", "Other time: ") }), tm]));
      var send = A.btn(L("✅ Skicka", "✅ Send"), "btn-amber btn-block", function () {
        if (!val) { A.toast(L("Välj en tid först.", "Pick a time first."), { ms: 3000 }); return; }
        send.disabled = true;
        call("report_bar_close", { p_bar_id: id, p_close: val }).then(function (r) {
          send.disabled = false;
          if (r.error) { if (!r.off) errToast(r); return; }
          A.closeSheet();
          A.toast(pick("close", sv() ? ["🕐 Tiden ä rättad. Hela truppen vet nu.", "🕐 Rapport mottagen. Klockan ä synkad för natten.",
            "🕐 Noterat! Kartan vet bättre än OpenStreetMap ikväll."] : ["🕐 Thanks – the time is fixed for tonight."]), { cls: "skal", ms: 4000 });
          fetchExtra(id, true);
        });
      });
      body.appendChild(send);
    });
  }
  function clubSheet(bar) {
    var id = String(bar.id), d = cache[id] && cache[id].d, c = (d && d.club) || {};
    A.map.closePopup();
    A.openSheet(L("✏️ Entré-info", "✏️ Entry info"), function (body) {
      var el = A.el;
      body.appendChild(el("p", { class: "muted", text: (bar.name || "") + " · " + L("Generalen kollar förslaget innan det syns för alla.", "The owner checks it before everyone sees it.") }));
      var age = el("select", { class: "inp", "aria-label": L("Åldersgräns", "Age limit") });
      [["", L("Åldersgräns: vet ej", "Age limit: don't know")]].concat([18, 20, 21, 22, 23, 24, 25, 27, 30].map(function (a) { return [String(a), a + L(" år", "+")]; })).forEach(function (x) {
        var o = el("option", { value: x[0], text: x[1] }); if (String(c.age || "") === x[0]) o.selected = true; age.appendChild(o);
      });
      var fee = el("input", { class: "inp", type: "number", inputmode: "numeric", min: "0", max: "1000", placeholder: L("Entré i kr (0 = fri)", "Entry in kr (0 = free)"), value: c.fee != null ? String(c.fee) : "" });
      var dress = el("input", { class: "inp", maxlength: "40", placeholder: L("Klädkod (t.ex. ingen keps)", "Dress code (e.g. no caps)"), value: c.dress || "", autocomplete: "off" });
      body.appendChild(el("div", { class: "bi-form" }, [age, fee, dress]));
      var send = A.btn(L("✅ Skicka förslag", "✅ Send suggestion"), "btn-amber btn-block", function () {
        var a = age.value ? +age.value : null, f = fee.value !== "" ? Math.round(+fee.value) : null, t = dress.value.trim() || null;
        if (a == null && f == null && !t) { A.toast(L("Fyll i minst en sak.", "Fill in at least one thing."), { ms: 3000 }); return; }
        send.disabled = true;
        call("suggest_club_info", { p_bar_id: id, p_age: a, p_fee: f, p_dress: t }).then(function (r) {
          send.disabled = false;
          if (r.error) { if (!r.off) errToast(r); return; }
          var res = A.parseData(r.data);
          A.closeSheet();
          A.toast(res.status === "ok" ? L("✅ Inne direkt – du ä betrodd.", "✅ Live right away.") :
            pick("club", sv() ? ["📨 Förslaget skickat till Generalen för godkännande.", "📨 Rapporten ligger på Generalens bord. Tack!",
              "📨 Mottaget. Högkvarteret granskar och godkänner."] : ["📨 Sent for review. Thanks!"]), { cls: "skal", ms: 4500 });
          fetchExtra(id, true);
        });
      });
      body.appendChild(send);
    });
  }

  /* ---------- 💰 price tags on the map ---------- */
  function tagsOn() { try { return U.ls.get(PKEY, "0") === "1"; } catch (e) { return false; } }
  function loadTags() {
    if (!A || !A.map || !tagsOn() || off.bar_prices_in || !A.authed()) return;
    var m = A.map; if (m.getZoom() < TAG_Z) return;
    var c = m.getCenter(), s = Math.floor(c.lat / 0.2) * 0.2, w = Math.floor(c.lng / 0.4) * 0.4, k = s.toFixed(1) + "_" + w.toFixed(1);
    if (tagBoxes[k] && Date.now() - tagBoxes[k] < TAG_TTL) return;
    tagBoxes[k] = Date.now();
    call("bar_prices_in", { p_s: s - 0.1, p_w: w - 0.2, p_n: s + 0.3, p_e: w + 0.6 }).then(function (r) {
      if (r.error) { delete tagBoxes[k]; return; }
      var list = A.parseData(r.data), ch = false;
      (Array.isArray(list) ? list : []).forEach(function (x) { if (x && x.bar_id && x.kr && tags[x.bar_id] !== x.kr) { tags[x.bar_id] = x.kr | 0; ch = true; } });
      if (ch) A.render();
    });
  }
  function settingsBlock(body) {
    var el = A.el;
    body.appendChild(el("h3", { text: L("💰 Ölpriser", "💰 Beer prices") }));
    var sw = el("button", { type: "button", class: "switch bi-switch", role: "switch", "aria-checked": String(tagsOn()), "aria-label": L("Visa ölpriser på kartan", "Show beer prices on the map") });
    sw.addEventListener("click", function () {
      var now = sw.getAttribute("aria-checked") !== "true";
      try { U.ls.set(PKEY, now ? "1" : "0"); } catch (e) {}
      sw.setAttribute("aria-checked", String(now));
      if (now) loadTags();
      A.render();
    });
    body.appendChild(el("div", { class: "toggle-row" }, [el("span", { text: L("💰 Visa ölpriser på kartan", "💰 Show beer prices on the map") }), sw]));
    body.appendChild(el("p", { class: "muted", text: L("En liten prislapp (stor stark) på krogarna från zoom 14. Priserna rapporteras av användarna och ä bara info.",
      "A small price tag (large beer) on bars from zoom 14. Prices come from users and are info only.") }));
  }

  window.BARINFO = {
    init: function (api) {
      A = api;
      A.map.on("popupopen", function (e) {
        var root = e.popup && e.popup.getElement && e.popup.getElement(); if (!root) return;
        root.querySelectorAll(".bi-info[data-bi]").forEach(function (x) { var id = x.getAttribute("data-bi"); fetchExtra(id, false); });
        if (root._olnuBi) return;
        root._olnuBi = true;
        root.addEventListener("click", function (ev) {
          var b = ev.target && ev.target.closest && ev.target.closest("[data-bia], [data-biq]"); if (!b) return;
          var box = b.closest("[data-bi]"), id = box && box.getAttribute("data-bi"), bar = id ? barOf(id) : null;
          if (!bar) return;
          ev.preventDefault(); ev.stopPropagation();
          var q = b.getAttribute("data-biq");
          if (q) {   // the v12 queue report (300 m rule, 10 min limit) through BARSPLUS's own button
            var real = root.querySelector('.bp[data-bp="' + id.replace(/["\\]/g, "") + '"] [data-bpq="' + q + '"]');
            if (real) { real.click(); setTimeout(function () { refreshDom(id); }, 2500); }
            else A.toast(L("Kö-rapporten funkar inte just nu.", "Queue report is not available now."), { ms: 3000 });
            return;
          }
          var a = b.getAttribute("data-bia");
          if (a === "price") priceSheet(bar); else if (a === "close") timeSheet(bar); else if (a === "club") clubSheet(bar);
        });
      });
      A.map.on("moveend", function () { clearTimeout(tagTimer); tagTimer = setTimeout(loadTags, 700); });
    },
    onAuthed: function () { setTimeout(loadTags, 2500); },
    barPopupHTML: function (bar) { if (bar && bar.id != null) seen[String(bar.id)] = bar; return barPopupHTML(bar); },
    barIcoHTML: function (bar) {
      if (!bar || !tagsOn() || !A || A.map.getZoom() < TAG_Z) return "";
      var kr = tags[String(bar.id)];
      return kr ? '<span class="bi-tag" aria-hidden="true">' + kr + " kr</span>" : "";
    },
    settingsSheet: function (body) { if (A && A.LIVE && A.el) settingsBlock(body); },
    // tests
    _cache: cache, _tags: tags, _refresh: refreshDom
  };
})();
