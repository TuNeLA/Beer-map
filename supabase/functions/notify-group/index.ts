// Öl Nu — notify-group Edge Function.
// The client calls it (fire-and-forget) after an accepted beer. Old clients call it only after a
// milestone beer (1, 5 or 10); new clients call it after EVERY accepted beer. One call does two jobs:
//  A) FRIENDS: when the caller's beer hit a milestone, push to everyone who shares a group with
//     the caller, once per level per night (atomic notified_level claim).
//  B) KAOS I STAN: when the area around the caller's beer is wild (>= 10 live beers or >= 3 on
//     HOT STREAK within 5 km), push to subscribers whose saved area is within 10 km, at most once
//     per subscriber per night (push_sent). Anonymous counts only: no names, no exact places.
//  C) LEVEL-UP (v7): when the caller's lifetime beers reach a new title, push to group-mates once
//     per title ever.
// v17: "beers" above = all drinks (beer_count + other_count); week_beers counts other drinks too.
//     Clients also call it (no body) after an accepted other drink. SOS accepts world positions.
// Body events (v7 SOCIAL): {event:"comehere"|"sos"|"msg", ...}, plus "home"/"pause" from v6.
// Body events (v9 INKALLELSE): {event:"rally"|"rally_yes", rally_id}.
// Body events (v10 CHECKA IN): {event:"checkin", bar?} -> "📍 {namn} har anlänt till {bar}".
// Body events (v12 KROGARNA): {event:"tip", tip_id} -> krogtips, {event:"takeover", bar_id} -> "🏰 Ni har tagit över {bar}!".
// Body events (v16 EFTERÅT): {event:"medevac_check", check_id} -> "🚑 Lisa kollar på Oskar", {event:"voice", voice_id} -> röstskål.
// Keep this in ONE file (the deploy tool uploads files directly; no import map).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

// ---- pure:start (no Deno / network below this line until pure:end; tested by supabase/tests) ----

export type Pt = { lat: number; lng: number };
export type LiveBeer = Pt & { beer_count: number; other_count?: number | null };

/** v17: all drinks count (beers + other drinks) for levels, chaos and level-ups. */
export function drinksOf(b: { beer_count?: number | null; other_count?: number | null } | null | undefined): number {
  if (!b) return 0;
  const n = (Number(b.beer_count) || 0) + (Number(b.other_count) || 0);
  return n > 0 ? n : 0;
}

export const CHAOS_RADIUS_KM = 5;
export const PUSH_RADIUS_KM = 10;
export const CHAOS_MIN_OUT = 10;
export const CHAOS_MIN_HOT = 3;
export const TOWN_MAX_KM = 30;

export function haversineKm(a: Pt, b: Pt): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Lat/lng box that contains a circle of radiusKm around p (for cheap DB pre-filtering). */
export function boxAround(p: Pt, radiusKm: number) {
  const dLat = radiusKm / 111.0; // slightly under the real 111.19 km/deg so the box always covers the circle
  const dLng = radiusKm / (111.0 * Math.max(0.2, Math.cos((p.lat * Math.PI) / 180)));
  return { minLat: p.lat - dLat, maxLat: p.lat + dLat, minLng: p.lng - dLng, maxLng: p.lng + dLng };
}

/** Chaos rule. `beers` must already be live (not expired, not stopped). */
export function chaosCheck(center: Pt, beers: LiveBeer[]) {
  let out = 0;
  let hot = 0;
  for (const b of beers) {
    const n = drinksOf(b);
    if (!(n >= 1)) continue;
    if (haversineKm(center, b) > CHAOS_RADIUS_KM) continue;
    out++;
    if (n >= 5) hot++;
  }
  return { out, hot, chaos: out >= CHAOS_MIN_OUT || hot >= CHAOS_MIN_HOT };
}

export function milestoneLevel(count: number): 0 | 1 | 5 | 10 {
  if (!(count >= 1)) return 0;
  return count >= 10 ? 10 : count >= 5 ? 5 : 1;
}

// [name, lat, lng]
export const TOWNS: [string, number, number][] = [
  ["Ludvika", 60.1496, 15.1878], ["Grängesberg", 60.0786, 14.9945], ["Smedjebacken", 60.1408, 15.4129],
  ["Borlänge", 60.4858, 15.4371], ["Falun", 60.6065, 15.6355], ["Säter", 60.3464, 15.7514],
  ["Hedemora", 60.2795, 15.9886], ["Avesta", 60.1455, 16.1679], ["Leksand", 60.7300, 14.9997],
  ["Rättvik", 60.8865, 15.1189], ["Mora", 61.0070, 14.5430], ["Fagersta", 60.0042, 15.7932],
  ["Stockholm", 59.3293, 18.0686], ["Göteborg", 57.7089, 11.9746], ["Malmö", 55.6050, 13.0038],
  ["Uppsala", 59.8586, 17.6389], ["Västerås", 59.6099, 16.5448], ["Örebro", 59.2753, 15.2134],
  ["Linköping", 58.4108, 15.6214], ["Helsingborg", 56.0465, 12.6945], ["Jönköping", 57.7826, 14.1618],
  ["Norrköping", 58.5877, 16.1924], ["Lund", 55.7047, 13.1910], ["Umeå", 63.8258, 20.2630],
  ["Gävle", 60.6749, 17.1413], ["Sandviken", 60.6216, 16.7756], ["Borås", 57.7210, 12.9401],
  ["Södertälje", 59.1955, 17.6253], ["Eskilstuna", 59.3666, 16.5077], ["Halmstad", 56.6745, 12.8578],
  ["Växjö", 56.8777, 14.8091], ["Karlstad", 59.3793, 13.5036], ["Sundsvall", 62.3908, 17.3069],
  ["Luleå", 65.5848, 22.1547], ["Trollhättan", 58.2837, 12.2886], ["Östersund", 63.1792, 14.6357],
  ["Kalmar", 56.6634, 16.3568], ["Kristianstad", 56.0294, 14.1567], ["Skövde", 58.3903, 13.8461],
  ["Karlskrona", 56.1612, 15.5869], ["Skellefteå", 64.7507, 20.9528], ["Uddevalla", 58.3498, 11.9356],
  ["Nyköping", 58.7530, 17.0079], ["Visby", 57.6348, 18.2948], ["Kiruna", 67.8558, 20.2253],
  ["Örnsköldsvik", 63.2909, 18.7153], ["Härnösand", 62.6323, 17.9379], ["Piteå", 65.3172, 21.4794],
  ["Varberg", 57.1056, 12.2508], ["Kungsbacka", 57.4872, 12.0761], ["Motala", 58.5371, 15.0365],
  ["Köping", 59.5140, 15.9926], ["Hudiksvall", 61.7290, 17.1036],
];

/** Nearest town name, or "stan" when no listed town is within TOWN_MAX_KM. */
export function nearestTown(p: Pt): string {
  let best = "stan";
  let bestKm = TOWN_MAX_KM;
  for (const [name, lat, lng] of TOWNS) {
    const km = haversineKm(p, { lat, lng });
    if (km <= bestKm) {
      bestKm = km;
      best = name;
    }
  }
  return best;
}

