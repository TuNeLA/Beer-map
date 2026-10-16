// Öl Nu — notify-group Edge Function.
// Called by the client when post_beer returns a milestone (1, 5 or 10).
// Sends a web push to every user who shares a group with the caller,
// once per level per night (notified_level).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";

let vapidReady = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
  } catch (e) {
    console.error("Invalid VAPID config", e);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    if (!vapidReady || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "server_not_configured" }, 500);
    }

    // 1. Who is calling? Use the forwarded user JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Pass the JWT explicitly: with persistSession=false there is no stored session to read.
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const uid = userData.user.id;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 2. Read caller's current beer to find the target level (1 / 5 / 10).
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: current, error: curErr } = await admin
      .from("beers")
      .select("id, beer_count")
      .eq("user_id", uid)
      .maybeSingle();
    if (curErr) throw curErr;
    if (!current) return json({ sent: 0, failed: 0 });
    const count = current.beer_count as number;
    // v5: a row with only shots (beer_count 0) is not a beer milestone.
    if (!(count >= 1)) return json({ sent: 0, failed: 0 });
    const level = count >= 10 ? 10 : count >= 5 ? 5 : 1;

    // Atomic claim: raise notified_level to the target once. A concurrent call
    // (or a retry) finds notified_level already >= target and claims nothing.
    const { data: claimed, error: claimErr } = await admin
      .from("beers")
      .update({ notified_level: level })
      .eq("user_id", uid)
      .lt("notified_level", level)
      .eq("stopped", false)
      .gt("updated_at", since)
      .gt("expires_at", new Date().toISOString())
      .select("id, beer_count");
    if (claimErr) throw claimErr;
    if (!claimed || claimed.length === 0) return json({ sent: 0, failed: 0 });
    const beerId = claimed[0].id as number;
    const payloadFor = (name: string) => {
      if (level === 10) {
        return { title: `🚁 MEDEVAC: ${name}`, body: "Öl nr 10. Vi behöver medevac!" };
      }
      if (level === 5) {
        return { title: `🔥 ${name} är på HOT STREAK`, body: "Öl nr 5 ikväll. Någon kör hårt!" };
      }
      return { title: `🍺 ${name} är ute på uppdrag`, body: "Första ölen ikväll. Öppna kartan." };
    };
    // Tag uses the beer id (already in the url), not the user id: recipients must not learn user ids.
    const tag = `olnu-${beerId}-${level}`;

    // 3. Caller's groups and display name per group.
    const { data: mine, error: mineErr } = await admin
      .from("group_members")
      .select("group_id, display_name")
      .eq("user_id", uid);
    if (mineErr) throw mineErr;
    if (!mine || mine.length === 0) return json({ sent: 0, failed: 0 });

    const nameByGroup = new Map<string, string>();
    for (const m of mine) nameByGroup.set(m.group_id as string, m.display_name as string);
    const groupIds = [...nameByGroup.keys()];

    // 4. Other members of those groups -> sender name per recipient.
    const { data: others, error: othersErr } = await admin
      .from("group_members")
      .select("group_id, user_id")
      .in("group_id", groupIds)
      .neq("user_id", uid);
    if (othersErr) throw othersErr;

    const senderNameFor = new Map<string, string>();
    for (const o of others ?? []) {
      const rid = o.user_id as string;
      const name = nameByGroup.get(o.group_id as string);
      if (!name) continue;
      // Deterministic pick if they share several groups: smallest name.
      const prev = senderNameFor.get(rid);
      if (prev === undefined || name < prev) senderNameFor.set(rid, name);
    }
    const recipientIds = [...senderNameFor.keys()];
    if (recipientIds.length === 0) return json({ sent: 0, failed: 0 });

    // 5. Push subscriptions of recipients.
    const { data: subs, error: subsErr } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", recipientIds);
    if (subsErr) throw subsErr;
    if (!subs || subs.length === 0) return json({ sent: 0, failed: 0 });

    // 6. Send in parallel.
    const results = await Promise.allSettled(
      subs.map((s) => {
        const name = senderNameFor.get(s.user_id as string) ?? "En vän";
        const payload = JSON.stringify({
          ...payloadFor(name),
          url: `/?focus=${beerId}`,
          tag,
        });
        return webpush.sendNotification(
          { endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
          payload,
          { TTL: 3600, urgency: "high" },
        );
      }),
    );

    let sent = 0;
    let failed = 0;
    const deadIds: number[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        sent++;
      } else {
        failed++;
        const code = (r.reason as { statusCode?: number } | undefined)?.statusCode;
        if (code === 404 || code === 410) deadIds.push(subs[i].id as number);
        else console.error("push failed", code, String(r.reason));
      }
    });

    if (deadIds.length > 0) {
      const { error: delErr } = await admin.from("push_subscriptions").delete().in("id", deadIds);
      if (delErr) console.error("failed to delete dead subscriptions", delErr);
    }

    return json({ sent, failed });
  } catch (e) {
    console.error("notify-group error", e);
    return json({ error: "internal_error" }, 500);
  }
});
