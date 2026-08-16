(function (root) {
  "use strict";

  var PLATFORM = "tizen";
  var SHELL_VERSION = "0.6.2";
  var APP_ORIGIN = "https://gate-iptv-player-production.up.railway.app";
  var APP_URL = APP_ORIGIN + "/";
  var WATCHDOG_INTERVAL_MS = 3000;
  var STALL_LIMIT_MS = 15000;
  var MAX_RECOVERIES = 5;
  var state = {
    source: null,
    watchdog: null,
    recoveryTimer: null,
    recoveryCount: 0,
    lastProgress: -1,
    lastProgressAt: 0,
    playing: false,
    preparing: false
  };

  var remoteKeys = {
    BACK: 10009,
    ENTER: 13,
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40,
    PLAY: 415,
    PLAY_PAUSE: 10252,
    PAUSE: 19,
    STOP: 413,
    REWIND: 412,
    FAST_FORWARD: 417,
    CHANNEL_UP: 427,
    CHANNEL_DOWN: 428,
    RED: 403,
    GREEN: 404,
    YELLOW: 405,
    BLUE: 406
  };

  var tizenKeyNames = [
    "MediaPlay", "MediaPause", "MediaPlayPause", "MediaStop",
    "MediaRewind", "MediaFastForward", "ChannelUp", "ChannelDown",
    "ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue"
  ];

  function emit(name, detail) {
    var event;
    try {
      event = new CustomEvent("gate:" + name, { detail: detail || {} });
    } catch (_error) {
      event = document.createEvent("CustomEvent");
      event.initCustomEvent("gate:" + name, false, false, detail || {});
    }
    root.dispatchEvent(event);
  }

  function avplay() {
    return root.webapis && root.webapis.avplay ? root.webapis.avplay : null;
  }

  function safeMediaUrl(value) {
    var parsed;
    try { parsed = new URL(String(value || ""), root.location.href); } catch (_error) { return ""; }
    if (["http:", "https:"].indexOf(parsed.protocol) === -1) return "";
    return parsed.href;
  }

  function buildLaunchUrl() {
    var target = new URL(APP_URL);
    target.searchParams.set("platform", PLATFORM);
    target.searchParams.set("shellVersion", SHELL_VERSION);
    target.searchParams.set("nativePlayer", "avplay");
    return target.href;
  }

  function registerRemoteKeys() {
    if (!root.tizen || !root.tizen.tvinputdevice) return;
    tizenKeyNames.forEach(function (name) {
      try { root.tizen.tvinputdevice.registerKey(name); } catch (_error) { /* key absent on this model */ }
    });
  }

  function playerListener() {
    return {
      onbufferingstart: function () {
        emit("player-buffering", { platform: PLATFORM, active: true });
      },
      onbufferingprogress: function (percent) {
        emit("player-buffer-progress", { platform: PLATFORM, percent: Number(percent) || 0 });
      },
      onbufferingcomplete: function () {
        state.lastProgressAt = Date.now();
        emit("player-buffering", { platform: PLATFORM, active: false });
      },
      oncurrentplaytime: function (milliseconds) {
        markProgress(Number(milliseconds) || 0);
      },
      onevent: function (eventType) {
        emit("player-event", { platform: PLATFORM, type: String(eventType || "unknown") });
      },
      onstreamcompleted: function () {
        if (state.source && state.source.live !== false) scheduleRecovery("unexpected-completed", true);
        else emit("player-completed", { platform: PLATFORM });
      },
      onerror: function (eventType) {
        emit("player-error", { platform: PLATFORM, type: String(eventType || "unknown") });
        scheduleRecovery("avplay-error", true);
      },
      onsubtitlechange: function () {},
      ondrmevent: function () {}
    };
  }

  function markProgress(milliseconds) {
    if (milliseconds !== state.lastProgress) {
      state.lastProgress = milliseconds;
      state.lastProgressAt = Date.now();
      state.recoveryCount = 0;
    }
  }

  function configureDisplay(player, rect) {
    var value = rect || {};
    var screenWidth = Number(root.innerWidth || 1920);
    var screenHeight = Number(root.innerHeight || 1080);
    var x = Math.max(0, Number(value.x || 0));
    var y = Math.max(0, Number(value.y || 0));
    var width = Math.max(1, Number(value.width || screenWidth));
    var height = Math.max(1, Number(value.height || screenHeight));
    player.setDisplayRect(x, y, width, height);
    try { player.setDisplayMethod("PLAYER_DISPLAY_MODE_FULL_SCREEN"); } catch (_error) { /* older model */ }
  }

  function closePlayer() {
    var player = avplay();
    if (!player) return;
    try {
      var status = player.getState();
      if (status === "PLAYING" || status === "PAUSED" || status === "READY") player.stop();
    } catch (_error) { /* already stopped */ }
    try { player.close(); } catch (_error2) { /* already closed */ }
  }

  function openSource(source, recovering) {
    var player = avplay();
    if (!player) return Promise.reject(new Error("Samsung AVPlay indisponivel."));
    state.preparing = true;
    state.playing = false;
    closePlayer();
    return new Promise(function (resolve, reject) {
      try {
        player.open(source.src);
        player.setListener(playerListener());
        configureDisplay(player, source.rect);
        try { player.setTimeoutForBuffering(10); } catch (_error) { /* optional on older TVs */ }
        player.prepareAsync(function () {
          state.preparing = false;
          try {
            player.play();
            state.playing = true;
            state.lastProgressAt = Date.now();
            emit("player-playing", { platform: PLATFORM, recovered: Boolean(recovering) });
            resolve(true);
          } catch (error) {
            scheduleRecovery("avplay-play-error");
            reject(error);
          }
        }, function (error) {
          state.preparing = false;
          scheduleRecovery("avplay-prepare-error");
          reject(error instanceof Error ? error : new Error("AVPlay nao preparou a fonte."));
        });
      } catch (error) {
        state.preparing = false;
        scheduleRecovery("avplay-open-error");
        reject(error);
      }
    });
  }

  function startWatchdog() {
    stopWatchdog();
    state.lastProgressAt = Date.now();
    state.watchdog = root.setInterval(function () {
      var player = avplay();
      if (!player || !state.source || document.hidden || state.preparing) return;
      try {
        var status = player.getState();
        if (status !== "PLAYING") return;
        markProgress(Number(player.getCurrentTime()) || 0);
        if (Date.now() - state.lastProgressAt >= STALL_LIMIT_MS) {
          scheduleRecovery("avplay-watchdog", true);
        }
      } catch (_error) {
        scheduleRecovery("avplay-state-error", true);
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  function stopWatchdog() {
    if (state.watchdog) root.clearInterval(state.watchdog);
    state.watchdog = null;
  }

  function scheduleRecovery(reason, immediate) {
    if (!state.source || state.recoveryTimer || state.preparing) return;
    if (state.recoveryCount >= MAX_RECOVERIES) {
      stopWatchdog();
      state.playing = false;
      emit("player-fatal", { platform: PLATFORM, reason: "recovery-limit" });
      return;
    }
    var wait = immediate ? 150 : Math.min(1000 * Math.pow(2, state.recoveryCount), 8000);
    state.recoveryTimer = root.setTimeout(function () {
      state.recoveryTimer = null;
      recover(reason);
    }, wait);
  }

  function recover(reason) {
    var source = state.source;
    if (!source) return Promise.resolve(false);
    state.recoveryCount += 1;
    state.lastProgressAt = Date.now();
    emit("player-recovering", {
      platform: PLATFORM,
      reason: reason,
      attempt: state.recoveryCount
    });
    return openSource(source, true).catch(function () {
      scheduleRecovery("avplay-recovery-failed");
      return false;
    });
  }

  function play(payload) {
    var input = payload || {};
    var src = safeMediaUrl(input.src);
    if (!src) return Promise.reject(new Error("Fonte de midia invalida."));
    state.source = {
      src: src,
      live: input.live !== false,
      mimeType: String(input.mimeType || "").slice(0, 100),
      rect: input.rect || null
    };
    state.recoveryCount = 0;
    state.lastProgress = -1;
    state.lastProgressAt = Date.now();
    startWatchdog();
    return openSource(state.source, false);
  }

  function pause() {
    var player = avplay();
    if (!player) return false;
    try { player.pause(); state.playing = false; return true; } catch (_error) { return false; }
  }

  function resume() {
    var player = avplay();
    if (!player) return false;
    try { player.play(); state.playing = true; state.lastProgressAt = Date.now(); return true; }
    catch (_error) { scheduleRecovery("resume-error", true); return false; }
  }

  function stop() {
    stopWatchdog();
    if (state.recoveryTimer) root.clearTimeout(state.recoveryTimer);
    state.recoveryTimer = null;
    state.source = null;
    state.playing = false;
    state.preparing = false;
    closePlayer();
    return Promise.resolve();
  }

  function requestExit() {
    stop();
    try { root.tizen.application.getCurrentApplication().exit(); } catch (_error) { root.close(); }
  }

  function keyName(keyCode) {
    var name;
    for (name in remoteKeys) if (remoteKeys[name] === keyCode) return name;
    return "UNKNOWN";
  }

  function onKeyDown(event) {
    var name = keyName(event.keyCode);
    if (name === "UNKNOWN") return;
    emit("remote-key", { platform: PLATFORM, key: name, keyCode: event.keyCode });
    if (name === "BACK" && state.source) {
      event.preventDefault();
      stop();
    }
  }

  function updateStatus(message) {
    var status = document.getElementById("status");
    if (status) status.textContent = message;
  }

  function launch() {
    if (!navigator.onLine) {
      updateStatus("A TV esta sem internet. Verifique a conexao e tente novamente.");
      return;
    }
    updateStatus("Conectando ao GATE TV…");
    root.setTimeout(function () { root.location.replace(buildLaunchUrl()); }, 180);
  }

  root.GateTizenBridge = Object.freeze({
    platform: PLATFORM,
    version: SHELL_VERSION,
    nativePlayer: "avplay",
    remoteKeys: Object.freeze(remoteKeys),
    registerRemoteKeys: registerRemoteKeys,
    play: play,
    pause: pause,
    resume: resume,
    stop: stop,
    recover: function () { return recover("manual"); },
    requestExit: requestExit,
    getState: function () {
      return {
        active: Boolean(state.source),
        playing: state.playing,
        preparing: state.preparing,
        recoveryCount: state.recoveryCount,
        avplayAvailable: Boolean(avplay())
      };
    }
  });

  registerRemoteKeys();
  root.addEventListener("keydown", onKeyDown, true);
  root.addEventListener("online", launch);
  root.addEventListener("offline", function () { updateStatus("A TV esta sem internet."); });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && state.source) {
      state.lastProgressAt = Date.now();
      startWatchdog();
    }
  });
  document.addEventListener("DOMContentLoaded", function () {
    var retry = document.getElementById("retry");
    if (retry) {
      retry.addEventListener("click", launch);
      retry.focus();
    }
    launch();
  });
}(window));
