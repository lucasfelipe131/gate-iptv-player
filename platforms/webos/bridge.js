(function (root) {
  "use strict";

  var PLATFORM = "webos";
  var UI_PLATFORM = "androidtv";
  var SHELL_VERSION = "0.7.0";
  var APP_URL = "https://gate-iptv-player-production.up.railway.app/index-webos-android.html";
  var redirected = false;
  var statusNode = null;
  var spinner = null;
  var retryButton = null;

  function buildLaunchUrl(cacheBust) {
    var url = APP_URL + "?platform=" + encodeURIComponent(UI_PLATFORM)
      + "&runtime=" + encodeURIComponent(PLATFORM)
      + "&layout=androidtv"
      + "&nativePlayer=html5"
      + "&shellVersion=" + encodeURIComponent(SHELL_VERSION)
      + "&revision=" + encodeURIComponent(SHELL_VERSION)
      + "&appVersion=" + encodeURIComponent(SHELL_VERSION)
      + "&boot=direct"
      + "&embedded=0";
    if (cacheBust) url += "&reload=" + encodeURIComponent(String(Date.now()));
    return url;
  }

  function setStatus(message) {
    if (statusNode) statusNode.textContent = message;
  }

  function showRetry(message) {
    redirected = false;
    setStatus(message || "Não foi possível abrir o GATE TV. Verifique a internet e tente novamente.");
    if (spinner) spinner.classList.add("hidden");
    if (retryButton) {
      retryButton.classList.remove("hidden");
      try { retryButton.focus(); } catch (_error) {}
    }
  }

  function openApp(cacheBust) {
    if (redirected) return;
    if (root.navigator && root.navigator.onLine === false) {
      showRetry("A TV está sem internet. Reconecte a rede e pressione OK.");
      return;
    }
    redirected = true;
    setStatus("Abrindo o aplicativo diretamente na sua TV LG…");
    try {
      root.location.replace(buildLaunchUrl(Boolean(cacheBust)));
    } catch (_error) {
      redirected = false;
      try {
        root.location.href = buildLaunchUrl(Boolean(cacheBust));
      } catch (_secondError) {
        showRetry();
      }
    }
  }

  function onKeyDown(event) {
    var code = Number(event.keyCode || event.which || 0);
    if ((code === 13 || event.key === "Enter") && retryButton && !retryButton.classList.contains("hidden")) {
      event.preventDefault();
      openApp(true);
      return;
    }
    if (code === 461 || code === 10009 || event.key === "BrowserBack" || event.key === "Escape") {
      event.preventDefault();
      try { root.close(); } catch (_error) {}
    }
  }

  function initialize() {
    statusNode = document.getElementById("status");
    spinner = document.getElementById("spinner");
    retryButton = document.getElementById("retry");

    if (retryButton) retryButton.addEventListener("click", function () { openApp(true); });
    root.addEventListener("keydown", onKeyDown, true);
    root.addEventListener("online", function () { openApp(true); });
    root.addEventListener("offline", function () { showRetry("A TV está sem internet. Reconecte a rede e pressione OK."); });

    root.setTimeout(function () { openApp(false); }, 0);
    root.setTimeout(function () {
      if (!redirected) showRetry();
    }, 8000);
  }

  root.GateWebOSBoot = Object.freeze({
    platform: PLATFORM,
    uiPlatform: UI_PLATFORM,
    version: SHELL_VERSION,
    launchUrl: buildLaunchUrl,
    open: function () { openApp(true); }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
}(window));
