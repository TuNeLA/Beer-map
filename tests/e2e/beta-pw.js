// 🧪 Betaversion (beta channel) test. Stable app on <port>, beta build (transform.py output, CORS like GitHub Pages) on
// <port+1>, a broken beta build (app.js throws) on <port+2>. Live Supabase: one fresh anonymous user per browser, at 68.35/18.80.
// Nothing is posted (Rapportera fel is caught in the page). usage: node beta-pw.js <port> [chromium|webkit|all]
const pw = require("playwright");
const SP = require("./env.js").OUT;
const PORT = +(process.argv[2] || 8900), WHICH = process.argv[3] || "all";
const BASE = `http://127.0.0.1:${PORT}/`, BETA = `http://127.0.0.1:${PORT + 1}/`, BROKEN = `http://127.0.0.1:${PORT + 2}/`;
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i))); c ? pass++ : fail++; };
const wait = (p, ms) => p.waitForTimeout(ms);

function seed(betaUrl) {
  return `(() => { const S = (k, v) => { try { if (localStorage.getItem(k) == null) localStorage.setItem(k, v); } catch (e) {} };
    S("olnu.name", "Betatest"); S("olnu.age18", "1"); S("olnu.intro", "1"); S("olnu.newsPn", "1"); S("olnu.locOk", "1");
    S("olnu.notifAsked", "1"); S("olnu.notifAskAt", String(Date.now())); S("olnu.guideSeen", String(Date.now())); S("olnu.installSeen", "1");
    S("olnu.flyttAsked", "1"); S("olnu.inst1", String(Date.now())); S("olnu.pnAha", "1"); S("olnu.pnOb", "1"); S("olnu.lang", "sv");
    if (location.port === "${PORT}" || location.port === "${PORT + 1}") S("olnu.betaUrl", "${betaUrl}");
    // Rapportera fel: never reaches the server in this test
    const f = window.fetch; window.__fb = [];
    window.fetch = function (u, o) { if (/rpc\\/submit_feedback/.test(String(u && u.url || u))) { window.__fb.push(o && o.body); return Promise.resolve(new Response("null", { status: 200, headers: { "Content-Type": "application/json" } })); } return f.apply(this, arguments); };
  })();`;
}
const uid = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("olnu.auth")).user.id; } catch (e) { return null; } });
const rec = (page) => page.evaluate(() => caches.open("olnu-pending").then((c) => c.match("./__kanal")).then((r) => r ? r.json() : null));
const betaCode = (page) => page.evaluate(() => ({ pn: window.PN_BETA || null, badge: !!document.getElementById("olnu-beta"), title: document.title, href: location.href }));
async function waitApp(page) {
  await page.waitForFunction(() => document.documentElement.classList.contains("pnds"), null, { timeout: 40000 }).catch(() => console.log("  (app not ready)"));
  await wait(page, 1500);
}
async function closeOverlays(page) {
  // SAFE age check (a fresh live user has age_ok false): answer it once like a user (1990)
  await page.evaluate(() => { const sel = [].find.call(document.querySelectorAll("select"), (x) => x.offsetParent && [].some.call(x.options, (o) => o.value === "1990"));
    if (!sel) return; sel.value = "1990"; sel.dispatchEvent(new Event("change", { bubbles: true })); sel.dispatchEvent(new Event("input", { bubbles: true }));
    setTimeout(() => { const b = [].find.call(document.querySelectorAll("button"), (x) => x.offsetParent && /^Kör!$/.test(x.textContent.trim())); if (b) b.click(); }, 300); });
  await wait(page, 1500);
  await page.evaluate(() => { const i = document.getElementById("intro"); if (i && !i.hidden) { const b = i.querySelector(".intro-later, .btn-ghost"); if (b) b.click(); } });
}
async function openSettings(page) {
  await closeOverlays(page);
  await page.evaluate(() => { const s = document.getElementById("sheet"); if (s && !s.hidden && window.PNDS && window.PNDS._A) window.PNDS._A().closeSheet(); });
  await wait(page, 300);
  await page.evaluate(() => document.getElementById("btn-settings").click());
  await page.waitForSelector("#sheet-body [data-pf=s]", { timeout: 10000 });
  await page.evaluate(() => document.querySelector("#sheet-body [data-pf=s]").click());
  await page.waitForSelector("#sheet-body .pn-kanal", { timeout: 10000 }).catch(() => {});
  await wait(page, 1800);   // ds.js / pnds.js passes
}
async function shotRow(page, name) {
  await page.evaluate(() => { const r = document.querySelector("#sheet-body .pn-kanal"); if (r) r.scrollIntoView({ block: "center" }); });
  await wait(page, 400);
  await page.screenshot({ path: SP + "beta-shots/" + name + ".png" });
}
async function flipAndReload(page) {
  const nav = page.waitForNavigation({ timeout: 20000 }).catch(() => null);
  await page.evaluate(() => document.querySelector("#sheet-body .pn-kanal .switch").click());
  await nav; await waitApp(page);
}

