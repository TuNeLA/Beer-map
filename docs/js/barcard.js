/* PintsNow — BARCARD: the unique bar card header ("Krogkortet", I-133 option A; owner 24 Nov: all 8 A34 defaults = yes).
   PN.barcard = { theme(bar), kind(bar), initials(name), seed(id), decorate(html, bar), setBrands(data), brandOf(bar) }. No window global.
   Hook: wraps window.PNDS.barSheet (js/pnds.js "ds07 bar"), so it runs on every bar sheet / bar popup render (app-pins.js barPopup).
   - Order of looks (top wins): 1 the bar's own photo (approved + licence) · 2 chain look (written permission) · 3 kind theme · 4 Bar.
     Photos ONLY from the bar itself (our storage bucket "bar-brand"), never scraped. No data today = no photo, no chain look.
   - 15 venue kinds (window.PNVTYPE) -> 9 themes. Accent = the map pin tint family (tokens --bc-<theme>-acc in docs/barcard.css).
   - Each bar: crest with its initials + a small shift / mirror of the picture, seeded from bar.id (same bar = same look).
     A chain look never shifts. "1 av 14 ställen" is text only (no list, no rank).
   - The header is always dark (art, like a photo): own text tokens, no light version. No motion (reduced motion = still).
   - Nothing about drinking: no counts, no praise. Fine in store builds (window.OLNU_STORE).
   - Arenas and places (restaurants) keep today's plain header. Any error = today's header (never breaks the card). */
