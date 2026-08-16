(function (root) {
  "use strict";

  var PLATFORM = "webos";
  var SHELL_VERSION = "0.6.2";
  var APP_ORIGIN = "https://gate-iptv-player-production.up.railway.app";
  var APP_URL = APP_ORIGIN + "/";
  var START_TIMEOUT_MS = 30000;
  var STALL_TIMEOUT_MS = 18000;
  var FRAME_TIMEOUT_MS = 20000;
  var WATCHDOG_INTERVAL_MS = 2000;
  var session = null;
  var watchdog = null;
  var generation = 0;
  var refreshSerial = 0;
  var appFrame = null;

  function now() { return Date.now(); }

  function buildLaunchUrl() {
    var target = new URL(APP_URL);
    target.searchParams.set("platform", PLATFORM);
    target.searchParams.set("shellVersion", SHELL_VERSION);
    target.searchParams.set("nativePlayer", "parent-webos");
    target.searchParams.set("safe", "1");
    target.searchParams.set("revision", SHELL_VERSION);
    target.searchParams.set("appVersion", SHELL_VERSION);
    return target.href;
  }

  function postHook(eventName, value) {
    if (!appFrame || !appFrame.contentWindow) return;
    try {
      appFrame.contentWindow.postMessage({ channel: "gate-native-hooks", event: eventName, value: value || "" }, APP_ORIGIN);
    } catch (_error) { /* iframe not ready yet */ }
  }

  function validUrl(value) {
    try {
      var url = new URL(String(value || ""), APP_URL);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch (_error) { return ""; }
  }

  function freshUrl(value, attempt) {
    try {
      var url = new URL(value, APP_URL);
      if (url.origin === APP_ORIGIN && /^\/api\/stream\//.test(url.pathname)) {
        url.searchParams.set("direct", "1");
        url.searchParams.set("_gate_refresh", String(++refreshSerial) + "-" + String(attempt));
      }
      return url.href;
    } catch (_error) { return value; }
  }

  function isActive(target, attempt) {
    return Boolean(target && session === target && target.generation === generation && !target.closed
      && (attempt == null || target.attempt === attempt));
  }

  function clearRetry(target) {
    if (target && target.retryTimer) root.clearTimeout(target.retryTimer);
    if (target) target.retryTimer = null;
  }

  function removeSurface() {
    var surface = document.getElementById("gate-native-surface");
    if (!surface) return;
    if (session && session.surface === surface) session.surface = null;
    try { surface.pause(); } catch (_error) {}
    surface.removeAttribute("src");
    try { surface.load(); } catch (_error2) {}
    if (surface.parentNode) surface.parentNode.removeChild(surface);
  }

  function applyBounds(target, surface) {
    var bounds = target.fullscreen ? null : target.bounds;
    surface.style.left = bounds ? Math.max(0, Number(bounds.x) || 0) + "px" : "0";
    surface.style.top = bounds ? Math.max(0, Number(bounds.y) || 0) + "px" : "0";
    surface.style.width = bounds ? Math.max(1, Number(bounds.width) || 1) + "px" : "100%";
    surface.style.height = bounds ? Math.max(1, Number(bounds.height) || 1) + "px" : "100%";
  }

  function sampleFrames(target, surface) {
    var frames = NaN;
    try {
      var quality = surface.getVideoPlaybackQuality && surface.getVideoPlaybackQuality();
      if (quality) frames = Number(quality.totalVideoFrames);
    } catch (_error) {}
    if (!isFinite(frames)) frames = Number(surface.webkitDecodedFrameCount);
    if (!isFinite(frames) || frames < 0) return;
    target.frameMonitoring = true;
    if (frames > target.lastFrameCount) {
      target.lastFrameCount = frames;
      target.framesSeen = frames > 0;
      target.lastFrameAt = now();
    }
  }

  function monitorFrames(target, surface, attempt) {
    if (typeof surface.requestVideoFrameCallback !== "function") return;
    var callback = function (_timestamp, metadata) {
      if (!isActive(target, attempt) || target.surface !== surface) return;
      var frames = Number(metadata && metadata.presentedFrames);
      target.frameMonitoring = true;
      if (!isFinite(frames) || frames > target.lastFrameCount) {
        if (isFinite(frames)) target.lastFrameCount = frames;
        target.framesSeen = true;
        target.lastFrameAt = now();
      }
      target.frameCallbackId = surface.requestVideoFrameCallback(callback);
    };
    target.frameCallbackId = surface.requestVideoFrameCallback(callback);
  }

  function markClock(target, surface) {
    var value = Number(surface.currentTime);
    if (isFinite(value) && value !== target.lastTime) {
      target.lastTime = value;
      target.lastProgressAt = now();
    }
  }

  function openCurrent(target, reason) {
    if (!isActive(target)) return;
    clearRetry(target);
    removeSurface();
    var route = target.urls[target.routeIndex];
    if (!route) return retry(target, reason || "Rota vazia", true);
    var attempt = ++target.attempt;
    var source = freshUrl(route, attempt);
    var surface = document.createElement("video");
    surface.id = "gate-native-surface";
    surface.autoplay = true;
    surface.playsInline = true;
    surface.setAttribute("playsinline", "");
    surface.setAttribute("webkit-playsinline", "");
    target.surface = surface;
    target.started = false;
    target.startedAt = 0;
    target.lastTime = -1;
    target.lastProgressAt = now();
    target.lastFrameAt = 0;
    target.lastFrameCount = -1;
    target.framesSeen = false;
    target.frameMonitoring = false;
    target.bufferingAt = 0;
    applyBounds(target, surface);
    document.body.appendChild(surface);

    surface.addEventListener("playing", function () {
      if (!isActive(target, attempt)) return;
      target.started = true;
      target.startedAt = target.startedAt || now();
      target.bufferingAt = 0;
      target.lastProgressAt = now();
      target.routeRetries = 0;
      target.round = 0;
      postHook("engine", "LG webOS · vídeo nativo");
    });
    surface.addEventListener("timeupdate", function () { if (isActive(target, attempt)) markClock(target, surface); });
    surface.addEventListener("waiting", function () { if (isActive(target, attempt) && !target.bufferingAt) target.bufferingAt = now(); });
    surface.addEventListener("canplay", function () { if (isActive(target, attempt)) target.bufferingAt = 0; });
    surface.addEventListener("stalled", function () { if (isActive(target, attempt) && !target.bufferingAt) target.bufferingAt = now(); });
    surface.addEventListener("error", function () { if (isActive(target, attempt)) retry(target, "A TV perdeu o sinal", true); });
    surface.addEventListener("ended", function () {
      if (!isActive(target, attempt)) return;
      if (target.live) retry(target, "A transmissão encerrou", false);
      else closePlayer();
    });
    monitorFrames(target, surface, attempt);
    surface.src = source;
    try { surface.load(); } catch (_error) {}
    try {
      var promise = surface.play();
      if (promise && typeof promise.catch === "function") promise.catch(function () { if (isActive(target, attempt)) retry(target, "A reprodução não iniciou", false); });
    } catch (_error2) { retry(target, "A TV recusou o vídeo", true); }
  }

  function retry(target, message, rotate) {
    if (!isActive(target) || target.switching) return;
    target.switching = true;
    clearRetry(target);
    removeSurface();
    if (rotate || target.routeRetries >= 1) {
      target.routeIndex = (target.routeIndex + 1) % target.urls.length;
      target.routeRetries = 0;
      if (target.routeIndex === 0) target.round += 1;
    } else {
      target.routeRetries += 1;
    }
    postHook("engine", "LG webOS · reconectando");
    var delay = Math.min(12000, 700 + target.round * 1200);
    target.retryTimer = root.setTimeout(function () {
      target.retryTimer = null;
      if (!isActive(target)) return;
      target.switching = false;
      openCurrent(target, message);
    }, delay);
  }

  function startWatchdog(target) {
    if (watchdog) root.clearInterval(watchdog);
    watchdog = root.setInterval(function () {
      if (!isActive(target) || target.switching || document.hidden || !target.surface) return;
      var current = now();
      var surface = target.surface;
      markClock(target, surface);
      sampleFrames(target, surface);
      var videoExpected = Number(surface.videoWidth) > 0 || Number(surface.videoHeight) > 0;
      if (!target.started && current - target.lastProgressAt > START_TIMEOUT_MS) retry(target, "O canal demorou para iniciar", true);
      else if (target.bufferingAt && current - target.bufferingAt > STALL_TIMEOUT_MS) retry(target, "O buffer ficou parado", false);
      else if (target.started && videoExpected && target.frameMonitoring && !target.framesSeen && current - target.startedAt > FRAME_TIMEOUT_MS) retry(target, "O áudio iniciou sem imagem", false);
      else if (target.framesSeen && current - target.lastFrameAt > FRAME_TIMEOUT_MS) retry(target, "A imagem parou", false);
      else if (target.started && current - target.lastProgressAt > STALL_TIMEOUT_MS) retry(target, "O sinal parou de avançar", false);
      else if (target.started && surface.paused) { try { surface.play(); } catch (_error) {} }
    }, WATCHDOG_INTERVAL_MS);
  }

  function startPlayer(payload, fullscreen) {
    var urls = [validUrl(payload.url), validUrl(payload.fallbackUrl)].filter(function (value, index, list) { return value && list.indexOf(value) === index; });
    if (!urls.length) return;
    var bounds = fullscreen ? null : { x: payload.x, y: payload.y, width: payload.width, height: payload.height };
    if (session && !session.closed && session.urls[0] === urls[0]) {
      session.fullscreen = fullscreen;
      session.bounds = bounds || session.bounds;
      session.live = String(payload.streamType || "").toLowerCase() !== "video";
      if (session.surface) applyBounds(session, session.surface);
      return;
    }
    closePlayer(false);
    generation += 1;
    var target = session = {
      generation: generation, urls: urls, routeIndex: 0, routeRetries: 0, round: 0, attempt: 0,
      retryTimer: null, switching: false, closed: false, fullscreen: fullscreen, bounds: bounds,
      live: String(payload.streamType || "").toLowerCase() !== "video", surface: null,
      started: false, lastProgressAt: now()
    };
    openCurrent(target, "");
    startWatchdog(target);
  }

  function closePlayer(notify) {
    if (notify == null) notify = true;
    if (watchdog) root.clearInterval(watchdog);
    watchdog = null;
    if (session) { session.closed = true; clearRetry(session); }
    generation += 1;
    removeSurface();
    session = null;
    if (notify) postHook("closed", "");
  }

  function handleMessage(event) {
    if (event.origin !== APP_ORIGIN || !appFrame || event.source !== appFrame.contentWindow) return;
    var data = event.data || {};
    if (data.channel !== "gate-native-player") return;
    if (data.action === "preview") startPlayer(data, false);
    else if (data.action === "playFullscreen") startPlayer(data, true);
    else if (data.action === "fullscreen" && session) { session.fullscreen = true; if (session.surface) applyBounds(session, session.surface); }
    else if (data.action === "resizePreview" && session && !session.fullscreen) {
      session.bounds = { x: data.x, y: data.y, width: data.width, height: data.height };
      if (session.surface) applyBounds(session, session.surface);
    } else if (data.action === "close") closePlayer();
  }

  function updateStatus(message) { var status = document.getElementById("status"); if (status) status.textContent = message; }

  function launch() {
    var overlay = document.getElementById("connection-state");
    if (!navigator.onLine) {
      if (overlay) overlay.className = "connection-state";
      updateStatus("A TV está sem internet. Verifique a conexão e tente novamente.");
      return;
    }
    updateStatus("Conectando ao GATE TV…");
    appFrame = document.getElementById("gate-app-frame");
    appFrame.onload = function () { if (overlay) overlay.className = "connection-state hidden"; try { appFrame.focus(); } catch (_error) {} };
    appFrame.src = buildLaunchUrl();
  }

  root.GateWebOSBridge = Object.freeze({
    platform: PLATFORM,
    version: SHELL_VERSION,
    recover: function () { if (session) retry(session, "Recuperação manual", false); },
    stop: closePlayer,
    getState: function () { return { active: Boolean(session), generation: generation }; }
  });

  root.addEventListener("message", handleMessage, false);
  root.addEventListener("online", launch);
  root.addEventListener("offline", function () { document.getElementById("connection-state").className = "connection-state"; updateStatus("A TV está sem internet."); });
  document.addEventListener("DOMContentLoaded", function () { document.getElementById("retry").addEventListener("click", launch); launch(); });
}(window));
