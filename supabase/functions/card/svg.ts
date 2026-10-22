// Öl Nu link card image: 1200x630 SVG in the app's black/yellow tabloid style (Morgontidningen look).
// Pure string building (no DOM). The function renders it to PNG with resvg-wasm and the two embedded fonts.
// Text width is estimated from measured advance widths (widths.ts), so long group names shrink or wrap.
import { W } from "./widths.ts";

export const CARD_W = 1200, CARD_H = 630;
const YEL = "#ffd60a", INK = "#111111", RED = "#d62828", NIGHT = "#0a0f1c";
const DISP = "Black Ops One", BODY = "Chakra Petch";

export function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] as string));
}
// Drop emoji and other glyphs the fonts do not have (card text keeps Latin-1 + dashes/quotes).
export function plain(s: string): string {
  return String(s || "").replace(/[^\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2018-\u201e\u2026]/g, "").replace(/\s+/g, " ").trim();
}
function width(text: string, font: "d" | "b", size: number): number {
  const t = W[font]; let sum = 0;
  for (const ch of text) sum += t[ch] ?? t._avg;
  return sum / 1000 * size;
}
// Largest size in [min, max] that fits maxW; null when even min does not fit.
function fit(text: string, font: "d" | "b", maxW: number, max: number, min: number): number | null {
  for (let s = max; s >= min; s -= 2) if (width(text, font, s) <= maxW) return s;
  return null;
}
function cut(text: string, font: "d" | "b", size: number, maxW: number): string {
  if (width(text, font, size) <= maxW) return text;
  let t = text;
  while (t.length > 1 && width(t + "…", font, size) > maxW) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}
// Headline in 1 or 2 lines: returns {lines, size}.
function headline(text: string, maxW: number, max: number, min: number): { lines: string[]; size: number } {
  const one = fit(text, "d", maxW, max, min);
  if (one) return { lines: [text], size: one };
  const words = text.split(" ");
  if (words.length > 1) {
    let best: string[] | null = null, bestW = Infinity;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
      const w = Math.max(width(a, "d", 100), width(b, "d", 100));
      if (w < bestW) { bestW = w; best = [a, b]; }
    }
    if (best) {
      const s = Math.max(min, Math.min(max * 0.8, Math.floor(maxW / (bestW / 100))));
      return { lines: best.map((l) => cut(l, "d", s, maxW)), size: s };
    }
  }
  return { lines: [cut(text, "d", min, maxW)], size: min };
}

function stripes(y: number, h: number): string {
  let s = `<rect x="0" y="${y}" width="${CARD_W}" height="${h}" fill="${YEL}"/><g fill="${INK}">`;
  for (let x = -h; x < CARD_W + h; x += 2 * h) s += `<polygon points="${x},${y + h} ${x + h},${y} ${x + 2 * h},${y} ${x + h},${y + h}"/>`;
  return s + "</g>";
}
// A small beer mug, drawn (no emoji font in the renderer).
function mug(x: number, y: number, s: number, fill: string): string {
  const k = s / 100;
  return `<g transform="translate(${x},${y}) scale(${k})" fill="${fill}">` +
    `<rect x="8" y="22" width="58" height="74" rx="6"/>` +
    `<path d="M66 36 h14 a12 12 0 0 1 12 12 v22 a12 12 0 0 1 -12 12 h-14 v-10 h12 a4 4 0 0 0 4 -4 v-18 a4 4 0 0 0 -4 -4 h-12z"/>` +
    `<circle cx="16" cy="18" r="12"/><circle cx="36" cy="12" r="14"/><circle cx="56" cy="18" r="12"/>` +
    `<rect x="20" y="40" width="7" height="44" rx="3" fill="${INK}" opacity=".35"/><rect x="40" y="40" width="7" height="44" rx="3" fill="${INK}" opacity=".35"/>` +
    `</g>`;
}

export interface CardSpec {
  kicker: string;          // red box top right, e.g. "INKALLELSE"
  head: string;            // big headline (group name, bar name)
  sub?: string;            // line under the headline, e.g. "3 UTE NU"
  note?: string;           // small line under sub
  foot: string;            // bottom band text
  duel?: { a: string; b: string; sa: number; sb: number; tag: string };
  faces?: string[];        // v4: up to 4 initials drawn as round "avatars" on the right
}

