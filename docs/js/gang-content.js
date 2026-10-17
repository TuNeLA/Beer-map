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
    }
  };
})();
