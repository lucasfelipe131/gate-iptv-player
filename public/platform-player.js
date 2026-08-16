(function gatePlatformPlayer(global) {
  "use strict";

  if (global.GateNativePlayer) return;

  const query = new URLSearchParams(global.location.search);
  const requestedPlatform = String(query.get("platform") || "").toLowerCase();
  if (requestedPlatform === "webos" && global.parent && global.parent !== global) {
    const send = (action, payload = {}) => {
      global.parent.postMessage({ channel: "gate-native-player", action, ...payload }, "*");
    };
    global.GateNativePlayer = {
      preview(url, fallbackUrl, name, streamType, x, y, width, height) {
        send("preview", { url, fallbackUrl, name, streamType, x, y, width, height });
      },
      playFullscreen(url, fallbackUrl, name, streamType) {
        send("playFullscreen", { url, fallbackUrl, name, streamType });
      },
      fullscreen() { send("fullscreen"); },
      resizePreview(x, y, width, height) { send("resizePreview", { x, y, width, height }); },
      close() { send("close"); }
    };
    global.addEventListener("message", (event) => {
      if (event.source !== global.parent || event.data?.channel !== "gate-native-hooks") return;
      const hook = event.data.event;
      if (hook === "engine") global.GateNativeHooks?.onEngine?.(event.data.value || "LG webOS");
      else if (hook === "error") global.GateNativeHooks?.onError?.(event.data.value || "O canal não respondeu.");
      else if (hook === "closed") global.GateNativeHooks?.onClosed?.();
    });
    send("ready");
    return;
  }

  if (requestedPlatform === "tizen" && !global.document.querySelector("object[type='application/avplayer']")) {
    const avObject = global.document.createElement("object");
    avObject.id = "gate-av-player";
    avObject.type = "application/avplayer";
    avObject.setAttribute("aria-hidden", "true");
    Object.assign(avObject.style, { position: "fixed", inset: "0", width: "100%", height: "100%", zIndex: "0" });
    global.document.body.appendChild(avObject);
  }

  const avplay = global.webapis?.avplay;
  if (!avplay || (requestedPlatform !== "tizen" && !/Tizen/i.test(global.navigator.userAgent || ""))) return;

  const WATCHDOG_INTERVAL_MS = 2_500;
  const START_TIMEOUT_MS = 22_000;
  const STALL_TIMEOUT_MS = 18_000;
  const BUFFER_TIMEOUT_MS = 16_000;
  const RETRY_LIMIT_PER_ROUTE = 2;
  let session = null;
  let watchdog = null;
  let generation = 0;

  function now() { return Date.now(); }

  function freshUrl(value, attempt) {
    try {
      const url = new URL(value, global.location.href);
      if (url.origin === global.location.origin && /^\/api\/stream\//.test(url.pathname)) {
        url.searchParams.set("_gate_refresh", `${now()}-${attempt}`);
      }
      return url.href;
    } catch { return value; }
  }

  function notify(method, value) {
    try { global.GateNativeHooks?.[method]?.(value); } catch {}
  }

  function safeClose() {
    try {
      const state = avplay.getState?.();
      if (state && state !== "NONE" && state !== "IDLE") avplay.stop();
    } catch {}
    try { avplay.close(); } catch {}
  }

  function clearWatchdog() {
    if (watchdog) global.clearInterval(watchdog);
    watchdog = null;
  }

  function isActive(target) {
    return Boolean(target && session === target && target.generation === generation && !target.closed);
  }

  function isCurrentAttempt(target, attempt) {
    return isActive(target) && target.attempt === attempt;
  }

  function clearRetry(target) {
    if (target?.retryTimer) global.clearTimeout(target.retryTimer);
    if (target) target.retryTimer = null;
  }

  function displayRect(bounds) {
    const width = Math.max(1, Math.round(bounds?.width || global.innerWidth || 1920));
    const height = Math.max(1, Math.round(bounds?.height || global.innerHeight || 1080));
    const x = Math.max(0, Math.round(bounds?.x || 0));
    const y = Math.max(0, Math.round(bounds?.y || 0));
    try { avplay.setDisplayRect(x, y, width, height); } catch {}
    try { avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX"); } catch {}
  }

  function retry(message, rotate = false, target = session) {
    if (!isActive(target) || target.switching) return;
    target.switching = true;
    clearRetry(target);
    safeClose();
    if (rotate || target.routeRetries >= RETRY_LIMIT_PER_ROUTE) {
      target.routeIndex = (target.routeIndex + 1) % target.urls.length;
      target.routeRetries = 0;
      if (target.routeIndex === 0) target.round += 1;
    } else {
      target.routeRetries += 1;
    }
    const delay = Math.min(8_000, 600 + target.round * 900);
    notify("onEngine", "Tizen AVPlay · reconectando");
    target.retryTimer = global.setTimeout(() => {
      target.retryTimer = null;
      if (!isActive(target)) return;
      target.switching = false;
      openCurrent(message, target);
    }, delay);
  }

  function openCurrent(reason, target = session) {
    if (!isActive(target)) return;
    const sourceUrl = target.urls[target.routeIndex];
    if (!sourceUrl) return retry("Rota vazia", true, target);
    safeClose();
    target.started = false;
    target.lastProgressAt = now();
    target.bufferingAt = 0;
    target.lastBufferPercent = -1;
    const attempt = ++target.attempt;
    const url = freshUrl(sourceUrl, attempt);
    try {
      avplay.open(url);
      displayRect(target.fullscreen ? null : target.bounds);
      try { avplay.setStreamingProperty("USER_AGENT", "GATE-TV-TIZEN/0.6.4"); } catch {}
      try { avplay.setStreamingProperty("IS_LIVE", target.live ? "true" : "false"); } catch {}
      avplay.setListener({
        onbufferingstart() {
          if (isCurrentAttempt(target, attempt)) target.bufferingAt = now();
        },
        onbufferingprogress(percent) {
          if (!isCurrentAttempt(target, attempt)) return;
          const value = Number(percent);
          if (Number.isFinite(value) && value !== target.lastBufferPercent) {
            target.lastBufferPercent = value;
            target.lastProgressAt = now();
          }
        },
        onbufferingcomplete() {
          if (!isCurrentAttempt(target, attempt)) return;
          target.bufferingAt = 0;
          target.lastProgressAt = now();
        },
        oncurrentplaytime() {
          if (!isCurrentAttempt(target, attempt)) return;
          target.started = true;
          target.lastProgressAt = now();
        },
        onstreamcompleted() {
          if (!isCurrentAttempt(target, attempt)) return;
          if (target.live) retry("O servidor encerrou o sinal", false, target);
        },
        onerror() {
          if (isCurrentAttempt(target, attempt)) retry("Falha no AVPlay", true, target);
        },
        onevent() {},
        ondrmevent() {},
        onsubtitlechange() {}
      });
      avplay.prepareAsync(() => {
        if (!isCurrentAttempt(target, attempt) || target.switching) return;
        try {
          avplay.play();
          target.started = true;
          target.lastProgressAt = now();
          target.routeRetries = 0;
          notify("onEngine", "Tizen AVPlay");
        } catch { retry("Não foi possível iniciar o AVPlay", true, target); }
      }, () => {
        if (isCurrentAttempt(target, attempt)) retry(reason || "O AVPlay não preparou o canal", true, target);
      });
    } catch {
      if (isCurrentAttempt(target, attempt)) retry(reason || "O AVPlay recusou a rota", true, target);
    }
  }

  function start(primaryUrl, fallbackUrl, bounds, fullscreen, live = true) {
    const urls = [primaryUrl, fallbackUrl].map((value) => String(value || "").trim()).filter((value, index, list) => /^https?:\/\//i.test(value) && list.indexOf(value) === index);
    if (!urls.length) return;
    clearWatchdog();
    if (session) {
      session.closed = true;
      clearRetry(session);
    }
    generation += 1;
    safeClose();
    const target = session = {
      generation,
      urls,
      routeIndex: 0,
      routeRetries: 0,
      round: 0,
      bounds,
      fullscreen,
      live,
      started: false,
      switching: false,
      closed: false,
      retryTimer: null,
      attempt: 0,
      bufferingAt: 0,
      lastBufferPercent: -1,
      lastProgressAt: now()
    };
    openCurrent("", target);
    watchdog = global.setInterval(() => {
      if (!isActive(target) || target.switching || global.document.hidden) return;
      const elapsed = now() - target.lastProgressAt;
      if (!target.started && elapsed > START_TIMEOUT_MS) retry("O canal não iniciou", true, target);
      else if (target.bufferingAt && now() - target.bufferingAt > BUFFER_TIMEOUT_MS) retry("O buffer parou", false, target);
      else if (target.started && elapsed > STALL_TIMEOUT_MS) retry("O sinal parou de avançar", false, target);
    }, WATCHDOG_INTERVAL_MS);
  }

  global.GateNativePlayer = {
    preview(url, fallbackUrl, _name, _streamType, x, y, width, height) {
      start(url, fallbackUrl, { x, y, width, height }, false, true);
    },
    playFullscreen(url, fallbackUrl, _name, streamType) {
      start(url, fallbackUrl, null, true, String(streamType || "").toLowerCase() !== "video");
    },
    fullscreen() {
      if (!session) return;
      session.fullscreen = true;
      displayRect(null);
    },
    resizePreview(x, y, width, height) {
      if (!session || session.fullscreen) return;
      session.bounds = { x, y, width, height };
      displayRect(session.bounds);
    },
    close() {
      clearWatchdog();
      if (session) {
        session.closed = true;
        clearRetry(session);
      }
      generation += 1;
      safeClose();
      session = null;
      notify("onClosed", "");
    }
  };

  global.addEventListener("pagehide", () => global.GateNativePlayer?.close?.());
}(window));