export const FRIEND_LINES: Record<1 | 5 | 10, string[]> = {
  1: [
    "🍻 Grabbarna går loss på stan! {namn} är ute",
    "🍺 {namn} har öppnat första ölen. Hänger du på?",
    "🚨 {namn} är ute och rör sig. Int' sitta hemma nu!",
    "🍺 {namn} har knäckt en kall. Var é du?",
    "🚜 {namn} har parkerat traktorn och gått ut!",
    "📣 {namn} är ute på byn. Ska du bara sitta där?",
    "🛋️ {namn} har lämnat soffan. Historiskt ögonblick!",
    "🍺 Första ölen för {namn}. Kvällen har officiellt börjat.",
    "📡 Radarn har fått utslag: {namn} är ute!",
    "🚀 {namn} har lyft. Uppdrag: ölen.",
    "🧥 {namn} har tagit på sig finjackan. Det betyder bara en sak.",
    "🐻 Björnen har vaknat: {namn} är ute!",
    "🔔 Ding ding! {namn} har ringt in kvällen.",
    "🍺 {namn} säger skål. Du säger …?",
    "🎣 {namn} har kastat ut kroken. Nappar du?",
    "🚌 {namn} har hoppat på festbussen. Nästa hållplats: du?",
    "😎 {namn} är ute och ser bra ut. Kom och bevisa motsatsen.",
    "🏁 Startskottet har gått! {namn} är igång.",
    "🦌 {namn} har brutit sig ut ur skogen och tagit en öl.",
    "📞 {namn} är ute. Morsan vet inte om det än.",
    "🎖️ {titel} {namn} dricker för fullo!",
    "🍻 {titel} {namn} är ute på uppdrag",
    "📣 {titel} {namn} har lämnat basen!",
    "🫡 {titel} {namn} har ryckt ut. Uppdrag: öl.",
    "🪖 {titel} {namn} rapporterar: första ölen är i hand.",
    "📡 Spaning: {titel} {namn} har setts med en kall.",
    "🚁 {titel} {namn} har landat på krogen.",
  ],
  5: [
    "🔥 {namn} är på HOT STREAK! Öl nr 5",
    "🔥 {namn} har fått upp ångan – fem öl!",
    "🔥 Fem öl för {namn}. Det här går int' att stoppa.",
    "🥵 {namn} är varm i kläderna nu. Öl nr 5!",
    "🐎 {namn} går som en dalahäst i galopp – fem öl!",
    "🔥 {namn} har tagit fem. Nu börjar det likna nåt!",
    "🚂 Tåget har gått! {namn} är på öl nr 5.",
    "🎸 {namn} har kommit till refrängen. Fem öl!",
    "🖐️ En hel hand öl för {namn}!",
    "🌡️ Termometern visar: {namn} är HET. Öl nr 5",
    "🎳 Strike! {namn} har fällt fem öl.",
    "🧨 {namn} har tänt stubinen. Fem öl och räknar.",
    "🏒 Hattrick plus två. {namn} är på öl nr 5!",
    "🕺 {namn} har börjat dansa utan musik. Öl nr 5.",
    "📈 Kurvan pekar uppåt: {namn} på fem öl!",
    "🔥 {namn} har slutat räkna. Vi gör det: fem.",
    "🦅 {namn} flyger högt nu. Öl nr 5!",
    "🍺🍺🍺🍺🍺 {namn}. Mer behöver vi inte säga.",
    "🚒 Ring brandkåren – {namn} brinner! Öl nr 5",
    "🎤 {namn} har börjat prata om att starta band. Fem öl.",
    "🔥 {titel} {namn} är på HOT STREAK! Öl nr 5",
    "🎖️ {titel} {namn} kör hårt – fem öl!",
    "🪖 {titel} {namn} har tagit fem. Truppen följer efter?",
  ],
  10: [
    "🚁 MEDEVAC: kolla till {namn}! Öl nr 10",
    "🚁 {namn} har druckit 10. Nån borde kolla läget.",
    "🚁 Tio öl för {namn}. Ring och hör hur det står till.",
    "🚕 {namn} är uppe i 10. Dags att ordna taxi hem?",
    "💧 {namn} har tagit 10. Nån som har en flaska vatten?",
    "🚁 MEDEVAC till {namn}! Kolla att allt é lugnt.",
    "🛟 {namn} har tagit tio. Kasta ut en livboj!",
    "🍕 {namn} är på öl nr 10. Nån borde mata hen med en pizza.",
    "🧭 {namn} har tagit tio. Hittar hen hem? Kolla!",
    "📞 Tio öl för {namn}. Ett samtal nu kan rädda kvällen.",
    "🚁 Helikoptern är på väg till {namn}. Du är närmast – kolla!",
    "🥤 {namn} har nått tio. Byt nästa öl mot en vatten?",
    "🫂 {namn} har tagit tio. Ge hen en kram och ett glas vatten.",
    "🚕 Öl nr 10 för {namn}. Taxinumret är din bästa vän nu.",
    "🧯 {namn} har tagit tio. Dags att släcka med vatten.",
    "🌭 {namn} på 10 öl. Korvkiosken kallar – följ med hen dit!",
    "🚁 Kod röd: {namn} har tagit 10. Kolla att hen har sällskap.",
    "🔋 {namn} kör på reservbatteri. Öl nr 10 – kolla läget.",
    "🧑‍🚒 Nån måste vara vuxen nu. {namn} har druckit 10.",
    "🏠 {namn} har tagit tio. Se till att hen kommer hem helt.",
  ],
};

export const FRIEND_BODY: Record<1 | 5 | 10, string> = {
  1: "Öppna kartan och se var.",
  5: "Öppna kartan och se var.",
  10: "Kolla kartan. Vatten och taxi hem 🚕",
};

export const KAOS_LINES: string[] = [
  "🚨 Nu ballar det ur i {stad}!",
  "🍺 Ölbilen har kommit till {stad}!",
  "😳 Hörru, int' kan du sitta hemma nu?",
  "💥 Ja men nu jäklar, {stad}!",
  "📞 Kaos i {stad}! Nån borde ringa morsan.",
  "🚜 Hela {stad} har släppt traktorn och gått ut!",
  "🌲 Sånt här har int' hänt sen midsommar!",
  "🦌 Till och med älgarna i {stad} har gått ut!",
  "🍻 {n} pers är ute i {stad} just nu. Och du då?",
  "🎪 Cirkusen har kommit till {stad}! {n} pers ute.",
  "🔥 {stad} står i lågor! (Inte på riktigt.)",
  "📢 Detta är inte en övning. Det är kaos i {stad}!",
  "🎉 {stad} har gått bananas. {n} pers är ute!",
  "🐄 Korna i {stad} undrar vad som händer. Svar: öl.",
  "🛸 UFO? Nej. Bara {n} pers som är ute i {stad}.",
  "🚓 Grannarna har ringt. {stad} har gått loss!",
  "🌋 Vulkanen {stad} har fått utbrott!",
  "🎺 Dansbandet har dragit igång i {stad}. Var é du?",
  "🍺 Bryggerierna går på högvarv i {stad} ikväll!",
  "🧨 {stad} har tänt alla smällare samtidigt. Kaos!",
  "🏃 Alla springer till krogen i {stad}. Hänger du med?",
  "🦆 Till och med änderna i {stad} har gått ut.",
];

export const HOME_LINES: string[] = [
  "🏠 {namn} har kommit hem. Uppdraget slutfört!",
  "🛌 {namn} är hemma och i säng. God natt, soldat.",
  "🏠 {namn} har landat hemma. Inga förluster rapporterade.",
  "🦉 {namn} är hemma. Resten av er får klara er själva.",
  "🏡 {namn} har tagit sig hem helskinnad. Skål för det!",
  "🧦 {namn} är hemma i tofflorna. Kvällen är över.",
  "📦 Leverans klar: {namn} är hemma.",
  "🛬 {namn} har landat på hemmaplan.",
  "🌙 {namn} har checkat ut. Hemma och säker.",
  "🐻 Björnen har gått i ide. {namn} är hemma.",
];

export const PAUSE_LINES: string[] = [
  "🥀 {namn} har fått öltorsk. Nån borde skicka hjälp!",
  "🏜️ Torka i glaset hos {namn}. Öltorsk konstaterad.",
  "😢 {namn} har slutat dricka. Ska vi ringa nån?",
  "🍺❌ {namn} har lagt ner glaset. Vad är det som händer?!",
  "🚱 {namn} har drabbats av akut öltorsk.",
  "😴 {namn} har tagit paus. Svag insats, soldat.",
  "🐢 {namn} tar det lugnt nu. Tråkmåns.",
  "🧊 {namn} har frusit fast. Inget mer öl på ett tag.",
  "🫗 Glaset är tomt och {namn} fyller inte på. Larm!",
  "🪦 Här vilar kvällen för {namn}. Den var kort men fin.",
];

export function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// ---- v7 SOCIAL ----

/** Title ladder by lifetime beers (v11, 36 steps). Same list in migration 0012 (olnu_titles),
 *  docs/js/social.js TITLES and CONTRACT.md. */
export const TITLES: [number, string][] = [
  [0, "Rekryt"], [3, "Mönstrad Mellanöl"], [5, "Menig Mjöd"], [7, "Vicekorpral Kapsyl"],
  [10, "Kapsylkorpral från Grangärde"], [13, "Skumsergeant"], [17, "Furir Flaskhals"],
  [22, "Överfurir Fatkran"], [28, "Fanjunkare Flasköppnare"], [35, "Fänrik Fatöl"],
  [43, "Löjtnant Lager"], [52, "Premiärlöjtnant Pilsner"], [62, "Kapten Kaggen"],
  [75, "Ryttmästare Humle"], [90, "Major Malt från Smedjebacken"], [110, "Överstelöjtnant Ölstop"],
  [130, "Överste Ölkorv"], [155, "Brigadgeneral Bärs"], [180, "Generalmajor Gambrinus"],
  [210, "Generallöjtnant Guldskum"], [245, "General Dalabärs"], [285, "Fältmarskalk Fradga"],
  [330, "Riksmarskalk Rundtur"], [380, "Baron av Bryggstugan"], [430, "Hertig av Humlegården"],
  [490, "Ärkehertig av Ölkranen"], [560, "Kung Kapsyl av Dalarna"], [640, "Ölkejsaren"],
  [730, "Bryggerilegenden"], [830, "Halvguden från Väsman"], [920, "Myten från Grängesberg"],
  [1000, "Legenden från Ludvika"], [1100, "Sagofiguren från Säfsnäs"], [1200, "Oraklet i Ölstugan"],
  [1300, "Överbefälhavare Öl"], [1500, "Ölguden"],
];

export function titleFor(total: number) {
  const t = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  let i = 0;
  while (i + 1 < TITLES.length && TITLES[i + 1][0] <= t) i++;
  const next = TITLES[i + 1];
  return {
    title: TITLES[i][1],
    at: TITLES[i][0],
    next_title: next ? next[1] : null,
    next_at: next ? next[0] : null,
  };
}

/** Friend line with name and title. Without a title, "{titel} " is removed. */
export function fillFriend(tpl: string, namn: string, titel: string): string {
  return fill(titel ? tpl : tpl.replace(/\{titel\}\s*/g, ""), { namn, titel });
}

