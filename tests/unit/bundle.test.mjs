// bundleChunks (app.js): more calls than the server takes -> equal chunks, one request each; a chunk of 1 goes alone.
import test from "node:test";
import assert from "node:assert/strict";
import { loadFunctions } from "./load.mjs";

function run(n, cap) {
  const sent = [], alone = [];
  const f = loadFunctions(["bundleChunks"], { bundleSend: (part, sub) => sent.push({ part, sub }), bAlone: (sub) => alone.push(sub) });
  const calls = Array.from({ length: n }, (_, i) => ({ k: "k" + i, n: "name" + i, p: {} }));
  const list = calls.map((c) => ({ k: c.k, n: c.n }));
  f.bundleChunks(calls, list, cap);
  return { sent, alone, calls };
}

test("bundleChunks: fits in one request -> one bundle with everything", () => {
  const r = run(10, 40);
  assert.equal(r.sent.length, 1); assert.equal(r.sent[0].part.length, 10); assert.equal(r.alone.length, 0);
});
test("bundleChunks: 50 calls, cap 40 -> two equal chunks of 25", () => {
  const r = run(50, 40);
  assert.deepEqual(r.sent.map((s) => s.part.length), [25, 25]);
});
test("bundleChunks: 30 calls, cap 24 (old server) -> two chunks of 15", () => {
  assert.deepEqual(run(30, 24).sent.map((s) => s.part.length), [15, 15]);
});
test("bundleChunks: every call is sent once, in order, and the caller list matches the chunk", () => {
  const r = run(97, 24);
  assert.ok(r.sent.every((s) => s.part.length <= 24));
  assert.deepEqual(r.sent.flatMap((s) => s.part.map((c) => c.k)), r.calls.map((c) => c.k));
  r.sent.forEach((s) => assert.deepEqual(s.sub.map((x) => x.k), s.part.map((c) => c.k)));
});
test("bundleChunks: a chunk of 1 call goes alone, not in a bundle", () => {
  const r = run(1, 24);
  assert.equal(r.sent.length, 0); assert.equal(r.alone.length, 1); assert.equal(r.alone[0][0].k, "k0");
});
test("bundleChunks: 25 calls, cap 24 -> chunks 13 + 12 (no lone call)", () => {
  assert.deepEqual(run(25, 24).sent.map((s) => s.part.length), [13, 12]);
});
