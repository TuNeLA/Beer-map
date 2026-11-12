// #6 (quality review 12 Nov): unit tests of pure logic in the app parts that had none (docs/js/app-*.js).
// The REAL part code runs through tests/unit/load.mjs (vm loader). No app code is copied. A part test here fails when that logic changes.
import test from "node:test";
import assert from "node:assert/strict";
import { loadFunctions, loadScript } from "./load.mjs";

const U = loadScript("js/util.js").U;
const B = { btoa, atob, escape, unescape };
const lf = (names, scope) => loadFunctions(names, Object.assign({ U, window: {} }, scope || {}));

test("map: heat scale (zoom curves clamp and move the right way)", () => {
  const f = lf(["heatMeters", "heatOpacity", "heatGamma", "zoomEase", "inSweden"], { HEAT_M: [500, 10, 0.72, 9] });
  assert.equal(f.heatMeters(5), 500);                    // zoomed out: the max radius, never more
  assert.equal(f.heatMeters(40), 10);                    // zoomed far in: the min, never less
  assert.ok(f.heatMeters(14) < f.heatMeters(13) && f.heatMeters(13) < f.heatMeters(12));
  assert.equal(f.heatOpacity(10), 1); assert.equal(f.heatOpacity(16), 0.6); assert.ok(Math.abs(f.heatOpacity(14) - 0.8) < 1e-9);
  assert.equal(f.heatGamma(8), 0.5); assert.equal(f.heatGamma(20), 1); assert.ok(Math.abs(f.heatGamma(12.5) - 0.75) < 1e-9);
  assert.equal(f.zoomEase(0), 0); assert.equal(f.zoomEase(1), 1);
  assert.ok(f.zoomEase(0.5) > 0.5, "ease-out: fast start");
  let prev = -1; for (let t = 0; t <= 1; t += 0.1) { const e = f.zoomEase(t); assert.ok(e >= prev); prev = e; }
  assert.equal(f.inSweden(59.3, 18), true); assert.equal(f.inSweden(NaN, 18), false); assert.equal(f.inSweden(90, 0), false);
});

test("pins: hashStr, personKey, noLeadEmoji, skalCount, badgeRank", () => {
  const f = lf(["hashStr", "personKey", "noLeadEmoji", "skalCount", "badgeRank"]);
  assert.equal(f.hashStr("abc"), f.hashStr("abc")); assert.notEqual(f.hashStr("abc"), f.hashStr("abd"));
  assert.ok(f.hashStr("x") >= 0 && f.hashStr("x") <= 0xffffffff, "unsigned 32 bit");
  assert.equal(f.personKey(null), "me"); assert.equal(f.personKey({ is_mine: true, friend_name: "A" }), "me");
  assert.equal(f.personKey({ friend_name: "Kim" }), "f:Kim");
  assert.equal(f.personKey({ bar_id: 7, lat: "59.123456", lng: 15, created_at: "t" }), "s:7:59.1235,15.0000:t");
  assert.equal(f.noLeadEmoji("🔥 Het på gröten"), "Het på gröten"); assert.equal(f.noLeadEmoji(null), "");
  assert.equal(f.skalCount({ skal_count: 3.9 }), 3); assert.equal(f.skalCount({ skal_count: -4 }), 0); assert.equal(f.skalCount({}), 0);
  const el = (...c) => ({ classList: { contains: (x) => c.includes(x) } });
  assert.ok(f.badgeRank(el("cm-rally")) > f.badgeRank(el("cm-king")) && f.badgeRank(el("cm-king")) > f.badgeRank(el("cm-ci")));
  assert.equal(f.badgeRank(el()), 1);
});

test("checkin: myCheckin drops expired / broken, checkinsAt matches by canonical bar id", () => {
  const CI_KEY = "olnu.checkin";
  U.ls.setJSON(CI_KEY, { until: Date.now() + 60000, lat: 59.1, lng: 15.2 });
  const f = lf(["myCheckin", "checkinsAt"], { CI_KEY, window: { BARS: { canonId: (x) => String(x).replace(/^b/, "") }, DEMO: null }, checkins: [{ bar_id: "b5" }, { bar_id: "9" }] });
  assert.equal(f.myCheckin().lat, 59.1);
  U.ls.setJSON(CI_KEY, { until: Date.now() - 1, lat: 59.1, lng: 15.2 }); assert.equal(f.myCheckin(), null);
  U.ls.setJSON(CI_KEY, { until: Date.now() + 60000, lat: "x", lng: 15 }); assert.equal(f.myCheckin(), null);
  U.ls.del(CI_KEY); assert.equal(f.myCheckin(), null);
  assert.deepEqual(f.checkinsAt({ id: 5 }).map((c) => c.bar_id), ["b5"]);
});

