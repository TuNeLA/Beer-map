// Minimal OpenStreetMap opening_hours parser for the common forms (no dependency).
// Why not npm "opening_hours": it is LGPL-3.0 and ~300 kB with its holiday data; the app needs only a weekly table.
// parseOH(text, now) → { w: [Mo..Su] each [[startMin, endMin], …] (endMin may pass 1440 = after midnight), a: 1 for 24/7 }
// or null when nothing usable was found. Handled: "24/7"; "Mo-Fr 10:00-19:00; Sa 10:00-15:00; Su off"; day lists
// "Mo,We,Fr-Su"; wrap ranges "Fr-Mo"; times without days (every day); "18:00-02:00" (over midnight); "24:00"; "10-19";
// several times "11:00-14:00,17:00-23:00"; "off" / "closed"; later rules replace earlier ones for their days (OSM rule);
// ", Mo 12:00-14:00" additional rules; month selectors ("Jun-Aug …", "May-Sep: …") are kept only when `now` is in them,
// so a weekly build picks the season. Ignored: PH / SH rules, "||" fallbacks, comments, open ends "18:00+", sunrise.
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayList(sel) {
  const out = new Set();
  for (const part of sel.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su))?(?:\[[^\]]*\])?$/);
    if (!m) return null;
    const a = DAYS.indexOf(m[1]), b = m[2] ? DAYS.indexOf(m[2]) : a;
    for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; }
  }
  return out.size ? [...out] : null;
}
function minutes(s) {
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!m) return null;
  const h = +m[1], mi = m[2] ? +m[2] : 0;
  if (h > 48 || mi > 59) return null;
  return h * 60 + mi;
}
function timeList(sel) {
  const out = [];
  for (const part of sel.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d{1,2}(?:[:.]\d{2})?)\s*-\s*(\d{1,2}(?:[:.]\d{2})?)$/);
    if (!m) return null;
    const a = minutes(m[1]); let b = minutes(m[2]);
    if (a == null || b == null) return null;
    if (b <= a) b += 1440;
    if (a >= 1440 || b - a > 1440) return null;
    out.push([a, b]);
  }
  return out.length ? out : null;
}
function monthOk(sel, now) {
  // "Jun-Aug", "May-Sep", "Dec,Jan", "Jun 15-Aug 20" (day parts ignored: month level only)
  const mo = now.getUTCMonth();
  for (const part of sel.split(",")) {
    const m = part.trim().match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+\d{1,2})?(?:\s*-\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?(?:\s*\d{1,2})?)?$/);
    if (!m) return null;
    const a = MONTHS.indexOf(m[1]), b = m[2] ? MONTHS.indexOf(m[2]) : a;
    for (let i = a; ; i = (i + 1) % 12) { if (i === mo) return true; if (i === b) break; }
  }
  return false;
}

export function parseOH(text, now = new Date()) {
  if (!text || typeof text !== "string") return null;
  let s = text.trim().split("||")[0].replace(/"[^"]*"/g, "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/^24\/7(\s*;?\s*(PH|SH)?\s*(off|closed)?)?$/i.test(s) || /^(Mo-Su|Mo-So)\s+00:00-24:00$/.test(s)) {
    return { a: 1, w: DAYS.map(() => [[0, 1440]]) };
  }
  s = s.replace(/,\s+(?=(Mo|Tu|We|Th|Fr|Sa|Su)\b)/g, "; ");   // additional rule → own rule (fine for different days)
  const w = DAYS.map(() => null);
  let used = false;
  for (let rule of s.split(";")) {
    rule = rule.trim();
    if (!rule) continue;
    // month selector at the start ("Jun-Aug Mo-Su 11:00-23:00" / "May-Sep: …")
    const mm = rule.match(/^((?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[^A-Za-z:]*?)+(?:-\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s*\d{1,2})?)?)\s*:?\s+(.*)$/);
    if (mm) {
      const ok = monthOk(mm[1].trim().replace(/:$/, ""), now);
      if (!ok) continue;
      rule = mm[2].trim();
    }
    rule = rule.replace(/^:\s*/, "");
    // drop holiday tokens inside a day list ("Mo-Fr,PH 10:00-…" → "Mo-Fr …"); a rule only for PH / SH is skipped
    rule = rule.replace(/,(PH|SH)\b/g, "").replace(/\b(PH|SH),/g, "");
    if (/^(PH|SH)\b/.test(rule)) continue;
    let days = [0, 1, 2, 3, 4, 5, 6], rest = rule;
    const dm = rule.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)[A-Za-z0-9,\-\[\] ]*?)(?:\s+(.*))?$/);
    if (dm && /^(Mo|Tu|We|Th|Fr|Sa|Su)/.test(rule)) {
      const dl = dayList(dm[1].replace(/\s+/g, ""));
      if (!dl) continue;
      days = dl; rest = (dm[2] || "").trim();
    }
    rest = rest.replace(/^:\s*/, "");
    let iv;
    if (/^(off|closed)$/i.test(rest)) iv = [];
    else if (/^open$/i.test(rest) || rest === "") continue;   // no times: unknown
    else { iv = timeList(rest.replace(/\s*,\s*/g, ",")); if (!iv) continue; }
    for (const d of days) w[d] = iv;
    used = true;
  }
  if (!used) return null;
  return { w: w.map((x) => x || []) };
}

// Compact form for the json files: one string per day "600-1140" / "660-840,1020-1380" / "" (closed).
export function packW(w) { return w.map((d) => d.map((x) => x[0] + "-" + x[1]).join(",")); }
export function lateClose(w) {
  // latest closing minute over the week (≥ 1440 = after midnight)
  let m = 0; for (const d of w) for (const x of d) m = Math.max(m, x[1]); return m;
}
