// pn-broadcast — owner news push to every phone with push on (owner 13 Nov 2026 17:06: "the app is updated").
// POST { title, body, url?, tag?, go? }  with header x-pn-key = a key whose sha256 is in ops.bcast_keys (checked by the
// service-only SQL function olnu_bcast_key_ok; the app and anon cannot read or call it).
// go !== true = dry run: answers the number of phones, sends nothing. One push per phone (same endpoint = one phone).
// No user data in the push, no names. Dead subscriptions (404/410) are only counted here (notify-group cleans them up).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "not_configured" }, 500);
  }
  let p: { title?: string; body?: string; url?: string; tag?: string; go?: boolean } = {};
  try { p = await req.json(); } catch (_e) { return json({ error: "bad_json" }, 400); }
  const title = String(p.title ?? "").trim().slice(0, 80);
  const body = String(p.body ?? "").trim().slice(0, 200);
  if (title.length < 2) return json({ error: "no_title" }, 400);
  const url = /^\/[^\s]{0,120}$/.test(String(p.url ?? "")) ? String(p.url) : "/";
  const tag = String(p.tag ?? "pn-news").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "pn-news";

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const k = await admin.rpc("olnu_bcast_key_ok", { p_key: req.headers.get("x-pn-key") ?? "" });
  if (k.error || k.data !== true) return json({ error: "forbidden" }, 403);
  const { data, error } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").limit(5000);
  if (error) return json({ error: "read_failed" }, 500);
  const seen = new Set<string>();
  const subs = (data ?? []).filter((s) => s.endpoint && s.p256dh && s.auth && !seen.has(s.endpoint) && seen.add(s.endpoint));
  if (p.go !== true) return json({ dry: true, phones: subs.length, title, body, url, tag });

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const payload = JSON.stringify({ title, body, url, tag, k: "news", v: "news.1", ts: Date.now() });
  let sent = 0, dead = 0, failed = 0;
  for (let i = 0; i < subs.length; i += 50) {   // 50 at a time
    const part = subs.slice(i, i + 50);
    const res = await Promise.allSettled(part.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: "normal" })
    ));
    res.forEach((r) => {
      if (r.status === "fulfilled") sent++;
      else {
        const code = (r.reason as { statusCode?: number } | undefined)?.statusCode;
        if (code === 404 || code === 410) dead++; else failed++;
      }
    });
  }
  return json({ dry: false, phones: subs.length, sent, dead, failed });
});
