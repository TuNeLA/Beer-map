// feat (2026-11-07) Playwright test, mocked server, 390x844. Usage: node feat-pw.js <port>
// A) 👤 no character until created: Profil card, no map face, wizard step by step (presets, locked tiles, save, done), v3 tiers,
//    gentle nudge rules. B) 🆘 Hämta mig: start (112 first), live answers, stop; receiver alarm + "Jag kommer".
// C) 🚗 Jag kör ikväll: Ikväll? toggle, group page "Kör ikväll" + Skjuts?, Medlemmar 🚗 tag. D) ⏰ Baren stänger 20/10 min + Hemfärd.
// E) 🎯 Gissa kvällen hidden until the server counts people.
const { ctxFor, boot, wait } = require("./d2-helpers.js");
const { chromium } = require("playwright");
const SP = require("./env.js").OUT;
const SHOTS = SP + "feat-shots/";
const PORT = process.argv[2] || 8961;
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const MISSING = (r) => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "PGRST202", message: "Could not find the function" }) });
const GID = "11111111-2222-3333-4444-555555555555";
const iso = (m) => new Date(Date.now() - m * 60e3).toISOString();
const inMin = (m) => new Date(Date.now() + m * 60e3).toISOString();
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 300))); c ? pass++ : fail++; };
const shot = async (page, n, keepToast) => {
  if (!keepToast) await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  await page.screenshot({ path: SHOTS + n + ".png" }); console.log("shot", n);
};
const clickText = (page, sel, re) => page.evaluate(([s, r]) => { const e = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent) && x.offsetParent !== null); if (e) e.click(); return e ? e.textContent : null; }, [sel, re]);
const toastText = (page) => page.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "));

