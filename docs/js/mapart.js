/* PintsNow map art v1 (scratchpad mapart): tokens + glyphs + marker renderer in one file. window.PNTOKENS, PNGLYPHS, PNPINS.
   Load before js/glmap.js. Original glyphs (no third-party icon set). Rebuild: mapart/build.js. */
/* PintsNow map marker tokens (mapart v1). ONE source for the SVG masters, the sprite build and the canvas spec.
   All sizes are CSS px at 1x. Integer grid: every straight edge and every centre sits on a whole or half pixel at 1x,
   so it lands on whole device pixels at 2x and 3x (centre of an even-sized disc = a pixel corner). */
(function (root) {
  var T = {
    col: {
      ink: "#0A0F24",        // app icon bottom / marker bodies (pills, chips, clusters)
      navy: "#152050",       // app icon top / quiet bar disc
      navy2: "#1E2B66",      // quiet disc top highlight (gradient stop)
      amber: "#F5A623",      // brand amber = busy / people
      amberHi: "#FFC24D",    // amber text on ink, pub tint
      amberDeep: "#CC7810",  // amber shade (busy disc bottom stop)
      foam: "#FFFAF0",       // foam = rings, light text
      foam2: "#E9D9BA",      // foam shade
      green: "#3DDC84",      // friends / live / mine
      greenInk: "#00260F",
      red: "#FF5A4E",        // packed / medevac (always with a cross or a 3-bar meter, never alone)
      blue: "#4AA3FF",       // you (me-dot), arenas / info
      lilac: "#D9B8FF",      // other drinks
      slate: "#2A3557",      // restaurant / place dots (low emphasis)
      edge: "rgba(4,7,20,0.62)",   // 1 px ink hairline outside every foam ring (reads on the light parts of Skymning)
      shadow: "rgba(0,0,0,0.45)",  // drop shadow: 0 1 2.5
      labelText: "#FFF6E5", labelHalo: "rgba(8,12,30,0.92)"
    },
    // glyph tint per category ON the navy disc (>= 3:1 against #152050, checked by build.js)
    tint: {
      // map BR1: tint = family (beer amber · mixed pink · wine rose · party violet · sport blue · food+bar lime); shape = type
      pub: "#FFC24D", olbar: "#F2A86E", biergarten: "#E3C45C", nation: "#FFDA8F", brewery: "#F2A86E",
      bar: "#FFA3C7", cocktail: "#FF8FB8", hotellbar: "#FFB8DC", vinbar: "#FF7A93",
      nightclub: "#BCA6FF", karaoke: "#F7A1F0", livescen: "#C3B4FF", spelbar: "#A8BDFF",
      sportsbar: "#8CC6FF", restbar: "#C6E26E",
      restaurant: "#7FD8CF", cafe: "#E6BC93", fastfood: "#FF9E90", kebab: "#FFB27A",
      sun: "#FFC24D", note: "#C3B4FF", parasol: "#8FD8FF",
      hockey: "#FFFAF0", fotboll: "#FFFAF0", arena: "#FFFAF0"
    },
    // app data type -> marker category (bars.json has pub / bar / nightclub / biergarten today)
    // map BR1: venue key (window.PNVTYPE) or raw OSM type -> glyph. OSM "bar" is the generic Bar now (was the martini)
    typeMap: { pub: "pub", bar: "bar", cocktail: "cocktail", vinbar: "vinbar", olbar: "olbar", brewery: "olbar", nattklubb: "nightclub",
      nightclub: "nightclub", club: "nightclub", sportbar: "sportsbar", sports_bar: "sportsbar", karaoke: "karaoke", karaoke_box: "karaoke",
      livescen: "livescen", music_venue: "livescen", restbar: "restbar", restaurant_bar: "restbar", hotellbar: "hotellbar",
      oltradgard: "biergarten", biergarten: "biergarten", beer_garden: "biergarten", spelbar: "spelbar", nation: "nation",
      restaurant: "restaurant", cafe: "cafe", fast_food: "fastfood", kebab: "kebab", hockey: "hockey", fotboll: "fotboll", arena: "arena" },
    font: '"Chakra Petch", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    size: {
      ring: 2,            // foam ring on every disc
      edge: 1,            // ink hairline outside the ring
      shadowY: 1, shadowBlur: 2.5, pad: 3,   // sprite padding around every asset (room for the shadow)
      dotQuiet: 18, dotBusy: 20, dotHiScale: 1.2,   // (old dot sizes; town-view disc = dotBusy + 4)
      dot: 32, glyphDot: 18, dotBadge: 14,   // map B9 + M2: a dot = the full disc (drawn at the z >= 16 size; glmap scales all by zoom)
      glyphQuiet: 11, glyphBusy: 12,
      full: 28, fullHi: 32, glyphFull: 16, glyphFullHi: 18,
      badge: 12, crownW: 14, crownH: 10,
      pillH: 22, pillR: 11, pillPadL: 7, pillPadR: 9, pillGap: 4, pillGlyph: 14, pillTop: 3,   // pill sits 3 px under the disc
      chipH: 18, chipR: 9, chipPad: 5, chipGlyph: 12,
      tagH: 14, tagR: 7,
      labelSize: 15, labelHalo: 3, labelMax: 160, labelLines: 2,   // map M2: drawn at the z >= 16 size (x 0.875 = 13 px); R1-33: 2 lines
      meDot: 18, meCore: 12,
      clusterSteps: [[10, 28], [100, 32], [1000, 38], [1e9, 44]],
      personPin: 36, avatar: 28, personTail: 7,
      placeDot: 16, placeGlyph: 10,
      mypinH: 24, mypinR: 12, mypinTail: 6,
      arenaH: 24, arenaR: 7
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = T; else root.PNTOKENS = T;
})(this);

/* PintsNow map glyphs (mapart v1). ALL ORIGINAL (drawn here from circles, rounded rects and polygons; no third-party
   icon set). 24 x 24 grid, filled, no strokes, min part width 2 units (= 1 px at 12 px) so they hold at 11-18 px.
   Each glyph = layers: { d, k } where k "f" = glyph colour, "b" = knock-out in the colour of the disc under it.
   The same data feeds the SVG masters (build.js) and the canvas renderer (pins.js, Path2D). */
(function (root) {
  function n(v) { return Math.round(v * 100) / 100; }
  function R(x, y, w, h, r) {
    r = Math.min(r || 0, w / 2, h / 2);
    if (!r) return "M" + n(x) + " " + n(y) + "H" + n(x + w) + "V" + n(y + h) + "H" + n(x) + "Z";
    return "M" + n(x + r) + " " + n(y) + "H" + n(x + w - r) + "A" + n(r) + " " + n(r) + " 0 0 1 " + n(x + w) + " " + n(y + r) +
      "V" + n(y + h - r) + "A" + n(r) + " " + n(r) + " 0 0 1 " + n(x + w - r) + " " + n(y + h) + "H" + n(x + r) +
      "A" + n(r) + " " + n(r) + " 0 0 1 " + n(x) + " " + n(y + h - r) + "V" + n(y + r) + "A" + n(r) + " " + n(r) + " 0 0 1 " + n(x + r) + " " + n(y) + "Z";
  }
  function C(cx, cy, r) { return "M" + n(cx - r) + " " + n(cy) + "A" + n(r) + " " + n(r) + " 0 1 0 " + n(cx + r) + " " + n(cy) + "A" + n(r) + " " + n(r) + " 0 1 0 " + n(cx - r) + " " + n(cy) + "Z"; }
  function P(pts) { return "M" + pts.map(function (p) { return n(p[0]) + " " + n(p[1]); }).join("L") + "Z"; }
  function ngon(cx, cy, r, k, rot) { var a = [], i; for (i = 0; i < k; i++) { var t = (rot || -90) * Math.PI / 180 + i * 2 * Math.PI / k; a.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } return P(a); }
  function f(d) { return { d: d, k: "f" }; }
  function b(d) { return { d: d, k: "b" }; }

  var G = {
    /* ---- bar categories ---- */
    pub: [f(C(6.5, 7, 2.9)), f(C(10.2, 5.6, 3.3)), f(C(13.8, 7, 2.9)), f(R(4, 7, 12.5, 14, 2.6)),
      f(R(14, 9.5, 7, 9, 3.5)), b(R(16.2, 11.7, 2.6, 4.6, 1.3)), b(R(7.2, 11, 2.2, 7, 1.1))],
    cocktail: [f(P([[2.5, 3.5], [21.5, 3.5], [12, 13.5]])), f(R(10.9, 12, 2.2, 7.5, 1.1)), f(R(6.5, 18.6, 11, 2.6, 1.3)),
      b(C(14.2, 6.6, 1.8))],
    nightclub: [f("M11 3C11.7 8.4 14.3 11.1 19.5 12C14.3 12.9 11.7 15.6 11 21C10.3 15.6 7.7 12.9 2.5 12C7.7 11.1 10.3 8.4 11 3Z"),
      f("M18.5 2C18.8 4.2 19.8 5.2 22 5.5C19.8 5.8 18.8 6.8 18.5 9C18.2 6.8 17.2 5.8 15 5.5C17.2 5.2 18.2 4.2 18.5 2Z"),
      f(C(18.5, 18.5, 2.2))],
    // map BR1: restbar = beer mug + fork (was wine glass + fork, too busy at 24 px and close to the restaurant glyph)
    restbar: [f(C(4.6, 8.8, 2.2)), f(C(7.6, 7.8, 2.6)), f(C(10.4, 8.8, 2.1)), f(R(2.6, 9, 9.6, 12.4, 2.2)), f(R(11, 11.2, 4.2, 6.8, 2.1)),
      b(R(5.1, 12.2, 2, 6.4, 1)), f(R(16.9, 2.6, 2.1, 6.4, 1.05)), f(R(20.4, 2.6, 2.1, 6.4, 1.05)), f(R(16.9, 7.2, 5.6, 3.2, 1.6)), f(R(18.6, 9.4, 2.2, 12.2, 1.1))],
    // map BR1 new bar types
    bar: [f("M4.5 4.6H19.5L17.8 19.8A1.8 1.8 0 0 1 16 21.4H8A1.8 1.8 0 0 1 6.2 19.8Z"), b(R(7.2, 6.8, 9.6, 3.2, 0.6)), b(R(9.6, 12.4, 4.8, 4.8, 1))],
    vinbar: [f("M6.2 2.5H17.8C18.6 8.6 17 12.9 13.2 14.2V19.2H16.4A1.2 1.2 0 0 1 16.4 21.6H7.6A1.2 1.2 0 0 1 7.6 19.2H10.8V14.2C7 12.9 5.4 8.6 6.2 2.5Z"),
      b("M8.3 4.6H15.7C15.9 6 15.9 7.1 15.8 8.1H8.2C8.1 7.1 8.1 6 8.3 4.6Z")],
    olbar: [f(R(4.4, 2.5, 3, 8.6, 1.5)), f(R(10.5, 2.5, 3, 8.6, 1.5)), f(R(16.6, 2.5, 3, 8.6, 1.5)), f(R(2.5, 10.8, 19, 3.8, 1.3)),
      f(R(5, 14.2, 2, 3.4, 0.6)), f(R(11, 14.2, 2, 3.4, 0.6)), f(R(17.1, 14.2, 2, 3.4, 0.6)), f(R(3.5, 19, 17, 2.6, 1.3))],
    livescen: [f(C(7.4, 17.6, 3.4)), f(C(17.2, 15.6, 3.4)), f(R(8.6, 5, 2.4, 12.6, 0.4)), f(R(18.4, 3, 2.4, 12.6, 0.4)), f(P([[8.6, 5], [20.8, 2.4], [20.8, 6.4], [8.6, 9]]))],
    hotellbar: [f("M4 17.4A8 8 0 0 1 20 17.4Z"), f(R(2.5, 18.4, 19, 3, 1.5)), f(R(11, 6.8, 2, 3.4, 0.4)), f(C(12, 6, 2.1)), b("M7.2 15.6A5.2 5.2 0 0 1 9.6 11.6L10.8 13.2A3.4 3.4 0 0 0 9.4 15.6Z")],
    spelbar: [f(C(10.5, 13.5, 8.5)), b(C(10.5, 13.5, 6.2)), f(C(10.5, 13.5, 3.8)), f(P([[10.1, 12.3], [19.1, 3.3], [20.9, 5.1], [11.9, 14.1]])), f(P([[18.4, 1.6], [22.4, 1.6], [22.4, 5.6]]))],
    nation: [f("M4.5 12.4C4.5 8 7.8 5.8 12 5.8C16.2 5.8 19.5 8 19.5 12.4Z"), f(R(4, 14.2, 16, 3.4, 0.8)), f("M5.5 17.6H18.5L16.6 20.6Q12 21.8 7.4 20.6Z"), b(C(12, 9.6, 1.7))],
    brewery: [f("M6.6 3H17.4Q21.2 12 17.4 21H6.6Q2.8 12 6.6 3Z"), b(R(3.5, 7.4, 17, 2, 1)), b(R(3.5, 14.6, 17, 2, 1)),
      b(R(10.9, 10.4, 2.2, 3.2, 0.6))],
    sportsbar: [f(R(2, 3.5, 20, 13.5, 2.6)), b(R(4.2, 5.7, 15.6, 9.1, 1.2)), f(C(12, 10.25, 3.1)), f(R(11, 16.5, 2, 2.5, 0)),
      f(R(7.5, 18.6, 9, 2.4, 1.2))],
    karaoke: [f(C(15.4, 8.6, 5.4)), b(R(11.2, 7.7, 8.4, 1.8, 0.9)), f(P([[10.9, 9.6], [14.3, 13], [6.6, 20.7], [3.2, 17.3]])),
      f(C(4.7, 19.2, 2.3))],
    biergarten: [f(C(12, 8.6, 6.4)), f(C(7.2, 11.6, 4.4)), f(C(16.8, 11.6, 4.4)), f(R(10.8, 12, 2.4, 9, 1.2)), f(R(6, 19.4, 12, 2.2, 1.1))],
    /* ---- places (restaurant dots) ---- */
    restaurant: [f(R(4.4, 3, 2.3, 6.5, 1.15)), f(R(8.9, 3, 2.3, 6.5, 1.15)), f(R(4.4, 7.6, 6.8, 3.6, 1.8)), f(R(6.6, 9.5, 2.4, 11.5, 1.2)),
      f("M15.6 3Q19.6 5.4 19.6 12.6H17.6V20A1.25 1.25 0 0 1 15.1 20V4.2Q15.1 3 15.6 3Z")],
    cafe: [f("M3.5 8.5H16V13.6A5.4 5.4 0 0 1 10.6 19H8.9A5.4 5.4 0 0 1 3.5 13.6Z"), f(R(13.8, 9.5, 7, 7, 3.5)), b(R(16, 11.7, 2.6, 2.6, 1.3)),
      f(R(2.5, 19.8, 16, 2.2, 1.1)), f(R(6.5, 2.5, 2.2, 4.5, 1.1)), f(R(10.8, 2, 2.2, 5, 1.1))],
    fastfood: [f("M3.5 10.2A8.5 7 0 0 1 20.5 10.2Z"), f(R(2.5, 11.8, 19, 3.2, 1.6)), f(R(3.5, 16.2, 17, 4.6, 2.3)), b(C(9, 7.4, 0.9)), b(C(13, 6.4, 0.9)), b(C(15.6, 8.4, 0.9))],
    // map BR1: nattmat / kebab = a döner spit (cone on a skewer)
    kebab: [f(R(11, 2, 2, 19, 1)), f("M6 5.2H18Q17.4 13.2 12 18.2Q6.6 13.2 6 5.2Z"), b(R(7.6, 8.4, 8.8, 2, 1)), b(R(9.2, 12.2, 5.6, 2, 1)), f(R(7.5, 19.6, 9, 2.2, 1.1))],
    /* ---- arenas ---- */
    hockey: [f(P([[5.2, 2.5], [8.4, 2.5], [14.2, 15.4], [19.4, 15.4], [21, 17], [21, 18.6], [19.6, 20], [12.6, 20]])), f(R(2.5, 16, 8.4, 4.4, 2.2))],
    fotboll: [f(C(12, 12, 9.5)), b(ngon(12, 12, 3.4, 5)), b(C(12, 4.4, 1.7)), b(C(19.2, 9.7, 1.7)), b(C(16.5, 18.1, 1.7)), b(C(7.5, 18.1, 1.7)), b(C(4.8, 9.7, 1.7))],
    arena: [f(R(4.6, 2.5, 2.4, 19, 1.2)), f(P([[7, 3.5], [20.5, 8.2], [7, 13]]))],
    /* ---- badges and states ---- */
    crown: [f(P([[2.5, 18], [2.5, 6.5], [7.6, 11], [12, 3.5], [16.4, 11], [21.5, 6.5], [21.5, 18]])), f(R(2.5, 19, 19, 2.8, 1.2))],
    castle: [f(R(4, 10, 16, 11.5, 1)), f(R(4, 5.5, 3.6, 5.5, 0.6)), f(R(10.2, 5.5, 3.6, 5.5, 0.6)), f(R(16.4, 5.5, 3.6, 5.5, 0.6)),
      b("M10 21.5V16.8A2 2 0 0 1 14 16.8V21.5Z")],
    helmet: [f("M3 15.4A9 9 0 0 1 21 15.4Z"), f(R(1.5, 15, 21, 3.4, 1.7)), b(R(5.5, 11.4, 13, 1.6, 0.8))],
    door: [f(R(6, 2.5, 12, 18.5, 1.6)), b(C(14.6, 12.4, 1.5)), f(R(3.5, 20, 17, 2.2, 1.1))],
    calendar: [f(R(3, 5, 18, 16.5, 2.6)), b(R(5.2, 10.2, 13.6, 9.1, 1)), f(R(6.8, 2.5, 2.4, 5, 1.2)), f(R(14.8, 2.5, 2.4, 5, 1.2)),
      f(R(7, 12.2, 3.6, 3.2, 0.6)), f(R(13.4, 12.2, 3.6, 3.2, 0.6))],
    tumbler: [f("M4.5 4.5H19.5L17.8 19.8A1.8 1.8 0 0 1 16 21.4H8A1.8 1.8 0 0 1 6.2 19.8Z"), b(R(6.4, 6.4, 11.2, 4.2, 0.6))],
    hourglass: [f(R(4.5, 2.5, 15, 2.6, 1.3)), f(R(4.5, 18.9, 15, 2.6, 1.3)), f("M6.8 4.8H17.2V7Q17.2 10.2 13.4 12Q17.2 13.8 17.2 17V19.2H6.8V17Q6.8 13.8 10.6 12Q6.8 10.2 6.8 7Z")],
    person: [f(C(12, 7.6, 4.4)), f("M3.8 21.5A8.2 7.6 0 0 1 20.2 21.5Z")],
    people: [f(C(9, 8, 3.8)), f("M2 20.5A7 6.8 0 0 1 16 20.5Z"), f(C(17, 7.2, 3.1)), f("M14.6 12.4A6 6 0 0 1 22.5 18.6H17.6Q17 15 14.6 12.4Z")],
    house: [f(P([[2.5, 11.6], [12, 3], [21.5, 11.6]])), f(R(5.2, 10.4, 13.6, 11, 1.2)), b("M12 19.6L8.6 16.2A2 2 0 0 1 11.4 13.4L12 14L12.6 13.4A2 2 0 0 1 15.4 16.2Z")],
    chevrons: [f(P([[3, 4], [7.6, 4], [15.6, 12], [7.6, 20], [3, 20], [11, 12]])), f(P([[11, 4], [15.6, 4], [23, 12], [15.6, 20], [11, 20], [18.4, 12]]))],
    pin: [f("M12 2A7.6 7.6 0 0 1 19.6 9.6C19.6 14.6 12 22 12 22C12 22 4.4 14.6 4.4 9.6A7.6 7.6 0 0 1 12 2Z"), b(C(12, 9.6, 2.9))],
    envelope: [f(R(2.5, 5, 19, 14, 2.2)), b("M4.6 7.4L12 12.6L19.4 7.4V9.6L12 14.8L4.6 9.6Z")],
    flame: [f("M12 2C13.2 6 18.5 8.6 18.5 14.4A6.5 6.5 0 0 1 5.5 14.4C5.5 10.6 8 9 8.6 5.8C10.3 7.4 10.9 9 11 10.4C12.6 8.6 12.9 5.2 12 2Z"),
      b("M12 21A3 3 0 0 1 9 18C9 16.2 10.4 15.3 10.9 13.6C11.8 14.5 12.1 15.4 12.2 16.2C13.1 15.4 13.4 14.4 13.4 13.6C14.6 14.8 15 16.4 15 18A3 3 0 0 1 12 21Z")],
    cross: [f(R(9.4, 3, 5.2, 18, 1.3)), f(R(3, 9.4, 18, 5.2, 1.3))],
    clock: [f(C(12, 12, 9.5)), b(C(12, 12, 7.2)), f(R(10.9, 6.5, 2.2, 6.6, 1.1)), f(R(10.9, 10.9, 5.6, 2.2, 1.1))],
    // map BR1 badges in front of a bar name: uteservering · live music · rooftop (HBTQ+ = rainbow, drawn in labelOps)
    sun: [f(C(12, 12, 4.8)), f(R(11, 1.5, 2, 4, 1)), f(R(11, 18.5, 2, 4, 1)), f(R(1.5, 11, 4, 2, 1)), f(R(18.5, 11, 4, 2, 1)),
      f(P([[4.2, 5.6], [5.6, 4.2], [8.4, 7], [7, 8.4]])), f(P([[18.4, 4.2], [19.8, 5.6], [17, 8.4], [15.6, 7]])), f(P([[4.2, 18.4], [7, 15.6], [8.4, 17], [5.6, 19.8]])), f(P([[15.6, 17], [17, 15.6], [19.8, 18.4], [18.4, 19.8]]))],
    note: [f(C(9, 17.5, 3.6)), f(R(10.6, 4, 2.4, 13.6, 0.4)), f("M12.8 4C13.2 7 17.8 7.6 17.8 11.6C17.2 9.8 15.2 9 12.8 8.8Z")],
    parasol: [f("M2.5 11.5Q12 1.5 21.5 11.5Z"), f(R(11, 10.5, 2, 9.5, 1)), f(R(7, 19.6, 10, 2.2, 1.1))]
  };
  // map BR1: the 14 bar types (sprites are drawn for each), the places, the arenas
  var CATS = ["pub", "bar", "cocktail", "vinbar", "olbar", "nightclub", "sportsbar", "karaoke", "livescen", "restbar", "hotellbar", "biergarten", "spelbar", "nation"];
  var PLACES = ["restaurant", "cafe", "fastfood", "kebab"], ARENAS = ["hockey", "fotboll", "arena"];
  var out = { G: G, CATS: CATS, PLACES: PLACES, ARENAS: ARENAS };
  if (typeof module !== "undefined" && module.exports) module.exports = out; else root.PNGLYPHS = out;
})(this);

/* map BR1 — PNVTYPE: venue type of a bar from OSM tags (+ name words as the fallback). ONE source: the app (glmap.js for
   rows without vt, bars.js Overpass fallback) and scripts/fetch-bars.mjs (runs this file in a vm). Import rule order:
   karaoke → livescen → nattklubb → spelbar → nation → hotellbar → olbar → sportbar → vinbar → cocktail → oltradgard → pub → bar.
   BR2 (manual Ludvika check) can override a row with "vt" in bars-extra.json / bars.json. */
(function (root) {
  var ORDER = ["karaoke", "livescen", "nattklubb", "spelbar", "nation", "hotellbar", "olbar", "sportbar", "vinbar", "cocktail", "oltradgard", "pub", "bar", "restbar"];
  var LABEL = { pub: "Pub", bar: "Bar", cocktail: "Cocktailbar", vinbar: "Vinbar", olbar: "Ölbar / bryggeri", nattklubb: "Nattklubb", sportbar: "Sportbar",
    karaoke: "Karaoke", livescen: "Livemusik", restbar: "Mat & bar", hotellbar: "Hotellbar", oltradgard: "Ölträdgård", spelbar: "Spelbar", nation: "Studentpub / nation" };
  var RX = {
    karaoke: /karaoke/, livescen: /(^|[^a-zåäö])(jazz\w*|live|livescen\w*|scen(en)?|rockklubb\w*|musikpub|konserthus)([^a-zåäö]|$)/,
    spelbar: /(boule|shuffle|bowling|dart|minigolf|biljard|pingis|curling)/, nation: /(nation(en)?([^a-zåäö]|$)|studentpub|studentkår|kårhus|(^|[^a-zåäö])kåren?([^a-zåäö]|$))/,
    hotellbar: /(lobby|(^|[^a-zåäö])hote(l|ll))/, olbar: /(bryggeri|brew|taproom|tap ?room|ölhall|ölbar|beer ?bar|craft ?beer|ölkaf[eé]|ölcaf[eé])/,
    sportbar: /(^|[^a-zåäö])sport/, vinbar: /((^|[^a-zåäö])vin(bar(en)?|bod(en)?|stugan?|oteket|teket|källare(n)?)?([^a-zåäö]|$)|wine|champagne)/, cocktail: /(cocktail|speakeasy|tiki)/
  };
  function low(v) { return String(v == null ? "" : v).toLowerCase(); }
  function yes(v) { v = low(v); return v === "yes" || v === "only" || v === "primary"; }
  function classify(t, name) {
    t = t || {}; var a = low(t.amenity || t.type), n = low(name != null ? name : t.name), bar = low(t.bar), barish = a === "bar" || a === "pub" || a === "";
    if (a === "karaoke_box" || a === "karaoke" || yes(t.karaoke) || RX.karaoke.test(n)) return "karaoke";
    if (a === "music_venue" || a === "livescen" || ((barish || a === "nightclub") && RX.livescen.test(n))) return "livescen";
    if (a === "nightclub" || a === "nattklubb" || low(t.leisure) === "dance") return "nattklubb";
    if (barish && (/^(bowling_alley|miniature_golf)$/.test(low(t.leisure)) || RX.spelbar.test(n))) return "spelbar";
    if (barish && RX.nation.test(n)) return "nation";
    if (barish && (low(t.tourism) === "hotel" || RX.hotellbar.test(n))) return "hotellbar";
    if (a === "brewery" || low(t.craft) === "brewery" || (barish && (yes(t.microbrewery) || RX.olbar.test(n)))) return "olbar";
    if (barish && (t.sport || /^(sports_bar|sportsbar)$/.test(bar) || RX.sportbar.test(n))) return "sportbar";
    if (barish && (yes(t["drink:wine"]) && a === "bar" || /^(wine_bar|wine|winebar)$/.test(bar) || RX.vinbar.test(n))) return "vinbar";
    if (barish && (yes(t.cocktails) || bar === "cocktail" || RX.cocktail.test(n))) return "cocktail";
    if (a === "biergarten" || a === "beer_garden" || a === "oltradgard") return "oltradgard";
    if (a === "restaurant_bar" || a === "restbar") return "restbar";
    if (a === "pub") return "pub";
    return "bar";
  }
  // flags for the name badges: live music, HBTQ+, rooftop (uteservering = the existing "outdoor")
  function flags(t) {
    t = t || {}; var o = {}, os = low(t.outdoor_seating);
    if (yes(t.live_music)) o.live = 1;
    if (/^(primary|only)$/.test(low(t.lgbtq)) || /^(primary|only)$/.test(low(t.gay))) o.lgbtq = 1;
    if (os === "roof" || os === "rooftop" || yes(t.rooftop) || /(takterrass|rooftop|roof ?top|sky ?bar)/.test(low(t.name))) o.roof = 1;
    return o;
  }
  function of(b) { if (!b) return null; if (b.vt) return b.vt; if (b.arena || b.place) return null; return classify({ amenity: b.type }, b.name); }
  root.PNVTYPE = { classify: classify, flags: flags, of: of, ORDER: ORDER, LABEL: LABEL };
})(this);

/* PintsNow map markers (mapart v1) — ONE builder for every marker. Each builder returns a list of draw ops in CSS px around
   the anchor (0,0); toCanvas() rasterises it (sprites at 2x / 3x, and the dynamic full pills in glmap), toSVG() writes the
   SVG master. Needs PNTOKENS + PNGLYPHS (src/tokens.js, src/glyphs.js).
   Drop-in for glmap.js: PNPINS.build(state, mode, hi) takes the SAME parsed state glmap.parse() makes and returns
   { data: ImageData, ox, oy, bottom, parts } exactly like glmap's build(). PNPINS.buildLabel(name) likewise. */
(function (root) {
  var T = root.PNTOKENS, GL = root.PNGLYPHS, K = T.col, S = T.size, FONT = T.font;
  var paths = {};
  function p2d(d) { return paths[d] || (paths[d] = new Path2D(d)); }
  var mc = null;
  function tw(s, px, wt) { if (!mc) mc = document.createElement("canvas").getContext("2d"); mc.font = (wt || 700) + " " + px + "px " + FONT; return mc.measureText(s).width; }
  function cat(k) { return T.typeMap[k] || (GL.G[k] ? k : "pub"); }

  /* ---------- ops helpers ---------- */
  function circle(ops, x, y, r, o) { ops.push(Object.assign({ o: "c", x: x, y: y, r: r }, o)); }
  function rrect(ops, x, y, w, h, r, o) { ops.push(Object.assign({ o: "rr", x: x, y: y, w: w, h: h, r: r }, o)); }
  function path(ops, d, o) { ops.push(Object.assign({ o: "p", d: d }, o)); }
  function glyph(ops, n, cx, cy, s, fg, bg) { ops.push({ o: "g", n: n, x: cx - s / 2, y: cy - s / 2, s: s, fg: fg, bg: bg }); }
  function text(ops, x, y, t, px, wt, fill, o) { ops.push(Object.assign({ o: "t", x: x, y: y, t: t, px: px, wt: wt, fill: fill }, o)); }
  // the family "disc": shadow + ink hairline + foam ring + body. r = outer radius of the foam ring.
  function disc(ops, x, y, r, body, o) {
    o = o || {};
    circle(ops, x, y, r + S.edge, { fill: K.edge, sh: !o.noShadow });
    circle(ops, x, y, r, { fill: o.ring || K.foam });
    circle(ops, x, y, r - (o.rw || S.ring), { fill: body, grad: o.grad });
  }
  // small round badge (friend / stammis / event): ink hairline, foam ring 1.5, coloured body, glyph
  function badge(ops, x, y, d, body, g, fg, o) {
    o = o || {};
    circle(ops, x, y, d / 2 + 1, { fill: K.edge });
    circle(ops, x, y, d / 2, { fill: o.ring || K.foam });
    circle(ops, x, y, d / 2 - 1.5, { fill: body });
    glyph(ops, g, x, y, d * 0.62, fg, body);
  }
  function crown(ops, x, y, w) {   // crown centred on x, bottom at y (amber, ink hairline)
    var h = w * 0.72, s = w / 19, ox = x - w / 2 - 2.5 * s, oy = y - h - 3.5 * s;
    var g = GL.G.crown, i;
    for (i = 0; i < g.length; i++) path(ops, g[i].d, { fill: "none", stroke: K.edge, sw: 2.4 / s, join: "round", tf: [s, ox, oy] });
    for (i = 0; i < g.length; i++) path(ops, g[i].d, { fill: K.amberHi, tf: [s, ox, oy] });
  }
  function foamCap(ops, r, k) {     // 3 foam bubbles over the top of a busy disc (the app icon's foam head)
    k = k || 1;
    var b = k === 2 ? [[-r * 0.5, -r * 0.84, r * 0.3], [0, -r * 0.96, r * 0.36], [r * 0.5, -r * 0.84, r * 0.3]] : [[-r * 0.52, -r * 0.86, r * 0.34], [0, -r * 0.98, r * 0.42], [r * 0.52, -r * 0.86, r * 0.34]];
    b.forEach(function (q) { circle(ops, q[0], q[1], q[2] + 1, { fill: K.edge }); });
    b.forEach(function (q) { circle(ops, q[0], q[1], q[2], { fill: K.foam }); });
    if (k !== 2) circle(ops, -r * 0.1, -r * 1.08, r * 0.1, { fill: "#FFFFFF" });
  }
  function chip(ops, parts, sel, x, cy, g, n, border, o) {   // ink chip: glyph + number (check-ins, call-outs)
    o = o || {};
    var hasN = n != null && n !== "", tw_ = hasN ? Math.ceil(tw(String(n), 12, 700)) : 0;
    var w = S.chipPad + S.chipGlyph + (hasN ? 3 + tw_ : 0) + S.chipPad, h = S.chipH, y = cy - h / 2;
    if (!hasN) w = h;
    if (o.right != null) x = o.right - w; else if (o.center) x = x - w / 2;
    x = Math.round(x); y = Math.round(y);
    rrect(ops, x - 1, y - 1, w + 2, h + 2, h / 2 + 1, { fill: K.edge, sh: true });
    rrect(ops, x, y, w, h, h / 2, { fill: K.ink });
    rrect(ops, x + 1, y + 1, w - 2, h - 2, h / 2 - 1, { fill: "none", stroke: border || "rgba(255,250,240,0.55)", sw: 2 });
    var gx = hasN ? x + S.chipPad + S.chipGlyph / 2 : x + w / 2;
    glyph(ops, g, gx, y + h / 2, S.chipGlyph, o.gcol || K.foam, K.ink);
    if (hasN) text(ops, x + S.chipPad + S.chipGlyph + 3, y + h / 2, String(n), 12, 700, K.foam);
    var bb = [x - 1, y - 1, x + w + 1, y + h + 1];
    if (sel && parts) parts.push({ sel: sel, bb: bb });
    return bb;
  }
  var CROWD = { 1: { c: "#8FD19E", n: 1 }, 2: { c: K.amberHi, n: 2 }, 3: { c: K.red, n: 3 } };
  var LEVEL = [{ b: "rgba(245,166,35,0.85)" }, { b: "#FF8A1F", g: "flame" }, { b: K.red, g: "flame", outer: K.foam }];
  function meter(ops, x, cy, lv, col) {   // 3-bar crowd meter (shape cue for Lugnt / Livligt / Packat)
    for (var i = 0; i < 3; i++) { var h = 5 + i * 2.5; rrect(ops, x + i * 4, Math.round(cy + 5 - h), 3, h, 1, { fill: i < lv ? col : "rgba(255,250,240,0.22)" }); }
    return 11;
  }
  function evGlyph(e) { return /🎤/.test(e) ? "karaoke" : /⚽/.test(e) ? "fotboll" : /🏒/.test(e) ? "hockey" : /🍺|🍻/.test(e) ? "pub" : "calendar"; }

  /* ---------- people pill (bars, strangers, clusters share it) ---------- */
  // p = {l level 0-2, f friend, m mine, a approx, n count, e beer emoji, o other drinks}, cw = [word, "1"-"3"] crowd
  function pill(ops, parts, cx, top, p, cw, o) {
    o = o || {};
    var lv = LEVEL[p.l || 0], segs = [], x, w = S.pillPadL;
    var num = p.n && p.n !== "0" ? p.n : "", oth = p.o ? String(p.o).replace(/^·\s*/, "").replace(/[^\d]/g, "") : "";
    if (lv.g) w += 12 + 3;
    if (num) { w += S.pillGlyph + 3 + Math.ceil(tw(num, 14, 700)); }
    if (oth) w += (num ? 6 : 0) + 12 + 2 + Math.ceil(tw(oth, 13, 700));
    if (!num && !oth) { num = "0"; w += S.pillGlyph + 3 + Math.ceil(tw(num, 14, 700)); }
    var cwW = 0;
    if (cw) { cwW = 7 + 1 + 7 + 11 + 4 + Math.ceil(tw(cw[0], 12, 600)); w += cwW; }
    w += S.pillPadR;
    var h = S.pillH, px = Math.round(cx - w / 2), py = Math.round(top);
    if (lv.outer) rrect(ops, px - 3, py - 3, w + 6, h + 6, h / 2 + 3, { fill: lv.outer, sh: true });
    rrect(ops, px - 1, py - 1, w + 2, h + 2, h / 2 + 1, { fill: K.edge, sh: !lv.outer });
    rrect(ops, px, py, w, h, h / 2, { fill: p.m ? "#2A1C00" : K.ink });
    rrect(ops, px + 1, py + 1, w - 2, h - 2, h / 2 - 1, { fill: "none", stroke: lv.b, sw: 2, dash: p.a ? [3, 2] : null });
    if (p.f) rrect(ops, px + 3, py + 3, w - 6, h - 6, h / 2 - 3, { fill: "none", stroke: K.green, sw: 1.5 });
    var cy = py + h / 2; x = px + S.pillPadL;
    if (lv.g) { glyph(ops, lv.g, x + 6, cy, 12, lv.b, K.ink); x += 15; }
    if (num) {
      glyph(ops, "pub", x + S.pillGlyph / 2, cy, S.pillGlyph, K.amberHi, p.m ? "#2A1C00" : K.ink); x += S.pillGlyph + 3;
      text(ops, x, cy, num, 14, 700, p.m ? "#FFE08A" : K.foam); x += Math.ceil(tw(num, 14, 700));
    }
    if (oth) { if (num) x += 6; glyph(ops, "tumbler", x + 6, cy, 12, K.lilac, K.ink); x += 14; text(ops, x, cy, oth, 13, 700, K.lilac); x += Math.ceil(tw(oth, 13, 700)); }
    if (cw) {
      var c = CROWD[cw[1]] || CROWD[2]; x += 7;
      rrect(ops, x, py + 5, 1, h - 10, 0, { fill: "rgba(255,250,240,0.25)" }); x += 1 + 7;
      meter(ops, x, cy, c.n, c.c); x += 11 + 4;
      text(ops, x, cy, cw[0], 12, 600, c.c);
    }
    if (p.f) badge(ops, px + w - 2, py + 1, 14, K.green, "person", K.greenInk);
    if (p.m) { circle(ops, px + 3, py + 2, 6, { fill: K.edge }); circle(ops, px + 3, py + 2, 5, { fill: K.foam }); circle(ops, px + 3, py + 2, 3, { fill: K.blue }); }
    var bb = [px - 3, py - 6, px + w + 6, py + h + 3];
    if (parts && o.sel) parts.push({ sel: o.sel, bb: [px, py, px + w, py + h] });
    return { x: px, y: py, w: w, h: h, bb: bb };
  }

  /* ---------- bar marker: dot / full / town view (glmap modes "d" / "f" / "x") ----------
     mbx (owner 2026-11-07: "73 people at one place takes up a whole street … a little counter top right of the bar icon,
     like an app notification badge"): the full marker = the type disc + ONE round count badge at its top-right (1 … 99,
     then 99+). No people pill, no crowd word, no queue chip on the map: the bar sheet has them. Level = badge colour
     (amber · orange · red + foam ring), a friend there = green ring + green dot, me = blue dot. Every slot is fixed:
       👑 top-left · count top-right · 📅/🎤 bottom-left · 🪖 right · 🚪 left · 🏰 bottom-right · price under the disc (z ≥ 16 only). */
  var BADGE = [{ b: K.amber, t: "#241300" }, { b: "#FF8A1F", t: "#1A0B00" }, { b: K.red, t: "#FFFFFF", outer: K.foam }];
  function countText(p) {
    var n = parseInt(p && p.n, 10) || 0, o = p && p.o ? parseInt(String(p.o).replace(/[^\d]/g, ""), 10) || 0 : 0;
    if (!n && o) n = o;
    return n > 99 ? "99+" : String(Math.max(1, n));
  }
  function countBadge(ops, parts, cx, cy, p, hi) {
    // pf01: the badge counts PEOPLE at the bar → a small people glyph before the number (never read as "drinks")
    // The left edge stays where it was (top-right of the disc); the badge grows to the right only (owner: "no long pills").
    var t = countText(p), lv = BADGE[p.l || 0] || BADGE[0], h = 20, fs = 13, gw = 10, tws = Math.ceil(tw(t, fs, 700));   // map M2: x 0.75–1 by zoom
    var w0 = Math.max(h, tws + 9), w = Math.max(h, tws + gw + 7), x = Math.round(cx - w0 / 2), y = Math.round(cy - h / 2), cx0 = x + (w - (gw + 1 + tws)) / 2;
    if (lv.outer) rrect(ops, x - 2.5, y - 2.5, w + 5, h + 5, h / 2 + 2.5, { fill: lv.outer, sh: true });
    rrect(ops, x - 1, y - 1, w + 2, h + 2, h / 2 + 1, { fill: p.f ? K.green : K.edge, sh: !lv.outer });
    rrect(ops, x, y, w, h, h / 2, { fill: lv.b });
    glyph(ops, "people", cx0 + gw / 2, y + h / 2, gw, lv.t, lv.b);
    text(ops, cx0 + gw + 1, y + h / 2, t, fs, 700, lv.t);
    if (p.m) { circle(ops, x + 1, y + h - 1, 4.5, { fill: K.edge }); circle(ops, x + 1, y + h - 1, 3.5, { fill: K.blue }); }
    var bb = [x - 3, y - 3, x + w + 3, y + h + 3];
    if (parts) parts.push({ sel: ".pill", bb: bb });
    return bb;
  }
  // ds31: friends here → ONE chip under the disc: green friend badge + their night total(s) + a beer glyph. Ink body, green ring.
  function ftChip(ops, parts, cy, t) {
    t = String(t).slice(0, 14);
    var h = 20, tw_ = Math.ceil(tw(t, 12, 700)), w = 2 + 16 + 4 + tw_ + 3 + 12 + 7, x = Math.round(-w / 2), y = Math.round(cy - h / 2);
    rrect(ops, x - 1, y - 1, w + 2, h + 2, h / 2 + 1, { fill: K.edge, sh: true });
    rrect(ops, x, y, w, h, h / 2, { fill: K.ink });
    rrect(ops, x + 1, y + 1, w - 2, h - 2, h / 2 - 1, { fill: "none", stroke: K.green, sw: 2 });
    badge(ops, x + 2 + 8, y + h / 2, 16, K.green, "person", K.greenInk);
    text(ops, x + 2 + 16 + 4, y + h / 2, t, 12, 700, K.foam);
    glyph(ops, "pub", x + 2 + 16 + 4 + tw_ + 3 + 6, y + h / 2, 12, K.amberHi, K.ink);
    parts.push({ sel: ".pill", bb: [x - 1, y - 1, x + w + 1, y + h + 1] });   // tap = Folk här (the friends' rows)
  }
  function barOps(s, mode, hi, extra) {
    var ops = [], parts = [], full = mode !== "d", k = cat(s.k), busy = !!(s.p || s.hot), lit = !busy && !!s.lit;
    extra = extra || {};
    // map B9: the dot disc is as big as the full pill's disc (owner: an icon may never shrink by position, only the name hides)
    // map M2: one size for every zoom (glmap scales the image); hi / mode change only what is drawn (price tag, town-view chips)
    var D = full ? S.fullHi : S.dot, r = D / 2;
    var gs = full ? S.glyphFullHi : S.glyphDot;
    if (extra.sel) circle(ops, 0, 0, r + 4, { fill: "rgba(245,166,35,0.55)", sh: true });
    // the disc is ALWAYS navy with the type glyph (one look per place type at every zoom); busy = amber ring, lit = green
    var body = K.navy;
    disc(ops, 0, 0, r, body, { ring: busy ? K.amber : lit ? K.green : K.foam, grad: [K.navy2, K.navy] });
    glyph(ops, k, 0, 0, gs, T.tint[k] || K.foam, body);
    parts.push({ sel: ".bar-ico", bb: [-r, -r, r, r] });
    var king = s.king || extra.king, bo = Math.round(r * 0.72);
    if (!full) {
      if (busy && !king) foamCap(ops, r, 2);
      if (king) crown(ops, 0, -r + 2, 12);
      var bd = S.dotBadge;   // map B9 (was 10 on the 18 px dot)
      if (s.p && s.p.f) badge(ops, bo, bo, bd, K.green, "person", K.greenInk);
      if (lit) badge(ops, -bo, bo, bd, K.ink, "door", K.green);
      if (extra.stammis) badge(ops, -bo, bo, bd, K.foam, "house", K.ink, { ring: K.amber });
      return { ops: ops, parts: parts };
    }
    if (king) { crown(ops, -r * 0.45, -r + 3, 14); parts.push({ sel: ".cm-king", bb: [-r - 4, -r - 9, 2, -r + 3] }); }
    if (s.p && !s.p.q) countBadge(ops, parts, r * 0.78, -r * 0.78, s.p, true);
    else if (s.p && s.p.f) badge(ops, r * 0.78, -r * 0.78, 14, K.green, "person", K.greenInk);   // gw: < 3 people = no number; a friend keeps the dot
    if (s.p && s.p.ft) ftChip(ops, parts, Math.round(r + 3 + (s.tg && hi && mode !== "x" ? S.tagH + 3 : 0) + 10), s.p.ft);   // ds31
    if (mode === "x") return { ops: ops, parts: parts };
    if (s.ev) { badge(ops, -bo - 1, bo + 1, 15, K.ink, evGlyph(s.ev), K.foam); parts.push({ sel: ".bi-ev", bb: [-bo - 10, bo - 8, -bo + 8, bo + 10] }); }
    if (s.rl) chip(ops, parts, ".cm-rally", r + 4, s.p ? 6 : 0, "helmet", s.rl[0], s.rl[1] ? K.green : "#FF8A1F", { gcol: s.rl[1] ? K.green : "#FFB36B" });
    var cf = s.cf || (s.fl ? (s.fl[1] ? 2 : 1) : 0);
    if (cf) chip(ops, parts, ".cm-flag", r - 2, r + 2, "castle", null, cf === 2 ? K.green : K.amber, { gcol: cf === 2 ? K.green : K.amberHi });
    if (s.ci) chip(ops, parts, ".cm-ci", 0, 0, "door", s.ci, "rgba(61,220,132,0.9)", { right: -r - 4, gcol: K.green });
    if (s.tg && hi) {
      var tW = Math.ceil(tw(s.tg, 10, 700)) + 10, tx = Math.round(-tW / 2), ty = Math.round(r + 3);
      rrect(ops, tx - 1, ty - 1, tW + 2, S.tagH + 2, S.tagR + 1, { fill: K.edge, sh: true });
      rrect(ops, tx, ty, tW, S.tagH, S.tagR, { fill: K.amber });
      text(ops, tx + 5, ty + S.tagH / 2, s.tg, 10, 700, "#241300");
    }
    return { ops: ops, parts: parts };
  }

  /* ---------- other markers ---------- */
  function cut(t, px, mx) { var w = tw(t, px, 600); while (w > mx && t.length > 3) { t = t.slice(0, -2).replace(/\s+$/, "") + "…"; w = tw(t, px, 600); } return t; }
  // R1-33: a bar name that does not fit goes on 2 lines (split at the word that gives the shortest longest line); cut only after that
  function nameLines(name, px, mx, max) {
    if (max < 2 || tw(name, px, 600) <= mx) return [cut(name, px, mx)];
    var ws = String(name).split(/\s+/), best = null;
    for (var i = 1; i < ws.length; i++) { var a = ws.slice(0, i).join(" "), b = ws.slice(i).join(" "), wa = tw(a, px, 600), wb = tw(b, px, 600);
      if (wa <= mx && (!best || Math.max(wa, wb) < best.m)) best = { a: a, b: b, m: Math.max(wa, wb) }; }
    return best ? [best.a, cut(best.b, px, mx)] : [cut(name, px, mx)];
  }
  // map BR1: a name badge (s uteservering, n live music, h HBTQ+, r rooftop): ink disc Ø 16 with the glyph
  var PRIDE = ["#E40303", "#FF8C00", "#FFED00", "#008026", "#004DFF", "#750787"];
  function nameBadge(ops, x, cy, k) {
    circle(ops, x, cy, 9, { fill: K.edge, sh: true }); circle(ops, x, cy, 8, { fill: K.ink });
    if (k === "h") { for (var i = 0; i < 6; i++) { var a0 = (i / 6) * 6.2832 - 1.5708, a1 = ((i + 1) / 6) * 6.2832 - 1.5708, rr0 = 6.2;
        path(ops, "M" + x + " " + cy + "L" + (x + rr0 * Math.cos(a0)).toFixed(2) + " " + (cy + rr0 * Math.sin(a0)).toFixed(2) + "A" + rr0 + " " + rr0 + " 0 0 1 " + (x + rr0 * Math.cos(a1)).toFixed(2) + " " + (cy + rr0 * Math.sin(a1)).toFixed(2) + "Z", { fill: PRIDE[i] }); }
      circle(ops, x, cy, 2.4, { fill: K.ink }); return; }
    var g = { s: "sun", n: "note", r: "parasol" }[k] || "sun"; glyph(ops, g, x, cy, 11, T.tint[g] || K.foam, K.ink);
  }
  function labelOps(name, small, at) {   // small = place (restaurant) names: 11 px, softer; at = badge letters (bars)
    var px = small ? 11 : S.labelSize, ops = [], mx = small ? 110 : S.labelMax, bs = small ? "" : String(at || "").slice(0, 2), bw = bs.length ? bs.length * 18 + 2 : 0;
    var lines = small ? [cut(name, px, mx)] : nameLines(name, px, mx - bw, S.labelLines || 1);
    var lh = px + 3, w = 0, cy0 = Math.round(px * 0.6);
    lines.forEach(function (t, i) { var tw0 = tw(t, px, 600), lw = tw0 + (i ? 0 : bw), x0 = -lw / 2; w = Math.max(w, lw);
      if (!i) for (var j = 0; j < bs.length; j++) nameBadge(ops, x0 + 8 + j * 18, cy0, bs[j]);
      text(ops, i ? 0 : x0 + bw + tw0 / 2, cy0 + i * lh, t, px, 600, small ? "#CFC6B4" : K.labelText, { align: "center", halo: small ? "rgba(8,12,30,0.78)" : K.labelHalo, haloW: small ? 2.5 : S.labelHalo }); });
    return { ops: ops, bbox: [-Math.ceil(w / 2) - 3, Math.min(0, cy0 - 10), Math.ceil(w / 2) + 3, lines.length * lh + 3], lines: lines };
  }
  function meDotOps(o) {
    var ops = [];
    circle(ops, 0, 0, 14, { fill: "rgba(74,163,255,0.20)" });
    circle(ops, 0, 0, S.meDot / 2 + 1, { fill: K.edge, sh: true });
    circle(ops, 0, 0, S.meDot / 2, { fill: "#FFFFFF" });
    circle(ops, 0, 0, S.meCore / 2, { fill: K.blue });
    if (o && o.heading != null) path(ops, "M0 -15L4.5 -10.5H-4.5Z", { fill: K.blue, rot: o.heading });
    return { ops: ops };
  }
  function clusterOps(n, o) {
    o = o || {};
    var ops = [], d = 28, i, st = S.clusterSteps;
    for (i = 0; i < st.length; i++) if (n < st[i][0]) { d = st[i][1]; break; }
    var r = d / 2, lv = LEVEL[o.lvl || 0], ring = o.lvl ? lv.b : K.amber;
    // stack cue: a second disc behind, up-right
    circle(ops, 4, -3, r + 1, { fill: K.edge, sh: true }); circle(ops, 4, -3, r, { fill: "rgba(255,250,240,0.55)" }); circle(ops, 4, -3, r - 2, { fill: K.navy });
    circle(ops, 0, 0, r + 1, { fill: K.edge, sh: true }); circle(ops, 0, 0, r, { fill: ring }); circle(ops, 0, 0, r - 2, { fill: K.ink });
    var label = n >= 1000 ? (Math.floor(n / 100) / 10).toString().replace(".", ",") + "k" : String(n), px = d >= 38 ? 15 : d >= 32 ? 14 : 13;
    text(ops, 0, 0.5, label, px, 700, K.foam, { align: "center" });
    if (lv.g) badge(ops, -r * 0.72, -r * 0.72, 14, K.ink, lv.g, lv.b);
    if (o.friend) badge(ops, r * 0.72, r * 0.72, 14, K.green, "person", K.greenInk);
    if (o.mine) { circle(ops, -r * 0.72, r * 0.72, 6, { fill: K.edge }); circle(ops, -r * 0.72, r * 0.72, 5, { fill: K.foam }); circle(ops, -r * 0.72, r * 0.72, 3, { fill: K.blue }); }
    return { ops: ops };
  }
  // friend / me pin: room for the AVATAR circle (28 px). Anchor = tail tip.
  function personOps(o) {
    o = o || {};
    var ops = [], R_ = S.personPin / 2, cy = -R_ - S.personTail, ring = o.me ? K.amber : K.green;
    path(ops, "M" + (-6) + " " + (cy + R_ - 3) + "L0 0L6 " + (cy + R_ - 3) + "Z", { fill: K.edge, sh: true, grow: 1 });
    circle(ops, 0, cy, R_ + 1, { fill: K.edge, sh: true });
    path(ops, "M-5 " + (cy + R_ - 3) + "L0 -1.5L5 " + (cy + R_ - 3) + "Z", { fill: ring });
    circle(ops, 0, cy, R_, { fill: ring });
    circle(ops, 0, cy, R_ - 3, { fill: K.foam });
    circle(ops, 0, cy, S.avatar / 2 - 1, { fill: o.avBg || K.navy2, avatar: true });
    if (o.initial) text(ops, 0, cy + 0.5, o.initial, 14, 700, K.foam, { align: "center" });
    else glyph(ops, "person", 0, cy + 2, 18, "rgba(255,250,240,0.85)", K.navy2);
    if (o.approx) circle(ops, 0, cy, R_ + 3, { fill: "none", stroke: ring, sw: 1.5, dash: [3, 2.5] });
    if (o.n) {
      var lv = LEVEL[o.lvl || 0], t = String(o.n), w = 5 + 12 + 2 + Math.ceil(tw(t, 12, 700)) + 6, x = R_ - 8, y = cy + R_ - 14;
      rrect(ops, x - 1, y - 1, w + 2, 20, 10, { fill: K.edge });
      rrect(ops, x, y, w, 18, 9, { fill: K.ink });
      rrect(ops, x + 1, y + 1, w - 2, 16, 8, { fill: "none", stroke: lv.b, sw: 2 });
      glyph(ops, lv.g || "pub", x + 5 + 6, y + 9, 12, lv.g ? lv.b : K.amberHi, K.ink);
      text(ops, x + 19, y + 9, t, 12, 700, K.foam);
    }
    return { ops: ops };
  }
  function strangerOps(n, o) { var ops = []; pill(ops, null, 0, -S.pillH / 2, { n: String(n), l: (o && o.lvl) || 0, a: o && o.approx }, null); return { ops: ops }; }
  var WHY = { run: ["chevrons", K.amber], rally: ["helmet", K.amber], checkin: ["door", K.green], friends: ["people", K.green], event: ["calendar", K.amber], sel: ["pin", K.amber] };
  function mypinOps(why, name) {   // 📍 Mina ställen: foam callout, reason disc, tail. Anchor = tail tip.
    var ops = [], wy = WHY[why] || WHY.sel, t = name || "", w0 = Math.min(110, Math.ceil(tw(t, 12, 700)));
    while (tw(t, 12, 700) > 110 && t.length > 3) t = t.slice(0, -2) + "…";
    var h = S.mypinH, w = 3 + 18 + 5 + w0 + 9, x = Math.round(-w / 2), y = -h - S.mypinTail;
    path(ops, "M-7 " + (y + h - 1) + "L0 1L7 " + (y + h - 1) + "Z", { fill: K.edge, sh: true });
    rrect(ops, x - 1, y - 1, w + 2, h + 2, h / 2 + 1, { fill: K.edge, sh: true });
    path(ops, "M-6 " + (y + h - 2) + "L0 -0.5L6 " + (y + h - 2) + "Z", { fill: wy[1] });
    rrect(ops, x, y, w, h, h / 2, { fill: wy[1] });
    rrect(ops, x + 2, y + 2, w - 4, h - 4, h / 2 - 2, { fill: K.foam });
    circle(ops, x + 3 + 9, y + h / 2, 9, { fill: K.navy });
    glyph(ops, wy[0], x + 3 + 9, y + h / 2, 12, wy[1] === K.green ? K.green : K.amberHi, K.navy);
    text(ops, x + 3 + 18 + 5, y + h / 2, t, 12, 700, K.ink);
    return { ops: ops };
  }
  function arenaOps(kind, label) {   // 🏟️ arena / event chip: squarer radius = "venue", blue = info
    var ops = [], t = label || "", h = S.arenaH, w = 3 + 18 + 6 + Math.ceil(tw(t, 12, 700)) + 8, x = Math.round(-w / 2), y = -h / 2;
    rrect(ops, x - 1, y - 1, w + 2, h + 2, S.arenaR + 1, { fill: K.edge, sh: true });
    rrect(ops, x, y, w, h, S.arenaR, { fill: K.ink });
    rrect(ops, x + 1, y + 1, w - 2, h - 2, S.arenaR - 1, { fill: "none", stroke: K.blue, sw: 2 });
    circle(ops, x + 3 + 9, 0, 9, { fill: "#2B6FD6" });
    glyph(ops, kind in GL.G ? kind : "arena", x + 3 + 9, 0, 12, K.foam, "#2B6FD6");
    text(ops, x + 3 + 18 + 6, 0, t, 12, 700, K.foam);
    return { ops: ops };
  }
  function arenaDiscOps(kind) { var ops = []; disc(ops, 0, 0, 11, "#2B6FD6", { ring: K.foam }); glyph(ops, kind, 0, 0, 13, K.foam, "#2B6FD6"); return { ops: ops }; }
  // mbx (owner screenshot: "small grey restaurant dots look like a different style"): the SAME disc family as the bar dots
  // (navy body, gradient, foam ring, tinted type glyph), one step smaller and a softer ring = lower rank
  function placeOps(type) {
    var ops = [], k = cat(type), r = S.placeDot / 2;
    disc(ops, 0, 0, r, K.navy, { ring: "rgba(255,250,240,0.78)", rw: 1.5, grad: [K.navy2, K.navy] });
    glyph(ops, k, 0, 0, S.placeGlyph, T.tint[k] || K.foam, K.navy);
    return { ops: ops };
  }
  function inviteOps(label) {
    var ops = [], t = label || "", h = 22, w = 6 + 14 + 4 + Math.ceil(tw(t, 12, 700)) + 9, x = Math.round(-w / 2), y = -h / 2;
    rrect(ops, x - 1, y - 1, w + 2, h + 2, h / 2 + 1, { fill: K.edge, sh: true });
    rrect(ops, x, y, w, h, h / 2, { fill: K.ink });
    rrect(ops, x + 1, y + 1, w - 2, h - 2, h / 2 - 1, { fill: "none", stroke: K.amber, sw: 2 });
    glyph(ops, "envelope", x + 6 + 7, 0, 14, K.amberHi, K.ink);
    text(ops, x + 6 + 14 + 4, 0, t, 12, 700, K.foam);
    return { ops: ops };
  }
  // stretchable backgrounds (Mapbox stretchX / content, for icon-text-fit if pills ever move to GL text)
  function pillBgOps(lv) { var ops = [], w = 40, h = S.pillH, L = LEVEL[lv || 0], x = -w / 2, y = -h / 2;
    if (L.outer) rrect(ops, x - 3, y - 3, w + 6, h + 6, h / 2 + 3, { fill: L.outer, sh: true });
    rrect(ops, x - 1, y - 1, w + 2, h + 2, h / 2 + 1, { fill: K.edge, sh: !L.outer }); rrect(ops, x, y, w, h, h / 2, { fill: K.ink });
    rrect(ops, x + 1, y + 1, w - 2, h - 2, h / 2 - 1, { fill: "none", stroke: L.b, sw: 2 }); return { ops: ops }; }
  function chipBgOps(border) { var ops = [], w = 30, h = S.chipH, x = -w / 2, y = -h / 2;
    rrect(ops, x - 1, y - 1, w + 2, h + 2, h / 2 + 1, { fill: K.edge, sh: true }); rrect(ops, x, y, w, h, h / 2, { fill: K.ink });
    rrect(ops, x + 1, y + 1, w - 2, h - 2, h / 2 - 1, { fill: "none", stroke: border || "rgba(255,250,240,0.55)", sw: 2 }); return { ops: ops }; }
  function badgeOps(kind) {   // the dot badges as separate sprites (GL: one extra symbol layer each, offset from the dot centre)
    var ops = [];
    if (kind === "friend") badge(ops, 0, 0, 10, K.green, "person", K.greenInk);
    else if (kind === "friend-l") badge(ops, 0, 0, 14, K.green, "person", K.greenInk);
    else if (kind === "stammis") badge(ops, 0, 0, 10, K.foam, "house", K.ink, { ring: K.amber });
    else if (kind === "stammis-l") badge(ops, 0, 0, 14, K.foam, "house", K.ink, { ring: K.amber });
    else if (kind === "lit") badge(ops, 0, 0, 10, K.ink, "door", K.green);
    else if (kind === "event") badge(ops, 0, 0, 16, K.ink, "calendar", K.foam);
    else if (kind === "queue") badge(ops, 0, 0, 14, K.ink, "hourglass", K.foam);
    else if (kind === "king") crown(ops, 0, 4, 12);
    else if (kind === "king-l") crown(ops, 0, 5, 15);
    else if (kind === "sel") { circle(ops, 0, 0, 15, { fill: "rgba(245,166,35,0.55)" }); circle(ops, 0, 0, 11, { fill: "rgba(0,0,0,0)" }); }
    return { ops: ops };
  }

  /* ---------- rasterise / serialise ---------- */
  function bboxOf(ops) {
    var b = [1e9, 1e9, -1e9, -1e9];
    function add(x0, y0, x1, y1) { b[0] = Math.min(b[0], x0); b[1] = Math.min(b[1], y0); b[2] = Math.max(b[2], x1); b[3] = Math.max(b[3], y1); }
    ops.forEach(function (o) {
      var sh = o.sh ? 3 : 0, sw = (o.sw || 0) / 2;
      if (o.o === "c") add(o.x - o.r - sw - sh, o.y - o.r - sw - sh, o.x + o.r + sw + sh, o.y + o.r + sw + sh + 1);
      else if (o.o === "rr") add(o.x - sh - sw, o.y - sh - sw, o.x + o.w + sh + sw, o.y + o.h + sh + sw + 1);
      else if (o.o === "g") add(o.x, o.y, o.x + o.s, o.y + o.s);
      else if (o.o === "t") { var w = tw(o.t, o.px, o.wt) + (o.haloW || 0) * 2, x0 = o.align === "center" ? o.x - w / 2 : o.x - (o.haloW || 0); add(x0, o.y - o.px * 0.7, x0 + w, o.y + o.px * 0.7); }
      else if (o.o === "p") { var nums = String(o.d).match(/-?\d+(\.\d+)?/g) || [], tf = o.tf || [1, 0, 0];
        for (var i = 0; i + 1 < nums.length; i += 2) add(+nums[i] * tf[0] + tf[1] - 3, +nums[i + 1] * tf[0] + tf[2] - 3, +nums[i] * tf[0] + tf[1] + 3, +nums[i + 1] * tf[0] + tf[2] + 4); }
    });
    if (b[0] > b[2]) b = [-1, -1, 1, 1];
    return b;
  }
  function draw(g, ops) {
    ops.forEach(function (o) {
      g.save();
      if (o.sh) { g.shadowColor = K.shadow; g.shadowBlur = S.shadowBlur * (g.__r || 1); g.shadowOffsetY = S.shadowY * (g.__r || 1); }
      if (o.o === "c" || o.o === "rr" || o.o === "p") {
        g.beginPath();
        if (o.o === "c") g.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        else if (o.o === "rr") { var x = o.x, y = o.y, w = o.w, h = o.h, r = Math.min(o.r, w / 2, h / 2); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
        var pth = null;
        if (o.o === "p") { if (o.tf) { g.translate(o.tf[1], o.tf[2]); g.scale(o.tf[0], o.tf[0]); } if (o.rot) g.rotate(o.rot * Math.PI / 180); pth = p2d(o.d); }
        if (o.fill && o.fill !== "none") {
          var fs = o.fill;
          if (o.grad && o.o === "c") { var gr = g.createLinearGradient(0, o.y - o.r, 0, o.y + o.r); gr.addColorStop(0, o.grad[0]); gr.addColorStop(1, o.grad[1]); fs = gr; }
          g.fillStyle = fs; pth ? g.fill(pth) : g.fill();
        }
        if (o.stroke) { g.shadowColor = "transparent"; g.lineWidth = o.sw || 1; g.strokeStyle = o.stroke; if (o.join) g.lineJoin = o.join; if (o.dash) g.setLineDash(o.dash); pth ? g.stroke(pth) : g.stroke(); }
      } else if (o.o === "g") {
        var gl = GL.G[o.n] || GL.G.pub, sc = o.s / 24;
        g.translate(o.x, o.y); g.scale(sc, sc);
        gl.forEach(function (L) { g.fillStyle = L.k === "b" ? (o.bg || K.ink) : o.fg; g.fill(p2d(L.d)); });
      } else if (o.o === "t") {
        g.font = o.wt + " " + o.px + "px " + FONT; g.textBaseline = "middle"; g.textAlign = o.align || "left";
        if (o.halo) { g.lineJoin = "round"; g.lineWidth = o.haloW; g.strokeStyle = o.halo; g.strokeText(o.t, o.x, o.y + 0.5); }
        g.fillStyle = o.fill; g.fillText(o.t, o.x, o.y + 0.5);
      }
      g.restore();
    });
  }
  // ops -> {canvas, ox, oy, w, h} (ox, oy = anchor inside the image, whole CSS px)
  function raster(ops, ratio, bbox) {
    var b = bbox || bboxOf(ops), ox = Math.ceil(-b[0]), oy = Math.ceil(-b[1]), W = Math.ceil(b[2]) + ox, H = Math.ceil(b[3]) + oy;
    var cv = document.createElement("canvas"); cv.width = W * ratio; cv.height = H * ratio;
    var g = cv.getContext("2d"); g.__r = ratio; g.scale(ratio, ratio); g.translate(ox, oy); draw(g, ops);
    return { canvas: cv, ox: ox, oy: oy, w: W, h: H, bottom: b[3] };
  }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function toSVG(ops, bbox) {
    var b = bbox || bboxOf(ops), ox = Math.ceil(-b[0]), oy = Math.ceil(-b[1]), W = Math.ceil(b[2]) + ox, H = Math.ceil(b[3]) + oy, gid = 0, defs = [];
    var body = ops.map(function (o) {
      var sh = o.sh ? ' filter="url(#sh)"' : "", st = o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + o.sw + '"' + (o.dash ? ' stroke-dasharray="' + o.dash.join(" ") + '"' : "") + (o.join ? ' stroke-linejoin="' + o.join + '"' : "") : "";
      var fill = o.fill || "none";
      if (o.grad && o.o === "c") { var id = "g" + (++gid); defs.push('<linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + o.grad[0] + '"/><stop offset="1" stop-color="' + o.grad[1] + '"/></linearGradient>'); fill = "url(#" + id + ")"; }
      if (o.o === "c") return '<circle cx="' + o.x + '" cy="' + o.y + '" r="' + o.r + '" fill="' + fill + '"' + st + sh + "/>";
      if (o.o === "rr") return '<rect x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h + '" rx="' + Math.min(o.r, o.w / 2, o.h / 2) + '" fill="' + fill + '"' + st + sh + "/>";
      if (o.o === "p") { var tf = o.tf ? ' transform="translate(' + o.tf[1] + " " + o.tf[2] + ") scale(" + o.tf[0] + ')"' : o.rot ? ' transform="rotate(' + o.rot + ')"' : "";
        return '<path d="' + o.d + '" fill="' + fill + '"' + st + tf + sh + "/>"; }
      if (o.o === "g") { var gl = GL.G[o.n] || GL.G.pub; return '<g transform="translate(' + o.x + " " + o.y + ") scale(" + (o.s / 24) + ')">' +
        gl.map(function (L) { return '<path d="' + L.d + '" fill="' + (L.k === "b" ? (o.bg || K.ink) : o.fg) + '"/>'; }).join("") + "</g>"; }
      if (o.o === "t") { var a = o.align === "center" ? "middle" : "start";
        return '<text x="' + o.x + '" y="' + (o.y + 0.5) + '" font-family="Chakra Petch, system-ui, sans-serif" font-weight="' + o.wt + '" font-size="' + o.px + '" dominant-baseline="central" text-anchor="' + a + '" fill="' + o.fill + '"' +
          (o.halo ? ' stroke="' + o.halo + '" stroke-width="' + o.haloW + '" stroke-linejoin="round" paint-order="stroke"' : "") + ">" + esc(o.t) + "</text>"; }
      return "";
    }).join("");
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="' + (-ox) + " " + (-oy) + " " + W + " " + H + '">' +
      '<defs><filter id="sh" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="' + S.shadowY + '" stdDeviation="' + (S.shadowBlur / 2) + '" flood-color="#000" flood-opacity="0.45"/></filter>' + defs.join("") + "</defs>" +
      body + "</svg>";
  }

  /* ---------- glmap drop-in ---------- */
  var R2 = 2;
  function build(s, mode, hi, extra) {
    var x = barOps(s, mode, hi, extra), r = raster(x.ops, R2), g = r.canvas.getContext("2d");
    return { data: g.getImageData(0, 0, r.canvas.width, r.canvas.height), ox: r.ox, oy: r.oy, bottom: r.bottom, parts: x.parts, canvas: r.canvas };
  }
  function buildLabel(name, at) { var x = labelOps(name, false, at), r = raster(x.ops, R2, x.bbox); return { data: r.canvas.getContext("2d").getImageData(0, 0, r.canvas.width, r.canvas.height), canvas: r.canvas, ox: r.ox, oy: r.oy }; }

  /* ---------- people pins + people clusters (DOM markers, mbx) ----------
     Owner (2026-11-07): "no long pills: avatar + small badge count". A round face (the AVATAR character for me / friends,
     a person glyph for others) with the same count badge as the bars at its top-right. Name only at zoom ≥ 16 (CSS). */
  var PCSS =
    ".pn-p{position:absolute;left:0;top:0;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;box-sizing:border-box;" +
      "background:linear-gradient(#1E2B66,#152050);border:2px solid #FFFAF0;box-shadow:0 0 0 1px rgba(4,7,20,.62),0 1px 3px rgba(0,0,0,.5);display:grid;place-items:center;cursor:pointer}" +
    ".pn-p.pn-f{width:32px;height:32px;border-color:#3DDC84}.pn-p.pn-m{width:32px;height:32px;border-color:#F5A623}" +
    ".pn-p.pn-a{border-style:dashed}" +
    ".pn-p>.pn-d{width:100%;height:100%;border-radius:50%;overflow:hidden;display:grid;place-items:center}" +
    ".pn-p>.pn-d>svg{width:15px;height:15px;fill:rgba(255,250,240,.88)}.pn-p.pn-f>.pn-d>svg,.pn-p.pn-m>.pn-d>svg{width:18px;height:18px}" +
    ".pn-p>.pn-d>img{width:100%;height:100%;display:block;border-radius:50%}" +
    ".pn-c{position:absolute;right:-9px;top:-7px;min-width:17px;height:17px;padding:0 4px;box-sizing:border-box;border-radius:9px;background:#F5A623;color:#241300;" +
      "font:700 11px/17px var(--body,'Chakra Petch',system-ui,sans-serif);text-align:center;font-variant-numeric:tabular-nums;box-shadow:0 0 0 1px rgba(4,7,20,.62),0 1px 2px rgba(0,0,0,.5)}" +
    ".pn-p.lv1 .pn-c{background:#FF8A1F;color:#1A0B00}.pn-p.lv2 .pn-c{background:#FF5A4E;color:#fff;box-shadow:0 0 0 2px #FFFAF0,0 1px 3px rgba(0,0,0,.6)}" +
    ".pn-p.pn-f .pn-c{box-shadow:0 0 0 1.5px #3DDC84,0 1px 2px rgba(0,0,0,.5)}" +
    ".pn-nm{position:absolute;left:50%;top:calc(100% + 3px);transform:translateX(-50%);white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis;display:none;" +
      "font:600 11px/1.2 var(--body,'Chakra Petch',system-ui,sans-serif);color:#FFF6E5;text-shadow:0 0 3px rgba(8,12,30,.95),0 1px 2px #000;pointer-events:none}" +
    ".tz-hi .pn-nm{display:block}" +
    // people cluster: one round count bubble (stack cue = a second ring), faces of friends / me in front
    ".pn-cl{position:absolute;left:0;top:0;transform:translate(-50%,-50%);min-width:28px;height:28px;padding:0 6px;box-sizing:border-box;border-radius:14px;background:#0A0F24;" +
      "border:2px solid #F5A623;box-shadow:3px -3px 0 -1px rgba(30,43,102,.95),3px -3px 0 0 rgba(255,250,240,.5),0 1px 3px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;gap:2px;" +
      "font:700 12px/1 var(--body,'Chakra Petch',system-ui,sans-serif);color:#FFFAF0;font-variant-numeric:tabular-nums;cursor:pointer;white-space:nowrap}" +
    ".pn-cl.lv1{border-color:#FF8A1F}.pn-cl.lv2{border-color:#FF5A4E}.pn-cl.pn-f{border-color:#3DDC84}" +
    ".pn-cl>img{width:20px;height:20px;border-radius:50%;margin-left:-8px;box-shadow:0 0 0 1.5px #3DDC84}.pn-cl>img:first-child{margin-left:-4px}.pn-cl>img+b{margin-left:2px}" +
    "@media (prefers-reduced-motion:no-preference){.pn-p,.pn-cl{transition:transform .12s var(--e-std)}.leaflet-marker-icon:active>.pn-p,.leaflet-marker-icon:active>.pn-cl{transform:translate(-50%,-50%) scale(.92)}}";
  var PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + GL.G.person.map(function (L) { return L.d; }).join("") + '"/></svg>';
  function pcss() { if (typeof document === "undefined" || document.getElementById("pn-people-css")) return; var st = document.createElement("style"); st.id = "pn-people-css"; st.textContent = PCSS; (document.head || document.documentElement).appendChild(st); }
  function hesc(x) { return String(x == null ? "" : x).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function cnt(n) { n = Math.max(0, n | 0); return n > 99 ? "99+" : String(n); }
  // o = { n, lvl, friend, mine, approx, avatar (an <img> html or ""), name, nc (no number for strangers: SAFE) }
  function personHTML(o) {
    pcss(); o = o || {};
    var cls = "pn-p lv" + (o.lvl | 0) + (o.mine ? " pn-m" : o.friend ? " pn-f" : " pn-s") + (o.approx ? " pn-a" : "");
    var face = o.avatar ? String(o.avatar) : PERSON;
    return '<div class="' + cls + '"><span class="pn-d">' + face + "</span>" + (o.nc ? "" : '<b class="pn-c">' + cnt(o.n) + "</b>") +
      (o.name ? '<span class="pn-nm">' + hesc(o.name) + "</span>" : "") + "</div>";
  }
  function clusterHTML(o) {
    pcss(); o = o || {};
    var cls = "pn-cl lv" + (o.lvl | 0) + (o.friend || o.mine ? " pn-f" : "");
    return '<div class="' + cls + '">' + (o.faces || "") + "<b>" + (o.n >= 1000 ? (Math.floor(o.n / 100) / 10).toString().replace(".", ",") + "k" : cnt(o.n)) + "</b></div>";
  }

  root.PNPINS = { personHTML: personHTML, clusterHTML: clusterHTML, countText: countText, barOps: barOps, labelOps: labelOps, meDotOps: meDotOps, clusterOps: clusterOps, personOps: personOps, strangerOps: strangerOps,
    mypinOps: mypinOps, arenaOps: arenaOps, arenaDiscOps: arenaDiscOps, placeOps: placeOps, inviteOps: inviteOps, pillBgOps: pillBgOps,
    chipBgOps: chipBgOps, badgeOps: badgeOps, raster: raster, toSVG: toSVG, bboxOf: bboxOf, build: build, buildLabel: buildLabel,
    setRatio: function (r) { R2 = r; }, cat: cat, _tw: tw };
})(this);
