// crowdSort (app.js): me first, then friends, then by arrival time. SAFE: never by drink count.
import test from "node:test";
import assert from "node:assert/strict";
import { loadFunctions } from "./load.mjs";

const { crowdSort } = loadFunctions(["crowdSort"]);
const id = (l) => l.map((x) => x.id).join(",");

test("crowdSort: me, then friends, then strangers", () => {
  const l = [{ id: "s", created_at: "2026-11-10T20:00:00Z" }, { id: "f", friend_name: "Lisa", created_at: "2026-11-10T21:00:00Z" }, { id: "m", is_mine: true, created_at: "2026-11-10T22:00:00Z" }];
  assert.equal(id(l.slice().sort(crowdSort)), "m,f,s");
});
test("crowdSort: inside one group the earlier arrival is first", () => {
  const l = [{ id: "b", created_at: "2026-11-10T21:00:00Z" }, { id: "a", created_at: "2026-11-10T19:00:00Z" }, { id: "c", created_at: "2026-11-10T22:30:00Z" }];
  assert.equal(id(l.slice().sort(crowdSort)), "a,b,c");
});
test("crowdSort: the drink count never changes the order", () => {
  const l = [{ id: "a", created_at: "2026-11-10T19:00:00Z", beer_count: 1 }, { id: "b", created_at: "2026-11-10T20:00:00Z", beer_count: 99 }];
  assert.equal(id(l.slice().sort(crowdSort)), "a,b");
});
test("crowdSort: a missing created_at does not throw and sorts first in its group", () => {
  const l = [{ id: "b", created_at: "2026-11-10T20:00:00Z" }, { id: "a" }];
  assert.equal(id(l.slice().sort(crowdSort)), "a,b");
});
test("crowdSort: is_mine wins over friend_name", () => {
  const l = [{ id: "f", friend_name: "Lisa" }, { id: "m", is_mine: true, friend_name: "Anton" }];
  assert.equal(id(l.slice().sort(crowdSort)), "m,f");
});