test("ticker: chaosFits needs its placeholders; chaosSuppressed comes back only when clearly wilder", () => {
  const f = lf(["chaosFits", "chaosSuppressed"], { CHAOS_SEEN_KEY: "k", chaosHidden: null });
  assert.equal(f.chaosFits("Full {bar}", { bar: "X" }), true); assert.equal(f.chaosFits("Full {bar}", {}), false);
  assert.equal(f.chaosFits("{hot} heta", { hot: 0 }), false); assert.equal(f.chaosFits("plain", {}), true);
  assert.equal(f.chaosSuppressed({ out: 99, hot: 9 }), false, "nothing hidden: never suppressed");
  const hide = (out, hot) => { f.ctx.chaosHidden = { out, hot, until: Date.now() + 1e6 }; };
  hide(20, 1); assert.equal(f.chaosSuppressed({ out: 25, hot: 1 }), true);       // +5 is not 50 % more
  hide(20, 1); assert.equal(f.chaosSuppressed({ out: 30, hot: 1 }), false);      // +50 %
  assert.equal(f.ctx.chaosHidden, null, "cleared when it comes back");
  hide(20, 1); assert.equal(f.chaosSuppressed({ out: 20, hot: 3 }), false);      // 2 more on hot streak
  f.ctx.chaosHidden = { out: 20, hot: 1, until: Date.now() - 1 }; assert.equal(f.chaosSuppressed({ out: 1, hot: 0 }), false);   // night over
});

test("ticker: tickFill adds pieces until the track is wide enough, and stops (guard)", () => {
  let width = 0, calls = 0;
  const track = { get scrollWidth() { return width; }, parentNode: { clientWidth: 100 } };
  const f = lf(["tickFill"], { $: () => track, tickOff: 0, tickPiece: () => { calls++; width += 150; } });
  f.tickFill(); assert.ok(width >= 400 && calls === 3, "need = 2*100+200 = 400 px: " + calls);
  calls = 0; width = 0; const g = lf(["tickFill"], { $: () => track, tickOff: 0, tickPiece: () => { calls++; } });
  g.tickFill(); assert.equal(calls, 20, "a piece that adds nothing cannot loop forever (guard 20)");
});

test("hud: friendsDrinking counts distinct friend pins; nightEnd prefers the server time", () => {
  const f = lf(["friendsDrinking", "nightEnd"], { beers: [{ id: 1, friend_name: "A" }, { id: 1, friend_name: "A" }, { id: 2 }, { id: 3, friend_name: "B" }], meState: null, myNight: () => null });
  assert.equal(f.friendsDrinking(), 2);
  const soon = new Date(Date.now() + 3600e3).toISOString();
  f.ctx.meState = { expires_at: soon }; assert.equal(f.nightEnd(), Date.parse(soon));
  f.ctx.meState = { expires_at: new Date(Date.now() - 1000).toISOString() };   // stale server time: use the local night
  f.ctx.myNight = () => ({ expires: Date.now() + 5000 }); assert.ok(Math.abs(f.nightEnd() - (Date.now() + 5000)) < 50);
});

test("poll: normPins drops bad rows and empty pins, coerces numbers; beerOnly caches views", () => {
  const f = lf(["normPins", "beerOnly"], { beers: [], drinkViews: null });
  const out = f.normPins([{ id: 1, lat: "59.5", lng: "15", beer_count: "2" }, { id: 2, lat: NaN, lng: 1, beer_count: 1 }, { lat: 1, lng: 1, beer_count: 1 },
    { id: 3, lat: 1, lng: 1, beer_count: 0, other_count: 0 }, { id: 4, lat: 1, lng: 1, beer_count: -3, other_count: 2, skal_count: -1, is_mine: 1 }, null]);
  assert.deepEqual(out.map((b) => b.id), [1, 4]);
  assert.equal(out[0].lat, 59.5); assert.equal(out[0].beer_count, 2); assert.equal(out[0].friend_name, null);
  assert.equal(out[1].beer_count, 0); assert.equal(out[1].skal_count, 0); assert.equal(out[1].is_mine, true);
  assert.equal(f.normPins(null).length, 0);
  f.ctx.beers = [{ beer_count: 2, other_count: 1 }, { beer_count: 0, other_count: 0 }];
  const v = f.beerOnly(); assert.equal(v.length, 1); assert.equal(v[0].beer_count, 3); assert.equal(v[0].beers_only, 2); assert.equal(f.beerOnly(), v);
});

test("beer: cooldownLeft is the rest of the 10 min, never negative", () => {
  const f = lf(["cooldownLeft"], { myNight: () => null });
  assert.equal(f.cooldownLeft(), 0);
  f.ctx.myNight = () => ({ lastTap: Date.now() - 60000 }); const left = f.cooldownLeft();
  assert.ok(left > 530000 && left <= 540000, "10 min - 1 min: " + left);
  f.ctx.myNight = () => ({ lastTap: Date.now() - U.COOLDOWN_MS - 1 }); assert.equal(f.cooldownLeft(), 0);
});

