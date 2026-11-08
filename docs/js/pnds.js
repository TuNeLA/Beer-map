/* PintsNow — PNDS: design system pass (agent ds-site, 2026-11-07; owner feedback 1–12). Swedish only.
   window.PNDS, in app.js mods() right after PNUI. Styles: pnds.css (loaded last). Icons: js/pnicons.js (window.PNI).
   Rules + tokens: DESIGN.md in the repo root.
   1. Icons, not emoji, in the UI chrome: a leading emoji in a heading / tab / button / row label / toggle label becomes our
      own SVG icon (PNI.EMOJI); an emoji with no icon is dropped there. Chat text, ticker lines, game art and other fun
      copy keep their emoji (see DESIGN.md "Emoji we keep").
   2. Main screen: the precision choice is a fixed-size control (pnds.css); its helper text is a short bubble after a
      change (and before the first beer); the world count pill says "N ute" with a globe icon.
   3. Navigation: a full-screen game / förfest / party overlay that was opened from a sheet goes BACK to that sheet
      (and its group view) when it closes. The hub's top-left button is ‹ "Tillbaka till gruppen". In #sheet, ✕ shows
      only on the first screen (pnds.css; ‹ = one step back on the others).
   4. Grupper: one calm "Ute ikväll" card at the top (friends out + who said Ute), tap = the Ikväll? sheet. The map has no
      friends strip any more.
   5. Inställningar: iOS-style groups (pnds.css) + Trygghet rows move to "Integritet & säkerhet", the notification types
      fold behind one "Välj notiser" row (a back step), exact duplicate rows hide.
   6. A sheet that failed to build shows a finished error state with "Uppdatera appen" (never an empty sheet).
   Public: PNDS = { init, onPoll, groupsSheet, settingsSheet, profileSheet, sheetFail, iconize, outCard }. */
