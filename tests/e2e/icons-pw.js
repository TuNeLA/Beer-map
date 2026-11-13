// lane icons: 25 new PNI icons (js/pnicons-more.js) + the emoji → icon map that the chrome pass and the toasts use.
// Usage: node icons-pw.js <port>
const { ctxFor, boot, wait, clickJS } = require("./ds-helpers.js");
const pw = require("playwright");
const fs = require("fs");
const path = require("path");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 500)); };
const NEW = ["warn", "siren", "stop", "hourglass", "undo", "save", "age18", "signal", "speaker-off", "ghost", "spy", "party", "gift", "bandage", "palette",
  "vote", "news", "radio", "scales", "truck", "sunrise", "cloud", "music", "cards", "ball"];

(async () => {
  const src = fs.readFileSync(path.join(__dirname, "../../docs/js/pnicons-more.js"), "utf8");
  ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "quality: no raw hex colour in the icon file (currentColor only)");
  ok(fs.readFileSync(path.join(__dirname, "../../docs/index.html"), "utf8").indexOf("pnicons-more.js") > 0, "the icon file is loaded by index.html");

  const browser = await pw.chromium.launch(require("./env.js").CHROME ? { executablePath: require("./env.js").CHROME } : {});
  const { ctx, page } = await ctxFor(browser, { width: 390, height: 844 });
  await boot(page);

  /* ---- 1. every new icon exists, renders, is unique, stays in the live area ---- */
  const r = await page.evaluate((NEW) => {
    const P = window.PNI, all = P.names(), seen = {}, dup = [], miss = [], bad = [], area = [], lab = [];
    all.forEach((n) => { const s = P.svg(n, ""); if (!s) return; const k = s.replace(/pi-[\w-]+/, ""); if (seen[k]) dup.push([n, seen[k]]); else seen[k] = n; });
    NEW.forEach((n) => {
      if (!P.has(n)) { miss.push(n); return; }
      const d = document.createElement("div"); d.innerHTML = P.svg(n, "");
      document.body.appendChild(d);
      const sv = d.querySelector("svg"), g = sv && sv.querySelector("g"), bb = g && g.getBBox();
      if (!sv || sv.getAttribute("viewBox") !== "0 0 24 24" || !g || g.getAttribute("stroke-width") !== "2" || g.getAttribute("stroke") !== "currentColor" || g.getAttribute("stroke-linejoin") !== "round") bad.push(n);
      if (bb && (bb.x < 1.9 || bb.y < 1.9 || bb.x + bb.width > 22.1 || bb.y + bb.height > 22.1 || Math.max(bb.width, bb.height) < 13)) area.push([n, bb.x, bb.y, bb.width, bb.height]);
      if (!/aria-hidden="true"/.test(P.svg(n, "")) || !/role="img" aria-label="Test"/.test(P.svg(n, "", "Test"))) lab.push(n);
      d.remove();
    });
    return { n: all.length, miss, bad, dup, area, lab };
  }, NEW);
  ok(r.miss.length === 0, "all 25 new icons exist in PNI", r.miss);
  ok(r.bad.length === 0, "same viewBox 24, stroke 2, round joins, currentColor", r.bad);
  ok(r.dup.length === 0, "no two icons have the same drawing", r.dup);
  ok(r.area.length === 0, "inside the live area 2…22 and not tiny", r.area);
  ok(r.lab.length === 0, "decorative = aria-hidden; with a label = role img + aria-label (icon-only buttons get a name)", r.lab);

  /* ---- 2. one emoji = one meaning: the icons that were shared are split ---- */
  const m = await page.evaluate((NEW) => {
    const E = window.PNI.EMOJI, used = {}; Object.keys(E).forEach((k) => { used[E[k]] = 1; });
    return { unused: NEW.filter((n) => !used[n]), ball: E["⚽"], tv: E["📺"], cards: E["🃏"], dice: E["🎲"], ghost: E["👻"], clock: E["⏰"], party: E["🎉"], spark: E["✨"],
      vin: E["🍷"], whisky: E["🥃"], warn: E["⚠️"], save: E["💾"], news: E["📰"] };
  }, NEW);
  ok(m.unused.length === 0, "every new icon is reachable from an emoji", m.unused);
  ok(m.ball === "ball" && m.tv === "tv", "sport = ball, TV = tv (were both tv)", [m.ball, m.tv]);
  ok(m.cards === "cards" && m.dice === "game", "cards ≠ dice (were both game)", [m.cards, m.dice]);
  ok(m.ghost === "ghost" && m.clock === "clock", "ghost ≠ history", [m.ghost, m.clock]);
  ok(m.party === "party" && m.spark === "sparkle", "party popper ≠ sparkle", [m.party, m.spark]);
  ok(m.vin !== m.whisky, "wine ≠ whisky (were both drink)", [m.vin, m.whisky]);
  ok(m.warn === "warn" && m.save === "save" && m.news === "news", "⚠️ 💾 📰 have icons (were dropped)", m);

  /* ---- 3. chrome pass: a leading emoji in a sheet button / heading becomes the icon, no emoji left ---- */
  await clickJS(page, "#btn-settings"); await wait(page, 1200);
  const c = await page.evaluate(async () => {
    const body = document.getElementById("sheet-body"); const box = document.createElement("div"); box.id = "icons-box";
    box.innerHTML = '<h3>⏳ Väntar</h3><button type="button">💾 Spara bild</button><button type="button">⚔️ Utmana grupp</button><button type="button">🗳️ Starta omröstning</button>' +
      '<button type="button">📰 Kvällens tidning</button><button type="button">🕵️ Agent</button><h4>⚖️ Rättvis</h4><button type="button">🤕 Bakisrapporten</button>';
    body.appendChild(box); window.PNDS.iconize(box);
    const r = {}; box.querySelectorAll("h3,h4,button").forEach((e) => { r[e.textContent.trim()] = [(e.querySelector("svg") || {}).getAttribute ? e.querySelector("svg").getAttribute("class").replace(/^pi pi-/, "").split(" ")[0] : "", /\p{Extended_Pictographic}/u.test(e.textContent)]; });
    box.remove(); return r;
  });
  const want = { "Väntar": "hourglass", "Spara bild": "save", "Utmana grupp": "swords", "Starta omröstning": "vote", "Kvällens tidning": "news", "Agent": "spy", "Rättvis": "scales", "Bakisrapporten": "bandage" };
  Object.keys(want).forEach((k) => ok(c[k] && c[k][0] === want[k] && !c[k][1], "sheet chrome: " + k + " → icon " + want[k] + ", no emoji", c[k]));

  /* ---- 4. toasts: the leading emoji becomes the right icon (⚠️ was the generic info icon) ---- */
  await page.evaluate(() => document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove()));
  const T = {};
  for (const [e, n] of [["⚠️", "warn"], ["🚨", "siren"], ["🚚", "truck"], ["🔇", "speaker-off"], ["🤕", "bandage"], ["📻", "radio"]]) {
    await page.evaluate(([e, i]) => window.PNDS._A().toast(e + " Test " + i, { ms: 0, id: "ic" + i }), [e, n]); await wait(page, 500);
    T[n] = await page.evaluate((i) => { const t = document.querySelector("#toasts .toast:last-child .pn-toast-i svg"); const tx = document.querySelector("#toasts .toast:last-child"); return [t ? t.getAttribute("class") : "", /\p{Extended_Pictographic}/u.test(tx ? tx.textContent : "")]; }, n);
    await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
    ok(T[n][0].indexOf("pi-" + n) > 0 && !T[n][1], "toast " + e + " → icon " + n + ", no emoji", T[n]);
  }

  /* ---- 5. event kinds use the new icons (sport = ball, party = party) ---- */
  const ek = fs.readFileSync(path.join(__dirname, "../../docs/js/events.js"), "utf8") + fs.readFileSync(path.join(__dirname, "../../docs/js/evgroup.js"), "utf8");
  ok(/sport: "ball"/.test(ek) && /party: "party"/.test(ek) && !/sport: "tv"/.test(ek), "event kind icons: sport ball, party popper");
  const fr = fs.readFileSync(path.join(__dirname, "../../docs/js/friends2.js"), "utf8");
  const chip = (fr.match(/class: "f2-chip"[^\n]*/) || [""])[0];
  ok(chip && !/\p{Extended_Pictographic}|✓/u.test(chip) && /ic\("hourglass"\)/.test(chip), "friend chip has no emoji (icon + word)", chip);

  await ctx.close(); await browser.close();
  console.log("icons: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
