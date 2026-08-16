const APP_VERSION = "0.6.2";
const CACHE_DB = "gate-player-cache-v1";
const CACHE_STORE = "device";
const FAVORITES_KEY = "gate.favorites.v1";
const IMA_SDK_URL = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";
const TV_STREAM_BUFFER = Object.freeze({
  back: 18,
  target: 30,
  maximum: 60,
  startup: 4,
  resume: 8
});
const WEB_STREAM_BUFFER = Object.freeze({
  back: 30,
  target: 45,
  maximum: 90,
  startup: 5,
  resume: 10
});
const catalogGroupCache = new WeakMap();
const catalogSearchCache = new WeakMap();

function readJsonStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "") ?? fallback; }
  catch { return fallback; }
}

const state = {
  config: {
    annualPrice: 30,
    adDurationSeconds: 10,
    paymentAvailable: false,
    ads: { enabled: false, mode: "house", fallback: "house", houseAd: { enabled: true, durationSeconds: 10 } }
  },
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
  pairing: null,
  favorites: new Set(readJsonStorage(FAVORITES_KEY, [])),
  activation: { key: "", at: 0 },
  adFree: localStorage.getItem("gate.adFree") === "true"
};

const main = document.querySelector("#main-content");
const sourceModal = document.querySelector("#source-modal");
const pairingModal = document.querySelector("#pairing-modal");
const tvSettingsModal = document.querySelector("#tv-settings-modal");
const playerModal = document.querySelector("#player-modal");
const detailsModal = document.querySelector("#details-modal");
const detailsPoster = document.querySelector("#details-poster");
const detailsBackdrop = document.querySelector("#details-backdrop");
const detailsPrimary = document.querySelector("#details-primary");
const detailsFavorite = document.querySelector("#details-favorite");
const sourceStatus = document.querySelector("#source-status");
let video = document.querySelector("#video-player");
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
    refresh: '<path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"/>',
    qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v4h-2zM14 18h4v2h-4z"/>'
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
    <div class="topbar-start">
      <button class="top-brand focusable" data-action="go-home" data-focusable><img src="/gate-icon.svg" alt=""><span><strong>GATE</strong><small>IPTV PLAYER</small></span></button>
      <div class="web-top-context"><small>GATE PLAYER</small><strong>${state.view === "home" ? "Visão geral" : escapeHtml(titleFor(state.view))}</strong></div>
    </div>
    <div class="top-actions">${connected}${expiry}<button class="round-action focusable" data-action="open-pairing" data-focusable aria-label="Conectar por QR">${gateIcon("qr")}</button>${state.source ? `<button class="round-action focusable" data-action="open-favorites" data-focusable aria-label="Favoritos">${gateIcon("favorite")}</button>` : ""}<button class="round-action focusable" data-action="open-source" data-focusable aria-label="Trocar lista">${gateIcon("settings")}</button></div>
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
  document.body.classList.remove("pairing-page");
  document.title = "GATE IPTV PLAYER";
  const browserExperience = document.body.classList.contains("browser-mode");
  if (state.source) {
    main.innerHTML = `${topbar()}
      ${browserExperience ? `<section class="web-welcome"><div><p class="eyebrow">SUA BIBLIOTECA</p><h1>Tudo pronto para assistir.</h1><p>Escolha uma categoria ou conecte uma nova fonte pelo celular.</p></div><button class="web-inline-action focusable" data-action="open-pairing" data-focusable>${gateIcon("qr")}<span><small>CONEXÃO RÁPIDA</small><strong>Adicionar por QR Code</strong></span><b>›</b></button></section>` : '<section class="tv-home-head"><div><p class="eyebrow">CONTEÚDO DA SUA LISTA</p><h1>O que você quer assistir?</h1></div></section>'}
      ${renderConnectedSummary()}`;
    bindDynamicActions();
    refreshFocusable();
    queueEpgForCards();
    return;
  }
  main.innerHTML = browserExperience ? `${topbar()}${renderBrowserWelcome()}` : `${topbar()}
      <section class="hero">
        <div class="hero-content">
          <p class="eyebrow">SIMPLES. RÁPIDO. NA SUA TV.</p>
          <h1>Todo o seu conteúdo<br>em uma única tela.</h1>
          <p>Conecte uma fonte autorizada por Xtream Codes, M3U/M3U8, arquivo local ou link direto e navegue pelo controle remoto.</p>
          <div class="button-row">
            <button class="primary-button focusable" data-action="open-pairing" data-focusable>${gateIcon("qr")} Conectar pelo celular</button>
            <button class="secondary-button focusable" data-action="open-source" data-focusable>Digitar na TV</button>
            <a class="ghost-link focusable" href="/assinar" data-link data-focusable>Conhecer o GATE Premium</a>
          </div>
        </div>
      </section>
      ${renderConnectOptions()}`;
  bindDynamicActions();
  refreshFocusable();
}

function renderBrowserWelcome() {
  return `<section class="web-landing">
    <div class="web-landing-copy">
      <span class="web-kicker"><i></i> PLAYER PARA TODAS AS SUAS TELAS</span>
      <h1>Sua programação.<br><em>Do seu jeito.</em></h1>
      <p>Conecte sua fonte autorizada em segundos e assista na Web, Android TV, LG webOS ou Samsung Tizen com uma experiência simples e segura.</p>
      <div class="web-landing-actions">
        <button class="primary-button focusable" data-action="open-pairing" data-focusable>${gateIcon("qr")} Conectar pelo celular</button>
        <button class="secondary-button focusable" data-action="open-source" data-focusable>Inserir dados manualmente</button>
      </div>
      <div class="web-trust-list"><span>✓ Sem conteúdo incluso</span><span>✓ Dados temporários</span><span>✓ Feito para Smart TV</span></div>
    </div>
    <div class="web-product-preview" aria-hidden="true">
      <div class="preview-glow"></div>
      <div class="preview-window">
        <div class="preview-toolbar"><span><i></i><i></i><i></i></span><small>GATE PLAYER</small><b>AO VIVO</b></div>
        <div class="preview-feature"><span>AGORA NO GATE</span><strong>Todo o seu conteúdo<br>em um só lugar.</strong><small>Rápido, organizado e pronto para assistir.</small><i>${gateIcon("play")}</i></div>
        <div class="preview-rail"><span class="cyan">${gateIcon("live")}<b>TV</b></span><span class="coral">${gateIcon("movies")}<b>Filmes</b></span><span class="violet">${gateIcon("series")}<b>Séries</b></span></div>
      </div>
      <div class="preview-float-card"><span>${gateIcon("qr")}</span><div><small>CONECTE SEM DIGITAR</small><strong>Leia o QR com o celular</strong></div><b>›</b></div>
    </div>
  </section>
  <section class="web-onboarding">
    <div class="web-section-heading"><div><p class="eyebrow">COMECE EM SEGUNDOS</p><h2>Três passos. Nenhuma complicação.</h2></div><a class="web-premium-link focusable" href="/assinar" data-link data-focusable>Conhecer o Premium <span>›</span></a></div>
    <div class="web-step-grid">
      <button class="web-step-card focusable" data-action="open-pairing" data-focusable><span class="step-number">01</span><i>${gateIcon("qr")}</i><div><strong>Leia o QR Code</strong><small>Use a câmera do celular para abrir a conexão segura.</small></div></button>
      <button class="web-step-card focusable" data-action="open-source" data-focusable><span class="step-number">02</span><i>${gateIcon("settings")}</i><div><strong>Informe sua fonte</strong><small>Xtream, M3U, Portal ou um link direto autorizado.</small></div></button>
      <button class="web-step-card focusable" data-action="open-pairing" data-focusable><span class="step-number">03</span><i>${gateIcon("play")}</i><div><strong>Escolha e assista</strong><small>Sua biblioteca aparece organizada automaticamente.</small></div></button>
    </div>
  </section>
  <section class="web-compatibility"><span>COMPATÍVEL COM</span><b>Xtream Codes</b><b>M3U / M3U8</b><b>Portal / MAC</b><b>HLS</b><b>MPEG-TS</b><small>O GATE é somente um player e não fornece canais ou listas.</small></section>`;
}

