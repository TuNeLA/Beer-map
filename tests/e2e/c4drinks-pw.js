// lane c4drinks: I-33 one PNI.kind everywhere, I-35 beer-style picker icons + >= 44 px, I-26 Sidospår buttons hold the icon,
// I-34 ÅNGRA chip exactly over Annat, I-44 Swish link per platform (Android intent / iPhone https / PC QR).
// Usage: node c4drinks-pw.js <port>
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const pw = require("playwright");
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 600)); };

// Pixel difference of the icon drawings at 28 px: every pair must differ clearly.
async function minDiff(page, names) {
  return page.evaluate(async (names) => {
    const px = [];
    for (const n of names) {
      const x = window.PNI.kind(n, "").replace(/currentColor/g, "#000").replace(/width="24" height="24"/, 'width="28" height="28"');
      const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(x); await img.decode();
      const c = document.createElement("canvas"); c.width = 28; c.height = 28; const g = c.getContext("2d"); g.drawImage(img, 0, 0, 28, 28);
      const a = g.getImageData(0, 0, 28, 28).data, m = []; for (let i = 3; i < a.length; i += 4) m.push(a[i] > 60 ? 1 : 0); px.push(m);
    }
    let minD = 1, pair = "";
    for (let i = 0; i < px.length; i++) for (let j = i + 1; j < px.length; j++) {
      let u = 0, n = 0; for (let k = 0; k < px[i].length; k++) { if (px[i][k] || px[j][k]) u++; if (px[i][k] !== px[j][k]) n++; }
      const v = u ? n / u : 0; if (v < minD) { minD = v; pair = names[i] + "/" + names[j]; }
    }
    return { minD, pair };
  }, names);
}
async function open(browser, o = {}) {
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, o);
  await page.route(/rest\/v1\/rpc\/(post_beer_v2|post_beer)$/, (r) => J(r, { accepted: true, wait_seconds: 0, id: 77, beer_count: 4, is_new: false,
    expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), undo_until: new Date(Date.now() + 120e3).toISOString(), milestone: null, hidden: false, lat: 60.15, lng: 15.18, precise: true }));
  await boot(page);
  await page.evaluate(() => document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove()));
  return { ctx, page };
}

