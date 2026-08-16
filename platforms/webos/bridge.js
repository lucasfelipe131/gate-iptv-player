(function (root) {
  "use strict";

  var PLATFORM = "webos";
  var SHELL_VERSION = "0.6.1";
  var APP_ORIGIN = "https://gate-iptv-player-production.up.railway.app";
  var APP_URL = APP_ORIGIN + "/";
  var WATCHDOG_INTERVAL_MS = 3000;
  var STALL_LIMIT_MS = 15000;
  var MAX_RECOVERIES = 5;
  var state = {
    source: null,
    video: null,
    provider: null,
    watchdog: null,
    recoveryTimer: null,
    recoveryCount: 0,
    lastProgressAt: 0,
    lastTime: -1,
    playing: false
  };

  var remoteKeys = {
    BACK: 461,
    ENTER: 13,
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40,
    PLAY: 415,
    PAUSE: 19,
    STOP: 413,
    REWIND: 412,
    FAST_FORWARD: 417,
    CHANNEL_UP: 33,
    CHANNEL_DOWN: 34
  };

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

  function safeMediaUrl(value) {
    var parsed;
    try { parsed = new URL(String(value || ""), root.location.href); } catch (_error) { return ""; }
    if (["http:", "https:", "blob:"].indexOf(parsed.protocol) === -1) return "";
    return parsed.href;
  }

  function buildLaunchUrl() {
    var target = new URL(APP_URL);
    target.searchParams.set("platform", PLATFORM);
    target.searchParams.set("shellVersion", SHELL_VERSION);
    target.searchParams.set("nativePlayer", "webos-watchdog");
    target.searchParams.set("safe", "1");
    target.searchParams.set("revision", "0.6.1");
    return target.href;
  }

  function getVideo() {
    if (state.video) return state.video;
    var video = document.createElement("video");
    video.id = "gate-native-surface";
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    document.body.appendChild(video);
    video.addEventListener("playing", function () {
      state.playing = true;
      state.lastProgressAt = Date.now();
      state.recoveryCount = 0;
      emit("player-playing", { platform: PLATFORM });
    });
    video.addEventListener("timeupdate", markProgress);
    video.addEventListener("progress", markProgress);
    video.addEventListener("waiting", function () { scheduleRecovery("waiting"); });
    video.addEventListener("stalled", function () { scheduleRecovery("stalled"); });
    video.addEventListener("error", function () { scheduleRecovery("media-error", true); });
    video.addEventListener("ended", function () {
      if (state.source && state.source.live !== false) scheduleRecovery("unexpected-ended", true);
      else emit("player-completed", { platform: PLATFORM });
    });
    state.video = video;
    return video;
  }

  function markProgress() {
    var video = state.video;
    if (!video) return;
    if (video.currentTime !== state.lastTime) {
      state.lastTime = video.currentTime;
      state.lastProgressAt = Date.now();
    }
  }

  function startWatchdog() {
    stopWatchdog();
    state.lastProgressAt = Date.now();
    state.watchdog = root.setInterval(function () {
      if (!state.source || document.hidden) return;
      if (state.provider && typeof state.provider.getProgress === "function") {
        Promise.resolve(state.provider.getProgress()).then(function (progress) {
          if (Number(progress) !== state.lastTime) {
            state.lastTime = Number(progress);
            state.lastProgressAt = Date.now();
          } else if (state.playing && Date.now() - state.lastProgressAt >= STALL_LIMIT_MS) {
            scheduleRecovery("native-watchdog", true);
          }
        }).catch(function () { scheduleRecovery("native-watchdog-error", true); });
        return;
      }
      markProgress();
      if (state.video && !state.video.paused && Date.now() - state.lastProgressAt >= STALL_LIMIT_MS) {
        scheduleRecovery("html5-watchdog", true);
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  function stopWatchdog() {
    if (state.watchdog) root.clearInterval(state.watchdog);
    state.watchdog = null;
  }

  function scheduleRecovery(reason, immediate) {
    if (!state.source || state.recoveryTimer) return;
    if (state.recoveryCount >= MAX_RECOVERIES) {
      stopWatchdog();
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
    if (state.provider && typeof state.provider.recover === "function") {
      return Promise.resolve(state.provider.recover(source)).then(function () { return true; }).catch(function () {
        scheduleRecovery("native-recovery-failed");
        return false;
      });
    }
    return playHtml5(source, true);
  }

  function playHtml5(source, recovering) {
    var video = getVideo();
    var resumeAt = recovering && source.live === false ? Number(video.currentTime || 0) : 0;
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.src = source.src;
      video.load();
      if (resumeAt > 0) {
        video.addEventListener("loadedmetadata", function restorePosition() {
          video.removeEventListener("loadedmetadata", restorePosition);
          try { video.currentTime = resumeAt; } catch (_error) { /* unsupported seek */ }
        });
      }
      var promise = video.play();
      if (promise && typeof promise.then === "function") {
        return promise.then(function () { return true; }).catch(function () {
          scheduleRecovery("play-rejected");
          return false;
        });
      }
      return Promise.resolve(true);
    } catch (_error) {
      scheduleRecovery("html5-exception");
      return Promise.resolve(false);
    }
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
    state.lastTime = -1;
    state.lastProgressAt = Date.now();
    startWatchdog();
    if (state.provider && typeof state.provider.play === "function") {
      return Promise.resolve(state.provider.play(state.source));
    }
    return playHtml5(state.source, false);
  }

  function stop() {
    stopWatchdog();
    if (state.recoveryTimer) root.clearTimeout(state.recoveryTimer);
    state.recoveryTimer = null;
    state.playing = false;
    state.source = null;
    if (state.provider && typeof state.provider.stop === "function") {
      return Promise.resolve(state.provider.stop());
    }
    if (state.video) {
      state.video.pause();
      state.video.removeAttribute("src");
      state.video.load();
    }
    return Promise.resolve();
  }

  function setNativeProvider(provider) {
    if (!provider || typeof provider.play !== "function" || typeof provider.stop !== "function") {
      throw new Error("O provedor nativo deve implementar play() e stop().");
    }
    state.provider = provider;
    emit("native-provider-ready", { platform: PLATFORM });
  }

  function requestExit() {
    try { root.close(); } catch (_error) { /* webOS closes the app at platform level */ }
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

  root.GateWebOSBridge = Object.freeze({
    platform: PLATFORM,
    version: SHELL_VERSION,
    remoteKeys: Object.freeze(remoteKeys),
    play: play,
    stop: stop,
    recover: function () { return recover("manual"); },
    setNativeProvider: setNativeProvider,
    requestExit: requestExit,
    getState: function () {
      return {
        active: Boolean(state.source),
        playing: state.playing,
        recoveryCount: state.recoveryCount,
        nativeProvider: Boolean(state.provider)
      };
    }
  });

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
