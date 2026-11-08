// 🔔 ntf v2 Playwright test (mocked Supabase, 390x844). Usage: node ntf-pw.js <port>
// A) settings v2: Färre notiser + 5 rows + Mer, row → several kinds, auto-muted hint, set_push_mode.
// B) priming card after "pn:group-joined" (permission "default"), "Inte nu" snoozes.
// C) in-app feed card (my_ntf_feed) with the rows and "Slå på notiser".
// D) push tap while the app is open: ?ikvall=1&st=ute answers + opens Ikväll?, ?hemfard=1 opens Hemfärd.
// E) log drain: the service worker queue → PNLOG.event push.open/push.action + push_seen().
// G) ux: live counter, 'Av' when push is off. H) ux: the ask is calm (not over ÖL!).
// F) the REAL sw.js push + notificationclick handlers, run inside the service worker with hand-made events → fold of one night,
//    the button deep link reaches the open page (postMessage) and answers Ikväll?.
const H0 = require("./d2-helpers.js"), { boot, wait } = H0;
// a busy CI box: long navigation timeouts (the default 30 s fails under load)
const ctxFor = async (...a) => { const r = await H0.ctxFor(...a); r.ctx.setDefaultNavigationTimeout(90000); r.ctx.setDefaultTimeout(30000); return r; };
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8871, BASE = `http://127.0.0.1:${PORT}/`;
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const T0 = Date.now(); let SEC = "";
const ok = (n, c, i) => { const sec = (n.match(/^(\w+):/) || [])[1] || ""; if (sec !== SEC) { SEC = sec; console.log("time", sec, Math.round((Date.now() - T0) / 1000) + "s"); }
  console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 300))); c ? pass++ : fail++; };
const PREFS = { v: 1, off: [], quiet_from: null, quiet_to: null, cap: 0, cap_default: 15, tonight: 2, mode: "normal", auto_muted: ["kaos"], v2: true,
  cats: ["ute", "chat", "dm", "plan", "kaos", "bar", "kul", "vanner", "film", "ikvall", "gang"] };
const FEED = { v: 1, items: [
  { id: 1, kind: "ikvall", title: "Bosse och Cecilia ska ut ikväll", body: "Hänger du med? Svara så ser gänget.", url: "/?ikvall=1", why: "nosub", at: new Date().toISOString(), seen: false },
  { id: 2, kind: "film", title: "Gårdagens film är framkallad 📸", body: "23 bilder från Gänget.", url: "/?film=g1", why: "cap", at: new Date(Date.now() - 3600e3).toISOString(), seen: false }] };
