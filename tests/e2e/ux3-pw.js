// ux3: Android back stack, ← one step, grip drag, constant Grupper height, chat ⚙️ + day separators, 🚪 Checka ut, first-visit install card.
// Usage: node ux3-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8905, BASE = `http://127.0.0.1:${PORT}/`;
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const G = "11111111-2222-3333-4444-555555555555";
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 300)); };
const shot = (page, n) => page.screenshot({ path: SP + "ui-testshots/ux3-ds-" + n + ".png" }).then(() => console.log("shot " + SP + "ux3-" + n + ".png"));
const day = (d, hh) => { const x = new Date(); x.setDate(x.getDate() - d); x.setHours(hh, 14, 0, 0); return x.toISOString(); };
const calls = []; let outDone = false;
const st = (page) => page.evaluate(() => ({ open: !document.getElementById("sheet").hidden, title: document.getElementById("sheet-title").textContent,
  gv: (document.querySelector("#sheet-body [data-gv]") || { getAttribute: () => null }).getAttribute("data-gv"), depth: window.SHEETNAV ? window.SHEETNAV.depth() : -1, url: location.href }));
const noToasts = (page) => page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  const errs = [];
  {
    const { ctx, page } = await ctxFor(browser, { width: 412, height: 915 }, {});
    page.on("pageerror", (e) => errs.push(e.message));
    await page.route(/rest\/v1\/rpc\/(my_groups|group_status_v3|group_status_v2|group_msgs|check_out|my_friends|friend_list|live_checkins)$/, (r) => {
      const fn = r.request().url().match(/rpc\/(\w+)/)[1];
      let b = {}; try { b = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
      calls.push([fn, b]);
      switch (fn) {
        case "my_groups": return J(r, [{ id: G, name: "Ludvika Lager", code: "ABC234", member_count: 4, active_count: 3 }, { id: "22222222-2222-3333-4444-555555555555", name: "Jobbet", code: "XYZ789", member_count: 9, active_count: 0 }]);
        case "group_status_v3": case "group_status_v2": return J(r, [{ name: "Anton", k: "k0", is_me: true, beers: 3, others: 0, live: true, total: 40, meriter: 12 }, { name: "Lisa", k: "k1", is_me: false, beers: 2, others: 0, live: true, total: 18, meriter: 5 }]);
        case "group_msgs": return J(r, b.p_after_id > 0 ? [] : [
          { id: 1, name: "Lisa", body: "Va ä ni?", created_at: day(3, 21), is_me: false },
          { id: 2, name: "Oskar", body: "La Parma!", created_at: day(3, 22), is_me: false },
          { id: 3, name: "Anton", body: "Kommer", created_at: day(1, 20), is_me: true },
          { id: 4, name: "Oskar", body: "🚁🚁🚁", created_at: day(0, 0), is_me: false }]);
        case "check_out": outDone = true; return J(r, { ok: true, bar_id: "n3472634175", bar_name: "Pitchers" });
        case "live_checkins": return J(r, outDone ? [] : [{ bar_id: "n3472634175", bar_name: "Pitchers", lat: 60.14997, lng: 15.18679, name: "Anton", is_mine: true, is_friend: false, created_at: new Date(Date.now() - 90 * 60e3).toISOString() }]);
        case "my_friends": return J(r, { code: "K7Q2MXA", friends: [], incoming: [], outgoing: [] });
        case "friend_list": return J(r, { v: 1, people: [], groups: [] });
      }
    });
    await boot(page);
    await noToasts(page);
    await page.evaluate(() => { try { localStorage.setItem("olnu.gtab", "g"); localStorage.setItem("olnu.ibTab", "0"); } catch (e) {} });
    const h0 = await page.evaluate(() => history.length);
    // ---- Grupper sheet ----
    await page.click("#btn-groups"); await wait(page, 1300); await noToasts(page);
    let s = await st(page);
    ok(s.open && s.depth === 1, "Grupper open, depth 1", s);
    ok(await page.evaluate(() => !document.querySelector("#sheet-body .namebar") && !/Byt namn/.test(document.getElementById("sheet-body").textContent)), "no name / Byt namn in Grupper");
    ok(await page.evaluate(() => { const l = document.querySelector("#sheet-body .glist"), e = document.querySelector("#sheet-body .evc-sec"); return !e || !!(l.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING); }), "my groups above tonight's events");
    await shot(page, "1-groups");
    // constant height on all tabs
    const dims = [];
    for (const t of ["g", "f", "i", "g"]) {
      await page.evaluate((t) => document.querySelector('.inv-tabs [data-t="' + t + '"]').click(), t); await wait(page, 900);
      dims.push(await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { sh: Math.round(r("#sheet").height), grip: Math.round(r("#sheet .sheet-grip").height), head: Math.round(r("#sheet .sheet-head").height), gTop: Math.round(r("#sheet .sheet-grip").top - r("#sheet").top), hTop: Math.round(r("#sheet .sheet-head").top - r("#sheet").top) }; }));
      if (t === "f") { await noToasts(page); await shot(page, "2-friends-tab"); }
    }
    ok(dims.every((d) => JSON.stringify(d) === JSON.stringify(dims[0])), "same sheet height + handle on Grupper/Vänner/Inkorg", dims);
    s = await st(page); ok(s.depth === 1, "tab taps add no back levels", s);
    // ---- group page → ⋯ → Medlemmar → ← (one step) ----
    await page.click(".glist .gcard >> nth=0"); await wait(page, 1300);
    s = await st(page); ok(s.title === "Ludvika Lager" && s.depth === 2, "group page = level 2", s);
    await page.click(".gpg-dots"); await wait(page, 500);
    s = await st(page); ok(s.gv === "info" && s.depth === 3, "⋯ info = level 3 (sub-view)", s);
    await page.evaluate(() => { const b = [...document.querySelectorAll(".gpg-info .gpg-row")].find((x) => /Medlemmar/.test(x.textContent)); b.click(); }); await wait(page, 1300);
    s = await st(page); ok(s.gv === null && s.depth === 4 && await page.evaluate(() => !!document.querySelector("#sheet-body .st-list, #sheet-body .st-row")), "Medlemmar = level 4", s);
    await noToasts(page); await shot(page, "3-members");
    const backBtn = await page.evaluate(() => { const b = [...document.querySelectorAll("#sheet-body button")].find((x) => /^[←‹]/.test(x.textContent.trim())); if (b) { b.click(); return b.textContent; } return null; });
    await wait(page, 1200);
    s = await st(page); ok(backBtn && s.title === "Ludvika Lager" && s.gv === "info" && s.depth === 3, "← in Medlemmar goes back ONE step (group page, ⋯ view)", [backBtn, s]);
    // Android back at each level
    await page.evaluate(() => { const b = [...document.querySelectorAll(".gpg-info .gpg-row")].find((x) => /Medlemmar/.test(x.textContent)); b.click(); }); await wait(page, 1200);
    s = await st(page); ok(s.depth === 4, "Medlemmar again (level 4)", s);
    await page.goBack(); await wait(page, 1000);
    s = await st(page); ok(s.title === "Ludvika Lager" && s.gv === "info" && s.depth === 3, "Android back: Medlemmar → group page ⋯", s);
    await page.goBack(); await wait(page, 800);
    s = await st(page); ok(s.title === "Ludvika Lager" && s.gv === "home" && s.depth === 2, "Android back: ⋯ → group page home", s);
    await page.goBack(); await wait(page, 1000);
    s = await st(page); ok(s.title === "Grupper" && s.open && s.depth === 1, "Android back: group page → Grupper", s);
    await page.goBack(); await wait(page, 800);
    s = await st(page); ok(!s.open && s.depth === 0 && s.url.startsWith(BASE), "Android back: Grupper → sheet closed, still in the app", s);
    ok(await page.evaluate(() => !!window.__map && document.getElementById("btn-groups") !== null), "app still running after 4 backs");
    // ✕ after deep nav unwinds history (next back would leave)
    await page.click("#btn-groups"); await wait(page, 1200);
    await page.click(".glist .gcard >> nth=0"); await wait(page, 1200);
    await page.evaluate(() => document.getElementById("sheet-close").click()); /* pnds: ✕ hides on sub-screens; same close-all action */ await wait(page, 600);
    const hl = await page.evaluate(() => ({ len: history.length, st: history.state }));
    s = await st(page); ok(!s.open && s.depth === 0 && !(hl.st && hl.st.olnuNav), "✕ closes all levels and unwinds history", [s, hl, h0]);
    // ---- grip drag ----
    await page.click("#btn-groups"); await wait(page, 1300);
    let g = await page.evaluate(() => { const r = document.querySelector("#sheet .sheet-grip").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x, g.y + 30, { steps: 6 }); await page.mouse.up(); await wait(page, 500);
    s = await st(page); ok(s.open, "small slow drag springs back (sheet stays)", s);
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    await page.mouse.move(g.x, g.y + 60, { steps: 3 });
    const mid = await page.evaluate(() => document.getElementById("sheet").style.transform);
    await page.mouse.move(g.x, g.y + 320, { steps: 4 }); await page.mouse.up(); await wait(page, 600);
    s = await st(page); ok(/translateY\(\d/.test(mid) && !s.open && s.depth === 0, "drag the grip down → sheet follows and closes", [mid, s]);
    // ---- chat: ⚙️ + day separators ----
    await page.evaluate((G) => window.SOCIAL.openChat({ id: G, name: "Ludvika Lager" }), G); await wait(page, 1800); await noToasts(page);
    const ch = await page.evaluate(() => {
      const vis = (e) => !!e && e.getClientRects().length > 0 && !e.closest("[hidden]");
      return { cog: !!document.querySelector(".ux-chat-top .ux-cog"), note: vis(document.querySelector(".chat-note")), keep: vis(document.querySelector(".chat-keep")),
        days: [...document.querySelectorAll(".chat-list > .ux-day")].map((x) => x.textContent), exp: [3, 1, 0].map((d) => { const x = new Date(); x.setDate(x.getDate() - d); return window.UXFIX.dayLabel(x.toISOString()); }) };
    });
    ok(ch.cog && !ch.note && !ch.keep, "chat: ⚙️ in the head, no keep note in the body", ch);
    ok(JSON.stringify(ch.days) === JSON.stringify(ch.exp) && ch.days[1] === "Igår" && ch.days[2] === "Idag", "day separators: date / Igår / Idag", ch);
    await shot(page, "4-chat");
    await page.evaluate(() => document.querySelector(".chat-msg .cm-time").click()); await wait(page, 200);
    const ft = await page.evaluate(() => document.querySelector(".chat-msg .cm-time").textContent);
    ok(/\d{4} · \d\d:\d\d/.test(ft), "tap a time → full date", ft);
    await page.click(".ux-cog"); await wait(page, 400);
    ok(await page.evaluate(() => !document.querySelector(".ux-cset").hidden && /sparar|chatten/i.test(document.querySelector(".ux-cset").textContent)), "⚙️ opens chat settings with the keep info");
    await shot(page, "5-chat-settings");
    await page.goBack(); await wait(page, 500);
    s = await st(page);
    ok(s.open && await page.evaluate(() => document.querySelector(".ux-cset").hidden), "Android back closes chat settings, chat stays", s);
    await page.evaluate(() => document.getElementById("sheet-close").click()); /* pnds: ✕ hides on sub-screens; same close-all action */ await wait(page, 500);
    // ---- 🚪 Checka ut ----
    await page.evaluate(() => window.__map.setView([60.14997, 15.18679], 17, { animate: false })); await wait(page, 1800);
    const opened = await page.evaluate(() => { let m = null; window.__map.eachLayer((l) => { const c = l.options && l.options.olnuC; if (!m && c && c.bar && String(c.bar.id) === "n3472634175") m = l; }); if (m) { m.openPopup(); return true; } return false; });
    await wait(page, 1200); await noToasts(page);
    const ci = await page.evaluate(() => ({ out: !!document.querySelector(".leaflet-popup [data-ciout]"), here: (document.querySelector(".leaflet-popup .ci-here") || {}).textContent }));
    ok(opened && ci.out, "bar sheet where I am checked in shows 🚪 Checka ut", [opened, ci]);
    await shot(page, "6-bar-checkout");
    s = await st(page); ok(s.depth === 1, "bar sheet = one back level", s);
    await page.goBack(); await wait(page, 700);
    s = await st(page); ok(!(await page.$(".leaflet-popup")) && s.depth === 0, "Android back closes the bar sheet", s);
    await page.evaluate(() => { let m = null; window.__map.eachLayer((l) => { const c = l.options && l.options.olnuC; if (!m && c && c.bar && String(c.bar.id) === "n3472634175") m = l; }); if (m) m.openPopup(); });
    await wait(page, 1000); await noToasts(page);
    await page.evaluate(() => document.querySelector(".leaflet-popup [data-ciout]").click()); await wait(page, 1000);
    const co = await page.evaluate(() => ({ ls: localStorage.getItem("olnu.checkin"), toast: [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | ") }));
    ok(calls.some((c) => c[0] === "check_out") && !co.ls && /Utcheckad|utcheckad|Lämnat/.test(co.toast), "check_out RPC + local check-in gone + toast", co);
    await shot(page, "7-checked-out");
    await ctx.close();
  }
  // ---- first visit install card ----
  const UAS = {
    android: "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
    ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    desktop: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36" };
  for (const k of ["android", "ios", "desktop"]) {
    const mob = k !== "desktop";
    const ctx = await browser.newContext({ viewport: mob ? { width: 412, height: 915 } : { width: 1280, height: 800 }, isMobile: mob, hasTouch: mob, userAgent: UAS[k], locale: "sv-SE", deviceScaleFactor: mob ? 2 : 1 });
    await ctx.route(/supabase\.co/, (r) => J(r, []));
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(BASE); await wait(page, 3500);
    const r = await page.evaluate(() => ({ card: !!document.getElementById("ux-inst"), intro: !document.getElementById("intro").hidden, steps: document.querySelectorAll("#ux-inst .mn-inst-step").length,
      qr: !!document.querySelector("#ux-inst .mn-inst-qr"), txt: (document.getElementById("ux-inst") || {}).textContent || "", skip: !!document.querySelector(".mn-inst-skip") }));
    // lane main S5 (owner 10 Nov): on a phone the install guide is the FIRST thing (before the tour); a desktop gets the tour
    if (mob) ok(r.card && !r.intro, k + ": [S5] the install guide first, the tour waits", r);
    else ok(!r.card && r.intro, k + ": [S5] desktop: no install guide, the tour comes first", r);
    if (!r.card) { await page.evaluate(() => { document.getElementById("intro").hidden = true; window.INSTALL1.show(); }); await wait(page, 500); }
    Object.assign(r, await page.evaluate(() => ({ card: !!document.getElementById("ux-inst"), steps: document.querySelectorAll("#ux-inst .mn-inst-step").length,
      qr: !!document.querySelector("#ux-inst .mn-inst-qr"), txt: (document.getElementById("ux-inst") || {}).textContent || "", skip: !!document.querySelector(".mn-inst-skip") })));
    ok(r.card && r.skip && /Fortsätt utan att installera/.test(r.txt), k + ": [S5] the guide with 'Fortsätt utan att installera'", r);
    if (k === "android") ok(r.steps === 3 && !r.qr && /Installera app/.test(r.txt), "android: 3 install steps, no QR", r);
    if (k === "ios") ok(r.steps === 3 && !r.qr && /Lägg till på hemskärmen/.test(r.txt), "ios: Dela → Lägg till på hemskärmen steps, no QR", r);
    if (k === "desktop") ok(r.qr, "desktop: QR code", r);
    await shot(page, "8-install-" + k);
    if (k === "android") {
      await page.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => { window.__prompted = 1; }; e.userChoice = Promise.resolve({ outcome: "accepted" }); window.dispatchEvent(e); }); await wait(page, 300);
      const b = await page.evaluate(() => { const x = document.querySelector("#ux-inst .mn-inst-go"); return x ? x.textContent : null; });
      ok(/Installera (Öl Nu|PintsNow|appen)/.test(b || ""), "android: install event → one-tap button", b);
      await shot(page, "9-install-android-onetap");
      await page.click("#ux-inst .mn-inst-go"); await wait(page, 400);
      ok(await page.evaluate(() => window.__prompted === 1 && /Klart/.test(document.getElementById("ux-inst").textContent)), "tap → prompt() → Klart");
    }
    await page.click(".mn-inst-skip"); await wait(page, 800);
    const after = await page.evaluate(() => ({ card: !!document.getElementById("ux-inst") }));
    ok(!after.card, k + ": [S5] 'Fortsätt utan att installera' → the card closes", after);
    await ctx.close();
  }
  { // [ui-build] an in-app browser (storage is lost there) still gets the card first
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, locale: "sv-SE",
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36 Instagram 350.0" });
    await ctx.route(/supabase\.co/, (r) => J(r, []));
    const page = await ctx.newPage(); page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(BASE); await wait(page, 3500);
    const r = await page.evaluate(() => ({ card: !!document.getElementById("ux-inst"), intro: !document.getElementById("intro").hidden }));
    ok(r.card && !r.intro, "inapp: [ui-build] install card first (open in the browser)", r);
    await ctx.close();
  }
  ok(errs.length === 0, "no page errors", errs);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
