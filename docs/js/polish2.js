/* Öl Nu — design pass 4 (design3): visual structure only, no data, no RPCs.
   1. Group page: the tiles from ~15 modules are sorted into clear sections
      (Ikväll · Spel & kul · Dagen efter · Gruppen · Mer…). Chatt stays the one primary action on top.
      The DOM order is NOT changed (modules and tests keep working): each tile gets data-gp + CSS order,
      and the section heads are extra grid items. Late tiles (async RPCs) are sorted by a MutationObserver.
   2. 🏆 sheet: one tab bar (Topplistor · Meriter · Streak · Event · Pass) instead of one long scroll.
      Sections stay in the DOM; CSS shows the active tab. Tabs without content are hidden.
   3. ⚙️: a small heading fix (Vänner/Ölpasset get their own heading).
   No app.js hook needed: it watches #sheet-body. Styles: polish2.css. Missing parts = no change. */
(function () {
  "use strict";
  var sv = function () { try { return (localStorage.getItem("olnu.lang") || "sv") !== "en"; } catch (e) { return true; } };
  var L = function (a, b) { return sv() ? a : b; };
  var lsGet = function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  var lsSet = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };

  /* ---------- 1. Group page sections ---------- */
  // section: 1 Ikväll, 2 Spel & kul, 3 Dagen efter, 4 Gruppen, 5 Mer… (folded)
  var SECT = [
    [1, L("Ikväll", "Tonight")], [2, L("Spel & kul", "Games & fun")], [3, L("Dagen efter", "The day after")],
    [4, L("Gruppen", "The group")]
  ];
  function sectOf(c) {
    var k = c.classList;
    if (k.contains("gmain") || k.contains("gp-h") || k.contains("gp-more")) return null;
    if (/(^|\s)gpg-/.test(c.className || "")) return null;   // social2: gpage.js parts (Nu, chat, bar, menus)
    if (k.contains("g-foot") || k.contains("confirm")) return null;
    if (k.contains("jn-gtile")) return [0, 2];      // ➕ Bjud in (join.js): primary, under Chatt
    if (k.contains("row")) {
      if (c.querySelector(".jam-host")) return [5, 1];
      var tx = c.textContent || "";
      if (/💬/.test(tx)) return [0, 1];             // Chatt = primary
      if (/🪖/.test(tx)) return [1, 1, 1];          // Kalla in (full width)
      return [4, 8];
    }
    if (k.contains("rl-group-item")) return [1, 0];
    if (k.contains("rl-gi-yes")) return [1, 0];
    if (k.contains("sk-gi")) return [1, 2];
    if (k.contains("fm-gi")) return [1, 3];
    if (k.contains("rnd-gi")) return [1, 5];        // 💸 Kvällens nota (rundan.js)
    if (k.contains("nr-tile")) return [1, 4];
    if (k.contains("gm-gi")) return [2, 1];
    if (k.contains("ff-gi")) return [2, 2];
    if (k.contains("du-gi")) return [5, 2];
    if (k.contains("gg-gi")) return [3, 1];
    if (k.contains("cer-gi")) return [3, 2];
    if (k.contains("cr-gi")) return [4, 1];
    if (k.contains("chief-gi")) return [4, 3];
    if (k.contains("hs-gline")) return [4, 4];
    if (k.contains("g-acts")) return [4, 2];
    return [4, 7];                                   // unknown new tile: visible, in "Gruppen"
  }
  function sortGroup(wrap) {
    if (!wrap || wrap.__gpBusy) return;
    wrap.__gpBusy = true;
    wrap.classList.add("gp");
    var used = {}, more = 0;
    [].slice.call(wrap.children).forEach(function (c) {
      var s = sectOf(c);
      if (!s) return;
      c.setAttribute("data-gp", String(s[0]));
      c.style.order = String(s[0] * 10 + s[1]);
      if (s[2]) c.setAttribute("data-gp-wide", "1");
      if (s[0] === 5) more++;
      used[s[0]] = (used[s[0]] || 0) + 1;
    });
    SECT.forEach(function (x) {
      var h = wrap.querySelector('.gp-h[data-s="' + x[0] + '"]');
      if (!h) {
        h = document.createElement("div"); h.className = "gp-h"; h.setAttribute("data-s", String(x[0]));
        h.setAttribute("role", "heading"); h.setAttribute("aria-level", "3"); h.textContent = x[1];
        h.style.order = String(x[0] * 10); wrap.appendChild(h);
      }
      h.hidden = !used[x[0]];
    });
    var m = wrap.querySelector(".gp-more");
    if (!m) {
      m = document.createElement("button"); m.type = "button"; m.className = "gp-more"; m.style.order = "50";
      m.setAttribute("aria-expanded", "false");
      m.addEventListener("click", function () {
        var open = !wrap.classList.contains("gp-open");
        wrap.classList.toggle("gp-open", open); m.setAttribute("aria-expanded", String(open));
        lsSet("olnu.gpMore", open ? "1" : "0"); label();
      });
      wrap.appendChild(m);
      if (lsGet("olnu.gpMore", "0") === "1") { wrap.classList.add("gp-open"); m.setAttribute("aria-expanded", "true"); }
    }
    function label() { m.textContent = (wrap.classList.contains("gp-open") ? L("Mindre ▴", "Less ▴") : L("Mer… ", "More… ") + "(" + more + ") ▾"); }
    label();
    m.hidden = !more;
    wrap.__gpBusy = false;
    try { if (window.GPAGE && window.GPAGE.sorted) window.GPAGE.sorted(wrap); } catch (e) {}   // social2: + / ⋯ views
  }
  function watchGroup(wrap) {
    if (!wrap || wrap.__gpObs) return;
    sortGroup(wrap);
    var t = null;
    wrap.__gpObs = new MutationObserver(function () { if (wrap.__gpBusy) return; clearTimeout(t); t = setTimeout(function () { sortGroup(wrap); }, 30); });
    wrap.__gpObs.observe(wrap, { childList: true });
  }

  /* ---------- 2. 🏆 tabs ---------- */
  var TT = [["top", L("Topplistor", "Top lists")], ["mer", L("Meriter", "Merits")], ["streak", "Streak"], ["ev", "Event"], ["pass", L("Pass", "Passport")]];
  function ttOf(c) {
    var k = c.classList;
    if (k.contains("tt-bar")) return null;
    if (k.contains("mer-board")) return "mer";
    if (k.contains("hs-top")) return "streak";
    if (k.contains("ev-box") || k.contains("gh-box")) return "ev";
    if (k.contains("ps-toprow")) return "pass";
    if (k.contains("ws-topfoot")) return "all";
    return "top";
  }
  function sortTop(body) {
    if (body.__ttBusy) return;
    body.__ttBusy = true;
    var bar = body.querySelector(":scope > .tt-bar"), has = { top: 1 };
    [].slice.call(body.children).forEach(function (c) { var k = ttOf(c); if (!k) return; c.setAttribute("data-tt", k); has[k] = 1; });
    var foot = body.querySelector(":scope > .ws-topfoot");
    if (foot && foot !== body.lastElementChild) body.appendChild(foot);   // the "Önska" footer stays last in every tab
    if (!bar) {
      bar = document.createElement("div"); bar.className = "tt-bar"; bar.setAttribute("role", "tablist");
      bar.setAttribute("aria-label", L("Topplistan", "Top list"));
      TT.forEach(function (x) {
        var b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("data-t", x[0]); b.textContent = x[1];
        b.addEventListener("click", function () { setTab(body, x[0], true); });
        bar.appendChild(b);
      });
      body.insertBefore(bar, body.firstChild);
    }
    [].slice.call(bar.children).forEach(function (b) { b.hidden = !has[b.getAttribute("data-t")]; });
    var cur = body.getAttribute("data-tt") || lsGet("olnu.ttab", "top");
    if (!has[cur]) cur = "top";
    setTab(body, cur, false);
    body.__ttBusy = false;
  }
  function setTab(body, k, user) {
    body.setAttribute("data-tt", k);
    [].slice.call(body.querySelectorAll(":scope > .tt-bar button")).forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-t") === k)); });
    if (user) { lsSet("olnu.ttab", k); body.scrollTop = 0; }
  }
  function watchTop(body) {
    if (body.__ttObs) return;
    sortTop(body);
    var t = null;
    body.__ttObs = new MutationObserver(function () {
      if (body.__ttBusy) return;
      if (!body.querySelector(":scope > ol.toplist")) { body.__ttObs.disconnect(); body.__ttObs = null; body.removeAttribute("data-tt"); return; }
      clearTimeout(t); t = setTimeout(function () { sortTop(body); }, 30);
    });
    body.__ttObs.observe(body, { childList: true });
  }

  /* ---------- 3. ⚙️ heading for Vänner + Ölpasset ---------- */
  function fixSettings(body) {
    var nr = body.querySelector(":scope > .nr-set");
    if (!nr || body.querySelector(":scope > .p2-h-friends")) return;
    var ps = body.querySelector(":scope > .row .ps-entry");
    var first = ps ? ps.parentNode : nr;
    var h = document.createElement("h3"); h.className = "p2-h-friends"; h.textContent = L("👥 Kompisar & pass", "👥 Friends & passport");
    body.insertBefore(h, first);
    if (ps && first.nextElementSibling !== nr) body.insertBefore(nr, first.nextElementSibling);
    var ws = body.querySelector(":scope > .ws-entry");
    var wh = ws && ws.previousElementSibling;
    if (wh && wh.tagName === "H3") wh.classList.add("p2-hide");
  }

  /* ---------- wiring ---------- */
  function scan() {
    var body = document.getElementById("sheet-body");
    if (!body) return;
    if (body.__ttObs && !body.querySelector(":scope > ol.toplist")) { body.__ttObs.disconnect(); body.__ttObs = null; body.removeAttribute("data-tt"); }
    if (body.querySelector(":scope > ol.toplist")) watchTop(body);
    var w = body.querySelector(".gitem:not(.gcard) > div");
    if (w) watchGroup(w);
    if (body.querySelector(":scope > .nr-set")) fixSettings(body);
  }
  function start() {
    var body = document.getElementById("sheet-body");
    if (!body) return;
    var t = null;
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(scan, 0); }).observe(body, { childList: true, subtree: true });
    scan();
  }
  window.POLISH2 = { sortGroup: sortGroup, sortTop: sortTop, setTab: setTab, sectOf: sectOf };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
