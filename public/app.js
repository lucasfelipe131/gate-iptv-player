const state = {
  config: { annualPrice: 30, adDurationSeconds: 10, paymentAvailable: false },
  source: null,
  channels: [],
  movies: [],
  series: [],
  hls: null,
  adFree: localStorage.getItem("gate.adFree") === "true"
};

const main = document.querySelector("#main-content");
const sourceModal = document.querySelector("#source-modal");
const playerModal = document.querySelector("#player-modal");
const sourceStatus = document.querySelector("#source-status");
const video = document.querySelector("#video-player");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3400);
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
  const date = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(new Date());
  return `<header class="topbar"><span class="date">${escapeHtml(date)}</span><div class="top-actions"><span class="pill">Samsung · LG · Android TV</span></div></header>`;
}

function renderHome() {
  document.title = "GATE IPTV PLAYER";
  main.innerHTML = `${topbar()}
    <section class="hero">
      <div class="hero-content">
        <p class="eyebrow">SIMPLES. RÁPIDO. NA SUA TV.</p>
        <h1>Todo o seu conteúdo<br>em uma única tela.</h1>
        <p>Conecte uma fonte autorizada por Xtream Codes, M3U/M3U8, arquivo local ou link direto e navegue pelo controle remoto.</p>
        <div class="button-row">
          <button class="primary-button focusable" data-action="open-source" data-focusable>＋ Adicionar lista</button>
          <a class="secondary-button focusable" href="/renovar" data-link data-focusable>Remover anúncios · R$ 30/ano</a>
        </div>
      </div>
    </section>
    <div class="section-head"><h2>Formas de conectar</h2><span>Use apenas conteúdo autorizado</span></div>
    <section class="format-grid">
      <button class="format-card focusable" data-action="open-source" data-tab="xtream" data-focusable><span class="format-icon">◈</span><strong>Xtream Codes</strong><small>Servidor, usuário e senha</small></button>
      <button class="format-card focusable" data-action="open-source" data-tab="m3u" data-focusable><span class="format-icon">≡</span><strong>M3U / M3U8</strong><small>Link remoto ou arquivo local</small></button>
      <button class="format-card focusable" data-action="open-source" data-tab="portal" data-focusable><span class="format-icon">⌁</span><strong>Portal / MAC</strong><small>Validação para portais compatíveis</small></button>
      <button class="format-card focusable" data-action="open-source" data-tab="direct" data-focusable><span class="format-icon">▶</span><strong>HLS e link direto</strong><small>M3U8, MP4 e MPEG-TS</small></button>
    </section>
    ${renderConnectedRows()}`;
  bindDynamicActions();
}

function mediaCards(items, kind) {
  if (!items.length) return `<div class="empty-state">Conecte uma lista para ver ${kind} aqui.</div>`;
  return `<div class="media-row">${items.slice(0, 18).map((item) => {
    const style = item.logo ? ` style="background-image:linear-gradient(transparent,rgba(4,8,15,.9)),url('${escapeHtml(item.logo)}')"` : "";
    return `<button class="media-card focusable ${item.logo ? "has-image" : ""}" data-focusable data-play-url="${escapeHtml(item.url || "")}" data-play-name="${escapeHtml(item.name)}"${style}>${item.url ? '<span class="play-dot">▶</span>' : ""}<strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.group || kind)}</small></button>`;
  }).join("")}</div>`;
}

function renderConnectedRows() {
  if (!state.source) return `<div class="section-head"><h2>Pronto para começar</h2></div><div class="empty-state">Nenhuma fonte conectada. Seus dados de acesso não são salvos no servidor.</div>`;
  return `<div class="section-head"><h2>Ao vivo</h2><span>${state.channels.length} itens carregados</span></div>${mediaCards(state.channels, "Ao vivo")}
    <div class="section-head"><h2>Filmes</h2><span>Da sua fonte</span></div>${mediaCards(state.movies, "Filmes")}
    <div class="section-head"><h2>Séries</h2><span>Da sua fonte</span></div>${mediaCards(state.series, "Séries")}`;
}

function renderRenew() {
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
      <aside class="price-card">
        <p class="eyebrow">PLANO ANUAL</p><h2>GATE sem anúncios</h2>
        <div class="price">R$ 30<small>/ano</small></div>
        <ul class="benefits"><li>Remove os anúncios de 10 segundos</li><li>Vinculação a um aparelho</li><li>Compatível com a mesma conta/lista</li><li>Renovação rápida pelo MAC</li></ul>
        <p class="legal-note">A assinatura remove anúncios do player. Ela não inclui canais, filmes, séries nem assinatura de terceiros.</p>
      </aside>
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
  setTimeout(() => sourceModal.querySelector("input:not([type=file])")?.focus(), 30);
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

function parseLocalM3u(text) {
  const lines = text.split(/\r?\n/);
  const items = [];
  let info = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) {
      const attr = (name) => line.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] || "";
      info = { name: attr("tvg-name") || line.slice(line.lastIndexOf(",") + 1).trim(), group: attr("group-title") || "Outros", logo: attr("tvg-logo") };
    } else if (info && /^https?:\/\//i.test(line)) {
      items.push({ ...info, url: line }); info = null;
      if (items.length >= 500) break;
    }
  }
  return items;
}

