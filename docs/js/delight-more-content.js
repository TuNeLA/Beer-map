/* Öl Nu v26 — texts for delight-more.js: 16 more rare map events + 8 easter eggs. Same shape as delight-content.js
   (events.<key>.sv {cap:[…], tap:[…]}, .en {cap, tap}). Dalmål + military, "ä" for the dialect é. Keep keys stable. */
window.DELIGHT_MORE_CONTENT = {
  events: {
    varg: {
      sv: { cap: ["🐺 Vargflock i {sektor}! Tre stycken. De letar efter en fjärde till pubquizen.",
                  "🐺 Spaningen rapporterar varg i skogskanten. De ylar på dalmål: 'aaauuu-hä'.",
                  "🐺 Fyrbenta förband på nattmarsch. Ingen fara. De ä veganer. Påstår de."],
            tap: ["🐺 Ledarvargen tittar på dig och nickar. Du ä nu med i flocken. Ingen återbetalning.",
                  "🐺 Vargen ylar en gång till, bara för dig. Grannarna klagar inte. De ä vargar.",
                  "🐺 'Vi ä int' farliga, vi ä bara törstiga', säger vargen. Samma här."] },
      en: { cap: "🐺 A wolf pack crosses {sektor}. They need a fourth for the pub quiz.", tap: "🐺 The lead wolf nods. You're in the pack now." }
    },
    rav: {
      sv: { cap: ["🦊 En räv tittar fram vid kartkanten. Han har koll på korvkiosken.",
                  "🦊 Mickel Räv på spaning i {sektor}. Listig, rödhårig, int' bjuden.",
                  "🦊 Rävspaning! Han har sett dig. Du har sett honom. Ingen säger nåt."],
            tap: ["🦊 Räven blinkar. Han vet nåt du int' vet. Typ var den billigaste korven finns.",
                  "🦊 'Vad säger räven?' Han säger 'skål'. Mysteriet löst.",
                  "🦊 Räven försvann med en pommes. Ingen såg hur."] },
      en: { cap: "🦊 A fox peeks in at the map edge. He knows where the hot dog stand is.", tap: "🦊 What does the fox say? 'Cheers.' Mystery solved." }
    },
    bandy: {
      sv: { cap: ["🏒 Bandyspelare på isen i {sektor}! Klubban högt, mössan på, termosen full.",
                  "🏒 Israpport: bandymatch i full gång. Publiken: två kråkor och en farbror.",
                  "🏒 Vinterförband på skridskor! Dalarnas hemliga vapen: bandy och kaffe."],
            tap: ["🏒 MÅÅÅL! Bollen gick rakt i kiosken. Den räknas.",
                  "🏒 Du fick en kopp kaffe ur termosen. Det ä 1987 års kaffe. Det ä bäst.",
                  "🏒 Domaren blåser av. Ingen vet varför. Han ville bara blåsa."] },
      en: { cap: "🏒 Bandy players on the ice in {sektor}! Thermos full.", tap: "🏒 GOAL! Straight into the kiosk. It counts." }
    },
    kanot: {
      sv: { cap: ["🛶 Kanot på Dalälven! Paddlarna har int' sett en karta sen i fredags.",
                  "🛶 Amfibieförband i {sektor}: en kanot, två paddlar, noll flytvästar… nej vänta, två.",
                  "🛶 Någon paddlar förbi. Hon säger att hon ska till Gävle. Hon ä i Ludvika."],
            tap: ["🛶 Paddlaren vinkar. Kanoten gungar. Ingen ramlade i. Bra jobbat.",
                  "🛶 'Ä hä långt till närmsta krog?' Ja. Men det ä nedströms.",
                  "🛶 Du fick en vattenstänk-medalj. Den syns int', men den finns."] },
      en: { cap: "🛶 A canoe on the river! The paddlers lost the map on Friday.", tap: "🛶 Nobody fell in. Good job." }
    },
    buss: {
      sv: { cap: ["🚌 Supporterbussen rullar genom {sektor}! Halsdukar ute, sången falsk, stämningen 10/10.",
                  "🚌 Transportförband på väg till bortamatch. Sist på bussen bär kylväskan.",
                  "🚌 En buss full med folk som sjunger. Chauffören har hörlurar. Klokt."],
            tap: ["🚌 Bussen tutar! Hela bussen vinkar. Du ä hedersmedlem i klacken nu.",
                  "🚌 'Ä hä här vi ska av?' Nej. Det ä aldrig här.",
                  "🚌 Någon kastade en halsduk till dig. Den luktar korv. Bra tecken."] },
      en: { cap: "🚌 The supporters' bus rolls through {sektor}! Singing badly.", tap: "🚌 The whole bus waves. You're in the stand now." }
    },
    blabar: {
      sv: { cap: ["🫐 Blåbärsregn över {sektor}! Skogen har överskott. Ta med en hink.",
                  "🫐 Luftlandsättning av blåbär. Försvarsmakten kallar det 'operation sylt'.",
                  "🫐 Det regnar blåbär. Dalarna i ett nötskal. Eller bärskal."],
            tap: ["🫐 Du fångade ett blåbär! Fingrarna ä blå i tre dar nu. Bär det med stolthet.",
                  "🫐 Mormor skulle vara stolt. Hon skulle också säga att du plockar för långsamt.",
                  "🫐 Ett blåbär, fem mygg. Det ä växelkursen i skogen."] },
      en: { cap: "🫐 It's raining blueberries over {sektor}!", tap: "🫐 Caught one! Blue fingers for three days." }
    },
    lov: {
      sv: { cap: ["🍂 Höstlöv faller över kartan. Dalarna byter uniform: från grön till orange.",
                  "🍂 Lövoffensiv i {sektor}! Räfsorna ä mobiliserade.",
                  "🍂 Det ä höst. Löven faller. Kepsen åker på. Ölen ä fortfarande kall."],
            tap: ["🍂 Du fångade ett löv i luften. Det betyder tur hela hösten. Sägs det.",
                  "🍂 Lövet var formad som en ölsejdel. Slumpen? Vi tror int' på slumpen.",
                  "🍂 Ett löv landade på din telefon. Det ä nu ditt husdjur."] },
      en: { cap: "🍂 Autumn leaves fall over the map. Dalarna changes uniform.", tap: "🍂 Caught a leaf mid-air. Good luck all autumn." }
    },
    mus: {
      sv: { cap: ["🐁 En mus springer över kartan med en kapsyl. Han har uppenbarligen en plan.",
                  "🐁 Underrättelse: minsta soldaten i {sektor} ä på uppdrag. Han ä snabb.",
                  "🐁 Något litet springer förbi. Det var en mus. Eller en väldigt liten tomte."],
            tap: ["🐁 Musen stannade och gav dig kapsylen. Sen sprang han. Det var en gåva.",
                  "🐁 Pip! Det betyder 'tack för senast' på musspråk.",
                  "🐁 Du missade. Musen ä snabbare än ölen i baren."] },
      en: { cap: "🐁 A mouse runs across the map with a bottle cap.", tap: "🐁 He gave you the cap. It was a gift." }
    },
    raket: {
      sv: { cap: ["🚀 SÄLLSYNT: En raket från Esrange passerar {sektor}. Den har med sig en lättöl till rymden.",
                  "🚀 Rymdförbandet testar. Nedräkningen gick på dalmål: 'tre, två, ä', nu!'",
                  "🚀 Raketuppskjutning! Målet: månen. Reservmålet: en kebab i Borlänge."],
            tap: ["🚀 Raketen svarade 'Över'. Du ä nu officiell markkontroll.",
                  "🚀 Du vinkade till astronauten. Hon vinkade tillbaka. Antagligen.",
                  "🚀 Rymden ä stor. Men inte större än stämningen i Dalarna."] },
      en: { cap: "🚀 RARE: a rocket passes {sektor}. It carries a light beer to space.", tap: "🚀 'Roger.' You're ground control now." }
    },
    hare: {
      sv: { cap: ["🐇 En hare skuttar förbi. Han ä sen till nåt. Som vanligt.",
                  "🐇 Snabbförband i {sektor}! En hare på väg till efterfesten.",
                  "🐇 Haren springer. Ingen jagar honom. Han springer ändå. Motion."],
            tap: ["🐇 Haren stannade, tittade, och sprang åt fel håll. Vi känner igen oss.",
                  "🐇 Du fick ett hareöra-vink. Ovanligt. Ta en skärmdump.",
                  "🐇 'Ingen tid, ingen tid!' Haren har en klocka. Den går fel."] },
      en: { cap: "🐇 A hare hops by. Late, as usual.", tap: "🐇 He stopped, looked, and ran the wrong way." }
    },
    fyrverkeri: {
      sv: { cap: ["🎆 Fyrverkeri över {sektor}! Gott nytt år från hela Dalregementet!",
                  "🎆 Raketer i luften! Hundarna gömmer sig, folket jublar.",
                  "🎆 Himlen brinner (fint). Nyårslöftet: fler skål, färre bakisar."],
            tap: ["🎆 PANG! Den där var för dig. Gott nytt år, soldat.",
                  "🎆 Du fick ett tomtebloss. Håll i den rätta änden.",
                  "🎆 Raketen skrev 'SKÅL' på himlen. Nästan. Det stod 'SKL'."] },
      en: { cap: "🎆 Fireworks over {sektor}! Happy new year!", tap: "🎆 BANG! That one was for you." }
    },
    pingvin: {
      sv: { cap: ["🐧 MYCKET SÄLLSYNT: En pingvin har rymt från Kolmården och tagit tåget till Dalarna.",
                  "🐧 Okänd svartvit soldat marscherar i {sektor}. Han har frack. Han ä redo för fest.",
                  "🐧 En pingvin! Han säger att han ä här för kylan. Och barerna."],
            tap: ["🐧 Pingvinen bugar. Han ä den mest välklädda gästen i stan ikväll.",
                  "🐧 Han glider på magen över kartan. Du ä avundsjuk. Erkänn.",
                  "🐧 'Ä hä kallt nog?' Han ä besviken. Det ä för varmt."] },
      en: { cap: "🐧 VERY RARE: a penguin escaped the zoo and took the train to Dalarna.", tap: "🐧 He bows. Best-dressed guest in town." }
    },
    vasman: {
      sv: { cap: ["🧖 En bastubadare stiger upp ur Väsman. Ångan ryker. Han ser nöjd ut.",
                  "🧖 Vinterbad i {sektor}! Någon har hoppat i isvaken. Frivilligt.",
                  "🧖 Isvaksdoppet klart. Nu bastu. Sen öl. Den heliga ordningen."],
            tap: ["🧖 'Hä ä int' kallt, hä ä uppfriskande', säger han. Han ä blå.",
                  "🧖 Du fick en björkruska. Använd den klokt.",
                  "🧖 Han vinkar och dyker igen. Vi ses i bastun."] },
      en: { cap: "🧖 A winter swimmer rises from the lake. Steam everywhere.", tap: "🧖 'It's not cold, it's refreshing.' He is blue." }
    },
    fallskarm: {
      sv: { cap: ["🪂 Fallskärmsjägarna landar över {sektor}! De har med sig chips.",
                  "🪂 Luftlandsättning! Mål: närmaste bar. Ingen rapporterad saknad.",
                  "🪂 Skärmar på himlen. Någon ropar 'GERONIMOOO' på dalmål: 'JÄSSSSES'."],
            tap: ["🪂 En jägare landade på taket. Han säger att det var planen.",
                  "🪂 Du fick ett vingmärke. Du har int' hoppat, men du var med i andanden.",
                  "🪂 'Hoppa sa dom, kul sa dom.' Det var kul."] },
      en: { cap: "🪂 Paratroopers land over {sektor}! They brought crisps.", tap: "🪂 One landed on the roof. He says it was the plan." }
    },
    isbjorn: {
      sv: { cap: ["🐻‍❄️ SÄLLSYNT: En isbjörn har gått vilse i {sektor}. Han letar efter Svalbard. Det ä åt andra hållet.",
                  "🐻‍❄️ Vit jätte på kartan! Han säger att han bara ska köpa mjölk.",
                  "🐻‍❄️ Isbjörnsvarning! Han ä snäll. Han vill bara ha en kall öl. Den kallaste."],
            tap: ["🐻‍❄️ Isbjörnen kramade dig. Virtuellt. Det var mjukt.",
                  "🐻‍❄️ 'Ä hä Dalarna? Hä ä ju varmt!' Han tar av sig halsduken.",
                  "🐻‍❄️ Han viftade med tassen. Det var antingen hej eller skål."] },
      en: { cap: "🐻‍❄️ RARE: a polar bear got lost in {sektor}. Svalbard is the other way.", tap: "🐻‍❄️ He waved. Either hello or cheers." }
    },
    svamp: {
      sv: { cap: ["🍄 Kantarellspaning i {sektor}! Ställena ä hemliga. Kartan ser inget. Kartan säger inget.",
                  "🍄 En svamp svävar förbi. Den ä int' giftig. Den ä bara festlig.",
                  "🍄 Höstens underrättelse: svampen ä uppe. Mormors ställe ä fortfarande hemligt."],
            tap: ["🍄 Du hittade ett hemligt kantarellställe! Vi har glömt det redan. Lovar.",
                  "🍄 Svampen blinkade. Okej, det ä kanske dags att gå hem.",
                  "🍄 Smör, stekpanna, toast. Du vet vad som ska göras."] },
      en: { cap: "🍄 Chanterelle recon in {sektor}! The spots are secret.", tap: "🍄 You found a secret spot! We forgot it already." }
    }
  },
  /* ---------- easter eggs (caption head + lines) ---------- */
  eggs: {
    ticker: { head: { sv: "📡 TICKERN HACKAD", en: "📡 TICKER HACKED" },
      sv: ["Du tryckte på nyheterna fem gånger. Redaktionen ä smickrad.", "Nyhetsbyrån Dalarna tackar för ditt intresse. Fler nyheter kommer när nån dricker.",
           "Tickern blinkade tillbaka. Det var int' meningen. Den ä blyg.", "BREAKING: En person trycker på tickern. Mer om detta senare."],
      en: ["You tapped the news five times. The newsroom is flattered."] },
    count: { head: { sv: "🔢 RÄKNEVERKET", en: "🔢 THE COUNTER" },
      sv: ["Du räknar själv? Räkneverket räknar rätt. Det har gått kurs.", "Fyra tryck på räknaren. Den räknade dem också.",
           "Räknaren säger: 'Jag ä int' en knapp, jag ä en institution.'"], en: ["Counting yourself? The counter has it covered."] },
    leet: { head: { sv: "💻 13:37", en: "💻 13:37" },
      sv: ["Klockan ä 13:37. Du ä nu officiellt en öl-hacker.", "13:37 – hackertid. Lunchölen ä int' rekommenderad. Kaffet ä det."],
      en: ["It's 13:37. You are now an official beer hacker."] },
    midnight: { head: { sv: "🕛 SPÖKSTUNDEN", en: "🕛 MIDNIGHT" },
      sv: ["Midnatt. Spökena i Dalarna vaknar. De vill också ha en öl.", "Klockan slog tolv. Askungen gick hem. Du ä kvar. Respekt (drick vatten).",
           "Midnattsrapport: dagen ä slut, natten ä ung, vattnet ä gratis."], en: ["Midnight. The ghosts of Dalarna wake up."] },
    world: { head: { sv: "🌍 GLOBAL SPANING", en: "🌍 GLOBAL RECON" },
      sv: ["Hela världen på en skärm. Dalarna ä fortfarande mittpunkten. Det ä vetenskap.", "Du zoomade ut så långt det går. Världen törstar. Dalarna först.",
           "Satellitläge aktiverat. Jorden ä rund, ölen ä kall."], en: ["The whole world on one screen. Dalarna is still the centre."] },
    solo: { head: { sv: "🕯️ MINNESPLATS", en: "🕯️ MEMORIAL" },
      sv: ["Här låg nattklubben Solo. Vila i frid. Dansgolvet minns dig.", "Solo, Ludvika. Stängd sen länge. Men legenderna lever.",
           "En tyst minut för Solo. … Okej, det räcker. Skål!"], en: ["Here was nightclub Solo. Rest in peace."] },
    vatten: { head: { sv: "💧 VATTENLARM", en: "💧 WATER ALERT" },
      sv: ["Någon sa vatten! Dalregementet ä stolt. Drick ett glas till.", "Vatten nämnt i chatten. Hydreringsbonus: +10 i livet.",
           "💧 Klokt ord. Vatten ä hemliga vapnet för en bra morgon."], en: ["Someone said water! The regiment is proud."] },
    dalarna: { head: { sv: "🐎 DALAKRAFT", en: "🐎 DALA POWER" },
      sv: ["Någon skrev Dalarna. Dalahästen hörde det.", "Dalarna nämnt! Kavalleriet rycker ut."],
      en: ["Someone wrote Dalarna. The horse heard it."] }
  }
};