(function () {
  "use strict";
  var I = window.I18N;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // venue kind (PNVTYPE keys) -> theme
  var THEME = { pub: "pub", nation: "pub", bar: "bar", cocktail: "cocktail", vinbar: "cocktail", sportbar: "sportbar", spelbar: "sportbar",
    nattklubb: "nattklubb", karaoke: "nattklubb", livescen: "nattklubb", olbar: "olbar", restbar: "restbar", hotellbar: "hotellbar",
    oltradgard: "olhall", olhall: "olhall" };
  var EN = { pub: "Pub", bar: "Bar", cocktail: "Cocktail bar", vinbar: "Wine bar", olbar: "Beer bar / brewery", nattklubb: "Nightclub", sportbar: "Sports bar",
    karaoke: "Karaoke", livescen: "Live music", restbar: "Food & bar", hotellbar: "Hotel bar", oltradgard: "Beer garden", olhall: "Beer hall",
    spelbar: "Games bar", nation: "Student pub / nation" };
  // per theme: crest shape + bottom edge
  var LOOK = { pub: ["shield", "arch"], bar: ["circle", "flat"], cocktail: ["diamond", "deco"], sportbar: ["roundel", "centre"], nattklubb: ["hex", "slant"],
    olbar: ["barrel", "wave"], restbar: ["plate", "scallop"], hotellbar: ["arch", "awning"], olhall: ["banner", "bunting"], chain: ["chain", "arch"] };

  // ---- the picture (motif) per theme: viewBox 0 0 180 110, stroke = the accent (currentColor) ----
  var M = {
    pub: '<path d="M178 18H98q-10 0-10 10" stroke-width="3"/><path d="M178 46L146 18" stroke-width="2.5"/><path d="M108 18V30M164 18V30"/>' +
      '<rect x="96" y="30" width="78" height="58" rx="6" stroke-width="2.5"/><rect x="102" y="36" width="66" height="46" rx="3" opacity=".55"/>' +
      '<rect x="122" y="48" width="20" height="26" rx="3"/><path d="M142 54h5a5 5 0 0 1 5 5v5a5 5 0 0 1-5 5h-5"/><path d="M120 48q4-6 8-2q4-5 8 0q4-4 8 2"/>',
    bar: '<path d="M104 44H160L153 112H111Z" stroke-width="3"/><path d="M108 70H156"/><path d="M146 22L136 70" stroke-width="2.5"/>' +
      '<path d="M76 40l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/><path d="M172 96l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>',
    cocktail: '<g opacity=".45"><path d="M132 150L40 0M132 150L86 0M132 150V0M132 150L178 0"/></g><path d="M96 42H168Q164 74 132 76Q100 74 96 42Z" stroke-width="2.5"/>' +
      '<path d="M101 52H163"/><path d="M132 76V108M112 110H152" stroke-width="2.5"/><circle cx="160" cy="34" r="10"/><path d="M160 24V44M150 34H170M153 27L167 41M167 27L153 41" opacity=".6"/>',
    sportbar: '<circle cx="150" cy="98" r="46" stroke-width="2.5"/><path d="M150 0V150" stroke-width="2.5"/><circle cx="150" cy="98" r="3" fill="currentColor"/>' +
      '<circle cx="92" cy="58" r="17" stroke-width="2.5"/><path d="M92 51l6.6 4.8-2.5 7.8h-8.2l-2.5-7.8z" fill="currentColor"/><path d="M92 51V41M98.6 55.8l8-4M96.1 63.6l5 8M87.9 63.6l-5 8M85.4 55.8l-8-4"/>',
    nattklubb: '<path d="M150 8L56 150H92Z" fill="currentColor" stroke="none" opacity=".16"/><path d="M150 8L120 150H150Z" fill="currentColor" stroke="none" opacity=".12"/>' +
      '<path d="M150 8L176 150H196Z" fill="currentColor" stroke="none" opacity=".16"/><path d="M150 0V10"/><circle cx="150" cy="32" r="22" stroke-width="2.5"/>' +
      '<ellipse cx="150" cy="32" rx="22" ry="8"/><ellipse cx="150" cy="32" rx="9" ry="22"/><path d="M128 32H172"/>' +
      '<path d="M74 50l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" fill="currentColor"/><path d="M108 100l2 4.5 4.5 2-4.5 2-2 4.5-2-4.5-4.5-2 4.5-2z" fill="currentColor"/>',
    olbar: '<g transform="translate(0 -4)"><rect x="92" y="22" width="34" height="66" rx="17" stroke-width="2.5"/><path d="M92 76L109 100L126 76"/><path d="M98 90V128M120 90V128"/><path d="M92 46H126" opacity=".6"/>' +
      '<rect x="136" y="10" width="40" height="80" rx="20" stroke-width="2.5"/><path d="M136 78L156 104L176 78"/><path d="M142 92V128M170 92V128"/><path d="M136 38H176" opacity=".6"/>' +
      '<path d="M126 58H136" stroke-width="3"/><circle cx="156" cy="56" r="5"/></g>',
    restbar: '<circle cx="134" cy="76" r="36" stroke-width="2.5"/><circle cx="134" cy="76" r="25" opacity=".6"/>' +
      '<path d="M86 40V112" stroke-width="2.5"/><path d="M80 40V58M92 40V58M80 58Q86 64 92 58"/><path d="M178 40V112" stroke-width="2.5"/><path d="M178 40q9 12 0 38"/>' +
      '<rect x="124" y="64" width="16" height="22" rx="3"/><path d="M140 69h4a4 4 0 0 1 4 4v3a4 4 0 0 1-4 4h-4"/>',
    hotellbar: '<path d="M78 150V78A51 51 0 0 1 180 78V150" opacity=".4" stroke-width="2"/><circle cx="118" cy="44" r="14" stroke-width="2.5"/><circle cx="118" cy="44" r="6"/>' +
      '<path d="M132 44H178" stroke-width="3"/><path d="M166 44V56M174 44V52" stroke-width="3"/><path d="M110 56L96 92Q93 100 101 102L112 104Q120 105 121 97L124 58"/><circle cx="108" cy="92" r="3"/>',
    olhall: '<path d="M58 14Q120 34 182 12"/><path d="M66 17L74 36L82 21M92 24L100 43L108 27M118 28L126 47L134 29M144 27L152 46L160 25M168 20L176 38L182 17" fill="currentColor" fill-opacity=".25"/>' +
      '<g transform="translate(0 -34)"><path d="M70 120H182" stroke-width="3"/><path d="M82 120V140M170 120V140"/><rect x="92" y="98" width="14" height="20" rx="2"/><rect x="122" y="96" width="14" height="22" rx="2"/><rect x="152" y="98" width="14" height="20" rx="2"/>' +
      '<path d="M106 103h3a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-3M136 101h3a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-3M166 103h3a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-3"/></g>',
    chain: '<path d="M110 40H150L146 50Q160 54 160 70V110Q160 120 150 120H110Q100 120 100 110V70Q100 54 114 50Z" stroke-width="2.5"/>' +
      '<path d="M160 66H168Q178 66 178 78V92Q178 104 166 104H160" stroke-width="2.5"/><path d="M108 82H152" opacity=".6"/><path d="M106 40Q130 26 154 40" opacity=".6"/>'
  };
  // ---- crest shapes (48 x 48): our own letters in our own shape, not a logo ----
  var CR = {
    shield: '<path d="M6 5H42V24Q42 38 24 45Q6 38 6 24Z"/>', circle: '<circle cx="24" cy="24" r="19"/>', diamond: '<path d="M24 3L45 24L24 45L3 24Z"/>',
    roundel: '<circle cx="24" cy="24" r="20"/><circle cx="24" cy="24" r="15" fill="none" opacity=".5"/>', hex: '<path d="M24 3L42 13.5V34.5L24 45L6 34.5V13.5Z"/>',
    barrel: '<path d="M12 4H36Q44 24 36 44H12Q4 24 12 4Z"/><path d="M7 14H41M7 34H41" fill="none" opacity=".5"/>',
    plate: '<circle cx="24" cy="24" r="20"/><circle cx="24" cy="24" r="14" fill="none" opacity=".5"/>',
    arch: '<rect x="8" y="4" width="32" height="40" rx="12"/>', banner: '<path d="M5 6H43V38L24 44L5 38Z"/>', chain: '<rect x="4" y="4" width="40" height="40" rx="10"/>'
  };
  // ---- bottom edge of the band (box 390 x 24; below the line = the sheet colour) ----
  function edge(k) {
    var d = { arch: "M0 6 Q195 34 390 6", flat: "M0 20 H390", deco: "M0 10 H156 L170 20 H220 L234 10 H390", centre: "M0 20 H173 A25 25 0 0 1 217 20 H390",
      slant: "M0 6 L390 20" }[k], i;
    if (d) return d;
    if (k === "wave") { d = "M0 14"; for (i = 0; i < 10; i++) d += " q9.75 -6 19.5 0 t19.5 0"; }
    if (k === "scallop") { d = "M0 8"; for (i = 0; i < 15; i++) d += " a13 13 0 0 0 26 0"; }
    if (k === "awning") { d = "M0 6"; for (i = 0; i < 6; i++) d += " a48 48 0 0 0 65 0"; }
    if (k === "bunting") { d = "M0 6"; for (i = 0; i < 15; i++) d += " l13 12 l13 -12"; }
    return d || "M0 20 H390";
  }

  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  // the per-bar seed: picture slot (right 50 / 80 / 110 px), mirror, shift ±14 / ±6 px, turn ±2°, pattern offset. Same id = same look.
  function seed(id, theme) {
    var h = hash(id), noTurn = theme === "sportbar";
    return { slot: [50, 80, 110][h % 3], flip: noTurn ? 1 : ((h >>> 3) & 1 ? -1 : 1), dx: ((h >>> 4) % 29) - 14, dy: ((h >>> 9) % 13) - 6,
      rot: noTurn ? 0 : ((h >>> 13) % 5) - 2, po: (h >>> 17) % 40 };
  }
  var STOP = /^(the|pub|bar|&|och|and|restaurang|restaurant|cocktail|cocktails|taproom|mat|krog|krogen|hotell|hotel|lobbybar|nattklubb|på|i|vid|hos|-|·)$/i;
  function initials(n) {
    var all = String(n || "").replace(/:/g, "").replace(/[()"'.,;!?]/g, " ").split(/\s+/).filter(function (x) { return x && /[\p{L}\p{N}]/u.test(x); });
    var w = all.filter(function (x) { return !STOP.test(x); });
    if (!w.length) w = all;   // "Pub" alone = P, not "?"
    if (!w.length) return "?";
    var a = Array.from(w[0])[0], b = w.length > 1 ? Array.from(w[1])[0] : "";
    return (a + b).toUpperCase();
  }

  function kind(bar) {
    if (!bar || bar.arena || bar.place) return null;
    var V = window.PNVTYPE, k = bar.vt || (V && V.of ? V.of(bar) : null);
    // A34 q4: bars.json rows made before the "olhall" kind say olbar; the name decides until the next fetch (scripts/fetch-bars.mjs)
    if (k === "olbar" && /(ölhall|bierhalle|beer ?hall)/i.test(String(bar.name || ""))) k = "olhall";
    return THEME[k] ? k : (k ? null : "bar");   // a restaurant / cafe row keeps the plain header
  }
  function label(k) {
    var V = window.PNVTYPE;
    return sv() ? (V && V.LABEL && V.LABEL[k]) || (k === "olhall" ? "Ölhall" : "Bar") : EN[k] || "Bar";
  }

  // ---- brand layer (data model: pintsnow-ops/handover/barcard-out/barcard-DONE.md "Data model"). Empty today. ----
  // data = { chains: { <id>: { name, n, acc: "#rrggbb", band: "#rrggbb", mark?: url } }, bars: { <bar id>: { chain?: <id>, photo?: url, credit? } } }
  var BR = { chains: {}, bars: {} };
  var HEX = /^#[0-9a-f]{6}$/i;
  function ownUrl(u) {
    var C = window.OLNU_CONFIG || {}, base = String(C.SUPABASE_URL || "").replace(/\/+$/, "");
    return !!(base && typeof u === "string" && u.indexOf(base + "/storage/v1/object/public/bar-brand/") === 0 && !/["'<>\s\\]/.test(u));
  }
  function setBrands(d) { BR = { chains: (d && d.chains) || {}, bars: (d && d.bars) || {} }; }
  function brandOf(bar) {
    var id = bar && bar.id != null ? String(bar.id) : "", b = BR.bars[id] || (bar && bar.brand) || null, out = {};
    if (!b) return out;
    var c = b.chain != null ? BR.chains[String(b.chain)] : null;
    if (c && c.name && HEX.test(c.acc || "") && HEX.test(c.band || "")) out.chain = { name: String(c.name), n: Math.max(0, c.n | 0), acc: c.acc, band: c.band, mark: ownUrl(c.mark) ? c.mark : "" };
    if (ownUrl(b.photo)) out.photo = { u: b.photo };
    return out;
  }

  function theme(bar) {
    var k = kind(bar); if (!k) return null;
    var br = brandOf(bar), t = { k: k, theme: THEME[k], label: label(k), chain: br.chain || null, photo: br.photo || null };
    t.look = t.chain ? "chain" : t.theme;
    return t;
  }

  function glyph(k) {
    var P = window.PNPINS, G = window.PNGLYPHS, g = P && P.cat ? P.cat(k) : k, ps = G && G.G && G.G[g];
    if (!ps) return "";
    return '<svg class="pn-bc-gl" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' + ps.map(function (p) {
      return '<path d="' + esc(p.d) + '"' + (p.k === "b" ? ' style="fill:var(--bc-band)"' : ' fill="currentColor"') + "/>";
    }).join("") + "</svg>";
  }

  function bandHTML(t, bar, name) {
    var look = LOOK[t.look] || LOOK.bar, ch = t.chain, s = ch ? { slot: 50, flip: 1, dx: 0, dy: 0, rot: 0, po: 0 } : seed(bar.id != null ? bar.id : name, t.theme);
    var st = "--bc-r:" + (s.slot - 72) + "px;--bc-dx:" + s.dx + "px;--bc-dy:" + s.dy + "px;--bc-rot:" + s.rot + "deg;--bc-flip:" + s.flip + ";--bc-po:" + s.po + "px";
    if (ch) st += ";--bc-acc:" + ch.acc + ";--bc-band:" + ch.band;
    var e = edge(look[1]), crest;
    if (ch) crest = ch.mark ? '<img class="pn-bc-mark" alt="" src="' + esc(ch.mark) + '">' :
      '<svg viewBox="0 0 48 48" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="2">' + CR.chain + "</svg><b>" + esc(initials(ch.name)) + "</b>";
    else crest = '<svg viewBox="0 0 48 48" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="2">' + CR[look[0]] + "</svg><b>" + esc(initials(name)) + "</b>";
    var art = t.photo ? '<img class="pn-bc-photo" alt="" src="' + esc(t.photo.u) + '"><span class="pn-bc-cred">' + esc(L("Foto: krogen", "Photo: the bar")) + "</span>" : '<div class="pn-bc-pat"></div>';
    var mot = t.photo ? "" : '<span class="pn-bc-motw" aria-hidden="true"><svg class="pn-bc-mot" viewBox="0 0 180 110" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (M[t.look] || M.bar) + "</svg></span>";
    return '<div class="pn-bc pn-bc--' + t.look + (t.photo ? " pn-bc-ph" : "") + '" data-bc="' + esc(t.look) + '" data-kind="' + esc(t.k) + '" style="' + st + '">' + art +
      '<div class="pn-bc-scrim"></div><div class="pn-bc-in"><div class="pn-bc-crest" aria-hidden="true">' + crest + "</div>" +
      '<div class="pn-bc-top"><span class="pn-bc-chip">' + glyph(t.k) + "<span>" + esc(t.label) + "</span></span>" +
      (ch ? '<span class="pn-bc-chip pn-bc-chain">' + esc(ch.name) + "</span>" : "") + mot + "</div></div>" +
      (t.photo ? "" : '<svg class="pn-bc-edge" viewBox="0 0 390 24" preserveAspectRatio="none" aria-hidden="true"><path class="pn-bc-ef" d="' + e + ' V24 H0Z"/><path class="pn-bc-el" d="' + e + '"/></svg>') + "</div>";
  }

  // The meta line under the title: hours (+ the crowd word / count when there is no meter). The kind label moved to the chip.
  function metaParts(meta, t) {
    var parts = [].filter.call(meta.childNodes, function (n) { return n.nodeType === 1; });
    meta.textContent = "";
    parts.forEach(function (p, i) { if (i) meta.appendChild(document.createTextNode(" · ")); meta.appendChild(p); });
    if (t.chain && t.chain.n > 1) {
      var c = document.createElement("span"); c.className = "pn-bc-of";
      c.textContent = L("1 av " + t.chain.n + " ställen", "1 of " + t.chain.n + " places");
      if (parts.length) meta.appendChild(document.createTextNode(" · "));
      meta.appendChild(c);
    }
    meta.classList.add("pn-bc-meta");
  }

  function decorate(html, bar) {
    try {
      var t = theme(bar); if (!t) return html;
      var tp = document.createElement("template"); tp.innerHTML = html;
      var bs = tp.content.firstElementChild, head = bs && bs.querySelector(":scope > .bs-head");
      if (!bs || !head || head.querySelector(".pn-bc")) return html;
      var title = head.querySelector(".pp-title"), meta = head.querySelector(".bs-meta"); if (!title) return html;
      var name = title.textContent;
      var box = document.createElement("template"); box.innerHTML = bandHTML(t, bar, name);
      var band = box.content.firstElementChild, inner = band.querySelector(".pn-bc-in");
      inner.appendChild(title);
      if (meta) { metaParts(meta, t); inner.appendChild(meta); }
      head.classList.add("pn-bch"); head.insertBefore(band, head.firstChild);
      // the compact name bar: sticky, shows when the band has scrolled away (a scroll listener sets .pn-bc-stuck on .bs)
      var mini = document.createElement("div"); mini.className = "pn-bc-mini pn-bc--" + t.look; mini.setAttribute("aria-hidden", "true");
      mini.setAttribute("style", band.getAttribute("style"));
      mini.innerHTML = '<b class="pn-bc-mi">' + esc(t.chain ? initials(t.chain.name) : initials(name)) + '</b><span class="pn-bc-mn">' + esc(name) + "</span>";
      bs.insertBefore(mini, head);
      bs.classList.add("pn-bc-bs");
      return bs.outerHTML;
    } catch (e) { return html; }
  }

  // sticky name bar: one capture listener for every scroller (cheap: only the bar sheet content matches)
  function onScroll(e) {
    var sc = e.target; if (!sc || !sc.classList || !sc.classList.contains("leaflet-popup-content")) return;
    var bs = sc.querySelector(".bs.pn-bc-bs"), band = bs && bs.querySelector(".pn-bc"); if (!band) return;
    var stuck = band.getBoundingClientRect().bottom < sc.getBoundingClientRect().top + 60;
    if (bs.classList.contains("pn-bc-stuck") !== stuck) bs.classList.toggle("pn-bc-stuck", stuck);
  }
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });

  function hook() {
    var P = window.PNDS; if (!P || !P.barSheet || P.barSheet._bc) return !!(P && P.barSheet && P.barSheet._bc);
    var b0 = P.barSheet;
    P.barSheet = function (html, bar, list) { return decorate(b0.call(this, html, bar, list), bar); };
    P.barSheet._bc = true;
    return true;
  }
  if (!hook()) { var n = 0, iv = setInterval(function () { if (hook() || ++n > 50) clearInterval(iv); }, 100); }

  (window.PN = window.PN || {}).barcard = {
    theme: theme, kind: kind, initials: initials, seed: seed, decorate: decorate, setBrands: setBrands, brandOf: brandOf,
    THEME: THEME
  };
  if (window.PN && window.PN.mod) window.PN.mod("barcard");
})();
