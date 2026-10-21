/* Öl Nu design system helper (design5). Structure only: no data, no RPCs, no new buttons. Styles: ds.css.
   1. Keeps ds.css the LAST stylesheet: sheet CSS that loads later (boot.js x-lazy-css) and injected <style> is put in
      front of it, so the system wins on equal specificity. party.css + forfest.css (full-screen modes, own identity) stay after it.
   2. #sheet-body gets .ds-scrolled when its list is scrolled (shadow under the sticky Grupper | Vänner and 🏆 tabs).
   3. Short sheet titles use the stencil face: ≤ 13 letters 22 px (.ds-stencil), ≤ 20 letters 18 px (.ds-stencil-s); longer ones stay in the sans.
   4. A tap anywhere on a .toggle-row flips its switch (iOS/Android settings behaviour; 56 px target).
   5. ⚙️: after app.js + the settingsSheet hooks have built the sheet, the blocks are moved (not rebuilt, so
      every listener and every module reference stays) into sections:
      Profil · Kompisar & pass · Din statistik · Notiser & ljud · Integritet & säkerhet · Karta ·
      Skoj & överraskningar · Om & hjälp (· Mer for an unknown future block).
      Each block becomes one .ds-item row in a .ds-list card. Late blocks (async hooks) are sorted the same way.
   Missing parts = no change. Public: window.DS = { organizeSettings }. */
