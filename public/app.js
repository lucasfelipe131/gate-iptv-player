const state = {
  config: { annualPrice: 30, adDurationSeconds: 10, paymentAvailable: false },
  source: null,
  account: null,
  sessionId: null,
  counts: {},
  channels: [],
  movies: [],
  series: [],
  episodes: [],
  loadedCatalogs: new Set(),
  catalogPromises: new Map(),
  catalogErrors: new Map(),
  epg: new Map(),
  epgPending: new Set(),
  view: "home",
  filter: { query: "", group: "Todos" },
  visibleCount: 36,
  pageSize: 36,
  hls: null,
  currentItem: null,
  lastFocused: null,
  adFree: localStorage.getItem("gate.adFree") === "true"
};

const main = document.querySelector("#main-content");
const sourceModal = document.querySelector("#source-modal");
const playerModal = document.querySelector("#player-modal");
const sourceStatus = document.querySelector("#source-status");
const video = document.querySelector("#video-player");
const playerStatus = document.querySelector("#player-status");
const playerStatusText = document.querySelector("#player-status-text");
const retryButton = document.querySelector("#retry-stream");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

function showToast(message, duration = 3800) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), duration);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir.");
  return payload;
}

function topbar() {
  const connected = state.source ? '<span class="pill connected-pill">● Lista conectada</span>' : '<span class="pill">Nenhuma lista conectada</span>';
  const expiry = state.source ? `<span class="pill expiry-pill">Validade: ${escapeHtml(formatExpiryDate(state.account?.expiresAt))}</span>` : "";
  return `<header class="topbar"><strong class="topbar-title">GATE IPTV PLAYER</strong><div class="top-actions">${connected}${expiry}</div></header>`;
}

function formatExpiryDate(value) {
  if (!value) return "data não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "data não informada";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function renderHome() {
  state.view = "home";
  document.title = "GATE IPTV PLAYER";
  if (state.source) {
    main.innerHTML = `${topbar()}
      <section class="tv-home-head"><div><p class="eyebrow">CONTEÚDO DA SUA LISTA</p><h1>Escolha e assista.</h1><p>TV ao vivo, filmes e séries organizados em cards.</p></div></section>
      ${renderConnectedSummary()}
      ${renderHomePreviews()}`;
    bindDynamicActions();
    refreshFocusable();
    queueEpgForCards();
    return;
  }
  main.innerHTML = `${topbar()}
    <section class="hero">
      <div class="hero-content">
        <p class="eyebrow">SIMPLES. RÁPIDO. NA SUA TV.</p>
        <h1>Todo o seu conteúdo<br>em uma única tela.</h1>
        <p>Conecte uma fonte autorizada por Xtream Codes, M3U/M3U8, arquivo local ou link direto e navegue pelo controle remoto.</p>
        <div class="button-row">
          <button class="primary-button focusable" data-action="open-source" data-focusable>＋ ${state.source ? "Trocar lista" : "Adicionar lista"}</button>
          <a class="secondary-button focusable" href="/renovar" data-link data-focusable>Remover anúncios · R$ 30/ano</a>
        </div>
      </div>
    </section>
    ${renderConnectOptions()}`;
  bindDynamicActions();
  refreshFocusable();
}

function renderConnectOptions() {
  return `<div class="section-head"><h2>Formas de conectar</h2><span>Use apenas conteúdo autorizado</span></div>
    <section class="format-grid">
      <button class="format-card focusable" data-action="open-source" data-tab="xtream" data-focusable><span class="format-icon">◈</span><strong>Xtream Codes</strong><small>Servidor, usuário e senha</small></button>
      <button class="format-card focusable" data-action="open-source" data-tab="m3u" data-focusable><span class="format-icon">≡</span><strong>M3U / M3U8</strong><small>Link remoto ou arquivo local</small></button>
      <button class="format-card focusable" data-action="open-source" data-tab="portal" data-focusable><span class="format-icon">⌁</span><strong>Portal / MAC</strong><small>Validação para portais compatíveis</small></button>
      <button class="format-card focusable" data-action="open-source" data-tab="direct" data-focusable><span class="format-icon">▶</span><strong>HLS e link direto</strong><small>M3U8, MP4 e MPEG-TS</small></button>
    </section>
    <div class="section-head"><h2>Pronto para começar</h2></div><div class="empty-state">Nenhuma fonte conectada. Seus dados de acesso não são salvos permanentemente no servidor.</div>`;
}

