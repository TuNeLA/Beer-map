// misc lane (mocked server): X4 Radera kontot with 7 days to undo · F4 Grundare badge · X5 block the photographer of a
// film photo + MISC.reportMenu · F3 film photo reports in the owner queue (stats.html) + the founders cutoff panel.
// Usage: node misc-pw.js <port>. Each part FAILS on 10dbb7a (no window.MISC, no film rows in the owner panel).
const { ctxFor, boot, wait } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8793, BASE = `http://127.0.0.1:${PORT}/`;
const G = "11111111-2222-3333-4444-555555555555";
const NIGHT = "2026-11-08T04:00:00.000Z";
const J = (r, b, st) => r.fulfill({ status: st || 200, contentType: "application/json", body: JSON.stringify(b) });
const MISSING = { code: "PGRST202", message: "Could not find the function public.my_account_deletion without parameters in the schema cache", details: null, hint: null };
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c || i === undefined ? "" : JSON.stringify(i).slice(0, 300)); c ? pass++ : fail++; };
const shot = (page, n) => page.screenshot({ path: SP + "misc-" + n + ".png" }).then(() => console.log("shot " + SP + "misc-" + n + ".png"));
const iso = (d) => new Date(Date.now() + d * 86400e3).toISOString();

// server state for one page: deletion (0402), founders (0401), film (0400)
async function server(page, st, calls) {
  await page.route(/rest\/v1\/rpc\/(my_account_deletion|request_account_deletion|cancel_account_deletion|my_founder|film_block|delete_my_data_v2)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    calls.push([fn, b]);
    if (st.old && /account_deletion/.test(fn)) return J(r, MISSING, 404);
    const dj = () => st.pending ? { v: 1, pending: true, requested_at: iso(st.days - 7), due_at: iso(st.days), days_left: st.days, now: iso(0) } : { v: 1, pending: false, now: iso(0) };
    switch (fn) {
      case "my_account_deletion": return J(r, dj());
      case "request_account_deletion": st.pending = true; st.days = 7; return J(r, dj());
      case "cancel_account_deletion": { const was = st.pending; st.pending = false; return J(r, Object.assign(dj(), { cancelled: was })); }
      case "my_founder": return J(r, Object.assign({ v: 1, founder: true, premium: true, final: true, cutoff: iso(-1), since: iso(-20) }, st.founder || {}));
      case "film_block": return J(r, { ok: true, on: true, name: "Lisa", id: "0123456789abcdef" });
      case "delete_my_data_v2": return J(r, { ok: true, v: 2, deleted_rows: 1, anonymised_rows: 0, auth_deleted: true, left: [], errors: [] });
    }
    return r.fallback();
  });
}
const sheet = (page) => page.evaluate(() => {
  const s = document.getElementById("sheet"), b = document.getElementById("sheet-body"), vis = (e) => !!e && e.getClientRects().length > 0;
  const btns = [...b.querySelectorAll("button")].filter(vis).map((x) => { const r = x.getBoundingClientRect(); const cs = getComputedStyle(x); return { t: x.textContent.trim(), h: Math.round(r.height), w: Math.round(r.width), c: x.className, css: cs.minHeight + '/' + cs.height + '/' + cs.maxHeight + '/' + cs.boxSizing }; });
  return { open: !s.hidden, title: document.getElementById("sheet-title").textContent, text: b.textContent, btns, sw: document.documentElement.scrollWidth, iw: innerWidth,
    mm: !!b.querySelector(".mm-del"), state: (b.querySelector(".mm-del-state") || {}).textContent || "" };
});
const tap = (page, sel, re) => page.evaluate(([s, r]) => { const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length && new RegExp(r).test(x.textContent)); if (e) e.click(); return e ? e.textContent.trim() : null; }, [sel, re]);

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  const errs = [];
  try {
    // ---------- X4: Inställningar → Radera mitt konto → confirm → 7 days → Ångra (360 / 390 / 430) ----------
    for (const w of [360, 390, 430]) {
      const { ctx, page } = await ctxFor(browser, { width: w, height: 844 });
      page.on("pageerror", (e) => errs.push("x4:" + e.message));
      const dialogs = []; page.on("dialog", (d) => { dialogs.push(d.type()); d.dismiss().catch(() => {}); });
      const st = { pending: false }, calls = [];
      await server(page, st, calls);
      await boot(page);
      await page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));
      await page.evaluate(() => document.getElementById("btn-settings").click()); await wait(page, 1200);
      // the ⚙️ button opens Profil; Inställningar is its 2nd tab (pnui / ds20)
      await tap(page, "#sheet button, #sheet [role=tab]", "^Inställningar$"); await wait(page, 900);
      await page.evaluate(() => { const e = [...document.querySelectorAll("#sheet button, #sheet [role=button]")].find((x) => /Radera mitt konto/.test(x.textContent)); if (e) e.scrollIntoView({ block: "center" }); });
      await wait(page, 300);
      const hit = await tap(page, "#sheet button, #sheet [role=button]", "Radera mitt konto");
      await wait(page, 900);
      let s = await sheet(page);
      ok(`[${w}] X4 Inställningar 'Radera mitt konto' (${hit ? "found" : "missing"}) opens 'Radera kontot' with the 7-day text`, !!hit && s.open && s.title === "Radera kontot" && s.mm && /om 7 dagar/.test(s.text), { title: s.title, mm: s.mm });
      ok(`[${w}] X4 first view: one danger button, no amber, text link 'Radera direkt', no sideways scroll`,
        s.btns.filter((b) => /btn-danger/.test(b.c)).length === 1 && !s.btns.some((b) => /btn-amber/.test(b.c)) && s.btns.some((b) => /Radera direkt/.test(b.t)) && s.sw <= s.iw, s.btns);
      await shot(page, "delete-1-" + w);
      await tap(page, "#sheet-body .mm-del-go", "Radera kontot"); await wait(page, 300);
      s = await sheet(page);
      const two = s.btns.filter((b) => /mm-del-(no|yes)\b/.test(b.c));
      ok(`[${w}] X4 confirm step: 'Säker?' + Avbryt / Ja, radera side by side, same width, ≥ 44 px`, /Säker\?/.test(s.text) && two.length === 2 && Math.abs(two[0].w - two[1].w) <= 1 && two.every((b) => b.h >= 44), two);
      await shot(page, "delete-2-confirm-" + w);
      ok(`[${w}] X4 nothing sent before 'Ja, radera'`, !calls.some((c) => /request_account_deletion|delete_my_data/.test(c[0])), calls.map((c) => c[0]));
      await tap(page, "#sheet-body .mm-del-yes", "Ja, radera"); await wait(page, 900);
      s = await sheet(page);
      ok(`[${w}] X4 'Ja, radera' → request_account_deletion; sheet shows 'Kontot raderas om 7 dagar' + one amber 'Ångra'`,
        calls.some((c) => c[0] === "request_account_deletion") && /Kontot raderas om 7 dagar/.test(s.state) && s.btns.filter((b) => /btn-amber/.test(b.c)).length === 1 && /Ångra/.test(s.text), s);
      ok(`[${w}] X4 no instant delete (delete_my_data_v2 not called)`, !calls.some((c) => c[0] === "delete_my_data_v2"));
      await shot(page, "delete-3-pending-" + w);
      await tap(page, "#sheet-body .mm-del-undo", "Ångra"); await wait(page, 900);
      s = await sheet(page);
      ok(`[${w}] X4 'Ångra' → cancel_account_deletion; back to the first view`, calls.some((c) => c[0] === "cancel_account_deletion") && s.mm && !s.state && /Radera kontot/.test(s.text), s.text.slice(0, 120));
      ok(`[${w}] X4 no browser dialogs`, dialogs.length === 0, dialogs);
      await ctx.close();
    }
    // ---------- X4: reminder toast in the 7 days + the row API ----------
    {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
      page.on("pageerror", (e) => errs.push("x4b:" + e.message));
      await page.addInitScript(() => {
        window.__toasts = [];
        const go = () => new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains("toast")) window.__toasts.push(n.textContent); })))
          .observe(document.getElementById("toasts"), { childList: true });
        if (document.getElementById("toasts")) go(); else document.addEventListener("DOMContentLoaded", go);
      });
      const st = { pending: true, days: 3 }, calls = [];
      await server(page, st, calls);
      await boot(page);
      const got = await page.waitForFunction(() => window.__toasts.some((t) => /Ditt konto raderas om 3 dagar/.test(t)), null, { timeout: 8000 }).then(() => true, () => false);
      ok("X4 boot in the 7 days: toast 'Ditt konto raderas om 3 dagar.' with Ångra", got && await page.evaluate(() => !!document.querySelector("#toasts .mm-del-toast button")), await page.evaluate(() => window.__toasts));
      await shot(page, "delete-toast-390");
      await page.evaluate(() => { const b = document.querySelector("#toasts .mm-del-toast button"); if (b) b.click(); }); await wait(page, 800);
      ok("X4 toast Ångra → cancel_account_deletion", calls.some((c) => c[0] === "cancel_account_deletion"));
      st.pending = true; st.days = 2;
      const row = await page.evaluate(() => new Promise((res) => {
        if (!window.MISC) return res(null);
        const r = window.MISC.deleteAccountRow(); document.body.appendChild(r);
        window.MISC.deletionState().then(() => setTimeout(() => res({ t: r.textContent, cls: r.className, sub: !r.querySelector(".mm-del-sub").hidden }), 50));
      }));
      ok("X4 MISC.deleteAccountRow(): ds-row, sub 'Raderas om 2 dagar · tryck för att ångra'", !!row && /ds-row/.test(row.cls) && row.sub && /Raderas om 2 dagar · tryck för att ångra/.test(row.t), row);
      ok("X4 reminder shows once per app start", await page.evaluate(() => sessionStorage.getItem("olnu.mmDelToast") === "1"));
      await ctx.close();
    }
    // ---------- X4: old server (no 0402) → the old instant flow ----------
    {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
      page.on("pageerror", (e) => errs.push("x4c:" + e.message));
      const st = { old: true }, calls = [];
      await server(page, st, calls);
      await boot(page); await wait(page, 1500);
      await page.evaluate(() => window.PRIVACY.showDelete()); await wait(page, 900);
      const s = await sheet(page);
      ok("X4 old server: Radera opens the old sheet ('Ja, radera', no .mm-del)", !s.mm && s.btns.some((b) => /Ja, radera/.test(b.t)), s.btns);
      await ctx.close();
    }
    // ---------- F4: Grundare badge ----------
    {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
      page.on("pageerror", (e) => errs.push("f4:" + e.message));
      const st = {}, calls = [];
      await server(page, st, calls);
      await boot(page);
      const f = await page.evaluate(() => new Promise((res) => {
        if (!window.MISC) return res(null);
        const b = window.MISC.founderBadge(); const host = document.createElement("div"); host.id = "mm-test-host";
        host.style.cssText = "position:fixed;top:120px;left:16px;z-index:5000;padding:12px;background:#121a2a"; host.appendChild(b); document.body.appendChild(host);
        window.MISC.isFounder().then((x) => setTimeout(() => { const r = b.getBoundingClientRect(); res({ is: x, hidden: b.hidden, t: b.textContent, h: Math.round(r.height), icon: !!b.querySelector("svg.pi-star") }); }, 100));
      }));
      ok("F4 my_founder {founder, final} → MISC.isFounder() true, 'Grundare' badge visible with the star icon", !!f && f.is === true && !f.hidden && /Grundare/.test(f.t) && f.icon && f.h >= 20, f);
      await page.evaluate(() => { const h = document.getElementById("mm-test-host"); h && h.scrollIntoView(); });
      await page.screenshot({ path: SP + "misc-founder-badge-390.png", clip: { x: 0, y: 100, width: 390, height: 90 } }); console.log("shot " + SP + "misc-founder-badge-390.png");
      ok("F4 calls my_founder once", calls.filter((c) => c[0] === "my_founder").length === 1, calls.map((c) => c[0]));
      await ctx.close();
      const c2 = await ctxFor(browser, { width: 390, height: 844 });
      await server(c2.page, { founder: { final: false } }, []);
      await boot(c2.page);
      const g = await c2.page.evaluate(() => new Promise((res) => {
        if (!window.MISC) return res(null);
        const a = window.MISC.founderBadge(), b = window.MISC.founderBadge({ always: true }); document.body.appendChild(a); document.body.appendChild(b);
        window.MISC.isFounder().then(() => setTimeout(() => res({ a: a.hidden, b: b.hidden }), 100));
      }));
      ok("F4 before the owner sets the launch cutoff: badge hidden (owner default), {always:true} shows it", !!g && g.a === true && g.b === false, g);
      await c2.ctx.close();
    }
    // ---------- X5: film viewer → Anmäl → 'Blockera den som tog bilden' → film_block ----------
    {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
      page.on("pageerror", (e) => errs.push("x5:" + e.message));
      const st = {}, calls = [];
      await server(page, st, calls);
      let JPG = null;
      await page.route(/rest\/v1\/rpc\/(film_poll|film_state|film_stock|film_roll|film_photo|film_save_list|film_report|film_react)\b/, (r) => {
        const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
        calls.push([fn, b]);
        const names = ["Lisa", "Oskar", "Anton"];
        if (fn === "film_poll") return J(r, { v: 2, now: iso(0), night: NIGHT, develop_at: NIGHT, groups: [], rolls: [] });
        if (fn === "film_state") return J(r, { now: iso(0), night: NIGHT, develop_at: NIGHT, mine: 0, left: 10, max: 10, group_n: 0, group_max: 60, shooters: 0, keeps: false, rolls: [] });
        if (fn === "film_stock") return J(r, { night: NIGHT, film: null, locked: false, nights: [] });
        if (fn === "film_roll") return J(r, { night: NIGHT, evening: "2026-11-07", develop_at: NIGHT, developed: true, n: 3, gone: 0, expires_at: iso(5),
          photos: [0, 1, 2].map((i) => ({ id: 900 + i, k: "k" + i, name: names[i], is_me: i === 2, at: new Date(Date.parse("2026-11-07T21:00:00Z") + i * 9e5).toISOString(), w: 64, h: 48, reacts: [], n: 0, my: null })) });
        if (fn === "film_photo") return J(r, { id: b.p_photo_id, mime: "image/jpeg", w: 64, h: 48, b64: JPG });
        if (fn === "film_save_list") return J(r, { night: NIGHT, developed: true, evening: "2026-11-07", group_name: "Ludvika Lager", film: null, photos: [] });
        if (fn === "film_report") return J(r, { ok: true, id: b.p_photo_id, hidden_all: false });
        return J(r, {});
      });
      await boot(page);
      JPG = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 64; c.height = 48; const x = c.getContext("2d"); x.fillStyle = "#c86"; x.fillRect(0, 0, 64, 48); return c.toDataURL("image/jpeg", 0.8).split(",")[1]; });
      await page.evaluate((G) => window.FILM.openRoll({ id: G, name: "Ludvika Lager" }, "2026-11-08T04:00:00.000Z"), G);
      await page.waitForFunction(() => document.querySelector("#sheet-body .fm-shot img"), null, { timeout: 20000 }).catch(() => {});
      await wait(page, 800);
      await page.evaluate(() => document.querySelector("#sheet-body .fm-shot img").click()); await wait(page, 900);
      await page.evaluate(() => { const b = document.querySelector(".fm-view .fm-v-rep"); if (b) b.click(); }); await wait(page, 500);
      const rows = await page.evaluate(() => [...document.querySelectorAll(".fm-mini .btn")].map((b) => b.textContent));
      ok("X5 film report sheet has 'Blockera den som tog bilden' (before Avbryt)", rows.includes("Blockera den som tog bilden") && rows[rows.length - 1] === "Avbryt", rows);
      await shot(page, "film-report-390");
      await tap(page, ".fm-mini .btn", "^Blockera den som tog bilden$"); await wait(page, 500);
      const cf = await page.evaluate(() => { const o = document.querySelector(".mm-ov"); return o && { t: o.textContent, z: getComputedStyle(o).zIndex }; });
      ok("X5 confirm overlay (own sheet, above the film viewer): 'Blockera den som tog bilden?' + Ångra hint", !!cf && /Blockera den som tog bilden\?/.test(cf.t) && /Blockerade/.test(cf.t) && +cf.z > 3000, cf);
      await shot(page, "film-block-confirm-390");
      ok("X5 nothing sent before the confirm", !calls.some((c) => c[0] === "film_block"));
      await page.evaluate(() => document.querySelector(".mm-ov .mm-block-yes").click()); await wait(page, 900);
      const fb = calls.filter((c) => c[0] === "film_block").pop();
      const after = await page.evaluate(() => ({ ov: !!document.querySelector(".mm-ov"), view: !!document.querySelector(".fm-view"), hidden: document.querySelectorAll("#sheet-body .fm-frame")[0].hidden }));
      ok("X5 Blockera → film_block {p_photo_id: 900}; overlay + viewer close; the photo is hidden", fb && fb[1].p_photo_id === 900 && !after.ov && !after.view && after.hidden, [fb, after]);
      ok("X5 no film_report sent for a block", !calls.some((c) => c[0] === "film_report"));
      // reportMenu API (for social-a's chat UI)
      const rm = await page.evaluate(() => { if (!window.MISC) return null; const r = window.MISC.reportMenu({ id: 4, name: "Oskar" }); const o = document.querySelector(".sf-ov"); const t = o ? o.textContent : ""; if (o) o.remove(); return { r, t }; });
      ok("X5 MISC.reportMenu({id, name}) opens the 🚩 / 🚫 menu (Anmäl meddelandet, Blockera Oskar)", !!rm && rm.r && /Anmäl meddelandet/.test(rm.t) && /Blockera Oskar/.test(rm.t), rm);
      await ctx.close();
    }
    // ---------- F3: owner panel — film photo reports in the same queue + Grundare cutoff ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errs.push("f3:" + e.message));
      page.on("dialog", (d) => d.accept("").catch(() => {}));
      const calls = [];
      const H = (h) => new Date(Date.now() - h * 3600e3).toISOString();
      let cut = null;
      await page.route(/rest\/v1\/rpc\/(\w+)/, (r) => {
        const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
        calls.push([fn, b]);
        if (fn === "owner_reports") return J(r, { generated_at: H(0), open: 1, oldest_open_h: 3.5, reports: [
          { id: 11, kind: "msg", ref: "341", reason: "hat", note: null, excerpt: "Din f****", status: "new", created_at: H(3.5), same: 1, author_30d: 1, author: "1a2b3c4d", photo_id: null }] });
        if (fn === "owner_film_reports") return J(r, { generated_at: H(0), open: 1, oldest_open_h: 21.2, reports: [
          { id: 77, kind: "film", ref: "77", reason: "sex", note: null, excerpt: "[🎞️ 77]", status: "new", created_at: H(1), handled_at: null, same: 2, author_30d: 2, author: "9f8e7d6c", film_id: 77, photo: true, live: false, auto_hidden: true }] });
        if (fn === "owner_film_photo") return J(r, { ok: true, mime: "image/png", b64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" });
        if (fn === "owner_film_act" || fn === "owner_report_act") return J(r, { ok: true, status: b.p_action, restored: b.p_action === "dismiss" });
        if (fn === "owner_founders") return J(r, { v: 1, cutoff: cut, set_at: cut ? H(0) : null, marks: cut ? 568 : 0, users: 568, founders: 568 });
        if (fn === "owner_set_founder_cutoff") { cut = b.p_at; return J(r, { ok: true, cutoff: b.p_at, new_marks: 568, marks: 568 }); }
        if (fn === "owner_stats") return J(r, { generated_at: H(0), users: {}, beers: {}, places: {}, social: {}, care: {}, tech: {} });
        return J(r, null);
      });
      await page.addInitScript(() => sessionStorage.setItem("olnu.ownerKey", "test-key"));
      await page.goto(BASE + "stats.html"); await wait(page, 2500);
      await page.evaluate(() => { const m = document.getElementById("main"); if (m) m.hidden = false; const l = document.getElementById("login"); if (l) l.hidden = true; });
      await wait(page, 2500);
      const pan = await page.evaluate(() => { const p = document.getElementById("pUgc"); return p && !p.hidden ? { t: p.textContent, rows: [...p.querySelectorAll("[data-rep]")].map((x) => x.getAttribute("data-rep")) } : null; });
      ok("F3 owner queue: chat report + film photo in ONE list (film first: newest), head '2 öppna, äldsta 21,2 h'",
        !!pan && pan.rows.join() === "f77,11" && /2 öppna/.test(pan.t) && /21,2 h/.test(pan.t) && /filmbild/.test(pan.t) && /2 anmälare/.test(pan.t) && /Dold för alla efter 2 anmälare/.test(pan.t), pan);
      await page.evaluate(() => document.querySelector('#pUgc [data-rep="f77"]').scrollIntoView()); await wait(page, 300);
      await page.evaluate(() => { const b = [...document.querySelectorAll('#pUgc [data-rep="f77"] button')].find((x) => /Visa bild/.test(x.textContent)); if (b) b.click(); }); await wait(page, 700);
      ok("F3 'Visa bild' on a film report → owner_film_photo {p_photo_id: 77}, image shown", calls.some((c) => c[0] === "owner_film_photo" && c[1].p_photo_id === 77 && c[1].p_key === "test-key")
        && await page.evaluate(() => !!document.querySelector('#pUgc [data-rep="f77"] img')));
      await shot(page, "owner-queue-390");
      await page.evaluate(() => document.querySelector('#pUgc [data-rep="f77"] [data-act="dismiss"]').click()); await wait(page, 800);
      ok("F3 ✅ OK on the film report → owner_film_act {77, dismiss} (not owner_report_act)", calls.some((c) => c[0] === "owner_film_act" && c[1].p_photo_id === 77 && c[1].p_action === "dismiss")
        && !calls.some((c) => c[0] === "owner_report_act"));
      await page.evaluate(() => document.querySelector('#pUgc [data-rep="f77"] [data-act="hide"]').click()); await wait(page, 800);
      ok("F3 🗑️ Ta bort on the film report → owner_film_act {77, hide}", calls.some((c) => c[0] === "owner_film_act" && c[1].p_photo_id === 77 && c[1].p_action === "hide"));
      await page.evaluate(() => document.querySelector('#pUgc [data-rep="11"] [data-act="dismiss"]').click()); await wait(page, 800);
      ok("F3 chat report still → owner_report_act {11}", calls.some((c) => c[0] === "owner_report_act" && c[1].p_id === 11));
      // founders
      const fp = await page.evaluate(() => { const p = document.getElementById("pFounders"); return p && !p.hidden ? p.textContent : null; });
      ok("F4 owner panel: ⭐ Grundare, 'inte satt än', 568 accounts", !!fp && /Grundare/.test(fp) && /inte satt än/.test(fp) && /568/.test(fp), fp);
      await page.evaluate(() => document.getElementById("pFounders").scrollIntoView()); await wait(page, 200);
      await page.evaluate(() => document.querySelector('#pFounders [data-act="set"]').click()); await wait(page, 300);
      ok("F4 set cutoff asks first (inline 'Säker?'), nothing sent yet", await page.evaluate(() => /Säker\?/.test(document.getElementById("pFounders").textContent)) && !calls.some((c) => c[0] === "owner_set_founder_cutoff"));
      await shot(page, "owner-founders-confirm-390");
      await page.evaluate(() => document.querySelector('#pFounders [data-act="yes"]').click()); await wait(page, 1000);
      const sc = calls.filter((c) => c[0] === "owner_set_founder_cutoff").pop();
      ok("F4 'Ja, sätt datumet' → owner_set_founder_cutoff {p_key, p_at ISO}; panel shows the date", !!sc && sc[1].p_key === "test-key" && !isNaN(Date.parse(sc[1].p_at))
        && await page.evaluate(() => /Lanseringsdatum: \d/.test(document.getElementById("pFounders").textContent)), sc);
      await shot(page, "owner-founders-set-390");
      await ctx.close();
    }
  } catch (e) { console.log("FAIL exception", e && e.stack); fail++; }
  ok("no page errors", errs.length === 0, errs);
  await browser.close();
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
