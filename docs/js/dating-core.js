/* PintsNow — Öppen ikväll (P-088, lane dating2): the switch, consent, the server state and the notice. Lazy, beta only
   (js/dating.js loads it). Server: supabase/migrations/0530_dating.sql (oi_* RPCs).
   - Krogkortet section "Ikväll" (only on the sheet of the bar where I am checked in): switch "Öppen ikväll", "Stängs av själv",
     "Så funkar det · säkerhet" ›. Turning on opens the sheet "Öppen ikväll": the first time with the 4 facts + what we store +
     an unticked consent box (GDPR Art. 9(2)(a), version 1); every night the choices (age group, optional jag ä / vill träffa,
     no group mates). Then an exact fix (FASTPOS.forExact, <= 100 m) → oi_set_open. Never a count, never a place.
   - State: oi_state every 20 s while open, 8 s while a pair is live, 3 s while a game screen is up; nothing while hidden.
   - The notice (a card over the map, never over a sheet): "Psst…". Kör! / Inte ikväll (equal size). The game screens are
     js/dating-ui.js (loaded on Kör!).
   - Auto-off: the server turns it off at check-out / check-in elsewhere / 05 / pause; the phone says "Öppen ikväll ä av. God natt!".
   - Every end the other side causes (no, Stopp, block, report, timeout, check-out) shows ONE neutral line (logic endKey).
   - PGRST202 (no server) or feature_off (flag off) = everything hides for this session (sessionStorage olnu.oi.gone).
   Public: PN.oiCore = { start, mount, resume, ui, openGame, openSafety, chipHTML, S, T, rpc, refresh, el, ic, ... } */
