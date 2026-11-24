// motionfix-pw.js — lane motionfix (24 Nov 2026): the 3 CI reds after the I-135 motion merge (ee069b6).
//  A (popfix-gl E2): a sheet that opens over an open sheet (back stack) gets its ‹ state (#sheet.pn-has-back) in the SAME
//    task as its title. Before: pnui.js synced it after a 30 ms quiet time of the body; a body that fills for a while got its
//    24 px shared-axis slide (pnds.js) late, over content already in view: the body stood 8 px out of the sheet (E2 on CI).
// 390 px, mocked Supabase. Usage: node motionfix-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined || c ? "" : JSON.stringify(x).slice(0, 600)); };

async function open(browser, vp) {
  const { ctx, page } = await ctxFor(browser, vp || { width: 390, height: 844 });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await boot(page);
  await page.waitForFunction(() => window.PN && PN.openSheet && document.getElementById("sheet") && window.SHEETNAV, null, { timeout: 15000 }).catch(() => console.log("no PN.openSheet"));
  await wait(page, 400);
  return { ctx, page, errs };
}

async function partA(browser) {
  for (const vp of [{ width: 390, height: 844 }, { width: 2543, height: 1270 }]) {
    const { ctx, page, errs } = await open(browser, vp);
    const r = await page.evaluate(async () => {
      const s = document.getElementById("sheet"), b = document.getElementById("sheet-body");
      PN.openSheet("Motionfix A", function (body) { body.appendChild(document.createElement("p")).textContent = "first"; }, { now: true });
      await new Promise((res) => setTimeout(res, 600));
      const first = { open: !s.hidden, back: s.classList.contains("pn-has-back") };
      // the second sheet replaces the first one (a level on the back stack); its body keeps filling for 400 ms (a list that
      // comes in row by row): the old 30 ms quiet wait never ended while rows came
      let n = 0; const fill = setInterval(() => { n++; b.appendChild(document.createElement("p")).textContent = "row " + n; }, 5);
      PN.openSheet("Motionfix B", function (body) { body.appendChild(document.createElement("p")).textContent = "second"; }, { now: true });
      await new Promise((res) => setTimeout(res, 0));
      const at0 = { title: document.getElementById("sheet-title").textContent, back: s.classList.contains("pn-has-back"), levels: SHEETNAV._levels(),
        ax: b.getAnimations().filter((a) => /^pn-ax/.test(a.id || "")).map((a) => a.id) };
      await new Promise((res) => setTimeout(res, 450));   // its own slide (300 ms) is over; the rows still come
      clearInterval(fill);
      await new Promise((res) => setTimeout(res, 120));   // the rows stopped: the old code synced the ‹ now and slid the body again
      const sr = s.getBoundingClientRect(), br = b.getBoundingClientRect(), samples = [[Math.round(br.left - sr.left), Math.round(sr.right - br.right)]];
      return { first, at0, samples, lateAx: b.getAnimations().filter((a) => /^pn-ax/.test(a.id || "") && a.playState === "running").length };
    });
    const w = vp.width;
    ok(w + ": A the first sheet opens with no ‹ (nothing to go back to)", r.first.open && !r.first.back, r);
    ok(w + ": A the 2nd sheet has its ‹ in the same task as its title (no wait for the body to stop changing)", r.at0.title === "Motionfix B" && r.at0.back, r.at0);
    ok(w + ": A its shared-axis slide starts with it, at once", r.at0.ax.length === 1 && r.at0.ax[0] === "pn-ax-in", r.at0);
    ok(w + ": A no late slide while the body still fills (the body stays inside the sheet, no 2nd slide running)",
      r.samples.every((x) => x[0] >= 0 && x[1] >= 0) && r.lateAx === 0, r);
    ok(w + ": A no page errors", errs.length === 0, errs.slice(0, 3));
    await ctx.close();
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  try {
    await partA(browser);
  } catch (e) { ok("crash " + (e && e.stack || e), false); }
  await browser.close();
  console.log("motionfix: " + pass + " PASS, " + fail + " FAIL");
  process.exit(fail ? 1 : 0);
})();
