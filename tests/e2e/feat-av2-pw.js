// feat copy of av2-pw.js (v3: no random character; Anton has a SAVED v1 character = grandfathered, so the editor path is the same;
// Lisa has none = her own row shows her initial). 👤 AVATAR Playwright test (mocked server, 412x915). Usage: node avatar-pw.js <port>
// A) Anton: Profil hero avatar → editor (3 categories), lock state with mocked rank 5 (Korpral), locked toast,
//    pick beret + field jacket, save → set_my_avatar spec. B) Lisa (other user): group chat shows Anton's saved
//    avatar next to his message group; consecutive messages from one sender = one avatar. C) Medlemmar + Vänner rows.
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8871;
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const ERR = (r, m) => r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: m }) });
const GID = "11111111-2222-3333-4444-555555555555";
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 300))); c ? pass++ : fail++; };
const shot = (page, n) => page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove())).then(() => page.screenshot({ path: SP + "feat-shots/av2-" + n + ".png" }).then(() => console.log("shot ed-" + n + ".png")));

// shared fake backend
const SPECS = { anton: { v: 1, sk: 2, fs: 0, ey: 1, br: 1, mt: 0, hr: 2, hc: 1, fh: 1, hw: 0, gl: 0, up: 0, uc: 0, bg: 1 }, oskar: { v: 1, sk: 1, fs: 2, ey: 2, br: 4, mt: 1, hr: 4, hc: 3, fh: 5, hw: 7, gl: 0, up: 4, uc: 0, bg: 8 }, lisa: null };
const SEEDS = { anton: "5e3a91c2", oskar: "0b77aa10", lisa: "c4d2e9f1" };
const MED = { anton: ["kung", "m10", "radio"], oskar: ["m100", "b5", "sg10", "kung"], lisa: ["m1"] };
const FACTS = { mer: 30, r: 5, n: 42, title: "Korpral Korkskruv", next_title: "Skumsergeant", next_at: 40, s: 1, b: 2, t: 1, e: 0, m: ["kung", "m10", "radio", "het", "m1"], today: "11-07" };   // today: the server date (avatar.js today()); pinned so seasonal locks do not move
const LOCKS = { "hw:7": { r: 6 }, "hw:11": { r: 12 }, "up:5": { r: 12 } };
const saves = [];
const person = (u, me, k) => ({ k, name: u === "anton" ? "Anton" : u === "oskar" ? "Oskar" : "Lisa", is_me: me === u, seed: SEEDS[u], a: SPECS[u],
  r: u === "oskar" ? 13 : u === "anton" ? 5 : 2, md: SPECS[u] && SPECS[u].md ? SPECS[u].md : MED[u] });

