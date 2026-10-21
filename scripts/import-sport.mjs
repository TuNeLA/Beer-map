// Öl Nu — ⚽🏒 sport matches for public.bar_events (CONTRACT "SPORT + 📅 EVENT-KNAPPEN", migration 0100).
// Called by scripts/import-events.mjs (same daily GitHub Actions run). Node 18+ (global fetch). Config: scripts/sport-feeds.json,
// arena positions: scripts/sport-venues.json. Every source is optional and fails soft (logged, the others still run).
//
// Sources (research: CONTRACT + scratchpad/sport-research.md):
//   1. stats.swehockey.se "Games By Date" (the Swedish Ice Hockey Association's official public stats site, no robots.txt rules):
//      one page per day for 14 days. Senior leagues only: SHL, HockeyAllsvenskan, Hockeyettan, HockeyTvåan, HockeyTrean
//      (Ludvika HF = HockeyTrean Dalarna, Smedjebackens HC = HockeyTvåan, Borlänge HF = Hockeyettan, Mora/Leksand = HockeyAllsvenskan).
//      Match facts only (date, time, teams, arena) + a link back. 1.5 s between pages.
//   2. TheSportsDB v1 (free key "123" works without a secret; THESPORTSDB_KEY = premium key, optional, lifts the 3-rows cap):
//      football league days (Allsvenskan, Superettan, Ettan Norra), the next match of local teams (IK Brage …),
//      and the next match of "TV teams" (Sverige, big Premier League / La Liga clubs) → TV rows. 30 requests/min → 2.1 s apart.
//   3. football-data.org v4 (FOOTBALL_DATA_KEY, free plan: PL, CL, WC, EC …; 10 calls/min). One call. Big games → TV rows.
//      Its terms ask for the line "Football data provided by the Football-Data.org API" in the app (⚙️ Om).
//   4. Manual TV entries in sport-feeds.json "tv_manual" (Tre Kronor etc.).
// Rows go to import_sport_events (service role). TV rows have NO lat/lng (town-less) — old clients (events_near) never see them.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ticketFor } from "./import-tickster.mjs";   // 🎟️ exact match links (optional TICKSTER_KEY)

const here = dirname(fileURLToPath(import.meta.url));
const UA = "OlNu-events/1.0 (+https://github.com/TuNeLA/Beer-map; daily match import)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TZ = "Europe/Stockholm";

