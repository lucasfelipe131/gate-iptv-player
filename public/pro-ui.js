(function () {
  "use strict";

  var STYLE_ID = "gate-ui-polish-2";
  var STYLE_URL = "/ui-polish.css?v=0.6.5";

  function ensurePolishStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = STYLE_URL;
    document.head.appendChild(link);
  }

  ensurePolishStyle();

  var ua = navigator.userAgent || "";
  var params;
  try { params = new URLSearchParams(window.location.search || ""); }
  catch (_error) { params = { get: function () { return ""; } }; }

  var requestedPlatform = String(params.get("platform") || "").toLowerCase();
  var tvMode = requestedPlatform === "webos" || requestedPlatform === "androidtv" || requestedPlatform === "tizen" ||
    /Web0S|WebOS|NetCast|Tizen|SMART-TV|SmartTV|Android TV|AFT|BRAVIA|GATE-TV-NATIVE/i.test(ua) ||
    document.body.classList.contains("tv-optimized");

  if (!tvMode) {
    document.body.classList.add("gate-browser-polish");
    window.GateProUI = { version: "2.2.0", tvMode: false };
    return;
  }

  document.body.classList.add("gate-pro-ui", "gate-tv-v2");

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
  var syncTimer = 0;
  var lastView = "";

  function visible(element) {
    if (!element || element.classList.contains("hidden")) return false;
    var style;
    try { style = window.getComputedStyle(element); } catch (_error) { return true; }
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function textOf(selector) {
    var node = document.querySelector(selector);
    return node ? String(node.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function currentView() {
    if (visible(document.getElementById("ad-overlay"))) return "ad";
    if (visible(document.getElementById("player-modal"))) return "player";
    if (document.querySelector(".live-preview-stage.live-preview-immersive")) return "fullscreen";
    if (visible(document.getElementById("details-modal"))) return "details";
    if (visible(document.getElementById("tv-settings-modal"))) return "settings";
    if (visible(document.getElementById("pairing-modal"))) return "pairing";
    if (visible(document.getElementById("source-modal"))) return "source";
    if (window.location.pathname === "/assinar") return "premium";
    if (document.querySelector(".live-layout")) return "live";
    if (document.querySelector(".catalog-layout")) {
      var catalogTitle = textOf(".catalog-titlebar h1").toLowerCase();
      if (catalogTitle.indexOf("filme") >= 0) return "movies";
      if (catalogTitle.indexOf("série") >= 0 || catalogTitle.indexOf("serie") >= 0 || catalogTitle.indexOf("episódio") >= 0) return "series";
      return "catalog";
    }
    if (textOf(".catalog-titlebar h1").toLowerCase().indexOf("favorito") >= 0) return "favorites";
    if (document.querySelector(".library-launchers") || document.querySelector(".web-dashboard")) return "home";
    return "page";
  }

  function contextText(view) {
    if (view === "player") return "OK reproduz ou pausa · Voltar fecha o player";
    if (view === "fullscreen") return "Canal em tela cheia · Voltar retorna à lista";
    if (view === "details") return "Escolha Assistir, Favoritar ou Voltar";
    if (view === "settings") return "OK ativa ou desativa · Voltar fecha as configurações";
    if (view === "pairing") return "Leia o QR pelo celular ou escolha Digitar na TV";
    if (view === "source") return "Preencha os dados e pressione OK para conectar";
    if (view === "live") return "OK abre a prévia · outro OK coloca em tela cheia";
    if (view === "movies") return "Escolha um filme e pressione OK para ver os detalhes";
    if (view === "series") return "Escolha uma série e pressione OK para abrir";
    if (view === "favorites") return "Seus canais, filmes e séries salvos";
    if (view === "premium") return "Plano anual para usar o GATE sem anúncios";
    if (view === "catalog") return "Escolha uma categoria e pressione OK para abrir";
    if (view === "home") return "Escolha TV, Filmes, Séries ou Favoritos";
    return "Use o controle para navegar";
  }

  function viewTitle(view) {
    if (view === "live") return "TV ao vivo";
    if (view === "movies") return "Filmes";
    if (view === "series") return "Séries";
    if (view === "favorites") return "Favoritos";
    if (view === "premium") return "GATE Premium";
    if (view === "pairing") return "Conectar pelo celular";
    if (view === "source") return "Adicionar ou trocar lista";
    if (view === "details") return textOf("#details-title") || "Detalhes";
    if (view === "settings") return "Configurações da TV";
    if (view === "catalog") return textOf(".catalog-titlebar h1") || "Catálogo";
    if (view === "home") return "Sua biblioteca";
    return textOf("h1") || "GATE IPTV PLAYER";
  }

  function activeSelector(view) {
    if (view === "live") return "[data-action='open-live']";
    if (view === "movies") return "[data-action='open-movies']";
    if (view === "series") return "[data-action='open-series']";
    if (view === "favorites") return "[data-action='open-favorites']";
    if (view === "pairing") return "[data-action='open-pairing']";
    if (view === "source") return "[data-action='open-source']";
    if (view === "settings") return "[data-action='open-tv-settings']";
    if (view === "premium") return "[href='/assinar']";
    return "[href='/']";
  }

  function ensureSidebarGuide() {
    var sidebar = document.querySelector(".sidebar");
    if (!sidebar || sidebar.querySelector(".tv-nav-guide")) return;
    var guide = document.createElement("div");
    guide.className = "tv-nav-guide";
    guide.setAttribute("aria-hidden", "true");
    guide.innerHTML =
      "<strong>CONTROLE REMOTO</strong>" +
      "<span><kbd>← ↑ ↓ →</kbd> navegar</span>" +
      "<span><kbd>OK</kbd> selecionar</span>" +
      "<span><kbd>↩</kbd> voltar</span>";
    sidebar.appendChild(guide);
  }

  function syncSidebar(view) {
    var sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;
    var items = sidebar.querySelectorAll(".nav-item");
    var selector = activeSelector(view);
    var active = sidebar.querySelector(selector);
    for (var index = 0; index < items.length; index += 1) {
      var selected = items[index] === active;
      items[index].classList.toggle("active", selected);
      if (selected) items[index].setAttribute("aria-current", "page");
      else items[index].removeAttribute("aria-current");
    }
  }

  function syncTopbar(view) {
    var topbar = document.querySelector(".topbar");
    if (!topbar) return;
    var node = topbar.querySelector(".tv-view-context");
    if (!node) {
      node = document.createElement("div");
      node.className = "tv-view-context";
      node.innerHTML = "<small>GATE IPTV PLAYER</small><strong></strong>";
      topbar.insertBefore(node, topbar.firstChild);
    }
    var strong = node.querySelector("strong");
    if (strong) strong.textContent = viewTitle(view);
  }

  function syncBodyState(view) {
    document.body.classList.toggle("player-open", view === "player");
    document.body.classList.toggle("modal-open", view === "details" || view === "source" || view === "pairing" || view === "settings");
    document.body.classList.toggle("ad-open", view === "ad");
    document.body.classList.toggle("catalog-focus-view", ["live", "movies", "series", "catalog", "favorites"].indexOf(view) >= 0);
    document.body.setAttribute("data-gate-view", view);
  }

  function hideHint() { hint.classList.remove("visible"); }

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
    hideTimer = window.setTimeout(hideHint, typeof duration === "number" ? duration : 4200);
  }

  function syncView(forceHint) {
    var view = currentView();
    syncBodyState(view);
    ensureSidebarGuide();
    syncSidebar(view);
    syncTopbar(view);
    context.textContent = contextText(view);
    if (view !== lastView || forceHint) {
      lastView = view;
      showHint(forceHint ? 5200 : 3600);
    }
  }

  function scheduleSync(delay) {
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(function () { syncView(false); }, typeof delay === "number" ? delay : 70);
  }

  document.addEventListener("keydown", function (event) {
    var code = Number(event.keyCode || event.which || 0);
    if ([13, 461, 10009].indexOf(code) >= 0 ||
        event.key === "Enter" || event.key === "BrowserBack" || event.key === "Escape") {
      showHint(1200);
    }
  }, false);

  document.addEventListener("focusin", function (event) {
    var target = event.target;
    if (!target || !target.matches || !target.matches("[data-focusable]")) return;
    document.body.classList.add("remote-focus-mode");
  }, false);

  document.addEventListener("pointerdown", function () {
    document.body.classList.remove("remote-focus-mode");
    hideHint();
  }, true);

  var observer = new MutationObserver(function () { scheduleSync(75); });
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  var stateObserver = new MutationObserver(function () { scheduleSync(40); });
  ["ad-overlay", "player-modal", "details-modal", "tv-settings-modal", "pairing-modal", "source-modal"].forEach(function (id) {
    var node = document.getElementById(id);
    if (node) stateObserver.observe(node, { attributes: true, attributeFilter: ["class"] });
  });

  window.addEventListener("popstate", function () { scheduleSync(30); });
  window.addEventListener("pageshow", function () { syncView(true); });
  window.addEventListener("load", function () { syncView(true); });

  syncView(true);

  window.GateProUI = {
    version: "2.2.0",
    tvMode: true,
    showHint: showHint,
    syncView: function () { syncView(false); }
  };
}());
