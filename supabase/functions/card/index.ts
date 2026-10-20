// Öl Nu edge function `card` (verify_jwt = false, read-only). CONTRACT "v26 LÄNKKORT".
// GET /functions/v1/card?t=<kind>&id=<id>[&l=en]        -> link preview page (crawlers) or 302 to the app (people)
// GET /functions/v1/card?t=<kind>&id=<id>[&l=en]&img=1  -> 1200x630 PNG (og:image), black/yellow tabloid style
// Kinds: invite (no id) | join (group code) | duelinv (duel token) | group | rally | duel | paper (share token
// from share_card()). Data comes ONLY from card_public() (migration 0060): group name, counts, bar name and the
// rally sender's first name. Nothing is written except the hit counter and the rate-limit buckets.
//
// Why people get a 302 and crawlers get HTML: Supabase rewrites text/html from *.supabase.co to text/plain
// (HTML needs a custom domain), so a person must never see this page. Crawlers (WhatsApp, Messenger,
// iMessage, Telegram, Slack, Discord, X ...) read the og: tags. The page also has meta refresh + JS as a backup.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (set by the platform), OLNU_APP_URL (optional secret, the app
// link; set it when the app moves to its own domain, no redeploy needed).
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import { cardSvg } from "./svg.ts";
import { buildCard } from "./copy.ts";