async function run(name, type, ctxOpts) {
  console.log("=== " + name);
  const browser = type === "chromium" ? await pw.chromium.launch({ executablePath: require("./env.js").CHROME }) : await pw[type].launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "sv-SE", hasTouch: true,
    geolocation: { latitude: 68.35, longitude: 18.80 }, permissions: type === "chromium" ? ["geolocation"] : [], serviceWorkers: "allow", ...(ctxOpts || {}) });
  await ctx.addInitScript(seed(BETA));
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const pre = name.replace(/\W+/g, "-");
  await page.goto(BASE); await waitApp(page);
  const swOk = await page.evaluate(() => "serviceWorker" in navigator);
  if (!swOk) { console.log("  no service worker in this browser: skip"); await browser.close(); return; }
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 }).catch(() => {});
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await waitApp(page); }
  ok(name + ": worker controls the page", await page.evaluate(() => !!navigator.serviceWorker.controller));
  await page.evaluate(() => window.PNDS._A().ensureAccount());   // the app makes the anonymous account only when needed
  await page.waitForFunction(() => !!localStorage.getItem("olnu.auth"), null, { timeout: 20000 }).catch(() => {});
  const u0 = await uid(page);
  ok(name + ": fresh anonymous user", !!u0, u0);
  ok(name + ": stable code at start", !(await betaCode(page)).badge);

  // 1. the switch in Inställningar → Om & hjälp
  await openSettings(page);
  const row = await page.evaluate(() => { const r = document.querySelector("#sheet-body .pn-kanal"); if (!r) return null;
    const sec = r.closest("section.ds-section"); const s = r.querySelector(".switch");
    return { sec: sec && sec.getAttribute("data-ds"), text: r.textContent.replace(/\s+/g, " ").trim(), on: s.getAttribute("aria-checked"), icon: !!r.querySelector("svg"), h: r.getBoundingClientRect().height }; });
  ok(name + ": row in Om & hjälp", row && row.sec === "om", row);
  ok(name + ": row text + off", row && /Betaversion/.test(row.text) && /Nya grejer först\. Kan ha buggar\./.test(row.text) && row.on === "false", row);
  ok(name + ": row has an icon, ≥ 44 px", row && row.icon && row.h >= 44, row);
  await shotRow(page, pre + "-1-row-off");

  // 2. on → reload → beta code, same URL, same user
  await flipAndReload(page);
  let bc = await betaCode(page);
  ok(name + ": beta code after the switch", bc.pn === "abc1234" && bc.badge, bc);
  ok(name + ": same address", bc.href.indexOf(BASE) === 0, bc.href);
  ok(name + ": same user id in beta", (await uid(page)) === u0);
  const tag = await page.evaluate(() => { const b = document.getElementById("olnu-beta"); const r = b && b.getBoundingClientRect(); return b ? { t: b.textContent, top: r.top, vis: getComputedStyle(b).display !== "none" } : null; });
  ok(name + ": version tag at the top", tag && /BETA abc1234/.test(tag.t) && tag.top < 40 && tag.vis, tag);
  ok(name + ": beta script came through the launcher", await page.evaluate(() => [].some.call(document.scripts, (s) => /\/beta\.js/.test(s.src) && s.src.indexOf(location.origin) === 0)));
  await wait(page, 2500);
  const r1 = await rec(page);
  ok(name + ": boot ok signal cleared the start mark", r1 && r1.ch === "beta" && !r1.pend && !r1.fails, r1);
  const manifest = await page.evaluate(() => !!document.querySelector('link[rel="manifest"]'));
  ok(name + ": stable manifest link kept", manifest);
  await page.screenshot({ path: SP + "beta-shots/" + pre + "-2-beta-main.png" });
  await openSettings(page);
  const row2 = await page.evaluate(() => { const r = document.querySelector("#sheet-body .pn-kanal"); return r ? { text: r.textContent.replace(/\s+/g, " ").trim(), on: r.querySelector(".switch").getAttribute("aria-checked") } : null; });
  ok(name + ": row on + 'Beta abc1234. Av = vanliga appen'", row2 && row2.on === "true" && /Beta abc1234\. Av = vanliga appen/.test(row2.text), row2);
  await shotRow(page, pre + "-3-row-on");

  // 3. Rapportera fel tagged as beta
  await page.evaluate(() => { window.PNDS._A().closeSheet(); });
  await wait(page, 400);
  await page.evaluate(() => window.PNUI.openBug());
  await page.waitForSelector("#pn-bug", { timeout: 5000 });
  const metaTxt = await page.evaluate(() => document.querySelector(".pn-meta").textContent);
  ok(name + ": bug sheet shows beta", /Version beta abc1234/.test(metaTxt), metaTxt);
  await page.fill("#pn-bug", "Testrapport från betan");
  await page.evaluate(() => document.querySelector("#sheet-body .btn-amber").click());
  await wait(page, 1500);
  const fb = await page.evaluate(() => window.__fb.map((b) => { try { return JSON.parse(b); } catch (e) { return b; } }));
  ok(name + ": feedback text + meta say beta", fb.length === 1 && /^\[beta abc1234\] Testrapport/.test(fb[0].p_text) && /^beta abc1234/.test(fb[0].p_meta.v), fb);

  // 4. off → stable, same user, beta cache gone
  await openSettings(page);
  await flipAndReload(page);
  bc = await betaCode(page);
  ok(name + ": stable after off", !bc.pn && !bc.badge, bc);
  ok(name + ": same user id after off", (await uid(page)) === u0);
  ok(name + ": beta cache deleted", !(await page.evaluate(() => caches.has("olnu-beta"))));

  // 5. ?kanal=stabil forces stable
  await openSettings(page);
  await flipAndReload(page);
  ok(name + ": on again", (await betaCode(page)).badge);
  await page.goto(BASE + "?kanal=stabil"); await waitApp(page);
  bc = await betaCode(page);
  const r2 = await rec(page);
  ok(name + ": ?kanal=stabil → stable code", !bc.badge && r2 && r2.ch === "stable", { bc, r2 });
  ok(name + ": ?kanal=stabil removed from the URL", !/kanal=/.test(await page.evaluate(() => location.href)));
  const t1 = await page.evaluate(() => [].map.call(document.querySelectorAll(".toast"), (t) => t.textContent).join(" | "));
  ok(name + ": toast 'Du kör vanliga versionen.'", /Du kör vanliga versionen\./.test(t1), t1);
  await page.goto(BASE); await waitApp(page);
  ok(name + ": stays stable on the next start", !(await betaCode(page)).badge);

  // 6. safety net: a broken beta build → back to stable by itself + toast
  await page.evaluate((u) => localStorage.setItem("olnu.betaUrl", u), BROKEN);
  await page.reload(); await waitApp(page);
  await openSettings(page);
  const t0 = Date.now();
  await page.evaluate(() => document.querySelector("#sheet-body .pn-kanal .switch").click());
  // the broken page loads (no ok), the worker gives up and reloads it as stable
  await page.waitForFunction(() => !!document.getElementById("olnu-beta"), null, { timeout: 20000, polling: 300 }).catch(() => console.log("  (broken beta never loaded)"));
  console.log("  broken beta loaded after", Math.round((Date.now() - t0) / 1000), "s");
  await page.waitForFunction(() => document.documentElement.classList.contains("pnds") && !document.getElementById("olnu-beta"), null, { timeout: 70000, polling: 1000 }).catch(() => {});
  await page.waitForFunction(() => !!document.body && /Betan kunde inte starta/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  const fellTxt = await page.evaluate(() => [].map.call(document.querySelectorAll(".toast"), (t) => t.textContent).join(" | "));
  const r3 = await rec(page);
  ok(name + ": broken beta → stable again (" + Math.round((Date.now() - t0) / 1000) + " s)", !(await betaCode(page)).badge && r3 && r3.ch === "stable" && !!r3.fell, r3);
  ok(name + ": toast 'Betan kunde inte starta – du kör vanliga versionen'", /Betan kunde inte starta – du kör vanliga versionen/.test(fellTxt), fellTxt);
  ok(name + ": same user id after the safety net", (await uid(page)) === u0);
  await page.screenshot({ path: SP + "beta-shots/" + pre + "-4-fell-toast.png" });
  await page.reload(); await waitApp(page);
  const again = await page.evaluate(() => [].map.call(document.querySelectorAll(".toast"), (t) => t.textContent).join(" | "));
  ok(name + ": fell toast only once", !/Betan kunde inte starta/.test(again), again);
  await page.evaluate(() => localStorage.setItem("olnu.betaUrl", localStorage.getItem("olnu.betaUrl").replace(/:\d+\/$/, (m) => ":" + (+m.slice(1, -1) - 1) + "/")));

  // 7. the direct beta URL (social-b S3): the switch is shown ON, a tap cannot switch (inline note + link to the normal app)
  const p2 = await ctx.newPage();
  await p2.addInitScript((b) => { try { localStorage.setItem("olnu.betaUrl", b); } catch (e) {} }, BETA);
  await p2.goto(BETA); await waitApp(p2);
  const d = await betaCode(p2);
  ok(name + ": direct beta URL works", d.badge && d.pn === "abc1234" && /^BETA/.test(d.title), d);
  await openSettings(p2);
  const dr = await p2.evaluate(async () => { const r = document.querySelector("#sheet-body .pn-kanal"); if (!r) return null; const h0 = location.href;
    r.querySelector(".switch").click(); await new Promise((ok) => setTimeout(ok, 900));
    const i = r.querySelector(".kn-info"); return { on: r.querySelector(".switch").getAttribute("aria-checked"), text: r.textContent, info: !!i && !i.hidden, same: location.href === h0 }; });
  ok(name + ": direct beta: switch shown ON, tap stays beta, note shown", dr && dr.on === "true" && /Testadressen/.test(dr.text) && dr.info && dr.same, dr);
  await p2.close();

  const bad = errs.filter((m) => !/broken beta for the test/.test(m));
  ok(name + ": no page errors", bad.length === 0, bad.slice(0, 5));
  await browser.close();
}

(async () => {
  if (WHICH === "all" || WHICH === "chromium") await run("chromium", "chromium", { isMobile: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36" });
  if (WHICH === "all" || WHICH === "webkit") {
    try { await run("webkit-iphone", "webkit", { ...pw.devices["iPhone 13"], viewport: { width: 390, height: 844 } }); }
    catch (e) { console.log("FAIL webkit run", e.message.split("\n")[0]); fail++; }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
