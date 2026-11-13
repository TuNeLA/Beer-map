// d2group: a calm group page (AUDIT-NAV moves 7 + 8, Q5, Q13) + I-42 (a bigger chat preview).
// Home: no Spel row (only while a game runs), no Engångskamera row, no Gängkamp, "Kod" under "N av M dricker nu".
// Ikväll (+): Engångskamera = the first row, Spel row, no "Chatt" row, no "Gänget" row (it is a section of the Spel hub now).
// Om gruppen: no Kod / Bjud in row. Chat preview: the last 5 messages, a photo row = a fixed 48 px thumb.
// Mocked server (ds-helpers + fixtures/rpc.js). Usage: node d2group-pw.js <port> [shotsDir]
const { ctxFor, boot, wait, clickJS } = require("./ds-helpers.js");
const { chromium } = require("playwright");
const SHOTS = process.argv[3] || "";
let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 400)); };
const now = Date.now(), iso = (m) => new Date(now - m * 60e3).toISOString();
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
// 1x1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const MSGS = [
  { id: 1, name: "Lisa", body: "Var é ni?", created_at: iso(60), is_me: false },
  { id: 2, name: "Oskar", body: "La Parma. Kom nu, det är fullt ös här", created_at: iso(50), is_me: false },
  { id: 3, name: "Anton", body: "Sitter på Pitchers", created_at: iso(44), is_me: true },
  { id: 4, name: "Lisa", body: "Jag tar en taxi strax", created_at: iso(30), is_me: false },
  { id: 5, name: "Oskar", body: "📷 Kolla kön", created_at: iso(20), is_me: false },
  { id: 6, name: "Anton", body: "Haha", created_at: iso(12), is_me: true }];
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