function renderConnectedSummary() {
  const live = Number(state.counts.live ?? state.channels.length);
  const rawStatus = String(state.account?.status || "Ativa").toLowerCase();
  const status = rawStatus === "active" ? "Ativa" : rawStatus === "expired" ? "Expirada" : state.account?.status || "Ativa";
  const expires = formatExpiryDate(state.account?.expiresAt);
  const catalogLabel = (kind, singular) => {
    if (state.catalogErrors.has(kind)) return "Não foi possível carregar · pressione OK";
    if (!state.loadedCatalogs.has(kind) && state.sessionId) return `Carregando ${singular.toLowerCase()}…`;
    const total = Number(state.counts[kind] ?? state[kind].length);
    return `${total.toLocaleString("pt-BR")} ${singular.toLowerCase()}${total === 1 ? "" : "s"}`;
  };
  return `<section class="account-strip">
      <span class="account-dot" aria-hidden="true"></span>
      <span><small>STATUS DA LISTA</small><strong>${escapeHtml(status)}</strong></span>
      <span class="account-expiry"><small>DATA DE EXPIRAÇÃO</small><strong>${escapeHtml(expires)}</strong></span>
    </section>
    <section class="library-launchers simple-launchers">
      <button class="library-launch focusable live-launch" data-action="open-live" data-focusable><span class="launcher-icon live">●</span><span><strong>TV ao vivo</strong><small>${live.toLocaleString("pt-BR")} canais</small></span><b>›</b></button>
      <button class="library-launch focusable movies-launch" data-action="open-movies" data-focusable><span class="launcher-icon">▶</span><span><strong>Filmes</strong><small>${escapeHtml(catalogLabel("movies", "filme"))}</small></span><b>›</b></button>
      <button class="library-launch focusable series-launch" data-action="open-series" data-focusable><span class="launcher-icon">▣</span><span><strong>Séries</strong><small>${escapeHtml(catalogLabel("series", "série"))}</small></span><b>›</b></button>
    </section>`;
}

function renderHomePreviews() {
  const sections = [
    { kind: "live", title: "TV ao vivo", action: "open-live", empty: "Nenhum canal foi carregado." },
    { kind: "movies", title: "Filmes", action: "open-movies", empty: "Nenhum filme foi carregado." },
    { kind: "series", title: "Séries", action: "open-series", empty: "Nenhuma série foi carregada." }
  ];

  return `<div class="home-shelves">${sections.map((section) => {
    const items = currentItems(section.kind).slice(0, 8);
    const loading = section.kind !== "live" && Boolean(state.sessionId) && !state.loadedCatalogs.has(section.kind) && !state.catalogErrors.has(section.kind);
    const error = state.catalogErrors.get(section.kind);
    const body = loading
      ? renderPreviewSkeletons(section.kind)
      : items.length
        ? `<div class="media-row home-preview-row ${section.kind}">${items.map((item) => mediaCard(item, section.kind)).join("")}</div>`
        : `<div class="empty-state compact-empty">${escapeHtml(error || section.empty)}</div>`;
    return `<section class="home-shelf ${section.kind}">
      <div class="home-shelf-head"><h2>${section.title}</h2><button class="shelf-more focusable" data-action="${section.action}" data-focusable>Ver todos <span>›</span></button></div>
      ${body}
    </section>`;
  }).join("")}</div>`;
}

function renderPreviewSkeletons(kind) {
  return `<div class="media-row home-preview-row ${kind}" aria-label="Carregando cards">${Array.from({ length: 6 }, () => '<span class="media-card card-skeleton" aria-hidden="true"><i></i><b></b></span>').join("")}</div>`;
}

function mediaRow(items, kind) {
  if (!items.length) return `<div class="empty-state">Nenhum item de ${escapeHtml(kind)} foi carregado.</div>`;
  return `<div class="media-row">${items.map((item) => mediaCard(item, kind)).join("")}</div>`;
}

function mediaCard(item, kind) {
  const style = item.logo ? ` style="background-image:linear-gradient(transparent,rgba(4,8,15,.9)),url('${escapeHtml(item.logo)}')"` : "";
  const playable = Boolean(item.playUrl);
  const seriesData = item.seriesId ? ` data-series-id="${escapeHtml(item.seriesId)}" data-session-id="${escapeHtml(item.sessionId || state.sessionId || "")}"` : "";
  const description = item.description || "";
  const detailsData = ` data-item-id="${escapeHtml(item.id || "")}" data-description="${escapeHtml(description)}"`;
  const liveData = kind === "live" && item.id ? ` data-live-id="${escapeHtml(item.id)}"` : "";
  const metadata = [item.group || kind, item.year, item.rating ? `★ ${item.rating}` : ""].filter(Boolean).join(" · ");
  const epg = kind === "live" && item.id ? state.epg.get(String(item.id)) : null;
  const current = epg?.current?.title ? `Agora · ${epg.current.title}` : item.id ? "Agora · Carregando guia…" : "Guia não informado pela lista";
  const next = epg?.next?.title ? `Depois · ${epg.next.title}` : "";
  const extra = kind === "live"
    ? `<span class="card-epg card-now">${escapeHtml(current)}</span><span class="card-epg card-next">${escapeHtml(next)}</span>`
    : `<p class="card-synopsis">${escapeHtml(description || "Sinopse não informada pela lista.")}</p>`;
  return `<button class="media-card focusable kind-${escapeHtml(kind)} ${item.logo ? "has-image" : ""}" data-focusable${playable ? ` data-play-url="${escapeHtml(item.playUrl)}" data-stream-type="${escapeHtml(item.streamType || "auto")}"` : ""}${seriesData}${detailsData}${liveData} data-play-name="${escapeHtml(item.name)}"${style}>
    <span class="play-dot">${item.seriesId ? "＋" : "▶"}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(metadata)}</small>${extra}</button>`;
}