(function () {
  "use strict";
  var sv = function () { try { return (localStorage.getItem("olnu.lang") || "sv") !== "en"; } catch (e) { return true; } };

  /* ---------- 1. ds.css stays last ---------- */
  function dsLink() { return [].filter.call(document.querySelectorAll('link[rel="stylesheet"]'), function (l) { return /(^|\/)ds\.css(\?|$)/.test(l.getAttribute("href") || ""); })[0] || null; }
  function keepLast() {
    var ds = dsLink(); if (!ds) return;
    var n = ds.nextElementSibling, late = [];
    while (n) {
      // party.css / forfest.css are full-screen modes with their own look: they stay after ds.css
      if ((n.tagName === "LINK" && n.rel === "stylesheet" && !/(party|forfest)\.css/.test(n.getAttribute("href") || "")) || n.tagName === "STYLE") late.push(n);
      n = n.nextElementSibling;
    }
    late.forEach(function (l) { ds.parentNode.insertBefore(l, ds); });
  }
  try { new MutationObserver(keepLast).observe(document.head, { childList: true }); } catch (e) {}
  keepLast();

  /* ---------- 5. settings sections ---------- */
  var SEC = [["profil", "👤", "Profil", "Profile"], ["vanner", "👥", "Kompisar & pass", "Friends & passport"], ["stat", "🎖️", "Din statistik", "Your stats"],
    ["notis", "🔔", "Notiser & ljud", "Notifications & sound"], ["integ", "🔒", "Integritet & säkerhet", "Privacy & safety"], ["karta", "🗺️", "Karta", "Map"],
    ["skoj", "🎉", "Skoj & överraskningar", "Fun & surprises"], ["om", "ℹ️", "Om & hjälp", "About & help"], ["mer", "➕", "Mer", "More"]];
  function txt(n) { return (n && n.textContent || "").replace(/\s+/g, " ").trim(); }
  function headSec(h) {
    var t = txt(h);
    if (!t) return null;
    if (/namn|name|hemstad|home ?town|språk|language/i.test(t)) return "profil";
    if (/notis|notif|ljud|sound/i.test(t)) return "notis";
    if (/social|säkerhet|safety|topplist|top ?list|leaderboard|integritet|privacy|spök|ghost/i.test(t)) return "integ";
    if (/wrapped|bakis|hangover|statistik|stats/i.test(t)) return "stat";
    if (/skoj|fun|överrask|surprise/i.test(t)) return "skoj";
    if (/kartstil|map style|karta|\bmap\b/i.test(t)) return "karta";
    if (/kompis|vänner|friend|pass/i.test(t)) return "vanner";
    if (/flytta|move|^om |about|önska|wish|hjälp|help/i.test(t)) return "om";
    return null;
  }
  function has(n, sel) { try { return !!(n.matches && n.matches(sel)) || !!(n.querySelector && n.querySelector(sel)); } catch (e) { return false; } }
  function secOf(n, hs) {
    var t = txt(n);
    if (has(n, "#set-name, .ht-set, .hz-set, .hz-row")) return "profil";
    if (has(n, ".bm-seg")) return "karta";
    if (has(n, ".seg")) return "profil";
    if (has(n, ".nr-set, .ps-entry")) return "vanner";
    if (has(n, ".bd-optin, .sos-block")) return "integ";
    if (has(n, ".ws-entry")) return "om";
    if (n.classList && n.classList.contains("toggle-row") && /uppdatera|update/i.test(t)) return "om";
    if (has(n, ".btn-amber") && /bjud in|invite/i.test(t)) return "vanner";
    if (/hemskärm|home screen|installera|install/i.test(t)) return "om";
    if (/göm min pin|hide my pin|spökläge|ghost/i.test(t)) return "integ";
    if (/radera|delete/i.test(t)) return "integ";
    if (/integritet|privacy/i.test(t) && has(n, ".btn")) return "integ";
    if (/flytta|flyttkod|move|transfer/i.test(t)) return "om";
    if (/introduktion|intro/i.test(t)) return "om";
    if (/uniform|din kväll|your night|bakis|hangover|wrapped|månaden|month|året|year/i.test(t)) return "stat";
    if (/kapsyl|överrask|skaka|surprise|shake|bottle ?cap/i.test(t)) return "skoj";
    return hs || "mer";
  }
  function sectionFor(body, key) {
    var s = body.querySelector(':scope > section.ds-section[data-ds="' + key + '"]');
    if (s) return s.querySelector(".ds-list");
    var def = SEC.filter(function (x) { return x[0] === key; })[0] || SEC[SEC.length - 1];
    s = document.createElement("section"); s.className = "ds-section"; s.setAttribute("data-ds", key);
    var h = document.createElement("h3"); h.className = "ds-section-h";
    var i = document.createElement("span"); i.className = "ds-sec-i"; i.setAttribute("aria-hidden", "true"); i.textContent = def[1];
    h.appendChild(i); h.appendChild(document.createTextNode(sv() ? def[2] : def[3]));
    var list = document.createElement("div"); list.className = "ds-list";
    s.appendChild(h); s.appendChild(list);
    // canonical order
    var idx = SEC.map(function (x) { return x[0]; }).indexOf(key), after = null;
    [].slice.call(body.querySelectorAll(":scope > section.ds-section")).forEach(function (o) {
      if (SEC.map(function (x) { return x[0]; }).indexOf(o.getAttribute("data-ds")) < idx) after = o;
    });
    var first = body.querySelector(":scope > section.ds-section");
    if (after) body.insertBefore(s, after.nextSibling);
    else if (first) body.insertBefore(s, first);
    else body.insertBefore(s, body.firstChild);
    return list;
  }
  var busy = false;
  function organizeSettings(body) {
    body = body || document.getElementById("sheet-body");
    if (!body || busy || !body.querySelector("#set-name")) return false;
    busy = true;
    try {
      body.classList.add("ds-set");
      var loose = [].slice.call(body.children).filter(function (c) { return !(c.tagName === "SECTION" && c.classList.contains("ds-section")); });
      // a heading at the very end may still wait for its content (async hook): leave it for the next pass
      while (loose.length && loose[loose.length - 1].tagName === "H3") loose.pop();
      var head = null, headUsed = false, cur = null, curSec = null, pend = [];
      function newItem(el, key) {
        var it = document.createElement("div"); it.className = "ds-item";
        var block = has(el, "#set-name, .seg") || (el.classList.contains("row") && el.querySelectorAll(".btn").length > 1 && head && /wrapped/i.test(txt(head)));
        if (block) it.classList.add("ds-blk");
        if (has(el, ".bm-seg")) it.classList.add("ds-karta");
        if (has(el, ".btn-danger") && !has(el, ".sos-block")) it.classList.add("ds-danger");
        if (el.classList.contains("toggle-row") && /uppdatera|update/i.test(txt(el))) it.classList.add("ds-ver");
        if (head && !headUsed) {
          if (block) head.classList.add("ds-item-l"); else head.classList.add("ds-hide");
          it.appendChild(head); headUsed = true;
        }
        if (block) { pend.forEach(function (p) { it.appendChild(p); }); it.appendChild(el); }
        else { it.appendChild(el); pend.forEach(function (p) { p.classList.add("ds-item-hint"); it.appendChild(p); }); }
        pend = [];
        sectionFor(body, key).appendChild(it);
        cur = it; curSec = key;
        return it;
      }
      loose.forEach(function (el) {
        if (el.tagName === "H3") {
          if (head && !headUsed) { head.classList.add("ds-hide"); (cur || sectionFor(body, headSec(head) || "mer")).appendChild(head); }
          head = el; headUsed = false; cur = null; return;
        }
        var hs = head ? headSec(head) : null;
        if (el.tagName === "P" || el.classList.contains("info")) {
          if (/^\s*🎖/.test(txt(el))) { pend.push(el); return; }
          if (cur && !cur.classList.contains("ds-danger")) { el.classList.add("ds-item-hint"); cur.appendChild(el); return; }
          if (cur && cur.classList.contains("ds-danger")) {   // text after "Radera": its own quiet text row
            var it = document.createElement("div"); it.className = "ds-item ds-blk ds-text"; it.appendChild(el);
            sectionFor(body, hs || "om").appendChild(it); return;
          }
          pend.push(el); return;
        }
        newItem(el, secOf(el, hs));
        // the row gets its own chevron: drop a "›" at the end of a plain-text label (🏠 Hemzon … ›)
        [].forEach.call(el.querySelectorAll ? el.querySelectorAll(".btn") : [], function (b) {
          var t = b.lastChild;
          if (t && t.nodeType === 3 && /\s*›\s*$/.test(t.nodeValue)) t.nodeValue = t.nodeValue.replace(/\s*›\s*$/, "");
        });
      });
      if (pend.length) { var it2 = document.createElement("div"); it2.className = "ds-item ds-blk ds-text"; pend.forEach(function (p) { it2.appendChild(p); }); pend = []; sectionFor(body, "om").appendChild(it2); }
      if (head && !headUsed && head.parentNode === body && loose.indexOf(head) >= 0) { head.classList.add("ds-hide"); }
    } catch (e) { try { console.warn("ds settings", e); } catch (x) {} }
    busy = false;
    return true;
  }

  /* ---------- wiring ---------- */
  function scan() {
    var body = document.getElementById("sheet-body");
    if (!body) return;
    if (body.querySelector("#set-name")) organizeSettings(body);
    else body.classList.remove("ds-set");
  }
  function title() {
    var t = document.getElementById("sheet-title");
    if (!t) return;
    var s = txt(t).replace(/[\u{1F000}-\u{1FFFF}☀-➿️]/gu, "").trim();
    t.classList.toggle("ds-stencil", s.length > 0 && s.length <= 13);
    t.classList.toggle("ds-stencil-s", s.length > 13 && s.length <= 20);
  }
  function start() {
    keepLast();
    var body = document.getElementById("sheet-body");
    if (body) {
      var tm = null;
      new MutationObserver(function () { if (busy) return; clearTimeout(tm); tm = setTimeout(scan, 40); }).observe(body, { childList: true });
      body.addEventListener("scroll", function () { body.classList.toggle("ds-scrolled", body.scrollTop > 4); }, { passive: true });
      new MutationObserver(function () { body.classList.toggle("ds-scrolled", body.scrollTop > 4); }).observe(body, { childList: true });
      scan();
    }
    var t = document.getElementById("sheet-title");
    if (t) { new MutationObserver(title).observe(t, { childList: true, characterData: true, subtree: true }); title(); }
    document.addEventListener("click", function (e) {
      var row = e.target && e.target.closest && e.target.closest(".toggle-row");
      if (!row || e.target.closest("button, a, input, select, textarea, label")) return;
      var sw = row.querySelector(":scope > .switch, :scope > button[role=switch]");
      if (sw && !sw.disabled) sw.click();
    });
  }
  window.DS = { organizeSettings: organizeSettings, keepLast: keepLast };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
