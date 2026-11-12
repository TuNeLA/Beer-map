// I-19: dedupeDevices (one push per user + device class) and tidyRideText from supabase/functions/notify-group/index.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { functionSource } from "./load.mjs";

const src = fs.readFileSync(new URL("../../supabase/functions/notify-group/index.ts", import.meta.url), "utf8");
const code = ["dedupeDevices", "tidyRideText"].map((n) => functionSource(src, n)).map((c) => stripTypeScriptTypes(c)).join("\n");
const { dedupeDevices, tidyRideText } = vm.runInNewContext(code + "\n({ dedupeDevices, tidyRideText })");
const J = (id, user) => ({ sub: { id, user_id: user } });
const row = (dev, standalone, seen) => ({ dev, standalone, seen, created: null });

test("two endpoints for one device: the installed app wins", () => {
  const jobs = [J(1, "u"), J(2, "u")];
  const info = new Map([[1, row("android", false, "2026-11-12T10:00:00Z")], [2, row("android", true, "2026-11-01T10:00:00Z")]]);
  assert.deepEqual(dedupeDevices(jobs, info).map((j) => j.sub.id), [2]);
});
test("two browser endpoints: the newest wins", () => {
  const jobs = [J(1, "u"), J(2, "u")];
  const info = new Map([[1, row("android", false, "2026-11-01T10:00:00Z")], [2, row("android", false, "2026-11-12T10:00:00Z")]]);
  assert.deepEqual(dedupeDevices(jobs, info).map((j) => j.sub.id), [2]);
});
test("phone + laptop (different dev) both stay; other users untouched; old rows (dev null) stay", () => {
  const jobs = [J(1, "u"), J(2, "u"), J(3, "v"), J(4, "u"), J(5, "u")];
  const info = new Map([[1, row("android", true, null)], [2, row("desktop", false, null)], [3, row("android", true, null)], [4, row(null, null, null)], [5, row(null, null, null)]]);
  assert.deepEqual(dedupeDevices(jobs, info).map((j) => j.sub.id), [1, 2, 3, 4, 5]);
});
test("no info (0505 not run): nothing dropped", () => {
  const jobs = [J(1, "u"), J(2, "u")];
  assert.equal(dedupeDevices(jobs, new Map()).length, 2);
});
test("ride text: 'Vid nära X' becomes 'Nära X'", () => {
  assert.equal(tidyRideText("Vid nära Taste Of India · Röd Volvo · Kolla att det ä rätt bil"), "Nära Taste Of India · Röd Volvo · Kolla att det ä rätt bil");
  assert.equal(tidyRideText("Vid Pitchers · Kolla"), "Vid Pitchers · Kolla");
  assert.equal(tidyRideText("Från nära Pitchers → Centrum · 1 pers"), "Från Pitchers → Centrum · 1 pers");
});