(function () {
  "use strict";
  var A = null;
  function $(id) { return document.getElementById(id); }
  function W(n) { return window[n] || null; }
  function safe(fn, d) { try { var v = fn(); return v === undefined ? d : v; } catch (e) { return d; } }
  function ic(n, cls) { var P = W("PNI"); return P ? P.svg(n, cls) : ""; }
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") n.textContent = v; else if (k === "html") n.innerHTML = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function sheetOpen() { var s = $("sheet"); return !!(s && !s.hidden); }

  /* ---------- 1. icons instead of emoji in the chrome ---------- */
  var EMO_RE;
  try { EMO_RE = new RegExp("^(\\s*)((?:\\p{Extended_Pictographic})(?:\\uFE0F|\\u20E3|[\\u{1F3FB}-\\u{1F3FF}]|\\u200D\\p{Extended_Pictographic}\\uFE0F?)*)\\s*", "u"); } catch (e) { EMO_RE = null; }
  var CHROME = [".sheet-head h2", "#sheet-body h3", "#sheet-body h4", "#sheet-body .tabs > button", "#sheet-body [role=tab]", "#sheet-body .toggle-row > span",
    "#sheet-body button", "#sheet-body a.btn", "#sheet-body .ds-sec-i", "#sheet-body .ds-row-i", "#sheet-body .ds-row-t > span", "#sheet-body label",
    ".leaflet-popup button", ".leaflet-popup a.btn", ".leaflet-popup h3", ".topbar button", ".dock .side-ico", ".hx-chip", ".locate-btn", "#chaos-show",
    "#sp .sp-top b", "#sp .sp-tabs button", ".dl-cap-h", "#sheet-body button span", "#sheet-body button b", "#sheet-body summary span", ".leaflet-popup summary span",
    ".leaflet-popup button span", ".leaflet-popup .chip", ".pn-ikv-gh", ".toast .btn",
    ".leaflet-popup summary", ".leaflet-popup .pp-sec-h", ".leaflet-popup .bi-h", ".leaflet-popup .ci-here", ".leaflet-popup .ute-tag", ".leaflet-popup .sp-l",
    ".leaflet-popup a.af-qr", "#sheet-body .gpg-ph-t", "#sheet-body .bp-sb-h > span", "#sheet-body .pk-ikv-t > b", "#sheet-body .pk-h", "#sheet-body .np-h", "#sheet-body .ht-h", "#sheet-body .pn-it > .pn-e"].join(",");
  // fun copy / user text / game art: emoji stay
  var KEEP = ".chat-list, .gpg-msgs, .cm-body, .cm-text, .dm-list, .dm-msg, .tk-track, .takeover, .mx-pop, .og, .kind-grid, .no-pi, .sp-cards, .sp-card, .sp-room, " +
    ".pn-gikv, .rx, .pp-rx, .react, .reactions, .emoji, .ev-react, .bm-b, .pf-av, .av-wiz, .avatar, input, textarea, select, [contenteditable], .sk-, .ff-cards, .pt-cards";
  var EXTRA = { "🤔": "help", "🛋️": "home", "🛋": "home", "💧": "drink", "🎯": "locate", "🧪": "sparkle", "🔙": "chev-left", "🙋": "hand", "🫡": "hand", "🏁": "flag", "🎤": "speaker",
    "📞": "phone", "☎️": "phone", "✋": "hand", "⏹️": "x", "⏹": "x", "🚑": "sos", "🪖": "medal", "🪩": "sparkle", "🖨️": "qr", "🗣️": "megaphone", "🧾": "receipt", "☕": "drink", "🍔": "food", "🍟": "food", "🥙": "food", "🍜": "food", "🍣": "food", "🥗": "food", "🧁": "food", "🍦": "food", "📊": "clock", "🧑‍🎨": "user", "👆": "hand", "📈": "clock" };
  function iconFor(e) {
    var P = W("PNI"); if (!P) return null;
    var k = e.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "");
    return P.EMOJI[k] || P.EMOJI[k.replace(/️/g, "")] || EXTRA[k] || EXTRA[k.replace(/️/g, "")] || null;
  }
  function firstText(el) {
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { if (c.nodeValue.trim()) return c; continue; }
      if (c.nodeType === 1) { if (c.classList && c.classList.contains("pi")) return null; return null; }
    }
    return null;
  }
  function iconizeEl(el) {
    if (!EMO_RE || el.__pniDone === el.textContent) return;
    if (el.closest(KEEP)) { el.__pniDone = el.textContent; return; }
    var t = firstText(el);
    if (t) {
      var m = EMO_RE.exec(t.nodeValue);
      if (m && m[2]) {
        var rest = t.nodeValue.slice(m[0].length), name = iconFor(m[2]);
        var alone = !rest.trim() && !t.nextSibling && t === el.firstChild;
        if (name) {
          var tmp = document.createElement("span"); tmp.innerHTML = ic(name, alone ? "" : "pi-lead");
          var svg = tmp.firstChild;
          if (svg) { el.insertBefore(svg, t); t.nodeValue = rest; if (!rest) el.removeChild(t); }
        } else if (rest.trim()) {
          t.nodeValue = m[1] + rest;   // an emoji with no icon: dropped (the label says it)
        }
      }
    }
    el.__pniDone = el.textContent;
  }
  function iconize(root) {
    if (!root || !root.querySelectorAll) return;
    try {
      if (root.matches && root.matches(CHROME)) iconizeEl(root);
      root.querySelectorAll(CHROME).forEach(iconizeEl);
    } catch (e) {}
  }
  var dirty = [], raf = 0;
  function soon(n) {
    if (n && dirty.indexOf(n) < 0) dirty.push(n);
    if (raf) return;
    raf = 1;
    // the next frame, or 60 ms when no frame comes (a hidden / background page pauses requestAnimationFrame)
    var go = function () {
      if (!raf) return;
      raf = 0; var d = dirty; dirty = [];
      d.forEach(function (x) { if (x.isConnected) iconize(x); });
      fixChrome();
    };
    try { requestAnimationFrame(go); } catch (e) {}
    setTimeout(go, 60);
  }
  function watchIcons() {
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var t = ms[i].target; if (t.nodeType === 3) t = t.parentNode;
        if (!t || (t.closest && t.closest(".pi"))) continue;
        soon(t.nodeType === 1 ? t : null);
      }
    });
    [$("sheet"), document.querySelector(".topbar"), document.querySelector(".dock"), document.querySelector(".hud-left"), $("chaos")].forEach(function (r) {
      if (r) { mo.observe(r, { childList: true, subtree: true, characterData: true }); soon(r); }
    });
    // late roots: the bar sheet (Leaflet popup), the game hub
    var late = new MutationObserver(function (ms) {
      ms.forEach(function (m) { [].forEach.call(m.addedNodes || [], function (n) {
        if (n.nodeType !== 1) return;
        if (n.id === "sp" || (n.classList && (n.classList.contains("leaflet-popup") || n.classList.contains("dl-cap")))) { mo.observe(n, { childList: true, subtree: true, characterData: true }); soon(n); }
        if (n.id === "sp" || n.id === "ff" || n.id === "pt") watchOverlay(n);
      }); });
    });
    late.observe(document.body, { childList: true });
    var pp = document.querySelector(".leaflet-popup-pane"); if (pp) late.observe(pp, { childList: true });
    var dc = $("dl-cap"); if (dc) { mo.observe(dc, { childList: true, subtree: true, characterData: true }); }
  }
  // fixed chrome icons by id (their old content was an emoji or a one-off svg)
  function setIcon(el, name, label) {
    if (!el || el.__pnIc === name) return;
    el.__pnIc = name;
    var keep = [].filter.call(el.children, function (c) { return /badge|dot|cnt|n$/.test(c.className || "") && !c.classList.contains("pi"); });
    el.innerHTML = ic(name);
    keep.forEach(function (k) { el.appendChild(k); });
    if (label && !el.getAttribute("aria-label")) el.setAttribute("aria-label", label);
  }
  function fixChrome() {
    setIcon($("btn-top"), "trophy", "Topplistor");
    setIcon($("btn-locate"), "locate", "Visa var jag är");
    var gi = document.querySelector("#btn-groups .side-ico"); if (gi && !gi.querySelector(".pi")) gi.innerHTML = ic("users");
    var x = $("sheet-close"); if (x && !x.querySelector(".pi")) x.innerHTML = ic("x");
    var bk = $("pn-back"); if (bk && !bk.querySelector(".pi")) bk.innerHTML = ic("chev-left");
    var ex = $("prec-exact"), ar = $("prec-area");
    if (ex && !ex.querySelector(".pi")) ex.insertAdjacentHTML("afterbegin", ic("pin"));
    if (ar && !ar.querySelector(".pi")) ar.insertAdjacentHTML("afterbegin", ic("area"));
    // the game hub: ‹ back to the group (the hub's ✕ looked like "close everything")
    document.querySelectorAll("#sp .sp-back").forEach(function (b) {
      if (b.querySelector(".pi")) return;
      var toGroup = /✕/.test(b.textContent);
      b.innerHTML = ic("chev-left");
      b.setAttribute("aria-label", toGroup ? "Tillbaka till gruppen" : "Tillbaka till spelen");
    });
    document.querySelectorAll(".skj-ic").forEach(function (x) { if (!x.querySelector(".pi")) x.innerHTML = ic("taxi"); });
    document.querySelectorAll(".sp-gi-ic").forEach(function (x) { if (!x.querySelector(".pi-game")) x.innerHTML = ic("game"); });
    document.querySelectorAll("#sp .sp-x").forEach(function (b) { if (!b.querySelector(".pi")) { b.innerHTML = ic("x"); b.setAttribute("aria-label", "Stäng spelet"); } });
    liveCount(); merExtra(); driveLabel(); profileBtn();
  }
  // top-right: my own character's face if I made one, else a clean person icon (no initial on a bottle cap)
  function profileBtn() {
    var b = $("btn-settings"); if (!b) return;
    var av = W("AVATAR"), me = av && av.me ? safe(function () { return av.me(); }, null) : null;
    var sig = me && me.spec ? "a:" + JSON.stringify(me.spec) : "none";
    if (b.__pnds === sig && b.querySelector(".pn-me")) return;
    var html = "";
    if (me && me.spec && av.svg) html = safe(function () { return av.svg(me.spec, { vb: (av.VB && av.VB.FACE) || "24 20 52 52", small: true }); }, "");
    b.innerHTML = '<span class="pn-me' + (html ? " pn-me-av" : "") + '" aria-hidden="true">' + (html || ic("user")) + "</span>";
    b.__pnds = sig;
    b.__pnCap = "c:" + (safe(function () { return A.getName(); }, "") || safe(function () { return localStorage.getItem("olnu.name"); }, "") || "?");   // PNUI.avatarBtn leaves it
    b.setAttribute("aria-label", "Profil och inställningar");
  }
  // Mer på kartan: + "Ställen nära dig" (js/nearplaces.js, same as the ?nara=1 link)
  function merExtra() {
    var t = $("sheet-title"), b = $("sheet-body"), np = W("NEARPLACES");
    if (!t || !b || !sheetOpen() || txt(t) !== "Mer på kartan" || !np || typeof np.open !== "function") return;
    var list = b.querySelector(".pn-list"); if (!list || list.querySelector("[data-pn-near]")) return;
    var r = h("button", { type: "button", class: "ds-row pn-row", "data-pn-near": "1" }, [h("span", { class: "ds-row-i", html: ic("food") }),
      h("span", { class: "ds-row-t" }, [h("span", { text: "Ställen nära dig" }), h("small", { text: "Krogar och restauranger runt dig" })]), h("span", { class: "ds-chev" })]);
    r.addEventListener("click", function () { try { np.open(); } catch (e) {} });
    var rows = list.querySelectorAll(":scope > .pn-row"), last = rows[rows.length - 1];
    if (last && /Kartstil/.test(txt(last))) list.insertBefore(r, last); else list.appendChild(r);
  }
  // group page "+": the "Jag kör ikväll" tile shows the new state at once (skjuts.js builds the label once)
  var driveT = 0;
  function driveLabel() {
    var sk = W("SKJUTS"); if (!sk || typeof sk.driving !== "function") return;
    var on = safe(function () { return sk.driving(); }, false);
    document.querySelectorAll('#sheet-body [data-ga="pk-drv"] .btn').forEach(function (b) {
      var gl = b.querySelector(".gpg-gl"), gs = b.querySelector(".gpg-gs"), want = "Jag kör ikväll";
      if (gl && txt(gl) !== want) gl.innerHTML = ic("taxi", "pi-lead") + want;
      if (gs) { var ws = on ? "Gänget ser att du kör" : "Visa gänget att du kör"; if (txt(gs) !== ws) gs.textContent = ws; }
    });
  }
  document.addEventListener("click", function (e) {
    if (!e.target || !e.target.closest || !e.target.closest('[data-ga="pk-drv"]')) return;
    var n = 0; clearInterval(driveT);
    driveT = setInterval(function () { driveLabel(); if (++n > 16) clearInterval(driveT); }, 300);
  });

  /* ---------- 2. main screen ---------- */
  var lcBusy = false;
  function liveCount() {
    var lc = $("live-count"); if (!lc || lcBusy || lc.classList.contains("zn-pill")) return;
    var b = lc.querySelector("b");
    if (!b || lc.querySelector(".pi")) return;
    var n = b.textContent.trim();
    if (!/^[\d\s–-]+$/.test(n)) return;
    lcBusy = true;
    lc.innerHTML = ic("globe") + "<b>" + n.replace(/[<>&]/g, "") + "</b>&nbsp;ute";
    lc.setAttribute("aria-label", n + " ute just nu");
    lcBusy = false;
  }
  function watchLive() {
    var lc = $("live-count"); if (!lc || !window.MutationObserver) return;
    new MutationObserver(function () { if (!lcBusy) liveCount(); }).observe(lc, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    liveCount();
  }
  // ÖL! shows only the word now: the button keeps a spoken name (app.js removes aria-label in the ready state)
  function beerName() {
    var b = $("btn-beer"); if (!b) return;
    var fix = function () { if (!b.getAttribute("aria-label") && !b.classList.contains("cooldown")) b.setAttribute("aria-label", "Rapportera öl"); };
    fix();
    if (window.MutationObserver) new MutationObserver(fix).observe(b, { attributes: true, attributeFilter: ["aria-label", "class"] });
  }
  var hintT = 0;
  function precHint(ms) {
    var p = $("prec-hint"); if (!p || !p.textContent.trim()) return;
    p.classList.add("pn-show"); clearTimeout(hintT);
    hintT = setTimeout(function () { p.classList.remove("pn-show"); }, ms || 2800);
  }
  function watchPrec() {
    var s = $("prec-seg"); if (!s) return;
    var touched = false;
    s.addEventListener("click", function () { touched = true; setTimeout(function () { precHint(2800); }, 30); });
    // first visit (before the first beer): show the hint once, short
    setTimeout(function () { if (!touched && document.body.classList.contains("pn-first") && !sheetOpen()) precHint(5000); }, 2500);
  }

  /* ---------- 3. overlays go back to the sheet they came from ---------- */
  var RET = { spel: 1, forfest: 1, party: 1 }, ret = null;
  function snapshot() {
    var sn = W("SHEETNAV"), cur = sn && sn.cur ? safe(function () { return sn.cur(); }, null) : null;
    if (!cur) return null;
    var b = $("sheet-body"), w = b && b.querySelector("[data-gv]");
    return { entry: cur, gv: w ? w.getAttribute("data-gv") : null, scroll: b ? b.scrollTop : 0, at: Date.now() };
  }
  function hookClose() {
    if (!A || A.__pndsClose) return;
    var orig = A.closeSheet;
    if (typeof orig !== "function") return;
    A.__pndsClose = true;
    A.closeSheet = function (reason) {
      if (typeof reason === "string" && RET[reason] && sheetOpen()) ret = snapshot();
      return orig.apply(this, arguments);
    };
  }
  function goBack() {
    var r = ret; ret = null;
    if (!r || Date.now() - r.at > 3 * 3600e3 || sheetOpen() || !A) return;
    var o = {}; Object.keys(r.entry[2] || {}).forEach(function (k) { o[k] = r.entry[2][k]; }); o.now = true;
    setTimeout(function () {
      if (sheetOpen()) return;
      try { A.openSheet(r.entry[0], r.entry[1], o); } catch (e) { return; }
      var tries = 0;
      (function restore() {
        var b = $("sheet-body"), w = b && b.querySelector("[data-gv]");
        if (r.gv && r.gv !== "home") {
          if (!w && tries++ < 10) { setTimeout(restore, 60); return; }
          try { if (w && W("GPAGE") && W("GPAGE").view) W("GPAGE").view(w, r.gv); } catch (e) {}
        }
        if (b && r.scroll) setTimeout(function () { b.scrollTop = r.scroll; }, 40);
      })();
    }, 80);
  }
  function watchOverlay(root) {
    if (!root || root.__pnds || !window.MutationObserver) return;
    root.__pnds = true;
    new MutationObserver(function () { if (root.hidden && ret) goBack(); }).observe(root, { attributes: true, attributeFilter: ["hidden"] });
  }
  function watchOverlaysGone() {
    if (!window.MutationObserver) return;
    new MutationObserver(function (ms) {
      ms.forEach(function (m) { [].forEach.call(m.removedNodes || [], function (n) { if (n.nodeType === 1 && /^(sp|ff|pt)$/.test(n.id) && ret) goBack(); }); });
    }).observe(document.body, { childList: true });
    ["sp", "ff", "pt"].forEach(function (id) { watchOverlay($(id)); });
  }

  /* ---------- 4. Grupper: "Ute ikväll" ---------- */
  function evening() { try { if (localStorage.getItem("olnu.pnEve") === "1") return true; } catch (e) {} var x = new Date().getHours(); return x >= 16 || x < 5; }
  function outPeople() {
    var seen = {}, out = [];
    (safe(function () { return A.beers(); }, []) || []).forEach(function (b) {
      var nm = b && b.friend_name; if (!nm || seen[nm]) return; seen[nm] = 1; out.push({ name: nm, live: true });
    });
    var ik = safe(function () { return W("PNUI")._ikv().d; }, null);
    var plan = [];
    if (ik && ik.people) ik.people.forEach(function (p) { if (p.st === "ute" && !seen[p.name]) { seen[p.name] = 1; plan.push({ name: p.name, live: false }); } });
    return { live: out, plan: plan, mine: ik ? ik.mine : null, kanske: ik && ik.counts ? ik.counts.kanske | 0 : 0 };
  }
  function names(list) {
    var n = list.map(function (p) { return p.name; });
    if (n.length <= 2) return n.join(" och ");
    return n.slice(0, 2).join(", ") + " och " + (n.length - 2) + " till";
  }
  function outCard() {
    var o = outPeople(), all = o.live.concat(o.plan), cap = W("PNUI") && W("PNUI").capSVG;
    var faces = h("span", { class: "pn-out-faces", "aria-hidden": "true" });
    all.slice(0, 4).forEach(function (p) { faces.appendChild(h("span", { html: cap ? cap(p.name, 32) : "" })); });
    var t, s;
    if (o.live.length) { t = o.live.length === 1 ? "1 vän ute nu" : o.live.length + " vänner ute nu"; s = names(o.live) + (o.plan.length ? " · " + o.plan.length + " ska ut" : ""); }
    else if (o.plan.length) { t = o.plan.length + " ska ut ikväll"; s = names(o.plan); }
    else { t = "Ingen ute än"; s = evening() ? "Säg om du ska ut ikväll" : "Dina vänner syns här när de är ute"; }
    var me = o.mine === "ute" ? "Du: Ute" : o.mine === "kanske" ? "Du: Kanske" : o.mine === "hemma" ? "Du: Hemma" : "";
    var b = h("button", { type: "button", class: "pn-out" + (all.length ? "" : " pn-none"), "data-pnout": "1", "aria-label": t + ". " + s + ". Ikväll?" }, [
      h("span", { class: "pn-out-dot", "aria-hidden": "true" }),
      h("span", { class: "pn-out-t" }, [h("b", { text: t }), h("small", { text: me ? s + " · " + me : s })]),
      all.length ? faces : null,
      h("span", { html: ic("chev-right") })
    ]);
    b.addEventListener("click", function () { try { W("PNUI").openIkvall(); } catch (e) {} });
    return b;
  }
  function paintOut(body) {
    body = body || $("sheet-body");
    var pane = body && body.querySelector("#inv-pane-g"); if (!pane) return;
    var old = pane.querySelector(":scope > .pn-out"), nb = outCard();
    if (old) { if (old.textContent !== nb.textContent) old.replaceWith(nb); }
    else pane.insertBefore(nb, pane.firstChild);
    // the card says who is out: the "Mina grupper · N vänner dricker nu" heading does not repeat it
    var hh = pane.querySelector(":scope > h3"), tn = hh && [].filter.call(hh.childNodes, function (c) { return c.nodeType === 3 && / · \d+ vänner dricker nu/.test(c.nodeValue); })[0];
    if (tn) tn.nodeValue = tn.nodeValue.replace(/ · \d+ vänner dricker nu/, "");
  }

  /* ---------- 5. Inställningar ---------- */
  function txt(n) { return (n && n.textContent || "").replace(/\s+/g, " ").trim(); }
  function tidySettings(body) {
    body = body || $("sheet-body");
    if (!body || !body.classList.contains("ds-set")) return;
    var items = [].slice.call(body.querySelectorAll(":scope > section.ds-section .ds-item"));
    // a) exact duplicates (a module that adds its rows twice): the later copy hides
    var seen = {};
    items.forEach(function (it) {
      if (it.classList.contains("pn-gone")) return;
      var k = txt(it).toLowerCase(); if (k.length < 4) return;
      if (seen[k] && seen[k] !== it) it.classList.add("pn-gone", "pn-dup"); else seen[k] = it;
    });
    // b) Trygghet → Integritet & säkerhet, as rows, before "Radera mitt konto"
    var sf = body.querySelector(".sf-set"), integ = body.querySelector(':scope > section.ds-section[data-ds="integ"] .ds-list');
    if (sf && integ) {
      var it = sf.closest(".ds-item");
      if (it && it.parentNode !== integ) { var dz = integ.querySelector(":scope > .ds-danger"); integ.insertBefore(it, dz || null); }
    }
    // c) the notification types fold behind one row
    var pp = body.querySelector(".push-prefs"), pit = pp && pp.closest(".ds-item");
    if (pit && !pit.classList.contains("pn-fold")) {
      pit.classList.add("pn-fold");
      pp.querySelectorAll(":scope > h3").forEach(function (x, i) { if (i > 0) x.classList.add("pn-sub"); });
      var row = h("button", { type: "button", class: "pn-fold-row", "aria-expanded": "false" }, [h("span", { html: ic("bell", "pi-lead") }), h("span", { text: "Välj notiser" }), h("small", { class: "pn-fold-n" }), h("span", { html: ic("chev-right") })]);
      var undo = null;
      var set = function (open) {
        pit.classList.toggle("pn-open", open); row.setAttribute("aria-expanded", String(open));
        row.lastChild.innerHTML = ic(open ? "chev-down" : "chev-right");
      };
      row.addEventListener("click", function () {
        var open = !pit.classList.contains("pn-open"); set(open);
        var sn = W("SHEETNAV");
        if (open && sn && sn.sub) undo = sn.sub(function () { set(false); });
        else if (!open && undo) { var u = undo; undo = null; try { u(); } catch (e) {} }
        if (open) setTimeout(function () { try { row.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (e) {} }, 30);
      });
      pit.insertBefore(row, pit.firstChild);
    }
    if (pp) {
      var sw = pp.querySelectorAll(":scope > .toggle-row .switch"), on = [].filter.call(sw, function (s) { return s.getAttribute("aria-checked") === "true"; }).length;
      var n = body.querySelector(".pn-fold-n"); if (n && sw.length) n.textContent = on + " av " + sw.length + " på";
    }
    // d) a section with nothing visible left hides
    body.querySelectorAll(":scope > section.ds-section").forEach(function (sec) {
      var vis = [].filter.call(sec.querySelectorAll(".ds-list > .ds-item"), function (i) { return !i.classList.contains("pn-gone") && i.getClientRects().length; });
      if (!vis.length && sec.querySelector(".ds-list > .ds-item")) sec.classList.add("pn-gone");
    });
  }
  document.addEventListener("click", function (e) {
    var hnt = e.target && e.target.closest && e.target.closest("#sheet-body.ds-set .ds-item-hint");
    if (hnt && !e.target.closest("a, button")) hnt.classList.toggle("pn-full");
  });
  function settingsSheet(body) {
    [150, 600, 1500].forEach(function (ms) { setTimeout(function () { if (body && body.isConnected) { tidySettings(body); iconize(body); } }, ms); });
  }

  /* ---------- 6. never an empty sheet ---------- */
  // Same as app.js forceUpdate (Inställningar → Uppdatera nu): drop the app caches (not olnu-pending), ask the service
  // worker for the newest sw.js, reload with a fresh URL. Push stays on (the worker is not unregistered).
  function hardUpdate() {
    var jobs = [];
    try { if (window.caches && caches.keys) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf("olnu-") === 0 && k !== "olnu-pending"; }).map(function (k) { return caches.delete(k); })); })); } catch (e) {}
    try { if ("serviceWorker" in navigator) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.update().catch(function () {}); })); })); } catch (e) {}
    Promise.all(jobs).catch(function () {}).then(function () { location.replace(location.pathname + "?v=" + Date.now() + location.hash); });
  }
  function sheetFail(body, title) {
    body = body || $("sheet-body"); if (!body) return;
    body.innerHTML = "";
    body.appendChild(h("div", { class: "pn-fail", role: "alert" }, [
      h("p", { text: "Det här gick int' att öppna just nu." }),
      h("p", { class: "muted", text: "Uppdatera appen och försök igen." }),
      h("button", { type: "button", class: "btn btn-amber", text: "Uppdatera appen", onclick: hardUpdate })
    ]));
    try { if (W("VITALS") && W("VITALS").note) W("VITALS").note("sheet_empty", String(title || "").slice(0, 40)); } catch (e) {}
  }
  function watchEmpty() {
    var s = $("sheet"); if (!s || !window.MutationObserver) return;
    new MutationObserver(function () {
      if (s.hidden) return;
      setTimeout(function () {
        var b = $("sheet-body"), t = $("sheet-title");
        if (!s.hidden && b && !b.children.length && !txt(b) && t && txt(t)) sheetFail(b, txt(t));
      }, 400);
    }).observe(s, { attributes: true, attributeFilter: ["hidden"] });
  }

  window.PNDS = {
    init: function (api) {
      A = api;
      document.documentElement.classList.add("pnds");
      hookClose(); watchIcons(); watchLive(); watchPrec(); beerName(); watchOverlaysGone(); watchEmpty(); fixChrome();
      setTimeout(fixChrome, 600);
    },
    onPoll: function () { fixChrome(); var t = $("sheet-title"); if (sheetOpen() && t && /^Grupper$/.test(txt(t))) paintOut(); },
    groupsSheet: function (body) { [60, 700].forEach(function (ms) { setTimeout(function () { if (body && body.isConnected) paintOut(body); }, ms); }); },
    settingsSheet: settingsSheet,
    profileSheet: function (body) { [150, 900].forEach(function (ms) { setTimeout(function () { if (body && body.isConnected) iconize(body); }, ms); }); },
    sheetFail: sheetFail, iconize: iconize, outCard: outCard, _ret: function () { return ret; }, _A: function () { return A; }   // _A: tests only
  };
})();
/* ds05 layout START — main screen geometry: --pn-r2 (bottom of row 2: ticker / kaos / call-out), --pn-ban (install
   banner height + gap), KAOS inside the ticker, the right rail, the care chip says what to do. Styles: pnds.css ds05 block. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function vis(e) { if (!e || e.hidden || !e.getClientRects().length) return false; var s = getComputedStyle(e); return s.display !== "none" && s.visibility !== "hidden"; }
  var root = document.documentElement, busy = false;
  function place() {
    if (busy) return; busy = true;
    try {
      var r2 = 0;
      [$("rally"), document.querySelector(".ticker")].forEach(function (e) { if (vis(e)) r2 = Math.max(r2, e.getBoundingClientRect().bottom); });
      if (r2) { var v = Math.round(r2) + "px"; if (root.style.getPropertyValue("--pn-r2") !== v) root.style.setProperty("--pn-r2", v); }
      var b = $("install-banner"), ban = vis(b) ? Math.round(b.getBoundingClientRect().height) + 8 + "px" : "0px";
      if (root.style.getPropertyValue("--pn-ban") !== ban) root.style.setProperty("--pn-ban", ban);
      var pr = $("prec-seg");   // locate: right side, 12 px above the dock's right box (owner: thumb reach)
      if (vis(pr)) { var lb = Math.round(innerHeight - pr.getBoundingClientRect().top + 12) + "px"; if (root.style.getPropertyValue("--pn-loc-b") !== lb) root.style.setProperty("--pn-loc-b", lb); }
      document.querySelectorAll(".hx-chip.af-chip-med").forEach(function (c) {
        var t = [].filter.call(c.childNodes, function (n) { return n.nodeType === 3 && n.nodeValue.trim(); }).pop();
        if (t && !/^\s*Kolla till /.test(t.nodeValue)) t.nodeValue = "Kolla till " + t.nodeValue.replace(/^\s*🚑\s*/, "").trim();
      });
    } catch (e) {}
    busy = false;
  }
  // KAOS inside the LIVE ticker (owner E): app.js still runs #chaos (hidden by CSS); the ticker shows it
  function kaos() {
    var c = $("chaos"), tk = document.querySelector(".ticker"); if (!c || !tk) return;
    var on = !c.hidden, ln = tk.querySelector(".pn-kaos-line");
    if (on && !ln) {
      ln = document.createElement("button"); ln.type = "button"; ln.className = "pn-kaos-line";
      ln.innerHTML = "<span></span><b>Visa</b>";
      ln.addEventListener("click", function () { var s = $("chaos-show"); if (s) s.click(); });
      var x = document.createElement("button"); x.type = "button"; x.className = "pn-kaos-x"; x.setAttribute("aria-label", "Dölj kaos-larmet");
      x.innerHTML = window.PNI ? window.PNI.svg("x") : "✕";
      x.addEventListener("click", function () { var s = $("chaos-close"); if (s) s.click(); });
      tk.appendChild(ln); tk.appendChild(x);
    }
    if (ln) {
      var hd = ($("chaos-head") || {}).textContent || "", fc = ($("chaos-facts") || {}).textContent || "";
      var txt = (hd + (fc ? " · " + fc : "")).trim();
      if (ln.firstChild.textContent !== txt) ln.firstChild.textContent = txt;
      ln.setAttribute("aria-label", "Kaos: " + txt + ". Visa");
      var lv = tk.querySelector(".tk-live"); if (lv) root.style.setProperty("--pn-kaos-l", Math.round(lv.getBoundingClientRect().width) + "px");
    }
    tk.classList.toggle("pn-kaos", on);
  }
  // the right rail (owner B): Spökläge (privacy, one tap) · Event · ⋯ Mer. Usage data (client_vitals sheet opens, 2026-11-07):
  // Event 10 reports, Taxi sheet 3, Mer 1; heat / ghost-pin / spökläge toggles are not logged → owner default order.
  function railBtn(id, icon, label, fn) {
    var b = $(id); if (b) return b;
    b = document.createElement("button"); b.type = "button"; b.id = id; b.className = "pn-rail"; b.setAttribute("aria-label", label); b.title = label;
    b.innerHTML = (window.PNI ? window.PNI.svg(icon) : "") + '<i class="pn-rail-dot" hidden></i>';
    b.addEventListener("click", fn);
    var more = $("btn-more"); (more && more.parentNode ? more.parentNode : document.body).insertBefore(b, more || null);
    return b;
  }
  function ghostOn() { try { return localStorage.getItem("olnu.ghostMode") === "1"; } catch (e) { return false; } }
  function rail() {
    if (!$("btn-more")) return;
    var g = railBtn("pn-ghost", "eye-off", "Spökläge", function () {
      var on = !ghostOn();
      try { localStorage.setItem("olnu.ghostMode", on ? "1" : "0"); } catch (e) {}
      var A = window.PNDS && window.PNDS._A && window.PNDS._A();
      try { if (A && A.updateCounts) A.updateCounts(); } catch (e) {}
      try { if (A && A.toast) A.toast(on ? "Spökläge på: ölen räknas, men du syns int' på kartan." : "Spökläge av: du syns på kartan igen.", { ms: 3500 }); } catch (e) {}
      paintRail();
    });
    var ev = $("btn-evs");
    if (ev) railBtn("pn-evs", "calendar", "Event ikväll", function () { var e = $("btn-evs"); if (e) e.click(); });
    paintRail();
  }
  function paintRail() {
    var g = $("pn-ghost");
    if (g && !g.hasAttribute("data-vis")) { var on = ghostOn(); g.setAttribute("aria-pressed", String(on)); g.title = on ? "Spökläge på (du syns int')" : "Spökläge av"; g.setAttribute("aria-label", g.title); }
    var e = $("pn-evs"), b = document.querySelector("#btn-evs .evs-badge");
    if (e) { var d = e.querySelector(".pn-rail-dot"); if (d) d.hidden = !(b && !b.hidden && (b.textContent || "0") !== "0"); }
  }
  var t = 0;
  function soon() { clearTimeout(t); t = setTimeout(function () { kaos(); rail(); place(); }, 30); }
  function start() {
    kaos(); rail(); place();
    window.addEventListener("resize", soon);
    if (window.ResizeObserver) { var ro = new ResizeObserver(soon); [".ticker", "#chaos", "#rally", "#install-banner", ".dock", "#btn-groups"].forEach(function (s) { var e = document.querySelector(s); if (e) ro.observe(e); }); }
    if (window.MutationObserver) {
      var mo = new MutationObserver(soon);
      ["chaos", "rally", "install-banner", "hud-x"].forEach(function (id) { var e = $(id); if (e) mo.observe(e, { attributes: true, attributeFilter: ["hidden", "class"], childList: true, characterData: true, subtree: id === "hud-x" || id === "chaos" }); });
      mo.observe(document.body, { childList: true });   // #btn-evs arrives later (evsheet.js)
    }
    setInterval(function () { kaos(); rail(); place(); }, 2000);   // cheap safety net (layout reads only, writes only on change)
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
/* ds05 layout END */
/* ds05b dock START — ANNAT beside ÖL! (8 px outside the ring, up-left or up-right, never overlapping, ≥ 8 px clear of the side box), --pn-dock-b for the map credits. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  var root = document.documentElement;
  function place() {
    try {
      var bw = document.querySelector(".beer-wrap"), ow = document.querySelector(".beer-wrap>.other-wrap"), row = document.querySelector(".dock-row");
      if (row) { var r = row.getBoundingClientRect(); if (r.height) { var v = Math.round(innerHeight - r.top) + "px"; if (root.style.getPropertyValue("--pn-dock-b") !== v) root.style.setProperty("--pn-dock-b", v); } }
      if (!bw || !ow) return;
      var b = bw.getBoundingClientRect(); if (!b.width) return;
      // side: +1 = up-right, -1 = up-left (--pn-annat-side, ds05c). The angle starts at 50° and rises until the button is
      // ≥ 8 px clear of the side box on that side (Grupper / precision), so it reads as a pair with ÖL!.
      var side = parseFloat(getComputedStyle(root).getPropertyValue("--pn-annat-side")) || 1;
      var ring = b.width / 2, me = (ow.offsetWidth || 52) / 2, d = ring + 8 + me;
      var box = side < 0 ? $("btn-groups") : $("prec-seg"), br = box && box.getClientRects().length ? box.getBoundingClientRect() : null;
      var cx, cy, deg;
      for (deg = 50; deg <= 88; deg++) {
        var a = deg * Math.PI / 180; cx = b.width / 2 + side * d * Math.cos(a); cy = b.height / 2 - d * Math.sin(a);
        if (!br) break;
        var px = b.left + cx, py = b.top + cy, nx = Math.max(br.left, Math.min(px, br.right)), ny = Math.max(br.top, Math.min(py, br.bottom));
        if (Math.hypot(px - nx, py - ny) - me >= 8) break;
      }
      var L = Math.round(cx - me) + "px", T = Math.round(cy - me) + "px";
      if (ow.style.left !== L) ow.style.setProperty("left", L, "important");
      if (ow.style.top !== T) ow.style.setProperty("top", T, "important");
      // map credits (wordmark + ⓘ, bottom-left): when ANNAT is on that side and in their row, the unit sits 8 px above ANNAT
      var lg = document.querySelector(".bm-mblogo"), logo = lg && !lg.hidden && lg.getClientRects().length;
      var unitR = (logo ? 12 + 65 + 2 + 44 : 4 + 44) + 8, owL = b.left + cx - me, owT = b.top + cy - me;
      var dockB = row ? Math.round(innerHeight - row.getBoundingClientRect().top) + 12 : 0;
      var credB = owL < unitR ? Math.max(dockB, Math.round(innerHeight - owT) + 8) : dockB;
      var cv = credB + "px"; if (credB && root.style.getPropertyValue("--pn-cred-b") !== cv) root.style.setProperty("--pn-cred-b", cv);
    } catch (e) {}
  }
  function start() {
    place();
    window.addEventListener("resize", function () { setTimeout(place, 30); });
    if (window.ResizeObserver) { var ro = new ResizeObserver(function () { place(); }); [".dock", ".beer-wrap"].forEach(function (s) { var e = document.querySelector(s); if (e) ro.observe(e); }); }
    var mt = 0;   // the Mapbox wordmark arrives / hides later (basemap.js): place again at once
    if (window.MutationObserver) new MutationObserver(function () { clearTimeout(mt); mt = setTimeout(place, 40); }).observe(document.body, { childList: true });
    setInterval(place, 2500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
/* ds05b dock END */
/* ds06 sheets START — one amber primary per sheet (the first visible one stays; the others look secondary); emoji out of chrome labels. */
(function () {
  "use strict";
  function one() {
    var b = document.getElementById("sheet-body"), s = document.getElementById("sheet");
    if (!b || !s || s.hidden) return;
    var am = [].filter.call(b.querySelectorAll(".btn-amber:not(.pn-demote), .ds-btn-primary:not(.pn-demote)"), function (x) { return x.getClientRects().length; });
    am.slice(1).forEach(function (x) { x.classList.add("pn-demote"); });
  }
  // emoji inside chrome labels (not only leading): headings, buttons, summaries, tab labels lose them (pnds iconize does the
  // leading one; this does the rest). Fun copy / chat / game art keep theirs (same KEEP list as pnds iconize).
  var EMO = /(?:\p{Extended_Pictographic}(?:\uFE0F|\u20E3|[\u{1F3FB}-\u{1F3FF}]|\u200D\p{Extended_Pictographic}\uFE0F?)*)\s?/gu;
  var KEEP = ".chat-list, .gpg-msgs, .cm-body, .dm-list, .tk-track, .takeover, .mx-pop, .sp-cards, .kind-grid, .rx, .reactions, input, textarea, [contenteditable], .no-pi";
  function scrub(root) {
    if (!root) return;
    root.querySelectorAll("h2, h3, h4, button, summary, [role=button], .bm-b, .pp-sec-h, .gpg-now-s, .pn-gikv").forEach(function (el) {
      if (el.closest(KEEP)) return;
      var tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), c;
      while ((c = tw.nextNode())) {
        if (c.parentNode && c.parentNode.closest && c.parentNode.closest(KEEP + ", .pf-ribbons, .md-rib, svg")) continue;
        if (!EMO.test(c.nodeValue)) { EMO.lastIndex = 0; continue; }
        EMO.lastIndex = 0;
        var v = c.nodeValue.replace(EMO, "").replace(/\s{2,}/g, " ").replace(/·\s*·/g, "·");
        if (v.trim()) c.nodeValue = v;
      }
      EMO.lastIndex = 0;
    });
  }
  var t = 0;
  function soon() { clearTimeout(t); t = setTimeout(function () { one(); scrub(document.getElementById("sheet")); var p = document.querySelector(".leaflet-popup"); if (p) scrub(p); }, 120); }
  function start() {
    var b = document.getElementById("sheet"); if (!b || !window.MutationObserver) return;
    new MutationObserver(soon).observe(b, { childList: true, subtree: true, characterData: true });
    var pp = document.querySelector(".leaflet-popup-pane, #map"); if (pp) new MutationObserver(soon).observe(pp, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
/* ds06 sheets END */
/* ds07 bar START — Krogkortet (design review "Förslag: nytt krogkort"). app.js barPopup passes its finished HTML through
   PNDS.barSheet(html, bar, list). Order: header (title + "Pub · Öppet till 01:00") → hero (crowd meter + friends here) →
   other lines (events, call-outs) → ONE action row (Checka in amber + På väg ghost, equal width; checked in = Checka ut, På väg
   hidden) → photos 72 × 72 → Folk här → "Info" grouped list (hours/price, uteservering, sport, Kö och erbjudanden) → "Mer"
   (Bjud in hit, Incheckade, Stammis & kung, öppettider/pris reports, dansgolv, QR-affisch, fel plats, finns inte längre).
   Every module element is MOVED, never rebuilt: modules repaint their own element in place (outerHTML), so it stays put.
   Kept for tests / other code: .bs, .bs-head, .pp-title, .pp-act, .pp-folds, details.pp-fold[data-fold=here|bp|rally],
   all data-* hooks. New: .pn-bs7, .pn-bs-hero, .pn-bs-fr, .pn-bs-photos, .pn-bs-h, .pn-bs-info, details[data-fold=mer]. */
(function () {
  "use strict";
  var EMO = /(?:\p{Extended_Pictographic}(?:️|⃣|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*)\s?/gu;
  function noEmo(s) { return String(s || "").replace(EMO, "").replace(/\s{2,}/g, " ").trim(); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ico(n) { try { return window.PNI && window.PNI.has(n) ? window.PNI.svg(n) : ""; } catch (e) { return ""; } }
  function foldsOpen() { try { return JSON.parse(sessionStorage.getItem("olnu.folds") || "{}") || {}; } catch (e) { return {}; } }
  function mk(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function kid(p, sel) { if (!p) return null; for (var i = 0; i < p.children.length; i++) if (p.children[i].matches(sel)) return p.children[i]; return null; }
  function who(n) {
    if (n.length === 1) return n[0] + " är här";
    if (n.length === 2) return n[0] + " och " + n[1] + " är här";
    return n[0] + ", " + n[1] + " och " + (n.length - 2) + " till är här";
  }
  function bodyOf(d) { var b = d && kid(d, ".pf-body"); return b ? [].slice.call(b.childNodes) : []; }
  function sec(cls, title, nodes) {
    var s = mk("div", "pn-bs-sec " + cls, "<h4>" + esc(title) + "</h4>");
    nodes.forEach(function (n) { s.appendChild(n); });
    return s;
  }
  function barSheet(html, bar, list) {
    try {
      var t = document.createElement("template"); t.innerHTML = html;
      var bs = t.content.firstElementChild;
      if (!bs || !bs.classList.contains("bs") || bs.classList.contains("pn-bs7")) return html;
      bs.classList.add("pn-bs7");
      var kids = [].slice.call(bs.children), head = kid(bs, ".bs-head");
      // header: subtitle "Pub · Öppet till 01:00" (hours from OPPET, the same source as the info line)
      var meta = head && kid(head, ".bs-meta");
      if (meta && bar && window.OPPET && window.OPPET.barStatus) {
        try {
          var st = window.OPPET.barStatus(bar), lb = st && window.OPPET.label(st);
          if (lb && lb.t) { var oh = mk("span", "pn-bs-oh " + (lb.cls || "")); oh.textContent = noEmo(lb.t); meta.appendChild(document.createTextNode(" · ")); meta.appendChild(oh); }
        } catch (e) {}
      }
      // hero: crowd meter + friends here (+ the small king / queue marks)
      var hero = mk("div", "pn-bs-hero"), meter = kid(bs, ".pn-meter");
      if (meter) hero.appendChild(meter);
      var names = [];
      (list || []).forEach(function (b) { var n = b && b.friend_name ? String(b.friend_name).trim() : ""; if (n && names.indexOf(n) < 0) names.push(n); });
      if (names.length) {
        hero.appendChild(mk("div", "pn-bs-fr", '<span class="pn-bs-avs" aria-hidden="true">' +
          names.slice(0, 3).map(function (n) { return '<i class="pn-bs-av">' + esc(n.charAt(0).toUpperCase()) + "</i>"; }).join("") +
          '</span><span class="pn-bs-frt">' + esc(who(names)) + "</span>"));
      }
      var icons = head && kid(head, ".bs-icons");
      if (icons) hero.appendChild(icons);
      if (hero.children.length && head) head.after(hero);
      // lines: invite → Mer; hours/price, uteservering, sport → Info; photos → own row; the rest stays under the hero
      var info = mk("div", "pn-bs-info"), mer = [], photos = null, inv = null;
      kids.forEach(function (k) {
        if (!k.classList.contains("ev-line") && !k.classList.contains("sp-tag")) return;
        if (k.classList.contains("inv-line")) {
          if (k.classList.contains("solo")) inv = k;
          else { var b = k.querySelector(".inv-here"); if (b) { inv = mk("div", "ev-line inv-line solo pn-bs-inv"); inv.appendChild(b.cloneNode(true)); } }
          if (inv === k) k.remove();
          return;
        }
        if (k.matches(".bi-line, .ute-line, .sp-tag")) { info.appendChild(k); return; }
        if (k.classList.contains("bf-line")) { photos = k; k.remove(); }
      });
      var fd = function (key) { return bs.querySelector('details.pp-fold[data-fold="' + key + '"]'); };
      var fInfo = fd("info"), fCi = fd("ci"), fStam = fd("stam"), fBp = fd("bp");
      var merOpen = !!foldsOpen().mer || [fInfo, fCi, fStam].some(function (d) { return d && d.hasAttribute("open"); });
      var infoNodes = bodyOf(fInfo), pick = function (sel) { var out = []; infoNodes = infoNodes.filter(function (n) { if (n.nodeType === 1 && n.matches(sel)) { out.push(n); return false; } return true; }); return out; };
      pick(".sp-tag").forEach(function (n) { info.appendChild(n); });
      if (fBp) {
        var h = fBp.querySelector("summary .pp-sec-h");
        if (h) h.textContent = "Kö och erbjudanden";
        info.appendChild(fBp);
      }
      if (inv) mer.push(inv);
      if (fCi) { var n = fCi.querySelector(".pf-n"); mer.push(sec("pn-bs-ci", "Incheckade" + (n && n.textContent.trim() ? " · " + n.textContent.trim() : ""), bodyOf(fCi))); fCi.remove(); }
      if (fStam) { mer.push(sec("pn-bs-stam", "Stammis & kung", bodyOf(fStam))); fStam.remove(); }
      mer = mer.concat(pick(".bi-info"), pick(".cr-dance"), pick(".af-qr"), pick(".pp-info"), pick(".gone-sec"), infoNodes);
      if (fInfo) fInfo.remove();
      // photos right under the action row
      var act = kid(bs, ".pp-act");
      if (act) {
        act.classList.add("pn-bs-act");
        if (act.querySelector(".ci-out")) { act.classList.add("pn-bs-in"); var eta = act.querySelector(".pp-sec-eta"); if (eta) eta.classList.add("pn-bs-hide"); }
      }
      if (photos) { photos.classList.add("pn-bs-photos"); var at = act || (hero.parentNode ? hero : head); if (at) at.after(photos); else bs.prepend(photos); }
      // Folk här (+ call-outs) stay in .pp-folds; then "Info"; then "Mer" last
      var folds = kid(bs, ".pp-folds");
      if (!folds) { folds = mk("div", "pp-folds"); bs.appendChild(folds); }
      var tail = folds;
      if (info.children.length) {
        var ih = mk("h3", "pn-bs-h", "Info"); tail.after(ih); ih.after(info); tail = info;
      }
      if (mer.length) {
        var md = mk("details", "pp-fold pp-sec pp-sec-mer");
        md.setAttribute("data-fold", "mer"); if (merOpen) md.setAttribute("open", "");
        md.innerHTML = '<summary><span class="pp-sec-h">Mer</span><span class="pn-bs-sub">Stammis, bjud in, QR</span><span class="pf-chev" aria-hidden="true">›</span></summary>';
        var body = mk("div", "pf-body"); mer.forEach(function (x) { body.appendChild(x); }); md.appendChild(body);
        var wrap = mk("div", "pp-folds pn-bs-folds2"); wrap.appendChild(md); tail.after(wrap);
      }
      if (!folds.children.length) folds.remove();
      return bs.outerHTML;
    } catch (e) { return html; }
  }
  // Live tweaks after modules repaint their parts: sport vote buttons say Ja / Nej (+ count) instead of 👍 / 👎; the weather value
  // next to the sun icon loses its weather emoji (one sun, not two).
  function fix(root) {
    root.querySelectorAll(".pn-bs7 .ute-wx").forEach(function (w) { var v = noEmo(w.textContent); if (v && w.textContent !== v) w.textContent = v; });
    root.querySelectorAll(".pn-bs7 .sp-b[data-spvote]").forEach(function (b) {
      var c = (b.textContent.match(/\d+/) || [""])[0], want = (b.getAttribute("data-spvote") === "1" ? "Ja" : "Nej") + (c ? " " + c : "");
      if (b.textContent !== want) b.textContent = want;
    });
  }
  function onOpen(e) {
    var root = e.popup && e.popup.getElement && e.popup.getElement();
    if (!root || !root.querySelector(".pn-bs7")) return;
    root.classList.add("pn-bs7-root");
    var x = root.querySelector(".leaflet-popup-close-button");
    if (x && !x.querySelector("svg")) { x.innerHTML = ico("x") || "×"; x.setAttribute("aria-label", "Stäng"); x.setAttribute("title", "Stäng"); }
    fix(root);
    if (!root._pnBs7) {
      var tm = 0;
      root._pnBs7 = new MutationObserver(function () { clearTimeout(tm); tm = setTimeout(function () { fix(root); }, 30); });
      root._pnBs7.observe(root, { childList: true, subtree: true });
    }
  }
  function hook() {
    var m = window.__map; if (!m || !m.on) return false;
    if (!m._pnBs7) { m._pnBs7 = true; m.on("popupopen", onOpen); }
    return true;
  }
  if (!hook()) { var iv = setInterval(function () { if (hook()) clearInterval(iv); }, 400); }
  window.PNDS = window.PNDS || {};
  window.PNDS.barSheet = barSheet;
})();
/* ds07 bar END */
/* ds08 screens START — Inställningar: on/off rows become switches ("Överraskningar på kartan: På" → label + switch), "Radera
   mitt konto" in its own group last, every row in a list gets an icon. Gruppens sida: characters → our icons (⋯ dots, ➤ send,
   ＋ plus). All idempotent; runs after each repaint of #sheet (no element is renamed or rebuilt: hooks stay). */
(function () {
  "use strict";
  function ico(n) { try { return window.PNI && window.PNI.has(n) ? window.PNI.svg(n) : ""; } catch (e) { return ""; } }
  var ONOFF = /^\s*(.+?):\s*(På|Av)\s*$/;
  function settings(b) {
    if (!b.classList.contains("ds-set")) return;
    // a) "Label: På / Av" buttons → label + switch (the button still does the toggle; delight.js rewrites its text → redone)
    b.querySelectorAll(".ds-item button.btn").forEach(function (x) {
      if (x.querySelector(".pn-sw-l")) {
        var lab = x.querySelector(".pn-sw-l"), sw = x.querySelector(".switch");
        if (sw && x.getAttribute("aria-checked") !== sw.getAttribute("aria-checked")) sw.setAttribute("aria-checked", x.getAttribute("aria-checked"));
        return lab;
      }
      var m = (x.textContent || "").match(ONOFF); if (!m) return;
      var on = m[2] === "På", svg = x.querySelector("svg");
      x.textContent = "";
      if (svg) x.appendChild(svg);
      var l = document.createElement("span"); l.className = "pn-sw-l"; l.textContent = m[1].trim(); x.appendChild(l);
      var s = document.createElement("span"); s.className = "switch"; s.setAttribute("aria-hidden", "true"); s.setAttribute("aria-checked", String(on)); x.appendChild(s);
      x.classList.add("pn-swb"); x.setAttribute("role", "switch"); x.setAttribute("aria-checked", String(on));
    });
    // b) danger in its own group, last
    var dz = b.querySelector(":scope > section.ds-section .ds-item.ds-danger");
    if (dz) {
      var sec = b.querySelector(":scope > section.pn-danger-sec");
      if (!sec) { sec = document.createElement("section"); sec.className = "ds-section pn-danger-sec"; var l2 = document.createElement("div"); l2.className = "ds-list"; sec.appendChild(l2); }
      if (dz.parentNode !== sec.firstChild) sec.firstChild.appendChild(dz);
      if (sec.parentNode !== b || b.lastElementChild !== sec) b.appendChild(sec);
    }
    // c) icon on every row: rows without one get a fitting icon
    var MAP = [[/^Ljud/, "speaker"], [/^Visa introduktionen/, "help"], [/^Uppdatera/, "refresh"]];
    b.querySelectorAll(".ds-item .toggle-row > span:first-child, .ds-item > .row > button.btn").forEach(function (x) {
      if (x.querySelector("svg") || x.closest(".push-prefs")) return;
      var t = (x.textContent || "").trim();
      for (var i = 0; i < MAP.length; i++) if (MAP[i][0].test(t)) { var s = ico(MAP[i][1]); if (s) x.insertAdjacentHTML("afterbegin", s.replace("<svg ", '<svg data-pn8="1" ')); break; }
    });
  }
  function gpage(b) {
    var d = b.querySelector(".gpg-dots"); if (d && !d.querySelector("svg")) { var s1 = ico("dots"); if (s1) d.innerHTML = s1; }
    var sd = b.querySelector(".gpg-send"); if (sd && !sd.querySelector("svg") && /➤/.test(sd.textContent)) { var s2 = ico("send"); if (s2) sd.innerHTML = s2; }
    var p = b.querySelector(".gpg-plus"); if (p && !p.querySelector("svg")) { var s3 = ico("plus"); if (s3) p.innerHTML = s3; }
  }
  function run() {
    var b = document.getElementById("sheet-body"); if (!b) return;
    try { settings(b); } catch (e) {}
    try { gpage(b); } catch (e) {}
  }
  var t = 0, busy = false;
  function soon() { if (busy) return; clearTimeout(t); t = setTimeout(function () { busy = true; run(); setTimeout(function () { busy = false; }, 0); }, 60); }
  function start() {
    var s = document.getElementById("sheet"); if (!s) return;
    new MutationObserver(soon).observe(s, { childList: true, subtree: true, characterData: true });
    soon();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
/* ds08 screens END */
/* ds10 motion START — (1) endless loops stop after 3 cycles (spinners / loading skeletons excepted), on every element incl. map
   pins, without touching their code (Web Animations API); (2) ÖL! squash + spring + foam + count ticks up; (3) sub-screens slide
   on the X axis; (4) tab / segment marker slides, new pane fades through; (5) DOM people pins pop in once; (6) bar sheet slides
   down on close; (7) toast leaves in 150 ms; (8) LIVE ticker: tap = stop / go. Reduced motion: none of it. */
(function () {
  "use strict";
  var W = window;
  function reduced() { try { return !!(W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  /* 1. loops: 3 cycles, then still */
  var LOOP_OK = /spin|load|skel|shim|busy|wait|breath|rot|smBreath/i;
  function stopLoops() {
    if (!document.getAnimations || document.hidden) return;
    try {
      document.getAnimations().forEach(function (a) {
        var ef = a.effect; if (!ef || !ef.getTiming) return;
        var t = ef.getTiming(); if (t.iterations !== Infinity) return;
        var name = a.animationName || "", tg = ef.target;
        if (LOOP_OK.test(name) || (tg && tg.closest && tg.closest(".busy, [aria-busy=true], .sm-skel, .spinner"))) return;
        ef.updateTiming({ iterations: 3 });
      });
    } catch (e) {}
  }
  setInterval(stopLoops, 1500);
  document.addEventListener("visibilitychange", stopLoops);
  /* 2. ÖL! press */
  function foam(btn) {
    if (reduced()) return;
    var r = btn.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height * 0.3;
    for (var i = 0; i < 7; i++) {
      var f = document.createElement("i"), a = -Math.PI / 2 + (i - 3) * 0.38, d = 46 + (i % 3) * 14;
      f.className = "pn-foam"; f.setAttribute("aria-hidden", "true");
      f.style.left = cx + "px"; f.style.top = cy + "px";
      f.style.setProperty("--dx", Math.round(Math.cos(a) * d) + "px"); f.style.setProperty("--dy", Math.round(Math.sin(a) * d) + "px");
      document.body.appendChild(f);
      setTimeout(function (x) { return function () { x.remove(); }; }(f), 460);
    }
  }
  function beer() {
    var b = document.getElementById("btn-beer"); if (!b || b._pn10) return; b._pn10 = true;
    b.addEventListener("pointerdown", function () { if (reduced() || b.disabled) return; b.classList.remove("pn-spring"); b.classList.add("pn-squash"); });
    var up = function () { if (!b.classList.contains("pn-squash")) return; b.classList.remove("pn-squash"); b.classList.add("pn-spring"); setTimeout(function () { b.classList.remove("pn-spring"); }, 320); };
    b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("pointerleave", up);
    b.addEventListener("click", function () { if (!b.disabled) foam(b); });
  }
  /* count ticks up: any number node in .pn-tick-n / the HUD out-count, when it grows */
  function tickNum(el, from, to) {
    if (reduced() || !(to > from) || to - from > 500) return;
    var t0 = 0, dur = 300;
    el._pnTick = true;
    function f(ts) { if (!t0) t0 = ts; var k = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = String(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(f); else el._pnTick = false; }
    requestAnimationFrame(f);
  }
  function watchCounts() {
    document.querySelectorAll("#hud-count b, #hud-n, .hud-ute b, .ute-n, .pn-tick-n").forEach(function (el) {
      if (el._pn10) return; el._pn10 = true; var last = parseInt(el.textContent, 10);
      new MutationObserver(function () {
        if (el._pnTick) return;
        var v = parseInt(el.textContent, 10);
        if (isFinite(v) && isFinite(last) && v > last) tickNum(el, last, v);
        last = v;
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });
  }
  /* 3. sub-screens: shared axis X */
  function axis() {
    var s = document.getElementById("sheet"), b = document.getElementById("sheet-body"); if (!s || !b || s._pn10) return; s._pn10 = true;
    var back = s.classList.contains("pn-has-back"), title = (document.getElementById("sheet-title") || {}).textContent;
    new MutationObserver(function () {
      var nb = s.classList.contains("pn-has-back"), nt = (document.getElementById("sheet-title") || {}).textContent;
      if (s.hidden) { back = nb; title = nt; return; }
      if ((nt !== title || nb !== back) && !reduced() && !(b._pnAx && b._pnAx.playState === "running")) {
        // Web Animation (other code resets #sheet-body's class list while it opens a page); while warm.js holds the body
        // invisible (.wm-hold) only the slide runs, so its one fade-in stays in charge of opacity.
        var dir = nb && !back ? 1 : !nb && back ? -1 : nb && back && nt !== title ? 1 : 0;
        if (dir && b.animate) {
          b.classList.remove("sm-swap");   // ds18: one animation per element (smooth.js content fade off)
          var hold = b.classList.contains("wm-hold"), x = (24 * dir) + "px";
          b._pnAx = b.animate(hold ? [{ transform: "translateX(" + x + ")" }, { transform: "none" }] : [{ transform: "translateX(" + x + ")", opacity: 0 }, { transform: "none", opacity: 1 }],
            { duration: 300, easing: "cubic-bezier(.05,.7,.1,1)" });
          b._pnAx.id = dir > 0 ? "pn-ax-in" : "pn-ax-back";
        }
      }
      back = nb; title = nt;
    }).observe(s, { attributes: true, attributeFilter: ["class", "hidden"], subtree: true, childList: true, characterData: true });
  }
  /* 4. segmented control: marker slides from the old item to the new one; the pane below fades through.
     ds18: the marker finds the bar again after the tap (Grupper rebuilds its tabs), scales instead of animating width. */
  var SEG = ".tabs, .seg, .bp-seg, .tt-bar, .np-tabs, .np-seg, .pk-seg, .pn-ikv-seg, .pf-tabs, .inv-tabs, .gg-tabs, .gm-tabs, .gm-seg, .cr-tabs, .sp-seg, .bm-seg";
  document.addEventListener("pointerdown", function (e) {
    if (reduced()) return;
    var it = e.target.closest && e.target.closest("button, [role=tab]"), bar = it && it.parentElement && it.parentElement.closest(SEG);
    if (!bar || it.parentElement !== bar) return;
    var old = bar.querySelector(':scope > [aria-selected="true"], :scope > .on, :scope > .active, :scope > [aria-pressed="true"], :scope > [aria-checked="true"]');
    if (!old || old === it) return;
    var o = old.getBoundingClientRect(), idx = [].indexOf.call(bar.children, it), cls = "." + bar.className.trim().split(/\s+/).join(".");
    var go = function () {
      var b2 = bar.isConnected ? bar : document.querySelector("#sheet " + cls); if (!b2) return;
      var n2 = b2.children[idx]; if (!n2 || !n2.getClientRects().length) return;
      var br = b2.getBoundingClientRect(), n = n2.getBoundingClientRect();
      var m = document.createElement("i"); m.className = "pn-seg-mark"; m.setAttribute("aria-hidden", "true");
      if (getComputedStyle(b2).position === "static") b2.style.position = "relative";
      m.style.cssText = "left:0;top:" + (n.top - br.top) + "px;height:" + n.height + "px;width:" + n.width + "px;transform-origin:0 0;transform:translateX(" + (o.left - br.left + b2.scrollLeft) + "px) scaleX(" + (o.width / Math.max(1, n.width)).toFixed(3) + ")";
      b2.insertBefore(m, b2.firstChild); b2.classList.add("pn-seg-anim");
      requestAnimationFrame(function () { requestAnimationFrame(function () { m.style.transform = "translateX(" + (n.left - br.left + b2.scrollLeft) + "px)"; }); });
      setTimeout(function () { m.remove(); b2.classList.remove("pn-seg-anim"); }, 260);
      if (b2.closest("#sheet")) { var p = b2.nextElementSibling; if (p) { p.classList.remove("pn-ft"); void p.offsetWidth; p.classList.add("pn-ft"); setTimeout(function () { p.classList.remove("pn-ft"); }, 320); } }
    };
    var once = function () { document.removeEventListener("click", once, true); setTimeout(go, 0); };
    document.addEventListener("click", once, true);
    setTimeout(function () { document.removeEventListener("click", once, true); }, 1500);
  }, true);
  /* 5. people pins pop in once per person position (re-renders of the same pin do not pop) */
  var seenPin = {};
  function pinKey(p) { var mk = p.closest(".leaflet-marker-icon, .mapboxgl-marker, .bm-mk") || p.parentElement; return (p.className.replace(/\bpn-pop\b/, "") + "|" + (p.textContent || "")).slice(0, 80) + "|" + (mk && mk.getAttribute("data-k") || ""); }
  function pins(nodes) {
    if (reduced()) return;
    nodes.forEach(function (n) {
      if (n.nodeType !== 1) return;
      var list = n.classList && n.classList.contains("pn-p") ? [n] : n.querySelectorAll ? [].slice.call(n.querySelectorAll(".pn-p")) : [];
      list.forEach(function (p) { var k = pinKey(p); if (seenPin[k]) return; seenPin[k] = 1; p.classList.add("pn-pop"); setTimeout(function () { p.classList.remove("pn-pop"); }, 360); });
    });
  }
  /* 6. bar sheet: a copy slides down when it closes */
  function barOpen(e) {
    var r = e.popup && e.popup.getElement && e.popup.getElement(); if (!r || !r.classList.contains("olnu-sheet")) return;
    var w = r.querySelector(".leaflet-popup-content-wrapper"), c = r.querySelector(".leaflet-popup-content");
    if (!w || !c) return;
    var ws = getComputedStyle(w), cs = getComputedStyle(c);
    r._pnGhost = { w: "background:" + ws.background + ";border-radius:" + ws.borderRadius + ";border-top:" + ws.borderTop + ";padding-bottom:" + ws.paddingBottom,
      c: "margin:" + cs.margin + ";padding-bottom:" + cs.paddingBottom + ";max-height:" + cs.maxHeight + ";overflow:hidden", top: c.scrollTop };
  }
  function ghost(r) {
    if (reduced() || !r._pnGhost || !r.querySelector(".bs")) return;
    var g = r.cloneNode(true);
    g.className = "pn-bs-ghost"; g.removeAttribute("id"); g.setAttribute("aria-hidden", "true");
    try { g.inert = true; } catch (e) {}
    g.querySelectorAll("[id]").forEach(function (x) { x.removeAttribute("id"); });
    var w = g.querySelector(".leaflet-popup-content-wrapper"), c = g.querySelector(".leaflet-popup-content");
    if (w) { w.className = ""; w.style.cssText = r._pnGhost.w; }
    if (c) { c.className = ""; c.style.cssText = r._pnGhost.c; }
    g.querySelectorAll(".leaflet-popup-close-button, .leaflet-popup-tip-container").forEach(function (x) { x.remove(); });
    document.body.appendChild(g);
    if (c) c.scrollTop = r._pnGhost.top;
    setTimeout(function () { g.remove(); }, 260);
  }
  /* 7. toast out: when a toast is removed / hidden, a copy fades down in 150 ms */
  function toastOut(t) {
    if (reduced() || !t.classList || !t.classList.contains("toast") || !t.textContent) return;
    var r = t.getBoundingClientRect && t._pnRect; if (!r) return;
    var g = t.cloneNode(true); g.removeAttribute("id"); g.classList.add("pn-out"); g.setAttribute("aria-hidden", "true");
    g.style.cssText += ";position:fixed;left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;margin:0;pointer-events:none";
    document.body.appendChild(g); setTimeout(function () { g.remove(); }, 200);
  }
  function noteToasts() { document.querySelectorAll(".toast").forEach(function (t) { try { var r = t.getBoundingClientRect(); if (r.width) t._pnRect = { left: r.left, top: r.top, width: r.width }; } catch (e) {} }); }
  /* 8. LIVE ticker: a short tap stops it (readable), the next tap starts it; hold-to-pause (pnui) still works */
  function ticker() {
    var tk = document.querySelector("#ticker, .ticker"); if (!tk || tk._pn10) return; tk._pn10 = true;
    var down = 0, stop = false;
    tk.addEventListener("pointerdown", function () { down = Date.now(); });
    tk.addEventListener("pointerup", function (e) {
      if (Date.now() - down > 300 || (e.target.closest && e.target.closest("a, button"))) return;
      stop = !stop; tk.classList.toggle("pn-tk-stop", stop); tk.setAttribute("aria-label", stop ? "Nyheter (stoppad, tryck för att fortsätta)" : "Nyheter (tryck för att stoppa)");
      var f = function () { if (stop) { W.PN_TICK_F = 0; requestAnimationFrame(f); } };
      if (stop) f(); else W.PN_TICK_F = 1;
    });
  }
  function start() {
    beer(); axis(); ticker(); watchCounts();
    if (W.MutationObserver) {
      var t = 0;
      new MutationObserver(function (ms) {
        var add = [];
        ms.forEach(function (m) {
          m.addedNodes.forEach(function (n) { add.push(n); });
          m.removedNodes.forEach(function (n) {
            if (n.nodeType !== 1) return;
            if (n.classList.contains("olnu-sheet")) ghost(n);
            if (n.classList.contains("toast")) toastOut(n);
          });
          if (m.type === "attributes" && m.target.classList && m.target.classList.contains("toast") && m.target.hidden) toastOut(m.target);
        });
        if (add.length) pins(add);
        clearTimeout(t); t = setTimeout(function () { noteToasts(); beer(); ticker(); watchCounts(); }, 200);
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    }
    var hook = function () { var m = W.__map; if (!m || !m.on) return false; if (!m._pn10) { m._pn10 = true; m.on("popupopen", barOpen); } return true; };
    if (!hook()) { var iv = setInterval(function () { if (hook()) clearInterval(iv); }, 500); }
    stopLoops();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
/* ds10 motion END */
/* ds11 banners START — the bottom banner column starts 8 px above the highest dock item (ANNAT moves with ds05b, the credits
   and locate can change), so a banner never covers ANNAT, locate or the Mapbox logo / (i). Sets --pn-ban-b on :root. */
(function () {
  "use strict";
  var SEL = "#other-wrap, .locate-btn, .bm-mblogo, #btn-attrib, .attrib-btn";
  function place() {
    var top = Infinity;
    document.querySelectorAll(SEL).forEach(function (e) {
      if (!e.getClientRects().length || e.closest("[hidden]")) return;
      var r = e.getBoundingClientRect(); if (r.height && r.top > innerHeight * 0.45) top = Math.min(top, r.top);
    });
    if (top === Infinity) return;
    var v = Math.round(innerHeight - top + 8) + "px";
    if (document.documentElement.style.getPropertyValue("--pn-ban-b") !== v) document.documentElement.style.setProperty("--pn-ban-b", v);
  }
  var t = 0;
  function soon() { clearTimeout(t); t = setTimeout(place, 80); }
  function start() {
    place();
    addEventListener("resize", soon); addEventListener("orientationchange", soon);
    if (window.MutationObserver) {
      var watch = function (id) { var e = document.getElementById(id); if (e) new MutationObserver(soon).observe(e, { attributes: true, attributeFilter: ["hidden", "style", "class"] }); };
      ["hf-banner", "sk-banner", "fm-banner", "other-wrap"].forEach(watch);
      new MutationObserver(function (ms) { for (var i = 0; i < ms.length; i++) for (var j = 0; j < ms[i].addedNodes.length; j++) { var n = ms[i].addedNodes[j]; if (n.nodeType === 1 && (n.id === "hf-banner" || n.id === "sk-banner" || n.id === "fm-banner")) { watch(n.id); soon(); } } })
        .observe(document.body, { childList: true });
      new MutationObserver(soon).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }
    setTimeout(place, 1500); setTimeout(place, 4000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
/* ds11 banners END */
/* ds12 icons START — emoji and characters used as UI icons → our icons (DESIGN "Emoji are not UI icons"), also outside
   #sheet: the party lobby, förfest, Truppen tabs, chat composer, intro, invite page, Bjud in fields, Följ mig hem list,
   map controls. Every emoji in these elements becomes a PNI icon, or goes when no icon fits (the word says it).
   Characters ✕ ⋯ i alone in a button become x / dots / info. Kept (art, not chrome): game cards, drink picker, chat,
   KAOS lines, medal ribbons, map pins. Idempotent; runs after every repaint (body observer, debounced). */
(function () {
  "use strict";
  var SEL = ["#btn-other .ol-e", "#install-close", "#btn-attrib > span",
    ".pt .pt-top button", ".pt h2", ".pt .pt-kick", ".pt button.pt-b", ".pt .pt-kx",
    ".ff .ff-x", ".ff .ff-pack b", ".ff .ff-pack small", ".sp .sp-seg > button", ".sp .sp-main", ".sp-card-m > span",
    "#intro .intro-privlink", "#intro .sf-age-l", ".jn-kick", ".jn-card button",
    ".af-mic", ".cr-tabs .cr-te", ".hf-nm", ".hf-people button", "#sheet-body label > span", "#sheet-body .inv-pk-main > small",
    "#sheet-body .np-ic", "#sheet-body .nr-frow .btn", "#sheet-body .rl-loc > span", ".gpg-dots", "#sheet-body .evs-detail button", "#sheet-body .cr button", "#sheet-body .cr summary",
    ".toast .btn", "#sheet-body .rnd-check > span"].join(",");
  var KEEP = ".chat-list, .gpg-msgs, .cm-body, .sp-card-ic, .ff-me, .kind-grid, .kb-e, .pn-kaos-line, .tk-track, .rb, .uni-ribbon, .pf-ribbons, .leaflet-marker-pane, .mapboxgl-marker, input, textarea";
  var EXTRA = { "🎙️": "mic", "🎙": "mic", "🎤": "mic", "🚌": "bus", "📼": "history", "🤔": "help", "🏟️": "trophy", "🏟": "trophy", "👀": "eye", "📡": "locate",
    "🗓️": "calendar", "👋": "hand", "🔆": "sun", "🚑": "sos", "🥳": "sparkle", "😎": "user", "🎂": "", "⚖️": "", "📏": "", "🥾": "", "🥃": "mixed" };
  var DOTS = { "🟢": "on", "🔴": "red", "🟡": "amber", "⚪": "off", "⚫": "off" };
  var CHR = { "✕": "x", "×": "x", "⋯": "dots", "i": "info" };
  var EMO = /(?:\p{Extended_Pictographic}(?:️|⃣|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*|[\u{1F7E0}-\u{1F7EB}])️?/gu;
  function nameFor(e) {
    var P = window.PNI; if (!P) return null;
    var k = e.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, ""), k2 = k.replace(/️/g, "");
    if (k in EXTRA) return EXTRA[k]; if (k2 in EXTRA) return EXTRA[k2];
    return P.EMOJI[k] || P.EMOJI[k2] || "";
  }
  function svgNode(n, cls) { var t = document.createElement("span"); t.innerHTML = window.PNI.svg(n, cls || "pi-lead"); return t.firstChild; }
  function fixEl(el) {
    if (!window.PNI || el.closest(KEEP)) return;
    // a lone character icon
    var tx = el.textContent.trim();
    if (CHR[tx] && !el.querySelector("svg") && el.children.length <= 1 && (el.tagName === "BUTTON" || el.tagName === "SPAN")) {
      if (tx === "i" && !el.closest("#btn-attrib")) return;
      el.textContent = ""; el.appendChild(svgNode(CHR[tx], "")); return;
    }
    var tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), list = [], c;
    while ((c = tw.nextNode())) { if (c.parentNode.closest("svg") || c.parentNode.closest(KEEP)) continue; EMO.lastIndex = 0; if (EMO.test(c.nodeValue)) list.push(c); }
    list.forEach(function (t) {
      var v = t.nodeValue, out = document.createDocumentFragment(), at = 0, m;
      EMO.lastIndex = 0;
      while ((m = EMO.exec(v))) {
        var before = v.slice(at, m.index); if (before) out.appendChild(document.createTextNode(before));
        var k = m[0].replace(/️/g, ""), put = false;
        if (DOTS[k]) { var d = document.createElement("i"); d.className = "pn-dot pn-dot-" + DOTS[k]; d.setAttribute("aria-hidden", "true"); out.appendChild(d); put = true; }
        else { var nm = nameFor(m[0]); if (nm) { out.appendChild(svgNode(nm, at === 0 && !before ? "pi-lead" : "pi-in")); put = true; } }
        at = m.index + m[0].length;
        if (v.charAt(at) === " " && (!put || DOTS[k])) at++;   // a dropped emoji or a dot: no extra space
      }
      var rest = v.slice(at); if (rest) out.appendChild(document.createTextNode(rest));
      t.parentNode.replaceChild(out, t);
    });
  }
  function run(root) { (root || document).querySelectorAll(SEL).forEach(fixEl); }
  var t = 0;
  function soon() { clearTimeout(t); t = setTimeout(function () { try { run(); } catch (e) {} }, 50); }
  function start() {
    run();
    if (window.MutationObserver) new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) { var n = ms[i].target; if (n.nodeType === 3) n = n.parentNode; if (n && n.closest && n.closest("svg, .leaflet-marker-pane, .mapboxgl-marker, .tk-track")) continue; soon(); return; }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
/* ds12 icons END */
/* ds14 back START — ONE back button per screen: the header ‹ (sheet rule 3). The in-content "← Tillbaka" / "← Grupper" /
   "‹ Tillbaka" rows of the chat, Gänget, Lek and event detail hide while the header ‹ shows. Event detail had no header ‹:
   it now registers as a SHEETNAV sub-view, so the header ‹ (and Android back) runs its old in-content back. */
(function () {
  "use strict";
  var BACKTXT = /^(←|‹)\s*(Tillbaka|Grupper|Back)\b/;
  var SEL = "#sheet-body .ux-chat-top > .btn, #sheet-body .gg-top > .btn, #sheet-body .gm-top > .btn, #sheet-body .evs-detail > .btn, #sheet-body .evs-detail > .row > .btn";
  function vis(e) { return e && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden"; }
  function run() {
    var s = document.getElementById("sheet"), body = document.getElementById("sheet-body"); if (!s || s.hidden || !body) return;
    // event detail → a sub level (once per detail element)
    var det = body.querySelector(".evs-detail");
    if (det && !det._pnSub && window.SHEETNAV && window.SHEETNAV.sub) {
      var ib = [].filter.call(det.querySelectorAll(".btn"), function (b) { return BACKTXT.test((b.textContent || "").trim()); })[0];
      if (ib) {
        det._pnSub = true;
        var done = window.SHEETNAV.sub(function () { if (ib.isConnected) ib.click(); });
        var mo = new MutationObserver(function () { if (!det.isConnected) { mo.disconnect(); try { done(); } catch (e) {} } });
        mo.observe(body, { childList: true, subtree: true });
      }
    }
    var head = vis(document.getElementById("pn-back")) || s.classList.contains("pn-has-back") || !!(det && det._pnSub);
    body.querySelectorAll(SEL).forEach(function (b) {
      if (!BACKTXT.test((b.textContent || "").trim())) return;
      b.classList.toggle("pn-dupback", head);
      var row = b.parentElement;
      if (row && /\b(ux-chat-top|gg-top|gm-top|row)\b/.test(row.className)) {
        var other = [].some.call(row.children, function (c) { return c !== b && vis(c); });
        row.classList.toggle("pn-dupback-row", head && !other);
      }
    });
  }
  var t = 0;
  function soon() { clearTimeout(t); t = setTimeout(run, 40); }
  function start() {
    var s = document.getElementById("sheet"); if (!s || !window.MutationObserver) return;
    new MutationObserver(soon).observe(s, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
/* ds14 back END */
/* ds17 switch START — "Jag kör ikväll" in the group + menu is an on/off setting: a switch on the tile (role=switch,
   aria-checked), the label never says ": på". State = SKJUTS.driving(); refreshed after every repaint and after a tap. */
(function () {
  "use strict";
  function on() { try { return !!(window.SKJUTS && window.SKJUTS.driving && window.SKJUTS.driving()); } catch (e) { return false; } }
  function run() {
    var v = String(on());
    document.querySelectorAll('#sheet-body [data-ga="pk-drv"] .btn').forEach(function (b) {
      var sw = b.querySelector(":scope > .pn-ga-sw");
      if (!sw) { sw = document.createElement("span"); sw.className = "switch pn-ga-sw"; sw.setAttribute("aria-hidden", "true"); b.appendChild(sw); b.classList.add("pn-ga-swb"); b.setAttribute("role", "switch"); }
      if (sw.getAttribute("aria-checked") !== v) sw.setAttribute("aria-checked", v);
      if (b.getAttribute("aria-checked") !== v) b.setAttribute("aria-checked", v);
    });
  }
  var t = 0;
  function soon() { clearTimeout(t); t = setTimeout(run, 60); }
  function start() {
    var s = document.getElementById("sheet"); if (!s || !window.MutationObserver) return;
    new MutationObserver(soon).observe(s, { childList: true, subtree: true });
    document.addEventListener("click", function (e) {
      if (!e.target || !e.target.closest || !e.target.closest('[data-ga="pk-drv"]')) return;
      var n = 0, iv = setInterval(function () { run(); if (++n > 16) clearInterval(iv); }, 300);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
/* ds17 switch END */
/* ds18 motion START — progress bars move with transform: the inline width a module sets ("62%") becomes --pn-p (0.62);
   CSS draws the bar at full width and scales it from the left. Modules keep writing style.width; nothing else changes. */
(function () {
  "use strict";
  var SEL = ".bp-st-bar span, .du-tug-us, .gm-bar > span, .gg-rbar > span, .gg-obar > span, .gw-pl-bar i, .mer-bar span, .pt-bt i";
  function sync(e) {
    var w = e.style.width; if (!w) return;
    var m = /^(-?[\d.]+)%$/.exec(w.trim()); if (!m) return;
    var v = String(Math.max(0, Math.min(1, +m[1] / 100)));
    if (e.style.getPropertyValue("--pn-p") !== v) e.style.setProperty("--pn-p", v);
  }
  function scan(root) { (root && root.querySelectorAll ? root : document).querySelectorAll(SEL).forEach(sync); }
  function start() {
    scan(document);
    if (!window.MutationObserver) return;
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.type === "attributes") { if (m.target.matches && m.target.matches(SEL)) sync(m.target); }
        else for (var j = 0; j < m.addedNodes.length; j++) { var n = m.addedNodes[j]; if (n.nodeType === 1) { if (n.matches(SEL)) sync(n); scan(n); } }
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
/* ds18 motion END */
/* ds33 toasts START — owner 2026-11-08 (6-main.jpg): the precision bubble "Exakt plats räknas till barer i närheten" covered
   ANNAT and locate, and ANNAT cut its text. ALL bottom messages (toasts, the precision bubble) now start 8 px above the
   highest of: ANNAT, locate, the Mapbox logo / ⓘ, and any bottom banner (Följ mig hem, Skåltimmen, film). The same measure
   as ds11 (--pn-ban-b), plus the banners. Sets --pn-toast-b on :root. */
(function () {
  "use strict";
  var DOCK = "#other-wrap, .locate-btn, .bm-mblogo, #btn-attrib, .attrib-btn", BAN = "#hf-banner, #sk-banner, #fm-banner, .hf-banner, .sk-banner, .fm-banner";
  function top(sel, min) {
    var t = Infinity;
    document.querySelectorAll(sel).forEach(function (e) {
      if (e.hidden || !e.getClientRects().length || e.closest("[hidden]")) return;
      var s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return;
      var r = e.getBoundingClientRect(); if (r.height && r.top > innerHeight * min) t = Math.min(t, r.top);
    });
    return t;
  }
  function place() {
    var t = Math.min(top(DOCK, 0.45), top(BAN, 0.35));
    if (t === Infinity) return;
    var v = Math.round(innerHeight - t + 8) + "px", R = document.documentElement;
    if (R.style.getPropertyValue("--pn-toast-b") !== v) R.style.setProperty("--pn-toast-b", v);
    // the precision bubble goes over the toasts when both show (never on top of each other)
    var tt = top("#toasts > .toast", 0), h = Math.round(innerHeight - Math.min(t, tt) + 8) + "px";
    if (R.style.getPropertyValue("--pn-hint-b") !== h) R.style.setProperty("--pn-hint-b", h);
    var dk = document.querySelector(".dock"), db = dk && dk.getClientRects().length ? Math.round(innerHeight - dk.getBoundingClientRect().top) + "px" : "";   // the bubble lives in the dock
    if (db && R.style.getPropertyValue("--pn-dock-top-b") !== db) R.style.setProperty("--pn-dock-top-b", db);
  }
  var tm = 0;
  // debounced to one measure per 120 ms (layout reads only, a write only on change)
  function soon() { clearTimeout(tm); tm = setTimeout(place, 120); }
  function start() {
    soon();
    addEventListener("resize", soon); addEventListener("orientationchange", soon);
    if (window.MutationObserver) {
      new MutationObserver(soon).observe(document.body, { childList: true, attributes: true, attributeFilter: ["class"] });
      var ow = document.getElementById("other-wrap"); if (ow) new MutationObserver(soon).observe(ow, { attributes: true, attributeFilter: ["hidden", "style"] });
      var ts = document.getElementById("toasts"); if (ts) new MutationObserver(function () { soon(); setTimeout(soon, 260); }).observe(ts, { childList: true });   // a new toast: measure (and after its 200 ms entry)
      var ph = document.getElementById("prec-hint"); if (ph) new MutationObserver(soon).observe(ph, { attributes: true, attributeFilter: ["class"] });
    }
    setInterval(soon, 2000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.PNDS_TOASTB = place;
})();
/* ds33 toasts END */
/* ds37 start START — owner 2026-11-08: "start-up feels not smooth". A calm start (PWA splash practice: the first frame is the
   same colour as the manifest background_color, then ONE fade into the app; web.dev "Web app manifest"):
   1. #pn-splash (in index.html, solid --ds-bg, the app icon + wordmark) covers the chrome while ~80 modules restyle it
      (emoji → icons, rail, ANNAT, KAOS line, fonts). It never waits for data: it goes when the map has painted (Mapbox loaded
      or the first raster tiles) and the fonts are ready, at the latest 2.6 s after navigation (live data: map ready median
      1.58 s, max 3.1 s). Fade 280 ms (opacity only), none with reduced motion. Pointer events pass through it all the time.
   2. "pn:calm" fires 1.2 s after the splash is gone (or at 6 s): heavy non-visible work waits for it (smooth.js style copy).
   3. Chrome that arrives later (rail, chips, KAOS line) fades in once (200 ms) instead of popping (CSS ds37).
   window.__pnSplashGone = ms after navigation; window.__pnCalm = true after pn:calm. */
(function () {
  "use strict";
  var W = window, sp = document.getElementById("pn-splash"), gone = false, t0 = performance.now(), CAP = 2600;
  function calm() { if (W.__pnCalm) return; W.__pnCalm = true; try { document.dispatchEvent(new Event("pn:calm")); } catch (e) {} }
  function mapPainted() {
    try {
      var B = W.BASEMAP;
      if (B && B.isMapbox && B.isMapbox() && B.mapbox && B.mapbox()) { var m = B.mapbox().getMapboxMap(); if (m && (m.loaded() || (m.isStyleLoaded && m.isStyleLoaded() && m.areTilesLoaded()))) return true; }
    } catch (e) {}
    var n = 0; document.querySelectorAll("#map img.leaflet-tile").forEach(function (i) { if (i.complete && i.naturalWidth) n++; });
    return n >= 4;
  }
  function fontsOk() { try { return !document.fonts || document.fonts.status === "loaded"; } catch (e) { return true; } }
  function hide() {
    if (gone) return; gone = true; W.__pnSplashGone = Math.round(performance.now());
    document.documentElement.classList.remove("pn-booting");
    if (sp) {
      var still = W.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      sp.classList.add("pn-out");
      setTimeout(function () { if (sp && sp.parentNode) sp.parentNode.removeChild(sp); }, still ? 0 : 320);
    }
    setTimeout(calm, 1200);
  }
  function check() {
    if (gone) return;
    if (performance.now() >= CAP || (mapPainted() && fontsOk())) { hide(); return; }
    setTimeout(check, 60);
  }
  if (!sp) { document.documentElement.classList.remove("pn-booting"); setTimeout(calm, 1500); } else check();
  setTimeout(calm, Math.max(0, 6000 - t0));
  W.PNSTART = { hide: hide, calm: calm };
})();
/* ds37 start END */
/* ds39 ux2 START — "Ingen data här ikväll än": when the map shows a town (zoom ≥ 13) and nobody is out in view, one quiet
   caption says so (usability test: in Stockholm "find a calm bar" failed silently: no data looked like nothing). Once per
   area (~5 km) per session, never while a sheet is open, a calm toast (the toast queue decides when). */
(function () {
  "use strict";
  var seen = {}, tm = 0;
  function check() {
    try {
      var A = window.PNDS && window.PNDS._A && window.PNDS._A(); if (!A || !A.map || !A.LIVE || !A.beers) return;
      var s = document.getElementById("sheet"); if (s && !s.hidden) return;
      var m = A.map, z = m.getZoom(); if (z < 13) return;
      var c = m.getCenter(), k = Math.round(c.lat * 20) + ":" + Math.round(c.lng * 10); if (seen[k]) return;
      var b = m.getBounds(), any = (A.beers() || []).some(function (x) { return isFinite(x.lat) && b.contains([x.lat, x.lng]); });
      seen[k] = 1;
      if (!any) A.toast("Ingen data här ikväll än: ingen har tryckt ÖL! i närheten. Bli först!", { id: "pn-nodata", ms: 5000, cls: "pn-nodata" });
    } catch (e) {}
  }
  function hook() {
    var A = window.PNDS && window.PNDS._A && window.PNDS._A();
    if (!A || !A.map || !A.map.on) { setTimeout(hook, 1500); return; }
    A.map.on("moveend", function () { clearTimeout(tm); tm = setTimeout(check, 1800); });
  }
  document.addEventListener("pn:calm", function () { setTimeout(hook, 0); }, { once: true });
  setTimeout(function () { if (!window.__pnCalm) hook(); }, 9000);
})();
/* ds39 ux2 END */
/* ds40 ux START — (1) body.pn-modal-on while a sheet or a full-screen dialog is open (toasts go to the top, CSS);
   (2) fun cards (DELIGHT.caption: Visste du?, greetings) wait while a sheet / dialog is open and during the start, then come
   one at a time when the map has been still for 1.5 s; (3) html.pn-settle for 5 s after the splash (KAOS line and cards wait);
   (4) PNDS_BEEROK(): the "Öl #N registrerad" chip after an accepted ÖL!. */
(function () {
  "use strict";
  var R = document.documentElement, q = [], still = 0, lastMove = Date.now(), wrapped = false;
  function modal() {
    var s = document.getElementById("sheet"); if (s && !s.hidden) return true;
    var d = document.querySelectorAll('[aria-modal="true"]');
    for (var i = 0; i < d.length; i++) { var e = d[i]; if (e.id === "sheet" || e.id === "pn-splash" || e.hidden || !e.getClientRects().length) continue; var cs = getComputedStyle(e); if (cs.display !== "none" && cs.visibility !== "hidden") return true; }
    return false;
  }
  function busy() { return modal() || R.classList.contains("pn-settle") || R.classList.contains("pn-booting") || !!document.getElementById("pn-splash"); }
  function tick() {
    var m = modal(); if (document.body.classList.contains("pn-modal-on") !== m) document.body.classList.toggle("pn-modal-on", m);
    if (m) lastMove = Date.now();
    if (!q.length || busy() || Date.now() - lastMove < 1500) return;
    var cap = document.getElementById("dl-cap"); if (cap && cap.classList.contains("dl-in")) return;   // one at a time
    var o = q.shift(); try { orig(o); } catch (e) {}
  }
  var orig = null;
  function wrap() {
    var D = window.DELIGHT; if (wrapped || !D || typeof D.caption !== "function") return; wrapped = true;
    orig = D.caption.bind(D);
    D.caption = function (o) { if (!o) return; if (busy() || q.length) { if (q.length < 3) q.push(o); return; } return orig(o); };
  }
  function start() {
    wrap(); setTimeout(wrap, 2000);
    try { var A = window.PNDS && window.PNDS._A && window.PNDS._A(); if (A && A.map && A.map.on) A.map.on("movestart move", function () { lastMove = Date.now(); }); } catch (e) {}
    setInterval(tick, 400);
    var settle = function () { R.classList.add("pn-settle"); setTimeout(function () { R.classList.remove("pn-settle"); }, 5000); };
    if (window.__pnSplashGone) { if (performance.now() - window.__pnSplashGone < 5000) settle(); }
    else { var w = setInterval(function () { if (window.__pnSplashGone || !document.getElementById("pn-splash")) { clearInterval(w); settle(); } }, 100); setTimeout(function () { clearInterval(w); }, 8000); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.PNDS_BEEROK = function () {
    try {
      var n = 0; try { var nt = JSON.parse(localStorage.getItem("olnu.night") || "null"); n = nt ? nt.count | 0 : 0; } catch (e) {}
      var ghost = false; try { ghost = localStorage.getItem("olnu.ghostMode") === "1"; } catch (e) {}
      var old = document.querySelector(".pn-beerok"); if (old) old.remove();
      var c = document.createElement("div"); c.className = "pn-beerok"; c.setAttribute("role", "status");
      c.innerHTML = (window.PNI ? window.PNI.svg("check", "") : "") + "<span>" + (n ? "Öl #" + n + " registrerad" : "Öl registrerad") + "</span><small>" + (ghost ? "spökläge" : "syns för gänget") + "</small>";
      document.body.appendChild(c); setTimeout(function () { c.remove(); }, 2300);
    } catch (e) {}
  };
  window.PNDS_UX40 = { busy: busy, queue: function () { return q.length; } };
})();
/* ds40 ux END */
