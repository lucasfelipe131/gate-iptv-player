(function (root) {
  "use strict";

  var query = String(root.location && root.location.search || "");
  var userAgent = String(root.navigator && root.navigator.userAgent || "");

  // Android and Google TV show the opening VAST ad in the native launcher
  // Activity. Mark the web-shell ad as handled to prevent a second ad or the
  // local house fallback from appearing when MainActivity loads the catalogue.
  var androidWrapper = /(?:[?&]platform=android(?:tv)?(?:&|$))/i.test(query)
    || /GATE-IPTV-PLAYER\/\d/i.test(userAgent);
  if (androidWrapper) {
    try { root.sessionStorage.setItem("gate.adShown", "true"); } catch (_) {}
  }

  if (!/(?:[?&]platform=tizen(?:&|$))/i.test(query) && !/Tizen/i.test(userAgent)) return;
  if (root.webapis && root.webapis.avplay) return;

  // Tizen resolves this SDK alias inside the signed widget context. Keeping the
  // load parser-blocking ensures AVPlay exists before platform-player.js runs.
  root.document.write('<script src="$WEBAPIS/webapis/webapis.js"><\/script>');
}(window));
