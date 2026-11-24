// E8 (lane i18n, 24 Nov 2026): "does this visible text look Swedish?" Used by tests/unit/i18n.test.mjs (static scan of
// the JS) and tests/e2e/i18n-pw.js (the English screens). CommonJS so both can load it.
// A text is Swedish when it has a word with å/ä/ö, or a common Swedish word that is not also an English word.
// PROPER = names that stay as they are in English (the brand, places, people in the test data, Swedish institutions).
"use strict";
const WORDS = ("och inte att för med på du din ditt dina dig jag mig vi oss ni er dom det är var vad vem hur när som men eller " +
  "om till från nu ute ikväll kväll här där alla inga ingen inget visa stäng spara avbryt skicka grupp grupper gruppen vänner " +
  "vän kompis kompisen karta kartan krog krogen krogar kolla lugnt plats platsen exakt område sök hem hemma mer mindre ja nej tack " +
  "hej gänget ställe ställen öppet stängt idag igår imorgon sen nyss timme timmar minuter igen också bara redan snart välj lägg ta " +
  "kom ser får kan ska vill har hade blir finns sparad sparat inställningar profil konto notiser ljud hjälp rapportera fel ny nytt " +
  "nya dag natt vecka öppna logga ut av ett mitt mina sin dagens nära bort tillbaka klar klart fler folk många nån någon något " +
  "pågår senaste ölen öl dricka dryck drycker kvällen namn ändra radera bjud vill gå inne utan också tryck knappen dela läs " +
  "skriv ditt vilken vilka varje mellan efter innan medan gärna aldrig alltid kanske ganska väldigt lite mycket stad staden " +
  "området ikon kartlager kartstil dialekt språk engelska svenska").split(/\s+/).filter(Boolean);
const NOT_SV = new Set(["in", "an", "a", "i", "be", "bar", "barer", "top"]);   // never treat these as Swedish
const W = new Set(WORDS.filter((w) => !NOT_SV.has(w)));
const PROPER = ["PintsNow", "TuNeLA", "Systembolaget", "Systemet", "Swish", "BankID", "Ludvika", "Stockholm", "Göteborg", "Malmö",
  "Dalarna", "Sverige", "Mapbox", "OpenStreetMap", "Pitchers", "La Parma Pub & Restaurang", "La Parma", "Lobbybaren",
  "Grand Hotel Elektra", "Grekiska Grill & Bar", "Grekiska", "Ludvika Lager", "Oskar", "Lisa", "Ida", "Robban", "Kalle K", "Sara",
  "Anton", "Ronny", "Ragge", "Kasttjärnsparken", "Eriksgatan", "Bergslagsgatan", "Högbergsgatan", "Mossgatan"];
function strip(t) {
  let s = " " + String(t || "") + " ";
  for (const p of PROPER) s = s.split(p).join(" ");
  return s;
}
// the Swedish words found in a text (lower case). [] = looks fine.
function svWords(t, extraProper) {
  let s = strip(t);
  for (const p of extraProper || []) if (p) s = s.split(p).join(" ");
  const out = [];
  for (const m of s.toLowerCase().matchAll(/[a-zåäöéü]+/g)) {
    const w = m[0];
    if (/[åäö]/.test(w) || W.has(w)) out.push(w);
  }
  return out;
}
const isSv = (t, extra) => svWords(t, extra).length > 0;
module.exports = { svWords, isSv, PROPER, WORDS: W };
