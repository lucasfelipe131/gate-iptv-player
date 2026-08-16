(function () {
  "use strict";
  var ua = navigator.userAgent || "";
  var params;
  try { params = new URLSearchParams(window.location.search || ""); }
  catch (_error) { params = { get: function () { return ""; } }; }
  var isWebOS = String(params.get("platform") || "").toLowerCase() === "webos" || /Web0S|WebOS|NetCast/i.test(ua);
  if (!isWebOS) return;

  document.body.classList.add("webos-tv", "webos-safe-mode", "webos-remote");
  var lastFocused = null;
  var focusTimer = 0;
  var lastMoveAt = 0;

  function visible(element) {
    if (!element || !element.isConnected || element.disabled) return false;
    var style;
    try { style = window.getComputedStyle(element); } catch (_error) { return false; }
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    var rect = element.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }

  function activeScope() {
    var ids = ["ad-overlay", "player-modal", "details-modal", "pairing-modal", "source-modal"];
    for (var index = 0; index < ids.length; index += 1) {
      var node = document.getElementById(ids[index]);
      if (node && !node.classList.contains("hidden")) return node;
    }
    return document;
  }

  function focusableElements() {
    var nodes = activeScope().querySelectorAll("[data-focusable]:not([disabled])");
    var result = [];
    for (var index = 0; index < nodes.length; index += 1) if (visible(nodes[index])) result.push(nodes[index]);
    return result;
  }

  function mark(element) {
    if (lastFocused && lastFocused !== element) lastFocused.classList.remove("remote-focused");
    if (element && element.classList) element.classList.add("remote-focused");
    lastFocused = element || null;
  }

  function focus(element) {
    if (!visible(element)) return false;
    try { element.focus(); } catch (_error) { return false; }
    mark(element);
    try { element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" }); }
    catch (_error) { try { element.scrollIntoView(false); } catch (_ignored) {} }
    return true;
  }

  function preferred() {
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
      var candidate = activeScope().querySelector(selectors[index]);
      if (visible(candidate)) return candidate;
    }
    return null;
  }

  function ensureFocus() {
    var elements = focusableElements();
    if (!elements.length) return;
    var active = document.activeElement;
    if (elements.indexOf(active) >= 0 && visible(active)) return mark(active);
    focus(preferred() || elements[0]);
  }

  function scheduleFocus(delay) {
    window.clearTimeout(focusTimer);
    focusTimer = window.setTimeout(ensureFocus, typeof delay === "number" ? delay : 120);
  }

  function linearMove(active, selector, direction) {
    if (!active || !active.matches || !active.matches(selector)) return false;
    var nodes = active.parentNode ? active.parentNode.querySelectorAll(selector) : [];
    var list = [];
    for (var index = 0; index < nodes.length; index += 1) if (visible(nodes[index])) list.push(nodes[index]);
    var current = list.indexOf(active);
    if (current < 0) return false;
    var target = direction === "up" || direction === "left" ? current - 1 : current + 1;
    if (target < 0 || target >= list.length) return false;
    return focus(list[target]);
  }

  function move(direction) {
    var now = Date.now();
    if (now - lastMoveAt < 70) return;
    lastMoveAt = now;
    var active = document.activeElement;

    if ((direction === "up" || direction === "down") && linearMove(active, ".live-channel-row", direction)) return;
    if ((direction === "up" || direction === "down") && linearMove(active, ".category-chip", direction)) return;

    var elements = focusableElements();
    if (!elements.length) return;
    if (elements.indexOf(active) < 0 || !visible(active)) return focus(preferred() || elements[0]);
    var current = active.getBoundingClientRect();
    var cx = current.left + current.width / 2;
    var cy = current.top + current.height / 2;
    var horizontal = direction === "left" || direction === "right";
    var best = null;
    var bestScore = Number.POSITIVE_INFINITY;

    for (var index = 0; index < elements.length; index += 1) {
      var element = elements[index];
      if (element === active) continue;
      var box = element.getBoundingClientRect();
      var x = box.left + box.width / 2;
      var y = box.top + box.height / 2;
      var dx = x - cx;
      var dy = y - cy;
      var valid = direction === "left" ? dx < -5 : direction === "right" ? dx > 5 : direction === "up" ? dy < -5 : dy > 5;
      if (!valid) continue;
      var primary = horizontal ? Math.abs(dx) : Math.abs(dy);
      var secondary = horizontal ? Math.abs(dy) : Math.abs(dx);
      var score = primary * primary + secondary * secondary * 3.5;
      if (score < bestScore) { bestScore = score; best = element; }
    }
    if (best) focus(best);
  }

  function direction(event, code) {
    if (code === 37 || event.key === "ArrowLeft") return "left";
    if (code === 38 || event.key === "ArrowUp") return "up";
    if (code === 39 || event.key === "ArrowRight") return "right";
    if (code === 40 || event.key === "ArrowDown") return "down";
    return "";
  }

  function editable(element) {
    return Boolean(element && element.matches && element.matches("input, textarea, select, [contenteditable='true']"));
  }

  window.addEventListener("keydown", function (event) {
    var code = Number(event.keyCode || event.which || 0);
    var back = code === 461 || code === 10009 || event.key === "BrowserBack" || event.key === "Escape";
    if (back) { event.preventDefault(); return; }

    var player = document.getElementById("player-modal");
    if (player && !player.classList.contains("hidden")) return;
    if (document.querySelector(".live-preview-stage.live-preview-immersive")) return;

    var way = direction(event, code);
    var active = document.activeElement;
    if (way) {
      if (editable(active) && (way === "left" || way === "right")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      move(way);
      return;
    }

    if (code === 13 || event.key === "Enter") {
      if (editable(active)) return;
      if (active && active !== document.body && typeof active.click === "function") {
        event.preventDefault();
        event.stopImmediatePropagation();
        active.click();
        scheduleFocus(140);
      } else ensureFocus();
    }
  }, true);

  document.addEventListener("focusin", function (event) {
    if (event.target && event.target.matches && event.target.matches("[data-focusable]")) mark(event.target);
  });

  var observer = new MutationObserver(function (records) {
    for (var index = 0; index < records.length; index += 1) {
      if (records[index].addedNodes && records[index].addedNodes.length) return scheduleFocus(160);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("pageshow", function () { scheduleFocus(160); });
  window.addEventListener("load", function () { scheduleFocus(180); });
  scheduleFocus(180);
  window.GateWebOSRemote = { version: "safe-1.1.0", ensureFocus: ensureFocus, moveFocus: move };
}());
