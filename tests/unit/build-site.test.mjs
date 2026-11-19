// lane ci1: the live build (scripts/build-site.mjs + scripts/bundle.mjs groups + scripts/stamp.mjs). No browser.
// The bundled part needs esbuild (npm ci). Without it those tests are skipped with a message (CI always has it).
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, appendFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { stampSite } from "../../scripts/stamp.mjs";

const REPO = new URL("../..", import.meta.url).pathname, BUILD = join(REPO, "scripts", "build-site.mjs");
let esbuild = true; try { await import("esbuild"); } catch (e) { esbuild = false; }
const need = esbuild ? {} : { skip: "esbuild is not installed here (npm ci installs it; CI runs these)" };
const T = mkdtempSync(join(tmpdir(), "pn-bs-"));
test.after(() => rmSync(T, { recursive: true, force: true }));
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const run = (...a) => spawnSync("node", [BUILD, ...a], { encoding: "utf8", cwd: REPO });
const meta = (dir) => JSON.parse(readFileSync(join(dir, "build.json"), "utf8"));
const repo0 = sha(join(REPO, "docs/index.html")) + sha(join(REPO, "docs/sw.js"));

test("plain build (PAGES_BUNDLE off) = scripts/stamp.mjs on a copy: the old branch deploy, same VERSION, same index.html", () => {
  const r = run("--out", join(T, "p"), "--bundle", "off", "--sha", "abc1234");
  assert.equal(r.status, 0, r.stderr);
  const st = join(T, "st"); cpSync(join(REPO, "docs"), st, { recursive: true });
  const s = stampSite(st);
  const m = meta(join(T, "p/docs"));
  assert.equal(m.version, s.version);
  assert.equal(m.mode, "plain"); assert.equal(m.commit, "abc1234");
  assert.equal(readFileSync(join(T, "p/docs/index.html"), "utf8"), readFileSync(join(st, "index.html"), "utf8"));
  assert.ok(existsSync(join(T, "p/index.html")) && existsSync(join(T, "p/.nojekyll")) && existsSync(join(T, "p/docs/.well-known/assetlinks.json")), "root layout: index.html, .nojekyll, docs/.well-known");
});
test("the build never changes the repo's docs/ and refuses a folder that is not empty", () => {
  const r = run("--out", join(T, "p"), "--bundle", "off");
  assert.equal(r.status, 1); assert.match(r.stderr, /not empty/);
  assert.equal(run("--out", join(REPO, "docs", "x")).status, 1);
  assert.equal(sha(join(REPO, "docs/index.html")) + sha(join(REPO, "docs/sw.js")), repo0);
});
test("bundled build: few start files, named groups in document order, every ?v= is the file's hash, twice = the same", need, () => {
  const a = run("--out", join(T, "a"), "--bundle", "on", "--layout", "docs", "--sha", "abc1234", "--tar", join(T, "a.tar"));
  assert.equal(a.status, 0, a.stderr);
  const b = run("--out", join(T, "a2"), "--bundle", "on", "--layout", "docs", "--sha", "abc1234");
  assert.equal(b.status, 0, b.stderr);
  const m = meta(join(T, "a")), m2 = meta(join(T, "a2"));
  assert.equal(m.version, m2.version, "the same source gives the same VERSION");
  assert.deepEqual(m.files.map((f) => f.file + f.v), m2.files.map((f) => f.file + f.v));
  assert.ok(m.start_files <= 16, "start files: " + m.start_files);
  const g = m.files.filter((f) => /^js\/app\.bundle/.test(f.file)).map((f) => f.file.replace(/^js\/app\.bundle-|\.js$/g, ""));
  assert.deepEqual(g, ["boot", "mbx", "base", "social", "fun", "more", "map", "season", "people", "ui", "app", "last"]);
  assert.ok(m.files.find((f) => f.file === "js/app.bundle-last.js").gzip < 20 * 1024, "the last group is small");
  assert.ok(Math.max(...m.files.map((f) => f.gzip)) < 300 * 1024, "no start file over 300 KB gzip");
  for (const f of m.files) assert.equal(createHash("sha256").update(readFileSync(join(T, "a", f.file))).digest("hex").slice(0, 10), f.v, f.file);
  assert.match(readFileSync(join(T, "a/js/app.bundle-last.js"), "utf8"), new RegExp('window\\.PN_BUILD="' + m.build + '"'));
  // every source file is in exactly one group, in the order of the repo's index.html
  const src = [...readFileSync(join(REPO, "docs/index.html"), "utf8").matchAll(/<script defer src="(\.\/[^"]+)"/g)].map((x) => x[1]).filter((u) => u !== "./config.js");
  const parts = [...readFileSync(join(T, "a/index.html"), "utf8").matchAll(/<script defer src="\.\/js\/app\.bundle[^"]*" data-parts="([^"]*)"/g)].flatMap((x) => x[1].split(",").map((u) => u.replace(/\?.*/, "")));
  assert.deepEqual(parts, src);
  const tar = spawnSync("tar", ["-tf", join(T, "a.tar")], { encoding: "utf8", maxBuffer: 64 << 20 }).stdout.split("\n");
  for (const f of ["./.nojekyll", "./.well-known/assetlinks.json", "./sw.js", "./index.html", "./build.json"]) assert.ok(tar.includes(f), "artifact tar has " + f);
});
test("one changed source file: only its group and the small last group get a new ?v= (a cheap update)", need, () => {
  const root = join(T, "srcB"); mkdirSync(root); cpSync(join(REPO, "docs"), join(root, "docs"), { recursive: true });
  appendFileSync(join(root, "docs/js/glmap.js"), "\n;window.__ci1Changed = 1;\n");   // real code: a comment-only change is minified away (the group keeps its hash)
  const b = run("--repo", root, "--out", join(T, "b"), "--bundle", "on", "--layout", "docs", "--sha", "def5678");
  assert.equal(b.status, 0, b.stderr);
  const A = Object.fromEntries(meta(join(T, "a")).files.map((f) => [f.file, f.v])), B = meta(join(T, "b"));
  const changed = B.files.filter((f) => A[f.file] !== f.v);
  assert.deepEqual(changed.map((f) => f.file), ["js/app.bundle-map.js", "js/app.bundle-last.js"]);
  assert.ok(changed.reduce((n, f) => n + f.gzip, 0) < 250 * 1024);
  assert.notEqual(B.version, meta(join(T, "a")).version); assert.notEqual(B.build, meta(join(T, "a")).build);
});
test("a file that cannot be joined safely stops the build (top-level let in a start script)", need, () => {
  const root = join(T, "srcX"); mkdirSync(root); cpSync(join(REPO, "docs"), join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs/js/chaos.js"), "let leaked = 1;\n" + readFileSync(join(root, "docs/js/chaos.js"), "utf8"));
  const r = run("--repo", root, "--out", join(T, "x"), "--bundle", "on", "--layout", "docs");
  assert.equal(r.status, 1); assert.match(r.stderr, /cannot be joined safely[\s\S]*js\/chaos\.js/);
});
