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
    ["Mora", 61.0070, 14.5430]
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