test("account: flytt code round trip (b64url, makeFlyttCode -> readFlytt) and rejects", () => {
  U.ls.setJSON("olnu.auth", { refresh_token: "rt-abcdef-123", user: { id: "u1" } });
  U.ls.set("olnu.lang", "sv"); U.ls.set("olnu.prec", "1");
  const f = lf(["b64urlEnc", "b64urlDec", "storedAuth", "storedUid", "makeFlyttCode", "readFlytt", "rtHash"],
    Object.assign({ AUTH_KEY: "olnu.auth", FLYTT_KEYS: ["lang", "prec", "mute"], FLYTT_MAX: 900, getName: () => "Åsa" }, B));
  assert.equal(f.b64urlDec(f.b64urlEnc("Åäö 🍺 ~?>")), "Åäö 🍺 ~?>");
  assert.ok(!/[+/=]/.test(f.b64urlEnc("???>>>~~~")), "url-safe");
  const code = f.makeFlyttCode(), p = f.readFlytt(code);
  assert.equal(p.rt, "rt-abcdef-123"); assert.equal(p.u, "u1"); assert.equal(p.name, "Åsa"); assert.equal(JSON.stringify(p.ls), JSON.stringify({ lang: "sv", prec: "1" }));
  assert.equal(f.readFlytt("https://x.se/?flytt=" + code + "&a=1").rt, "rt-abcdef-123", "a whole link works");
  assert.equal(f.readFlytt("short"), null); assert.equal(f.readFlytt(""), null);
  assert.equal(f.readFlytt(f.b64urlEnc(JSON.stringify({ v: 2, rt: "123456789" }))), null, "wrong version");
  assert.equal(f.readFlytt(f.b64urlEnc(JSON.stringify({ v: 1, rt: "x" }))), null, "token too short");
  assert.equal(f.rtHash("abc"), f.rtHash("abc")); assert.notEqual(f.rtHash("abc"), f.rtHash("abd"));
  U.ls.del("olnu.auth"); assert.equal(f.makeFlyttCode(), null, "signed out: no code");
});

test("account: makeFlyttCode drops a key that would pass FLYTT_MAX (the code never grows past it)", () => {
  U.ls.setJSON("olnu.auth", { refresh_token: "rt-abcdef-123", user: { id: "u1" } });
  U.ls.set("olnu.big", "x".repeat(2000)); U.ls.set("olnu.lang", "sv");
  const f = lf(["b64urlEnc", "storedAuth", "storedUid", "makeFlyttCode"], Object.assign({ AUTH_KEY: "olnu.auth", FLYTT_KEYS: ["big", "lang"], FLYTT_MAX: 900, getName: () => null }, B));
  const code = f.makeFlyttCode(); assert.ok(code.length <= 900);
  const p = JSON.parse(decodeURIComponent(escape(atob(code.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(code.length / 4) * 4, "=")))));
  assert.deepEqual(p.ls, { lang: "sv" }); U.ls.del("olnu.auth");
});

test("groups: gactScore halves per half-life, sortGroupsByChat keeps server order on ties", () => {
  const HALF = 5 * 86400e3, GACT_KEY = "olnu.gact";
  const f = lf(["gactScore", "sortGroupsByChat", "joinLink"], { GACT_HALF: HALF, GACT_KEY, location: { origin: "https://x.se", pathname: "/app/" } });
  assert.equal(f.gactScore(null), 0);
  assert.ok(Math.abs(f.gactScore({ s: 8, t: Date.now() - HALF }) - 4) < 0.01);
  U.ls.setJSON(GACT_KEY, { 2: { s: 3, t: Date.now() }, 3: { s: 1, t: Date.now() } });
  assert.deepEqual(f.sortGroupsByChat([{ id: 1 }, { id: 3 }, { id: 2 }, { id: 4 }]).map((g) => g.id), [2, 3, 1, 4]);
  U.ls.del(GACT_KEY);
  assert.equal(f.joinLink("a b&c"), "https://x.se/app/?join=a%20b%26c");
});

test("settings: inAppBrowser sees in-app user agents, iosNeedsInstall only for iOS in the browser", () => {
  const ua = (s) => lf(["inAppBrowser"], { navigator: { userAgent: s } }).inAppBrowser();
  assert.equal(ua("Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBAV/400]"), true);
  assert.equal(ua("Mozilla/5.0 Instagram 300.0"), true);
  assert.equal(ua("Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36"), false);
  const ios = (isIOS, st) => lf(["iosNeedsInstall"], { U: { isIOS: () => isIOS, isStandalone: () => st } }).iosNeedsInstall();
  assert.equal(ios(true, false), true); assert.equal(ios(true, true), false); assert.equal(ios(false, false), false);
});

test("filmfx: stampedSrc keeps the deploy ?v= (own tag first, else the filmfx tag's version)", () => {
  const doc = (srcs) => ({ querySelector: (sel) => { const m = /js\/([\w-]+)\.js/.exec(sel); const s = srcs.find((x) => m && x.includes("js/" + m[1] + ".js")); return s ? { getAttribute: () => s } : null; } });
  const f = (srcs) => loadFunctions(["stampedSrc"], { document: doc(srcs) }).stampedSrc;
  assert.equal(f(["./js/filmcam.js?v=abc123", "./js/filmfx.js?v=zzz"])("filmcam"), "./js/filmcam.js?v=abc123");
  assert.equal(f(["./js/filmfx.js?v=zzz"])("filmcam"), "./js/filmcam.js?v=zzz");
  assert.equal(f([])("filmcam"), "./js/filmcam.js", "clean dev tree: no version");
});
