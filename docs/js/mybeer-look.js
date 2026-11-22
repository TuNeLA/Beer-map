/* PintsNow — MYBEER_LOOK (lane mybeer, I-146 / I-147, 22 Nov 2026): how "my beer" looks. Pure data + small helpers, no DOM.
   window.MYBEER_LOOK. Used by js/mybeer.js (the ÖL! button skin, the mini bottle on the pin), js/beerlib.js (saveMini) and
   js/barsplus.js. Unit tests: tests/unit/mybeer.test.mjs.
   - look(beer, styleHex, kind) -> { sn short name, pk "b" bottle | "c" can, c1 body colour, c2 label band colour, liq beer colour }.
   - The HAND list: the ~60 most common beers in Sweden (owner I-147: "say BLANC instead of ÖL"). Colours are data (2 colours of
     the pack: body + label band; no logo, no text, no mark). Colours were set by hand, from memory of the packs: the owner may
     fix any row here. First match wins, so a special beer stands before its brand (1664 Blanc before 1664).
   - Not in the list: short name by the rule (shortName), container = bottle, body = the beer colour (the style's SRM colour),
     band = foam. No style = the colour of the strip kind; no kind = pale lager. Never an empty name: the last fall-back is "".
     The caller then shows the normal "ÖL!" (the button never shows a guessed brand).
   - inkFor(liq): the text colour with the higher contrast (dark ink or foam ink); if even that is < 4.5:1, the fill is moved
     (darker under foam ink) until it passes. The ratio is checked against the fill AND its lighter / darker gradient stops. */