export const LEVELUP_LINES: string[] = [
  "⬆️ {namn} har blivit befordrad till {titel}!",
  "🎖️ Ceremoni! {namn} är nu {titel}. Applåder.",
  "📜 Generalstaben meddelar: {namn} är nu {titel}.",
  "🎺 Fanfar! {namn} har avancerat till {titel}.",
  "🫡 Givakt! Hälsa på {titel} {namn}.",
  "🏅 Ny rang i gruppen: {namn} är {titel}!",
];

export function levelUpPayload(idx: number, namn: string, titel: string, beerId: number) {
  return {
    title: fill(LEVELUP_LINES[((idx % LEVELUP_LINES.length) + LEVELUP_LINES.length) % LEVELUP_LINES.length], { namn, titel }),
    body: "Ny rang i Öl Nu. Skål för det! 🍻",
    url: `/?focus=${beerId}`,
    tag: `olnu-title-${beerId}`,
  };
}

export const COMEHERE_LINES: string[] = [
  "📍 {namn} vill att du kommer till {bar}!",
  "🍺 {namn}: Kom hit till {bar}, det é fest!",
  "🚨 Inkallelse! {namn} behöver förstärkning på {bar}.",
  "📣 {namn} ropar från {bar}: Var é du?!",
  "🍻 {namn} har ställt fram ett glas åt dig på {bar}.",
  "🫡 Order från {namn}: Infinna dig på {bar}. Nu.",
  "🎉 Det händer grejer på {bar}! {namn} väntar på dig.",
  "🚕 Ta en taxi till {bar}. {namn} saknar dig redan.",
];

export const COMEHERE_NOBAR_LINES: string[] = [
  "📍 {namn} vill att du kommer hit",
  "🍺 {namn}: Kom hit, det é fest!",
  "📣 {namn} kallar på förstärkning. Kolla kartan!",
];

/** Bar names come from the client: one line, no control chars, max 60 chars. */
export function cleanBarName(x: unknown): string {
  if (typeof x !== "string") return "";
  // deno-lint-ignore no-control-regex
  return x.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
}

export function comeherePayload(idx: number, namn: string, bar: string, beerId: number) {
  const lines = bar ? COMEHERE_LINES : COMEHERE_NOBAR_LINES;
  return {
    title: fill(lines[((idx % lines.length) + lines.length) % lines.length], { namn, bar }),
    body: "Tryck för att se var.",
    url: `/?focus=${beerId}`,
    tag: `olnu-come-${beerId}`,
  };
}

/** Finite numbers anywhere in the world (v17: |lat| <= 85, lng -180..180; same as post_beer_v2). */
export function validPt(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -85.0 && lat <= 85.0 && lng >= -180.0 && lng <= 180.0;
}

/** SOS: the only push with an exact location, only to group-mates. */
export function sosPayload(namn: string, lat: number, lng: number, stamp: number) {
  return {
    title: `🆘 ${namn} behöver hjälp!`,
    body: "Tryck för att se var.",
    url: `/?sos=${lat.toFixed(5)},${lng.toFixed(5)}`,
    tag: `olnu-sos-${stamp}`,
    sos: true,
    requireInteraction: true,
  };
}

export function msgPayload(namn: string, body: string, groupName: string, groupId: string) {
  return {
    title: `💬 ${namn}: ${body}`,
    body: groupName ? `i ${groupName}` : "Nytt i gruppchatten",
    url: `/?chat=${groupId}`,
    tag: `olnu-msg-${groupId}`,
  };
}

