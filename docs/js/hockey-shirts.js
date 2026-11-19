/* PintsNow — HOCKEY SHIRTS: hockey shirts in town colours for the avatar (I-116, lane hockeybuild, owner default A28).
   Owner: "I have a lot of Leksand supporters that are using my app. Imagine if they could have the Leksand shirts."
   Rule (legal): colours and a simple generic stripe pattern ONLY. No crest, no wordmark, no sponsor mark, no copy of a
   club's own jersey layout. The label is the TOWN and the colours ("Leksand (blå-vit)"), never the club's name or logo.
   - ONE data file: TEAMS below. Each row: tm (FIXED index, never re-used; spec key "tm"), lg (league 2026/27), town,
     col (colour words, sv; en from WORDS), c [main, second, third] hex, pat (pattern), src (where the colours come from).
     Research: pintsnow-ops research/hockey/teams.json (checked 2026-11-19). Leksand is in HockeyAllsvenskan 2026/27.
   - NOT here (no colour source yet, owner A28: add only when a source is found): Djurgården (Stockholm), Södertälje,
     Almtuna (Uppsala), Vimmerby, Visby/Roma, Östersund. They get tm 23-28 when they come (the server max is 28).
   - Spec: tm = 1..28 (0 / missing = no team shirt). It draws over the top ("up" stays as it is, so an old app shows the
     old top). Needs SQL olnu_avatar_max "tm": 28; an old server says invalid_avatar → saved without tm (avatar.js setSpec).
   - Patterns (our own, generic): classic = 2 stripes on each sleeve + 2 at the hem; band = one wide chest band;
     yoke = contrast shoulders + one hem stripe; hoops = 3 wide hoops. V collar in the third colour.
   Public: PN.hockey {TEAMS, LEAGUES, MAXTM, team, main, label, svg, section}. Used by js/avatar.js and js/avwiz.js. */
