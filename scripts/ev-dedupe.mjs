// Öl Nu — 📅 one row per real event (CONTRACT "📅 EN RAD PER EVENT", migration 0164). Same rules as the server's olnu_ev_dup():
// two rows are ONE event when they start within ±45 min AND
//   a) both have teams and the teams match (first real word of home and away: "Ludvika HF" = "Ludvika Hockey Förening"), ≤ 3 km, or
//   b) one has teams and the other's title has both team words, ≤ 3 km, or
//   c) same bar or ≤ 300 m, and the titles share ≥ 50 % of the words of the longer title ("–", "-", "vs", "@", "på", "(Tal: …)" ignored).
// Import time (scripts/import-events.mjs): a Tickster / Ticketmaster / Visit Sweden / feed row that is a match row's twin is NOT
// uploaded; its shop link becomes the match row's ticket_url when the match has none. Twins among the other rows: the best one is
// uploaded (Ticketmaster > Tickster > own feeds > Visit Sweden). Rows already in the database are hidden at read time (0164).
// Node 18+. Stand-alone check: node scripts/ev-dedupe.mjs rows.json (a JSON array of rows) prints the groups it would merge.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const STOP = new Set(["vs", "mot", "och", "and", "the", "pa", "at", "med", "mfl", "if", "ik", "hc", "hk", "bk", "sk", "aik", "ff", "fk", "fc",
  "is", "hf", "goif", "ibk", "ibf", "bois", "hockey", "ishockey", "hockeyforening", "hockeyklubb", "forening", "idrottsforening", "idrottsklubb",
  "idrottsallskap", "klubb", "club", "fotboll", "fotbollsklubb", "tal", "text", "svenska", "engelska", "live", "biljetter", "tickets",
  "presenterar", "presents", "feat", "ft"]);
const FROM = "åäöéèëüáàâêíóúñç", TO = "aaoeeeuaaaeiounc";

export function evWords(s) {
  let t = String(s || "").replace(/\([^)]*(\)|$)/g, " ").toLowerCase();
  t = t.replace(/[åäöéèëüáàâêíóúñç]/g, (c) => TO[FROM.indexOf(c)]);
  return t.replace(/[^a-z0-9]+/g, " ").trim().split(" ")
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map((w) => (w.length >= 5 && w.endsWith("s") ? w.slice(0, -1) : w));
}
export function evTeam(s) { return evWords(s).find((w) => w.length >= 3) || null; }
export function evRank(r) {
  const teams = r.home && r.away ? 100 : 0;
  const S = { swehockey: 60, thesportsdb: 55, owner: 50, ticketmaster: 40, tickster: 38, recurring: 32, ical: 30, jsonld: 30, visitsweden: 20 };
  return teams + (S[r.source] || 10);
}
const metres = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180));

function prep(r) {
  if (!r.__w) Object.defineProperty(r, "__w", { value: { w: evWords(r.title), h: evTeam(r.home), a: evTeam(r.away), t: Date.parse(r.starts_at) }, enumerable: false });
  return r.__w;
}
export function sameEvent(a, b) {
  if (!a || !b || a.tv || b.tv || !isFinite(a.lat) || !isFinite(b.lat)) return false;
  const A = prep(a), B = prep(b);
  if (!(Math.abs(A.t - B.t) <= 45 * 60e3)) return false;
  const m = metres(a, b), aT = !!(A.h && A.a), bT = !!(B.h && B.a);
  if (m <= 3000) {
    if (aT && bT && A.h === B.h && A.a === B.a) return true;
    if (aT && !bT && B.w.includes(A.h) && B.w.includes(A.a)) return true;
    if (bT && !aT && A.w.includes(B.h) && A.w.includes(B.a)) return true;
  }
  if (aT && bT) return false;
  if (!(m <= 300 || (a.bar_id && a.bar_id === b.bar_id))) return false;
  const sa = new Set(A.w), inter = [...new Set(B.w)].filter((w) => sa.has(w)).length, mx = Math.max(new Set(A.w).size, new Set(B.w).size);
  return inter >= 1 && mx > 0 && inter / mx >= 0.5;
}
const isShop = (r) => r.source === "tickster" || r.source === "ticketmaster";

// sport = rows for import_sport_events, rows = rows for import_events. Returns new arrays + stats + merged groups (for --dry).
export function dedupeImport(sport, rows) {
  const all = [...sport.filter((r) => !r.tv), ...rows].sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at));
  const drop = new Set(), groups = [];
  // Sweep by time: only rows within 45 min of each other are compared.
  for (let i = 0; i < all.length; i++) {
    const a = all[i]; if (drop.has(a)) continue;
    const ta = Date.parse(a.starts_at), twins = [];
    for (let j = i + 1; j < all.length && Date.parse(all[j].starts_at) - ta <= 45 * 60e3; j++) {
      const b = all[j]; if (!drop.has(b) && sameEvent(a, b)) twins.push(b);
    }
    if (!twins.length) continue;
    const g = [a, ...twins].sort((x, y) => evRank(y) - evRank(x));
    const keep = g[0];
    for (const x of g.slice(1)) {
      drop.add(x);
      if (!keep.ticket_url && keep.home && isShop(x) && x.url) keep.ticket_url = x.url;   // a match row takes the shop link
      if (!keep.ticket_url && keep.home && x.ticket_url) keep.ticket_url = x.ticket_url;
      if (!keep.url && x.url) keep.url = x.url;
      if (!keep.place && x.place) keep.place = x.place;
      for (const k of ["sport", "league", "home", "away"]) if (!keep[k] && x[k] && sport.includes(keep)) keep[k] = x[k];
    }
    groups.push({ keep: keep.title + " [" + keep.source + "]", hide: g.slice(1).map((x) => x.title + " [" + x.source + "]") });
  }
  return {
    sport: sport.filter((r) => !drop.has(r)), rows: rows.filter((r) => !drop.has(r)), groups,
    stats: { before: sport.filter((r) => !r.tv).length + rows.length, after: all.length - drop.size, merged: drop.size }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const list = JSON.parse(await readFile(process.argv[2], "utf8"));
  const sport = list.filter((r) => r.home && r.away), rows = list.filter((r) => !(r.home && r.away));
  const d = dedupeImport(sport, rows);
  console.log(JSON.stringify({ stats: d.stats, groups: d.groups.slice(0, 40) }, null, 1));
}