const SB_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APP = ((Deno.env.get("OLNU_APP_URL") || "https://tunela.github.io/Beer-map/docs/").replace(/\/*$/, "/"));
const SELF = SB_URL + "/functions/v1/card";
const STATIC_IMG = APP + "og-image.png";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm";
// Fonts (SIL OFL) from pinned npm packages on jsDelivr; loaded once per instance. widths.ts was measured on these files.
const FONT_URLS = [
  "https://cdn.jsdelivr.net/npm/@expo-google-fonts/black-ops-one@0.4.1/400Regular/BlackOpsOne_400Regular.ttf",
  "https://cdn.jsdelivr.net/npm/@expo-google-fonts/chakra-petch@0.4.1/700Bold/ChakraPetch_700Bold.ttf",
];
const KINDS = new Set(["invite", "join", "duelinv", "group", "rally", "duel", "paper"]);
const BOT = /bot|crawl|spider|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|twitter|linkedin|skype|snapchat|pinterest|vkshare|embedly|quora|outbrain|redditbot|applebot|bingpreview|google|yandex|preview|metainspector|iframely|mastodon|signal|viber|line\//i;

// ---- per-instance limits and caches (the database has the real per-IP + global limit) ----
const hits = new Map<string, { m: number; n: number }>();
function limited(ip: string): boolean {
  const m = Math.floor(Date.now() / 60000);
  if (hits.size > 5000) hits.clear();
  const h = hits.get(ip);
  if (!h || h.m !== m) { hits.set(ip, { m, n: 1 }); return false; }
  h.n++; return h.n > 120;
}
// deno-lint-ignore no-explicit-any
const dataCache = new Map<string, { at: number; d: any }>();
const pngCache = new Map<string, Uint8Array>();
function remember<T>(map: Map<string, T>, k: string, v: T, max: number) {
  if (map.size >= max) { const first = map.keys().next().value; if (first !== undefined) map.delete(first); }
  map.set(k, v);
}

// deno-lint-ignore no-explicit-any
async function cardData(kind: string, id: string, ip: string): Promise<any> {
  const key = kind + "|" + id;
  const c = dataCache.get(key);
  if (c && Date.now() - c.at < 60000) return c.d;
  const res = await fetch(SB_URL + "/rest/v1/rpc/card_public", {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_kind: kind, p_id: id || null, p_ip: ip }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error("rpc " + res.status);
  const d = await res.json();
  if (d && d.why !== "limited") remember(dataCache, key, { at: Date.now(), d }, 300);
  return d;
}

let fonts: Uint8Array[] | null = null;
let assets: Promise<void> | null = null;
function ready(): Promise<void> {
  if (!assets) {
    assets = Promise.all([
      initWasm(fetch(WASM_URL)),
      Promise.all(FONT_URLS.map((u) => fetch(u, { signal: AbortSignal.timeout(5000) }).then((r) => {
        if (!r.ok) throw new Error("font " + r.status);
        return r.arrayBuffer();
      }).then((b) => new Uint8Array(b)))).then((f) => { fonts = f; }),
    ]).then(() => {}).catch((e) => { assets = null; throw e; });
  }
  return assets;
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function page(title: string, desc: string, img: string, self: string, to: string, en: boolean): string {
  const t = esc(title), d = esc(desc), i = esc(img), u = esc(self), go = esc(to);
  return `<!doctype html><html lang="${en ? "en" : "sv"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t}</title>
<meta name="description" content="${d}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Öl Nu">
<meta property="og:locale" content="${en ? "en_GB" : "sv_SE"}">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${u}">
<meta property="og:image" content="${i}">
<meta property="og:image:secure_url" content="${i}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${t}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${i}">
<meta name="theme-color" content="#0a0f1c">
<meta http-equiv="refresh" content="0; url=${go}">
<link rel="canonical" href="${u}">
</head><body style="background:#0a0f1c;color:#ffd60a;font-family:sans-serif">
<p><a href="${go}" style="color:#ffd60a">${t}</a></p>
<script>location.replace(${JSON.stringify(to).replace(/</g, "\\u003c")});</script>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("method", { status: 405 });
  const url = new URL(req.url);
  const kind = (url.searchParams.get("t") || "invite").toLowerCase();
  const id = (url.searchParams.get("id") || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase();
  const en = url.searchParams.get("l") === "en";
  const wantImg = url.searchParams.get("img") === "1";
  const ua = req.headers.get("user-agent") || "";
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "-";
  const k = KINDS.has(kind) ? kind : "invite";
  const qs = "t=" + k + (id ? "&id=" + id : "") + (en ? "&l=en" : "");
  const self = SELF + "?" + qs;

  // A person (not a crawler) asking for the page: straight to the app, no data lookup needed for most kinds.
  const isBot = BOT.test(ua) || !ua;
  // deno-lint-ignore no-explicit-any
  let d: any = { ok: false };
  if (!limited(ip)) {
    try { d = await cardData(k, id, ip); } catch (e) { console.error("card data", String(e)); d = { ok: false, why: "error" }; }
  } else d = { ok: false, why: "limited" };
  const card = buildCard(d, en, k + id);
  const go = card.go && /^[a-z]+=[A-Za-z0-9-]{1,40}$/.test(card.go) ? card.go : "";
  const to = APP + (go ? "?" + go : "");

  if (wantImg) {
    const ckey = qs + "|" + card.title + "|" + card.desc;
    let png = pngCache.get(ckey);
    if (!png) {
      try {
        await ready();
        png = new Resvg(cardSvg(card.spec), {
          font: { fontBuffers: fonts!, loadSystemFonts: false, defaultFontFamily: "Chakra Petch" },
          fitTo: { mode: "original" },
        }).render().asPng();
        remember(pngCache, ckey, png, 40);
      } catch (e) {
        console.error("card png", String(e));
        return new Response(null, { status: 302, headers: { Location: STATIC_IMG, "Cache-Control": "public, max-age=60" } });
      }
    }
    return new Response(req.method === "HEAD" ? null : png, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=600", "Content-Length": String(png.length) },
    });
  }
  if (!isBot) {
    return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
  const img = self + "&img=1&v=" + (card.title.length + card.desc.length).toString(36) + (d && d.ok ? (Number(d.out ?? d.yes ?? d.us ?? 0) % 97).toString(36) : "x");
  const html = page(card.title, card.desc, img, self, to, en);
  return new Response(req.method === "HEAD" ? null : html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120", "X-Robots-Tag": "noindex" },
  });
});
