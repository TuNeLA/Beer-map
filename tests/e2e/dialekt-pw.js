// dialect-core (D2): docs/js/dialekt.js — the string layer and its kommun → region data. Usage: node dialekt-pw.js <port>
// Part 1: the module alone on a tiny page from the same server (real dialekt.js + real data/dialekt-kommun.json).
// Part 2: the real app (mocked Supabase): DIALEKT loads, finds Ludvika, and its Inställningar row works at 360/390/430.
// Part 3 (phase 2): call sites read the region packs (LIVE, toasts, group empty state, game cards) per region, Av = plain,
// only the region's pack is fetched (after the load event, no long task), the service worker keeps it (next start + offline).
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const { ctxFor, boot, wait, mock } = require("./ds-helpers.js");
const SP = require("./env.js").OUT;
const PORT = process.argv[2] || 8871, BASE = `http://127.0.0.1:${PORT}/`;
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (i === undefined ? "" : JSON.stringify(i).slice(0, 600))); c ? pass++ : fail++; };
const A_CODES = ["sv-neutral", "sv-syd", "sv-vast", "sv-sthlm", "sv-dalarna", "sv-norr"];
const RENAME = { sv: "sv-neutral", "sv-norrland": "sv-norr" };
const CSV = fs.readFileSync(path.join(__dirname, "../../scripts/dialekt-kommuner.csv"), "utf8").trim().split("\n").slice(1).map((l) => {
  const c = l.split(","); return { name: c[0], kod: c[2], a: RENAME[c[3]] || c[3], b: RENAME[c[4]] || c[4] };
});
const PAGE = BASE + "__dialekt-test.html";
const HTML = '<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>dk</title></head><body><script src="./js/dialekt.js"></script></body></html>';
const HOOKED = /window\.DIALEKT\b/.test(fs.readFileSync(path.join(__dirname, "../../docs/app.js"), "utf8"));   // patch 02 applied?
const at = (y, mo, d, h) => new Date(y, mo - 1, d, h, 0, 0).getTime();   // local time (CI: TZ=Europe/Stockholm)

async function fresh(browser, ls, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  const reqs = [];
  await ctx.route(PAGE, (r) => r.fulfill({ status: 200, contentType: "text/html", body: HTML }));
  if (o.blockData) await ctx.route(/dialekt-kommun\.json/, (r) => r.abort());
  ctx.on("request", (r) => { if (/dialekt-kommun\.json/.test(r.url())) reqs.push(Date.now()); });
  await ctx.addInitScript((ls) => { if (sessionStorage.getItem("dk-seeded")) return; sessionStorage.setItem("dk-seeded", "1"); localStorage.clear(); Object.keys(ls || {}).forEach((k) => localStorage.setItem(k, typeof ls[k] === "string" ? ls[k] : JSON.stringify(ls[k]))); }, ls || {});
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(PAGE);
  if (!o.noReady) await page.evaluate(() => window.DIALEKT.ready());
  return { ctx, page, reqs, errs };
}