/* ---------- small helpers ---------- */
function tzOffset(utcMs, tz) {
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(utcMs)).forEach((x) => { p[x.type] = x.value; });
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000;
}
export function stockholm(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split("-").map(Number), [h, mi] = String(timeStr || "19:00").split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - tzOffset(guess, TZ);
  const off2 = tzOffset(t, TZ);
  if (guess - off2 !== t) t = guess - off2;
  return t;
}
export function localDate(ms) { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)); }
const decode = (s) => String(s || "")
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const text = (h) => decode(String(h || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
export const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function km(a, b) { const dx = (a.lng - b.lng) * 111.32 * Math.cos(a.lat * Math.PI / 180), dy = (a.lat - b.lat) * 111.32; return Math.sqrt(dx * dx + dy * dy); }
const cut = (s, n) => (s == null ? null : String(s).slice(0, n));

/* ---------- positions: arena table → town in the arena / team name → null ---------- */
export function placer(venues, towns) {
  const vIdx = new Map(Object.entries(venues || {}).map(([k, v]) => [norm(k), v]));
  const tIdx = (towns || []).map((t) => ({ t, n: norm(t.name) })).sort((a, b) => b.n.length - a.n.length);
  function townIn(s) {
    const n = " " + norm(s) + " ";
    for (const x of tIdx) {
      // "Leksands IF" → Leksand, "Smedjebackens HC" → Smedjebacken, "Borlänge Ishall" → Borlänge
      if (n.includes(" " + x.n + " ") || n.includes(" " + x.n + "s ")) return x.t;
    }
    return null;
  }
  return function place(venue, home, location) {
    const v = venue && vIdx.get(norm(venue));
    if (v && isFinite(v.lat)) return { lat: +v.lat, lng: +v.lng, place: cut(venue, 60), exact: true };
    const t = townIn(location || "") || townIn(venue || "") || townIn(home || "");
    if (t) return { lat: +t.lat, lng: +t.lng, place: cut(venue || t.name, 60), exact: false };
    return null;
  };
}

/* ---------- 1. stats.swehockey.se ---------- */
// One "Games By Date" page → [{group, groupId, time, home, away, venue, gameId, played}]
export function parseSwehockeyDay(html) {
  const out = [];
  let group = null, groupId = null;
  const body = String(html || "");
  const start = body.search(/Group<\/a>\s*\/\s*<a[^>]*>Time|<th class="tdHeader">Venue<\/th>/i);
  const rows = (start > 0 ? body.slice(start) : body).split(/<tr[\s>]/i).slice(1);
  for (const raw of rows) {
    const r = raw.split(/<\/tr>/i)[0];
    const g = r.match(/colspan="5"[\s\S]*?<a href="\/ScheduleAndResults\/(?:Overview|Schedule|Live)\/(\d+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (g) { groupId = g[1]; group = text(g[2]); continue; }
    const tds = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (tds.length < 3 || !group) continue;
    const tm = text(tds[0]).match(/(\d{1,2}):(\d{2})/);
    const teams = text(tds[1]).split(/\s+-\s+/);
    if (!tm || teams.length !== 2 || !teams[0] || !teams[1]) continue;
    const res = text(tds[2]);
    const gid = (r.match(/lnkTooltip"\s+title="(\d+)"/) || r.match(/Game\/Events\/(\d+)/) || [])[1] || null;
    out.push({ group, groupId, time: ("0" + tm[1]).slice(-2) + ":" + tm[2], home: teams[0].trim(), away: teams[1].trim(),
      venue: text(tds[tds.length - 1]) || null, gameId: gid, played: /\d+\s*-\s*\d+/.test(res) });
  }
  return out;
}
export function swehockeyRows(day, games, cfg, place) {
  const keep = new RegExp(cfg.leagues || "^(SHL|HockeyAllsvenskan|Hockeyettan|HockeyTvåan|HockeyTrean)", "i");
  const skip = new RegExp(cfg.skip || "(U\\d|TV-?pucken|Preseason|Träning|Distrikt|Junior)", "i");
  const out = [];
  for (const g of games) {
    if (!keep.test(g.group) || skip.test(g.group)) continue;
    const st = stockholm(day, g.time), p = place(g.venue, g.home);
    const league = g.group.replace(/,\s*Region\s+\S+$/i, "").slice(0, 40);
    const sid = (g.gameId || norm(g.home + "-" + g.away).replace(/ /g, "")) + ":" + day;
    const base = { source: "swehockey", source_id: "swh:" + sid, title: cut(g.home + " – " + g.away, 80), starts_at: new Date(st).toISOString(),
      ends_at: new Date(st + 150 * 60e3).toISOString(), url: "https://stats.swehockey.se/ScheduleAndResults/Schedule/" + g.groupId,
      sport: "hockey", league, home: cut(g.home, 60), away: cut(g.away, 60), kind: "sport" };
    if (p) out.push(Object.assign({}, base, { place: p.place, lat: p.lat, lng: p.lng, tv: false }));
    // Regional "TV match": e.g. Leksand / Mora games for everyone in Dalarna (ends up town-less, with an area)
    const tvr = cfg.tv_teams ? new RegExp(cfg.tv_teams, "i") : null;
    const tvl = new RegExp(cfg.tv_leagues || "^(SHL|HockeyAllsvenskan)", "i");
    if (tvr && tvl.test(g.group) && (tvr.test(g.home) || tvr.test(g.away)) && cfg.tv_area) {
      out.push(Object.assign({}, base, { source: "tv", source_id: "tv:swh:" + sid, place: null, lat: null, lng: null, tv: true,
        tv_lat: cfg.tv_area.lat, tv_lng: cfg.tv_area.lng, tv_km: cfg.tv_area.km || 200 }));
    }
  }
  return out;
}
async function swehockey(cfg, place, log, now) {
  const rows = [];
  const days = Math.max(1, Math.min(21, +cfg.days || 14));
  for (let i = 0; i < days; i++) {
    const day = localDate(now + i * 864e5);
    const url = "https://stats.swehockey.se/GamesByDate/" + day + "/ByTime/null";
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
      if (!r.ok) { log("swehockey", day, r.status); if (r.status === 429 || r.status >= 500) break; continue; }
      const got = swehockeyRows(day, parseSwehockeyDay(await r.text()), cfg, place);
      rows.push(...got);
      log("swehockey", day, got.length);
    } catch (e) { log("swehockey", day, String(e.message || e)); }
    await sleep(1500);
  }
  return rows;
}

/* ---------- 2. TheSportsDB ---------- */
export function tsdbRow(e, o) {
  const ts = e.strTimestamp ? Date.parse(/Z|[+-]\d\d:?\d\d$/.test(e.strTimestamp) ? e.strTimestamp : e.strTimestamp + "Z") : NaN;
  if (!isFinite(ts) || !e.strHomeTeam || !e.strAwayTeam) return null;
  if (/^yes$/i.test(e.strPostponed || "") || /(PST|CANC|ABD|FT|AET|PEN)$/i.test(e.strStatus || "")) return null;
  const row = { source: o.tv ? "tv" : "thesportsdb", source_id: (o.tv ? "tv:tsdb:" : "tsdb:") + e.idEvent, title: cut(e.strHomeTeam + " – " + e.strAwayTeam, 80),
    starts_at: new Date(ts).toISOString(), ends_at: new Date(ts + 120 * 60e3).toISOString(),
    url: "https://www.thesportsdb.com/event/" + e.idEvent, sport: /hockey/i.test(e.strSport || "") ? "hockey" : "fotboll",
    league: cut(o.league || e.strLeague, 40), home: cut(e.strHomeTeam, 60), away: cut(e.strAwayTeam, 60), kind: "sport", tv: !!o.tv };
  if (o.tv) return Object.assign(row, { place: null, lat: null, lng: null });
  if (!o.pos) return null;
  return Object.assign(row, { place: o.pos.place, lat: o.pos.lat, lng: o.pos.lng });
}
async function thesportsdb(cfg, place, log, now, skipClubTv) {
  const key = process.env.THESPORTSDB_KEY || "123", base = "https://www.thesportsdb.com/api/v1/json/" + encodeURIComponent(key) + "/";
  const rows = [], venues = new Map();
  let waited = 0;
  async function get(path) {
    await sleep(2100);   // free: 30 requests/min
    let r = await fetch(base + path, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (r.status === 429 && waited < 3) { waited++; log("thesportsdb 429, waiting 61 s"); await sleep(61000); r = await fetch(base + path, { headers: { "User-Agent": UA, Accept: "application/json" } }); }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const t = await r.text();
    try { return JSON.parse(t); } catch { throw new Error("not json: " + t.slice(0, 80)); }
  }
  async function venuePos(e) {
    let loc = null;
    if (e.idVenue) {
      if (!venues.has(e.idVenue)) {
        try { const v = await get("lookupvenue.php?id=" + encodeURIComponent(e.idVenue)); venues.set(e.idVenue, (v && v.venues && v.venues[0] && v.venues[0].strLocation) || null); }
        catch { venues.set(e.idVenue, null); }
      }
      loc = venues.get(e.idVenue);
    }
    return place(e.strVenue, e.strHomeTeam, loc || e.strCity || "");
  }
  const until = now + (+cfg.days || 14) * 864e5, seen = new Set();
  const inWin = (e) => { const t = Date.parse((e.strTimestamp || "") + (/Z$/.test(e.strTimestamp || "") ? "" : "Z")); return isFinite(t) && t > now - 3 * 3600e3 && t < until; };
  async function local(e, league) {
    if (!e || seen.has("l" + e.idEvent) || !inWin(e) || (e.strCountry && !/sweden|sverige/i.test(e.strCountry))) return;
    seen.add("l" + e.idEvent);
    const r = tsdbRow(e, { league, pos: await venuePos(e) });
    if (r) rows.push(r);
  }
  for (const id of cfg.local_teams || []) {
    try { const d = await get("eventsnext.php?id=" + id); for (const e of ((d && d.events) || []).slice(0, 3)) await local(e, null); }
    catch (e) { log("thesportsdb team", id, e.message); }
  }
  for (const t of cfg.tv_teams || []) {
    if (skipClubTv && t.type === "club") continue;
    try {
      const d = await get("eventsnext.php?id=" + t.id);
      for (const e of ((d && d.events) || []).slice(0, 3)) {
        if (!inWin(e) || seen.has("t" + e.idEvent)) continue;
        seen.add("t" + e.idEvent);
        const r = tsdbRow(e, { tv: true }); if (r) rows.push(r);
      }
    } catch (e) { log("thesportsdb tv", t.id, e.message); }
  }
  // league days (free key: max 3 rows per call, so a busy day is incomplete — premium key fixes that)
  for (const lg of cfg.leagues || []) {
    for (let i = 0; i < (+cfg.league_days || 7); i++) {
      const day = localDate(now + i * 864e5);
      try { const d = await get("eventsday.php?d=" + day + "&l=" + lg.id); for (const e of (d && d.events) || []) await local(e, lg.name); }
      catch (e) { log("thesportsdb league", lg.id, day, e.message); if (/429/.test(e.message)) return rows; }
    }
  }
  log("thesportsdb", rows.length, key === "123" ? "(free key)" : "(premium key)");
  return rows;
}

/* ---------- 3. football-data.org ---------- */
export function fdRows(json, cfg) {
  const big = new RegExp(cfg.big || "(Liverpool|Arsenal|Manchester|Chelsea|Tottenham|Newcastle|Real Madrid|Barcelona|Bayern|Juventus|Milan|Inter|Paris|Dortmund)", "i");
  const all = new Set(cfg.all_matches || ["WC", "EC"]);
  const LG = { PL: "Premier League", CL: "Champions League", WC: "VM", EC: "EM", PD: "La Liga", SA: "Serie A", BL1: "Bundesliga" };
  const out = [];
  for (const m of (json && json.matches) || []) {
    if (!/SCHEDULED|TIMED|IN_PLAY|PAUSED/.test(m.status || "")) continue;
    const c = (m.competition && m.competition.code) || "", h = (m.homeTeam && (m.homeTeam.shortName || m.homeTeam.name)) || "", a = (m.awayTeam && (m.awayTeam.shortName || m.awayTeam.name)) || "";
    if (!h || !a) continue;
    if (!all.has(c) && !big.test(h + " " + a) && !/Sweden|Sverige/i.test(h + " " + a)) continue;
    const ts = Date.parse(m.utcDate); if (!isFinite(ts)) continue;
    out.push({ source: "tv", source_id: "tv:fd:" + m.id, title: cut(h + " – " + a, 80), starts_at: new Date(ts).toISOString(), ends_at: new Date(ts + 120 * 60e3).toISOString(),
      url: null, place: null, lat: null, lng: null, sport: "fotboll", league: LG[c] || cut(m.competition && m.competition.name, 40), home: cut(h, 60), away: cut(a, 60), kind: "sport", tv: true });
  }
  return out;
}
async function footballData(cfg, log, now) {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) { log("football-data skipped (no FOOTBALL_DATA_KEY)"); return null; }
  const u = new URL("https://api.football-data.org/v4/matches");
  u.searchParams.set("competitions", (cfg.competitions || ["PL", "CL", "WC", "EC"]).join(","));
  u.searchParams.set("dateFrom", localDate(now)); u.searchParams.set("dateTo", localDate(now + 9 * 864e5));   // max 10 days per call
  try {
    const r = await fetch(u, { headers: { "X-Auth-Token": key, "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) { log("football-data", r.status, (await r.text()).slice(0, 120)); return null; }
    const rows = fdRows(await r.json(), cfg);
    log("football-data", rows.length);
    return rows;
  } catch (e) { log("football-data", String(e.message || e)); return null; }
}

/* ---------- 4. manual TV entries ---------- */
export function manualRows(list, now) {
  const out = [];
  for (const m of list || []) {
    const ts = Date.parse(m.starts_at || "");
    if (!m.title || !isFinite(ts) || ts < now - 6 * 3600e3 || ts > now + 30 * 864e5) continue;
    out.push({ source: "tv", source_id: "tv:man:" + (m.id || norm(m.title).replace(/ /g, "-") + ":" + m.starts_at.slice(0, 10)), title: cut(m.title, 80),
      starts_at: new Date(ts).toISOString(), ends_at: new Date(ts + (+m.hours || 2.5) * 3600e3).toISOString(), url: m.url || null, place: null, lat: null, lng: null,
      sport: m.sport === "hockey" ? "hockey" : "fotboll", league: cut(m.league, 40), home: cut(m.home, 60), away: cut(m.away, 60), kind: "sport", tv: true });
  }
  return out;
}

/* ---------- 🎟️ tickets (scripts/sport-tickets.json: one verified link per home club) ---------- */
export function clubTicket(tickets, row) {
  const list = tickets && tickets[row.sport]; if (!list || !row.home) return null;
  const hit = list[row.home] || Object.entries(list).find(([k]) => norm(k) === norm(row.home))?.[1];
  return hit && /^https:\/\//.test(hit.url || "") ? hit.url : null;
}

/* ---------- all ---------- */
export async function sportRows({ towns, log, now, tickster }) {
  now = now || Date.now();
  const cfg = JSON.parse(await readFile(resolve(here, "sport-feeds.json"), "utf8").catch(() => "{}"));
  const venues = JSON.parse(await readFile(resolve(here, "sport-venues.json"), "utf8").catch(() => "{}"));
  const place = placer(venues, towns && towns.length ? towns : cfg.fallback_towns || []);
  const rows = [];
  if (cfg.swehockey && cfg.swehockey.on !== false) rows.push(...await swehockey(cfg.swehockey, place, log, now));
  const fd = cfg.football_data && cfg.football_data.on !== false ? await footballData(cfg.football_data, log, now) : null;
  if (fd) rows.push(...fd);
  if (cfg.thesportsdb && cfg.thesportsdb.on !== false) rows.push(...await thesportsdb(cfg.thesportsdb, place, log, now, !!fd));
  rows.push(...manualRows(cfg.tv_manual, now));
  // Local games only near a town the app knows (40 km); TV rows always.
  const near = towns && towns.length ? rows.filter((r) => r.tv || towns.some((t) => km(t, r) <= (+cfg.town_km || 40))) : rows;
  const seen = new Set();
  const out = near.filter((r) => (seen.has(r.source_id) ? false : seen.add(r.source_id)));
  // 🎟️ local matches: the exact Tickster match first, else the home club's ticket page. TV rows never get one.
  const tickets = JSON.parse(await readFile(resolve(here, "sport-tickets.json"), "utf8").catch(() => "{}"));
  let nt = 0, nx = 0;
  for (const r of out) {
    if (r.tv) continue;
    const exact = ticketFor(r, tickster), t = exact || clubTicket(tickets, r);
    if (t) { r.ticket_url = t; nt++; if (exact) nx++; }
  }
  log("sport tickets:", nt, "matches (" + nx + " exact Tickster links)");
  log("sport rows:", out.length, "(local", out.filter((r) => !r.tv).length + ", tv " + out.filter((r) => r.tv).length + ")");
  return out;
}