async function playStream(url, name = "Reproduzindo") {
  if (!url) return;
  document.querySelector("#player-title").textContent = name;
  document.querySelector("#player-detail").textContent = "Fonte conectada pelo usuário";
  playerModal.classList.remove("hidden");
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  if (/\.m3u8($|\?)/i.test(url) && window.Hls?.isSupported()) {
    state.hls = new window.Hls({ maxBufferLength: 30, enableWorker: true });
    state.hls.loadSource(url);
    state.hls.attachMedia(video);
  } else {
    video.src = url;
  }
  video.play().catch(() => showToast("Pressione play para iniciar a reprodução."));
}

function closePlayer() {
  video.pause();
  video.removeAttribute("src");
  video.load();
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  playerModal.classList.add("hidden");
}

function afterConnected(payload) {
  state.source = payload.source;
  state.channels = payload.channels || [];
  state.movies = payload.movies || [];
  state.series = payload.series || [];
  localStorage.setItem("gate.lastSource", JSON.stringify({ type: state.source, connectedAt: new Date().toISOString(), counts: payload.counts || { live: state.channels.length } }));
  closeSource();
  navigate("/");
  showToast(`${state.channels.length} canais carregados com sucesso.`);
}

function bindForms() {
  document.querySelector("#xtream-form").addEventListener("submit", async (event) => {
    event.preventDefault(); setSourceStatus("Validando a fonte…");
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try { afterConnected(await api("/api/xtream/connect", { method: "POST", body: JSON.stringify(body) })); }
    catch (error) { setSourceStatus(error.message, "error"); }
  });
  document.querySelector("#m3u-form").addEventListener("submit", async (event) => {
    event.preventDefault(); setSourceStatus("Lendo a lista…");
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    try {
      if (file?.size) {
        if (file.size > 8_000_000) throw new Error("O arquivo deve ter no máximo 8 MB nesta versão.");
        const channels = parseLocalM3u(await file.text());
        if (!channels.length) throw new Error("Nenhum canal válido foi encontrado no arquivo.");
        afterConnected({ source: "m3u-file", channels });
      } else {
        afterConnected(await api("/api/m3u/parse", { method: "POST", body: JSON.stringify({ url: data.get("url") }) }));
      }
    } catch (error) { setSourceStatus(error.message, "error"); }
  });
  document.querySelector("#portal-form").addEventListener("submit", async (event) => {
    event.preventDefault(); setSourceStatus("Validando o portal…");
    try {
      const payload = await api("/api/portal/validate", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      setSourceStatus(payload.message, "success");
    } catch (error) { setSourceStatus(error.message, "error"); }
  });
  document.querySelector("#direct-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const url = new FormData(event.currentTarget).get("url");
    closeSource();
    playStream(url, "Link direto");
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
      result.innerHTML = `<strong>Solicitação criada</strong><p>MAC: ${escapeHtml(payload.mac)}<br>Protocolo: ${escapeHtml(payload.protocol)}</p>${payload.checkoutUrl ? `<a class="primary-button focusable" data-focusable href="${escapeHtml(payload.checkoutUrl)}" target="_blank" rel="noopener">Ir para pagamento</a>` : `<p>O pagamento online será liberado assim que a conta de cobrança for conectada.</p>`}`;
      refreshFocusable();
    } catch (error) {
      result.className = "result-box"; result.textContent = error.message;
    } finally { button.disabled = false; button.textContent = "Solicitar renovação anual"; }
  });
}

function bindDynamicActions() {
  main.querySelectorAll("[data-action=open-source]").forEach((button) => button.addEventListener("click", () => openSource(button.dataset.tab || "xtream")));
  main.querySelectorAll("[data-play-url]").forEach((button) => button.addEventListener("click", () => playStream(button.dataset.playUrl, button.dataset.playName)));
}

function getDeviceId() {
  let id = localStorage.getItem("gate.deviceId");
  if (!id) {
    id = `GT-${cryptoRandom(4)}-${cryptoRandom(4)}`;
    localStorage.setItem("gate.deviceId", id);
  }
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
    if (remaining <= 0) {
      clearInterval(timer); skip.disabled = false; skip.textContent = "Continuar"; skip.focus();
    }
  }, 1000);
  skip.addEventListener("click", () => { if (!skip.disabled) { overlay.classList.add("hidden"); sessionStorage.setItem("gate.adShown", "true"); refreshFocusable(); } }, { once: true });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-link]");
  if (link) { event.preventDefault(); navigate(link.getAttribute("href")); }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "open-source" && !event.target.closest("main")) openSource("xtream");
  if (action === "open-live") state.channels.length ? main.querySelector("[data-play-url]")?.focus() : openSource("xtream");
  if (action === "open-movies" || action === "open-series") state.source ? showToast("Catálogo conectado disponível na página inicial.") : openSource("xtream");
  if (action === "toggle-adfree") navigate("/renovar");
});
document.querySelectorAll("[data-source-tab]").forEach((tab) => tab.addEventListener("click", () => selectSourceTab(tab.dataset.sourceTab)));
document.querySelector(".close-modal").addEventListener("click", closeSource);
document.querySelector(".player-close").addEventListener("click", closePlayer);
window.addEventListener("popstate", route);
document.addEventListener("keydown", (event) => {
  const directions = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
  if (directions[event.key]) { event.preventDefault(); moveFocus(directions[event.key]); }
  if (event.key === "Escape" || event.key === "BrowserBack") {
    if (!playerModal.classList.contains("hidden")) closePlayer();
    else if (!sourceModal.classList.contains("hidden")) closeSource();
    else if (location.pathname !== "/") history.back();
  }
});

async function boot() {
  try { state.config = await api("/api/config"); } catch {}
  document.querySelector("#plan-status").textContent = state.adFree ? "Sem anúncios" : "Plano gratuito";
  bindForms(); route(); showAd();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}
boot();