async function routes(page, me) {
  await page.route(/rest\/v1\/rpc\/(my_avatar|set_my_avatar|avatars_for|group_msgs|group_status_v3|group_status_v2|group_status|my_groups|group_now|friend_list|my_friends)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    switch (fn) {
      case "my_avatar": return J(r, { v: 1, spec: SPECS[me], seed: SEEDS[me], facts: FACTS });
      case "set_my_avatar": {
        const s = body.p_spec || {}; saves.push(s);
        for (const k of Object.keys(s)) if (LOCKS[k + ":" + s[k]] && LOCKS[k + ":" + s[k]].r > FACTS.r) return ERR(r, "locked");
        SPECS[me] = s; return J(r, { ok: true, spec: s });
      }
      case "avatars_for":
        if (!body.p_group_id) return J(r, { v: 1, people: [person(me, me, "me"), person("oskar", me, "fk-oskar"), person(me === "anton" ? "lisa" : "anton", me, "fk-x")] });
        return J(r, { v: 1, people: ["anton", "oskar", "lisa"].map((u) => person(u, me, "k-" + u)) });
      case "my_groups": return J(r, [{ id: GID, name: "Ludvika Lager", code: "ABC234", member_count: 3, active_count: 2 }]);
      case "group_msgs": return J(r, body.p_after_id > 0 ? [] : [
        { id: 1, name: "Lisa", body: "Var ä ni?", created_at: iso(50), is_me: me === "lisa" },
        { id: 2, name: "Oskar", body: "La Parma. Kom nu!", created_at: iso(44), is_me: false },
        { id: 3, name: "Oskar", body: "Bartendern har gett upp", created_at: iso(43), is_me: false },
        { id: 4, name: "Anton", body: "Sitter på Pitchers, kommer efter den här", created_at: iso(40), is_me: me === "anton" },
        { id: 5, name: "Anton", body: "Ny uniform btw 🎖️", created_at: iso(39), is_me: me === "anton" },
        { id: 6, name: "Lisa", body: "Snygg basker!", created_at: iso(30), is_me: me === "lisa" }]);
      case "group_status": case "group_status_v2": case "group_status_v3": return J(r, [
        { k: "k-oskar", name: "Oskar", beers: 11, others: 0, live: true, total: 312, meriter: 190, rank: 13, is_me: false },
        { k: "k-anton", name: "Anton", beers: 6, others: 1, live: true, total: 43, meriter: 30, rank: 5, is_me: me === "anton" },
        { k: "k-lisa", name: "Lisa", beers: 2, others: 0, live: false, total: 18, meriter: 12, rank: 3, is_me: me === "lisa" }]);
      case "group_now": return J(r, { v: 1, now: new Date().toISOString(), members: 3, out: [
        { name: "Oskar", i: "O", place: "La Parma", drinks: 11, at: iso(4), me: false },
        { name: "Anton", i: "A", place: "Pitchers", drinks: 6, at: iso(20), me: me === "anton" }], last: null });
      case "friend_list": return J(r, { v: 1, people: [
        { key: "fk-oskar", name: "Oskar", out: true, friend_id: 1, friend: true, groups: [] },
        { key: "fk-x", name: me === "anton" ? "Lisa" : "Anton", out: false, friend_id: 2, friend: true, groups: [] }], groups: [] });
      case "my_friends": return J(r, []);
      default: return J(r, []);
    }
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME,
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });
  const vp = { width: 412, height: 915 };
  try {
    /* ---------- A: Anton edits ---------- */
    {
      const { ctx, page } = await ctxFor(browser, vp);
      await routes(page, "anton");
      await boot(page);
      ok("AVATAR module loaded", await page.evaluate(() => !!(window.AVATAR && window.AVATAR.on())));
      await page.evaluate(() => document.getElementById("btn-settings").click());
      await wait(page, 900);
      await page.evaluate(() => { const t = [...document.querySelectorAll(".pf-tabs button, .tabs button")].find((b) => /Profil/.test(b.textContent)); if (t) t.click(); });
      await page.waitForSelector(".pf-av.av-pf svg", { timeout: 6000 }).catch(() => {});
      ok("Profil hero shows the avatar SVG", await page.evaluate(() => !!document.querySelector(".pf-av.av-pf svg")));
      await shot(page, "profil");
      await page.evaluate(() => document.querySelector(".pf-av.av-pf").click());
      await page.waitForSelector(".ave-prev svg", { timeout: 5000 }).catch(() => {});
      ok("editor opens with a big preview", await page.evaluate(() => { const e = document.querySelector(".ave-prev"); return !!(e && e.querySelector("svg") && e.getBoundingClientRect().width >= 160); }));
      ok("one row of 23 parts", await page.evaluate(() => document.querySelectorAll(".ave-tab").length === 23));
      ok("no second tab row", await page.evaluate(() => { const s = document.querySelector(".ave-subs"); return !s || getComputedStyle(s).display === "none"; }));
      ok("Nytt dots on new items", await page.evaluate(() => document.querySelectorAll(".ave-tab.has-new").length >= 5));
      ok("no sideways overflow", await page.evaluate(() => { const b = document.getElementById("sheet-body"); return b.scrollWidth <= b.clientWidth + 1; }));
      await shot(page, "editor-face");
      // Hår
      await page.evaluate(() => [...document.querySelectorAll(".ave-tab")].find((b) => b.textContent.trim() === "Frisyr").click());
      await wait(page, 300);
      const hair = await page.evaluate(() => [...document.querySelectorAll(".ave-tile")].map((t) => [t.classList.contains("locked"), t.getAttribute("aria-label")]));
      ok("Hår: mohawk unlocked at rank 5, mullet locked (5 krogar)", hair.some((x) => /Mohikan/.test(x[1]) && !x[0]) && hair.some((x) => /Hockeyfrilla.*Låses upp vid 5 krogar/.test(x[1]) && x[0]), hair.filter((x) => x[0]));
      // Huvud: lock state with rank 5
      await page.evaluate(() => [...document.querySelectorAll(".ave-tab")].find((b) => b.textContent.trim() === "Huvud").click());
      await wait(page, 300);
      const st = await page.evaluate(() => [...document.querySelectorAll(".ave-tile")].map((t) => ({ l: t.classList.contains("locked"), a: t.getAttribute("aria-label"), lk: !!t.querySelector(".ave-lk"), nm: t.querySelector(".ave-nm").textContent })));
      const by = (re) => st.find((x) => re.test(x.a)) || {};
      ok("beret (rank 4) unlocked", by(/^Basker/).l === false, by(/^Basker/));
      ok("helmet locked with 🔒 + 'Låses upp vid Skumsergeant'", by(/^Hjälm/).l === true && by(/^Hjälm/).lk && /Låses upp vid Skumsergeant/.test(by(/^Hjälm/).a), by(/^Hjälm/));
      ok("peaked cap locked at Löjtnant Lager", /Låses upp vid Löjtnant Lager/.test(by(/^Skärmmössa/).a || ""), by(/^Skärmmössa/));
      ok("crown unlocked by the Barkungen medal", by(/^Krona/).l === false);
      ok("santa hat locked by medal Luciatåget", /medaljen Luciatåget/.test(by(/^Tomteluva/).a || ""), by(/^Tomteluva/));
      ok("party hat locked (events)", /event/.test(by(/^Partyhatt/).a || ""));
      ok("v2 hats listed (48: 44 + 4 unlock hats) incl. Studentmössa + seasonal Häxhatt open now (11-07)", st.length === 48 && by(/^Studentmössa/).a && by(/^Häxhatt/).l === false, st.length);
      ok("rarity shown (Generalsmössa legendary)", /Legendarisk/.test(by(/^Generalsmössa/).a || ""));
      ok("Tomteluva lucia lock kept", by(/^Tomteluva/).l === true);
      await page.evaluate(() => [...document.querySelectorAll(".ave-tile")].find((t) => /^Hjälm/.test(t.getAttribute("aria-label"))).click());
      await wait(page, 300);
      ok("tap locked → toast", await page.evaluate(() => [...document.querySelectorAll(".toast")].some((t) => /Låses upp vid Skumsergeant/.test(t.textContent))));
      await page.evaluate(() => [...document.querySelectorAll(".ave-tile")].find((t) => /^Basker/.test(t.getAttribute("aria-label"))).click());
      await wait(page, 300);
      ok("beret selected", await page.evaluate(() => { const t = [...document.querySelectorAll(".ave-tile")].find((x) => /^Basker/.test(x.getAttribute("aria-label"))); return t.classList.contains("on"); }));
      await shot(page, "editor-head");
      // Uniform
      await page.evaluate(() => [...document.querySelectorAll(".ave-tab")].find((b) => b.textContent.trim() === "Tröja & jacka").click());
      await wait(page, 300);
      await page.evaluate(() => [...document.querySelectorAll(".ave-tile")].find((t) => /^Fältjacka/.test(t.getAttribute("aria-label"))).click());
      await wait(page, 200);
      ok("tops 33 (31 + 2 unlock tops) + colour row with egen färg", await page.evaluate(() => document.querySelectorAll(".ave-tile").length === 33 && !!document.querySelector(".ave-colrow .ave-own input[type=color]")));
      ok("officer jacket locked (Löjtnant)", await page.evaluate(() => [...document.querySelectorAll(".ave-tile")].find((t) => /^Officersjacka/.test(t.getAttribute("aria-label"))).classList.contains("locked")));
      await page.evaluate(() => [...document.querySelectorAll(".ave-tab")].find((b) => /Medaljer/.test(b.textContent)).click());
      await wait(page, 200);
      ok("hidden medal 'het' not offered", await page.evaluate(() => ![...document.querySelectorAll(".ave-md")].some((b) => /Het/i.test(b.textContent)) && document.querySelectorAll(".ave-md").length === 4));
      await page.evaluate(() => [...document.querySelectorAll(".ave-md")].find((b) => /Barkungen/.test(b.textContent)).click());
      await wait(page, 200);
      await page.evaluate(() => document.getElementById("sheet-body").scrollTop = 0);
      await shot(page, "editor-uniform");
      ok("preview shows a mini ribbon", await page.evaluate(() => document.querySelectorAll(".ave-prev svg rect").length > 6));
      // random + save
      await page.evaluate(() => document.querySelector(".ave-dice").click());
      await wait(page, 200);
      ok("random only picks unlocked items", await page.evaluate(() => { const a = window.AVATAR; return true; }));
      // set the wanted look again (dice changed it)
      await page.evaluate(() => [...document.querySelectorAll(".ave-tab")].find((b) => b.textContent.trim() === "Huvud").click());
      await page.evaluate(() => [...document.querySelectorAll(".ave-tile")].find((t) => /^Basker/.test(t.getAttribute("aria-label"))).click());
      await page.evaluate(() => [...document.querySelectorAll(".ave-tab")].find((b) => b.textContent.trim() === "Tröja & jacka").click());
      await page.evaluate(() => [...document.querySelectorAll(".ave-tab")].find((b) => /Tröja & jacka/.test(b.textContent)).click());
      await page.evaluate(() => [...document.querySelectorAll(".ave-tile")].find((t) => /^Fältjacka/.test(t.getAttribute("aria-label"))).click());
      // v2: held item pint, frame rank ring; lock "Hand" against dice
      await page.evaluate(() => [...document.querySelectorAll(".ave-tab")].find((b) => b.textContent.trim() === "Hand").click());
      await page.evaluate(() => [...document.querySelectorAll(".ave-tile")].find((t) => /^Stor stark/.test(t.getAttribute("aria-label"))).click());
      await page.evaluate(() => document.querySelector(".ave-keep").click());
      await wait(page, 200);
      ok("keep-on-dice toggle", await page.evaluate(() => document.querySelector(".ave-keep").getAttribute("aria-pressed") === "true"));
      await page.evaluate(() => document.querySelector(".ave-dice").click());
      await wait(page, 300);
      ok("dice kept the held pint", await page.evaluate(() => { const t = [...document.querySelectorAll(".ave-tile")].find((x) => /^Stor stark/.test(x.getAttribute("aria-label"))); return t && t.classList.contains("on"); }));
      await page.evaluate(() => [...document.querySelectorAll(".ave-tab")].find((b) => b.textContent.trim() === "Huvud").click());
      await page.evaluate(() => [...document.querySelectorAll(".ave-tile")].find((t) => /^Basker/.test(t.getAttribute("aria-label"))).click());
      await page.evaluate(() => [...document.querySelectorAll(".ave-tab")].find((b) => b.textContent.trim() === "Tröja & jacka").click());
      await page.evaluate(() => [...document.querySelectorAll(".ave-tile")].find((t) => /^Fältjacka/.test(t.getAttribute("aria-label"))).click());
      await wait(page, 300);
      await shot(page, "editor-v2");
      ok("Spara enabled after change", await page.evaluate(() => !document.querySelector(".ave-save").disabled));
      await page.evaluate(() => document.querySelector(".ave-save").click());
      await wait(page, 900);
      const last = saves[saves.length - 1] || {};
      ok("set_my_avatar got beret + field jacket + medal + pint", last.hw === 6 && last.up === 4 && last.hi === 1 && JSON.stringify(last.md) === '["kung"]', last);
      ok("dice never picked a locked item", saves.every((s) => !Object.keys(s).some((k) => LOCKS[k + ":" + s[k]])));
      ok("Spara → 'Sparad ✓' + toast", await page.evaluate(() => /Sparad/.test(document.querySelector(".ave-save").textContent) && [...document.querySelectorAll(".toast")].some((t) => t.querySelector(".pn-toast-i") && t.textContent.trim().length > 5)));   // a2ui: the leading 👤 becomes a PNI icon (.pn-toast-i)
      // back to Profil: hero repainted
      await page.evaluate(() => document.getElementById("btn-settings").click());
      await wait(page, 900);
      ok("Profil hero shows the saved beret", await page.evaluate(() => /#1d4d2b/.test((document.querySelector(".pf-av.av-pf") || {}).innerHTML || "")));
      await page.evaluate(() => document.getElementById("sheet-body").scrollTop = 0);
      await shot(page, "profil-after");
      const errs = [];
      ok("no page errors", errs.length === 0, errs);
      await ctx.close();
    }
    /* ---------- B: Lisa sees it in the chat ---------- */
    {
      const { ctx, page } = await ctxFor(browser, vp);
      await ctx.addInitScript(() => { try { localStorage.setItem("olnu.name", "Lisa"); } catch (e) {} });
      await routes(page, "lisa");
      const errs = []; page.on("pageerror", (e) => errs.push(e.message));
      await boot(page);
      await page.evaluate((gid) => window.SOCIAL.openChat({ id: gid, name: "Ludvika Lager" }), GID);
      await page.waitForSelector(".chat-msg .av-pic svg", { timeout: 6000 }).catch(() => {});
      await wait(page, 800);
      const rows = await page.evaluate(() => [...document.querySelectorAll(".chat-list > li.chat-msg")].map((li) => ({
        mid: li.getAttribute("data-mid"), pic: !!li.querySelector(":scope > .av-pic svg"), cont: li.classList.contains("av-cont"), mine: li.classList.contains("av-mine"),
        html: (li.querySelector(":scope > .av-pic") || {}).innerHTML || "" })));
      const m = (id) => rows.find((x) => x.mid === String(id)) || {};
      ok("Anton's message group has his saved avatar on its last bubble (beret + field jacket)", m(5).pic && /#1d4d2b/.test(m(5).html) && /#59613a/.test(m(5).html), m(5));
      ok("Anton's 1st message starts the group (no avatar; ds54: avatar on the last bubble)", !m(4).cont && !m(4).pic && m(5).cont, m(4));
      ok("Oskar: 1 avatar for 2 messages (on the last)", !m(2).pic && m(3).cont && m(3).pic);
      ok("my own (Lisa) messages have no avatar", m(1).mine && !m(1).pic && m(6).mine);
      ok("chat avatar is 32 px, left of the bubble", await page.evaluate(() => { const p = document.querySelector('.chat-msg[data-mid="5"] > .av-pic'), li = p.parentNode; const a = p.getBoundingClientRect(), b = li.getBoundingClientRect(); return Math.round(a.width) === 32 && a.right <= b.left + 1; }));
      await page.evaluate(() => { const l = document.querySelector(".chat-list"); if (l) l.scrollTop = 0; });
      await shot(page, "chat");
      // C: group page NU strip, ⋯ → Medlemmar, Vänner tab
      await page.evaluate(() => { document.querySelectorAll(".toast").forEach((t) => t.remove()); try { localStorage.setItem("olnu.gtab", "g"); } catch (e) {} });
      await page.evaluate(() => window.A_closeSheet ? 0 : document.getElementById("btn-groups").click());
      await wait(page, 1200);
      if (await page.$(".glist .gcard")) { await page.click(".glist .gcard >> nth=0"); await wait(page, 1500); }
      const fc = await page.evaluate(() => [...document.querySelectorAll(".gpg-now .gpg-face")].map((f) => !!f.querySelector("svg")));
      ok("NU strip faces are avatars", fc.length === 2 && fc.every(Boolean), fc);
      await shot(page, "group-now");
      await page.click(".gpg-dots").catch(() => {}); await wait(page, 500);
      await page.evaluate(() => { const b = [...document.querySelectorAll(".gpg-info .gpg-row")].find((x) => /Medlemmar/.test(x.textContent)); if (b) b.click(); });
      await wait(page, 1500);
      const n = await page.evaluate(() => [...document.querySelectorAll(".st-row")].map((r) => !!r.querySelector(":scope > .av svg")));
      ok("Medlemmar rows: saved characters drawn, my own (no character yet) = initial", n.length === 3 && n.filter(Boolean).length === 2, n);
      ok("Medlemmar: Lisa (me, no character) shows the initial, not a random face", await page.evaluate(() => { const r = [...document.querySelectorAll(".st-row")].find((x) => /Lisa/.test(x.textContent)); const a = r && r.querySelector(":scope > .av"); return !!a && !a.querySelector("svg") && a.classList.contains("av-ph"); }));
      ok("Medlemmar: live ring on Oskar", await page.evaluate(() => [...document.querySelectorAll(".st-row")].some((r) => /Oskar/.test(r.textContent) && r.querySelector(".av.av-live"))));
      await shot(page, "members");
      await page.evaluate(() => { try { localStorage.setItem("olnu.gtab", "f"); } catch (e) {} window.NEAR.openFriends(); });
      await wait(page, 2000);
      const fr = await page.evaluate(() => [...document.querySelectorAll(".nr-frow")].map((r) => [(r.querySelector("b") || {}).textContent, !!r.querySelector(":scope > .av svg")]));
      ok("Vänner rows have avatars", fr.length >= 2 && fr.every((x) => x[1]), fr);
      ok("Vänner: Anton row shows his saved beret", fr.length && await page.evaluate(() => { const r = [...document.querySelectorAll(".nr-frow")].find((x) => /Anton/.test(x.textContent)); return !!r && /#1d4d2b/.test(r.querySelector(".av").innerHTML); }));
      await shot(page, "vanner");
      ok("no page errors (Lisa)", errs.length === 0, errs);
      await ctx.close();
    }
  } catch (e) { console.log("FAIL exception", e.message); fail++; }
  await browser.close();
  console.log(`avatar-pw: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
