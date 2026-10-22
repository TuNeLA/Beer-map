/* Öl Nu — 📜 VISSTE DU? Short true facts per town, shown rarely by js/calm.js when you zoom in on the town
   (max one town card per day, see calm.js). Data only: window.TOWN_FACTS = { <key>: { name, lat, lng, r (m), sv: [...], en: [...] } }.
   Add a town = add a key. Every line must be checkable: keep the source next to it (owner rule: no invented facts).
   Sources (checked 2026-10-22):
   [SNL]   https://snl.no/Ludvika
   [WPM]   https://en.wikipedia.org/wiki/Ludvika_Municipality
   [WPR]   https://en.wikipedia.org/wiki/Ludvika_Town_Hall
   [WPV]   https://en.wikipedia.org/wiki/V%C3%A4sman
   [WPD]   https://en.wikipedia.org/wiki/Dan_Andersson
   [WPS]   https://en.wikipedia.org/wiki/Spendrups
   [WPL]   https://en.wikipedia.org/wiki/Railway_Museum_of_Gr%C3%A4ngesberg
   [EKH]   https://ekomuseum.se/en/besoksmalen/hammarbacken/
   [VDH]   https://www.visitdalarna.se/en/hammarbacken
   [EKG]   https://ekomuseum.se/en/?p=1130  (Ludvika Gammelgård & Gruvmuseum)
   [EKS]   https://ekomuseum.se/en/besoksmalen/skattlosberg-luossastugan/
   [EKK]   https://ekomuseum.se/en/besoksmalen/klenshyttan/
   [EKGR]  https://ekomuseum.se/en/besoksmalen/grangesbergs-gruvomrade/
   [VDC]   https://visitdalarna.se/en/do/activities/cassels-konserthus
   [SKBL]  https://skbl.se/en/article/FejanForsslund  (Brunnsviks folkhögskola)
   [NKU]   https://www.naturkartan.se/en/dalarnas-lan/ulrika-kyrka-2
   [HE20]  https://www.hitachienergy.com/news-and-events/press-releases/2020/09/hitachi-abb-power-grids-marks-120-years-of-innovation-in-ludvika-sweden
   [DPS]   https://www.dagensps.se/foretag/ludvika-kan-bli-varldens-kraftcentrum-vaxer-med-40-procent/
   [BJ22]  https://www.ekeving.se/b/gdg/BJ/1922/01_oversikt_tillkomst.pdf  (Bergslagernas Järnvägar 1922) */
