// The poll plan (app.js: planRecord / planDue): which background calls ride in the next map poll bundle.
import test from "node:test";
import assert from "node:assert/strict";
import { loadFunctions } from "./load.mjs";

function mk(over) {
  const scope = Object.assign({ plan: {}, pollWin: 0, pollSlow: false, noB: {}, PRE_DENY: { moments_poll: 1, film_poll: 1 }, PLAN_LONG: { zone_counts: 1 } }, over || {});
  const f = loadFunctions(["planRecord", "planDue"], scope);
  return Object.assign(f, { scope });
}
const T = 1e6;   // a fixed "now" (ms)
const E = (o) => Object.assign({ n: "x", p: {}, at: T - 30000, gap: 30000, miss: 0, fast: true }, o);

test("planDue: a key without a learned gap is never asked ahead", () => {
  assert.equal(mk().planDue(E({ gap: 0 }), T), false);
});
test("planDue: 30 s rhythm -> due after 22 s, not before", () => {
  const f = mk();
  assert.equal(f.planDue(E({ at: T - 21000 }), T), false);
  assert.equal(f.planDue(E({ at: T - 22000 }), T), true);
});
test("planDue: 4 unused answers in a row stop the asking (fast keys)", () => {
  const f = mk();
  assert.equal(f.planDue(E({ miss: 3 }), T), true);
  assert.equal(f.planDue(E({ miss: 4 }), T), false);
});
test("planDue: a slow key (not fast) goes only with a slow-lane poll, after 20 s, 2 misses max", () => {
  assert.equal(mk({ pollSlow: false }).planDue(E({ fast: false, gap: 60000, at: T - 30000 }), T), false);
  const f = mk({ pollSlow: true });
  assert.equal(f.planDue(E({ fast: false, gap: 60000, at: T - 30000 }), T), true);
  assert.equal(f.planDue(E({ fast: false, gap: 60000, at: T - 19000 }), T), false);
  assert.equal(f.planDue(E({ fast: false, gap: 60000, at: T - 30000, miss: 2 }), T), false);
});
test("planDue: gap 65-130 s follows its own rhythm (gap - 5 s)", () => {
  const f = mk();
  assert.equal(f.planDue(E({ gap: 100000, at: T - 94000 }), T), false);
  assert.equal(f.planDue(E({ gap: 100000, at: T - 95000 }), T), true);
  assert.equal(f.planDue(E({ gap: 100000, at: T - 95000, miss: 2 }), T), false);
});
test("planDue: gap above 130 s is dropped unless the key is PLAN_LONG (<= 7 min)", () => {
  const f = mk();
  assert.equal(f.planDue(E({ gap: 200000, at: T - 190000 }), T), false);
  assert.equal(f.planDue(E({ n: "zone_counts", gap: 300000, at: T - 280000 }), T), true);
  assert.equal(f.planDue(E({ n: "zone_counts", gap: 300000, at: T - 270000 }), T), false);   // age < gap - 20 s
  assert.equal(f.planDue(E({ n: "zone_counts", gap: 8 * 60e3, at: T - 8 * 60e3 + 1000 }), T), false);   // > 7 min
});
test("planDue: PRE_DENY names, noB names and p_seen:true calls are never asked ahead", () => {
  const f = mk({ noB: { x: 1 } });
  assert.equal(f.planDue(E({ n: "moments_poll" }), T), false);
  assert.equal(f.planDue(E({ n: "x" }), T), false);
  assert.equal(mk().planDue(E({ p: { p_seen: true } }), T), false);
  assert.equal(mk().planDue(E({ p: { p_seen: false } }), T), true);
});
test("planRecord: records only inside the poll window; the gap is learned from the 2nd call >= 10 s later", () => {
  const f = mk(), now = Date.now();
  f.scope.pollWin = now - 1;
  f.planRecord("duel_poll{}", "duel_poll", {});
  assert.deepEqual(Object.keys(f.ctx.plan), [], "outside the window: nothing");
  f.ctx.pollWin = now + 15000;
  f.planRecord("duel_poll{}", "duel_poll", {});
  let e = f.ctx.plan["duel_poll{}"];
  assert.ok(e && e.gap === 0 && e.n === "duel_poll");
  f.planRecord("duel_poll{}", "duel_poll", {});   // < 10 s later: ignored
  assert.equal(f.ctx.plan["duel_poll{}"].gap, 0);
  e.at = now - 31000;                              // pretend the first call was 31 s ago
  f.planRecord("duel_poll{}", "duel_poll", {});
  assert.ok(Math.abs(f.ctx.plan["duel_poll{}"].gap - 31000) < 500);
  assert.equal(f.ctx.plan["duel_poll{}"].miss, 0);
});
test("planRecord: a key seen in a slow-lane poll is not 'fast' until a normal poll sees it", () => {
  const f = mk({ pollSlow: true }), now = Date.now();
  f.ctx.pollWin = now + 15000;
  f.planRecord("k", "n", {});
  assert.equal(f.ctx.plan.k.fast, false);
  f.ctx.pollSlow = false;
  f.planRecord("k", "n", {});
  assert.equal(f.ctx.plan.k.fast, true);
});