async function extra(ctx, page, log, o = {}) {
  const h = (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    log.push([fn, body]);
    if (fn === "my_push_prefs") return J(r, o.prefs || PREFS);
    if (fn === "set_push_prefs") return J(r, { ...PREFS, off: body.p_off, cap: body.p_cap });
    if (fn === "set_push_mode") return J(r, { ...PREFS, mode: body.p_mode, auto_muted: [] });
    if (fn === "my_ntf_feed") return J(r, FEED);
    if (fn === "ntf_feed_seen") return J(r, { ok: true, n: 2 });
    if (fn === "push_seen") return J(r, { ok: true, n: (body.p_items || []).length });
    if (fn === "ikvall_set") return J(r, { ok: true, st: body.p_st });
    return r.fallback();
  };
  const re = /rest\/v1\/rpc\/(my_push_prefs|set_push_prefs|set_push_mode|my_ntf_feed|ntf_feed_seen|push_seen|ikvall_set)\b/;
  await page.route(re, h);
  await ctx.route(re, h);   // also requests that pass through the service worker
}
async function openSettings(page) {
  await page.waitForSelector("#btn-settings", { timeout: 60000 }).catch(() => {});
  await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 1500);
  await page.evaluate(() => { const t = [...document.querySelectorAll(".pf-tabs button, .tabs button")].find((b) => /Inställningar/.test(b.textContent)); if (t) t.click(); });
  await wait(page, 1200);
  await page.waitForSelector(".push-prefs:not([hidden]) .switch", { timeout: 45000 }).catch(() => {});
  await page.evaluate(() => { const r = document.querySelector(".pn-fold-row"); if (r && r.getAttribute("aria-expanded") !== "true") r.click(); }); await wait(page, 400);
}
const sheetTitle = (page) => page.evaluate(() => { const s = document.getElementById("sheet"); return s && !s.hidden ? (document.getElementById("sheet-title") || {}).textContent || "" : ""; });
(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });
  const vp = { width: 390, height: 844 };
  try {
    { // A) settings v2
      const log = []; const { ctx, page } = await ctxFor(browser, vp); await extra(ctx, page, log);
      await boot(page); await openSettings(page);
      const top = await page.evaluate(() => [...document.querySelectorAll(".push-prefs > .toggle-row .switch")].map((s) => s.getAttribute("data-kind") || s.getAttribute("data-pref")));
      ok("A: Färre notiser + 5 rows (Vänner ute, Ikväll?, Bilder, Event, Gänget)", JSON.stringify(top) === '["farre","ute","ikvall","film","plan","gang"]', top);
      const more = await page.evaluate(() => [...document.querySelectorAll(".push-prefs details .switch")].map((s) => s.getAttribute("data-kind")));
      ok("A: Mer has Meddelanden, Vänförfrågningar, Kaos", JSON.stringify(more) === '["chat","vanner","kaos"]', more);
      ok("A: social rows on by default", await page.evaluate(() => ["ute", "ikvall", "film", "plan", "gang"].every((k) => document.querySelector('.push-prefs .switch[data-kind="' + k + '"]').getAttribute("aria-checked") === "true")));
      ok("A: auto-muted kaos shows 'Pausad' and is off", await page.evaluate(() => { const s = document.querySelector('.push-prefs .switch[data-kind="kaos"]');
        return s.getAttribute("aria-checked") === "false" && /Pausad/.test(s.closest(".toggle-row").textContent); }));
      await page.evaluate(() => document.querySelector('.push-prefs .switch[data-kind="gang"]').click()); await wait(page, 500);
      let last = log.filter((x) => x[0] === "set_push_prefs").pop();
      ok("A: Gänget off → p_off gang + kul + bar", last && JSON.stringify([...last[1].p_off].sort()) === '["bar","gang","kul"]', last);
      await page.evaluate(() => document.querySelector('.push-prefs .switch[data-pref="farre"]').click()); await wait(page, 500);
      last = log.filter((x) => x[0] === "set_push_mode").pop();
      ok("A: Färre notiser → set_push_mode farre", last && last[1].p_mode === "farre", last);
      await page.evaluate(() => document.querySelector('.push-prefs .switch[data-kind="kaos"]').click()); await wait(page, 1200);
      ok("A: kaos on again → hint gone + set_push_mode clears the auto-mute", await page.evaluate(() => !/Pausad/.test(document.querySelector('.push-prefs .switch[data-kind="kaos"]').closest(".toggle-row").textContent))
        && log.filter((x) => x[0] === "set_push_mode").length >= 2, log.map((x) => x[0]));
      ok("A: no horizontal scroll", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.evaluate(() => document.querySelector('.push-prefs .switch[data-pref="farre"]').click()); await wait(page, 300);
      await page.evaluate(() => { const d = document.querySelector(".push-prefs details"); if (d) d.open = true; document.querySelector(".push-prefs").scrollIntoView({ block: "start" }); }); await wait(page, 400);
      await page.screenshot({ path: SP + "ntf-settings.png" });
      await ctx.close();
    }
    { // B) priming + C) feed card
      const log = []; const { ctx, page } = await ctxFor(browser, vp);
      await ctx.addInitScript(() => { try { Object.defineProperty(Notification, "permission", { get: () => "default" }); } catch (e) {} try { localStorage.removeItem("olnu.pushPrime"); } catch (e) {} });
      await extra(ctx, page, log); await boot(page);
      const hasRpc = await page.evaluate(() => !!window.PUSH && typeof window.PUSH.prime === "function");
      ok("B: PUSH.prime exists", hasRpc);
      await page.evaluate(() => { window.PUSH.drainLog(); document.dispatchEvent(new CustomEvent("pn:group-joined", { detail: { name: "Gänget" } })); });
      await wait(page, 1800);
      const t = await page.evaluate(() => { const b = document.querySelector(".pn-prime"); return b ? b.textContent : ""; });
      ok("B: priming card after the first group join, with a one-line value", /Vet när Gänget drar ut/.test(t) && /Max 4 notiser per kväll/.test(t), t);
      ok("B: buttons ≥ 44 px", await page.evaluate(() => [...document.querySelectorAll(".pn-prime button")].every((b) => b.getBoundingClientRect().height >= 44)));
      await page.screenshot({ path: SP + "ntf-prime.png" });
      await page.evaluate(() => document.querySelector('.pn-prime [data-prime="no"]').click()); await wait(page, 300);
      const st = await page.evaluate(() => JSON.parse(localStorage.getItem("olnu.pushPrime") || "{}"));
      ok("B: 'Inte nu' closes and snoozes 7 days", !(await page.$(".pn-prime")) && st.n === 1 && st.until > Date.now() + 6 * 864e5, st);
      await page.evaluate(() => document.dispatchEvent(new CustomEvent("pn:group-joined", { detail: { name: "X" } }))); await wait(page, 1600);
      ok("B: no second ask while snoozed", !(await page.$(".pn-prime")));
      // C) feed card
      await page.evaluate(() => { const d = document.createElement("div"); d.id = "feedhost"; d.style.cssText = "position:fixed;left:12px;right:12px;bottom:90px;z-index:1300;background:#222e48;border-radius:16px;padding:12px";
        document.body.appendChild(d); return window.PUSH.feedCard(d); });
      await wait(page, 800);
      const rows = await page.evaluate(() => [...document.querySelectorAll("#feedhost .pn-feed-r .pn-feed-tt")].map((x) => x.textContent));
      ok("C: feed card lists what push did not deliver", rows.length === 2 && /ska ut ikväll/.test(rows[0]), rows);
      ok("C: 'Slå på notiser' offered (nosub, permission default)", !!(await page.$("#feedhost .pn-feed-on")));
      ok("C: ntf_feed_seen called", log.some((x) => x[0] === "ntf_feed_seen"));
      await page.screenshot({ path: SP + "ntf-feed.png" });
      log.length = 0;
      await page.evaluate(() => document.querySelector("#feedhost .pn-feed-r").click()); await wait(page, 1500);
      ok("C: tapping a feed row opens the exact sheet (Ikväll?)", /Ikväll/.test(await sheetTitle(page)), await sheetTitle(page));
      await ctx.close();
    }
    { // D) deep links while open + E) log drain
      const log = []; const { ctx, page } = await ctxFor(browser, vp); await extra(ctx, page, log);
      await boot(page);
      // push.js needs the app's rpc: resync() runs on authed (PUSH_ON). Make sure it has one.
      const hasR = await page.evaluate(() => new Promise((res) => setTimeout(() => res(true), 300)));
      await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "olnu-open", url: location.origin + "/?ikvall=1&st=ute" } })));
      await wait(page, 2200);
      const iv = log.filter((x) => x[0] === "ikvall_set").pop();
      ok("D: '🍺 Jag kommer' on Ikväll? → ikvall_set('ute')", hasR && iv && iv[1].p_st === "ute", log.map((x) => x[0]));
      ok("D: … and the Ikväll? sheet opens", /Ikväll/.test(await sheetTitle(page)), await sheetTitle(page));
      await page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); }); await wait(page, 600);
      await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "olnu-open", url: location.origin + "/?hemfard=1" } })));
      await wait(page, 1500);
      ok("D: ⏰ stänger push while open → Hemfärd sheet", /Hemfärd/.test(await sheetTitle(page)), await sheetTitle(page));
      await page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); }); await wait(page, 400);
      // E) the queue the service worker writes
      log.length = 0;
      await page.evaluate(() => { window.__pnl = []; const P = window.PNLOG; if (P) { const o = P.event; P.event = function (n, p) { window.__pnl.push([n, p]); return o.apply(this, arguments); }; } });
      await page.evaluate(() => caches.open("olnu-pending").then((c) => c.put("./__pnq", new Response(JSON.stringify([
        { n: "push.shown", k: "ute", v: "fo.2", a: "", h: 21, t: 1 }, { n: "push.open", k: "ute", v: "fo.2", a: "", h: 21, t: 2 },
        { n: "push.action", k: "ikvall", v: "ik.1", a: "ute", h: 18, t: 3 }])))));
      await page.evaluate(() => new Promise((r) => setTimeout(r, 1600))).then(() => page.evaluate(() => window.PUSH.drainLog()));
      await wait(page, 800);
      const seen = log.filter((x) => x[0] === "push_seen").pop();
      ok("E: push_seen gets open + action (not shown) with kind + hour", seen && JSON.stringify(seen[1].p_items) === '[{"e":"open","k":"ute","h":21},{"e":"action","k":"ikvall","h":18}]', seen);
      const pn = await page.evaluate(() => window.__pnl || []);
      ok("E: PNLOG events push.shown / push.open / push.action with k + v", ["push.shown", "push.open", "push.action"].every((n) => pn.some((x) => x[0] === n && x[1].k && x[1].v)), pn);
      ok("E: queue emptied", await page.evaluate(() => caches.open("olnu-pending").then((c) => c.match("./__pnq")).then((r) => r.text()).then((t) => t === "[]")));
      await ctx.close();
    }
    { // F) real sw.js: push + notificationclick handlers run inside the service worker (events built by hand, so no OS
      //    notification server is needed: CI headless has none and showNotification can hang there).
      const log = []; const { ctx, page } = await ctxFor(browser, vp); await extra(ctx, page, log);
      await boot(page);
      await page.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 15000))]).then(() => true));
      for (let i = 0; i < 30 && !ctx.serviceWorkers().length; i++) await wait(page, 500);
      const sw = ctx.serviceWorkers()[0];
      ok("F: service worker running", !!sw);
      if (sw) {
        const r = await Promise.race([sw.evaluate(async () => {
          const shown = [];
          // record notifications instead of asking the OS (same API the handlers use)
          self.registration.showNotification = (title, opts) => { const i = shown.findIndex((n) => n.tag === opts.tag);
            const n = { title, ...opts, close() {} }; if (i >= 0) shown[i] = n; else shown.push(n); return Promise.resolve(); };
          self.registration.getNotifications = (o) => Promise.resolve(shown.filter((n) => !o || !o.tag || n.tag === o.tag));
          const fire = (type, props) => new Promise((res) => {
            const w = [], ev = new Event(type);
            Object.defineProperty(ev, "waitUntil", { value: (p) => { w.push(Promise.resolve(p).catch(() => {})); } });
            for (const k in props) Object.defineProperty(ev, k, { value: props[k] });
            self.dispatchEvent(ev);
            Promise.race([Promise.all(w), new Promise((t) => setTimeout(t, 8000))]).then(res);
          });
          const push = (d) => fire("push", { data: { json: () => d, text: () => JSON.stringify(d) } });
          const P = (n, b, id) => ({ title: n + " på " + b + " 🍺", body: "Sedan 21:04.", url: "/?focus=" + id, tag: "olnu-" + id + "-f1", k: "ute", v: "fo.1",
            fold: { key: "ute-2026-11-07", title: "{n} vänner ute ikväll 🍻", line: n + " · " + b }, actions: [{ action: "coming", title: "🏃 Jag kommer", url: "/?focus=" + id + "&act=coming" }] });
          await push(P("Lisa", "Pitchers", 71)); await push(P("Oskar", "Tegera", 72));
          const fold = shown.filter((n) => n.tag === "olnu-fold-ute-2026-11-07").map((n) => ({ t: n.title, b: n.body, u: n.data && n.data.url }));
          await push({ title: "Bosse och Cecilia ska ut ikväll", body: "x", url: "/?ikvall=1", tag: "olnu-ikvall-t", k: "ikvall", v: "ik.1",
            actions: [{ action: "ute", title: "🍺 Jag kommer", url: "/?ikvall=1&st=ute" }, { action: "kanske", title: "🤔 Kanske", url: "/?ikvall=1&st=kanske" }] });
          const ik = shown.find((n) => n.tag === "olnu-ikvall-t");
          if (ik) await fire("notificationclick", { notification: ik, action: "ute" });
          const q = await caches.open("olnu-pending").then((c) => c.match("./__pnq")).then((x) => x ? x.text() : "[]");
          return { fold, clicked: !!ik, acts: ik ? ik.actions.map((a) => a.title) : [], q: JSON.parse(q) };
        }), new Promise((res) => setTimeout(() => res({ err: "sw.evaluate timeout 60 s" }), 60000))]).catch((e) => ({ err: e.message }));
        ok("F: two friends in one night = ONE notice '2 vänner ute ikväll 🍻'", r.fold && r.fold.length === 1 && r.fold[0].t === "2 vänner ute ikväll 🍻" && r.fold[0].u === "/", r);
        ok("F: Ikväll? shows the buttons 🍺 Jag kommer / 🤔 Kanske", JSON.stringify(r.acts) === '["🍺 Jag kommer","🤔 Kanske"]', r.acts);
        ok("F: SW queued push.shown + push.action", r.q && r.q.some((x) => x.n === "push.shown") && r.q.some((x) => x.n === "push.action" && x.a === "ute"), r.q);
        for (let i = 0; i < 16 && !log.some((x) => x[0] === "ikvall_set"); i++) await wait(page, 500);
        const iv = log.filter((x) => x[0] === "ikvall_set").pop();
        ok("F: notificationclick 'ute' → the open page answers Ikväll? (ikvall_set ute)", r.clicked && iv && iv[1].p_st === "ute", log.map((x) => x[0]));
        await wait(page, 800);
        ok("F: … and shows the Ikväll? sheet", /Ikväll/.test(await sheetTitle(page)), await sheetTitle(page));
      }
      await ctx.close();
    }
    { // G) ux review: the "Välj notiser" counter is live, and "Av" when push is off
      const log = []; const { ctx, page } = await ctxFor(browser, vp); await extra(ctx, page, log);
      await boot(page); await openSettings(page); await wait(page, 600);
      const off = await page.evaluate(() => (document.querySelector(".pn-fold-n") || {}).textContent || "");
      ok("G: push off (no subscription) → counter says 'Av'", off === "Av", off);
      await ctx.close();
    }
    {
      const log = []; const { ctx, page } = await ctxFor(browser, vp);
      await ctx.addInitScript(() => { try { Object.defineProperty(Notification, "permission", { get: () => "granted" }); } catch (e) {}
        try { PushManager.prototype.getSubscription = function () { return Promise.resolve({ endpoint: "https://push.invalid/x", getKey: function () { return null; }, toJSON: function () { return { keys: {} }; } }); }; } catch (e) {} });
      await extra(ctx, page, log); await boot(page); await openSettings(page); await wait(page, 600);
      const a = await page.evaluate(() => (document.querySelector(".pn-fold-n") || {}).textContent || "");
      ok("G: push on → '7 av 8 på' (kaos auto-paused)", a === "7 av 8 på", a);
      await page.evaluate(() => document.querySelector('.push-prefs .switch[data-kind="gang"]').click()); await wait(page, 700);
      const b = await page.evaluate(() => (document.querySelector(".pn-fold-n") || {}).textContent || "");
      ok("G: one switched off → counter updates to '6 av 8 på'", b === "6 av 8 på", b);
      await page.screenshot({ path: SP + "ntf-settings-count.png" });
      await ctx.close();
    }
    { // G2) iPhone Safari (no web push): the counter explains why
      const log = []; const { ctx, page } = await ctxFor(browser, vp);
      await ctx.addInitScript(() => { Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1" }); });
      await extra(ctx, page, log); await boot(page); await openSettings(page); await wait(page, 600);
      const t = await page.evaluate(() => (document.querySelector(".pn-fold-n") || {}).textContent || "");
      ok("G2: iPhone Safari → 'Av – kräver att appen läggs på hemskärmen'", /^Av – kräver att appen läggs på hemskärmen$/.test(t), t);
      await ctx.close();
    }
    { // H) ux review: no ask over the ÖL! confirmation; the calm card is at the top, not over the ÖL! button
      const log = []; const { ctx, page } = await ctxFor(browser, vp);
      await ctx.addInitScript(() => { try { Object.defineProperty(Notification, "permission", { get: () => "default" }); } catch (e) {} try { localStorage.setItem("olnu.notifAskAt", String(Date.now())); } catch (e) {} });
      await extra(ctx, page, log); await boot(page);
      await page.evaluate(() => window.PUSH.prime({ force: true, group: "Gänget" })); await wait(page, 300);
      const ov = await page.evaluate(() => { const c = document.querySelector(".pn-prime"), b = document.getElementById("btn-beer"); if (!c || !b) return null;
        const r1 = c.getBoundingClientRect(), r2 = b.getBoundingClientRect(); return r1.bottom <= r2.top || r1.top >= r2.bottom; });
      ok("H: the ask card never covers the ÖL! button", ov === true, ov);
      const src = await page.evaluate(() => fetch("app.js").then((r) => r.text()));
      ok("H: no notification ask on a beer tap (no sheet 2.2 s after ÖL!)", /no notification ask on a beer tap/.test(src) && !/askNotifSheet\(\); \}, 2200\)/.test(src));
      const ui = await page.evaluate(() => fetch("js/pnui.js").then((r) => r.text()));
      ok("H: install card never on the first beer, guarded by one prompt per session", /if \(first\) \{ lsSet\("olnu.pnBeer1N"/.test(ui) && /PNPROMPT/.test(ui));
      ok("H: one prompt per session: after the ask card, PNPROMPT.can() is false", await page.evaluate(() => !!window.PNPROMPT && window.PNPROMPT.can() === false));
      await ctx.close();
    }
  } catch (e) { console.log("FAIL exception", e.message); fail++; }
  await browser.close();
  console.log(`\n${pass} PASS, ${fail} FAIL (${Math.round((Date.now() - T0) / 1000)} s)`);
  process.exit(fail ? 1 : 0);
})();
