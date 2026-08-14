const APP_VERSION = "0.5.3";
const CACHE_DB = "gate-player-cache-v1";
const CACHE_STORE = "device";
const FAVORITES_KEY = "gate.favorites.v1";
const catalogGroupCache = new WeakMap();
const catalogSearchCache = new WeakMap();

function readJsonStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "") ?? fallback; }
  catch { return fallback; }
}

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
  previewHls: null,
  webPlayer: null,
  webPreview: null,
  selectedLive: null,
  detailsItem: null,
  detailsKind: null,
  detailsReturnFocus: null,
  detailsInfoCache: new Map(),
  currentItem: null,
  lastFocused: null,
  connectionDescriptor: null,
  favorites: new Set(readJsonStorage(FAVORITES_KEY, [])),
  activation: { key: "", at: 0 },
  adFree: localStorage.getItem("gate.adFree") === "true"
};

const main = document.querySelector("#main-content");
const sourceModal = document.querySelector("#source-modal");
const playerModal = document.querySelector("#player-modal");
const detailsModal = document.querySelector("#details-modal");
const detailsPoster = document.querySelector("#details-poster");
const detailsBackdrop = document.querySelector("#details-backdrop");
const detailsPrimary = document.querySelector("#details-primary");
const detailsFavorite = document.querySelector("#details-favorite");
const sourceStatus = document.querySelector("#source-status");
const video = document.querySelector("#video-player");
const playerStatus = document.querySelector("#player-status");
const playerStatusText = document.querySelector("#player-status-text");
const retryButton = document.querySelector("#retry-stream");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

