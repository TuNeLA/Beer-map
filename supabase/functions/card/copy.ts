// Öl Nu link card texts: card_public() data -> og:title, og:description, image spec, app query.
// Swedish (dalmål light) first, English when the link has &l=en. Only the safe fields from card_public are used.
import type { CardSpec } from "./svg.ts";

export interface Card { title: string; desc: string; spec: CardSpec; go: string; }
// deno-lint-ignore no-explicit-any
type D = Record<string, any>;

function n(x: unknown): number { const v = Number(x); return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0; }
function clip(s: unknown, max: number): string {
  const t = String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}
// Pick one line from a list, stable per link (no flicker between crawler fetches of the same link).
function pick(list: string[], seed: string): string {
  let h = 2166136261; for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return list[(h >>> 0) % list.length];
}
function hm(iso: unknown): string {
  try {
    return new Date(String(iso)).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" });
  } catch { return ""; }
}

const SV = {
  foot: ["Tryck för att öppna · live ölkarta", "Tryck här · ingen inloggning", "Live ölkarta · tryck och häng med"],
  invHead: ["Häng med ikväll", "Ut ikväll?", "Kartan ä tänd"],
  invDesc: "Live ölkarta. {0} ute just nu. Tryck ÖL! och syns för dina kompisar – ingen inloggning.",
  invDesc0: "Live ölkarta. Tryck ÖL! och syns för dina kompisar – ingen inloggning.",
  out: "{0} ute nu", members: "{0} i gruppen", outMembers: "{0} ute nu · {1} i gruppen",
  joinKick: "Inbjudan", joinDesc: ["Du ä inkallad till {0}. Tryck för att gå med i gruppen.", "{0} behöver förstärkning. Tryck för att gå med.", "Kom med i {0} på Öl Nu. Ett tryck, sen ä du med."],
  grpKick: "Läget", grpDesc: ["Gruppchatten för {0}. Tryck för att öppna.", "Läget i {0} just nu. Tryck för att se kartan."],
  rlKick: "Inkallelse", rlTitle: "Inkallelse: {0} – {1} på väg", rlTitleNo: "Inkallelse från {0}", rlTitleGrp: "Inkallelse: {0}",
  rlDesc: "{0} kallar in {1}. {2} kommer, {3} kanske. Tryck för att svara.", rlDescAnon: "{1} kallas in. {2} kommer, {3} kanske. Tryck för att svara.",
  rlOver: "Inkallelsen ä över. Öppna kartan och se var gänget ä.", rlSub: "{0} på väg",
  duKick: "Duell", duTitle: "Duell: {0} {1}–{2} {3}", duLive: "Gruppduell ikväll. Flest drinkar till kl. 05:00 vinner.",
  duWon: "{0} vann duellen mot {1}!", duLost: "{1} vann duellen mot {0}.", duDraw: "Oavgjort mellan {0} och {1}.",
  duPend: "{0} har utmanat {1}. Väntar på svar.", duTagLive: "Pågår till 05:00", duTagDone: "Slutställning",
  diKick: "Utmaning", diTitle: "{0} utmanar er på duell", diDesc: "Vilken grupp dricker mest ikväll? Tryck för att anta. Koden gäller till {0}.",
  diSub: "Utmanar er på duell",
  paKick: "Morgontidningen", paTitle: "Morgontidningen: {0}", paDesc: "{0} ute i natt · {1}. Läs hela tidningen i Öl Nu.",
  paDesc0: "Nattens tidning ä tryckt. Läs den i Öl Nu.", paSub: "{0} ute · {1}",
  goneTitle: "Öl Nu 🍺", goneDesc: "Länken har gått ut. Öppna kartan och se vem som ä ute.", goneHead: "Länken har gått ut",
  evKick: "Inbjudan", evYes: "{0} kommer", evFrom: "{0} bjuder in.", evDesc: "Svara direkt i mobilen – ingen app, ingen inloggning.",
};
const EN: typeof SV = {
  foot: ["Tap to open · live beer map", "Tap here · no login", "Live beer map · tap and join"],
  invHead: ["Join us tonight", "Out tonight?", "The map is lit"],
  invDesc: "Live beer map. {0} out right now. Tap BEER! and your friends see you – no login.",
  invDesc0: "Live beer map. Tap BEER! and your friends see you – no login.",
  out: "{0} out now", members: "{0} in the group", outMembers: "{0} out now · {1} in the group",
  joinKick: "Invite", joinDesc: ["You're called up to {0}. Tap to join the group.", "{0} needs backup. Tap to join.", "Join {0} on Öl Nu. One tap and you're in."],
  grpKick: "Status", grpDesc: ["The group chat for {0}. Tap to open.", "What {0} is up to right now. Tap to see the map."],
  rlKick: "Call-out", rlTitle: "Call-out: {0} – {1} on the way", rlTitleNo: "Call-out from {0}", rlTitleGrp: "Call-out: {0}",
  rlDesc: "{0} calls up {1}. {2} coming, {3} maybe. Tap to answer.", rlDescAnon: "{1} is called up. {2} coming, {3} maybe. Tap to answer.",
  rlOver: "The call-out is over. Open the map and see where the gang is.", rlSub: "{0} on the way",
  duKick: "Duel", duTitle: "Duel: {0} {1}–{2} {3}", duLive: "Group duel tonight. Most drinks by 05:00 wins.",
  duWon: "{0} won the duel against {1}!", duLost: "{1} won the duel against {0}.", duDraw: "Draw between {0} and {1}.",
  duPend: "{0} challenged {1}. Waiting for an answer.", duTagLive: "Live until 05:00", duTagDone: "Final score",
  diKick: "Challenge", diTitle: "{0} challenges you to a duel", diDesc: "Which group drinks the most tonight? Tap to accept. The code works until {0}.",
  diSub: "Challenges you to a duel",
  paKick: "Morning paper", paTitle: "Morning paper: {0}", paDesc: "{0} out last night · {1}. Read the whole paper in Öl Nu.",
  paDesc0: "Last night's paper is out. Read it in Öl Nu.", paSub: "{0} out · {1}",
  goneTitle: "Öl Nu 🍺", goneDesc: "This link has expired. Open the map and see who is out.", goneHead: "Link expired",
  evKick: "Invite", evYes: "{0} going", evFrom: "{0} invites you.", evDesc: "Answer right on your phone – no app, no login.",
};
// "tors 22/10 20:00" / "ikväll 20:00" in Stockholm time
function when(iso: unknown, en: boolean): string {
  try {
    const d = new Date(String(iso)); if (isNaN(d.getTime())) return "";
    const tz = "Europe/Stockholm";
    const day = (x: Date) => x.toLocaleDateString("sv-SE", { timeZone: tz });
    const t = d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: tz });
    const now = new Date(), tom = new Date(Date.now() + 864e5);
    if (day(d) === day(now)) return (en ? "tonight " : "ikväll ") + t;
    if (day(d) === day(tom)) return (en ? "tomorrow " : "i morgon ") + t;
    const wd = d.toLocaleDateString(en ? "en-GB" : "sv-SE", { weekday: "short", timeZone: tz }).replace(".", "");
    const dm = d.toLocaleDateString("sv-SE", { day: "numeric", month: "numeric", timeZone: tz });
    return wd + " " + dm + " " + t;
  } catch { return ""; }
}
function F(s: string, ...a: unknown[]): string { return s.replace(/\{(\d)\}/g, (_, i) => String(a[+i] ?? "")); }

