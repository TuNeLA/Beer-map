// btndress-pw.js — lane btndress (owner 19 Nov 2026, I-134): the ÖL! button dress (docs/js/seasondress.js + docs/season.css).
//  "the hats are ... off to the side a little bit. I want it to feel like they're actually sitting on the button, like the
//  button is a head" / "the snow on the button looks kind of bad ... like it looks like white hair".
//  fit     every dress at 390x844 and 360x640: the hat is CENTRED on the button (symmetric where it meets the top of the
//          circle), sits ON it (above the top, a little over the rim), never covers the label, the GLÖGG mug, the Annat
//          circle, never leaves the screen. Snow = white hair: tufts down both sides of the head, a bumpy (tufted) top edge,
//          the fringe stays above the mug. Pixel check: only the dress is painted (the rest is hidden), alpha mask.
//  states  "Ångra" and the wait (timer) while dressed: no dress pixel on the text; taps still reach ÖL! (pointer-events none,
//          same button box with and without the dress)
//  flip    Annat on the right: the hat flops to the left (away from Annat) and still misses it
//  still   reduced motion: no hop after a tap; the hair never moves
// usage: node btndress-pw.js <port> [sections regex]
const { ctxFor, wait } = require("./d2-helpers.js");
const { launchOpts } = require("./map3-lib.js");
const { chromium } = require("playwright");
const PORT = process.argv[2], ONLY = new RegExp(process.argv[3] || ".");
const BASE = "http://127.0.0.1:" + PORT + "/";
let pass = 0, fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined || c ? "" : " " + JSON.stringify(x).slice(0, 600))); c ? pass++ : fail++; };
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const DRESS = [["xmas", "none", "santa"], ["newyear", "none", "party"], ["valborg", "none", "cap"], ["midsummer", "none", "crown"], ["autumn", "none", "leaves"]];

async function open(b, vp, o = {}) {
  const { ctx, page } = await ctxFor(b, vp, { reduced: !!o.reduced });
  const S = { posts: 0, undos: 0 };
  await page.route(/rest\/v1\/rpc\/post_beer_v2/, (r) => { S.posts++; J(r, { accepted: true, beer_count: 3, drinks: 3, lat: 60.1511, lng: 15.1876, precise: true,
    expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), wait_seconds: 0, undo_until: new Date(Date.now() + 120000).toISOString() }); });
  await page.route(/rest\/v1\/rpc\/undo_beer/, (r) => { S.undos++; J(r, { ok: true, undone: true }); });
  const errs = []; page.on("pageerror", (e) => { if (!/ResizeObserver/.test(e.message)) errs.push(e.message.slice(0, 200)); });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.PNSeason && window.PNDress && window.PN && PN.tickCooldown && document.getElementById("btn-beer"), null, { timeout: 30000 });
  await wait(page, 4500);
  await page.addStyleTag({ content: "#toasts{display:none !important}" });
  return { ctx, page, errs, S };
}
const force = async (page, season, wx) => { await page.evaluate(([s, w]) => { PNSeason._force({ season: s, wx: w }); PNDress.place(); }, [season, wx]); await wait(page, 500); };
const rest = (page) => page.evaluate(() => { const m = JSON.parse(localStorage.getItem("olnu.night") || "{}"); m.lastTap = 0; localStorage.setItem("olnu.night", JSON.stringify(m));
  try { PN.s.meState && (PN.s.meState.undo_until = null); } catch (e) {} PN.tickCooldown(); });