(function () {
  "use strict";
  var TEAMS = [
    // SHL 2026/27
    // Umeå (Björklöven): https://logotyp.us/logo/bjorkloven/ (colour names; hex partly ours)
    { tm: 1, lg: "SHL", town: "Umeå", col: "grön-gul", c: ["#016243", "#F0D200", "#FFFFFF"], pat: "classic", src: "https://logotyp.us/logo/bjorkloven/" },
    // Gävle (Brynäs): https://logotyp.us/logo/brynas/ (colour names; hex partly ours)
    { tm: 2, lg: "SHL", town: "Gävle", col: "svart-gul", c: ["#201600", "#F3C644", "#FFFFFF"], pat: "band", src: "https://logotyp.us/logo/brynas/" },
    // Karlstad (Färjestad)
    { tm: 3, lg: "SHL", town: "Karlstad", col: "grön-vit", c: ["#009B5E", "#FFFFFF", "#FFD121"], pat: "hoops", src: "https://teamcolorcodes.com/farjestad-bk-color-codes/" },
    // Göteborg (Frölunda)
    { tm: 4, lg: "SHL", town: "Göteborg", col: "grön-vit", c: ["#00573F", "#FFFFFF", "#C8102E"], pat: "yoke", src: "https://teamcolorcodes.com/frolunda-hc-color-codes/" },
    // Jönköping (HV71)
    { tm: 5, lg: "SHL", town: "Jönköping", col: "blå-gul", c: ["#0C2950", "#FCD213", "#FFFFFF"], pat: "classic", src: "https://teamcolorcodes.com/hv71-color-codes/" },
    // Linköping (Linköping HC)
    { tm: 6, lg: "SHL", town: "Linköping", col: "blå-vit", c: ["#003690", "#FFFFFF", "#FF151F"], pat: "band", src: "https://teamcolorcodes.com/linkoping-hc-color-codes/" },
    // Luleå (Luleå HF)
    { tm: 7, lg: "SHL", town: "Luleå", col: "röd-gul", c: ["#E30613", "#FFCC00", "#1D1D1B"], pat: "hoops", src: "https://teamcolorcodes.com/lulea-hf-color-codes/" },
    // Malmö (Malmö Redhawks)
    { tm: 8, lg: "SHL", town: "Malmö", col: "röd-svart", c: ["#ED1C24", "#1A1A1A", "#FFFFFF"], pat: "classic", src: "https://teamcolorcodes.com/malmo-redhawks-color-codes/" },
    // Örebro (Örebro HK)
    { tm: 9, lg: "SHL", town: "Örebro", col: "röd-svart", c: ["#ED1737", "#1A1A1A", "#FFFFFF"], pat: "yoke", src: "https://teamcolorcodes.com/orebro-hk-color-codes/" },
    // Ängelholm (Rögle)
    { tm: 10, lg: "SHL", town: "Ängelholm", col: "röd-grön", c: ["#B0141E", "#118235", "#FFFFFF"], pat: "band", src: "https://teamcolorcodes.com/rogle-bk-color-codes/" },
    // Skellefteå (Skellefteå AIK)
    { tm: 11, lg: "SHL", town: "Skellefteå", col: "svart-gul", c: ["#1A1A1A", "#FFC323", "#FFFFFF"], pat: "classic", src: "https://teamcolorcodes.com/skelleftea-aik-color-codes/" },
    // Timrå (Timrå IK)
    { tm: 12, lg: "SHL", town: "Timrå", col: "röd-blå", c: ["#EB2B2E", "#264FA6", "#FFFFFF"], pat: "hoops", src: "https://teamcolorcodes.com/timra-ik-color-codes/" },
    // Växjö (Växjö Lakers)
    { tm: 13, lg: "SHL", town: "Växjö", col: "blå-orange", c: ["#013A80", "#F37835", "#FFFFFF"], pat: "yoke", src: "https://teamcolorcodes.com/vaxjo-lakers-hc-color-codes/" },
    // HockeyAllsvenskan 2026/27
    // Stockholm (AIK): https://logotyp.us/logo/aik-if/ (navy + gold); black + yellow = the common colours (hex ours)
    { tm: 14, lg: "HA", town: "Stockholm", col: "svart-gul", c: ["#1A1A1A", "#FFE800", "#FFFFFF"], pat: "classic", src: "https://logotyp.us/logo/aik-if/" },
    // Kalmar (Kalmar HC): red and yellow (hex ours)
    { tm: 15, lg: "HA", town: "Kalmar", col: "röd-gul", c: ["#D0202E", "#FFD21F", "#FFFFFF"], pat: "hoops", src: "https://icehockey.fandom.com/wiki/Kalmar_HC" },
    // Karlskoga (BIK Karlskoga): blue and white (hex labels doubtful)
    { tm: 16, lg: "HA", town: "Karlskoga", col: "blå-vit", c: ["#026DBC", "#FFFFFF", "#08467F"], pat: "yoke", src: "https://logotyp.us/logo/karlskoga/" },
    // Leksand (Leksands IF): dark blue + white (no yellow); third colour = our darker blue
    { tm: 17, lg: "HA", town: "Leksand", col: "blå-vit", c: ["#26358C", "#FFFFFF", "#161F5C"], pat: "classic", src: "https://teamcolorcodes.com/leksands-if-color-codes/" },
    // Örnsköldsvik (MoDo)
    { tm: 18, lg: "HA", town: "Örnsköldsvik", col: "röd-svart", c: ["#E01C21", "#1A1A1A", "#FFFFFF"], pat: "band", src: "https://teamcolorcodes.com/modo-hockey-color-codes/" },
    // Mora (Mora IK): https://logotyp.us/logo/mora/ + https://internationalhockeywiki.com/ihw/index.php/Mora_IK
    { tm: 19, lg: "HA", town: "Mora", col: "röd-vit", c: ["#EE2621", "#FFFFFF", "#077F35"], pat: "hoops", src: "https://logotyp.us/logo/mora/" },
    // Nybro (Nybro Vikings): red, black, white (hex ours)
    { tm: 20, lg: "HA", town: "Nybro", col: "röd-svart", c: ["#C8102E", "#1A1A1A", "#FFFFFF"], pat: "yoke", src: "https://en.wikipedia.org/wiki/Nybro_Vikings" },
    // Oskarshamn (IK Oskarshamn)
    { tm: 21, lg: "HA", town: "Oskarshamn", col: "blå-röd", c: ["#154281", "#ED192D", "#FFFFFF"], pat: "classic", src: "https://teamcolorcodes.com/ik-oskarshamn-color-codes/" },
    // Västerås (Västerås IK): yellow and black (hex ours)
    { tm: 22, lg: "HA", town: "Västerås", col: "gul-svart", c: ["#FFD21F", "#1A1A1A", "#FFFFFF"], pat: "hoops", src: "https://en.wikipedia.org/wiki/V%C3%A4ster%C3%A5s_IK" }
  ];
  var LEAGUES = [["SHL", "SHL 2026/27", "SHL 2026/27"], ["HA", "HockeyAllsvenskan 2026/27", "HockeyAllsvenskan 2026/27"]];
  var MAXTM = 28;   // = SQL olnu_avatar_max "tm" (room for the 6 towns without a source yet)
  var WORDS = { "blå": "blue", "vit": "white", "gul": "yellow", "grön": "green", "röd": "red", "svart": "black", "orange": "orange" };
  var BY = {};
  TEAMS.forEach(function (t) { BY[t.tm] = t; });

  function sv() { var I = window.I18N; return !I || I.lang !== "en"; }
  function team(n) { return BY[n | 0] || null; }
  function main(n) { var t = team(n); return t ? t.c[0] : null; }
  function label(t, isSv) {
    var c = isSv ? t.col : t.col.split("-").map(function (w) { return WORDS[w] || w; }).join("-");
    return t.town + " (" + c + ")";
  }

  /* ---------- art (viewBox 0 0 100 100; H = avatar.js XH helpers; the top layer is clipped to the body outline) ---------- */
  var SL = [["M5,86 L19,81 L20.2,84.6 L5.6,89.6Z", "M95,86 L81,81 L79.8,84.6 L94.4,89.6Z"], ["M5.6,91 L20.6,86 L21.8,89.6 L6.2,94.8Z", "M94.4,91 L79.4,86 L78.2,89.6 L93.8,94.8Z"]];
  var YOKE = "M0,100 C2,84 22,77 38,75 L62,75 C78,77 98,84 100,100 L94,100 C92,92 82,83.2 62,81.8 L38,81.8 C18,83.2 8,92 6,100Z";
  var COLLAR = "M38,75 C40,80 44,82 50,82 C56,82 60,80 62,75 L58,75 C56,78 54,79 50,79 C46,79 44,78 42,75Z";
  function pattern(t, H) {
    var a = t.c[1], b = t.c[2], o = "";
    if (t.pat === "classic") {
      o += H.P(SL[0][0], a) + H.P(SL[0][1], a) + H.P(SL[1][0], b) + H.P(SL[1][1], b);
      o += H.R(0, 91.5, 100, 2.6, 0, a) + H.R(0, 95.4, 100, 1.6, 0, b);
    } else if (t.pat === "band") {
      o += H.R(0, 83, 100, 5.6, 0, a) + H.R(0, 81.2, 100, 1.1, 0, b) + H.R(0, 89.3, 100, 1.1, 0, b);
    } else if (t.pat === "yoke") {
      o += H.P(YOKE, a) + H.R(0, 93.4, 100, 2.4, 0, a);
    } else if (t.pat === "hoops") {
      o += H.R(0, 78.5, 100, 3.6, 0, a) + H.R(0, 86.8, 100, 3.6, 0, a) + H.R(0, 95.1, 100, 3.6, 0, a);
    }
    return o;
  }
  function svg(s, H) {
    var t = s && team(s.tm);
    if (!t || !H || !H.cel || !H.SHOULDERS) return null;
    var m = t.c[0], lite = H.lite && H.lite();
    var o = H.cel(H.SHOULDERS, m, { w: [2.6, 1.6], v: [1, 1] }) + pattern(t, H) + H.P(COLLAR, t.c[2]);
    o += H.P("M47.6,79.6 L52.4,79.6 L50,86.5Z", H.shade(m, -0.3));   // the V of the lace collar
    if (!lite) o += H.S("M48.4,81.6 L51.6,82.4 M48.9,83.8 L51.1,84.6", t.c[2], 0.6);
    return o;
  }

  /* ---------- the picker (avatar editor "Tröja & jacka" and the wizard step "Kläder") ----------
     o = {cls "ave" | "avw", draft (the spec being edited), scope (element: its "up" tiles lose .on on a pick),
     observe(tile) (editor: lazy art; the tile has data-k="tm" data-i=n data-vb), art(spec, vb) (wizard: SVG now), onPick()}. */
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  // the tile shows the shirt big: the neck crop of the avatar (same as the Hals tiles), so the stripes can be seen
  function tileVB() { var A = window.AVATAR; return (A && A.VB && A.VB.NECK) || ""; }
  function tile(t, o, isSv) {
    var c = o.cls, on = (o.draft.tm | 0) === t.tm, nm = label(t, isSv), vb = tileVB();
    var b = el("button", c + "-tile hk-tile" + (on ? " on" : ""));
    b.type = "button"; b.setAttribute("aria-pressed", on ? "true" : "false"); b.setAttribute("aria-label", nm);
    b.setAttribute("data-k", "tm"); b.setAttribute("data-i", String(t.tm)); if (vb) b.setAttribute("data-vb", vb);
    var art = el("span", c + "-art");
    if (o.art) { var sp = JSON.parse(JSON.stringify(o.draft)); sp.tm = t.tm; art.innerHTML = o.art(sp, vb); }
    b.appendChild(art);
    var n = el("span", c + "-nm"); n.appendChild(document.createTextNode(t.town)); n.appendChild(el("br")); n.appendChild(document.createTextNode(label(t, isSv).slice(t.town.length + 1)));
    b.appendChild(n);
    b.addEventListener("click", function () {
      o.draft.tm = t.tm;
      (o.scope || document).querySelectorAll('[data-k="up"].on, [data-k="tm"].on').forEach(function (x) { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
      b.classList.add("on"); b.setAttribute("aria-pressed", "true");
      if (o.onPick) o.onPick(t.tm);
    });
    if (o.observe) o.observe(b);
    return b;
  }
  function section(o) {
    var isSv = sv(), c = o.cls, box = el("div", (c === "ave" ? "ave-cols " : "") + "hk-sec");
    box.setAttribute("data-hk", "1");
    box.appendChild(el("h4", c === "avw" ? "avw-lh" : "", isSv ? "Hockeytröja i stadens färger" : "Hockey shirt in town colours"));
    box.appendChild(el("p", c === "avw" ? "avw-note" : "muted ave-note", isSv ? "Bara färger och ränder. Inga klubbmärken." : "Only colours and stripes. No club badges."));
    LEAGUES.forEach(function (lg) {
      var list = TEAMS.filter(function (t) { return t.lg === lg[0]; });
      if (!list.length) return;
      box.appendChild(el("h4", c === "avw" ? "avw-lh hk-lg" : "hk-lg", isSv ? lg[1] : lg[2]));
      var g = el("div", c + "-grid hk-grid");
      g.setAttribute("data-lg", lg[0]);
      list.forEach(function (t) { g.appendChild(tile(t, o, isSv)); });
      box.appendChild(g);
    });
    return box;
  }

  function register() {
    var AV = window.AVATAR;
    if (!AV || !AV.MAX) return false;
    AV.MAX.tm = MAXTM;
    return true;
  }
  register();
  PN.hockey = { TEAMS: TEAMS, LEAGUES: LEAGUES, MAXTM: MAXTM, team: team, main: main, label: label, svg: svg, section: section, register: register };
})();
