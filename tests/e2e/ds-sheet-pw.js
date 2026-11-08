// Sheet rules (ds06, design review "Fönster-regler") measured on EVERY sheet. node ds-sheet-pw.js <port> [wk] [only…]
// Hard rules per sheet: header (✕ 16 px from the edge, ‹ 16 px when shown, title Black Ops One 22 amber, no icon in the
// title), tap targets ≥ 44, list rows ≥ 56, segment items ≥ 44, one amber primary, font sizes on the scale, radius on the
// scale, no CSS uppercase, no emoji in buttons / headings, no cut button labels, bottom padding ≥ 16.
process.argv[2] = process.argv[2] || "8942";
const { ctxFor, boot, wait, clickJS } = require("./ds-helpers.js");
const pw = require("playwright");
const WK = process.argv[3] === "wk", ONLY = process.argv.slice(WK ? 4 : 3);
const SP = require("./env.js").OUT + "ds-shots/sheets/";
require("fs").mkdirSync(SP, { recursive: true });
const J = (r, b) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
const G = "11111111-2222-3333-4444-555555555555";
let pass = 0, fail = 0; const sum = [];
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? "PASS " : "FAIL ") + (WK ? "[wk] " : "") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 600)); };
async function routes(page) {
  await page.route(/rest\/v1\/rpc\/(my_groups|group_status_v3|group_status_v2|group_msgs|my_friends|friend_list|ikvall_status|safety_state|drivers_for|pickup_poll)$/, (r) => {
    const fn = r.request().url().match(/rpc\/(\w+)/)[1];
    switch (fn) {
      case "my_groups": return J(r, [{ id: G, name: "Ludvika Lager", code: "ABC234", member_count: 5, active_count: 3 }, { id: "22222222-2222-3333-4444-555555555555", name: "Jobbet", code: "XYZ789", member_count: 9, active_count: 0 }]);
      case "group_status_v3": case "group_status_v2": return J(r, [{ name: "Anton", k: "k0", is_me: true, beers: 3, others: 0, live: true, total: 40, meriter: 12 }, { name: "Lisa", k: "k1", is_me: false, beers: 2, others: 0, live: true, total: 18, meriter: 5 }]);
      case "group_msgs": return J(r, [{ id: 1, name: "Lisa", body: "Va ä ni?", created_at: new Date(Date.now() - 50 * 60e3).toISOString(), is_me: false }]);
      case "my_friends": return J(r, { code: "K7Q2MXA", friends: [{ id: "f1", name: "Lisa" }], incoming: [], outgoing: [] });
      case "friend_list": return J(r, { v: 1, people: [], groups: [] });
      case "ikvall_status": return J(r, { v: 1, night: "x", mine: null, counts: { ute: 2, kanske: 1, hemma: 0 }, people: [{ name: "Lisa", st: "ute", friend: true }, { name: "Ida", st: "kanske", friend: true }] });
      case "drivers_for": return J(r, { v: 1, drivers: [{ name: "Lisa", k: "k1", is_me: false }] });
      case "pickup_poll": return J(r, { v: 1, driving: false, incoming: [], mine: null });
      case "safety_state": return J(r, { v: 1, age_ok: true, terms_ver: 1, terms_at: new Date().toISOString(), store: "off", blocks: 0, notices: [] });
      default: return J(r, []);
    }
  });
}
const SCAN = () => {
  const FS = new Set([12, 14, 16, 18, 22, 28, 34, 44]), RAD = new Set([0, 4, 8, 12, 16, 24]);
  const vis = (e) => { if (!e || !e.getClientRects().length) return false; const s = getComputedStyle(e); return s.display !== "none" && s.visibility !== "hidden" && +s.opacity > 0.05; };
  const bar = document.querySelector(".leaflet-popup.olnu-sheet, .leaflet-popup");
  const sh = document.querySelector("#sheet:not([hidden])");
  const root = sh || (vis(bar) ? bar : null);
  if (!root) return null;
  const emo = /\p{Extended_Pictographic}/u, R = (e) => e.getBoundingClientRect();
  const o = { small: [], rows: [], seg: [], fs: {}, rad: {}, caps: [], emoji: [], cut: [], amber: 0 };
  const sr = R(root);
  for (const el of root.querySelectorAll("*")) {
    if (!vis(el)) continue; const r = R(el); if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
    if (el.closest(".chat-list, .gpg-msgs, .sp-cards, .tk-track, .pn-glass, svg, .pp-list, .bf-strip")) continue;
    const cs = getComputedStyle(el), tag = el.tagName.toLowerCase();
    const direct = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");
    const inter = /^(button|a|select|summary)$/.test(tag) || el.getAttribute("role") === "button" || el.getAttribute("role") === "switch";
    if (direct) {
      const f = Math.round(parseFloat(cs.fontSize)); if (!FS.has(f)) o.fs[f] = (o.fs[f] || []).concat(direct.slice(0, 20)).slice(0, 2);
      if (cs.textTransform === "uppercase") o.caps.push(direct.slice(0, 24));
      if (emo.test(direct) && !el.closest(".rb, .pf-ribbons, .md-rib") && (inter || el.closest("button, h2, h3, summary, .sheet-head"))) o.emoji.push(direct.slice(0, 24) + " <" + tag + "." + String(el.className).slice(0, 30) + " in " + String((el.parentElement || {}).className).slice(0, 30) + ">");
      if (el.closest("button, summary, .btn") && cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) o.cut.push(direct.slice(0, 24));
    }
    const bg = cs.backgroundColor, box = (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") || parseFloat(cs.borderTopWidth) > 0;
    if (box) { const v = parseFloat(cs.borderTopLeftRadius); const pill = cs.borderTopLeftRadius.includes("%") || v >= r.height / 2 - 1; if (!pill && !RAD.has(Math.round(v))) o.rad[Math.round(v)] = (o.rad[Math.round(v)] || []).concat(String(el.className).slice(0, 24)).slice(0, 2); }
    const rowT = el.matches(".switch, [role=switch]") && el.closest(".toggle-row, .pn-row, .ds-row, label, .pk-ikv-row");
    if (inter && !(rowT && rowT.getBoundingClientRect().height >= 43.5) && (r.width < 43.5 || r.height < 43.5) && !el.closest(".pp-list")) o.small.push(((el.innerText || el.getAttribute("aria-label") || el.className) + "").replace(/\s+/g, " ").slice(0, 20) + " " + Math.round(r.width) + "×" + Math.round(r.height));
    if (el.matches(".ds-row, .pn-row, .pn-fold-row, .pn-bs-row > summary, .pp-fold > summary, #sheet-body.ds-set .ds-item > .row > .btn, #sheet-body.ds-set .ds-item > .toggle-row") && r.height < 55.5) o.rows.push(direct.slice(0, 18) + " " + Math.round(r.height));
    if (el.matches(":is(.tabs, .seg, .tt-bar, .pk-seg, .pn-ikv-seg, .np-tabs, .np-seg, .pf-tabs) > button") && r.height < 43.5) o.seg.push(direct.slice(0, 16) + " " + Math.round(r.height));
    if (el.matches(".btn-amber:not(.pn-demote), .ds-btn-primary:not(.pn-demote)")) o.amber++;
  }
  const t = sh ? document.getElementById("sheet-title") : root.querySelector(".pp-title, .bs-head h2, h2");
  if (t) { const c = getComputedStyle(t); o.title = { txt: t.textContent.trim().slice(0, 30), ff: c.fontFamily.split(",")[0].replace(/"/g, ""), fs: c.fontSize, col: c.color, icon: [...t.querySelectorAll("svg, .pi")].some(vis) }; }
  const x = sh ? document.getElementById("sheet-close") : root.querySelector(".leaflet-popup-close-button");
  if (x && vis(x)) { const xr = R(x); o.close = { right: Math.round(sr.right - xr.right), w: Math.round(xr.width), h: Math.round(xr.height), top: Math.round(xr.top - sr.top) };
    const hit = document.elementFromPoint(xr.left + xr.width / 2, xr.top + xr.height / 2); o.close.onTop = !!(hit && (hit === x || x.contains(hit))); }
  const bk = document.getElementById("pn-back"); if (sh && vis(bk)) o.back = Math.round(R(bk).left - sr.left);
  const bc = !sh && root.querySelector(".leaflet-popup-content");
  const pb = parseFloat(getComputedStyle(root).paddingBottom) + (sh ? parseFloat(getComputedStyle(document.getElementById("sheet-body")).paddingBottom) : 0) +
    (bc ? parseFloat(getComputedStyle(bc).paddingBottom) + parseFloat(getComputedStyle(bc).marginBottom) : 0);
  // ds07 bar layout facts
  if (!sh) {
    const q = (s) => root.querySelector(s), top = (e) => e ? e.getBoundingClientRect().top : null;
    const btn = [...root.querySelectorAll(".pp-act .ci-btn, .pp-act .ci-out, .pp-act .eta-go")].filter(vis).map((e) => { const r = R(e); return { c: e.className, w: Math.round(r.width), h: Math.round(r.height), bg: getComputedStyle(e).backgroundColor }; });
    o.bar = { hero: top(q(".pn-bs-hero")), act: top(q(".pp-act")), info: top(q(".pn-bs-info")), mer: top(q("details[data-fold=mer]")), head: top(q(".bs-head")),
      btn, merHas: !!(q("details[data-fold=mer] .inv-here") && q("details[data-fold=mer] .af-qr")), stickyHead: getComputedStyle(q(".bs-head")).position };
  }
  o.padB = Math.round(pb);
  o.thin = [...root.querySelectorAll("p, h3, h4")].filter((e) => vis(e) && e.textContent.trim().length > 12 && R(e).width < 60).map((e) => e.className + " " + Math.round(R(e).width));
  return o;
};
const SHEETS = [
  ["mer", async (p) => { await clickJS(p, "#btn-more"); }],
  ["nara", async (p) => { await clickJS(p, "#btn-more"); await wait(p, 700); await p.evaluate(() => { const r = document.querySelector("[data-pn-near]"); if (r) r.click(); }); }],
  ["ikvall", async (p) => { await p.evaluate(() => window.PNUI && window.PNUI.openIkvall()); }],
  ["hemstad", async (p) => { await p.evaluate(() => window.HOMETOWN && window.HOMETOWN.open()); }],
  ["hamta", async (p) => { await p.evaluate(() => window.SKJUTS && window.SKJUTS.openPickup({})); }],
  ["nytt", async (p) => { await p.evaluate(() => window.PNMOVE && window.PNMOVE.open && window.PNMOVE.open()); }],
  ["topp", async (p) => { await clickJS(p, "#btn-top"); }],
  ["grupper", async (p) => { await clickJS(p, "#btn-groups"); }],
  ["vanner", async (p) => { await clickJS(p, "#btn-groups"); await wait(p, 1200); await p.evaluate(() => { const t = document.querySelector('.inv-tabs [data-t="f"]'); if (t) t.click(); }); }],
  ["inkorg", async (p) => { await clickJS(p, "#btn-groups"); await wait(p, 1200); await p.evaluate(() => { const t = document.querySelector('.inv-tabs [data-t="i"]'); if (t) t.click(); }); }],
  ["grupp", async (p) => { await clickJS(p, "#btn-groups"); await wait(p, 1400); await p.evaluate(() => { const c = document.querySelector(".glist .gcard"); if (c) c.click(); }); }],
  ["gplus", async (p) => { await clickJS(p, "#btn-groups"); await wait(p, 1400); await p.evaluate(() => { const c = document.querySelector(".glist .gcard"); if (c) c.click(); }); await wait(p, 1800); await p.evaluate(() => { const x = document.querySelector(".gpg-plus"); if (x) x.click(); }); }],
  ["profil", async (p) => { await clickJS(p, "#btn-settings"); }],
  ["installningar", async (p) => { await clickJS(p, "#btn-settings"); await wait(p, 1200); await p.evaluate(() => { const t = [...document.querySelectorAll("#sheet-body .pf-tabs button")].find((x) => /Inställningar/.test(x.textContent)); if (t) t.click(); }); }],
  ["krog", async (p) => { await p.evaluate(() => window.__map.setView([60.14997, 15.18679], 17, { animate: false })); await wait(p, 1800);
    await p.evaluate(() => { let m = null; window.__map.eachLayer((l) => { const c = l.options && l.options.olnuC; if (!m && c && c.bar && String(c.bar.id) === "n3472634175") m = l; }); if (m) m.fire("click"); }); }],
  // ds07: a bar where I am NOT checked in (Checka in + På väg) – the nearest other pub to La Parma
  ["krog2", async (p) => { await p.evaluate(() => window.__map.setView([60.15124, 15.18797], 17, { animate: false })); await wait(p, 1800);
    await p.evaluate(() => { let m = null, best = 1e9; window.__map.eachLayer((l) => { const c = l.options && l.options.olnuC; if (!c || !c.bar || String(c.bar.id) === "n3472634175" || !/^(pub|bar)$/.test(c.bar.type) || !l.getLatLng) return;
      const d = Math.abs(l.getLatLng().lat - 60.15124) + Math.abs(l.getLatLng().lng - 15.18797); if (d < best) { best = d; m = l; } }); if (m) m.fire("click"); }); }],
];
(async () => {
  const browser = WK ? await pw.webkit.launch() : await pw.chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  for (const [name, open] of SHEETS) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    const { ctx, page } = await ctxFor(browser, { width: 390, height: name === "installningar" || name === "profil" || /^krog/.test(name) ? 1400 : 844 }, { ua: "ios" });
    await routes(page); await boot(page);
    await page.evaluate(() => { try { localStorage.setItem("olnu.pnEve", "1"); } catch (e) {} document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove()); });
    await open(page); await wait(page, 2200); await page.evaluate(() => document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove())); await wait(page, 200);
    const m = await page.evaluate(SCAN);
    // switch rows: a tap on the row text (not on the switch) must flip the switch (the row is the 44+ px tap target)
    const rows = await page.evaluate(() => {
      const root = document.querySelector("#sheet:not([hidden])"); if (!root) return [];
      const vis = (e) => e && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden";
      return [...root.querySelectorAll(".switch, [role=switch]")].filter(vis).filter((sw) => { const r = sw.getBoundingClientRect(); return r.top > 0 && r.bottom < innerHeight; }).slice(0, 6).map((sw, i) => {
        sw.setAttribute("data-pn-swt", i);
        const row = sw.closest(".toggle-row, .pn-row, .ds-row, label, .pk-ikv-row, .ds-item, li") || sw.parentElement, rr = row.getBoundingClientRect(), sr = sw.getBoundingClientRect();
        return { i, txt: (row.innerText || "").replace(/\s+/g, " ").trim().slice(0, 24), x: rr.left + Math.min(40, Math.max(8, (sr.left - rr.left) / 3)), y: sr.top + sr.height / 2, h: Math.round(rr.height) };
      });
    });
    const st = (i) => page.evaluate((i) => { const s = document.querySelector('[data-pn-swt="' + i + '"]'); return s ? s.getAttribute("aria-checked") || s.getAttribute("aria-pressed") || String(s.classList.contains("on")) : null; }, i);
    const bad = [];
    for (const r of rows) {
      if (/notiser/i.test(r.txt)) continue;   // the push row asks the OS for permission; ds.js row-tap code is the same for all .toggle-row
      const a = await st(r.i); await page.mouse.click(r.x, r.y); await wait(page, 350); const b2 = await st(r.i);
      if (a === b2 || r.h < 44) bad.push(r.txt + " h" + r.h + " " + a + "→" + b2); else { await page.mouse.click(r.x, r.y); await wait(page, 350); }
    }
    m.rowtap = { n: rows.length, bad };
    await page.screenshot({ path: SP + (WK ? "wk-" : "") + name + ".png" });
    if (!m) { ok(false, name + ": sheet did not open"); await ctx.close(); continue; }
    const n = name + ":";
    ok(m.title && m.title.ff === "Black Ops One" && Math.round(parseFloat(m.title.fs)) === 22 && !m.title.icon && /255, 194, 77|245, 166, 35/.test(m.title.col), n + " title = Black Ops One 22 amber, no icon", m.title);
    if (m.back == null || m.close) ok(m.close && Math.abs(m.close.right - 16) <= 1 && m.close.w === 44 && m.close.h === 44 && m.close.onTop, n + " ✕ round 44, 16 px from the edge, on top", m.close);
    else ok(true, n + " sub-screen: ‹ shows, ✕ hides (rule 3)");
    if (m.back != null) ok(Math.abs(m.back - 16) <= 1, n + " ‹ 16 px from the edge", m.back);
    ok(!m.small.length, n + " tap targets ≥ 44", m.small);
    if (m.rowtap.n) ok(!m.rowtap.bad.length, n + " switch rows: tapping the row text flips the switch (row ≥ 44)", m.rowtap.bad);
    ok(!m.rows.length, n + " list rows ≥ 56", m.rows);
    ok(!m.seg.length, n + " segment items ≥ 44", m.seg);
    ok(m.amber <= 1, n + " at most one amber primary", m.amber);
    ok(!Object.keys(m.fs).length, n + " font sizes on the scale", m.fs);
    ok(!Object.keys(m.rad).length, n + " radius on the scale", m.rad);
    ok(!m.caps.length, n + " no CSS uppercase", m.caps);
    ok(!m.emoji.length, n + " no emoji in buttons / headings", m.emoji);
    ok(!m.cut.length, n + " no cut button labels", m.cut);
    ok(m.padB >= 16, n + " bottom padding ≥ 16 (+ safe area)", m.padB);
    ok(!m.thin.length, n + " no text squeezed into a thin box (the 'Nytt i appen' p.pn-p bug)", m.thin);
    if (m.bar) {
      const b = m.bar;
      ok(b.head < b.hero && b.hero < b.act && b.act < b.info && b.info < b.mer, n + " order: header < hero < actions < Info < Mer", b);
      ok(b.btn.length && b.btn.every((x) => x.h === 48), n + " action buttons 48 high", b.btn);
      ok(b.btn.filter((x) => /245, 166, 35/.test(x.bg)).length === 1, n + " exactly one amber action", b.btn);
      if (name === "krog") ok(b.btn.length === 1 && /ci-out/.test(b.btn[0].c), n + " checked in: only Checka ut (På väg hidden)", b.btn);
      if (name === "krog2") ok(b.btn.length === 2 && b.btn[0].w === b.btn[1].w && /ci-btn/.test(b.btn[0].c) && /eta-go/.test(b.btn[1].c), n + " not checked in: Checka in + På väg, equal width", b.btn);
      ok(b.merHas, n + " Bjud in hit + QR-affisch are inside Mer");
      ok(b.stickyHead === "sticky", n + " header stays on top while the sheet scrolls", b.stickyHead);
    }
    await ctx.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
