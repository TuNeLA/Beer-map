// SAFE Playwright test (mocked server, 412x915): store-safe + trust & safety client.
// Usage: NODE_PATH=... node safe-pw.js <port>      Screenshots: safe-tests/safe-*.png
const { ctxFor, boot, wait, clickJS } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8901, BASE = `http://127.0.0.1:${PORT}/`;
const GID = "11111111-2222-3333-4444-555555555555";
const J = (r, b, s) => r.fulfill({ status: s || 200, contentType: "application/json", body: JSON.stringify(b) });
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c || i === undefined ? "" : JSON.stringify(i).slice(0, 300)); c ? pass++ : fail++; };
const shot = async (page, n) => { await page.screenshot({ path: SP + "safe-" + n + ".png" }); console.log("shot " + SP + "safe-" + n + ".png"); };
const BANNED = /legend|rekord|en till|natten ä ung|hot streak|medevac/i;

// Safety RPC mocks. st = server state for this page; calls = log.
async function safetyMocks(page, st, calls) {
  await page.route(/rest\/v1\/rpc\/(safety_state|set_age_ok|accept_terms|report_content|block_user|my_blocks|unblock_user|delete_my_data_v2|delete_my_data|avatars_for|post_group_msg|public_config|my_groups)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    calls.push([fn, b]);
    switch (fn) {
      case "safety_state": return J(r, { v: 1, age_ok: st.age_ok, age_checked_at: null, terms_ver: st.terms_ver, terms_at: null, store: false, blocks: 1, notices: st.notices || [] });
      case "set_age_ok": { const ok18 = 2026 - b.p_birth_year > 18; st.age_ok = ok18; return J(r, { age_ok: ok18 }); }
      case "accept_terms": st.terms_ver = 1; return J(r, { terms_ver: 1 });
      case "report_content": return J(r, { ok: true, id: 7, dup: false, hidden: false });
      case "block_user": return J(r, { ok: true, on: true, name: "Oskar", id: "abcdef0123456789" });
      case "my_blocks": return J(r, { v: 1, blocks: [{ id: "abcdef0123456789", name: "Oskar", at: new Date().toISOString() }] });
      case "unblock_user": return J(r, { ok: true });
      case "delete_my_data_v2": return J(r, { ok: true, v: 2, deleted_rows: 120, anonymised_rows: 3, auth_deleted: true, left: [], errors: [] });
      case "avatars_for": return J(r, { v: 1, people: [{ k: "aaaaaaaaaaaa", name: "Oskar", is_me: false }, { k: "me", name: "Anton", is_me: true }] });
      case "post_group_msg": return J(r, { id: 99, created_at: new Date().toISOString() });
      case "public_config": return J(r, st.config || { v: 1 });
      case "my_groups": return J(r, [{ id: GID, name: "Ludvika Lager", code: "ABC234", member_count: 4, active_count: 3 }]);
    }
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });
  const errs = [];

  // ---------- 1. new user, English phone: Swedish only + birth-year picker; under 18 is blocked ----------
  {
    const { ctx, page } = await ctxFor(browser, { width: 412, height: 915 }, { clean: true });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, "language", { get: () => "en-US" }); });
    page.on("pageerror", (e) => errs.push("1:" + e.message));
    const calls = [], st = { age_ok: null, terms_ver: null };
    await safetyMocks(page, st, calls);
    await page.goto(BASE); await wait(page, 4000);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button, a")].find((x) => /utan att installera/i.test(x.textContent)); if (b) b.click(); });
    await wait(page, 1500);
    const intro = await page.evaluate(() => ({ lang: window.I18N.lang, html: document.documentElement.lang, svenBtn: !!document.querySelector(".intro-lang, .intro-lang-b"),
      sel: !!document.querySelector("#intro-body #sf-age-year"), ov: !!document.querySelector(".sf-ov"), go: (() => { const b = [...document.querySelectorAll("#intro-body button")].find((x) => /Kör/.test(x.textContent)); return b ? b.disabled : null; })() }));
    ok("Swedish only on an English phone, no SV/EN buttons", intro.lang === "sv" && intro.html === "sv" && !intro.svenBtn, intro);
    ok("intro asks for the birth year (no extra sheet on top); Kör! disabled", intro.sel && !intro.ov && intro.go === true, intro);
    await shot(page, "intro-age");
    await page.selectOption("#sf-age-year", "2008");
    await wait(page, 300);
    const bd = await page.evaluate(() => !document.querySelector(".sf-age-bd").hidden);
    ok("born 2008 → asks 'Har du fyllt år i år?'", bd, bd);
    await page.selectOption("#sf-age-year", "2012"); await wait(page, 800);
    const blocked = await page.evaluate(() => { const o = document.querySelector(".sf-ov.sf-hard"); return o ? o.textContent : ""; });
    ok("under 18 → friendly block screen", /Sorry, kompis/.test(blocked) && /18/.test(blocked), blocked);
    await shot(page, "under18");
    await page.reload(); await wait(page, 3500);
    const still = await page.evaluate(() => !!document.querySelector(".sf-ov.sf-hard"));
    ok("block stays after reload (24 h)", still, still);
    await ctx.close();
  }
  // ---------- 2. adult new user: picker → server gets the year once (only age_ok is kept) ----------
  {
    const { ctx, page } = await ctxFor(browser, { width: 412, height: 915 }, { clean: true });
    page.on("pageerror", (e) => errs.push("2:" + e.message));
    const calls = [], st = { age_ok: null, terms_ver: 1 };
    await safetyMocks(page, st, calls);
    await page.goto(BASE); await wait(page, 4000);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button, a")].find((x) => /utan att installera/i.test(x.textContent)); if (b) b.click(); });
    await wait(page, 1200);
    await page.selectOption("#sf-age-year", "1990"); await wait(page, 300);
    const goOn = await page.evaluate(() => { const b = [...document.querySelectorAll("#intro-body button")].find((x) => /Kör/.test(x.textContent)); return b && !b.disabled; });
    ok("adult → Kör! enabled", goOn, goOn);
    await shot(page, "intro-adult");
    await page.evaluate(() => { const b = [...document.querySelectorAll("#intro-body button")].find((x) => /Kör/.test(x.textContent)); if (b) b.click(); });
    await wait(page, 1500);
    await page.evaluate(() => { const b = [...document.querySelectorAll("#intro-body button")].find((x) => /Senare|senare|Int' nu|Hoppa/i.test(x.textContent)); if (b) b.click(); });
    await wait(page, 5000);
    const age = calls.filter((c) => c[0] === "set_age_ok");
    ok("set_age_ok sent once with the year, then forgotten", age.length === 1 && age[0][1].p_birth_year === 1990, age);
    const kept = await page.evaluate(() => [sessionStorage.getItem("olnu.agePend"), localStorage.getItem("olnu.age18")]);
    ok("year not kept on the phone after sending", kept[0] === null && kept[1] === "1", kept);
    await ctx.close();
  }
  // ---------- 3. existing user (old 18+ box): asked once; Regler before first post; chat 🚩 / 🚫 ----------
  {
    const { ctx, page } = await ctxFor(browser, { width: 412, height: 915 }, {});
    await ctx.tracing.start({ screenshots: true, snapshots: true });   // saved only when this part fails (CI debug)
    const failAtStart = fail;
    page.on("pageerror", (e) => errs.push("3:" + e.message));
    const calls = [], st = { age_ok: null, terms_ver: null };
    await safetyMocks(page, st, calls);
    await boot(page);
    await wait(page, 1500);
    const ask = await page.evaluate(() => { const o = document.querySelector(".sf-ov"); return o ? o.textContent : ""; });
    ok("existing user: one-time birth-year sheet", /snabb kontroll/i.test(ask), ask.slice(0, 80));
    await shot(page, "age-once");
    await page.selectOption("#sf-age-year", "1985"); await wait(page, 300);
    await page.evaluate(() => { const b = [...document.querySelectorAll(".sf-ov button")].find((x) => /Kör/.test(x.textContent)); if (b) b.click(); });
    await wait(page, 1500);
    ok("age answer sent; sheet closed", calls.some((c) => c[0] === "set_age_ok" && c[1].p_birth_year === 1985) && !(await page.$(".sf-ov")), calls.filter((c) => c[0] === "set_age_ok"));
    // chat: Regler before the first post
    await page.evaluate((gid) => window.SOCIAL.openChat({ id: gid, name: "Ludvika Lager" }), GID); await wait(page, 2000);
    await page.fill(".chat-input input, #chat-input, .chat-in input, input[enterkeyhint='send']", "Skål på er!").catch(() => {});
    await page.evaluate(() => { const i = document.querySelector("#sheet input[type=text], #sheet input:not([type]), #sheet textarea"); if (i) { i.value = "Skål på er!"; i.dispatchEvent(new Event("input")); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); } });
    await wait(page, 1200);
    const rules = await page.evaluate(() => { const o = document.querySelector(".sf-ov"); return o ? o.textContent : ""; });
    ok("first post → 📜 Regler sheet (chat stays open)", /Regler i PintsNow/.test(rules) && /support@pintsnow.com/.test(rules) && await page.evaluate(() => !document.querySelector("#sheet").hidden), rules.slice(0, 80));
    await shot(page, "regler");
    ok("post waits for the answer", !calls.some((c) => c[0] === "post_group_msg"));
    await page.evaluate(() => document.querySelector(".sf-accept").click()); await wait(page, 1500);
    ok("Jag godkänner → accept_terms, then the message goes", calls.some((c) => c[0] === "accept_terms") && calls.some((c) => c[0] === "post_group_msg" && c[1].p_body === "Skål på er!"));
    // long-press a message from Oskar
    // The app cancels a long-press when the list scrolls (by design). On a slow CI machine the list can still be
    // auto-scrolling when we press, so: wait until it is still, then press; try up to 3 times.
    // long-press = the chat's own menu. Shared by both presses below (msg 2 and msg 4): the message is scrolled into view first.
    const longPress = async (mid) => {
      let li = null, box = null, pick = null; const tries = [];
      for (let t = 0; t < 3 && !pick; t++) {
        await page.evaluate(() => { document.querySelectorAll(".toast").forEach((x) => x.remove()); window.__scrolls = 0; const l = document.querySelector(".chat-list, .chat-msgs, #chat-list") || document.querySelector(".chat-msg") && document.querySelector(".chat-msg").parentElement; if (l && !l.__sc) { l.__sc = 1; l.addEventListener("scroll", () => window.__scrolls++); } });
        await page.evaluate((mid) => { const m = document.querySelector('.chat-msg[data-mid="' + mid + '"]'); if (m) m.scrollIntoView({ block: "center" }); }, mid);
        await page.waitForFunction((mid) => { const m = document.querySelector('.chat-msg[data-mid="' + mid + '"]'); if (!m) return false; const y = m.getBoundingClientRect().top; const ok = window.__lastY === y; window.__lastY = y; return ok; }, mid, { timeout: 5000, polling: 300 }).catch(() => {});
        li = await page.$('.chat-msg:not(.me)[data-mid="' + mid + '"] .cm-body');
        box = li && await li.boundingBox();
        if (box) { await page.mouse.move(box.x + 30, box.y + box.height / 2); await page.mouse.down(); await wait(page, 700); await page.mouse.up(); }
        await wait(page, 400);
        pick = await page.evaluate(() => { const p = document.querySelector(".cm-picker"); return p ? [...p.querySelectorAll("button")].map((b) => b.textContent) : null; });
        tries.push(await page.evaluate((b) => ({ scrolls: window.__scrolls, hit: b ? (document.elementFromPoint(b.x + 30, b.y + b.height / 2) || {}).className : null, picker: !!document.querySelector(".cm-picker") }), box));
      }
      console.log("long-press tries msg " + mid, JSON.stringify(tries));
      return { li, box, pick };
    };
    let { li, box, pick } = await longPress("2");
    if (!pick) console.log("long-press debug", JSON.stringify({ li: !!li, box, msgs: await page.evaluate(() => [...document.querySelectorAll(".chat-msg")].map((m) => (m.dataset.mid || "?") + (m.classList.contains("me") ? "me" : "")).join(",")), sheet: await page.evaluate(() => { const s = document.getElementById("sheet"); return s && !s.hidden ? s.textContent.slice(0, 120) : null; }), ov: await page.evaluate(() => { const o = document.querySelector(".sf-ov"); return o ? o.textContent.slice(0, 120) : null; }) }));
    // fixS T-12 (was: ONE icon-only "Anmäl eller blockera" entry): labelled "Anmäl" (PNI flag) + "Blockera" (PNI block) in the menu
    const hasRep = await page.evaluate(() => { const r = document.querySelector(".cm-picker .sa-cm-rep"), b = document.querySelector(".cm-picker .sa-cm-blk");
      return !!(r && b && r.querySelector("svg") && b.querySelector("svg") && r.textContent.trim() === "Anmäl" && b.textContent.trim() === "Blockera"); });
    ok("long-press menu has the Anmäl + Blockera buttons (labelled)", !!pick && hasRep, pick);
    await shot(page, "chat-menu");
    await page.evaluate(() => { const b = document.querySelector(".cm-picker .sa-cm-rep"); if (b) b.click(); });   // → the report sheet at once
    await wait(page, 500);
    await shot(page, "report-sheet");
    await page.evaluate(() => { document.querySelector('.sf-chip[data-r="hat"]').click(); });
    await page.evaluate(() => { const b = [...document.querySelectorAll(".sf-ov button")].find((x) => /Skicka anmälan/.test(x.textContent)); b.click(); });
    await wait(page, 1200);
    const rep = calls.find((c) => c[0] === "report_content");
    ok("🚩 → report_content(msg, 2, hat)", rep && rep[1].p_kind === "msg" && rep[1].p_ref === "2" && rep[1].p_reason === "hat", rep);
    // block from another message
    await longPress("4");
    await page.evaluate(() => { const b = document.querySelector(".cm-picker .sa-cm-blk"); if (b) b.click(); });   // fixS T-12: → the block sheet at once
    await wait(page, 400);
    await shot(page, "block-sheet");
    const blkBtn = await page.evaluate(() => { const b = [...document.querySelectorAll(".sf-ov button")].find((x) => /^(🚫 )?Blockera$/.test(x.textContent.trim())); if (b) b.click(); return !!b; });
    if (!blkBtn) console.log("block sheet debug", JSON.stringify(await page.evaluate(() => ({ ov: (document.querySelector(".sf-ov") || {}).textContent || null, picker: !!document.querySelector(".cm-picker"),
      msgs: [...document.querySelectorAll(".chat-msg")].map((m) => (m.dataset.mid || "?") + (m.classList.contains("me") ? "me" : "")).join(",") }))));
    await wait(page, 1500);
    const blk = calls.find((c) => c[0] === "block_user");
    const left = await page.evaluate(() => [...document.querySelectorAll(".chat-msg:not(.me) .cm-name")].map((x) => x.textContent));
    ok("🚫 → block_user(msg 4); Oskar's rows leave the chat", blk && blk[1].p_kind === "msg" && blk[1].p_ref === "4" && !left.some((n) => /Oskar/.test(n)), { blk, left });
    // member card: 🚩 / 🚫 for a person (key looked up by name)
    await page.evaluate((gid) => window.MEDALS.openMember({ id: gid, name: "Ludvika Lager" }, { name: "Oskar", is_me: false }, null), GID);
    await wait(page, 1500);
    const card = await page.evaluate(() => [...document.querySelectorAll(".sf-person button")].map((b) => b.textContent));
    ok("member card has 🚩 Anmäl + 🚫 Blockera", card.length === 2, card);
    await shot(page, "member-card");
    await page.evaluate(() => [...document.querySelectorAll(".sf-person button")][1].click()); await wait(page, 800);
    await page.evaluate(() => { const b = [...document.querySelectorAll(".sf-ov button")].find((x) => /^(🚫 )?Blockera$/.test(x.textContent.trim())); if (b) b.click(); });
    await wait(page, 1200);
    const blk2 = calls.filter((c) => c[0] === "block_user")[1];
    ok("card block uses the member key", blk2 && blk2[1].p_kind === "person" && blk2[1].p_k === "aaaaaaaaaaaa" && blk2[1].p_group === GID, blk2);
    if (fail > failAtStart) { require("fs").mkdirSync(SP + "traces", { recursive: true }); await ctx.tracing.stop({ path: SP + "traces/safe-chat.zip" }); console.log("trace " + SP + "traces/safe-chat.zip"); }
    else await ctx.tracing.stop();
    await ctx.close();
  }
  // ---------- 4. map, top list, settings, SOS, delete, effects ----------
  {
    const { ctx, page } = await ctxFor(browser, { width: 412, height: 915 }, {});
    page.on("pageerror", (e) => errs.push("4:" + e.message));
    const calls = [], st = { age_ok: true, terms_ver: 1, notices: [{ id: 3, kind: "msg", text: "Något du la upp togs bort efter en anmälan, för att det bröt mot Reglerna.", at: new Date().toISOString() }] };
    await safetyMocks(page, st, calls);
    await boot(page);
    await wait(page, 1000);
    const note = await page.evaluate(() => { const o = document.querySelector(".sf-ov"); return o ? o.textContent : ""; });
    ok("removal notice (DSA art. 17) shown once", /Från PintsNow/.test(note) && /bröt mot Reglerna/.test(note), note.slice(0, 60));
    await shot(page, "notice");
    await page.evaluate(() => { const b = [...document.querySelectorAll(".sf-ov button")].find((x) => /Uppfattat/.test(x.textContent)); if (b) b.click(); });
    await wait(page, 600);
    ok("notice marked seen", calls.some((c) => c[0] === "safety_state" && c[1].p_seen === true));
    const pins = await page.evaluate(() => window.SAFETY._beers().map((b) => ({ n: b.beer_count + (b.other_count | 0), nc: !!b._nc, f: b.friend_name, me: b.is_mine })));
    const strangers = pins.filter((p) => !p.f && !p.me), group = pins.filter((p) => p.f || p.me);
    ok("strangers carry no number (all 1, masked)", strangers.length > 5 && strangers.every((p) => p.nc && p.n === 1), strangers.slice(0, 4));
    ok("own pin + group keep their count (care signal)", group.some((p) => p.f === "Oskar" && p.n >= 11) && group.some((p) => p.me && p.n >= 6), group);
    // top list: only Barer
    await clickJS(page, "#btn-top"); await wait(page, 1200);
    const tabs = await page.evaluate(() => [...document.querySelectorAll("#sheet .tabs button")].map((b) => b.textContent));
    const topTxt = await page.evaluate(() => document.querySelector("#sheet").textContent);
    const appTabs = await page.evaluate(() => [...document.querySelectorAll('#sheet .tabs button[data-k]')].map((b) => b.getAttribute("data-k")));
    ok("Topplista: app tabs = only 'bars'; no törstigaste / Wall of Fame / Städer / Ligan", appTabs.join() === "bars" && !/törstig|Wall of Fame|Städer|🏆 Ligan/.test(topTxt), { appTabs, hit: (topTxt.match(/.{0,60}(törstig|Wall of Fame|Städer|Ligan).{0,60}/i) || [""])[0] });
    await shot(page, "toplist");
    await clickJS(page, "#sheet-close"); await wait(page, 400);
    // settings: one line, Regler, Blockerade, delete v2, no SV/EN
    await page.evaluate(() => { const b = document.querySelector("#btn-settings, [data-open='settings'], #btn-menu"); if (b) b.click(); });
    await wait(page, 1200);
    let setTxt = await page.evaluate(() => document.querySelector("#sheet") && !document.querySelector("#sheet").hidden ? document.querySelector("#sheet").textContent : "");
    if (!/Trygghet/.test(setTxt)) { await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet button, #sheet [role=tab]")].find((x) => /Inställningar/.test(x.textContent)); if (b) b.click(); }); await wait(page, 1000); setTxt = await page.evaluate(() => document.querySelector("#sheet").textContent); }
    ok("⚙️: 'Vi räknar kvällar och kompisar, inte glas.' (one line)", (setTxt.match(/Vi räknar kvällar och kompisar, inte glas\./g) || []).length === 1, setTxt.slice(0, 200));
    ok("⚙️: no SV/EN language switch", !/Språk/.test(setTxt) && !/\bEN\b/.test(setTxt));
    ok("⚙️: 🗑️ Radera mitt konto", /Radera mitt konto/.test(setTxt));
    await page.evaluate(() => { const s = document.querySelector(".sf-set"); if (s) s.scrollIntoView(); }); await wait(page, 300);
    await shot(page, "settings");
    await page.evaluate(() => { const b = [...document.querySelectorAll(".sf-set button")].find((x) => /Blockerade/.test(x.textContent)); b.click(); }); await wait(page, 1000);
    const bl = await page.evaluate(() => document.querySelector(".sf-blist").textContent);
    ok("Blockerade lists Oskar with Häv", /Oskar/.test(bl) && /Häv/.test(bl), bl);
    await shot(page, "blocked-list");
    await page.evaluate(() => { const b = [...document.querySelectorAll(".sf-blist button")][0]; b.click(); }); await wait(page, 800);
    ok("Häv → unblock_user", calls.some((c) => c[0] === "unblock_user" && c[1].p_id === "abcdef0123456789"));
    await page.evaluate(() => { const o = document.querySelector(".sf-ov"); if (o) o.remove(); });
    // SOS block + Följ mig hem: Ring 112 first
    const sos = await page.evaluate(() => { const c = document.createElement("div"); document.body.appendChild(c); window.SOCIAL.sosBlock(c);
      const w = c.querySelector(".sos-block"); const first = w && w.firstElementChild; const r = { first: first ? first.textContent : "", href: first ? first.querySelector("a,.sf-112-btn") && (first.querySelector("a") || {}).getAttribute("href") : "", text: c.textContent }; c.remove(); return r; });
    ok("SOS: 📞 Ring 112 first + 'Appen larmar inte själv.'", /Ring 112/.test(sos.first) && sos.href === "tel:112" && /Appen larmar inte själv\./.test(sos.text), sos);
    await page.evaluate(() => window.HEMFOLJ && window.HEMFOLJ.open ? window.HEMFOLJ.open() : null); await wait(page, 1000);
    const hf = await page.evaluate(() => { const s = document.querySelector("#sheet"); const f = s && s.querySelector(".sf-112"); return f ? [f.textContent, f === s.querySelector("#sheet-body, .sheet-body, .sheet-content") ? 1 : 0] : null; });
    ok("Följ mig hem sheet starts with Ring 112", !!hf && /Ring 112/.test(hf[0]), hf);
    await shot(page, "folj-112");
    // full-screen effects: 5 / 10 / 15 – same takeover, tease + care words
    const fx = [];
    for (const [tot, prev] of [[5, 4], [10, 9], [15, 14]]) {
      await page.evaluate(() => document.querySelectorAll(".takeover").forEach((t) => t.remove()));
      await page.evaluate(([a, b]) => window.__olnuDrinkFx ? window.__olnuDrinkFx(a, b) : null, [tot, prev]);
      await page.evaluate(([a, b]) => { const api = window.SAFETY && window.SAFETY._api; }, [tot, prev]);
      fx.push(tot);
    }
    const lv = await page.evaluate(() => (window.LEVELS_SV || []).filter((l) => [5, 10, 15].includes(l.at)).map((l) => ({ at: l.at, names: l.names, lines: l.lines })));
    const friend = await page.evaluate(() => JSON.stringify(window.LEVEL_FRIEND_SV));
    const i18 = await page.evaluate(() => [window.I18N.t("lvl5"), window.I18N.t("lvl10"), window.I18N.t("hot"), window.I18N.t("medevac"), window.I18N.t("medTitle"), window.I18N.t("hotTitle"), window.I18N.t("care")].join(" | "));
    ok("levels 5, 10 and 15 exist (15 = new full-screen level)", lv.map((l) => l.at).join(",") === "5,10,15", lv.map((l) => l.at));
    ok("owner lines present (10 + 15)", JSON.stringify(lv).includes("🚑 Nr 10. Sjukvårdare till plats 3! Förstärkning på väg: vatten, mat och en kompis.") &&
      JSON.stringify(lv).includes("🛟 Nr 15. Truppen tar över härifrån. Vatten, sen hem. Dä ä en order, la."));
    ok("no banned words in level / friend / i18n level texts", !BANNED.test(JSON.stringify(lv)) && !BANNED.test(friend) && !BANNED.test(i18), (JSON.stringify(lv) + friend + i18).match(BANNED));
    await ctx.close();
  }
  // ---------- 5. takeover at 15 on screen (real drinkFx through a beer tap is covered by strip-test; here FX directly) ----------
  {
    const { ctx, page } = await ctxFor(browser, { width: 412, height: 915 }, {});
    page.on("pageerror", (e) => errs.push("5:" + e.message));
    const calls = [], st = { age_ok: true, terms_ver: 1 };
    await safetyMocks(page, st, calls);
    await boot(page);
    for (const at of [5, 10, 15]) {
      await page.evaluate((at) => { const lv = window.LEVELS_SV.find((l) => l.at === at); window.FX.takeover(at === 5 ? 1 : 2, { title: lv.names[0], sub: lv.lines[0], icon: lv.emoji, color: lv.color, gag: true, hint: "Tryck för att stänga", noAmbient: true }); }, at);
      await wait(page, 1200);
      const t = await page.evaluate(() => { const x = document.querySelector(".takeover"); return x ? x.textContent : ""; });
      ok("takeover " + at + ": full screen, tease + care text", t.length > 10 && !BANNED.test(t) && /Nr /.test(t), t.slice(0, 120));
      await shot(page, "takeover-" + at);
      await page.evaluate(() => document.querySelectorAll(".takeover").forEach((x) => x.click())); await wait(page, 600);
    }
    // duel score = Truppanda; meriter: drink 0; medals: skål
    const dm = await page.evaluate(() => {
      const m = window.MERITER && window.MERITER.ACTS ? window.MERITER.ACTS.find((a) => a[0] === "drink") : null;
      const md = window.MEDALS && window.MEDALS.CAT ? window.MEDALS.CAT.find((c) => c[0] === "m1000") : null;
      return { mer: m && m[2], medal: md && md.join(" ") };
    });
    ok("meriter: a drink gives points (owner 2026-11-08: beers count, nightly cap on the server)", dm.mer === undefined || dm.mer > 0, dm);
    ok("medal m1000 = 1000 beers in total (owner 2026-11-08: lifetime beer medals stay)", !dm.medal || /1000 öl/.test(dm.medal), dm);
    await ctx.close();
  }
  // ---------- 6. store build (?app=android): no Klassiskt pack, no drink deals; Visningsläge off without flag ----------
  {
    const { ctx, page } = await ctxFor(browser, { width: 412, height: 915 }, {});
    page.on("pageerror", (e) => errs.push("6:" + e.message));
    const calls = [], st = { age_ok: true, terms_ver: 1, config: { v: 1 } };
    await safetyMocks(page, st, calls);
    await page.goto(BASE + "?app=android"); await wait(page, 6000);
    const s = await page.evaluate(() => ({ flag: window.OLNU_STORE, cls: document.documentElement.classList.contains("olnu-store"),
      packs: window.OLNU_PEN ? window.OLNU_PEN.packs().map((p) => p.id) : null, demo: window.DEMO ? window.DEMO.on() : null,
      offerHidden: (() => { const d = document.createElement("div"); d.className = "bp-of"; document.body.appendChild(d); const h = getComputedStyle(d).display === "none"; d.remove(); return h; })() }));
    ok("?app=android → OLNU_STORE + html.olnu-store", s.flag === true && s.cls, s);
    ok("store: penalty packs without Klassiskt", Array.isArray(s.packs) && !s.packs.includes("klunk") && s.packs.includes("utm"), s.packs);
    ok("store: user drink deals hidden", s.offerHidden, s);
    ok("Visningsläge off when the server flag is missing", s.demo === false, s.demo);
    await ctx.close();
    const w = await ctxFor(browser, { width: 412, height: 915 }, {});
    await safetyMocks(w.page, { age_ok: true, terms_ver: 1, config: { v: 1 } }, []);
    await w.page.goto(BASE); await wait(w.page, 5000);
    const web = await w.page.evaluate(() => ({ flag: window.OLNU_STORE, packs: window.OLNU_PEN ? window.OLNU_PEN.packs().map((p) => p.id) : null, demo: window.DEMO ? window.DEMO.on() : null }));
    ok("web build keeps Klassiskt; demo still off without flag", web.flag === false && web.packs.includes("klunk") && web.demo === false, web);
    await w.ctx.close();
  }
  // ---------- 7. delete v2 ----------
  {
    const { ctx, page } = await ctxFor(browser, { width: 412, height: 915 }, {});
    page.on("pageerror", (e) => errs.push("7:" + e.message));
    const calls = [];
    await safetyMocks(page, { age_ok: true, terms_ver: 1 }, calls);
    await boot(page);
    await page.evaluate(() => window.PRIVACY.showDelete()); await wait(page, 800);
    // misc X4: "Radera mitt konto" opens the 7-day sheet (misc-mod.js); the instant delete is its "Radera direkt" link
    await page.evaluate(() => { const b = document.querySelector("#sheet-body .mm-del-now"); if (b) b.click(); }); await wait(page, 800);
    await shot(page, "delete-1");
    await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet button")].find((x) => /Ja, radera/.test(x.textContent)); b.click(); }); await wait(page, 400);
    await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet button")].find((x) => /Radera nu/.test(x.textContent)); b.click(); });
    const cleared = await page.waitForFunction(() => !localStorage.getItem("olnu.auth") && !localStorage.getItem("olnu.name"), null, { timeout: 4000 }).then(() => true, () => false);
    await wait(page, 3000);
    ok("delete → delete_my_data_v2 (not v1)", calls.some((c) => c[0] === "delete_my_data_v2") && !calls.some((c) => c[0] === "delete_my_data"), calls.map((c) => c[0]).filter((n) => /delete/.test(n)));
    ok("phone cleared after delete (session + name gone before the restart)", cleared, cleared);
    await ctx.close();
  }
  // ---------- 8. privacy text in the app ----------
  {
    const { ctx, page } = await ctxFor(browser, { width: 412, height: 915 }, {});
    await safetyMocks(page, { age_ok: true, terms_ver: 1 }, []);
    await boot(page);
    await page.evaluate(() => window.PRIVACY.showPrivacy()); await wait(page, 800);
    const t = await page.evaluate(() => document.querySelector("#sheet").textContent);
    ok("Integritet: e-mail login, Swish, speed data, 30 days, processors, contact",
      /E-post/.test(t) && /Swish/.test(t) && /telefonmodell/i.test(t) && /30 dagar/.test(t) && /Supabase/.test(t) && /Mapbox/.test(t) && /Google Workspace/.test(t) && /GitHub Pages/.test(t) && /support@pintsnow\.com/.test(t) && !/Ingen e-post, inget telefonnummer/.test(t), t.slice(0, 200));
    await shot(page, "privacy");
    await ctx.close();
  }
  // ---------- 9. web pages + owner panel ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errs.push("9:" + e.message));
    for (const p of ["radera", "regler", "integritet"]) {
      await page.goto(BASE + p + ".html"); await wait(page, 500);
      const t = await page.evaluate(() => document.body.textContent);
      const mail = await page.evaluate(() => !!document.querySelector('a[href^="mailto:support@pintsnow.com?subject=Radera"]'));
      ok(p + ".html: support address" + (p === "radera" ? " + mailto delete request" : ""), /support@pintsnow\.com/.test(t) && (p !== "radera" || mail), t.slice(0, 80));
      await page.screenshot({ path: SP + "safe-page-" + p + ".png", fullPage: true }); console.log("shot " + SP + "safe-page-" + p + ".png");
    }
    const calls = [];
    await page.route(/rest\/v1\/rpc\/(\w+)/, (r) => {
      const fn = r.request().url().match(/rpc\/(\w+)/)[1]; let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
      calls.push([fn, b]);
      if (fn === "owner_reports") return J(r, { generated_at: new Date().toISOString(), open: 2, oldest_open_h: 3.5, reports: [
        { id: 11, kind: "msg", ref: "341", reason: "hat", note: "Elak mot Lisa", excerpt: "Din f****", status: "new", created_at: new Date(Date.now() - 3.5 * 3600e3).toISOString(), same: 3, author_30d: 2, author: "1a2b3c4d", photo_id: null },
        { id: 12, kind: "photo", ref: "77", reason: "sex", note: null, excerpt: "[📷 77]", status: "new", created_at: new Date(Date.now() - 600e3).toISOString(), same: 1, author_30d: 1, author: "9f8e7d6c", photo_id: 77 }] });
      if (fn === "owner_report_act") return J(r, { ok: true, status: b.p_action });
      if (fn === "owner_stats") return J(r, { generated_at: new Date().toISOString(), users: {}, beers: {}, places: {}, social: {}, care: {}, tech: {} });
      return J(r, null);
    });
    await page.addInitScript(() => sessionStorage.setItem("olnu.ownerKey", "test-key"));
    await page.goto(BASE + "stats.html"); await wait(page, 3000);
    await page.evaluate(() => { const m = document.getElementById("main"); if (m) m.hidden = false; const l = document.getElementById("login"); if (l) l.hidden = true; });
    await wait(page, 2500);
    const pan = await page.evaluate(() => { const p = document.getElementById("pUgc"); return p && !p.hidden ? p.textContent : ""; });
    ok("stats.html: 🚩 Anmälningar panel with age of oldest report", /Anmälningar/.test(pan) && /2 öppna/.test(pan) && /3,5 h/.test(pan) && /Din f\*\*\*\*/.test(pan), pan.slice(0, 160));
    await page.evaluate(() => document.getElementById("pUgc").scrollIntoView()); await wait(page, 300);
    await page.screenshot({ path: SP + "safe-stats-reports.png" }); console.log("shot " + SP + "safe-stats-reports.png");
    await page.evaluate(() => document.querySelector('#pUgc [data-rep="11"] [data-act="dismiss"]').click()); await wait(page, 800);
    ok("owner ✅ OK → owner_report_act(dismiss)", calls.some((c) => c[0] === "owner_report_act" && c[1].p_id === 11 && c[1].p_action === "dismiss" && c[1].p_key === "test-key"));
    await ctx.close();
  }
  ok("no page errors", errs.length === 0, errs);
  await browser.close();
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
