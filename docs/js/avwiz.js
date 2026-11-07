/* PintsNow — 👤 AVWIZ: "Skapa din karaktär" (owner 2026-11-07: "When people start the app they should NOT have a character
   until they create one … Profil → create a character … step by step: I choose male or female, or maybe it doesn't matter").
   Research: Bitmoji / Memoji / game creators start from a body or style preset, then ONE part per screen with a big live
   preview, a randomise button, back / next and a progress bar; the finish is a small celebration.
   - Steps: Start (Feminin / Maskulin / Spelar ingen roll = ONLY a starting preset and the order of the tiles; every item stays
     free to mix) → Hudton → Ansiktsform → Frisyr + hårfärg → Ögon + ögonfärg → Bryn → Mun → Skägg → Kläder + färg →
     Glasögon → Huvudbonad → I handen → Bakgrund → Klar (save + confetti). 🎲 = random for this step only.
   - Items you can not use yet show last ("🔒 Låses upp senare", max 6) with what unlocks them (meriter / grad).
   - Profil: no character yet → a "Skapa din karaktär" card under the hero (sync, called by AVATAR.repaint).
   - Gentle nudge: never on the first days. From the 3rd day the app is opened, max 3 times, 4 days apart, only with no
     sheet open: one toast "👤 Skapa din karaktär?" + "Skapa".
   Uses window.AVATAR (svg, NAMES, saveSpec, usable …). Public: window.AVWIZ {open, sync, init, onAuthed, onPoll}. Styles: avwiz.css. */