function formatProgramTime(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function updateEpgCards() {
  main.querySelectorAll("[data-live-id]").forEach((card) => {
    const entry = state.epg.get(String(card.dataset.liveId));
    if (!entry) return;
    const currentTime = formatProgramTime(entry.current?.start);
    const nextTime = formatProgramTime(entry.next?.start);
    const now = card.querySelector(".card-now");
    const next = card.querySelector(".card-next");
    if (now) now.textContent = entry.current?.title ? `Agora${currentTime ? ` ${currentTime}` : ""} · ${entry.current.title}` : "Programação não informada";
    if (next) next.textContent = entry.next?.title ? `Depois${nextTime ? ` ${nextTime}` : ""} · ${entry.next.title}` : "";
  });
}

async function queueEpgForCards(cards = [...main.querySelectorAll("[data-live-id]")]) {
  if (!state.sessionId) return;
  const streamIds = [...new Set(cards.map((card) => String(card.dataset.liveId || "")))]
    .filter((id) => id && !state.epg.has(id) && !state.epgPending.has(id))
    .slice(0, 10);
  if (!streamIds.length) return;
  streamIds.forEach((id) => state.epgPending.add(id));
  try {
    const payload = await api("/api/xtream/epg", { method: "POST", body: JSON.stringify({ sessionId: state.sessionId, streamIds }) });
    streamIds.forEach((id) => state.epg.set(id, payload.items?.[id] || {}));
  } catch {
    streamIds.forEach((id) => state.epg.set(id, {}));
  } finally {
    streamIds.forEach((id) => state.epgPending.delete(id));
    updateEpgCards();
  }
}

function currentItems(kind = state.view) {
  if (kind === "live") return state.channels;
  if (kind === "movies") return state.movies;
  if (kind === "series") return state.series;
  if (kind === "episodes") return state.episodes;
  return [];
}

function titleFor(kind) {
  return ({ live: "TV ao vivo", movies: "Filmes", series: "Séries", episodes: "Episódios" })[kind] || "Catálogo";
}

function filteredCatalogItems(kind) {
  const items = currentItems(kind);
  const query = state.filter.query.trim().toLocaleLowerCase("pt-BR");
  return items.filter((item) => (state.filter.group === "Todos" || item.group === state.filter.group) && (!query || `${item.name} ${item.group || ""}`.toLocaleLowerCase("pt-BR").includes(query)));
}

let catalogObserver = null;
let catalogAutoLoading = false;

function renderCatalog(kind, heading = "", description = "") {
  catalogObserver?.disconnect();
  state.view = kind;
  const items = currentItems(kind);
  const groups = ["Todos", ...new Set(items.map((item) => item.group || "Outros"))].slice(0, 80);
  if (!groups.includes(state.filter.group)) state.filter.group = "Todos";
  const filtered = filteredCatalogItems(kind);
  const visible = filtered.slice(0, state.visibleCount);
  const total = Number(kind === "live" ? state.counts.live : state.counts[kind]) || items.length;
  const previousFocus = document.activeElement;
  const restoreSearch = previousFocus?.id === "catalog-search";
  const focusFirstCard = !restoreSearch && (!previousFocus || previousFocus === document.body || previousFocus.matches?.("[data-action^='open-']"));
  document.title = `${titleFor(kind)} · GATE IPTV PLAYER`;
  main.innerHTML = `${topbar()}
    <section class="catalog-head">
      <div><p class="eyebrow">${kind === "live" ? "AGORA NA TV" : kind === "episodes" ? "ESCOLHA UM EPISÓDIO" : "SUA BIBLIOTECA"}</p><h1>${escapeHtml(heading || titleFor(kind))}</h1>${description ? `<p class="catalog-description">${escapeHtml(description)}</p>` : ""}<p>${items.length.toLocaleString("pt-BR")}${total > items.length ? ` de ${total.toLocaleString("pt-BR")}` : ""} itens disponíveis neste aparelho.</p></div>
      <div class="catalog-actions">
        ${kind === "episodes" ? '<button class="secondary-button focusable" data-action="back-series" data-focusable>← Voltar às séries</button>' : ""}
        <button class="secondary-button focusable" data-action="open-source" data-focusable>Trocar lista</button>
      </div>
    </section>
    <div class="catalog-toolbar">
      <label class="search-box"><span>⌕</span><input class="focusable" data-focusable id="catalog-search" type="search" placeholder="Buscar por nome ou categoria" value="${escapeHtml(state.filter.query)}" /></label>
      <span class="result-count">${visible.length.toLocaleString("pt-BR")} de ${filtered.length.toLocaleString("pt-BR")}</span>
    </div>
    <div class="category-row">${groups.map((group) => `<button class="category-chip focusable ${group === state.filter.group ? "active" : ""}" data-group="${escapeHtml(group)}" data-focusable>${escapeHtml(group)}</button>`).join("")}</div>
    ${filtered.length ? `<section class="catalog-grid ${kind === "movies" || kind === "series" ? "poster-grid" : ""}">${visible.map((item) => mediaCard(item, kind)).join("")}</section>${visible.length < filtered.length ? `<div class="catalog-autoload" data-auto-load data-kind="${escapeHtml(kind)}" data-heading="${escapeHtml(heading)}" role="status"><i></i><span>Os próximos cards serão carregados automaticamente</span></div>` : ""}` : '<div class="empty-state">Nenhum item corresponde a esta busca.</div>'}`;
  bindDynamicActions();
  bindCatalogFilters(kind, heading, description);
  refreshFocusable();
  setupAutoPagination(kind, heading);
  queueEpgForCards();
  if (restoreSearch) {
    const search = main.querySelector("#catalog-search");
    search?.focus();
    search?.setSelectionRange?.(search.value.length, search.value.length);
  } else if (focusFirstCard) {
    setTimeout(() => main.querySelector(".catalog-grid .media-card")?.focus(), 0);
  }
}

function setupAutoPagination(kind, heading) {
  const sentinel = main.querySelector("[data-auto-load]");
  if (!sentinel || typeof IntersectionObserver === "undefined") return;
  catalogObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) appendNextCatalogPage(kind, heading);
  }, { rootMargin: "520px 0px" });
  catalogObserver.observe(sentinel);
}

