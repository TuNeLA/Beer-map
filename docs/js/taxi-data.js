/* PintsNow — taxi per town. ONE source of truth (agent bold, bd09, 2026-11-08; owner rule: every number checked against a real
 source, a number we could not verify is NOT here). Used by: the 🚕 Taxi sheet (extras.js, rundan.js), Hem-läge (bold-taxi.js),
 hometown.js (town names + coordinates, also from "places").
 Fields: town, lat, lng, name, text, tel, src (kind of source), url (the source). unverified: true = shown in the old Taxi
 sheet only, never in Hem-läge, until the owner confirms it.
 "places" = towns without a verified taxi number (name + position only; the Taxi sheet shows Uber / a map search there).
 fallback: null (the national TaxiKurir 0771 number could not be verified).
 B2 (taxi lane, 2026-11-10): every row re-checked on the company's OWN site (src "co"); URL + date in the comment. */
window.TAXI_DATA = {
"fallback": null,
"towns": [
// Ludvika: OFFICIAL – Taxi Dalarna (Ludvikataxi AB is a member) footer: 'Ludvika / Smedjebacken / Grängesberg – Ludvikataxi AB 0240-139 00' – https://taxidalarna.se/ – checked 2026-11-10
{"town":"Ludvika","lat":60.1496,"lng":15.1878,"name":"Ludvikataxi","text":"0240-139 00","tel":"+4624013900","src":"co","url":"https://taxidalarna.se/"},
// Stockholm: OFFICIAL – company site: 08-15 00 00 – https://www.taxistockholm.se/ – checked 2026-11-10
{"town":"Stockholm","lat":59.3293,"lng":18.0686,"name":"Taxi Stockholm","text":"08-15 00 00","tel":"+468150000","src":"co","url":"https://www.taxistockholm.se/"},
// Göteborg: OFFICIAL – company site: 031-650 000 – https://www.taxigoteborg.se/ – checked 2026-11-10
{"town":"Göteborg","lat":57.7089,"lng":11.9746,"name":"Taxi Göteborg","text":"031-650 000","tel":"+4631650000","src":"co","url":"https://www.taxigoteborg.se/"},
// Malmö: OFFICIAL – company site: 'Boka på 040-330 330' (Taxi97 had no reachable site) – https://www.taxiskane.se/ – checked 2026-11-10
{"town":"Malmö","lat":55.605,"lng":13.0038,"name":"Taxi Skåne","text":"040-330 330","tel":"+4640330330","src":"co","url":"https://www.taxiskane.se/"},
// Uppsala: OFFICIAL – company site: 018-100 000 – https://www.uppsalataxi.se/ – checked 2026-11-10
{"town":"Uppsala","lat":59.8586,"lng":17.6389,"name":"Uppsala Taxi 100 000","text":"018-100 000","tel":"+4618100000","src":"co","url":"https://www.uppsalataxi.se/"},
// Falun: OFFICIAL – TaxiKurir city list: 'Falun | 023-153 00' – https://www.taxikurir.se/hitta-stad-och-priser – checked 2026-11-10
{"town":"Falun","lat":60.6065,"lng":15.6355,"name":"TaxiKurir Falun","text":"023-153 00","tel":"+462315300","src":"co","url":"https://www.taxikurir.se/hitta-stad-och-priser"},
// Borlänge: OFFICIAL – Taxi Dalarna footer: 'Borlänge / Säter – Borlängetaxiservice AB 0243-131 00' (0243-22 88 00 had no official source) – https://taxidalarna.se/ – checked 2026-11-10
{"town":"Borlänge","lat":60.4858,"lng":15.4371,"name":"Borlängetaxiservice","text":"0243-131 00","tel":"+4624313100","src":"co","url":"https://taxidalarna.se/"},
// Gävle: OFFICIAL – company site: 026-12 90 00 – https://www.gavletaxi.se/ – checked 2026-11-10
{"town":"Gävle","lat":60.6749,"lng":17.1413,"name":"Gävle Taxi","text":"026-12 90 00","tel":"+4626129000","src":"co","url":"https://www.gavletaxi.se/"},
// Örebro: OFFICIAL – TaxiKurir city list: 'Örebro | 019-12 30 30' (019-20 01 20 had no official source) – https://www.taxikurir.se/hitta-stad-och-priser – checked 2026-11-10
{"town":"Örebro","lat":59.2753,"lng":15.2134,"name":"TaxiKurir Örebro","text":"019-12 30 30","tel":"+4619123030","src":"co","url":"https://www.taxikurir.se/hitta-stad-och-priser"},
// Linköping: OFFICIAL – TaxiKurir city list: 'Linköping | 013- 15 15 15' (was 013-15 00 00) – https://www.taxikurir.se/hitta-stad-och-priser – checked 2026-11-10
{"town":"Linköping","lat":58.4108,"lng":15.6214,"name":"TaxiKurir Linköping","text":"013-15 15 15","tel":"+4613151515","src":"co","url":"https://www.taxikurir.se/hitta-stad-och-priser"},
// Jönköping: OFFICIAL – TaxiKurir city list: 'Jönköping | 036-12 12 12' – https://www.taxikurir.se/hitta-stad-och-priser – checked 2026-11-10
{"town":"Jönköping","lat":57.7826,"lng":14.1618,"name":"TaxiKurir Jönköping","text":"036-12 12 12","tel":"+4636121212","src":"co","url":"https://www.taxikurir.se/hitta-stad-och-priser"},
// Nyköping: OFFICIAL – company site: 0155-21 75 00 (also Nyköpings kommun visitor site nykopingsguiden.se) – https://www.taxinyox.se/ – checked 2026-11-10
{"town":"Nyköping","lat":58.753,"lng":17.0079,"name":"Taxi Nyköping Oxelösund","text":"0155-21 75 00","tel":"+46155217500","src":"co","url":"https://www.taxinyox.se/"},
// Kalmar: OFFICIAL – company site contact: 0480-16000 – https://www.nettotaxi.se/ – checked 2026-11-10
{"town":"Kalmar","lat":56.6634,"lng":16.3568,"name":"Nettotaxi","text":"0480-160 00","tel":"+4648016000","src":"co","url":"https://www.nettotaxi.se/"},
// Visby: OFFICIAL – company contact page: 'Bokning via telefon 0498 - 200 200' – https://www.taxigotland.se/sv-SE/kontakt-37069304 – checked 2026-11-10
{"town":"Visby","lat":57.6348,"lng":18.2948,"name":"Taxi Gotland","text":"0498-200 200","tel":"+46498200200","src":"co","url":"https://www.taxigotland.se/sv-SE/kontakt-37069304"},
// Sundsvall: OFFICIAL – Sverigetaxi city list: 'Sundsvall | 060 - 19 90 00' – https://www.sverigetaxi.se/hitta-stad-och-priser – checked 2026-11-10
{"town":"Sundsvall","lat":62.3908,"lng":17.3069,"name":"Sverigetaxi Sundsvall","text":"060-19 90 00","tel":"+4660199000","src":"co","url":"https://www.sverigetaxi.se/hitta-stad-och-priser"},
// Örnsköldsvik: OFFICIAL – company site: 'Ring 0660 - 10 000' – https://www.orntaxi.se/ – checked 2026-11-10
{"town":"Örnsköldsvik","lat":63.2909,"lng":18.7153,"name":"Örntaxi","text":"0660-10 000","tel":"+4666010000","src":"co","url":"https://www.orntaxi.se/"},
// Umeå: OFFICIAL – company site: 'Ring direkt 090-15 15 15' – https://www.taxinord.se/ – checked 2026-11-10
{"town":"Umeå","lat":63.8258,"lng":20.263,"name":"Taxi Nord","text":"090-15 15 15","tel":"+4690151515","src":"co","url":"https://www.taxinord.se/"},
// Skellefteå: OFFICIAL – company site: 'Boka taxi 0910-17 000' – https://www.skellefteataxi.se/ – checked 2026-11-10
{"town":"Skellefteå","lat":64.7507,"lng":20.9528,"name":"Skellefteå Taxi","text":"0910-170 00","tel":"+4691017000","src":"co","url":"https://www.skellefteataxi.se/"},
// Luleå: OFFICIAL – company site: 'Luleå 0920-30000' – https://www.mintaxi.se/ – checked 2026-11-10
{"town":"Luleå","lat":65.5848,"lng":22.1547,"name":"Min Taxi Luleå","text":"0920-300 00","tel":"+4692030000","src":"co","url":"https://www.mintaxi.se/"},
// Kiruna: OFFICIAL – Sverigetaxi city list: 'Kiruna | 0980 - 120 20' – https://www.sverigetaxi.se/hitta-stad-och-priser – checked 2026-11-10
{"town":"Kiruna","lat":67.8558,"lng":20.2253,"name":"Sverigetaxi Kiruna","text":"0980-120 20","tel":"+4698012020","src":"co","url":"https://www.sverigetaxi.se/hitta-stad-och-priser"}
],
"places": [
{"town":"Smedjebacken","lat":60.1403,"lng":15.4122},
{"town":"Avesta","lat":60.1455,"lng":16.1679},
{"town":"Hedemora","lat":60.2754,"lng":15.9883},
{"town":"Säter","lat":60.3478,"lng":15.7509},
{"town":"Mora","lat":61.007,"lng":14.543},
{"town":"Orsa","lat":61.1197,"lng":14.6155},
{"town":"Vansbro","lat":60.5103,"lng":14.2245},
{"town":"Gagnef (Djurås)","lat":60.5582,"lng":15.1347},
{"town":"Grängesberg","lat":60.0759,"lng":14.9957},
{"town":"Västerås","lat":59.6099,"lng":16.5448},
{"town":"Helsingborg","lat":56.0465,"lng":12.6945},
{"town":"Norrköping","lat":58.5877,"lng":16.1924},
{"town":"Lund","lat":55.7047,"lng":13.191},
{"town":"Borås","lat":57.721,"lng":12.9401},
{"town":"Södertälje","lat":59.1955,"lng":17.6253},
{"town":"Eskilstuna","lat":59.3717,"lng":16.5077},
{"town":"Halmstad","lat":56.6745,"lng":12.8578},
{"town":"Växjö","lat":56.8777,"lng":14.8091},
{"town":"Karlstad","lat":59.3793,"lng":13.5036},
{"town":"Östersund","lat":63.1792,"lng":14.6357},
{"town":"Trollhättan","lat":58.2837,"lng":12.2886},
{"town":"Kristianstad","lat":56.0294,"lng":14.1567},
{"town":"Skövde","lat":58.3903,"lng":13.8461},
{"town":"Karlskrona","lat":56.1612,"lng":15.5869},
{"town":"Uddevalla","lat":58.3498,"lng":11.9356},
{"town":"Varberg","lat":57.1056,"lng":12.2508},
{"town":"Falkenberg","lat":56.9055,"lng":12.4912},
{"town":"Motala","lat":58.5371,"lng":15.0365},
{"town":"Sandviken","lat":60.6216,"lng":16.7755},
{"town":"Köping","lat":59.514,"lng":15.9926},
{"town":"Fagersta","lat":60.0042,"lng":15.7932},
{"town":"Arboga","lat":59.3939,"lng":15.8388}
]
};