export function buildCard(d: D, en: boolean, seed: string): Card {
  const T = en ? EN : SV;
  const foot = pick(T.foot, seed);
  const k = d && d.ok ? String(d.kind) : "gone";
  const g = clip(d?.group, 40), opp = clip(d?.opp, 40);
  if (k === "invite") {
    const out = n(d.out), head = pick(T.invHead, seed);
    return { title: "Öl Nu 🍺 " + head, desc: out ? F(T.invDesc, out) : T.invDesc0, go: "invite=1",
      spec: { kicker: en ? "Live beer map" : "Live ölkarta", head, sub: out ? F(T.out, out) : "", foot } };
  }
  if (k === "ev") {
    const title0 = clip(d.title, 60), place = clip(d.place, 40), yes = n(d.yes), who = clip(d.from, 20);
    const t = when(d.starts_at, en);
    const title = title0 + (t ? " · " + t : "") + (yes ? " · " + F(T.evYes, yes) : "");
    const desc = (who ? F(T.evFrom, who) + " " : "") + T.evDesc;
    return { title, desc, go: String(d.go || ""),
      spec: { kicker: T.evKick, head: title0, sub: (yes ? F(T.evYes, yes) + " · " : "") + t, note: place, foot, faces: Array.isArray(d.faces) ? d.faces : [] } };
  }
  if (k === "join" || k === "group") {
    const out = n(d.out), mem = n(d.members);
    const title = g + " · " + (out ? F(T.out, out) : F(T.members, mem));
    const desc = F(pick(k === "join" ? T.joinDesc : T.grpDesc, seed), g) + (out && mem ? " " + F(T.members, mem) + "." : "");
    return { title, desc, go: String(d.go || ""),
      spec: { kicker: k === "join" ? T.joinKick : T.grpKick, head: g, sub: out ? F(T.outMembers, out, mem) : F(T.members, mem), foot, faces: Array.isArray(d.faces) ? d.faces : [] } };
  }
  if (k === "rally") {
    const place = clip(d.place, 40), who = clip(d.sender, 20), yes = n(d.yes), maybe = n(d.maybe);
    const title = place ? F(T.rlTitle, place, yes) : who ? F(T.rlTitleNo, who) : F(T.rlTitleGrp, g);
    const desc = d.live === false ? T.rlOver : who ? F(T.rlDesc, who, g, yes, maybe) : F(T.rlDescAnon, who, g, yes, maybe);
    return { title, desc, go: String(d.go || ""),
      spec: { kicker: T.rlKick, head: place || g, sub: F(T.rlSub, yes), note: who ? (en ? "From " : "Från ") + who + " · " + g : g, foot } };
  }
  if (k === "duel") {
    const us = n(d.us), them = n(d.them);
    const desc = d.status === "done" || d.winner
      ? (d.winner === "us" ? F(T.duWon, g, opp) : d.winner === "them" ? F(T.duLost, g, opp) : F(T.duDraw, g, opp))
      : d.status === "pending" ? F(T.duPend, g, opp) : T.duLive;
    return { title: F(T.duTitle, g, us, them, opp), desc, go: "",
      spec: { kicker: T.duKick, head: g, foot, duel: { a: g, b: opp, sa: us, sb: them, tag: d.status === "done" || d.winner ? T.duTagDone : T.duTagLive } } };
  }
  if (k === "duelinv") {
    return { title: "⚔️ " + F(T.diTitle, g), desc: F(T.diDesc, hm(d.expires_at)), go: String(d.go || ""),
      spec: { kicker: T.diKick, head: g, sub: T.diSub, note: F(T.members, n(d.members)), foot } };
  }
  if (k === "paper") {
    const people = n(d.people), drinks = n(d.drinks);
    const dw = drinks + " " + (en ? (drinks === 1 ? "drink" : "drinks") : (drinks === 1 ? "drink" : "drinkar"));
    return { title: "📰 " + F(T.paTitle, g), desc: people ? F(T.paDesc, people, dw) : T.paDesc0, go: "",
      spec: { kicker: T.paKick, head: g, sub: people ? F(T.paSub, people, dw) : "", foot } };
  }
  return { title: T.goneTitle, desc: T.goneDesc, go: "", spec: { kicker: en ? "Live beer map" : "Live ölkarta", head: T.goneHead, foot } };
}