export function isUuid(x: unknown): x is string {
  return typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

/** Start of the fixed time bucket (ms) that contains nowMs. */
export function bucketStart(nowMs: number, windowSec: number): number {
  const w = windowSec * 1000;
  return Math.floor(nowMs / w) * w;
}

/** Event rate limits in seconds (push_sent kind -> window). */
export const RATE_SEC = { comehere: 600, sos: 180, msg: 120, checkin: 600 } as const;

// ---- v10 CHECKA IN ----
export const CHECKIN_LINES: string[] = [
  "📍 {namn} har anlänt till {bar}",
  "🍺 {namn} har checkat in på {bar}. Ölen är beställd.",
  "🚪 Dörren till {bar} slogs upp. In klev {namn}.",
  "🫡 {namn} rapporterar: på plats vid {bar}.",
  "🪖 {namn} har intagit {bar}. Positionen är säkrad.",
  "📡 Spaning: {namn} har setts gå in på {bar}.",
  "🎺 Fanfar! {namn} har gjort entré på {bar}.",
  "🚁 {namn} har landat på {bar}. Ölbasen är bemannad.",
  "🛬 Touchdown! {namn} är på {bar}.",
  "📣 Hör upp! {namn} har anlänt till {bar}.",
  "🐻 Björnen har lämnat idet. {namn} är på {bar}.",
  "🍻 {namn} har tagit plats på {bar}. Stolen bredvid är ledig.",
  "🚜 {namn} har parkerat traktorn utanför {bar}.",
  "🦌 En vild {namn} har setts på {bar}!",
  "🧭 Koordinaterna är bekräftade: {namn} är på {bar}.",
  "🎯 Målet nått! {namn} står i baren på {bar}.",
  "🕵️ Hemlig källa: {namn} sitter på {bar} just nu.",
  "📯 {namn} blåser i hornet från {bar}. Kom!",
  "🏁 {namn} har gått i mål på {bar}. Nu börjar kvällen.",
  "🚕 Taxin har lämnat av {namn} vid {bar}.",
  "🎪 Cirkusen har kommit till stan: {namn} är på {bar}.",
  "🧲 {bar} drog till sig {namn}. Vem blir nästa?",
  "🎤 {namn} har tagit över {bar}. Karaoke kan inte uteslutas.",
  "⚓ {namn} har kastat ankar på {bar}.",
  "🛎️ Pling! {namn} har checkat in på {bar}.",
];

export const CHECKIN_BODY: string[] = [
  "Tryck för att se var. Hänger du på?",
  "Öppna kartan. Det finns plats för en till.",
  "Tryck för att se baren på kartan.",
  "Ska du bara sitta hemma? Kolla kartan.",
];

export function checkinPayload(idx: number, namn: string, bar: string, stamp: number) {
  const b = bar || "baren";
  return {
    title: fill(CHECKIN_LINES[((Math.floor(idx) % CHECKIN_LINES.length) + CHECKIN_LINES.length) % CHECKIN_LINES.length], { namn, bar: b }),
    body: CHECKIN_BODY[((Math.floor(idx) % CHECKIN_BODY.length) + CHECKIN_BODY.length) % CHECKIN_BODY.length],
    url: "/",
    tag: `olnu-checkin-${stamp}`,
  };
}

/** Random index in [0, n), never equal to `avoid` when n > 1. */
export function pickIndex(n: number, avoid: number | undefined, rand: () => number = Math.random): number {
  if (n <= 1) return 0;
  if (avoid === undefined || avoid < 0 || avoid >= n) return Math.floor(rand() * n) % n;
  const i = Math.floor(rand() * (n - 1)) % (n - 1);
  return i >= avoid ? i + 1 : i;
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Chaos line for a user on a night: a per-user offset plus the night number, so the same
 *  user never gets the same line two nights in a row, and different users get different lines. */
export function kaosLineIndex(n: number, nightIso: string, userId: string): number {
  const day = Math.floor(Date.parse(nightIso) / 86_400_000);
  return (((day + hashStr(userId)) % n) + n) % n;
}

/** Evening date of a night ("2026-10-17" for the night that ends 2026-10-18 05:00 Stockholm). */
export function nightLabel(nightIso: string): string {
  const d = new Date(Date.parse(nightIso) - 12 * 3600 * 1000);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export function kaosPayload(idx: number, stad: string, out: number, hot: number, nightIso: string) {
  const title = fill(KAOS_LINES[idx % KAOS_LINES.length], { stad, n: out, hot });
  const body = hot > 0 ? `${out} ute · ${hot} på hot streak` : `${out} ute`;
  return { title, body, url: "/", tag: `olnu-kaos-${nightLabel(nightIso)}` };
}

// ---- v9 INKALLELSE (rally) ----

/** Call-out lines to group-mates. {namn} = creator, {body} = rally text. */
export const RALLY_LINES: string[] = [
  "🪖 {namn}: {body}",
  "📯 {namn} blåser till samling! {body}",
  "🚨 Förstärkning behövs! {namn} kallar",
  "🍻 {namn} har öppnat baren. Kommer du?",
  "🫡 Inkallelse från {namn}. Uppdrag: öl.",
  "📣 {namn} kallar in trupperna: {body}",
  "🥁 Trummorna går! {namn}: {body}",
  "📡 Nödsignal från {namn}: {body}",
  "🎖️ Order från {namn}: {body}",
  "🚁 {namn} begär luftunderstöd. {body}",
];

/** "Someone is coming" lines to the creator. {yes} = number on the way. */
export const RALLY_YES_LINES: string[] = [
  "✅ {namn} är på väg! {yes} på väg nu",
  "🪖 {namn} har anslutit till skyttegraven! {yes} på väg",
  "🏃 {namn} springer mot dig. {yes} på väg.",
  "🫡 {namn} har tagit emot ordern. {yes} på väg",
  "🚕 {namn} har hoppat in i taxin. {yes} på väg nu",
];

/** Rally id from the request body: a positive safe integer (number or digit string), else null. */
export function parseRallyId(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" && /^\d{1,15}$/.test(x) ? Number(x) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function wrapIdx(idx: number, n: number): number {
  return ((Math.floor(idx) % n) + n) % n;
}

/** Push to group-mates. The service worker opens /?rally=<id>&answer=yes|no for the actions. */
export function rallyPayload(idx: number, namn: string, body: string, place: string | null | undefined, rallyId: number) {
  return {
    title: fill(RALLY_LINES[wrapIdx(idx, RALLY_LINES.length)], { namn, body }),
    body: place ? `📍 ${place} · Svara i appen` : "Svara i appen",
    url: `/?rally=${rallyId}`,
    tag: `olnu-rally-${rallyId}`,
    rally_id: rallyId,
    actions: [
      { action: "yes", title: "✅ Jag kommer" },
      { action: "no", title: "❌ Kan inte" },
    ],
  };
}

/** Push to the rally creator when a member answers yes (same tag, so they stack into one). */
export function rallyYesPayload(idx: number, namn: string, yes: number, rallyId: number) {
  return {
    title: fill(RALLY_YES_LINES[wrapIdx(idx, RALLY_YES_LINES.length)], { namn, yes }),
    body: "Tryck för att se vilka som kommer.",
    url: `/?rally=${rallyId}`,
    tag: `olnu-rally-${rallyId}-yes`,
    rally_id: rallyId,
  };
}


// ---- v12 KROGARNA: bar tips + takeovers ----
export const TIP_LINES: string[] = [
  "📣 {namn} tipsar: Kom till {bar}!",
  "🍻 {namn} har spanat: {bar} är stället ikväll!",
  "📡 Underrättelse från {namn}: läget är bra på {bar}.",
  "🪖 {namn} beordrar: samling på {bar}!",
  "🦌 {namn} har hittat bästa betet. Det är {bar}.",
  "🎯 {namn} pekar ut målet: {bar}.",
  "📯 {namn} blåser i luren. Alla till {bar}!",
  "🗺️ Krogtips från {namn}: {bar}. Lita på kartan.",
  "🔥 {namn} säger att det brinner på {bar}. Positivt menat.",
  "🚕 {namn} tycker du ska ta taxin till {bar}. Nu.",
  "🕵️ Hemligt tips från {namn}: {bar}. Sprid det inte (sprid det).",
  "🐻 Björnen {namn} har lämnat idet för {bar}. Följ spåren.",
  "📻 Ronny & Ragge-radion rapporterar via {namn}: {bar} är grejen!",
  "🛎️ Pling! {namn} har ett tips: {bar}.",
  "🍺 {namn} har provsmakat {bar}. Betyg: kom hit.",
];
export function tipPayload(idx: number, namn: string, bar: string, body: string | null | undefined, barId: string, tipId: number) {
  const b = cleanBarName(bar) || "baren";
  // deno-lint-ignore no-control-regex
  const extra = typeof body === "string" ? body.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 40) : "";
  return {
    title: fill(TIP_LINES[wrapIdx(idx, TIP_LINES.length)], { namn, bar: b }),
    body: extra ? `”${extra}” · Tryck för att se baren.` : "Tryck för att se baren på kartan.",
    url: `/?bar=${encodeURIComponent(barId)}`,
    tag: `olnu-tip-${tipId}`,
  };
}
export const TAKEOVER_LINES: string[] = [
  "🏰 Ni har tagit över {bar}!",
  "🚩 Flaggan är hissad! {grupp} äger {bar} ikväll.",
  "👑 {bar} är ert. Kungariket {grupp} växer.",
  "🪖 Uppdrag slutfört: {grupp} har intagit {bar}.",
  "🏴 {bar} har fallit. {grupp} håller positionen.",
  "🎺 Fanfar! {grupp} styr {bar} just nu.",
  "🛡️ {bar} är säkrat av {grupp}. Försvara det!",
  "🐴 Dalahästen nickar: {bar} tillhör {grupp} ikväll.",
  "⚔️ Krogen är erövrad! {grupp} äger {bar}.",
  "📡 Spaning bekräftar: {grupp} har flest man på {bar}.",
  "🏰 Borgen {bar} är er. Glöm inte att skåla för segern.",
  "🍻 {grupp} äger {bar}. Ronny och Ragge hade varit stolta.",
  "🚁 Luftlandsättning lyckad. {bar} är {grupp}s.",
  "🗺️ Nytt territorium: {bar}. Kartan är ändrad.",
  "🔥 {bar} är ert ikväll. Håll ställningarna (och drick vatten).",
];
export function takeoverPayload(idx: number, grupp: string, bar: string, barId: string, groupId: string) {
  const b = cleanBarName(bar) || "krogen";
  const g = cleanBarName(grupp) || "Ni";
  return {
    title: fill(TAKEOVER_LINES[wrapIdx(idx, TAKEOVER_LINES.length)], { grupp: g, bar: b }),
    body: "Tryck för att se kartan. Håll krogen!",
    url: `/?bar=${encodeURIComponent(barId)}`,
    tag: `olnu-takeover-${groupId}-${barId}`.slice(0, 120),
  };
}


// ---- v16 EFTERÅT ----
// Kom hem säkert: extra home lines (content B23). {namn}, {tid} = HH:MM.
export const SAFE_HOME_LINES: string[] = [
  "🏠 {namn} é hemma. Basen é säkrad.",
  "🏠 {namn} har tryckt Jag är hemma. Högkvarteret andas ut.",
  "🏠 {namn} é i säng, eller på väg dit. Snyggt, soldat.",
  "🏠 Landat: {namn} é hemma {tid}. Tornet tackar.",
  "🏠 {namn} é hemma. Ölguden bockar av ett namn i sin bok.",
  "🏠 {namn} har nått basen. Inga skadade, inga saknade.",
  "🏠 Kudden rapporterar: {namn} é på plats.",
  "🏠 {namn} é hemma kl. {tid}. Morsan hade varit nöjd.",
  "🏠 Ett namn mindre att oroa sig för: {namn} é hemma.",
  "🏠 {namn} é hemma. Drick ett glas vatten innan du somnar, pojk.",
  "🏠 Högkvarteret bekräftar: {namn} é tillbaka på basen.",
  "🏠 {namn} gick hem som en hjälte. Eller i alla fall som en människa.",
  "🏠 {namn} é hemma och i säkerhet. Bra jobbat, soldat.",
  "🏠 Dörren é låst, skorna é av: {namn} é hemma.",
  "🏠 {namn} har checkat ut från stan och in i sängen.",
  "🏠 Pling! {namn} é hemma. Gruppen kan pusta ut.",
  "🏠 {namn} é hemma {tid}. Ingen behöver skicka ut sökpatrull.",
  "🏠 {namn} é på basen. Ladda mobilen, ladda dig själv.",
  "🏠 {namn} é hemma. Ölguden höjer sitt vattenglas.",
  "🏠 Säker hemkomst: {namn}. Kvällens bästa nyhet.",
  "🏠 {namn} é hemma. Kylskåpet hälsar välkommen, men gå och lägg dig.",
  "🏠 Reträtt genomförd: {namn} é hemma kl. {tid}.",
  "🏠 {namn} é hemma. Grannkatten såg alltihop och godkände.",
  "🏠 {namn} har lämnat slagfältet för täcket.",
  "🏠 {namn} é hemma. Den som trycker på knappen é en ansvarsfull själ.",
  "🏠 Uppdrag Hemgång klart: {namn} é hemma.",
  "🏠 {namn} é i hamn. Ankaret é kastat i sängen.",
  "🏠 {namn} é hemma {tid}. Bakisrapporten kommer i morgon.",
  "🏠 Till gruppen: {namn} é hemma och mår bra.",
  "🏠 {namn} é hemma. En soldat i sängen é värd två på stan.",
  "🏠 {namn} har tryckt på knappen. Kvällens viktigaste tryck.",
  "🏠 Basen meddelar ankomst: {namn}. Lampan é släckt.",
  "🏠 {namn} é hemma. Sov gott, vi ses i morgon.",
  "🏠 {namn} é hemma säkert. Ölguden somnar lite lugnare.",
  "🏠 Hemkomst registrerad för {namn}. Vattenglaset é obligatoriskt.",
  "🏠 {namn} é hemma. Tack till den som följde med en bit på vägen.",
  "🏠 {namn} é tillbaka i baracken. Tystnad i logementet.",
  "🏠 {namn} é hemma. Gruppchatten kan sänka beredskapen ett snäpp.",
  "🏠 Bekräftat från fältet: {namn} é hemma kl. {tid}. Utmärkt.",
  "🏠 {namn} é hemma. Det é så det ska va', dä.",
];

// Röstskål in the group chat. {namn}
export const VOICE_LINES: string[] = [
  "🎙️ {namn} skickade ett röstskål.",
  "🎙️ {namn} har spelat in ett röstmeddelande från fältet.",
  "🎙️ Radio {namn} sänder live från krogen.",
  "🎙️ {namn} rapporterar via kommradion. Över.",
  "🎙️ Ljudbevis från {namn}: stämningen é god.",
  "🎙️ {namn} har skickat ett röstskål. Volymen står på tolv.",
  "🎙️ Högkvarteret har tagit emot en ljudfil från {namn}. Analys pågår.",
  "🎙️ {namn} skålar med rösten. Det låter som Dalarna.",
  "🎙️ Röstbrev från {namn}. Bakgrundsljud: glada människor.",
  "🎙️ {namn} skickade ett 'skååål' med äkta dalmål.",
  "🎙️ Ny sändning från {namn}. Sänk volymen innan du lyssnar.",
  "🎙️ {namn} har talat. Gruppen lyssnar andäktigt.",
  "🎙️ Kommradion sprakar: det é {namn} med en hälsning.",
  "🎙️ {namn} spelade in en lägesrapport. Ingen förstod, alla skrattade.",
  "🎙️ Ett röstskål från {namn}. Ölguden nickar i takt.",
  "🎙️ {namn} sänder från frontlinjen. Över och ut.",
  "🎙️ Röstmeddelande från {namn}. Innehåll: hemligt, men roligt.",
  "🎙️ {namn} har lagt till ljud i kvällens krönika.",
  "🎙️ {namn} skickade en skål i ljudform. Skåla tillbaka, pojk.",
  "🎙️ Ljudsignal från {namn}. Antingen en skål eller en raggarbil som startar.",
];

/** HH:MM in Europe/Stockholm. */
export function hhmm(ms: number): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .format(new Date(ms));
  } catch (_e) {
    const d = new Date(ms);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
}

/** Home push title: old HOME_LINES + SAFE_HOME_LINES. idx over the joined list. */
export function homeTitle(idx: number, namn: string, ms: number): string {
  const all = HOME_LINES.concat(SAFE_HOME_LINES);
  return fill(all[wrapIdx(idx, all.length)], { namn, tid: hhmm(ms) });
}
export function homeLineCount(): number { return HOME_LINES.length + SAFE_HOME_LINES.length; }

// "🚑 Jag kollar": a friend takes care of a mate on MEDEVAC (10 beers). Caring, never shaming.
export const MEDCHECK_LINES: string[] = [
  "🚑 {namn} kollar läget med {mal}. Bra jobbat, kompis.",
  "💚 {namn} har koll på {mal} ikväll.",
  "🫡 {namn} tar hand om {mal}. Ingen soldat lämnas kvar.",
  "🚑 {namn} är på väg till {mal} med ett glas vatten.",
  "🤝 {namn} kollar till {mal}. Så gör riktiga vänner.",
  "💧 {namn} har {mal} under uppsikt. Vatten är beställt.",
  "🛡️ {namn} står vakt vid {mal}. Lugnt läge.",
  "🚕 {namn} kollar läget med {mal} och har taxinumret redo.",
  "💚 Kompisvakten {namn} har koll på {mal}.",
  "🫂 {namn} ser efter {mal} ikväll. Tack!",
];
export const MEDCHECK_ME_LINES: string[] = [
  "💚 {namn} kommer och kollar läget med dig.",
  "🚑 {namn} har koll på dig ikväll. Ta ett glas vatten.",
  "🫂 {namn} ser efter dig. Säg till om du vill hem.",
  "💧 {namn} är på väg med vatten. Du är i goda händer.",
  "🛡️ {namn} står vakt. Ta det lugnt nu.",
];
export function medcheckPayload(idx: number, namn: string, mal: string | null, beerId: number | null, checkId: number) {
  const me = mal === null;
  const lines = me ? MEDCHECK_ME_LINES : MEDCHECK_LINES;
  return {
    title: fill(lines[wrapIdx(idx, lines.length)], { namn: cleanBarName(namn) || "En vän", mal: cleanBarName(mal ?? "") || "kompisen" }),
    body: me ? "Drick vatten. Ta taxi hem. 🚕" : "Tack för att ni tar hand om varandra.",
    url: beerId ? `/?focus=${beerId}` : "/",
    tag: `olnu-medcheck-${checkId}`,
  };
}

export function voicePayload(idx: number, namn: string, groupName: string, groupId: string) {
  return {
    title: fill(VOICE_LINES[wrapIdx(idx, VOICE_LINES.length)], { namn: cleanBarName(namn) || "En vän" }),
    body: `i ${cleanBarName(groupName) || "gruppen"} · Tryck för att lyssna`,
    url: `/?chat=${groupId}`,
    tag: `olnu-voice-${groupId}`,
  };
}

// ---- pure:end ----

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

const MAX_KAOS_RECIPIENTS = 500;

let vapidReady = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
  } catch (e) {
    console.error("Invalid VAPID config", e);
  }
}

