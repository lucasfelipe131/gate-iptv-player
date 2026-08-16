(function () {
  "use strict";

  var ua = navigator.userAgent || "";
  var params;
  try { params = new URLSearchParams(window.location.search || ""); } catch (_error) { params = { get: function () { return ""; } }; }
  var requestedPlatform = String(params.get("platform") || "").toLowerCase();
  var runtimePlatform = String(params.get("runtime") || "").toLowerCase();
  var bridgeToken = String(params.get("bridgeToken") || "");
  var isWebOS = requestedPlatform === "webos" || runtimePlatform === "webos" || /Web0S|WebOS|NetCast/i.test(ua);
  if (!isWebOS) return;

  var androidTvLayout = requestedPlatform === "androidtv" && runtimePlatform === "webos";
  document.body.classList.add("webos-remote");
  if (!androidTvLayout) {
    document.body.classList.add("webos-tv");
    document.documentElement.setAttribute("data-platform", "webos");
  }
  document.documentElement.setAttribute("data-runtime-platform", "webos");

  var lastRemoteFocus = null;
  var lastNavigationAt = 0;
  var focusTimer = 0;
  var lastActivationAt = 0;
  var lastActivationTarget = null;

  function isVisible(element) {
    if (!element || !element.isConnected || element.disabled) return false;
    var style;
    try { style = window.getComputedStyle(element); } catch (_error) { return false; }
    if (!style || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    var rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function activeScope() {
  var ids = ["ad-overlay", "player-modal", "details-modal", "tv-settings-modal", "pairing-modal", "source-modal"];
  for (var index = 0; index < ids.length; index += 1) {
    var node = document.getElementById(ids[index]);
    if (node && !node.classList.contains("hidden")) return node;
  }
  return document;
}

  function focusables(scope) {
    var root = scope || activeScope();
    var nodes = root.querySelectorAll("[data-focusable]");
    var result = [];
    for (var index = 0; index < nodes.length; index += 1) {
      if (isVisible(nodes[index])) result.push(nodes[index]);
    }
    return result;
  }

  function markRemoteFocus(element) {
    if (lastRemoteFocus && lastRemoteFocus !== element) lastRemoteFocus.classList.remove("remote-focused");
    if (element && element.classList) element.classList.add("remote-focused");
    lastRemoteFocus = element || null;
  }

  function scrollNearest(element) {
    if (!element) return;
    try {
      element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    } catch (_error) {
      try { element.scrollIntoView(false); } catch (_ignored) {}
    }
  }

  function focusElement(element) {
    if (!element || !isVisible(element)) return false;
    try { element.focus(); } catch (_error) { return false; }
    markRemoteFocus(element);
    scrollNearest(element);
    return true;
  }

  function preferredFocus() {
    var overlay = document.getElementById("ad-overlay");
    var skip = document.getElementById("skip-ad");
    if (overlay && !overlay.classList.contains("hidden") && skip && !skip.disabled && isVisible(skip)) return skip;

    var source = document.getElementById("source-modal");
    if (source && !source.classList.contains("hidden")) {
      var activeTab = source.querySelector("[data-source-tab].active");
      if (isVisible(activeTab)) return activeTab;
      var sourceItems = focusables(source);
      return sourceItems[0] || null;
    }

    var details = document.getElementById("details-modal");
    if (details && !details.classList.contains("hidden")) {
      var primary = document.getElementById("details-primary");
      if (isVisible(primary)) return primary;
      var detailItems = focusables(details);
      return detailItems[0] || null;
    }

    var player = document.getElementById("player-modal");
    if (player && !player.classList.contains("hidden")) {
      var retry = document.getElementById("retry-stream");
      if (isVisible(retry)) return retry;
      var playerItems = focusables(player);
      return playerItems[0] || null;
    }

    var selectors = [
      ".library-launch",
      ".live-channel-row.active",
      ".live-channel-row",
      ".category-chip.active",
      ".catalog-grid .media-card",
      "[data-action='go-home']",
      ".primary-button",
      ".top-brand",
      "[data-focusable]"
    ];
    for (var index = 0; index < selectors.length; index += 1) {
      var candidate = document.querySelector(selectors[index]);
      if (isVisible(candidate)) return candidate;
    }
    return null;
  }

  function ensureFocus() {
    var list = focusables(activeScope());
    if (!list.length) return;
    var active = document.activeElement;
    if (list.indexOf(active) >= 0 && isVisible(active)) {
      markRemoteFocus(active);
      return;
    }
    focusElement(preferredFocus() || list[0]);
  }

  function scheduleEnsureFocus(delay) {
    window.clearTimeout(focusTimer);
    focusTimer = window.setTimeout(ensureFocus, typeof delay === "number" ? delay : 50);
  }

  function overlapAmount(aStart, aEnd, bStart, bEnd) {
    return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  }

  function moveFocus(direction) {
    var now = Date.now();
    if (now - lastNavigationAt < 55) return;
    lastNavigationAt = now;

    if (window.GateRemoteNavigation && typeof window.GateRemoteNavigation.move === "function") {
      window.GateRemoteNavigation.move(direction);
      return;
    }

    var list = focusables(activeScope());
    if (!list.length) return;
    var active = document.activeElement;
    var currentIndex = list.indexOf(active);
    if (currentIndex < 0 || !isVisible(active)) {
      focusElement(preferredFocus() || list[0]);
      return;
    }

    var current = active.getBoundingClientRect();
    var cx = current.left + current.width / 2;
    var cy = current.top + current.height / 2;
    var horizontal = direction === "left" || direction === "right";
    var best = null;
    var bestScore = Number.POSITIVE_INFINITY;

    for (var index = 0; index < list.length; index += 1) {
      var element = list[index];
      if (element === active) continue;
      var box = element.getBoundingClientRect();
      var x = box.left + box.width / 2;
      var y = box.top + box.height / 2;
      var dx = x - cx;
      var dy = y - cy;
      var valid = direction === "left" ? dx < -4 : direction === "right" ? dx > 4 : direction === "up" ? dy < -4 : dy > 4;
      if (!valid) continue;

      var primary = horizontal ? Math.abs(dx) : Math.abs(dy);
      var secondary = horizontal ? Math.abs(dy) : Math.abs(dx);
      var overlap = horizontal
        ? overlapAmount(current.top, current.bottom, box.top, box.bottom)
        : overlapAmount(current.left, current.right, box.left, box.right);
      var alignedPenalty = overlap > 0 ? 0 : 90000;
      var score = primary * primary + secondary * secondary * (overlap > 0 ? 2.2 : 7) + alignedPenalty;

      if (score < bestScore) {
        bestScore = score;
        best = element;
      }
    }

    if (!best) {
      var step = direction === "left" || direction === "up" ? -1 : 1;
      var fallbackIndex = Math.max(0, Math.min(list.length - 1, currentIndex + step));
      if (fallbackIndex !== currentIndex) best = list[fallbackIndex];
    }

    if (best) focusElement(best);
  }

  function keyDirection(event, code) {
    if (code === 37 || event.key === "ArrowLeft") return "left";
    if (code === 38 || event.key === "ArrowUp") return "up";
    if (code === 39 || event.key === "ArrowRight") return "right";
    if (code === 40 || event.key === "ArrowDown") return "down";
    return "";
  }

  function isEditable(element) {
    if (!element || !element.matches) return false;
    return element.matches("input, textarea, select, [contenteditable='true']");
  }

  function playerIsOpen() {
    var player = document.getElementById("player-modal");
    return Boolean(player && !player.classList.contains("hidden"));
  }

  function handlePlayerRemote(event, code, direction) {
    if (!playerIsOpen()) return false;
    var media = document.getElementById("video-player");
    if (!media) return false;

    if (direction) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (direction === "left" || direction === "right") {
        if (Number.isFinite(media.duration)) media.currentTime = Math.max(0, media.currentTime + (direction === "left" ? -10 : 10));
      } else {
        media.volume = Math.min(1, Math.max(0, media.volume + (direction === "up" ? .1 : -.1)));
      }
      return true;
    }

    if (code === 13 || code === 19 || code === 415 || code === 10252 || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (media.paused) {
        try { Promise.resolve(media.play()).catch(function () {}); } catch (_error) {}
      } else {
        media.pause();
      }
      return true;
    }
    return false;
  }

  function handleKeyDown(event) {
    var code = Number(event.keyCode || event.which || 0);
    var direction = keyDirection(event, code);
    var active = document.activeElement;
    var backPressed = code === 461 || code === 10009 || event.key === "BrowserBack" || event.key === "Escape";

    if (backPressed) {
      event.preventDefault();
      return;
    }

    if (handlePlayerRemote(event, code, direction)) return;

    var immersive = document.querySelector(".live-preview-stage.live-preview-immersive");
    if (immersive) {
      if (direction || code === 13 || event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }

    if (direction) {
      if (isEditable(active) && (direction === "left" || direction === "right")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      moveFocus(direction);
      return;
    }

    if (code === 13 || event.key === "Enter") {
    if (isEditable(active)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;

    var now = Date.now();
    if (active && active === lastActivationTarget && now - lastActivationAt < 700) return;

    if (active && active.matches && active.matches(".live-channel-row.active")) {
      var previewStage = document.querySelector(".live-preview-stage");
      if (previewStage && typeof previewStage.click === "function") {
        lastActivationTarget = active;
        lastActivationAt = now;
        previewStage.click();
        return;
      }
    }

    if (active && active !== document.body && active !== document.documentElement && typeof active.click === "function") {
      lastActivationTarget = active;
      lastActivationAt = now;
      active.click();
      scheduleEnsureFocus(90);
    } else {
      ensureFocus();
    }
  }
  }

  function defineEventValue(event, name, value) {
    try { Object.defineProperty(event, name, { configurable: true, enumerable: true, value: value }); }
    catch (_error) { try { event[name] = value; } catch (_ignored) {} }
  }

  function dispatchBridgedKey(data) {
    var synthetic;
    try {
      synthetic = document.createEvent("Event");
      synthetic.initEvent("keydown", true, true);
    } catch (_error) {
      return;
    }
    var keyCode = Number(data.keyCode || data.which || 0);
    defineEventValue(synthetic, "key", String(data.key || ""));
    defineEventValue(synthetic, "code", String(data.code || ""));
    defineEventValue(synthetic, "keyCode", keyCode);
    defineEventValue(synthetic, "which", keyCode);
    defineEventValue(synthetic, "gateWebOSBridge", true);
    window.dispatchEvent(synthetic);
  }

  window.addEventListener("message", function (event) {
    var data = event.data || {};
    if (event.source !== window.parent || data.type !== "gate-webos-remote") return;
    if (!bridgeToken || data.token !== bridgeToken) return;
    dispatchBridgedKey(data);
  }, false);

  document.addEventListener("click", function (event) {
  if (!event.isTrusted || !lastActivationTarget) return;
  if (Date.now() - lastActivationAt >= 700) return;
  var target = event.target;
  var sameTarget = target === lastActivationTarget
    || (lastActivationTarget.contains && lastActivationTarget.contains(target));
  if (!sameTarget) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

window.addEventListener("keydown", handleKeyDown, true);

  document.addEventListener("focusin", function (event) {
    if (event.target && event.target.matches && event.target.matches("[data-focusable]")) markRemoteFocus(event.target);
  });

  document.addEventListener("pointerdown", function () {
    if (lastRemoteFocus) lastRemoteFocus.classList.remove("remote-focused");
  }, true);

  var observer = new MutationObserver(function () {
    scheduleEnsureFocus(80);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("pageshow", function () { scheduleEnsureFocus(100); });
  window.addEventListener("load", function () { scheduleEnsureFocus(120); });
  scheduleEnsureFocus(120);

  window.GateWebOSRemote = {
    ensureFocus: ensureFocus,
    moveFocus: moveFocus,
    dispatchBridgedKey: dispatchBridgedKey,
    androidTvLayout: androidTvLayout,
    version: "1.2.0"
  };
}());
