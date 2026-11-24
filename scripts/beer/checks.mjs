// Beer data rules + audit (lane beerlist, 24 Nov 2026). Used by scripts/beer/build-data.mjs (the rules) and by
// tests/unit/beerdata.test.mjs (the audit of the shipped docs/data/beer/*.json), so a bad row cannot come back.
// Why: "A ship full of IPA" showed "0,0 %". Open Food Facts had it in the category "non-alcoholic beers" with alcohol 0
// (the form's empty default), but it is the normal IPA (the alcohol-free one is a separate product, "... Alcohol Free").
// Rule: an alcohol-free mark needs evidence. Without it the beer gets NO strength (we show nothing, never a wrong 0 %).
// Safety direction: a strong beer shown as alcohol-free is the dangerous error; an alcohol-free beer with no mark is not.

export const MAX_ABV = 16;

// evidence in the name that a beer is alcohol-free (sv, no, da, fi, de, fr, it, es, en)
export const AF_NAME_RE = new RegExp([
  "alkohol ?fri", "akoholfri", "alcohol[- ]?free", "alkoholfrei", "alkoholiton", "analcolica", "sans alcool", "sin alcohol",
  "non[- ]?alc", "\\balc\\.? ?0\\b", "\\b0[.,]0\\b", "(?:^|[^\\d.,])0(?:[.,][0-5])?\\s*%", "\\bzero\\b", "\\buten\\b(?! tilsatt)",
  "\\bhelt fri\\b", "\\bfri (?:ipa|pils|lager|øl|öl)\\b", "\\bnolo\\b", "luovutusolut", "\\b0 alc", "\\bcero\\b", "nealko",
  "alkoholit+om", "no buzz", "\\balko\\.? ?fri"
].join("|"), "i");
// brands that make only alcohol-free beer
export const AF_BRAND_RE = /\b(?:munkholm|clausthaler)\b/i;
// a name that says "strong": never alcohol-free on a guess
export const STRONG_NAME_RE = /\b(?:imperial|double|dubbel|tripel|triple|quad(?:rupel)?|barley ?wine|dipa|iipa|tipa)\b/i;
// a name that says "light / low strength": a low ABV is real
export const LIGHT_RE = /l[äa]tt|\blett|light|\blite\b|\bmild\b|folk[öo]l|kevyt|\blow\b|klass ?(?:i|1|ii|2)\b/i;
// not a drink at all (seen: "Lager eddike" = lager vinegar)
export const NOT_DRINK_RE = /\b(?:eddike|ättika|vinegar|vinaigre|essig|aceto)\b/i;

// one alcohol-free decision for the build (raw OFF row) and the audit (shipped row)
// b: { name, brewery, abv (raw number or null), af (the source says alcohol-free) }
export function afOk(b) {
  if (!b.af) return false;
  const txt = String(b.name || "") + " " + String(b.brewery || "");
  if (AF_NAME_RE.test(b.name || "") || AF_BRAND_RE.test(txt)) return true;
  if (STRONG_NAME_RE.test(b.name || "")) return false;
  const a = typeof b.abv === "number" && isFinite(b.abv) ? b.abv : null;
  return a != null && a > 0 && a <= 0.5;   // a real low number (0,3 %); an exact 0 is often the empty default of the source
}

// a beer whose name is only a big brand ("Heineken Bier", "Corona Alus", "Staropramen st 330") had no style: it gets the brand's
// flagship style as a guess (confidence low, the app says "(gissning)"). Any other word in the name ("Dunkel", "Radler", "0") = no guess.
const FLAG = { heineken: "ljus-lager", amstel: "ljus-lager", carlsberg: "ljus-lager", tuborg: "ljus-lager", peroni: "ljus-lager", nastro: "ljus-lager",
  staropramen: "ljus-lager", corona: "ljus-lager", stella: "ljus-lager", saku: "ljus-lager", karhu: "ljus-lager", koff: "ljus-lager", frydenlund: "ljus-lager",
  ringnes: "ljus-lager", aass: "ljus-lager", falcon: "ljus-lager", pripps: "ljus-lager", norrlands: "ljus-lager", mariestads: "ljus-lager", spendrups: "ljus-lager",
  kronenbourg: "ljus-lager", budweiser: "ljus-lager", estrella: "ljus-lager", moretti: "ljus-lager", poretti: "ljus-lager", olvi: "ljus-lager",
  urquell: "tjeckisk-pilsner", guinness: "stout", hoegaarden: "witbier", erdinger: "hefeweizen", paulaner: "hefeweizen", franziskaner: "hefeweizen",
  weihenstephaner: "hefeweizen" };