(async () => {
  const browser = await chromium.launch({ executablePath: require("./env.js").CHROME });

  // ---------- 1. data: all 290 kommuner → a valid A region (by code AND by name), grid, towns ----------
  {
    const { ctx, page, errs } = await fresh(browser);
    const r = await page.evaluate((rows) => {
      const D = window.DIALEKT, out = { n: D._sets()[0].k.length, code: [], name: [], codeB: [], grid: [], t0: performance.now() };
      rows.forEach((x) => {
        D.setArea({ code: x.kod }); const a = D.area();
        if (!a || a.a !== x.a || a.cc !== "SE") out.code.push([x.kod, x.name, a && a.a, x.a]);
        if (!a || a.b !== x.b) out.codeB.push([x.kod, a && a.b, x.b]);
        D.setArea({ name: x.name }); const b = D.area();
        if (!b || b.code !== x.kod) out.name.push([x.name, b && b.code, x.kod]);
      });
      D._sets()[0].k.forEach((k) => { D.setArea({ lat: k[4], lng: k[5] }); const a = D.area(); if (!a || a.code !== k[0]) out.grid.push([k[1], a && a.name]); });
      out.ms = Math.round(performance.now() - out.t0);
      return out;
    }, CSV);
    ok("data: 290 kommuner in data/dialekt-kommun.json", r.n === 290 && CSV.length === 290, { n: r.n, csv: CSV.length });
    ok("data: every CSV regionA is a valid A code", CSV.every((x) => A_CODES.includes(x.a)), CSV.filter((x) => !A_CODES.includes(x.a)));
    ok("data: all 290 kommuner by SCB code → their CSV A region", r.code.length === 0, r.code);
    ok("data: all 290 kommuner by code → their CSV B region", r.codeB.length === 0, r.codeB);
    ok("data: all 290 kommuner by name (normalised) → the right kommun", r.name.length === 0, r.name);
    ok("data: every kommun label point → its own kommun on the grid", r.grid.length === 0, r.grid);
    ok(`speed: 870 area lookups in ${r.ms} ms (< 400)`, r.ms < 400, r.ms);
    const towns = await page.evaluate(() => {
      const D = window.DIALEKT, q = (x) => { D.setArea(x); return D.region(); };
      return {
        ludvika: q({ lat: 60.1496, lng: 15.1878 }), smedjebacken: q({ lat: 60.1405, lng: 15.4128 }), avesta: q({ lat: 60.1455, lng: 16.1679 }),
        malmo: q({ lat: 55.605, lng: 13.0038 }), goteborg: q({ lat: 57.7089, lng: 11.9746 }), stockholm: q({ lat: 59.3293, lng: 18.0686 }),
        kiruna: q({ lat: 67.8558, lng: 20.2253 }), uppsala: q({ lat: 59.8586, lng: 17.6389 }), visby: q({ lat: 57.6348, lng: 18.2948 }),
        karlstad: q({ lat: 59.3793, lng: 13.5036 }), habo: q({ name: "Habo" }), haabo: q({ name: "Håbo" }),
        grangesberg: (D.setArea({ name: "Grängesberg" }), D.area().name), salen: (D.setArea({ name: "Sälen" }), D.area().name),
        gagnef: (D.setArea({ name: "Gagnef (Djurås)" }), D.area().name), kommunSuffix: (D.setArea({ name: "Ludvika kommun" }), D.area().name),
        upplandsbro: (D.setArea({ name: "upplands bro" }), D.area().name)
      };
    });
    ok("towns: lat/lng → region (Ludvika, Smedjebacken, Avesta = Dalarna; Malmö Syd; Göteborg, Karlstad Väst; Stockholm; Kiruna Norrland; Uppsala, Visby Neutral)",
      towns.ludvika === "sv-dalarna" && towns.smedjebacken === "sv-dalarna" && towns.avesta === "sv-dalarna" && towns.malmo === "sv-syd" && towns.goteborg === "sv-vast" &&
      towns.karlstad === "sv-vast" && towns.stockholm === "sv-sthlm" && towns.kiruna === "sv-norr" && towns.uppsala === "sv-neutral" && towns.visby === "sv-neutral", towns);
    ok("towns: Habo (Syd) ≠ Håbo (Neutral): å ä ö are kept in names", towns.habo === "sv-syd" && towns.haabo === "sv-neutral", towns);
    ok("towns: aliases + name forms (Grängesberg → Ludvika, Sälen → Malung-Sälen, 'Gagnef (Djurås)', 'Ludvika kommun', 'upplands bro')",
      towns.grangesberg === "Ludvika" && towns.salen === "Malung-Sälen" && towns.gagnef === "Gagnef" && towns.kommunSuffix === "Ludvika" && towns.upplandsbro === "Upplands-Bro", towns);
    ok("no page errors (data part)", errs.length === 0, errs);
    await ctx.close();
  }

  // ---------- 2. lookup order, def, key, vars, unknown → neutral ----------
  {
    const { ctx, page, errs } = await fresh(browser);
    const r = await page.evaluate(() => {
      const D = window.DIALEKT, P = D._packs();
      D.register("sv-neutral", { "test.onlyNeutral": "N-only", "test.both": "N-both" });
      D.register("sv-dalarna", { "test.both": "D-both" });
      D.setArea({ code: "2085" });   // Ludvika
      const o = { region: D.region(), chain: D.chain(), area: D.area(),
        grp: D.t("grp.empty"), both: D.t("test.both"), onlyN: D.t("test.onlyNeutral"),
        def: D.t("test.nowhere", null, "fallback {x}"), defVars: D.t("test.nowhere", { x: "ok" }, "fallback {x}"), key: D.t("test.nowhere"),
        skal: D.t("toast.skal", { name: "Ida" }), rank: D.t("rank.up", { rank: "Korpral" }), noVar: D.t("toast.skal"),
        dalaGrp: P["sv-dalarna"]["grp.empty"], neutralGrp: P["sv-neutral"]["grp.empty"] };
      D.setArea({ code: "9999" }); o.unknownCode = [D.region(), D.area(), D.t("grp.empty")];
      D.setArea({ lat: 59.9139, lng: 10.7522 }); o.oslo = [D.region(), D.area()];
      D.setArea({ name: "Atlantis" }); o.atlantis = D.region();
      D.setArea({ lat: 52.52, lng: 13.40 }); o.berlin = D.region();
      return o;
    });
    ok("lookup: Ludvika → region sv-dalarna, chain [sv-dalarna, sv-neutral]", r.region === "sv-dalarna" && r.chain.join() === "sv-dalarna,sv-neutral" && r.area.name === "Ludvika" && r.area.src === "set", r);
    ok("lookup: region pack wins (test.both = D-both; grp.empty = the Dalarna line)", r.both === "D-both" && r.grp === r.dalaGrp && r.grp !== r.neutralGrp, r);
    ok("lookup: key missing in region → neutral", r.onlyN === "N-only", r.onlyN);
    ok("lookup: missing everywhere → def (with vars), then the key itself", r.def === "fallback " && r.defVars === "fallback ok" && r.key === "test.nowhere", [r.def, r.defVars, r.key]);
    ok("vars: {name} / {rank} filled", /Ida/.test(r.skal) && /Korpral/.test(r.rank) && !/[{}]/.test(r.skal + r.rank), [r.skal, r.rank]);
    ok("vars: a missing var leaves no {name} in the text", !/[{}]/.test(r.noVar), r.noVar);
    ok("unknown kommun code → neutral (no area)", r.unknownCode[0] === "sv-neutral" && r.unknownCode[1] === null && r.unknownCode[2] === r.neutralGrp, r.unknownCode);
    ok("outside Sweden (Oslo, Berlin) and an unknown name → neutral", r.oslo[0] === "sv-neutral" && r.oslo[1] === null && r.atlantis === "sv-neutral" && r.berlin === "sv-neutral", [r.oslo, r.atlantis, r.berlin]);
    ok("no page errors (lookup part)", errs.length === 0, errs);
    await ctx.close();
  }

  // ---------- 3. scheme B: B → A fallback per kommun; variant not: filter in scheme A ----------
  {
    const { ctx, page, errs } = await fresh(browser);
    const r = await page.evaluate(() => {
      const D = window.DIALEKT, P = D._packs(), o = {};
      D.register("sv-smaland", { "test.sma": "SMÅ" });
      D.register("sv-varmland", { "test.sma": "VÄRM" });
      o.schemeDefault = D.scheme();
      D.setArea({ code: "0780" });   // Växjö: A syd, B småland
      o.aChain = D.chain(); o.aSma = D.t("test.sma");
      D.setScheme("B");
      o.bChain = D.chain(); o.bRegion = D.region(); o.bSma = D.t("test.sma"); o.bGrp = D.t("grp.empty"); o.sydGrp = P["sv-syd"]["grp.empty"];
      D.setArea({ code: "1883" }); o.karlskoga = [D.chain(), D.t("test.sma"), D.t("grp.empty") === P["sv-neutral"]["grp.empty"]];   // B värmland, A neutral
      D.setArea({ code: "2180" }); o.gavle = D.chain();   // A norr, B neutral
      D.setArea({ code: "2085" }); o.ludvikaB = D.chain();   // B = A
      D.setScheme("A"); D.setArea({ code: "2180" }); o.gavleA = D.chain();
      // not: filter — sv-syd "live.quiet" has a påg/tös variant with not:["sv-smaland"]
      const seen = (code) => { D.setArea({ code }); const s = new Set(); for (let i = 0; i < 60; i++) s.add(D.t("live.quiet", { _seed: i })); return [...s]; };
      o.vaxjoLines = seen("0780"); o.malmoLines = seen("1280");
      D.preview("sv-smaland"); o.preview = [D.chain(), D.region(), D.t("grp.empty") === o.sydGrp]; D.preview(null);
      return o;
    });
    ok("scheme: default A (from the data file)", r.schemeDefault === "A", r.schemeDefault);
    ok("scheme A: Växjö chain [sv-syd, sv-neutral]; a B-only key is not used", r.aChain.join() === "sv-syd,sv-neutral" && r.aSma === "test.sma", r);
    ok("scheme B: Växjö chain [sv-smaland, sv-syd, sv-neutral], region sv-smaland", r.bChain.join() === "sv-smaland,sv-syd,sv-neutral" && r.bRegion === "sv-smaland", r.bChain);
    ok("scheme B: B pack key used; missing B key falls back to the A pack (Syd line)", r.bSma === "SMÅ" && r.bGrp === r.sydGrp, [r.bSma, r.bGrp]);
    ok("scheme B: Karlskoga (B värmland, A neutral) → [sv-varmland, sv-neutral]", r.karlskoga[0].join() === "sv-varmland,sv-neutral" && r.karlskoga[1] === "VÄRM" && r.karlskoga[2], r.karlskoga);
    ok("scheme B: Gävle (B neutral) → neutral only; scheme A: Gävle → Norrland", r.gavle.join() === "sv-neutral" && r.gavleA.join() === "sv-norr,sv-neutral", [r.gavle, r.gavleA]);
    ok("scheme B: Ludvika (B = A) → [sv-dalarna, sv-neutral]", r.ludvikaB.join() === "sv-dalarna,sv-neutral", r.ludvikaB);
    ok("variant not:[sv-smaland]: never shown in Växjö, shown in Malmö (60 seeds)", !r.vaxjoLines.some((l) => /påg/.test(l)) && r.malmoLines.some((l) => /påg/.test(l)), [r.vaxjoLines, r.malmoLines]);
    ok("preview(sv-smaland): chain [sv-smaland, sv-syd, sv-neutral]", r.preview[0].join() === "sv-smaland,sv-syd,sv-neutral" && r.preview[1] === "sv-smaland" && r.preview[2], r.preview);
    ok("no page errors (scheme part)", errs.length === 0, errs);
    await ctx.close();
  }

  // ---------- 4. stable variant per night ----------
  {
    const { ctx, page, errs } = await fresh(browser);
    const r = await page.evaluate((T) => {
      const D = window.DIALEKT, o = {};
      D.register("sv-neutral", { "test.v": ["a", "b", "c", "d", "e", "f", "g", "h"] });
      D.setArea({ code: "0380" });   // Uppsala (neutral)
      D._setNow(T.fri22); o.n1 = D._night();
      o.same = new Set(Array.from({ length: 25 }, () => D.t("test.v"))).size;
      o.v22 = D.t("test.v");
      D._setNow(T.sat03); o.v03 = D.t("test.v"); o.n2 = D._night();   // 03:00 next day = same night
      D._setNow(T.sat06); o.n3 = D._night();                          // 06:00 = a new night
      const nights = new Set(); for (let d = 0; d < 14; d++) { D._setNow(T.fri22 + d * 864e5); nights.add(D.t("test.v")); } o.nights = nights.size;
      D._setNow(T.fri22); const seeds = new Set(); for (let s = 0; s < 40; s++) seeds.add(D.t("test.v", { _seed: s })); o.seeds = seeds.size;
      D._setNow(null);
      return o;
    }, { fri22: at(2026, 11, 13, 22), sat03: at(2026, 11, 14, 3), sat06: at(2026, 11, 14, 6) });
    ok("variant: 25 re-renders in one night give the same line", r.same === 1, r);
    ok("variant: 03:00 is still the same night (same line); 06:00 starts the next night", r.v22 === r.v03 && r.n1 === r.n2 && r.n3 !== r.n1, r);
    ok("variant: changes over 14 nights (≥ 3 different of 8)", r.nights >= 3, r.nights);
    ok("variant: vars._seed picks other variants (≥ 4 of 8 over 40 seeds)", r.seeds >= 4, r.seeds);
    ok("no page errors (variant part)", errs.length === 0, errs);
    await ctx.close();
  }

  // ---------- 5. off mode, persistence, onChange ----------
  {
    const { ctx, page, errs } = await fresh(browser, { "olnu.homeTown": "Ludvika" });
    const r = await page.evaluate(() => {
      const D = window.DIALEKT, P = D._packs(), o = { calls: [] };
      D.onChange((i) => o.calls.push(i.region + "/" + i.mode));
      o.auto = [D.mode(), D.region(), D.area() && D.area().src];
      D.setMode("off"); o.off = [D.mode(), D.region(), D.chain().join(), D.t("grp.empty") === P["sv-neutral"]["grp.empty"]];
      D.setMode("off");   // same mode again: no event
      o.ls = localStorage.getItem("olnu.dialekt");
      D._resolve();      // same area again: no event
      return o;
    });
    ok("hometown 'Ludvika' → sv-dalarna (src hometown)", r.auto[0] === "auto" && r.auto[1] === "sv-dalarna" && r.auto[2] === "hometown", r.auto);
    ok("off: region sv-neutral, chain [sv-neutral], neutral text", r.off[0] === "off" && r.off[1] === "sv-neutral" && r.off[2] === "sv-neutral" && r.off[3], r.off);
    ok("off: persisted in localStorage olnu.dialekt", /"mode":"off"/.test(r.ls || ""), r.ls);
    ok("onChange: fired once for the one real change", r.calls.length === 1 && r.calls[0] === "sv-neutral/off", r.calls);
    await page.reload(); await page.evaluate(() => window.DIALEKT.ready());
    const r2 = await page.evaluate(() => [window.DIALEKT.mode(), window.DIALEKT.region()]);
    ok("off: still off after a reload", r2[0] === "off" && r2[1] === "sv-neutral", r2);
    await page.evaluate(() => window.DIALEKT.setMode("auto"));
    ok("auto again → sv-dalarna", (await page.evaluate(() => window.DIALEKT.region())) === "sv-dalarna");
    ok("no page errors (mode part)", errs.length === 0, errs);
    await ctx.close();
  }

  // ---------- 6. source order: current position → push cell → hometown → home zone; stale ignored; mods hook ----------
  {
    const now = Date.now();
    const cases = [
      ["push cell (fresh) beats hometown", { "olnu.pushLoc": { c: "6015,1519", t: now - 3600e3 }, "olnu.homeTown": "Malmö" }, "sv-dalarna", "push"],
      ["stale push cell (13 h) is skipped → hometown", { "olnu.pushLoc": { c: "6015,1519", t: now - 13 * 3600e3 }, "olnu.homeTown": "Malmö" }, "sv-syd", "hometown"],
      ["hometown alias 'Grängesberg' → Ludvika", { "olnu.homeTown": "Grängesberg" }, "sv-dalarna", "hometown"],
      ["home zone only (Umeå) → Norrland", { "olnu.home": { lat: 63.8258, lng: 20.263, r: 300 } }, "sv-norr", "homezone"],
      ["nothing known → neutral", {}, "sv-neutral", null],
    ];
    for (const [name, ls, want, src] of cases) {
      const { ctx, page } = await fresh(browser, ls);
      const g = await page.evaluate(() => [window.DIALEKT.region(), window.DIALEKT.area() && window.DIALEKT.area().src]);
      ok("source: " + name, g[0] === want && g[1] === src, g);
      await ctx.close();
    }
    const { ctx, page, errs } = await fresh(browser, { "olnu.homeTown": "Malmö" });
    const r = await page.evaluate(() => {
      const D = window.DIALEKT, o = { ev: [] }; let ll = { lat: 59.3293, lng: 18.0686 };
      window.addEventListener("dialekt:change", (e) => o.ev.push(e.detail.region));
      D.init({ lastLoc: () => ll });
      o.sthlm = [D.region(), D.area().src];
      D.onPoll(); o.samePoll = o.ev.length;
      ll = { lat: 57.7089, lng: 11.9746 }; D.onPoll(); o.gbg = D.region();
      ll = null; D.onPoll(); o.nullLoc = D.region();
      D.init(null); D._resolve(); o.back = [D.region(), D.area().src];
      return o;
    });
    ok("mods hook: api.lastLoc() (Stockholm) beats hometown Malmö", r.sthlm[0] === "sv-sthlm" && r.sthlm[1] === "loc", r);
    ok("mods hook: onPoll re-checks only when the position moves (Göteborg → sv-vast)", r.samePoll === 1 && r.gbg === "sv-vast", r);
    ok("mods hook: without a position → back to hometown (sv-syd)", r.back[0] === "sv-syd" && r.back[1] === "hometown", r);
    ok("window event dialekt:change carries the region", r.ev[0] === "sv-sthlm" && r.ev.includes("sv-vast"), r.ev);
    ok("no page errors (source part)", errs.length === 0, errs);
    await ctx.close();
  }

  // ---------- 7. lazy load + cached region before / without data ----------
  {
    const { ctx, page, reqs, errs } = await fresh(browser, {}, { noReady: true });
    await wait(page, 1000);
    const early = reqs.length;
    await wait(page, 4000);
    ok("lazy: no data request in the first second; loaded on idle (~2 s after load)", early === 0 && reqs.length === 1, { early, after: reqs.length });
    await ctx.close();
    const b = await fresh(browser, { "olnu.dialekt.r": { cc: "SE", lang: "sv", code: "2085", name: "Ludvika", a: "sv-dalarna", b: "sv-dalarna", src: "loc", at: Date.now() } }, { noReady: true, blockData: true });
    const g = await b.page.evaluate(async () => { const D = window.DIALEKT, r0 = D.region(), t0 = D.t("grp.empty"); const okd = await D.ready(); return [r0, t0 === D._packs()["sv-dalarna"]["grp.empty"], okd, D.region(), D.stats.err]; });
    ok("cache: last region (Ludvika) used at once, and kept when the data file fails (offline)", g[0] === "sv-dalarna" && g[1] && g[2] === false && g[3] === "sv-dalarna" && !!g[4], g);
    const c = await fresh(browser, {}, { noReady: true });
    const first = await c.page.evaluate(() => { window.DIALEKT.t("grp.empty"); return true; });
    await wait(c.page, 300);
    ok("lazy: the first t() call starts the data load at once", first && c.reqs.length === 1, c.reqs.length);
    ok("no page errors (lazy part)", errs.length === 0 && b.errs.length === 0 && c.errs.length === 0, [errs, b.errs, c.errs]);
    await b.ctx.close(); await c.ctx.close();
  }

  // ---------- 8. the real app: loads, Ludvika, Inställningar row (360/390/430) ----------
  for (const w of [360, 390, 430]) {
    const { ctx, page } = await ctxFor(browser, { width: w, height: 844 });
    await ctx.addInitScript(() => { if (!localStorage.getItem("olnu.homeTown")) localStorage.setItem("olnu.homeTown", "Ludvika"); });
    // the server's home town (hometown.js my_home_town → localStorage olnu.homeTown); the shared mock says null
    await page.route(/rest\/v1\/rpc\/my_home_town\b/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ v: 1, town: "Ludvika" }) }));
    const perr = []; page.on("pageerror", (e) => perr.push(e.message));
    const dreq = []; page.on("request", (r) => { if (/dialekt-kommun\.json/.test(r.url())) dreq.push(r.url()); });
    await boot(page);
    const s = await page.evaluate(async () => { const D = window.DIALEKT; if (!D) return null; await D.ready(); return { region: D.region(), area: D.area(), ms: D.stats.loadMs, err: D.stats.err }; });
    ok(`[${w}] app: DIALEKT loaded, data in, region sv-dalarna (Ludvika)`, !!s && s.region === "sv-dalarna" && s.area && s.area.name === "Ludvika" && !s.err, s);
    // with app.js mods() listing DIALEKT (patch 02) the source is the app's own position; without it, the home town
    ok(`[${w}] app: source = ${HOOKED ? "loc (api.lastLoc via mods hook)" : "hometown (no mods hook)"}`, !!s && s.area && s.area.src === (HOOKED ? "loc" : "hometown"), s && s.area);
    ok(`[${w}] app: data file fetched once`, dreq.length === 1, dreq);
    ok(`[${w}] app: no page errors`, perr.length === 0, perr);
    await page.click("#btn-settings"); await wait(page, 1200);
    await page.evaluate(() => {
      const b = document.getElementById("sheet-body"), row = window.DIALEKT.settingsRow();
      const sec = b.querySelector("section.ds-section .ds-list");   // as the social lane would: one .ds-item in a list card
      const it = document.createElement("div"); it.className = "ds-item dk-test-item"; it.appendChild(row);
      (sec || b).insertBefore(it, (sec || b).firstChild); it.scrollIntoView({ block: "center" });
    });
    await wait(page, 400);
    const m = await page.evaluate(() => {
      const row = document.querySelector(".dk-set"), btn = row.querySelector(".dk-sw"), sw = btn.querySelector(".switch"), sub = btn.querySelector(".dk-sub"), r = btn.getBoundingClientRect();
      return { h: Math.round(r.height), w: Math.round(r.width), vw: innerWidth, right: Math.round(r.right), swW: Math.round(sw.getBoundingClientRect().width), swRight: Math.round(sw.getBoundingClientRect().right),
        sub: sub.textContent, subCut: sub.scrollWidth > sub.clientWidth + 1, aria: btn.getAttribute("aria-checked"), role: btn.getAttribute("role"), icon: !!btn.querySelector("svg") };
    });
    ok(`[${w}] row: ≥ 56 px high, inside the screen, switch on the right`, m.h >= 56 && m.right <= m.vw && m.swW >= 40 && m.swRight <= m.vw - 8, m);
    ok(`[${w}] row: switch role, on = Auto, sub-line 'Auto · Dalarna (Ludvika)' not cut`, m.role === "switch" && m.aria === "true" && m.sub === "Auto · Dalarna (Ludvika)" && !m.subCut, m);
    const box = await page.evaluate(() => { const r = document.querySelector(".dk-test-item").getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top - 70), width: innerWidth, height: Math.min(innerHeight - Math.max(0, r.top - 70), r.height + 140) }; });
    await page.screenshot({ path: SP + `ui-testshots/dialekt-row-on-${w}.png`, clip: box });
    await page.click(".dk-sw"); await wait(page, 400);
    const off = await page.evaluate(() => ({ aria: document.querySelector(".dk-sw").getAttribute("aria-checked"), sub: document.querySelector(".dk-sub").textContent, mode: window.DIALEKT.mode(), region: window.DIALEKT.region() }));
    ok(`[${w}] row: tap → Av (mode off, neutral, sub-line 'Av · …')`, off.aria === "false" && off.mode === "off" && off.region === "sv-neutral" && /^Av · /.test(off.sub), off);
    await page.screenshot({ path: SP + `ui-testshots/dialekt-row-off-${w}.png`, clip: box });
    await page.click(".dk-sw"); await wait(page, 300);
    ok(`[${w}] row: second tap → Auto again`, await page.evaluate(() => window.DIALEKT.mode() === "auto" && document.querySelector(".dk-sw").getAttribute("aria-checked") === "true"));
    await ctx.close();
  }

  // ---------- 9. phase 2: the call sites read the region packs (lazy, region only), Av = the plain def, exact {mix} ----------
  // Region = the phone's position. Nights = DIALEKT._setNow (the variant + mix
  // draw is stable per night). "Region line" = matches a line of that region's pack and is not in the Av (neutral) set.
  // the phone's own position (geolocation → the app's api.lastLoc via the mods hook → the kommun → the region)
  const P2 = [["Ludvika", "sv-dalarna", 60.1496, 15.1878], ["Malmö", "sv-syd", 55.6050, 13.0038], ["Stockholm", "sv-sthlm", 59.3293, 18.0686],
    ["Umeå", "sv-norr", 63.8258, 20.2630], ["Göteborg", "sv-vast", 57.7089, 11.9746], ["Uppsala", "sv-neutral", 59.8586, 17.6389]];
  const VARS = /\{[A-Za-z_]\w*\}/;
  // all call-site text of the four surfaces, read through the real content objects (as the app reads them)
  const sample = () => {
    const d = new Proxy({ name: "Oskar", bar: "Pitchers", group: "Ludvika Lager", n: 7, k: 3, stad: "Ludvika", town: "Ludvika", t: 4, p: 40, title: "Löjtnant",
      b: 2, who: "Lisa", where: "Pitchers", krogar: "krogar", personer: "personer", min: 5, m: 5, h: 2, x: 1, total: 9, home: "02:10" }, { get: (o, k) => (k in o ? o[k] : "Ludvika") });
    const out = { live: [], toast: [], card: [] };
    (window.NEWS_GT || []).concat((window.NEWS_MORE && window.NEWS_MORE.sv) || []).forEach((x) => { try { const s = x.f(d); if (typeof s === "string") out.live.push(s); } catch (e) {} });
    const I = window.I18N, q = I.t("bpQueueToasts") || {};
    ["none", "short", "long"].forEach((k) => (q[k] || []).forEach((s) => out.toast.push(s)));
    Object.keys(window.DRINK_LINES || {}).forEach((k) => window.DRINK_LINES[k].forEach((s) => out.toast.push(s)));
    // game cards: Spel (spel-cards.js), Förfest and Party decks (index-stable, one key per card)
    const deep = (x, dep) => { if (dep > 4 || !x) return; if (typeof x === "string") { if (x.length > 15) out.card.push(x); return; } if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) deep(x[i], dep + 1); return; } if (typeof x === "object") Object.keys(x).forEach((k) => k !== "en" && deep(x[k], dep + 1)); };
    deep(window.SPEL_CARDS, 0); ["mest", "aldrig", "utm", "kat", "virus", "kapten"].forEach((k) => deep((window.FORFEST_CONTENT || {})[k], 1));
    ["survivor", "hatten", "flocken"].forEach((k) => deep((window.PARTY_CONTENT || {})[k], 1));
    return out;
  };
  const regexes = (pack) => {
    const out = [];
    Object.keys(pack || {}).forEach((k) => { const v = pack[k]; (Array.isArray(v) ? v : [v]).forEach((x) => { const s = typeof x === "string" ? x : x && x.t; if (s && s.replace(/\{[A-Za-z_]\w*\}/g, "").length > 14) out.push(s); }); });
    return out;
  };
  const toRe = (s) => new RegExp("^" + s.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\?\{[A-Za-z_]\w*\\?\}/g, ".+?") + "$");
  // boot without the Ludvika map-pill wait (the mock bars are in Ludvika; the phone is elsewhere)
  const bootAt = async (page) => { await page.goto(BASE); await page.waitForFunction(() => window.__map && window.DIALEKT && document.getElementById("ticker-track"), null, { timeout: 30000 }).catch(() => {}); await wait(page, 3500); };
  for (const [town, code, lat, lng] of P2) {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
    await ctx.setGeolocation({ latitude: lat, longitude: lng });
    const preq = []; page.on("request", (r) => { if (/dialekt-packs\//.test(r.url())) preq.push(r.url().replace(/^.*\//, "")); });
    const perr = []; page.on("pageerror", (e) => perr.push(e.message));
    await page.route(/rest\/v1\/rpc\/group_now\b/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ v: 1, now: new Date().toISOString(), members: 4, out: [], last: null }) }));
    await page.route(/rest\/v1\/rpc\/post_other(_v2)?\b/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, other_count: 1, drinks: 7, beer_count: 6, wait_seconds: 0 }) }));
    await bootAt(page);
    await page.evaluate(() => window.OLNU_LAZY_NOW && window.OLNU_LAZY_NOW());
    if (code !== "sv-neutral") await page.waitForFunction((c) => window.DIALEKT.stats.packs[c] && window.DIALEKT.stats.packs[c + "-lek"], code, { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => window.NEWS_GT && window.DRINK_LINES && window.SPEL_CARDS && window.FORFEST_CONTENT && window.PARTY_CONTENT, null, { timeout: 15000 }).catch(() => {});
    const r = await page.evaluate(([code, sampleSrc, reSrc, toReSrc]) => {
      const sample = eval("(" + sampleSrc + ")"), regexes = eval("(" + reSrc + ")"), toRe = eval("(" + toReSrc + ")"), D = window.DIALEKT, base = Date.now(), VARS_RE = /\{[A-Za-z_]\w*\}/;
      const o = { region: D.region(), packs: Object.keys(D.stats.packs), hits: { live: 0, toast: 0, card: 0 }, n: {}, vars: [], offEqNeutral: null, offHits: 0 };
      const res = regexes(D._packs()[code]).map(toRe);
      const off = {}, offSets = {};
      D.setMode("off"); const so = sample(); D.setMode("auto");
      Object.keys(so).forEach((k) => { offSets[k] = new Set(so[k]); });
      for (let night = 0; night < 4; night++) {
        D._setNow(base + night * 864e5);
        const s = sample();
        Object.keys(s).forEach((k) => {
          o.n[k] = s[k].length;
          s[k].forEach((x) => { if (!offSets[k].has(x) && [x].concat(x.split("|")).some((y) => res.some((re) => re.test(y)))) o.hits[k]++; });   // a card may be "MODES|text|end|N"
        });
        s.live.forEach((x) => { if (VARS_RE.test(x) && o.vars.length < 5) o.vars.push(x); });
      }
      D._setNow(null);
      // Av: the same text as a neutral area, whatever the region
      D.setMode("off"); const a = JSON.stringify(sample()); const offRegion = D.region();
      D.setMode("auto"); const keep = D.area(); D.setArea({ name: "Uppsala" }); const nz = JSON.stringify(sample());
      o.offEqNeutral = a === nz && offRegion === "sv-neutral";
      o.offHits = 0; D.setMode("off"); const s2 = sample(); D.setMode("auto"); D.setArea({ name: keep ? keep.name : "Uppsala" });
      Object.keys(s2).forEach((k) => s2[k].forEach((x) => { if (!offSets[k].has(x)) o.offHits++; }));
      return o;
    }, [code, sample.toString(), regexes.toString(), toRe.toString()]).catch((e) => ({ err: String(e) }));
    const label = `[p2 ${town} → ${code}]`;
    if (code === "sv-neutral") {
      ok(`${label} neutral area: no region pack loaded, every line = the Av line`, r.region === "sv-neutral" && preq.length === 0 && r.hits && r.hits.live + r.hits.toast + r.hits.card === 0, { r, preq });
    } else {
      ok(`${label} only this region's pack (+ its -lek) is fetched, once each`, preq.length === 2 && preq.includes(code + ".js") && preq.includes(code + "-lek.js"), preq);
      ok(`${label} LIVE ticker templates show region lines (${r.hits && r.hits.live}/${r.n && r.n.live * 4})`, r.hits && r.hits.live > 0, r);
      ok(`${label} toasts (queue + drink lines) show region lines (${r.hits && r.hits.toast})`, r.hits && r.hits.toast > 0, r);
      ok(`${label} game cards show region cards (${r.hits && r.hits.card})`, r.hits && r.hits.card > 0, r);
    }
    ok(`${label} no {var} left in the LIVE lines`, r.vars && r.vars.length === 0, r.vars);
    ok(`${label} Av = the same text as a neutral area, and never a region line`, r.offEqNeutral === true && r.offHits === 0, r);
    // the rendered surfaces: ticker belt, a real drink toast, the group empty state (several nights)
    const dom = await page.evaluate(async () => {
      const W = (ms) => new Promise((f) => setTimeout(f, ms)), o = { tick: "", toast: "", empty: [] };
      window.dispatchEvent(new CustomEvent("dialekt:change", { detail: {} })); await W(1500);
      o.tick = (document.getElementById("ticker-track") || {}).textContent || "";
      try { localStorage.removeItem("olnu.otherCd"); } catch (e) {}
      document.querySelectorAll(".toast").forEach((t) => t.remove());
      const b = document.getElementById("btn-other"); if (b) { b.click(); await W(900); const k = document.querySelector('#sheet-body .kind-btn[data-kind="rom"]') || document.querySelector("#sheet-body .kind-btn"); if (k) { k.click(); await W(1500); } }
      o.toast = [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | ");
      document.getElementById("sheet-close") && document.getElementById("sheet-close").click(); await W(400);
      return o;
    });
    ok(`${label} ticker belt rendered, no {var} in it`, dom.tick.length > 20 && !VARS.test(dom.tick), dom.tick.slice(0, 300));
    ok(`${label} drink toast shown, no {var} in it`, dom.toast.length > 10 && !VARS.test(dom.toast), dom.toast);
    const empties = [];
    for (let night = 0; night < 6; night++) {
      await page.evaluate((nt) => { window.DIALEKT._setNow(Date.now() + nt * 864e5); }, night);
      await page.click("#btn-groups").catch(() => {}); await wait(page, 900);
      await page.evaluate(() => { const c = [...document.querySelectorAll(".glist .gcard")][0]; if (c) c.click(); }); await wait(page, 1500);
      empties.push(await page.evaluate(() => { const e = document.querySelector(".gpg-now-l"); return e ? e.textContent : null; }));
      await page.evaluate(() => { const c = document.getElementById("sheet-close"); if (c) c.click(); }); await wait(page, 400);
    }
    await page.evaluate(() => window.DIALEKT._setNow(null));
    const em = await page.evaluate(([code, list]) => {
      const D = window.DIALEKT, pk = D._packs()[code] || {}, v = pk["grp.empty"];
      const reg = (Array.isArray(v) ? v : v ? [v] : []).map((x) => (typeof x === "string" ? x : x && x.t)).filter(Boolean);
      return { reg: list.filter((x) => x && reg.includes(x)).length, ok: list.filter(Boolean).length };
    }, [code, empties]);
    ok(`${label} group empty state shown on 6 nights, no {var}`, em.ok === 6 && empties.every((x) => x && !VARS.test(x)), empties);
    if (code !== "sv-neutral") ok(`${label} group empty state: region line at least once in 6 nights (${em.reg}/6)`, em.reg > 0, empties);
    ok(`${label} no page errors`, perr.length === 0, perr);
    await ctx.close();
  }

  // ---------- 10. phase 2: Settings Dialekt Av / Auto acts at once; start-up: the pack never makes a long task ----------
  {
    const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
    await ctx.addInitScript(() => { window.__lt = []; try { performance.setResourceTimingBufferSize(3000); } catch (e) {} try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([e.startTime, e.duration]))).observe({ type: "longtask", buffered: true }); } catch (e) {} });
    const perr = []; page.on("pageerror", (e) => perr.push(e.message));
    await boot(page);   // ctxFor = Ludvika → sv-dalarna (the biggest pack, 351 KB)
    await page.waitForFunction(() => window.DIALEKT.stats.packs["sv-dalarna"], null, { timeout: 15000 }).catch(() => {});
    const t = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0], res = performance.getEntriesByType("resource").filter((r) => /dialekt-packs\//.test(r.name));
      const lt = window.__lt, win = res.map((r) => [r.responseEnd, r.responseEnd + 150]);
      const near = lt.filter(([s, d]) => d > 50 && win.some(([a, b]) => s + d >= a && s <= b));
      return { load: Math.round(nav.loadEventEnd), packs: res.map((r) => [r.name.replace(/^.*\//, ""), Math.round(r.startTime), Math.round(r.responseEnd)]), near: near.map((x) => x.map(Math.round)), all: lt.map((x) => x.map(Math.round)) };
    });
    ok("start-up: the region pack loads after the load event (first paint first)", t.packs.length >= 1 && t.packs.every((p) => p[1] >= t.load), t);
    ok("start-up: no long task (> 50 ms) while a pack is evaluated", t.near.length === 0, t);
    const before = await page.evaluate(() => window.I18N.t("tickQuiet"));
    await page.click("#btn-settings"); await wait(page, 1200);
    await page.evaluate(() => { const b = document.getElementById("sheet-body"), row = window.DIALEKT.settingsRow(); b.insertBefore(row, b.firstChild); });
    await page.evaluate(() => document.querySelector(".dk-sw").click()); await wait(page, 300);
    const off = await page.evaluate(() => ({ mode: window.DIALEKT.mode(), q: window.I18N.t("tickQuiet"), tick: document.getElementById("ticker-track").textContent }));
    await page.evaluate(() => document.querySelector(".dk-sw").click()); await wait(page, 300);
    const on = await page.evaluate(() => ({ mode: window.DIALEKT.mode(), q: window.I18N.t("tickQuiet") }));
    ok("settings: Av = the plain line at once, Auto = the region line at once (tickQuiet)", off.mode === "off" && on.mode === "auto" && off.q !== before && on.q === before && !/int'/.test(off.q), { before, off, on });
    ok("no page errors (settings / start-up part)", perr.length === 0, perr);
    await ctx.close();
  }

  // ---------- 11. phase 2: the pack is fetched once and the service worker keeps it (next start + offline) ----------
  {
    const ctx = await browser.newContext({ serviceWorkers: "allow", viewport: { width: 390, height: 844 }, locale: "sv-SE" });
    const page = await ctx.newPage();
    await mock(page, {});
    const net = []; ctx.on("requestfinished", async (r) => { if (/dialekt-packs\/sv-syd\.js/.test(r.url())) { const res = await r.response(); net.push({ sw: !!(res && res.fromServiceWorker()), byWorker: !!r.serviceWorker() }); } });
    await page.goto(BASE); await wait(page, 2500);
    const ctl = await page.evaluate(async () => { await navigator.serviceWorker.ready; return !!navigator.serviceWorker.controller; });
    if (!ctl) { await page.reload(); await wait(page, 2500); }
    await page.evaluate(() => window.DIALEKT.preview("sv-syd"));
    await page.waitForFunction(() => window.DIALEKT.stats.packs["sv-syd"], null, { timeout: 15000 }).catch(() => {});
    await wait(page, 1500);
    const cached = await page.evaluate(async () => { const c = await caches.open("olnu-data"); const k = await c.keys(); return k.map((r) => r.url.replace(/^.*\//, "")).filter((u) => /^sv-/.test(u)); });
    ok("sw: the region pack (and its -lek) is in the data cache after the first load", cached.includes("sv-syd.js") && cached.includes("sv-syd-lek.js"), cached);
    ok("sw: no sv-neutral pack is fetched or cached", !cached.some((u) => /neutral/.test(u)), cached);
    await ctx.setOffline(true);
    await page.reload(); await wait(page, 2500);
    const off = await page.evaluate(async () => { await new Promise((f) => setTimeout(f, 1500)); return { ok: !!window.DIALEKT.stats.packs["sv-syd"], region: window.DIALEKT.region() }; });
    const first = net.filter((x) => !x.byWorker).length;
    ok("sw: offline next start still gets the region pack (from the cache)", off.ok && off.region === "sv-syd", off);
    // (Playwright does not report the worker's own fetches; the offline start above proves the cache.)
    ok("sw: the page asked for the pack once per start, and the service worker answered both times", first === 2 && net.every((x) => x.sw), net);
    await ctx.setOffline(false);
    await page.evaluate(() => window.DIALEKT.preview(null));
    await ctx.close();
  }

  console.log(`dialekt: ${pass} pass, ${fail} fail`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash", e && e.stack || e); process.exit(1); });