// the geometry of the button and its neighbours (CSS px, viewport)
const geo = (page) => page.evaluate(() => {
  const R = (e) => { if (!e || !e.getClientRects().length) return null; const q = e.getBoundingClientRect(); return { l: q.left, t: q.top, r: q.right, b: q.bottom, w: q.width, h: q.height }; };
  const rg = document.createRange(); rg.selectNodeContents(document.getElementById("beer-label"));
  const ow = document.getElementById("other-wrap"), ob = !ow || ow.hidden ? null : R(document.getElementById("btn-other"));
  const mug = document.querySelector("#btn-beer .ss-mug:not([hidden])");
  return { btn: R(document.getElementById("btn-beer")), label: R(rg), mug: mug && getComputedStyle(mug).display !== "none" ? R(mug) : null, annat: ob, vw: innerWidth, vh: innerHeight };
});
// alpha mask of ONLY the dress pieces (sel) in a band around the button: 1 CSS px per cell. Everything else is hidden.
async function mask(page, sel, g) {
  const y0 = Math.max(0, Math.floor(g.btn.t - 150)), y1 = Math.min(g.vh, Math.ceil(g.btn.b + 10));
  const tag = await page.addStyleTag({ content: `html,body{background:transparent !important} body *{visibility:hidden !important} ${sel}, ${sel} *{visibility:visible !important}` });
  await wait(page, 120);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: y0, width: g.vw, height: y1 - y0 } });
  await tag.evaluate((n) => n.remove());
  const bits = await page.evaluate(async ([b64, w, h]) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data, k = c.width / w;
    let s = ""; for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const i = (Math.floor(yy * k) * c.width + Math.floor(xx * k)) * 4 + 3; s += d[i] > 90 ? "1" : "0"; }
    return s;
  }, [png.toString("base64"), g.vw, y1 - y0]);
  const W = g.vw, H = y1 - y0, at = (x, y) => { const yy = Math.round(y) - y0, xx = Math.round(x); return xx >= 0 && xx < W && yy >= 0 && yy < H && bits[yy * W + xx] === "1"; };
  let n = 0, top = 1e9, bot = -1, l = 1e9, r = -1;
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) if (bits[yy * W + xx] === "1") { n++; top = Math.min(top, yy + y0); bot = Math.max(bot, yy + y0); l = Math.min(l, xx); r = Math.max(r, xx); }
  const inRect = (q) => { if (!q) return 0; let c = 0; for (let y = Math.ceil(q.t); y < q.b; y++) for (let x = Math.ceil(q.l); x < q.r; x++) if (at(x, y)) c++; return c; };
  const inCircle = (q, pad) => { if (!q) return 0; const cx = (q.l + q.r) / 2, cy = (q.t + q.b) / 2, rr = q.w / 2 + (pad || 0); let c = 0;
    for (let y = Math.floor(cy - rr); y <= cy + rr; y++) for (let x = Math.floor(cx - rr); x <= cx + rr; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= rr * rr && at(x, y)) c++; return c; };
  const row = (y) => { let a = -1, b = -1; for (let x = 0; x < W; x++) if (at(x, y)) { if (a < 0) a = x; b = x; } return a < 0 ? null : { l: a, r: b }; };
  const colTop = (x) => { for (let y = y0; y < y1; y++) if (at(x, y)) return y; return null; };
  return { n, top, bot, l, r, at, inRect, inCircle, row, colTop, edgeL: l <= 0, edgeR: r >= W - 1, edgeT: top <= 0 };
}
// the hat checks for one dress (m = mask of the hat only)
function hatChecks(m, g, name) {
  const cx = (g.btn.l + g.btn.r) / 2, bw = g.btn.w, t = g.btn.t, rw = m.row(t + 3);
  ok(m.n > 300, `${name}: the hat is drawn (${m.n} px)`, m.n);
  ok(!!rw && Math.abs((rw.l + rw.r) / 2 - cx) <= 3 && rw.r - rw.l > bw * 0.3, `${name}: CENTRED where it meets the top of the button (row top+3: ${rw && rw.l}..${rw && rw.r}, button centre ${cx.toFixed(0)})`, { rw, cx, bw });
  ok(m.top < t - 8, `${name}: it sits ON the button (top ${m.top} is above the button top ${t.toFixed(0)})`, { top: m.top, t });
  ok(m.bot >= t + 4 && m.bot <= t + bw * 0.3, `${name}: a little overlap on the rim (lowest px ${m.bot}, button top ${t.toFixed(0)})`, { bot: m.bot, t, bw });
  ok(m.inRect(g.label) === 0, `${name}: not on the label`, m.inRect(g.label));
  ok(!g.mug || m.inRect(g.mug) === 0, `${name}: not on the GLÖGG mug`, g.mug && m.inRect(g.mug));
  ok(!g.annat || m.inCircle(g.annat, 2) === 0, `${name}: not on the Annat circle`, g.annat && m.inCircle(g.annat, 2));
  ok(!m.edgeL && !m.edgeR && !m.edgeT && m.l > 0 && m.r < g.vw - 1, `${name}: inside the screen (${m.l}..${m.r} of ${g.vw})`, { l: m.l, r: m.r, top: m.top });
}