function renderConnectOptions() {
  return `<div class="section-head"><h2>Formas de conectar</h2><span>Use apenas conteúdo autorizado</span></div>
    <section class="format-grid">
      <button class="format-card featured-format focusable" data-action="open-pairing" data-focusable><span class="format-icon">${gateIcon("qr")}</span><strong>QR Code</strong><small>Mais rápido: use o celular</small><b>RECOMENDADO</b></button>
      <button class="format-card focusable" data-action="open-source" data-tab="xtream" data-focusable><span class="format-icon">◈</span><strong>Xtream Codes</strong><small>Servidor, usuário e senha</small></button>
      <button class="format-card focusable" data-action="open-source" data-tab="m3u" data-focusable><span class="format-icon">≡</span><strong>M3U / M3U8</strong><small>Link remoto ou arquivo local</small></button>
      <button class="format-card focusable" data-action="open-source" data-tab="portal" data-focusable><span class="format-icon">⌁</span><strong>Portal / MAC</strong><small>Validação para portais compatíveis</small></button>
      <button class="format-card focusable" data-action="open-source" data-tab="direct" data-focusable><span class="format-icon">▶</span><strong>HLS e link direto</strong><small>M3U8, MP4 e MPEG-TS</small></button>
    </section>
    <div class="section-head"><h2>Pronto para começar</h2></div><div class="empty-state">Nenhuma fonte conectada. Seus dados de acesso não são salvos permanentemente no servidor.</div>`;
}