export function cardSvg(c: CardSpec): string {
  const kick = plain(c.kicker).toLocaleUpperCase("sv-SE");
  const foot = plain(c.foot);
  let body = "";
  if (c.duel) {
    const a = plain(c.duel.a).toLocaleUpperCase("sv-SE") || "?", b = plain(c.duel.b).toLocaleUpperCase("sv-SE") || "?";
    const score = `${c.duel.sa}–${c.duel.sb}`;
    const ss = fit(score, "d", 700, 220, 120) || 120;
    body += `<text x="600" y="${(262 + ss * 0.74).toFixed(0)}" text-anchor="middle" font-family="${DISP}" font-size="${ss}" fill="${INK}">${esc(score)}</text>`;
    const ns = Math.min(fit(a, "d", 460, 70, 30) || 30, fit(b, "d", 460, 70, 30) || 30);
    body += `<text x="60" y="210" font-family="${DISP}" font-size="${ns}" fill="${INK}">${esc(cut(a, "d", ns, 460))}</text>`;
    body += `<text x="1140" y="210" text-anchor="end" font-family="${DISP}" font-size="${ns}" fill="${INK}">${esc(cut(b, "d", ns, 460))}</text>`;
    body += `<text x="600" y="210" text-anchor="middle" font-family="${BODY}" font-weight="700" font-size="40" fill="${RED}">MOT</text>`;
    const tag = plain(c.duel.tag).toLocaleUpperCase("sv-SE");
    if (tag) {
      const ts = fit(tag, "b", 1000, 50, 28) || 28;
      body += `<text x="600" y="520" text-anchor="middle" font-family="${BODY}" font-weight="700" font-size="${ts}" fill="${INK}">${esc(cut(tag, "b", ts, 1080))}</text>`;
    }
  } else {
    const head = plain(c.head).toLocaleUpperCase("sv-SE") || "ÖL NU";
    const fc = (c.faces || []).map((x) => plain(String(x || "")).slice(0, 1).toLocaleUpperCase("sv-SE")).filter(Boolean).slice(0, 4);
    const W0 = fc.length ? 800 : 1100;
    const h = headline(head, W0, 168, 64);
    const lh = h.size * 0.98;
    const sub = plain(c.sub || "").toLocaleUpperCase("sv-SE");
    const note = plain(c.note || "");
    const subS = sub ? (fit(sub, "b", W0 - 40, 76, 36) || 36) : 0;
    const noteS = note ? 34 : 0;
    const blockH = h.lines.length * lh + (sub ? subS * 1.25 : 0) + (note ? noteS * 1.4 : 0);
    let y = 150 + Math.max(10, (370 - blockH) / 2) + h.size * 0.8;
    for (const line of h.lines) {
      body += `<text x="48" y="${y.toFixed(0)}" font-family="${DISP}" font-size="${h.size}" fill="${INK}">${esc(line)}</text>`;
      y += lh;
    }
    if (sub) {
      y += subS * 0.25 - lh + h.size * 0.2 + subS;
      const sw = Math.min(W0 + 4, width(sub, "b", subS) + 36);
      body += `<rect x="40" y="${(y - subS * 0.92).toFixed(0)}" width="${sw.toFixed(0)}" height="${(subS * 1.18).toFixed(0)}" fill="${INK}"/>`;
      body += `<text x="58" y="${y.toFixed(0)}" font-family="${BODY}" font-weight="700" font-size="${subS}" fill="${YEL}">${esc(cut(sub, "b", subS, W0 - 30))}</text>`;
    }
    if (note) {
      y += noteS * 1.6;
      body += `<text x="48" y="${y.toFixed(0)}" font-family="${BODY}" font-weight="700" font-size="${noteS}" fill="${INK}">${esc(cut(note, "b", noteS, W0))}</text>`;
    }
    // v4 faces: overlapping circles, right side, vertically centred in the body
    const n = fc.length;
    for (let i = n - 1; i >= 0; i--) {
      const cx = 1120 - (n - 1 - i) * 74, cy = 336;
      body += `<circle cx="${cx}" cy="${cy}" r="48" fill="${INK}" stroke="${YEL}" stroke-width="6"/>`;
      body += `<text x="${cx}" y="${cy + 20}" text-anchor="middle" font-family="${DISP}" font-size="56" fill="${YEL}">${esc(fc[i])}</text>`;
    }
  }
  const kS = fit(kick, "b", 560, 40, 24) || 24;
  const kW = Math.min(600, width(kick, "b", kS) + 44);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">` +
    `<rect width="${CARD_W}" height="${CARD_H}" fill="${YEL}"/>` +
    `<rect width="${CARD_W}" height="118" fill="${INK}"/>` +
    mug(44, 16, 86, YEL) +
    `<text x="150" y="90" font-family="${DISP}" font-size="80" fill="${YEL}">ÖL NU</text>` +
    `<rect x="${(1156 - kW).toFixed(0)}" y="30" width="${kW.toFixed(0)}" height="60" fill="${RED}"/>` +
    `<text x="${(1156 - kW / 2).toFixed(0)}" y="${(60 + kS * 0.36).toFixed(0)}" text-anchor="middle" font-family="${BODY}" font-weight="700" font-size="${kS}" fill="#ffffff">${esc(kick)}</text>` +
    stripes(118, 16) +
    body +
    `<rect y="544" width="${CARD_W}" height="86" fill="${INK}"/>` +
    `<text x="48" y="600" font-family="${BODY}" font-weight="700" font-size="34" fill="${YEL}">${esc(cut(foot, "b", 34, 1000))}</text>` +
    `<circle cx="1140" cy="587" r="14" fill="${RED}"/><text x="1112" y="599" text-anchor="end" font-family="${BODY}" font-weight="700" font-size="32" fill="#ffffff">LIVE</text>` +
    `</svg>`;
}
export { NIGHT };