(function () {
  "use strict";
  var W = typeof window !== "undefined" ? window : this;
  var HEX = /^#[0-9A-Fa-f]{6}$/;
  // ---------- the hand list: [match on the beer name (normalised), short name, container, body, label band, beer colour or ""] ----------
  // match on "name" (and on the brewery only where the 7th field is 1: one-brand breweries).
  var PALE = "#FFBF42", PILS = "#FFCA5A", WHEAT = "#FFCA5A", IPA = "#DE7C00", STOUT = "#300A06", AMBER = "#CF6900", BLOND = "#FBB123";
  var HAND = [
    [/\b1664 blanc\b|\bkronenb\w* blanc\b/, "BLANC", "b", "#2846B8", "#F4F1EA", WHEAT],
    [/\b1664\b|\bkronenbourg\b/, "1664", "b", "#22305C", "#E9DFC4", PALE],
    [/\bnorrlands? ?guld\b|\bnorrlands\b/, "NORRLANDS", "c", "#D9A92E", "#1E3570", PALE, 1],
    [/\bmariestads?\b/, "MARIESTAD", "c", "#1F4A35", "#C9A24A", PALE, 1],
    [/\bpripps\b/, "PRIPPS", "c", "#1E4FA0", "#F2F2F2", PALE, 1],
    [/\bfalcon\b/, "FALCON", "c", "#B8202E", "#E8C66A", PALE],
    [/\beriksberg\b/, "ERIKSBERG", "c", "#1C2E5C", "#C8102E", PALE, 1],
    [/\bspendrups\b/, "SPENDRUPS", "c", "#14342A", "#D4AF37", PALE],
    [/\bsofiero\b/, "SOFIERO", "c", "#E8B730", "#B3202A", PALE],
    [/\bthe bear\b/, "THE BEAR", "c", "#3A2414", "#D4AF37", AMBER],
    [/\babro\b/, "ÅBRO", "c", "#A51E22", "#F1E6C8", PALE, 1],
    [/\bmelleruds?\b/, "MELLERUD", "c", "#0F4C81", "#F2F2F2", PILS, 1],
    [/\blapin kulta\b/, "KULTA", "c", "#C99A2E", "#1B2A55", PALE],
    [/\bcarlsberg hof\b|^hof\b/, "HOF", "b", "#2B7A3D", "#C8102E", PALE],
    [/\bcarlsberg\b/, "CARLSBERG", "b", "#2B7A3D", "#F2F2EA", PILS],
    [/\btuborg\b/, "TUBORG", "b", "#1F7A3A", "#F2F2F2", PILS, 1],
    [/\bheineken\b/, "HEINEKEN", "b", "#00703C", "#E9E9E9", PALE],
    [/\bstaropramen\b/, "STARO", "b", "#7A1F2B", "#E9DFC4", PALE, 1],
    [/\bpilsner urquell\b|\burquell\b/, "URQUELL", "b", "#2E6B30", "#E9DFC4", "#FBB123"],
    [/\bbudvar\b/, "BUDVAR", "b", "#2A5A2A", "#B3202A", "#FBB123", 1],
    [/\bbudweiser\b/, "BUDWEISER", "c", "#C8102E", "#F2F2F2", PALE],
    [/\bkozel\b/, "KOZEL", "b", "#6B3A1E", "#C9A24A", PALE],
    [/\bkrusovice\b/, "KRUŠOVICE", "b", "#1B2A55", "#C8102E", PALE],
    [/\bguinness\b/, "GUINNESS", "c", "#151210", "#E9DDB8", STOUT, 1],
    [/\bkilkenny\b/, "KILKENNY", "c", "#B3202A", "#E9DDB8", "#9B3200"],
    [/\bcorona\b/, "CORONA", "b", "#F2C14E", "#1B3D8F", "#FFD878"],
    [/^sol\b/, "SOL", "b", "#F2C14E", "#C8102E", "#FFD878"],
    [/\bstella\b/, "STELLA", "b", "#2E6B30", "#C8102E", PALE],
    [/\bleffe\b/, "LEFFE", "b", "#4A2A12", "#C9A24A", BLOND, 1],
    [/\bhoegaarden\b/, "HOEGAARDEN", "b", "#E9EEF2", "#2C5DA8", WHEAT, 1],
    [/\bgrimbergen\b/, "GRIMBERGEN", "b", "#3A2414", "#C8102E", BLOND, 1],
    [/\berdinger\b/, "ERDINGER", "b", "#5A3517", "#1B3D8F", WHEAT, 1],
    [/\bpaulaner\b/, "PAULANER", "b", "#5A3517", "#2A4F9E", WHEAT, 1],
    [/\bpunk\b/, "PUNK", "c", "#27A3D8", "#F7F2E8", IPA],
    [/\belvis juice\b/, "ELVIS", "c", "#E9622A", "#F2F2F2", IPA],
    [/\bhazy jane\b/, "HAZY JANE", "c", "#F2D24B", "#E85D9E", "#FBB123"],
    [/\bbrooklyn east\b|\beast ipa\b/, "EAST IPA", "b", "#6B2A14", "#E8742A", IPA],
    [/\bdefender\b/, "DEFENDER", "b", "#1B2A55", "#E8742A", IPA],
    [/\bbrooklyn lager\b|^brooklyn$/, "BROOKLYN", "b", "#5A3517", "#2E6B30", AMBER],
    [/\blagunitas\b/, "LAGUNITAS", "b", "#5A3517", "#F2E6C8", IPA, 1],
    [/\bsierra nevada\b/, "SIERRA", "b", "#4A2A12", "#2E6B30", "#EA8F00", 1],
    [/\bship full of\b/, "SHIP IPA", "c", "#1C1C1C", "#E8C21F", IPA],
    [/\bmad canary\b/, "CANARY", "c", "#F2D24B", "#1C1C1C", "#EA8F00"],
    [/\bpoppels\b/, "POPPELS", "c", "#2D6E5A", "#F2E6C8", "#EA8F00", 1],
    [/\boppigards?\b/, "OPPIGÅRD", "b", "#5A3517", "#D9A92E", "#EA8F00", 1],
    [/\bnils oscar\b/, "N. OSCAR", "b", "#1B2A55", "#C9A24A", PALE, 1],
    [/\bjamtlands?\b/, "JÄMTLAND", "b", "#1F3A7A", "#E9DFC4", AMBER, 1],
    [/\bwisby\b/, "WISBY", "c", "#0F4C81", "#F2F2F2", PILS],
    [/\bthree hearts\b/, "3 HEARTS", "c", "#2E7D32", "#F2F2F2", PALE],
    [/\bhoga kusten\b|\bzeunerts\b/, "ZEUNERTS", "b", "#1F3A7A", "#E9DFC4", PALE, 1],
    [/\barboga\b/, "ARBOGA", "c", "#1C1C1C", "#C8102E", PALE, 1],
    [/\bsmaland\b/, "SMÅLAND", "c", "#1E4FA0", "#F2F2F2", PALE],
    [/\bgranges\b/, "GRÄNGES", "b", "#1C2E5C", "#C9A24A", PALE, 1],
    [/\bperoni\b|\bnastro azzurro\b/, "PERONI", "b", "#2E6B30", "#1E4FA0", PALE, 1],
    [/\bsan miguel\b/, "SAN MIGUEL", "b", "#2E6B30", "#D4AF37", PALE],
    [/\bstonewall\b/, "STONEWALL", "b", "#5A3517", "#7A3E9D", IPA],
    [/\bestrella\b/, "ESTRELLA", "c", "#C8102E", "#F2D24B", PALE],
    [/\basahi\b/, "ASAHI", "c", "#C9CDD3", "#1C1C1C", PALE, 1],
    [/\bsapporo\b/, "SAPPORO", "c", "#C9CDD3", "#D4AF37", PALE, 1],
    [/\bamstel\b/, "AMSTEL", "c", "#C8102E", "#F2F2F2", PALE, 1],
    [/\bbeck ?s\b/, "BECK'S", "b", "#1F7A3A", "#F2F2F2", PILS],
    [/\bduvel\b/, "DUVEL", "b", "#2A2016", "#F2F2F2", BLOND, 1],
    [/\bchimay\b/, "CHIMAY", "b", "#3A2414", "#C8102E", "#9B3200", 1],
    [/\bnewcastle\b/, "NEWCASTLE", "b", "#4A2A12", "#1E4FA0", "#671902"],
    [/\btyskie\b/, "TYSKIE", "c", "#C9A24A", "#1B2A55", PALE, 1],
    [/\blech\b/, "LECH", "c", "#1F7A3A", "#F2F2F2", PALE, 1]
  ];
  // the strip's 10 kinds (barsplus.js TYPES) -> a beer colour (style SRM colours from styles.json)
  var KIND_LIQ = { lager: PALE, pilsner: PILS, ipa: IPA, apa: "#EA8F00", stout: STOUT, vete: WHEAT, ale: AMBER, sour: "#FFD878", alkfri: PALE, annan: PALE };
  var FOAM = "#FFF6DE", INK_D = "#1A0F00", INK_L = FOAM;

  // ---------- short names (I-147: max 8 by the rule, up to 10 from the hand list; upper case; never cut with "…") ----------
  var MAX = 8, MAXH = 10;
  var FILL = {}, GEN = {};
  ("beer bier biere bière bierre biertje bere birra cerveza cerveja alus öl ol øl olut pivo piwo can cans burk boks dose dosen btl bottle flaska " +
    "flaske flasche lata lattina blik garrafa pack packung pk x vol alc abv cl ml l the de la le och and with mit med brewery brewing bryggeri " +
    "brygghus bryggeriet co & - zzgl pfand").split(" ").forEach(function (w) { FILL[w] = 1; });
  ("wheat lager pils pilsner pilsener premium original export draught draft classic ale ipa apa stout porter blonde blond blonda blanche weiss " +
    "weissbier weißbier alkoholfrei hefe hefeweizen weizen dunkel helles ljus mörk mork light lätt lättöl folköl starköl alkoholfri alkoholfritt alcohol free sans alcool " +
    "zero non alcoholic craft special extra strong gold gull guld fatöl fat organic danish swedish svensk dansk irish belgian belge belgisk german " +
    "czech red amber brown dark pale india session double imperial beer")
    .split(" ").forEach(function (w) { GEN[w] = 1; });
  var STYLE_SHORT = { ipa: "IPA", apa: "APA", neipa: "NEIPA", stout: "STOUT", porter: "PORTER", "ljus-lager": "LAGER", "tysk-pilsner": "PILS",
    "tjeckisk-pilsner": "PILS", hefeweizen: "VETE", witbier: "WIT", julol: "JULÖL" };
  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "o").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim();
  }
  function toks(s) {
    s = String(s || "").replace(/[\u2018\u2019`]/g, "'").replace(/\b[x×]\d+\b/gi, " ").replace(/\d+(?:[.,]\d+)?\s*(?:%|cl|ml|l\b|lx\d+)/gi, " ").replace(/\b\d+\s*x\s*\d*\b/gi, " ");
    return s.split(/[\s/()+,]+/).filter(function (w) { return w && !FILL[w.toLowerCase()]; });
  }
  var LETTERS = /[A-Za-zÀ-ÿĀ-ž]/g;
  function pick(ws) {
    // a name has 3+ characters and 2+ letters ("7", "X3", "A." are not names)
    var good = function (x) { return x.length >= 3 && x.toUpperCase().length <= MAX && (x.match(LETTERS) || []).length >= 2; };
    var j = ws.join(" ");
    if (good(j)) return j;
    for (var i = 0; i < ws.length; i++) if (good(ws[i])) return ws[i];   // BLANC before 1664
    return "";
  }
  function hand(name, brewery) {
    var n = norm(name), br = norm(brewery);
    for (var i = 0; i < HAND.length; i++) if (HAND[i][0].test(n)) return HAND[i];
    if (br) for (i = 0; i < HAND.length; i++) if (HAND[i][6] && HAND[i][0].test(br)) return HAND[i];
    return null;
  }
  // "" = no good name (the caller shows the normal ÖL!)
  function shortName(name, brewery, style) {
    var h = hand(name, brewery);
    if (h) return h[1];
    var w = toks(name), bw = {};
    toks(brewery).forEach(function (x) { bw[x.toLowerCase()] = 1; });
    var dist = w.filter(function (x) { return !bw[x.toLowerCase()] && !GEN[x.toLowerCase()]; });
    var brand = w.filter(function (x) { return !GEN[x.toLowerCase()]; });
    var s = pick(dist) || pick(brand) || pick(toks(brewery).slice(0, 1));
    s = (s || STYLE_SHORT[style] || "").toUpperCase();
    return okName(s) ? s : "";
  }
  // a stored short name must look like one (localStorage is not trusted): letters, digits, space . ' & ! -
  function okName(s) { return typeof s === "string" && s.length >= 1 && s.length <= MAXH && /^[0-9A-ZÀ-ÞĀ-Ž .'&!:-]+$/.test(s) && /[0-9A-ZÀ-ÞĀ-Ž]/.test(s); }

  // ---------- colour maths (WCAG 2) ----------
  function rgb(h) { h = String(h).replace("#", ""); return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  function hex(c) { return "#" + c.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? "0" : "") + v.toString(16); }).join("").toUpperCase(); }
  function lum(h) { var c = rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mix(h, t, k) { var a = rgb(h), b = rgb(t); return hex(a.map(function (v, i) { return v + (b[i] - v) * k; })); }
  // The button fill: a radial gradient hi -> liq -> lo. The label sits on hi .. liq, so the ink must pass on BOTH.
  function stops(f) { return { fill: f, hi: mix(f, "#FFFFFF", 0.18), lo: mix(f, "#000000", 0.32) }; }
  function worst(ink, s) { return Math.min(ratio(ink, s.fill), ratio(ink, s.hi)); }
  function inkFor(liq) {
    var base = HEX.test(liq || "") ? String(liq).toUpperCase() : PALE, s = stops(base);
    var d = worst(INK_D, s), l = worst(INK_L, s), ink = d >= l ? INK_D : INK_L, k = 0;
    // not enough contrast (mid colours, e.g. amber ale #C35900): move the fill away from the ink until it passes
    while (worst(ink, s) < 4.5 && k < 12) { k++; s = stops(mix(base, ink === INK_L ? "#000000" : "#FFFFFF", 0.07 * k)); }
    return { ink: ink, fill: s.fill, hi: s.hi, lo: s.lo, r: Math.round(worst(ink, s) * 100) / 100, moved: k > 0 };
  }

  // ---------- the look of one beer ----------
  // b: { id, name|n, brewery, style } (library row or the small favMini copy); styleHex: the style's colour; kind: the strip kind
  function look(b, styleHex, kind) {
    b = b || {};
    var name = b.name || b.n || "", h = hand(name, b.brewery);
    var liq = h && h[5] ? h[5] : HEX.test(styleHex || "") ? styleHex : KIND_LIQ[kind] || PALE;
    if (h) return { sn: h[1], pk: h[2], c1: h[3], c2: h[4], liq: liq.toUpperCase() };
    // not in the list: a bottle in the beer's own colour with a foam label
    return { sn: shortName(name, b.brewery, b.style), pk: "b", c1: liq.toUpperCase(), c2: FOAM, liq: liq.toUpperCase() };
  }
  // a stored look (localStorage, a friend's answer): only what we can draw safely, else null
  function clean(x) {
    if (!x || typeof x !== "object") return null;
    if (!HEX.test(x.c1 || "") || !HEX.test(x.c2 || "") || !HEX.test(x.liq || "") || (x.pk !== "b" && x.pk !== "c")) return null;
    return { sn: okName(x.sn) ? x.sn : "", pk: x.pk, c1: x.c1.toUpperCase(), c2: x.c2.toUpperCase(), liq: x.liq.toUpperCase() };
  }

  // ---------- the mini bottle / can (I-146 P1): 2 colours of the beer, an edge in foam, no logo, no text, no picture ----------
  // The edge, cap and rim colours come from CSS (docs/mybeer.css: .mb-svg .e / .r / .r2 / .sh): no colour token in JS.
  var BOTTLE = "M4.6 1.4h2.8v6.9c0 1.7 3.3 2.7 3.3 5.6v13.2c0 1-.8 1.7-1.7 1.7H3c-.9 0-1.7-.7-1.7-1.7V13.9c0-2.9 3.3-3.9 3.3-5.6z";
  var nId = 0;
  function svg(lk) {
    lk = clean(lk); if (!lk) return "";
    if (lk.pk === "c") {
      return '<svg class="mb-svg mb-can" viewBox="-1 -1 16 26" width="15" height="25" aria-hidden="true" focusable="false">' +
        '<rect class="e" x=".8" y="1.6" width="12.4" height="20.6" rx="2" fill="' + lk.c1 + '" stroke-width="1.6"/>' +
        '<rect x="1.6" y="9" width="10.8" height="6.4" fill="' + lk.c2 + '"/>' +
        '<rect class="r e" x="2" y=".6" width="10" height="2.4" rx="1.1" stroke-width=".7"/><rect class="r2" x="2" y="21" width="10" height="1.8" rx=".9"/>' +
        '<rect class="sh" x="3" y="4" width="1.3" height="15" rx=".6"/></svg>';
    }
    var id = "mbc" + (++nId);
    return '<svg class="mb-svg mb-bottle" viewBox="-1 -1 14 32" width="13" height="30" aria-hidden="true" focusable="false">' +
      '<defs><clipPath id="' + id + '"><path d="' + BOTTLE + '"/></clipPath></defs>' +
      '<path class="e" d="' + BOTTLE + '" fill="' + lk.c1 + '" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<g clip-path="url(#' + id + ')"><rect x="0" y="16.2" width="12" height="7.2" fill="' + lk.c2 + '"/>' +
      '<rect class="sh" x="2.9" y="12.5" width="1.3" height="14" rx=".6"/></g>' +
      '<rect class="e" x="4.1" y=".4" width="3.8" height="2.2" rx=".6" fill="' + lk.c2 + '" stroke-width=".9"/></svg>';
  }

  W.MYBEER_LOOK = { look: look, clean: clean, shortName: shortName, okName: okName, hand: hand, norm: norm, inkFor: inkFor, ratio: ratio, mix: mix,
    svg: svg, KIND_LIQ: KIND_LIQ, HAND: HAND, INK_D: INK_D, INK_L: INK_L, FOAM: FOAM, MAX: MAX, MAXH: MAXH };
})();
