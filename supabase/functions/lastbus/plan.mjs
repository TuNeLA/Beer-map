// PintsNow edge function `lastbus` — the pure part (no Deno, no network): rounding, the ResRobot URLs and the answer.
// index.ts imports it; tests/unit/lastbus.test.mjs runs it in node. See index.ts for the why.
// ResRobot v2.1 route planner (Trafiklab): GET https://api.resrobot.se/v2.1/trip?originCoordLat=..&originCoordLong=..
//   &destCoordLat=..&destCoordLong=..&date=YYYY-MM-DD&time=HH:MM&searchForArrival=0|1&numF=1..6&format=json&accessId=KEY
//   Answer: { Trip: [ { LegList: { Leg: [ { type: "WALK"|"JNY"|..., duration: "PT6M", Origin: {name, date, time},
//   Destination: {name, date, time}, Product: {name, num, catOutL} | [..] } ] } } ] }. Licence CC0.

export const STEP = 0.005;   // ≈ 550 m north-south: the same coarse grid the app uses for a drink inside the home zone
export const LAST_BY = "03:00";   // the night ends: the last trip of the night must ARRIVE before 03:00

export function round(v, step = STEP) { return Math.round(+v / step) * step; }
export function roundPt(p) {
  const lat = +(p && p.lat), lng = +(p && p.lng);
  if (!isFinite(lat) || !isFinite(lng) || lat < 55 || lat > 69.5 || lng < 10.5 || lng > 24.5) return null;   // Sweden only
  return { lat: +round(lat).toFixed(3), lng: +round(lng).toFixed(3) };
}

// Wall-clock date and time in Europe/Stockholm (the server runs in UTC).
export function sthlm(ms) {
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = {}; for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { date: p.year + "-" + p.month + "-" + p.day, time: p.hour + ":" + p.minute, hour: +p.hour };
}
function addDay(date, n) { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// Two calls: (1) the next trips from now, (2) the last trips that arrive before 03:00 tonight.
export function urls(key, from, to, nowMs) {
  const n = sthlm(nowMs), base = "https://api.resrobot.se/v2.1/trip?format=json&lang=sv&accessId=" + encodeURIComponent(key) +
    "&originCoordLat=" + from.lat + "&originCoordLong=" + from.lng + "&destCoordLat=" + to.lat + "&destCoordLong=" + to.lng;
  const lastDate = n.hour < 5 ? n.date : addDay(n.date, 1);
  return [base + "&date=" + n.date + "&time=" + n.time + "&numF=3",
    base + "&date=" + lastDate + "&time=" + LAST_BY + "&searchForArrival=1&numF=3"];
}

const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
function mins(iso) { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?/.exec(String(iso || "")); return m ? (+m[1] || 0) * 60 + (+m[2] || 0) : 0; }
function hm(t) { return String(t || "").slice(0, 5); }
// One trip → { dep: "YYYY-MM-DD HH:MM" (the first bus / train leaves), line, stop, walk (min to the stop), arr, to } | null
export function tripOf(t) {
  const legs = arr(t && t.LegList && t.LegList.Leg);
  let walk = 0, first = null, last = null;
  for (const l of legs) {
    if (l.type === "JNY") { if (!first) first = l; last = l; } else if (!first) walk += mins(l.duration);
  }
  if (!first || !first.Origin || !first.Origin.time) return null;
  const p = arr(first.Product)[0] || {};
  const line = ((p.catOutL || "") + " " + (p.num || p.displayNumber || "")).trim() || String(p.name || first.name || "").trim();
  return { dep: first.Origin.date + " " + hm(first.Origin.time), line: line.slice(0, 40), stop: String(first.Origin.name || "").slice(0, 60),
    walk, arr: last && last.Destination ? hm(last.Destination.time) : "", to: last && last.Destination ? String(last.Destination.name || "").slice(0, 60) : "" };
}
// The answer the app reads: { ok, next, last, gone } (times as "YYYY-MM-DD HH:MM" Stockholm time).
export function answer(nextJson, lastJson, nowMs) {
  const now = sthlm(nowMs), nowKey = now.date + " " + now.time;
  const next = arr(nextJson && nextJson.Trip).map(tripOf).filter((x) => x && x.dep >= nowKey).sort((a, b) => (a.dep < b.dep ? -1 : 1));
  const last = arr(lastJson && lastJson.Trip).map(tripOf).filter(Boolean).sort((a, b) => (a.dep < b.dep ? -1 : 1));
  const L = last.length ? last[last.length - 1] : null;
  return { ok: true, next: next[0] || null, last: L, gone: !L || L.dep < nowKey };   // no trip tonight at all = gone too
}
