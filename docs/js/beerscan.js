/* PintsNow — BEERSCAN: scan a beer with the camera and find it in the beer library (owner I-140, lane beerscan, 21 Nov 2026).
   Research: the lane's beerscan-RESEARCH.md. Ranked: 1. barcode (our beer ids ARE the EAN codes), 2. the label text (OCR) on a tap,
   3. "Skriv namnet" = the normal Öl search. Loaded on demand by js/barsearch.js (the camera button in the Öl search field).
   - Camera: getUserMedia (rear) only after the tap. The stream stops on close, Android back, and when the app goes to the
     background. No camera / denied / no getUserMedia: a card with "Välj en bild" (gallery, no camera app) + "Skriv namnet".
   - Barcode: BarcodeDetector (Chrome Android, Android WebView = the Capacitor app) on the live video, every SCAN_MS.
     A known code opens the beer page at once. An unknown code: "not in the library yet" + Läs texten / Skriv namnet.
   - Text: TextDetector when the browser has it, else Tesseract.js from OUR files (docs/vendor/tesseract/, README.txt there):
     loaded on the first "Läs texten" tap only (about 4 MB once, then the browser cache). The worker starts from its URL
     (a blob: worker would inherit the page CSP, which has no 'wasm-unsafe-eval'). Match: js/beerscan-match.js.
     One clear hit = the beer page; else "Menade du …" (best 3); else the normal search with the best word filled in.
   - Privacy: frames stay in memory on this phone. No upload, no log of the picture or of the text.
   - Store builds: the same (no drinking words here). Reduced motion: the scan line stands still.
   Texts: tl(sv, en). CSS: docs/beerscan.css (lazy). Test: tests/e2e/beerscan-pw.js, tests/unit/beerscan.test.mjs. */
