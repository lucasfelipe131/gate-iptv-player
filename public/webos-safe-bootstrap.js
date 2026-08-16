(function () {
  "use strict";

  var ua = navigator.userAgent || "";
  var params;
  try { params = new URLSearchParams(window.location.search || ""); }
  catch (_error) { params = { get: function () { return ""; } }; }

  var isWebOS = String(params.get("platform") || "").toLowerCase() === "webos" || /Web0S|WebOS|NetCast/i.test(ua);
  if (!isWebOS) return;

  var BRIDGE_VERSION = "1.2.0";
  var bridgeToken = String(params.get("bridgeToken") || "");
  var readyNotified = false;

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

  function notifyParent(type, message) {
    if (!bridgeToken || window.parent === window) return;
    try {
      window.parent.postMessage({
        type: type,
        token: bridgeToken,
        version: BRIDGE_VERSION,
        message: String(message || "")
      }, "*");
    } catch (_error) {}
  }

  function eventKey(code, fallback) {
    var names = {
      13: "Enter",
      19: "MediaPause",
      27: "Escape",
      37: "ArrowLeft",
      38: "ArrowUp",
      39: "ArrowRight",
      40: "ArrowDown",
      413: "MediaStop",
      415: "MediaPlay",
      417: "MediaFastForward",
      461: "BrowserBack",
      10009: "BrowserBack",
      10252: "MediaPlayPause"
    };
    return names[code] || String(fallback || "");
  }

  function defineEventValue(event, property, value) {
    try {
      Object.defineProperty(event, property, {
        configurable: true,
        enumerable: true,
        get: function () { return value; }
      });
    } catch (_error) {
      try { event[property] = value; } catch (_ignored) {}
    }
  }

  function dispatchRemoteKey(data) {
    var keyCode = Number(data.keyCode || data.which || 0);
    if (!keyCode) return;
    var key = eventKey(keyCode, data.key);
    var target = document.activeElement && document.activeElement !== document.documentElement
      ? document.activeElement
      : document.body;
    var event;

    try {
      event = new KeyboardEvent("keydown", {
        key: key,
        code: String(data.code || key),
        bubbles: true,
        cancelable: true
      });
    } catch (_error) {
      event = document.createEvent("Event");
      event.initEvent("keydown", true, true);
    }

    defineEventValue(event, "key", key);
    defineEventValue(event, "code", String(data.code || key));
    defineEventValue(event, "keyCode", keyCode);
    defineEventValue(event, "which", keyCode);
    target.dispatchEvent(event);
  }

  if (bridgeToken && window.parent !== window) {
    window.addEventListener("message", function (event) {
      var data = event.data || {};
      if (event.source !== window.parent || data.type !== "gate-webos-remote" || data.token !== bridgeToken) return;
      dispatchRemoteKey(data);
    }, false);
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

  function interfaceRendered() {
    var main = document.getElementById("main-content");
    return Boolean(main && main.children && main.children.length);
  }

  function signalReady() {
    if (!interfaceRendered()) return false;
    if (!readyNotified) {
      readyNotified = true;
      diagnostics("ui-ready", "Interface webOS renderizada", "safe-" + BRIDGE_VERSION);
    }
    notifyParent("gate-webos-ready", "Interface pronta");
    return true;
  }

  function waitForInterface(attempt) {
    if (signalReady()) return;
    if (attempt < 48) {
      window.setTimeout(function () { waitForInterface(attempt + 1); }, 250);
      return;
    }

    var main = document.getElementById("main-content");
    diagnostics("ui-empty", "A interface não renderizou em 12 segundos", "safe-" + BRIDGE_VERSION);
    notifyParent("gate-webos-error", "A interface não respondeu. Recarregue o aplicativo.");
    if (main) {
      main.innerHTML = '<section style="padding:70px;text-align:center"><h1 style="font-size:46px">Recuperando o GATE TV</h1><p style="font-size:22px;color:#aebbd0">Feche e abra o aplicativo novamente.</p></section>';
    }
  }

  window.addEventListener("pageshow", function () { window.setTimeout(signalReady, 120); });
  window.addEventListener("load", function () { window.setTimeout(signalReady, 180); });

  window.GateWebOSSafe = {
    version: BRIDGE_VERSION,
    diagnostics: diagnostics,
    signalReady: signalReady
  };

  diagnostics("bootstrap", "Modo seguro LG iniciado", "safe-" + BRIDGE_VERSION);
  notifyParent("gate-webos-booting", "Inicialização webOS em andamento");
  window.setTimeout(function () { waitForInterface(0); }, 100);
}());
