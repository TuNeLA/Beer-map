// Pure tests for notify-group DEPLOY v28 🔕 LUGNA NOTISER (short titles, evening rule, digest, specific bodies).
// Run: node --experimental-strip-types supabase/tests/notify-v28.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../functions/notify-group/index.ts"), "utf8");
const block = src.split("// ---- pure:start")[1]?.split("// ---- pure:end")[0];
assert.ok(block, "pure block markers not found");
const tmp = join(mkdtempSync(join(tmpdir(), "olnu28-")), "pure.ts");
writeFileSync(tmp, "//" + block);
const m = await import(pathToFileURL(tmp).href);
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("ok -", name); };
const len = (s) => [...s].length;
const emojiFirst = (s) => /^\p{Extended_Pictographic}/u.test(s);

t("tidyTitle: emoji moves to the end, max 30", () => {
  for (const s of ["🚕 Taxin har lämnat av Lisa vid Chinatown.", "📣 Flottiljamiral Flaskpost Oskar har lämnat basen!",
    "🏰 Ni har tagit över Restaurang Kinesiska Muren!", "🍺🍺🍺🍺🍺 Lisa. Mer behöver vi inte säga."]) {
    const x = m.tidyTitle(s);
    assert.ok(len(x) <= 30, x); assert.ok(!emojiFirst(x), x);
  }
  assert.equal(m.tidyTitle("Filmen är framkallad! 📸"), "Filmen är framkallad! 📸");
  assert.equal(m.tidyTitle("5 öl"), "5 öl");
});
t("all v28 titles are ≤ 30 and start with the info", () => {
  const long = "Restaurang Kinesiska Muren och Bar";
  const ps = [
    m.friendPayload28(1, 0, "Oskar", "Flottiljamiral Flaskpost", 1, "Chinatown", "11:27"),
    m.friendPayload28(5, 1, "Oskar", "", 1, "", "21:00"), m.friendPayload28(10, 0, "Alexandra", "", 1, long, "23:10"),
    m.checkinPayload28(0, "Lisa", long, 1, "b1", 3, "11:38"), m.takeoverPayload28(0, "Gänget", long, "b", "g", 3),
    m.levelUpPayload28(0, "Oskar", "Generallöjtnant Guldskum", 1, "General Gyllenbärs"),
    m.kaosPayload28(2, "Ludvika", 14, 3, "2026-11-08T04:00:00Z"), m.comeherePayload28("Lisa", long, 1),
  ];
  for (const p of ps) { assert.ok(len(p.title) <= 30, p.title); assert.ok(!emojiFirst(p.title), p.title); }
  assert.match(ps[0].title, /^Oskar/); assert.match(ps[3].title, /^Lisa/);
});
t("bodies are specific (name, bar, count or time) and never a generic line", () => {
  const b = [0, 1, 2, 3].map((i) => m.checkinPayload28(i, "Lisa", "Tegera Arena", 1, "b", 1, "11:38").body);
  for (const x of b) { assert.ok(!m.GENERIC_BODIES.includes(x), x); assert.match(x, /11:38|Tegera Arena/); }
  assert.match(m.checkinPayload28(0, "Lisa", "Tegera Arena", 1, "b", 3, "11:38").body, /3/);
  assert.match(m.friendPayload28(1, 0, "Oskar", "", 9, "Chinatown", "11:27").body, /11:27/);
  assert.equal(m.tidyBody("Öppna kartan och se var."), "");
  assert.equal(m.tidyBody("Ny rang i Öl Nu. Skål för det! 🍻"), "Ny rang i PintsNow. Skål för det! 🍻");
});
t("tags: one per pin (öl 5 replaces öl 1), per bar for check-ins", () => {
  assert.equal(m.friendPayload28(1, 0, "A", "", 7, "", "").tag, "olnu-7-f1");
  assert.equal(m.pushCat("olnu-7-f5"), "ute");
  assert.equal(m.checkinPayload28(0, "A", "B", 1, "n9", 1, "").tag, "olnu-checkin-n9");
});
t("evening rule: hype only 17–05, check-ins and safety always", () => {
  assert.equal(m.rule28("ute", "olnu-7-f1", 11), "day");
  assert.equal(m.rule28("bar", "olnu-takeover-g-b", 11), "day");
  assert.equal(m.rule28("kul", "olnu-title-3", 14), "day");
  assert.equal(m.rule28("kaos", "olnu-kaos-2026-11-07", 12), "day");
  assert.equal(m.rule28("ute", "olnu-7-f10", 11), "pace");
  assert.equal(m.rule28("ute", "olnu-checkin-b", 11), "pace");
  assert.equal(m.rule28("bar", "olnu-takeover-g-b", 21), "pace");
  assert.equal(m.rule28("kul", "olnu-title-3", 2), "pace");
  assert.equal(m.rule28("safe", "olnu-sos-1", 11), "send");
  assert.equal(m.rule28("chat", "olnu-msg-x", 11), "send");
  assert.equal(m.rule28("plan", "olnu-rally-1", 11), "send");
});
t("digest: 1 line = that line; 3 lines = count + newest first", () => {
  const one = m.digestPayload(["11:38|Lisa på Tegera Arena"], "Gänget");
  assert.equal(one.title, "Lisa på Tegera Arena"); assert.equal(one.body, "kl 11:38 · Gänget"); assert.equal(one.tag, "olnu-digest");
  const three = m.digestPayload(["11:27|Oskar är ute", "11:28|Gänget äger Chinatown", "11:38|Lisa på Tegera Arena"], "Gänget");
  assert.equal(three.title, "3 nya i Gänget 🍻");
  assert.ok(three.body.startsWith("Lisa på Tegera Arena"), three.body);
  const five = m.digestPayload(["1|a", "2|b", "3|c", "4|d", "5|e"], "");
  assert.match(five.body, /\+2 till$/); assert.equal(five.title, "5 nya från vänner 🍻");
});
t("tidyPayload keeps chat titles long (the text is the info) and names no 'Öl Nu'", () => {
  const p = m.tidyPayload(m.msgPayload28("Anton", "Vi ses på Pitchers om tio minuter, ta med Lisa", "Gänget", "g"));
  assert.equal(p.title, "Anton i Gänget 💬"); assert.match(p.body, /Pitchers/);
  const q = m.tidyPayload({ title: "🍺 Öl Nu", body: "", tag: "x" });
  assert.equal(q.title, "PintsNow 🍺");
});
t("paceOf: default 10 min / 4 per night (gw), user caps win", () => {
  assert.deepEqual(m.paceOf(null), { gap: 600, max: 4 });
  assert.deepEqual(m.paceOf({ cap: 5 }), { gap: 600, max: 5 });
  assert.deepEqual(m.paceOf({ cap: 99 }), { gap: 120, max: 99 });
});
console.log(`v28 lugna notiser: ${passed} tests ok`);
