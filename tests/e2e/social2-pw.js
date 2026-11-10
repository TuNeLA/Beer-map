// social2 Playwright test: group page (home / + / ⋯), quick chat, 🍺, 🔔 Inkorg, 👋 Du kanske känner, event link sheet,
// welcome card answer-first (group + event) in a fresh browser. Usage: node social2-pw.js <port>
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8871, BASE = `http://127.0.0.1:${PORT}/`;
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const GID = "11111111-2222-3333-4444-555555555555";
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i))); c ? pass++ : fail++; };
const calls = [];
async function extra(page) {
  await page.route(/rest\/v1\/rpc\/(group_now|my_inbox|friend_suggest|friend_suggest_hide|friend_suggest_add|friend_answer|post_group_msg|ev_preview|ev_join|ev_link|join_preview|join_group|my_groups|invite_get)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    calls.push([fn, body]);
    switch (fn) {
      case "my_groups": return J(r, [{ id: GID, name: "Ludvika Lager", code: "ABC234", member_count: 4, active_count: 3 }, { id: "22222222-2222-3333-4444-555555555555", name: "Jobbet", code: "XYZ789", member_count: 9, active_count: 0 }]);
      case "group_now": return J(r, { v: 1, now: new Date().toISOString(), members: 4, out: [
        { name: "Oskar", i: "O", place: "La Parma Pub & Restaurang", bar_id: null, drinks: 11, at: iso(4), me: false },
        { name: "Anton", i: "A", place: "Pitchers", bar_id: null, drinks: 6, at: iso(20), me: true },
        { name: "Lisa", i: "L", place: null, bar_id: null, drinks: 2, at: iso(35), me: false }],
        last: { name: "Oskar", kind: "beer", place: "La Parma Pub & Restaurang", at: iso(4), me: false } });
      case "my_inbox": return J(r, { v: 1, now: new Date().toISOString(), items: [
        { k: "friend:5", type: "friend", id: 5, name: "Kalle", home_town: null, at: iso(3) },
        { k: "rally:77", type: "rally", id: 77, group_id: GID, group_name: "Ludvika Lager", name: "Oskar", body: "Alla till La Parma!", place: "La Parma", yes: 2, at: iso(6) },
        { k: "inv:9", type: "inv", id: 9, title: "🧠 Pubquiz på Pitchers", starts_at: new Date(Date.now() + 3 * 3600e3).toISOString(), place: "Pitchers", from: "Lisa", group_name: null, at: iso(30) },
        { k: "duel:4", type: "duel", id: 4, group_id: GID, group_name: "Ludvika Lager", opp: "Borlänge Bärs", answer_by: iso(-60), at: iso(50) },
        { k: "rsvp:3:x", type: "rsvp", id: 3, title: "🍺 Fredagsöl", name: "Ida", answer: "yes", starts_at: new Date(Date.now() + 26 * 3600e3).toISOString(), at: iso(200) }] });
      case "friend_suggest": return J(r, { v: 1, people: [{ k: "0123456789abcdef", name: "Maja", mutual: 3 }, { k: "fedcba9876543210", name: "Erik", mutual: 1 }] });
      case "friend_suggest_hide": return J(r, { ok: true });
      case "friend_suggest_add": return J(r, { id: 1, status: "pending", name: "Maja" });
      case "friend_answer": return J(r, { id: 5, status: "accepted", name: "Kalle" });
      case "post_group_msg": return J(r, { id: 99, created_at: new Date().toISOString() });
      case "ev_preview": return J(r, { ok: true, token: "QWE234", title: "🧠 Pubquiz på Pitchers", place: "Pitchers", starts_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
        live: true, from: "Lisa", creator: "Lisa", yes: 3, maybe: 1, faces: ["L", "O", "A"], member: false, my_answer: "none", id: null });
      case "ev_join": return J(r, { id: 9, my_answer: body.p_answer, yes: 4, maybe: 1, push_yes: true, token: "QWE234", faces: ["L", "O", "A", "T"] });
      case "ev_link": return J(r, { token: "QWE234", expires_at: new Date(Date.now() + 9 * 3600e3).toISOString() });
      case "join_preview": return J(r, { ok: true, name: "Ludvika Lager", members: 4, member: false, out: 2, faces: ["O", "L", "A", "N"] });
      case "join_group": return J(r, { id: GID, name: "Ludvika Lager", code: "ABC234" });
      case "invite_get": return J(r, { id: 9, title: "🧠 Pubquiz på Pitchers", kind: "quiz", place: "Pitchers", lat: 60.15, lng: 15.18, starts_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
        ends_at: new Date(Date.now() + 9 * 3600e3).toISOString(), status: "open", creator_name: "Lisa", mine: false, my_answer: "yes", yes: 4, maybe: 1, no: 0, none: 2, n: 7, live: true, can_add: true,
        people: [{ name: "Lisa", answer: "yes", is_me: false, is_creator: true }, { name: "Anton", answer: "yes", is_me: true, is_creator: false }] });
    }
  });
}
const vis = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== "none"; }, sel);
const shot = (page, n) => page.screenshot({ path: SP + "ui-testshots/social2-" + n + ".png" }).then(() => console.log("shot", SP + "social2-" + n + ".png"));

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  const errs = [];
  // ---------- 1. group page ----------
  {
    const { ctx, page } = await ctxFor(browser, { width: 412, height: 915 }, {});
    page.on("pageerror", (e) => errs.push(e.message));
    await page.addInitScript(() => { window.TESTMOD = { groupActions: (g) => [{ id: "t1", icon: "💸", label: "Jag bjöd", sub: "skriv upp en runda", onClick: () => { window.__ga = g.id; } }] }; });
    await extra(page);
    await boot(page);
    await page.evaluate(() => { document.querySelectorAll(".toast").forEach((t) => t.remove()); localStorage.setItem("olnu.ibTab", "0"); });
    ok("inbox badge on Grupper button", await page.evaluate(() => { const b = document.getElementById("ib-badge"); return b && !b.hidden && b.textContent === "5"; }), await page.evaluate(() => (document.getElementById("ib-badge") || {}).outerHTML));
    await page.click("#btn-groups"); await wait(page, 1200);
    await page.evaluate(() => { const c = [...document.querySelectorAll(".glist .gcard")].find((x) => /Ludvika/.test(x.textContent)); c.click(); }); await wait(page, 2200);
    ok("home: Nu strip", await vis(page, ".gpg-now") && /3 ute nu/.test(await page.textContent(".gpg-now")) && /La Parma/.test(await page.textContent(".gpg-now")), await page.textContent(".gpg-now"));
    ok("home: faces 3", (await page.$$(".gpg-now .gpg-face")).length === 3);
    ok("home: chat preview 3 msgs", (await page.$$(".gpg-msgs .gpg-msg")).length === 3);
    ok("home: [ds52] bar = labelled Ikväll, no 🍺", await vis(page, ".gpg-plus") && /Ikväll/.test(await page.textContent(".gpg-plus")) && !(await vis(page, ".gpg-beer")));
    ok("home: [ds52] Bjud in button + [ds60] group code on the page", await vis(page, ".pn-gp-inv") && /Bjud in/.test(await page.textContent(".pn-gp-inv")) && /ABC234/.test(await page.textContent(".pn-gp-code")));
    ok("home: [ds52] Om gruppen row (.gpg-dots)", await vis(page, ".gpg-dots") && /Om gruppen/.test(await page.textContent(".gpg-dots")));
    // gpage.js menuOf(): home = header, Nu, chat, bar, ⋯, 🎉 Spel, 📸 kamera + anything LIVE right now (a tile with .live / .new /
    // .cer-hot, e.g. 🚗 "Kör ikväll" when a member drives tonight: skjuts.js). Everything else lives behind + / ⋯.
    const homeTiles = await page.evaluate(() => [...document.querySelectorAll(".gpg > *")].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && getComputedStyle(e).display !== "none"; })
      .map((e) => e.className.split(" ")[0] + (e.querySelector(".live, .new, .cer-hot") || e.classList.contains("rl-group-item") ? ":live" : "")));
    ok("home: only header, Nu, chat, bar (+ ⋯), Spel, kamera + live tiles", homeTiles.every((c) => /^(gmain|gpg-now|gpg-chat|gpg-bar|gpg-dots|sp-gi|fm-gi|pn-gp-inv|pn-gp-code|pn-gp-mem|sa-gk)$|:live$/.test(c)), homeTiles);
    ok("home: old 💬 Chatt button gone", !(await page.evaluate(() => [...document.querySelectorAll(".gpg > .row")].some((r) => /💬/.test(r.textContent) && r.getBoundingClientRect().height > 0))));
    await shot(page, "group-home");
    // quick reply
    await page.fill(".gpg-inp", "Kommer om 10"); await page.click(".gpg-send"); await wait(page, 900);
    ok("quick reply posts", calls.some((c) => c[0] === "post_group_msg" && c[1].p_body === "Kommer om 10" && c[1].p_group_id === GID));
    // + menu
    await page.click(".gpg-plus"); await wait(page, 600);
    const plusVis = await page.evaluate(() => [...document.querySelectorAll(".gpg > *")].filter((e) => e.getBoundingClientRect().height > 0).map((e) => (e.textContent || "").trim().slice(0, 22)));
    ok("+: [ui-build] Kalla in + Spel visible, Bjud in only in ⋯", ["Kalla in", "Spel"].every((w) => plusVis.some((t) => t.indexOf(w) >= 0)) && !plusVis.some((t) => /Bjud in till/.test(t)), plusVis);
    ok("+: groupActions item (Jag bjöd)", plusVis.some((t) => /Jag bjöd/.test(t)), plusVis);
    ok("+: Nu/chat/bar hidden", !(await vis(page, ".gpg-now")) && !(await vis(page, ".gpg-chat")) && !(await vis(page, ".gpg-bar")));
    ok("+: [ui-build] one list, no fold: Gänget visible, no Mer… button", plusVis.some((t) => /Gänget/.test(t)) && !(await vis(page, ".gpg-fold")), plusVis);
    ok("+: chief/leave not here", !plusVis.some((t) => /Lämna|Gruppchef/.test(t)), plusVis);
    await shot(page, "plus");
    ok("+ [ui-build] list: Gänget + Spel (duels live in the 🎉 Spel hub)", plusVis.some((t) => /Gänget/.test(t)) && plusVis.some((t) => /Spel/.test(t)), plusVis);
    await page.evaluate(() => [...document.querySelectorAll(".gpg-ga .btn")].find((b) => /Jag bjöd/.test(b.textContent)).click());
    ok("groupActions onClick gets g", await page.evaluate((gid) => window.__ga === gid, GID));
    await page.click("#pn-back"); await wait(page, 300);
    ok("[ui-build] header ‹ → home", await vis(page, ".gpg-now"));
    // ⋯ menu
    await page.click(".gpg-dots"); await wait(page, 600);
    const infoVis = await page.evaluate(() => [...document.querySelectorAll(".gpg > *")].filter((e) => e.getBoundingClientRect().height > 0).map((e) => (e.textContent || "").trim().slice(0, 26)));
    ok("⋯: members, code, leave [ui-build: the code is only in the ⋯ Kod row, not in the subtitle]", infoVis.some((t) => /Medlemmar/.test(t)) && /ABC234/.test(await page.evaluate(() => { const c = document.querySelector(".gpg-code-v"); return c && c.getBoundingClientRect().height > 0 ? c.textContent : ""; })) && infoVis.some((t) => /Lämna/.test(t)), infoVis);
    ok("⋯: no game tiles", !infoVis.some((t) => /Lek|Förfest|Kalla in/.test(t)), infoVis);
    await shot(page, "info");
    await page.click("#pn-back"); await wait(page, 300);
    // ds52: no 🍺 on the group page (ÖL! lives on the map): Bjud in opens the invite instead
    await page.click(".pn-gp-inv"); await wait(page, 1200);
    ok("[ds52] Bjud in → invite sheet", /Bjud in/.test(await page.textContent("#sheet-title")));
    await page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c && !document.getElementById("sheet").hidden) c.click(); document.querySelectorAll(".bp-strip").forEach((s) => s.hidden = true); });
    await wait(page, 600);
    // ---------- inbox ----------
    await page.evaluate(() => window.INBOX.open()); await wait(page, 1500);
    ok("inbox tab open", await vis(page, "#inv-pane-i") && (await page.$$("#inv-pane-i .ib-item")).length === 5);
    ok("inbox tab selected", await page.evaluate(() => document.querySelector(".ib-tab").getAttribute("aria-selected") === "true"));
    ok("inbox actions inline", (await page.$$("#inv-pane-i .ib-friend .ib-b")).length === 2 && (await page.$$("#inv-pane-i .ib-inv .ib-b")).length === 3 && (await page.$$("#inv-pane-i .ib-duel .ib-b")).length === 2);
    await shot(page, "inbox");
    ok("badge cleared after open", await page.evaluate(() => document.getElementById("ib-badge").hidden));
    await page.click("#inv-pane-i .ib-friend .btn-green"); await wait(page, 800);
    ok("friend ✅ → friend_answer", calls.some((c) => c[0] === "friend_answer" && c[1].p_id === 5 && c[1].p_accept === true));
    // tab switch back to Grupper hides the inbox pane
    await page.click('.inv-tabs button[data-t="g"]'); await wait(page, 300);
    ok("Grupper tab hides inbox", !(await vis(page, "#inv-pane-i")) && await vis(page, "#inv-pane-g"));
    // ---------- Vänner + suggestions ----------
    await page.click('.inv-tabs button[data-t="f"]'); await wait(page, 2000);
    ok("suggestions shown", await vis(page, ".sg-box") && (await page.$$(".sg-row")).length === 2 && /3 gemensamma vänner/.test(await page.textContent(".sg-box")));
    ok("suggestions: no place/time text", !/Pitchers|Parma|kl|:\d\d/.test(await page.textContent(".sg-list")));
    await page.evaluate(() => document.querySelector(".sg-box").scrollIntoView({ block: "center" })); await wait(page, 300);
    await shot(page, "friends-suggest");
    await page.click(".sg-row >> nth=1 >> .sg-x"); await wait(page, 600);
    ok("✕ Dölj → hide + row gone", calls.some((c) => c[0] === "friend_suggest_hide" && c[1].p_k === "fedcba9876543210") && (await page.$$(".sg-row")).length === 1);
    await page.click(".sg-row .sg-add"); await wait(page, 600);
    ok("➕ → friend_suggest_add", calls.some((c) => c[0] === "friend_suggest_add" && c[1].p_k === "0123456789abcdef"));
    await page.evaluate(() => { localStorage.setItem("olnu.gtab", "g"); localStorage.setItem("olnu.ibTab", "0"); document.getElementById("sheet-close").click(); });
    // ---------- event sheet in the app + typed code ----------
    await page.evaluate(() => window.EVLINK.open("qwe234")); await wait(page, 1200);
    ok("event sheet", /Pubquiz/.test(await page.textContent("#sheet-body")) && (await page.$$(".evl-ans .btn")).length === 3);
    await shot(page, "event-sheet");
    await page.click(".evl-ans .btn-green"); await wait(page, 1200);
    ok("event ✅ → ev_join yes", calls.some((c) => c[0] === "ev_join" && c[1].p_token === "QWE234" && c[1].p_answer === "yes"));
    await ctx.close();
  }
  // ---------- 2. welcome card in a fresh browser (group link) ----------
  for (const kind of ["join", "ev"]) {
    const { ctx, page } = await ctxFor(browser, { width: 412, height: 915 }, { clean: true });
    page.on("pageerror", (e) => errs.push(e.message));
    await extra(page);
    await page.goto(BASE + (kind === "join" ? "?join=ABC234&by=Anton" : "?ev=QWE234&by=Lisa"));
    await wait(page, 3500);
    ok(kind + ": card shown", await vis(page, "#jn-wel"));
    const txt = await page.textContent("#jn-wel");
    ok(kind + ": answer first (no install step yet)", !/Installera|hemskärmen/.test(txt.replace(/Appen kan du fixa sen|appen kan du fixa sen/g, "")) || /Gå med i|Jag kommer/.test(txt), txt);
    ok(kind + ": preview", kind === "join" ? /2 ute nu/.test(txt) && (await page.$$(".jn-face")).length === 4 : /Pubquiz/.test(txt) && /3 kommer/.test(txt), txt);
    await shot(page, "welcome-" + kind);
    await page.fill("#jn-name", "Nisse");
    if (kind === "join") {
      await page.click(".jn-joinbtn"); await wait(page, 500);
      ok("join: [ds59] 18+ asked BEFORE the join", await vis(page, ".jn-age") && !calls.some((c) => c[0] === "join_group"));
      await page.selectOption("#sf-age-year", "1990"); await wait(page, 300); await page.click(".jn-age-go");
    } else await page.click(".jn-evyes");
    await wait(page, 1500);
    const t2 = await page.textContent("#jn-wel");
    ok(kind + ": answered → done box + code + install guide", /Din kod/.test(t2) && (kind === "join" ? /ABC234/.test(t2) : /QWE234/.test(t2)) && /(⋮|Installera|hemskärmen)/.test(t2), t2);
    ok(kind + ": server call", kind === "join" ? calls.some((c) => c[0] === "join_group" && c[1].p_display_name === "Nisse") : calls.some((c) => c[0] === "ev_join" && c[1].p_name === "Nisse"));
    await shot(page, "welcome-" + kind + "-done");
    await ctx.close();
  }
  // iPhone welcome (event)
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "sv-SE",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errs.push(e.message));
    const H = require("./d2-helpers.js");
    await page.route(/\/auth\/v1\//, (r) => J(r, { access_token: "x", token_type: "bearer", expires_in: 3600, refresh_token: "r", user: { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", aud: "authenticated", role: "authenticated", is_anonymous: true } }));
    await page.route(/rest\/v1\/rpc\//, (r) => J(r, []));
    await page.route(/functions\/v1\//, (r) => J(r, {}));
    await extra(page);
    await page.goto(BASE + "?ev=QWE234&by=Lisa"); await wait(page, 3500);
    await page.fill("#jn-name", "Nisse"); await page.click(".jn-evyes"); await wait(page, 1500);
    const t3 = await page.textContent("#jn-wel");
    ok("iOS: after answer → home-screen guide", /Lägg till på hemskärmen/.test(t3) && /Din kod/.test(t3), t3);
    await page.screenshot({ path: SP + "ui-testshots/social2-welcome-ios-done.png" }); console.log("shot", SP + "social2-welcome-ios-done.png");
    await ctx.close();
  }
  console.log("errors", errs);
  console.log(`${pass} PASS, ${fail} FAIL`);
  await browser.close();
})();