const calls = [];
function state() {
  return { spec: null, facts: { mer: 3, r: 1, n: 42, title: "Rekryt", s: 0, b: 0, t: 0, e: 0, g: 1, k: 0, m: [] },
    poll: { v: 1, mine: null, incoming: [], driving: false }, drivers: [], guessKind: false };
}
async function routes(page, S) {
  await page.route(/rest\/v1\/rpc\/(my_avatar|set_my_avatar|avatars_for|friend_list|pickup_\w+|driver_set|drivers_for|ride_ask|close_remind_\w+|guess_night_kind|group_status\w*|ikvall_status|ikvall_set|game_poll|game_group)\b/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
    calls.push({ fn, body });
    switch (fn) {
      case "my_avatar": return J(r, { v: 2, spec: S.spec, seed: "5e3a91c2", facts: S.facts });
      case "set_my_avatar": S.spec = body.p_spec; return J(r, { ok: true, spec: body.p_spec });
      case "avatars_for": return J(r, { v: 1, people: [
        { k: body.p_group_id ? "k-anton" : "me", name: "Anton", is_me: true, seed: "5e3a91c2", a: S.spec, r: 1, md: [] },
        { k: "k-oskar", name: "Oskar", is_me: false, seed: "0b77aa10", a: { v: 1, sk: 1, fs: 2, ey: 2, br: 4, mt: 1, hr: 4, hc: 3, fh: 5, hw: 0, gl: 0, up: 1, uc: 0, bg: 8 }, r: 13, md: [] },
        { k: "k-lisa", name: "Lisa", is_me: false, seed: "c4d2e9f1", a: null, r: 2, md: [] }] });
      case "friend_list": return J(r, { v: 1, people: [
        { key: "fk-oskar", name: "Oskar", groups: [{ id: GID, name: "Ludvika Lager" }] },
        { key: "fk-lisa", name: "Lisa", groups: [{ id: GID, name: "Ludvika Lager" }] },
        { key: "fk-ida", name: "Ida", groups: [] }], groups: [{ id: GID, name: "Ludvika Lager" }] });
      case "pickup_start": S.poll.mine = { id: 501, kind: "hamta", live: true, created_at: iso(0), ends_at: inMin(body.p_minutes || 60), n: 2, has_pos: body.p_lat != null, answers: [] };
        return J(r, S.poll.mine);
      case "pickup_poll": return J(r, S.poll);
      case "pickup_stop": if (S.poll.mine) { S.poll.mine.live = false; S.poll.mine.has_pos = false; } return J(r, { ok: true });
      case "pickup_answer": return J(r, { ok: true, ans: body.p_ans });
      case "pickup_ping": return J(r, { ok: true, live: true });
      case "driver_set": S.poll.driving = !!body.p_on; return J(r, { ok: true, on: !!body.p_on });
      case "drivers_for": return J(r, { v: 1, drivers: S.drivers });
      case "ride_ask": S.poll.mine = { id: 777, kind: "skjuts", live: true, created_at: iso(0), ends_at: inMin(60), n: 1, has_pos: true, driver: "Oskar", answers: [] };
        return J(r, S.poll.mine);
      case "close_remind_set": case "close_remind_clear": return J(r, { ok: true });
      case "guess_night_kind": return S.guessKind ? J(r, "folk") : MISSING(r);
      case "group_status": case "group_status_v2": case "group_status_v3": return J(r, [
        { k: "k-oskar", name: "Oskar", beers: 2, others: 0, live: true, total: 40, meriter: 60, rank: 7, is_me: false },
        { k: "k-anton", name: "Anton", beers: 1, others: 0, live: true, total: 43, meriter: 3, rank: 1, is_me: true },
        { k: "k-lisa", name: "Lisa", beers: 0, others: 0, live: false, total: 18, meriter: 12, rank: 3, is_me: false }]);
      case "ikvall_status": return J(r, { v: 1, mine: "ute", counts: { ute: 2, kanske: 1, hemma: 0 }, people: [{ name: "Oskar", st: "ute", friend: true }, { name: "Lisa", st: "kanske", friend: true }] });
      case "ikvall_set": return J(r, { ok: true, st: body.p_st });
      case "game_poll": return J(r, { v: 1, night: iso(0), me: { out: true, guess_open: true, missions: [] }, groups: [{ id: GID, name: "Ludvika Lager" }] });
      case "game_group": return J(r, { v: 1 });
      default: return J(r, []);
    }
  });
}
const launch = () => chromium.launch({ executablePath: require("./env.js").CHROME,
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"] });
const VP = { width: 390, height: 844 };
async function openProfil(page) {
  await page.evaluate(() => document.getElementById("btn-settings").click());
  await wait(page, 900);
  await page.evaluate(() => { const t = [...document.querySelectorAll(".pf-tabs button, .tabs button, [role=tab]")].find((b) => /Profil/.test(b.textContent)); if (t) t.click(); });
  await wait(page, 900);
}
async function openGroup(page) {
  await page.evaluate(() => { document.querySelectorAll(".toast").forEach((t) => t.remove()); try { localStorage.setItem("olnu.gtab", "g"); } catch (e) {} document.getElementById("btn-groups").click(); });
  await wait(page, 1200);
  if (await page.$(".glist .gcard")) { await page.click(".glist .gcard >> nth=0"); await wait(page, 1500); }
}

(async () => {
  const browser = await launch();
  try {
    /* ---------- A: avatar ---------- */
    {
      const S = state();
      const { ctx, page } = await ctxFor(browser, VP);
      await page.addInitScript(() => { try { localStorage.removeItem("olnu.avV3"); localStorage.setItem("olnu.avwDays", JSON.stringify({ d: "x", n: 0 })); } catch (e) {} });
      await routes(page, S);
      await boot(page);
      ok("AVATAR + AVWIZ loaded", await page.evaluate(() => !!(window.AVATAR && window.AVATAR.on() && window.AVWIZ)));
      await page.evaluate(() => window.AVATAR.loadMe(true)); await wait(page, 500);
      ok("new user: AVATAR.me() is null (no random character)", await page.evaluate(() => window.AVATAR.me() === null && !!window.AVATAR.meRaw()));
      ok("map: my pin has no face", await page.evaluate(() => window.AVPINS ? window.AVPINS.img({ is_mine: true }) === "" : true));
      await page.evaluate(() => window.AVATAR.forFriends()); await wait(page, 600);
      ok("friend without a saved character is not drawn (Lisa); friend with one is (Oskar)", await page.evaluate(() => {
        const c = window.AVATAR._caches()[0] || {}; return !!(c.byName && c.byName.Oskar && !c.byName.Lisa);
      }));
      await openProfil(page);
      await page.waitForSelector(".avw-cta", { timeout: 6000 }).catch(() => {});
      ok("Profil: no SVG in the hero", await page.evaluate(() => !document.querySelector(".pf-av.av-pf svg")));
      ok("Profil: 'Skapa din karaktär' card", await page.evaluate(() => /Skapa din karaktär/.test((document.querySelector(".avw-cta") || {}).textContent || "")));
      await shot(page, "01-profil-skapa");
      await page.evaluate(() => document.querySelector(".avw-cta").click());
      await page.waitForSelector(".avw-base", { timeout: 6000 }).catch(() => {});
      ok("wizard opens on 'Välj en start' with 3 presets", await page.evaluate(() => document.querySelectorAll(".avw-base").length === 3 && /Välj en start/.test(document.querySelector(".avw-t").textContent)));
      ok("presets: Feminin / Maskulin / Spelar ingen roll", await page.evaluate(() => [...document.querySelectorAll(".avw-base b")].map((b) => b.textContent).join(",") === "Feminin,Maskulin,Spelar ingen roll"));
      await shot(page, "02-wiz-start");
      await page.evaluate(() => document.querySelector('.avw-base[data-b="fem"]').click());
      await wait(page, 900);
      ok("preset tap goes on to Hudton", await page.evaluate(() => /Hudton/.test(document.querySelector(".avw-t").textContent)));
      ok("step text 'Steg 2 av 13'", await page.evaluate(() => /Steg 2 av 13/.test(document.querySelector(".avw-n").textContent)), await page.evaluate(() => document.querySelector(".avw-n").textContent));
      ok("all 10 real skin tones are free, light → deep", await page.evaluate(() => [...document.querySelectorAll(".avw-grid-sw .avw-tile:not(.locked)")].slice(0, 10).map((t) => t.getAttribute("data-i")).join() === "8,9,10,11,3,13,4,15,16,17"));
      await shot(page, "03-wiz-hudton");
      await page.evaluate(() => document.querySelector(".avw-next").click()); await wait(page, 400);   // Frisyr (avt: hair right after skin)
      ok("Frisyr: long hair first after Feminin", await page.evaluate(() => document.querySelector(".avw-grid .avw-tile").getAttribute("data-i") === "5"));
      ok("Frisyr: hair colour row", await page.evaluate(() => document.querySelectorAll(".avw-colrow .avw-c").length >= 10));
      ok("Frisyr: locked teasers shown (rank 1)", await page.evaluate(() => /Låses upp senare/.test((document.querySelector(".avw-lh") || {}).textContent || "") && document.querySelectorAll(".avw-grid-lock .avw-tile.locked").length > 0));
      ok("afro / flätor / dreads stay free", await page.evaluate(() => ["15", "16", "17"].every((i) => !!document.querySelector('.avw-grid:not(.avw-grid-lock) .avw-tile[data-k="hr"][data-i="' + i + '"]'))));
      await page.evaluate(() => document.querySelector(".avw-grid-lock .avw-tile").click()); await wait(page, 200);
      ok("locked tile → toast with what unlocks it", /Låses upp|Säsong/.test(await toastText(page)), await toastText(page));
      await page.evaluate(() => document.querySelector('.avw-colrow .avw-c:nth-child(4)').click()); await wait(page, 200);
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, "05-wiz-frisyr");
      await page.evaluate(() => document.querySelector(".avw-next").click()); await wait(page, 300);   // Ansiktsform (avt)
      await shot(page, "04-wiz-ansikte");
      await page.evaluate(() => document.querySelector(".avw-next").click()); await wait(page, 300);   // Ögon
      await shot(page, "06-wiz-ogon");
      for (let i = 0; i < 4; i++) { await page.evaluate(() => document.querySelector(".avw-next").click()); await wait(page, 250); }   // Bryn, Mun, Skägg, Kläder
      ok("step Kläder", await page.evaluate(() => /Kläder/.test(document.querySelector(".avw-t").textContent)));
      await shot(page, "07-wiz-klader");
      await page.evaluate(() => document.querySelector(".avw-dice").click()); await wait(page, 300);
      await page.evaluate(() => document.querySelector(".avw-next").click()); await wait(page, 250);   // Glasögon
      ok("Glasögon: more than the first 5 locked for rank 1 (v3 tiers)", await page.evaluate(() => document.querySelectorAll(".avw-grid:not(.avw-grid-lock) .avw-tile").length === 5));
      await shot(page, "08-wiz-glasogon");
      await page.evaluate(() => document.querySelector(".avw-next").click()); await wait(page, 250);   // Huvudbonad
      await page.evaluate(() => document.querySelector(".avw-next").click()); await wait(page, 250);   // I handen
      ok("I handen: water / alcohol-free on the list", await page.evaluate(() => !!document.querySelector('.avw-tile[data-k="hi"][data-i="2"]')));
      await shot(page, "09-wiz-handen");
      await page.evaluate(() => document.querySelector(".avw-next").click()); await wait(page, 250);   // Bakgrund
      ok("last step button says 'Spara ✓'", await page.evaluate(() => /Spara/.test(document.querySelector(".avw-next").textContent)));
      await page.evaluate(() => document.querySelector(".avw-next").click()); await wait(page, 1200);
      const saved = calls.filter((c) => c.fn === "set_my_avatar").pop();
      ok("save sends the spec (Feminin start: long hair 5, lashes 9)", !!saved && saved.body.p_spec.hr === 5 && saved.body.p_spec.ey === 9, saved && saved.body);
      ok("done screen + confetti", await page.evaluate(() => !!document.querySelector(".avw-done") && /Snyggt/.test(document.querySelector(".avw-done").textContent)));
      ok("made in the wizard → not grandfathered", await page.evaluate(() => localStorage.getItem("olnu.avV3") === "1" && window.AVATAR.gf() === false));
      await wait(page, 600);
      await shot(page, "10-wiz-klar");
      ok("after save: AVATAR.me() has the spec, map pin gets the face", await page.evaluate(() => !!window.AVATAR.me() && (!window.AVPINS || /bm-av/.test(window.AVPINS.img({ is_mine: true })))));
      ok("tiers: hr:18 locked at rank 1, open at rank 2, open when grandfathered", await page.evaluate(() => {
        const A = window.AVATAR, lk = A.LOCKS["hr:18"]; return !A.unlocked(lk, { r: 1, gf: false }) && A.unlocked(lk, { r: 2, gf: false }) && A.unlocked(lk, { r: 1, gf: true });
      }));
      ok("old v1/v2 locks unchanged (hw:13 needs medal kung)", await page.evaluate(() => JSON.stringify(window.AVATAR.LOCKS["hw:13"]) === '{"m":"kung"}'));
      // full editor has "Steg för steg"
      await page.evaluate(() => { const b = document.querySelector(".avw-full"); if (b) b.click(); }); await wait(page, 900);
      ok("full editor opens with '🧭 Steg för steg'", await page.evaluate(() => !!document.querySelector(".ave-wiz")));
      await shot(page, "11-editor-stegforsteg");
      await ctx.close();
    }
    /* ---------- A2: grandfathered user + nudge ---------- */
    {
      const S = state(); S.spec = { v: 2, sk: 2, fs: 0, ey: 0, br: 1, mt: 0, hr: 2, hc: 1, fh: 0, hw: 0, gl: 0, up: 0, uc: 0, bg: 1 };
      const { ctx, page } = await ctxFor(browser, VP);
      await routes(page, S);
      await boot(page);
      await page.evaluate(() => window.AVATAR.loadMe(true)); await wait(page, 400);
      ok("saved before v3 (no flag, server without gf) → grandfathered, v3 items open", await page.evaluate(() => window.AVATAR.gf() === true && window.AVATAR.unlocked(window.AVATAR.LOCKS["gl:11"], window.AVATAR.meRaw().facts)));
      S.facts.gf = false; await page.evaluate(() => window.AVATAR.loadMe(true)); await wait(page, 400);
      ok("server facts.gf=false wins", await page.evaluate(() => window.AVATAR.gf() === false));
      S.spec = null; await page.evaluate(() => window.AVATAR.loadMe(true)); await wait(page, 400);
      await page.evaluate(() => { localStorage.setItem("olnu.avwDays", JSON.stringify({ d: "x", n: 1 })); localStorage.removeItem("olnu.avwNudge"); document.querySelectorAll(".toast").forEach((t) => t.remove()); window.AVWIZ._nudge(); });
      await wait(page, 300);
      ok("nudge: not on the first days", !/Skapa din karaktär/.test(await toastText(page)));
      await page.evaluate(() => { localStorage.setItem("olnu.avwDays", JSON.stringify({ d: "x", n: 3 })); });
      await page.waitForTimeout(100);
      await page.evaluate(() => { window.__t = Date.now; Date.now = () => window.__t() + 120000; window.AVWIZ._nudge(); Date.now = window.__t; });
      await wait(page, 300);
      ok("nudge: from day 3, one toast with 'Skapa'", /Skapa din karaktär/.test(await toastText(page)), await toastText(page));
      await shot(page, "12-nudge", true);
      await ctx.close();
    }
    /* ---------- B: 🆘 Hämta mig ---------- */
    {
      const S = state(); S.spec = { v: 2, sk: 2, hr: 2, bg: 1 };
      const { ctx, page } = await ctxFor(browser, VP);
      await routes(page, S);
      await boot(page);
      ok("SKJUTS loaded", await page.evaluate(() => !!window.SKJUTS));
      await page.evaluate(() => window.SKJUTS.openPickup({}));
      await page.waitForSelector(".pk-chip", { timeout: 6000 }).catch(() => {});
      // owner 11 Nov: a pickup is not an emergency: the request content is first, 112 = one small link at the very bottom
      ok("Hämta mig: request content first, no big 112; 'Akut fara? Ring 112' small link at the bottom", await page.evaluate(() => { const sb = document.getElementById("sheet-body"), b = sb && sb.querySelector(".pk"); const last = sb && sb.lastElementChild;
        return !!b && !b.querySelector(".sf-112") && b.firstElementChild.classList.contains("pk-lead") && !!last && last.classList.contains("pk-112") && !!last.querySelector('a[href="tel:112"]'); }));
      ok("send disabled until someone is picked", await page.evaluate(() => document.querySelector(".pk-go").disabled));
      await page.evaluate(() => document.querySelector(".pk-gchip").click()); await wait(page, 200);
      ok("group chip = 2 people", /2 får frågan/.test(await page.evaluate(() => document.querySelector(".pk-go").textContent)), await page.evaluate(() => document.querySelector(".pk-go").textContent));
      await shot(page, "13-hamta-start");
      await page.evaluate(() => document.querySelector(".pk-go").click());
      await page.waitForSelector(".pk-stop", { timeout: 15000 }).catch(() => {});
      const st = calls.filter((c) => c.fn === "pickup_start").pop();
      ok("pickup_start: group id, 60 min, my position", !!st && st.body.p_group_ids[0] === GID && st.body.p_minutes === 60 && Math.abs(st.body.p_lat - 60.1511) < 0.01, st && st.body);
      S.poll.mine.answers = [{ name: "Lisa", ans: "kommer", at: iso(0) }, { name: "Oskar", ans: "kan_inte", at: iso(0) }];
      await page.evaluate(() => window.SKJUTS._force()); await wait(page, 800);
      ok("live: 'Lisa: Jag kommer' shown", await page.evaluate(() => /Lisa: Jag kommer/.test(document.querySelector(".pk-ans").textContent)));
      ok("asker gets '🙋 Lisa kommer' toast", /Lisa kommer/.test(await toastText(page)), await toastText(page));
      ok("HUD chip '🆘 Hämta mig · 1 kommer'", await page.evaluate(() => /1 kommer/.test(window.SKJUTS.hudChipsHTML())));
      await shot(page, "14-hamta-live");
      await page.evaluate(() => document.querySelector(".pk-stop").click()); await wait(page, 600);
      ok("stop → pickup_stop + 'raderad'", calls.some((c) => c.fn === "pickup_stop") && /raderad/.test(await page.evaluate(() => document.querySelector("#sheet-body .pk").textContent)));
      // receiver
      S.poll = { v: 1, mine: null, driving: false, incoming: [{ id: 900, kind: "hamta", name: "Oskar", live: true, lat: 60.1499, lng: 15.1868, acc: 12, pos_at: iso(1), created_at: iso(1), ends_at: inMin(59), my_ans: null, coming: 0 }] };
      await page.evaluate(() => { document.getElementById("sheet-close") && document.getElementById("sheet-close").click(); window.SKJUTS._force(); }); await wait(page, 900);
      ok("receiver: alarm toast '🆘 Oskar: Kan nån hämta mig?'", /Oskar: Kan nån hämta mig/.test(await toastText(page)), await toastText(page));
      await shot(page, "15-hamta-alarm", true);
      await page.evaluate(() => { const t = [...document.querySelectorAll(".toast button")].find((b) => /Visa/.test(b.textContent)); if (t) t.click(); }); await wait(page, 700);
      ok("receiver sheet: map, directions, Jag kommer, 112", await page.evaluate(() => !!document.querySelector(".pk-map") && /maps\/dir/.test(document.querySelector(".pk-dir").href) && !!document.querySelector(".pk-yes") && !document.querySelector(".pk .sf-112") && !!document.querySelector("#sheet-body > .pk-112 a[href='tel:112']")));
      await shot(page, "16-hamta-mottagare");
      await page.evaluate(() => document.querySelector(".pk-yes").click()); await wait(page, 600);
      const an = calls.filter((c) => c.fn === "pickup_answer").pop();
      ok("answer 'kommer' sent", !!an && an.body.p_id === 900 && an.body.p_ans === "kommer", an && an.body);
      await ctx.close();
    }
    /* ---------- C: 🚗 Jag kör ikväll ---------- */
    {
      const S = state(); S.spec = { v: 2, sk: 2, hr: 2, bg: 1 }; S.drivers = [{ k: "k-oskar", name: "Oskar", is_me: false }];
      const { ctx, page } = await ctxFor(browser, VP);
      await page.addInitScript(() => { try { localStorage.setItem("olnu.pnEve", "1"); } catch (e) {} });
      await routes(page, S);
      await boot(page);
      await page.evaluate(() => { const c = document.querySelector(".pn-ikv-chip"); if (c) c.click(); });
      await page.waitForSelector(".pk-ikv", { timeout: 6000 }).catch(() => {});
      ok("Ikväll? sheet has '🚗 Jag kör ikväll'", await page.evaluate(() => /Jag kör ikväll/.test((document.querySelector(".pk-ikv") || {}).textContent || "")));
      ok("text says it never counts as a drink", await page.evaluate(() => /Räknas aldrig som dryck/.test(document.querySelector(".pk-ikv").textContent)));
      await page.evaluate(() => document.querySelector(".pk-ikv .switch").click()); await wait(page, 600);
      const ds = calls.filter((c) => c.fn === "driver_set").pop();
      ok("toggle → driver_set(true)", !!ds && ds.body.p_on === true);
      ok("switch shows on", await page.evaluate(() => document.querySelector(".pk-ikv .switch").getAttribute("aria-checked") === "true"));
      await shot(page, "17-ikvall-jagkor");
      await page.evaluate(() => document.getElementById("sheet-close") && document.getElementById("sheet-close").click()); await wait(page, 400);
      await openGroup(page);
      await page.waitForSelector(".skj-gi:not([hidden]) .skj-card", { timeout: 8000 }).catch(() => {});
      ok("group page: '🚗 Kör ikväll: Oskar' + Skjuts?", await page.evaluate(() => { const t = document.querySelector(".skj-gi:not([hidden])"); return !!t && /Oskar/.test(t.textContent) && !!t.querySelector(".skj-ask"); }));
      // polishA (AUDIT-NAV move 4, owner I-17): Hämta mig + Jag kör ikväll are personal → the Ikväll chip menu, not the group '+' (checked at the end of C)
      ok("group '+' has no 🆘 Hämta mig / 🚗 Jag kör ikväll tile (personal menu now)", await page.evaluate(() => !document.querySelector('.gpg-ga[data-ga="pk-ga"]') && !document.querySelector('.gpg-ga[data-ga="pk-drv"]')));
      await page.evaluate(() => { const t = document.querySelector(".skj-gi"); if (t) t.scrollIntoView({ block: "center" }); });
      await shot(page, "18-grupp-korikvall");
      await page.evaluate(() => document.querySelector(".skj-ask").click());
      await page.waitForFunction(() => [...document.querySelectorAll(".toast")].some((t) => /om skjuts/.test(t.textContent)), null, { timeout: 9000 }).catch(() => {});
      const ra = calls.filter((c) => c.fn === "ride_ask").pop();
      ok("Skjuts? → ride_ask(group, k-oskar)", !!ra && ra.body.p_group_id === GID && ra.body.p_k === "k-oskar", ra && ra.body);
      ok("toast 'frågat Oskar om skjuts'", /frågat Oskar om skjuts/.test(await toastText(page)), await toastText(page));
      await shot(page, "19-skjuts-fragad", true);
      // plus menu screenshot
      await page.evaluate(() => { const p = document.querySelector(".gpg-plus"); if (p) p.click(); }); await wait(page, 600);
      await shot(page, "20-grupp-plus");
      // Medlemmar
      await page.evaluate(() => { const b = document.querySelector(".gpg-back"); if (b) b.click(); }); await wait(page, 300);
      await page.evaluate(() => { const m = document.querySelector(".gmain"); if (m) m.click(); }); await wait(page, 1800);
      ok("Medlemmar: 'Kör ikväll' role pill next to Oskar (R1-30, lane ride)", await page.evaluate(() => { const r = [...document.querySelectorAll(".st-row")].find((x) => /Oskar/.test(x.textContent)); return !!r && !!r.querySelector(".skj-role") && /Kör ikväll/.test(r.textContent); }));
      await shot(page, "21-medlemmar-kor");
      await page.evaluate(() => document.getElementById("sheet-close") && document.getElementById("sheet-close").click()); await wait(page, 600);
      await page.evaluate(() => { const c = document.getElementById("pn-ikv2"); if (c) c.click(); }); await wait(page, 500);
      ok("personal menu (Ikväll chip) has 🆘 Hämta mig and 🚗 Jag kör ikväll (polishA move 4)", await page.evaluate(() => { const t = [...document.querySelectorAll("#pn-ikm .pn-ikm-row")].map((b) => b.textContent); return t.some((x) => /Hämta mig/.test(x)) && t.some((x) => /Jag kör ikväll/.test(x)); }));
      await ctx.close();
    }
    /* ---------- D: ⏰ Baren stänger ---------- */
    {
      const S = state(); S.spec = { v: 2, sk: 2, hr: 2, bg: 1 };
      const { ctx, page } = await ctxFor(browser, VP);
      await routes(page, S);
      await boot(page);
      const setClose = (min) => page.evaluate((mn) => {
        const w = window.OPPET.wall(Date.now()), d = ["", "", "", "", "", "", ""]; d[w.dow] = "0-" + (w.min + mn);
        window.OPPET._set({ v: 1, bars: { n3472634175: d } }); document.querySelectorAll(".toast").forEach((t) => t.remove());
        localStorage.removeItem("olnu.aioClose"); window.OPPET._check();
      }, min);
      await setClose(25); await wait(page, 800);
      ok("25 min left: no toast yet", !/stänger om/.test(await toastText(page)));
      await setClose(18); await wait(page, 900);
      const t20 = await toastText(page);
      ok("20-min heads-up: care text + Hemfärd", /stänger|Om 18 min/.test(t20) && /hemfärd|hem/i.test(t20) && /Hemfärd/.test(t20), t20);
      ok("no 'nearest open bar' in the toast", !/Närmast öppet/.test(t20));
      await shot(page, "22-stanger-20", true);
      ok("close_remind_set sent for Pitchers", calls.some((c) => c.fn === "close_remind_set" && c.body.p_bar_id === "n3472634175"));
      await page.evaluate(() => { const b = [...document.querySelectorAll(".toast button")].find((x) => /Hemfärd/.test(x.textContent)); if (b) b.click(); }); await wait(page, 700);
      ok("Hemfärd sheet: Följ mig hem, Hämta mig, Taxi", await page.evaluate(() => { const t = (document.querySelector(".hf2") || {}).textContent || ""; return /Följ mig hem/.test(t) && /Hämta mig/.test(t) && /Taxi/.test(t); }));
      await shot(page, "23-hemfard");
      await page.evaluate(() => document.getElementById("sheet-close") && document.getElementById("sheet-close").click()); await wait(page, 400);
      await page.evaluate(() => { const w = window.OPPET.wall(Date.now()), d = ["", "", "", "", "", "", ""]; d[w.dow] = "0-" + (w.min + 8);
        window.OPPET._set({ v: 1, bars: { n3472634175: d } }); document.querySelectorAll(".toast").forEach((t) => t.remove()); window.OPPET._check(); });
      await wait(page, 900);
      const t10 = await toastText(page);
      ok("10-min heads-up after the 20-min one", /8 min/.test(t10), t10);
      await page.evaluate(() => { document.querySelectorAll(".toast").forEach((t) => t.remove()); window.OPPET._check(); }); await wait(page, 300);
      ok("each heads-up only once", !/stänger|kvar på/.test(await toastText(page)));
      await ctx.close();
    }
    /* ---------- E: 🎯 Gissa kvällen ---------- */
    {
      const S = state(); S.spec = { v: 2, sk: 2, hr: 2, bg: 1 };
      const { ctx, page } = await ctxFor(browser, VP);
      await routes(page, S);
      await boot(page);
      await page.evaluate(() => window.GAMES && window.GAMES.openGroup({ id: "11111111-2222-3333-4444-555555555555", name: "Ludvika Lager" })); await wait(page, 900);
      ok("Gissa hidden while the server counts beers (no guess_night_kind)", await page.evaluate(() => document.querySelectorAll(".gm-tab").length > 0 && ![...document.querySelectorAll(".gm-tab")].some((b) => /Gissa/.test(b.textContent))),
        await page.evaluate(() => [...document.querySelectorAll(".gm-tab")].map((b) => b.textContent)));
      await ctx.close();
    }
  } catch (e) { console.log("FAIL exception", e.message, e.stack && e.stack.split("\n")[1]); fail++; }
  await browser.close();
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