// Best effort "not the same line twice in a row" for friend pushes (per warm isolate).
const lastFriendLine = new Map<string, number>();
function rememberLine(key: string, idx: number) {
  if (lastFriendLine.size > 5000) lastFriendLine.clear();
  lastFriendLine.set(key, idx);
}

type Sub = { id: number; user_id: string; endpoint: string; p256dh: string; auth: string };
type Job = { sub: Sub; payload: string };

// deno-lint-ignore no-explicit-any
type Admin = any;

async function friendJobs(admin: Admin, uid: string, beerId: number, level: 1 | 5 | 10, titel = ""): Promise<Job[]> {
  const { data: mine, error: mineErr } = await admin
    .from("group_members")
    .select("group_id, display_name")
    .eq("user_id", uid);
  if (mineErr) throw mineErr;
  if (!mine || mine.length === 0) return [];

  const nameByGroup = new Map<string, string>();
  for (const m of mine) nameByGroup.set(m.group_id as string, m.display_name as string);

  const { data: others, error: othersErr } = await admin
    .from("group_members")
    .select("group_id, user_id")
    .in("group_id", [...nameByGroup.keys()])
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
  if (senderNameFor.size === 0) return [];

  const { data: subs, error: subsErr } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", [...senderNameFor.keys()]);
  if (subsErr) throw subsErr;

  // One line per recipient (all their devices get the same text).
  const lines = FRIEND_LINES[level];
  const lineFor = new Map<string, number>();
  for (const rid of senderNameFor.keys()) {
    const key = `${rid}:${level}`;
    const idx = pickIndex(lines.length, lastFriendLine.get(key));
    rememberLine(key, idx);
    lineFor.set(rid, idx);
  }
  // Tag uses the beer id (already in the url), never the user id.
  const tag = `olnu-${beerId}-${level}`;
  return ((subs ?? []) as Sub[]).map((s) => {
    const name = senderNameFor.get(s.user_id) ?? "En vän";
    const title = fillFriend(lines[lineFor.get(s.user_id) ?? 0], name, titel);
    return {
      sub: s,
      payload: JSON.stringify({ title, body: FRIEND_BODY[level], url: `/?focus=${beerId}`, tag }),
    };
  });
}

async function kaosJobs(
  admin: Admin,
  uid: string,
  beer: { lat: number; lng: number; expires_at: string },
): Promise<{ jobs: Job[]; out: number; hot: number; chaos: boolean }> {
  const center = { lat: beer.lat, lng: beer.lng };
  const nowIso = new Date().toISOString();

  // 1. Live beers in a box around the beer, exact distance in JS.
  const b5 = boxAround(center, CHAOS_RADIUS_KM);
  const { data: near, error: nearErr } = await admin
    .from("beers")
    .select("lat, lng, beer_count, other_count")
    .gt("expires_at", nowIso)
    .eq("stopped", false)
    .gte("lat", b5.minLat).lte("lat", b5.maxLat)
    .gte("lng", b5.minLng).lte("lng", b5.maxLng)
    .limit(5000);
  if (nearErr) throw nearErr;
  const { out, hot, chaos } = chaosCheck(center, (near ?? []) as LiveBeer[]);
  if (!chaos) return { jobs: [], out, hot, chaos };

  // 2. Subscribers whose saved area is within 10 km (never the beer's owner).
  const b10 = boxAround(center, PUSH_RADIUS_KM);
  const { data: subsRaw, error: subsErr } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, lat, lng")
    .not("lat", "is", null)
    .not("lng", "is", null)
    .gte("lat", b10.minLat).lte("lat", b10.maxLat)
    .gte("lng", b10.minLng).lte("lng", b10.maxLng)
    .neq("user_id", uid)
    .limit(5000);
  if (subsErr) throw subsErr;
  const subs = ((subsRaw ?? []) as (Sub & Pt)[]).filter((s) => haversineKm(center, s) <= PUSH_RADIUS_KM);
  if (subs.length === 0) return { jobs: [], out, hot, chaos };

  // 3. Once per user per night: claim rows in push_sent. Only newly inserted rows come back
  //    (insert ... on conflict do nothing returning), so parallel calls cannot double-send.
  const userIds = [...new Set(subs.map((s) => s.user_id))].slice(0, MAX_KAOS_RECIPIENTS);
  const { data: claimed, error: claimErr } = await admin
    .from("push_sent")
    .upsert(
      userIds.map((u) => ({ user_id: u, kind: "kaos", night: beer.expires_at })),
      { onConflict: "user_id,kind,night", ignoreDuplicates: true },
    )
    .select("user_id");
  if (claimErr) throw claimErr;
  const fresh = new Set(((claimed ?? []) as { user_id: string }[]).map((r) => r.user_id));
  if (fresh.size === 0) return { jobs: [], out, hot, chaos };

  const stad = nearestTown(center);
  const jobs = subs
    .filter((s) => fresh.has(s.user_id))
    .map((s) => {
      const idx = kaosLineIndex(KAOS_LINES.length, beer.expires_at, s.user_id);
      return { sub: s, payload: JSON.stringify(kaosPayload(idx, stad, out, hot, beer.expires_at)) };
    });

  // Light cleanup of old nights (kept out of the SQL migration on purpose).
  if (Math.random() < 0.05) {
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    // Keep the forever rows (level-up 'title:*', night 2100-01-01): they are in the future anyway, but be explicit.
    const { error } = await admin.from("push_sent").delete().lt("night", old).neq("night", "2100-01-01T00:00:00Z");
    if (error) console.error("push_sent cleanup failed", error);
  }
  return { jobs, out, hot, chaos };
}