function gateIcon(name, className = "ui-icon") {
  const paths = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10M9 20v-6h6v6"/>',
    live: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m8 3 4 3 4-3M8 12h8M12 9v6"/>',
    movies: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M7 5l2 4m4-4 2 4m2-4 2 4"/>',
    series: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.36.28.57.71.6 1.17V10h1v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/>',
    fullscreen: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    play: '<path d="m8 5 11 7-11 7Z"/>',
    favorite: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"/>'
  };
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.play}</svg>`;
}

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

function openCacheDb() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(CACHE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CACHE_STORE)) request.result.createObjectStore(CACHE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function cacheRead(key) {
  const db = await openCacheDb();
  if (!db) return readJsonStorage(`gate.cache.${key}`, null);
  return new Promise((resolve) => {
    const request = db.transaction(CACHE_STORE, "readonly").objectStore(CACHE_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  }).finally(() => db.close());
}

async function cacheWrite(key, value) {
  const db = await openCacheDb();
  if (!db) {
    try {
      const serialized = JSON.stringify(value);
      if (serialized.length < 4_000_000) localStorage.setItem(`gate.cache.${key}`, serialized);
    } catch {}
    return;
  }
  await new Promise((resolve) => {
    const transaction = db.transaction(CACHE_STORE, "readwrite");
    transaction.objectStore(CACHE_STORE).put(value, key);
    transaction.oncomplete = resolve;
    transaction.onerror = resolve;
    transaction.onabort = resolve;
  });
  db.close();
}

function favoriteKey(item, kind) {
  const type = kind === "live" ? "live" : kind === "series" ? "series" : "movies";
  const id = item?.seriesId || item?.id || item?.name;
  return id ? `${type}:${String(id)}` : "";
}

function isFavorite(item, kind) {
  const key = favoriteKey(item, kind);
  return Boolean(key && state.favorites.has(key));
}

function persistFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
}

function toggleFavorite(item, kind) {
  const key = favoriteKey(item, kind);
  if (!key) return false;
  if (state.favorites.has(key)) state.favorites.delete(key);
  else state.favorites.add(key);
  persistFavorites();
  syncFavoriteUi();
  showToast(state.favorites.has(key) ? "Adicionado aos favoritos." : "Removido dos favoritos.");
  return state.favorites.has(key);
}

function favoriteItems(kind) {
  return currentItems(kind).filter((item) => isFavorite(item, kind));
}

function allowActivation(key, minimumGap = 420) {
  const now = performance.now();
  if (state.activation.key === key && now - state.activation.at < minimumGap) return false;
  state.activation = { key, at: now };
  return true;
}

function topbar() {
  const connected = state.source ? '<span class="pill connected-pill">● Lista conectada</span>' : '<span class="pill">Nenhuma lista conectada</span>';
  const expiry = state.source ? `<span class="pill expiry-pill">Validade: ${escapeHtml(formatExpiryDate(state.account?.expiresAt))}</span>` : "";
  return `<header class="topbar">
    <button class="top-brand focusable" data-action="go-home" data-focusable><img src="/gate-icon.svg" alt=""><span><strong>GATE</strong><small>IPTV PLAYER</small></span></button>
    <div class="top-actions">${connected}${expiry}${state.source ? `<button class="round-action focusable" data-action="open-favorites" data-focusable aria-label="Favoritos">${gateIcon("favorite")}</button>` : ""}<button class="round-action focusable" data-action="open-source" data-focusable aria-label="Trocar lista">${gateIcon("settings")}</button></div>
  </header>`;
}

function formatExpiryDate(value) {
  if (!value) return "data não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "data não informada";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function renderHome() {
  stopLivePreview();
  state.view = "home";
  document.title = "GATE IPTV PLAYER";
  if (state.source) {
    main.innerHTML = `${topbar()}
      <section class="tv-home-head"><div><p class="eyebrow">CONTEÚDO DA SUA LISTA</p><h1>O que você quer assistir?</h1></div></section>
      ${renderConnectedSummary()}`;
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
    const total = Number(state.counts[kind] ?? state[kind].length);
    if (!state.loadedCatalogs.has(kind) && state.sessionId && !total) return `Abrir catálogo de ${singular.toLowerCase()}s`;
    return `${total.toLocaleString("pt-BR")} ${singular.toLowerCase()}${total === 1 ? "" : "s"}`;
  };
  return `<section class="account-strip">
      <span class="account-dot" aria-hidden="true"></span>
      <span><small>STATUS DA LISTA</small><strong>${escapeHtml(status)}</strong></span>
      <span class="account-expiry"><small>DATA DE EXPIRAÇÃO</small><strong>${escapeHtml(expires)}</strong></span>
    </section>
    <section class="library-launchers simple-launchers">
      <button class="library-launch focusable live-launch" data-action="open-live" data-focusable><span class="launcher-icon">${gateIcon("live")}</span><span><strong>TV ao vivo</strong><small>${live.toLocaleString("pt-BR")} canais</small></span><b>›</b></button>
      <button class="library-launch focusable movies-launch" data-action="open-movies" data-focusable><span class="launcher-icon">${gateIcon("movies")}</span><span><strong>Filmes</strong><small>${escapeHtml(catalogLabel("movies", "filme"))}</small></span><b>›</b></button>
      <button class="library-launch focusable series-launch" data-action="open-series" data-focusable><span class="launcher-icon">${gateIcon("series")}</span><span><strong>Séries</strong><small>${escapeHtml(catalogLabel("series", "série"))}</small></span><b>›</b></button>
      <button class="library-launch focusable favorites-launch" data-action="open-favorites" data-focusable><span class="launcher-icon">${gateIcon("favorite")}</span><span><strong>Favoritos</strong><small>${state.favorites.size.toLocaleString("pt-BR")} ${state.favorites.size === 1 ? "item salvo" : "itens salvos"}</small></span><b>›</b></button>
    </section>`;
}

function renderFavorites() {
  stopLivePreview();
  state.view = "favorites";
  document.title = "Favoritos · GATE IPTV PLAYER";
  const sections = [
    ["live", "Canais"],
    ["movies", "Filmes"],
    ["series", "Séries"]
  ];
  const content = sections.map(([kind, label]) => {
    const items = favoriteItems(kind);
    if (!items.length) return "";
    return `<section class="home-shelf ${kind}"><div class="home-shelf-head"><h2>${label}</h2><span>${items.length.toLocaleString("pt-BR")}</span></div><div class="catalog-grid ${kind === "live" ? "" : "poster-grid"}">${items.map((item) => mediaCard(item, kind)).join("")}</div></section>`;
  }).filter(Boolean).join("");
  main.innerHTML = `${topbar()}<section class="catalog-titlebar"><button class="round-action focusable" data-action="go-home" data-focusable aria-label="Voltar">${gateIcon("back")}</button><div><p class="eyebrow">SUA SELEÇÃO</p><h1>Favoritos</h1></div><span class="result-count">${state.favorites.size.toLocaleString("pt-BR")} salvos</span></section>${content || '<div class="empty-state">Nenhum favorito ainda. Abra um canal, filme ou série e pressione “Favoritar”.</div>'}`;
  bindDynamicActions();
  refreshFocusable();
  setTimeout(() => main.querySelector(".media-card, [data-action=go-home]")?.focus(), 0);
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
  const playable = Boolean(item.playUrl);
  const favorite = isFavorite(item, kind);
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
  const artwork = item.logo ? `<img class="card-artwork" src="${escapeHtml(item.logo)}" alt="" loading="lazy" decoding="async">` : "";
  return `<button class="media-card focusable kind-${escapeHtml(kind)} ${item.logo ? "has-image" : "cover-missing"} ${favorite ? "is-favorite" : ""}" data-focusable data-item-kind="${escapeHtml(kind)}"${playable ? ` data-play-url="${escapeHtml(item.playUrl)}" data-stream-type="${escapeHtml(item.streamType || "auto")}"` : ""}${seriesData}${detailsData}${liveData} data-play-name="${escapeHtml(item.name)}">
    ${artwork}${favorite ? '<span class="favorite-mark" aria-label="Favorito">★</span>' : ""}<span class="play-dot">${item.seriesId ? "＋" : "▶"}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(metadata)}</small>${extra}</button>`;
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
  updateLivePreviewEpg();
}

function updateLivePreviewEpg() {
  const item = state.selectedLive;
  const panel = main.querySelector(".live-preview-panel");
  if (!item || !panel) return;
  const entry = state.epg.get(String(item.id)) || {};
  const currentTime = [formatProgramTime(entry.current?.start), formatProgramTime(entry.current?.end)].filter(Boolean).join(" – ");
  const nextTime = [formatProgramTime(entry.next?.start), formatProgramTime(entry.next?.end)].filter(Boolean).join(" – ");
  const nowTitle = panel.querySelector("[data-epg-now-title]");
  const nowTime = panel.querySelector("[data-epg-now-time]");
  const nowDescription = panel.querySelector("[data-epg-now-description]");
  const nextTitle = panel.querySelector("[data-epg-next-title]");
  const nextTimeNode = panel.querySelector("[data-epg-next-time]");
  if (nowTitle) nowTitle.textContent = entry.current?.title || "Programação não informada";
  if (nowTime) nowTime.textContent = currentTime || "Agora";
  if (nowDescription) nowDescription.textContent = entry.current?.description || "O servidor não forneceu uma descrição para este programa.";
  if (nextTitle) nextTitle.textContent = entry.next?.title || "Próximo programa não informado";
  if (nextTimeNode) nextTimeNode.textContent = nextTime || "Depois";
}

async function queueEpgForCards(cards = [...main.querySelectorAll("[data-live-id]")]) {
  if (!state.sessionId) return;
  const sessionId = state.sessionId;
  const epg = state.epg;
  const pending = state.epgPending;
  const streamIds = [...new Set(cards.map((card) => String(card.dataset.liveId || "")))]
    .filter((id) => id && !epg.has(id) && !pending.has(id))
    .slice(0, 10);
  if (!streamIds.length) return;
  streamIds.forEach((id) => pending.add(id));
  try {
    const payload = await api("/api/xtream/epg", { method: "POST", body: JSON.stringify({ sessionId, streamIds }) });
    if (state.sessionId !== sessionId) return;
    streamIds.forEach((id) => epg.set(id, payload.items?.[id] || {}));
  } catch {
    if (state.sessionId === sessionId) streamIds.forEach((id) => epg.set(id, {}));
  } finally {
    streamIds.forEach((id) => pending.delete(id));
    if (state.sessionId === sessionId) updateEpgCards();
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

function catalogGroupSummary(items, limit) {
  let summary = catalogGroupCache.get(items);
  if (!summary) {
    const counts = new Map();
    const order = [];
    for (const item of items) {
      const group = item.group || "Outros";
      if (!counts.has(group)) order.push(group);
      counts.set(group, (counts.get(group) || 0) + 1);
    }
    summary = { counts, order };
    catalogGroupCache.set(items, summary);
  }
  const groups = ["Todos", ...summary.order.slice(0, Math.max(0, limit - 1))];
  return { groups, count: (group) => group === "Todos" ? items.length : summary.counts.get(group) || 0 };
}

function catalogSearchText(item) {
  if (!item || typeof item !== "object") return "";
  let value = catalogSearchCache.get(item);
  if (!value) {
    value = `${item.name || ""} ${item.group || ""}`.toLocaleLowerCase("pt-BR");
    catalogSearchCache.set(item, value);
  }
  return value;
}

function filteredCatalogItems(kind) {
  const items = currentItems(kind);
  const query = state.filter.query.trim().toLocaleLowerCase("pt-BR");
  return items.filter((item) => (state.filter.group === "Todos" || (item.group || "Outros") === state.filter.group) && (!query || catalogSearchText(item).includes(query)));
}

let catalogObserver = null;
let catalogAutoLoading = false;

function renderCatalog(kind, heading = "", description = "") {
  catalogObserver?.disconnect();
  state.view = kind;
  if (kind === "live") return renderLiveCatalog();
  stopLivePreview();
  const items = currentItems(kind);
  const groupSummary = catalogGroupSummary(items, 80);
  const groups = groupSummary.groups;
  if (!groups.includes(state.filter.group)) state.filter.group = "Todos";
  const filtered = filteredCatalogItems(kind);
  const visible = filtered.slice(0, state.visibleCount);
  const total = Number(kind === "live" ? state.counts.live : state.counts[kind]) || items.length;
  const previousFocus = document.activeElement;
  const restoreSearch = previousFocus?.id === "catalog-search";
  const focusFirstCard = !restoreSearch && (!previousFocus || previousFocus === document.body || previousFocus.matches?.("[data-action^='open-']"));
  document.title = `${titleFor(kind)} · GATE IPTV PLAYER`;
  main.innerHTML = `${topbar()}
    <section class="catalog-titlebar">
      <button class="round-action focusable" data-action="go-home" data-focusable aria-label="Voltar">${gateIcon("back")}</button>
      <div><p class="eyebrow">${kind === "episodes" ? "ESCOLHA UM EPISÓDIO" : "SUA BIBLIOTECA"}</p><h1>${escapeHtml(heading || titleFor(kind))}</h1>${description ? `<p class="catalog-description">${escapeHtml(description)}</p>` : ""}</div>
      ${kind === "episodes" ? '<button class="secondary-button focusable" data-action="back-series" data-focusable>Voltar às séries</button>' : `<span class="result-count">${visible.length.toLocaleString("pt-BR")} de ${filtered.length.toLocaleString("pt-BR")}</span>`}
    </section>
    <section class="catalog-layout">
      <aside class="catalog-categories">
        <label class="search-box">${gateIcon("search")}<input class="focusable" data-focusable id="catalog-search" type="search" placeholder="Buscar" value="${escapeHtml(state.filter.query)}" /></label>
        <div class="category-row">${groups.map((group) => `<button class="category-chip focusable ${group === state.filter.group ? "active" : ""}" data-group="${escapeHtml(group)}" data-focusable><span>${escapeHtml(group)}</span><b>${groupSummary.count(group)}</b></button>`).join("")}</div>
      </aside>
      <div class="catalog-results">
        ${filtered.length ? `<section class="catalog-grid ${kind === "movies" || kind === "series" ? "poster-grid" : ""}">${visible.map((item) => mediaCard(item, kind)).join("")}</section>${visible.length < filtered.length ? `<div class="catalog-autoload" data-auto-load data-kind="${escapeHtml(kind)}" data-heading="${escapeHtml(heading)}" role="status"><i></i><span>Carregando automaticamente…</span></div>` : ""}` : '<div class="empty-state">Nenhum item corresponde a esta busca.</div>'}
      </div>
    </section>`;
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
    setTimeout(() => main.querySelector(".category-chip.active, .catalog-grid .media-card")?.focus(), 0);
  }
}

function liveChannelRow(item) {
  const selected = String(state.selectedLive?.id || "") === String(item.id || "");
  const favorite = isFavorite(item, "live");
  return `<button class="live-channel-row focusable ${selected ? "active" : ""} ${favorite ? "is-favorite" : ""}" data-focusable data-live-select="${escapeHtml(item.id || "")}" data-live-id="${escapeHtml(item.id || "")}">
    <span class="channel-number">${escapeHtml(item.id || "•")}</span>
    <span class="channel-logo">${item.logo ? `<img src="${escapeHtml(item.logo)}" alt="" loading="lazy" decoding="async">` : gateIcon("live")}</span>
    <span><strong>${escapeHtml(item.name)}</strong><small class="card-now">Carregando guia…</small></span>
    <b>${favorite ? "★" : gateIcon("play")}</b>
  </button>`;
}

function renderLivePreview(item) {
  const epg = item?.id ? state.epg.get(String(item.id)) : null;
  return `<aside class="live-preview-panel">
    <div class="live-preview-stage">
      <video id="live-preview-video" playsinline></video>
      <div class="preview-placeholder ${item ? "" : "visible"}">
        ${item?.logo ? `<img src="${escapeHtml(item.logo)}" alt="">` : gateIcon("live", "preview-icon")}
        <span>${item ? "Selecione o canal novamente para tela cheia" : "Escolha um canal"}</span>
      </div>
    </div>
    <div class="live-channel-title"><span class="live-badge">AO VIVO</span><div><strong data-live-preview-name>${escapeHtml(item?.name || "Selecione um canal")}</strong><small>${escapeHtml(item?.group || "TV ao vivo")}</small></div></div>
    <button class="favorite-button focusable" data-action="toggle-live-favorite" data-focusable ${item ? "" : "disabled"}>${isFavorite(item, "live") ? "★ Remover dos favoritos" : "☆ Favoritar canal"}</button>
    <div class="epg-card now"><small>AGORA</small><strong data-epg-now-title>${escapeHtml(epg?.current?.title || "Programação não informada")}</strong><time data-epg-now-time>Agora</time><p data-epg-now-description>${escapeHtml(epg?.current?.description || "Escolha um canal para visualizar a programação e iniciar a prévia.")}</p></div>
    <div class="epg-card next"><small>A SEGUIR</small><strong data-epg-next-title>${escapeHtml(epg?.next?.title || "Próximo programa não informado")}</strong><time data-epg-next-time>Depois</time></div>
  </aside>`;
}

function renderLiveCatalog() {
  stopLivePreview();
  catalogObserver?.disconnect();
  state.view = "live";
  const items = state.channels;
  const groupSummary = catalogGroupSummary(items, 100);
  const groups = groupSummary.groups;
  if (!groups.includes(state.filter.group)) state.filter.group = "Todos";
  const filtered = filteredCatalogItems("live");
  if (state.selectedLive && !filtered.some((item) => String(item.id) === String(state.selectedLive.id))) state.selectedLive = null;
  state.visibleCount = Math.max(60, state.visibleCount);
  const visible = filtered.slice(0, state.visibleCount);
  if (state.selectedLive && !items.some((item) => String(item.id) === String(state.selectedLive.id))) state.selectedLive = null;
  document.title = "TV ao vivo · GATE IPTV PLAYER";
  main.innerHTML = `${topbar()}
    <section class="catalog-titlebar live-titlebar"><button class="round-action focusable" data-action="go-home" data-focusable aria-label="Voltar">${gateIcon("back")}</button><div><p class="eyebrow">AGORA NA TV</p><h1>TV ao vivo</h1></div><span class="result-count">${filtered.length.toLocaleString("pt-BR")} canais</span></section>
    <section class="live-layout">
      <aside class="catalog-categories live-categories">
        <label class="search-box">${gateIcon("search")}<input class="focusable" data-focusable id="catalog-search" type="search" placeholder="Buscar canal" value="${escapeHtml(state.filter.query)}"></label>
        <div class="category-row">${groups.map((group) => `<button class="category-chip focusable ${group === state.filter.group ? "active" : ""}" data-group="${escapeHtml(group)}" data-focusable><span>${escapeHtml(group)}</span><b>${groupSummary.count(group)}</b></button>`).join("")}</div>
      </aside>
      <section class="live-channel-column">
        <div class="channel-list-head"><span>CANAL</span><span>PROGRAMAÇÃO</span></div>
        <div class="live-channel-list">${visible.map(liveChannelRow).join("")}${visible.length < filtered.length ? `<div class="catalog-autoload" data-auto-load data-kind="live" role="status"><i></i><span>Carregando automaticamente…</span></div>` : ""}</div>
      </section>
      ${renderLivePreview(state.selectedLive)}
    </section>`;
  bindDynamicActions();
  bindCatalogFilters("live", "");
  refreshFocusable();
  setupAutoPagination("live", "");
  queueEpgForCards([...main.querySelectorAll("[data-live-id]")].slice(0, 10));
  setTimeout(() => main.querySelector(".category-chip.active, .live-channel-row")?.focus(), 0);
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
  const grid = main.querySelector(kind === "live" ? ".live-channel-list" : ".catalog-grid");
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
  sentinel.insertAdjacentHTML("beforebegin", nextItems.map((item) => kind === "live" ? liveChannelRow(item) : mediaCard(item, kind)).join(""));
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
      saveDeviceSnapshot();
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

function bindCatalogFilters(kind, heading, description = "") {
  document.querySelector("#catalog-search")?.addEventListener("input", (event) => {
    const input = event.currentTarget;
    state.filter.query = event.target.value;
    state.visibleCount = state.pageSize;
    clearTimeout(bindCatalogFilters.timer);
    bindCatalogFilters.timer = setTimeout(() => {
      if (state.view === kind && input.isConnected) renderCatalog(kind, heading, description);
    }, 220);
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

function openDetails(item, kind) {
  if (!item) return;
  state.detailsItem = item;
  state.detailsKind = kind;
  state.detailsReturnFocus = document.activeElement;
  renderDetailsContent(item, kind);
  detailsModal.classList.remove("hidden");
  refreshFocusable();
  setTimeout(() => detailsPrimary.focus(), 30);
  enrichDetails(item, kind);
}

function renderDetailsContent(item, kind) {
  const isSeries = kind === "series";
  document.querySelector("#details-kind").textContent = isSeries ? "SÉRIE" : "FILME";
  document.querySelector("#details-title").textContent = item.name || (isSeries ? "Série" : "Filme");
  document.querySelector("#details-synopsis").textContent = item.description || "Buscando sinopse na lista…";
  const metadata = [item.year, item.genre || item.group, item.rating ? `★ ${item.rating}` : ""]
    .filter(Boolean)
    .map((value) => `<span>${escapeHtml(value)}</span>`)
    .join("");
  document.querySelector("#details-meta").innerHTML = metadata || "<span>Informações da lista</span>";
  detailsPoster.classList.remove("fallback");
  detailsPoster.src = item.logo || "/gate-icon.svg";
  detailsPoster.alt = item.logo ? `Capa de ${item.name || "conteúdo"}` : "";
  detailsBackdrop.style.backgroundImage = item.logo ? `url(${JSON.stringify(item.logo)})` : "none";
  detailsPrimary.textContent = isSeries ? "Assistir episódio 1" : "Assistir agora";
  detailsFavorite.textContent = isFavorite(item, kind) ? "★ Remover favorito" : "☆ Favoritar";
}

function syncFavoriteUi() {
  if (state.detailsItem && !detailsModal.classList.contains("hidden")) {
    detailsFavorite.textContent = isFavorite(state.detailsItem, state.detailsKind) ? "★ Remover favorito" : "☆ Favoritar";
  }
  const liveButton = main.querySelector("[data-action=toggle-live-favorite]");
  if (liveButton && state.selectedLive) liveButton.textContent = isFavorite(state.selectedLive, "live") ? "★ Remover dos favoritos" : "☆ Favoritar canal";
  main.querySelectorAll(".media-card[data-item-kind]").forEach((card) => {
    const kind = card.dataset.itemKind;
    const item = currentItems(kind).find((entry) => String(entry.id || entry.seriesId || "") === String(card.dataset.itemId || card.dataset.seriesId || ""));
    const active = isFavorite(item, kind);
    card.classList.toggle("is-favorite", active);
    let mark = card.querySelector(".favorite-mark");
    if (active && !mark) card.insertAdjacentHTML("afterbegin", '<span class="favorite-mark" aria-label="Favorito">★</span>');
    if (!active) mark?.remove();
  });
}

async function enrichDetails(item, kind) {
  if (!state.sessionId || !item?.id || !["movies", "series"].includes(kind)) {
    if (!item?.description && state.detailsItem === item) document.querySelector("#details-synopsis").textContent = "Sinopse não informada pela lista.";
    return item;
  }
  const key = `${kind}:${item.id}`;
  let request = state.detailsInfoCache.get(key);
  if (!request) {
    request = api("/api/xtream/details", { method: "POST", body: JSON.stringify({ sessionId: state.sessionId, kind, itemId: item.id }) });
    state.detailsInfoCache.set(key, request);
  }
  try {
    const details = await request;
    Object.assign(item, Object.fromEntries(Object.entries(details).filter(([, value]) => value !== "" && value != null)));
    if (state.detailsItem === item && state.detailsKind === kind && !detailsModal.classList.contains("hidden")) renderDetailsContent(item, kind);
    return item;
  } catch {
    state.detailsInfoCache.delete(key);
    if (state.detailsItem === item && !item.description) document.querySelector("#details-synopsis").textContent = "Sinopse não informada pela lista.";
    return item;
  }
}

function closeDetails(restoreFocus = true) {
  detailsModal.classList.add("hidden");
  const returnFocus = state.detailsReturnFocus;
  state.detailsItem = null;
  state.detailsKind = null;
  state.detailsReturnFocus = null;
  if (restoreFocus) returnFocus?.focus?.();
}

async function confirmDetails() {
  const item = state.detailsItem;
  const kind = state.detailsKind;
  const returnFocus = state.detailsReturnFocus;
  if (!item) return;
  closeDetails(false);
  state.lastFocused = returnFocus;
  if (kind === "series") {
    if (item.firstEpisode?.playUrl) {
      playStream({ ...item.firstEpisode, name: `${item.name} · ${item.firstEpisode.name}` }, "Reproduzindo", "auto", { immersive: true, preserveFocus: true });
      return;
    }
    preparePlayerShell(item, { immersive: true, preserveFocus: true, statusText: "Carregando o primeiro episódio…" });
    try {
      const payload = await api("/api/xtream/series", { method: "POST", body: JSON.stringify({ sessionId: item.sessionId || state.sessionId, seriesId: item.seriesId || item.id }) });
      state.episodes = payload.episodes || [];
      const firstEpisode = state.episodes[0];
      if (!firstEpisode?.playUrl) throw new Error("Nenhum episódio reproduzível foi encontrado nesta série.");
      await playStream({ ...firstEpisode, name: `${payload.name || item.name} · ${firstEpisode.name}` }, "Reproduzindo", "auto", { immersive: true, reusePlayer: true, preserveFocus: true });
    } catch (error) {
      closePlayer();
      showToast(error.message, 6500);
    }
    return;
  }
  playStream(item, "Reproduzindo", "auto", { immersive: true, preserveFocus: true });
}

function normalizeXtreamForm(form) {
  const serverInput = form.elements.serverUrl;
  let value = String(serverInput?.value || "").trim();
  if (!value) return { serverUrl: "", username: "", password: "" };
  if (value.startsWith("//")) value = `http:${value}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`;
  try {
    const parsed = new URL(value);
    const queryUser = parsed.searchParams.get("username") || parsed.searchParams.get("user") || "";
    const queryPassword = parsed.searchParams.get("password") || parsed.searchParams.get("pass") || "";
    if (!form.elements.username.value && queryUser) form.elements.username.value = queryUser;
    if (!form.elements.password.value && queryPassword) form.elements.password.value = queryPassword;
    parsed.pathname = parsed.pathname.replace(/\/(?:player_api|panel_api|get|xmltv)\.php\/?$/i, "").replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    serverInput.value = parsed.toString().replace(/\/$/, "");
  } catch {
    serverInput.value = value;
  }
  return {
    serverUrl: serverInput.value.trim(),
    username: form.elements.username.value.trim(),
    password: form.elements.password.value
  };
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

function adaptiveHlsOptions(preview = false) {
  return {
    startLevel: -1,
    capLevelToPlayerSize: true,
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: preview ? 45 : 90,
    maxBufferLength: preview ? 60 : 120,
    maxMaxBufferLength: preview ? 180 : 300,
    abrBandWidthFactor: .65,
    abrBandWidthUpFactor: .45,
    abrEwmaDefaultEstimate: 1_500_000,
    liveSyncDurationCount: preview ? 3 : 5,
    liveMaxLatencyDurationCount: preview ? 10 : 18,
    maxLiveSyncPlaybackRate: 1.04,
    manifestLoadingTimeOut: 30_000,
    levelLoadingTimeOut: 30_000,
    fragLoadingTimeOut: 35_000
  };
}

function absoluteStreamUrl(value) {
  try { return new URL(String(value || ""), location.href).href; }
  catch { return String(value || ""); }
}

function directStreamUrl(value) {
  try {
    const url = new URL(String(value || ""), location.href);
    if (url.origin === location.origin && /^\/api\/stream\//.test(url.pathname)) url.searchParams.set("direct", "1");
    return url.href;
  } catch { return String(value || ""); }
}

function streamCandidates(item) {
  const candidates = [];
  const add = (url, type, direct) => {
    if (!url) return;
    const resolved = direct ? directStreamUrl(url) : absoluteStreamUrl(url);
    if (!resolved || candidates.some((candidate) => candidate.url === resolved)) return;
    candidates.push({ url: resolved, type: type || "auto", direct });
  };
  add(item?.playUrl, item?.streamType, false);
  add(item?.playUrl, item?.streamType, true);
  add(item?.fallbackPlayUrl, item?.fallbackStreamType, false);
  add(item?.fallbackPlayUrl, item?.fallbackStreamType, true);
  return candidates;
}

function nativePlayerAvailable() {
  try { return Boolean(window.GateNativePlayer && typeof window.GateNativePlayer.playFullscreen === "function"); }
  catch { return false; }
}

window.GateNativeHooks = {
  onEngine(engine) {
    document.documentElement.dataset.nativeEngine = String(engine || "").toLowerCase();
  },
  onError(message) {
    showToast(message || "O canal não respondeu em nenhum dos motores.", 6500);
  },
  onClosed() {
    document.documentElement.dataset.nativeEngine = "";
    state.lastFocused?.focus?.();
  }
};

function nativeStreamPair(item) {
  const candidates = streamCandidates(item);
  const primary = candidates.find((candidate) => candidate.direct) || candidates[0];
  const fallback = candidates.find((candidate) => candidate.direct && candidate.url !== primary?.url && candidate.type !== primary?.type)
    || candidates.find((candidate) => candidate.url !== primary?.url);
  return { primary, fallback };
}

function playNativePreview(item) {
  if (!nativePlayerAvailable()) return false;
  const stage = main.querySelector(".live-preview-stage");
  if (!stage) return false;
  const rect = stage.getBoundingClientRect();
  const scale = Number(devicePixelRatio || 1);
  const { primary, fallback } = nativeStreamPair(item);
  if (!primary?.url) return false;
  try {
    window.GateNativePlayer.preview(
      primary.url,
      fallback?.url || "",
      item.name || "Canal",
      primary.type || "auto",
      Math.max(0, Math.round(rect.left * scale)),
      Math.max(0, Math.round(rect.top * scale)),
      Math.max(1, Math.round(rect.width * scale)),
      Math.max(1, Math.round(rect.height * scale))
    );
    return true;
  } catch { return false; }
}

function syncNativePreviewBounds() {
  if (!nativePlayerAvailable() || !state.selectedLive || state.view !== "live") return;
  const stage = main.querySelector(".live-preview-stage");
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  const scale = Number(devicePixelRatio || 1);
  try {
    window.GateNativePlayer.resizePreview(
      Math.max(0, Math.round(rect.left * scale)),
      Math.max(0, Math.round(rect.top * scale)),
      Math.max(1, Math.round(rect.width * scale)),
      Math.max(1, Math.round(rect.height * scale))
    );
  } catch {}
}

function clearWebEngine(session) {
  if (!session) return;
  if (session.hls) { session.hls.destroy(); session.hls = null; }
  if (session.mpegts) {
    try { session.mpegts.pause(); session.mpegts.unload(); session.mpegts.detachMediaElement(); session.mpegts.destroy(); } catch {}
    session.mpegts = null;
  }
  session.media.pause();
  session.media.removeAttribute("src");
  session.media.load();
}

function destroyWebPlayback(slot, clearMedia = true) {
  const session = state[slot];
  if (!session) return;
  clearInterval(session.watchdog);
  session.destroyed = true;
  if (clearMedia) clearWebEngine(session);
  for (const [name, handler] of session.listeners || []) session.media.removeEventListener(name, handler);
  state[slot] = null;
  if (slot === "webPlayer") state.hls = null;
  if (slot === "webPreview") state.previewHls = null;
}

function playbackStatus(session, message, type = "loading") {
  if (!session.preview) showPlayerStatus(message, type);
}

function bufferedAhead(media) {
  const currentTime = Number(media?.currentTime);
  if (!Number.isFinite(currentTime) || !media?.buffered) return 0;
  try {
    for (let index = 0; index < media.buffered.length; index += 1) {
      const start = media.buffered.start(index);
      const end = media.buffered.end(index);
      if (currentTime >= start - .25 && currentTime <= end + .25) return Math.max(0, end - currentTime);
    }
  } catch {}
  return 0;
}

function markPlaybackProgress(session) {
  session.lastProgressAt = Date.now();
  session.starvedAt = 0;
  session.stallRetries = 0;
  session.routeRounds = 0;
}

function advanceWebCandidate(session, message) {
  if (!session || session.destroyed || session.switching) return;
  session.switching = true;
  clearWebEngine(session);
  session.index += 1;
  session.networkRetries = 0;
  session.mediaRetries = 0;
  session.stallRetries = 0;
  setTimeout(() => {
    session.switching = false;
    startWebCandidate(session, message);
  }, session.preview ? 180 : 320);
}

function retryWebCandidate(session, message, { preserveNetworkRetries = false } = {}) {
  if (!session || session.destroyed || session.switching) return;
  session.switching = true;
  clearWebEngine(session);
  if (!preserveNetworkRetries) session.networkRetries = 0;
  session.mediaRetries = 0;
  session.lastProgressAt = Date.now();
  session.starvedAt = 0;
  playbackStatus(session, message || "Reconectando o canal…");
  setTimeout(() => {
    session.switching = false;
    startWebCandidate(session, message);
  }, session.preview ? 350 : 700);
}

function startWebCandidate(session, reason = "") {
  if (!session || session.destroyed) return;
  const candidate = session.candidates[session.index];
  if (!candidate) {
    session.routeRounds += 1;
    session.index = 0;
    const delay = Math.min(15_000, 2_000 * session.routeRounds);
    playbackStatus(session, reason || "Mantendo o canal aberto e procurando uma rota estável…");
    setTimeout(() => startWebCandidate(session, "Nova tentativa de conexão…"), delay);
    return;
  }
  session.lastProgressAt = Date.now();
  session.starvedAt = 0;
  session.lastTime = -1;
  session.lastDecodedFrames = -1;
  session.started = false;
  playbackStatus(session, candidate.direct ? "Testando rota direta mais rápida…" : "Abrindo pela rota compatível…");

  if (candidate.type === "hls" && window.Hls?.isSupported()) {
    const hls = new window.Hls(adaptiveHlsOptions(session.preview));
    session.hls = hls;
    if (session.preview) state.previewHls = hls; else state.hls = hls;
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      if (session.destroyed) return;
      session.media.play().catch(() => playbackStatus(session, "Pressione OK ou Play para iniciar.", "ready"));
    });
    hls.on(window.Hls.Events.LEVEL_SWITCHED, (_event, data) => {
      if (!session.preview) updatePlayerQuality(hls.levels?.[data.level]?.height || session.media.videoHeight);
    });
    if (window.Hls.Events.FRAG_BUFFERED) {
      hls.on(window.Hls.Events.FRAG_BUFFERED, () => { session.lastDataAt = Date.now(); });
    }
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal || session.destroyed) return;
      if (!candidate.direct && data.type === window.Hls.ErrorTypes.NETWORK_ERROR && session.networkRetries < 2) {
        session.networkRetries += 1;
        playbackStatus(session, "Reconectando sem trocar de rota…");
        setTimeout(() => hls.startLoad(), 700 * session.networkRetries);
        return;
      }
      if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && session.mediaRetries < 1) {
        session.mediaRetries += 1;
        hls.recoverMediaError();
        return;
      }
      advanceWebCandidate(session, hlsErrorMessage(data));
    });
    hls.loadSource(candidate.url);
    hls.attachMedia(session.media);
    return;
  }

  if (candidate.type === "mpegts" && window.mpegts?.isSupported?.()) {
    try {
      const player = window.mpegts.createPlayer({ type: "mpegts", isLive: true, url: candidate.url }, {
        enableWorker: true,
        enableStashBuffer: true,
        stashInitialSize: session.preview ? 3 * 1024 * 1024 : 8 * 1024 * 1024,
        lazyLoad: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 60,
        autoCleanupMinBackwardDuration: 20,
        liveBufferLatencyChasing: false,
        liveBufferLatencyMaxLatency: 15,
        liveBufferLatencyMinRemain: 3
      });
      session.mpegts = player;
      player.attachMediaElement(session.media);
      player.load();
      player.on(window.mpegts.Events.ERROR, () => {
        if (session.networkRetries < 2) {
          session.networkRetries += 1;
          retryWebCandidate(session, "O fluxo TS oscilou. Reconectando na mesma rota…", { preserveNetworkRetries: true });
          return;
        }
        advanceWebCandidate(session, "O fluxo TS não respondeu nesta rota.");
      });
      if (window.mpegts.Events.STATISTICS_INFO) {
        player.on(window.mpegts.Events.STATISTICS_INFO, (info) => {
          const totalFrames = Number(info?.decodedFrames);
          const frameDelta = Number(info?.decodedFramesDelta);
          if (Number.isFinite(totalFrames) && totalFrames >= 0 && totalFrames !== session.lastDecodedFrames) {
            session.lastDecodedFrames = totalFrames;
            markPlaybackProgress(session);
          } else if (Number.isFinite(frameDelta) && frameDelta > 0) {
            markPlaybackProgress(session);
          }
        });
      }
      Promise.resolve(player.play()).catch(() => playbackStatus(session, "Pressione OK ou Play para iniciar.", "ready"));
      return;
    } catch {
      advanceWebCandidate(session, "Este navegador não conseguiu preparar o fluxo MPEG-TS.");
      return;
    }
  }

  session.media.src = candidate.url;
  session.media.play().catch(() => playbackStatus(session, "Pressione OK ou Play para iniciar.", "ready"));
}

function startWebPlayback(media, item, { preview = false } = {}) {
  const slot = preview ? "webPreview" : "webPlayer";
  destroyWebPlayback(slot);
  const candidates = streamCandidates(item);
  const session = {
    media,
    item,
    preview,
    candidates,
    index: 0,
    hls: null,
    mpegts: null,
    listeners: [],
    destroyed: false,
    switching: false,
    lastProgressAt: Date.now(),
    lastTime: -1,
    started: false,
    starvedAt: 0,
    lastDataAt: Date.now(),
    networkRetries: 0,
    mediaRetries: 0,
    stallRetries: 0,
    routeRounds: 0
  };
  const listen = (name, handler) => { media.addEventListener(name, handler); session.listeners.push([name, handler]); };
  listen("playing", () => {
    session.started = true;
    markPlaybackProgress(session);
    if (!preview) hidePlayerStatus();
  });
  listen("canplay", () => markPlaybackProgress(session));
  listen("timeupdate", () => {
    if (Math.abs(media.currentTime - session.lastTime) < .08) return;
    session.lastTime = media.currentTime;
    markPlaybackProgress(session);
  });
  listen("progress", () => { session.lastDataAt = Date.now(); });
  listen("waiting", () => {
    if (!session.starvedAt) session.starvedAt = Date.now();
    playbackStatus(session, "Sinal oscilando. Aguardando o buffer…");
  });
  listen("stalled", () => {
    if (!session.starvedAt) session.starvedAt = Date.now();
    playbackStatus(session, "Sinal temporariamente sem dados…");
  });
  listen("error", () => advanceWebCandidate(session, "Este formato não abriu nesta rota."));
  session.watchdog = setInterval(() => {
    if (session.destroyed || session.switching || media.paused || document.hidden) return;
    const now = Date.now();
    const recentProgress = now - session.lastProgressAt <= 12_000;
    const haveFutureData = recentProgress && (Number(media.readyState) >= 3 || bufferedAhead(media) > 1.25);
    if (haveFutureData) {
      session.starvedAt = 0;
      return;
    }
    if (!session.starvedAt && now - session.lastProgressAt > 12_000) session.starvedAt = now;
    const starvationLimit = preview ? 45_000 : 60_000;
    if (!session.starvedAt || now - session.starvedAt <= starvationLimit) return;
    if (session.stallRetries < 1) {
      session.stallRetries += 1;
      retryWebCandidate(session, "O sinal ficou sem dados. Refazendo a conexão atual…");
      return;
    }
    session.stallRetries = 0;
    advanceWebCandidate(session, "A rota ficou sem dados. Tentando a alternativa…");
  }, 3000);
  state[slot] = session;
  startWebCandidate(session);
  return session;
}

function qualityLabel(height) {
  const pixels = Number(height || 0);
  if (pixels >= 2160) return "4K";
  if (pixels >= 1440) return "QHD";
  if (pixels >= 1080) return "Full HD";
  if (pixels >= 720) return "HD";
  return pixels ? `${pixels}p` : "Automática";
}

function updatePlayerQuality(height) {
  const detail = document.querySelector("#player-detail");
  if (!detail) return;
  const source = state.currentItem?.group || "Fonte conectada pelo usuário";
  detail.textContent = `${source} · ${qualityLabel(height)}`;
}

function requestPlayerFullscreen() {
  const shell = playerModal.querySelector(".player-shell");
  const request = shell?.requestFullscreen || shell?.webkitRequestFullscreen || video.webkitEnterFullscreen;
  if (!request) return;
  try {
    const target = shell?.requestFullscreen || shell?.webkitRequestFullscreen ? shell : video;
    Promise.resolve(request.call(target)).catch(() => {});
  } catch {}
}

function preparePlayerShell(item, { immersive = false, preserveFocus = false, statusText = "Abrindo o canal…" } = {}) {
  if (!preserveFocus) state.lastFocused = document.activeElement;
  state.currentItem = item;
  document.querySelector("#player-title").textContent = item?.name || "Reproduzindo";
  updatePlayerQuality(0);
  const playerDescription = document.querySelector("#player-description");
  if (playerDescription) {
    const epgDescription = item?.id ? state.epg.get(String(item.id))?.current?.description : "";
    playerDescription.textContent = item?.description || epgDescription || "";
    playerDescription.classList.toggle("hidden", !playerDescription.textContent);
  }
  playerModal.classList.toggle("player-modal-immersive", immersive);
  playerModal.classList.remove("hidden");
  video.controls = false;
  showPlayerStatus(statusText);
  if (immersive) requestPlayerFullscreen();
}

async function playStream(itemOrUrl, name = "Reproduzindo", streamType = "auto", options = {}) {
  const item = typeof itemOrUrl === "string" ? { playUrl: itemOrUrl, name, streamType } : itemOrUrl;
  if (!item?.playUrl) return;
  if (nativePlayerAvailable()) {
    state.currentItem = item;
    const { primary, fallback } = nativeStreamPair(item);
    try {
      window.GateNativePlayer.playFullscreen(primary.url, fallback?.url || "", item.name || name, primary.type || streamType || "auto");
      return;
    } catch {}
  }
  if (!options.reusePlayer) preparePlayerShell(item, options);
  else {
    state.currentItem = item;
    document.querySelector("#player-title").textContent = item.name || name;
    updatePlayerQuality(0);
    showPlayerStatus("Abrindo o vídeo…");
  }
  startWebPlayback(video, { ...item, streamType: item.streamType || streamType }, { preview: false });
}

function closePlayer() {
  destroyWebPlayback("webPlayer");
  playerModal.classList.add("hidden");
  playerModal.classList.remove("player-modal-immersive");
  hidePlayerStatus();
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
    try { document.webkitExitFullscreen(); } catch {}
  }
  state.lastFocused?.focus?.();
}

function stopLivePreview() {
  destroyWebPlayback("webPreview");
  if (nativePlayerAvailable()) {
    try { window.GateNativePlayer.close(); } catch {}
  }
}

function playLivePreview(item) {
  if (!item?.playUrl) return;
  state.selectedLive = item;
  main.querySelectorAll(".live-channel-row").forEach((row) => row.classList.toggle("active", row.dataset.liveSelect === String(item.id)));
  const preview = main.querySelector("#live-preview-video");
  const placeholder = main.querySelector(".preview-placeholder");
  const title = main.querySelector("[data-live-preview-name]");
  const group = main.querySelector(".live-channel-title small");
  if (!preview) return;
  if (title) title.textContent = item.name || "Canal";
  if (group) group.textContent = item.group || "TV ao vivo";
  placeholder?.classList.remove("visible");
  destroyWebPlayback("webPreview");
  if (!playNativePreview(item)) startWebPlayback(preview, item, { preview: true });
  updateLivePreviewEpg();
  const row = [...main.querySelectorAll("[data-live-select]")].find((node) => node.dataset.liveSelect === String(item.id));
  queueEpgForCards(row ? [row] : []);
}

function openLiveFullscreen() {
  const preview = main.querySelector("#live-preview-video");
  const stage = main.querySelector(".live-preview-stage");
  if (!preview || !state.selectedLive) return showToast("Escolha um canal primeiro.");
  if (nativePlayerAvailable()) {
    try { window.GateNativePlayer.fullscreen(); return; } catch {}
  }
  const request = stage?.requestFullscreen || stage?.webkitRequestFullscreen || preview.webkitEnterFullscreen;
  if (request) {
    try { request.call(stage?.requestFullscreen || stage?.webkitRequestFullscreen ? stage : preview); preview.play().catch(() => {}); return; } catch {}
  }
  stopLivePreview();
  playStream(state.selectedLive, "Reproduzindo", "auto", { immersive: true });
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

function deviceSnapshot() {
  return {
    version: APP_VERSION,
    savedAt: new Date().toISOString(),
    descriptor: state.connectionDescriptor,
    source: state.source,
    account: state.account,
    sessionId: state.sessionId,
    counts: state.counts,
    channels: state.channels,
    movies: state.movies,
    series: state.series
  };
}

function saveDeviceSnapshot() {
  if (!state.source) return Promise.resolve();
  return cacheWrite("session", deviceSnapshot());
}

async function restoreDeviceSnapshot() {
  const cached = await cacheRead("session");
  if (!cached?.source || !Array.isArray(cached.channels)) return false;
  state.source = cached.source;
  state.account = cached.account || null;
  state.sessionId = cached.sessionId || null;
  state.counts = cached.counts || {};
  state.channels = cached.channels || [];
  state.movies = cached.movies || [];
  state.series = cached.series || [];
  state.connectionDescriptor = cached.descriptor || null;
  state.loadedCatalogs = new Set([
    ...(state.movies.length ? ["movies"] : []),
    ...(state.series.length ? ["series"] : [])
  ]);
  if (location.pathname === "/") renderHome(); else route();
  return true;
}

async function reconnectSavedSource() {
  const descriptor = state.connectionDescriptor;
  if (!descriptor?.type) return;
  try {
    let payload;
    if (descriptor.type === "xtream") {
      payload = await api("/api/xtream/connect", { method: "POST", body: JSON.stringify({ serverUrl: descriptor.serverUrl, username: descriptor.username, password: descriptor.password }) });
    } else if (descriptor.type === "m3u-url") {
      payload = await api("/api/m3u/parse", { method: "POST", body: JSON.stringify({ url: descriptor.url }) });
    } else if (descriptor.type === "m3u-file" && Array.isArray(descriptor.items)) {
      const prepared = await api("/api/streams/register", { method: "POST", body: JSON.stringify({ items: descriptor.items }) });
      payload = { source: "m3u-file", channels: prepared.items, counts: { live: prepared.items.length } };
    }
    if (payload) afterConnected(payload, descriptor, { silent: true, preserveCatalogs: true });
  } catch {
    showToast("A lista salva foi mantida. A atualização automática será tentada novamente na próxima abertura.", 5200);
  }
}

function afterConnected(payload, descriptor = state.connectionDescriptor, options = {}) {
  const previousMovies = state.movies;
  const previousSeries = state.series;
  state.source = payload.source;
  state.account = payload.account || null;
  state.sessionId = payload.sessionId || null;
  state.counts = payload.counts || { live: payload.channels?.length || 0, movies: payload.movies?.length || 0, series: payload.series?.length || 0 };
  state.channels = payload.channels || [];
  state.movies = payload.movies?.length ? payload.movies : options.preserveCatalogs ? previousMovies : [];
  state.series = payload.series?.length ? payload.series : options.preserveCatalogs ? previousSeries : [];
  state.episodes = [];
  state.loadedCatalogs = new Set();
  state.catalogPromises = new Map();
  state.catalogErrors = new Map();
  state.detailsInfoCache = new Map();
  state.epg = new Map();
  state.epgPending = new Set();
  state.selectedLive = null;
  state.connectionDescriptor = descriptor || null;
  if (payload.movies?.length) state.loadedCatalogs.add("movies");
  if (payload.series?.length) state.loadedCatalogs.add("series");
  localStorage.setItem("gate.lastSource", JSON.stringify({ type: state.source, connectedAt: new Date().toISOString(), counts: state.counts, expiresAt: state.account?.expiresAt || null }));
  closeSource();
  history.replaceState({}, "", "/");
  state.filter = { query: "", group: "Todos" };
  state.visibleCount = state.pageSize;
  renderHome();
  saveDeviceSnapshot();
  if (!options.silent) showToast(`Lista conectada e salva neste aparelho. Validade: ${formatExpiryDate(state.account?.expiresAt)}.`);
}

function bindForms() {
  document.querySelector("#xtream-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setSourceStatus("Autenticando e organizando os canais…");
    setFormBusy(form, true, "Carregando canais…");
    try {
      const credentials = normalizeXtreamForm(form);
      afterConnected(await api("/api/xtream/connect", { method: "POST", body: JSON.stringify(credentials) }), { type: "xtream", ...credentials });
    }
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
        afterConnected({ source: "m3u-file", channels: prepared.items, counts: { live: prepared.items.length } }, { type: "m3u-file", items: localItems });
      } else {
        afterConnected(await api("/api/m3u/parse", { method: "POST", body: JSON.stringify({ url }) }), { type: "m3u-url", url });
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
  main.querySelector("[data-action=toggle-live-favorite]")?.addEventListener("click", () => state.selectedLive && toggleFavorite(state.selectedLive, "live"));
  main.querySelectorAll("[data-live-select]:not([data-action-bound])").forEach((button) => {
    button.dataset.actionBound = "true";
    button.addEventListener("click", () => {
      const item = state.channels.find((channel) => String(channel.id) === button.dataset.liveSelect);
      if (!item) return;
      if (!allowActivation(`live:${item.id}`)) return;
      if (String(state.selectedLive?.id || "") === String(item.id || "")) openLiveFullscreen();
      else playLivePreview(item);
    });
  });
  main.querySelector(".live-preview-stage")?.addEventListener("click", () => state.selectedLive && openLiveFullscreen());
  main.querySelectorAll(".media-card:not([data-action-bound])").forEach((button) => {
    button.dataset.actionBound = "true";
    button.querySelector(".card-artwork")?.addEventListener("error", () => button.classList.add("cover-missing"), { once: true });
    button.addEventListener("click", () => {
      const kind = button.dataset.itemKind || state.view;
      const item = currentItems(kind).find((entry) => String(entry.id || entry.seriesId || "") === String(button.dataset.itemId || button.dataset.seriesId || "")) || {
        id: button.dataset.itemId,
        seriesId: button.dataset.seriesId,
        sessionId: button.dataset.sessionId,
        playUrl: button.dataset.playUrl,
        name: button.dataset.playName,
        group: button.querySelector("small")?.textContent,
        description: button.dataset.description,
        streamType: button.dataset.streamType || "auto"
      };
      if (!allowActivation(`${kind}:${item.id || item.seriesId || item.name}`)) return;
      if (kind === "live") {
        state.filter = { query: "", group: "Todos" };
        state.visibleCount = Math.max(60, state.pageSize);
        state.selectedLive = item;
        renderLiveCatalog();
        setTimeout(() => playLivePreview(item), 0);
      } else if (kind === "movies" || kind === "series") openDetails(item, kind);
      else if (item.seriesId) openDetails(item, "series");
      else if (item.playUrl) playStream(item);
    });
  });
  main.querySelector("[data-action=back-series]")?.addEventListener("click", () => renderCatalog("series"));
}

function setupTvEnvironment() {
  const ua = navigator.userAgent || "";
  const requestedPlatform = new URLSearchParams(location.search).get("platform") || "";
  const androidWrapper = /^android(?:tv)?$/i.test(requestedPlatform) || /GATE-IPTV-PLAYER\/\d/i.test(ua);
  const tv = requestedPlatform.toLowerCase() === "androidtv" || /Tizen|Web0S|WebOS|NetCast|SMART-TV|SmartTV|Android TV|AFT|BRAVIA/i.test(ua);
  const touch = navigator.maxTouchPoints > 0 || (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches);
  document.body.classList.toggle("tv-optimized", tv);
  document.body.classList.toggle("browser-mode", !tv);
  document.body.classList.toggle("android-wrapper", androidWrapper);
  document.body.classList.toggle("native-player", nativePlayerAvailable());
  document.body.classList.toggle("touch-mode", Boolean(touch));
  document.documentElement.dataset.platform = tv ? "tv" : androidWrapper ? "android-app" : "browser";
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
function activeFocusScope() {
  if (!playerModal.classList.contains("hidden")) return playerModal;
  if (!detailsModal.classList.contains("hidden")) return detailsModal;
  if (!sourceModal.classList.contains("hidden")) return sourceModal;
  return document;
}
function refreshFocusable() { focusables = [...activeFocusScope().querySelectorAll("[data-focusable]:not(.hidden):not([disabled])")].filter((element) => element.offsetParent !== null); }
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
    const crossOverlap = direction === "left" || direction === "right"
      ? Math.max(0, Math.min(current.bottom, box.bottom) - Math.max(current.top, box.top))
      : Math.max(0, Math.min(current.right, box.right) - Math.max(current.left, box.left));
    return { element, score: primary + secondary * (crossOverlap > 0 ? 1.35 : 4.2) };
  }).filter(Boolean).sort((a, b) => a.score - b.score);
  candidates[0]?.element.focus();
  candidates[0]?.element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
}

function toggleFocusedFavorite() {
  if (!detailsModal.classList.contains("hidden") && state.detailsItem) return toggleFavorite(state.detailsItem, state.detailsKind);
  const active = document.activeElement;
  if (active?.dataset?.liveSelect) {
    const item = state.channels.find((channel) => String(channel.id) === String(active.dataset.liveSelect));
    if (item) return toggleFavorite(item, "live");
  }
  const card = active?.closest?.(".media-card[data-item-kind]");
  if (card) {
    const kind = card.dataset.itemKind;
    const item = currentItems(kind).find((entry) => String(entry.id || entry.seriesId || "") === String(card.dataset.itemId || card.dataset.seriesId || ""));
    if (item) return toggleFavorite(item, kind);
  }
  if (state.selectedLive) return toggleFavorite(state.selectedLive, "live");
  return false;
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
video.addEventListener("loadedmetadata", () => updatePlayerQuality(video.videoHeight));
video.addEventListener("waiting", () => showPlayerStatus("Carregando o sinal…"));
video.addEventListener("stalled", () => showPlayerStatus("Sinal instável. Reconectando…"));
video.addEventListener("click", () => { if (!playerModal.classList.contains("hidden")) video.paused ? video.play().catch(() => {}) : video.pause(); });
retryButton.addEventListener("click", () => state.currentItem && playStream(state.currentItem));

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-link]");
  if (link) { event.preventDefault(); navigate(link.getAttribute("href")); }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "open-source" && !event.target.closest("main")) openSource("xtream");
  if (action === "open-live") state.channels.length ? ensureCatalog("live") : openSource("xtream");
  if (action === "open-movies") state.source ? ensureCatalog("movies") : openSource("xtream");
  if (action === "open-series") state.source ? ensureCatalog("series") : openSource("xtream");
  if (action === "open-favorites") state.source ? renderFavorites() : openSource("xtream");
  if (action === "go-home") renderHome();
  if (action === "live-fullscreen") openLiveFullscreen();
  if (action === "toggle-adfree") navigate("/renovar");
});
document.querySelectorAll("[data-source-tab]").forEach((tab) => tab.addEventListener("click", () => selectSourceTab(tab.dataset.sourceTab)));
document.querySelector(".close-modal").addEventListener("click", closeSource);
document.querySelector(".player-close").addEventListener("click", closePlayer);
document.querySelector("#details-close").addEventListener("click", () => closeDetails());
document.querySelector("#details-cancel").addEventListener("click", () => closeDetails());
detailsPrimary.addEventListener("click", confirmDetails);
detailsFavorite.addEventListener("click", () => state.detailsItem && toggleFavorite(state.detailsItem, state.detailsKind));
detailsPoster.addEventListener("error", () => {
  detailsPoster.classList.add("fallback");
  detailsPoster.src = "/gate-icon.svg";
  detailsBackdrop.style.backgroundImage = "none";
});
window.addEventListener("popstate", route);
document.addEventListener("keydown", (event) => {
  const code = Number(event.keyCode || event.which || 0);
  const backPressed = [4, 27, 461, 10009].includes(code) || event.key === "Escape" || event.key === "BrowserBack";
  const playPausePressed = [13, 19, 415, 10252].includes(code) || event.key === "Enter" || event.key === " ";
  const favoritePressed = [184, 404].includes(code) || event.key?.toLowerCase?.() === "f";
  const playerOpen = !playerModal.classList.contains("hidden");
  if (playerOpen) {
    if (backPressed || event.key === "Backspace") { event.preventDefault(); closePlayer(); return; }
    if (playPausePressed) { event.preventDefault(); video.paused ? video.play() : video.pause(); return; }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.currentTime + (event.key === "ArrowLeft" ? -10 : 10)); return; }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); video.volume = Math.min(1, Math.max(0, video.volume + (event.key === "ArrowUp" ? .1 : -.1))); return; }
  }
  const detailsOpen = !detailsModal.classList.contains("hidden");
  if (detailsOpen && (backPressed || event.key === "Backspace")) {
    event.preventDefault();
    closeDetails();
    return;
  }
  if (favoritePressed) { event.preventDefault(); toggleFocusedFavorite(); return; }
  const editable = event.target?.matches?.("input, textarea, select, [contenteditable='true']");
  if (editable) {
    if (document.body.classList.contains("tv-optimized") && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      moveFocus(event.key === "ArrowUp" ? "up" : "down");
    }
    return;
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
  const card = event.target.closest?.(".catalog-grid .media-card, .live-channel-row");
  if (!card) return;
  const cards = [...main.querySelectorAll(state.view === "live" ? ".live-channel-row" : ".catalog-grid .media-card")];
  if (card.dataset.liveId) {
    const index = cards.indexOf(card);
    queueEpgForCards(cards.slice(Math.max(0, index - 1), index + 6));
  }
  if (cards.indexOf(card) < Math.max(0, cards.length - 10)) return;
  const sentinel = main.querySelector("[data-auto-load]");
  if (sentinel) appendNextCatalogPage(sentinel.dataset.kind, sentinel.dataset.heading || "");
});
window.addEventListener("scroll", () => {
  syncNativePreviewBounds();
  const sentinel = main.querySelector("[data-auto-load]");
  if (!sentinel || sentinel.getBoundingClientRect().top > innerHeight + 520) return;
  appendNextCatalogPage(sentinel.dataset.kind, sentinel.dataset.heading || "");
}, { passive: true });
window.addEventListener("resize", () => requestAnimationFrame(syncNativePreviewBounds));

async function boot() {
  setupTvEnvironment();
  try { state.config = await api("/api/config"); } catch {}
  bindForms();
  const restored = await restoreDeviceSnapshot();
  if (!restored) route();
  showAd();
  if (restored) reconnectSavedSource();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}
boot();
