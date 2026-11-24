/* PintsNow — the app language (E8, owner 14 Nov 2026 "start English texts"; OWNER-INPUTS D5: Swedish only until the Nordic
   plan, the English switch later). Loads right before js/i18n.js and makes window.I18N; i18n.js adds the strings (add, t).
   - Every normal user gets Swedish. English is BEHIND A TEST FLAG: on in a test build (the /test/ path, the staging config,
     window.PN_DEV) or on this device after ?langtest=1 (?langtest=0 = off, even on a test build). With the flag off a stored "en" is ignored
     and removed (the old SAFE rule of 7 Nov).
   - With the flag on: ?lang=en|sv picks the language, and Inställningar > Karta & dialekt has the switch (settingsRow, put
     there by account.js). The choice is per device (localStorage "olnu.lang"). A change reloads the app: the modules read
     their texts once at start. <html lang> follows; dates and numbers: sv-SE or en-GB (I18N.locale / num / date / time).
   - The dialect packs (js/dialekt.js) are Swedish only: in English the Dialekt row is not shown (account.js).
   - Texts that live in CSS content: get their English twin here (EN_CSS, only injected in English).
   Tests: tests/unit/i18n.test.mjs (flag rules + no new Swedish text outside I18N), tests/e2e/i18n-pw.js (the screens). */