async function sendAll(admin: Admin, jobs: Job[], ttl = 3600) {
  const results = await Promise.allSettled(
    jobs.map((j) =>
      webpush.sendNotification(
        { endpoint: j.sub.endpoint, keys: { p256dh: j.sub.p256dh, auth: j.sub.auth } },
        j.payload,
        { TTL: ttl, urgency: "high" },
      )
    ),
  );
  let sent = 0;
  let failed = 0;
  const deadIds = new Set<number>();
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sent++;
    } else {
      failed++;
      const code = (r.reason as { statusCode?: number } | undefined)?.statusCode;
      if (code === 404 || code === 410) deadIds.add(jobs[i].sub.id);
      else console.error("push failed", code, String(r.reason));
    }
  });
  if (deadIds.size > 0) {
    const { error } = await admin.from("push_subscriptions").delete().in("id", [...deadIds]);
    if (error) console.error("failed to delete dead subscriptions", error);
  }
  return { sent, failed };
}

// ---- v7 SOCIAL helpers ----

/** Group-mates of uid -> sender name (uid's display_name in a shared group, smallest).
 *  With onlyGroup: only that group. */
async function mateNames(admin: Admin, uid: string, onlyGroup?: string): Promise<Map<string, string>> {
  let q = admin.from("group_members").select("group_id, display_name").eq("user_id", uid);
  if (onlyGroup) q = q.eq("group_id", onlyGroup);
  const { data: mine, error } = await q;
  if (error) throw error;
  const nameFor = new Map<string, string>();
  if (!mine || mine.length === 0) return nameFor;
  const nameByGroup = new Map<string, string>();
  for (const m of mine) nameByGroup.set(m.group_id as string, m.display_name as string);
  const { data: others, error: oErr } = await admin
    .from("group_members").select("group_id, user_id")
    .in("group_id", [...nameByGroup.keys()]).neq("user_id", uid);
  if (oErr) throw oErr;
  for (const o of others ?? []) {
    const name = nameByGroup.get(o.group_id as string);
    if (!name) continue;
    const prev = nameFor.get(o.user_id as string);
    if (prev === undefined || name < prev) nameFor.set(o.user_id as string, name);
  }
  return nameFor;
}

async function subsOf(admin: Admin, userIds: string[]): Promise<Sub[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await admin
    .from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", userIds);
  if (error) throw error;
  return (data ?? []) as Sub[];
}

/** Sliding rate limit without removing rows: refuse when a push_sent row of this kind was sent in
 *  the last windowSec, else claim the row for the current time bucket (atomic per bucket). */
async function rateClaim(admin: Admin, uid: string, kind: string, windowSec: number): Promise<boolean> {
  const now = Date.now();
  const { data: recent, error } = await admin
    .from("push_sent").select("kind")
    .eq("user_id", uid).eq("kind", kind)
    .gt("sent_at", new Date(now - windowSec * 1000).toISOString())
    .limit(1);
  if (error) throw error;
  if (recent && recent.length > 0) return false;
  const { data: claimed, error: cErr } = await admin
    .from("push_sent")
    .upsert(
      [{ user_id: uid, kind, night: new Date(bucketStart(now, windowSec)).toISOString(), sent_at: new Date(now).toISOString() }],
      { onConflict: "user_id,kind,night", ignoreDuplicates: true },
    )
    .select("user_id");
  if (cErr) throw cErr;
  return !!claimed && claimed.length > 0;
}

async function lifetimeTotal(admin: Admin, uid: string): Promise<number> {
  const { data, error } = await admin.from("week_beers").select("n").eq("user_id", uid);
  if (error) throw error;
  return ((data ?? []) as { n: number }[]).reduce((a, r) => a + (r.n ?? 0), 0);
}

/** Once per title per user, ever (push_sent kind 'title:<title>', night 2100-01-01). */
async function levelUpJobs(admin: Admin, uid: string, beerId: number, total: number): Promise<Job[]> {
  const t = titleFor(total);
  if (t.at <= 0) return [];
  // Only a rank reached just now (this beer or the one before). Users whose rank name changed
  // with the v11 ladder, but who did not just pass a step, get no push.
  if (total - t.at > 1) return [];
  const mates = await mateNames(admin, uid);
  if (mates.size === 0) return [];
  const { data: claimed, error } = await admin
    .from("push_sent")
    .upsert([{ user_id: uid, kind: `title:${t.title}`, night: "2100-01-01T00:00:00Z" }],
      { onConflict: "user_id,kind,night", ignoreDuplicates: true })
    .select("user_id");
  if (error) throw error;
  if (!claimed || claimed.length === 0) return [];
  const idx = Math.floor(Math.random() * LEVELUP_LINES.length);
  return (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(levelUpPayload(idx, mates.get(s.user_id) ?? "En vän", t.title, beerId)),
  }));
}

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;
const NONE = { sent: 0, failed: 0 };

// {event:"comehere", bar_name?, lat?, lng?}: "come here" to group-mates. Needs a live pin.
// The url points at the caller's pin, so it never shows more than the pin itself shows.
// bar_name is only used when the pin is precise (an approximate pin must not reveal the bar).
async function comeHere(admin: Admin, uid: string, b: Body) {
  const { data: beer, error } = await admin
    .from("beers").select("id, precise, stopped, expires_at")
    .eq("user_id", uid).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) throw error;
  if (!beer || beer.stopped) return { ...NONE, reason: "no_beer" };
  const mates = await mateNames(admin, uid);
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  if (!(await rateClaim(admin, uid, "comehere", RATE_SEC.comehere))) return { ...NONE, reason: "slow_down" };
  const bar = beer.precise ? cleanBarName(b.bar_name) : "";
  const idx = Math.floor(Math.random() * (bar ? COMEHERE_LINES : COMEHERE_NOBAR_LINES).length);
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(comeherePayload(idx, mates.get(s.user_id) ?? "En vän", bar, beer.id as number)),
  }));
  return jobs.length ? await sendAll(admin, jobs) : NONE;
}

// {event:"sos", lat, lng}: high priority push with the exact place, to group-mates only.
async function sos(admin: Admin, uid: string, b: Body) {
  if (!validPt(b.lat, b.lng)) return { ...NONE, reason: "bad_location" };
  const mates = await mateNames(admin, uid);
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  if (!(await rateClaim(admin, uid, "sos", RATE_SEC.sos))) return { ...NONE, reason: "slow_down" };
  const stamp = Date.now();
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(sosPayload(mates.get(s.user_id) ?? "En vän", b.lat as number, b.lng as number, stamp)),
  }));
  return jobs.length ? await sendAll(admin, jobs, 900) : NONE;
}

// {event:"msg", group_id}: push the caller's newest live message (< 5 min old) in that group.
async function msgPush(admin: Admin, uid: string, b: Body) {
  if (!isUuid(b.group_id)) return { ...NONE, reason: "bad_group" };
  const gid = b.group_id as string;
  const mates = await mateNames(admin, uid, gid); // empty when the caller is not a member
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  const nowIso = new Date().toISOString();
  const { data: msg, error } = await admin
    .from("group_msgs").select("id, body, created_at")
    .eq("group_id", gid).eq("user_id", uid).gt("expires_at", nowIso)
    .gt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!msg) return { ...NONE, reason: "no_msg" };
  if (!(await rateClaim(admin, uid, `msg:${gid}`, RATE_SEC.msg))) return { ...NONE, reason: "slow_down" };
  const { data: g } = await admin.from("groups").select("name").eq("id", gid).maybeSingle();
  // The sender's name is the same for every member of this one group.
  const { data: me } = await admin
    .from("group_members").select("display_name").eq("group_id", gid).eq("user_id", uid).maybeSingle();
  const namn = (me?.display_name as string) ?? "Någon";
  const payload = JSON.stringify(msgPayload(namn, msg.body as string, (g?.name as string) ?? "", gid));
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({ sub: s, payload }));
  return jobs.length ? await sendAll(admin, jobs, 600) : NONE;
}

// ---- v9 INKALLELSE ----

type Rally = {
  id: number; group_id: string; user_id: string; body: string; place: string | null;
  created_at: string; expires_at: string; closed: boolean;
};

/** Live, open rally by id, or null. */
async function loadRally(admin: Admin, rallyId: number): Promise<Rally | null> {
  const { data, error } = await admin
    .from("rallies").select("id, group_id, user_id, body, place, created_at, expires_at, closed")
    .eq("id", rallyId).eq("closed", false).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) throw error;
  return (data as Rally) ?? null;
}

