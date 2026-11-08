// tx TEXT FIT: every rank name, every new medal name, every KAOS banner line and a sample of LIVE lines rendered at 390 px
// in the real elements; FAIL = cut text where the design does not allow ellipsis. Usage: node txtfit-pw.js <port>
const H = require("./ds-helpers.js");
const pw = require("playwright");
const OLD = ["Rekryt", "Mönstrad Mellanöl", "Menig Mjöd", "Vicekorpral Kapsyl", "Korpral Korkskruv", "Skumsergeant", "Översergeant Sejdel", "Furir Flaskhals", "Överfurir Fatkran", "Fanjunkare Flasköppnare", "Fänrik Fatöl", "Löjtnant Lager", "Premiärlöjtnant Pilsner", "Kapten Kaggen", "Kommendörkapten Krus", "Ryttmästare Humle", "Major Mäsk", "Överstelöjtnant Ölstop", "Överste Ölkorv", "Brigadgeneral Bärs", "Flottiljamiral Flaskpost", "Generalmajor Gambrinus", "Generallöjtnant Guldskum", "General Gyllenbärs", "Amiral Ankarstout", "Fältmarskalk Fradga", "Storamiral Skumtopp", "Riksmarskalk Rundtur", "Baron av Bryggstugan", "Hertig av Humlefältet", "Ärkehertig av Ölkranen", "Kung Kapsyl den Store", "Ölkejsaren", "Bryggerilegenden", "Halvguden vid Jäskaret", "Myten i Mässen", "Legenden vid Långbordet", "Sagofiguren i Skyttegraven", "Oraklet i Ölstugan", "Överbefälhavare Öl", "Generalissimus Glaset", "Ölguden"];
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 600)); };
(async () => {
  const browser = await pw.chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  const { ctx, page } = await H.ctxFor(browser, { width: 390, height: 844 }, { ua: "ios" });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  page.setDefaultNavigationTimeout(180000); page.setDefaultTimeout(120000);
  await H.boot(page);
  await page.evaluate(() => document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove()));
  const titles = await page.evaluate(() => window.SOCIAL.TITLES.map((x) => x[1]));
  ok(titles.length === 42 && new Set(titles).size === 42, "42 unique rank names", titles.length);
  ok(titles.filter((t) => t.length > 22).join() === "Premiärlöjtnant Pilsner", "every rank name <= 22 characters (owner exception: Premiärlöjtnant Pilsner)", titles.filter((t) => t.length > 22));

  // A probe = a real element of the app with its real classes and parent, so the real CSS applies.
  const measure = (sel, parentSel, texts, build) => page.evaluate(({ sel, parentSel, texts, build }) => {
    const host = document.querySelector(parentSel) || document.body; if (build.open) host.classList.add("open");
    const el = document.createElement(build.tag); el.className = build.cls; if (build.html) el.innerHTML = build.html;
    host.appendChild(el);
    const tgt = build.inner ? el.querySelector(build.inner) : el;
    const cs = getComputedStyle(tgt), out = [];
    texts.forEach((t) => {
      tgt.textContent = (build.pre || "") + t + (build.post || "");
      const cut = tgt.scrollWidth > tgt.clientWidth + 1 || (!build.hOnly && tgt.scrollHeight > tgt.clientHeight + 1);
      const r = tgt.getBoundingClientRect();
      out.push({ t, cut, off: r.right > innerWidth + 0.5 || r.left < -0.5, lines: Math.round(r.height / (parseFloat(cs.lineHeight) || 20)) });
    });
    const ell = cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none" && cs.webkitLineClamp !== "";
    el.remove(); if (build.open) host.classList.remove("open");
    return { out, ell, ws: cs.whiteSpace };
  }, { sel, parentSel, texts, build });

  // 1. rank chip in the open HUD panel — "🎖️ <rank> · 1234 meriter"; ellipsis is the design; the new ladder must not cut more than the old
  const chip = (list) => measure(".hx-title", ".hud-left", list, { tag: "button", cls: "hx-chip hx-title hx-title-m", pre: "🎖️ ", post: " · 1234 meriter", open: 1, hOnly: 1 });
  let m = await chip(titles), mo = await chip(OLD);
  const cn = m.out.filter((x) => x.cut || x.off), co = mo.out.filter((x) => x.cut || x.off);
  console.log("info chip (open panel): ellipsis=" + m.ell + " cut new " + cn.length + "/42, old " + co.length + "/42", JSON.stringify(cn.map((x) => x.t)));
  ok(cn.length <= co.length && (m.ell || !cn.length), "HUD rank chip: new ladder cuts no more names than the old one (ellipsis by design)", [cn.length, co.length]);
  // 2. uniform rank (big display font)
  m = await measure(".uni-rank", "body", titles, { tag: "div", cls: "uni-rank", hOnly: 1 });
  ok(m.out.every((x) => !x.off && !x.cut), "uniform .uni-rank: all 42 fit at 390 px", m.out.filter((x) => x.off || x.cut).map((x) => x.t));
  ok(m.out.every((x) => x.lines <= 2), "uniform .uni-rank: max 2 lines", m.out.filter((x) => x.lines > 2).map((x) => [x.t, x.lines]));
  // 3. meriter sheet rank (.mer-rank) and the level-up popup (.mx-new)
  m = await measure(".mer-rank", "body", titles, { tag: "div", cls: "mer-ex", html: '<div class="mer-me"><div class="mer-rank"></div></div>', inner: ".mer-rank", hOnly: 1 });
  ok(m.out.every((x) => !x.off && !x.cut), "meriter sheet .mer-rank: all 42 fit", m.out.filter((x) => x.off || x.cut).map((x) => x.t));
  m = await measure(".mx-new", "body", titles, { tag: "div", cls: "mx-ranks", html: '<span class="mx-new"></span>', inner: ".mx-new", hOnly: 1 });
  ok(m.out.every((x) => !x.off && !x.cut), "level-up .mx-new: all 42 fit", m.out.filter((x) => x.off || x.cut).map((x) => x.t));
  // 4. top list sub line "🎖️ <rank>" (ellipsis by design in styles.css .top-sub)
  m = await measure(".top-sub", "body", titles, { tag: "div", cls: "toplist", html: '<div class="top-row" style="width:358px"><span class="top-rank">01</span><span class="top-main"><span class="top-name">Anton (du) · Ludvikabo</span><span class="top-sub"></span></span><span class="top-n">7000 m</span></div>', inner: ".top-sub", pre: "🎖️ " });
  const subCut = m.out.filter((x) => x.cut);
  ok(!subCut.length, "board .top-sub: no rank name is cut at 390 px", { ellipsis: m.ell, cut: subCut.map((x) => x.t) });
  // 5. KAOS banner head (line clamp = allowed truncation; report how many are clamped)
  const chaos = await page.evaluate(() => (window.I18N.t("chaosLines") || []).map((l) => l.replace(/\{stad\}/g, "Smedjebacken").replace(/\{n\}/g, "23").replace(/\{hot\}/g, "3").replace(/\{bar\}/g, "Bishops Arms")));
  // #chaos banner is display:none in the new design (pnds.css); KAOS shows as a toast (app.js chaos-toast)
  const r = await page.evaluate((lines) => {
    const host = document.getElementById("toasts") || document.body, el = document.createElement("div"); el.className = "toast chaos-toast"; host.appendChild(el);
    const out = lines.map((t) => { el.textContent = t; const b = el.getBoundingClientRect(); return { t, cut: el.scrollWidth > el.clientWidth + 1, off: b.right > innerWidth + 0.5 || b.left < -0.5, h: Math.round(b.height) }; });
    el.remove(); return out;
  }, chaos);
  const bad = r.filter((x) => x.cut || x.off);
  console.log("info KAOS toast heights: " + Math.min(...r.map((x) => x.h)) + "–" + Math.max(...r.map((x) => x.h)) + " px");
  ok(!bad.length, "KAOS toast: all " + r.length + " lines fit at 390 px (no cut)", bad.map((x) => x.t));
  // 6. LIVE ticker: items never wrap or clip (belt)
  const tk = await page.evaluate(() => {
    const it = document.querySelector(".tk-item"); if (!it) return null;
    const cs = getComputedStyle(it), old = it.textContent;
    it.textContent = "🎢 Liseberg har stängt karusellerna. Göteborg kör sin egen åktur. 🎓 Uppsala: nationerna har öppnat. Tentan får vänta till måndag.";
    const r = { ws: cs.whiteSpace, ov: cs.overflow, cut: it.scrollWidth > it.clientWidth + 1, h: it.getBoundingClientRect().height };
    it.textContent = old; return r;
  });
  ok(tk && /nowrap/.test(tk.ws) && !tk.cut, "LIVE ticker item: one line, never clipped (moving belt)", tk);
  // 7. a real build now shows new kinds
  const k = await page.evaluate(() => { const L = window.NEWS.last(); const out = []; for (let i = 0; i < 30; i++) window.NEWS.build(L.beers, Object.assign({}, L.ctx, { now: new Date() })).forEach((x) => out.push(x.k)); return out; });
  ok(k.some((x) => /^(townJoke_|wd\d|mo\d|tMorning|tDay|t[1-5]|townWx_)/.test(x)), "NEWS.build uses the new kinds", [...new Set(k)].slice(0, 30));
  ok(!errs.length, "no page errors", errs.slice(0, 3));
  await ctx.close(); await browser.close();
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL crash " + (e && e.stack)); process.exit(1); });