const FLAG_OK = new Set(("beer bier biere birra cerveza cervesa ol olut alus piwo pivo premium original flaske flaska bottle can cans boks burk st stk " +
  "sklo blik plech x l cl ml artois azzurro azzuro classic the guld bla galicia damm pilsner").split(" "));
export function flagshipStyle(name) {
  const w = fold(name).split(" ").filter(Boolean), brand = w.find((x) => FLAG[x]);
  if (!brand) return null;
  return w.every((x) => FLAG[x] || FLAG_OK.has(x) || (/^\d+$/.test(x) && x !== "0")) ? FLAG[brand] : null;
}

// words for "is this the same beer": the name, folded
export function fold(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "o").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
const CO = new Set(("as ab a s sa bv b v ag gmbh ltd inc co oy aps nv srl spa plc the de la le and och og bryggeri brewery brewing brewers " +
  "brouwerij brouwerijen brauerei bryghus bryggerier group beer bier ol olut").split(" "));
function brandWords(brewery) { return fold(brewery).split(" ").filter((w) => w.length >= 3 && !CO.has(w)); }
// a and b: { name, brewery }. Same folded name AND (same brewery, or the name holds the brand of one of them):
// "Heineken" by Heineken = "Heineken" by Hansa Borg (licence brewer); "Juicy IPA" by Ringnes != "Juicy IPA" by Carlsberg.
export function sameBeer(a, b) {
  const n = fold(a.name); if (!n || n !== fold(b.name)) return false;
  if (fold(a.brewery) === fold(b.brewery)) return true;
  const words = " " + n + " ";
  return brandWords(a.brewery).concat(brandWords(b.brewery)).some((w) => words.indexOf(" " + w + " ") >= 0);
}

// the audit of the shipped data. beers = beers.json, styles = styles.json, img = Set of file names in img/ (or null)
// returns a list of problems ("<kind> <id> <name>: <why>"); an empty list = clean
export function audit(beers, styles, img) {
  const out = [], st = {}, ids = new Set(), byName = new Map();
  for (const s of styles.styles || []) st[s.id] = s;
  const rows = (beers.rows || []).map((r) => Object.fromEntries(beers.cols.map((c, i) => [c, r[i]])));
  const say = (k, r, why) => out.push(k + " " + r.id + " " + r.name + ": " + why);
  for (const r of rows) {
    const a = r.abv, s = st[r.style], rng = s && s.abv;
    if (ids.has(r.id)) say("dup-id", r, "the same id twice"); ids.add(r.id);
    if (!r.name || (String(r.name).match(/\p{L}/gu) || []).length < 2) say("name", r, "no real name");
    if (NOT_DRINK_RE.test(r.name)) say("not-drink", r, "not a drink");
    if (a != null && (typeof a !== "number" || !isFinite(a) || a < 0 || a > MAX_ABV)) say("abv", r, "impossible ABV " + a);
    else if (a != null && !r.af && a < 0.6) say("abv0", r, a + " % on a beer that is not alcohol-free");
    else if (a != null && r.af && a > 0.5) say("af-abv", r, "alcohol-free but " + a + " %");
    else if (a != null && rng && !r.af && a > rng[1] + 4) say("abv-hi", r, a + " % is far above the style " + r.style);
    else if (a != null && rng && !r.af && a < rng[0] - 2 && !LIGHT_RE.test(r.name)) say("abv-lo", r, a + " % is far below the style " + r.style);
    if (r.af && !afOk({ name: r.name, brewery: r.brewery, abv: a, af: 1 })) say("af", r, "alcohol-free with no evidence (" + a + " %)");
    if (r.style && !s) say("style", r, "unknown style " + r.style);
    if (r.style === "alkoholfri" && !r.af) say("style-af", r, "style alkoholfri on a beer that is not marked alcohol-free");
    if (r.af && !r.style) say("style-af", r, "alcohol-free with no style");
    if (r.photo && !r.credit) say("photo", r, "a photo with no credit");
    if (img && r.photo && !img.has(r.id + ".jpg")) say("photo", r, "photo file missing");
    const k = fold(r.name), l = byName.get(k) || [];
    for (const o of l) if (sameBeer(o, r)) say("dup", r, "the same beer as " + o.id);
    l.push(r); byName.set(k, l);
  }
  if (img) for (const f of img) if (!ids.has(f.replace(/\.jpg$/, ""))) out.push("photo " + f + ": a file with no beer");
  for (const [a, k] of Object.entries(beers.alias || {})) {
    if (!ids.has(String(k))) out.push("alias " + a + ": points to a missing beer " + k);
    if (ids.has(a)) out.push("alias " + a + ": is also a beer row");
  }
  return out;
}