async function fit(b, vp) {
  const { ctx, page, errs } = await open(b, vp);
  const tag = vp.width + "x" + vp.height;
  for (const [season, wx, kind] of DRESS) {
    await force(page, season, wx);
    const g = await geo(page);
    const st = await page.evaluate(() => PNDress.state());
    ok(st.dress === kind && st.shown, `${tag} ${season}: dress ${kind}`, st);
    hatChecks(await mask(page, ".ss-dress .ss-d", g), g, `${tag} ${kind}`);
  }
  // snow weather = white hair (winter: no hat), and Christmas + snow = hair under the Santa hat
  for (const [season, name] of [["winter", "hair"], ["xmas", "hair under the hat"]]) {
    await force(page, season, "snow");
    const g = await geo(page), m = await mask(page, ".ss-dress .ss-hair", g), cx = (g.btn.l + g.btn.r) / 2, cy = (g.btn.t + g.btn.b) / 2, bw = g.btn.w;
    const st = await page.evaluate(() => PNDress.state());
    ok(/\+snow$/.test(st.dress) && m.n > 300, `${tag} ${name}: snow weather draws the hair (${st.dress}, ${m.n} px)`, { st, n: m.n });
    // hair comes down BOTH sides of the head: pixels near the rim at 30 % of the button above its centre (it stops above the label box)
    const yS = cy - bw * 0.30, side = (s) => { for (let d = 0.3; d <= 0.58; d += 0.02) if (m.at(cx + s * bw * d, yS)) return true; return false; };
    ok(side(-1) && side(1), `${tag} ${name}: tufts down both sides of the head (row ${yS.toFixed(0)})`, { yS });
    const rw = m.row(g.btn.t + 3);
    ok(!!rw && Math.abs((rw.l + rw.r) / 2 - cx) <= 3, `${tag} ${name}: centred on the head`, { rw, cx });
    // a tufted top edge: count the bumps (local tops) of the outline across the head
    const tops = []; for (let x = Math.round(cx - bw * 0.45); x <= cx + bw * 0.45; x++) tops.push(m.colTop(x));
    let bumps = 0; for (let i = 2; i < tops.length - 2; i++) if (tops[i] != null && tops[i - 2] != null && tops[i + 2] != null && tops[i] < tops[i - 2] && tops[i] <= tops[i + 2] && tops[i] <= tops[i - 1] && tops[i] <= tops[i + 1]) bumps++;
    ok(bumps >= 6, `${tag} ${name}: soft rounded tufts along the top (${bumps} bumps; flat snow had 1-2)`, bumps);
    ok(m.inRect(g.label) === 0 && (!g.mug || m.inRect(g.mug) === 0), `${tag} ${name}: the fringe stays above the label and the mug`, { label: m.inRect(g.label), mug: g.mug && m.inRect(g.mug) });
    ok(!g.annat || m.inCircle(g.annat, 2) === 0, `${tag} ${name}: not on the Annat circle`, g.annat && m.inCircle(g.annat, 2));
    ok(m.l > 0 && m.r < g.vw - 1 && !m.edgeT, `${tag} ${name}: inside the screen`, { l: m.l, r: m.r });
  }
  ok(errs.length === 0, `${tag} fit: no page error`, errs);
  await ctx.close();
}

async function states(b, vp) {
  const { ctx, page, errs, S } = await open(b, vp);
  const tag = vp.width + "x" + vp.height;
  await force(page, "normal", "none"); await rest(page); await wait(page, 300);
  const plain = (await geo(page)).btn;
  await force(page, "xmas", "snow"); await rest(page); await wait(page, 300);
  const dressed = await geo(page);
  ok(Math.abs(plain.l - dressed.btn.l) < 0.5 && Math.abs(plain.w - dressed.btn.w) < 0.5 && Math.abs(plain.t - dressed.btn.t) < 0.5, `${tag}: the ÖL! button box is the same with and without the dress`, { plain, dressed: dressed.btn });
  const pe = await page.evaluate(() => { const d = document.querySelector(".ss-dress"), b = document.getElementById("btn-beer").getBoundingClientRect(), e = document.elementFromPoint(b.left + b.width / 2, b.top + 5);
    return { pe: getComputedStyle(d).pointerEvents, hit: e && (e.id === "btn-beer" || !!e.closest("#btn-beer")), what: e && (e.id || e.className) }; });
  ok(pe.pe === "none" && pe.hit, `${tag}: a tap on the hat brim reaches ÖL! (pointer-events none)`, pe);
  await page.click("#btn-beer"); await wait(page, 1600);
  let g = await geo(page);
  const u = await page.evaluate(() => ({ cls: document.getElementById("btn-beer").className, label: document.getElementById("beer-label").textContent }));
  ok(S.posts === 1 && /undo/.test(u.cls) && /Ångra/.test(u.label), `${tag}: the tap went through; Ångra shows`, { posts: S.posts, u });
  let m = await mask(page, ".ss-dress", g);
  ok(m.inRect(g.label) === 0, `${tag} Ångra: the hat + hair do not cover the Ångra text`, m.inRect(g.label));
  await wait(page, 11000);
  g = await geo(page);
  const w = await page.evaluate(() => ({ cls: document.getElementById("btn-beer").className, label: document.getElementById("beer-label").textContent }));
  m = await mask(page, ".ss-dress", g);
  ok(/cooldown/.test(w.cls) && /^\d+:\d\d$/.test(w.label) && m.n > 300 && m.inRect(g.label) === 0, `${tag} wait: the timer (${w.label}) is free, the dress stays`, { w, onLabel: m.inRect(g.label) });
  // the timer is the widest text on the button: every dress (with hair) stays off it
  for (const [season] of DRESS) {
    await force(page, season, "snow"); g = await geo(page); m = await mask(page, ".ss-dress", g);
    ok(m.n > 300 && m.inRect(g.label) === 0, `${tag} wait + ${season} + hair: the timer is free`, m.inRect(g.label));
  }
  ok(errs.length === 0, `${tag} states: no page error`, errs);
  await ctx.close();
}

