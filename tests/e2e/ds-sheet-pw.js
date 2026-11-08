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
      if (emo.test(direct) && (inter || el.closest("button, h2, h3, summary, .sheet-head"))) o.emoji.push(direct.slice(0, 24));
      if (el.closest("button, summary, .btn") && cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) o.cut.push(direct.slice(0, 24));
    }
    const bg = cs.backgroundColor, box = (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") || parseFloat(cs.borderTopWidth) > 0;
    if (box) { const v = parseFloat(cs.borderTopLeftRadius); const pill = cs.borderTopLeftRadius.includes("%") || v >= r.height / 2 - 1; if (!pill && !RAD.has(Math.round(v))) o.rad[Math.round(v)] = (o.rad[Math.round(v)] || []).concat(String(el.className).slice(0, 24)).slice(0, 2); }
    if (inter && (r.width < 43.5 || r.height < 43.5) && !el.closest(".pp-list")) o.small.push(((el.innerText || el.getAttribute("aria-label") || el.className) + "").replace(/\s+/g, " ").slice(0, 20) + " " + Math.round(r.width) + "×" + Math.round(r.height));
    if (el.matches(".ds-row, .pn-row, .pn-fold-row, .pn-bs-row > summary, .pp-fold > summary, #sheet-body.ds-set .ds-item > .row > .btn, #sheet-body.ds-set .ds-item > .toggle-row") && r.height < 55.5) o.rows.push(direct.slice(0, 18) + " " + Math.round(r.height));
    if (el.matches(":is(.tabs, .seg, .tt-bar, .pk-seg, .pn-ikv-seg, .np-tabs, .np-seg, .pf-tabs) > button") && r.height < 43.5) o.seg.push(direct.slice(0, 16) + " " + Math.round(r.height));
    if (el.matches(".btn-amber:not(.pn-demote), .ds-btn-primary:not(.pn-demote)")) o.amber++;
  }
  const t = sh ? document.getElementById("sheet-title") : root.querySelector(".pp-title, .bs-head h2, h2");
  if (t) { const c = getComputedStyle(t); o.title = { txt: t.textContent.trim().slice(0, 30), ff: c.fontFamily.split(",")[0].replace(/"/g, ""), fs: c.fontSize, col: c.color, icon: !!t.querySelector("svg, .pi") }; }
  const x = sh ? document.getElementById("sheet-close") : root.querySelector(".leaflet-popup-close-button");
  if (x && vis(x)) { const xr = R(x); o.close = { right: Math.round(sr.right - xr.right), w: Math.round(xr.width), h: Math.round(xr.height), top: Math.round(xr.top - sr.top) }; }
  const bk = document.getElementById("pn-back"); if (sh && vis(bk)) o.back = Math.round(R(bk).left - sr.left);
  const pb = parseFloat(getComputedStyle(root).paddingBottom) + (sh ? parseFloat(getComputedStyle(document.getElementById("sheet-body")).paddingBottom) : 0);
  o.padB = Math.round(pb);
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
];
(async () => {
  const browser = WK ? await pw.webkit.launch() : await pw.chromium.launch({ executablePath: require("./env.js").CHROME, args: ["--ignore-certificate-errors"] });
  for (const [name, open] of SHEETS) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    const { ctx, page } = await ctxFor(browser, { width: 390, height: name === "installningar" || name === "profil" || name === "krog" ? 1400 : 844 }, { ua: "ios" });
    await routes(page); await boot(page);
    await page.evaluate(() => { try { localStorage.setItem("olnu.pnEve", "1"); } catch (e) {} document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove()); });
    await open(page); await wait(page, 2200); await page.evaluate(() => document.querySelectorAll(".toast, .dl-cap").forEach((t) => t.remove())); await wait(page, 200);
    const m = await page.evaluate(SCAN);
    await page.screenshot({ path: SP + (WK ? "wk-" : "") + name + ".png" });
    if (!m) { ok(false, name + ": sheet did not open"); await ctx.close(); continue; }
    const n = name + ":";
    ok(m.title && m.title.ff === "Black Ops One" && Math.round(parseFloat(m.title.fs)) === 22 && !m.title.icon && /255, 194, 77|245, 166, 35/.test(m.title.col), n + " title = Black Ops One 22 amber, no icon", m.title);
    ok(m.close && Math.abs(m.close.right - 16) <= 1 && m.close.w === 44 && m.close.h === 44, n + " ✕ round 44, 16 px from the edge", m.close);
    if (m.back != null) ok(Math.abs(m.back - 16) <= 1, n + " ‹ 16 px from the edge", m.back);
    ok(!m.small.length, n + " tap targets ≥ 44", m.small);
    ok(!m.rows.length, n + " list rows ≥ 56", m.rows);
    ok(!m.seg.length, n + " segment items ≥ 44", m.seg);
    ok(m.amber <= 1, n + " at most one amber primary", m.amber);
    ok(!Object.keys(m.fs).length, n + " font sizes on the scale", m.fs);
    ok(!Object.keys(m.rad).length, n + " radius on the scale", m.rad);
    ok(!m.caps.length, n + " no CSS uppercase", m.caps);
    ok(!m.emoji.length, n + " no emoji in buttons / headings", m.emoji);
    ok(!m.cut.length, n + " no cut button labels", m.cut);
    ok(m.padB >= 16, n + " bottom padding ≥ 16 (+ safe area)", m.padB);
    await ctx.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})();