function appendNextCatalogPage(kind = state.view, heading = "") {
  if (catalogAutoLoading || state.view !== kind) return;
  const grid = main.querySelector(".catalog-grid");
  const sentinel = main.querySelector("[data-auto-load]");
  if (!grid || !sentinel) return;
  const filtered = filteredCatalogItems(kind);
  const start = Math.min(state.visibleCount, filtered.length);
  if (start >= filtered.length) { sentinel.remove(); return; }

  catalogAutoLoading = true;
  sentinel.classList.add("loading");
  sentinel.querySelector("span").textContent = "Carregando mais cards…";
  const nextItems = filtered.slice(start, start + state.pageSize);
  state.visibleCount = start + nextItems.length;
  grid.insertAdjacentHTML("beforeend", nextItems.map((item) => mediaCard(item, kind)).join(""));
  bindDynamicActions();
  refreshFocusable();
  queueEpgForCards([...grid.querySelectorAll("[data-live-id]")].slice(start, start + 10));
  const count = main.querySelector(".result-count");
  if (count) count.textContent = `${state.visibleCount.toLocaleString("pt-BR")} de ${filtered.length.toLocaleString("pt-BR")}`;
  if (state.visibleCount >= filtered.length) sentinel.remove();
  else {
    sentinel.classList.remove("loading");
    sentinel.querySelector("span").textContent = "Os próximos cards serão carregados automaticamente";
  }
  catalogAutoLoading = false;
}

function renderCatalogLoading(kind) {
  state.view = kind;
  main.innerHTML = `${topbar()}<section class="catalog-head"><div><p class="eyebrow">CARREGANDO DA SUA FONTE</p><h1>${titleFor(kind)}</h1><p>Listas grandes podem levar alguns segundos.</p></div></section><div class="catalog-loading"><i></i><strong>Organizando ${titleFor(kind).toLowerCase()} e categorias…</strong><span>Não feche o aplicativo.</span></div>`;
}

async function ensureCatalog(kind) {
  state.filter = { query: "", group: "Todos" };
  state.visibleCount = state.pageSize;
  if (kind === "live") return renderCatalog("live");
  if (state.loadedCatalogs.has(kind) || !state.sessionId) return renderCatalog(kind);
  renderCatalogLoading(kind);
  try {
    await loadCatalogData(kind);
    renderCatalog(kind);
  } catch (error) {
    renderHome();
    showToast(error.message, 6500);
  }
}

function loadCatalogData(kind) {
  if (state.loadedCatalogs.has(kind) || !state.sessionId) return Promise.resolve(state[kind]);
  if (state.catalogPromises.has(kind)) return state.catalogPromises.get(kind);
  const sessionId = state.sessionId;
  const request = api("/api/xtream/catalog", { method: "POST", body: JSON.stringify({ sessionId, kind }) })
    .then((payload) => {
      if (state.sessionId !== sessionId) return [];
      state[kind] = payload.items || [];
      state.counts[kind] = payload.total;
      state.loadedCatalogs.add(kind);
      state.catalogErrors.delete(kind);
      return state[kind];
    })
    .catch((error) => {
      if (state.sessionId === sessionId) state.catalogErrors.set(kind, error.message);
      throw error;
    })
    .finally(() => state.catalogPromises.delete(kind));
  state.catalogPromises.set(kind, request);
  return request;
}

async function preloadMainCatalogs() {
  if (!state.sessionId) return;
  await Promise.allSettled([loadCatalogData("movies"), loadCatalogData("series")]);
  if (state.view === "home" && state.source) renderHome();
}