function renderConnectedSummary() {
  const live = Number(state.counts.live ?? state.channels.length);
  const annualPrice = Math.max(0, Number(state.config?.annualPrice || 30)).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const rawStatus = String(state.account?.status || "Ativa").toLowerCase();
  const status = rawStatus === "active" ? "Ativa" : rawStatus === "expired" ? "Expirada" : state.account?.status || "Ativa";
  const expires = formatExpiryDate(state.account?.expiresAt);
  const catalogLabel = (kind, singular) => {
    if (state.catalogErrors.has(kind)) return "Não foi possível carregar · pressione OK";
    const total = Number(state.counts[kind] ?? state[kind].length);
    if (!state.loadedCatalogs.has(kind) && state.sessionId && !total) return `Abrir catálogo de ${singular.toLowerCase()}s`;
    return `${total.toLocaleString("pt-BR")} ${singular.toLowerCase()}${total === 1 ? "" : "s"}`;
  };
  const account = `<section class="account-strip">
      <span class="account-dot" aria-hidden="true"></span>
      <span><small>STATUS DA LISTA</small><strong>${escapeHtml(status)}</strong></span>
      <span class="account-expiry"><small>DATA DE EXPIRAÇÃO</small><strong>${escapeHtml(expires)}</strong></span>
    </section>`;
  const launchers = `<section class="library-launchers simple-launchers">
      <button class="library-launch focusable live-launch" data-action="open-live" data-focusable><span class="launcher-icon">${gateIcon("live")}</span><span><strong>TV ao vivo</strong><small>${live.toLocaleString("pt-BR")} canais</small></span><b>›</b></button>
      <button class="library-launch focusable movies-launch" data-action="open-movies" data-focusable><span class="launcher-icon">${gateIcon("movies")}</span><span><strong>Filmes</strong><small>${escapeHtml(catalogLabel("movies", "filme"))}</small></span><b>›</b></button>
      <button class="library-launch focusable series-launch" data-action="open-series" data-focusable><span class="launcher-icon">${gateIcon("series")}</span><span><strong>Séries</strong><small>${escapeHtml(catalogLabel("series", "série"))}</small></span><b>›</b></button>
      <button class="library-launch focusable favorites-launch" data-action="open-favorites" data-focusable><span class="launcher-icon">${gateIcon("favorite")}</span><span><strong>Favoritos</strong><small>${state.favorites.size.toLocaleString("pt-BR")} ${state.favorites.size === 1 ? "item salvo" : "itens salvos"}</small></span><b>›</b></button>
    </section>`;
  if (!document.body.classList.contains("browser-mode")) return `${account}${launchers}`;
  return `<section class="web-dashboard-grid">
    <div class="web-library-area">
      <div class="web-section-heading compact"><div><p class="eyebrow">EXPLORAR</p><h2>O que você quer assistir?</h2></div><span>${(live + Number(state.counts.movies || 0) + Number(state.counts.series || 0)).toLocaleString("pt-BR")} itens disponíveis</span></div>
      ${launchers}
    </div>
    <aside class="web-side-panel">
      <div class="web-side-heading"><span>MINHA CONTA</span><i>SEGURO</i></div>
      ${account}
      <button class="web-side-action focusable" data-action="open-pairing" data-focusable><span class="side-action-icon">${gateIcon("qr")}</span><span><small>USE O CELULAR</small><strong>Conectar outra lista</strong><em>Gere um código temporário e evite digitar na TV.</em></span><b>›</b></button>
      <a class="web-premium-card focusable" href="/assinar" data-link data-focusable><span><small>GATE PREMIUM</small><strong>Assista sem anúncio inicial</strong><em>Plano anual por R$ ${escapeHtml(annualPrice)}</em></span><b>Conhecer <i>›</i></b></a>
      <p class="web-security-note">Seus dados de acesso são entregues somente a este aparelho.</p>
    </aside>
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
      <video id="live-preview-video" playsinline muted autoplay></video>
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
  document.body.classList.remove("pairing-page");
  document.title = "GATE Premium · Assinatura anual";
  const deviceId = getDeviceId();
  const annualPrice = Math.max(0, Number(state.config?.annualPrice || 30));
  const annualPriceLabel = annualPrice.toLocaleString("pt-BR", { minimumFractionDigits: annualPrice % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const monthlyPriceLabel = (annualPrice / 12).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const paymentAvailable = state.config?.paymentAvailable === true || state.config?.billing?.checkoutAvailable === true;
  main.innerHTML = `${topbar()}
    <section class="premium-hero">
      <div><span class="premium-badge">GATE PREMIUM</span><p class="eyebrow">12 MESES NESTE APARELHO</p><h1>Abra o GATE.<br>Vá direto ao que importa.</h1><p>Remova a publicidade inicial e mantenha a experiência mais limpa em todas as versões do player.</p><div class="premium-guarantees"><span>✓ Pagamento único</span><span>✓ Sem renovação automática</span><span>✓ Não inclui conteúdo</span></div></div>
      <div class="premium-price"><small>PLANO ANUAL</small><strong><sup>R$</sup> ${escapeHtml(annualPriceLabel)}</strong><span>equivale a R$ ${escapeHtml(monthlyPriceLabel)}/mês</span><em>12 meses de licença</em></div>
    </section>
    <section class="premium-layout">
      <div class="premium-benefits">
        <div class="premium-section-heading"><p class="eyebrow">O QUE VOCÊ RECEBE</p><h2>Uma experiência mais direta.</h2></div>
        <article><span>✓</span><div><strong>Sem anúncio inicial</strong><p>Abra o GATE e vá direto para sua biblioteca.</p></div></article>
        <article><span>✓</span><div><strong>Licença do aparelho</strong><p>Ativação vinculada ao ID seguro desta instalação.</p></div></article>
        <article><span>✓</span><div><strong>Todos os motores</strong><p>Web, Android TV, LG webOS e Samsung Tizen.</p></div></article>
        <article><span>✓</span><div><strong>12 meses de acesso</strong><p>Pagamento único e sem renovação automática.</p></div></article>
      </div>
      ${paymentAvailable ? `<form class="subscription-card" id="subscription-form">
        <p class="eyebrow">FINALIZAR ASSINATURA</p>
        <h2>Assinar neste aparelho</h2>
        <label>Seu e-mail<input class="focusable" data-focusable name="email" type="email" inputmode="email" autocomplete="email" placeholder="voce@exemplo.com"></label>
        <label>Nome do aparelho (opcional)<input class="focusable" data-focusable name="deviceName" placeholder="Ex.: TV da sala"></label>
        <input type="hidden" name="deviceId" value="${escapeHtml(deviceId)}">
        <div class="device-license"><span>ID DO APARELHO</span><strong>${escapeHtml(deviceId)}</strong></div>
        <button class="primary-button focusable" data-focusable type="submit">Continuar para o pagamento seguro</button>
        <div id="subscription-result" aria-live="polite"></div>
        <p class="legal-note">A assinatura é somente do player GATE. Não inclui canais, listas, filmes, séries ou conteúdo de terceiros.</p>
      </form>` : `<aside class="subscription-card payment-unavailable" data-payment-unavailable>
        <p class="eyebrow">PAGAMENTO EM CONFIGURAÇÃO</p>
        <h2>A assinatura ainda não está disponível.</h2>
        <p>A cobrança segura está sendo preparada. Nenhum pagamento será solicitado e nenhuma ativação foi realizada.</p>
        <div class="device-license"><span>ID DESTE APARELHO</span><strong>${escapeHtml(deviceId)}</strong></div>
        <a class="secondary-button focusable" href="/" data-link data-focusable>Voltar ao GATE TV</a>
      </aside>`}
    </section>`;
  bindSubscriptionForm();
}

function route() {
  document.body.classList.toggle("pairing-page", location.pathname === "/pair");
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.getAttribute("href") === location.pathname));
  if (location.pathname === "/pair") renderPairingPortal();
  else if (["/assinar", "/renovar"].includes(location.pathname)) renderRenew();
  else if (location.pathname.startsWith("/payment/")) renderPaymentReturn(location.pathname.split("/").slice(-1)[0]);
  else { document.body.classList.remove("pairing-page"); renderHome(); }
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

function trustedQrDataUrl(value) {
  const dataUrl = String(value || "");
  return /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl) ? dataUrl : "";
}

function clearPairingSession() {
  stopPairingTimers(state.pairing);
  state.pairing = null;
}

function stopPairingTimers(pairing) {
  if (!pairing) return;
  if (pairing.pollTimer) clearInterval(pairing.pollTimer);
  if (pairing.countdownTimer) clearInterval(pairing.countdownTimer);
  pairing.pollTimer = null;
  pairing.countdownTimer = null;
}

function closePairing() {
  clearPairingSession();
  pairingModal.classList.add("hidden");
}

function updatePairingCountdown() {
  if (!state.pairing) return;
  const status = document.querySelector("#pairing-status");
  const seconds = Math.max(0, Math.ceil((new Date(state.pairing.expiresAt).getTime() - Date.now()) / 1000));
  if (!seconds) {
    status.textContent = "Código expirado. Gere um novo para continuar.";
    status.classList.add("error");
    stopPairingTimers(state.pairing);
    return;
  }
  if (state.pairing.status === "pending") status.textContent = `Aguardando o celular · expira em ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function connectPairedDescriptor(descriptor) {
  if (descriptor.type === "xtream") {
    const credentials = {
      serverUrl: descriptor.serverUrl,
      username: descriptor.username,
      password: descriptor.password
    };
    const payload = await api("/api/xtream/connect", { method: "POST", body: JSON.stringify(credentials) });
    closePairing();
    afterConnected(payload, { type: "xtream", ...credentials });
    return;
  }
  if (descriptor.type === "m3u") {
    const payload = await api("/api/m3u/parse", { method: "POST", body: JSON.stringify({ url: descriptor.url }) });
    closePairing();
    afterConnected(payload, { type: "m3u-url", url: descriptor.url });
    return;
  }
  throw new Error("O celular enviou um formato de lista não reconhecido.");
}

async function pollPairingSession() {
  const pairing = state.pairing;
  if (!pairing || pairing.consuming) return;
  try {
    const status = await api(`/api/pairing/${encodeURIComponent(pairing.code)}`);
    if (state.pairing !== pairing) return;
    pairing.status = status.status;
    if (status.status === "pending") return updatePairingCountdown();
    if (status.status === "expired") {
      document.querySelector("#pairing-status").textContent = "Código expirado. Gere um novo para continuar.";
      return;
    }
    if (status.status !== "ready") return;
    pairing.consuming = true;
    const statusElement = document.querySelector("#pairing-status");
    statusElement.textContent = "Lista recebida. Validando e organizando seus canais…";
    statusElement.classList.add("success");
    const consumed = await api(`/api/pairing/${encodeURIComponent(pairing.code)}/consume`, {
      method: "POST",
      headers: { authorization: `Bearer ${pairing.deviceToken}` },
      body: "{}"
    });
    await connectPairedDescriptor(consumed.descriptor);
  } catch (error) {
    if (state.pairing !== pairing) return;
    pairing.consuming = false;
    const statusElement = document.querySelector("#pairing-status");
    statusElement.textContent = error.message;
    statusElement.classList.add("error");
  }
}

async function startPairing() {
  clearPairingSession();
  pairingModal.classList.remove("hidden");
  const qr = document.querySelector("#pairing-qr");
  const loader = document.querySelector("#pairing-qr-loading");
  const code = document.querySelector("#pairing-code");
  const status = document.querySelector("#pairing-status");
  qr.removeAttribute("src");
  qr.classList.remove("ready");
  loader.innerHTML = "<i></i><span>Gerando código seguro…</span>";
  loader.classList.remove("hidden");
  code.textContent = "••••-••••";
  status.className = "pairing-status";
  status.textContent = "Preparando conexão segura…";
  try {
    const payload = await api("/api/pairing/sessions", { method: "POST", body: JSON.stringify({ deviceId: getDeviceId() }) });
    state.pairing = { ...payload, status: "pending", consuming: false, pollTimer: null, countdownTimer: null };
    code.textContent = payload.code;
    qr.onload = () => { qr.classList.add("ready"); loader.classList.add("hidden"); };
    qr.onerror = () => { loader.innerHTML = "<span>Use o código ao lado em outro aparelho.</span>"; };
    const qrDataUrl = trustedQrDataUrl(payload.qrDataUrl);
    if (!qrDataUrl) throw new Error("O servidor não retornou um QR Code local válido.");
    qr.src = qrDataUrl;
    updatePairingCountdown();
    state.pairing.pollTimer = setInterval(pollPairingSession, 1_750);
    state.pairing.countdownTimer = setInterval(updatePairingCountdown, 1_000);
  } catch (error) {
    loader.classList.add("hidden");
    status.textContent = error.message;
    status.classList.add("error");
  }
}

function normalizePairCode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return compact.length > 4 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

function renderPairingPortal() {
  stopLivePreview();
  state.view = "pair";
  document.body.classList.add("pairing-page");
  const initialCode = normalizePairCode(new URLSearchParams(location.search).get("code") || "");
  main.innerHTML = `<section class="pair-portal">
    <header class="pair-page-header"><a class="pair-brand focusable" href="/" data-link data-focusable><img src="/gate-icon.svg" alt=""><span><strong>GATE</strong><small>CONEXÃO SEGURA</small></span></a><a class="pair-back-link focusable" href="/" data-link data-focusable>${gateIcon("back")} Voltar ao player</a></header>
    <div class="pair-portal-card">
      <div class="pair-copy"><p class="eyebrow">CONECTAR À TV</p><h1>Envie sua lista<br>sem digitar no controle.</h1><p>O código é temporário e os dados são entregues uma única vez à TV que o gerou.</p><div class="pair-confidence"><span>${gateIcon("qr")}<b>1. Leia o código</b></span><i></i><span>${gateIcon("settings")}<b>2. Informe a fonte</b></span><i></i><span>${gateIcon("play")}<b>3. Assista na TV</b></span></div><small class="pair-security">CONEXÃO TEMPORÁRIA E PROTEGIDA</small></div>
      <form id="pair-portal-form" class="pair-form">
        <div class="pair-form-heading"><span>PASSO 2 DE 3</span><h2>Conectar sua fonte</h2><p>Use somente uma lista que você tenha autorização para acessar.</p></div>
        <label>Código exibido na TV<input class="focusable pair-code-input" data-focusable name="code" value="${escapeHtml(initialCode)}" placeholder="ABCD-EFGH" autocomplete="one-time-code" required></label>
        <div class="tabs pair-tabs" role="tablist">
          <button class="tab focusable active" type="button" data-pair-type="xtream" data-focusable>Xtream Codes</button>
          <button class="tab focusable" type="button" data-pair-type="m3u" data-focusable>Link M3U</button>
        </div>
        <div class="pair-fields" data-pair-fields="xtream">
          <label>Servidor<input class="focusable" data-focusable name="serverUrl" inputmode="url" placeholder="servidor.com:porta"></label>
          <label>Usuário<input class="focusable" data-focusable name="username" autocomplete="username"></label>
          <label>Senha<input class="focusable" data-focusable name="password" type="password" autocomplete="current-password"></label>
        </div>
        <div class="pair-fields hidden" data-pair-fields="m3u">
          <label>URL da lista M3U<input class="focusable" data-focusable name="url" type="url" placeholder="https://servidor/lista.m3u"></label>
        </div>
        <input type="hidden" name="type" value="xtream">
        <button class="primary-button focusable" data-focusable type="submit">Enviar para minha TV</button>
        <div class="pair-submit-status" id="pair-submit-status" aria-live="polite"></div>
        <p class="pair-legal">O GATE é somente um player e não fornece conteúdo. Use apenas listas autorizadas.</p>
      </form>
    </div>
  </section>`;
  bindPairingPortal();
  refreshFocusable();
}

function bindPairingPortal() {
  const form = document.querySelector("#pair-portal-form");
  if (!form) return;
  const status = document.querySelector("#pair-submit-status");
  form.elements.code.addEventListener("input", (event) => { event.target.value = normalizePairCode(event.target.value); });
  main.querySelectorAll("[data-pair-type]").forEach((tab) => tab.addEventListener("click", () => {
    const type = tab.dataset.pairType;
    form.elements.type.value = type;
    main.querySelectorAll("[data-pair-type]").forEach((item) => item.classList.toggle("active", item === tab));
    main.querySelectorAll("[data-pair-fields]").forEach((fields) => fields.classList.toggle("hidden", fields.dataset.pairFields !== type));
  }));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Enviando com segurança…";
    status.className = "pair-submit-status";
    status.textContent = "Validando o código da TV…";
    const values = Object.fromEntries(new FormData(form));
    const descriptor = values.type === "m3u"
      ? { type: "m3u", url: values.url, name: "Lista enviada pelo celular" }
      : { type: "xtream", serverUrl: values.serverUrl, username: values.username, password: values.password, name: "Lista enviada pelo celular" };
    try {
      const code = normalizePairCode(values.code);
      await api(`/api/pairing/${encodeURIComponent(code)}`, { method: "PUT", body: JSON.stringify({ descriptor }) });
      form.querySelectorAll("input").forEach((input) => { if (input.type === "password") input.value = ""; });
      status.className = "pair-submit-status success";
      status.innerHTML = "<strong>Pronto!</strong><span>A lista foi enviada. Volte para a TV — ela conectará automaticamente.</span>";
      button.textContent = "Lista enviada";
    } catch (error) {
      status.className = "pair-submit-status error";
      status.textContent = error.message;
      button.disabled = false;
      button.textContent = "Tentar novamente";
    }
  });
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
  const constrainedTv = document.body.classList.contains("tv-optimized");
  const buffer = constrainedTv ? TV_STREAM_BUFFER : WEB_STREAM_BUFFER;
  return {
    startLevel: -1,
    capLevelToPlayerSize: true,
    enableWorker: !/Web0S|WebOS|NetCast/i.test(navigator.userAgent || ""),
    lowLatencyMode: false,
    backBufferLength: preview ? Math.min(12, buffer.back) : buffer.back,
    maxBufferLength: preview ? Math.min(20, buffer.target) : buffer.target,
    maxMaxBufferLength: preview ? Math.min(40, buffer.maximum) : buffer.maximum,
    maxBufferSize: constrainedTv ? 48 * 1024 * 1024 : 80 * 1024 * 1024,
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

function freshPlaybackUrl(value, serial) {
  try {
    const url = new URL(String(value || ""), location.href);
    if (url.origin === location.origin && /^\/api\/stream\//.test(url.pathname)) {
      url.searchParams.set("_gate_refresh", String(serial));
    }
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
  const directFirst = document.documentElement.dataset.tvPlatform === "webos";
  add(item?.playUrl, item?.streamType, directFirst);
  add(item?.playUrl, item?.streamType, !directFirst);
  add(item?.fallbackPlayUrl, item?.fallbackStreamType, directFirst);
  add(item?.fallbackPlayUrl, item?.fallbackStreamType, !directFirst);
  return candidates;
}

function isLiveWebPlayback(item, preview = false) {
  if (preview || item?.live === true) return true;
  if (item?.live === false) return false;
  const mediaKind = String(item?.mediaKind || item?.kind || "").toLowerCase();
  if (["movies", "movie", "series", "episodes", "episode", "vod"].includes(mediaKind)) return false;
  const streamType = String(item?.streamType || "").toLowerCase();
  if (streamType === "video") return false;
  return streamType === "mpegts" || state.view === "live";
}

function nativePlayerAvailable() {
  try { return Boolean(window.GateNativePlayer && typeof window.GateNativePlayer.playFullscreen === "function"); }
  catch { return false; }
}

function nativeAutoStartAvailable() {
  try {
    return Boolean(window.GateNativePlayer
      && typeof window.GateNativePlayer.isAutoStartEnabled === "function"
      && typeof window.GateNativePlayer.setAutoStartEnabled === "function");
  } catch { return false; }
}

function nativeAutoStartEnabled() {
  try { return nativeAutoStartAvailable() && Boolean(window.GateNativePlayer.isAutoStartEnabled()); }
  catch { return false; }
}

function renderTvSettings() {
  if (!tvSettingsModal) return;
  const toggle = tvSettingsModal.querySelector("#autostart-toggle");
  const description = tvSettingsModal.querySelector("#autostart-description");
  const enabled = nativeAutoStartEnabled();
  toggle?.classList.toggle("enabled", enabled);
  toggle?.setAttribute("aria-pressed", String(enabled));
  if (description) description.textContent = enabled ? "Ativado · a GATE TV tentará abrir ao ligar" : "Desativado";
}

function openTvSettings() {
  if (!tvSettingsModal || !nativeAutoStartAvailable()) {
    showToast("Esta opção está disponível no aplicativo para Android TV.");
    return;
  }
  state.lastFocused = document.activeElement;
  renderTvSettings();
  tvSettingsModal.classList.remove("hidden");
  refreshFocusable();
  setTimeout(() => tvSettingsModal.querySelector("#autostart-toggle")?.focus(), 0);
}

function closeTvSettings() {
  if (!tvSettingsModal) return;
  tvSettingsModal.classList.add("hidden");
  state.lastFocused?.focus?.();
}

function toggleNativeAutoStart() {
  if (!nativeAutoStartAvailable()) return;
  const enabled = !nativeAutoStartEnabled();
  try {
    window.GateNativePlayer.setAutoStartEnabled(enabled);
    renderTvSettings();
    showToast(enabled ? "Inicialização automática ativada." : "Inicialização automática desativada.");
  } catch {
    showToast("A TV não permitiu alterar essa configuração.");
  }
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
  const sourceKey = (candidate) => {
    try {
      const url = new URL(candidate?.url || "", location.href);
      url.searchParams.delete("direct");
      url.searchParams.delete("_gate_refresh");
      return url.href;
    } catch { return String(candidate?.url || ""); }
  };
  const primaryKey = sourceKey(primary);
  const fallback = candidates.find((candidate) => candidate.direct && sourceKey(candidate) !== primaryKey)
    || candidates.find((candidate) => sourceKey(candidate) !== primaryKey)
    || candidates.find((candidate) => candidate.url !== primary?.url);
  return { primary, fallback };
}

function nativeCoordinateScale() {
  // Android and AVPlay consume physical pixels. The webOS decoder lives in a
  // parent HTML document, so its bounds must stay in CSS pixels even on 4K.
  return document.documentElement.dataset.tvPlatform === "webos"
    ? 1
    : Number(devicePixelRatio || 1);
}

function playNativePreview(item) {
  if (!nativePlayerAvailable()) return false;
  const stage = main.querySelector(".live-preview-stage");
  if (!stage) return false;
  const rect = stage.getBoundingClientRect();
  const scale = nativeCoordinateScale();
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
  const scale = nativeCoordinateScale();
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
  session.attempt += 1;
  for (const timer of session.timers || []) clearTimeout(timer);
  session.timers?.clear?.();
  if (session.frameCallbackId != null && typeof session.media.cancelVideoFrameCallback === "function") {
    try { session.media.cancelVideoFrameCallback(session.frameCallbackId); } catch {}
  }
  session.frameCallbackId = null;
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
  for (const [name, handler] of session.listeners || []) session.media.removeEventListener(name, handler);
  if (clearMedia) clearWebEngine(session);
  else {
    for (const timer of session.timers || []) clearTimeout(timer);
    session.timers?.clear?.();
  }
  state[slot] = null;
  if (slot === "webPlayer") state.hls = null;
  if (slot === "webPreview") state.previewHls = null;
}

function webSessionSlot(session) {
  return session?.preview ? "webPreview" : "webPlayer";
}

function scheduleWebTask(session, callback, delay, attempt = session?.attempt) {
  if (!session || session.destroyed) return null;
  const timer = setTimeout(() => {
    session.timers.delete(timer);
    if (session.destroyed || (attempt != null && session.attempt !== attempt)) return;
    callback();
  }, delay);
  session.timers.add(timer);
  return timer;
}

function isCurrentWebAttempt(session, attempt) {
  return Boolean(session && !session.destroyed && session.attempt === attempt);
}

function sampleRenderedFrames(session, media, now = Date.now()) {
  let frames = Number.NaN;
  try { frames = Number(media.getVideoPlaybackQuality?.().totalVideoFrames); } catch {}
  if (!Number.isFinite(frames)) frames = Number(media.webkitDecodedFrameCount);
  if (!Number.isFinite(frames)) frames = Number(media.mozDecodedFrames);
  if (!Number.isFinite(frames) || frames < 0) return;
  session.frameMonitoringAvailable = true;
  if (frames > session.lastRenderedFrames) {
    session.lastRenderedFrames = frames;
    session.videoFramesSeen = frames > 0;
    session.lastVideoFrameAt = now;
  }
}

function startVideoFrameMonitor(session) {
  const media = session?.media;
  if (!media || typeof media.requestVideoFrameCallback !== "function") return;
  const callback = (_now, metadata) => {
    if (session.destroyed || session.media !== media) return;
    const frames = Number(metadata?.presentedFrames);
    session.frameMonitoringAvailable = true;
    if (!Number.isFinite(frames) || frames > session.lastRenderedFrames) {
      if (Number.isFinite(frames)) session.lastRenderedFrames = frames;
      session.videoFramesSeen = true;
      session.lastVideoFrameAt = Date.now();
    }
    session.frameCallbackId = media.requestVideoFrameCallback(callback);
  };
  session.frameCallbackId = media.requestVideoFrameCallback(callback);
}

function replaceWebVideoSurface(session) {
  const previous = session.media;
  const replacement = previous.cloneNode(false);
  if (previous.parentNode) previous.parentNode.replaceChild(replacement, previous);
  if (previous === video) {
    video = replacement;
    bindPrimaryVideoEvents(video);
  }
  return replacement;
}

function recoverWebVideoSurface(session, message) {
  if (!session || session.destroyed || session.switching) return;
  session.switching = true;
  const slot = webSessionSlot(session);
  const item = session.item;
  const preview = session.preview;
  const index = session.index;
  const surfaceResetCount = session.surfaceResetCount + 1;
  playbackStatus(session, message || "A imagem parou. Reiniciando o vídeo…");
  clearInterval(session.watchdog);
  session.destroyed = true;
  for (const [name, handler] of session.listeners || []) session.media.removeEventListener(name, handler);
  clearWebEngine(session);
  const replacement = replaceWebVideoSurface(session);
  if (state[slot] === session) state[slot] = null;
  if (slot === "webPlayer") state.hls = null;
  if (slot === "webPreview") state.previewHls = null;
  startWebPlayback(replacement, item, { preview, startIndex: index, surfaceResetCount });
}

function playbackStatus(session, message, type = "loading") {
  if (!session.preview) showPlayerStatus(message, type);
}

function requestWebMediaPlay(session) {
  if (!session || session.destroyed) return;
  session.lastPlayAttemptAt = Date.now();
  if (session.preview) {
    session.media.muted = true;
    session.media.defaultMuted = true;
    session.media.autoplay = true;
    session.media.playsInline = true;
  }
  try {
    Promise.resolve(session.media.play()).catch(() => {
      playbackStatus(session, "Pressione OK ou Play para iniciar.", "ready");
    });
  } catch {
    playbackStatus(session, "Pressione OK ou Play para iniciar.", "ready");
  }
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
  session.lastDataAt = session.lastProgressAt;
  session.starvedAt = 0;
  session.stallRetries = 0;
  session.routeRounds = 0;
  session.unexpectedPauseAt = 0;
}

function advanceWebCandidate(session, message) {
  if (!session || session.destroyed || session.switching) return;
  session.switching = true;
  clearWebEngine(session);
  session.index += 1;
  session.networkRetries = 0;
  session.mediaRetries = 0;
  session.stallRetries = 0;
  scheduleWebTask(session, () => {
    session.switching = false;
    startWebCandidate(session, message);
  }, session.preview ? 180 : 320, session.attempt);
}

function retryWebCandidate(session, message, { preserveNetworkRetries = false } = {}) {
  if (!session || session.destroyed || session.switching) return;
  session.switching = true;
  clearWebEngine(session);
  if (!preserveNetworkRetries) session.networkRetries = 0;
  session.mediaRetries = 0;
  session.lastProgressAt = Date.now();
  session.lastDataAt = session.lastProgressAt;
  session.starvedAt = 0;
  session.unexpectedPauseAt = 0;
  playbackStatus(session, message || "Reconectando o canal…");
  scheduleWebTask(session, () => {
    session.switching = false;
    startWebCandidate(session, message);
  }, session.preview ? 350 : 700, session.attempt);
}

function startWebCandidate(session, reason = "") {
  if (!session || session.destroyed) return;
  const attempt = ++session.attempt;
  const candidate = session.candidates[session.index];
  if (!candidate) {
    session.routeRounds += 1;
    session.index = 0;
    const delay = Math.min(15_000, 2_000 * session.routeRounds);
    playbackStatus(session, reason || "Mantendo o canal aberto e procurando uma rota estável…");
    scheduleWebTask(session, () => startWebCandidate(session, "Nova tentativa de conexão…"), delay, attempt);
    return;
  }
  const playbackUrl = freshPlaybackUrl(candidate.url, `${Date.now()}-${attempt}`);
  session.lastProgressAt = Date.now();
  session.lastDataAt = session.lastProgressAt;
  session.starvedAt = 0;
  session.lastTime = -1;
  session.lastDecodedFrames = -1;
  session.lastRenderedFrames = -1;
  session.lastVideoFrameAt = 0;
  session.frameMonitoringAvailable = false;
  session.videoFramesSeen = false;
  session.startedAt = 0;
  session.started = false;
  session.lastPlayAttemptAt = 0;
  startVideoFrameMonitor(session);
  playbackStatus(session, candidate.direct ? "Testando rota direta mais rápida…" : "Abrindo pela rota compatível…");

  if (candidate.type === "hls" && window.Hls?.isSupported()) {
    const hls = new window.Hls(adaptiveHlsOptions(session.preview));
    session.hls = hls;
    if (session.preview) state.previewHls = hls; else state.hls = hls;
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      if (!isCurrentWebAttempt(session, attempt)) return;
      requestWebMediaPlay(session);
    });
    hls.on(window.Hls.Events.LEVEL_SWITCHED, (_event, data) => {
      if (isCurrentWebAttempt(session, attempt) && !session.preview) updatePlayerQuality(hls.levels?.[data.level]?.height || session.media.videoHeight);
    });
    if (window.Hls.Events.FRAG_BUFFERED) {
      hls.on(window.Hls.Events.FRAG_BUFFERED, () => {
        if (!isCurrentWebAttempt(session, attempt)) return;
        session.lastDataAt = Date.now();
        if (!session.media.paused) session.starvedAt = 0;
      });
    }
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!isCurrentWebAttempt(session, attempt)) return;
      if (!data.fatal) {
        const detail = String(data.details || "").toLowerCase();
        if (/stalled|buffer|fragloaderror|levelloaderror/.test(detail) && !session.starvedAt) {
          session.starvedAt = Date.now();
        }
        return;
      }
      if (!candidate.direct && data.type === window.Hls.ErrorTypes.NETWORK_ERROR && session.networkRetries < 2) {
        session.networkRetries += 1;
        playbackStatus(session, "Reconectando sem trocar de rota…");
        scheduleWebTask(session, () => {
          if (isCurrentWebAttempt(session, attempt) && session.hls === hls) hls.startLoad();
        }, 700 * session.networkRetries, attempt);
        return;
      }
      if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && session.mediaRetries < 1) {
        session.mediaRetries += 1;
        hls.recoverMediaError();
        return;
      }
      advanceWebCandidate(session, hlsErrorMessage(data));
    });
    hls.loadSource(playbackUrl);
    hls.attachMedia(session.media);
    return;
  }

  if (candidate.type === "mpegts" && window.mpegts?.isSupported?.()) {
    try {
      const player = window.mpegts.createPlayer({ type: "mpegts", isLive: true, url: playbackUrl }, {
        enableWorker: true,
        enableStashBuffer: true,
        stashInitialSize: session.preview ? 1024 * 1024 : 3 * 1024 * 1024,
        lazyLoad: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 30,
        autoCleanupMinBackwardDuration: 10,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 10,
        liveBufferLatencyMinRemain: 2,
        statisticsInfoReportInterval: 1000
      });
      session.mpegts = player;
      player.attachMediaElement(session.media);
      player.load();
      player.on(window.mpegts.Events.ERROR, () => {
        if (!isCurrentWebAttempt(session, attempt)) return;
        if (session.networkRetries < 2) {
          session.networkRetries += 1;
          retryWebCandidate(session, "O fluxo TS oscilou. Reconectando na mesma rota…", { preserveNetworkRetries: true });
          return;
        }
        advanceWebCandidate(session, "O fluxo TS não respondeu nesta rota.");
      });
      if (window.mpegts.Events.STATISTICS_INFO) {
        player.on(window.mpegts.Events.STATISTICS_INFO, (info) => {
          if (!isCurrentWebAttempt(session, attempt)) return;
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
      for (const eventName of ["LOADING_COMPLETE", "RECOVERED_EARLY_EOF"]) {
        const event = window.mpegts.Events?.[eventName];
        if (!event) continue;
        player.on(event, () => {
          if (isCurrentWebAttempt(session, attempt)) retryWebCandidate(session, "O servidor encerrou o fluxo. Reconectando o mesmo canal…");
        });
      }
      Promise.resolve(player.play()).catch(() => {
        if (session.preview) requestWebMediaPlay(session);
        else playbackStatus(session, "Pressione OK ou Play para iniciar.", "ready");
      });
      return;
    } catch {
      advanceWebCandidate(session, "Este navegador não conseguiu preparar o fluxo MPEG-TS.");
      return;
    }
  }

  session.media.src = playbackUrl;
  requestWebMediaPlay(session);
}

function startWebPlayback(media, item, { preview = false, startIndex = 0, surfaceResetCount = 0 } = {}) {
  const slot = preview ? "webPreview" : "webPlayer";
  destroyWebPlayback(slot);
  const candidates = streamCandidates(item);
  const session = {
    media,
    item,
    preview,
    live: isLiveWebPlayback(item, preview),
    candidates,
    index: Math.max(0, Math.min(Number(startIndex) || 0, Math.max(0, candidates.length - 1))),
    hls: null,
    mpegts: null,
    listeners: [],
    timers: new Set(),
    attempt: 0,
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
    routeRounds: 0,
    lastPlayAttemptAt: 0,
    unexpectedPauseAt: 0,
    userPaused: false,
    completed: false,
    startedAt: 0,
    surfaceResetCount,
    lastRenderedFrames: -1,
    lastVideoFrameAt: 0,
    videoFramesSeen: false,
    frameMonitoringAvailable: false,
    frameCallbackId: null
  };
  if (preview) {
    media.muted = true;
    media.defaultMuted = true;
    media.autoplay = true;
    media.playsInline = true;
  }
  const listen = (name, handler) => { media.addEventListener(name, handler); session.listeners.push([name, handler]); };
  listen("playing", () => {
    session.started = true;
    if (!session.startedAt) session.startedAt = Date.now();
    session.completed = false;
    session.userPaused = false;
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
  listen("ended", () => {
    if (!session.live) {
      session.completed = true;
      session.userPaused = true;
      session.unexpectedPauseAt = 0;
      playbackStatus(session, "Reprodução concluída.", "ready");
      return;
    }
    retryWebCandidate(session, "O servidor encerrou o sinal. Reabrindo o mesmo canal…");
  });
  listen("error", () => advanceWebCandidate(session, "Este formato não abriu nesta rota."));
  session.watchdog = setInterval(() => {
    if (session.destroyed || session.switching || session.completed || document.hidden) return;
    const now = Date.now();
    if (media.paused) {
      if (session.userPaused) return;
      if (!session.started) {
        if (now - session.lastPlayAttemptAt >= 2_500) requestWebMediaPlay(session);
        const startupLimit = preview ? 18_000 : 35_000;
        if (now - session.lastProgressAt > startupLimit) {
          advanceWebCandidate(session, "A reprodução não iniciou nesta rota. Tentando a alternativa…");
        }
      } else {
        if (!session.unexpectedPauseAt) session.unexpectedPauseAt = now;
        if (now - session.lastPlayAttemptAt >= 2_500) requestWebMediaPlay(session);
        if (media.ended || now - session.unexpectedPauseAt > (preview ? 6_000 : 9_000)) {
          retryWebCandidate(session, "O sinal foi interrompido. Reconectando o mesmo canal…");
        }
      }
      return;
    }
    sampleRenderedFrames(session, media, now);
    if (session.startedAt && now - session.startedAt > 60_000) session.surfaceResetCount = 0;
    const videoExpected = Number(media.videoWidth) > 0 || Number(media.videoHeight) > 0;
    const firstFrameTimedOut = session.started && videoExpected && session.frameMonitoringAvailable
      && !session.videoFramesSeen && now - session.startedAt > (preview ? 15_000 : 20_000);
    const renderedFramesStopped = session.videoFramesSeen && session.lastVideoFrameAt > 0
      && now - session.lastVideoFrameAt > (preview ? 15_000 : 20_000);
    if (firstFrameTimedOut || renderedFramesStopped) {
      if (session.surfaceResetCount < 2) {
        recoverWebVideoSurface(session, firstFrameTimedOut
          ? "O som iniciou sem imagem. Reiniciando o decodificador…"
          : "A imagem parou. Reiniciando o decodificador…");
      } else {
        session.surfaceResetCount = 0;
        advanceWebCandidate(session, "A rota ficou sem imagem. Tentando a alternativa…");
      }
      return;
    }
    const recentProgress = now - session.lastProgressAt <= 12_000;
    const haveFutureData = recentProgress && (Number(media.readyState) >= 3 || bufferedAhead(media) > 1.25);
    if (haveFutureData) {
      session.starvedAt = 0;
      return;
    }
    if (!session.starvedAt && now - session.lastProgressAt > 12_000) session.starvedAt = now;
    const starvationLimit = preview ? 15_000 : 22_000;
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

function setWebPlaybackPaused(media, paused) {
  const session = state.webPlayer?.media === media ? state.webPlayer : state.webPreview?.media === media ? state.webPreview : null;
  if (session) session.userPaused = Boolean(paused);
  if (paused) media.pause();
  else {
    if (session) {
      session.userPaused = false;
      session.unexpectedPauseAt = 0;
    }
    media.play().catch(() => {});
  }
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
  document.body.classList.remove("live-preview-open");
  main.querySelector(".live-preview-stage")?.classList.remove("live-preview-immersive");
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
  stage?.classList.add("live-preview-immersive");
  document.body.classList.add("live-preview-open");
  preview.muted = false;
  preview.defaultMuted = false;
  const request = stage?.requestFullscreen || stage?.webkitRequestFullscreen || preview.webkitEnterFullscreen;
  if (request) {
    try {
      Promise.resolve(request.call(stage?.requestFullscreen || stage?.webkitRequestFullscreen ? stage : preview)).catch(() => {});
    } catch {}
  }
  preview.play().catch(() => {});
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
  state.filter = { query: "", group: "Todos" };
  state.visibleCount = state.pageSize;
  if (options.silent && location.pathname !== "/") route();
  else {
    history.replaceState({}, "", "/");
    renderHome();
  }
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

function bindSubscriptionForm() {
  document.querySelector("#subscription-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    const result = document.querySelector("#subscription-result");
    button.disabled = true; button.textContent = "Preparando pagamento seguro…";
    try {
      const payload = await api("/api/billing/checkout", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      const checkoutUrl = String(payload.checkoutUrl || "");
      const checkoutQrDataUrl = trustedQrDataUrl(payload.checkoutQrDataUrl);
      result.className = "result-box checkout-ready";
      result.innerHTML = `<div><strong>Checkout criado</strong><p>Finalize o pagamento no ambiente seguro do ${payload.provider === "mercadopago" ? "Mercado Pago" : "provedor de pagamento"}.</p><a class="primary-button focusable" data-focusable href="${escapeHtml(checkoutUrl)}" target="_blank" rel="noopener noreferrer">Abrir pagamento</a></div>${checkoutQrDataUrl ? `<img src="${escapeHtml(checkoutQrDataUrl)}" alt="QR Code do pagamento">` : ""}`;
      button.textContent = "Checkout aguardando pagamento";
      refreshFocusable();
    } catch (error) {
      result.className = "result-box error";
      result.innerHTML = `<strong>Pagamento ainda indisponível</strong><p>${escapeHtml(error.message)}</p>`;
      button.disabled = false;
      button.textContent = "Tentar novamente";
    }
  });
}

function renderPaymentReturn(status) {
  state.view = "payment";
  document.body.classList.remove("pairing-page");
  const messages = {
    success: ["Pagamento enviado", "O provedor recebeu o pagamento. A ativação será confirmada assim que a transação for validada."],
    pending: ["Pagamento em análise", "A transação ainda está pendente. Você pode voltar ao aplicativo enquanto ela é processada."],
    failure: ["Pagamento não concluído", "Nenhuma ativação foi realizada. Volte e tente novamente com outro meio de pagamento."]
  };
  const [title, message] = messages[status] || messages.pending;
  main.innerHTML = `<section class="payment-return"><img src="/gate-icon.svg" alt=""><p class="eyebrow">GATE PREMIUM</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a class="primary-button focusable" data-link data-focusable href="/">Voltar ao GATE TV</a></section>`;
  main.querySelector("[data-link]")?.addEventListener("click", (event) => { event.preventDefault(); navigate("/"); });
}

function syncPrimaryNavigation() {
  const actionByView = { live: "open-live", movies: "open-movies", series: "open-series", favorites: "open-favorites" };
  document.querySelectorAll(".sidebar .nav-item").forEach((item) => {
    const isHome = item.matches('[href="/"]') && state.view === "home";
    const isCurrentAction = item.dataset.action === actionByView[state.view];
    const isPremium = item.matches('[href="/assinar"]') && ["renew", "payment"].includes(state.view);
    item.classList.toggle("active", Boolean(isHome || isCurrentAction || isPremium));
  });
}

function bindDynamicActions() {
  syncPrimaryNavigation();
  main.querySelectorAll("[data-action=open-source]").forEach((button) => button.addEventListener("click", () => openSource(button.dataset.tab || "xtream")));
  main.querySelectorAll("[data-action=open-pairing]").forEach((button) => button.addEventListener("click", startPairing));
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
  const platform = requestedPlatform.toLowerCase();
  const androidWrapper = /^android(?:tv)?$/i.test(requestedPlatform) || /GATE-IPTV-PLAYER\/\d/i.test(ua);
  const tv = ["androidtv", "webos", "tizen"].includes(platform) || /Tizen|Web0S|WebOS|NetCast|SMART-TV|SmartTV|Android TV|AFT|BRAVIA/i.test(ua);
  const touch = navigator.maxTouchPoints > 0 || (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches);
  document.body.classList.toggle("tv-optimized", tv);
  document.body.classList.toggle("browser-mode", !tv);
  document.body.classList.toggle("android-wrapper", androidWrapper);
  document.body.classList.toggle("native-player", nativePlayerAvailable());
  document.body.classList.toggle("touch-mode", Boolean(touch));
  document.documentElement.dataset.platform = tv ? "tv" : androidWrapper ? "android-app" : "browser";
  document.documentElement.dataset.tvPlatform = platform || (tv ? "generic" : "");
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
  const adOverlay = document.querySelector("#ad-overlay");
  if (adOverlay && !adOverlay.classList.contains("hidden")) return adOverlay;
  if (!playerModal.classList.contains("hidden")) return playerModal;
  if (!detailsModal.classList.contains("hidden")) return detailsModal;
  if (tvSettingsModal && !tvSettingsModal.classList.contains("hidden")) return tvSettingsModal;
  if (!pairingModal.classList.contains("hidden")) return pairingModal;
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

let imaSdkPromise = null;

function loadImaSdk(timeoutMs = 7_000) {
  if (window.google?.ima) return Promise.resolve(window.google.ima);
  if (imaSdkPromise) return imaSdkPromise;
  const timeout = Math.min(10_000, Math.max(1_000, Number(timeoutMs) || 7_000));
  imaSdkPromise = new Promise((resolve, reject) => {
    const previous = document.querySelector("script[data-gate-ima-sdk]");
    previous?.remove();
    const script = document.createElement("script");
    script.src = IMA_SDK_URL;
    script.async = true;
    script.dataset.gateImaSdk = "true";
    script.referrerPolicy = "strict-origin-when-cross-origin";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (error || !window.google?.ima) {
        script.remove();
        imaSdkPromise = null;
        reject(error || new Error("IMA SDK indisponível."));
      } else resolve(window.google.ima);
    };
    const timer = setTimeout(() => finish(new Error("Tempo esgotado ao carregar publicidade.")), timeout);
    script.onload = () => finish();
    script.onerror = () => finish(new Error("Não foi possível carregar publicidade."));
    document.head.appendChild(script);
  });
  return imaSdkPromise;
}

function resetAdOverlay() {
  const overlay = document.querySelector("#ad-overlay");
  overlay?.classList.remove("ima-active");
  document.querySelector("#ima-ad-container")?.replaceChildren();
  const contentVideo = document.querySelector("#ima-content-video");
  if (contentVideo) {
    try { contentVideo.pause(); } catch {}
    contentVideo.removeAttribute("src");
  }
}

function completeInitialAd() {
  resetAdOverlay();
  document.querySelector("#ad-overlay")?.classList.add("hidden");
  sessionStorage.setItem("gate.adShown", "true");
  refreshFocusable();
}

function showHouseAd(configuration = {}) {
  const overlay = document.querySelector("#ad-overlay");
  const countdown = document.querySelector("#ad-countdown");
  const progress = document.querySelector("#ad-progress-bar");
  const skip = document.querySelector("#skip-ad");
  if (!overlay || !countdown || !progress || !skip || configuration.enabled === false) {
    completeInitialAd();
    return Promise.resolve(false);
  }
  const duration = Math.min(15, Math.max(.1, Number(configuration.durationSeconds ?? state.config.adDurationSeconds) || 10));
  let remaining = duration;
  resetAdOverlay();
  overlay.classList.remove("hidden");
  countdown.textContent = String(Math.ceil(remaining));
  skip.disabled = true;
  skip.innerHTML = `Aguarde <span id="ad-countdown">${Math.ceil(remaining)}</span>s`;
  const liveCountdown = skip.querySelector("#ad-countdown");
  progress.style.transition = "none";
  progress.style.width = "0";
  requestAnimationFrame(() => {
    progress.style.transition = `width ${duration}s linear`;
    progress.style.width = "100%";
  });
  return new Promise((resolve) => {
    let finished = false;
    const close = () => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      clearTimeout(safetyTimer);
      skip.onclick = null;
      completeInitialAd();
      resolve(true);
    };
    const startedAt = Date.now();
    const timer = setInterval(() => {
      remaining = Math.max(0, duration - ((Date.now() - startedAt) / 1000));
      if (liveCountdown) liveCountdown.textContent = String(Math.ceil(remaining));
      if (remaining <= 0) close();
    }, 250);
    const safetyTimer = setTimeout(close, Math.ceil(duration * 1000) + 500);
    skip.onclick = () => { if (!skip.disabled) close(); };
  });
}

async function showImaAd(configuration) {
  const ima = await loadImaSdk(configuration.loadTimeoutMs);
  const overlay = document.querySelector("#ad-overlay");
  const adContainer = document.querySelector("#ima-ad-container");
  const contentVideo = document.querySelector("#ima-content-video");
  if (!overlay || !adContainer || !contentVideo) return false;
  resetAdOverlay();
  overlay.classList.remove("hidden");
  overlay.classList.add("ima-active");
  contentVideo.muted = true;
  return new Promise((resolve) => {
    let adsLoader = null;
    let adsManager = null;
    let adDisplayContainer = null;
    let settled = false;
    let started = false;
    const maxPlaybackMs = Math.min(45_000, Math.max(5_000, Number(configuration.maxPlaybackSeconds) * 1000 || 45_000));
    const dimensions = () => ({
      width: Math.max(320, overlay.clientWidth || window.innerWidth || 1280),
      height: Math.max(180, overlay.clientHeight || window.innerHeight || 720)
    });
    const resize = () => {
      if (!adsManager) return;
      const { width, height } = dimensions();
      try { adsManager.resize(width, height, ima.ViewMode.NORMAL); } catch {}
    };
    const finish = (played) => {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      window.removeEventListener("resize", resize);
      try { adsManager?.destroy(); } catch {}
      try { adsLoader?.destroy?.(); } catch {}
      try { adDisplayContainer?.destroy?.(); } catch {}
      resetAdOverlay();
      resolve(Boolean(played));
    };
    const safetyTimer = setTimeout(() => finish(started), maxPlaybackMs);
    try {
      ima.settings?.setLocale?.("pt_br");
      adDisplayContainer = new ima.AdDisplayContainer(adContainer, contentVideo);
      adsLoader = new ima.AdsLoader(adDisplayContainer);
      adsLoader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, (event) => {
        try {
          const rendering = new ima.AdsRenderingSettings();
          rendering.enablePreloading = true;
          rendering.restoreCustomPlaybackStateOnAdBreakComplete = true;
          rendering.prerollLoadVideoTimeout = Math.min(10_000, Math.max(1_000, Number(configuration.loadTimeoutMs) || 7_000));
          adsManager = event.getAdsManager(contentVideo, rendering);
          adsManager.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, () => finish(started));
          adsManager.addEventListener(ima.AdEvent.Type.STARTED, () => {
            started = true;
            try { adsManager.focus?.(); } catch {}
          });
          [ima.AdEvent.Type.CONTENT_RESUME_REQUESTED, ima.AdEvent.Type.ALL_ADS_COMPLETED, ima.AdEvent.Type.SKIPPED]
            .filter(Boolean)
            .forEach((eventType) => adsManager.addEventListener(eventType, () => finish(started)));
          const { width, height } = dimensions();
          adsManager.init(width, height, ima.ViewMode.NORMAL);
          adsManager.start();
          window.addEventListener("resize", resize);
        } catch { finish(started); }
      }, false);
      adsLoader.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, () => finish(started), false);
      adDisplayContainer.initialize();
      const request = new ima.AdsRequest();
      const { width, height } = dimensions();
      request.adTagUrl = configuration.vastAdTagUrl;
      request.linearAdSlotWidth = width;
      request.linearAdSlotHeight = height;
      request.nonLinearAdSlotWidth = width;
      request.nonLinearAdSlotHeight = Math.max(90, Math.round(height / 3));
      request.vastLoadTimeout = Math.min(10_000, Math.max(1_000, Number(configuration.loadTimeoutMs) || 7_000));
      request.setAdWillAutoPlay?.(true);
      request.setAdWillPlayMuted?.(true);
      request.setContinuousPlayback?.(false);
      adsLoader.requestAds(request);
    } catch { finish(started); }
  });
}

function validVastConfiguration(configuration) {
  if (!configuration?.enabled || configuration.sdkUrl !== IMA_SDK_URL) return false;
  try { return new URL(configuration.vastAdTagUrl).protocol === "https:"; }
  catch { return false; }
}

async function showAd() {
  if (location.pathname === "/pair" || state.adFree || sessionStorage.getItem("gate.adShown")) return false;
  const configuration = state.config.ads || {};
  const imaClient = document.documentElement.dataset.platform === "browser"
    || ["webos", "tizen"].includes(document.documentElement.dataset.tvPlatform || "");
  if (imaClient && validVastConfiguration(configuration)) {
    try {
      const played = await showImaAd(configuration);
      if (played) {
        completeInitialAd();
        return true;
      }
    } catch {}
  }
  return showHouseAd(configuration.houseAd || { enabled: true, durationSeconds: state.config.adDurationSeconds });
}

const primaryVideoBindings = new WeakSet();
function bindPrimaryVideoEvents(media) {
  if (!media || primaryVideoBindings.has(media)) return;
  primaryVideoBindings.add(media);
  media.addEventListener("playing", hidePlayerStatus);
  media.addEventListener("canplay", () => { if (!media.paused) hidePlayerStatus(); });
  media.addEventListener("loadedmetadata", () => updatePlayerQuality(media.videoHeight));
  media.addEventListener("waiting", () => showPlayerStatus("Carregando o sinal…"));
  media.addEventListener("stalled", () => showPlayerStatus("Sinal instável. Reconectando…"));
  media.addEventListener("click", () => {
    if (!playerModal.classList.contains("hidden")) setWebPlaybackPaused(media, !media.paused);
  });
}
bindPrimaryVideoEvents(video);
retryButton.addEventListener("click", () => state.currentItem && playStream(state.currentItem));

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-link]");
  if (link) { event.preventDefault(); navigate(link.getAttribute("href")); }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "open-tv-settings") openTvSettings();
  if (action === "toggle-autostart") toggleNativeAutoStart();
  if (action === "open-source" && !event.target.closest("main")) openSource("xtream");
  if (action === "open-pairing" && !event.target.closest("main")) startPairing();
  if (action === "pairing-manual") { closePairing(); openSource("xtream"); }
  if (action === "open-live") state.channels.length ? ensureCatalog("live") : openSource("xtream");
  if (action === "open-movies") state.source ? ensureCatalog("movies") : openSource("xtream");
  if (action === "open-series") state.source ? ensureCatalog("series") : openSource("xtream");
  if (action === "open-favorites") state.source ? renderFavorites() : openSource("xtream");
  if (action === "go-home") renderHome();
  if (action === "live-fullscreen") openLiveFullscreen();
  if (action === "toggle-adfree") navigate("/assinar");
});
document.querySelectorAll("[data-source-tab]").forEach((tab) => tab.addEventListener("click", () => selectSourceTab(tab.dataset.sourceTab)));
document.querySelector(".close-modal").addEventListener("click", closeSource);
document.querySelector(".close-pairing").addEventListener("click", closePairing);
document.querySelector(".close-tv-settings")?.addEventListener("click", closeTvSettings);
document.querySelector(".close-tv-settings-primary")?.addEventListener("click", closeTvSettings);
document.querySelector("#pairing-new-code").addEventListener("click", startPairing);
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
  const nativeOpen = Boolean(document.documentElement.dataset.nativeEngine);
  const liveFullscreen = main.querySelector(".live-preview-stage.live-preview-immersive");
  if (backPressed && (document.fullscreenElement || document.webkitFullscreenElement || liveFullscreen)) {
    event.preventDefault();
    liveFullscreen?.classList.remove("live-preview-immersive");
    document.body.classList.remove("live-preview-open");
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
      try { document.webkitExitFullscreen(); } catch {}
    }
    return;
  }
  if (backPressed && nativeOpen) {
    event.preventDefault();
    try { window.GateNativePlayer?.close?.(); } catch {}
    return;
  }
  if (playerOpen) {
    if (backPressed || event.key === "Backspace") { event.preventDefault(); closePlayer(); return; }
    if (playPausePressed) { event.preventDefault(); setWebPlaybackPaused(video, !video.paused); return; }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.currentTime + (event.key === "ArrowLeft" ? -10 : 10)); return; }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); video.volume = Math.min(1, Math.max(0, video.volume + (event.key === "ArrowUp" ? .1 : -.1))); return; }
  }
  const detailsOpen = !detailsModal.classList.contains("hidden");
  if (detailsOpen && (backPressed || event.key === "Backspace")) {
    event.preventDefault();
    closeDetails();
    return;
  }
  if (tvSettingsModal && !tvSettingsModal.classList.contains("hidden") && (backPressed || event.key === "Backspace")) {
    event.preventDefault();
    closeTvSettings();
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
    if (tvSettingsModal && !tvSettingsModal.classList.contains("hidden")) closeTvSettings();
    else if (!pairingModal.classList.contains("hidden")) closePairing();
    else if (!sourceModal.classList.contains("hidden")) closeSource();
    else if (location.pathname !== "/") history.back();
    else if (state.view !== "home") renderHome();
  }
});
const syncWebLiveFullscreen = () => {
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  main.querySelector(".live-preview-stage.live-preview-immersive")?.classList.remove("live-preview-immersive");
  document.body.classList.remove("live-preview-open");
};
document.addEventListener("fullscreenchange", syncWebLiveFullscreen);
document.addEventListener("webkitfullscreenchange", syncWebLiveFullscreen);
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
  showAd().catch(() => completeInitialAd());
  if (restored) reconnectSavedSource();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {});
  }
}
boot();