// {event:"rally", rally_id}: the creator calls group-mates of that ONE group. Once per rally.
async function rallyPush(admin: Admin, uid: string, b: Body) {
  const rid = parseRallyId(b.rally_id);
  if (rid === null) return { ...NONE, reason: "no_rally" };
  const r = await loadRally(admin, rid);
  if (!r || r.user_id !== uid || Date.parse(r.created_at) <= Date.now() - 5 * 60 * 1000) {
    return { ...NONE, reason: "no_rally" };
  }
  const mates = await mateNames(admin, uid, r.group_id); // empty when the caller left the group
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  const { data: claimed, error } = await admin
    .from("push_sent")
    .upsert([{ user_id: uid, kind: `rally:${r.id}`, night: r.expires_at }],
      { onConflict: "user_id,kind,night", ignoreDuplicates: true })
    .select("user_id");
  if (error) throw error;
  if (!claimed || claimed.length === 0) return { ...NONE, reason: "already_sent" };
  const idx = Math.floor(Math.random() * RALLY_LINES.length);
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(rallyPayload(idx, mates.get(s.user_id) ?? "En vän", r.body, r.place, r.id)),
  }));
  return jobs.length ? await sendAll(admin, jobs, 1800) : NONE;
}

// {event:"rally_yes", rally_id}: tell the creator that the caller is on the way. Once per answer
// (atomic claim of rally_answers.notified). Never to the caller.
async function rallyYesPush(admin: Admin, uid: string, b: Body) {
  const rid = parseRallyId(b.rally_id);
  if (rid === null) return { ...NONE, reason: "no_rally" };
  const r = await loadRally(admin, rid);
  if (!r) return { ...NONE, reason: "no_rally" };
  if (r.user_id === uid) return { ...NONE, reason: "no_answer" };
  const { data: members, error: mErr } = await admin
    .from("group_members").select("user_id, display_name").eq("group_id", r.group_id);
  if (mErr) throw mErr;
  const nameOf = new Map<string, string>();
  for (const m of members ?? []) nameOf.set(m.user_id as string, m.display_name as string);
  if (!nameOf.has(uid) || !nameOf.has(r.user_id)) return { ...NONE, reason: "no_group" };
  const { data: claimed, error: cErr } = await admin
    .from("rally_answers").update({ notified: true })
    .eq("rally_id", r.id).eq("user_id", uid).eq("answer", "yes").eq("notified", false)
    .select("user_id");
  if (cErr) throw cErr;
  if (!claimed || claimed.length === 0) return { ...NONE, reason: "no_answer" };
  const { data: yesRows, error: yErr } = await admin
    .from("rally_answers").select("user_id").eq("rally_id", r.id).eq("answer", "yes");
  if (yErr) throw yErr;
  const yes = ((yesRows ?? []) as { user_id: string }[]).filter((x) => nameOf.has(x.user_id)).length;
  const idx = Math.floor(Math.random() * RALLY_YES_LINES.length);
  const payload = JSON.stringify(rallyYesPayload(idx, nameOf.get(uid) ?? "En vän", yes, r.id));
  const jobs = (await subsOf(admin, [r.user_id])).map((s) => ({ sub: s, payload }));
  return jobs.length ? await sendAll(admin, jobs, 1800) : NONE;
}

// ---- v10 CHECKA IN ----
// {event:"checkin", bar?}: "📍 Anton har anlänt till La Parma" to group-mates. Needs a live check-in
// made in the last 5 min (the bar name comes from that row, not from the body). 1 per 10 min per sender.
async function checkinPush(admin: Admin, uid: string, _b: Body) {
  const { data: ci, error } = await admin
    .from("checkins").select("bar_name, created_at, expires_at")
    .eq("user_id", uid).gt("expires_at", new Date().toISOString())
    .gt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString()).maybeSingle();
  if (error) throw error;
  if (!ci) return { ...NONE, reason: "no_checkin" };
  const mates = await mateNames(admin, uid);
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  if (!(await rateClaim(admin, uid, "checkin", RATE_SEC.checkin))) return { ...NONE, reason: "slow_down" };
  const bar = cleanBarName(ci.bar_name);
  const idx = Math.floor(Math.random() * CHECKIN_LINES.length);
  const stamp = Date.now();
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(checkinPayload(idx, mates.get(s.user_id) ?? "En vän", bar, stamp)),
  }));
  return jobs.length ? await sendAll(admin, jobs, 1800) : NONE;
}

// Status push to group-mates: "home" (Jag är hemma) or "pause" (öltorsk). Once per kind per night.
async function statusPush(admin: Admin, uid: string, kind: "home" | "pause") {
  const none = { sent: 0, failed: 0, status: 0 };
  const nowIso = new Date().toISOString();
  const { data: beer, error } = await admin
    .from("beers").select("id, expires_at, beer_count, other_count")
    .eq("user_id", uid).gt("expires_at", nowIso).maybeSingle();
  if (error) throw error;
  if (!beer || !(drinksOf(beer) >= 1)) return none;

  const { data: mine, error: mineErr } = await admin
    .from("group_members").select("group_id, display_name").eq("user_id", uid);
  if (mineErr) throw mineErr;
  if (!mine || mine.length === 0) return none;

  // Claim once per kind per night (anti-spam), only after we know there is a group.
  const { data: claimed, error: cErr } = await admin
    .from("push_sent")
    .upsert([{ user_id: uid, kind, night: beer.expires_at }], { onConflict: "user_id,kind,night", ignoreDuplicates: true })
    .select("user_id");
  if (cErr) throw cErr;
  if (!claimed || claimed.length === 0) return none;

  const nameByGroup = new Map<string, string>();
  for (const m of mine) nameByGroup.set(m.group_id as string, m.display_name as string);
  const { data: others, error: othersErr } = await admin
    .from("group_members").select("group_id, user_id")
    .in("group_id", [...nameByGroup.keys()]).neq("user_id", uid);
  if (othersErr) throw othersErr;
  const nameFor = new Map<string, string>();
  for (const o of others ?? []) {
    const name = nameByGroup.get(o.group_id as string);
    if (!name) continue;
    const prev = nameFor.get(o.user_id as string);
    if (prev === undefined || name < prev) nameFor.set(o.user_id as string, name);
  }
  if (nameFor.size === 0) return none;
  const { data: subs, error: subsErr } = await admin
    .from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", [...nameFor.keys()]);
  if (subsErr) throw subsErr;

  const lines = PAUSE_LINES;
  // v16: home uses HOME_LINES + SAFE_HOME_LINES (some with the time, "hemma kl. 01:32").
  const idx = Math.floor(Math.random() * (kind === "home" ? homeLineCount() : lines.length));
  const stampMs = Date.now();
  const body = kind === "home" ? "Kvällen är slut för den här soldaten." : "Pinnen är borta från kartan.";
  const jobs: Job[] = ((subs ?? []) as Sub[]).map((s) => ({
    sub: s,
    payload: JSON.stringify({
      title: kind === "home" ? homeTitle(idx, nameFor.get(s.user_id) ?? "En vän", stampMs)
        : fill(lines[idx], { namn: nameFor.get(s.user_id) ?? "En vän" }),
      body, url: "/", tag: `olnu-${beer.id}-${kind}`,
    }),
  }));
  if (jobs.length === 0) return none;
  const r = await sendAll(admin, jobs);
  return { ...r, status: jobs.length };
}

// ---- v12 KROGARNA ----
// {event:"tip", tip_id}: "📣 Anton tipsar: Kom till Pitchers!" to the other members of the tip's group.
// The tip row (send_tip RPC) must be the caller's, < 5 min old and not pushed yet (atomic claim).
// The RPC already limits tips to 1 per 5 min per user.
async function tipPush(admin: Admin, uid: string, b: Body) {
  const tid = parseRallyId(b.tip_id);
  if (tid === null) return { ...NONE, reason: "no_tip" };
  const { data: claimed, error } = await admin
    .from("bar_tips").update({ notified: true })
    .eq("id", tid).eq("user_id", uid).eq("notified", false)
    .gt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .select("id, group_id, bar_id, bar_name, body");
  if (error) throw error;
  const tip = claimed && claimed[0];
  if (!tip) return { ...NONE, reason: "no_tip" };
  const mates = await mateNames(admin, uid, tip.group_id as string);
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  const idx = Math.floor(Math.random() * TIP_LINES.length);
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(tipPayload(idx, mates.get(s.user_id) ?? "En vän", tip.bar_name as string,
      tip.body as string | null, tip.bar_id as string, tip.id as number)),
  }));
  return jobs.length ? await sendAll(admin, jobs, 1800) : NONE;
}

