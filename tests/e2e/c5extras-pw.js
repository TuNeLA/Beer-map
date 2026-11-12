// c5extras: I-49 bar photo detail (pinned ✕), I-54 real torch, I-32 ticker min-height, I-31 caption vs bar popup, I-29 versioned dialekt pack.
// Usage: node c5extras-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 300)); };
const G = "11111111-2222-3333-4444-555555555555";

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    args: ["--ignore-certificate-errors", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  try {
    const { ctx, page } = await ctxFor(browser, { width: 360, height: 640 });
    await ctx.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => { const t = document.querySelector('script[src*="js/dialekt.js"]'); if (t) t.setAttribute("src", "./js/dialekt.js?v=abc123"); }); });
    const preq = []; page.on("request", (r) => { if (/dialekt-packs\//.test(r.url())) preq.push(r.url()); });
    await boot(page, { clean: true }); await wait(page, 1500);

    { // I-49: the header with ✕ is pinned, only the body scrolls
      await page.evaluate(() => {
        const long = []; for (let i = 0; i < 40; i++) long.push("x");
        window.BARFOTO._cache[7] = { at: Date.now(), d: { group: [{ key: "k1", at: new Date().toISOString(), is_me: true, can_share: true, by: "Anton", group_name: long.join(" ") }], public: [] } };
        window.BARFOTO._open("k1", 7);
        const sc = document.querySelector(".bf-view .bf-card"); if (sc) sc.style.setProperty("--t", "1");
        const f = document.createElement("div"); f.style.height = "900px"; f.className = "t-fill";
        const acts = document.querySelector(".bf-acts"); if (acts) acts.appendChild(f);
      });
      await wait(page, 300);
      const r = await page.evaluate(() => {
        const q = (s) => document.querySelector(s), box = (e) => e && e.getBoundingClientRect();
        const card = box(q(".bf-card")), x = box(q(".bf-x")), sc = q(".bf-scroll");
        const t0 = x && x.top; if (sc) sc.scrollTop = 500;
        const x2 = box(q(".bf-x"));
        return { card, x, x2, t0, scrolls: !!sc && sc.scrollHeight > sc.clientHeight, st: sc ? sc.scrollTop : -1, vh: innerHeight };
      });
      ok("I-49: card fits the screen", r.card && r.card.top >= 0 && r.card.bottom <= r.vh, r.card);
      ok("I-49: ✕ pinned inside the card top, does not move when the body scrolls", r.x && r.x2 && Math.abs(r.x2.top - r.x.top) < 1 && r.x.top >= r.card.top - 1 && r.x.top < r.card.top + 60, { x: r.x, x2: r.x2 });
      ok("I-49: the body scrolls", r.scrolls && r.st > 0, r);
      await page.evaluate(() => document.querySelector(".bf-view") && document.querySelector(".bf-x").click());
    }

    { // I-54: torch
      const cases = [["torch", true], ["no torch", false]];
      for (const [name, cap] of cases) {
        await page.evaluate((cap) => {
          window.__tc = []; const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
          navigator.mediaDevices.getUserMedia = (c) => gum(c).then((s) => { const t = s.getVideoTracks()[0];
            t.getCapabilities = () => (cap ? { torch: true } : {}); t.applyConstraints = (c2) => { window.__tc.push(JSON.stringify(c2)); return Promise.resolve(); }; return s; });
        }, cap);
        await page.evaluate((G) => window.FILMCAM.open({ id: G, name: "Test" }, { left: 8, max: 10, mine: 2, group_n: 5, group_max: 60, rolls: [] }), G);
        await page.waitForFunction(() => { const v = document.querySelector(".fc-video"); return v && v.videoWidth > 0; }, null, { timeout: 15000 }).catch(() => {});
        await wait(page, 500);
        const vis = await page.evaluate(() => { const b = document.querySelector(".fc-torch"); return !!b && !b.hidden && b.getClientRects().length > 0; });
        if (!cap) { ok("I-54: no torch capability → button hidden", !vis); }
        else {
          ok("I-54: torch capability → button shown", vis);
          await page.evaluate(() => document.querySelector(".fc-torch").click());
          ok("I-54: toggle on (aria-pressed)", await page.evaluate(() => document.querySelector(".fc-torch").getAttribute("aria-pressed") === "true"));
          await page.evaluate(() => { window.__tc.length = 0; document.querySelector(".fc-shutter").disabled = false; document.querySelector(".fc-shutter").click(); });
          await wait(page, 900);
          const tc = await page.evaluate(() => window.__tc);
          ok("I-54: the shot fires the torch on, then off", tc.length >= 2 && /"torch":true/.test(tc[0]) && /"torch":false/.test(tc[tc.length - 1]), tc);
        }
        await page.evaluate(() => { const x = document.querySelector(".fc-x"); if (x) x.click(); });
        await wait(page, 300);
      }
    }

    { // I-32: ticker box does not change when the first item arrives
      const r = await page.evaluate(() => {
        const t = document.querySelector(".ticker"), v = document.querySelector(".ticker .tk-viewport"), tr = document.getElementById("ticker-track");
        const prev = tr.innerHTML; tr.innerHTML = ""; const a = [t.getBoundingClientRect().height, v.getBoundingClientRect().height];
        const s = document.createElement("span"); s.className = "tk-item"; s.textContent = "Test item"; tr.appendChild(s);
        const b = [t.getBoundingClientRect().height, v.getBoundingClientRect().height]; tr.innerHTML = prev;
        return { a, b, minH: getComputedStyle(v).minHeight };
      });
      ok("I-32: .tk-viewport has a fixed min-height from the first paint", parseFloat(r.minH) >= 30, r);
      ok("I-32: ticker and viewport height unchanged by the first item", r.a[0] === r.b[0] && r.a[1] === r.b[1] && r.a[1] >= 30, r);
    }

    { // I-31: no caption while a bar popup is open
      const r = await page.evaluate(async () => {
        document.body.classList.add("barsheet-open");
        window.DELIGHT.caption({ text: "Test caption", now: true, ms: 3000 });
        await new Promise((res) => setTimeout(res, 300));
        const b = document.getElementById("dl-cap"), shown = !!b && !b.hidden && getComputedStyle(b).display !== "none";
        document.body.classList.remove("barsheet-open");
        return { shown, exists: !!b };
      });
      ok("I-31: caption is not visible while a bar popup is open", r.shown === false, r);
      const r2 = await page.evaluate(async () => {
        window.DELIGHT.caption({ text: "Test caption 2", now: true, ms: 3000 });
        await new Promise((res) => setTimeout(res, 300));
        const b = document.getElementById("dl-cap"); return { shown: !!b && !b.hidden && getComputedStyle(b).display !== "none" };
      });
      ok("I-31: caption shows normally when no popup is open", r2.shown === true, r2);
    }

    { // I-29: pack request carries the stamp of dialekt.js's own tag
      await wait(page, 3500);
      console.log("pack requests", JSON.stringify(preq));
      ok("I-29: every pack request carries ?v= (PN.load / stamped src)", preq.length > 0 && preq.every((u) => /\?v=abc123/.test(u)), preq);
    }
  } catch (e) { fail++; console.log("FAIL exception", e && e.stack || e); }
  await browser.close();
  console.log("c5extras: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