function bindCatalogFilters(kind, heading, description = "") {
  document.querySelector("#catalog-search")?.addEventListener("input", (event) => {
    state.filter.query = event.target.value;
    state.visibleCount = state.pageSize;
    clearTimeout(bindCatalogFilters.timer);
    bindCatalogFilters.timer = setTimeout(() => renderCatalog(kind, heading, description), 180);
  });
  main.querySelectorAll("[data-group]").forEach((button) => button.addEventListener("click", () => {
    state.filter.group = button.dataset.group;
    state.visibleCount = state.pageSize;
    renderCatalog(kind, heading, description);
    [...main.querySelectorAll("[data-group]")].find((item) => item.dataset.group === state.filter.group)?.focus();
  }));
}

function renderRenew() {
  state.view = "renew";
  document.title = "Renovar por MAC · GATE IPTV PLAYER";
  const deviceId = getDeviceId();
  main.innerHTML = `${topbar()}
    <section class="page-title"><p class="eyebrow">GATE SEM ANÚNCIOS</p><h1>Renove seu aparelho<br>usando o MAC.</h1><p>Informe manualmente o MAC exibido no seu aparelho ou portal. Por segurança, navegadores de Smart TV não permitem que o site leia o MAC físico automaticamente.</p></section>
    <section class="renew-layout">
      <form class="renew-card" id="renew-form">
        <h2>Identificar aparelho</h2>
        <label>Endereço MAC<input class="focusable mac-input" data-focusable name="mac" placeholder="00:1A:79:XX:XX:XX" autocomplete="off" required></label>
        <div class="mac-preview">ID deste aplicativo: <strong>${deviceId}</strong></div>
        <label>Nome do aparelho (opcional)<input class="focusable" data-focusable name="deviceName" placeholder="Ex.: TV da sala"></label>
        <button class="primary-button focusable" data-focusable type="submit">Solicitar renovação anual</button>
        <div id="renew-result" aria-live="polite"></div>
      </form>
      <aside class="price-card"><p class="eyebrow">PLANO ANUAL</p><h2>GATE sem anúncios</h2><div class="price">R$ 30<small>/ano</small></div><ul class="benefits"><li>Remove os anúncios de 10 segundos</li><li>Vinculação a um aparelho</li><li>Compatível com a mesma conta/lista</li><li>Renovação rápida pelo MAC</li></ul><p class="legal-note">A assinatura remove anúncios do player. Ela não inclui canais, filmes, séries nem assinatura de terceiros.</p></aside>
    </section>`;
  bindRenewForm();
}

function route() {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.getAttribute("href") === location.pathname));
  if (location.pathname === "/renovar") renderRenew(); else renderHome();
  refreshFocusable();
}

function navigate(pathname) {
  history.pushState({}, "", pathname);
  route();
}

function openSource(tab = "xtream") {
  sourceModal.classList.remove("hidden");
  selectSourceTab(tab);
  setTimeout(() => sourceModal.querySelector(".source-form:not(.hidden) input:not([type=file])")?.focus(), 30);
}

function closeSource() {
  sourceModal.classList.add("hidden");
  sourceStatus.textContent = "";
  sourceStatus.className = "form-status";
}

function selectSourceTab(name) {
  document.querySelectorAll("[data-source-tab]").forEach((tab) => tab.classList.toggle("active", tab.dataset.sourceTab === name));
  document.querySelectorAll(".source-form").forEach((form) => form.classList.toggle("hidden", form.id !== `${name}-form`));
  sourceStatus.textContent = "";
}

function setSourceStatus(message, type = "") {
  sourceStatus.textContent = message;
  sourceStatus.className = `form-status ${type}`;
}

function setFormBusy(form, busy, busyText = "Conectando…") {
  const button = form.querySelector("button[type=submit]");
  if (!button) return;
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.label;
}

function parseLocalM3u(text) {
  const lines = text.split(/\r?\n/);
  const items = [];
  let info = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) {
      const attr = (name) => line.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] || "";
      info = { name: attr("tvg-name") || line.slice(line.lastIndexOf(",") + 1).trim(), group: attr("group-title") || "Outros", logo: attr("tvg-logo"), epgChannelId: attr("tvg-id") };
    } else if (info && /^https?:\/\//i.test(line)) {
      items.push({ ...info, url: line, streamType: /\.m3u8($|\?)/i.test(line) ? "hls" : /\.ts($|\?)/i.test(line) ? "mpegts" : "auto" });
      info = null;
      if (items.length >= 800) break;
    }
  }
  return items;
}

function showPlayerStatus(message, type = "loading") {
  playerStatus.className = `player-status ${type}`;
  playerStatusText.textContent = message;
  retryButton.classList.toggle("hidden", type !== "error");
}

function hidePlayerStatus() {
  playerStatus.classList.add("hidden");
}

function hlsErrorMessage(data) {
  if (data?.response?.code === 401 || data?.response?.code === 403) return "A fonte recusou este canal. Verifique se a conta está ativa e se há conexão disponível.";
  if (data?.response?.code === 404) return "Este canal não está disponível na fonte neste momento.";
  if (data?.type === window.Hls?.ErrorTypes?.MEDIA_ERROR) return "O formato deste canal não pôde ser decodificado nesta TV.";
  return "O canal não respondeu. Tente novamente ou escolha outro canal.";
}

