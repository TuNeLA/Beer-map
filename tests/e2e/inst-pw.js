// INST test (owner 2026-11-07 "Boom, boom, boom … it should already be loaded"). Mocked server with SLOW RPCs
// (300–800 ms). Usage: node inst-pw.js <port>
// Asserts on Grupper, Vänner, Inkorg, Grupper tab, group page, Profil, Ikväll? (first session AND returning user):
//   layout-shift sum < 0.01 and no visible element inserted / text changed after the screen showed (+ 400 ms);
// plus: in-place update of a changed value (same element, no shift), "Uppdaterad för N min sedan" for old data,
// a user write makes the cache dirty, prefetch stays small.
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const { routes, GID } = require("./inst-mocks.js");
const { chromium } = require("playwright");
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 700))); c ? pass++ : fail++; };

const INSTR = () => {
  const I = window.__inst = { ls: [], mu: [], t0: 0, tc: 0, on: false };
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (I.on) I.ls.push({ t: Math.round(e.startTime - I.t0), v: e.value }); })).observe({ type: "layout-shift" }); } catch (e) {}
  const desc = (n) => n && n.nodeType === 1 ? n.tagName.toLowerCase() + (n.className && typeof n.className === "string" ? "." + n.className.split(" ").slice(0, 2).join(".") : "") : "#text";
  const vis = (n) => { const e = n.nodeType === 1 ? n : n.parentElement; if (!e || !e.getClientRects().length) return false; const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight; };
  const mo = new MutationObserver((recs) => {
    if (!I.on) return;
    const t = Math.round(performance.now() - I.t0);
    recs.forEach((r) => {
      const tgt = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (!tgt || !tgt.closest || !tgt.closest("#sheet-body")) return;
      if (tgt.closest(".pn-gikv, .tk-track, .toast")) return;   // a rotating chip (design animation), not data
      if (r.type === "characterData") { if (vis(tgt)) I.mu.push({ t, w: "text " + desc(tgt) }); return; }
      const add = [...r.addedNodes].filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()));
      if (!add.length) return;
      const rem = [...r.removedNodes].map((n) => n.textContent).join(""), now = add.map((n) => n.textContent).join("");
      if (add.every((n) => n.nodeType === 3) && rem === now) return;   // the same text written again (no visible change)
      if (add.some(vis)) I.mu.push({ t, w: desc(tgt) + " +" + add.slice(0, 2).map(desc).join(",") });
    });
  });
  const st = () => mo.observe(document.body, { subtree: true, childList: true, characterData: true });
  if (document.body) st(); else document.addEventListener("DOMContentLoaded", st);
  document.addEventListener("click", () => { if (I.on && !I.tc) I.tc = performance.now() - I.t0; }, true);
  I.mark = () => { I.ls = []; I.mu = []; I.t0 = performance.now(); I.tc = 0; I.on = true; };
  I.stop = () => { I.on = false; const T = I.tc + 400; return { cls: I.ls.reduce((s, e) => s + e.v, 0), late: I.mu.filter((m) => m.t > T).map((m) => m.t + " " + m.w) }; };
};
async function tap(page, sel) {
  const b = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  if (!b) return false;
  await page.mouse.move(b.x, b.y); await page.mouse.down(); await wait(page, 90); await page.mouse.up();
  return true;
}
const close = (page) => page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c && !document.getElementById("sheet").hidden) c.click(); });
async function screen(page, P, name, act) {
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  await page.evaluate(() => window.__inst.mark());
  const did = await act();
  await wait(page, 1700);
  const m = await page.evaluate(() => window.__inst.stop());
  ok(P + " " + name + ": opened", did !== false);
  ok(P + " " + name + ": layout shift < 0.01 (" + m.cls.toFixed(4) + ")", m.cls < 0.01, m);
  ok(P + " " + name + ": nothing pops in after it showed", m.late.length === 0, m.late);
}
async function pass_(page, P) {
  await close(page); await wait(page, 400);
  await screen(page, P, "Grupper", () => tap(page, "#btn-groups"));
  await screen(page, P, "Vänner", () => tap(page, '.inv-tabs button[data-t="f"]'));
  await screen(page, P, "Inkorg", () => tap(page, ".inv-tabs .ib-tab"));
  await screen(page, P, "Grupper-fliken", () => tap(page, '.inv-tabs button[data-t="g"]'));
  await screen(page, P, "gruppsidan", () => tap(page, ".glist .gcard"));
  await close(page); await wait(page, 500);
  await screen(page, P, "Profil", () => tap(page, "#btn-settings"));
  await close(page); await wait(page, 500);
  await screen(page, P, "Ikväll?", () => page.evaluate(() => { window.PNUI.openIkvall(); return true; }));
  await close(page); await wait(page, 500);
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 }, { ua: "ios" });
  await ctx.addInitScript(INSTR);
  await ctx.addInitScript(() => { try { localStorage.setItem("olnu.pnEve", "1"); if (!sessionStorage.getItem("inst1")) { sessionStorage.setItem("inst1", "1"); localStorage.setItem("olnu.gtab", "g"); localStorage.setItem("olnu.ibTab", "0"); } } catch (e) {} });
  let active = 3; const calls = [];
  await routes(page, { lat: [300, 800], active: () => active, log: calls });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await boot(page); await wait(page, 4000);
  const st0 = await page.evaluate(() => window.WARM && JSON.parse(JSON.stringify(window.WARM.stats)));
  ok("warm.js loaded", !!st0);
  ok("idle prefetch is small (≤ 25 calls)", st0 && st0.pre <= 25, st0);
  ok("background polls do not make the cache dirty", st0 && st0.dirty === 0, st0 && st0.dirtyBy);

  await pass_(page, "[första gången]");
  await page.reload();
  await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 3, null, { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => window.__map.setView([60.1505, 15.1872], 15, { animate: false }));
  await wait(page, 5000);
  await pass_(page, "[återkommande]");

  // ---- in-place update: a cached list shows at once, the newer value replaces only the text ----
  // (a background poll can refresh my_groups just before the tap: then try again, max 3 times)
  let first, after, m3;
  for (let i = 0; i < 3; i++) {
    const was = active, nw = active + 1;
    await page.evaluate(() => { const m = window.WARM._mem(); Object.keys(m).forEach((k) => { if (/\|my_groups\|/.test(k)) m[k].at = Date.now() - 20000; }); });
    active = nw;
    await page.evaluate(() => window.__inst.mark());
    await tap(page, "#btn-groups"); await wait(page, 200);
    first = await page.evaluate(() => { const c = [...document.querySelectorAll(".glist .gcard")].find((x) => /Ludvika/.test(x.textContent)); if (c) c.__mark = 1; return c ? c.textContent : null; });
    // cifix3: wait for the fresh answer (mock 300-800 ms + load on a shared runner), max 3.5 s, instead of a fixed 1.3 s
    for (let w = 0; w < 14; w++) { await wait(page, 250); if (await page.evaluate((n) => { const c = [...document.querySelectorAll(".glist .gcard")].find((x) => /Ludvika/.test(x.textContent)); return !!c && c.textContent.indexOf(n + " av 5") >= 0; }, nw)) break; }
    after = await page.evaluate(() => { const c = [...document.querySelectorAll(".glist .gcard")].find((x) => /Ludvika/.test(x.textContent)); return c ? { same: !!c.__mark, t: c.textContent } : null; });
    m3 = await page.evaluate(() => window.__inst.stop());
    await close(page); await wait(page, 400);
    if (first && first.indexOf(was + " av 5") >= 0) { first = { ok: true, first, nw }; break; }
  }
  ok("in place: cached list is there at once (old value)", first && first.ok, first);
  ok("in place: new value shown", after && first && after.t.indexOf(first.nw + " av 5") >= 0, after);
  ok("in place: same row element (no list rebuild)", after && after.same, after);
  ok("in place: no layout shift", m3.cls < 0.01, m3);

  // ---- old data → quiet pill, gone when the fresh answer is in ----
  let pill = null;
  for (let i = 0; i < 3 && !pill; i++) {
    await page.evaluate(() => { const m = window.WARM._mem(); Object.keys(m).forEach((k) => { if (/\|my_groups\|/.test(k)) m[k].at = Date.now() - 3.4 * 60e3; }); });
    await page.evaluate(() => { window.__pill = null; const iv = setInterval(() => { const p = document.querySelector("#sheet > .wm-age"); if (p && !p.hidden && !p.classList.contains("wm-age-out")) { window.__pill = p.textContent; clearInterval(iv); } }, 16); setTimeout(() => clearInterval(iv), 1500); });
    await tap(page, "#btn-groups"); await wait(page, 300);
    pill = await page.evaluate(() => window.__pill);
    if (!pill) { await close(page); await wait(page, 1200); }
  }
  ok("old data: 'Uppdaterad för 3 min sedan' shows", pill === "Uppdaterad för 3 min sedan", pill);
  await wait(page, 1500);
  ok("old data: pill gone after the refresh", await page.evaluate(() => { const p = document.querySelector("#sheet > .wm-age"); return !p || p.hidden; }));
  const pillBox = await page.evaluate(() => { const p = document.querySelector("#sheet > .wm-age"); return p ? getComputedStyle(p).position : null; });
  ok("old data: pill takes no layout space (absolute)", pillBox === null || pillBox === "absolute", pillBox);

  // ---- a write by the user makes the cache dirty ----
  await tap(page, ".glist .gcard"); await wait(page, 900);
  await page.fill(".gpg-inp", "Kommer om 10");
  const d0 = await page.evaluate(() => window.WARM.stats.dirty);
  await tap(page, ".gpg-send"); await wait(page, 1200);
  const d1 = await page.evaluate(() => ({ dirty: window.WARM.stats.dirty, g: window.WARM.get("my_groups", {}) }));
  ok("write: post_group_msg makes the cache dirty", d1.dirty > d0, d1);
  ok("write: a dirty read is not served from the cache", d1.g === null, d1.g);
  await close(page);

  // ---- no stale data from another user ----
  const other = await page.evaluate(() => { const a = JSON.parse(localStorage.getItem("olnu.auth")); const u = a.user.id; a.user.id = "ffffffff-0000-0000-0000-000000000000"; localStorage.setItem("olnu.auth", JSON.stringify(a)); localStorage.setItem("__u", u); return true; });
  await wait(page, 5200);
  ok("other user: cache key changes with the user", await page.evaluate(() => window.WARM.get("my_groups", {}) === null));
  await page.evaluate(() => { const a = JSON.parse(localStorage.getItem("olnu.auth")); a.user.id = localStorage.getItem("__u"); localStorage.setItem("olnu.auth", JSON.stringify(a)); });

  ok("no page errors", errs.length === 0, errs);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
