(function (root) {
  "use strict";

  var query = String(root.location && root.location.search || "");
  var userAgent = String(root.navigator && root.navigator.userAgent || "");
  if (!/(?:[?&]platform=tizen(?:&|$))/i.test(query) && !/Tizen/i.test(userAgent)) return;
  if (root.webapis && root.webapis.avplay) return;

  // Tizen resolves this SDK alias inside the signed widget context. Keeping the
  // load parser-blocking ensures AVPlay exists before platform-player.js runs.
  root.document.write('<script src="$WEBAPIS/webapis/webapis.js"><\/script>');
}(window));
