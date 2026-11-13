// polishB (blind test 13 Nov): P2-5 the group chat opens with the last messages at once (cache / group page preview), then
// merges the slow server answer (no duplicates, no jump); P3-1 plain Swedish in the age, rules and safety copy + the year list
// ends at (this year − 18) with a "(year − 17) eller senare" choice that keeps the under-18 path.
// Mocked server (ds-helpers + fixtures/rpc.js). Usage: node polishB-pw.js <port>
const { ctxFor, boot, wait, clickJS } = require("./ds-helpers.js");
const { chromium } = require("playwright");
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 400)); };
const now = Date.now(), iso = (m) => new Date(now - m * 60e3).toISOString();
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
// 25 lines on the server; the group page keeps the last 20 (gpage.js st.msgs), so the preview path must put lines 1–5 ABOVE it
const MSGS = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: ["Lisa", "Oskar", "Anton"][i % 3], body: "Rad " + (i + 1), created_at: iso(90 - i * 3), is_me: i % 3 === 2 }));
const NEW = { id: 26, name: "Lisa", body: "Framme om fem", created_at: iso(1), is_me: false };
const Y = (() => { try { return +new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric" }).format(new Date()); } catch (e) { return new Date().getFullYear(); } })();

// The group page reads group_msgs fast; once the page is up (window.__slow), the chat's own read takes 3 s and has one more line.
async function openGroup(page) {
  await page.route(/rest\/v1\/rpc\/group_msgs/, async (r) => {
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    const slow = await page.evaluate(() => !!window.__slow).catch(() => false);
    if (b.p_after_id > 0) return J(r, b.p_after_id < 26 && slow ? [NEW] : []);
    if (slow) { await new Promise((res) => setTimeout(res, 3000)); return J(r, MSGS.concat([NEW])); }
    return J(r, MSGS);
  });
  await boot(page);
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  await clickJS(page, "#btn-groups"); await wait(page, 1200);
  await clickJS(page, '.inv-tabs button[data-t="g"]'); await wait(page, 400);
  await page.evaluate(() => { const c = [...document.querySelectorAll(".glist .gcard")].find((x) => /Ludvika/.test(x.textContent)); if (c) c.click(); });
  await page.waitForSelector(".gpg-msgs li.gpg-msg", { timeout: 15000 }).catch(() => {});
  await wait(page, 1500);
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
}
const chatState = (page) => page.evaluate(() => {
  const l = document.querySelector(".chat-list"); if (!l) return { open: false };
  const ids = [...l.querySelectorAll("li.chat-msg")].map((x) => x.getAttribute("data-mid"));
  return { open: true, ids, empty: !!l.querySelector(".chat-empty"), gap: Math.round(l.scrollHeight - l.scrollTop - l.clientHeight), oneLine: !!l.querySelector(".chat-msg .cm-body") };
});

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    /* ---------- P2-5: the chat shows the last lines at once, then merges the slow answer ---------- */
    for (const how of ["warm", "preview"]) {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
      const errs = []; page.on("pageerror", (e) => errs.push(e.message));
      await openGroup(page);
      const pv = await page.evaluate(() => document.querySelectorAll(".gpg-msgs li.gpg-msg:not(.gpg-empty)").length);
      // "preview": no usable WARM entry (a write made the cache dirty / a new phone): the group page preview is the source
      await page.evaluate((h) => { window.__slow = 1; if (h === "preview") { try { window.WARM.clear(); } catch (e) {} } }, how);
      await page.evaluate(() => { const b = document.querySelector(".gpg-chat-h"); if (b) b.click(); });
      await wait(page, 600);
      const s0 = await chatState(page);
      const want0 = how === "warm" ? 25 : 20;   // WARM = the whole cached first page; preview = the 20 lines the group page keeps
      ok(`[${how}] P2-5 chat open: the last lines show at once (no empty chat while the server answers in 3 s)`, pv >= 5 && s0.open && s0.ids.length === want0 && !s0.empty && s0.ids.includes("25"), { pv, n: s0.ids && s0.ids.length, s0 });
      ok(`[${how}] P2-5 chat open: the newest line is in view (scrolled to the bottom)`, s0.open && s0.gap <= 4, s0.gap);
      // the server answer: preview = the slow first page (3 s); WARM = served from the cache, the next chat tick (7 s) brings line 26
      await page.waitForFunction(() => !!document.querySelector('.chat-list li[data-mid="26"]'), null, { timeout: 9000 }).catch(() => {});
      await wait(page, 700);
      const s1 = await chatState(page);
      const dup = s1.ids ? s1.ids.length - new Set(s1.ids).size : -1;
      ok(`[${how}] P2-5 the server answer merges: 26 lines once each, in id order (older lines above the preview)`, s1.open && dup === 0 && s1.ids.length === 26 && s1.ids.join() === s1.ids.slice().sort((a, b) => a - b).join(), s1.ids);
      ok(`[${how}] P2-5 no jump: still at the newest line after the merge`, s1.open && s1.gap <= 4, s1.gap);
      ok(`[${how}] no page errors`, !errs.length, errs);
      await ctx.close();
    }

    /* ---------- P3-1: the age widget (plain Swedish, year list, under 18) ---------- */
    {
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
      const errs = []; page.on("pageerror", (e) => errs.push(e.message));
      await boot(page);
      const a = await page.evaluate(() => {
        const cb = document.createElement("input"); cb.type = "checkbox"; document.body.appendChild(cb);
        const box = window.SAFETY.ageWidget(cb); box.id = "pb-age"; document.body.appendChild(box);
        const sel = box.querySelector("select"), o = [...sel.options].map((x) => ({ v: x.value, t: x.textContent }));
        return { l: box.querySelector(".sf-age-l").textContent, note: box.querySelector(".sf-age-note").textContent, o, txt: box.textContent };
      });
      const yrs = a.o.filter((x) => x.v).map((x) => +x.v);
      ok("P3-1 age label + note in plain Swedish", a.l === "Vilket år är du född?" && a.note === "Vi sparar bara att du är 18 år eller äldre, inte födelseåret.", a);
      ok("P3-1 no dialect in the age widget (ä du / int' / soldat)", !/(^|\s)ä(\s|$)|int'|soldat/i.test(a.txt), a.txt);
      ok(`P3-1 year list: the first year is ${Y - 18} (never ${Y - 13}); one "${Y - 17} eller senare" choice first; down to 1930`,
        a.o[0].v === "" && a.o[1].v === String(Y - 17) && a.o[1].t === (Y - 17) + " eller senare" && a.o[2].v === String(Y - 18) && a.o[2].t === String(Y - 18)
        && !yrs.some((y) => y > Y - 17) && yrs[yrs.length - 1] === 1930, a.o.slice(0, 4));
      // adult: "Välkommen in." (check icon, no emoji)
      await page.selectOption("#pb-age select", "1990"); await wait(page, 300);
      const ad = await page.evaluate(() => { const m = document.querySelector("#pb-age .sf-age-msg"); return { t: m.textContent.trim(), i: !!m.querySelector("svg") }; });
      ok("P3-1 adult: 'Välkommen in.' with the check icon", ad.t === "Välkommen in." && ad.i, ad);
      await page.evaluate(() => { try { localStorage.removeItem("olnu.age18"); } catch (e) {} });
      // born (year − 18), no birthday yet = under 18 → the calm block screen
      await page.selectOption("#pb-age select", String(Y - 18)); await wait(page, 300);
      const bd = await page.evaluate(() => { const b = document.querySelector("#pb-age .sf-age-bd"); return { shown: !b.hidden, t: b.textContent }; });
      ok(`P3-1 born ${Y - 18} → 'Har du fyllt år i år?'`, bd.shown && /Har du fyllt år i år\?/.test(bd.t), bd);
      await page.evaluate(() => document.querySelector('#pb-age [data-bd="0"]').click()); await wait(page, 600);
      const u1 = await page.evaluate(() => { const o = document.querySelector(".sf-ov.sf-hard"); return o ? o.textContent : ""; });
      ok("P3-1 not 18 yet → the block screen in plain Swedish", /Du behöver vara 18 år/.test(u1) && /PintsNow är bara för dig som har fyllt 18\./.test(u1) && !/(^|\s)ä(\s|$)|kompis|int'/.test(u1), u1);
      await page.evaluate(() => { document.querySelectorAll(".sf-ov").forEach((x) => x.remove()); try { localStorage.removeItem("olnu.ageNo"); } catch (e) {} });
      await page.selectOption("#pb-age select", String(Y - 17)); await wait(page, 600);
      const u2 = await page.evaluate(() => { const o = document.querySelector(".sf-ov.sf-hard"); return o ? o.textContent : ""; });
      ok(`P3-1 '${Y - 17} eller senare' → the same block screen (the under-18 path works)`, /Du behöver vara 18 år/.test(u2), u2);
      ok("P3-1 no page errors (age)", !errs.length, errs);
      await ctx.close();
    }

    /* ---------- P3-1: rules, report, block and contact copy (safety.js) + the invite heading (join.js) ---------- */
    {
      const fs = require("fs"), path = require("path"), root = path.join(__dirname, "..", "..", "docs", "js");
      const src = (f) => fs.readFileSync(path.join(root, f), "utf8");
      const strs = (s) => { const out = [], re = /"((?:[^"\\]|\\.)*)"/g; let m; while ((m = re.exec(s))) out.push(m[1]); return out; };
      const DIA = /(^|[\s"(])(ä|Dä|int'|Int'|nån|nåt)([\s.,!?:)]|$)|soldat|kompis!/;
      const bad = strs(src("safety.js")).filter((x) => /[a-zåäö]/i.test(x) && DIA.test(x));
      ok("P3-1 safety.js: no dialect in any user text (ä / int' / nån / nåt / soldat / kompis)", bad.length === 0, bad);
      const sub = (() => { const s = src("join.js"), a = s.indexOf("function subText"), b = s.indexOf("function needName"); return a > 0 && b > a ? s.slice(a, b) : ""; })();
      ok("P3-1 join.js invite heading: 'Du är inbjuden' / 'Du är bjuden', no 'Du ä'", sub && /Du är inbjuden till PintsNow/.test(sub) && /Du är bjuden/.test(sub) && !/Du ä /.test(sub), sub.slice(0, 200));
      const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
      const errs = []; page.on("pageerror", (e) => errs.push(e.message));
      await boot(page);
      const r = await page.evaluate(async () => {
        try { localStorage.removeItem("olnu.termsOk"); } catch (e) {}
        const out = {};
        const p = window.SAFETY.showRules ? window.SAFETY.showRules() : null;
        await new Promise((res) => setTimeout(res, 300));
        const ov = document.querySelector(".sf-ov"); out.rules = ov ? ov.textContent : "";
        out.btns = ov ? [...ov.querySelectorAll("button")].map((b) => b.textContent.trim()) : [];
        return out;
      });
      ok("P3-1 Regler: plain Swedish ('Dela inte andras …', 'PintsNow är för dig som är 18 år eller äldre.')", /Dela inte andras bilder/.test(r.rules) && /PintsNow är för dig som är 18 år eller äldre\./.test(r.rules) && !/int'|(^|\s)ä(\s|$)/.test(r.rules), r);
      ok("P3-1 no page errors (rules)", !errs.length, errs);
      await ctx.close();
    }
  } catch (e) { fail++; console.log("FAIL crash", e && e.stack); }
  await browser.close();
  console.log(`\npolishB: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
