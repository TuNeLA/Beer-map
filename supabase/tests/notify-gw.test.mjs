// Pure tests for the gw additions to notify-group (0310-0313): "Ute ikväll?" window + kind, budget 4, texts.
// Run: node --experimental-strip-types supabase/tests/notify-gw.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../functions/notify-group/index.ts"), "utf8");
const block = src.split("// ---- pure:start")[1]?.split("// ---- pure:end")[0];
assert.ok(block, "pure block markers not found");
const tmp = join(mkdtempSync(join(tmpdir(), "olnugw-")), "pure.ts");
writeFileSync(tmp, "//" + block);
const m = await import(pathToFileURL(tmp).href);
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("ok -", name); };
// 2026-11-06 is a Friday. Stockholm = UTC+1 in November.
const at = (iso) => Date.parse(iso);

t("budget: 4 per night by default, user caps still win", () => {
  assert.equal(m.PACE_NIGHT_MAX, 4);
  assert.deepEqual(m.paceOf(null), { gap: 600, max: 4 });
  assert.deepEqual(m.paceOf({ cap: 10 }), { gap: 600, max: 10 });
});
t("chat / DM / plan / safety are never paced", () => {
  for (const tag of ["olnu-msg-g", "olnu-dm-g", "olnu-inv-1", "olnu-sos-1", "olnu-walk-alert-5", "olnu-walk-chk-5"]) {
    assert.equal(m.rule28(m.pushCat(tag), tag, 21), "send", tag);
  }
});
t("ikvall: own kind, paced, only Fri/Sat 19-23 Stockholm", () => {
  assert.equal(m.pushCat("olnu-ikvall-2026-11-06"), "ikvall");
  assert.ok(m.PACE_CATS.includes("ikvall") && m.PUSH_NOISY.includes("ikvall"));
  assert.equal(m.ikvallWindow(at("2026-11-06T19:00:00Z")), true);    // Fri 20:00
  assert.equal(m.ikvallWindow(at("2026-11-07T21:30:00Z")), true);    // Sat 22:30
  assert.equal(m.ikvallWindow(at("2026-11-07T22:30:00Z")), false);   // Sat 23:30
  assert.equal(m.ikvallWindow(at("2026-11-05T19:00:00Z")), false);   // Thu 20:00
  assert.equal(m.ikvallWindow(at("2026-11-08T19:00:00Z")), false);   // Sun 20:00
  assert.equal(m.rule28("ikvall", "olnu-ikvall-x", 20, at("2026-11-06T19:00:00Z")), "pace");
  assert.equal(m.rule28("ikvall", "olnu-ikvall-x", 20, at("2026-11-05T19:00:00Z")), "day");
});
t("ikvall: nattro is respected (pushGate)", () => {
  assert.equal(m.pushGate("ikvall", { quiet_from: 19, quiet_to: 8 }, 20), "quiet");
  assert.equal(m.pushGate("ikvall", null, 20), "cap");
});
t("texts: short titles, info first, no drink counts", () => {
  const ik = m.tidyPayload(m.ikvallPayload(0, at("2026-11-06T19:00:00Z")));
  assert.equal(ik.title, "Ute ikväll? 🍺"); assert.match(String(ik.tag), /^olnu-ikvall-2026-11-06$/); assert.equal(ik.url, "/?ikvall=1");
  const k = m.tidyPayload(m.knuffPayload("Anton", 7));
  assert.equal(k.title, "Anton knuffar dig 👋"); assert.equal(m.pushCat(String(k.tag)), "ute");
  const r = m.tidyPayload(m.walkRemindPayload(5));
  assert.equal(m.pushCat(String(r.tag)), "safe"); assert.match(String(r.url), /walk=5&chk=1/);
  const a = m.tidyPayload(m.walkAlertPayload("Lisa", 5, at("2026-11-06T22:40:00Z"), at("2026-11-06T22:31:00Z")));
  assert.equal(m.pushCat(String(a.tag)), "safe"); assert.equal(a.title, "Lisa har inte svarat ⚠️");
  assert.match(String(a.body), /23:40/); assert.match(String(a.body), /23:31/); assert.match(String(a.body), /112/);
  for (const p of [ik, k, r, a]) assert.ok(![...String(p.title)].length || [...String(p.title)].length <= 40, p.title);
});
console.log(`gw notify: ${passed} tests ok`);