async function playStream(itemOrUrl, name = "Reproduzindo", streamType = "auto") {
  const item = typeof itemOrUrl === "string" ? { playUrl: itemOrUrl, name, streamType } : itemOrUrl;
  if (!item?.playUrl) return;
  state.lastFocused = document.activeElement;
  state.currentItem = item;
  document.querySelector("#player-title").textContent = item.name || name;
  document.querySelector("#player-detail").textContent = item.group || "Fonte conectada pelo usuário";
  const playerDescription = document.querySelector("#player-description");
  if (playerDescription) {
    const epgDescription = item.id ? state.epg.get(String(item.id))?.current?.description : "";
    playerDescription.textContent = item.description || epgDescription || "";
    playerDescription.classList.toggle("hidden", !playerDescription.textContent);
  }
  playerModal.classList.remove("hidden");
  showPlayerStatus("Abrindo o canal…");
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  video.pause();
  video.removeAttribute("src");
  video.load();

  const type = item.streamType || streamType;
  if (type === "mpegts") {
    showPlayerStatus("Este canal usa MPEG-TS direto. Tentando reprodução nativa…");
    video.src = item.playUrl;
    video.play().catch(() => {});
    return;
  }
  if (type === "hls" && window.Hls?.isSupported()) {
    const hls = new window.Hls({ maxBufferLength: 24, maxMaxBufferLength: 48, enableWorker: true, manifestLoadingTimeOut: 20_000, levelLoadingTimeOut: 20_000, fragLoadingTimeOut: 25_000 });
    state.hls = hls;
    let networkRetries = 0;
    let mediaRetries = 0;
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      showPlayerStatus("Sinal encontrado. Iniciando reprodução…");
      video.play().catch(() => showPlayerStatus("Pressione OK ou Play para iniciar.", "ready"));
    });
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 1) {
        networkRetries += 1;
        showPlayerStatus("Reconectando ao canal…");
        setTimeout(() => hls.startLoad(), 1200);
      } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 1) {
        mediaRetries += 1;
        showPlayerStatus("Ajustando o formato do vídeo…");
        hls.recoverMediaError();
      } else {
        showPlayerStatus(hlsErrorMessage(data), "error");
      }
    });
    hls.loadSource(item.playUrl);
    hls.attachMedia(video);
  } else {
    video.src = item.playUrl;
    video.play().catch(() => showPlayerStatus("Pressione OK ou Play para iniciar.", "ready"));
  }
}

function closePlayer() {
  video.pause();
  video.removeAttribute("src");
  video.load();
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  playerModal.classList.add("hidden");
  hidePlayerStatus();
  state.lastFocused?.focus?.();
}

async function openSeries(item) {
  renderCatalogLoading("episodes");
  try {
    const payload = await api("/api/xtream/series", { method: "POST", body: JSON.stringify({ sessionId: item.sessionId || state.sessionId, seriesId: item.seriesId }) });
    state.episodes = payload.episodes || [];
    state.filter = { query: "", group: "Todos" };
    renderCatalog("episodes", payload.name || item.name, payload.description || item.description || "");
  } catch (error) {
    renderCatalog("series");
    showToast(error.message, 6500);
  }
}

function afterConnected(payload) {
  state.source = payload.source;
  state.account = payload.account || null;
  state.sessionId = payload.sessionId || null;
  state.counts = payload.counts || { live: payload.channels?.length || 0, movies: payload.movies?.length || 0, series: payload.series?.length || 0 };
  state.channels = payload.channels || [];
  state.movies = payload.movies || [];
  state.series = payload.series || [];
  state.episodes = [];
  state.loadedCatalogs = new Set();
  state.catalogPromises = new Map();
  state.catalogErrors = new Map();
  state.epg = new Map();
  state.epgPending = new Set();
  if (state.movies.length) state.loadedCatalogs.add("movies");
  if (state.series.length) state.loadedCatalogs.add("series");
  localStorage.setItem("gate.lastSource", JSON.stringify({ type: state.source, connectedAt: new Date().toISOString(), counts: state.counts, expiresAt: state.account?.expiresAt || null }));
  closeSource();
  history.replaceState({}, "", "/");
  state.filter = { query: "", group: "Todos" };
  state.visibleCount = state.pageSize;
  renderHome();
  preloadMainCatalogs();
  showToast(`Lista conectada. Validade: ${formatExpiryDate(state.account?.expiresAt)}.`);
}

