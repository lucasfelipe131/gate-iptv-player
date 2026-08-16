(function (root) {
  "use strict";

  var PLATFORM = "webos";
  var SHELL_VERSION = "0.6.3";
  var APP_ORIGIN = "https://gate-iptv-player-production.up.railway.app";
  var launchTimer = null;
  var launching = false;

  function buildLaunchUrl() {
    return APP_ORIGIN + "/?platform=" + encodeURIComponent(PLATFORM)
      + "&shellVersion=" + encodeURIComponent(SHELL_VERSION)
      + "&safe=1"
      + "&revision=" + encodeURIComponent(SHELL_VERSION)
      + "&appVersion=" + encodeURIComponent(SHELL_VERSION)
      + "&boot=hosted";
  }

  function updateStatus(message) {
    var status = document.getElementById("status");
    if (status) status.textContent = message;
  }

  function setReadyState(ready) {
    var button = document.getElementById("retry");
    if (!button) return;
    button.disabled = !ready;
    button.textContent = ready ? "Abrir novamente" : "Abrindo…";
  }

  function cancelLaunch() {
    if (launchTimer) root.clearTimeout(launchTimer);
    launchTimer = null;
    launching = false;
  }

  function launch() {
    if (launching) return;
    if (navigator.onLine === false) {
      cancelLaunch();
      updateStatus("A TV está sem internet. Conecte-a à rede e tente novamente.");
      setReadyState(true);
      return;
    }

    launching = true;
    updateStatus("Abrindo o GATE TV…");
    setReadyState(false);
    launchTimer = root.setTimeout(function () {
      launchTimer = null;
      root.location.replace(buildLaunchUrl());
    }, 120);
  }

  function retry() {
    cancelLaunch();
    launch();
  }

  root.GateWebOSBoot = Object.freeze({
    platform: PLATFORM,
    version: SHELL_VERSION,
    launchUrl: buildLaunchUrl,
    launch: retry
  });

  root.addEventListener("online", retry);
  root.addEventListener("offline", function () {
    cancelLaunch();
    updateStatus("A TV está sem internet. Conecte-a à rede e tente novamente.");
    setReadyState(true);
  });

  document.addEventListener("DOMContentLoaded", function () {
    var retryButton = document.getElementById("retry");
    if (retryButton) {
      retryButton.addEventListener("click", retry);
      try { retryButton.focus(); } catch (_error) {}
    }
    launch();
  });
}(window));
