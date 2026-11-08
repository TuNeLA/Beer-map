/* PintsNow — taxi per town. ONE source of truth (agent bold, bd09, 2026-11-08; owner rule: every number checked against a real
 source, a number we could not verify is NOT here). Used by: the 🚕 Taxi sheet (extras.js, rundan.js), Hem-läge (bold-taxi.js),
 hometown.js (town names + coordinates, also from "places").
 Fields: town, lat, lng, name, text, tel, src (kind of source), url (the source). unverified: true = shown in the old Taxi
 sheet only, never in Hem-läge, until the owner confirms it.
 "places" = towns without a verified taxi number (name + position only; the Taxi sheet shows Uber / a map search there).
 fallback: null (the national TaxiKurir 0771 number could not be verified). */
window.TAXI_DATA = {
"fallback": null,
"towns": [
// UNVERIFIED – owner to confirm (only found in a directory listing: gobytaxi.com)
{"town":"Ludvika","lat":60.1496,"lng":15.1878,"name":"Ludvikataxi","text":"0240-139 00","tel":"+4624013900","src":"dir","url":"https://www.gobytaxi.com/drivers/55580","unverified":true},
// Stockholm: company site — https://www.taxistockholm.se/en/booking
{"town":"Stockholm","lat":59.3293,"lng":18.0686,"name":"Taxi Stockholm","text":"08-15 00 00","tel":"+468150000","src":"co","url":"https://www.taxistockholm.se/en/booking"},
// Göteborg: arrivalguides city guide — https://www.arrivalguides.com/en/Travelguide/GOTHENBURG/essentialinformation/taxi-7758
{"town":"Göteborg","lat":57.7089,"lng":11.9746,"name":"Taxi Göteborg","text":"031-65 00 00","tel":"+4631650000","src":"guide","url":"https://www.arrivalguides.com/en/Travelguide/GOTHENBURG/essentialinformation/taxi-7758"},
// Malmö: arrivalguides city guide — https://www.arrivalguides.com/fr/Travelguide/MALMO/essentialinformation/taxi-12852
{"town":"Malmö","lat":55.605,"lng":13.0038,"name":"Taxi97","text":"040-97 97 97","tel":"+4640979797","src":"guide","url":"https://www.arrivalguides.com/fr/Travelguide/MALMO/essentialinformation/taxi-12852"},
// Uppsala: arrivalguides city guide — https://www.arrivalguides.com/ru/Travelguide/UPPSALA/essentialinformation/taxi-21854
{"town":"Uppsala","lat":59.8586,"lng":17.6389,"name":"Uppsala Taxi 100 000","text":"018-100 000","tel":"+4618100000","src":"guide","url":"https://www.arrivalguides.com/ru/Travelguide/UPPSALA/essentialinformation/taxi-21854"},
// Falun: university page — https://www.du.se/en/study-at-du/new-students/living-in-sweden/travel-to-and-in-dalarna/
{"town":"Falun","lat":60.6065,"lng":15.6355,"name":"Taxi i Falun","text":"023-153 00","tel":"+462315300","src":"edu","url":"https://www.du.se/en/study-at-du/new-students/living-in-sweden/travel-to-and-in-dalarna/"},
// Borlänge: university page — https://www.du.se/en/study-at-du/new-students/living-in-sweden/travel-to-and-in-dalarna/
{"town":"Borlänge","lat":60.4858,"lng":15.4371,"name":"Taxi i Borlänge","text":"0243-22 88 00","tel":"+46243228800","src":"edu","url":"https://www.du.se/en/study-at-du/new-students/living-in-sweden/travel-to-and-in-dalarna/"},
// Gävle: company register name + directory — https://tic.io/en/foretag/gavle-taxi-129000-ab-1889503
{"town":"Gävle","lat":60.6749,"lng":17.1413,"name":"Gävle Taxi","text":"026-12 90 00","tel":"+4626129000","src":"reg","url":"https://tic.io/en/foretag/gavle-taxi-129000-ab-1889503"},
// Örebro: arrivalguides city guide — https://www.arrivalguides.com/en/Travelguide/OREBRO/essentialinformation/taxi-24477
{"town":"Örebro","lat":59.2753,"lng":15.2134,"name":"Örebro Taxi","text":"019-20 01 20","tel":"+4619200120","src":"guide","url":"https://www.arrivalguides.com/en/Travelguide/OREBRO/essentialinformation/taxi-24477"},
// Linköping: arrivalguides city guide — https://www.arrivalguides.com/en/Travelguide/LINKOPING/essentialinformation/taxi-24475
{"town":"Linköping","lat":58.4108,"lng":15.6214,"name":"Taxikurir Linköping","text":"013-15 00 00","tel":"+4613150000","src":"guide","url":"https://www.arrivalguides.com/en/Travelguide/LINKOPING/essentialinformation/taxi-24475"},
// Jönköping: university page — https://ju.se/en/study-at-ju/accommodation-and-arrival/how-to-get-to-jonkoping.html
{"town":"Jönköping","lat":57.7826,"lng":14.1618,"name":"Taxikurir Jönköping","text":"036-12 12 12","tel":"+4636121212","src":"edu","url":"https://ju.se/en/study-at-ju/accommodation-and-arrival/how-to-get-to-jonkoping.html"},
// Nyköping: tourism page — https://www.nykopingsguiden.se/en/travel-information
{"town":"Nyköping","lat":58.753,"lng":17.0079,"name":"Taxi Nyköping Oxelösund","text":"0155-21 75 00","tel":"+46155217500","src":"tour","url":"https://www.nykopingsguiden.se/en/travel-information"},
// Kalmar: arrivalguides city guide — https://www.arrivalguides.com/sv/Travelguide/KALMAR/essentialinformation/taxi-24126
{"town":"Kalmar","lat":56.6634,"lng":16.3568,"name":"Taxi Netto","text":"0480-160 00","tel":"+4648016000","src":"guide","url":"https://www.arrivalguides.com/sv/Travelguide/KALMAR/essentialinformation/taxi-24126"},
// Visby: arrivalguides city guide — https://www.arrivalguides.com/en/Travelguide/GOTLAND/essentialinformation/telefon-25579
{"town":"Visby","lat":57.6348,"lng":18.2948,"name":"Taxi Gotland","text":"0498-200 200","tel":"+46498200200","src":"guide","url":"https://www.arrivalguides.com/en/Travelguide/GOTLAND/essentialinformation/telefon-25579"},
// Sundsvall: airport operator page — https://www.sdlairport.se/english/start/transport/taxi.html
{"town":"Sundsvall","lat":62.3908,"lng":17.3069,"name":"Sverigetaxi Sundsvall","text":"060-19 90 00","tel":"+4660199000","src":"air","url":"https://www.sdlairport.se/english/start/transport/taxi.html"},
// Örnsköldsvik: airport operator page — https://ws.swedavia.se/umea/taxi
{"town":"Örnsköldsvik","lat":63.2909,"lng":18.7153,"name":"Örntaxi","text":"0660-10 000","tel":"+4666010000","src":"air","url":"https://ws.swedavia.se/umea/taxi"},
// Umeå: airport operator page — https://ws.swedavia.se/umea/taxi
{"town":"Umeå","lat":63.8258,"lng":20.263,"name":"Taxi Nord","text":"090-15 15 15","tel":"+4690151515","src":"air","url":"https://ws.swedavia.se/umea/taxi"},
// Skellefteå: tourism page — https://www.visitskelleftea.se/en/travel-to-skelleftea/get-around/
{"town":"Skellefteå","lat":64.7507,"lng":20.9528,"name":"Skellefteå Taxi","text":"0910-170 00","tel":"+4691017000","src":"tour","url":"https://www.visitskelleftea.se/en/travel-to-skelleftea/get-around/"},
// Luleå: arrivalguides city guide — https://www.arrivalguides.com/sv/Travelguide/Lulea/essentialinformation/telefon-25707
{"town":"Luleå","lat":65.5848,"lng":22.1547,"name":"MinTaxi Norrbotten","text":"0920-300 00","tel":"+4692030000","src":"guide","url":"https://www.arrivalguides.com/sv/Travelguide/Lulea/essentialinformation/telefon-25707"},
// Kiruna: airport operator page — https://www.swedavia.com/kiruna/taxi/
{"town":"Kiruna","lat":67.8558,"lng":20.2253,"name":"Taxi Kiruna","text":"0980-120 20","tel":"+4698012020","src":"air","url":"https://www.swedavia.com/kiruna/taxi/"}
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
