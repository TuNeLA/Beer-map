/* PintsNow — Öppen ikväll (P-088, lane dating2): the game screens. Lazy, beta only (js/dating-core.js loads it on Kör!,
   the HUD chip, the Krogkortet row "Matchspel pågår" or the safety row).
   Screens (DESIGN.md §3.4–3.9, pictures handover/dating-out/02 + 03), all in the app sheet:
     play (5 game types A–E) · waitThem · decide (score + "Visa åldersgrupp / förnamn / bild" | "Räcker så") · waitStep ·
     reveal (Ni båda ville, step x of 3) · chat (text only, filters, "Jag vill ses") · code (the code word) · ended ·
     stop (confirm) · report (+ what happens next) · safety (rules, help numbers, consent, recent games, hide).
   Stopp + Anmäl are on every game, reveal, chat and code-word screen. Nothing shows a place, a distance or a count.
   The chat updates in place (typing is never lost); other screens draw again only when the screen key changes.
   Public: PN.oiUi = { start, open, update, ended, safety, shown }. */
(function () {
  "use strict";
  var W = window, D = document, P = W.PN, C = null, A = null, L = P.oiLogic;
  var cur = { key: "", name: "", sub: null, chatIds: {} };
  function T() { return C.T.apply(null, arguments); }
  function el(t, o, k) { return C.el(t, o, k); }
  function ic(n, c) { return C.ic(n, c); }
  function lang() { return W.I18N && W.I18N.lang === "en" ? "en" : "sv"; }
  function Q(type, n) { var tx = P.oiText, q = (lang() === "en" ? tx.qEn : tx.q)[type]; return q ? q[(n | 0) - 1] : null; }
  function glass() { return P.oiText.glass[lang()]; }
  function pair() { return C.S.st && C.S.st.pair; }
  function shown() { var s = D.getElementById("sheet"), b = D.getElementById("sheet-body"); return !!(s && !s.hidden && b && b.querySelector(".oi-ui")); }

  // open (or redraw) the app sheet with one of our screens. The game flow always opens under ONE sheet title, so the back
  // stack (sheetnav.js: same title + same build = in place) never replays an old screen; the visible title is set after.
  function sheet(title, build, sub, base) {
    cur.sub = sub || null;
    base = base || T("title");
    A.openSheet(base, function (body) {
      var t = D.getElementById("sheet-title"); if (t) t.textContent = title;
      var root = el("div", { class: "oi-ui oi-sheet" }); body.appendChild(root); build(root);
    }, { now: true, onClose: function (why) { if (why === "replaced") return; cur.key = ""; cur.sub = null; setTimeout(function () { C.poll(); }, 50); } });
  }
  function sub(root, text) { if (text) root.appendChild(el("p", { class: "oi-sub", text: text })); }
  // "Du ä Gul räv · mot Blå uggla" + Stopp / Anmäl
  function head(root, p, noAlias) {
    if (!noAlias) {
      var v = T("youVs", p.me, p.them);
      root.appendChild(el("p", { class: "oi-vs" }, [el("span", { class: "oi-vs-i", "aria-hidden": "true", html: ic("moon", "") }), v[0] + " ", el("b", { text: v[1] }),
        " · " + v[2] + " ", el("b", { text: v[3] }), el("span", { class: "oi-vs-i", "aria-hidden": "true", html: ic("star", "") })]));
    }
    root.appendChild(el("div", { class: "oi-sr" }, [
      el("button", { type: "button", class: "btn btn-small oi-stop", html: ic("hand", "pi-inl") + "<span></span>", on: { click: function () { stopConfirm(); } } }),
      el("button", { type: "button", class: "btn btn-small btn-ghost oi-rep", html: ic("flag", "pi-inl") + "<span></span>", on: { click: function () { reportSheet(pair() && pair().id, pair() && pair().them); } } })]));
    root.querySelector(".oi-stop span").textContent = T("stop");
    root.querySelector(".oi-rep span").textContent = T("report");
  }
  function btns(a, b) { return el("div", { class: "oi-btns" }, [a, b]); }
  function btn(text, cls, fn) { return el("button", { type: "button", class: "btn " + (cls || ""), text: text, on: { click: fn } }); }
  function act(fn, args, after) {
    return C.rpc(fn, args).then(function (r) {
      if (r.code === "gone") return r;
      if (r.code && /^filtered_/.test(r.code)) { if (after) after(r); return r; }
      if (r.code) { C.toast(C.errText(r.code), { err: true, id: "oi" }); C.poll(); return r; }
      if (after) after(r);
      if (r.data && r.data.id) C.refresh(r.data, true); else C.poll();
      return r;
    });
  }
  function answer(p, item, value, after) { return act("oi_answer", { p_pair: p.id, p_round: p.round, p_item: item, p_answer: value }, after); }

  /* ---------- the screen router ---------- */
  function keyOf(sc, p) {
    if (!p) return sc.name;
    return [sc.name, p.id, p.round, sc.item, p.step, p.state, sc.code || "", sc.phase || ""].join("|");
  }
  function update(st, sc) {
    var p = st && st.pair;
    if (!shown()) {
      cur.name = sc.name;
      // Kör! was tapped on this phone and the game just started: open it (the user is waiting for it)
      if (p && C.S.local.autoOpen === p.id && sc.name !== "waitOffer" && !(A.sheetOpen && A.sheetOpen())) { C.S.local.autoOpen = null; C.saveLocal(); open(st); }
      return;
    }
    if (cur.sub) return;   // a sub view (Stopp, Anmäl) is up: leave it
    if (sc.name === "chat" && cur.name === "chat" && cur.key === keyOf(sc, p)) { chatPatch(p); return; }
    var k = keyOf(sc, p);
    if (k === cur.key) { patchStatus(p, sc); return; }
    draw(st, sc);
  }
  function open(st) {
    st = st || C.S.st;
    var sc = L.screen(st, C.S.local);
    if (sc.name === "off" || sc.name === "open" || sc.name === "notice" || sc.name === "waitOffer") return;
    draw(st, sc);
  }
  function draw(st, sc) {
    var p = st && st.pair;
    cur.key = keyOf(sc, p); cur.name = sc.name;
    if (sc.name === "ended") return endedScreen(sc.phase);
    if (sc.name === "reveal") return reveal(p, sc.step);
    if (sc.name === "chat") return chat(p);
    if (sc.name === "code") return code(p, sc.code);
    sheet(T("game"), function (root) {
      head(root, p);
      progress(root, p);
      if (sc.name === "play") play(root, p, sc);
      else if (sc.name === "waitThem") waitBox(root, T("waitThem", p.them), p);
      else if (sc.name === "decide") decide(root, p, sc.step);
      else if (sc.name === "waitStep") { summary(root, p, p.round); waitBox(root, T("waitStep", p.them)); }
    });
  }
  function progress(root, p) {
    var t = L.planOf(p, p.round) || {}, dots = el("span", { class: "oi-dots", "aria-hidden": "true" });
    for (var i = 1; i <= 3; i++) dots.appendChild(el("i", { class: i <= p.round ? "on" : "" }));
    root.appendChild(el("p", { class: "oi-prog" }, [dots, T("roundOf", p.round, (T("types") || {})[t.t] || "")]));
  }
  function waitBox(root, text) { root.appendChild(el("div", { class: "oi-status oi-wait", role: "status", "aria-live": "polite" }, [el("span", { class: "oi-spin", "aria-hidden": "true" }), el("span", { text: text })])); }
  // "Blå uggla har svarat" changes without a redraw (a half-made answer stays)
  function patchStatus(p, sc) {
    var s = D.querySelector(".oi-ui .oi-their");
    if (!s || sc.name !== "play") return;
    var done = (p.them_done || []).indexOf(sc.item) >= 0;
    s.hidden = !done;
  }
  function theirStatus(root, p, item) {
    var done = (p.them_done || []).indexOf(item) >= 0;
    root.appendChild(el("div", { class: "oi-status oi-their", role: "status", "aria-live": "polite", hidden: !done }, [
      el("span", { class: "oi-ok", "aria-hidden": "true", html: ic("check", "") }), el("span", { text: T("theyAnswered", p.them) })]));
  }

  /* ---------- play: the 5 game types ---------- */
  function play(root, p, sc) {
    var t = L.planOf(p, p.round), n = L.items(t.t);
    if (t.t === "A" || t.t === "D") return pick2(root, p, sc.item, t, n);
    if (t.t === "E") return likely(root, p, sc.item, t, n);
    if (t.t === "B") return sc.item === 2 ? lieGuess(root, p) : lieWrite(root, p, t);
    return glassGame(root, p, sc.item, t);
  }
  function choice(label, letter, on) {
    return el("button", { type: "button", class: "oi-opt", role: "radio", "aria-checked": String(!!on) }, [el("span", { class: "oi-letter", "aria-hidden": "true", text: letter }), el("span", { text: label })]);
  }
  function radios(box, onPick) {
    box.setAttribute("role", "radiogroup");
    box.addEventListener("click", function (e) {
      var b = e.target.closest(".oi-opt"); if (!b || !box.contains(b)) return;
      [].forEach.call(box.querySelectorAll(".oi-opt"), function (x) { x.setAttribute("aria-checked", String(x === b)); });
      onPick(b.getAttribute("data-v"));
    });
  }
  function pick2(root, p, item, t, n) {
    var qq = Q(t.t, t.q[item]) || ["", ""], sel = null, quick = t.t === "D";
    root.appendChild(el("h3", { class: "oi-q", text: quick ? T("quick") : T("hellre") }));
    var box = el("div", { class: "oi-opts" });
    ["a", "b"].forEach(function (v, i) { var c = choice(qq[i], v.toUpperCase()); c.setAttribute("data-v", v); box.appendChild(c); });
    radios(box, function (v) { sel = v; ok.disabled = false; });
    root.appendChild(box);
    theirStatus(root, p, item);
    root.appendChild(el("p", { class: "oi-note", text: T("qOf", item + 1, n) }));
    var sent = false, send = function (v) { if (sent) return; sent = true; clearInterval(tm); answer(p, item, v); };
    var ok = btn(T("answer"), "btn-amber", function () { if (sel) send(sel); });
    ok.disabled = true;
    var tm = 0;
    if (quick) {   // Snabbfrågor: 5 s, then the pick (or a skip) goes by itself
      var left = 5, bar = el("div", { class: "oi-timer", role: "timer", "aria-live": "off", text: "5" });
      root.insertBefore(bar, box);
      tm = setInterval(function () { left--; bar.textContent = String(Math.max(0, left)); if (left <= 0) send(sel || "s"); }, 1000);
    }
    root.appendChild(btns(btn(T("skip"), "", function () { send("s"); }), ok));
  }
  function likely(root, p, item, t, n) {
    var s = null, g = null;
    root.appendChild(el("h3", { class: "oi-q", text: (T("types") || {}).E }));
    root.appendChild(el("p", { class: "oi-stmt", text: Q("E", t.q[item]) || "" }));
    var ok = btn(T("answer"), "btn-amber", function () { if (s && g) { ok.disabled = true; answer(p, item, s + g); } });
    ok.disabled = true;
    var upd = function () { ok.disabled = !(s && g); };
    root.appendChild(el("h4", { class: "oi-h3", text: T("eSelf") }));
    root.appendChild(segm([T("eMe"), T("eNotMe")], ["j", "n"], function (v) { s = v; upd(); }));
    root.appendChild(el("h4", { class: "oi-h3", text: T("eGuess", p.them) }));
    root.appendChild(segm([T("eYes"), T("eNo")], ["j", "n"], function (v) { g = v; upd(); }));
    theirStatus(root, p, item);
    root.appendChild(el("p", { class: "oi-note", text: T("qOf", item + 1, n) }));
    root.appendChild(btns(btn(T("skip"), "", function () { ok.disabled = true; answer(p, item, "s"); }), ok));
  }
  function segm(labels, values, cb) {
    var s = el("div", { class: "ds-seg oi-seg", role: "radiogroup" });
    labels.forEach(function (lb, i) {
      var b = el("button", { type: "button", role: "radio", "aria-checked": "false", text: lb });
      b.addEventListener("click", function () { [].forEach.call(s.children, function (x) { x.setAttribute("aria-checked", String(x === b)); }); cb(values[i]); });
      s.appendChild(b);
    });
    return s;
  }
  function hint(root) { var h = el("p", { class: "oi-filter", role: "alert", hidden: true }); root.appendChild(h); return function (k) { h.hidden = !k; h.textContent = k ? (T("eFiltered") || {})[k] || T("eFail") : ""; }; }
  function lieWrite(root, p, t) {
    root.appendChild(el("h3", { class: "oi-q", text: T("bWrite") }));
    root.appendChild(el("p", { class: "oi-note", text: T("bWriteSub") }));
    var lie = null, ins = [], box = el("div", { class: "oi-lines" });
    t.q.forEach(function (qn, i) {
      var inp = el("input", { type: "text", class: "inp oi-line", maxlength: "80", placeholder: Q("B", qn) || "", "aria-label": Q("B", qn) || "" });
      var mark = el("button", { type: "button", class: "oi-lie", role: "radio", "aria-checked": "false", text: T("bLie") });
      mark.addEventListener("click", function () { lie = String(i); [].forEach.call(box.querySelectorAll(".oi-lie"), function (x) { x.setAttribute("aria-checked", String(x === mark)); }); upd(); });
      inp.addEventListener("input", function () { upd(); });
      ins.push(inp);
      box.appendChild(el("div", { class: "oi-line-row" }, [el("span", { class: "oi-letter", "aria-hidden": "true", text: String(i + 1) }), inp, mark]));
    });
    root.appendChild(box);
    var show = hint(root);
    var ok = btn(T("send"), "btn-amber", function () {
      var lines = ins.map(function (x) { return x.value.replace(/\s+/g, " ").trim(); });
      for (var i = 0; i < 3; i++) { var f = L.filter(lines[i]); if (f !== "ok") { show(f); return; } }
      ok.disabled = true;
      answer(p, 0, lines.join("\n"), function (r) { if (r.code) { ok.disabled = false; show(r.code.slice(9)); } }).then(function (r) {
        if (!r.code) answer(p, 1, lie);
      });
    });
    var upd = function () { ok.disabled = !(lie != null && ins.every(function (x) { return x.value.trim().length >= 2; })); };
    upd();
    theirStatus(root, p, 0);
    root.appendChild(el("div", { class: "oi-btns oi-btns-1" }, [ok]));
  }
  function lieGuess(root, p) {
    var lines = String(L.ans(p, p.round, 0).them || "").split("\n"), sel = null;
    root.appendChild(el("h3", { class: "oi-q", text: T("bGuess") }));
    var box = el("div", { class: "oi-opts" });
    lines.forEach(function (ln, i) { var c = choice(ln, String(i + 1)); c.setAttribute("data-v", String(i)); box.appendChild(c); });
    radios(box, function (v) { sel = v; ok.disabled = false; });
    root.appendChild(box);
    theirStatus(root, p, 2);
    var ok = btn(T("answer"), "btn-amber", function () { if (sel != null) { ok.disabled = true; answer(p, 2, sel); } });
    ok.disabled = true;
    root.appendChild(el("div", { class: "oi-btns oi-btns-1" }, [ok]));   // no skip on the guess (the score needs it)
  }
  function glassGame(root, p, item, t) {
    if (item === 2) {
      root.appendChild(el("h3", { class: "oi-q", text: T("cFollow") }));
      root.appendChild(el("p", { class: "oi-stmt", text: Q("C", t.q[0]) || "" }));
      var inp = el("input", { type: "text", class: "inp oi-line", maxlength: "80", placeholder: T("cFollowPh"), "aria-label": Q("C", t.q[0]) || "" });
      root.appendChild(inp);
      var show = hint(root);
      theirStatus(root, p, 2);
      var ok = btn(T("answer"), "btn-amber", function () {
        var v = inp.value.replace(/\s+/g, " ").trim(); if (!v) { answer(p, 2, "s"); return; }
        var f = L.filter(v); if (f !== "ok") { show(f); return; }
        ok.disabled = true; answer(p, 2, v, function (r) { if (r.code) { ok.disabled = false; show(r.code.slice(9)); } });
      });
      root.appendChild(btns(btn(T("skip"), "", function () { answer(p, 2, "s"); }), ok));
      return;
    }
    var sel = null;
    root.appendChild(el("h3", { class: "oi-q", text: item === 0 ? T("cMine") : T("cGuess", p.them) }));
    var box = el("div", { class: "oi-opts oi-opts-2" });
    glass().forEach(function (g, i) { var c = choice(g, String(i + 1)); c.setAttribute("data-v", String(i)); box.appendChild(c); });
    radios(box, function (v) { sel = v; ok2.disabled = false; });
    root.appendChild(box);
    theirStatus(root, p, item);
    var ok2 = btn(T("answer"), "btn-amber", function () { if (sel != null) { ok2.disabled = true; answer(p, item, sel); } });
    ok2.disabled = true;
    root.appendChild(el("div", { class: "oi-btns oi-btns-1" }, [ok2]));
  }

  /* ---------- after a round: score, then the reveal question ---------- */
  function summary(root, p, r) {
    var t = L.planOf(p, r), sc = L.score(p, r), like = t && (t.t === "A" || t.t === "D") ? T("likeA") : T("likeB");
    var pct = sc[1] ? Math.round(100 * sc[0] / sc[1]) : 0;
    var card = el("div", { class: "oi-score" }, [el("div", { class: "oi-score-h" }, [el("span", { text: like }), el("b", { class: "oi-score-n", text: T("scoreOf", sc[0], sc[1]) })]),
      el("div", { class: "oi-bar", "aria-hidden": "true" }, [el("i", { style: "width:" + pct + "%" })])]);
    if (t && t.t === "B") {
      var lines = String(L.ans(p, r, 0).them || "").split("\n"), lie = L.ans(p, r, 1).them, g = L.ans(p, r, 2).me;
      var box = el("div", { class: "oi-opts oi-res" });
      lines.forEach(function (ln, i) {
        var c = choice(ln, String(i + 1), String(i) === g); c.disabled = true;
        if (String(i) === lie) { c.classList.add("oi-lie-is"); c.appendChild(el("span", { class: "oi-tag " + (g === lie ? "ok" : "no"), text: g === lie ? T("right") : T("bLie") })); }
        box.appendChild(c);
      });
      root.appendChild(box);
    } else if (t && t.t === "C") {
      var th = L.ans(p, r, 0).them, fu = L.ans(p, r, 2).them;
      root.appendChild(el("div", { class: "oi-list" }, [
        el("div", { class: "oi-row" }, [el("span", { class: "oi-t" }, [el("small", { text: T("cGuess", p.them) }), el("b", { text: th != null ? glass()[+th] : "–" })])]),
        fu && fu !== "s" ? el("div", { class: "oi-row" }, [el("span", { class: "oi-t" }, [el("small", { text: Q("C", t.q[0]) || "" }), el("b", { text: fu })])]) : null]));
    }
    root.appendChild(card);
  }
  function decide(root, p, step) {
    summary(root, p, p.round);
    var stop = function () { act("oi_step", { p_pair: p.id, p_yes: false }); C.S.local.selfEnd = p.id; C.saveLocal(); };
    root.appendChild(btns(btn(T("enough"), "", stop), btn((T("stepAsk") || {})[step], "btn-amber oi-step-yes", function (e) { e.currentTarget.disabled = true; act("oi_step", { p_pair: p.id, p_yes: true }); })));
    root.appendChild(el("p", { class: "oi-note oi-center", text: T("stepHint") }));
  }

  /* ---------- reveal: Ni båda ville ---------- */
  function avatarHTML(p) {
    var spec = p.reveal && p.reveal.avatar;
    try { if (W.AVATAR && W.AVATAR.svg) return W.AVATAR.svg(spec || W.AVATAR.defaultSpec(p.them), {}); } catch (e) {}
    return "";
  }
  function reveal(p, step) {
    sheet(T("bothWanted"), function (root) {
      sub(root, T("stepOf", step, (T("stepNames") || {})[step]));
      var rv = p.reveal || {}, pic = el("div", { class: "oi-pic" + (step >= 3 ? " on" : ""), "aria-hidden": step >= 3 ? null : "true" });
      if (step >= 3) { pic.innerHTML = avatarHTML(p); pic.setAttribute("role", "img"); pic.setAttribute("aria-label", T("rPic")); }
      else pic.appendChild(el("span", { class: "oi-pic-q", html: ic("user", "") }));
      root.appendChild(pic);
      root.appendChild(el("h2", { class: "oi-name", text: step >= 2 ? rv.name || T("noName") : p.them }));
      root.appendChild(el("p", { class: "oi-meta", text: p.them + (rv.age ? " · " + rv.age.replace("-", "–") : "") }));
      if (step >= 3) root.appendChild(el("p", { class: "oi-note oi-center", text: T("picNote") }));
      var row = function (lb, val, done) {
        return el("div", { class: "oi-row oi-step" + (done ? " done" : "") }, [el("span", { class: "oi-ok", "aria-hidden": "true", html: done ? ic("check", "") : "" }),
          el("span", { class: "oi-t" }, [el("span", { text: lb })]), el("b", { text: val })]);
      };
      root.appendChild(el("div", { class: "oi-list" }, [row(T("rNick"), p.them, true), row(T("rAge"), rv.age ? rv.age.replace("-", "–") : T("later"), step >= 1),
        row(T("rName"), step >= 2 ? rv.name || T("noName") : T("later"), step >= 2), row(T("rPic"), step >= 3 ? T("shownNow") : T("later"), step >= 3)]));
      head(root, p, true);
      var next = function () { C.S.local.seenStep = step; C.saveLocal(); cur.key = ""; C.refresh(C.S.st); };
      root.appendChild(btns(btn(T("end"), "", function () { stopConfirm(); }), btn(step >= 3 ? T("chat") : T("nextRound"), "btn-amber oi-next", next)));
    });
  }

  /* ---------- chat ---------- */
  function chat(p) {
    cur.chatIds = {};
    var title = (p.reveal && p.reveal.name) || p.them;
    sheet(title, function (root) {
      sub(root, T("chatSub"));
      head(root, p, true);
      var log = el("div", { class: "oi-log", role: "log", "aria-live": "polite" });
      log.appendChild(el("p", { class: "oi-sys", text: T("chatFirst") }));
      root.appendChild(log);
      var show = hint(root);
      root.appendChild(el("div", { class: "oi-meet" }));
      var inp = el("input", { type: "text", class: "inp oi-in", maxlength: "300", placeholder: T("chatPh"), "aria-label": T("chatPh"), enterkeyhint: "send" });
      var send = el("button", { type: "button", class: "btn oi-send", "aria-label": T("sendAria"), html: ic("send", "") });
      var go = function () {
        var v = inp.value.replace(/\s+/g, " ").trim(); if (!v) return;
        var f = L.filter(v); if (f !== "ok") { show(f); return; }
        send.disabled = true;
        C.rpc("oi_send", { p_pair: p.id, p_body: v }).then(function (r) {
          send.disabled = false;
          if (r.code === "gone") return;
          if (r.code) { C.toast(C.errText(r.code), { err: true, id: "oi" }); return; }
          if (r.data && r.data.ok === false) { show(r.data.filtered); return; }
          show(null); inp.value = ""; C.poll();
        });
      };
      send.addEventListener("click", go);
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
      root.appendChild(el("div", { class: "oi-input" }, [inp, send]));
      chatPatch(p);
    });
  }
  function chatPatch(p) {
    var log = D.querySelector(".oi-ui .oi-log"), meet = D.querySelector(".oi-ui .oi-meet");
    if (!log) return;
    (p.msgs || []).forEach(function (m) {
      if (cur.chatIds[m.id]) return; cur.chatIds[m.id] = 1;
      var at = ""; try { at = new Date(m.at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }); } catch (e) {}
      log.appendChild(el("div", { class: "oi-msg-b" + (m.me ? " me" : "") }, [el("p", { text: m.body }), el("small", { text: at })]));
    });
    try { log.scrollTop = log.scrollHeight; } catch (e) {}
    if (meet) {
      var who = (p.reveal && p.reveal.name) || p.them, mine = p.meet && p.meet.me;
      var k = mine ? "w" : "q";
      if (meet.getAttribute("data-k") !== k) {
        meet.setAttribute("data-k", k); meet.innerHTML = "";
        if (mine) meet.appendChild(el("p", { class: "oi-meet-w", text: T("meetWait", who) }));
        else {
          meet.appendChild(el("div", { class: "oi-meet-t" }, [el("b", { text: T("meetQ") }), el("small", { text: T("meetSub") })]));
          meet.appendChild(btn(T("meetBtn"), "btn-amber btn-small oi-meet-b", function (e) { e.currentTarget.disabled = true; act("oi_meet", { p_pair: p.id }); }));
        }
      }
    }
  }

  /* ---------- code word ---------- */
  function code(p, word) {
    sheet(T("codeTitle"), function (root) {
      sub(root, ((p.reveal && p.reveal.name) || p.them));
      root.appendChild(el("div", { class: "oi-code" }, [el("small", { text: T("codeHead") }), el("strong", { class: "oi-word", text: word }), el("small", { text: T("codeSame") })]));
      var ol = el("ol", { class: "oi-steps" });
      ["code1", "code2", "code3"].forEach(function (k) { ol.appendChild(el("li", { text: T(k) })); });
      root.appendChild(ol);
      var share = function () {
        var txt = T("friendText");
        try { if (navigator.share) { navigator.share({ text: txt }).catch(function () {}); return; } } catch (e) {}
        try { var a = C.app(); if (a && a.copyText) a.copyText(txt); } catch (e) {}
      };
      root.appendChild(el("div", { class: "oi-list" }, [
        el("button", { type: "button", class: "oi-row oi-row-go", on: { click: share } }, [el("span", { class: "oi-i", "aria-hidden": "true", html: ic("users", "") }),
          el("span", { class: "oi-t" }, [el("b", { text: T("friend") }), el("small", { text: T("friendSub") })]), el("span", { class: "oi-chev", "aria-hidden": "true", html: ic("chev-right", "") })]),
        el("div", { class: "oi-row" }, [el("span", { class: "oi-i", "aria-hidden": "true", html: ic("taxi", "") }),
          el("span", { class: "oi-t" }, [el("b", { text: T("home") }), el("small", { text: T("homeSub") })])])]));
      head(root, p, true);
      root.appendChild(el("div", { class: "oi-btns oi-btns-1" }, [btn(T("okGo"), "btn-amber oi-okgo", function () { C.S.local.codeSeen = true; C.saveLocal(); cur.key = ""; C.refresh(C.S.st); })]));
    });
  }

  /* ---------- ended, Stopp, Anmäl ---------- */
  function endedScreen(phase) {
    if (!shown()) return;
    sheet(T("game"), function (root) {
      root.appendChild(el("div", { class: "oi-end", role: "status" }, [el("span", { class: "oi-i", "aria-hidden": "true", html: ic("moon", "") }), el("p", { text: T(L.endKey(phase, !!(C.S.st && C.S.st.on))) })]));
      root.appendChild(el("div", { class: "oi-btns oi-btns-1" }, [btn("Ok", "btn-amber", function () { A.closeSheet(); })]));
    });
  }
  function ended(sc) { if (shown() && !cur.sub) { cur.key = ""; endedScreen(sc.phase); } }
  function stopConfirm() {
    var p = pair(); if (!p) return;
    sheet(T("stopQ"), function (root) {
      sub(root, T("stopSub"));
      root.appendChild(btns(btn(T("cancel"), "", function () { cur.sub = null; cur.key = ""; C.refresh(C.S.st); }), btn(T("stopBtn"), "btn-danger oi-stop-yes", function (e) {
        e.currentTarget.disabled = true;
        C.S.local.selfEnd = p.id; C.saveLocal();
        C.rpc("oi_stop", { p_pair: p.id }).then(function () { stoppedBanner(); C.poll(); });
      })));
    }, "stop");
  }
  function stoppedBanner() {
    sheet(T("game"), function (root) {
      root.appendChild(el("div", { class: "oi-banner ok", role: "status" }, [el("span", { class: "oi-ok", "aria-hidden": "true", html: ic("check", "") }), el("span", { text: T("stopped") })]));
      root.appendChild(el("div", { class: "oi-btns oi-btns-1" }, [btn("Ok", "btn-amber", function () { A.closeSheet(); })]));
    }, "done");
  }
  function reportSheet(id, alias, base) {
    if (!id) return;
    var reason = null;
    sheet(T("report"), function (root) {
      sub(root, T("reportSub", alias || "–"));
      root.appendChild(el("h3", { class: "oi-h3", text: T("what") }));
      var box = el("div", { class: "oi-list oi-reasons", role: "radiogroup", "aria-label": T("what") });
      (T("reasons") || []).forEach(function (r) {
        var b = el("button", { type: "button", class: "oi-row oi-radio", role: "radio", "aria-checked": "false", "data-v": r[0] }, [el("span", { class: "oi-dot", "aria-hidden": "true" }), el("span", { class: "oi-t", text: r[1] })]);
        box.appendChild(b);
      });
      box.addEventListener("click", function (e) { var b = e.target.closest(".oi-radio"); if (!b) return; reason = b.getAttribute("data-v"); [].forEach.call(box.children, function (x) { x.setAttribute("aria-checked", String(x === b)); }); msg.textContent = ""; });
      root.appendChild(box);
      var note = el("textarea", { class: "inp oi-note-in", maxlength: "300", rows: "2", placeholder: T("notePh"), "aria-label": T("notePh") });
      root.appendChild(note);
      var blk = el("input", { type: "checkbox", class: "oi-cb" }); blk.checked = true;
      root.appendChild(el("label", { class: "oi-check" }, [blk, el("span", { text: T("alsoBlock") })]));
      root.appendChild(el("a", { class: "oi-danger", href: "tel:112" }, [el("span", { class: "oi-i", "aria-hidden": "true", html: ic("sos", "") }), el("span", { text: T("danger") })]));
      var msg = el("p", { class: "oi-msg", role: "status", "aria-live": "polite" });
      root.appendChild(msg);
      root.appendChild(btns(btn(T("justStop"), "", function () { C.S.local.selfEnd = id; C.saveLocal(); C.rpc("oi_stop", { p_pair: id }).then(function () { stoppedBanner(); C.poll(); }); }),
        btn(T("send"), "btn-amber oi-rep-send", function (e) {
          if (!reason) { msg.textContent = T("pickReason"); return; }
          var b = e.currentTarget; b.disabled = true;
          C.S.local.selfEnd = id; C.saveLocal();
          C.rpc("oi_report", { p_pair: id, p_reason: reason, p_note: note.value.trim() || null, p_block: blk.checked }).then(function (r) {
            if (r.code && r.code !== "gone") { b.disabled = false; msg.textContent = C.errText(r.code); return; }
            reportDone(); C.poll();
          });
        })));
    }, "report", base);
  }
  function reportDone() {
    sheet(T("report"), function (root) {
      root.appendChild(el("div", { class: "oi-banner ok", role: "status" }, [el("span", { class: "oi-ok", "aria-hidden": "true", html: ic("check", "") }), el("span", { text: T("reportDone") })]));
      root.appendChild(el("h3", { class: "oi-h3", text: T("nextHead") }));
      var ol = el("ol", { class: "oi-steps" });
      ["next1", "next2", "next3", "next4"].forEach(function (k) { ol.appendChild(el("li", { text: T(k) })); });
      root.appendChild(ol);
      root.appendChild(el("a", { class: "oi-danger", href: "tel:112" }, [el("span", { class: "oi-i", "aria-hidden": "true", html: ic("sos", "") }), el("span", { text: T("danger") })]));
      root.appendChild(el("div", { class: "oi-btns oi-btns-1" }, [btn("Ok", "btn-amber", function () { A.closeSheet(); })]));
    }, "done");
  }

  /* ---------- the safety page ---------- */
  function row(icon, t, s, href, fn) {
    var kids = [el("span", { class: "oi-i", "aria-hidden": "true", html: ic(icon, "") }), el("span", { class: "oi-t" }, [el("b", { text: t }), s ? el("small", { text: s }) : null])];
    if (href || fn) kids.push(el("span", { class: "oi-chev", "aria-hidden": "true", html: ic("chev-right", "") }));
    if (href) return el("a", { class: "oi-row oi-row-go", href: href }, kids);
    if (fn) return el("button", { type: "button", class: "oi-row oi-row-go", on: { click: fn } }, kids);
    return el("div", { class: "oi-row" }, kids);
  }
  function safety() {
    var st = C.S.st || {}, hide = C.ls("olnu.oi.hide") === "1";
    sheet(T("safeTitle"), function (root) {
      sub(root, T("title"));
      root.appendChild(el("h3", { class: "oi-h3", text: T("weDo") }));
      root.appendChild(el("div", { class: "oi-list" }, [row("users", T("s1"), T("s1s")), row("clock", T("s2"), T("s2s")), row("lock", T("s3"), T("s3s")), row("hand", T("s4"), T("s4s"))]));
      root.appendChild(el("h3", { class: "oi-h3", text: T("whenMeet") }));
      root.appendChild(el("div", { class: "oi-list" }, [row("eye", T("m1"), T("m1s")), row("users", T("m2"), T("m2s"))]));
      root.appendChild(el("h3", { class: "oi-h3", text: T("help") }));
      root.appendChild(el("div", { class: "oi-list" }, [row("sos", T("h1"), T("h1s"), "tel:112"), row("phone", T("h2"), T("h2s"), "tel:116016"), row("shield", "Polisen 114 14", "", "tel:11414")]));
      root.appendChild(el("h3", { class: "oi-h3", text: T("yourData") }));
      var list = el("div", { class: "oi-list" });
      list.appendChild(row("check", st.consent ? T("consentOn") : T("consentOff"), T("stored")));
      if (st.consent) list.appendChild(row("x", T("withdraw"), T("withdrawSub"), null, function () {
        C.rpc("oi_withdraw", {}).then(function (r) { if (r.code === "gone") return; C.ls(C.REC, null); C.toast(T("withdrawn"), { id: "oi" }); A.closeSheet(); C.poll(); });
      }));
      list.appendChild(row("flag", T("recent"), T("recentSub"), null, recentList));
      list.appendChild(row(hide ? "eye" : "eye-off", hide ? T("rowOn") : T("hide"), T("hideSub"), null, function () {
        C.ls("olnu.oi.hide", hide ? null : "1");
        if (!hide) { [].forEach.call(D.querySelectorAll(".oi-sec"), function (n) { n.remove(); }); C.toast(T("hidden"), { id: "oi" }); }
        A.closeSheet();
      }));
      root.appendChild(list);
    }, "safety", T("safeTitle"));
  }
  function recentList() {
    sheet(T("recent"), function (root) {
      sub(root, T("recentSub"));
      root.appendChild(el("button", { type: "button", class: "btn btn-small btn-ghost oi-back", html: ic("chev-left", "pi-inl") + "<span></span>", on: { click: function () { safety(); } } }));
      root.querySelector(".oi-back span").textContent = T("safeTitle");
      var list = el("div", { class: "oi-list" }, [el("div", { class: "oi-row" }, [el("span", { class: "oi-spin", "aria-hidden": "true" })])]);
      root.appendChild(list);
      C.rpc("oi_recent", {}).then(function (r) {
        list.innerHTML = "";
        var rows = (r.data || []);
        if (!rows.length) { list.appendChild(row("moon", T("recentNone"))); return; }
        rows.forEach(function (x) {
          var t = (x.name ? x.name + " · " : "") + x.alias, s = String(x.night || "");
          list.appendChild(x.reported ? row("check", t, s + " · " + T("reported")) : row("flag", t, s, null, function () { reportSheet(x.ref, x.alias, T("safeTitle")); }));
        });
      });
    }, "recent", T("safeTitle"));
  }

  function start(core) { C = core; A = core.app(); }
  P.oiUi = { start: start, open: open, update: update, ended: ended, safety: safety, shown: shown };
})();
