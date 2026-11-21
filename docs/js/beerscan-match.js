/* PintsNow — BEERSCAN_MATCH: find a beer of the library from a barcode or from text read off a label (owner I-140, lane
   beerscan, 21 Nov 2026). Pure code: no DOM, no network. Loaded on demand with js/beerscan.js (tap on the camera button).
   - ean(code, data): the beer ids ARE the EAN/UPC barcodes (Open Food Facts), and data.byId also holds the aliases of
     duplicate beers (js/beerlib.js load()). UPC-A (12 digits) = EAN-13 with a leading 0: both forms are tried.
   - rank(text, data, n): OCR text is noisy (cut words, l/1, 0/o, a curved label). Each beer token is compared with the
     words read (exact, contained in a longer word, or close: edit distance). A rare token (IDF over the library) counts more
     than "lager" or "beer". score = coverage of the beer's own tokens x a "seen enough" factor. Same names once.
     A beer needs one matched word of 4+ letters (or a number of 3+ digits, "1664"): noise like "ol" finds nothing.
   - decide(list, text, data): "open" (one clear hit), "pick" (Menade du…: best 3) or "none" (+ the best word for the search).
   Test: tests/unit/beerscan.test.mjs. */
(function (W) {
  "use strict";
  var OPEN_MIN = 0.8, OPEN_GAP = 0.12, PICK_MIN = 0.3, SEEN_K = 2.5, CLOSE = 0.75, MAX_WORDS = 100;

  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "o").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim();
  }
  function tokens(s) {
    var out = [], seen = {};
    norm(s).split(" ").forEach(function (t) { if (t.length >= 2 && !seen[t]) { seen[t] = 1; out.push(t); } });
    return out;
  }
  // edit distance, but stops as soon as it is over k (then returns k + 1). Two reused rows: no garbage per call.
  var R0 = new Int16Array(64), R1 = new Int16Array(64);
  function lev(a, b, k) {
    var m = a.length, n = b.length, i, j, prev = R0, cur = R1, t;
    if (Math.abs(m - n) > k) return k + 1;
    if (n >= 63) return k + 1;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i; var low = i;
      for (j = 1; j <= n; j++) {
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
        cur[j] = v; if (v < low) low = v;
      }
      if (low > k) return k + 1;
      t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }
  // how well one word read (w) shows one beer token (t): 0..1. known = w is itself a token of the library: then "heinek" (a cut
  // name in the data) inside "heineken" counts less than the exact "heineken".
  function sim(t, w, known) {
    if (t === w) return 1;
    var num = /^\d+$/.test(t);
    if (num || t.length <= 3) return 0;                                   // short words and numbers: exact only
    if (w.length > t.length && w.indexOf(t) >= 0) return known ? 0.6 : 0.9;   // "norrlandsguld" holds "guld"
    var L = Math.max(t.length, w.length), k = Math.floor(L * (1 - CLOSE) + 1e-9);
    if (Math.abs(w.length - t.length) > k) return 0;
    var d = lev(t, w, k);
    return d > k ? 0 : 1 - d / L;
  }

  function index(data) {
    if (data._bsIx) return data._bsIx;
    var df = {}, rows = [];
    (data.beers || []).forEach(function (b) {
      var ts = tokens((b.name || "") + " " + (b.brewery || ""));
      if (!ts.length) return;
      ts.forEach(function (t) { df[t] = (df[t] || 0) + 1; });
      rows.push({ b: b, ts: ts });
    });
    var N = rows.length || 1, idf = {};
    Object.keys(df).forEach(function (t) { idf[t] = Math.log(1 + N / df[t]); });
    var ix = { rows: rows, idf: idf, vocab: Object.keys(df) };
    try { Object.defineProperty(data, "_bsIx", { value: ix, enumerable: false, configurable: true }); } catch (e) { data._bsIx = ix; }
    return ix;
  }
  // words read -> { vocabToken: best similarity } (each vocab token once, not once per beer)
  function seenMap(ix, text) {
    var ws = tokens(text).slice(0, MAX_WORDS), parts = norm(text).split(" "), have = {}, i;
    ws.forEach(function (w) { have[w] = 1; });
    for (i = 0; i + 1 < parts.length && ws.length < MAX_WORDS + 40; i++) {   // "Norr lands" -> "norrlands"
      var j = parts[i] + parts[i + 1];
      if (parts[i] && parts[i + 1] && !have[j]) { have[j] = 1; ws.push(j); }
    }
    var seen = {};
    if (!ws.length) return seen;
    ix.vocab.forEach(function (t) {
      var best = 0;
      for (var k = 0; k < ws.length && best < 1; k++) { var s = sim(t, ws[k], ix.idf[ws[k]] != null); if (s > best) best = s; }
      if (best) seen[t] = best;
    });
    return seen;
  }
  function rank(text, data, n) {
    var ix = index(data), seen = seenMap(ix, text), out = [], names = {};
    if (!Object.keys(seen).length) return [];
    ix.rows.forEach(function (r) {
      var m = 0, tot = 0, strong = false;
      r.ts.forEach(function (t) { var w = ix.idf[t]; tot += w; if (seen[t]) { m += w * seen[t]; if (t.length >= 4 || /^\d{3,}$/.test(t)) strong = true; } });
      if (!m || !strong) return;   // "ol" / "sol" read from noise must never find the beers "Øl" or "Sol"
      var s = (m / tot) * Math.min(1, m / SEEN_K);
      if (s > 0.05) out.push({ b: r.b, s: Math.round(s * 1000) / 1000 });
    });
    out.sort(function (a, b) { return b.s - a.s || (b.b.photo ? 1 : 0) - (a.b.photo ? 1 : 0) || (a.b.group | 0) - (b.b.group | 0) || (a.b.name < b.b.name ? -1 : 1); });
    return out.filter(function (x) { var k = norm(x.b.name); if (names[k]) return false; names[k] = 1; return true; }).slice(0, n || 3);
  }
  // the one best word for the normal search (beerlib search needs every word in the name: one word is safest)
  function queryFrom(text, data) {
    var ws = tokens(text).filter(function (w) { return /^[a-z]{3,}$/.test(w); });
    if (data) {
      var ix = index(data), best = null, bw = 0;
      ws.forEach(function (w) { ix.vocab.forEach(function (t) { var s = sim(t, w, ix.idf[w] != null); if (s && t.length >= 3 && /^[a-z]+$/.test(t)) { var v = s * ix.idf[t]; if (v > bw) { bw = v; best = t; } } }); });
      if (best) return best;
    }
    ws = ws.filter(function (w) { return w.length >= 4; }).sort(function (a, b) { return b.length - a.length; });
    return ws[0] || "";
  }
  function decide(list, text, data) {
    var a = list[0], b = list[1];
    if (a && a.s >= OPEN_MIN && (!b || a.s - b.s >= OPEN_GAP)) return { kind: "open", beer: a.b, list: list };
    if (a && a.s >= PICK_MIN) return { kind: "pick", list: list.filter(function (x) { return x.s >= PICK_MIN / 2; }).slice(0, 3) };
    return { kind: "none", q: queryFrom(text, data) };
  }
  function ean(code, data) {
    var c = String(code == null ? "" : code).replace(/\D/g, ""), by = data && data.byId;
    if (!c || !by) return null;
    var tries = [c];
    if (c.length === 12) tries.push("0" + c);
    if (c.length === 13 && c.charAt(0) === "0") tries.push(c.slice(1));
    for (var i = 0; i < tries.length; i++) if (by[tries[i]]) return by[tries[i]];
    return null;
  }

  W.BEERSCAN_MATCH = { norm: norm, tokens: tokens, sim: sim, index: index, rank: rank, decide: decide, queryFrom: queryFrom, ean: ean,
    LIMITS: { OPEN_MIN: OPEN_MIN, OPEN_GAP: OPEN_GAP, PICK_MIN: PICK_MIN } };
  if (W.PN && W.PN.mod) W.PN.mod("BEERSCAN_MATCH");
})(typeof window !== "undefined" ? window : globalThis);
