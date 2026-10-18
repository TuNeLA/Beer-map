/* Öl Nu v19 GÄNGET — all texts for js/gang.js (window.GANG_CONTENT).
   Rules: kind teasing only. No drinking rules, nothing mean, sexual or humiliating. No drink counts about a person.
   Keep list ORDER (the server stores indexes for Mest troligt); add new items at the END. */
(function () {
  "use strict";
  window.GANG_CONTENT = {
    // 📖 Citatboken — header over the book (20)
    quoteHeaders: [
      "📖 Citatboken – det som sas, stannar här",
      "📖 Gängets samlade visdom (typ)",
      "📖 Ord som borde ristas i en dalahäst",
      "📖 Protokoll från nattens stormöte",
      "📖 Historiska uttalanden, del 1 av ∞",
      "📖 Så talade gänget",
      "📖 Citat som Ölguden själv gillat",
      "📖 Nattens filosofer har ordet",
      "📖 Sagt är sagt. Nu ä det skrivet.",
      "📖 Arkivet. Hemligstämplat till 10:00.",
      "📖 Bevismaterial, lag nr 1",
      "📖 Kvällens visdomsord från Dalarnas djup",
      "📖 Det här kommer vi skratta åt 2040",
      "📖 Ur gängets memoarer",
      "📖 Ingen sa att det var smart. Bara att det sas.",
      "📖 Citatboken – dalmål på högsta nivå",
      "📖 Ordagrant. Tyvärr.",
      "📖 Rapport från frontlinjen",
      "📖 Gängets lilla röda (gula?) bok",
      "📖 Klassiker i vardande"
    ],
    // Toast when a quote is saved (before the reveal)
    quoteSaved: [
      "📖 Sparat i citatboken! Avslöjas imorgon kl. 10:00. 🤫",
      "📖 Inskrivet. Gänget får se det imorgon 10:00.",
      "📖 Bevis säkrat. Avslöjas efter frukost.",
      "📖 Citatet ligger i valvet till imorgon 10:00.",
      "📖 Arkiverat. Ölguden vaktar det till imorgon."
    ],
    quoteRevealToast: [
      "📖 Gårdagens citat ä här! ({n} st)",
      "📖 Valvet ä öppnat: {n} citat från igår.",
      "📖 Dags att skämmas lite: {n} citat från igår!"
    ],

    // 🤔 Mest troligt — "Vem ä mest trolig att …?" (120). Keep order; add at the end.
    mt: [
      "somna först ikväll",
      "ringa mamma innan midnatt",
      "börja dansa innan nån annan gör det",
      "glömma jackan på krogen",
      "bli bästis med dörrvakten",
      "beställa pizza klockan tre på natten",
      "hitta en ny genväg som ä längre",
      "börja prata dalmål med en turist",
      "ha batteri kvar i mobilen kl. 02",
      "sjunga med i varenda låt",
      "fastna i ett tre timmar långt samtal om älgar",
      "säga ”en till och sen går vi hem” och mena det",
      "vara den som håller koll på att alla kommer hem",
      "starta en kör i taxikön",
      "få hela kebabkön att skratta",
      "dyka upp på förfesten med hembakat",
      "ta med sig en ny kompis hem till gänget",
      "bli fotograf för hela kvällen",
      "planera nästa helg redan ikväll",
      "kunna alla ord till Kalle Moraeus låtar",
      "ha på sig en dalahäst-tröja utan ironi",
      "fråga om vägen trots att hen bott här i 20 år",
      "vinna en armbrytning mot en skogsarbetare",
      "bli kompis med en katt på vägen hem",
      "hålla tal utan att nån bett om det",
      "vara först i kön till garderoben",
      "ha snacks i jackfickan",
      "säga ”jag ä bara ute en sväng” och komma hem sist",
      "veta var den bästa kebaben i stan finns",
      "dansa schottis på ett dansgolv med house",
      "starta en debatt om vilken ort som ä bäst i Dalarna",
      "glömma vad hen skulle säga mitt i en mening",
      "beställa vatten till hela gänget",
      "bjuda en främling på pommes",
      "hamna på bild i någon annans semesteralbum",
      "kunna hitta hem med slutna ögon",
      "bli kallad ”kapten” av hela krogen",
      "ta med en termos kaffe till förfesten",
      "börja nynna på Dalarnas lov",
      "tappa bort sin mössa (igen)",
      "kunna prata med en fjällko",
      "vara den som tar gruppbilden",
      "hålla igång diskussionen om vem som tar taxin",
      "bli bäst på karaoke utan att öva",
      "skriva i gruppchatten fast alla sitter vid samma bord",
      "säga ”det här blir en lugn kväll”",
      "vara sist ut från dansgolvet",
      "få dörrvakten att le",
      "ha kvar kvittot från förra helgen",
      "bära ut nån annans jacka av misstag",
      "hitta en tvåkrona på marken och bli glad",
      "kunna alla stamgäster vid namn",
      "ringa in en önskelåt till radion",
      "börja göra stretchövningar i kön",
      "lära sig nån annans namn efter tre timmar",
      "byta skor med nån för att det var kul",
      "vara den som minns allt imorgon",
      "börja prata om Vasaloppet klockan ett på natten",
      "lova att ta med fika imorgon",
      "säga ”nu ä jag pigg igen” efter en korv",
      "vinna en tävling som ingen visste fanns",
      "ta med sig en souvenir från krogen (en servett)",
      "berätta samma historia två gånger ikväll",
      "vara snyggast klädd utan att försöka",
      "hitta en fyrklöver på väg till krogen",
      "skicka ett röstmeddelande på fem minuter",
      "bli inbjuden till en främlings kräftskiva",
      "börja planera en resa till Mora mitt i natten",
      "känna igen en låt efter två toner",
      "vara först hemma ikväll",
      "glömma att hen redan har ätit",
      "starta ett gruppkram-initiativ",
      "hälsa på varenda hund i stan",
      "säga ”jag har ett förslag” och sen inte ha det",
      "kunna rita en karta över alla krogar i stan",
      "bli den nya stamgästen nånstans",
      "våga ta första steget på dansgolvet",
      "vara den som har plåster i plånboken",
      "få hela gänget att ringa hem till mamma",
      "prata med en staty",
      "ge en komplimang till alla i taxikön",
      "sitta kvar och lyssna på trubaduren till sista låten",
      "kunna säga ”int’ vet jag” på sju dialekter",
      "starta en vågen på en pub",
      "göra en hel monolog om väder",
      "hitta det enda lediga bordet",
      "berätta en vits som bara hen förstår",
      "vara på bild med en kändis i Leksand",
      "tappa bort gänget och hitta ett nytt",
      "äta upp hela pizzan innan taxin kommer",
      "ha bäst koll på tågtiderna",
      "börja varje mening med ”asså…”",
      "bli intervjuad av lokaltidningen",
      "fixa en extrastol åt nån som saknar",
      "säga ”vi borde göra det här oftare” minst fem gånger",
      "uppfinna en ny dans",
      "bli kompis med hela bordet bredvid",
      "ta med sig kvällens bästa fråga till frukosten",
      "lägga en hjärt-emoji på allt i gruppchatten",
      "ha ont i fötterna först av alla",
      "känna nån på varenda krog",
      "börja prata engelska med en kompis från Borlänge",
      "vara den som ser till att alla får vatten",
      "ringa en taxi till fel stad",
      "skriva en dikt på en servett",
      "vinna sten-sax-påse om vem som ska beställa",
      "hitta på ett smeknamn som fastnar",
      "bli mest saknad när hen går hem",
      "tro att det ä fredag fast det ä lördag",
      "kunna Ludvikas historia utantill",
      "överraska alla med en dold talang",
      "vara den som säger ”nu tar vi en bild!”",
      "ge alla i gänget en kram vid hejdå",
      "bli kvällens DJ utan att fråga",
      "få med sig hela gänget på en promenad",
      "bära gänget på axlarna (bildligt)",
      "vara bäst på att lyssna",
      "komma ihåg allas födelsedagar",
      "bli Kebabkungen i stan",
      "skratta så högt att hela krogen vänder sig om"
    ],
    // One funny line after a result. {name} = winner(s)
    mtResult: [
      "Folket har talat: {name}. Inget att tillägga.",
      "{name} tar hem den. Grattis (tror vi).",
      "Rösterna ä räknade. {name}, det ä du. Dalarna såg det komma.",
      "{name}! Inte ens Ölguden blev förvånad.",
      "Enhälligt-ish: {name}.",
      "Domen ä fallen: {name}. Ingen överklagan.",
      "{name} vinner. Priset ä äran. Och ett leende.",
      "Där satt den. {name}, ta emot applåderna!",
      "Gänget vet vad gänget vet: {name}.",
      "{name}, du ä officiellt mest trolig. Bär titeln med stolthet.",
      "Statistiken ljuger int’: {name}.",
      "Vi har en vinnare: {name}. Kommunen meddelas.",
      "{name} – en självklarhet sedan 1987.",
      "Rösterna rasade in. {name} tackar och bockar.",
      "Det blev {name}. Det ä inget fel på dig. Tvärtom.",
      "Ölgudens kristallkula sa samma sak: {name}.",
      "{name}. Säg inget. Vi vet.",
      "Folkomröstningen ä avgjord: {name}!",
      "Ingen jäv, inget fusk. Bara {name}.",
      "Mest troligt? {name}. Mest omtyckt? Också {name}."
    ],
    mtTie: "Delad seger! {name}. Dela titeln broderligt.",
    mtNoVotes: "Ingen röstade. Frågan hänger kvar i luften som dimma över Väsman.",

    // 🗳️ Vart ska vi?
    pollLines: [
      "🗳️ Demokrati i Dalarna! Rösta på nästa krog.",
      "🗳️ Gänget röstar. Den som int’ röstar får int’ klaga.",
      "🗳️ Ett parti, flera krogar. Välj!",
      "🗳️ Valet ä ditt. Konsekvenserna ä allas."
    ],
    pollWinner: [
      "🏆 Det blir {bar}! Inkallelsen ä ute.",
      "🏆 Folket valde {bar}. Mot nya äventyr!",
      "🏆 {bar} vann valet. Packa jackan.",
      "🏆 Rösterna ä räknade: {bar}. Framåt marsch!"
    ],

    // 🥞 Bakisbrunchen (30)
    brunch: [
      "🥞 Kroppen säger nej. Pannkakan säger ja.",
      "🥞 Bakis ä bara ett annat ord för brunchsugen.",
      "🥞 Dags att lappa ihop truppen med ägg och bacon.",
      "🥞 Ingen soldat lämnas kvar. Inte ens den som sover.",
      "🥞 Frukost ä dagens viktigaste mål. Särskilt idag.",
      "🥞 Kaffe först, minnen sen.",
      "🥞 Vi samlas och pratar om igår. Lugnt och fint.",
      "🥞 Gårdagens hjältar behöver dagens våfflor.",
      "🥞 En macka och en saft, sen ä vi människor igen.",
      "🥞 Solen ä för stark. Kaffet ä för gott. Kom.",
      "🥞 Truppen behöver bränsle. Brunch nu!",
      "🥞 Inget botar en lång kväll som en lång frukost.",
      "🥞 Sängen kan vänta. Kanelbullen kan int’.",
      "🥞 Dags för debriefing över pannkakor.",
      "🥞 Gänget ä trött men hungrigt. Klassiskt.",
      "🥞 Vatten, kaffe, ägg. I den ordningen.",
      "🥞 Den som kommer till brunchen får höra alla historier först.",
      "🥞 Brunch ä som en krogrunda fast med sylt.",
      "🥞 Mössan på, solglasögonen på, mot kaféet!",
      "🥞 Ölguden ordinerar: en stor frukost och ett glas vatten.",
      "🥞 Vi har gått igenom mycket tillsammans. Nu: smörgåsar.",
      "🥞 Det ä söndag i själen idag. Brunch.",
      "🥞 Kan du gå? Kan du äta? Då kan du brunscha.",
      "🥞 Hemlig operation: Operation Omelett.",
      "🥞 Gänget samlas för att räkna in alla. Och ät.",
      "🥞 Lite saltat, lite sött, mycket kaffe.",
      "🥞 Ingen dömer någon vid brunchbordet.",
      "🥞 Dags att ladda batterierna. Ditt och mobilens.",
      "🥞 Lugn morgon, god mat, bra folk.",
      "🥞 Frukostkrigarna samlas!"
    ],
    brunchClosed: "🥞 Bakisbrunchen öppnar kl. 06. Sov gott, soldat.",

    // 🌯 Kebabtoppen — tags (ids must match the server whitelist)
    kebabTags: [
      ["sas", "🔥 Bäst sås"], ["storst", "💪 Störst"], ["snabbast", "⚡ Snabbast"], ["krispigast", "✨ Krispigast"],
      ["trevligast", "😊 Trevligast"], ["prisvard", "💰 Prisvärd"], ["starkast", "🌶️ Starkast"], ["raddare", "🦸 Nattens räddare"]
    ],
    kebabLines: [
      "🌯 Kebab ä också en näringsdryck. Typ.",
      "🌯 Betygsätt nattens räddare. Folket behöver veta.",
      "🌯 Såsen talar. Lyssna.",
      "🌯 Fem stjärnor eller en? Var ärlig, stan räknar med dig.",
      "🌯 Kebabkungen utses av folket, för folket."
    ],
    kebabSaved: [
      "🌯 Betyg sparat! Stan tackar.",
      "🌯 Noterat. Kebabkungen darrar.",
      "🌯 Tack, recensent. Michelin ringer snart.",
      "🌯 Inskrivet i kebabhistorien."
    ],

    // 💸 Skuldboken — categories (no alcohol words)
    debtWhat: ["🚕 Taxi", "🍕 Pizza", "🌯 Kebab", "🍔 Mat", "🎉 Förfest", "🎟️ Biljetter", "☕ Fika", "📦 Annat"],
    debtLines: [
      "💸 Kort skuld, lång vänskap.",
      "💸 Den som betalar tillbaka får sova gott.",
      "💸 Ölguden ser allt. Även skulder.",
      "💸 Swisha och var fri."
    ],
    debtPaid: [
      "✅ Betalt! Vänskapen ä räddad.",
      "✅ Skulden ä borta. Grattis till friheten.",
      "✅ Klart! Banken i Dalarna applåderar."
    ],

    // 📰 Morgontidningen. Placeholders: {name} {n} {bar} {town} {time} {q} {quote} {who} {group} {place} {names}
    paper: {
      mastheadTail: "KVÄLLSPOST",
      price: "Pris: 1 kapsyl",
      slogans: ["Dalarnas mest lästa tidning (i gänget)", "Oberoende. Opartisk. Lite bakis.", "Sanningen, mest", "Grundad i natt"],
      // Big headline candidates per fact kind (pick by priority, then seeded random)
      big: {
        bars: [
          "{name} ERÖVRADE {n} KROGAR – SÅGS ÖVERALLT",
          "KROGTURISTEN {name}: {n} STÄLLEN PÅ EN KVÄLL",
          "{name} PÅ TURNÉ – {n} KROGAR BESÖKTA",
          "EXPERTER CHOCKADE: {name} HANN MED {n} KROGAR",
          "{name} – STADENS NYA KARTLÄSARE"
        ],
        takeover: [
          "GÄNGET TOG ÖVER {bar}!",
          "{bar} ÄR VÅRT – {group} HÖLL KROGEN",
          "HISTORISKT: {group} ERÖVRADE {bar}",
          "KUPP PÅ {bar} – GÄNGET STYRDE"
        ],
        quote: [
          "”{quote}” – {who} TALAR UT",
          "{who} I CHOCKCITAT: ”{quote}”",
          "SÅ SA {who}: ”{quote}”",
          "NATTENS CITAT: ”{quote}”"
        ],
        mt: [
          "{name} UTSEDD: MEST TROLIG ATT {q}",
          "FOLKET HAR TALAT – {name} MEST TROLIG ATT {q}",
          "AVSLÖJAT: {name} KOMMER ATT {q}"
        ],
        skal: [
          "{name} SKÅLADE MED HALVA STAN",
          "SKÅLKUNGEN {name} – {n} SKÅL PÅ EN KVÄLL",
          "{name} KLINGADE I {n} GLAS – REKORD?"
        ],
        home: [
          "{name} HEMMA FÖRST – KL. {time}",
          "KLOKAST I STAN: {name} HEMMA {time}",
          "{name} SMET HEM {time} – ”DET VAR SKÖNT”"
        ],
        eta: [
          "{name} LOVADE {n} MINUTER – KOM TILL SLUT",
          "”JAG Ä PÅ VÄG” – {name} ({n} MIN) SPRENGDE ALLA PROGNOSER",
          "{name}S {n} MINUTER BLEV EN SAGA"
        ],
        kebab: [
          "{name} SÅGS VID {place} – KEBABEN BEKRÄFTAD",
          "NATTENS RÄDDARE: {place} – {name} PÅ PLATS",
          "{name} I SÅSDRAMA PÅ {place}"
        ],
        rally: [
          "{name} BLÅSTE TILL SAMLING – TRUPPEN KOM",
          "INKALLELSE! {name} SAMLADE GÄNGET",
          "{name} KALLADE IN FÖRSTÄRKNING"
        ],
        crawl: [
          "KROGRUNDAN KLAR – ALLA STOPP AVBOCKADE",
          "{group} GJORDE HELA RUNDAN",
          "RUNDAN SOM GICK TILL HISTORIEN"
        ],
        crowd: [
          "{n} AGENTER UTE I {town} – STADEN SKAKADE",
          "{group} INTOG {town} MED {n} MAN",
          "LARM I {town}: HELA GÄNGET UTE"
        ],
        first: [
          "{name} FÖRST UT – KL. {time}",
          "TIDIG FÅGEL: {name} UTE REDAN {time}"
        ],
        quiet: [
          "LUGN KVÄLL I {town} – EXPERTER FÖRBRYLLADE",
          "INGET HÄNDE – OCH DET VAR SKÖNT",
          "STILLHET ÖVER {town}: GÄNGET LADDAR",
          "SOFFAN VANN – ”NÄSTA HELG”, LOVAR GÄNGET"
        ]
      },
      // Small headlines (3 are picked; never the same kind as the big one)
      small: {
        bars: ["{name} hann med {n} krogar", "Krogturisten {name}: {n} stopp", "{name} sågs på {bar}"],
        takeover: ["Gänget höll {bar}", "{bar} – ockuperat av {group}"],
        quote: ["”{quote}” – {who}", "Veckans citat? ”{quote}”", "{who} om livet: ”{quote}”"],
        mt: ["{name}: mest trolig att {q}", "Omröstning: {name} vann", "Folket valde {name}"],
        skal: ["Skålkung: {name} ({n})", "{name} delade ut {n} skål", "{name} – vänligast i stan"],
        home: ["Hemma först: {name} kl. {time}", "{name} tog täcket kl. {time}"],
        eta: ["{name}: ”{n} min”. Typ.", "Längsta ETA: {name}, {n} min"],
        kebab: ["Kebabvittne: {name} på {place}", "{place} räddade natten", "Såsrapport från {place}"],
        rally: ["{name} skickade inkallelse", "Samling! {name} kallade"],
        crawl: ["Krogrundan: alla stopp klara", "Rundan i hamn"],
        crowd: ["{n} ute i {town}", "{town} fick besök av {group}"],
        first: ["Först ut: {name} kl. {time}", "{name} startade kvällen {time}"],
        names: ["Med i natt: {names}", "Närvarande: {names}"],
        filler: ["Vädret: grått, men gänget lyste", "Börsen: kebab upp, sömn ner", "Sport: soffhäng i världsklass",
                 "Insändare: ”Mer pommes åt folket”", "Horoskop: vatten och vila gynnar dig", "Debatt: Vem tar taxin nästa gång?"]
      },
      footer: [
        "Drick vatten. Ät frukost. Ring nån du gillar.",
        "Allt i denna tidning ä sant, typ.",
        "Ölgudens Kvällspost – läst av hela gänget",
        "Nästa nummer: när ni hittar på nåt nytt"
      ],
      none: "Ingen tidning idag. Gänget var int’ ute igår – Kvällsposten tar ledigt."
    },

    // 📰 Morgontidningen v24: KVÄLLENS FÖRLOPP (group_night_story, migration 0032).
    // Every list has at least 15 lines; one paper never shows the same line twice.
    // Placeholders: {name} {n} {bar} {from} {by} {place} {yes} {names} {opp} {us} {them} {min} {other}
    //   {answered} {needed} {fast} {sec} {group} {town} {total} {bars}
    story: {
      heads: { timeline: "KVÄLLENS FÖRLOPP", quotes: "CITAT", photos: "BILDBEVIS", awards: "MEDALJREGN", stats: "KVÄLLEN I SIFFROR" },
      stats: { drinks: "DRYCKER", bars: "KROGAR", skal: "SKÅL", rallies: "INKALLNINGAR", photos: "BILDER" },
      awards: {
        general: "KVÄLLENS GENERAL", late: "LÄNGST UTE", thirsty: "TÖRSTIGAST", skal: "SKÅLMÄSTARE",
        bars: "STIGFINNAREN", photo: "KRIGSFOTOGRAFEN", fast: "SNABBAST TILL FRONTEN"
      },
      why: {
        general: "{n} order till truppen", late: "sista ölen {time}", lateHome: "hemma först {time}", thirsty: "{n} drycker",
        skal: "{n} skål", bars: "{n} krogar", photo: "{n} bildbevis", fast: "svarade på {sec} s"
      },
      caption: "BILDBEVIS: {by} kl. {time}",
      voice: "{n} röstmeddelanden avlyssnade av redaktionen",
      // Big headline per strongest event of the night
      big: {
        meet: [
          "{group} DROG TILL {bar} – MÖTTE ANDRA GÄNGET",
          "FRONTERNA MÖTTES PÅ {bar}",
          "TVÅ GÄNG, EN KROG: {bar} I GUNGNING",
          "ALLIANS BILDAD PÅ {bar}",
          "HISTORISKT TOPPMÖTE PÅ {bar}",
          "{bar} BLEV SAMLINGSPLATS FÖR HALVA STAN",
          "GÄNGEN FÖRENADE – {bar} FICK ÖS",
          "TRUPPEN ANSLÖT MÄ ANDRA GÄNGET PÅ {bar}",
          "FREDSAVTAL SKRIVET PÅ {bar}",
          "STORMÖTE PÅ {bar} – ALLA VA DÄR",
          "{group} OCH ANDRA GÄNGET – NU Ä DÄ EN ARMÉ",
          "KNÖKFULLT PÅ {bar}: GÄNGEN SLOG IHOP SIG",
          "{bar} INTOGS FRÅN TVÅ HÅLL",
          "FÖRSTÄRKNINGEN KOM – OCH DÄ VA ETT HELT GÄNG",
          "ÖVERRASKNING PÅ {bar}: GÄNGET FICK SÄLLSKAP"
        ],
        bars: [
          "{group} ERÖVRADE {n} KROGAR – SÅGS ÖVERALLT",
          "{n} KROGAR PÅ EN KVÄLL – {group} PÅ TURNÉ",
          "OFFENSIVEN RULLADE: {n} KROGAR INTAGNA",
          "TRUPPEN MARSCHERADE GENOM {n} KROGAR",
          "{group} SÅGS PÅ {n} STÄLLEN – SAMTIDIGT?",
          "KARTAN RÖD AV {group}: {n} KROGAR",
          "FÄLTTÅGET: {n} KROGAR, NOLL RETRÄTT",
          "{n} KROGAR SENARE – GÄNGET STÅR FORTFARANDE",
          "BLIXTKRIG I {town}: {n} KROGAR PÅ EN NATT",
          "{group} PÅ ROADTRIP – {n} KROGAR AVBOCKADE",
          "INGEN KROG VA SÄKER: {n} BESÖKTA",
          "STRATEGERNA RYSTE: {n} KROGAR PÅ RAD",
          "{n} KROGAR – GÄNGET KAN INT' STÅ STILL",
          "VANDRINGSPOKALEN TILL {group}: {n} KROGAR",
          "KROGRUNDAN SOM BLEV ETT FÄLTTÅG – {n} STOPP"
        ],
        peak: [
          "FULLT ÖS I SKYTTEGRAVEN: {n} I TIMMEN",
          "{n} DRYCKER PÅ EN TIMME – BAREN SKAKADE",
          "KULMEN KL. {time}: {n} I TIMMEN",
          "TIMMEN SOM GICK TILL HISTORIEN – {n} ST",
          "{group} SATTE TEMPOREKORD: {n} PÅ EN TIMME",
          "BARTENDERN SVETTADES: {n} I TIMMEN",
          "KRANARNA GLÖDDE – {n} PÅ EN TIMME",
          "ANFALLET KL. {time}: {n} DRYCKER",
          "{n} I TIMMEN – EXPERTER MÅLLÖSA",
          "TOPPTIMMEN: {n} GLAS, NOLL PAUS",
          "ÖLFRONTEN BRÖTS IGENOM KL. {time}",
          "{group} I HÖGVARV: {n} PÅ 60 MINUTER",
          "SKYTTEGRAVEN KOKADE – {n} I TIMMEN",
          "MAXFART KL. {time}: {n} I TIMMEN",
          "TEMPOT SOM FICK STAN ATT HÅLLA ANDAN – {n}/H"
        ],
        rally: [
          "FÖRSTÄRKNING TILLKALLADES – {yes} SVARADE",
          "{by} BLÅSTE TILL SAMLING – {yes} KOM",
          "INKALLELSEN SOM FUNKADE: {yes} PÅ VÄG",
          "{yes} MAN SVARADE PÅ {by}S ROP",
          "GENERALEN {by} KALLADE – TRUPPEN LYDDE",
          "LARMET GICK – {yes} RYCKTE UT",
          "{by} RINGDE I KLOCKAN – {yes} KOM SPRINGANDE",
          "MOBILISERING! {yes} SVARADE JA",
          "SAMLING VID {place}: {yes} I LEDET",
          "{by}S INKALLELSE BLEV SUCCÉ",
          "TRUPPEN STRÖMMADE TILL {place}",
          "{yes} SOLDATER SVARADE PÅ ORDERN",
          "ORDER FRÅN {by}: ”KOM!” – OCH DÄ GJORDE DOM",
          "FÖRSTÄRKNINGEN ANLÄNDE TILL {place}",
          "{by} SAMLADE GÄNGET – {yes} SA JA"
        ],
        duelWin: [
          "SEGER! {group} BESEGRADE {opp} {us}–{them}",
          "{opp} KROSSADE – {us} MOT {them}",
          "DUELLEN AVGJORD: {group} VANN",
          "{group} TOG HEM DUELLEN MOT {opp}",
          "TRIUMF! {us}–{them} MOT {opp}",
          "{opp} FICK GÅ HEM MÄ SVANSEN MELLAN BENEN",
          "GULDET TILL {group} – {opp} SLAGNA",
          "{group} VANN KRIGET MOT {opp}",
          "{opp} BÖJDE SIG: {us}–{them}",
          "SEGERPARAD! {group} SLOG {opp}",
          "MEDALJEN HEM – {opp} BESEGRADE",
          "{us}–{them}: {group} ÄGDE DUELLEN",
          "{opp} UTMANADE – OCH FÖRLORADE",
          "SEGER I NATT, BAKIS I MORRN – VÄRT DÄ",
          "DUELLKUNGARNA: {group} FÖRE {opp}"
        ],
        duelLoss: [
          "NEDERLAG MOT {opp} – {us}–{them}",
          "{opp} VANN DUELLEN – REVANSCH KRÄVS",
          "{group} FÖLL MOT {opp}",
          "SORGENS NATT: {us}–{them} MOT {opp}",
          "{opp} TOG SEGERN – GÄNGET SAMLAR SIG",
          "RETRÄTT! {opp} VANN {them}–{us}",
          "{opp} STARKAST I NATT",
          "DUELLEN FÖRLORAD – MEN INTE ÄRAN",
          "{opp} VANN – ”NÄSTA GÅNG”, LOVAR {group}",
          "NEDERLAGET SOM SVED: {us}–{them}",
          "{group} SLOGS TAPPERT – {opp} VANN ÄNDÅ",
          "REVANSCHLUSTEN VÄCKT EFTER {us}–{them}",
          "{opp} 1, {group} 0 – OCH EN HELVETES KVÄLL",
          "SILVER TILL {group} – {opp} TOG GULDET",
          "KRIGSRÅD INKALLAT EFTER FÖRLUST MOT {opp}"
        ],
        duelDraw: [
          "OAVGJORT MOT {opp} – {us}–{them}",
          "DÖDLÄGE! {group} OCH {opp} LIKA",
          "INGEN VANN – ALLA DRACK",
          "{us}–{them}: FRONTEN STOD STILL",
          "VAPENVILA MÄ {opp}",
          "LIKA STARKA: {group} OCH {opp}",
          "DUELLEN SLUTADE JÄMNT",
          "STÄLLNINGSKRIG MOT {opp} – OAVGJORT",
          "{opp} OCH {group} DELAR PÅ ÄRAN",
          "OAVGJORT – OMMATCH KRÄVS",
          "EXAKT LIKA! {us}–{them}",
          "PATT MOT {opp}",
          "INGEN KUNDE KNÄCKA NÅN – {us}–{them}",
          "FREDEN RÄDDAD: OAVGJORT",
          "{group} MOT {opp}: DÖTT LÖPP"
        ],
        status: [
          "GENERALEN KRÄVDE LÄGESRAPPORT – {answered} AV {needed} SVARADE",
          "LÄGESRAPPORT: {answered}/{needed} VID LIV",
          "{by} RÄKNADE TRUPPEN – {answered} SVARADE",
          "ORDER FRÅN HÖGKVARTERET: RAPPORTERA!",
          "TRUPPEN RAPPORTERADE – {fast} SNABBAST",
          "{fast} SVARADE PÅ {sec} SEKUNDER",
          "UPPROP! {answered} AV {needed} RAPPORTERADE",
          "HÖGKVARTERET NÖJT: TRUPPEN VID LIV",
          "{by} HÖLL KOLL PÅ ALLA – NÄSTAN",
          "BILDBEVIS INKRÄVDA – OCH LEVERERADE",
          "LÄGET? ”BRA”, SVARADE {answered}",
          "GENERALENS NATT: {by} HADE KOLL",
          "RAPPORT FRÅN FRONTEN: {answered} SVARADE",
          "{fast} VANN RAPPORTRACET",
          "KONTROLL AV TRUPPEN: GODKÄND"
        ],
        total: [
          "{total} DRYCKER – {group} TÖMDE STAN",
          "REKORDKVÄLL: {total} DRYCKER",
          "{group} DRACK {total} – BRYGGERIET JUBLAR",
          "{total} GLAS SENARE – GÄNGET LEVER",
          "KRANARNA SINADE: {total} DRYCKER",
          "{total} DRYCKER I {town} – EXPERTER CHOCKADE",
          "SIFFRAN SOM FICK STAN ATT HICKA: {total}",
          "{group} SATTE {total} PÅ TAVLAN",
          "{total} SKÅL MOT TAKET",
          "{total} STYCKEN – OCH INGEN SPILLDES",
          "PRODUKTIONEN STEG: {total} DRYCKER",
          "LEVERANS: {total} DRYCKER TILL FRONTEN",
          "{total} DRYCKER – BAREN BAD OM NÅD",
          "RÄKNEVERKET GLÖDDE: {total}",
          "EN KVÄLL, {total} DRYCKER, NOLL ÅNGER"
        ],
        photos: [
          "BILDERNA SOM SKAKAR {town}",
          "{n} BILDBEVIS FRÅN FRONTEN",
          "SE BILDERNA – GÄNGET AVSLÖJAT",
          "KAMERAN GICK VARM: {n} BILDER",
          "FOTOBEVIS: SÅ VAR KVÄLLEN",
          "{n} BILDER SOM ALDRIG FÅR LÄMNA GRUPPEN",
          "BILDREPORTAGE INIFRÅN SKYTTEGRAVEN",
          "EXKLUSIVT: BILDERNA FRÅN NATTEN",
          "PAPARAZZI I GÄNGET – {n} BILDER",
          "BEVISEN ÄR SÄKRADE",
          "NATTENS FOTOALBUM: {n} BILDER",
          "SMILE! {n} BILDER TAGNA",
          "BILDERNA DOM INT' VILL ATT DU SER",
          "REDAKTIONEN HAR BILDERNA",
          "FOTOGRAFERNA VA I TJÄNST HELA NATTEN"
        ],
        crowd: [
          "{n} I GÄNGET UTE – {town} SKAKADE",
          "{group} INTOG {town} MÄ {n} MAN",
          "LARM I {town}: HELA GÄNGET UTE",
          "{n} SOLDATER PÅ STAN",
          "FULL MÖNSTRING: {n} UTE I NATT",
          "{town} BELÄGRAT AV {n} MAN",
          "{group} RYCKTE UT MÄ {n} MAN",
          "{n} UTE – ALLA I TJÄNST",
          "TRUPPEN KOMPLETT: {n} PÅ PLATS",
          "{n} MAN STARK – {group} I {town}",
          "{town} FICK BESÖK AV HELA {group}",
          "STYRKEDEMONSTRATION: {n} UTE",
          "ARMÉN VAKNADE: {n} PÅ STAN",
          "{n} I LEDET – KVÄLLEN KUNDE BÖRJA",
          "GÄNGET I FULL STYRKA: {n} MAN"
        ]
      },
      // Timeline lines (time is drawn in front of each line)
      line: {
        open: [
          "{name} öppnade kvällen", "{name} sköt startskottet", "{name} tände stubinen", "{name} va först i skyttegraven",
          "{name} bröt tystnaden", "{name} drog igång festligheterna", "{name} gick över startlinjen", "{name} blåste reveljen",
          "{name} rapporterade först till tjänst", "{name} öppnade fronten", "{name} tog första klunken", "{name} va först på plats – som vanligt",
          "{name} startade motorn", "{name} hissade flaggan", "Kvällen började – {name} va först"
        ],
        arriveGroup: [
          "{n} vänner anslöt på {bar}", "{n} man samlades på {bar}", "Truppen ({n} st) intog {bar}", "{names} dök upp på {bar}",
          "{n} soldater ryckte in på {bar}", "{bar} fick besök av {n} från gänget", "{n} i gänget tog plats på {bar}",
          "{names} slog läger på {bar}", "Patrullen ({n} man) landade på {bar}", "{n} stycken tog {bar} i besittning",
          "{bar} bemannades av {n} man", "{names} checkade in på {bar}", "{n} vänner hittade hem till {bar}",
          "Förtrupp på {n} man nådde {bar}", "{n} kamrater samlades vid {bar}"
        ],
        arriveSolo: [
          "{name} dök upp på {bar}", "{name} spanade in {bar}", "{name} rekade {bar} ensam", "{name} smög in på {bar}",
          "{name} checkade in på {bar}", "{name} tog posten på {bar}", "{name} höll ställningarna på {bar}",
          "{name} landade på {bar}", "Ensamvargen {name} intog {bar}", "{name} ryckte ut till {bar}",
          "{name} rapporterade från {bar}", "{name} gick in bakom linjerna på {bar}", "{name} säkrade {bar}",
          "{name} tittade förbi {bar}", "{name} spejade från {bar}"
        ],
        move: [
          "Truppen drog till {bar}", "Gänget förflyttade sig till {bar}", "Marsch! Från {from} till {bar}", "Truppen ryckte fram till {bar}",
          "{n} man bytte front till {bar}", "Avancemang: {bar} nästa", "Gänget lämnade {from} – sikte på {bar}",
          "Taktisk förflyttning till {bar}", "Flytt! {names} drog vidare till {bar}", "Ny front öppnad på {bar}",
          "Truppen omgrupperade på {bar}", "Kolonnen rullade vidare till {bar}", "Ut från {from}, in på {bar}",
          "{n} soldater marscherade till {bar}", "Hela styrkan flyttade till {bar}"
        ],
        moveSolo: [
          "{name} smet vidare till {bar}", "{name} drog från {from} till {bar}", "{name} bytte till {bar}",
          "{name} rekognoscerade {bar}", "{name} gick på egen hand till {bar}", "{name} hoppade vidare till {bar}",
          "{name} lämnade {from} – nu på {bar}", "{name} spanade vidare på {bar}", "{name} flankerade till {bar}",
          "{name} tog genvägen till {bar}", "{name} förflyttade sig till {bar}", "{name} letade nya marker på {bar}",
          "{name} försvann – och dök upp på {bar}", "{name} avancerade till {bar}", "{name} drog sig mot {bar}"
        ],
        meet: [
          "Truppen drog till {bar} och anslöt med andra gänget", "På {bar} väntade andra gänget", "Två gäng, en front: {bar}",
          "Gänget mötte förstärkning på {bar}", "{bar}: allians med andra gänget", "Truppen slog ihop sig med andra gänget på {bar}",
          "Andra gänget anslöt på {bar}", "Stormöte på {bar} – {other} st till på plats", "{bar} blev mötesplats för två gäng",
          "Fronterna möttes på {bar}", "Truppen fick sällskap på {bar}", "Gänget drog till {bar} – där va redan fullt",
          "Allierade styrkor sågs på {bar}", "Kontakt med andra gänget på {bar}", "Gängen förenades på {bar}"
        ],
        meetGroup: [
          "Truppen drog till {bar} och mötte {other}", "{other} väntade på {bar}", "Möte mä {other} på {bar}",
          "Toppmöte mä {other} på {bar}", "{bar}: {other} i sikte", "Truppen stötte på {other} på {bar}",
          "Fiendekontakt! {other} på {bar}", "{other} och gänget delade {bar}", "Skål mä {other} på {bar}",
          "Duellanterna {other} sågs på {bar}", "{bar} – gänget och {other} sida vid sida", "Gänget hälsade på {other} på {bar}",
          "{other} anslöt på {bar}", "Fredssamtal mä {other} på {bar}", "Gänget och {other} intog {bar} ihop"
        ],
        rally: [
          "Förstärkning tillkallades – {yes} svarade", "{by} blåste till samling – {yes} kom", "Inkallelse till {place}: {yes} sa ja",
          "{by} skickade order – {yes} lydde", "Larmet gick – {yes} ryckte ut", "{by} kallade på truppen: {yes} svarade",
          "Mobilisering mot {place} – {yes} på väg", "SOS från {by}: {yes} svarade ja", "{by} ringde i klockan – {yes} kom",
          "Order: alla till {place}! {yes} lydde", "{by} bad om förstärkning – fick {yes}", "Samlingssignal från {by}: {yes} svar",
          "Inkallelse! {names} svarade", "{yes} soldater hörsammade {by}", "Förstärkning begärd vid {place} – {yes} kom"
        ],
        rallyQuiet: [
          "{by} kallade in förstärkning – tystnad i luren", "{by} ropade på hjälp – ingen svarade", "Inkallelse till {place} – eko",
          "{by} blåste i luren – bara syrsor svarade", "{by} begärde förstärkning – fick vänta", "Ensam inkallelse från {by}",
          "{by} skickade order – truppen sov", "Larm från {by} – ingen ryckte ut", "{by} väntade vid {place} – länge",
          "{by} kallade – mobilerna låg i fickan", "Ingen hörde {by}s rop", "{by}: ”kom hit!” – tystnad",
          "Signal från {by} – inget svar från fronten", "{by} försökte mobilisera – resultat: noll", "{by} bjöd in till {place} – ingen nappade"
        ],
        eta: [
          "{name}: ”{min} min” – på väg till fronten", "{name} lovade att va där om {min} min", "{name} rapporterade {min} min kvar",
          "{name} i full galopp, {min} min bort", "{name} på marsch – ETA {min} min", "{name}: ”{min} minuter, typ”",
          "{name} kastade sig ut – {min} min", "{name} sprang mot {place}, {min} min", "{name} skickade ETA: {min} min",
          "{name} på ingång om {min} min", "{name} anmälde {min} min till kontakt", "{name} drog på sig kängorna – {min} min",
          "{name} i rörelse, {min} min kvar", "{name} lovade {min} min – höll dä?", "{name} på väg: {min} min till {place}"
        ],
        peak: [
          "Fullt ös i skyttegraven: {n} i timmen", "Kulmen: {n} drycker på en timme", "{n} i timmen – baren skakade",
          "Topptempo: {n} drycker", "Bartendern svettades: {n} i timmen", "Anfallet: {n} drycker på en timme",
          "Kranarna glödde – {n} i timmen", "Högvarv i truppen: {n} drycker", "{n} på en timme – rekord?",
          "Maxfart: {n} i timmen", "Skyttegraven kokade: {n} drycker", "Timmen alla minns: {n} st",
          "Ölfronten bröts igenom: {n} i timmen", "Stormanfall: {n} drycker", "Truppen i högform: {n} i timmen"
        ],
        status: [
          "Generalen {by} krävde lägesrapport – {answered} av {needed} svarade", "Lägesrapport: {answered}/{needed} vid liv",
          "{by} räknade truppen – {answered} svarade", "Upprop från {by}: {answered} rapporterade", "Bildbevis inkrävt – {answered} levererade",
          "Högkvarteret ville veta läget: {answered} svar", "{by} kollade läget – {fast} snabbast", "{fast} svarade på {sec} s",
          "Rapportorder: {answered} av {needed} i tid", "Kontroll av truppen – {answered} svarade", "{by}: ”Läget?” – {answered} svarade",
          "Lägesrapport inkallad av {by}", "Truppen rapporterade: {answered}/{needed}", "Generalens upprop: {fast} först",
          "{by} höll mönstring – {answered} närvarande"
        ],
        duelWin: [
          "Duellen mot {opp} vunnen: {us}–{them}", "Seger mot {opp}! {us}–{them}", "{opp} besegrade, {us}–{them}",
          "Triumf över {opp}", "{opp} slogs ut: {us}–{them}", "Duell: gänget {us}, {opp} {them} – seger",
          "Medalj hem mot {opp}", "{opp} böjde sig", "Segern säkrad mot {opp}", "{opp} fick stryk: {us}–{them}",
          "Duellen avgjord – gänget vann", "Krigslycka mot {opp}: {us}–{them}", "Guld i duellen mot {opp}",
          "{opp} utmanade och förlorade", "{us} mot {them} – seger"
        ],
        duelLoss: [
          "Duellen mot {opp} förlorad: {us}–{them}", "{opp} vann: {them}–{us}", "Nederlag mot {opp}",
          "{opp} drog det längsta strået", "Retreat mot {opp}: {us}–{them}", "{opp} starkast i natt",
          "Duell: {opp} tog segern", "Förlust mot {opp} – revansch planeras", "{opp} vann med {them}–{us}",
          "Tappert men förlorat mot {opp}", "Silver i duellen mot {opp}", "{opp} höll längst",
          "Duellen sved: {us}–{them}", "{opp} tog skalpen", "Revanschlust efter {opp}-duellen"
        ],
        duelDraw: [
          "Duellen mot {opp}: oavgjort {us}–{them}", "Dödläge mot {opp}", "Lika mot {opp}: {us}–{them}",
          "Vapenvila mä {opp}", "Ingen vann duellen mot {opp}", "Patt mot {opp}", "Jämnt mot {opp}: {us}–{them}",
          "Ställningskrig mot {opp}", "Oavgjort – ommatch mot {opp}?", "{opp} och gänget lika starka",
          "Fronten stod still mot {opp}", "Delad ära mä {opp}", "{us}–{them} mot {opp}, ingen vinnare",
          "Duellen slutade jämnt", "Död lopp mot {opp}"
        ],
        duelOn: [
          "Duell startad mot {opp}", "{opp} utmanade – gänget antog", "Krigsförklaring mot {opp}", "Duellen mot {opp} drog igång",
          "Gänget mot {opp}: fight!", "Handsken kastad mot {opp}", "Duell i gång mot {opp}", "{opp} i sikte – duell!",
          "Utmaning antagen: {opp}", "Svärden drogs mot {opp}", "Strid mot {opp} startad", "Duellbanan öppnad mot {opp}",
          "{opp} vs gänget – start", "Kamp mot {opp} inledd", "Gänget gick i duell mot {opp}"
        ],
        photo: [
          "{name} skickade bildbevis", "{name} dokumenterade fronten", "Bildbevis från {name}", "{name} knäppte en bild",
          "{name} rapporterade mä foto", "Kameran i tjänst: {name}", "{name} säkrade bevisen", "Krigsfotograf {name} slog till",
          "{name} delade en bild", "{name} fångade ögonblicket", "Fotobevis från {name}", "{name} skickade hem en bild",
          "{name} tog en bild för eftervärlden", "Bild från fronten – av {name}", "{name} höll kameran redo"
        ],
        lastDrink: [
          "Sista ölen registrerades", "Kranarna stängdes – sista drycken", "Sista klunken togs", "Sista ordern levererad",
          "Sista glaset tömdes", "Sista skottet avlossat", "Fronten tystnade – sista drycken", "Sista rundan avslutad",
          "Kvällens sista registrerades", "Eld upphör – sista drycken", "Sista droppen", "Sista påfyllningen",
          "Nedräkningen klar: sista drycken", "Sista ölen i boken", "Sista kapsylen föll"
        ],
        home: [
          "{name} retirerade först", "{name} tog täcket", "{name} drog sig hem", "{name} lämnade fronten",
          "{name} marscherade hem", "{name} sa hej då", "{name} hittade hem", "{name} gick till förläggningen",
          "{name} lämnade slagfältet", "{name} kröp till kojs", "{name} tog nattbussen hem", "{name} avmönstrade för natten",
          "{name} drog sig tillbaka", "{name} vinkade adjö", "{name} va först i säng"
        ]
      }
    }
  };
})();
