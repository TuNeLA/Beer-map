/* Öl Nu v12 — KROGARNA (CONTRACT "v12 KROGARNA", migration 0014).
   1. Kö-rapport  2. Kvällens erbjudande  3. Ölsorter (+ "Vad dricker stan?")  4. Ta över krogen  5. Krogtips.
   Hooks from app.js mods(): init, onAuthed, onPoll, barPopupHTML, barBadgeHTML, barIcoHTML, onBeerAccepted,
   topSheet, groupItem. Plus window.NEWS hooks: newsTemplates, newsCands.
   Every RPC may be missing on an older database: that part then hides quietly. Never breaks the map. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N, t = I.t, esc = U.esc;
  var A = null;
  var off = {};                    // rpc name -> true when it is missing on this server
  var state = "unknown";           // bar_status: "unknown" | "on" | "missing"
  var status = {};                 // bar id -> bar_status row
  var statusKey = "", statusAt = 0, statusBusy = false, statusAgain = false;
  var STATUS_MS = 40000, NEAR_M = 300;
  var openMore = {};               // bar id -> details open
  var entrySel = {};               // bar id -> chosen entry ("free" | "low" | "high")
  var barCache = {};               // bar id -> bar (from popups)
  var prevOwners = null;           // bar id -> {mine, who}
  var takeNews = [];               // recent takeover changes for the ticker
  var TYPES = ["lager", "pilsner", "ipa", "apa", "stout", "vete", "ale", "sour", "alkfri", "annan"];
  var TYPE_KEY = "olnu.beerType", NOTED_KEY = "olnu.takeNoted";
  var CODES = ["too_far", "outside_sweden", "invalid_bar", "invalid_queue", "invalid_entry", "invalid_offer", "offer_blocked",
    "slow_down", "own_offer", "offer_not_found", "invalid_vote", "invalid_type", "no_beer", "not_member", "not_admin",
    "invalid_msg", "not_authenticated"];

  /* ---------- Helpers ---------- */
  function call(name, params) {
    if (!A || !A.LIVE || !A.authed() || off[name]) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) { off[name] = true; r.off = true; if (name === "bar_status") { state = "missing"; status = {}; A.render(); } }
      return r;
    });
  }
  function codeOf(err) {
    var m = String((err && (err.message || err.details || err.hint)) || "");
    for (var i = 0; i < CODES.length; i++) if (m.indexOf(CODES[i]) >= 0) return CODES[i];
    return "error";
  }
  var lastPick = {};
  function pick(key, list) {
    list = list || [];
    if (!list.length) return "";
    var i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === lastPick[key]) i = (i + 1) % list.length;
    lastPick[key] = i;
    return list[i];
  }
  function on() { return !!(A && A.LIVE && state !== "missing"); }
  function barOf(id) { return barCache[id] || (window.BARS && window.BARS.byId(id)) || null; }
  function barNameOf(id) { var b = barOf(id); return (b && b.name) || null; }
  function cleanName(s) { return String(s || t("unnamedBar")).replace(/\s+/g, " ").trim().slice(0, 60); }
  function minsAgo(ts) { var d = Date.parse(ts); return isFinite(d) ? Math.max(0, Math.floor((Date.now() - d) / 60000)) : 0; }
  function award() { if (window.MEDALS && window.MEDALS.award) setTimeout(function () { window.MEDALS.award(null, true); }, 1500); }
  function fx() { try { window.FX.unlock(); window.FX.sound.clink(); window.FX.vibrate([18, 40, 18]); } catch (e) {} }
  function nightTs() { return U.next5am().getTime(); }
  function ownerWho(s) { return s.owner_name || null; }

  /* ---------- bar_status (one call per poll, max every 40 s) ---------- */
  function loadStatus(force) {
    if (!A || !A.LIVE || !A.authed() || state === "missing") return Promise.resolve();
    if (statusBusy) { if (force) statusAgain = true; return Promise.resolve(); }
    if (!force && Date.now() - statusAt < STATUS_MS) return Promise.resolve();
    statusBusy = true; statusAt = Date.now();
    return call("bar_status").then(function (r) {
      if (r.error) return;
      state = "on";
      var m = {};
      (r.data || []).forEach(function (row) {
        if (!row || row.bar_id == null) return;
        if (typeof row.offers === "string") { try { row.offers = JSON.parse(row.offers); } catch (e) { row.offers = []; } }
        if (!Array.isArray(row.offers)) row.offers = [];
        m[String(row.bar_id)] = row;
      });
      status = m;
      checkOwners();
      var key = JSON.stringify(m);
      if (key !== statusKey) { statusKey = key; A.render(); }
    }).then(function () {
      statusBusy = false;
      if (statusAgain) { statusAgain = false; loadStatus(true); }
    }, function () { statusBusy = false; });
  }

  /* ---------- 4. Ta över krogen: changes, own takeover toast, push ---------- */
  function checkOwners() {
    var now = {}, noted = U.ls.getJSON(NOTED_KEY, {}) || {}, dirty = false, ts = nightTs();
    Object.keys(noted).forEach(function (k) { if (noted[k] !== ts) { delete noted[k]; dirty = true; } });
    Object.keys(status).forEach(function (id) {
      var s = status[id];
      if (!s || (s.owner_n | 0) < 1) return;
      now[id] = { mine: !!s.owner_mine, who: ownerWho(s), n: s.owner_n | 0 };
      var bar = barNameOf(id);
      if (prevOwners) {
        var p = prevOwners[id];
        if (bar && (!p || p.mine !== now[id].mine || p.who !== now[id].who)) {
          takeNews.push({ bar: bar, who: now[id].who, n: now[id].n, at: Date.now() });
        }
      }
      if (s.owner_mine && !noted[id]) {
        noted[id] = ts; dirty = true;
        noteTakeover(id, s);
      }
    });
    if (prevOwners) {
      Object.keys(prevOwners).forEach(function (id) {
        if (prevOwners[id].mine && !(now[id] && now[id].mine)) {
          var nm = barNameOf(id);
          if (nm) A.toast(t("bpLostToast", nm), { ms: 5000 });
        }
      });
    }
    takeNews = takeNews.filter(function (x) { return Date.now() - x.at < 45 * 60e3; }).slice(-6);
    prevOwners = now;
    if (dirty) U.ls.setJSON(NOTED_KEY, noted);
  }
  function noteTakeover(id, s) {
    var bar = barNameOf(id) || t("unnamedBar");
    var line = pick("take", t("bpTakeToasts")).replace(/\{bar\}/g, bar).replace(/\{grupp\}/g, s.owner_name || t("bpNewsGroup"));
    A.toast(line, { cls: "promo", ms: 6000 });
    fx();
    call("note_takeover", { p_bar_id: id }).then(function (r) {
      if (r.error) return;
      var d = A.parseData(r.data);
      if (d.is_new && A.PUSH_ON) A.invoke("notify-group", { event: "takeover", bar_id: id });
      if (d.ok) award();
    });
  }

  /* ---------- Popup ---------- */
  function queueLine(s) {
    var names = t("bpQueueNames") || {};
    return t("bpQueueLine", names[s.queue] || s.queue, t("bpAgo", minsAgo(s.queue_at)), s.queue_n | 0);
  }
  function offerHTML(o) {
    var mv = o.my_vote | 0, mine = !!o.is_mine;
    return '<div class="bp-of"><span class="bp-of-t">' + esc(o.body) + "</span>" +
      '<span class="bp-of-v">' +
      '<button type="button" class="bp-v up' + (mv === 1 ? " on" : "") + '" data-bpv="1" data-of="' + esc(String(o.id)) + '"' +
        (mine ? " disabled" : "") + ' aria-pressed="' + (mv === 1) + '" aria-label="👍 ' + esc(t("bpVoteAria", o.up | 0)) + '">👍 ' + (o.up | 0) + "</button>" +
      '<button type="button" class="bp-v dn' + (mv === -1 ? " on" : "") + '" data-bpv="-1" data-of="' + esc(String(o.id)) + '"' +
        (mine ? " disabled" : "") + ' aria-pressed="' + (mv === -1) + '" aria-label="' + esc(t("bpDown")) + '">👎 ' + (o.down | 0) + "</button>" +
      "</span></div>";
  }
  // Compact: owner + queue are one short line each; offers and all buttons sit in ONE collapsed section.
  function barPopupHTML(bar, list) {
    var e = "";
    try { e = etaSectionHTML(bar); } catch (x) { e = ""; }
    return e + bpPopupHTML(bar, list);
  }
  function bpPopupHTML(bar, list) {
    if (!on() || !bar || bar.id == null) return "";
    var id = String(bar.id), s = status[id], h = "";
    barCache[id] = bar;
    var name = bar.name || t("unnamedBar");
    if (s && (s.owner_n | 0) > 0) {
      var own = s.owner_name ? t("bpOwner", s.owner_name, name, s.owner_n | 0) : t("bpOwnerAnon", name, s.owner_n | 0);
      h += '<div class="bp-own' + (s.owner_mine ? " mine" : "") + '"' + (s.owner_mine ? ' title="' + esc(t("bpOwnerMine")) + '"' : "") + ">" + esc(own) + "</div>";
    }
    if (s && s.queue) {
      var ent = (t("bpEntryShort") || {})[s.entry];
      h += '<div class="bp-q q-' + esc(s.queue) + '">' + esc(queueLine(s)) + (ent ? '<span class="bp-ent-l"> · 🎟️ ' + esc(ent) + "</span>" : "") + "</div>";
    }
    var offers = s && s.offers ? s.offers.slice(0, 3) : [], authed = A.authed();
    if (!offers.length && !authed) return h ? '<div class="bp" data-bp="' + esc(id) + '">' + h + "</div>" : "";
    var body = "";
    // Offers (legal: Alkohollagen 7 kap.): user-written, passive, only inside the bar popup, neutral wording.
    if (offers.length) {
      body += '<div class="bp-ofs"><div class="bp-of-h">' + esc(t("bpOfferHead")) + "</div>" + offers.map(offerHTML).join("") +
        '<div class="bp-of-note">' + esc(t("bpOfferNote")) + "</div></div>";
    }
    if (authed) {
      var qn = t("bpQueueNames") || {}, en = t("bpEntryShort") || {}, qe = t("bpQueueEmoji") || {}, sel = entrySel[id] || "";
      body += '<div class="bp-lbl">' + esc(t("bpEntryQ")) + "</div>" +
        '<div class="bp-row bp-ent">' + ["free", "low", "high"].map(function (e) {
          return '<button type="button" class="bp-chip' + (sel === e ? " on" : "") + '" data-bpe="' + e + '" aria-pressed="' + (sel === e) + '">' + esc(en[e] || e) + "</button>";
        }).join("") + "</div>" +
        '<div class="bp-lbl">' + esc(t("bpQueueQ")) + "</div>" +
        '<div class="bp-row bp-qs">' + ["none", "short", "long"].map(function (q) {
          return '<button type="button" class="bp-qb q-' + q + '" data-bpq="' + q + '">' + (qe[q] || "") + " " + esc(qn[q] || q) + "</button>";
        }).join("") + "</div>" +
        '<div class="bp-row bp-acts">' +
          (off.add_offer ? "" : '<button type="button" class="bp-act" data-bpa="offer">' + esc(t("bpOfferAdd")) + "</button>") +
          (off.send_tip ? "" : '<button type="button" class="bp-act" data-bpa="tip">' + esc(t("bpTipBtn")) + "</button>") +
        "</div>";
    }
    h += '<details class="bp-more"' + (openMore[id] ? " open" : "") + "><summary>" +
      esc(offers.length ? t("bpMoreN", offers.length) : t("bpMore")) + "</summary>" + body + "</details>";
    return '<div class="bp" data-bp="' + esc(id) + '">' + h + "</div>";
  }

  /* ---------- Map icons ---------- */
  function flagLabel(s) { return "🏰" + (s.owner_name ? " " + s.owner_name : ""); }
  function barIcoHTML(bar) {
    if (!on() || !bar) return "";
    var s = status[String(bar.id)]; if (!s) return "";
    var h = "";
    if ((s.owner_n | 0) > 0) h += '<span class="bi-flag' + (s.owner_mine ? " mine" : "") + '">' + esc(flagLabel(s)) + "</span>";
    if (s.queue) h += '<span class="bi-q q-' + esc(s.queue) + '" aria-hidden="true"></span>';
    return h;
  }
  function barBadgeHTML(bar, list, zoom) {
    if (!on() || !bar) return "";
    var s = status[String(bar.id)]; if (!s) return "";
    var h = "";
    if ((s.owner_n | 0) > 0) h += '<span class="bm-flag' + (s.owner_mine ? " mine" : "") + '">' + esc(flagLabel(s)) + "</span>";
    if (s.queue) h += '<span class="bm-q q-' + esc(s.queue) + '" aria-hidden="true">🚶</span>';
    return h;
  }

  /* ---------- Position (for queue reports and offers) ---------- */
  function hereFor(bar) {
    return A.getPosition().then(function (pos) {
      var lat = pos.coords.latitude, lng = pos.coords.longitude;
      try { A.setLastLoc(lat, lng); } catch (e) {}
      if (U.haversine(lat, lng, bar.lat, bar.lng) > NEAR_M + 25) { A.toast(pick("far", t("bpTooFar")), { err: true, ms: 5000 }); return null; }
      return { lat: lat, lng: lng };
    }, function (err) {
      if (err && err.code === 1) A.locError(err); else A.toast(t("bpNeedPos"), { err: true, ms: 5000 });
      return null;
    });
  }
  function serverErr(r, extra) {
    var c = codeOf(r.error);
    if (c === "too_far") { A.toast(pick("far", t("bpTooFar")), { err: true, ms: 5000 }); return; }
    if (extra && extra[c]) { A.toast(extra[c], { err: true, ms: 5000 }); return; }
    A.toast(c === "outside_sweden" || c === "not_authenticated" ? A.errMsg(r.error) : t("bpFail"), { err: true });
  }

  /* ---------- 1. Kö-rapport ---------- */
  function reportQueue(bar, q, button) {
    if (!bar || button.disabled) return;
    var id = String(bar.id), ent = entrySel[id] || null;
    button.disabled = true; button.classList.add("busy");
    hereFor(bar).then(function (me) {
      if (!me) return null;
      return call("report_queue", { p_bar_id: id, p_bar_name: cleanName(bar.name), p_bar_lat: bar.lat, p_bar_lng: bar.lng,
        p_lat: me.lat, p_lng: me.lng, p_queue: q, p_entry: ent });
    }).then(function (r) {
      button.disabled = false; button.classList.remove("busy");
      if (!r) return;
      if (r.error) { if (!r.off) serverErr(r); return; }
      var d = A.parseData(r.data);
      if (d.ok === false) { A.toast(t("bpQueueWait", U.mmss((d.wait_seconds | 0) * 1000)), { ms: 4500 }); return; }
      entrySel[id] = "";
      A.toast(pick("q" + q, (t("bpQueueToasts") || {})[q]), { cls: "skal", ms: 4500 });
      fx(); award();
      loadStatus(true);
    });
  }

  /* ---------- 2. Kvällens erbjudande (legal: user-written, passive; popup only, no push/ticker/medal) ---------- */
  function offerSheet(bar) {
    var el = A.el;
    A.map.closePopup();
    A.openSheet(t("bpOfferTitle"), function (body) {
      body.appendChild(el("p", { class: "muted", text: cleanName(bar.name) }));
      var inp = el("input", { class: "inp", id: "bp-offer-inp", maxlength: "60", enterkeyhint: "send", placeholder: t("bpOfferPh"), autocomplete: "off" });
      var left = el("div", { class: "muted bp-left", text: t("bpOfferLeft", 60) });
      inp.addEventListener("input", function () { left.textContent = t("bpOfferLeft", 60 - inp.value.length); });
      var send = A.btn(t("bpOfferSend"), "btn-amber btn-block", function () { go(); });
      function go() {
        var v = inp.value.replace(/\s+/g, " ").trim();
        if (v.length < 3 || v.length > 60) { A.toast(t("bpOfferInvalid"), { err: true }); return; }
        if (send.disabled) return;
        send.disabled = true;
        hereFor(bar).then(function (me) {
          if (!me) return null;
          return call("add_offer", { p_bar_id: String(bar.id), p_bar_name: cleanName(bar.name), p_bar_lat: bar.lat, p_bar_lng: bar.lng,
            p_lat: me.lat, p_lng: me.lng, p_body: v });
        }).then(function (r) {
          send.disabled = false;
          if (!r) return;
          if (r.error) {
            if (r.off) { A.closeSheet(); return; }
            serverErr(r, { offer_blocked: t("bpOfferBlocked"), invalid_offer: t("bpOfferInvalid"), slow_down: t("bpOfferSlow") });
            return;
          }
          A.closeSheet();
          A.toast(pick("offer", t("bpOfferToasts")), { ms: 3500 });
          loadStatus(true);
        });
      }
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      body.appendChild(el("label", { class: "fld", for: "bp-offer-inp", text: t("bpOfferTitle") }));
      body.appendChild(inp);
      body.appendChild(left);
      body.appendChild(el("p", { class: "muted bp-hint", text: t("bpOfferHint") }));
      body.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [send]));
      setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);
    });
  }
  function vote(button) {
    var oid = button.getAttribute("data-of"), v = +button.getAttribute("data-bpv");
    if (!oid || button.disabled) return;
    var row = null, bid = null;
    Object.keys(status).forEach(function (k) { (status[k].offers || []).forEach(function (o) { if (String(o.id) === oid) { row = o; bid = k; } }); });
    var send = row && (row.my_vote | 0) === v ? 0 : v;
    button.disabled = true;
    call("vote_offer", { p_offer_id: +oid, p_vote: send }).then(function (r) {
      button.disabled = false;
      if (r.error) {
        if (r.off) return;
        var c = codeOf(r.error);
        if (c === "own_offer") A.toast(t("bpOfferOwn"));
        else if (c === "offer_not_found") { A.toast(t("bpOfferGone")); loadStatus(true); }
        else A.toast(t("bpFail"), { err: true });
        return;
      }
      var d = A.parseData(r.data);
      if (row) {
        row.up = d.up | 0; row.down = d.down | 0; row.my_vote = d.mine | 0;
        if (d.hidden && bid) status[bid].offers = status[bid].offers.filter(function (o) { return String(o.id) !== oid; });
        statusKey = ""; A.render();
      }
      if (send === 0) A.toast(t("bpVoteOff"), { ms: 2500 });
      else A.toast(pick("v" + send, send === 1 ? t("bpVoteUp") : t("bpVoteDown")), { ms: 3000 });
      setTimeout(function () { loadStatus(true); }, 800);
    });
  }

  /* ---------- 5. Krogtips ---------- */
  function tipSheet(bar) {
    var el = A.el;
    A.map.closePopup();
    A.withName(function () {
      A.openSheet(t("bpTipTitle"), function (body) {
        body.appendChild(el("p", { class: "muted", text: t("bpTipAbout", cleanName(bar.name)) }));
        var inp = el("input", { class: "inp", id: "bp-tip-inp", maxlength: "40", enterkeyhint: "done", placeholder: t("bpTipPh"), autocomplete: "off" });
        body.appendChild(inp);
        body.appendChild(el("h3", { text: t("bpTipPick") }));
        var box = el("div", { class: "bp-tip-groups" }, [el("p", { class: "muted", text: "…" })]);
        body.appendChild(box);
        A.rpc("my_groups").then(function (r) {
          if (!document.body.contains(box)) return;
          box.innerHTML = "";
          var gs = r.error ? [] : r.data || [];
          if (!gs.length) { box.appendChild(el("p", { class: "muted", text: r.error ? t("bpFail") : t("bpTipNoGroup") })); return; }
          gs.forEach(function (g) {
            var b = A.btn("📣 " + g.name, "btn-amber btn-block", function () { sendTip(bar, g, inp.value, b); });
            box.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [b]));
          });
        });
      });
    });
  }
  function sendTip(bar, g, text, button) {
    if (button.disabled) return;
    var v = String(text || "").replace(/\s+/g, " ").trim();
    if (v.length > 40) { A.toast(t("bpTipBad"), { err: true }); return; }
    button.disabled = true;
    call("send_tip", { p_group_id: g.id, p_bar_id: String(bar.id), p_bar_name: cleanName(bar.name), p_body: v || null }).then(function (r) {
      button.disabled = false;
      if (r.error) {
        if (r.off) { A.closeSheet(); return; }
        var c = codeOf(r.error);
        A.toast(c === "invalid_msg" ? t("bpTipBad") : c === "not_member" ? A.errMsg(r.error) : t("bpFail"), { err: true, ms: 5000 });
        return;
      }
      var d = A.parseData(r.data);
      if (d.ok === false) { A.toast(t("bpTipWait", U.mmss((d.wait_seconds | 0) * 1000)), { ms: 4500 }); return; }
      A.closeSheet();
      A.toast(pick("tip", t("bpTipToasts")), { cls: "skal", ms: 5000 });
      fx(); award();
      if (A.PUSH_ON && d.id != null) A.invoke("notify-group", { event: "tip", tip_id: d.id });
    });
  }

  /* ---------- 3. Ölsorter: chips after ÖL! ---------- */
  var strip = null, stripTimer = null, stripLeft = 0, stripLast = 0;
  /* Strip gate (owner: "kan inte välja ölsort"): while the strip is up (or about to show after ÖL!), no
     takeover, level popup, sheet or map event may open on top of it. They wait in this queue and run
     one by one after the strip closes (chip picked, ✕ or timeout). window.OLNU_STRIP = { up, after }. */
  var gateQ = [], gateUntil = 0, gateTimer = null;
  function stripUp() { return !!(strip && !strip.hidden) || Date.now() < gateUntil; }
  function afterStrip(fn) {
    if (typeof fn !== "function") return;
    if (!stripUp()) { fn(); return; }
    gateQ.push(fn);
    if (!gateTimer) gateTimer = setTimeout(gateCheck, 1000);   // safety net if the strip never showed
  }
  function gateCheck() {
    gateTimer = null;
    if (stripUp()) { gateTimer = setTimeout(gateCheck, 1000); return; }
    var q = gateQ; gateQ = [];
    q.forEach(function (f, i) { setTimeout(function () { try { f(); } catch (e) {} }, 350 + i * 300); });
  }
  window.OLNU_STRIP = { up: stripUp, after: afterStrip };
  function hideStrip() {
    if (stripTimer) { clearInterval(stripTimer); stripTimer = null; }
    if (strip) { strip.hidden = true; strip.innerHTML = ""; }
    gateUntil = 0;
    if (gateTimer) clearTimeout(gateTimer);
    gateTimer = setTimeout(gateCheck, 0);
  }
  function showStrip(delay) {
    // Old server (0014 missing): bar_status is known missing by now -> no strip at all.
    if (off.set_beer_type || state === "missing" || !A || !A.authed()) return;
    var waitUntil = Date.now() + (delay || 0) + 15000;
    gateUntil = Date.now() + (delay || 0) + 600;
    setTimeout(function open() {
      // A HOT / MEDEVAC takeover from this same tap is on screen: show the strip after it (max ~15 s).
      if (document.querySelector(".takeover") && Date.now() < waitUntil) { gateUntil = Date.now() + 900; setTimeout(open, 300); return; }
      if (!strip) { strip = document.createElement("div"); strip.className = "bp-strip hud-panel"; strip.setAttribute("role", "group"); document.body.appendChild(strip); }
      var names = t("bpTypes") || {}, emo = t("bpTypeEmoji") || {}, last = U.ls.get(TYPE_KEY, "");
      if (TYPES.indexOf(last) < 0) last = "";
      var order = last ? [last].concat(TYPES.filter(function (x) { return x !== last; })) : TYPES.slice();
      strip.setAttribute("aria-label", t("bpTypeQ"));
      strip.innerHTML = '<div class="bp-st-head"><span>' + esc(t("bpTypeQ")) + '</span><button type="button" class="bp-st-x" aria-label="✕">✕</button></div>' +
        '<div class="bp-st-chips">' + order.map(function (k) {
          var same = k === last;
          return '<button type="button" class="bp-tc' + (same ? " same" : "") + '" data-bpt="' + k + '">' +
            (same ? '<span class="bp-same">' + esc(t("bpSame")) + "</span>" : "") + (emo[k] || "🍺") + " " + esc(names[k] || k) + "</button>";
        }).join("") + '</div><div class="bp-st-bar"><span></span></div>';
      strip.hidden = false;
      try { document.documentElement.style.setProperty("--bp-strip-h", (strip.offsetHeight + 18) + "px"); } catch (e) {}
      stripLeft = 12000; stripLast = Date.now();
      var bar = strip.querySelector(".bp-st-bar span");
      if (stripTimer) clearInterval(stripTimer);
      var paused = false;
      strip.onpointerdown = function () { paused = true; stripLeft = Math.max(stripLeft, 2500); };
      strip.onpointerup = strip.onpointercancel = function () { paused = false; stripLast = Date.now(); };
      stripTimer = setInterval(function () {
        var now = Date.now();
        if (!paused) stripLeft -= now - stripLast;
        stripLast = now;
        if (bar) bar.style.width = Math.max(0, stripLeft / 40) + "%";
        if (stripLeft <= 0) hideStrip();
      }, 100);
      strip.onclick = function (e) {
        var x = e.target.closest && e.target.closest(".bp-st-x");
        if (x) { hideStrip(); return; }
        var b = e.target.closest && e.target.closest("[data-bpt]");
        if (b) setType(b.getAttribute("data-bpt"));
      };
    }, delay || 0);
  }
  function setType(k) {
    hideStrip();
    U.ls.set(TYPE_KEY, k);
    call("set_beer_type", { p_type: k }).then(function (r) {
      if (r.error) { if (!r.off && codeOf(r.error) !== "no_beer") A.toast(t("bpTypeFail"), { err: true }); return; }
      var lines = (t("bpTypeLines") || {})[k] || [];
      A.toast(pick("type" + k, lines), { cls: k === "alkfri" ? "water" : "skal", ms: 4500 });
      try { window.FX.vibrate(15); } catch (e) {}
      award();
    });
  }

  /* ---------- 3b. "Vad dricker stan?" in the top list ---------- */
  function topSheet(body) {
    if (!A || !A.LIVE || !A.authed() || off.beer_type_stats || state === "missing") return;
    var el = A.el, sec = el("section", { class: "bp-stats" });
    var period = U.ls.get("olnu.typePeriod", "night") === "week" ? "week" : "night";
    var seg = el("div", { class: "bp-seg", role: "tablist" });
    var out = el("div", { class: "bp-st-out" }, [el("p", { class: "muted", text: t("bpStatsLoading") })]);
    sec.appendChild(el("h3", { text: t("bpStatsTitle") }));
    sec.appendChild(seg); sec.appendChild(out);
    body.appendChild(sec);
    var c = (A.lastLoc && A.lastLoc()) || A.center();
    var town = c && window.CITIES ? window.CITIES.nearest(c.lat, c.lng) : null;
    var rows = null;
    [["night", t("bpStatsTonight")], ["week", t("bpStatsWeek")]].forEach(function (p) {
      seg.appendChild(el("button", { type: "button", role: "tab", "data-p": p[0], "aria-selected": String(period === p[0]), text: p[1], onclick: function () {
        period = p[0]; U.ls.set("olnu.typePeriod", period);
        seg.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-p") === period)); });
        draw();
      } }));
    });
    function block(scope, title) {
      var list = rows.filter(function (r) { return r.scope === scope && r.period === period && (r.n | 0) > 0; });
      var tot = 0; list.forEach(function (r) { tot += r.n | 0; });
      var names = t("bpTypes") || {}, emo = t("bpTypeEmoji") || {};
      var box = el("div", { class: "bp-sb" }, [el("div", { class: "bp-sb-h" }, [el("span", { text: title }), el("span", { class: "muted", text: tot ? t("bpStatsN", tot) : "" })])]);
      if (!tot) { box.appendChild(el("p", { class: "muted bp-sb-none", text: t("bpStatsNone") })); return box; }
      list.sort(function (a, b) { return (b.n | 0) - (a.n | 0); }).slice(0, 6).forEach(function (r) {
        var pct = Math.round((r.n | 0) * 100 / tot);
        box.appendChild(el("div", { class: "bp-sr t-" + r.type }, [
          el("span", { class: "bp-sr-n", text: (emo[r.type] || "🍺") + " " + (names[r.type] || r.type) }),
          el("span", { class: "bp-sr-bar" }, [el("span", { style: "width:" + Math.max(3, pct) + "%" })]),
          el("span", { class: "bp-sr-p", text: pct + "%" })
        ]));
      });
      return box;
    }
    function draw() {
      if (!rows) return;
      out.innerHTML = "";
      if (c) out.appendChild(block("town", town ? t("bpStatsTown", town.name) : t("bpStatsNear")));
      out.appendChild(block("sweden", t("bpStatsSweden")));
    }
    call("beer_type_stats", c ? { p_lat: c.lat, p_lng: c.lng } : {}).then(function (r) {
      if (r.error) { sec.remove(); return; }
      rows = r.data || [];
      draw();
    });
  }

  /* ---------- Group setting: "Visa vår grupp på kartan" ---------- */
  var flagsP = null, flagsAt = 0;
  function groupFlags() {
    if (!flagsP || Date.now() - flagsAt > 5000) {
      flagsAt = Date.now();
      flagsP = call("my_group_flags").then(function (r) {
        var m = {};
        if (!r.error) (r.data || []).forEach(function (x) { if (x && x.group_id) m[x.group_id] = x; });
        return r.error ? null : m;
      });
    }
    return flagsP;
  }
  function groupItem(g, wrap) {
    if (!A || !A.LIVE || off.my_group_flags || state === "missing" || !g || !g.id) return;
    groupFlags().then(function (m) {
      var f = m && m[g.id];
      if (!f || !document.body.contains(wrap) || wrap.querySelector(".bp-gflag")) return;
      var row;
      if (f.can_edit) {
        var sw = A.el("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(!!f.show_on_map), "aria-label": t("bpShowOnMap") });
        sw.addEventListener("click", function () {
          if (sw.disabled) return;
          var want = sw.getAttribute("aria-checked") !== "true";
          sw.disabled = true;
          call("set_group_show", { p_group_id: g.id, p_on: want }).then(function (r) {
            sw.disabled = false;
            if (r.error) { A.toast(codeOf(r.error) === "not_admin" ? t("bpNotAdmin") : t("bpFail"), { err: true }); return; }
            var d = A.parseData(r.data);
            sw.setAttribute("aria-checked", String(!!d.show_on_map));
            f.show_on_map = !!d.show_on_map;
            A.toast(d.show_on_map ? t("bpShowOn") : t("bpShowOff"), { ms: 4000 });
            loadStatus(true);
          });
        });
        row = A.el("div", { class: "bp-gflag" }, [
          A.el("div", { class: "bp-gflag-t" }, [A.el("div", { text: t("bpShowOnMap") }), A.el("div", { class: "muted", text: t("bpShowOnMapHint") })]),
          sw
        ]);
      } else if (f.show_on_map) {
        row = A.el("div", { class: "bp-gflag muted", text: t("bpShowOnMap") + " ✓" });
      }
      if (row) wrap.appendChild(row);
    });
  }

  /* ---------- Ticker ---------- */
  function newsTemplates() {
    if (!on()) return [];
    var l = t("bpNews");
    return Array.isArray(l) ? l : [];
  }
  function newsCands() {
    if (!on()) return [];
    var out = [], grp = t("bpNewsGroup");
    takeNews.slice(-2).forEach(function (x) {
      out.push({ k: "takeover", d: { bar: x.bar, who: x.who || grp, n: x.n }, imp: 2 });
    });
    var q = { long: 0, none: 0 };   // offers never go in the ticker (legal: they stay in the popup only)
    Object.keys(status).forEach(function (id) {
      var s = status[id], bar = barNameOf(id);
      if (!s || !bar) return;
      if (!takeNews.length && (s.owner_n | 0) > 0 && out.length < 1) out.push({ k: "takeover", d: { bar: bar, who: s.owner_name || grp, n: s.owner_n | 0 }, imp: 0 });
      if ((s.queue === "long" || s.queue === "none") && q[s.queue] < 1 && minsAgo(s.queue_at) <= 20) {
        q[s.queue]++;
        out.push({ k: s.queue === "long" ? "queueLong" : "queueNone", d: { bar: bar }, imp: 0 });
      }
    });
    return out;
  }

  /* ---------- v18 ETA: "🏃 Jag ä på väg" (CONTRACT "v18 ETA", migration 0024) ----------
     Bar popup: button → chips 5/10/15/20/30 min → set_eta + notify-group {event:"eta"}. Own ETA with countdown,
     "✅ Framme!" / "✖️ Avbryt". Group-mates heading to the bar: "🏃 Anton · 7 min". The rally sheet (rally.js)
     uses BARSPLUS.eta. One group_etas() call per poll (max every 25 s). Missing RPC → no ETA UI at all. */
  var ETX = {
    sv: {
      head: "🏃 På väg hit", btn: "🏃 Jag ä på väg", q: "Hur långt bort ä du?", chip: "{n} min",
      mine: "⏱️ Du ä framme om ", mineLate: "⏱️ ETA:n har passerat – ä du framme?", mineElse: "Du ä på väg till {bar} ({min}).",
      mineArr: "✅ Du ä framme. Bra marscherat, soldat!", arrived: "✅ {namn} ä framme", soon: "snart",
      here: "✅ Framme!", cancel: "✖️ Avbryt", wait: "Lugn i stegen! Ny ETA om {s} s.",
      fail: "ETA:n gick int' fram. Försök igen.", noGroup: "Ingen grupp att säga till. Gå med i en grupp så ser kompisarna din ETA.",
      gone: "Inkallelsen ä över.", rallyQ: "Hur långt bort ä du?", rallyOnWay: "🏃 ETA: {list}", rallyNone: "🏃 Ingen har angett ETA än.",
      rallyBtn: "⏱️ Ange ETA", rallyMine: "Din ETA: ", you: "Du", place: "samlingsplatsen",
      set: [
        "🪖 Marschorder given! {bar} om {min} min. Kompisarna ä varskodda.",
        "📡 ETA {min} min skickad. Truppen på {bar} håller en stol.",
        "🏃 Spring int' för fort nu. {bar} om {min} min.",
        "🫡 Uppfattat! Du ä på {bar} om {min} min. Över.",
        "🚁 Inflygning registrerad: {bar}, {min} min.",
        "🐎 Sadla dalahästen. {bar} väntar om {min} min.",
        "📻 Radion sprakar: ”{min} min till {bar}”. Över och ut.",
        "🧭 Kursen ä satt mot {bar}. {min} min, dä.",
        "🥾 Snöra kängorna! {bar} om {min} min.",
        "🎯 Målet: {bar}. Tid: {min} min. Uppdraget: kom fram helskinnad.",
        "📣 Truppen vet nu att du kommer till {bar} om {min} min.",
        "🚜 Traktorn ä startad. {bar} om {min} min.",
        "🛷 Kälken ä vallad. {bar} om {min} min.",
        "⏱️ Klockan tickar: {min} min till {bar}. Ingen stress.",
        "🦌 Ta skogsvägen om du vill. {bar} om {min} min.",
        "🪑 Stolen ä bokad på {bar}. Du har {min} min.",
        "💧 Ta en vatten på vägen. {bar} om {min} min.",
        "🗺️ Kartan ä uppdaterad: du ä {min} min från {bar}.",
        "🚕 Taxi eller apostlahästar? {bar} om {min} min oavsett.",
        "🔔 Pling! Förvarning skickad. {bar} om {min} min.",
        "🐻 Björnen har lämnat idet. {bar} om {min} min.",
        "🥁 Trumvirvel… du ä på {bar} om {min} min.",
        "🧥 Glöm int' jackan. {bar} om {min} min, pojk.",
        "🛰️ Satelliten följer dig. {bar} om {min} min.",
        "🎺 Fanfaren övar redan på {bar}. {min} min kvar.",
        "🚶 Lagom takt nu. {bar} om {min} min.",
        "📦 Leverans av dig till {bar} beräknad om {min} min.",
        "🎒 Packningen ä klar. Mot {bar}, {min} min.",
        "🐢 Ingen brådska – {bar} står kvar om {min} min också.",
        "🦆 Flyg i formation mot {bar}. {min} min.",
        "⚓ Ankaret ä lättat. {bar} om {min} min.",
        "🫡 Order bekräftad, soldat. {bar}, {min} min.",
        "🧑‍✈️ Kaptenen meddelar: beräknad ankomst till {bar} om {min} min.",
        "🌲 Ut ur skogen, in på {bar}. {min} min.",
        "🛶 Paddla lugnt. {bar} om {min} min.",
        "📯 Uppbrott! Truppen väntar på {bar} om {min} min.",
        "🏁 Startskottet har gått. {bar} om {min} min.",
        "🎖️ Uppdrag {bar} ä aktiverat. {min} min till mål.",
        "😎 Snyggt planerat. {bar} om {min} min. Gruppen ä informerad.",
        "🔦 Ta med ficklampa om det ä mörkt i backen. {bar} om {min} min."
      ],
      arrive: [
        "✅ {namn} ä framme vid {bar}. Uppdraget slutfört!",
        "🛬 Touchdown! {namn} har landat på {bar}.",
        "🫡 {namn} rapporterar: på plats vid {bar}. Över.",
        "🎯 Målet nått. {namn} ä på {bar}.",
        "🪖 Förstärkningen har anlänt: {namn} ä på {bar}.",
        "🏁 {namn} har gått i mål på {bar}. Bra tid!",
        "🚪 Dörren till {bar} gick upp och in klev {namn}.",
        "📡 Radarn bekräftar: {namn} ä på {bar}.",
        "🐎 Dalahästen ä parkerad. {namn} ä framme vid {bar}.",
        "🎺 Fanfar! {namn} har anlänt till {bar}.",
        "🧭 Koordinaterna stämmer: {namn} ä på {bar}.",
        "🙌 {namn} ä framme! Säg hej på {bar}.",
        "🐻 Björnen ä på plats: {namn} har kommit till {bar}.",
        "🚁 {namn} har landat på {bar}. Helikoptern kan vända.",
        "⚓ {namn} har kastat ankar vid {bar}.",
        "📦 Leveransen ä framme: en {namn} till {bar}.",
        "🥾 Kängorna ä avtorkade. {namn} ä på {bar}.",
        "🌟 {namn} ä framme vid {bar}. Truppen ä komplett, typ.",
        "🦌 En vild {namn} har setts komma in på {bar}.",
        "🔔 Pling! {namn} ä framme på {bar}.",
        "🎖️ {namn} klarade marschen till {bar}. Medalj? Kanske.",
        "🛶 {namn} har lagt till vid {bar}.",
        "📻 {namn} ä framme vid {bar}. Över och ut.",
        "🪑 Stolen ä fylld: {namn} sitter på {bar}.",
        "😄 {namn} hittade fram till {bar}. Kartan funkar, dä!"
      ],
      cancelT: [
        "✖️ Marschen ä avblåst. Ingen fara, soldat.",
        "🛑 ETA:n ä struken. Truppen klarar sig.",
        "🔙 Reträtt! Ingen ä arg (nästan).",
        "🛋️ Soffan vann den här gången.",
        "📻 Avbryt, avbryt! Uppfattat. Över.",
        "🐢 Ändrade planer – helt okej.",
        "🌙 Ny order: stanna där du ä.",
        "🧦 Strumpan hittades int'? Vi förstår.",
        "🫡 Uppdraget ä avbrutet. Vila, soldat.",
        "🚜 Traktorn ä tillbaka i ladan.",
        "💧 Klokt kanske. Drick ett glas vatten.",
        "🗺️ Kursen ä nollställd.",
        "🦌 Du tog en annan stig. Inga problem.",
        "📡 Signalen ä bruten. Kompisarna ser int' din ETA längre.",
        "🛷 Kälken står kvar i backen.",
        "🐻 Björnen gick tillbaka i idet.",
        "🔕 ETA:n ä borta. Ingen väntar i dörren.",
        "🏠 Hemmaplan ä också en plan.",
        "⛔ Stopp i marschen. Ny chans om en stund.",
        "🎺 Fanfaren pausas. Vi ses en annan gång."
      ],
      row: [
        "🏃 {namn} · {min}",
        "🪖 {namn} marscherar hit · {min}",
        "📡 {namn} på radarn · {min}",
        "🚶 {namn} ä på väg · {min}",
        "🐎 {namn} galopperar hit · {min}",
        "🛬 {namn} i inflygning · {min}",
        "🥾 {namn} i marsch · {min}",
        "🦌 {namn} genar genom skogen · {min}",
        "🚁 {namn} landar om {min}",
        "🧭 {namn} har kurs hit · {min}",
        "🫡 {namn} rapporterar {min} bort",
        "🛷 {namn} åker kälke hit · {min}",
        "🚜 {namn} kör traktor hit · {min}",
        "📻 {namn}: ”{min}, över”",
        "🎯 {namn} har {bar} i sikte · {min}",
        "🐻 {namn} har lämnat idet · {min}",
        "⏱️ {namn} framme om {min}",
        "🚕 {namn} i taxin · {min}",
        "🎒 {namn} med full packning · {min}",
        "🦆 {namn} flyger hit · {min}"
      ]
    },
    en: {
      head: "🏃 On the way here", btn: "🏃 I'm on my way", q: "How far away are you?", chip: "{n} min",
      mine: "⏱️ You arrive in ", mineLate: "⏱️ Your ETA has passed – are you there?", mineElse: "You're on your way to {bar} ({min}).",
      mineArr: "✅ You made it. Well marched, soldier!", arrived: "✅ {namn} is here", soon: "soon",
      here: "✅ I'm here!", cancel: "✖️ Cancel", wait: "Easy! New ETA in {s} s.",
      fail: "Couldn't send the ETA. Try again.", noGroup: "No group to tell. Join a group so friends see your ETA.",
      gone: "The call-out is over.", rallyQ: "How far away are you?", rallyOnWay: "🏃 ETA: {list}", rallyNone: "🏃 No ETAs yet.",
      rallyBtn: "⏱️ Set ETA", rallyMine: "Your ETA: ", you: "You", place: "the meeting point",
      set: ["🪖 Marching orders sent! {bar} in {min} min.", "📡 ETA {min} min sent. Your squad at {bar} saves you a seat.",
        "🏃 Don't run too fast. {bar} in {min} min.", "🫡 Copy that! {bar} in {min} min. Over.", "🧭 Course set for {bar}. {min} min."],
      arrive: ["✅ {namn} made it to {bar}. Mission complete!", "🛬 Touchdown! {namn} has landed at {bar}.", "🎯 Target reached: {namn} is at {bar}."],
      cancelT: ["✖️ March called off. No worries, soldier.", "🛑 ETA cancelled. The squad will cope.", "🛋️ The sofa won this time."],
      row: ["🏃 {namn} · {min}", "🪖 {namn} marching here · {min}", "📡 {namn} on radar · {min}", "⏱️ {namn} arrives in {min}"]
    }
  };
  function ex(k) { var en = I.lang === "en" ? ETX.en[k] : undefined; return en !== undefined ? en : ETX.sv[k]; }
  function fillE(s, v) { return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? String(v[k]) : m; }); }
  var SEEN_KEY = "olnu.etaSeen";
  // Random line, never one of the last 10 of that kind (remembered on the phone).
  function pickE(kind) {
    var list = ex(kind) || [], seen = U.ls.getJSON(SEEN_KEY, {}) || {};
    if (!list.length) return "";
    var last = Array.isArray(seen[kind]) ? seen[kind] : [], keep = Math.min(10, list.length - 1), bad = last.slice(-keep);
    var ok = []; for (var i = 0; i < list.length; i++) if (bad.indexOf(i) < 0) ok.push(i);
    var idx = ok.length ? ok[Math.floor(Math.random() * ok.length)] : Math.floor(Math.random() * list.length);
    seen[kind] = last.concat([idx]).slice(-10);
    U.ls.setJSON(SEEN_KEY, seen);
    return list[idx];
  }
  var eta = { st: "unknown", rows: [], at: 0, busy: false, empty: 0, listeners: [], prevLive: {}, toasted: null, first: true };
  var ETA_MIN = [5, 10, 15, 20, 30];
  var pickOpen = {};                 // bar id -> chips open (the app rebuilds popups when the map moves)
  function etaOn() { return !!(A && A.LIVE && A.authed() && eta.st === "on"); }
  function msLeft(r) { var d = Date.parse(r.eta_at); return isFinite(d) ? d - Date.now() : 0; }
  function minsLeft(r) { return Math.max(0, Math.ceil(msLeft(r) / 60000)); }
  function minText(r) { var m = minsLeft(r); return m > 0 ? m + " min" : ex("soon"); }
  function isLive(r) { return r && !r.arrived && msLeft(r) > -20 * 60e3; }
  function myEta() {
    var best = null;
    eta.rows.forEach(function (r) { if (r.is_me && (!best || Date.parse(r.created_at) > Date.parse(best.created_at))) best = r; });
    return best;
  }
  function nameOf(r) { return r.is_me ? (A.getName() || ex("you")) : (r.name || t("someone")); }
  function etaCall(name, params) {
    return call(name, params).then(function (r) {
      if (r.error && off[name]) { eta.st = "off"; eta.rows = []; refreshEtaUI(); }
      return r;
    });
  }
  function toastedMap() {
    if (!eta.toasted) {
      var m = U.ls.getJSON("olnu.etaToasted", {}) || {}, now = Date.now();
      Object.keys(m).forEach(function (k) { if (now - m[k] > 12 * 3600e3) delete m[k]; });
      eta.toasted = m;
    }
    return eta.toasted;
  }
  function onceToast(key) {
    var m = toastedMap(); if (m[key]) return false;
    m[key] = Date.now(); U.ls.setJSON("olnu.etaToasted", m); return true;
  }
  // Is this ETA heading to where I am (my check-in) or to my own call-out?
  function relevant(r) {
    try {
      var ci = A.myCheckin && A.myCheckin();
      if (ci && r.bar_id && String(ci.id) === String(r.bar_id)) return true;
      if (r.rally_id != null && window.RALLY && window.RALLY.list) {
        return window.RALLY.list().some(function (x) { return String(x.id) === String(r.rally_id) && x.is_mine; });
      }
    } catch (e) {}
    return false;
  }
  function loadEtas(force) {
    if (!A || !A.LIVE || !A.authed() || eta.st === "off") return Promise.resolve();
    var gap = eta.empty >= 3 ? 90000 : 25000;
    if (eta.busy || (!force && Date.now() - eta.at < gap)) return Promise.resolve();
    eta.busy = true; eta.at = Date.now();
    return etaCall("group_etas").then(function (r) {
      eta.busy = false;
      if (r.error) return;
      var was = eta.st;
      eta.st = "on";
      if (was !== "on") { try { A.render(); } catch (x) {} }
      var rows = (r.data || []).filter(function (x) { return x && x.id != null; });
      eta.empty = rows.length ? 0 : eta.empty + 1;
      var prev = eta.prevLive, live = {};
      rows.forEach(function (x) {
        var k = String(x.id);
        if (isLive(x)) live[k] = true;
        if (x.is_me) {
          if (prev[k] && x.arrived && onceToast("a" + k)) {
            A.toast(fillE(pickE("arrive"), { namn: nameOf(x), bar: x.bar_name || ex("place") }), { cls: "skal", ms: 6000 });
            fx();
          }
          return;
        }
        if (!relevant(x)) return;
        // A mate's new ETA to my place (not on the first load for old rows), and the moment they arrive.
        if (isLive(x) && !prev[k] && Date.now() - Date.parse(x.created_at) < 5 * 60e3 && onceToast("n" + k)) {
          A.toast(rowLine(x, 0), { ms: 6000 });
        }
        if (x.arrived && (prev[k] || Date.now() - Date.parse(x.arrived_at) < 2 * 60e3) && onceToast("a" + k)) {
          A.toast(fillE(pickE("arrive"), { namn: nameOf(x), bar: x.bar_name || ex("place") }), { cls: "skal", ms: 6000 });
        }
      });
      eta.prevLive = live; eta.first = false;
      eta.rows = rows;
      refreshEtaUI();
    }, function () { eta.busy = false; });
  }
  function rowLine(r, i) {
    var list = ex("row") || [], n = list.length || 1, idx = (Math.abs(+r.id || 0) + (i || 0)) % n;
    return fillE(list[idx], { namn: nameOf(r), min: minText(r), bar: r.bar_name || ex("place") });
  }
  function rowsFor(barId) {
    var id = String(barId);
    return eta.rows.filter(function (r) { return !r.is_me && r.bar_id != null && String(r.bar_id) === id && (isLive(r) || r.arrived); });
  }
  function cdText(r) { var ms = msLeft(r); return ms > 0 ? U.mmss(ms) : ex("soon"); }
  // Inner HTML of the ETA box in a bar popup.
  function etaInner(bar) {
    var id = String(bar.id), h = "", rows = rowsFor(id), used = {};
    rows.forEach(function (r, i) {
      if (r.arrived) { h += '<div class="eta-row arr">' + esc(fillE(ex("arrived"), { namn: nameOf(r) })) + "</div>"; return; }
      var line = rowLine(r, 0);
      if (used[line.split(" ")[0]]) line = rowLine(r, i + 1);   // no two equal lines in a row
      used[line.split(" ")[0]] = true;
      h += '<div class="eta-row">' + esc(line) + "</div>";
    });
    var me = myEta();
    if (me && String(me.bar_id) === id && (isLive(me) || me.arrived)) {
      if (me.arrived) h += '<div class="eta-me arr">' + esc(ex("mineArr")) + "</div>";
      else {
        var late = msLeft(me) <= 0;
        h += '<div class="eta-me">' + (late ? esc(ex("mineLate")) : esc(ex("mine")) + '<b class="eta-cd" data-until="' + Date.parse(me.eta_at) + '">' + esc(cdText(me)) + "</b>") + "</div>" +
          '<div class="eta-acts"><button type="button" class="eta-here" data-eta-act="here">' + esc(ex("here")) + "</button>" +
          '<button type="button" class="eta-x" data-eta-act="cancel">' + esc(ex("cancel")) + "</button></div>";
      }
      return h;
    }
    if (me && isLive(me) && me.bar_name) h += '<div class="eta-else muted">' + esc(fillE(ex("mineElse"), { bar: me.bar_name, min: minText(me) })) + "</div>";
    var po = !!pickOpen[id];
    h += '<button type="button" class="eta-go" data-eta-act="open" aria-expanded="' + po + '">' + esc(ex("btn")) + "</button>" +
      '<div class="eta-pick"' + (po ? "" : " hidden") + '><div class="eta-q">' + esc(ex("q")) + '</div><div class="eta-chips">' +
      ETA_MIN.map(function (n) { return '<button type="button" class="eta-chip" data-eta-min="' + n + '">' + esc(fillE(ex("chip"), { n: n })) + "</button>"; }).join("") +
      "</div></div>";
    return h;
  }
  function etaSectionHTML(bar) {
    if (!etaOn() || !bar || bar.id == null || !isFinite(bar.lat) || !isFinite(bar.lng)) return "";
    barCache[String(bar.id)] = bar;
    return '<div class="pp-sec pp-sec-eta"><div class="pp-sec-h">' + esc(ex("head")) + '</div><div class="eta" data-eta-bar="' + esc(String(bar.id)) + '">' +
      etaInner(bar) + "</div></div>";
  }
  // Re-draw every open ETA box (popups) and tell listeners (rally sheet).
  function refreshEtaUI() {
    document.querySelectorAll(".eta[data-eta-bar]").forEach(function (box) {
      var bar = barOf(box.getAttribute("data-eta-bar"));
      if (!etaOn() || !bar) { var s = box.closest(".pp-sec-eta"); if (s) s.hidden = true; return; }
      box.innerHTML = etaInner(bar);
    });
    eta.listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
    tickCd();
  }
  var cdTimer = null;
  function tickCd() {
    if (cdTimer) return;
    cdTimer = setInterval(function () {
      var els = document.querySelectorAll(".eta-cd[data-until]");
      if (!els.length) { clearInterval(cdTimer); cdTimer = null; return; }
      els.forEach(function (e) { var ms = +e.getAttribute("data-until") - Date.now(); e.textContent = ms > 0 ? U.mmss(ms) : ex("soon"); });
    }, 1000);
  }
  // target = {bar_id, bar_name, lat, lng}; rallyId optional. Resolves true on success.
  function setEta(target, min, rallyId) {
    if (!etaOn()) return Promise.resolve(false);
    var p = { p_bar_id: target.bar_id != null ? String(target.bar_id) : null, p_bar_name: target.bar_name ? cleanName(target.bar_name) : null,
      p_lat: isFinite(target.lat) && target.lat != null ? +target.lat : null, p_lng: isFinite(target.lng) && target.lng != null ? +target.lng : null,
      p_minutes: min };
    if (rallyId != null) p.p_rally_id = +rallyId;
    return etaCall("set_eta", p).then(function (r) {
      if (r.error) {
        if (r.off) return false;
        var m = String(r.error.message || "");
        A.toast(m.indexOf("rally_not_found") >= 0 ? ex("gone") : ex("fail"), { err: true });
        return false;
      }
      var d = A.parseData(r.data);
      if (d.ok === false) { A.toast(fillE(ex("wait"), { s: Math.max(1, d.wait_seconds | 0) }), { ms: 4500 }); return false; }
      d.is_me = true;
      eta.rows = eta.rows.filter(function (x) { return !(x.is_me && isLive(x)); }).concat([d]);
      eta.prevLive[String(d.id)] = true;
      A.toast(fillE(pickE("set"), { bar: d.bar_name || target.bar_name || ex("place"), min: min }), { cls: "skal", ms: 5500 });
      fx();
      if (A.PUSH_ON && d.id != null) A.invoke("notify-group", { event: "eta", eta_id: d.id }).then(function (res) {
        if (res && res.data && res.data.reason === "no_group") A.toast(ex("noGroup"), { ms: 6000 });
      });
      refreshEtaUI();
      setTimeout(function () { loadEtas(true); }, 1500);
      return true;
    });
  }
  function endEta(arrived) {
    return etaCall("cancel_eta", arrived ? { p_arrived: true } : {}).then(function (r) {
      if (r.error) { if (!r.off) A.toast(ex("fail"), { err: true }); return false; }
      var d = A.parseData(r.data), me = myEta();
      if (me && d.ok !== false) {
        if (arrived) { me.arrived = true; me.arrived_at = new Date().toISOString(); onceToast("a" + me.id); }
        else eta.rows = eta.rows.filter(function (x) { return x !== me; });
      }
      if (arrived) { A.toast(fillE(pickE("arrive"), { namn: A.getName() || ex("you"), bar: (me && me.bar_name) || ex("place") }), { cls: "skal", ms: 5000 }); fx(); }
      else A.toast(pickE("cancelT"), { ms: 4500 });
      refreshEtaUI();
      setTimeout(function () { loadEtas(true); }, 1200);
      return true;
    });
  }
  function etaClick(ev, box, tg) {
    var b = tg.closest("button"); if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    var bar = barOf(box.getAttribute("data-eta-bar")); if (!bar || b.disabled) return;
    var act = b.getAttribute("data-eta-act");
    if (act === "open") {
      var p = box.querySelector(".eta-pick"); if (!p) return;
      p.hidden = !p.hidden; b.setAttribute("aria-expanded", String(!p.hidden));
      pickOpen[String(bar.id)] = !p.hidden;
      return;
    }
    if (act === "here" || act === "cancel") { b.disabled = true; endEta(act === "here").then(function () { b.disabled = false; }); return; }
    var min = +b.getAttribute("data-eta-min");
    if (ETA_MIN.indexOf(min) < 0) return;
    A.withName(function () {
      box.querySelectorAll(".eta-chip").forEach(function (x) { x.disabled = true; });
      setEta({ bar_id: bar.id, bar_name: bar.name || t("unnamedBar"), lat: bar.lat, lng: bar.lng }, min, null).then(function (done) {
        if (done) { pickOpen[String(bar.id)] = false; refreshEtaUI(); }
        document.querySelectorAll(".eta-chip").forEach(function (x) { x.disabled = false; });
      });
    });
  }
  // For rally.js: live + arrived ETAs of one call-out, mine, chips.
  var etaApi = {
    on: etaOn,
    MINUTES: ETA_MIN.slice(),
    text: ex, fill: fillE,
    minText: minText, cdText: cdText, msLeft: msLeft, isLive: isLive, nameOf: nameOf,
    mine: function () { var m = myEta(); return m && (isLive(m) || m.arrived) ? m : null; },
    forRally: function (id) {
      return eta.rows.filter(function (r) { return r.rally_id != null && String(r.rally_id) === String(id) && (isLive(r) || r.arrived); })
        .sort(function (a, b) { return Date.parse(a.eta_at) - Date.parse(b.eta_at); });
    },
    set: setEta, end: endEta, load: function () { return loadEtas(true); },
    onChange: function (fn) { if (eta.listeners.indexOf(fn) < 0) eta.listeners.push(fn); },
    tick: tickCd
  };

  /* ---------- Public hooks ---------- */
  // Keep every open popup between the top HUD and the dock (ÖL!, ANNAT). The space is measured on the
  // real screen; the content scrolls inside, and the map moves so the whole popup is visible.
  // Runs on open and whenever the popup content changes size (sections opening, lists loading).
  function popupFit() {
    var map = A && A.map; if (!map || !window.ResizeObserver) return;
    var ro = null, cur = null, busy = false;
    function limits() {
      var top = 70, bottom = window.innerHeight - 200;
      var beer = document.getElementById("btn-beer"), annat = document.getElementById("btn-other");
      [beer, annat].forEach(function (e) { if (e) { var r = e.getBoundingClientRect(); if (r.height) bottom = Math.min(bottom, r.top - 10); } });
      document.querySelectorAll(".hud-left, .ticker, #rally:not([hidden]), .my-streak").forEach(function (e) {
        var r = e.getBoundingClientRect(); if (r.height && r.bottom < window.innerHeight / 2) top = Math.max(top, r.bottom + 8);
      });
      if (bottom - top < 220) top = Math.max(60, bottom - 220);   // tiny screens: allow over the HUD chips
      return { top: top, bottom: bottom };
    }
    function fit() {
      if (!cur || busy) return;
      var wrap = cur.getElement && cur.getElement(); if (!wrap) return;
      var content = wrap.querySelector(".leaflet-popup-content"); if (!content) return;
      var lim = limits(), extra = wrap.getBoundingClientRect().height - content.getBoundingClientRect().height;
      content.style.maxHeight = Math.max(160, Math.floor(lim.bottom - lim.top - extra - 14)) + "px";
      var r = wrap.getBoundingClientRect(), dy = 0;
      if (r.bottom > lim.bottom) dy = r.bottom - lim.bottom;          // move the map up
      else if (r.top < lim.top) dy = r.top - lim.top;                  // move the map down
      if (Math.abs(dy) > 2) { busy = true; map.panBy([0, Math.round(dy)], { animate: true, duration: 0.25 }); setTimeout(function () { busy = false; }, 300); }
    }
    map.on("popupopen", function (e) {
      cur = e.popup;
      if (ro) ro.disconnect();
      var el = cur.getElement && cur.getElement();
      ro = new ResizeObserver(function () { setTimeout(fit, 30); });
      if (el) { var c = el.querySelector(".leaflet-popup-content"); if (c) { ro.observe(c); Array.prototype.forEach.call(c.children, function (k) { ro.observe(k); }); } }
      setTimeout(fit, 60); setTimeout(fit, 400);
    });
    map.on("popupclose", function () { cur = null; if (ro) ro.disconnect(); });
    window.addEventListener("resize", function () { setTimeout(fit, 100); });
  }
  window.BARSPLUS = {
    newsTemplates: newsTemplates, newsCands: newsCands, status: function () { return status; },
    init: function (api) {
      A = api;
      popupFit();
      // Buttons live in Leaflet popups (click bubbling stops at the popup): listen on each popup element.
      A.map.on("popupopen", function (e) {
        var root = e.popup && e.popup.getElement && e.popup.getElement();
        if (root && root.querySelector(".eta[data-eta-bar]")) setTimeout(refreshEtaUI, 0);   // popup HTML may be older than the ETA list
        if (!root || root._olnuBp) return;
        root._olnuBp = true;
        root.addEventListener("click", function (ev) {
          var tg = ev.target; if (!tg || !tg.closest) return;
          var ebox = tg.closest(".eta[data-eta-bar]");
          if (ebox) { etaClick(ev, ebox, tg); return; }
          var box = tg.closest(".bp"); if (!box) return;
          var id = box.getAttribute("data-bp"), bar = barOf(id);
          var sum = tg.closest("summary");
          if (sum) {
            var det = sum.parentNode;
            setTimeout(function () {
              openMore[id] = !!det.open;
              try {
                var ap = e.popup.options.autoPan;
                e.popup.options.autoPan = false;   // Leaflet would pan back to show the popup top
                e.popup.update();   // rebuilds the content: use the new element
                e.popup.options.autoPan = ap;
                refreshEtaUI();
                var nd = e.popup.getElement() && e.popup.getElement().querySelector('.bp[data-bp="' + id.replace(/["\\]/g, "") + '"] .bp-more');
                if (nd) det = nd;
                if (det.open) {   // bring the opened section above the dock (the top HUD may then cover the popup title)
                  var dockH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dock-h")) || 212;
                  var over = det.getBoundingClientRect().bottom - (window.innerHeight - dockH - 8);
                  var room = det.getBoundingClientRect().top - 60;
                  if (over > 0) A.map.panBy([0, Math.round(Math.min(over, Math.max(0, room)))], { animate: true });
                }
              } catch (x) {}
            }, 0);
            return;
          }
          var b = tg.closest("button"); if (!b || !bar) return;
          ev.preventDefault(); ev.stopPropagation();
          if (b.hasAttribute("data-bpe")) {
            var v = b.getAttribute("data-bpe");
            entrySel[id] = entrySel[id] === v ? "" : v;
            box.querySelectorAll("[data-bpe]").forEach(function (x) {
              var onv = x.getAttribute("data-bpe") === entrySel[id];
              x.classList.toggle("on", onv); x.setAttribute("aria-pressed", String(onv));
            });
          } else if (b.hasAttribute("data-bpq")) reportQueue(bar, b.getAttribute("data-bpq"), b);
          else if (b.hasAttribute("data-bpv")) vote(b);
          else if (b.getAttribute("data-bpa") === "offer") offerSheet(bar);
          else if (b.getAttribute("data-bpa") === "tip") tipSheet(bar);
        });
      });
    },
    onAuthed: function () { loadStatus(true); loadEtas(true); },
    onPoll: function () { loadStatus(false); loadEtas(false); },
    eta: etaApi,
    barPopupHTML: barPopupHTML,
    barBadgeHTML: barBadgeHTML,
    barIcoHTML: barIcoHTML,
    onBeerAccepted: function (d) {
      if ((d && d.beer_count | 0) < 1) return;
      var n = d.beer_count | 0;
      showStrip(900);
    },
    topSheet: topSheet,
    groupItem: function (g, wrap) { groupItem(g, wrap); }
  };
})();
