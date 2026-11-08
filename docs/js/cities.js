/* Small built-in list of Swedish towns, used to group beers by city in the top list. */
(function () {
  "use strict";
  var U = window.U;
  var CITIES = [
    ["Stockholm", 59.3293, 18.0686], ["Göteborg", 57.7089, 11.9746], ["Malmö", 55.6050, 13.0038],
    ["Uppsala", 59.8586, 17.6389], ["Västerås", 59.6099, 16.5448], ["Örebro", 59.2753, 15.2134],
    ["Linköping", 58.4108, 15.6214], ["Helsingborg", 56.0465, 12.6945], ["Jönköping", 57.7826, 14.1618],
    ["Norrköping", 58.5877, 16.1924], ["Lund", 55.7047, 13.1910], ["Umeå", 63.8258, 20.2630],
    ["Gävle", 60.6749, 17.1413], ["Borås", 57.7210, 12.9401], ["Södertälje", 59.1955, 17.6253],
    ["Eskilstuna", 59.3666, 16.5077], ["Halmstad", 56.6745, 12.8578], ["Växjö", 56.8777, 14.8091],
    ["Karlstad", 59.3793, 13.5036], ["Sundsvall", 62.3908, 17.3069], ["Luleå", 65.5848, 22.1547],
    ["Trollhättan", 58.2837, 12.2886], ["Östersund", 63.1792, 14.6357], ["Borlänge", 60.4858, 15.4371],
    ["Falun", 60.6065, 15.6355], ["Kalmar", 56.6634, 16.3566], ["Kristianstad", 56.0294, 14.1567],
    ["Skövde", 58.3903, 13.8461], ["Karlskrona", 56.1612, 15.5869], ["Uddevalla", 58.3498, 11.9356],
    ["Varberg", 57.1056, 12.2508], ["Visby", 57.6348, 18.2948], ["Kiruna", 67.8558, 20.2253],
    ["Ludvika", 60.1496, 15.1878], ["Nyköping", 58.7530, 17.0079], ["Motala", 58.5371, 15.0365],
    ["Piteå", 65.3172, 21.4794], ["Skellefteå", 64.7507, 20.9528], ["Örnsköldsvik", 63.2909, 18.7153],
    ["Mora", 61.0070, 14.5430],
    // tx04: the other towns of the server list (olnu_towns), so client and server name the same town
    ["Alingsås", 57.93, 12.533], ["Älvdalen", 61.2272, 14.0393], ["Arboga", 59.394, 15.838],
    ["Åre", 63.399, 13.081], ["Arvika", 59.655, 12.585], ["Avesta", 60.1455, 16.1679],
    ["Boden", 65.825, 21.689], ["Bollnäs", 61.348, 16.394], ["Enköping", 59.636, 17.077],
    ["Fagersta", 60.004, 15.7932], ["Gällivare", 67.133, 20.66], ["Grängesberg", 60.0786, 14.9967],
    ["Haparanda", 65.835, 24.137], ["Härnösand", 62.632, 17.938], ["Hedemora", 60.2765, 15.9881],
    ["Hofors", 60.546, 16.287], ["Hudiksvall", 61.729, 17.104], ["Köping", 59.514, 15.993],
    ["Kopparberg", 59.874, 14.995], ["Kramfors", 62.931, 17.777], ["Kristinehamn", 59.309, 14.108],
    ["Kungsbacka", 57.487, 12.076], ["Landskrona", 55.87, 12.83], ["Leksand", 60.7307, 14.9993],
    ["Lidköping", 58.505, 13.158], ["Lindesberg", 59.594, 15.229], ["Lycksele", 64.595, 18.676],
    ["Malung", 60.6855, 13.7157], ["Orsa", 61.1203, 14.6153], ["Rättvik", 60.8857, 15.1199],
    ["Sala", 59.92, 16.606], ["Sälen", 61.16, 13.265], ["Sandviken", 60.6199, 16.7759],
    ["Säter", 60.3466, 15.7506], ["Smedjebacken", 60.1405, 15.4128], ["Söderhamn", 61.304, 17.059],
    ["Trelleborg", 55.375, 13.157], ["Vansbro", 60.5108, 14.2244], ["Västervik", 57.758, 16.637],
    ["Ystad", 55.429, 13.82]
  ].map(function (c) { return { name: c[0], lat: c[1], lng: c[2] }; });
  var MAX_M = 40000;

  window.CITIES = {
    list: CITIES,
    // Nearest town within 40 km, or null.
    nearest: function (lat, lng) {
      var best = null, bestD = MAX_M;
      for (var i = 0; i < CITIES.length; i++) {
        var c = CITIES[i];
        if (Math.abs(c.lat - lat) > 0.5) continue;
        var d = U.haversine(lat, lng, c.lat, c.lng);
        if (d <= bestD) { bestD = d; best = c; }
      }
      return best;
    }
  };
})();