function bindForms() {
  document.querySelector("#xtream-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setSourceStatus("Autenticando e organizando os canais…");
    setFormBusy(form, true, "Carregando canais…");
    try { afterConnected(await api("/api/xtream/connect", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) })); }
    catch (error) { setSourceStatus(error.message, "error"); }
    finally { setFormBusy(form, false); }
  });
  document.querySelector("#m3u-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    const url = String(data.get("url") || "");
    setSourceStatus(/\/get\.php/i.test(url) ? "Servidor Xtream detectado. Carregando canais e categorias…" : "Lendo e organizando a lista…");
    setFormBusy(form, true, "Importando…");
    try {
      if (file?.size) {
        if (file.size > 25_000_000) throw new Error("O arquivo deve ter no máximo 25 MB.");
        const localItems = parseLocalM3u(await file.text());
        if (!localItems.length) throw new Error("Nenhum canal válido foi encontrado no arquivo.");
        const prepared = await api("/api/streams/register", { method: "POST", body: JSON.stringify({ items: localItems }) });
        afterConnected({ source: "m3u-file", channels: prepared.items, counts: { live: prepared.items.length } });
      } else {
        afterConnected(await api("/api/m3u/parse", { method: "POST", body: JSON.stringify({ url }) }));
      }
    } catch (error) { setSourceStatus(error.message, "error"); }
    finally { setFormBusy(form, false); }
  });
  document.querySelector("#portal-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setSourceStatus("Validando o portal…");
    setFormBusy(form, true, "Validando…");
    try {
      const payload = await api("/api/portal/validate", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      setSourceStatus(payload.message, "success");
    } catch (error) { setSourceStatus(error.message, "error"); }
    finally { setFormBusy(form, false); }
  });
  document.querySelector("#direct-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setFormBusy(form, true, "Preparando…");
    try {
      const url = new FormData(form).get("url");
      const payload = await api("/api/stream/register", { method: "POST", body: JSON.stringify({ url }) });
      closeSource();
      playStream({ ...payload, name: "Link direto", group: "Fonte conectada" });
    } catch (error) { setSourceStatus(error.message, "error"); }
    finally { setFormBusy(form, false); }
  });
}

function bindRenewForm() {
  document.querySelector("#renew-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    const result = document.querySelector("#renew-result");
    button.disabled = true; button.textContent = "Criando solicitação…";
    try {
      const payload = await api("/api/renewals", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      result.className = "result-box";
      result.innerHTML = `<strong>Solicitação criada</strong><p>MAC: ${escapeHtml(payload.mac)}<br>Protocolo: ${escapeHtml(payload.protocol)}</p>${payload.checkoutUrl ? `<a class="primary-button focusable" data-focusable href="${escapeHtml(payload.checkoutUrl)}" target="_blank" rel="noopener">Ir para pagamento</a>` : "<p>O pagamento online será liberado assim que a conta de cobrança for conectada.</p>"}`;
      refreshFocusable();
    } catch (error) { result.className = "result-box"; result.textContent = error.message; }
    finally { button.disabled = false; button.textContent = "Solicitar renovação anual"; }
  });
}

function bindDynamicActions() {
  main.querySelectorAll("[data-action=open-source]").forEach((button) => button.addEventListener("click", () => openSource(button.dataset.tab || "xtream")));
  main.querySelectorAll("[data-play-url]:not([data-action-bound])").forEach((button) => {
    button.dataset.actionBound = "true";
    button.addEventListener("click", () => playStream({ id: button.dataset.itemId, playUrl: button.dataset.playUrl, name: button.dataset.playName, group: button.querySelector("small")?.textContent, description: button.dataset.description, streamType: button.dataset.streamType || "auto" }));
  });
  main.querySelectorAll("[data-series-id]:not([data-action-bound])").forEach((button) => {
    button.dataset.actionBound = "true";
    button.addEventListener("click", () => openSeries({ seriesId: button.dataset.seriesId, sessionId: button.dataset.sessionId, name: button.dataset.playName, description: button.dataset.description }));
  });
  main.querySelector("[data-action=back-series]")?.addEventListener("click", () => renderCatalog("series"));
}

function setupTvEnvironment() {
  const ua = navigator.userAgent || "";
  const tv = /Tizen|Web0S|WebOS|NetCast|SMART-TV|SmartTV|Android TV|AFT|BRAVIA/i.test(ua);
  document.body.classList.toggle("tv-optimized", tv);
  if (window.tizen?.tvinputdevice) {
    try { window.tizen.tvinputdevice.registerKeyBatch(["MediaPlay", "MediaPause", "MediaPlayPause", "MediaStop", "ColorF0Red", "ColorF1Green"]); } catch {}
  }
}

function getDeviceId() {
  let id = localStorage.getItem("gate.deviceId");
  if (!id) { id = `GT-${cryptoRandom(4)}-${cryptoRandom(4)}`; localStorage.setItem("gate.deviceId", id); }
  return id;
}

function cryptoRandom(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => (value % 36).toString(36).toUpperCase()).join("");
}

let focusables = [];
function refreshFocusable() { focusables = [...document.querySelectorAll("[data-focusable]:not(.hidden):not([disabled])")].filter((element) => element.offsetParent !== null); }
function moveFocus(direction) {
  refreshFocusable();
  const active = document.activeElement;
  const current = active?.getBoundingClientRect();
  if (!current) return focusables[0]?.focus();
  const cx = current.left + current.width / 2, cy = current.top + current.height / 2;
  const candidates = focusables.filter((element) => element !== active).map((element) => {
    const box = element.getBoundingClientRect(); const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const valid = direction === "left" ? x < cx - 8 : direction === "right" ? x > cx + 8 : direction === "up" ? y < cy - 8 : y > cy + 8;
    if (!valid) return null;
    const primary = direction === "left" || direction === "right" ? Math.abs(x - cx) : Math.abs(y - cy);
    const secondary = direction === "left" || direction === "right" ? Math.abs(y - cy) : Math.abs(x - cx);
    return { element, score: primary + secondary * 2.2 };
  }).filter(Boolean).sort((a, b) => a.score - b.score);
  candidates[0]?.element.focus();
  candidates[0]?.element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
}