(function () {
  "use strict";
  var W = window, D = document;
  var SCAN_MS = 250, VENDOR = "./vendor/tesseract/", FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"], MAX_W = 1280;
  var ui = null, stream = null, det = null, loopT = 0, busy = false, hist = 0, selfBack = null, opts = {}, worker = null, workerP = null, seen = {};
  // the smallest WASM module that uses a SIMD op (same bytes as wasm-feature-detect "simd")
  var SIMD = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11];

  function tl(sv, en) { return W.I18N && W.I18N.lang === "en" ? en : sv; }
  function ic(n) { try { return W.PNI && W.PNI.svg ? W.PNI.svg(n) : ""; } catch (e) { return ""; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function mk(tag, cls, html) { var e = D.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function M() { return W.BEERSCAN_MATCH; }
  function lib() { return W.BEERLIB; }
  function data() { var L = lib(); return L && L.data ? L.data() : null; }
  function abs(u) { try { return new URL(u, D.baseURI).href; } catch (e) { return u; } }
  function btn(cls, label, act, icon) { return '<button type="button" class="' + cls + '" data-bsc="' + act + '">' + (icon ? ic(icon) : "") + "<span>" + esc(label) + "</span></button>"; }

  /* ---------- detectors (feature tests; all on this phone) ---------- */
  function hasCam() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && W.isSecureContext !== false; }
  function barcode() {
    if (det) return Promise.resolve(det);
    if (!W.BarcodeDetector) return Promise.resolve(null);
    var BD = W.BarcodeDetector, fmts = BD.getSupportedFormats ? BD.getSupportedFormats() : Promise.resolve(FORMATS);
    return Promise.resolve(fmts).then(function (have) {
      var f = FORMATS.filter(function (x) { return (have || []).indexOf(x) >= 0; });
      if (!f.length) return null;
      det = new BD({ formats: f }); return det;
    })["catch"](function () { return null; });
  }
  function simdOK() { try { return !!(W.WebAssembly && WebAssembly.validate(new Uint8Array(SIMD))); } catch (e) { return false; } }
  function canRead() { return !!W.TextDetector || (simdOK() && !!W.Worker); }
  function ocrWorker(onStep) {
    if (worker) return Promise.resolve(worker);
    if (workerP) return workerP;
    var ld = W.PN && PN.load ? PN.load : null;
    if (!ld) return Promise.reject(new Error("no loader"));
    workerP = ld(VENDOR + "tesseract.min.js", { test: function () { return !!W.Tesseract; } }).then(function () {
      return W.Tesseract.createWorker("eng", 1, {
        workerPath: abs(VENDOR + "worker.min.js"), corePath: abs(VENDOR + "tesseract-core-simd-lstm.js"), langPath: abs(VENDOR).replace(/\/$/, ""),
        workerBlobURL: false, gzip: true, logger: function (m) { if (onStep && m && typeof m.progress === "number") onStep(m.status, m.progress); }
      });
    }).then(function (w) { worker = w; workerP = null; return w; }, function (e) { workerP = null; throw e; });
    return workerP;
  }
  function readText(cv, onStep) {
    if (W.TextDetector) {
      try { return new W.TextDetector().detect(cv).then(function (l) { return (l || []).map(function (x) { return x.rawValue || ""; }).join(" "); }); } catch (e) {}
    }
    if (!simdOK()) return Promise.reject(new Error("no simd"));
    return ocrWorker(onStep).then(function (w) { return w.recognize(cv); }).then(function (r) { return (r && r.data && r.data.text) || ""; });
  }
  // one still picture of the video (or an image), at most MAX_W wide
  function frame(src) {
    var w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
    if (!w || !h) return null;
    var k = Math.min(1, MAX_W / w), cv = D.createElement("canvas");
    cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
    return cv;
  }

  /* ---------- the camera ---------- */
  function stopCam() {
    clearTimeout(loopT); loopT = 0;
    if (stream) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} stream = null; }
    if (ui && ui.video) { try { ui.video.srcObject = null; } catch (e) {} }
  }
  function startCam() {
    if (!ui) return;
    if (!hasCam()) { noCam("none"); return; }
    state("live");
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(function (s) {
      if (!ui) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s; ui.video.srcObject = s;
      var p = ui.video.play(); if (p && p["catch"]) p["catch"](function () {});
      ui.box.classList.add("bsc-on");
      barcode().then(function (d) { if (!ui) return; ui.box.classList.toggle("bsc-nobar", !d); hint(); if (d) loop(); });
    }, function (e) {
      noCam(e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "denied" : "none");
    });
  }
  function loop() {
    clearTimeout(loopT);
    loopT = setTimeout(function () {
      if (!ui || !stream || !det || ui.st !== "live") return;
      if (busy || ui.video.readyState < 2) { loop(); return; }
      busy = true;
      det.detect(ui.video).then(function (codes) { busy = false; if (!onCodes(codes)) loop(); }, function () { busy = false; loop(); });
    }, SCAN_MS);
  }
  // true = handled (stop the loop)
  function onCodes(codes) {
    if (!ui || !codes || !codes.length) return false;
    var d = data();
    for (var i = 0; i < codes.length; i++) { var b = M().ean(codes[i].rawValue, d); if (b) { found(b); return true; } }
    var c = String(codes[0].rawValue || "").replace(/\D/g, "");
    if (c && !seen[c]) { seen[c] = 1; state("unknown", { code: c }); return true; }
    return false;
  }

  /* ---------- results ---------- */
  function found(b) { var id = b.id; close(function () { if (opts.openBeer) opts.openBeer(id); }); }
  function fill(q) { close(function () { if (opts.fill) opts.fill(q || ""); }); }
  function fromText(text) {
    if (!ui) return;
    var d = data(), list = M().rank(text, d, 5), r = M().decide(list, text, d);
    if (r.kind === "open") { found(r.beer); return; }
    if (r.kind === "pick") { state("pick", { list: r.list, q: M().queryFrom(text, d) }); return; }
    state("none", { q: r.q });
  }
  function readNow(src) {
    if (!ui || ui.st === "busy") return;
    if (!canRead()) { state("noread"); return; }
    var cv = frame(src || ui.video);
    if (!cv) { say(tl("Kameran är inte klar än. Försök igen.", "The camera is not ready yet. Try again.")); return; }
    clearTimeout(loopT);
    var first = !worker && !W.TextDetector;
    state("busy", { text: first ? tl("Laddar textläsaren (cirka 4 MB, bara första gången) …", "Loading the text reader (about 4 MB, first time only) …") : tl("Läser texten …", "Reading the text …") });
    readText(cv, function (what, p) {
      if (!ui || ui.st !== "busy") return;
      if (/recogni/i.test(what)) say(tl("Läser texten …", "Reading the text …"));
      else if (first) say(tl("Laddar textläsaren … ", "Loading the text reader … ") + Math.round(p * 100) + " %");
    }).then(function (t) { if (ui) fromText(t); }, function () {
      if (!ui) return;
      state("err", { text: W.navigator.onLine === false ? tl("Textläsaren behöver nätet första gången. Försök igen när du har täckning.", "The text reader needs the internet the first time. Try again when you have a signal.")
        : tl("Texten gick inte att läsa. Försök igen eller skriv namnet.", "Could not read the text. Try again or type the name.") });
    });
  }
  function fromFile(f) {
    if (!f || !ui) return;
    var img = new Image(), u = URL.createObjectURL(f);
    img.onload = function () {
      var cv = frame(img); URL.revokeObjectURL(u);
      if (!cv || !ui) return;
      barcode().then(function (d) { return d ? d.detect(cv)["catch"](function () { return []; }) : []; }).then(function (codes) {
        if (!onCodes(codes)) readNow(cv);
      });
    };
    img.onerror = function () { URL.revokeObjectURL(u); say(tl("Bilden gick inte att öppna.", "Could not open the picture.")); };
    img.src = u;
  }

  /* ---------- the view ---------- */
  function say(t) { if (ui) { ui.msg.textContent = t || ""; ui.msg.hidden = !t; } }
  function hint() {
    if (!ui || ui.st !== "live") return;
    say(det ? tl("Rikta kameran mot streckkoden på burken eller flaskan.", "Point the camera at the barcode on the can or bottle.")
      : tl("Rikta kameran mot namnet på etiketten och tryck Läs texten.", "Point the camera at the name on the label and tap Read the text."));
  }
  function rowsHTML(list) {
    var L = lib(), h = L && L.h;
    return '<div class="bl-list bsc-rows">' + list.map(function (x) { return h ? h.rowHTML(x.b) : '<button type="button" class="bl-row" data-bl-beer="' + esc(x.b.id) + '"><span><b>' + esc(x.b.name) + "</b></span></button>"; }).join("") + "</div>";
  }
  function state(st, o) {
    if (!ui) return;
    o = o || {}; ui.st = st; ui.q = o.q != null ? o.q : ui.q;
    ui.box.setAttribute("data-st", st);
    var p = ui.panel, read = canRead(), h = "";
    var type = btn("bsc-b bsc-2", tl("Skriv namnet", "Type the name"), "type", "search");
    var readB = read ? btn("bsc-b bsc-1", tl("Läs texten", "Read the text"), "read", "camera") : "";
    var again = btn("bsc-b bsc-2", tl("Skanna igen", "Scan again"), "again", "refresh");
    if (st === "live") h = '<div class="bsc-acts">' + readB + type + "</div>";
    else if (st === "busy") h = '<div class="bsc-acts">' + type + "</div>";
    else if (st === "unknown") h = '<p class="bsc-t">' + esc(tl("Streckkoden " + o.code + " finns inte i ölbiblioteket än.", "Barcode " + o.code + " is not in the beer library yet.")) + "</p>" +
      '<div class="bsc-acts">' + readB + type + "</div>" + '<div class="bsc-acts">' + again + "</div>";
    else if (st === "pick") h = '<h3 class="bsc-h">' + esc(tl("Menade du …", "Did you mean …")) + "</h3>" + rowsHTML(o.list) +
      '<div class="bsc-acts">' + btn("bsc-b bsc-2", tl("Ingen av dem", "None of them"), "type", "search") + again + "</div>";
    else if (st === "none") h = '<p class="bsc-t">' + esc(tl("Ingen öl i biblioteket matchar texten.", "No beer in the library matches the text.")) + "</p>" +
      '<div class="bsc-acts">' + btn("bsc-b bsc-1", ui.q ? tl("Sök på ”" + ui.q + "”", "Search for “" + ui.q + "”") : tl("Skriv namnet", "Type the name"), "type", "search") + again + "</div>";
    else if (st === "err" || st === "noread") h = '<p class="bsc-t">' + esc(st === "noread" ? tl("Den här telefonen kan inte läsa text i appen. Skriv namnet i stället.", "This phone can not read text in the app. Type the name instead.") : o.text) + "</p>" +
      '<div class="bsc-acts">' + type + (stream || st === "err" ? again : "") + "</div>";
    else if (st === "nocam") h = '<p class="bsc-t">' + esc(o.text) + "</p>" +
      '<div class="bsc-acts">' + btn("bsc-b bsc-1", tl("Välj en bild", "Choose a picture"), "file", "image") + type + "</div>";
    p.innerHTML = h;
    if (st === "busy") say(o.text); else if (st === "live") hint(); else say("");
    var L = lib(); if (L && L.h && L.h.fixPics) L.h.fixPics(p);
  }
  function noCam(why) {
    stopCam();
    if (ui) ui.box.classList.remove("bsc-on");
    state("nocam", { text: why === "denied" ? tl("Appen får inte använda kameran. Tillåt kameran i telefonens inställningar, eller välj en bild.", "The app may not use the camera. Allow the camera in the phone settings, or choose a picture.")
      : tl("Kameran gick inte att starta. Välj en bild i stället.", "Could not start the camera. Choose a picture instead.") });
  }
  function onAct(a) {
    if (a === "close") close();
    else if (a === "type") fill(ui.q || "");
    else if (a === "read") readNow();
    else if (a === "file") ui.file.click();
    else if (a === "again") { seen = {}; if (stream) { state("live"); if (det) loop(); } else startCam(); }
  }
  function build() {
    var box = mk("div", "bsc"); box.id = "bsc";
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", tl("Skanna en öl", "Scan a beer"));
    box.innerHTML = '<div class="bsc-top"><h2 class="bsc-title">' + esc(tl("Skanna en öl", "Scan a beer")) + "</h2>" +
      '<button type="button" class="bsc-x" data-bsc="close" aria-label="' + esc(tl("Stäng", "Close")) + '">' + ic("x") + "</button></div>" +
      '<div class="bsc-view"><video class="bsc-video" playsinline muted autoplay aria-hidden="true"></video>' +
      '<div class="bsc-frame" aria-hidden="true"><i class="bsc-line"></i></div></div>' +
      '<p class="bsc-msg" role="status" aria-live="polite" hidden></p><div class="bsc-panel"></div>' +
      '<p class="bsc-priv">' + esc(tl("Bilden stannar i telefonen. Inget skickas.", "The picture stays on the phone. Nothing is sent.")) + "</p>" +
      '<input type="file" accept="image/*" class="bsc-file" hidden tabindex="-1" aria-hidden="true">';
    var o = { box: box, video: box.querySelector("video"), msg: box.querySelector(".bsc-msg"), panel: box.querySelector(".bsc-panel"), file: box.querySelector(".bsc-file"), st: "", q: "" };
    box.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target : null; if (!t) return;
      var b = t.closest("[data-bl-beer]"), a = t.closest("[data-bsc]");
      if (b) { var d = data(), x = d && d.byId[b.getAttribute("data-bl-beer")]; if (x) found(x); return; }
      if (a) onAct(a.getAttribute("data-bsc"));
    });
    o.file.addEventListener("change", function () { var f = o.file.files && o.file.files[0]; o.file.value = ""; fromFile(f); });
    return o;
  }

  /* ---------- open / close (Android back, Esc, background) ---------- */
  function onKey(e) { if (e.key === "Escape" && ui) { e.preventDefault(); e.stopPropagation(); close(); } }
  function onVis() { if (!ui) return; if (D.visibilityState === "hidden") stopCam(); else if (ui.st === "live" && !stream) startCam(); }
  function onPop(e) {
    if (selfBack) { var f = selfBack; selfBack = null; f(); return; }
    if (ui && !(e.state && e.state.pnBsc === hist)) { hist = 0; close(); }
  }
  function open(o) {
    opts = o || {};
    if (ui) return;
    seen = {}; ui = build();
    D.body.appendChild(ui.box); D.body.classList.add("bsc-open");
    W.addEventListener("keydown", onKey, true);   // window capture runs before the search panel's own Esc (document)
    D.addEventListener("visibilitychange", onVis); W.addEventListener("pagehide", stopCam); W.addEventListener("popstate", onPop);
    try { var hs = history.state || {}, s = {}; for (var k in hs) s[k] = hs[k]; hist = Date.now(); s.pnBsc = hist; history.pushState(s, ""); } catch (e) { hist = 0; }
    try { ui.box.querySelector(".bsc-x").focus({ preventScroll: true }); } catch (e) {}
    var L = lib();
    (L && L.load ? L.load() : Promise.reject(new Error("no lib"))).then(function () { startCam(); }, function () {
      state("err", { text: tl("Ölen gick inte att ladda. Försök igen.", "Could not load the beers. Try again.") });
    });
  }
  function close(after) {
    if (!ui) { if (after) after(); return; }
    stopCam();
    ui.box.remove(); ui = null; D.body.classList.remove("bsc-open");
    W.removeEventListener("keydown", onKey, true); D.removeEventListener("visibilitychange", onVis); W.removeEventListener("pagehide", stopCam);
    var then = function () { W.removeEventListener("popstate", onPop); if (after) after(); else if (opts.back) opts.back(); };
    var hs = null; try { hs = history.state; } catch (e) {}
    if (hist && hs && hs.pnBsc === hist) {   // our own history step goes first, then the next screen
      hist = 0;
      var done = false, fin = function () { if (done) return; done = true; selfBack = null; then(); };
      selfBack = fin; setTimeout(fin, 450);
      try { history.back(); } catch (e) { fin(); }
    } else { hist = 0; then(); }
  }

  W.BEERSCAN = { open: open, close: close, canRead: canRead,
    _state: function () { return { open: !!ui, st: ui ? ui.st : "", cam: !!stream, det: !!det, worker: !!worker, q: ui ? ui.q : "" }; },
    _text: function (t) { fromText(t); }, _reset: function () { det = null; } };
  if (W.PN) PN.mod("BEERSCAN");
})();