// {event:"takeover", bar_id}: "🏰 Ni har tagit över La Parma!" to the other members of the caller's group
// that owns the bar tonight. Needs a bar_takeovers row (note_takeover RPC) of tonight, < 10 min old,
// not pushed yet: so max 1 push per bar per group per night (atomic claim of `notified`).
async function takeoverPush(admin: Admin, uid: string, b: Body) {
  const barId = typeof b.bar_id === "string" ? b.bar_id.trim().slice(0, 80) : "";
  if (!barId) return { ...NONE, reason: "no_takeover" };
  const { data: mine, error: mErr } = await admin.from("group_members").select("group_id").eq("user_id", uid);
  if (mErr) throw mErr;
  const gids = (mine ?? []).map((m: { group_id: string }) => m.group_id);
  if (gids.length === 0) return { ...NONE, reason: "no_group" };
  const { data: claimed, error } = await admin
    .from("bar_takeovers").update({ notified: true })
    .eq("bar_id", barId).in("group_id", gids).eq("notified", false)
    .gt("night", new Date().toISOString())
    .gt("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .select("id, group_id, bar_id, bar_name");
  if (error) throw error;
  if (!claimed || claimed.length === 0) return { ...NONE, reason: "already_sent" };
  let sent = 0, failed = 0;
  for (const t of claimed) {
    const mates = await mateNames(admin, uid, t.group_id as string);
    if (mates.size === 0) continue;
    const { data: g } = await admin.from("groups").select("name").eq("id", t.group_id).maybeSingle();
    const idx = Math.floor(Math.random() * TAKEOVER_LINES.length);
    const payload = JSON.stringify(takeoverPayload(idx, (g?.name as string) ?? "", (t.bar_name as string) ?? "",
      t.bar_id as string, t.group_id as string));
    const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({ sub: s, payload }));
    if (jobs.length) { const r = await sendAll(admin, jobs, 1800); sent += r.sent; failed += r.failed; }
  }
  return { sent, failed };
}

// ---- v16 EFTERÅT ----
// {event:"medevac_check", check_id}: "🚑 Lisa kollar på Oskar" to group-mates of the checker who also share a
// group with the target, plus the target ("💚 Lisa kommer och kollar läget med dig"). Once per check
// (atomic medevac_checks.notified claim, row < 5 min old, caller = checker); else reason no_check.
async function medcheckPush(admin: Admin, uid: string, b: Body) {
  const cid = parseRallyId(b.check_id);
  if (cid === null) return { ...NONE, reason: "no_check" };
  const { data: claimed, error } = await admin
    .from("medevac_checks").update({ notified: true })
    .eq("id", cid).eq("checker", uid).eq("notified", false)
    .gt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .select("id, target, night");
  if (error) throw error;
  const row = claimed && claimed[0];
  if (!row) return { ...NONE, reason: "no_check" };
  const target = row.target as string;
  const mates = await mateNames(admin, uid);              // recipient -> checker's name
  const tNames = await mateNames(admin, target);          // recipient -> target's name
  const { data: beer } = await admin.from("beers").select("id").eq("user_id", target)
    .eq("expires_at", row.night).maybeSingle();
  const beerId = (beer?.id as number) ?? null;
  const ids = [...mates.keys()].filter((u) => u === target || tNames.has(u));
  if (ids.length === 0) return { ...NONE, reason: "no_group" };
  const idx = Math.floor(Math.random() * 1000);
  const jobs = (await subsOf(admin, ids)).map((s) => ({
    sub: s,
    payload: JSON.stringify(medcheckPayload(idx, mates.get(s.user_id) ?? "En vän",
      s.user_id === target ? null : (tNames.get(s.user_id) ?? null), beerId, cid)),
  }));
  return jobs.length ? await sendAll(admin, jobs, 1800) : NONE;
}

// {event:"voice", voice_id}: "🎙️ Anton skickade ett röstskål" to the other members of that group.
// The voice row must be the caller's, < 5 min old, not pushed (atomic claim); max 1 push per sender per group
// per 2 min (push_sent kind voice:<group>). Reasons: no_voice, no_group, slow_down.
async function voicePush(admin: Admin, uid: string, b: Body) {
  const vid = parseRallyId(b.voice_id);
  if (vid === null) return { ...NONE, reason: "no_voice" };
  const { data: claimed, error } = await admin
    .from("voice_msgs").update({ notified: true })
    .eq("id", vid).eq("user_id", uid).eq("notified", false)
    .gt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .select("id, group_id");
  if (error) throw error;
  const v = claimed && claimed[0];
  if (!v) return { ...NONE, reason: "no_voice" };
  const gid = v.group_id as string;
  const mates = await mateNames(admin, uid, gid);
  if (mates.size === 0) return { ...NONE, reason: "no_group" };
  if (!(await rateClaim(admin, uid, `voice:${gid}`, 120))) return { ...NONE, reason: "slow_down" };
  const { data: g } = await admin.from("groups").select("name").eq("id", gid).maybeSingle();
  const idx = Math.floor(Math.random() * VOICE_LINES.length);
  const jobs = (await subsOf(admin, [...mates.keys()])).map((s) => ({
    sub: s,
    payload: JSON.stringify(voicePayload(idx, mates.get(s.user_id) ?? "En vän", (g?.name as string) ?? "", gid)),
  }));
  return jobs.length ? await sendAll(admin, jobs, 1800) : NONE;
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

    // Light cleanup: anonymous heat events older than 10 days (ghost_points shows 1-8 days).
    if (Math.random() < 0.05) {
      const { error } = await admin.from("beer_events").delete()
        .lt("created_at", new Date(Date.now() - 10 * 86_400_000).toISOString());
      if (error) console.error("beer_events cleanup failed", error);
    }

    // Optional body {event: ...}. Old clients send no body (= beer push).
    let event = "";
    let body: Body = {};
    try {
      const bj = await req.json();
      if (bj && typeof bj === "object") body = bj as Body;
      event = typeof body.event === "string" ? body.event : "";
    } catch (_e) { event = ""; }
    if (event === "home" || event === "pause") {
      return json(await statusPush(admin, uid, event));
    }
    if (event === "comehere") return json(await comeHere(admin, uid, body));
    if (event === "sos") return json(await sos(admin, uid, body));
    if (event === "msg") return json(await msgPush(admin, uid, body));
    if (event === "rally") return json(await rallyPush(admin, uid, body));
    if (event === "rally_yes") return json(await rallyYesPush(admin, uid, body));
    if (event === "checkin") return json(await checkinPush(admin, uid, body));
    if (event === "tip") return json(await tipPush(admin, uid, body));
    if (event === "takeover") return json(await takeoverPush(admin, uid, body));
    if (event === "medevac_check") return json(await medcheckPush(admin, uid, body));
    if (event === "voice") return json(await voicePush(admin, uid, body));

    // 2. Caller's beer. Nothing to do unless it is live and was accepted in the last 5 min.
    const nothing = { sent: 0, failed: 0, friends: 0, kaos: 0 };
    const { data: beer, error: beerErr } = await admin
      .from("beers")
      .select("id, lat, lng, beer_count, other_count, notified_level, stopped, expires_at, updated_at")
      .eq("user_id", uid)
      .maybeSingle();
    if (beerErr) throw beerErr;
    const now = Date.now();
    const since = new Date(now - 5 * 60 * 1000).toISOString();
    if (
      !beer || !(drinksOf(beer) >= 1) || beer.stopped ||
      Date.parse(beer.expires_at) <= now || Date.parse(beer.updated_at) <= Date.parse(since)
    ) {
      return json(nothing);
    }

    const jobs: Job[] = [];
    let friendCount = 0;

    // Lifetime beers -> title (migration 0007). Missing table -> no title, pushes still work.
    let total = -1;
    try {
      total = await lifetimeTotal(admin, uid);
    } catch (e) {
      console.error("lifetime total failed", e);
    }
    const titel = total >= 0 ? titleFor(total).title : "";

    // A) FRIENDS: milestone push, once per level per night.
    // v17: levels count all drinks (beers + other drinks). Migration 0023 set notified_level for
    // tonight's rows to their current level, so the switch sends no late pushes.
    const level = milestoneLevel(drinksOf(beer));
    if (level > 0 && (beer.notified_level ?? 0) < level) {
      // Atomic claim: a concurrent call (or a retry) finds notified_level already >= level.
      const { data: claimed, error: claimErr } = await admin
        .from("beers")
        .update({ notified_level: level })
        .eq("user_id", uid)
        .lt("notified_level", level)
        .eq("stopped", false)
        .gt("updated_at", since)
        .gt("expires_at", new Date(now).toISOString())
        .select("id");
      if (claimErr) throw claimErr;
      if (claimed && claimed.length > 0) {
        const fj = await friendJobs(admin, uid, claimed[0].id as number, level as 1 | 5 | 10, titel);
        friendCount = fj.length;
        jobs.push(...fj);
      }
    }

    // B) KAOS I STAN: every call; cheap when the area is calm.
    let kaosCount = 0;
    try {
      const k = await kaosJobs(admin, uid, beer);
      kaosCount = k.jobs.length;
      jobs.push(...k.jobs);
    } catch (e) {
      // Friend pushes must still go out if the area check fails (e.g. migration 0006 not run yet).
      console.error("kaos check failed", e);
    }

    // C) LEVEL-UP: new title -> group-mates, once per title per user ever.
    let levelUpCount = 0;
    if (total > 0) {
      try {
        const lj = await levelUpJobs(admin, uid, beer.id as number, total);
        levelUpCount = lj.length;
        jobs.push(...lj);
      } catch (e) {
        console.error("level-up check failed", e);
      }
    }

    if (jobs.length === 0) return json(nothing);
    const { sent, failed } = await sendAll(admin, jobs);
    return json({ sent, failed, friends: friendCount, kaos: kaosCount, levelup: levelUpCount });
  } catch (e) {
    console.error("notify-group error", e);
    return json({ error: "internal_error" }, 500);
  }
});