function showAd() {
  if (state.adFree || sessionStorage.getItem("gate.adShown")) return;
  const overlay = document.querySelector("#ad-overlay");
  const countdown = document.querySelector("#ad-countdown");
  const progress = document.querySelector("#ad-progress-bar");
  const skip = document.querySelector("#skip-ad");
  let remaining = state.config.adDurationSeconds;
  overlay.classList.remove("hidden"); countdown.textContent = remaining;
  progress.style.transition = `width ${remaining}s linear`; requestAnimationFrame(() => { progress.style.width = "100%"; });
  const timer = setInterval(() => {
    remaining -= 1; countdown.textContent = Math.max(0, remaining);
    if (remaining <= 0) { clearInterval(timer); skip.disabled = false; skip.textContent = "Continuar"; skip.focus(); }
  }, 1000);
  skip.addEventListener("click", () => { if (!skip.disabled) { overlay.classList.add("hidden"); sessionStorage.setItem("gate.adShown", "true"); refreshFocusable(); } }, { once: true });
}

video.addEventListener("playing", hidePlayerStatus);
video.addEventListener("canplay", () => { if (!video.paused) hidePlayerStatus(); });
video.addEventListener("waiting", () => showPlayerStatus("Carregando o sinal…"));
video.addEventListener("stalled", () => showPlayerStatus("Sinal instável. Reconectando…"));
video.addEventListener("error", () => showPlayerStatus(video.error?.code === 4 && state.currentItem?.streamType === "mpegts" ? "Esta TV não reproduz MPEG-TS direto. Use a saída M3U8/Xtream do mesmo servidor." : "Não foi possível reproduzir este canal.", "error"));
retryButton.addEventListener("click", () => state.currentItem && playStream(state.currentItem));

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-link]");
  if (link) { event.preventDefault(); navigate(link.getAttribute("href")); }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "open-source" && !event.target.closest("main")) openSource("xtream");
  if (action === "open-live") state.channels.length ? ensureCatalog("live") : openSource("xtream");
  if (action === "open-movies") state.source ? ensureCatalog("movies") : openSource("xtream");
  if (action === "open-series") state.source ? ensureCatalog("series") : openSource("xtream");
  if (action === "toggle-adfree") navigate("/renovar");
});
document.querySelectorAll("[data-source-tab]").forEach((tab) => tab.addEventListener("click", () => selectSourceTab(tab.dataset.sourceTab)));
document.querySelector(".close-modal").addEventListener("click", closeSource);
document.querySelector(".player-close").addEventListener("click", closePlayer);
window.addEventListener("popstate", route);
document.addEventListener("keydown", (event) => {
  const code = Number(event.keyCode || event.which || 0);
  const backPressed = [4, 27, 461, 10009].includes(code) || event.key === "Escape" || event.key === "BrowserBack";
  const playPausePressed = [13, 19, 415, 10252].includes(code) || event.key === "Enter" || event.key === " ";
  const playerOpen = !playerModal.classList.contains("hidden");
  if (playerOpen) {
    if (backPressed || event.key === "Backspace") { event.preventDefault(); closePlayer(); return; }
    if (playPausePressed) { event.preventDefault(); video.paused ? video.play() : video.pause(); return; }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.currentTime + (event.key === "ArrowLeft" ? -10 : 10)); return; }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); video.volume = Math.min(1, Math.max(0, video.volume + (event.key === "ArrowUp" ? .1 : -.1))); return; }
  }
  const directions = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
  if (directions[event.key]) { event.preventDefault(); moveFocus(directions[event.key]); }
  if (backPressed) {
    if (!sourceModal.classList.contains("hidden")) closeSource();
    else if (location.pathname !== "/") history.back();
    else if (state.view !== "home") renderHome();
  }
});
document.addEventListener("focusin", (event) => {
  const card = event.target.closest?.(".catalog-grid .media-card");
  if (!card) return;
  const cards = [...main.querySelectorAll(".catalog-grid .media-card")];
  if (card.dataset.liveId) {
    const index = cards.indexOf(card);
    queueEpgForCards(cards.slice(Math.max(0, index - 1), index + 6));
  }
  if (cards.indexOf(card) < Math.max(0, cards.length - 10)) return;
  const sentinel = main.querySelector("[data-auto-load]");
  if (sentinel) appendNextCatalogPage(sentinel.dataset.kind, sentinel.dataset.heading || "");
});
window.addEventListener("scroll", () => {
  const sentinel = main.querySelector("[data-auto-load]");
  if (!sentinel || sentinel.getBoundingClientRect().top > innerHeight + 520) return;
  appendNextCatalogPage(sentinel.dataset.kind, sentinel.dataset.heading || "");
}, { passive: true });

async function boot() {
  setupTvEnvironment();
  try { state.config = await api("/api/config"); } catch {}
  bindForms(); route(); showAd();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}
boot();