async function flip(b) {
  const { ctx, page, errs } = await open(b, { width: 390, height: 844 });
  await force(page, "xmas", "none");
  const g0 = await geo(page), m0 = await mask(page, ".ss-dress .ss-d", g0), cx = (g0.btn.l + g0.btn.r) / 2;
  // Annat up-left (normal): the flop (pom-pom) is on the right
  ok(!!g0.annat && g0.annat.l + g0.annat.w / 2 < cx && m0.r - cx > cx - m0.l, "Annat up-left: the Santa hat flops to the right", { annat: g0.annat, l: m0.l, r: m0.r, cx });
  // move Annat up-right (pnds.js can put it there): the hat flops to the left and still misses it
  const moved = await page.evaluate(() => { const o = document.getElementById("other-wrap"); if (!o || o.hidden) return false; const b = document.querySelector(".beer-wrap").getBoundingClientRect(), r = o.getBoundingClientRect();
    o.style.setProperty("left", (b.width - (r.left - b.left) - r.width) + "px", "important"); PNDress.place(); return document.querySelector(".ss-dress").classList.contains("ss-flip"); });
  await wait(page, 200);
  const g1 = await geo(page), m1 = await mask(page, ".ss-dress .ss-d", g1), rw = m1.row(g1.btn.t + 3);
  ok(moved && g1.annat && g1.annat.l + g1.annat.w / 2 > cx && cx - m1.l > m1.r - cx, "Annat up-right: the hat flops to the left (away from Annat)", { moved, annat: g1.annat, l: m1.l, r: m1.r });
  ok(!!rw && Math.abs((rw.l + rw.r) / 2 - cx) <= 3 && m1.inCircle(g1.annat, 2) === 0, "Annat up-right: still centred, not on Annat", { rw, cx, hit: m1.inCircle(g1.annat, 2) });
  ok(errs.length === 0, "flip: no page error", errs);
  await ctx.close();
}

async function still(b) {
  const { ctx, page, errs } = await open(b, { width: 390, height: 844 }, { reduced: true });
  await force(page, "xmas", "snow"); await rest(page); await wait(page, 300);
  await page.click("#btn-beer"); await wait(page, 200);
  const a = await page.evaluate(() => ({ hop: document.querySelector(".ss-dress").classList.contains("ss-hop"), anims: document.querySelector(".ss-dress").getAnimations({ subtree: true }).length }));
  ok(!a.hop && a.anims === 0, "reduced motion: no hop after the tap, nothing in the dress moves", a);
  await ctx.close();
  const o2 = await open(b, { width: 390, height: 844 });
  await force(o2.page, "xmas", "snow"); await rest(o2.page); await wait(o2.page, 300);
  await o2.page.click("#btn-beer"); await wait(o2.page, 250);
  const h = await o2.page.evaluate(() => ({ hat: document.querySelector(".ss-dress .ss-d").getAnimations().length, hair: document.querySelector(".ss-dress .ss-hair").getAnimations().length }));
  ok(h.hat >= 1 && h.hair === 0, "normal motion: the hat hops once after the tap, the hair stays still", h);
  ok(errs.length === 0 && o2.errs.length === 0, "still: no page error", errs.concat(o2.errs));
  await o2.ctx.close();
}

(async () => {
  const b = await chromium.launch(launchOpts());
  try {
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
      if (ONLY.test("fit")) await fit(b, vp);
      if (ONLY.test("states")) await states(b, vp);
    }
    if (ONLY.test("flip")) await flip(b);
    if (ONLY.test("still")) await still(b);
  } catch (e) { console.log("FAIL crash " + (e && e.stack || e)); fail++; }
  await b.close();
  console.log(`btndress: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