(function () {
  "use strict";
  var LIVE_REF = "wcdskpcevbhouvbytkhv", LK = "olnu.lang", FK = "olnu.langtest";
  var LOCALE = { sv: "sv-SE", en: "en-GB" };
  // the 42 ranks in English (same order as social.js TITLES; the server keeps the Swedish names)
  var RANK_EN = {}, RANK_SV = ["Rekryt Lättöl", "Värnpliktig Veteöl", "Menig Mellanöl", "Vicekorpral Kapsyl", "Korpral Kranöl", "Skumsergeant",
    "Översergeant Sejdel", "Stabssergeant Sixpack", "Fanjunkare Flaskhals", "Förvaltare Folköl", "Fänrik Fatöl", "Löjtnant Lager",
    "Premiärlöjtnant Pilsner", "Kapten Kagge", "Stabskapten Stout", "Major Mikrobryggeri", "Överstelöjtnant Ölback", "Överste Stor Stark",
    "Brigadgeneral Burköl", "Generalmajor Mörköl", "Generallöjtnant IPA", "General Guldbärs", "Överbefälhavare Öl", "Fältmarskalk Humle",
    "Riksmarskalk Malt", "Generalissimus Ale", "Ärkegeneral Ölhall", "Supergeneral Pint", "Krigsherre Porter", "Kommendant Julöl",
    "Imperator Påsköl", "Stormarskalk Ölstop", "Kejsargeneral Ölmage", "Fältherre Öltält", "General Oktoberfest", "Supermarskalk Pubrunda",
    "Överkommendant Ölglas", "Ärkemarskalk Ölbricka", "Krigsgud Hembrygd", "Ölgudens Överste", "Ölgudens Livgarde", "Ölguden"];
  ["Recruit Light Beer", "Conscript Wheat Beer", "Private Pale", "Lance Corporal Cap", "Corporal Draught", "Sergeant Foam",
    "Staff Sergeant Stein", "Sergeant Major Sixpack", "Warrant Officer Bottleneck", "Chief Warrant Officer Session", "Ensign Keg", "Lieutenant Lager",
    "First Lieutenant Pilsner", "Captain Cask", "Staff Captain Stout", "Major Microbrewery", "Lieutenant Colonel Crate", "Colonel Large Lager",
    "Brigadier Can", "Major General Dark Beer", "Lieutenant General IPA", "General Gold Brew", "Supreme Commander Beer", "Field Marshal Hops",
    "Grand Marshal Malt", "Generalissimo Ale", "Archgeneral Beer Hall", "Supergeneral Pint", "Warlord Porter", "Commandant Christmas Ale",
    "Emperor Easter Ale", "Great Marshal Tankard", "Emperor General Beer Belly", "Field Commander Beer Tent", "General Oktoberfest", "Super Marshal Pub Crawl",
    "High Commandant Beer Glass", "Arch Marshal Beer Tray", "War God Home Brew", "Colonel of the Beer God", "Guard of the Beer God", "The Beer God"]
    .forEach(function (e, i) { RANK_EN[RANK_SV[i]] = e; });
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function testBuild() {
    try {
      if (window.PN_DEV === true || /\/test\//.test(location.pathname || "")) return true;
      var c = window.OLNU_CONFIG || {};
      return !!(c.SUPABASE_URL && String(c.SUPABASE_URL).indexOf(LIVE_REF) < 0);   // the staging config
    } catch (e) { return false; }
  }
  var q = ""; try { q = String(location.search || ""); } catch (e) {}
  var mFlag = /[?&]langtest=([01])(?:&|$)/.exec(q);
  if (mFlag) lsSet(FK, mFlag[1]);
  var FLAG = lsGet(FK) !== "0" && (testBuild() || lsGet(FK) === "1");   // "0" = off, also on a test build (a normal-user check)
  var mLang = /[?&]lang=(sv|en)(?:&|$)/.exec(q);
  if (FLAG && mLang) lsSet(LK, mLang[1]);
  if (mFlag || mLang) {   // a reload or a shared link must not set it again
    try {
      var ps = new URLSearchParams(q); ps.delete("langtest"); ps.delete("lang");
      history.replaceState(history.state, "", location.pathname + (ps.toString() ? "?" + ps : "") + location.hash);
    } catch (e) {}
  }
  var lang = FLAG && lsGet(LK) === "en" ? "en" : "sv";
  if (!FLAG && lsGet(LK) === "en") lsSet(LK, "sv");

  var I18N = window.I18N = {
    get lang() { return lang; },
    // true when this device may pick English (the test flag). Normal users: false, and set() keeps Swedish.
    available: function () { return FLAG; },
    // set(l): store the choice for this device (no reload; switchTo reloads)
    set: function (l) {
      lang = FLAG && l === "en" ? "en" : "sv";
      lsSet(LK, lang); document.documentElement.lang = lang;
      return lang;
    },
    switchTo: function (l) { var was = lang; if (I18N.set(l) !== was) { try { location.reload(); } catch (e) {} } },
    // dates and numbers for people: "sv-SE" or "en-GB" (both a 24 h clock), Stockholm time
    locale: function () { return LOCALE[lang]; },
    num: function (n, o) { try { return Number(n).toLocaleString(LOCALE[lang], o); } catch (e) { return String(n); } },
    date: function (d, o) {
      try { return new Date(d).toLocaleDateString(LOCALE[lang], Object.assign({ timeZone: "Europe/Stockholm" }, o || {})); } catch (e) { return ""; }
    },
    time: function (d) {
      try { return new Date(d).toLocaleTimeString(LOCALE[lang], { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" }); } catch (e) { return ""; }
    },
    // L(sv, en): a one-off text pair for code without a string key (same as the L() helpers inside the modules)
    L: function (s, e) { return lang === "en" && e != null ? e : s; },
    // a rank name of the title ladder (social.js TITLES, SQL olnu_titles) in the app language; other names stay as they are
    rank: function (t) { return lang === "en" && Object.prototype.hasOwnProperty.call(RANK_EN, t) ? RANK_EN[t] : t; },
    settingsRow: settingsRow
  };
  document.documentElement.lang = lang;

  // The Språk row for Inställningar > Karta & dialekt: it looks like the Kartstil row (basemap.js): a settings row with a
  // 2-item segmented control + one hint line. Each language says its own name (lang attribute for screen readers).
  function settingsRow() {
    var f = document.createDocumentFragment(), P = window.PNI;
    var lab = document.createElement("span");
    try { if (P && P.has && P.has("globe")) lab.innerHTML = P.svg("globe", "pi-lead"); } catch (e) {}
    lab.appendChild(document.createTextNode(I18N.L("Språk", "Language")));
    var seg = document.createElement("div"); seg.className = "ds-seg bm-seg2 pn-lang-seg";
    seg.setAttribute("role", "radiogroup"); seg.setAttribute("aria-label", I18N.L("Språk", "Language"));
    [["sv", "Svenska"], ["en", "English"]].forEach(function (x) {
      var b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("lang", x[0]);
      b.setAttribute("data-lang", x[0]); b.setAttribute("aria-checked", String(lang === x[0]));
      var n = document.createElement("span"); n.className = "bm-n"; n.textContent = x[1]; b.appendChild(n);
      b.addEventListener("click", function () { if (x[0] !== lang) I18N.switchTo(x[0]); });
      seg.appendChild(b);
    });
    var row = document.createElement("div"); row.className = "toggle-row bm-row pn-lang";
    row.appendChild(lab); row.appendChild(seg);
    var hint = document.createElement("p"); hint.className = "muted bm-hint pn-lang-hint";
    hint.textContent = I18N.L("Test: engelska är inte klar. Bara i testversionen. Appen laddas om när du byter.",
      "Test: English is not finished. Test builds only. The app reloads when you switch.");
    f.appendChild(row); f.appendChild(hint);
    return f;
  }

  // CSS content: texts (pnds.css, gw.css) in English. Same selectors + html:lang(en), so they win only in English.
  var EN_CSS =
    'html:lang(en) body #prec-seg>#prec-exact[aria-checked="true"]::after{content:"Exact spot\\A On" !important}' +
    'html:lang(en) body #prec-seg>#prec-area[aria-checked="true"]::after{content:"Exact spot\\A Off" !important}' +
    'html:lang(en) .pill.pq::before{content:"Chill"}' +
    'html:lang(en):not(.pn-settle) .ticker.pn-kaos .tk-live::after{content:"CHAOS"}' +
    // "BEER!" is 5 letters where "ÖL!" is 3: a smaller token size so it fits the round button (fs-44 / fs-34 are for 3)
    'html:lang(en) .beer-btn:not(.cooldown) .beer-label{font-size:var(--fs-28) !important;letter-spacing:0 !important}' +
    '@media (max-width:380px){html:lang(en) .beer-btn:not(.cooldown) .beer-label{font-size:var(--fs-22) !important}}';
  if (lang === "en") {
    var st = document.createElement("style"); st.id = "pn-lang-en"; st.textContent = EN_CSS;
    (document.head || document.documentElement).appendChild(st);
  }
})();
