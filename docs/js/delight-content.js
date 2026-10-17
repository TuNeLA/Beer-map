/* Öl Nu — "delight" texts (Swedish with dalmål + military parody, short English fallbacks).
   window.DELIGHT_CONTENT. Used by js/delight.js. All lines are original. No real people. Never asks anyone to drink more.
   {sektor} = nearest town ("Ludvika"), {namn} = the user's callsign. */
window.DELIGHT_CONTENT = {
  /* ---------- 1. Rare map events: caption lines (one is picked) + bonus lines when the sprite is tapped ---------- */
  events: {
    alg: {
      sv: { cap: ["⚠️ ÄLGVARNING – sektor {sektor}. Kontakten é stor, brun och har företräde.",
                  "🫎 Älg på kartan! Han har int' sökt tillstånd. Ingen har vågat säga nåt.",
                  "🫎 Fiendens stridsvagn identifierad. Visade sig va' en älg. Larmet avblåst."],
            tap: ["🫎 BRÖÖL! Älgen nickar åt dig. Du é nu hedersmedlem i jaktlaget.",
                  "🫎 Älgen tittar på dig. Länge. Sen går han. Ingen vet vad det betydde.",
                  "🫎 Du klappade en älg på en karta. Mamma hade vari' stolt. Typ."] },
      en: { cap: "⚠️ MOOSE ALERT – sector {sektor}. It has right of way.", tap: "🫎 The moose nods. You are now an honorary hunter." }
    },
    ufo: {
      sv: { cap: ["🛸 UFO över Grängesberg! Det strålar upp en back lättöl. Försvarsmakten är tyst.",
                  "🛸 Oidentifierat flygande föremål över {sektor}. Det verkar leta efter en öppen kiosk.",
                  "🛸 Utomjordingarna landade, tittade på Dalarna och sa: 'hä va' väl int' så tokut'."],
            tap: ["👽 'Ta oss till er ledare.' Du pekade på korvkiosken. De verkar nöjda.",
                  "👽 Rymdvarelsen ger dig tummen upp. Den har tre tummar. Det blir många tummar.",
                  "🛸 Du fick ett vänligt pip från rymden. Det betyder antagligen 'drick vatten'."] },
      en: { cap: "🛸 UFO over Grängesberg! It is beaming up a crate of light beer.", tap: "👽 'Take us to your leader.' You pointed at the hot dog stand." }
    },
    vasa: {
      sv: { cap: ["⛷️ En Vasaloppsåkare korsar kartan. Han tror att Mora ligger åt det hållet. Ingen rättar honom.",
                  "⛷️ Skidåkare i sektor {sektor}! Blåbärssoppa i ena handen, fel karta i den andra.",
                  "⛷️ Åkare nr 4711 har gått vilse sen 1987. Han hälsar att han mår bra."],
            tap: ["⛷️ 'Hur långt é dä kvar?' – 'Ungefär hela Dalarna, pôjk.'",
                  "⛷️ Du gav honom en mugg blåbärssoppa. Han åkte vidare med nytt hopp.",
                  "⛷️ 'I fäders spår, för framtida segrar!' ropar han. Sen åker han in i en snödriva."] },
      en: { cap: "⛷️ A Vasaloppet skier crosses the map. He thinks Mora is this way.", tap: "⛷️ You gave him blueberry soup. He skis on with new hope." }
    },
    bjorn: {
      sv: { cap: ["🐻 Björn observerad vid Väsman. Han letar efter honung. Han hittade en kebab.",
                  "🐻 Nalle vid kartkanten! Han tittar bara. Tittar och dömer.",
                  "🐻 Spaning: en björn. Status: vaken. Humör: hungrig. Rekommendation: låt han va'."],
            tap: ["🐻 Björnen vinkar. Ingen har sett en björn vinka förut. Nu har du det.",
                  "🐻 'Brumm.' Det betyder 'god kväll' på björnska. Tror vi.",
                  "🐻 Björnen gick hem och la sig. Hä kan du också göra nån gång ikväll."] },
      en: { cap: "🐻 Bear spotted by lake Väsman. It found a kebab.", tap: "🐻 The bear waves. Nobody has seen that before." }
    },
    traktor: {
      sv: { cap: ["🚜 Traktorkö på Storgatan! Hastighet: 12 km/h. Moral: hög.",
                  "🚜 Bonde i täten, fem bilar bakom. Alla har accepterat sitt öde.",
                  "🚜 Pansarkolonn på väg genom {sektor}. Den é grön och luktar hö."],
            tap: ["🚜 Bonden lyfter ett finger från ratten. Den finaste hälsningen som finns i Dalarna.",
                  "🚜 Kön rör sig 3 meter. Folk jublar.",
                  "🚜 'Hä é int' bråttom', säger bonden. Han har rätt."] },
      en: { cap: "🚜 Tractor queue on the main street. Speed 12 km/h. Morale high.", tap: "🚜 The farmer lifts one finger off the wheel. Highest honour." }
    },
    ander: {
      sv: { cap: ["🦆 Andflock i V-formation över {sektor}. Bättre ordning än i kompaniet.",
                  "🦆 Flygvapnet har skickat förstärkning. Det é änder.",
                  "🦆 Änderna flyger söderut. De har hört om kebaben i Borlänge."],
            tap: ["🦆 KVACK! Hela flocken svarar. Du har nu befälet över en skvadron änder.",
                  "🦆 Den sista anden flyger lite snett. Vi kallar honom Anton. Nej, vi gör int' det.",
                  "🦆 Änderna tackar för visat intresse och återgår till uppdraget."] },
      en: { cap: "🦆 Ducks in V formation. Better discipline than the company.", tap: "🦆 QUACK! You now command a squadron of ducks." }
    },
    norrsken: {
      sv: { cap: ["🌌 Norrsken över kartan! Himlen festar också ikväll.",
                  "🌌 Gröna ljus på himlen. Spaningen bekräftar: det é int' grannens laser.",
                  "🌌 Norrsken över {sektor}. Ölguden har tänt diskolampan."],
            tap: ["🌌 Du önskade dig nåt. Norrskenet sa 'kanske'.",
                  "🌌 Titta upp på riktigt ibland också. Himlen har ingen app.",
                  "🌌 Ljuset fladdrar lite extra. Det gillar dig."] },
      en: { cap: "🌌 Northern lights over the map! The sky is partying too.", tap: "🌌 Look up for real sometimes. The sky has no app." }
    },
    spelman: {
      sv: { cap: ["🎻 Spelmanslaget marscherar förbi! Fiol, nyckelharpa och en kille med triangel.",
                  "🎺 Musikkåren på manöver i {sektor}. Ingen vet vilken låt det é. Inte de heller.",
                  "🪗 Dragspel på kartan! Det é antingen fest eller begravning. Det låter likadant."],
            tap: ["🎻 Du önskade en låt. De spelade samma låt igen. Hä é traditionen.",
                  "🎺 Trumpetaren tappade takten. Triangeln tog över. Kaos.",
                  "🪗 'Vi spelar bara en till', säger de. De har sagt så sen 1974."] },
      en: { cap: "🎻 The fiddlers march past! Fiddle, nyckelharpa and a triangle.", tap: "🎻 You asked for a song. They played the same one again." }
    },
    malmtag: {
      sv: { cap: ["🚂 Malmtåget passerar. 50 vagnar. Ta det lugnt, det tar en stund.",
                  "🚂 Tungt transportfordon på spåret. Last: järnmalm och en ensam kapsyl.",
                  "🚂 Tåget från gruvan kör förbi {sektor}. Det har aldrig varit sent. Påstår det."],
            tap: ["🚂 TUUT TUUT! Lokföraren vinkar. Du vinkade tillbaka. Fint.",
                  "🚂 Du räknade vagnarna. Du kom av dig på 23. Börja om?",
                  "🚂 Tåget tackar för att du väntade vid bommen."] },
      en: { cap: "🚂 The ore train passes. 50 wagons. Take it easy.", tap: "🚂 TOOT TOOT! The driver waves back." }
    },
    epa: {
      sv: { cap: ["🛵 Mopedcruising på Storgatan! Hastighet: 30. Volym: 120 dB.",
                  "🚗 EPA-kolonn rullar genom {sektor}. Dunk dunk dunk. Dunk.",
                  "🛵 Motoriserat förband på patrull. Bensin: halv. Självförtroende: fullt."],
            tap: ["🛵 Föraren tutar två gånger. Det betyder 'tjena' på mopedspråk.",
                  "🚗 Musiken é så hög att kartan vibrerar. Eller é dä din telefon?",
                  "🛵 Ett varv till runt torget. Som vanligt."] },
      en: { cap: "🛵 Moped cruise on the main street! Speed 30. Volume 120 dB.", tap: "🛵 Two honks. That means 'hi'." }
    },
    gadda: {
      sv: { cap: ["🐟 En gädda hoppar i Väsman! Hon é större än i fjol. Hon é alltid större än i fjol.",
                  "🐟 Ubåtskränkning i {sektor}! Visade sig va' en gädda. Hon é stolt över det.",
                  "🐟 Fisken hoppade så högt att den syntes på kartan. Rekord."],
            tap: ["🐟 Du fångade henne! Hon vägde 14 kilo. Eller 4. Beror på vem som berättar.",
                  "🐟 Gäddan blinkar åt dig och dyker. Hon kommer tillbaka i nästa historia.",
                  "🐟 'Den som fiskar, han får vänta', sa gäddan. Sen simmade hon."] },
      en: { cap: "🐟 A pike jumps in the lake! Bigger than last year. Always is.", tap: "🐟 You caught her! 14 kilos. Or 4." }
    },
    ballong: {
      sv: { cap: ["🎈 En ballong stiger över {sektor}. Nån har tappat sitt kalas.",
                  "🎈 Spaningsballong i luftrummet! Den é röd och har ett ansikte ritat med tusch.",
                  "🎈 Luftburen enhet på väg uppåt. Mål: okänt. Moral: lätt."],
            tap: ["🎈 Du nästan nådde den. Nästan.",
                  "🎈 Ballongen hälsar och svävar vidare mot Grangärde.",
                  "🎈 POFF! Nej. Den klarade sig. Den é starkare än den ser ut."] },
      en: { cap: "🎈 A balloon rises over {sektor}. Someone lost their party.", tap: "🎈 You almost reached it. Almost." }
    },
    snow: {
      sv: { cap: ["❄️ Första snön! Hela {sektor} säger 'nä, int' redan' samtidigt.",
                  "❄️ Snö på kartan. Vinterutrustning utdelas: mössa, vantar och tålamod.",
                  "❄️ Det snöar. Ölguden byter till lusekofta."],
            tap: ["❄️ Du fångade en snöflinga på tungan. Den smakade… snö.",
                  "⛄ Någon har byggt en snögubbe vid kartkanten. Han heter Kurt.",
                  "❄️ Kom ihåg: kängor, inte sneakers. Hälsningar, halkan."] },
      en: { cap: "❄️ First snow! Everyone in {sektor} says 'not yet' at once.", tap: "❄️ You caught a snowflake. It tasted like snow." }
    },
    aska: {
      sv: { cap: ["⚡ Åska över {sektor}! Räkna sekunderna. Eller gå in. Gå in.",
                  "🌩️ Artillerield från himlen. Det é bara Tor som har kalas.",
                  "⚡ Oväder på ingång. Stäng fönstret och ta in tvätten, soldat."],
            tap: ["🌩️ 1… 2… 3… BOM. Tre kilometer bort. Ungefär.",
                  "⚡ Blixten slog ner i en tom ölback. Den mår bra.",
                  "🌩️ Mormor hade dragit ur alla sladdar nu. Bara så du vet."] },
      en: { cap: "⚡ Thunder over {sektor}! Count the seconds. Or go inside.", tap: "🌩️ 1… 2… 3… BOOM. Three km away." }
    },
    korv: {
      sv: { cap: ["🌭 Korvgubben rullar förbi! Senap, ketchup och rostad lök. Taktiskt viktigt.",
                  "🌭 Matförråd på hjul i {sektor}. Förplägnaden har anlänt.",
                  "🌭 Korvvagnen patrullerar. Han har bröd. Han har korv. Han har en plan."],
            tap: ["🌭 'Med allt?' – 'Med allt.' Det é så man vet att man é vuxen.",
                  "🌭 Korvgubben ropar: 'Ät nåt, pôjk!' Bra råd faktiskt.",
                  "🌭 Du fick en extra servett. Det é kärlek i korvvärlden."] },
      en: { cap: "🌭 The hot dog cart rolls by! Supplies have arrived.", tap: "🌭 'Eat something!' Good advice actually." }
    },
    spoke: {
      sv: { cap: ["👻 Ett spöke svävar över {sektor}. Det har bara ett lakan och massor av självförtroende.",
                  "👻 Halloween-patrull: ett spöke letar efter godis. Det fick en kapsyl.",
                  "👻 BU! Ingen blev rädd. Spöket é lite ledset nu."],
            tap: ["👻 Spöket blev glad att du såg det. Ingen ser spöken längre.",
                  "👻 'Bus eller godis?' – 'Vatten?' – 'Okej då.'",
                  "👻 Lakanet var nytvättat. Ett hygieniskt spöke."] },
      en: { cap: "👻 A ghost floats over {sektor}. Only a sheet and lots of confidence.", tap: "👻 'Trick or treat?' – 'Water?' – 'Fine.'" }
    },
    tomte: {
      sv: { cap: ["🎅 Tomten på moped! Renarna é lediga ikväll.",
                  "🎅 Okänd man i rött kör genom {sektor}. Han har en lista. Han kollar den två gånger.",
                  "🎅 Tomtepatrull! Ni som varit snälla: drick vatten. Ni andra: drick också vatten."],
            tap: ["🎅 'Ho ho ho!' Du é på listan. Den snälla. Tror vi.",
                  "🎅 Tomten tutar. Mopeden låter som en arg geting.",
                  "🎅 Han kastade en pepparkaka åt dig. Den landade i snön."] },
      en: { cap: "🎅 Santa on a moped! The reindeer have the night off.", tap: "🎅 Ho ho ho! You are on the nice list." }
    },
    dalahast: {
      sv: { cap: ["🐎 En JÄTTELIK Dalahäst galopperar förbi Väsman! Kurbitsen fladdrar i vinden.",
                  "🐎 SÄLLSYNT: Den vilda Dalahästen har setts i {sektor}. Ingen har lyckats fånga den.",
                  "🐎 Kavalleriet é här! Det é en enda häst. Den é röd. Den é perfekt."],
            tap: ["🐎 Du rörde vid den vilda Dalahästen! Hä hände senast 1923. Kanske.",
                  "🐎 Hästen gnäggar på dalmål. Du förstod varje ord.",
                  "🐎 Den stannade, poserade och galopperade vidare. Ta en skärmdump nästa gång!"] },
      en: { cap: "🐎 RARE: a giant wild Dala horse gallops past!", tap: "🐎 You touched the wild Dala horse! Last time: 1923." }
    },
    olguden: {
      sv: { cap: ["🎣 MYCKET SÄLLSYNT: Ölguden fiskar i Väsman. Han har int' fått nåt sen i tisdags.",
                  "🎣 Ölguden sitter vid kartkanten med metspö. Han säger att han jobbar.",
                  "🎣 Ölguden har tagit ledigt. Han fiskar. Störst fisk vinner. Han har ingen fisk."],
            tap: ["🎣 'Hä nappar int' ikväll', säger Ölguden. 'Men hä é int' fisken som é poängen.'",
                  "🎣 Ölguden fick en gammal stövel. Han é nöjd ändå.",
                  "🎣 'Ro hem, pôjk. Hä gör jag också snart.'"] },
      en: { cap: "🎣 VERY RARE: the Beer God is fishing in the lake.", tap: "🎣 'No bites tonight. But fish aren't the point.'" }
    },
    mygg: {
      sv: { cap: ["🦟 MYGGLARM i {sektor}! Fienden é liten, många och törstig.",
                  "🦟 Luftangrepp! Myggskvadron på väg. Alla enheter: smörj in er.",
                  "🦟 Mygg på kartan. De har hittat dig även här."],
            tap: ["🦟 PANG! Du träffade en. 4 000 kvar.",
                  "🦟 Myggen surrar 'tjeeeena'. Den vill bara prata. Och suga blod.",
                  "🦟 Du viftade så mycket att telefonen trodde du ville skaka."] },
      en: { cap: "🦟 MOSQUITO ALERT! The enemy is small, many and thirsty.", tap: "🦟 SMACK! Got one. 4,000 left." }
    },
    troll: {
      sv: { cap: ["🧌 Ett troll korsar skogsvägen. Klockan é mycket. Hä é trolltid.",
                  "🧌 Okänd varelse i skogen vid {sektor}. Stor näsa, liten hatt, inga planer.",
                  "🧌 Trollet går hem från festen. Han ser ut som du kommer se ut imorgon."],
            tap: ["🧌 Trollet säger 'gonatt' och går in under en gran.",
                  "🧌 'Har du sett min hatt?' Den sitter på hans huvud. Säg inget.",
                  "🧌 Trollet blir sten när solen går upp. Gå hem innan dess, du med."] },
      en: { cap: "🧌 A troll crosses the forest road. It is troll o'clock.", tap: "🧌 The troll says good night and goes under a spruce." }
    },
    kebab: {
      sv: { cap: ["🥙 En flygande kebab kretsar över {sektor}. Kebabradarn har blivit självmedveten.",
                  "🥙 Oidentifierad rulle i omloppsbana! Vitlökssås-spår bekräftat.",
                  "🥙 Kebaben flyger. Ingen vet hur. Den vet inte själv."],
            tap: ["🥙 Du nästan fångade kebaben. Den é snabb för att va' en kebab.",
                  "🥙 Mild, medel eller stark? Kebaben väljer själv. Stark.",
                  "🥙 Kebaben landade i nån annans hand. Livet é orättvist."] },
      en: { cap: "🥙 A flying kebab orbits {sektor}. The kebab radar is self-aware.", tap: "🥙 Almost caught it. Fast for a kebab." }
    },
    glitch: {
      sv: { cap: ["⚠️ SYSTEMFEL: för mycket mys i Dalarna. Startar om… nej, det gick bra.",
                  "⚠️ SYSTEMFEL 0xDALA: hittade ingen tråkighet. Fortsätter.",
                  "⚠️ KRITISKT FEL: kaffet i serverhallen tog slut. Lagat."],
            tap: ["🛠️ Teknikern har slagit på serverrummet med en skiftnyckel. Allt funkar.",
                  "🛠️ Felet loggat som 'trevligt'. Ärendet stängt.",
                  "🛠️ Du hittade buggen! Den heter Bosse och bor här nu."] },
      en: { cap: "⚠️ SYSTEM ERROR: too much cosiness in Dalarna. Recovered.", tap: "🛠️ Bug found. His name is Bosse. He lives here now." }
    },
    satellit: {
      sv: { cap: ["🛰️ Spaningssatellit över {sektor}. Den letar efter roliga människor. Hittade några.",
                  "🛰️ Satelliten skannar kartan. Resultat: 3 katter, 1 korvkiosk, 0 problem.",
                  "🛰️ Ölradarn synkar med rymden. Var god dröj. Fortsätt va' trevlig."],
            tap: ["🛰️ Satelliten vinkar med solpanelen. Den é ensam där uppe.",
                  "🛰️ Bild tagen! Du blinkade. Vi tar en till om 90 minuter.",
                  "🛰️ 'Ludvika, vi har ett problem.' – 'Nej, vi har det mysigt.'"] },
      en: { cap: "🛰️ Recon satellite over {sektor}. Scanning for fun people.", tap: "🛰️ Photo taken! You blinked." }
    },
    uggla: {
      sv: { cap: ["🦉 En uggla vid kartkanten. Hon har nattskift, precis som du.",
                  "🦉 Nattspanare på post. Hon ser allt. Hon säger inget.",
                  "🦉 'Hoo?' frågar ugglan. Bra fråga. Hoo é ute ikväll?"],
            tap: ["🦉 Ugglan blinkar. Långsamt. Visdom överförd.",
                  "🦉 'Hoo hoo.' Det betyder 'drick vatten' på ugglespråk.",
                  "🦉 Ugglan vänder huvudet 270 grader. Hon é imponerad av dig."] },
      en: { cap: "🦉 An owl at the map edge. Night shift, like you.", tap: "🦉 The owl blinks slowly. Wisdom transferred." }
    },
    odjur: {
      sv: { cap: ["🦕 LEGENDARISKT: Väsmanodjuret har siktats! Ingen kommer tro dig. Ta en skärmdump.",
                  "🦕 Sjöodjur i {sektor}! Det é större än gäddan. Gäddan é sur.",
                  "🦕 Nessie har en kusin i Dalarna. Hon heter Vässe och é blyg."],
            tap: ["🦕 Vässe nickar åt dig och sjunker ner. Du é nu en av de utvalda.",
                  "🦕 Du har sett Väsmanodjuret. Det betyder tur i… nånting. Vi vet int' vad.",
                  "🦕 Odjuret ger dig en kapsyl från 1952 och försvinner."] },
      en: { cap: "🦕 LEGENDARY: the lake monster has been seen! Take a screenshot.", tap: "🦕 She nods and sinks. You are now one of the chosen." }
    },
    lucia: {
      sv: { cap: ["🕯️ Luciatåget går genom {sektor}! Någon sjunger falskt. Det é tradition.",
                  "🕯️ Ljusbärare på marsch. Lussekatter i fickorna.",
                  "🕯️ Sankta Lucia, ljusklara hägring… och en stjärngosse som tappat sin strut."],
            tap: ["🕯️ Du fick en lussekatt. Den é lite bränd. Perfekt.",
                  "🕯️ Pepparkaksgubben i slutet av tåget vinkar.",
                  "🕯️ Ljusen fladdrar. Brandvarnaren håller andan."] },
      en: { cap: "🕯️ The Lucia procession walks through {sektor}!", tap: "🕯️ You got a saffron bun. Slightly burnt. Perfect." }
    },
    kraftor: {
      sv: { cap: ["🦞 Kräftor på rymmen i {sektor}! De har hört om kräftskivan.",
                  "🦞 Pansarförband på marsch: sex kräftor och en hummer som går fel.",
                  "🦞 Augustilarm: kräftorna har organiserat sig."],
            tap: ["🦞 Kräftan knyper i luften. Hon är arg men respekterad.",
                  "🦞 Du fick en papperhatt. Bär den med stolthet.",
                  "🦞 'Helan går' sjunger kräftorna. Hälften av dem kan texten."] },
      en: { cap: "🦞 Crayfish on the run! They heard about the party.", tap: "🦞 You got a paper hat. Wear it proudly." }
    }
  },

  /* ---------- 2. Boot lines (shown while the app connects). ✓ / OK is added in code. ---------- */
  boot: {
    sv: [
      "📡 Kalibrerar ölradarn…", "🍺 Kyler satelliterna…", "🛰️ Riktar in spaningssatelliten mot Dalarna…",
      "🗺️ Laddar Dalarnas krogregister…", "🌭 Söker efter korv inom 2 km…", "🫎 Kontrollerar älgläget…",
      "🔋 Laddar moralen…", "🎖️ Putsar medaljerna…", "🪖 Spänner hakremmen…", "📻 Ropar på radion: 'Öl Nu, hör ni mig?'…",
      "🧭 Hittar norr. Hittade Grängesberg…", "🥨 Värmer upp korvgubben…", "🛡️ Startar Spökläge-skölden…",
      "🎺 Väcker spelmanslaget…", "🚂 Väntar på att malmtåget ska passera…", "🦆 Räknar änderna i Väsman…",
      "🍻 Polerar glasen…", "⚙️ Smörjer kugghjulen med rapsolja…", "🔦 Byter batteri i ficklampan…",
      "🧊 Hämtar is från Kopparberg…", "📡 Ställer in antennen. Lite till. Lite till…", "🧮 Räknar kapsyler…",
      "🎯 Siktar in kartan…", "🧥 Tar på lusekoftan…", "🐻 Ber björnen flytta på sig…", "☕ Kokar kaffe åt serverhamstern…",
      "🐹 Väcker serverhamstern…", "🔐 Låser in dina hemligheter…", "🧂 Saltar kartan lagom…", "🚜 Kör om traktorn på Storgatan…",
      "🧭 Frågar en bonde om vägen…", "🌲 Räknar granar. Det é många…", "🎲 Slår tärning om kvällens öde…",
      "🎻 Stämmer nyckelharpan…", "🕯️ Tänder lyktorna längs gatan…", "🪵 Lägger ved på brasan…",
      "🧯 Testar brandsläckaren. Bara för säkerhets skull…", "🗝️ Hittar nyckeln till högkvarteret…",
      "🛰️ Laddar ner Sverige. Det é stort…", "📶 Letar täckning i skogen…", "🥾 Snör kängorna…",
      "🎙️ Testar högtalarna: 'Ett, två, Dalarna'…", "🍞 Rostar tunnbröd…", "🧹 Sopar kartan ren…", "🔭 Spanar efter kompisar…"
    ],
    en: ["📡 Calibrating the beer radar…", "🍺 Cooling the satellites…", "🫎 Checking for moose…", "🔋 Charging morale…",
         "🐹 Waking the server hamster…", "🧭 Finding north…", "🎖️ Polishing medals…", "🔭 Looking for friends…"],
    done: { sv: ["✅ KLART. Kartan é din.", "✅ Allt grönt. Kör lugnt.", "✅ Uppkopplad. God kväll, soldat.", "✅ Systemet é redo. Du med?"],
            en: ["✅ READY. The map is yours.", "✅ All green."] },
    ok: { sv: "OK", en: "OK" }
  },

  /* ---------- 3. Empty state (no pins near you). {stad} = town. ---------- */
  empty: {
    sv: [
      "🌵 {stad} ikväll: en tumbleweed och en katt.", "🦗 Tyst i {stad}. Bara syrsorna har vakt.",
      "🫎 Tyst i stan. Till och med älgarna har gått hem.", "🐈 Spaning i {stad}: en katt. Katten é int' intresserad.",
      "📻 Radiotystnad över {stad}. Någon måste bryta den.", "🛰️ Satelliten ser inget i {stad}. Den kollade två gånger.",
      "🕸️ {stad}: spindlarna har tagit över krogen.", "🧊 Kallt på kartan i {stad}. Tänd en lykta, nån?",
      "🌲 {stad} sover. Granarna snarkar.", "🚜 En traktor. En lampa. Inga människor. {stad} ikväll.",
      "🔭 Spanaren rapporterar: inga kontakter i {stad}. Han äter sin matsäck.", "📭 Inga pins här. Lådan é tom, soldat.",
      "🦉 Bara ugglan é ute i {stad}. Och hon dricker bara vatten.", "🌙 Månen har hela {stad} för sig själv.",
      "🗺️ Kartan över {stad} é så tom att man ser jordens rundning.", "🛋️ {stad} har valt soffan ikväll. Respekt.",
      "🎻 Spelmanslaget i {stad} spelar för tomma bord.", "🐟 Gäddorna i Väsman har mer liv än {stad} just nu.",
      "🧹 Nån har sopat {stad} ren från folk.", "📡 Ölradarn piper int' ens. Den har somnat.",
      "🥶 {stad}: 0 pins, 1 frusen ekorre.", "🎖️ Den första pinnen i {stad} ikväll får äran. Och ingen medalj. Bara äran.",
      "🍃 Ett löv blåser förbi på Storgatan. Det é kvällens händelse i {stad}.", "🛰️ Kartan laddade klart. Det é bara int' nåt här.",
      "🧭 Alla har gått åt fel håll från {stad}. Typiskt.", "🫖 {stad} har teafton. Det é också fest.",
      "🪑 Stolarna står upp-och-ner på borden i {stad}.", "👻 Spökstad-läge: {stad}. Men ett trevligt spöke.",
      "🚂 Malmtåget passerade {stad}. Ingen vinkade. Ingen var där.", "😴 {stad} har tagit en tupplur. Väck den försiktigt.",
      "🐻 Björnen tittade in i {stad}, såg ingen och gick hem igen.", "📯 Ingen har blåst till samling i {stad} än. Kanske du?"
    ],
    en: ["🌵 {stad} tonight: one tumbleweed and a cat.", "🦗 Quiet in {stad}. Only crickets on duty.", "🫎 Even the moose went home.",
         "📻 Radio silence over {stad}.", "🌙 The moon has {stad} to itself."],
    nowhere: { sv: "här", en: "here" }
  },

  /* ---------- 4. Easter eggs ---------- */
  gud: {   // Ölgudens ordspråk (logo tapped 7 times). Never about drinking more.
    sv: [
      "Den som väntar på nåt gott, väntar ofta i kö till baren.", "En öl i handen é bättre än tio på kartan.",
      "Hä é int' mängden, pôjk. Hä é sällskapet.", "Vatten mellan varje. Hä har gudarna alltid vetat.",
      "Den som går hem i tid, vaknar som en kung.", "Ingen har ångrat ett glas vatten. Ingen.",
      "Kebaben é int' svaret. Men den é ett bra svar.", "Lyssna på ugglan, int' på trollet.",
      "En vän som följer dig hem é värd mer än en full krog.", "Hä é bättre att skåla en gång på riktigt än tio gånger på låtsas.",
      "Taxin é din vän. Behandla den som en vän.", "Morgondagen ser allt. Var snäll mot den.",
      "Den som dansar dåligt men glatt, dansar bäst.", "Ölguden ser dig. Han tycker du é trevlig.",
      "Tisdag é också en dag. Men en lugn dag.", "Säg tack till bartendern. Hen é en hjälte.",
      "Dalarna é stort. Hjärtat ska va' större.", "Det finns ingen skam i lättöl. Bara lättnad.",
      "Bästa partytricket: att veta när festen é slut.", "Kompisen som säger 'nu går vi hem' é en sann vän.",
      "Den som är snäll mot dörrvakten, är klok.", "Jag skapade humle på dag ett. Vilodagen kom på dag två.",
      "Pins försvinner vid fem. Minnen gör det int'.", "Ett skratt é gratis. En skål med kompisar också.",
      "Hä bästa i kvällen é int' ölen. Hä é de du dricker den med.", "Drick som en sköldpadda: långsamt och med skal… nej vänta.",
      "Lugn i stormen, mjuk i skummet.", "Den som har kebab har vänner. Tillfälligt.",
      "Ta ett foto, int' ett glas till.", "Ölguden har talat. Ölguden ska nu sova."
    ],
    en: ["It's not how many. It's who with.", "Water between every one. The gods always knew.", "A friend who walks you home is worth a full bar.",
         "Nobody ever regretted a glass of water.", "The best party trick: knowing when the party is over."],
    title: { sv: "🛐 ÖLGUDEN TALAR", en: "🛐 THE BEER GOD SPEAKS" },
    tap: { sv: "Tryck för att stänga", en: "Tap to close" }
  },
  secret: {   // long-press ÖL! for 3 s during the cooldown
    sv: [
      "🤫 Hemligt meddelande: klockan går int' fortare för att du håller in knappen.",
      "🤫 Agent, du har hittat den hemliga knappen. Den gör ingenting. Grattis.",
      "🤫 Ölguden: 'Tålamod, pôjk. Drick ett glas vatten under tiden.'",
      "🤫 Knappen har registrerat din otålighet. Den é rörd.",
      "🤫 Nedräkningen é int' ett förslag. Den é ett löfte.",
      "🤫 Psst. Hä bästa du kan göra nu é att prata med nån.",
      "🤫 Om du håller in knappen i 10 år till händer… fortfarande ingenting.",
      "🤫 Hemlig order: gå och skåla med någon. På riktigt.",
      "🤫 Kodord accepterat: 'VÄSMAN'. Belöning: denna text.",
      "🤫 Knappen säger: 'Kittlar!'"
    ],
    en: ["🤫 Secret: holding the button does not make time go faster.", "🤫 You found the secret button. It does nothing. Congrats."]
  },
  shake: {
    sv: ["🫧 Skakad, int' rörd.", "🫧 Du skakade telefonen. Skummet tackar.", "🫧 Skumlarm! Någon skakar i {stad}.",
         "🫧 Shaken, not stirred – på dalmål.", "🫧 Telefonen é nu väl blandad.", "🫧 Ölguden kände en jordbävning. Det var du."],
    en: ["🫧 Shaken, not stirred.", "🫧 You shook the phone. The foam says thanks."],
    setting: { sv: "📳 Skaka telefonen = skum", en: "📳 Shake phone = foam" },
    on: { sv: "📳 Skak-skämtet é på. Skaka!", en: "📳 Shake joke on. Shake it!" },
    denied: { sv: "📳 Telefonen sa nej till rörelse. Okej då.", en: "📳 Motion access denied." }
  },
  skal: {
    sv: ["🥂 SKÅL!", "🥂 Skål på er!", "🥂 Klingeling – skål!", "🥂 Skål, kompanjoner!", "🥂 Skål och välkomna!"],
    en: ["🥂 CHEERS!"]
  },

  /* ---------- 5. Moods: greeting on the first open of the day (1 = Monday … 7 = Sunday) + sunrise at 05:00 ---------- */
  greet: {
    sv: {
      1: ["☕ Måndag. Ölguden é stängd. Kom tillbaka när kaffet har verkat.", "😩 Måndag, soldat. Vi rör oss långsamt idag.",
          "🛌 Måndag. Hela kompaniet har sjukanmält sig. Utom du. Respekt."],
      2: ["🍺 Tisdagstörst? Lugn nu, det é tisdag.", "🦗 Tisdag. Den tystaste dagen i Dalarna.", "🫖 Tisdag. Te och mys. Eller en lugn en."],
      3: ["🤔 Onsdag… Lilllördag? Med frågetecken.", "🐪 Onsdag! Puckeln é nådd. Nu går det utför.", "📅 Onsdag. Halvvägs. Vi klarar det."],
      4: ["🧘 Torsdag. Ölguden stretchar inför helgen.", "🍲 Torsdag = ärtsoppa. Det é militärt.", "🎯 Torsdag. Planeringsdag inför operation helg."],
      5: ["🎉 FREDAG! Operation helg inledd. Ta det lugnt, ta det kul.", "😎 Fredag. Ölguden har tagit på sig solglasögonen.",
          "📯 Fredag! Samla trupperna. Och någon som kör hem."],
      6: ["🎊 Lördag! Kvällen é ung. Det é du också, typ.", "🕺 Lördag. Dansskorna é putsade.", "🍻 Lördag. Bästa dagen att träffa kompisar."],
      7: ["😬 Söndag. Ångesten knackar på. Öppna int'.", "🧊 Söndag. Ölguden har ispåse på huvudet.", "🛋️ Söndag. Soffan har ringt. Den saknar dig."]
    },
    en: { 1: ["☕ Monday. The Beer God is closed."], 2: ["🍺 Tuesday thirst? Easy, it's Tuesday."], 3: ["🤔 Wednesday… little Saturday?"],
          4: ["🧘 Thursday. Stretching before the weekend."], 5: ["🎉 FRIDAY! Operation weekend started. Take it easy."],
          6: ["🎊 Saturday! See your friends."], 7: ["😬 Sunday. The angst is knocking. Don't open."] },
    late: { sv: " Klockan é mycket – drick vatten.", en: " It's late – drink water." }
  },
  sunrise: {
    sv: ["🌅 Ny dag. Nya möjligheter. Drick vatten.", "🌅 Klockan é fem. Natten é slut. Pinsen flyger hem som lyktor.",
         "🌅 Gryning över {stad}. Alla pins återgår till basen.", "🌅 Operation natt avslutad. Bra jobbat. Sov gott.",
         "🌅 Solen kommer. Trollen blir sten. Du blir trött.", "🌅 Ölguden sopar kartan. Vi ses ikväll – eller imorgon."],
    en: ["🌅 New day. New chances. Drink water.", "🌅 5 o'clock. The night is over. Pins fly home like lanterns."]
  },

  /* ---------- 6. Kapsylsamlingen: 40 original caps. r: c = vanlig, r = sällsynt, l = legendarisk ---------- */
  caps: [
    { id: "c01", n: "Dalahästen", m: "🐎", c1: "#c8102e", c2: "#7a0a1c", r: "c" },
    { id: "c02", n: "Väsmans våg", m: "🌊", c1: "#2a6fdb", c2: "#123a7a", r: "c" },
    { id: "c03", n: "Älgen Algot", m: "🫎", c1: "#8a5a2b", c2: "#4a2d12", r: "c" },
    { id: "c04", n: "Granskogen", m: "🌲", c1: "#2e7d32", c2: "#123d17", r: "c" },
    { id: "c05", n: "Malmtåget", m: "🚂", c1: "#5d6d7e", c2: "#2b343d", r: "c" },
    { id: "c06", n: "Korvgubben", m: "🌭", c1: "#e67e22", c2: "#8a3d06", r: "c" },
    { id: "c07", n: "Kapsylkorpral", m: "🪖", c1: "#6f7d4f", c2: "#384028", r: "c" },
    { id: "c08", n: "Lusekoftan", m: "🧶", c1: "#ecf0f1", c2: "#2c3e50", r: "c" },
    { id: "c09", n: "Gäddan Gunnel", m: "🐟", c1: "#27ae60", c2: "#0e5a2e", r: "c" },
    { id: "c10", n: "Traktorn", m: "🚜", c1: "#43a047", c2: "#1b5e20", r: "c" },
    { id: "c11", n: "Kurbits", m: "🌺", c1: "#d35400", c2: "#1e5b3a", r: "c" },
    { id: "c12", n: "Ugglan", m: "🦉", c1: "#7b6a58", c2: "#3a2f24", r: "c" },
    { id: "c13", n: "Myggan", m: "🦟", c1: "#95a5a6", c2: "#4b5556", r: "c" },
    { id: "c14", n: "Tunnbrödet", m: "🫓", c1: "#d4a65a", c2: "#7d5a22", r: "c" },
    { id: "c15", n: "Midnattssol", m: "🌞", c1: "#f6c445", c2: "#c0641a", r: "c" },
    { id: "c16", n: "Snöflingan", m: "❄️", c1: "#a8d8f0", c2: "#3f7fa6", r: "c" },
    { id: "c17", n: "Nyckelharpan", m: "🎻", c1: "#a0522d", c2: "#4e260f", r: "c" },
    { id: "c18", n: "Fältkaffet", m: "☕", c1: "#6d4c41", c2: "#2e1d17", r: "c" },
    { id: "c19", n: "Kebabradarn", m: "🥙", c1: "#f39c12", c2: "#7e4a07", r: "c" },
    { id: "c20", n: "Andflocken", m: "🦆", c1: "#16a085", c2: "#0b4f42", r: "c" },
    { id: "c21", n: "Lägerelden", m: "🔥", c1: "#ff7a1a", c2: "#8c2a00", r: "c" },
    { id: "c22", n: "Vattenbäraren", m: "💧", c1: "#3498db", c2: "#154c79", r: "c" },
    { id: "c23", n: "Taxin hem", m: "🚕", c1: "#f1c40f", c2: "#7d6608", r: "c" },
    { id: "c24", n: "Mössan", m: "🧢", c1: "#34495e", c2: "#17202a", r: "c" },
    { id: "c25", n: "Spelmannen", m: "🪗", c1: "#8e44ad", c2: "#4a2259", r: "c" },
    { id: "c26", n: "Björnen Bruno", m: "🐻", c1: "#795548", c2: "#3e2723", r: "c" },
    { id: "c27", n: "Norrskenet", m: "🌌", c1: "#1abc9c", c2: "#4a148c", r: "r" },
    { id: "c28", n: "Vasaloppet", m: "⛷️", c1: "#e8f1f8", c2: "#1f4e8c", r: "r" },
    { id: "c29", n: "UFO:t", m: "🛸", c1: "#7fff7f", c2: "#1d3b2a", r: "r" },
    { id: "c30", n: "Gruvlampan", m: "🔦", c1: "#b87333", c2: "#3b2412", r: "r" },
    { id: "c31", n: "Trollet Tuva", m: "🧌", c1: "#5b8a3c", c2: "#273d19", r: "r" },
    { id: "c32", n: "Spökpatrullen", m: "👻", c1: "#d7dde8", c2: "#4b5468", r: "r" },
    { id: "c33", n: "Satelliten", m: "🛰️", c1: "#9fb3c8", c2: "#24364a", r: "r" },
    { id: "c34", n: "Midsommarstången", m: "🌼", c1: "#ffd54f", c2: "#2e7d32", r: "r" },
    { id: "c35", n: "Lucia", m: "🕯️", c1: "#fff3c4", c2: "#b71c1c", r: "r" },
    { id: "c36", n: "Kräftskivan", m: "🦞", c1: "#e53935", c2: "#5c0d0b", r: "r" },
    { id: "c37", n: "Ölguden", m: "🛐", c1: "#ffe08a", c2: "#b8860b", r: "l" },
    { id: "c38", n: "Väsmanodjuret", m: "🦕", c1: "#00bfa5", c2: "#003d33", r: "l" },
    { id: "c39", n: "Gyllene Dalahästen", m: "🐎", c1: "#ffd700", c2: "#8a6d00", r: "l" },
    { id: "c40", n: "Kopparkapsylen", m: "⛏️", c1: "#e08a4f", c2: "#6b2e0d", r: "l" }
  ],
  capLines: {   // shown when a new cap is opened (never about drinking)
    c: { sv: ["Daglig ranson utdelad.", "En till i samlingen. Fint.", "Vanlig, men din.", "Kapsylen glänser lite. Bara lite."],
         en: ["Daily ration issued.", "One more for the album."] },
    r: { sv: ["SÄLLSYNT! Kompaniet é avundsjukt.", "Sällsynt fynd, soldat. Visa kompisarna.", "Ooh. Den här é int' vanlig."],
         en: ["RARE! The company is jealous."] },
    l: { sv: ["LEGENDARISK! Ölguden själv nickar.", "LEGENDARISK. Den här berättar man om på äldreboendet.", "Legendarisk kapsyl. Rama in telefonen."],
         en: ["LEGENDARY! The Beer God nods."] }
  },

  /* ---------- UI strings ---------- */
  ui: {
    sv: { sector: "SEKTOR", contact: "KONTAKT", rarity: { c: "Vanlig", r: "Sällsynt", l: "Legendarisk" },
          capTitle: "🧢 Kapsylsamlingen", capNew: "🧢 Dagens kapsyl!", capOpen: "Öppna", capOf: "{n} av {m} kapsyler",
          capHint: "En kapsyl per dag – bara för att du tittar in. Sällsynt minst var tionde dag.",
          capPity: "Sällsynt garanterad om {n} dagar", capMissing: "???", capChip: "Ny kapsyl väntar", capWait: "Dagens kapsyl har kommit! Tryck för att öppna. (Finns också under 🍺 Ikväll ▾.)",
          spotted: "🔭 Spaningslogg: {n} av {m} händelser sedda", settings: "🎉 Skoj & överraskningar",
          events: "🗺️ Överraskningar på kartan", eventsOn: "På", eventsOff: "Av", capBtn: "🧢 Kapsylsamlingen ({n}/{m})",
          bootHead: "SYSTEMSTART", empty: "INGA KONTAKTER", close: "Stäng", greetHead: "DAGENS ORDER" },
    en: { sector: "SECTOR", contact: "CONTACT", rarity: { c: "Common", r: "Rare", l: "Legendary" },
          capTitle: "🧢 Bottle caps", capNew: "🧢 Today's cap!", capOpen: "Open", capOf: "{n} of {m} caps",
          capHint: "One cap per day – just for checking in. Rare at least every 10th day.",
          capPity: "Rare guaranteed in {n} days", capMissing: "???", capChip: "New cap waiting", capWait: "Today's bottle cap is here! Tap to open.",
          spotted: "🔭 Spotter log: {n} of {m} events seen", settings: "🎉 Fun & surprises",
          events: "🗺️ Map surprises", eventsOn: "On", eventsOff: "Off", capBtn: "🧢 Bottle caps ({n}/{m})",
          bootHead: "SYSTEM BOOT", empty: "NO CONTACTS", close: "Close", greetHead: "TODAY'S ORDERS" }
  }
};
