// beerscan-pw.js — I-140 (owner 21 Nov 2026 "add a way to scan the ocr on a beer"), lane beerscan: the camera button in the
// Öl search (js/barsearch.js) -> js/beerscan.js (lazy) + js/beerscan-match.js. Fake camera (Chromium fake device), a stub
// BarcodeDetector / TextDetector (headless Linux has neither), and ONE real OCR run with Tesseract.js from docs/vendor/tesseract
// on a picture with printed text (proves: our own files, the page CSP, the worker, the match). Old code: no #bs-cam -> FAIL.
// 390 px, mocked Supabase. Usage: node beerscan-pw.js <port>   (BEERSCAN_SHOTS=<dir> also saves 390x844 @2x pictures)
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SHOTS = process.env.BEERSCAN_SHOTS || "";
const K1664 = "5740700992636";   // Kronenbourg 1664
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, c || x === undefined ? "" : JSON.stringify(x).slice(0, 500)); };
const shot = async (page, name) => { if (SHOTS) { await wait(page, 450); await page.screenshot({ path: SHOTS + "/" + name + ".png" }); } };

// stubs: BarcodeDetector answers from window.__codes (live video) / __imgCodes (a still picture); TextDetector from __text.
// o.deny = getUserMedia says NotAllowedError. Every camera track is kept in __tracks (to check that it stops).
function stubs(o) {
  window.__codes = []; window.__imgCodes = []; window.__tracks = []; window.__detects = 0;
  window.BarcodeDetector = class {
    constructor(x) { this.f = (x && x.formats) || []; }
    static getSupportedFormats() { return Promise.resolve(["qr_code", "ean_13", "ean_8", "upc_a", "upc_e"]); }
    detect(src) {
      window.__detects++;
      const still = src && src.tagName === "CANVAS", q = still ? window.__imgCodes : window.__codes;
      return Promise.resolve(q.length ? [{ rawValue: q.shift(), format: "ean_13" }] : []);
    }
  };
  if (o.text) window.TextDetector = class { detect() { return Promise.resolve(window.__text ? window.__text.split("|").map((t) => ({ rawValue: t })) : []); } };
  const md = navigator.mediaDevices, gum = md && md.getUserMedia.bind(md);
  if (md) md.getUserMedia = (c) => {
    if (o.deny) { const e = new Error("denied"); e.name = "NotAllowedError"; return Promise.reject(e); }
    return gum(c).then((s) => { s.getTracks().forEach((t) => window.__tracks.push(t)); return s; });
  };
}
async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { reduced: !!o.reduced });
  await ctx.grantPermissions(["geolocation", "camera"]);
  await ctx.addInitScript(stubs, o);
  const errs = [], reqs = []; page.on("pageerror", (e) => errs.push(e.message));
  page.on("request", (r) => reqs.push(r.url()));
  await boot(page);
  await page.evaluate(() => window.BARSEARCH.open());
  await wait(page, 300);
  return { ctx, page, errs, reqs };
}
const st = (page) => page.evaluate(() => (window.BEERSCAN ? window.BEERSCAN._state() : null));
const live = (page) => page.waitForFunction(() => window.BEERSCAN && window.BEERSCAN._state().cam && document.querySelector(".bsc-video").readyState >= 2, null, { timeout: 15000 }).catch(() => {});
const toBeer = async (page) => { await page.click("#bs-tab-beer"); await page.waitForSelector("#bs-beer .bl-row", { timeout: 15000 }).catch(() => {}); };
const tapCam = async (page) => { await page.click("#bs-cam"); await page.waitForSelector("#bsc", { timeout: 15000 }).catch(() => {}); };
const sheetTitle = (page) => page.evaluate(() => { const s = document.getElementById("sheet"); return s && !s.hidden ? document.getElementById("sheet-title").textContent : null; });
const waitSheet = (page) => page.waitForFunction(() => { const s = document.getElementById("sheet"); return s && !s.hidden; }, null, { timeout: 20000 }).catch(() => {});
const tracksOff = (page) => page.evaluate(() => window.__tracks.length > 0 && window.__tracks.every((t) => t.readyState === "ended"));

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  try {
    // ---------- 1. the button + lazy loading ----------
    let { ctx, page, errs, reqs } = await open(browser, { text: true });
    const b0 = await page.evaluate(() => { const c = document.getElementById("bs-cam"); return { has: !!c, hidden: c ? c.hidden : null }; });
    ok("Krogar tab: no camera button shown", b0.has && b0.hidden === true, b0);
    await toBeer(page);
    const b1 = await page.evaluate(() => {
      const c = document.getElementById("bs-cam"), r = c && c.getBoundingClientRect(), f = document.querySelector(".bs-field").getBoundingClientRect();
      return { vis: !!c && !c.hidden && r.width > 0, w: r && r.width, h: r && r.height, inField: r && r.right <= f.right + 1 && r.left >= f.left, aria: c && c.getAttribute("aria-label"), svg: !!(c && c.querySelector("svg")) };
    });
    await shot(page, "00-ol-search-camera-button");
    ok("Öl tab: a camera button in the search field, 44x44, labelled, an icon (no emoji)", b1.vis && b1.w >= 44 && b1.h >= 44 && b1.inField && /Skanna en öl/.test(b1.aria) && b1.svg, b1);
    await page.fill("#bs-q", "pri"); await wait(page, 300);
    const b2 = await page.evaluate(() => ({ cam: document.getElementById("bs-cam").hidden, clear: document.querySelector(".bs-clear:not(.bs-cam)").hidden }));
    ok("typing: the ✕ takes the camera's place", b2.cam === true && b2.clear === false, b2);
    await page.fill("#bs-q", ""); await wait(page, 300);
    ok("empty field: the camera button is back", await page.evaluate(() => !document.getElementById("bs-cam").hidden));
    ok("nothing of the scanner is loaded before the tap", !reqs.some((u) => /beerscan|vendor\/tesseract/.test(u)) && !(await page.evaluate(() => !!window.BEERSCAN)), reqs.filter((u) => /beerscan/.test(u)));

    await tapCam(page); await live(page);
    const s1 = await page.evaluate(() => {
      const x = document.getElementById("bsc"), r = (e) => e.getBoundingClientRect();
      return { dlg: x && x.getAttribute("role"), modal: x && x.getAttribute("aria-modal"), st: window.BEERSCAN._state(), z: +getComputedStyle(x).zIndex,
        msg: document.querySelector(".bsc-msg").textContent, btns: [...x.querySelectorAll("button")].filter((b) => b.offsetParent).map((b) => ({ t: b.textContent, h: r(b).height, w: r(b).width })),
        priv: document.querySelector(".bsc-priv").textContent, focus: document.activeElement && document.activeElement.className, play: !document.querySelector(".bsc-video").paused };
    });
    ok("tap: the scanner opens full screen (dialog, modal, above the search)", s1.dlg === "dialog" && s1.modal === "true" && s1.z > 1450, s1);
    ok("the rear camera runs (fake device) and the barcode scan starts", s1.st.cam && s1.st.det && s1.play && s1.st.st === "live", s1.st);
    ok("hint: point at the barcode; buttons Läs texten + Skriv namnet; all 44 px", /streckkoden/.test(s1.msg) && s1.btns.some((b) => /Läs texten/.test(b.t)) && s1.btns.some((b) => /Skriv namnet/.test(b.t)) && s1.btns.every((b) => b.h >= 44 && b.w >= 44), s1);
    ok("says that the picture stays on the phone; focus on Stäng", /stannar i telefonen/.test(s1.priv) && /bsc-x/.test(s1.focus), s1);
    ok("only the scanner files loaded (no OCR files yet, no other host)", reqs.some((u) => /js\/beerscan\.js/.test(u)) && !reqs.some((u) => /vendor\/tesseract/.test(u)), reqs.filter((u) => /beerscan|tesseract/.test(u)));
    await shot(page, "01-scan-live");

    // ---------- 2. a known barcode -> the beer page, camera off ----------
    await page.evaluate((c) => { window.__codes.push(c); }, K1664);
    await waitSheet(page);
    ok("known barcode (EAN 5740700992636) -> the beer page Kronenbourg 1664", (await sheetTitle(page)) === "Kronenbourg 1664", await sheetTitle(page));
    ok("scanner closed and the camera stopped", !(await page.evaluate(() => !!document.getElementById("bsc"))) && (await tracksOff(page)));
    await shot(page, "02-barcode-beer-page");
    await ctx.close();

    // ---------- 3. unknown barcode, back, Esc ----------
    ({ ctx, page, errs, reqs } = await open(browser, { text: true }));
    await toBeer(page); await tapCam(page); await live(page);
    await page.evaluate(() => window.__codes.push("4006381333931"));
    await page.waitForFunction(() => window.BEERSCAN._state().st === "unknown", null, { timeout: 8000 }).catch(() => {});
    const u = await page.evaluate(() => ({ st: window.BEERSCAN._state().st, t: document.querySelector(".bsc-panel").innerText }));
    ok("unknown barcode: says it is not in the library yet + Läs texten / Skriv namnet / Skanna igen", u.st === "unknown" && /4006381333931 finns inte i ölbiblioteket/.test(u.t) && /Läs texten/.test(u.t) && /Skanna igen/.test(u.t), u);
    await shot(page, "03-unknown-barcode");
    await page.click('[data-bsc="again"]'); await wait(page, 200);
    ok("Skanna igen -> live scan again", (await st(page)).st === "live");
    await page.evaluate(() => history.back()); await wait(page, 700);
    const bk = await page.evaluate(() => ({ scan: !!document.getElementById("bsc"), search: !!document.getElementById("bs-panel") }));
    ok("Android back closes the scanner only (the search stays) and the camera stops", !bk.scan && bk.search && (await tracksOff(page)), bk);
    await tapCam(page); await live(page);
    await page.keyboard.press("Escape"); await wait(page, 700);
    const es = await page.evaluate(() => ({ scan: !!document.getElementById("bsc"), search: !!document.getElementById("bs-panel") }));
    ok("Esc closes the scanner only", !es.scan && es.search, es);

    // ---------- 4. label text: Menade du … ----------
    await tapCam(page); await live(page);
    await page.evaluate(() => { window.__text = "eld Ww 3,5%|Heineken"; });
    await page.click('[data-bsc="read"]');
    await page.waitForFunction(() => window.BEERSCAN._state().st === "pick", null, { timeout: 8000 }).catch(() => {});
    const p = await page.evaluate(() => ({ h: (document.querySelector(".bsc-h") || {}).textContent, rows: [...document.querySelectorAll(".bsc-rows .bl-row")].map((r) => ({ t: r.querySelector("b").textContent, h: r.getBoundingClientRect().height })) }));
    ok("text 'Heineken' -> 'Menade du …' with 2-3 Heineken beers, 44 px rows", p.h === "Menade du …" && p.rows.length >= 2 && p.rows.length <= 3 && p.rows.every((r) => /Heineken/i.test(r.t) && r.h >= 44), p);
    const low = await page.evaluate(() => { const a = [...document.querySelectorAll(".bsc-panel .bsc-b")].map((b) => b.getBoundingClientRect().bottom); return { max: Math.max(...a), vh: innerHeight }; });
    ok("the answers sit at the bottom (thumb reach)", low.max > low.vh * 0.8 && low.max <= low.vh, low);
    ok("no request for the OCR files when the browser reads text itself (TextDetector)", !reqs.some((x) => /vendor\/tesseract/.test(x)));
    await shot(page, "04-menade-du");
    const pickName = p.rows[0] && p.rows[0].t;
    await page.click(".bsc-rows .bl-row"); await waitSheet(page);
    ok("a tap on a row opens that beer", (await sheetTitle(page)) === pickName, await sheetTitle(page));
    await ctx.close();

    // ---------- 5. text with no match -> the normal search, filled ----------
    ({ ctx, page, errs, reqs } = await open(browser, { text: true }));
    await toBeer(page); await tapCam(page); await live(page);
    await page.evaluate(() => { window.__text = "Plonkety|Zq"; });
    await page.click('[data-bsc="read"]');
    await page.waitForFunction(() => window.BEERSCAN._state().st === "none", null, { timeout: 8000 }).catch(() => {});
    const n = await page.evaluate(() => document.querySelector(".bsc-panel").innerText);
    ok("no match: says so + 'Sök på ”plonkety”'", /Ingen öl i biblioteket matchar/.test(n) && /Sök på ”plonkety”/.test(n), n);
    await shot(page, "05-no-match");
    await page.click('.bsc-panel [data-bsc="type"]'); await wait(page, 900);
    const f = await page.evaluate(() => ({ scan: !!document.getElementById("bsc"), q: document.getElementById("bs-q").value, txt: document.getElementById("bs-beer").innerText }));
    ok("-> the Öl search with the read word filled in", !f.scan && f.q === "plonkety" && /Ingen öl med det namnet/.test(f.txt), f);
    // a clear text opens at once
    await page.fill("#bs-q", ""); await wait(page, 300);
    await tapCam(page); await live(page);
    await page.evaluate(() => { window.__text = "KRONENBOURG|1664"; });
    await page.click('[data-bsc="read"]'); await waitSheet(page);
    ok("clear text 'KRONENBOURG 1664' -> the beer page at once", (await sheetTitle(page)) === "Kronenbourg 1664", await sheetTitle(page));
    ok("no page errors (1-5)", errs.length === 0, errs);
    await ctx.close();

    // ---------- 6. camera denied -> a card; a picture from the gallery with a barcode ----------
    ({ ctx, page, errs, reqs } = await open(browser, { deny: true, text: true }));
    await toBeer(page); await tapCam(page);
    await page.waitForFunction(() => window.BEERSCAN._state().st === "nocam", null, { timeout: 8000 }).catch(() => {});
    const d = await page.evaluate(() => ({ t: document.querySelector(".bsc-panel").innerText, ph: getComputedStyle(document.querySelector(".bsc-ph")).display, frame: getComputedStyle(document.querySelector(".bsc-frame")).display, file: document.querySelector(".bsc-file").getAttribute("accept"), cap: document.querySelector(".bsc-file").hasAttribute("capture") }));
    ok("camera denied: how to allow it + Välj en bild + Skriv namnet; a camera placeholder, no aiming box", /Tillåt kameran/.test(d.t) && /Välj en bild/.test(d.t) && /Skriv namnet/.test(d.t) && d.ph === "grid" && d.frame === "none", d);
    ok("the picture picker is the gallery (image/*, no capture = no camera app)", d.file === "image/*" && !d.cap, d);
    await shot(page, "06-camera-denied");
    const png = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 400; c.height = 300; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 400, 300); return c.toDataURL("image/png").split(",")[1]; });
    await page.evaluate((c) => window.__imgCodes.push(c), K1664);
    await page.setInputFiles(".bsc-file", { name: "beer.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await waitSheet(page);
    ok("a gallery picture with a barcode -> the beer page", (await sheetTitle(page)) === "Kronenbourg 1664", await sheetTitle(page));
    await ctx.close();

    // ---------- 7. English + reduced motion ----------
    ({ ctx, page, errs, reqs } = await open(browser, { reduced: true, text: true }));
    await page.evaluate(() => { window.__i18n = window.I18N; window.I18N = new Proxy(window.__i18n, { get: (t, k) => (k === "lang" ? "en" : t[k]) }); });
    await toBeer(page); await tapCam(page); await live(page);
    const e = await page.evaluate(() => ({ title: document.querySelector(".bsc-title").textContent, msg: document.querySelector(".bsc-msg").textContent, b: document.querySelector(".bsc-panel").innerText,
      anim: getComputedStyle(document.querySelector(".bsc-line")).animationName, box: getComputedStyle(document.getElementById("bsc")).animationName }));
    ok("English texts", e.title === "Scan a beer" && /barcode/.test(e.msg) && /Read the text/.test(e.b) && /Type the name/.test(e.b), e);
    ok("reduced motion: the scan line and the panel stand still", e.anim === "none" && e.box === "none", e);
    await ctx.close();

    // ---------- 8. REAL OCR: Tesseract.js from docs/vendor/tesseract, the page CSP, a printed label ----------
    ({ ctx, page, errs, reqs } = await open(browser, { deny: true }));   // no TextDetector: the app must use its own OCR
    await toBeer(page); await tapCam(page);
    await page.waitForFunction(() => window.BEERSCAN._state().st === "nocam", null, { timeout: 8000 }).catch(() => {});
    const label = await page.evaluate(() => {
      const c = document.createElement("canvas"); c.width = 900; c.height = 420; const g = c.getContext("2d");
      g.fillStyle = "#f4f1e8"; g.fillRect(0, 0, 900, 420); g.fillStyle = "#1b2a6b"; g.font = "bold 96px sans-serif"; g.textAlign = "center";
      g.fillText("KRONENBOURG", 450, 170); g.font = "bold 120px serif"; g.fillText("1664", 450, 320);
      return c.toDataURL("image/png").split(",")[1];
    });
    const t0 = Date.now();
    await page.setInputFiles(".bsc-file", { name: "label.png", mimeType: "image/png", buffer: Buffer.from(label, "base64") });
    await page.waitForFunction(() => window.BEERSCAN && window.BEERSCAN._state().st === "busy", null, { timeout: 5000 }).catch(() => {});
    const busy = await page.evaluate(() => ({ t: document.querySelector(".bsc-msg").textContent, still: !!document.querySelector(".bsc-view .bsc-still") }));
    ok("first OCR: says the text reader loads (about 4 MB, first time only) and shows the chosen picture", /textläsaren/i.test(busy.t) && busy.still, busy);
    await shot(page, "07-ocr-loading");
    await page.waitForFunction(() => { const s = document.getElementById("sheet"); return (s && !s.hidden) || (window.BEERSCAN._state().st && !/busy|nocam/.test(window.BEERSCAN._state().st)); }, null, { timeout: 90000 }).catch(() => {});
    const ms = Date.now() - t0, title = await sheetTitle(page), so = await st(page);
    ok("real Tesseract OCR reads the printed label -> Kronenbourg 1664 (" + ms + " ms)", title === "Kronenbourg 1664", { title, so, errs });
    // the app itself loads Mapbox from jsDelivr: only the OCR requests are checked here
    const tes = reqs.filter((x) => /tesseract|traineddata|tessdata|vision|ocr/i.test(x));
    ok("OCR files came only from our own docs/vendor/tesseract (no CDN, no upload)", tes.length >= 3 && tes.every((x) => x.startsWith("http://127.0.0.1:") && /\/vendor\/tesseract\//.test(x)), tes);
    ok("no page errors (6-8)", errs.length === 0, errs);
    await ctx.close();
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack); }
  await browser.close();
  console.log(`\nbeerscan: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
