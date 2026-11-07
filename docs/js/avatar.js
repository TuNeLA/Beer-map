/* Öl Nu — 👤 AVATAR (owner 2026-11-07: "Like Snapchat Bitmoji but our own: a face in a circle with the top of the
   shoulders. Hat, mustache, mask, accessories, and a uniform with tiny versions of your medals. Rank/achievements
   unlock more. It shows in the chat next to messages.").
   - Art: one flat SVG drawn in code (viewBox 0 0 100 100, circle). Layers: background · hair (back) · shoulders/top +
     rank mark + mini ribbons of real medals · neck · ears · head · eyes · brows · mouth · facial hair · hair (front,
     clipped under a hat) · glasses/mask · headwear. Original art, no assets.
   - Spec (server table `avatars`, ≤ 1 KB): {v, sk skin, fs face, ey eyes, br brows, mt mouth, hr hair, hc hair colour,
     fh facial hair, hw headwear, gl glasses/mask, up top, uc top colour, bg background, ms show medals 0/1, md [medal ids ≤ 6]}.
     No spec = a default character from `seed` (md5 of the user id, from the server), so everyone has one.
   - Unlocks (LOCKS = SQL olnu_avatar_locks() in 0172): r rank index, m medal, s best weekend streak, b bars in the
     passport, t towns, e events said yes to. Locked tiles show 🔒 + "Låses upp vid …". Nothing is bought.
   - RPCs: my_avatar(), set_my_avatar(p_spec), avatars_for(p_group_id | null). Missing RPC (old server) = feature off.
   - Shown in: group chat / event chat / DM (next to each message group, social.js hook chatSeen), Medlemmar
     (statusRow), Vänner rows (friendRow), the group NU strip (faces), the Profil hero (profileAv → opens the editor).
   - Cache per group / friends 60 s; every avatar element has data-avk so a save repaints all of them at once.
   Public: window.AVATAR. Styles: avatar.css. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, me = null, meP = null, uid = 0;
  var groups = {}, friends = null, svgMemo = {}, svgMemoN = 0;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function esc(s) { return U && U.esc ? U.esc(s) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function missing(err) {
    try { if (U.missing) return U.missing(err); } catch (e) {}
    var m = String((err && (err.code || "")) + " " + (err && err.message || ""));
    return /PGRST202|42883|does not exist|Could not find the function/i.test(m);
  }
  function codeOf(err) { var m = String((err && err.message) || ""); var x = m.match(/(invalid_avatar|locked|slow_down|not_member|not_authenticated)/); return x ? x[1] : ""; }
  function rpc(name, params) {
    if (!A || !A.rpc) return Promise.resolve({ data: null, error: { message: "no_api" } });
    return A.rpc(name, params).then(function (r) {
      if (r && r.error && missing(r.error)) off = true;
      return r || { data: null, error: { message: "error" } };
    });
  }
  function parse(d) { return A && A.parseData ? A.parseData(d) : (typeof d === "string" ? JSON.parse(d) : d || {}); }

  /* ---------- Catalog ---------- */
  var SKIN = ["#f7d9c4", "#efc3a1", "#dca47c", "#c08457", "#9a643f", "#6f4529", "#4b2e1c", "#8fd18a"];
  var HAIRC = ["#1d1a19", "#3b2618", "#6b4426", "#d9b25c", "#b5532a", "#8d8d8d", "#e8e6e1", "#ff6fae", "#4aa3ff"];
  var TOPC = ["#2f6fb8", "#c8202a", "#1fa45c", "#f5a623", "#6b2d8f", "#3a4766", "#e8e6e1", "#2b2b2b"];
  var BGC = ["#f5a623", "#1fa45c", "#2f6fb8", "#c8202a", "#6b2d8f", "#1d8a8a", "#34497f", "#d9578f"];
  var N = {   // item names [sv, en] per slot
    sk: [["Ljus", "Light"], ["Ljus 2", "Light 2"], ["Mellan", "Medium"], ["Mellan 2", "Medium 2"], ["Mörk", "Dark"], ["Mörk 2", "Dark 2"], ["Mörkast", "Deep"], ["Grönis", "Greenie"]],
    fs: [["Rund", "Round"], ["Oval", "Oval"], ["Kantig", "Square"]],
    ey: [["Prickar", "Dots"], ["Glada", "Happy"], ["Stora", "Wide"], ["Sömniga", "Sleepy"], ["Blink", "Wink"], ["Fokus", "Focus"], ["Stjärnor", "Stars"]],
    br: [["Inga", "None"], ["Raka", "Flat"], ["Höjda", "Raised"], ["Arga", "Angry"], ["Buskiga", "Bushy"]],
    mt: [["Leende", "Smile"], ["Flin", "Grin"], ["Skratt", "Laugh"], ["Rak", "Flat"], ["Snett", "Smirk"], ["Oj", "Oh"], ["Tunga", "Tongue"]],
    hr: [["Flint", "Bald"], ["Snagg", "Buzz"], ["Bena", "Side part"], ["Tofs", "Quiff"], ["Rufsig", "Messy"], ["Långt", "Long"], ["Knut", "Bun"], ["Lockigt", "Curly"], ["Hästsvans", "Ponytail"], ["Mohikan", "Mohawk"], ["Hockeyfrilla", "Mullet"]],
    hc: [["Svart", "Black"], ["Mörkbrun", "Dark brown"], ["Brun", "Brown"], ["Blond", "Blond"], ["Röd", "Ginger"], ["Grå", "Grey"], ["Vit", "White"], ["Rosa", "Pink"], ["Blå", "Blue"]],
    fh: [["Inget", "None"], ["Skäggstubb", "Stubble"], ["Mustasch", "Mustache"], ["Valross", "Walrus"], ["Pipskägg", "Goatee"], ["Helskägg", "Full beard"], ["Hakband", "Chinstrap"], ["Styrmustasch", "Handlebar"], ["Vikingafläta", "Viking braid"]],
    hw: [["Inget", "None"], ["Keps", "Cap"], ["Keps bak", "Backwards cap"], ["Mössa", "Beanie"], ["Bucket hat", "Bucket hat"], ["Fältmössa", "Field cap"], ["Basker", "Beret"], ["Hjälm", "Helmet"], ["Headset", "Headset"], ["Partyhatt", "Party hat"], ["Vikingahjälm", "Viking helmet"], ["Skärmmössa", "Peaked cap"], ["Tomteluva", "Santa hat"], ["Krona", "Crown"]],
    gl: [["Inget", "None"], ["Runda", "Round"], ["Fyrkant", "Square"], ["Solglas", "Shades"], ["Skidglas", "Ski goggles"], ["Pilot", "Aviators"], ["Rånarluva", "Balaclava"], ["Partymask", "Party mask"], ["Ögonlapp", "Eye patch"], ["Mörkersikte", "Night vision"], ["Monokel", "Monocle"]],
    up: [["T-shirt", "T-shirt"], ["Huvtröja", "Hoodie"], ["Flanell", "Flannel"], ["Matchtröja", "Jersey"], ["Fältjacka", "Field jacket"], ["Officersjacka", "Officer jacket"], ["Generalsrock", "General's coat"], ["Amiralsrock", "Admiral's coat"], ["Smoking", "Tuxedo"]],
    uc: [["Blå", "Blue"], ["Röd", "Red"], ["Grön", "Green"], ["Gul", "Amber"], ["Lila", "Purple"], ["Grå", "Slate"], ["Vit", "White"], ["Svart", "Black"]],
    bg: [["Bärnsten", "Amber"], ["Grön", "Green"], ["Blå", "Blue"], ["Röd", "Red"], ["Lila", "Purple"], ["Petrol", "Teal"], ["Natt", "Night"], ["Rosa", "Pink"], ["Kamouflage", "Camo"], ["Eld", "Flame"], ["Norrsken", "Aurora"], ["Guld", "Gold"]]
  };
  var MAX = { sk: 7, fs: 2, ey: 6, br: 4, mt: 6, hr: 10, hc: 8, fh: 8, hw: 13, gl: 10, up: 8, uc: 7, bg: 11, ms: 1 };
  // Same as SQL olnu_avatar_locks() (0172).
  var LOCKS = {
    "sk:7": { r: 6 }, "ey:6": { r: 8 }, "mt:6": { m: "radio" },
    "hr:9": { r: 5 }, "hr:10": { b: 5 }, "hc:7": { m: "sr10" }, "hc:8": { s: 3 },
    "fh:7": { r: 7 }, "fh:8": { t: 2 },
    "hw:5": { r: 3 }, "hw:6": { r: 4 }, "hw:7": { r: 6 }, "hw:8": { r: 9 }, "hw:9": { e: 1 }, "hw:10": { t: 3 },
    "hw:11": { r: 12 }, "hw:12": { m: "lucia" }, "hw:13": { m: "kung" },
    "gl:5": { r: 7 }, "gl:6": { r: 5 }, "gl:7": { e: 1 }, "gl:8": { m: "uggla" }, "gl:9": { r: 14 }, "gl:10": { r: 17 },
    "up:3": { m: "sg10" }, "up:4": { r: 4 }, "up:5": { r: 12 }, "up:6": { r: 20 }, "up:7": { r: 25 }, "up:8": { s: 4 },
    "bg:8": { r: 3 }, "bg:9": { s: 2 }, "bg:10": { t: 2 }, "bg:11": { r: 15 }
  };
  var CAPS = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 10: 1, 11: 1, 12: 1 };   // headwear that hides the top of the hair
  var HIDDEN_MEDALS = { het: 1, medevac: 1 };

  /* ---------- Small helpers ---------- */
  function shade(hex, f) {   // f < 0 darker, f > 0 lighter
    var n = parseInt(String(hex).slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function c(x) { return Math.max(0, Math.min(255, Math.round(f < 0 ? x * (1 + f) : x + (255 - x) * f))); }
    return "#" + ((1 << 24) | (c(r) << 16) | (c(g) << 8) | c(b)).toString(16).slice(1);
  }
  function P(d, fill, x) { return '<path d="' + d + '" fill="' + fill + '"' + (x || "") + "/>"; }
  function S(d, col, w, x) { return '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round"' + (x || "") + "/>"; }
  function C(cx, cy, r, fill, x) { return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '"' + (x || "") + "/>"; }
  function hashStr(s) { var h = 2166136261; s = String(s || ""); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var a = hashStr(seed) || 1; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function clamp(spec, k) { var v = spec && spec[k]; v = typeof v === "number" ? v | 0 : 0; return v < 0 || v > MAX[k] ? 0 : v; }

  /* ---------- Default character (deterministic per seed; only free items) ---------- */
  function defaultSpec(seed, rank) {
    var R = rng("av:" + (seed || "x")), pick = function (n) { return Math.floor(R() * n); };
    var s = { v: 1, sk: pick(7), fs: pick(3), ey: pick(6), br: 1 + pick(4), mt: pick(6), hr: pick(9), hc: pick(7),
      fh: 0, hw: 0, gl: 0, up: pick(3), uc: pick(8), bg: pick(8), ms: 1 };
    if (R() < 0.42) s.fh = 1 + pick(6);
    if (R() < 0.3) s.hw = [1, 2, 3, 4][pick(4)];
    if (R() < 0.2) s.gl = [1, 2, 3][pick(3)];
    rank = rank | 0;
    if (rank >= 12 && R() < 0.6) s.up = 5; else if (rank >= 4 && R() < 0.5) s.up = 4;
    return s;
  }

  /* ---------- Ribbons (same colours as the uniform: MEDALS.ribbonBg) ---------- */
  var ribMemo = {};
  function ribbonStops(id) {
    if (ribMemo[id]) return ribMemo[id];
    var out = [];
    try {
      var bg = window.MEDALS && window.MEDALS.ribbonBg ? window.MEDALS.ribbonBg(id) : "";
      var re = /(#[0-9a-fA-F]{3,8})\s+([\d.]+)%\s+([\d.]+)%/g, m;
      while ((m = re.exec(bg))) out.push([m[1], +m[2], +m[3]]);
    } catch (e) { out = []; }
    if (!out.length) { var h = hashStr(id), cs = ["#b3121b", "#1f6fb8", "#1fa45c", "#f5a623", "#6b2d8f"]; out = [[cs[h % 5], 0, 30], [cs[(h >> 3) % 5], 30, 70], [cs[h % 5], 70, 100]]; }
    ribMemo[id] = out;
    return out;
  }
  function ribbonsSVG(md) {
    if (!md || !md.length) return "";
    var h = "", w = 6.4, hh = 3.2, x0 = 58, y0 = 84;
    md.slice(0, 6).forEach(function (id, i) {
      var x = x0 + (i % 3) * (w + 0.8), y = y0 + Math.floor(i / 3) * (hh + 0.9);
      ribbonStops(id).forEach(function (s) { h += '<rect x="' + (x + w * s[1] / 100).toFixed(2) + '" y="' + y + '" width="' + (w * (s[2] - s[1]) / 100 + 0.05).toFixed(2) + '" height="' + hh + '" fill="' + s[0] + '"/>'; });
      h += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + hh + '" fill="none" stroke="rgba(0,0,0,.45)" stroke-width=".4"/>';
    });
    return h;
  }

  /* ---------- Art ---------- */
  var SHOULDERS = "M4,100 C6,84 22,77 38,75 L62,75 C78,77 94,84 96,100Z";
  var SIDEPART = "M29,46 C27,28 38,19 51,19 C64,19 73,28 71,46 L68.5,46 C67.5,36 62,31 56,30 C48,34 38,33 32.5,36.5 C31.5,39.5 31.5,43 31.5,46Z";
  function rankMark(r, x, y, col) {   // small rank insignia
    r = r | 0; var h = "";
    if (r >= 20) { h += C(x, y, 2.2, "#ffc24d") + C(x + 5, y, 2.2, "#ffc24d") + S("M" + (x - 3) + "," + (y + 3.5) + " L" + (x + 8) + "," + (y + 3.5), "#ffc24d", 1); }
    else if (r >= 11) { var n = r >= 17 ? 3 : r >= 14 ? 2 : 1; for (var i = 0; i < n; i++) h += P(star(x + i * 4.2, y, 1.8), "#ffc24d"); }
    else { var c = Math.max(1, Math.min(3, Math.ceil(r / 3))); for (var j = 0; j < c; j++) h += S("M" + (x - 2.5) + "," + (y + j * 2.2 - 1) + " L" + x + "," + (y + j * 2.2 + 1) + " L" + (x + 2.5) + "," + (y + j * 2.2 - 1), col || "#ffc24d", 1); }
    return h;
  }
  function star(cx, cy, r) {
    var d = "";
    for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; d += (i ? "L" : "M") + (cx + rr * Math.cos(a)).toFixed(2) + "," + (cy + rr * Math.sin(a)).toFixed(2); }
    return d + "Z";
  }
  function bgSVG(b, id) {
    if (b < 8) return '<rect width="100" height="100" fill="' + BGC[b] + '"/>';
    if (b === 8) return '<rect width="100" height="100" fill="#5b6338"/>' + P("M0,20 C14,10 24,26 38,18 C46,30 30,38 14,34 C6,32 2,28 0,30Z", "#3f4527") + P("M60,4 C74,0 88,10 100,6 L100,30 C88,34 76,24 66,28 C58,22 54,12 60,4Z", "#7a7d4a") + P("M70,46 C84,40 96,52 100,48 L100,70 C90,74 80,62 72,64Z", "#3f4527") + P("M0,52 C10,46 20,58 26,66 C16,72 6,66 0,70Z", "#7a7d4a");
    if (b === 9) return '<rect width="100" height="100" fill="#3a0d0d"/>' + P("M0,100 L0,62 C8,70 10,52 18,46 C18,60 26,62 28,50 C34,58 34,68 40,60 C44,52 42,44 48,36 C50,50 58,52 56,62 C62,58 66,50 64,40 C72,48 74,60 80,56 C84,50 82,42 86,38 C88,50 96,54 100,48 L100,100Z", "#ff7a1a") + P("M0,100 L0,78 C10,82 14,68 22,66 C22,76 30,78 34,70 C40,78 46,74 50,66 C54,76 62,78 66,70 C70,78 78,76 82,68 C86,76 94,78 100,72 L100,100Z", "#ffc24d");
    if (b === 10) return '<rect width="100" height="100" fill="#0b1638"/>' + P("M-4,40 C20,20 40,46 60,26 C74,14 90,22 104,12 L104,24 C90,34 76,26 62,38 C42,56 22,32 -4,52Z", "#3ddc84", ' opacity=".75"') + P("M-4,58 C18,44 38,62 58,46 C74,34 92,44 104,36 L104,44 C92,52 76,44 60,54 C40,68 20,52 -4,64Z", "#b26bff", ' opacity=".55"') + C(18, 14, 0.9, "#fff") + C(80, 8, 0.7, "#fff") + C(46, 10, 0.6, "#fff");
    return '<defs><radialGradient id="' + id + 'g" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="#fff1b8"/><stop offset=".55" stop-color="#f5c542"/><stop offset="1" stop-color="#a86a00"/></radialGradient></defs><rect width="100" height="100" fill="url(#' + id + 'g)"/>' + '<circle cx="50" cy="50" r="47" fill="none" stroke="#fff6cc" stroke-width="1.5" opacity=".7"/>';
  }
  function topSVG(s, r, md) {
    var u = s.up, col = TOPC[s.uc], h = "", dk = shade(col, -0.25);
    var neckLine = S("M41,75.5 Q50,84 59,75.5", dk, 2);
    if (u === 0) h = P(SHOULDERS, col) + neckLine;
    else if (u === 1) h = P("M30,80 C28,68 40,64 50,64 C60,64 72,68 70,80Z", dk) + P(SHOULDERS, col) + P("M38,75 C40,86 60,86 62,75 L58,75 C56,81 44,81 42,75Z", dk) + S("M45,82 L44.5,92 M55,82 L55.5,92", "#eef0ec", 1.1);
    else if (u === 2) {
      h = P(SHOULDERS, col);
      for (var i = 0; i < 6; i++) h += S("M" + (10 + i * 16) + ",76 L" + (10 + i * 16) + ",100", dk, 3, ' opacity=".6"');
      h += S("M4,88 L96,88 M4,96 L96,96", dk, 2.2, ' opacity=".55"') + P("M40,75 L50,86 L60,75 L56,74 L50,80 L44,74Z", shade(col, 0.25));
    } else if (u === 3) h = P(SHOULDERS, col) + P("M22,79 C26,77 30,76 34,75.6 L36,100 L28,100Z", "#eef0ec", ' opacity=".9"') + P("M78,79 C74,77 70,76 66,75.6 L64,100 L72,100Z", "#eef0ec", ' opacity=".9"') + P("M42,75 L50,84 L58,75Z", dk);
    else if (u === 4) {
      var o = "#59613a";
      h = P(SHOULDERS, o) + P("M20,82 C26,78 30,80 34,84 C28,88 22,88 20,82Z", "#3f4527") + P("M70,90 C76,86 84,88 86,94 C80,96 74,96 70,90Z", "#7a7d4a") + P("M44,96 C48,92 54,94 56,100 L44,100Z", "#3f4527");
      h += P("M37,75 L50,86 L44,90 L33,78Z", "#4a5230") + P("M63,75 L50,86 L56,90 L67,78Z", "#4a5230") + S("M50,86 L50,100", "#3f4527", 1);
      h += '<rect x="39" y="90" width="7" height="6" rx="1" fill="#2a2f1a"/>' + rankMark(r, 42.5, 93, "#e8e6c8");
    } else if (u === 5 || u === 6 || u === 7) {
      var base = u === 5 ? "#2f3b26" : u === 6 ? "#24301f" : "#14223f", gold = "#ffc24d";
      h = P(SHOULDERS, base) + P("M42,75 L50,92 L58,75Z", "#eef0ec") + P("M48.4,78 L51.6,78 L52.6,90 L50,93 L47.4,90Z", u === 7 ? "#111" : "#3f2a14");
      h += P("M38,75 L50,94 L46,100 L33,79Z", shade(base, 0.12)) + P("M62,75 L50,94 L54,100 L67,79Z", shade(base, 0.12));
      h += C(50, 96, 1, gold);
      h += '<rect x="16" y="79" width="13" height="4" rx="2" transform="rotate(-18 22 81)" fill="' + (u === 5 ? shade(base, 0.2) : gold) + '"/><rect x="71" y="79" width="13" height="4" rx="2" transform="rotate(18 78 81)" fill="' + (u === 5 ? shade(base, 0.2) : gold) + '"/>';
      if (u === 6) h += S("M62,80 C70,90 76,92 84,88", gold, 1.3) + S("M38,78 L42,84 M62,78 L58,84", gold, 1.6);
      if (u === 7) h += S("M8,96 L20,96 M80,96 L92,96", gold, 1.5);
      h += rankMark(r, u === 5 ? 20 : 19, 81);
    } else if (u === 8) h = P(SHOULDERS, "#121212") + P("M42,75 L50,94 L58,75Z", "#f4f4f2") + P("M38,75 L50,96 L46,100 L33,79Z", "#232323") + P("M62,75 L50,96 L54,100 L67,79Z", "#232323") + P("M45.5,77 L50,79 L54.5,77 L54.5,82 L50,80 L45.5,82Z", "#111") + C(50, 86, 0.7, "#111") + C(50, 90, 0.7, "#111");
    if (md && md.length) h += ribbonsSVG(md);
    return h;
  }
  function hairBack(s, col) {
    var hr = s.hr;
    if (hr === 5) return P("M27,40 C27,22 38,17 50,17 C62,17 73,22 73,40 L76,76 L62,74 L62,52 L38,52 L38,74 L24,76Z", col);
    if (hr === 7) return C(50, 38, 25, col) + C(28, 52, 7, col) + C(72, 52, 7, col);
    if (hr === 8) return P("M66,30 C82,30 84,54 76,70 C72,60 70,46 63,40Z", col) + C(68, 31, 3, shade(col, 0.25));
    if (hr === 10) return P("M31,44 L29,70 C36,76 64,76 71,70 L69,44Z", col);
    return "";
  }
  function hairFront(s, col) {
    var hr = s.hr, dk = shade(col, -0.2);
    switch (hr) {
      case 1: return P("M30,44 C30,28 40,22 50,22 C60,22 70,28 70,44 C66,36 60,32.5 50,32.5 C40,32.5 34,36 30,44Z", col, ' opacity=".9"');
      case 2: case 5: case 8: case 10: return P(SIDEPART, col);
      case 3: return P(SIDEPART, col) + P("M33,32 C33,14 52,8 66,16 C60,17 55,22 53,29 C46,31 39,32 33,32Z", col) + S("M40,22 C46,16 54,14 60,15", shade(col, 0.2), 1.2);
      case 4: return P("M29,44 L30,30 L34,32 L36,21 L41,27 L45,17 L49,25 L54,16 L57,25 L62,19 L63,28 L68,25 L68,34 L71,44 C66,35 60,31 50,31 C40,31 34,35 29,44Z", col);
      case 6: return C(50, 15, 7.5, col) + C(48, 13, 2, shade(col, 0.2)) + P(SIDEPART, col);
      case 7: var h = ""; [[33, 34], [38, 27], [45, 23], [52, 22], [59, 24], [65, 29], [69, 36], [31, 41], [70, 43]].forEach(function (p) { h += C(p[0], p[1], 6.2, col); }); return h + S("M40,28 C44,25 48,25 50,27 M54,25 C58,24 62,26 63,29", dk, 1.1);
      case 9: return P("M30,44 C30,30 40,24 50,24 C60,24 70,30 70,44 C66,37 60,34 50,34 C40,34 34,37 30,44Z", col, ' opacity=".35"') + P("M44.5,34 L46,8 L48.5,13 L50,6 L51.5,13 L54,8 L55.5,34Z", col);
      default: return "";
    }
  }
  function headPath(fs) {
    if (fs === 1) return '<ellipse cx="50" cy="45" rx="18.5" ry="22"';
    if (fs === 2) return '<rect x="30" y="24.5" width="40" height="42" rx="11"';
    return '<circle cx="50" cy="45.5" r="20.5"';
  }
  function eyesSVG(e) {
    var d = "#1a1410", h = "";
    function both(fn) { return fn(42) + fn(58); }
    if (e === 1) return both(function (x) { return S("M" + (x - 3) + ",47 Q" + x + ",43 " + (x + 3) + ",47", d, 1.8); });
    if (e === 2) return both(function (x) { return C(x, 46, 3.6, "#fff") + C(x + 0.4, 46.4, 1.9, d) + C(x + 1.1, 45.6, 0.6, "#fff"); });
    if (e === 3) return both(function (x) { return P("M" + (x - 3.3) + ",45.6 Q" + x + ",49.8 " + (x + 3.3) + ",45.6Z", d) + S("M" + (x - 3.6) + ",45.6 L" + (x + 3.6) + ",45.6", d, 1.2); });
    if (e === 4) return C(42, 46, 2.3, d) + C(42.7, 45.3, 0.6, "#fff") + S("M55,46.5 Q58,43.5 61,46.5", d, 1.8);
    if (e === 5) return both(function (x) { return '<ellipse cx="' + x + '" cy="46.4" rx="2.6" ry="1.9" fill="' + d + '"/>'; }) + S("M38.6,43.4 L45,44.6 M61.4,43.4 L55,44.6", d, 1.3);
    if (e === 6) return both(function (x) { return P(star(x, 46, 3.6), "#ffc24d", ' stroke="#8a5a00" stroke-width=".5"'); });
    return both(function (x) { return C(x, 46, 2.3, d) + C(x + 0.7, 45.3, 0.6, "#fff"); });
  }
  function browsSVG(b, col) {
    if (b === 1) return S("M38.5,40.5 L45.5,40.5 M54.5,40.5 L61.5,40.5", col, 1.6);
    if (b === 2) return S("M38.5,41 Q42,37.5 45.5,40 M54.5,40 Q58,37.5 61.5,41", col, 1.6);
    if (b === 3) return S("M38.5,39 L45.5,41.5 M54.5,41.5 L61.5,39", col, 1.8);
    if (b === 4) return S("M38,40.6 Q42,38 46,40.2 M54,40.2 Q58,38 62,40.6", col, 3);
    return "";
  }
  function mouthSVG(m) {
    var d = "#5a1f1a";
    if (m === 1) return P("M43,55 Q50,62.5 57,55Z", d) + P("M44.4,55.4 L55.6,55.4 L55,57 L45,57Z", "#fff");
    if (m === 2) return P("M42.5,54 Q50,67 57.5,54Z", d) + P("M46,60.5 Q50,57.5 54,60.5 Q50,63.5 46,60.5Z", "#e66a7a");
    if (m === 3) return S("M45,57 L55,57", d, 1.7);
    if (m === 4) return S("M45,57.5 Q52,59.5 56,54.5", d, 1.7);
    if (m === 5) return '<ellipse cx="50" cy="57.5" rx="2.6" ry="3.1" fill="' + d + '"/>';
    if (m === 6) return S("M44,56 Q50,60.5 56,56", d, 1.7) + P("M47.4,57.6 L52.6,57.6 L52.6,61 Q50,63.6 47.4,61Z", "#e66a7a");
    return S("M44,56 Q50,61 56,56", d, 1.7);
  }
  function facialHair(f, col) {
    var must = P("M41,54 C44,50.8 48,51 50,53 C52,51 56,50.8 59,54 C56,56 53,55.2 50,54.6 C47,55.2 44,56 41,54Z", col);
    switch (f) {
      case 1: return P("M31,48 C32,63 40,68.5 50,68.5 C60,68.5 68,63 69,48 C67,58 62,61 58,61 C55,59.8 45,59.8 42,61 C38,61 33,58 31,48Z", col, ' opacity=".35"') + P("M42,53.2 Q50,50.6 58,53.2 L57,54.4 Q50,52.6 43,54.4Z", col, ' opacity=".35"');
      case 2: return must;
      case 3: return P("M39,53 C43,49 48,50 50,52 C52,50 57,49 61,53 L61.5,59.5 C57.5,56.5 54,56.6 50,56.6 C46,56.6 42.5,56.5 38.5,59.5Z", col);
      case 4: return must + P("M45.4,61 C46.2,67.5 53.8,67.5 54.6,61 C52.6,62.8 47.4,62.8 45.4,61Z", col);
      case 5: case 8: return P("M30,46 C30,65 39,73 50,73 C61,73 70,65 70,46 L66.5,48 C65,58 59,61.2 50,61.2 C41,61.2 35,58 33.5,48Z", col) + must + (f === 8 ? P("M47,70 L53,70 L52.2,84 L47.8,84Z", col) + S("M47.3,74 L52.7,74 M47.5,78 L52.5,78", "#ffc24d", 1) : "");
      case 6: return P("M31,47 C32,64 40,69.5 50,69.5 C60,69.5 68,64 69,47 L67,47 C66,61 59,65.6 50,65.6 C41,65.6 34,61 33,47Z", col);
      case 7: return P("M38,51 C40,56 46,52.3 50,53.2 C54,52.3 60,56 62,51 C63.6,54.6 60.4,57.6 57,56.4 C54.4,55.4 52,55.4 50,55.4 C48,55.4 45.6,55.4 43,56.4 C39.6,57.6 36.4,54.6 38,51Z", col);
      default: return "";
    }
  }
  function glassesSVG(g, id) {
    var k = "#15161a";
    switch (g) {
      case 1: return S("M48.2,46 Q50,44.6 51.8,46", k, 1.2) + '<circle cx="42" cy="46" r="5.6" fill="rgba(255,255,255,.12)" stroke="' + k + '" stroke-width="1.4"/><circle cx="58" cy="46" r="5.6" fill="rgba(255,255,255,.12)" stroke="' + k + '" stroke-width="1.4"/>' + S("M36.4,45 L31,44 M63.6,45 L69,44", k, 1.2);
      case 2: return '<rect x="35.6" y="41.6" width="12.4" height="9" rx="2" fill="rgba(255,255,255,.12)" stroke="' + k + '" stroke-width="1.5"/><rect x="52" y="41.6" width="12.4" height="9" rx="2" fill="rgba(255,255,255,.12)" stroke="' + k + '" stroke-width="1.5"/>' + S("M48,45 L52,45 M35.6,44 L31,43 M64.4,44 L69,43", k, 1.4);
      case 3: return '<rect x="35" y="42" width="13.4" height="8.6" rx="3.6" fill="#101216"/><rect x="51.6" y="42" width="13.4" height="8.6" rx="3.6" fill="#101216"/>' + S("M48.4,44.4 L51.6,44.4 M35,44 L30.6,43 M65,44 L69.4,43", k, 1.5) + S("M38,44.4 L41,44.4 M54.6,44.4 L57.6,44.4", "#fff", 0.9, ' opacity=".5"');
      case 4: return '<rect x="27" y="42" width="46" height="5" fill="#2b2b2b"/><defs><linearGradient id="' + id + 'k" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd36b"/><stop offset=".5" stop-color="#ff7a1a"/><stop offset="1" stop-color="#b26bff"/></linearGradient></defs><rect x="32" y="38.6" width="36" height="14" rx="7" fill="url(#' + id + 'k)" stroke="#eef0ec" stroke-width="1.6"/>' + S("M37,42 L45,42", "#fff", 1.2, ' opacity=".7"');
      case 5: return P("M35,43 C35,41.4 48,41.4 48,43 C48,48 46,51.4 41.6,51.4 C37.2,51.4 35,48 35,43Z", "#2b3a4a", ' stroke="#c8a24a" stroke-width="1"') + P("M52,43 C52,41.4 65,41.4 65,43 C65,48 62.8,51.4 58.4,51.4 C54,51.4 52,48 52,43Z", "#2b3a4a", ' stroke="#c8a24a" stroke-width="1"') + S("M48,43 L52,43 M35,43 L31,42.4 M65,43 L69,42.4", "#c8a24a", 1);
      case 6: return P("M50,19.5 C66,19.5 73,30 72.5,46 C72,62 66,74 50,74 C34,74 28,62 27.5,46 C27,30 34,19.5 50,19.5Z M36.5,41 Q50,38.6 63.5,41 Q65,46 63.5,51 Q50,52.6 36.5,51 Q35,46 36.5,41Z", "#1b1d22", ' fill-rule="evenodd"') + C(50, 20.5, 3, "#1b1d22");
      case 7: return P("M33,44 C33,39.4 40,39.4 46,42 L50,43.6 L54,42 C60,39.4 67,39.4 67,44 C67,50 60,51.6 54,49 L50,47.6 L46,49 C40,51.6 33,50 33,44Z M38,45.4 A3.2,2.4 0 1 0 44.4,45.4 A3.2,2.4 0 1 0 38,45.4Z M55.6,45.4 A3.2,2.4 0 1 0 62,45.4 A3.2,2.4 0 1 0 55.6,45.4Z", "#8a3ad6", ' fill-rule="evenodd"') + P(star(66, 40, 1.8), "#ffc24d") + P(star(34, 40.6, 1.4), "#ffc24d");
      case 8: return S("M30,40 L70,38.6", k, 1.2) + '<ellipse cx="58" cy="46" rx="5.4" ry="4.6" fill="' + k + '"/>';
      case 9: return '<rect x="36" y="27" width="28" height="5" rx="2" fill="#2a2f1a"/><rect x="47.6" y="31" width="4.8" height="9" fill="#2a2f1a"/><rect x="36.4" y="39" width="11.4" height="11.4" rx="2.6" fill="#1f241a"/><rect x="52.2" y="39" width="11.4" height="11.4" rx="2.6" fill="#1f241a"/>' + C(42.1, 44.7, 3.6, "#3ddc84", ' opacity=".85"') + C(57.9, 44.7, 3.6, "#3ddc84", ' opacity=".85"');
      case 10: return '<circle cx="58" cy="46" r="5.4" fill="rgba(255,255,255,.15)" stroke="#d6a93a" stroke-width="1.4"/>' + S("M62.6,49 C66,56 64,64 70,72", "#d6a93a", 0.8);
      default: return "";
    }
  }
  function hatSVG(h, s, id) {
    var c = TOPC[s.uc], dk = shade(c, -0.3);
    switch (h) {
      case 1: return P("M29,36 C29,19 40,14.5 50,14.5 C60,14.5 71,19 71,36Z", c) + P("M27,36 C40,32.6 62,32.6 84,38 C72,41.6 40,40.4 27,38.6Z", dk) + C(50, 15, 1.6, dk) + S("M50,15 L50,35", dk, 0.7, ' opacity=".5"');
      case 2: return P("M29,36 C29,19 40,14.5 50,14.5 C60,14.5 71,19 71,36Z", c) + P("M24.6,32.4 C18,32 16,36.6 21,38.4 L31,37Z", dk) + C(50, 15, 1.6, dk) + '<rect x="44" y="30" width="12" height="4" rx="2" fill="' + dk + '"/>';
      case 3: return P("M28,36 C28,17 40,12 50,12 C60,12 72,17 72,36Z", c) + '<rect x="26.6" y="31" width="46.8" height="8.4" rx="4" fill="' + dk + '"/>' + S("M34,33 L34,38 M40,33 L40,38 M46,33 L46,38 M52,33 L52,38 M58,33 L58,38 M64,33 L64,38", shade(c, -0.45), 1, ' opacity=".6"') + C(50, 11, 4.4, "#eef0ec");
      case 4: return P("M32.4,33 C33,17.4 67,17.4 67.6,33Z", "#c9b78a") + P("M23,36.6 C29,30 71,30 77,36.6 C70,39.4 30,39.4 23,36.6Z", "#b09d6c") + '<rect x="32.6" y="29.6" width="34.8" height="3.4" fill="#6f5d34"/>';
      case 5: return P("M29.4,36 L31.6,19.4 C40,17 60,17 68.4,19.4 L70.6,36Z", "#59613a") + P("M28,35 C40,32.6 60,32.6 73,35 L74,39 C60,37 40,37 27,39Z", "#3f4527") + '<rect x="46" y="24" width="8" height="5" rx="1" fill="#2a2f1a"/>' + C(50, 26.5, 1.2, "#ffc24d");
      case 6: return P("M27.6,35 C22,22 44,13 63,17.4 C76,20.6 78,30 71,35 C60,31.6 40,31.6 27.6,35Z", "#1d4d2b") + '<rect x="27" y="32.6" width="45" height="3.6" rx="1.8" fill="#13361e"/>' + C(39, 27, 2.6, "#ffc24d") + C(39, 27, 1.1, "#c8202a");
      case 7: return P("M26.6,40 C25.6,19 40,12 50,12 C60,12 74.4,19 73.4,40 L70,41.6 C66,35 34,35 30,41.6Z", "#4f5a33") + C(38, 24, 3, "#3a4224") + C(58, 20, 2.4, "#6b7442") + C(64, 31, 2.6, "#3a4224") + C(46, 32, 2, "#6b7442") + S("M30,41 C32,56 36,62 42,66 M70,41 C68,56 64,62 58,66", "#2a2f1a", 1.2);
      case 8: return S("M29,46 C27,18 73,18 71,46", "#22252b", 3) + '<rect x="24" y="40" width="8" height="12" rx="3.4" fill="#22252b"/><rect x="68" y="40" width="8" height="12" rx="3.4" fill="#22252b"/>' + S("M28,52 C28,60 34,62 42,59", "#22252b", 1.6) + C(42.6, 58.8, 1.8, "#c8202a");
      case 9: return '<g transform="rotate(14 50 26)">' + P("M39,27 L50,2 L61,27Z", "#ff5c93") + P("M42,20 L58,20 L56,15 L44,15Z", "#ffc24d") + P("M46,10 L54,10 L52.6,6.6 L47.4,6.6Z", "#4aa3ff") + C(50, 2.6, 3, "#ffc24d") + "</g>";
      case 10: return P("M27,38 C26,19 40,13 50,13 C60,13 74,19 73,38Z", "#8a8f99") + '<rect x="26" y="33" width="48" height="5.6" rx="2.6" fill="#6b4426"/>' + P("M27,30 C16,28 12,16 16,8 C19,16 23,20 30,22Z", "#f2ead6") + P("M73,30 C84,28 88,16 84,8 C81,16 77,20 70,22Z", "#f2ead6") + S("M50,13 L50,33", "#6f747d", 1.6) + C(36, 35.8, 0.9, "#ffc24d") + C(64, 35.8, 0.9, "#ffc24d");
      case 11: return P("M24,31 C24,17 76,17 76,31 L70,35 L30,35Z", "#2f3b26") + '<rect x="29" y="30" width="42" height="5.6" fill="#1a2214"/>' + P("M29,35 C38,33 62,33 71,35 C66,40 34,40 29,35Z", "#0f0f0f") + P(star(50, 26, 3.4), "#ffc24d") + S("M30,35.2 L70,35.2", "#ffc24d", 0.8);
      case 12: return P("M28,36 C29,17 50,8 72,13 C82,16 84,26 81,33 C77,25 71,22 66,24 C70,28 72,32 72,36Z", "#c8202a") + '<rect x="26" y="31.6" width="48" height="7.2" rx="3.6" fill="#f4f4f2"/>' + C(81, 33.6, 4, "#f4f4f2");
      case 13: return P("M31,32 L30.4,15 L38.4,23.4 L44,11 L50,21.4 L56,11 L61.6,23.4 L69.6,15 L69,32Z", "#f5c542", ' stroke="#a86a00" stroke-width=".8"') + '<rect x="31" y="28" width="38" height="4.6" fill="#e0a92a"/>' + C(50, 30.3, 1.6, "#c8202a") + C(40, 30.3, 1.3, "#2f6fb8") + C(60, 30.3, 1.3, "#1fa45c") + C(44, 11, 1.2, "#fff6cc") + C(56, 11, 1.2, "#fff6cc");
      default: return "";
    }
  }
  /* svg(spec, {r rank, md medal ids, id, vb viewBox, title}) → SVG string */
  function svg(spec, o) {
    o = o || {};
    var s = {}; Object.keys(MAX).forEach(function (k) { s[k] = clamp(spec, k); });
    if (!spec || spec.ms == null) s.ms = 1;
    var md = s.ms ? (o.md || []) : [];
    var key = JSON.stringify([s, md, o.r | 0, o.vb || ""]);
    var memo = svgMemo[key]; if (memo) return memo.replace(/__ID__/g, "av" + (++uid));
    var id = "__ID__", skin = SKIN[s.sk], hcol = HAIRC[s.hc], sh = shade(skin, -0.14);
    var browCol = s.hr === 0 && s.hc < 3 ? "#3b2618" : shade(hcol, -0.1);
    var capped = !!CAPS[s.hw], vb = o.vb || "0 0 100 100";
    var h = '<svg viewBox="' + vb + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
      '<defs><clipPath id="' + id + 'c"><circle cx="50" cy="50" r="50"/></clipPath><clipPath id="' + id + 'h"><rect x="0" y="' + (s.hw === 7 ? 37 : 33.5) + '" width="100" height="70"/></clipPath></defs>' +
      '<g clip-path="url(#' + id + 'c)">' + bgSVG(s.bg, id);
    var ov = s.fs === 1 ? ' transform="translate(50 45) scale(.93 1.05) translate(-50 -45)"' : "";
    h += "<g" + ov + ">" + hairBack(s, hcol) + "</g>";
    h += '<rect x="42.6" y="56" width="14.8" height="22" rx="5" fill="' + sh + '"/>';
    h += topSVG(s, o.r | 0, md);
    var ex = s.fs === 1 ? 4.6 : 0;
    h += C(29.6 + (s.fs === 1 ? 2.2 : 0), 47.5, 4.2, sh) + C(70.4 - (s.fs === 1 ? 2.2 : 0), 47.5, 4.2, sh) + (ex ? "" : "");
    h += headPath(s.fs) + ' fill="' + skin + '"/>';
    h += '<ellipse cx="40" cy="52" rx="3.4" ry="2" fill="#ff7b73" opacity=".18"/><ellipse cx="60" cy="52" rx="3.4" ry="2" fill="#ff7b73" opacity=".18"/>';
    h += P("M48.6,50.4 Q50,53.4 51.6,50.4", sh, ' stroke="' + sh + '" stroke-width=".6"');
    h += eyesSVG(s.ey) + browsSVG(s.br, browCol) + mouthSVG(s.mt) + facialHair(s.fh, shade(hcol, s.hc === 6 ? -0.05 : 0));
    var hf = hairFront(s, hcol);
    if (hf) h += "<g" + ov + (capped ? ' clip-path="url(#' + id + 'h)"' : "") + ">" + hf + "</g>";
    h += glassesSVG(s.gl, id);
    h += "<g" + ov + ">" + hatSVG(s.hw, s, id) + "</g>";
    h += "</g></svg>";
    if (svgMemoN > 400) { svgMemo = {}; svgMemoN = 0; }
    svgMemo[key] = h; svgMemoN++;
    return h.replace(/__ID__/g, "av" + (++uid));
  }

  /* ---------- People + cache ---------- */
  var TTL = 60000;
  function chestOf(p) {
    if (!p) return [];
    if (p.md) return p.md;
    return [];
  }
  function personSVG(p, o) {
    o = o || {};
    if (!p) return "";
    var spec = p.a || defaultSpec(p.seed || ("n:" + (p.name || "?")), p.r);
    return svg(spec, { r: p.r, md: chestOf(p), vb: o.vb });
  }
  function myMedals(spec, facts) {
    if (spec && spec.ms === 0) return [];
    if (spec && spec.md && spec.md.length) return spec.md.slice(0, 6);
    return ((facts && facts.m) || []).filter(function (x) { return !HIDDEN_MEDALS[x]; }).slice(0, 5);
  }
  function mePerson() {
    if (!me) return null;
    return { a: me.spec, seed: me.seed, r: me.facts ? me.facts.r : 1, md: myMedals(me.spec, me.facts), is_me: true, name: (A && A.getName && A.getName()) || "" };
  }
  function loadMe(force) {
    if (off) return Promise.resolve(null);
    if (meP && !force) return meP;
    meP = rpc("my_avatar").then(function (r) {
      if (r.error) { meP = null; return null; }
      me = parse(r.data); me.facts = me.facts || {};
      repaint();
      return me;
    });
    return meP;
  }
  function index(list) {
    var c = { at: Date.now(), byName: {}, byK: {}, me: null };
    (list || []).forEach(function (p) {
      if (p.is_me) c.me = p;
      if (p.k) c.byK[p.k] = p;
      if (p.name && !(p.is_me && c.byName[p.name])) c.byName[p.name] = p;
    });
    return c;
  }
  function forGroup(gid) {
    if (off || !gid) return Promise.resolve(null);
    var c = groups[gid];
    if (c && c.data && Date.now() - c.data.at < TTL) return Promise.resolve(c.data);
    if (c && c.p) return c.p;
    c = groups[gid] = groups[gid] || {};
    c.p = rpc("avatars_for", { p_group_id: gid }).then(function (r) {
      c.p = null;
      if (r.error) return c.data || null;
      c.data = index(parse(r.data).people);
      repaint();
      return c.data;
    });
    return c.data ? Promise.resolve(c.data) : c.p;
  }
  function forFriends() {
    if (off) return Promise.resolve(null);
    if (friends && friends.data && Date.now() - friends.data.at < TTL) return Promise.resolve(friends.data);
    if (friends && friends.p) return friends.p;
    friends = friends || {};
    friends.p = rpc("avatars_for", { p_group_id: null }).then(function (r) {
      friends.p = null;
      if (r.error) return friends.data || null;
      friends.data = index(parse(r.data).people);
      repaint();
      return friends.data;
    });
    return friends.data ? Promise.resolve(friends.data) : friends.p;
  }
  // avk: "me" | "g|<gid>|k|<k>" | "g|<gid>|n|<name>" | "f|<key>"
  function lookup(avk) {
    if (!avk) return null;
    if (avk === "me") return me ? mePerson() : null;
    var p = avk.split("|");
    if (p[0] === "f") { var f = friends && friends.data; return f ? f.byK[p[1]] || null : null; }
    if (p[0] === "g") {
      var d = groups[p[1]] && groups[p[1]].data; if (!d) return null;
      var x = p[2] === "k" ? d.byK[p.slice(3).join("|")] : d.byName[p.slice(3).join("|")];
      if (x && x.is_me && me) return mePerson();
      return x || null;
    }
    return null;
  }
  function paintEl(el) {
    var avk = el.getAttribute("data-avk"), p = lookup(avk);
    var sig = p ? JSON.stringify([p.a, p.seed, p.r, p.md]) : "";
    var tgt = el.querySelector(":scope > .av-pf-in") || el;
    if (!p) {
      if (!tgt.firstChild) { tgt.textContent = (el.getAttribute("data-avi") || "?").charAt(0).toUpperCase(); el.classList.add("av-ph"); }
      return;
    }
    if (el.__sig === sig && tgt.firstChild) return;
    el.__sig = sig;
    el.classList.remove("av-ph");
    tgt.innerHTML = personSVG(p, { vb: el.getAttribute("data-avvb") || "" });
  }
  var rpT = 0;
  function repaint() {
    if (rpT) return;
    rpT = setTimeout(function () {
      rpT = 0;
      try { document.querySelectorAll(".av[data-avk]").forEach(paintEl); } catch (e) {}
    }, 30);
  }
  function avEl(avk, initial, cls, label) {
    var e = document.createElement("span");
    e.className = "av" + (cls ? " " + cls : "");
    e.setAttribute("data-avk", avk);
    if (initial) e.setAttribute("data-avi", initial);
    if (label) e.setAttribute("aria-label", label); else e.setAttribute("aria-hidden", "true");
    paintEl(e);
    return e;
  }

  /* ---------- Chat (group, event chat, DM): one avatar per message group ---------- */
  var chat = { g: null, msgs: {}, t: 0 };
  function chatSeen(m, g) {
    if (off || !m || !g || !g.id) return;
    if (!chat.g || chat.g.id !== g.id) { chat.g = g; chat.msgs = {}; forGroup(g.id); if (!me) loadMe(); }
    chat.msgs[String(m.id)] = { me: !!m.is_me, name: m.name || "" };
    if (!chat.t) chat.t = setTimeout(decorateChat, 0);
  }
  function decorateChat() {
    chat.t = 0;
    var list = document.querySelector("#sheet-body .chat-list"); if (!list || !chat.g) return;
    var prev = null, gid = chat.g.id;
    for (var li = list.firstElementChild; li; li = li.nextElementSibling) {
      var info = li.classList.contains("chat-msg") ? chat.msgs[li.getAttribute("data-mid") || ""] : null;
      if (!info) { if (!li.classList.contains("chat-older-li")) prev = null; continue; }
      var who = info.me ? "\u0001me" : info.name || "\u0001?";
      var cont = prev === who;
      prev = who;
      if (info.me) { li.classList.add("av-mine"); continue; }
      li.classList.add("av-on");
      li.classList.toggle("av-cont", cont);
      var pic = li.querySelector(":scope > .av-pic");
      if (cont) { if (pic) pic.remove(); continue; }
      if (!pic) {
        var nm = info.name || L("Någon", "Someone");
        pic = avEl(info.name ? "g|" + gid + "|n|" + info.name : "none", nm, "av-pic", nm);
        pic.setAttribute("role", "button"); pic.setAttribute("tabindex", "-1");
        li.insertBefore(pic, li.firstChild);
      }
    }
  }
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest(".av-pic") : null;
    if (t) { var li = t.parentNode, n = li && li.querySelector(".cm-name.cm-tap"); if (n) n.click(); return; }
    var ed = e.target && e.target.closest ? e.target.closest("[data-av-edit]") : null;
    if (ed) { e.preventDefault(); e.stopPropagation(); openEditor(); }
  }, true);
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var ed = e.target && e.target.closest ? e.target.closest("[data-av-edit]") : null;
    if (ed) { e.preventDefault(); openEditor(); }
  });

  /* ---------- Member list, Vänner rows, NU strip, Profil ---------- */
  function statusRow(g, m, row) {
    if (off || !g || !g.id || !m || !row) return;
    var avk = m.is_me ? "me" : m.k ? "g|" + g.id + "|k|" + m.k : m.name ? "g|" + g.id + "|n|" + m.name : "";
    if (!avk) return;
    var e = avEl(avk, m.name || "?", "av-40" + (m.live ? " av-live" : "") + (m.is_me ? " av-me" : ""));
    var dot = row.querySelector(".st-dot");
    row.insertBefore(e, dot ? dot.nextSibling : row.firstChild);
    row.classList.add("av-row");
    forGroup(g.id); if (m.is_me && !me) loadMe();
  }
  function friendRow(p, li) {
    if (off || !p || !p.key || !li || li.querySelector(":scope > .av")) return;
    var e = avEl("f|" + p.key, p.name || "?", "av-40" + (p.out ? " av-live" : ""));
    var main = li.querySelector(".nr-fmain");
    li.insertBefore(e, main || li.firstChild);
    li.classList.add("av-row");
    forFriends();
  }
  function faces(box, out, g) {
    if (off || !box || !g || !g.id) return;
    var els = box.querySelectorAll(".gpg-face");
    for (var i = 0; i < els.length; i++) {
      var p = out[i]; if (!p) continue;
      var f = els[i];
      f.classList.add("av", "av-face");
      f.setAttribute("data-avk", p.me ? "me" : "g|" + g.id + "|n|" + (p.name || ""));
      f.setAttribute("data-avi", p.i || (p.name || "?").charAt(0));
      f.textContent = "";
      paintEl(f);
    }
    forGroup(g.id); if (!me) loadMe();
  }
  function profileAv(initial) {
    if (off) return null;
    if (!me) loadMe();
    // No SVG in this string: profile.js builds the hero with innerHTML and an <svg> there switches Chrome off its fast
    // parser path, which then un-nests the medal ribbon buttons. The SVG is painted into the element right after.
    setTimeout(repaint, 0);
    return '<div role="button" tabindex="0" class="pf-av av av-pf" data-avk="me" data-avi="' + esc(initial || "?") + '" data-av-edit="1" aria-label="' +
      esc(L("Ändra din avatar", "Edit your avatar")) + '"><span class="av-pf-in"></span><span class="av-pen" aria-hidden="true">✎</span></div>';
  }

  /* ---------- Unlock checks ---------- */
  function lockOf(k, i) { return LOCKS[k + ":" + i] || null; }
  function unlocked(lk, f) {
    if (!lk) return true;
    f = f || {};
    if (lk.r && (f.r | 0) < lk.r) return false;
    if (lk.m && (f.m || []).indexOf(lk.m) < 0) return false;
    if (lk.s && (f.s | 0) < lk.s) return false;
    if (lk.b && (f.b | 0) < lk.b) return false;
    if (lk.t && (f.t | 0) < lk.t) return false;
    if (lk.e && (f.e | 0) < lk.e) return false;
    return true;
  }
  function rankTitle(idx) {
    var T = window.SOCIAL && window.SOCIAL.TITLES;
    return T && T[idx - 1] ? T[idx - 1][1] : L("grad ", "rank ") + idx;
  }
  function medalName(id) { try { return window.MEDALS.info(id).name; } catch (e) { return id; } }
  function lockText(lk) {
    if (lk.r) return L("Låses upp vid ", "Unlocks at ") + rankTitle(lk.r);
    if (lk.m) return L("Låses upp med medaljen ", "Unlocks with the medal ") + medalName(lk.m);
    if (lk.s) return L("Låses upp vid " + lk.s + " helger i rad", "Unlocks at a " + lk.s + "-weekend streak");
    if (lk.b) return L("Låses upp vid " + lk.b + " krogar i Ölpasset", "Unlocks at " + lk.b + " bars in the passport");
    if (lk.t) return L("Låses upp vid " + lk.t + " orter", "Unlocks at " + lk.t + " towns");
    if (lk.e) return L("Låses upp när du gått på " + (lk.e === 1 ? "ett event" : lk.e + " event"), "Unlocks after " + lk.e + " event(s)");
    return "";
  }
  function shortLock(lk) {
    if (lk.r) { var t = rankTitle(lk.r); return t.split(" ")[0]; }
    if (lk.m) return medalName(lk.m);
    if (lk.s) return lk.s + L(" helger", " weekends");
    if (lk.b) return lk.b + L(" krogar", " bars");
    if (lk.t) return lk.t + L(" orter", " towns");
    if (lk.e) return lk.e + " event";
    return "";
  }

  /* ---------- Editor ---------- */
  var TABS = [
    ["face", "Ansikte", "Face"], ["hair", "Hår", "Hair"], ["beard", "Skägg", "Beard"], ["head", "Huvud", "Hat"],
    ["acc", "Ansikte+", "Glasses"], ["uni", "Uniform", "Uniform"], ["bg", "Bakgrund", "Background"]
  ];
  var FACE_VB = "24 20 52 52";
  var GROUPS = {
    face: [["sk", "Hudton", "Skin", "sw"], ["fs", "Form", "Shape"], ["ey", "Ögon", "Eyes", FACE_VB], ["br", "Ögonbryn", "Brows", FACE_VB], ["mt", "Mun", "Mouth", FACE_VB]],
    hair: [["hr", "Frisyr", "Style"], ["hc", "Hårfärg", "Colour", "sw"]],
    beard: [["fh", "Skägg & mustasch", "Beard & mustache", FACE_VB]],
    head: [["hw", "Huvudbonad", "Headwear"]],
    acc: [["gl", "Glasögon & masker", "Glasses & masks"]],
    uni: [["up", "Överdel", "Top"], ["uc", "Färg", "Colour", "sw"]],
    bg: [["bg", "Bakgrund", "Background"]]
  };
  var SAVE_SV = ["Snyggt! Nu känner gänget igen dä.", "Sparat. Spegeln säger tack.", "Uniformen sitter. Ut å visa dä!",
    "Klart! Nu ä du snyggast på kartan.", "Sparad, soldat. Lagom stilig.", "Ny look inskriven i liggaren.", "Dä va fint, dä. Sparat!"];
  var DICE_SV = ["Tärningen har talat!", "Slumpen ä din stylist ikväll.", "Ny agent, samma törst.", "Hemlig identitet: klar.", "Inkognito? Ja, typ."];
  var lastSave = -1, lastDice = -1;
  function pickLine(a, last) { var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === last) i = (i + 1) % a.length; return i; }
  var edTab = "face";
  function openEditor() {
    if (off || !A || !A.openSheet) return;
    var go = function () {
      if (!me) { A.toast(L("Kunde int' hämta din avatar. Prova igen.", "Could not load your avatar."), { err: true }); return; }
      A.openSheet(L("Min avatar", "My avatar"), build);
    };
    if (me) go(); else loadMe().then(go);
  }
  function build(body) {
    var f = me.facts || {}, saved = me.spec ? JSON.stringify(me.spec) : "";
    var draft = JSON.parse(JSON.stringify(me.spec || defaultSpec(me.seed, f.r)));
    if (draft.ms == null) draft.ms = 1;
    var wrap = document.createElement("div"); wrap.className = "ave";
    var unl = 0, tot = 0;
    Object.keys(LOCKS).forEach(function (k) { tot++; if (unlocked(LOCKS[k], f)) unl++; });
    wrap.innerHTML =
      '<div class="ave-top"><div class="ave-prev" aria-live="polite"></div>' +
      '<button type="button" class="ave-dice" aria-label="' + esc(L("Slumpa", "Randomise")) + '" title="' + esc(L("Slumpa", "Randomise")) + '">🎲</button></div>' +
      '<p class="ave-rank"><b>🎖️ ' + esc(f.title || rankTitle(f.r || 1)) + "</b> · " + esc(L(unl + " av " + tot + " specialgrejer upplåsta", unl + " of " + tot + " special items unlocked")) + "</p>" +
      '<div class="ave-tabs" role="tablist"></div><div class="ave-body"></div>' +
      '<div class="ave-bar"><button type="button" class="btn btn-amber btn-block ave-save">' + esc(L("Spara", "Save")) + "</button></div>";
    body.appendChild(wrap);
    var prev = wrap.querySelector(".ave-prev"), tabs = wrap.querySelector(".ave-tabs"), pane = wrap.querySelector(".ave-body"), save = wrap.querySelector(".ave-save");
    function md() { return draft.ms === 0 ? [] : draft.md && draft.md.length ? draft.md : myMedals(null, f); }
    function paintPrev() {
      prev.innerHTML = svg(draft, { r: f.r, md: md() });
      var dirty = JSON.stringify(clean(draft)) !== saved;
      save.disabled = !dirty;
      save.textContent = dirty ? L("Spara", "Save") : L("Sparad ✓", "Saved ✓");
    }
    TABS.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "ave-tab"; b.setAttribute("role", "tab"); b.setAttribute("data-t", t[0]);
      b.textContent = sv() ? t[1] : t[2];
      b.addEventListener("click", function () { edTab = t[0]; paintTabs(); paintPane(); });
      tabs.appendChild(b);
    });
    function paintTabs() {
      tabs.querySelectorAll(".ave-tab").forEach(function (b) { var on = b.getAttribute("data-t") === edTab; b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    }
    function tile(k, i, mode) {
      var lk = lockOf(k, i), ok = unlocked(lk, f), sel = (draft[k] | 0) === i;
      var b = document.createElement("button");
      b.type = "button"; b.className = "ave-tile" + (sel ? " on" : "") + (ok ? "" : " locked") + (mode === "sw" ? " sw" : "");
      b.setAttribute("aria-pressed", sel ? "true" : "false");
      var nm = (N[k][i] || ["", ""])[sv() ? 0 : 1];
      b.setAttribute("aria-label", nm + (ok ? "" : " — " + lockText(lk)));
      var art;
      if (mode === "sw") {
        var col = k === "sk" ? SKIN[i] : k === "hc" ? HAIRC[i] : TOPC[i];
        art = '<span class="ave-sw" style="background:' + col + '"></span>';
      } else {
        var t = JSON.parse(JSON.stringify(draft)); t[k] = i;
        if (k === "hw" || k === "gl" || k === "fh") { /* keep the rest */ }
        art = '<span class="ave-art">' + svg(t, { r: f.r, md: md(), vb: mode && mode !== "sw" ? mode : "" }) + "</span>";
      }
      b.innerHTML = art + (ok ? '<span class="ave-nm">' + esc(nm) + "</span>" : '<span class="ave-lk" aria-hidden="true">🔒</span><span class="ave-nm">' + esc(shortLock(lk)) + "</span>");
      b.addEventListener("click", function () {
        if (!ok) { A.toast("🔒 " + lockText(lk), { ms: 3500, id: "ave-lock" }); return; }
        draft[k] = i;
        paintPrev(); paintPane(true);
      });
      return b;
    }
    function paintPane(keep) {
      var st = keep ? body.scrollTop : 0;
      pane.innerHTML = "";
      (GROUPS[edTab] || []).forEach(function (gr) {
        var k = gr[0];
        var sec = document.createElement("section"); sec.className = "ave-sec";
        var h = document.createElement("h3"); h.textContent = sv() ? gr[1] : gr[2]; sec.appendChild(h);
        if (k === "uc" && draft.up >= 4 && draft.up <= 8) {
          var p = document.createElement("p"); p.className = "muted ave-note"; p.textContent = L("Färgen gäller civila kläder och kepsar.", "Colour is for civilian tops and caps."); sec.appendChild(p);
        }
        var grid = document.createElement("div"); grid.className = "ave-grid" + (gr[3] === "sw" ? " ave-grid-sw" : "");
        for (var i = 0; i <= MAX[k]; i++) grid.appendChild(tile(k, i, gr[3] || ""));
        sec.appendChild(grid);
        pane.appendChild(sec);
      });
      if (edTab === "uni") pane.appendChild(medalSec());
      if (keep) body.scrollTop = st;
    }
    function medalSec() {
      var sec = document.createElement("section"); sec.className = "ave-sec";
      var h = document.createElement("h3"); h.textContent = L("Medaljer på bröstet", "Medals on the chest"); sec.appendChild(h);
      var row = document.createElement("div"); row.className = "toggle-row ave-ms";
      row.innerHTML = '<span>' + esc(L("Visa mina medaljer", "Show my medals")) + '</span><button type="button" class="switch" role="switch" aria-checked="' + (draft.ms === 0 ? "false" : "true") + '" aria-label="' + esc(L("Visa mina medaljer", "Show my medals")) + '"></button>';
      row.addEventListener("click", function () { draft.ms = draft.ms === 0 ? 1 : 0; paintPrev(); paintPane(true); });
      sec.appendChild(row);
      var mine = (f.m || []).filter(function (x) { return !HIDDEN_MEDALS[x]; });
      if (!mine.length) {
        var p0 = document.createElement("p"); p0.className = "muted ave-note"; p0.textContent = L("Inga medaljer än. Ut å förtjäna dom!", "No medals yet."); sec.appendChild(p0);
        return sec;
      }
      if (draft.ms === 0) return sec;
      var pick = draft.md || [];
      var p = document.createElement("p"); p.className = "muted ave-note";
      p.textContent = pick.length ? L("Valda: " + pick.length + " av 6", "Picked: " + pick.length + " of 6") : L("Välj upp till 6. Annars syns dina 5 senaste.", "Pick up to 6. Otherwise your 5 newest show.");
      sec.appendChild(p);
      var grid = document.createElement("div"); grid.className = "ave-medals";
      mine.forEach(function (id) {
        var on = pick.indexOf(id) >= 0, b = document.createElement("button");
        b.type = "button"; b.className = "ave-md" + (on ? " on" : ""); b.setAttribute("aria-pressed", on ? "true" : "false");
        var bg = ""; try { bg = window.MEDALS.ribbonBg(id); } catch (e) {}
        b.innerHTML = '<span class="ave-rb" style="background:' + esc(bg || "#666") + '"></span><span>' + esc(medalName(id)) + "</span>";
        b.addEventListener("click", function () {
          var cur = (draft.md || []).slice(), at = cur.indexOf(id);
          if (at >= 0) cur.splice(at, 1);
          else { if (cur.length >= 6) { A.toast(L("Max 6 medaljer på bröstet. Ta bort en först.", "Max 6 medals."), { id: "ave-md" }); return; } cur.push(id); }
          if (cur.length) draft.md = cur; else delete draft.md;
          paintPrev(); paintPane(true);
        });
        grid.appendChild(b);
      });
      sec.appendChild(grid);
      return sec;
    }
    wrap.querySelector(".ave-dice").addEventListener("click", function () {
      var R = Math.random, keep = { ms: draft.ms, md: draft.md };
      Object.keys(MAX).forEach(function (k) {
        if (k === "ms") return;
        var okI = []; for (var i = 0; i <= MAX[k]; i++) if (unlocked(lockOf(k, i), f)) okI.push(i);
        draft[k] = okI[Math.floor(R() * okI.length)];
      });
      if (R() < 0.45) draft.fh = 0;
      if (R() < 0.5) draft.hw = 0;
      if (R() < 0.6) draft.gl = 0;
      draft.ms = keep.ms; if (keep.md) draft.md = keep.md;
      paintPrev(); paintPane(true);
      lastDice = pickLine(DICE_SV, lastDice);
      A.toast(sv() ? "🎲 " + DICE_SV[lastDice] : "🎲 New look!", { ms: 2200, id: "ave-dice" });
      try { prev.animate && !reduced() && prev.animate([{ transform: "rotate(-8deg) scale(.94)" }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.05,.7,.1,1)" }); } catch (e) {}
    });
    save.addEventListener("click", function () {
      if (save.disabled) return;
      save.disabled = true; save.textContent = "…";
      var spec = clean(draft);
      rpc("set_my_avatar", { p_spec: spec }).then(function (r) {
        if (r.error) {
          var c = codeOf(r.error);
          A.toast(c === "locked" ? L("Dä där ä låst än. Samla fler meriter!", "That item is still locked.") : c === "slow_down" ? L("Lugna dä, prova igen om en sekund.", "Slow down, try again.") : L("Kunde int' spara. Prova igen.", "Could not save. Try again."), { err: true });
          paintPrev(); return;
        }
        var d = parse(r.data);
        me.spec = d.spec || spec; saved = JSON.stringify(me.spec);
        Object.keys(groups).forEach(function (g) { var x = groups[g].data; if (x && x.me) { x.me.a = me.spec; x.me.md = myMedals(me.spec, f); } });
        if (friends && friends.data && friends.data.me) { friends.data.me.a = me.spec; friends.data.me.md = myMedals(me.spec, f); }
        paintPrev(); repaint();
        lastSave = pickLine(SAVE_SV, lastSave);
        A.toast(sv() ? "👤 " + SAVE_SV[lastSave] : "👤 Saved!", { ms: 3000 });
        try { if (window.FX && window.FX.vibrate) window.FX.vibrate(12); } catch (e) {}
      });
    });
    paintTabs(); paintPane(); paintPrev();
  }
  function clean(d) {
    var o = { v: 1 };
    Object.keys(MAX).forEach(function (k) { o[k] = clamp(d, k); });
    if (d.ms === 0) o.ms = 0;
    if (d.md && d.md.length) o.md = d.md.slice(0, 6);
    return o;
  }
  function reduced() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  window.AVATAR = {
    svg: svg, defaultSpec: defaultSpec, LOCKS: LOCKS, MAX: MAX, unlocked: unlocked, lockText: lockText,
    me: function () { return me; }, on: function () { return !off; },
    chatSeen: chatSeen, statusRow: statusRow, friendRow: friendRow, faces: faces, profileAv: profileAv,
    openEditor: openEditor, forGroup: forGroup, forFriends: forFriends, repaint: repaint,
    init: function (api) { A = api; },
    onAuthed: function () { loadMe(true); }
  };
})();