(function () {
  "use strict";
  window.TOWN_FACTS = window.TOWN_FACTS || {};
  window.TOWN_FACTS.ludvika = {
    name: "Ludvika", lat: 60.1496, lng: 15.1878, r: 3500,
    sv: [
      "Ludvika fick stadsrättigheter 1919. Hä ä alltså en stad mä papper på't.",                                   // [WPM] [WPR]
      "1971 slogs Ludvika ihop mä Grangärde och Säfsnäs. Så föddes dagens kommun.",                                  // [WPM]
      "Ludvika växte fram från 1500-talet runt kronans järnbruk. Järn först, öl sen.",                              // [SNL] [VDH]
      "Gustav Vasa skickade folk från Sala för att leta silver här. De hittade inget silver – men en bäck mä 17,7 meters fall.", // [EKH]
      "Kronan ägde Ludvika bruk ända till 1726. Då köpte friherre Jonas Cedercreutz hela rasket.",                   // [EKH]
      "Järnbruket i Ludvika lade ner 1920. Hammarna tystnade, staden fortsatte.",                                    // [VDH]
      "Hammarbacken norr om Ludvika ström ä stans äldsta del. Där bodde smederna.",                                  // [EKH]
      "Det vita sädesmagasinet på Hammarbacken byggdes 1805 – fyra våningar, för att svälten på 1780-talet int' skulle komma igen.", // [EKH] [VDH]
      "Disponent Carl Roths plan mä 112 kvarter blev grunden till Ludvika som stan ser ut idag.",                     // [EKH]
      "Ett smedhus i slaggsten står kvar på Hammarbacken. På 1800-talet bodde över 30 personer i det.",               // [EKH]
      "Väsman ä 39,1 km² stor. Hä ä mycket vatten att ha bredvid en krog.",                                         // [WPV]
      "Väsman ä som djupast 53 meter. Tappa int' telefonen där.",                                                    // [WPV]
      "Väsman ä ungefär 14 km lång och har 69,4 km strand. Promenera runt, sen ä du förtjänt av en öl.",             // [WPV]
      "Väsmans yta ligger 154 meter över havet. Ölen här ä alltså högt räknad.",                                     // [WPV]
      "1900 startade Elektriska AB Magnet i Ludvika. Det blev senare ASEA – och idag Hitachi Energy.",               // [HE20]
      "1 juli 2020 bildades Hitachi ABB Power Grids. Fabriken i Ludvika bytte skylt, int' adress.",                  // [HE20]
      "I Ludvika finns två högspänningslabb i världsklass och två testhallar för ultrahög spänning. Rör int' sladdarna.", // [HE20]
      "Runt 4 400 personer jobbade på Hitachi Energy i Ludvika i slutet av 2024.",                                   // [DPS]
      "I mars 2026 skeppades världens största HVDC VSC-transformator från Ludvika till Kina: 750 MVA och 446 ton.",     // [DPS]
      "2024 tog Ludvika-fabrikerna Sveriges största exportorder nånsin – 147 miljarder kronor.",                       // [DPS]
      "ABB-fabriken i Ludvika gör stora krafttransformatorer och högspänningsutrustning. Ström ut i världen.",        // [SNL] [DPS]
      "Rådhuset i Ludvika ritades av Cyrillus Johansson och byggdes 1936–1938. Tegelexpressionism, soldat.",           // [WPR]
      "Byggarna av rådhuset satte in en hund i kakelmedaljongerna för sin lösdrivande maskot Stella. Hon har en staty i trädgården.", // [WPR]
      "Rådhusets tornur gjordes av Linderoths urverk i Stockholm 1937 och sattes upp 1938.",                         // [WPR]
      "Kronorna ovanför rådhusets fönster påminner om stadsprivilegierna, 1919–1971.",                                // [WPR]
      "Ulrika kyrka ä uppkallad efter drottning Ulrika Eleonora. Hon skänkte nattvardskärl till kyrkan.",            // [NKU]
      "Klockstapeln vid Ulrika kyrka byggdes 1752 av Gabriel Bragner.",                                              // [NKU]
      "Ludvika blev en egen församling först 1863.",                                                                 // [NKU]
      "Dan Andersson föddes 6 april 1888 i Skattlösberg i Grangärde. Finnmarkens egen poet.",                          // [WPD] [EKS]
      "Dan Andersson skrev Kolarhistorier (1914) i Luossastugan i Skattlösberg.",                                     // [WPD] [EKS]
      "Dan Andersson ä begravd på Lyvikens kyrkogård i Ludvika.",                                                    // [WPD]
      "Första veckan i augusti ä det Dan Andersson-veckan i Ludvika. Visor, kolare och lugna kvällar.",               // [WPD]
      "Dan Andersson skickades till Minnesota 1902, bara 14 år gammal. Han skrev hem att det int' var bättre där.",    // [WPD]
      "Svarta ballader kom 1917. Där finns 'Omkring tiggarn från Luossa'.",                                          // [WPD]
      "Brunnsviks folkhögskola startade 1906. Dan Andersson pluggade där 1914–1915.",                                  // [SKBL] [WPD]
      "Ludvika gruvmuseum öppnade 1938 och kallas världens första friluftsmuseum för industrihistoria.",               // [EKG]
      "På Gammelgården i Ludvika snurrar ett vattenhjul på ungefär 15 meter i diameter. Platsens eget märke.",        // [EKG]
      "Ludvika hembygdsförening grundades 1920 av Karl-Erik Forsslund.",                                              // [EKG]
      "Järnvägen Falun–Ludvika öppnade nyårsafton 1875. Tåget har tuffat här i över 150 år.",                          // [BJ22]
      "Banan Ludvika–Daglösen öppnade 3 januari 1877.",                                                              // [BJ22]
      "Gruvan i Grängesberg stängde 1989. Sista malmtåget till Oxelösund gick 1990.",                                 // [EKGR]
      "I mitten av 1800-talet fanns runt 200 dagbrott och gruvor kring Grängesberg.",                                 // [EKGR]
      "1975 jobbade 1 600 personer i gruvan i Grängesberg.",                                                          // [EKGR]
      "1923 köpte bryggaren Louis Spendrup Grängesbergs bryggeri. Öl i kommunen har lång tradition.",                   // [WPS]
      "Cassels konserthus i Grängesberg invigdes 1900. Fasaden ä inspirerad av Bank of England.",                      // [VDC]
      "Lokmuseet i Grängesberg öppnade 1979 i ett lokstall från 1928. Där står ett ångturbinlok från 1930.",            // [WPL]
      "Klenshyttans masugn från 1842 står kvar på vägen mellan Ludvika och Grängesberg.",                              // [EKK]
      "Namnet Ludvika kommer från 'ludd' – vass. Int' från nån som hette Ludvig.",                                    // [SNL]
      "Mellan 1970 och 2000 krympte Ludvikas befolkning mä över 20 procent. Sen 2010 växer den igen."                 // [SNL]
    ],
    en: [
      "Ludvika got its town charter in 1919.",                                                                        // [WPM]
      "Ludvika grew up from the 1500s around the Crown's ironworks.",                                                 // [SNL]
      "Lake Väsman is 39.1 km² and up to 53 m deep.",                                                                 // [WPV]
      "Elektriska AB Magnet started in Ludvika in 1900. It later became ASEA – today Hitachi Energy.",               // [HE20]
      "The town hall (1936–1938) has a stray dog, Stella, hidden in its tiles and a statue of her in the garden.",     // [WPR]
      "The poet Dan Andersson (born 1888 in Grangärde) is buried at Lyviken cemetery in Ludvika.",                     // [WPD]
      "Ludvika's mining museum opened in 1938: called the world's first open-air industrial history museum.",          // [EKG]
      "The Grängesberg mine closed in 1989; the last ore train to Oxelösund left in 1990."                             // [EKGR]
    ]
  };
})();
