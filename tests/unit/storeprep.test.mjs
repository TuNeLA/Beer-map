// Lane storeprep (19 Nov 2026). F1: the Android store build (android-cap/, Capacitor, targetSdk 36, se.tunela.pintsnow).
// F4: docs/radera.html says what the app really does today (direct delete until 0402 is live, then 7 days to undo).
// Static checks only: no Android SDK, no network. The APK itself is built by .github/workflows/android-cap.yml.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CAP = path.join(ROOT, "android-cap");
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const has = (rel) => fs.existsSync(path.join(ROOT, rel));

/* ---------------- F1: Android store build ---------------- */
test("F1: android-cap exists with the FINAL package name and Capacitor at targetSdk 36", () => {
  assert.ok(has("android-cap/capacitor.config.json"), "android-cap/capacitor.config.json is missing");
  const cfg = JSON.parse(rd("android-cap/capacitor.config.json"));
  assert.equal(cfg.appId, "se.tunela.pintsnow");
  assert.equal(cfg.webDir, "www");
  assert.equal(cfg.server && cfg.server.androidScheme, "https");
  // a sub-domain of the app origin: the Mapbox token's URL list (pintsnow.com) covers it, and handover.js sees an
  // origin that is NOT APP_ORIGIN (no bounce to the old-address bridge on the first start)
  assert.match(String(cfg.server && cfg.server.hostname), /^[a-z0-9-]+\.pintsnow\.com$/);
  const vars = rd("android-cap/android/variables.gradle");
  assert.match(vars, /targetSdkVersion\s*=\s*36\b/);
  assert.match(vars, /compileSdkVersion\s*=\s*36\b/);
  const app = rd("android-cap/android/app/build.gradle");
  assert.match(app, /applicationId "se\.tunela\.pintsnow"/);
  assert.match(app, /namespace = "se\.tunela\.pintsnow"/);
  const pkg = JSON.parse(rd("android-cap/package.json"));
  for (const d of ["@capacitor/android", "@capacitor/core"]) assert.match(pkg.dependencies[d], /^8\.\d+\.\d+$/, d + " pinned to an exact 8.x");
  assert.match(pkg.devDependencies["@capacitor/cli"], /^8\.\d+\.\d+$/);
});

test("F1: least permissions (no background location), no keystore and no password in the repo", () => {
  const man = rd("android-cap/android/app/src/main/AndroidManifest.xml");
  assert.ok(!/ACCESS_BACKGROUND_LOCATION/.test(man), "never background location");
  assert.match(man, /ACCESS_COARSE_LOCATION/);
  const files = execFileSync("git", ["-C", ROOT, "ls-files", "android-cap", ".github/workflows/android-cap.yml"], { encoding: "utf8" }).split("\n").filter(Boolean);
  assert.ok(files.length > 10, "android-cap files are not git-added: " + files.length);
  assert.deepEqual(files.filter((f) => /\.(keystore|jks|p12|apk|aab)$/i.test(f)), [], "no key or build output in git");
  const gradle = rd("android-cap/android/app/build.gradle");
  assert.ok(!/(storePassword|keyPassword)\s+["']/.test(gradle), "passwords come from the environment only");
  const wf = rd(".github/workflows/android-cap.yml");
  for (const s of ["ANDROID_UPLOAD_KEYSTORE_B64", "ANDROID_UPLOAD_STORE_PASSWORD", "ANDROID_UPLOAD_KEY_ALIAS", "ANDROID_UPLOAD_KEY_PASSWORD"])
    assert.ok(wf.includes("secrets." + s), "workflow reads secret " + s);
  assert.ok(!/PASSWORD:\s*[A-Za-z0-9_+/=-]{8,}\s*$/m.test(wf), "no plain-text password in the workflow");
});

test("F1: the store copy of config.js sets window.OLNU_STORE = true; docs/config.js stays the web build", async () => {
  const { storeConfig, FLAG_NEW } = await import(path.join(CAP, "scripts/prepare-www.mjs"));
  const src = rd("docs/config.js");
  const run = (code) => {
    const store = {}, cls = [];
    const win = { location: { search: "", hostname: "app.pintsnow.com" }, document: { referrer: "", documentElement: { classList: { add: (c) => cls.push(c) } } },
      sessionStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); } }, localStorage: { getItem: () => null } };
    win.window = win;
    vm.runInNewContext(code, win);
    return { flag: win.OLNU_STORE, cls, sess: store["olnu.store"] };
  };
  assert.deepEqual(run(src), { flag: false, cls: [], sess: undefined }, "web build: off");
  const out = storeConfig(src);
  assert.ok(out.includes(FLAG_NEW));
  assert.deepEqual(run(out), { flag: true, cls: ["olnu-store"], sess: "1" }, "store build: on from the first line");
  assert.throws(() => storeConfig(src.replace("  window.OLNU_STORE = s;\n", "")), /exactly once/, "a changed config.js fails loud");
});

/* ---------------- F4: radera.html tells the truth ---------------- */
const page = () => rd("docs/radera.html");
const blocks = (html, mode) => [...html.matchAll(new RegExp('<(p|li|div)\\b[^>]*class="when-' + mode + '"[^>]*>([\\s\\S]*?)</\\1>', "g"))].map((m) => m[2]);
const strip = (html) => html.replace(/<(p|li|div)\b[^>]*class="when-(direct|7d)"[^>]*>[\s\S]*?<\/\1>/g, "");
const txt = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("F4: radera.html shows the mode that is live (0402 in the live schema snapshot = 7 days, else direct)", () => {
  const live7 = has("supabase/schema/functions/my_account_deletion().sql");
  const m = page().match(/<body class="(del-direct|del-7d)">/);
  assert.ok(m, "<body> must carry del-direct or del-7d (the one switch)");
  assert.equal(m[1], live7 ? "del-7d" : "del-direct",
    live7 ? "0402 is live: switch radera.html to del-7d" : "0402 is NOT live: the app deletes at once, the page must say so");
  assert.match(page(), /\.del-direct \.when-7d,\.del-7d \.when-direct\{display:none\}/);
});

test("F4: both texts exist, each one names the buttons its app flow really has", () => {
  const html = page(), v14 = rd("docs/js/v14.js"), misc = rd("docs/js/misc-mod.js");
  const dir = txt(blocks(html, "direct").join(" ")), d7 = txt(blocks(html, "7d").join(" "));
  // the old direct flow (v14.js): "Ja, radera" → "🗑️ Radera nu"
  const y1 = (v14.match(/delYes1: "([^"]+)"/) || [])[1], y2 = ((v14.match(/delYes2: "([^"]+)"/) || [])[1] || "").replace(/^\S+\s/, "");
  assert.ok(y1 && y2, "v14.js labels found");
  assert.ok(dir.includes(y1) && dir.includes(y2), "direct text names " + y1 + " / " + y2 + ": " + dir);
  assert.match(dir, /Det sker direkt/);
  assert.match(dir, /immediate/);
  // the 7-day flow (misc-mod.js, 0402)
  for (const l of ["Radera kontot", "Ja, radera", "Ångra – behåll kontot", "Radera direkt, utan ångertid"]) {
    assert.ok(misc.includes('"' + l + '"'), "misc-mod.js still has " + l);
    assert.ok(d7.includes(l), "7-day text names " + l);
  }
  assert.match(d7, /7 dagar/);
  assert.match(d7, /after 7 days/);
  // nothing outside the two blocks claims either mode
  const rest = txt(strip(html));
  assert.ok(!/Det sker direkt|7 dagar|immediate|after 7 days/.test(rest), "a mode claim outside the switch: " + rest.slice(0, 200));
});