(function () {
  "use strict";
  var W = window, D = document, P = W.PN = W.PN || {}, L = P.oiLogic;
  var A = null, H = null, timer = 0, busy = false, uiP = null, card = null;
  var S = { st: null, local: { seenStep: 0, codeSeen: false, ended: null }, bar: null, lastKey: "" };
  var CONSENT_V = 1, REC = "olnu.oi.on", LOC = "olnu.oi.local";

  function lang() { return W.I18N && W.I18N.lang === "en" ? "en" : "sv"; }
  // T(key, ...args): sv or en text; functions get the args
  function T(k) {
    var tx = P.oiText || {}, v = (tx[lang()] || {})[k];
    if (v === undefined) v = (tx.sv || {})[k];
    if (typeof v === "function") return v.apply(null, [].slice.call(arguments, 1));
    return v === undefined ? k : v;
  }
  function ls(k, v) { try { if (v === undefined) return W.localStorage.getItem(k); if (v === null) W.localStorage.removeItem(k); else W.localStorage.setItem(k, v); } catch (e) {} return null; }
  function ss(k, v) { try { if (v === undefined) return W.sessionStorage.getItem(k); W.sessionStorage.setItem(k, v); } catch (e) {} return null; }
  function ic(n, cls) { try { return W.PNI && W.PNI.has(n) ? W.PNI.svg(n, cls || "pi-lead") : ""; } catch (e) { return ""; } }
  // el(tag, {class, text, html, attrs...}, kids)
  function el(tag, o, kids) {
    var n = D.createElement(tag);
    Object.keys(o || {}).forEach(function (k) {
      var v = o[k]; if (v == null || v === false) return;
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else if (k === "html") n.innerHTML = v;
      else if (k === "on") Object.keys(v).forEach(function (e) { n.addEventListener(e, v[e]); });
      else n.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? D.createTextNode(c) : c); });
    return n;
  }
  function toast(m, o) { try { if (A && A.toast) A.toast(m, o || {}); } catch (e) {} }
  function sheetUp() { try { return !!(A && A.sheetOpen && A.sheetOpen()); } catch (e) { return false; } }
  function saveLocal() { ss(LOC, JSON.stringify(S.local)); }
  try { var l0 = JSON.parse(ss(LOC) || "null"); if (l0) S.local = l0; } catch (e) {}

  /* ---------- server ---------- */
  function errCode(err) {
    var m = String((err && (err.message || err.details || err.hint)) || "");
    var x = /(feature_off|not_authenticated|no_consent|need_age|paused|no_checkin|not_exact|invalid_value|slow_down|wrong_state|wrong_round|not_in_pair|not_complete|bad_answer|wait_other|bad_text|limit|filtered_\w+|bad_version|invalid_reason)/.exec(m);
    return x ? x[1] : "error";
  }
  function missing(err) {
    try { if (W.U && W.U.missing && W.U.missing(err)) return true; } catch (e) {}
    return !!(err && (err.code === "PGRST202" || /could not find the function/i.test(err.message || "")));
  }
  // every oi_* call: {data, code}. A missing function or the flag off hides the feature (not an error for the user).
  function rpc(fn, p) {
    if (!A || !A.rpc) return Promise.resolve({ data: null, code: "no_app" });
    return A.rpc(fn, p || {}).then(function (r) {
      if (r && r.error) {
        if (missing(r.error) || errCode(r.error) === "feature_off") { gone(); return { data: null, code: "gone" }; }
        return { data: null, code: errCode(r.error) };
      }
      return { data: A.parseData ? A.parseData(r && r.data) : r && r.data, code: null };
    }, function () { return { data: null, code: "net" }; });
  }
  function gone() {
    ss("olnu.oi.gone", "1"); ls(REC, null);
    clearTimeout(timer); timer = 0; closeCard();
    if (H && H.stop) H.stop();
    S.st = null;
  }
  function errText(code) {
    var m = { no_checkin: "eCheckin", not_exact: "eExact", paused: "ePaused", slow_down: "eSlow", net: "eNet", need_age: "needAge" }[code];
    if (/^filtered_/.test(code || "")) return (T("eFiltered") || {})[code.slice(9)] || T("eFail");
    return T(m || "eFail");
  }

  /* ---------- state loop ---------- */
  function schedule() {
    clearTimeout(timer); timer = 0;
    var ms = L.pollMs(S.st, sheetUp() && uiShown(), D.hidden);
    if (ms) timer = setTimeout(poll, ms);
  }
  function uiShown() { return !!(P.oiUi && P.oiUi.shown && P.oiUi.shown()); }
  function poll() {
    if (busy) return Promise.resolve(S.st);
    busy = true;
    return rpc("oi_state", { p_after: 0 }).then(function (r) {
      busy = false;
      if (r.code === "gone") return null;
      if (r.code) { schedule(); return S.st; }
      refresh(r.data);
      return S.st;
    });
  }
  // the one place that takes a new server state (also from the action RPCs, which answer with the pair view)
  function refresh(st, pairOnly) {
    if (pairOnly) { st = Object.assign({}, S.st || {}, { pair: st }); }
    S.st = st || null;
    var on = !!(st && st.on);
    if (on) ls(REC, JSON.stringify({ until: Date.parse(st.expires_at) || L.nightEnd() }));
    else if (!pairOnly && ls(REC)) { ls(REC, null); toast(T("toastAutoOff"), { id: "oi", ms: 5000 }); }
    if (st && st.pair && st.pair.id !== S.local.pid && st.pair.state !== "ended") {
      S.local = { pid: st.pair.id, seenStep: 0, codeSeen: false, ended: S.local.ended, selfEnd: S.local.selfEnd }; saveLocal();
    }
    paintSections();
    var sc = L.screen(S.st, S.local);
    if (sc.name === "ended") {
      if (!sc.seen) {
        S.local.ended = sc.id; S.local.seenStep = 0; S.local.codeSeen = false; saveLocal();
        if (!S.local.selfEnd || S.local.selfEnd !== sc.id) toast(T(L.endKey(sc.phase, on)), { id: "oi-end", ms: 7000 });
        if (P.oiUi && P.oiUi.ended) P.oiUi.ended(sc);
      }
      closeCard();
    } else if (sc.name === "notice" || sc.name === "waitOffer") {
      showCard(sc);
    } else {
      closeCard();
      if (st && st.pair && st.pair.state !== "offered") ui().then(function () { P.oiUi.update(S.st, sc); }, function () {});
    }
    try { if (A && A.updateCounts) A.updateCounts(); } catch (e) {}   // the HUD chip
    schedule();
  }

  /* ---------- Krogkortet section ---------- */
  function mount(bs, bar) {
    S.bar = bar;
    var act = bs.querySelector(".pp-act");
    var sec = el("section", { class: "oi-sec", "data-bar": bar, "aria-label": T("title") });
    sec.appendChild(el("h4", { class: "oi-h", text: T("secHead") }));
    var list = el("div", { class: "oi-list" });
    var swb = el("button", { type: "button", class: "switch oi-switch", role: "switch", "aria-checked": "false", "aria-label": T("rowOn") });
    swb.addEventListener("click", function (e) { e.stopPropagation(); flip(swb); });
    list.appendChild(el("div", { class: "oi-row oi-row-sw" }, [
      el("span", { class: "oi-i", "aria-hidden": "true", html: ic("heart", "") }),
      el("span", { class: "oi-t" }, [el("b", { text: T("rowOn") }), el("small", { text: T("rowOnSub") })]), swb]));
    list.appendChild(el("div", { class: "oi-row oi-row-game", hidden: true, role: "button", tabindex: "0", on: { click: function () { openGame(); } } }, [
      el("span", { class: "oi-i", "aria-hidden": "true", html: ic("star", "") }),
      el("span", { class: "oi-t" }, [el("b", { text: T("rowGame") }), el("small", { text: T("rowGameSub") })]),
      el("span", { class: "oi-chev", "aria-hidden": "true", html: ic("chev-right", "") })]));
    list.appendChild(el("div", { class: "oi-row" }, [
      el("span", { class: "oi-i", "aria-hidden": "true", html: ic("clock", "") }),
      el("span", { class: "oi-t" }, [el("b", { text: T("rowAuto") }), el("small", { text: T("rowAutoSub") })])]));
    list.appendChild(el("button", { type: "button", class: "oi-row oi-row-go", on: { click: function (e) { e.stopPropagation(); openSafety(); } } }, [
      el("span", { class: "oi-i", "aria-hidden": "true", html: ic("shield", "") }),
      el("span", { class: "oi-t" }, [el("b", { text: T("rowSafe") })]),
      el("span", { class: "oi-chev", "aria-hidden": "true", html: ic("chev-right", "") })]));
    sec.appendChild(list);
    sec.appendChild(el("p", { class: "oi-hint", text: T("secHint") }));
    if (act && act.parentNode) act.parentNode.insertBefore(sec, act.nextSibling); else bs.appendChild(sec);
    paintSections();
    if (!S.st) poll();
  }
  function paintSections() {
    var st = S.st, on = !!(st && st.on), live = !!(st && st.pair && st.pair.state !== "ended" && st.pair.state !== "offered");
    [].forEach.call(D.querySelectorAll(".oi-sec"), function (sec) {
      var swb = sec.querySelector(".oi-switch");
      if (swb && !swb.disabled) swb.setAttribute("aria-checked", String(on));
      sec.classList.toggle("oi-on", on);
      var g = sec.querySelector(".oi-row-game"); if (g) g.hidden = !live;
      var h = sec.querySelector(".oi-hint"); if (h) h.textContent = on ? T("hintOn") : T("secHint");
    });
  }
  function flip(swb) {
    if (swb.disabled) return;
    var on = swb.getAttribute("aria-checked") === "true";
    if (on) {
      swb.disabled = true; swb.setAttribute("aria-checked", "false");
      rpc("oi_set_open", { p_on: false }).then(function (r) {
        swb.disabled = false;
        if (r.code === "gone") return;
        if (r.code) { swb.setAttribute("aria-checked", "true"); toast(errText(r.code), { err: true, id: "oi" }); return; }
        ls(REC, null); toast(T("toastOff"), { id: "oi" });
        poll();
      });
      return;
    }
    openChoices();
  }

  /* ---------- the sheet "Öppen ikväll": consent (first time) + tonight's choices ---------- */
  function seg(name, labels, values, cur, cb) {
    var s = el("div", { class: "ds-seg oi-seg", role: "radiogroup", "aria-label": name });
    labels.forEach(function (lb, i) {
      var b = el("button", { type: "button", role: "radio", "aria-checked": String(values[i] === cur), "data-v": values[i], text: lb });
      b.addEventListener("click", function () {
        var was = b.getAttribute("aria-checked") === "true";
        [].forEach.call(s.children, function (x) { x.setAttribute("aria-checked", "false"); });
        if (!(was && cb.toggle)) b.setAttribute("aria-checked", "true");
        cb(was && cb.toggle ? null : values[i]);
      });
      s.appendChild(b);
    });
    return s;
  }
  function factRow(icon, t, s) {
    return el("div", { class: "oi-row" }, [el("span", { class: "oi-i", "aria-hidden": "true", html: ic(icon, "") }),
      el("span", { class: "oi-t" }, [el("b", { text: t }), el("small", { text: s })])]);
  }
  function openChoices() {
    var st = S.st || {}, needConsent = !st.consent, ch = { age: null, iAm: null, want: null, noGroups: true };
    try { var last = JSON.parse(ss("olnu.oi.ch") || "null"); if (last) ch = last; } catch (e) {}   // this night, this tab only
    A.openSheet(T("title"), function (body) {
      body.classList.add("oi-sheet");
      body.appendChild(el("p", { class: "oi-sub", text: needConsent ? T("consentSub") : T("choicesSub") }));
      if (needConsent) {
        body.appendChild(el("div", { class: "oi-list" }, [factRow("eye-off", T("c1"), T("c1s")), factRow("users", T("c2"), T("c2s")),
          factRow("lock", T("c3"), T("c3s")), factRow("moon", T("c4"), T("c4s"))]));
        body.appendChild(el("p", { class: "oi-note", text: T("stored") }));
      }
      var go = el("button", { type: "button", class: "btn btn-amber oi-go", text: needConsent ? T("imIn") : T("turnOn") });
      var box = null;
      var check = function () { go.disabled = !ch.age || (needConsent && !(box && box.checked)) || !!go.getAttribute("data-busy"); };
      body.appendChild(el("h3", { class: "oi-h3", text: T("ageHead") }));
      body.appendChild(seg(T("ageHead"), T("ages"), ["18-24", "25-34", "35-44", "45+"], ch.age, function (v) { ch.age = v; check(); }));
      body.appendChild(el("h3", { class: "oi-h3", text: T("prefHead") }));
      var f1 = function (v) { ch.iAm = v; }; f1.toggle = true;
      var f2 = function (v) { ch.want = v; }; f2.toggle = true;
      body.appendChild(seg(T("prefHead"), T("iAm"), ["k", "m", "a"], ch.iAm, f1));
      body.appendChild(seg(T("prefHead"), T("want"), ["k", "m", "alla"], ch.want, f2));
      body.appendChild(el("p", { class: "oi-note", text: T("prefHint") }));
      var ng = el("input", { type: "checkbox", class: "oi-cb" }); ng.checked = ch.noGroups !== false;
      ng.addEventListener("change", function () { ch.noGroups = ng.checked; });
      body.appendChild(el("label", { class: "oi-check" }, [ng, el("span", { text: T("noGroups") })]));
      if (needConsent) {
        box = el("input", { type: "checkbox", class: "oi-cb oi-consent" });
        box.addEventListener("change", check);
        body.appendChild(el("label", { class: "oi-check oi-consent-l" }, [box, el("span", { text: T("consentBox") })]));
      }
      var age = el("div", { class: "oi-age", hidden: true });
      body.appendChild(age);
      var msg = el("p", { class: "oi-msg", role: "status", "aria-live": "polite" });
      body.appendChild(msg);
      var no = el("button", { type: "button", class: "btn oi-no", text: T("notNow"), on: { click: function () { A.closeSheet(); } } });
      go.addEventListener("click", function () { submit(ch, needConsent, go, msg, age); });
      body.appendChild(el("div", { class: "oi-btns" }, [no, go]));
      check();
    }, { now: true });
  }
  function submit(ch, needConsent, go, msg, age) {
    if (!ch.age) { msg.textContent = T("pickAge"); return; }
    go.setAttribute("data-busy", "1"); go.disabled = true; msg.textContent = "";
    var done = function (text) { go.removeAttribute("data-busy"); go.disabled = false; if (text) msg.textContent = text; };
    var step = needConsent ? rpc("oi_give_consent", { p_version: CONSENT_V }) : Promise.resolve({ code: null });
    step.then(function (r) {
      if (r.code === "gone") return null;
      if (r.code === "need_age") { done(T("needAge")); ageWidget(age, function () { submit(ch, needConsent, go, msg, age); }); return null; }
      if (r.code) { done(errText(r.code)); return null; }
      if (S.st) S.st.consent = true;
      return exactFix().then(function (pos) {
        var c = pos && pos.coords;
        return rpc("oi_set_open", { p_on: true, p_age: ch.age, p_i_am: ch.iAm, p_want: ch.want, p_no_groups: ch.noGroups !== false,
          p_lat: c ? c.latitude : null, p_lng: c ? c.longitude : null, p_acc: c ? c.accuracy : null });
      }).then(function (r2) {
        if (!r2 || r2.code === "gone") return;
        if (r2.code) { done(errText(r2.code)); return; }
        ss("olnu.oi.ch", JSON.stringify(ch));
        done(); A.closeSheet();
        toast(T("toastOn"), { id: "oi", ms: 4000 });
        poll();
      });
    });
  }
  // an exact fix (<= 100 m): FASTPOS.forExact (fresh exact fix or a GPS wait). A coarse fix is sent as "no fix" (server: not_exact).
  function exactFix() {
    var F = W.FASTPOS;
    var p = F && F.forExact ? F.forExact() : A && A.getPosition ? A.getPosition() : Promise.reject(new Error("no pos"));
    return Promise.resolve(p).then(function (pos) { return pos && pos.coords && pos.coords.accuracy <= 100 ? pos : null; }, function () { return null; });
  }
  // the app's own 18+ year picker (safety.js), when the server has no 18+ answer yet
  function ageWidget(box, after) {
    if (!W.SAFETY || !W.SAFETY.ageWidget || box.firstChild) { box.hidden = false; return; }
    var cb = el("input", { type: "checkbox", hidden: true });
    cb.addEventListener("change", function () { if (cb.checked) setTimeout(after, 1200); });
    box.appendChild(W.SAFETY.ageWidget(cb)); box.hidden = false;
  }

  /* ---------- the notice card ---------- */
  function closeCard() { if (card && card.parentNode) card.parentNode.removeChild(card); card = null; }
  function showCard(sc) {
    if (sheetUp() && !card) return;   // never over a sheet: it waits for the next poll
    var key = sc.name + ":" + (S.st.pair && S.st.pair.id);
    if (card && card.getAttribute("data-k") === key) { var f = card.querySelector(".oi-foot"); if (f && sc.name === "notice") f.textContent = T("noticeFoot", Math.max(1, Math.ceil(sc.left / 60))); return; }
    closeCard();
    var id = S.st.pair.id;
    card = el("div", { class: "oi-card", role: "dialog", "aria-modal": "false", "aria-label": T("psst"), "data-k": key });
    card.appendChild(el("div", { class: "oi-card-ic", "aria-hidden": "true", html: ic("sparkle", "") }));
    card.appendChild(el("h2", { class: "oi-psst", text: T("psst") }));
    if (sc.name === "waitOffer") {
      card.appendChild(el("p", { class: "oi-card-t", text: T("waitOffer") }));
    } else {
      card.appendChild(el("p", { class: "oi-card-t", text: T("notice") }));
      card.appendChild(el("p", { class: "oi-card-s", text: T("noticeSub") }));
      var no = el("button", { type: "button", class: "btn oi-no", text: T("notTonight") });
      var yes = el("button", { type: "button", class: "btn btn-amber oi-yes", text: T("go") });
      no.addEventListener("click", function () { answerOffer(id, false, no, yes); });
      yes.addEventListener("click", function () { answerOffer(id, true, no, yes); });
      card.appendChild(el("div", { class: "oi-btns" }, [no, yes]));
      card.appendChild(el("p", { class: "oi-foot", text: T("noticeFoot", Math.max(1, Math.ceil(sc.left / 60))) }));
    }
    D.body.appendChild(card);
  }
  function answerOffer(id, yes, no, ok) {
    no.disabled = ok.disabled = true;
    if (!yes) S.local.selfEnd = id; else S.local.autoOpen = id;
    saveLocal();
    var go = yes ? ui() : Promise.resolve();
    go.then(function () { return rpc("oi_offer", { p_pair: id, p_yes: yes }); }, function () { return rpc("oi_offer", { p_pair: id, p_yes: yes }); }).then(function (r) {
      if (r.code === "gone") return;
      if (r.code) { poll(); return; }
      if (!yes) closeCard();
      refresh(r.data, true);
    });
  }

  /* ---------- the rest ---------- */
  function ui() {
    if (P.oiUi) return Promise.resolve(P.oiUi);
    if (!uiP) {
      var s = String(W.PN_BETA || "").replace(/[^\w]/g, "").slice(0, 12);
      uiP = P.load("./js/dating-ui.js" + (s ? "?b=" + s : ""), { test: function () { return !!P.oiUi; } }).then(function () { P.oiUi.start(core); return P.oiUi; }, function (e) { uiP = null; throw e; });
    }
    return uiP;
  }
  function openGame() { ui().then(function (u) { u.open(S.st); }, function () {}); }
  function openSafety() { ui().then(function (u) { if (!S.st) poll(); u.safety(); }, function () {}); }
  function chipHTML() {
    var p = S.st && S.st.pair;
    if (!p || p.state === "ended" || p.state === "offered" || uiShown()) return "";
    return '<button type="button" class="hx-chip oi-chip" data-hx="oi">' + ic("star", "pi-inl") + "<span>" + String(T("chip")).replace(/[<>&"]/g, "") + "</span></button>";
  }
  function resume() { if (!S.st) poll(); }
  function start(app, hook) {
    A = app; H = hook;
    D.addEventListener("visibilitychange", function () { if (!D.hidden && (S.st && (S.st.on || S.st.pair))) poll(); else schedule(); });
  }
  var core = { start: start, mount: mount, resume: resume, ui: ui, openGame: openGame, openSafety: openSafety, chipHTML: chipHTML,
    S: S, T: T, rpc: rpc, refresh: refresh, poll: poll, el: el, ic: ic, toast: toast, errText: errText, saveLocal: saveLocal,
    app: function () { return A; }, gone: gone, ls: ls, REC: REC };
  P.oiCore = core;
})();
