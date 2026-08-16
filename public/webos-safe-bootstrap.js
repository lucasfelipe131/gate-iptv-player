(function () {
  "use strict";
  var ua = navigator.userAgent || "";
  var params;
  try { params = new URLSearchParams(window.location.search || ""); }
  catch (_error) { params = { get: function () { return ""; } }; }
  var isWebOS = String(params.get("platform") || "").toLowerCase() === "webos" || /Web0S|WebOS|NetCast/i.test(ua);
  if (!isWebOS) return;

  document.body.classList.add("webos-tv", "webos-safe-mode", "tv-optimized");
  document.body.classList.remove("gate-tv-v2", "gate-browser-polish", "browser-mode");
  document.documentElement.setAttribute("data-platform", "webos");
  document.documentElement.setAttribute("data-tv-platform", "webos");
  try { sessionStorage.setItem("gate.adShown", "true"); } catch (_error) {}

  function diagnostics(kind, message, extra) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/client-diagnostics", true);
      xhr.setRequestHeader("content-type", "application/json");
      xhr.send(JSON.stringify({
        platform: "webos",
        kind: String(kind || "event").slice(0, 40),
        message: String(message || "").slice(0, 500),
        extra: String(extra || "").slice(0, 300),
        userAgent: String(ua).slice(0, 260)
      }));
    } catch (_error) {}
  }

  if (navigator.serviceWorker) {
    try {
      navigator.serviceWorker.getRegistrations().then(function (registrations) {
        registrations.forEach(function (registration) { registration.unregister().catch(function () {}); });
      }).catch(function () {});
    } catch (_error) {}
    try {
      navigator.serviceWorker.register = function () {
        return Promise.reject(new Error("Service Worker disabled on LG webOS safe mode."));
      };
    } catch (_error) {}
  }

  if (window.caches && typeof window.caches.keys === "function") {
    window.caches.keys().then(function (keys) {
      keys.filter(function (key) { return key.indexOf("gate-player-") === 0; })
        .forEach(function (key) { window.caches.delete(key).catch(function () {}); });
    }).catch(function () {});
  }

  window.addEventListener("error", function (event) {
    diagnostics("javascript-error", event.message, (event.filename || "") + ":" + (event.lineno || 0));
  });
  window.addEventListener("unhandledrejection", function (event) {
    diagnostics("promise-rejection", event.reason && (event.reason.message || event.reason), "");
  });

  window.setTimeout(function () {
    var main = document.getElementById("main-content");
    var rendered = Boolean(main && main.children && main.children.length);
    diagnostics(rendered ? "ui-ready" : "ui-empty", rendered ? "Interface renderizada" : "A interface não renderizou em 6 segundos", "safe-1.1.0");
    if (!rendered && main) {
      main.innerHTML = '<section style="padding:70px;text-align:center"><h1 style="font-size:46px">Recuperando o GATE TV</h1><p style="font-size:22px;color:#aebbd0">Pressione Voltar e abra o aplicativo novamente.</p></section>';
    }
  }, 6000);

  window.GateWebOSSafe = { version: "1.1.0", diagnostics: diagnostics };
  diagnostics("bootstrap", "Modo seguro LG iniciado", "safe-1.1.0");
}());
