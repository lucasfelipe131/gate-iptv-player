(function gateWebOSAndroidRuntime(root) {
  "use strict";

  var params;
  try { params = new URLSearchParams(root.location.search || ""); }
  catch (_error) { params = { get: function () { return ""; } }; }

  var runtime = String(params.get("runtime") || "").toLowerCase();
  var requestedPlatform = String(params.get("platform") || "").toLowerCase();
  if (runtime !== "webos" || requestedPlatform !== "androidtv") return;

  var parentOrigin = "https://gate-iptv-player-production.up.railway.app";
  var token = String(params.get("bridgeToken") || "");
  var readySent = false;

  document.documentElement.setAttribute("data-runtime-platform", "webos");
  document.documentElement.setAttribute("data-layout-platform", "androidtv");
  document.body.classList.add("webos-android-runtime", "webos-runtime");
  document.documentElement.setAttribute("data-tv-platform", "webos");

  try { sessionStorage.setItem("gate.adShown", "true"); } catch (_error) {}

  function post(type, extra) {
    if (!token || !root.parent || root.parent === root) return;
    var payload = { type: type, token: token, runtime: "webos", layout: "androidtv" };
    if (extra) {
      for (var key in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, key)) payload[key] = extra[key];
      }
    }
    try { root.parent.postMessage(payload, parentOrigin); } catch (_error) {}
  }

  function disableServiceWorker() {
    if (!navigator.serviceWorker) return;
    try {
      navigator.serviceWorker.getRegistrations().then(function (registrations) {
        for (var index = 0; index < registrations.length; index += 1) {
          try { registrations[index].unregister(); } catch (_error) {}
        }
      }).catch(function () {});
    } catch (_error) {}
    try {
      navigator.serviceWorker.register = function () {
        return Promise.reject(new Error("Service Worker disabled on LG webOS runtime."));
      };
    } catch (_error) {}
  }

  function clearOldCaches() {
    if (!root.caches || typeof root.caches.keys !== "function") return;
    try {
      root.caches.keys().then(function (keys) {
        for (var index = 0; index < keys.length; index += 1) {
          if (String(keys[index]).indexOf("gate-player-") === 0) {
            root.caches.delete(keys[index]).catch(function () {});
          }
        }
      }).catch(function () {});
    } catch (_error) {}
  }

  function patchMpegTs() {
    if (!root.mpegts || root.mpegts.__gateWebOSPatched || typeof root.mpegts.createPlayer !== "function") return;
    var original = root.mpegts.createPlayer;
    root.mpegts.createPlayer = function (mediaDataSource, config) {
      var safeConfig = {};
      var source = config || {};
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) safeConfig[key] = source[key];
      }
      safeConfig.enableWorker = false;
      safeConfig.enableStashBuffer = true;
      safeConfig.lazyLoad = false;
      safeConfig.autoCleanupSourceBuffer = true;
      safeConfig.autoCleanupMaxBackwardDuration = Math.min(24, Number(safeConfig.autoCleanupMaxBackwardDuration) || 24);
      safeConfig.autoCleanupMinBackwardDuration = Math.min(8, Number(safeConfig.autoCleanupMinBackwardDuration) || 8);
      return original.call(root.mpegts, mediaDataSource, safeConfig);
    };
    root.mpegts.__gateWebOSPatched = true;
  }

  function markReady() {
    if (readySent) return;
    var main = document.getElementById("main-content");
    if (!main || !main.children || !main.children.length) return;
    readySent = true;
    post("gate-webos-ready");
    try {
      if (root.GateRemoteNavigation && typeof root.GateRemoteNavigation.ensure === "function") {
        root.GateRemoteNavigation.ensure();
      } else if (root.GateWebOSRemote && typeof root.GateWebOSRemote.ensureFocus === "function") {
        root.GateWebOSRemote.ensureFocus();
      }
    } catch (_error) {}
  }

  disableServiceWorker();
  clearOldCaches();
  patchMpegTs();
  post("gate-webos-booting");

  root.addEventListener("error", function (event) {
    post("gate-webos-error", { message: String(event.message || "Erro ao abrir a interface.").slice(0, 240) });
  });

  var readyChecks = 0;
  var readyTimer = root.setInterval(function () {
    readyChecks += 1;
    patchMpegTs();
    markReady();
    if (readySent || readyChecks >= 20) root.clearInterval(readyTimer);
  }, 300);

  root.addEventListener("load", function () {
    patchMpegTs();
    root.setTimeout(markReady, 60);
    root.setTimeout(markReady, 400);
  });

  root.GateWebOSAndroidRuntime = {
    version: "0.7.1",
    runtime: "webos",
    layout: "androidtv",
    markReady: markReady
  };
}(window));