(async () => {
  const browser = await pw.chromium.launch();
  const TYPES = ["lager", "pilsner", "ipa", "apa", "stout", "vete", "ale", "sour", "alkfri", "annan"];
  const SIDE = ["rom", "vin", "cider", "drink", "shot", "whisky", "grogg", "bubbel", "annat"];
  {
    const { ctx, page } = await open(browser);
    /* ---- I-35: ten own icons, all different from each other and from the Sidospår set ---- */
    const all = await minDiff(page, TYPES.concat(SIDE));
    ok(all.minD >= 0.3, "19 drink icons clearly different at 28 px", all);
    ok(await page.evaluate((T) => T.every((k) => window.PNI.KIND[k] && window.PNI.kind(k).indexOf("<path") > 0 || window.PNI.kind(k).indexOf("<rect") > 0), TYPES), "every beer style has its own PNI icon");
    /* ---- I-35: the picker: icons, no emoji, buttons >= 44 px ---- */
    await page.evaluate(() => window.BARSPLUS.onBeerAccepted({ beer_count: 4 })); await wait(page, 2000);
    const p = await page.evaluate(() => {
      const bs = [...document.querySelectorAll(".bp-strip .bp-tc")];
      return { n: bs.length, h: bs.map((b) => Math.round(b.getBoundingClientRect().height)), w: bs.map((b) => Math.round(b.getBoundingClientRect().width)),
        ic: bs.map((b) => { const s = b.querySelector("svg"); return s ? Math.round(s.getBoundingClientRect().width) : 0; }),
        emoji: bs.some((b) => /\p{Extended_Pictographic}/u.test(b.textContent)), svgs: new Set(bs.map((b) => b.querySelector("svg") && b.querySelector("svg").innerHTML)).size,
        x: Math.round(document.querySelector(".bp-st-x").getBoundingClientRect().height) };
    });
    ok(p.n === 10 && p.svgs === 10 && !p.emoji, "picker: 10 buttons, 10 different PNI icons, no emoji", p);
    ok(p.h.every((h) => h >= 44) && p.w.every((w) => w >= 44) && p.x >= 44, "picker buttons and close >= 44 px", [p.h, p.w, p.x]);
    ok(p.ic.every((w) => w >= 24), "picker icons >= 24 px", p.ic);
    await page.screenshot({ path: (process.env.TEST_OUT || "/tmp/") + "c4drinks-picker.png" });
    await page.evaluate(() => { const x = document.querySelector(".bp-st-x"); if (x) x.click(); }); await wait(page, 400);
    /* ---- I-26: Sidospår buttons hold the icon with padding ---- */
    await page.evaluate(() => document.getElementById("btn-other").click()); await wait(page, 1500);
    const k = await page.evaluate(() => [...document.querySelectorAll(".kind-btn[data-kind]")].map((b) => {
      const r = b.getBoundingClientRect(), i = b.querySelector(".kb-e svg").getBoundingClientRect(), n = b.querySelector(".kb-n").getBoundingClientRect();
      return { h: Math.round(r.height), top: Math.round(i.top - r.top), bot: Math.round(r.bottom - n.bottom), sz: Math.round(i.height), inside: i.top >= r.top && n.bottom <= r.bottom };
    }));
    ok(k.length === 9 && k.every((b) => b.h >= 64 && b.inside && b.top >= 8 && b.bot >= 6 && b.sz >= 28), "Sidospår: icon + label fit with padding, buttons tall", k[0]);
    await page.screenshot({ path: (process.env.TEST_OUT || "/tmp/") + "c4drinks-sidospar.png" });
    await ctx.close();
  }
  /* ---- I-34: ÅNGRA chip exactly over Annat ---- */
  {
    const { ctx, page } = await open(browser);
    await page.evaluate(() => document.getElementById("btn-beer").click()); await wait(page, 1800);
    const u = await page.evaluate(() => {
      const f = document.querySelector(".undo-fab"), o = document.getElementById("btn-other"); if (!f || !o) return { f: !!f, o: !!o };
      const a = f.getBoundingClientRect(), b = o.getBoundingClientRect(), e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { a: [a.left, a.top, a.width, a.height].map(Math.round), b: [b.left, b.top, b.width, b.height].map(Math.round), top: !!(e && f.contains(e)) };
    });
    ok(u.a && JSON.stringify(u.a) === JSON.stringify(u.b), "undo chip has the same box as Annat", u);
    ok(u.top, "undo chip is the element on top of Annat");
    await page.screenshot({ path: (process.env.TEST_OUT || "/tmp/") + "c4drinks-undo.png" });
    await wait(page, 10500);
    ok(await page.evaluate(() => !document.querySelector(".undo-fab")), "undo chip gone after 10 s (Annat usable again)");
    await ctx.close();
  }
  /* ---- I-44: Swish per user agent ---- */
  for (const [ua, want] of [["android", "intent"], ["ios", "https"], ["desktop", "qr"]]) {
    const { ctx, page } = await open(browser, { ua: ua === "ios" ? "ios" : undefined });
    const r = await page.evaluate((ua) => {
      if (ua === "desktop") Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36" });
      const S = window.RUNDAN._swish, to = { swish: "0701234567", name: "Lisa" };
      const n = S.ctl(to, 170, "PintsNow - Kvällens nota", "btn", "Swisha");
      return { plat: S.platform(), tag: n.tagName, href: n.getAttribute("href"), sw: n.getAttribute("data-sw"), link: n.getAttribute("data-link"), https: S.https(to.swish, 72.5, "x"), https0: S.https(to.swish, 170, "x"),
        gang: window.GANG && window.GANG._swishUrl ? window.GANG._swishUrl(to.swish, 170, "x") : null, qr: !!n.querySelector(".rnd-qr") };
    }, ua);
    console.log(ua, JSON.stringify(r).slice(0, 400));
    const Q = "sw=46701234567&amt=170.0&msg=PintsNow%20-%20K%C3%A4llens%20nota";
    ok(r.https0.indexOf("amt=170.0&") > 0 && r.https.indexOf("amt=72.50&") > 0 && r.https.indexOf("edit=") < 0, "amount always has a decimal point, no edit param", [r.https0, r.https]);
    ok(r.gang && (want === "intent" ? /^intent:\/\/app\.swish\.nu\//.test(r.gang) : /^https:\/\/app\.swish\.nu\/1\/p\/sw\/\?sw=46701234567&amt=170\.0&/.test(r.gang)), "group debts (gang.js) build the same link", r.gang);
    if (want === "intent") {
      ok(r.plat === "android" && r.tag === "A" && r.href === "intent://app.swish.nu/1/p/sw/?" + Q + "#Intent;scheme=https;package=se.bankgirot.swish;S.browser_fallback_url=" +
        encodeURIComponent("https://app.swish.nu/1/p/sw/?" + Q) + ";end", "Android: explicit intent with package + https fallback", r.href);
    } else if (want === "https") {
      ok(r.plat === "ios" && r.tag === "A" && r.href === "https://app.swish.nu/1/p/sw/?" + Q, "iPhone: https link", r.href);
    } else {
      ok(r.plat === "desktop" && r.tag === "DIV" && r.qr && r.link === "https://app.swish.nu/1/p/sw/?" + Q && !r.href, "PC: QR code of the https link, no link", r);
    }
    await ctx.close();
  }
  await browser.close();
  console.log("c4drinks: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
