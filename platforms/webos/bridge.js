(function (root) {
  "use strict";

  var PLATFORM = "webos";
  var UI_PLATFORM = "androidtv";
  var SHELL_VERSION = "0.6.7";
  var APP_ORIGIN = "https://gate-iptv-player-production.up.railway.app";
  var BRIDGE_TOKEN = "gate-webos-0.6.7";
  var READY_TIMEOUT_MS = 20000;
  var frame = null;
  var bootScreen = null;
  var statusNode = null;
  var spinner = null;
  var retryButton = null;
  var readyTimer = null;
  var ready = false;

  function buildLaunchUrl(cacheBust) {
    var url = APP_ORIGIN + "/?platform=" + encodeURIComponent(UI_PLATFORM)
      + "&runtime=" + encodeURIComponent(PLATFORM)
      + "&layout=androidtv"
      + "&nativePlayer=html5"
      + "&shellVersion=" + encodeURIComponent(SHELL_VERSION)
      + "&revision=" + encodeURIComponent(SHELL_VERSION)
      + "&appVersion=" + encodeURIComponent(SHELL_VERSION)
      + "&boot=iframe"
      + "&embedded=1"
      + "&bridgeToken=" + encodeURIComponent(BRIDGE_TOKEN);
    if (cacheBust) url += "&reload=" + encodeURIComponent(String(Date.now()));
    return url;
  }

  function setStatus(message) {
    if (statusNode) statusNode.textContent = message;
  }

  function focusFrame() {
    if (!frame) return;
    try { frame.focus(); } catch (_error) {}
    try { frame.contentWindow.focus(); } catch (_error) {}
  }

  function clearReadyTimer() {
    if (readyTimer) root.clearTimeout(readyTimer);
    readyTimer = null;
  }

  function hideRetry() {
    if (retryButton) retryButton.classList.add("hidden");
    if (spinner) spinner.classList.remove("hidden");
  }

  function showFailure(message) {
    ready = false;
    clearReadyTimer();
    if (bootScreen) {
      bootScreen.classList.remove("ready");
      bootScreen.classList.add("failed");
    }
    if (spinner) spinner.classList.add("hidden");
    if (retryButton) {
      retryButton.classList.remove("hidden");
      try { retryButton.focus(); } catch (_error) {}
    }
    setStatus(message || "Não foi possível abrir o GATE. Verifique a internet e recarregue.");
  }

  function markReady() {
    if (ready) return;
    ready = true;
    clearReadyTimer();
    if (bootScreen) {
      bootScreen.classList.remove("failed");
      bootScreen.classList.add("ready");
    }
    focusFrame();
    root.setTimeout(focusFrame, 180);
    root.setTimeout(focusFrame, 700);
  }

  function startReadyTimeout() {
    clearReadyTimer();
    readyTimer = root.setTimeout(function () {
      if (!ready) showFailure("A interface demorou para responder. Pressione OK para recarregar.");
    }, READY_TIMEOUT_MS);
  }

  function loadApp(cacheBust) {
    if (!frame) return;
    ready = false;
    if (bootScreen) bootScreen.classList.remove("ready", "failed");
    hideRetry();
    setStatus(navigator.onLine === false
      ? "A TV está sem internet. Reconecte a rede para continuar."
      : "Abrindo a interface otimizada para sua TV LG…");
    frame.src = buildLaunchUrl(Boolean(cacheBust));
    startReadyTimeout();
  }

  function forwardRemoteKey(event) {
    if (!frame || !frame.contentWindow) return false;
    var keyCode = Number(event.keyCode || event.which || 0);
    if ([13, 19, 27, 37, 38, 39, 40, 413, 415, 417, 461, 10009, 10252].indexOf(keyCode) < 0
        && event.key !== "Enter" && event.key !== "BrowserBack" && event.key !== "Escape") return false;
    try {
      frame.contentWindow.postMessage({
        type: "gate-webos-remote",
        token: BRIDGE_TOKEN,
        key: String(event.key || ""),
        code: String(event.code || ""),
        keyCode: keyCode,
        which: keyCode
      }, APP_ORIGIN);
      focusFrame();
      return true;
    } catch (_error) {
      return false;
    }
  }

  function onKeyDown(event) {
    var keyCode = Number(event.keyCode || event.which || 0);
    var retryVisible = retryButton && !retryButton.classList.contains("hidden");
    if (retryVisible && (keyCode === 13 || event.key === "Enter")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      loadApp(true);
      return;
    }
    if (!ready && (keyCode === 461 || keyCode === 10009 || event.key === "BrowserBack" || event.key === "Escape")) {
      event.preventDefault();
      try { root.close(); } catch (_error) {}
      return;
    }
    if (forwardRemoteKey(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function onMessage(event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== APP_ORIGIN) return;
    var data = event.data || {};
    if (data.token !== BRIDGE_TOKEN) return;
    if (data.type === "gate-webos-booting") {
      setStatus("Carregando interface e controle remoto…");
      return;
    }
    if (data.type === "gate-webos-ready") {
      markReady();
      return;
    }
    if (data.type === "gate-webos-error") {
      showFailure(String(data.message || "A interface não respondeu."));
    }
  }

  function initialize() {
    frame = document.getElementById("gate-app");
    bootScreen = document.getElementById("boot-screen");
    statusNode = document.getElementById("status");
    spinner = document.getElementById("spinner");
    retryButton = document.getElementById("retry");

    if (!frame || !bootScreen) return;

    frame.addEventListener("load", function () {
      setStatus("Finalizando a abertura do GATE TV…");
      focusFrame();
      root.setTimeout(markReady, 850);
    });
    frame.addEventListener("error", function () {
      showFailure("Não foi possível carregar o aplicativo. Verifique a internet e tente novamente.");
    });

    if (retryButton) retryButton.addEventListener("click", function () { loadApp(true); });

    root.addEventListener("message", onMessage, false);
    root.addEventListener("keydown", onKeyDown, true);
    root.addEventListener("online", function () { if (!ready) loadApp(true); });
    root.addEventListener("offline", function () {
      showFailure("A TV está sem internet. Reconecte a rede e pressione OK.");
    });
    document.addEventListener("pointerdown", focusFrame, true);

    startReadyTimeout();
    focusFrame();
    root.setTimeout(function () {
      if (!ready && navigator.onLine !== false) markReady();
    }, 3500);
  }

  root.GateWebOSBoot = Object.freeze({
    platform: PLATFORM,
    uiPlatform: UI_PLATFORM,
    version: SHELL_VERSION,
    launchUrl: buildLaunchUrl,
    reload: function () { loadApp(true); },
    focus: focusFrame
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
}(window));