async function openGroup(page, w, h) {
  await page.route(/rest\/v1\/rpc\/group_msgs/, (r) => { let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {} return J(r, b.p_after_id > 0 ? [] : MSGS); });
  await page.route(/rest\/v1\/rpc\/group_photos/, async (r) => { await new Promise((res) => setTimeout(res, 600)); return J(r, [{ id: 77, msg_id: 5, w: 100, h: 100, created_at: iso(20), is_me: false }]); });
  await page.route(/rest\/v1\/rpc\/group_photo$/, (r) => J(r, { b64: PNG, mime: "image/png" }));
  await boot(page);
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  await clickJS(page, "#btn-groups"); await wait(page, 1200);
  await clickJS(page, '.inv-tabs button[data-t="g"]'); await wait(page, 400);
  await page.evaluate(() => { const c = [...document.querySelectorAll(".glist .gcard")].find((x) => /Ludvika/.test(x.textContent)); if (c) c.click(); });
  await page.waitForSelector(".gpg", { timeout: 15000 }).catch(() => {});
  await wait(page, 2600);
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
}
const visList = (page) => page.evaluate(() => [...document.querySelectorAll(".gpg > *")].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== "none")
  .map((e) => ({ c: String(e.className).split(" ")[0], t: (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40), top: Math.round(e.getBoundingClientRect().top), o: +getComputedStyle(e).order || 0 })));
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: SHOTS + "/d2group-" + name + ".png" }); };

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  try {
    for (const [w, h] of [[360, 780], [390, 844], [430, 932]]) {
      const { ctx, page } = await ctxFor(browser, { width: w, height: h });
      const errs = []; page.on("pageerror", (e) => errs.push(e.message));
      await openGroup(page, w, h);
      const P = `[${w}]`;
      // ---------- home ----------
      const home = await visList(page);
      const has = (re) => home.some((x) => re.test(x.c));
      ok(`${P} home: no Spel row (no game running)`, !has(/^sp-gi$/), home);
      ok(`${P} home: no Engångskamera row`, !has(/^fm-gi$/), home);
      ok(`${P} home: no Gängkamp row`, !has(/^sa-gk$/), home);
      ok(`${P} home: no old Chatt button row`, !home.some((x) => x.c === "row" && /^(Chatt|Chat)$/.test(x.t)), home);
      ok(`${P} home: top card, chat, Om gruppen and the Ikväll button are there`, has(/^gmain$/) && has(/^gpg-chat$/) && has(/^gpg-dots$/) && has(/^gpg-bar$/), home);
      const top = await page.evaluate(() => {
        const R = (s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), b: Math.round(r.bottom), r: Math.round(r.right), h: Math.round(r.height) }; };
        return { sub: R(".gpg > .gmain .gsub"), code: R(".gpg > .pn-gp-code"), inv: R(".gpg > .pn-gp-inv"), card: R(".gpg > .gmain"), codeT: (document.querySelector(".gpg > .pn-gp-code") || {}).textContent || "",
          about: (document.querySelector(".gpg-dots .pn-gp-tx small") || {}).textContent || "" };
      });
      ok(`${P} home: "Kod ABC234" sits under "N av M dricker nu" (left-aligned, below it, inside the top card)`, !!(top.sub && top.code && /ABC234/.test(top.codeT) && Math.abs(top.code.l - top.sub.l) <= 4 && top.code.t >= top.sub.b - 14 && top.code.b <= top.card.b + 1), top);
      ok(`${P} home: Bjud in on the top card`, !!(top.inv && top.card && top.inv.t >= top.card.t && top.inv.b <= top.card.b && top.inv.h >= 44), top);
      ok(`${P} home: Om gruppen sub has no "kod"`, /medlemmar/.test(top.about) && !/kod/i.test(top.about), top.about);
      // ---------- I-42 chat preview ----------
      const c1 = await page.evaluate(() => {
        const li = [...document.querySelectorAll(".gpg-msgs > li.gpg-msg")];
        const ph = document.querySelector(".gpg-msgs > li.gpg-pmsg"), th = ph && ph.querySelector(".gpg-thumb"), r = th && th.getBoundingClientRect();
        return { n: li.length, txt: li.map((x) => x.textContent.trim().slice(0, 30)), th: r ? { w: Math.round(r.width), h: Math.round(r.height), t: Math.round(r.top) } : null,
          img: !!(th && th.querySelector("img")), dots: Math.round(document.querySelector(".gpg-dots").getBoundingClientRect().top), phTxt: ph ? ph.textContent : "", chatH: Math.round(document.querySelector(".gpg-chat").getBoundingClientRect().height) };
      });
      ok(`${P} I-42: the preview shows the last 5 messages (was 3)`, c1.n === 5 && /Var é ni|La Parma/.test(c1.txt[0]) && /Haha/.test(c1.txt[4]), c1);
      ok(`${P} I-42: a photo message = a 48 px thumb box from the first paint, no 📷 in the text`, !!c1.th && c1.th.w === 48 && c1.th.h === 48 && /Kolla kön/.test(c1.phTxt) && !/📷/.test(c1.phTxt), c1);
      await wait(page, 1500);
      const c2 = await page.evaluate(() => {
        const th = document.querySelector(".gpg-msgs > li.gpg-pmsg .gpg-thumb"), r = th && th.getBoundingClientRect(), im = th && th.querySelector("img");
        return { th: r ? { w: Math.round(r.width), h: Math.round(r.height), t: Math.round(r.top) } : null, img: !!im, src: im ? im.src.slice(0, 5) : "", dots: Math.round(document.querySelector(".gpg-dots").getBoundingClientRect().top), chatH: Math.round(document.querySelector(".gpg-chat").getBoundingClientRect().height) };
      });
      ok(`${P} I-42: the thumb shows the photo (group_photos → group_photo)`, c2.img && c2.src === "blob:", c2);
      ok(`${P} I-42: no layout shift when the photo comes (thumb, chat card and Om gruppen stay put)`, !!c2.th && c2.th.w === 48 && c2.th.h === 48 && c2.th.t === c1.th.t && c2.dots === c1.dots && c2.chatH === c1.chatH, { c1, c2 });
      ok(`${P} I-42: the chat card is big (≥ 5 lines of messages)`, c2.chatH >= 260, c2.chatH);
      await shot(page, w + "-home");
      await page.evaluate(() => { const sb = document.getElementById("sheet-body"); sb.scrollTop = 99999; }); await wait(page, 300);
      await shot(page, w + "-home-bottom");
      await page.evaluate(() => { document.getElementById("sheet-body").scrollTop = 0; }); await wait(page, 200);
      const homeH = await page.evaluate(() => document.getElementById("sheet-body").scrollHeight);
      // a running game: the Spel row comes back on home (live)
      const live = await page.evaluate(async () => { const s = document.querySelector(".gpg > .sp-gi"); if (!s) return null; s.classList.add("sp-live"); await new Promise((r) => setTimeout(r, 400));
        const v = s.getClientRects().length > 0 && getComputedStyle(s).display !== "none"; s.classList.remove("sp-live"); await new Promise((r) => setTimeout(r, 400)); return { v, after: s.getClientRects().length > 0 && getComputedStyle(s).display !== "none" }; });
      ok(`${P} home: a running game (sp-live) shows the Spel row on home, then it goes again`, !!live && live.v && !live.after, live);
      // ---------- Ikväll (+) ----------
      await clickJS(page, ".gpg-plus"); await wait(page, 900);
      const plus = await visList(page);
      const ikv = plus.filter((x) => x.c !== "gpg-ph").sort((a, b) => a.top - b.top);
      const head = ikv.findIndex((x) => x.c === "gp-h" && /Ikväll/.test(x.t));
      ok(`${P} +: Engångskamera = the first row of Ikväll`, head >= 0 && ikv[head + 1] && ikv[head + 1].c === "fm-gi" && /Engångskamera/.test(ikv[head + 1].t), ikv.slice(0, 4));
      ok(`${P} +: a Spel row`, plus.some((x) => /^gpg-ga$/.test(x.c) && /^Spel/.test(x.t)), plus.map((x) => x.t));
      ok(`${P} +: no Chatt row (the chat is on the page)`, !plus.some((x) => x.c === "row" && /^(Chatt|Chat)$/.test(x.t)), plus.map((x) => x.c + ":" + x.t));
      ok(`${P} +: no separate Gänget row (it is in Spel)`, !plus.some((x) => x.c === "gg-gi"), plus.map((x) => x.c + ":" + x.t));
      const fmRow = await page.evaluate(() => { const b = document.querySelector(".gpg > .fm-gi > .btn"); const r = b && b.getBoundingClientRect(); return r ? { h: Math.round(r.height), svg: !!b.querySelector("svg"), emoji: b.textContent } : null; });
      ok(`${P} +: the Engångskamera row is a full row (≥ 64 px, PNI icon, no emoji)`, !!fmRow && fmRow.h >= 60 && fmRow.svg && !EMOJI.test(fmRow.emoji), fmRow);
      const plusSub = await page.evaluate(() => (document.querySelector(".gpg-plus small") || {}).textContent || "");
      ok(`${P} home Ikväll button names what is inside (Kamera, Skåltimmen, Spel)`, /Kamera/.test(plusSub) && /Spel/.test(plusSub) && !/Jag kör|Följ mig hem/.test(plusSub), plusSub);
      await shot(page, w + "-plus");
      await clickJS(page, "#pn-back"); await wait(page, 500);
      // ---------- Om gruppen ----------
      await clickJS(page, ".gpg-dots"); await wait(page, 800);
      const info = await visList(page);
      const infoCode = await page.evaluate(() => { const c = document.querySelector(".gpg-code, .gpg-code-v, .gpg-inv"); return !!(c && c.getClientRects().length); });
      ok(`${P} Om gruppen: no Kod / Bjud in row`, !infoCode && !info.some((x) => /ABC234|Bjud in/.test(x.t)), info.map((x) => x.t));
      ok(`${P} Om gruppen: Medlemmar & roller + Lämna stay`, info.some((x) => /Medlemmar/.test(x.t)) && info.some((x) => /Lämna/.test(x.t)), info.map((x) => x.t));
      await shot(page, w + "-info");
      await clickJS(page, "#pn-back"); await wait(page, 500);
      // ---------- Spel hub: the Gänget section ----------
      await clickJS(page, ".gpg-plus"); await wait(page, 600);
      await page.evaluate(() => { const b = document.querySelector('.gpg > [data-ga="spel"] .btn'); if (b) b.click(); });
      await page.waitForSelector(".sp-hub .pn-ggs", { timeout: 8000 }).catch(() => {});
      await wait(page, 600);
      const gg = await page.evaluate(() => {
        const s = document.querySelector(".sp-hub .pn-ggs"); if (!s) return null;
        const rows = [...s.querySelectorAll(".pn-ggs-r")], cards = document.querySelector(".sp-hub .sp-cards");
        return { n: rows.length, h: rows.map((r) => Math.round(r.getBoundingClientRect().height)), svg: rows.every((r) => r.querySelector(".pn-ggs-i svg")), txt: s.textContent,
          after: !!cards && s.getBoundingClientRect().top >= cards.getBoundingClientRect().bottom - 1, head: (s.querySelector(".pn-ggs-h") || {}).textContent, w: Math.round(s.getBoundingClientRect().width), vw: innerWidth };
      });
      ok(`${P} Spel hub: a "Gänget" section under the games with the 7 fun-pack rows`, !!gg && gg.n === 7 && gg.head === "Gänget" && gg.after && /Citatboken/.test(gg.txt) && /Morgontidningen/.test(gg.txt), gg);
      ok(`${P} Spel hub Gänget: rows ≥ 44 px, PNI icons, no emoji, fits the width`, !!gg && gg.h.every((x) => x >= 44) && gg.svg && !EMOJI.test(gg.txt) && gg.w <= gg.vw - 30, gg);
      if (w === 390) {
        await page.evaluate(() => { const b = document.querySelector(".sp-hub .sp-body"); if (b) b.scrollTop = 99999; }); await wait(page, 300);
        await shot(page, w + "-spel");
        await page.evaluate(() => { const b = document.querySelector('.sp-hub .pn-ggs-r[data-gg="citat"]'); if (b) b.click(); });
        await wait(page, 2200);
        const st = await page.evaluate(() => ({ sp: document.documentElement.classList.contains("sp-on"), title: (document.getElementById("sheet-title") || {}).textContent || "", open: !document.getElementById("sheet").hidden, gg: !!document.querySelector("#sheet-body .gg") }));
        ok(`${P} Spel hub Gänget: Citatboken closes the hub and opens the Gänget sheet`, !st.sp && st.open && st.gg && /Gänget/.test(st.title), st);
      }
      ok(`${P} home is calm: ≤ 9 blocks, no Spel / kamera / Gängkamp row; sheet body ≤ ${Math.round(h * 1.3)} px`, home.length <= 9 && homeH <= Math.round(h * 1.3), { n: home.length, homeH });
      ok(`${P} no page errors`, errs.length === 0, errs);
      await ctx.close();
    }
  } catch (e) { ok("run", false, String(e && e.stack || e)); }
  await browser.close();
  console.log(`\nd2group: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
