/* Öl Nu group page folds (review2). The owner hates clutter: the group page had 14 tiles in one grid.
   Hook (app.js mods, LAST in the list so every other module has added its tile): groupItem(g, wrap, main).
   It sorts the module tiles of one group card into folds:
     always on top  : the chat, the gruppchef card, live call-outs (rally cards) and any tile that is live now
     🌙 Kvällen     : call-out, skåltimmen, engångskamera, truppen samlad / hitta nån, förfest, truppen, jam
     🎲 Spel        : lek, gänget, utmana grupp
     ☀️ Dagen efter : medaljceremonin, helgstreak
     ➕ Mer          : any tile this file does not know (a new module lands here, never on top)
   A fold is a full-width header button in the same CSS grid (the tiles stay direct children of the card, so every
   module's own CSS still applies). Default: Kvällen open 15:00–05:00, Dagen efter open 05:00–15:00, the rest closed.
   A tap is remembered on this phone (localStorage olnu.gsec, try/catch). A closed fold with something live in it
   shows a dot. Tiles that a module re-draws later are sorted again (MutationObserver on the card). */
(function () {
  "use strict";
  var KEY = "olnu.gsec";
  var SECS = [
    { k: "kvall", sv: "🌙 Kvällen", en: "🌙 Tonight" },
    { k: "spel", sv: "🎲 Spel", en: "🎲 Games" },
    { k: "dagen", sv: "☀️ Dagen efter", en: "☀️ Day after" },
    { k: "mer", sv: "➕ Mer", en: "➕ More" }
  ];
  var ORDER = { kvall: 3, spel: 4, dagen: 5, mer: 6 };
  var BY_CLASS = {
    "sk-gi": "kvall", "fm-gi": "kvall", "nr-tile": "kvall", "ff-gi": "kvall", "cr-gi": "kvall",
    "gm-gi": "spel", "gg-gi": "spel", "du-gi": "spel",
    "cer-gi": "dagen", "hs-gline": "dagen"
  };
  var TOP_CLASS = ["gmain", "g-acts", "g-foot", "confirm", "chief-gi", "rl-group-item", "g-sec-h"];
  var A = null;

  function sv() { return !(window.I18N && window.I18N.lang === "en"); }
  function readState() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  function saveState(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function hourNow() {
    try { return +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23" }).format(new Date()); }
    catch (e) { return new Date().getHours(); }
  }
  function defaultOpen(k) {
    var h = hourNow(), evening = h >= 15 || h < 5;
    return k === "kvall" ? evening : k === "dagen" ? !evening : false;
  }
  function isOpen(k) { var s = readState(); return s[k] == null ? defaultOpen(k) : !!s[k]; }
  function hasClass(x, c) { return x.classList && x.classList.contains(c); }
  function secOf(x, wrap) {
    if (!x || x.nodeType !== 1) return null;
    for (var i = 0; i < TOP_CLASS.length; i++) if (hasClass(x, TOP_CLASS[i])) return "top";
    // the chat row (social.js) is the first plain .row; social.js also adds the jam row (.jam-host inside)
    if (hasClass(x, "row")) {
      if (x.querySelector(".jam-host")) return "kvall";
      var first = null;
      for (var j = 0; j < wrap.children.length; j++) if (hasClass(wrap.children[j], "row")) { first = wrap.children[j]; break; }
      if (x === first || x.getAttribute("data-gsec") === "top") return "top";
      return "kvall";   // the rally "Kalla in" row and other one-button rows of the night
    }
    for (var c in BY_CLASS) if (hasClass(x, c)) return BY_CLASS[c];
    return "mer";
  }
  function live(x) { return !!(x.querySelector && x.querySelector(".live, .new, .hx-urgent")) || hasClass(x, "live"); }

  function arrange(wrap) {
    if (wrap._gsBusy) return;
    wrap._gsBusy = true;
    try {
      var heads = wrap._gsHeads, kids = Array.prototype.slice.call(wrap.children), groups = {};
      kids.forEach(function (x) {
        if (hasClass(x, "g-sec-h")) return;
        var k = x.getAttribute("data-gsec") || secOf(x, wrap);
        if (!k) return;
        x.setAttribute("data-gsec", k);
        if (k === "top") {
          // the gruppchef card is a status card of the night: on top (polish.css puts it last)
          if (hasClass(x, "chief-gi")) x.style.order = "1";
          return;
        }
        // a tile that is live right now (skåltimme running, new roll) stays on top
        if (live(x)) { x.classList.remove("g-fold-off"); x.style.order = "2"; return; }
        (groups[k] = groups[k] || []).push(x);
      });
      SECS.forEach(function (s) {
        var list = groups[s.k] || [], h = heads[s.k];
        if (!list.length) { if (h) h.hidden = true; return; }
        if (!h) {
          h = document.createElement("button");
          h.type = "button"; h.className = "g-sec-h"; h.setAttribute("data-k", s.k);
          h.addEventListener("click", function () {
            var st = readState(); st[s.k] = !isOpen(s.k); saveState(st); arrange(wrap);
          });
          heads[s.k] = h;
          // the header goes before its tiles in DOM order (same CSS order value = DOM order decides)
          wrap.insertBefore(h, list[0]);
        }
        var open = isOpen(s.k);
        h.hidden = false;
        h.style.order = String(ORDER[s.k]);
        h.setAttribute("aria-expanded", open ? "true" : "false");
        var dot = !open && list.some(live);
        h.textContent = "";
        var t = document.createElement("span"); t.className = "g-sec-t"; t.textContent = sv() ? s.sv : s.en;
        var n = document.createElement("span"); n.className = "g-sec-n"; n.textContent = String(list.length) + (dot ? " ●" : "");
        var c = document.createElement("span"); c.className = "g-sec-c"; c.setAttribute("aria-hidden", "true"); c.textContent = open ? "▴" : "▾";
        h.appendChild(t); h.appendChild(n); h.appendChild(c);
        list.forEach(function (x) {
          x.style.order = String(ORDER[s.k]);
          x.classList.toggle("g-fold-off", !open);
          if (x.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) wrap.insertBefore(h, x);
        });
      });
    } catch (e) { try { console.warn("olnu gpage", e); } catch (x) {} }
    wrap._gsBusy = false;
  }

  window.GPAGE = {
    init: function (api) { A = api; },
    groupItem: function (g, wrap) {
      if (!wrap || wrap._gsHeads) return;
      wrap._gsHeads = {};
      wrap.classList.add("g-folds");
      arrange(wrap);
      if (window.MutationObserver) {
        var mo = new MutationObserver(function () { if (!wrap._gsBusy) arrange(wrap); });
        mo.observe(wrap, { childList: true });
      }
    },
    _arrange: arrange
  };
})();
