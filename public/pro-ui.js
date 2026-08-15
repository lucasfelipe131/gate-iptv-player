(function () {
  "use strict";

  var ua = navigator.userAgent || "";
  var params;
  try { params = new URLSearchParams(window.location.search || ""); }
  catch (_error) { params = { get: function () { return ""; } }; }

  var requestedPlatform = String(params.get("platform") || "").toLowerCase();
  var tvMode = requestedPlatform === "webos" || requestedPlatform === "androidtv" ||
    /Web0S|WebOS|NetCast|Tizen|SMART-TV|SmartTV|Android TV|AFT|BRAVIA|GATE-TV-NATIVE/i.test(ua) ||
    document.body.classList.contains("tv-optimized");
  if (!tvMode) return;

  document.body.classList.add("gate-pro-ui");

  var hint = document.createElement("div");
  hint.className = "tv-control-hint";
  hint.setAttribute("aria-hidden", "true");
  hint.innerHTML =
    '<span class="hint-context">Use o controle para navegar</span>' +
    '<span><kbd>←↑↓→</kbd>Navegar</span>' +
    '<span><kbd>OK</kbd>Abrir</span>' +
    '<span><kbd>↩</kbd>Voltar</span>';
  document.body.appendChild(hint);

  var context = hint.querySelector(".hint-context");
  var hideTimer = 0;
  var lastView = "";

  function visible(element) {
    return Boolean(element && !element.classList.contains("hidden"));
  }

  function currentView() {
    if (visible(document.getElementById("ad-overlay"))) return "ad";
    if (visible(document.getElementById("player-modal"))) return "player";
    if (document.querySelector(".live-preview-stage.live-preview-immersive")) return "fullscreen";
    if (visible(document.getElementById("details-modal"))) return "details";
    if (visible(document.getElementById("source-modal"))) return "source";
    if (document.querySelector(".live-layout")) return "live";
    if (document.querySelector(".catalog-layout")) return "catalog";
    if (document.querySelector(".library-launchers")) return "home";
    return "page";
  }

  function contextText(view) {
    if (view === "player") return "OK reproduz ou pausa · Voltar fecha o player";
    if (view === "fullscreen") return "Canal em tela cheia · Voltar retorna à lista";
    if (view === "details") return "Escolha Assistir, Favoritar ou Voltar";
    if (view === "source") return "Preencha os dados e pressione OK para conectar";
    if (view === "live") return "OK abre a prévia · pressione OK novamente para tela cheia";
    if (view === "catalog") return "Escolha uma categoria e pressione OK para abrir";
    if (view === "home") return "Escolha TV, Filmes, Séries ou Favoritos";
    return "Use o controle para navegar";
  }

  function syncBodyState(view) {
    document.body.classList.toggle("player-open", view === "player");
    document.body.classList.toggle("modal-open", view === "details" || view === "source");
    document.body.classList.toggle("ad-open", view === "ad");
    document.body.setAttribute("data-gate-view", view);
  }

  function hideHint() {
    hint.classList.remove("visible");
  }

  function showHint(duration) {
    var view = currentView();
    syncBodyState(view);
    context.textContent = contextText(view);
    if (view === "ad" || view === "player" || view === "fullscreen") {
      hideHint();
      return;
    }
    hint.classList.add("visible");
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideHint, typeof duration === "number" ? duration : 5200);
  }

  function syncView() {
    var view = currentView();
    syncBodyState(view);
    context.textContent = contextText(view);
    if (view !== lastView) {
      lastView = view;
      showHint(5400);
    }
  }

  document.addEventListener("keydown", function (event) {
    var code = Number(event.keyCode || event.which || 0);
    if ([13, 37, 38, 39, 40, 461, 10009].indexOf(code) >= 0 ||
        event.key === "Enter" || event.key === "BrowserBack" || event.key === "Escape") {
      showHint(2200);
    }
  }, false);

  document.addEventListener("focusin", function (event) {
    var target = event.target;
    if (!target || !target.matches || !target.matches("[data-focusable]")) return;
    document.body.classList.add("remote-focus-mode");
    showHint(1700);
  }, false);

  document.addEventListener("pointerdown", function () {
    document.body.classList.remove("remote-focus-mode");
    hideHint();
  }, true);

  var main = document.getElementById("main-content");
  var observer = new MutationObserver(function () {
    window.clearTimeout(observer.timer);
    observer.timer = window.setTimeout(syncView, 70);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "disabled"]
  });

  window.addEventListener("load", function () {
    syncView();
    showHint(6500);
  });

  if (main) main.addEventListener("scroll", hideHint, { passive: true });
  syncView();

  window.GateProUI = {
    version: "1.0.0",
    showHint: showHint,
    syncView: syncView
  };
}());