(function () {
  "use strict";
  var U = window.U;
  var A = null, cur = null;
  function AV() { var x = window.AVATAR; return x && x.on && x.on() && x.saveSpec ? x : null; }
  function esc(s) { return U && U.esc ? U.esc(s) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function reduced() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "text") e.textContent = v; else if (k === "html") e.innerHTML = v; else if (k === "class") e.className = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }

  /* ---------- presets (free items only) ---------- */
  var BASES = [
    { id: "fem", t: "Feminin", s: "Långt hår, fransar", spec: { v: 2, sk: 1, fs: 1, ey: 9, br: 5, mt: 8, hr: 5, hc: 2, fh: 0, hw: 0, gl: 0, up: 18, uc: 13, bg: 7, ck: 2, er: 2, ms: 1 } },
    { id: "masc", t: "Maskulin", s: "Kort hår, skäggstubb", spec: { v: 2, sk: 2, fs: 2, ey: 0, br: 6, mt: 0, hr: 2, hc: 1, fh: 1, hw: 0, gl: 0, up: 1, uc: 0, bg: 2, ns: 4, ms: 1 } },
    { id: "neu", t: "Spelar ingen roll", s: "Mitt emellan", spec: { v: 2, sk: 3, fs: 0, ey: 1, br: 1, mt: 1, hr: 4, hc: 2, fh: 0, hw: 0, gl: 0, up: 0, uc: 2, bg: 1, ms: 1 } }
  ];
  // Which tiles come first after each start (nothing is hidden).
  var PRIO = {
    fem: { hr: [5, 14, 8, 12, 11, 13, 16, 22, 23, 6, 15, 17, 30, 20, 24, 26], ey: [9, 7, 1, 10, 2, 0], br: [5, 12, 1, 2], mt: [8, 9, 0, 1, 2], up: [18, 17, 19, 16, 13, 0, 1, 2], fh: [0] },
    masc: { hr: [2, 1, 3, 4, 0, 20, 22, 7, 15, 17, 30, 31, 23, 19, 21], fh: [1, 0, 2, 5, 12, 4, 19, 9, 6, 3], br: [6, 1, 4, 2, 3], ey: [0, 1, 5, 2], up: [1, 2, 0, 16, 13, 19] },
    neu: {}
  };
  var STEPS = [
    { id: "base", t: "Välj en start", s: "Bara en start. Allt går att blanda fritt efteråt." },
    { k: "sk", t: "Hudton", sw: true },
    { k: "fs", t: "Ansiktsform", vb: "FACE" },
    { k: "hr", t: "Frisyr", col: "hc", colT: "Hårfärg" },
    { k: "ey", t: "Ögon", vb: "FACE", col: "ec", colT: "Ögonfärg" },
    { k: "br", t: "Ögonbryn", vb: "FACE" },
    { k: "mt", t: "Mun", vb: "FACE" },
    { k: "fh", t: "Skägg", vb: "FACE", s: "Valfritt. \"Inget\" går också bra." },
    { k: "up", t: "Kläder", col: "uc", colT: "Färg" },
    { k: "gl", t: "Glasögon", vb: "FACE", s: "Valfritt." },
    { k: "hw", t: "Huvudbonad", s: "Valfritt." },
    { k: "hi", t: "I handen", vb: "HAND", s: "Vatten och alkoholfritt finns med." },
    { k: "bg", t: "Bakgrund" },
    { id: "done", t: "Klar!" }
  ];
  var NONE_P = { fh: 0.5, gl: 0.6, hw: 0.5 };
  var PICK_LINES = ["Snyggt val!", "Den sitter.", "Klockrent.", "Ja, dä ä du.", "Stilpoäng!"];

  /* ---------- the wizard ---------- */
  function open(opts) {
    opts = opts || {};
    var av = AV(); if (!av || !A || !A.openSheet) return;
    var go = function () {
      var me = av.meRaw(); if (!me) { A.toast("Kunde int' hämta din karaktär. Prova igen.", { err: true }); return; }
      var had = !!me.spec;
      var st = { i: opts.from || me.spec ? 1 : 0, base: null, draft: JSON.parse(JSON.stringify(opts.from || me.spec || BASES[2].spec)), had: had, saving: false };
      cur = st;
      A.openSheet(had ? "Steg för steg" : "Skapa din karaktär", function (body) { build(body, st); });
    };
    if (av.meRaw()) go(); else av.loadMe().then(go);
  }
  function facts() { var me = AV() && AV().meRaw(); return (me && me.facts) || {}; }
  function svgOf(spec, vb) { var av = AV(); try { return av.svg(spec, { r: facts().r, md: [], vb: vb || "" }); } catch (e) { return ""; } }
  function ordered(k, base) {
    var av = AV(), max = av.MAX[k], p = (base && PRIO[base] && PRIO[base][k]) || [], out = [], seen = {};
    p.forEach(function (i) { if (i <= max && !seen[i]) { seen[i] = 1; out.push(i); } });
    for (var i = 0; i <= max; i++) if (!seen[i]) out.push(i);
    return out;
  }
  function build(body, st) {
    var av = AV(), f = facts();
    var wrap = h("div", { class: "avw" });
    var dots = h("div", { class: "avw-dots", "aria-hidden": "true" });
    STEPS.forEach(function (_, i) { if (i < STEPS.length - 1) dots.appendChild(h("i")); });
    var stepTxt = h("p", { class: "avw-n" }), title = h("h3", { class: "avw-t" }), sub = h("p", { class: "avw-s" });
    var prev = h("div", { class: "avw-prev", "aria-hidden": "true" });
    var pane = h("div", { class: "avw-pane" });
    var back = h("button", { type: "button", class: "btn avw-back", text: "‹ Tillbaka" });
    var dice = h("button", { type: "button", class: "btn avw-dice", "aria-label": "Slumpa det här steget", html: '<span aria-hidden="true">🎲</span> Slumpa' });
    var next = h("button", { type: "button", class: "btn btn-amber avw-next", text: "Nästa ›" });
    var bar = h("div", { class: "avw-bar" }, [back, dice, next]);
    wrap.appendChild(h("div", { class: "avw-top" }, [dots, stepTxt, title, sub, prev]));
    wrap.appendChild(pane); wrap.appendChild(bar);
    body.appendChild(wrap);

    function step() { return STEPS[st.i]; }
    function paintPrev(pop) {
      prev.innerHTML = svgOf(st.draft);
      if (pop && !reduced() && prev.animate) try { prev.animate([{ transform: "scale(.94)" }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" }); } catch (e) {}
    }
    function paint() {
      var s = step(), n = STEPS.length - 1;
      wrap.setAttribute("data-step", s.id || s.k);
      dots.querySelectorAll("i").forEach(function (d, i) { d.className = i < st.i ? "done" : i === st.i ? "on" : ""; });
      stepTxt.textContent = s.id === "done" ? "" : "Steg " + (st.i + 1) + " av " + n;
      title.textContent = s.t;
      sub.textContent = s.s || ""; sub.hidden = !s.s;
      back.hidden = s.id === "done" || st.i === 0;
      dice.hidden = s.id === "done";
      next.hidden = s.id === "done";
      next.disabled = s.id === "base" && !st.base && !st.had && !st.touchedBase;
      next.textContent = st.i === n - 1 ? (st.saving ? "Sparar…" : "Spara ✓") : s.id === "base" && !st.base ? "Hoppa över ›" : "Nästa ›";
      if (s.id === "base") next.disabled = false;
      prev.hidden = s.id === "base" || s.id === "done";
      pane.innerHTML = "";
      if (s.id === "base") paintBase(); else if (s.id === "done") paintDone(); else paintSlot(s);
      paintPrev(false);
      try { var sb = document.getElementById("sheet-body"); if (sb) sb.scrollTop = 0; } catch (e) {}
    }
    function paintBase() {
      var g = h("div", { class: "avw-bases", role: "radiogroup", "aria-label": "Välj en start" });
      BASES.forEach(function (b) {
        var on = st.base === b.id;
        var spec = JSON.parse(JSON.stringify(b.spec));
        var card = h("button", { type: "button", role: "radio", "aria-checked": String(on), class: "avw-base" + (on ? " on" : ""), "data-b": b.id }, [
          h("span", { class: "avw-base-art", html: svgOf(spec) }), h("b", { text: b.t }), h("small", { text: b.s })]);
        card.addEventListener("click", function () {
          st.base = b.id; st.draft = JSON.parse(JSON.stringify(b.spec));
          paint();
          setTimeout(function () { if (cur === st && st.i === 0) { st.i = 1; paint(); } }, reduced() ? 0 : 280);
        });
        g.appendChild(card);
      });
      pane.appendChild(g);
      pane.appendChild(h("p", { class: "avw-note", text: "Du väljer bara var du börjar. Kläder, frisyr, skägg och allt annat går att blanda hur du vill." }));
    }
    function tile(k, i, s, locked) {
      var t = JSON.parse(JSON.stringify(st.draft)); t[k] = i;
      var on = (st.draft[k] | 0) === i, nm = (av.NAMES[k][i] || ["", ""])[0], lk = av.lockOf(k, i);
      var b = h("button", { type: "button", class: "avw-tile" + (on ? " on" : "") + (locked ? " locked" : "") + (s.sw ? " sw" : ""), "aria-pressed": String(on),
        "aria-label": nm + (locked && lk ? " — " + av.lockText(lk) : ""), "data-k": k, "data-i": String(i) });
      if (s.sw) b.appendChild(h("span", { class: "avw-sw", style: "background:" + av.PAL.SKIN[i] }));
      else b.appendChild(h("span", { class: "avw-art", html: svgOf(t, s.vb ? av.VB[s.vb] : "") }));
      b.appendChild(h("span", { class: "avw-nm", text: locked && lk ? "🔒 " + av.shortLock(lk) : nm }));
      b.addEventListener("click", function () {
        if (locked) { A.toast("🔒 " + (lk ? av.lockText(lk) : "Låst"), { ms: 3800, id: "avw-lock" }); return; }
        st.draft[k] = i;
        pane.querySelectorAll(".avw-tile.on").forEach(function (x) { if (x.getAttribute("data-k") === k) { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); } });
        b.classList.add("on"); b.setAttribute("aria-pressed", "true");
        paintPrev(true);
        try { if (window.FX && window.FX.vibrate) window.FX.vibrate(8); } catch (e) {}
      });
      return b;
    }
    function colRow(ck, ttl) {
      var pal = ck === "hc" ? av.PAL.HAIRC : ck === "ec" ? av.PAL.EYEC : av.PAL.TOPC;
      var sec = h("div", { class: "avw-cols" }, [h("h4", { text: ttl })]);
      var row = h("div", { class: "avw-colrow", role: "radiogroup", "aria-label": ttl });
      pal.forEach(function (c, i) {
        var ok = av.usable(ck, i, facts()); if (!ok) return;
        var on = (st.draft[ck] | 0) === i;
        var b = h("button", { type: "button", role: "radio", "aria-checked": String(on), class: "avw-c" + (on ? " on" : ""), style: "background:" + c, "aria-label": av.NAMES[ck][i][0] });
        b.addEventListener("click", function () {
          st.draft[ck] = i; if (ck === "hc") { delete st.draft.hx; } if (ck === "uc") delete st.draft.ux;
          row.querySelectorAll(".avw-c").forEach(function (x) { x.classList.remove("on"); x.setAttribute("aria-checked", "false"); });
          b.classList.add("on"); b.setAttribute("aria-checked", "true");
          paintPrev(true); refreshArt();
        });
        row.appendChild(b);
      });
      sec.appendChild(row);
      return sec;
    }
    function refreshArt() {   // a colour changes the art in the style tiles
      var s = step(); if (!s.k || s.sw) return;
      pane.querySelectorAll(".avw-tile").forEach(function (b) {
        var k = b.getAttribute("data-k"), i = +b.getAttribute("data-i"), t = JSON.parse(JSON.stringify(st.draft)); t[k] = i;
        var art = b.querySelector(".avw-art"); if (art) art.innerHTML = svgOf(t, s.vb ? av.VB[s.vb] : "");
      });
    }
    function paintSlot(s) {
      var k = s.k, ok = [], lockd = [];
      ordered(k, st.base).forEach(function (i) { if (av.usable(k, i, f)) ok.push(i); else lockd.push(i); });
      if (s.col) pane.appendChild(colRow(s.col, s.colT));
      var g = h("div", { class: "avw-grid" + (s.sw ? " avw-grid-sw" : "") });
      ok.forEach(function (i) { g.appendChild(tile(k, i, s, false)); });
      pane.appendChild(g);
      if (lockd.length) {
        var show = lockd.filter(function (i) { var lk = av.lockOf(k, i); return lk && !lk.d; }).slice(0, 6);
        if (show.length) {
          var more = lockd.length - show.length;
          pane.appendChild(h("h4", { class: "avw-lh", text: "🔒 Låses upp senare · " + lockd.length }));
          var lg = h("div", { class: "avw-grid avw-grid-lock" });
          show.forEach(function (i) { lg.appendChild(tile(k, i, s, true)); });
          pane.appendChild(lg);
          pane.appendChild(h("p", { class: "avw-note", text: "Samla meriter och gå upp i grad så öppnas fler." + (more > 0 ? " (+" + more + " till, bl.a. säsongsgrejer.)" : "") }));
        }
      }
    }
    function paintDone() {
      var big = h("div", { class: "avw-done-art", html: svgOf(st.draft) });
      var conf = h("div", { class: "avw-conf", "aria-hidden": "true" });
      if (!reduced()) for (var i = 0; i < 18; i++) conf.appendChild(h("i", { style: "--i:" + i }));
      var unl = 0, tot = 0; Object.keys(av.LOCKS).forEach(function (key) { tot++; if (av.unlocked(av.LOCKS[key], f)) unl++; });
      pane.appendChild(h("div", { class: "avw-done" }, [conf, big,
        h("p", { class: "avw-done-l", text: "Snyggt! Dä här ä du nu." }),
        h("p", { class: "avw-note", text: "Gänget ser din karaktär i chatten, i medlemslistan och på kartan. " + unl + " av " + tot + " specialgrejer upplåsta – fler kommer med meriter." }),
        h("div", { class: "avw-done-b" }, [
          h("button", { type: "button", class: "btn btn-amber btn-block avw-ok", text: "Klar", onclick: function () { A.closeSheet(); } }),
          h("button", { type: "button", class: "btn btn-block avw-full", text: "🎨 Finjustera allt", onclick: function () { try { window.AVATAR.openEditor({ full: true }); } catch (e) {} } })
        ])]));
    }
    function save() {
      if (st.saving) return;
      st.saving = true; next.disabled = true; next.textContent = "Sparar…";
      if (!st.had) lsSet("olnu.avV3", 1);   // made in the new wizard = not grandfathered (until the server says gf)
      av.saveSpec(st.draft).then(function (r) {
        st.saving = false;
        if (cur !== st || !document.body.contains(wrap)) return;
        if (!r.ok) {
          A.toast(r.code === "locked" ? "Nåt av det där ä låst än. Välj nåt annat." : r.code === "slow_down" ? "Lugn, prova igen om en sekund." : "Kunde int' spara. Prova igen.", { err: true });
          paint(); return;
        }
        st.had = true; st.i = STEPS.length - 1; paint();
        try { if (window.FX && window.FX.vibrate) window.FX.vibrate([10, 40, 14]); } catch (e) {}
      });
    }
    back.addEventListener("click", function () { if (st.i > 0) { st.i--; paint(); } });
    next.addEventListener("click", function () {
      var n = STEPS.length - 1;
      if (st.i === n - 1) { save(); return; }
      if (st.i < n - 1) { st.i++; paint(); }
    });
    dice.addEventListener("click", function () {
      var s = step();
      if (s.id === "base") { var b = BASES[Math.floor(Math.random() * BASES.length)]; var c = pane.querySelector('[data-b="' + b.id + '"]'); if (c) c.click(); return; }
      var k = s.k, ok = [];
      for (var i = 0; i <= av.MAX[k]; i++) if (av.usable(k, i, f)) ok.push(i);
      st.draft[k] = NONE_P[k] && Math.random() < NONE_P[k] ? 0 : ok[Math.floor(Math.random() * ok.length)];
      if (s.col) {
        var pal = s.col === "hc" ? av.PAL.HAIRC : s.col === "ec" ? av.PAL.EYEC : av.PAL.TOPC, oc = [];
        pal.forEach(function (_, j) { if (av.usable(s.col, j, f)) oc.push(j); });
        if (oc.length) st.draft[s.col] = oc[Math.floor(Math.random() * oc.length)];
        delete st.draft.hx; delete st.draft.ux;
      }
      paint(); paintPrev(true);
      A.toast("🎲 " + PICK_LINES[Math.floor(Math.random() * PICK_LINES.length)], { ms: 1600, id: "avw-dice" });
    });
    paint();
  }

  /* ---------- Profil card ---------- */
  var SIL = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="18" r="9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="4 3"/>' +
    '<path d="M8 44c1.5-9 8-13 16-13s14.5 4 16 13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="4 3" stroke-linecap="round"/></svg>';
  function sync() {
    var av = AV(); if (!av) return;
    var me = av.meRaw(), none = !!me && !me.spec;
    document.querySelectorAll('.pf-av[data-avk="me"]').forEach(function (pf) {
      pf.classList.toggle("av-new", none);
      var pen = pf.querySelector(".av-pen"); if (pen) pen.textContent = none ? "+" : "✎";
      pf.setAttribute("aria-label", none ? "Skapa din karaktär" : "Ändra din karaktär");
      var top = pf.closest(".pf-top"); if (!top || !top.parentNode) return;
      var card = top.parentNode.querySelector(":scope > .avw-cta");
      if (!none) { if (card) card.remove(); return; }
      if (card) return;
      card = h("button", { type: "button", class: "avw-cta", "data-av-edit": "1" }, [
        h("span", { class: "avw-cta-ic", html: SIL }),
        h("span", { class: "avw-cta-t" }, [h("b", { text: "Skapa din karaktär" }), h("small", { text: "Steg för steg, tar en minut. Gänget ser den i chatten och på kartan." })]),
        h("span", { class: "avw-cta-go", "aria-hidden": "true", text: "›" })]);
      top.parentNode.insertBefore(card, top.nextSibling);
    });
  }

  /* ---------- gentle nudge (never on the first days) ---------- */
  function today() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function countDay() {
    var x = lsGet("olnu.avwDays", null) || { d: "", n: 0 };
    if (x.d !== today()) { x.d = today(); x.n = (x.n | 0) + 1; lsSet("olnu.avwDays", x); }
    return x.n | 0;
  }
  var nudgeAt = 0;
  function maybeNudge() {
    var av = AV(); if (!av || !A || !A.LIVE) return;
    var me = av.meRaw(); if (!me || me.spec) return;
    if (Date.now() - nudgeAt < 60000) return; nudgeAt = Date.now();
    var days = (lsGet("olnu.avwDays", null) || {}).n | 0;
    var nd = lsGet("olnu.avwNudge", null) || { n: 0, at: 0 };
    if (days < 3 || nd.n >= 3 || Date.now() - (nd.at || 0) < 4 * 86400000) return;
    try { if (A.sheetOpen && A.sheetOpen()) return; } catch (e) {}
    lsSet("olnu.avwNudge", { n: (nd.n | 0) + 1, at: Date.now() });
    A.toast("👤 Skapa din karaktär? Då känner gänget igen dig i chatten och på kartan.", { id: "avw-nudge", ms: 9000, action: { label: "Skapa", fn: function () { open(); } } });
  }

  window.AVWIZ = {
    init: function (api) { A = api; countDay(); },
    onAuthed: function () { setTimeout(sync, 0); },
    onPoll: function () { try { sync(); maybeNudge(); } catch (e) {} },
    open: open, sync: sync,
    _bases: BASES, _steps: STEPS, _nudge: maybeNudge
  };
})();
