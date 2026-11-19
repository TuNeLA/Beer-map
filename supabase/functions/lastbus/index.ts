// PintsNow edge function `lastbus` (lane places, E3; data-sources.md Top 10 no. 1). JWT check ON (deploy default).
// POST /functions/v1/lastbus  body {from: {lat, lng}, to: {lat, lng}}  →  {ok, next, last, gone} or {ok: false, code}.
// "Sista bussen hem": the next trip and the LAST trip of the night (arrives before 03:00) from where I am to my home zone,
// from Trafiklab ResRobot v2.1 (route planner, all Swedish public transport, CC0). The answer is computed in plan.mjs.
// The key: Supabase secret TRAFIKLAB_KEY, read at run time. Never in a file, a log or an answer. No key = {ok:false,
// code:"no_key"} and the app hides the card (js/lastbus.js). Owner steps: lane places DONE.md.
// Privacy: the app sends both points ROUNDED to 0.005° (≈ 550 m); this function rounds again and stores nothing (only an
// in-memory cache per rounded pair for 5 min, and a per-user rate limit). No log line holds a position, a user id or the key.
// Limits: Bronze key = 45 calls a minute, 30 000 a month. One open = 2 calls (next + last), cached 5 min per pair.
// Signed-in users only (role "authenticated" in the JWT that the platform has checked): 12 lookups per user per 10 min.
import { roundPt, urls, answer } from "./plan.mjs";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const cache = new Map<string, { at: number; v: unknown }>();
const hits = new Map<string, number[]>();
const CACHE_MS = 5 * 60e3, WIN_MS = 10 * 60e3, PER_USER = 12;

function claims(req: Request): { sub?: string; role?: string } {
  try {
    const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").split(".")[1] || "";
    return JSON.parse(atob(t.replace(/-/g, "+").replace(/_/g, "/")));
  } catch (_e) { return {}; }
}
function limited(uid: string): boolean {
  const now = Date.now(), list = (hits.get(uid) || []).filter((t) => now - t < WIN_MS);
  if (hits.size > 5000) hits.clear();
  list.push(now); hits.set(uid, list);
  return list.length > PER_USER;
}
async function get(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("resrobot " + r.status);
  return await r.json();
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return out({ ok: false, code: "method" }, 405);
  const c = claims(req);
  if (c.role !== "authenticated" || !c.sub) return out({ ok: false, code: "not_authenticated" }, 401);
  const key = Deno.env.get("TRAFIKLAB_KEY") || "";
  if (!key) return out({ ok: false, code: "no_key" });
  let body: { from?: unknown; to?: unknown } = {};
  try { body = await req.json(); } catch (_e) { return out({ ok: false, code: "bad_body" }, 400); }
  const from = roundPt(body.from), to = roundPt(body.to);
  if (!from || !to) return out({ ok: false, code: "bad_point" }, 400);
  if (from.lat === to.lat && from.lng === to.lng) return out({ ok: true, next: null, last: null, gone: false, home: true });
  const k = from.lat + "," + from.lng + ">" + to.lat + "," + to.lng, hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return out(hit.v);
  if (limited(c.sub)) return out({ ok: false, code: "slow_down" }, 429);
  try {
    const [u1, u2] = urls(key, from, to, Date.now());
    const [a, b] = await Promise.all([get(u1), get(u2)]);
    const v = { ...answer(a, b, Date.now()), src: "Trafiklab" };
    if (cache.size > 2000) cache.clear();
    cache.set(k, { at: Date.now(), v });
    return out(v);
  } catch (e) {
    console.log("lastbus: upstream failed", String((e as Error)?.message || e).replace(/accessId=[^&\s]+/g, "accessId=***").slice(0, 80));
    return out({ ok: false, code: "upstream" }, 502);
  }
});
