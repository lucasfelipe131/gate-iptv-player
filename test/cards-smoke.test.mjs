import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const appScript = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

const reply = (payload, ok = true) => ({ ok, json: async () => payload });
const waitFor = async (check, timeout = 1500) => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error("A interface não terminou de carregar os cards.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test("carrega logos, capas, EPG e paginação automática no layout de TV", async () => {
  const dom = new JSDOM(html, {
    url: "https://gate.test/?platform=androidtv",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.sessionStorage.setItem("gate.adShown", "true");
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLMediaElement.prototype.play = async () => {};
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLMediaElement.prototype.load = () => {};
  Object.defineProperty(window.HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return this.parentNode ? window.document.body : null; }
  });

  let xtreamConnectBody = null;
  const catalogRequests = [];
  window.fetch = async (input, options = {}) => {
    const pathname = new URL(String(input), window.location.href).pathname;
    if (pathname === "/api/config") return reply({ annualPrice: 30, adDurationSeconds: 10, paymentAvailable: false });
    if (pathname === "/api/xtream/connect") {
      xtreamConnectBody = JSON.parse(options.body || "{}");
      return reply({
        source: "xtream",
        sessionId: "test-session",
        account: { status: "active", expiresAt: "2026-12-31T12:00:00.000Z" },
        counts: { live: 90, movies: 2, series: 2 },
        channels: Array.from({ length: 90 }, (_, index) => ({
          id: String(index + 1),
          name: `Canal ${index + 1}`,
          group: index % 2 ? "Esportes" : "Notícias",
          logo: `https://img.test/channel-${index + 1}.png`,
          playUrl: `https://media.test/channel-${index + 1}.m3u8`,
          streamType: "hls"
        }))
      });
    }
    if (pathname === "/api/xtream/epg") {
      const streamIds = JSON.parse(options.body || "{}").streamIds || [];
      return reply({ items: Object.fromEntries(streamIds.map((id) => [id, {
        current: { title: `Programa atual ${id}`, description: `Descrição do programa ${id}`, start: "2026-08-02T18:00:00.000Z", end: "2026-08-02T19:00:00.000Z" },
        next: { title: `Próximo programa ${id}`, start: "2026-08-02T19:00:00.000Z", end: "2026-08-02T20:00:00.000Z" }
      }])) });
    }
    if (pathname === "/api/xtream/catalog") {
      const requestedKind = JSON.parse(options.body || "{}").kind;
      catalogRequests.push(requestedKind);
      const isMovies = requestedKind === "movies";
      return reply(isMovies ? {
        total: 2,
        items: [
          { id: "101", name: "Filme Um", group: "Ação", description: "Uma missão perigosa muda o destino de uma equipe.", logo: "https://img.test/movie-1.jpg", playUrl: "https://media.test/movie-1.m3u8", streamType: "hls" },
          { id: "102", name: "Filme Dois", group: "Drama", description: "Duas famílias enfrentam escolhas que transformam suas vidas.", logo: "https://img.test/movie-2.jpg", playUrl: "https://media.test/movie-2.m3u8", streamType: "hls" }
        ]
      } : {
        total: 2,
        items: [
          { id: "10", name: "Série Um", group: "Drama", description: "Uma investigadora retorna à cidade onde tudo começou.", logo: "https://img.test/series-1.jpg", seriesId: "10", sessionId: "test-session" },
          { id: "20", name: "Série Dois", group: "Comédia", description: "Amigos tentam salvar um pequeno negócio de bairro.", logo: "https://img.test/series-2.jpg", seriesId: "20", sessionId: "test-session" }
        ]
      });
    }
    if (pathname === "/api/xtream/series") {
      return reply({
        name: "Série Um",
        description: "Uma investigadora retorna à cidade onde tudo começou.",
        episodes: [
          { id: "1001", name: "Episódio 1", group: "Temporada 1", description: "O começo da investigação.", logo: "https://img.test/series-1.jpg", playUrl: "https://media.test/episode-1.m3u8", streamType: "hls" }
        ]
      });
    }
    if (pathname === "/api/xtream/details") {
      const request = JSON.parse(options.body || "{}");
      if (request.kind === "series") return reply({
        description: "Uma investigadora retorna à cidade onde tudo começou.",
        firstEpisode: { id: "1001", name: "Episódio 1", group: "Temporada 1", playUrl: "https://media.test/episode-1.m3u8", streamType: "hls" }
      });
      return reply({ description: "Uma missão perigosa muda o destino de uma equipe." });
    }
    return reply({ error: "Rota de teste não preparada" }, false);
  };

  window.eval(appScript);
  await waitFor(() => window.document.querySelector("#xtream-form"));
  assert.equal(window.document.body.classList.contains("tv-optimized"), true);
  assert.equal(window.document.documentElement.dataset.platform, "tv");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const form = window.document.querySelector("#xtream-form");
  form.elements.serverUrl.value = "provider.test:8080/get.php?username=teste&password=segredo&type=m3u_plus";
  form.elements.username.value = "";
  form.elements.password.value = "";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  await waitFor(() => window.document.querySelectorAll(".library-launch").length === 4);
  assert.deepEqual(xtreamConnectBody, { serverUrl: "http://provider.test:8080", username: "teste", password: "segredo" });
  assert.match(window.document.querySelector(".account-expiry strong").textContent, /2026/);
  await waitFor(() => Boolean(window.localStorage.getItem("gate.cache.session")));
  assert.equal(JSON.parse(window.localStorage.getItem("gate.cache.session")).descriptor.type, "xtream");

  await waitFor(() => /2 filmes/.test(window.document.querySelector(".movies-launch small")?.textContent || ""));
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.deepEqual(catalogRequests, [], "a TV não deve baixar catálogos grandes antes de o usuário abri-los");
  window.document.querySelector(".movies-launch").click();
  await waitFor(() => window.document.querySelectorAll(".poster-grid .media-card").length === 2);
  assert.deepEqual(catalogRequests, ["movies"]);
  assert.equal(window.document.querySelectorAll(".poster-grid .media-card.has-image").length, 2);
  assert.equal(window.document.querySelectorAll(".poster-grid .card-artwork").length, 2);
  assert.equal(window.document.querySelector(".poster-grid .media-card strong").textContent, "Filme Um");
  assert.match(window.document.querySelector(".poster-grid .card-synopsis").textContent, /missão perigosa/);
  window.document.querySelector(".poster-grid .media-card").click();
  assert.equal(window.document.querySelector("#details-modal").classList.contains("hidden"), false);
  assert.equal(window.document.querySelector("#player-modal").classList.contains("hidden"), true);
  assert.equal(window.document.querySelector("#details-primary").textContent, "Assistir agora");
  window.document.querySelector("#details-favorite").click();
  assert.deepEqual(JSON.parse(window.localStorage.getItem("gate.favorites.v1")), ["movies:101"]);
  window.document.querySelector("#details-primary").click();
  assert.equal(window.document.querySelector("#details-modal").classList.contains("hidden"), true);
  assert.equal(window.document.querySelector("#player-modal").classList.contains("hidden"), false);
  assert.equal(window.document.querySelector("#player-modal").classList.contains("player-modal-immersive"), true);
  window.document.querySelector(".player-close").click();
  window.document.querySelector("[data-action='go-home']").click();

  window.document.querySelector(".series-launch").click();
  await waitFor(() => window.document.querySelectorAll(".poster-grid .media-card").length === 2);
  assert.deepEqual(catalogRequests, ["movies", "series"]);
  window.document.querySelector(".poster-grid .media-card").click();
  assert.equal(window.document.querySelector("#details-primary").textContent, "Assistir episódio 1");
  window.document.querySelector("#details-primary").click();
  await waitFor(() => /Episódio 1/.test(window.document.querySelector("#player-title").textContent));
  assert.match(window.document.querySelector("#player-title").textContent, /Episódio 1/);
  window.document.querySelector(".player-close").click();
  window.document.querySelector("[data-action='go-home']").click();

  window.document.querySelector(".live-launch").click();
  await waitFor(() => window.document.querySelectorAll(".live-channel-row").length === 60);
  assert.equal(window.document.querySelectorAll(".channel-logo img").length, 60);
  const firstChannel = window.document.querySelector(".live-channel-row");
  firstChannel.click();
  await waitFor(() => /Canal 1/.test(window.document.querySelector("[data-live-preview-name]")?.textContent || ""));
  await waitFor(() => /Programa atual 1/.test(window.document.querySelector("[data-epg-now-title]")?.textContent || ""));
  assert.match(window.document.querySelector("[data-epg-next-title]").textContent, /Próximo programa 1/);
  assert.equal(window.document.querySelectorAll(".fullscreen-button").length, 0);
  await new Promise((resolve) => setTimeout(resolve, 450));
  firstChannel.click();
  assert.equal(window.document.querySelector(".live-preview-stage").classList.contains("live-preview-immersive"), true);
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(window.document.querySelector(".live-preview-stage").classList.contains("live-preview-immersive"), false);
  assert.equal(window.document.querySelector(".live-layout") !== null, true);
  assert.equal(window.document.querySelectorAll("[data-action='load-more']").length, 0);
  const firstPage = [...window.document.querySelectorAll(".live-channel-row")];
  firstPage.at(-1).focus();
  await waitFor(() => window.document.querySelectorAll(".live-channel-row").length === 90);
  assert.equal(window.document.querySelectorAll("[data-auto-load]").length, 0);
  window.document.querySelector("[data-action='go-home']").click();
  assert.match(window.document.querySelector(".favorites-launch small").textContent, /1 item salvo/);
  window.document.querySelector(".favorites-launch").click();
  assert.equal(window.document.querySelectorAll(".media-card.is-favorite").length, 1);
  assert.equal(window.document.querySelector(".media-card.is-favorite strong").textContent, "Filme Um");
  dom.window.close();
});

test("adapta o mesmo núcleo para navegador e invólucro Android comum", async () => {
  const dom = new JSDOM(html, {
    url: "https://gate.test/?platform=android",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.sessionStorage.setItem("gate.adShown", "true");
  window.fetch = async () => reply({ annualPrice: 30, adDurationSeconds: 10, paymentAvailable: false });
  Object.defineProperty(window.HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return this.parentNode ? window.document.body : null; }
  });

  window.eval(appScript);
  await waitFor(() => window.document.querySelector(".web-landing"));
  assert.equal(window.document.querySelector(".web-dashboard-grid"), null);
  assert.equal(window.document.body.classList.contains("browser-mode"), true);
  assert.equal(window.document.body.classList.contains("android-wrapper"), true);
  assert.equal(window.document.body.classList.contains("tv-optimized"), false);
  assert.equal(window.document.documentElement.dataset.platform, "android-app");
  dom.window.close();
});

test("reconexão silenciosa preserva a página de assinatura", async () => {
  const dom = new JSDOM(html, {
    url: "https://gate.test/assinar",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.sessionStorage.setItem("gate.adShown", "true");
  window.localStorage.setItem("gate.cache.session", JSON.stringify({
    source: "xtream",
    account: { status: "active", expiresAt: "2026-12-31T12:00:00.000Z" },
    sessionId: "saved-session",
    counts: { live: 1, movies: 0, series: 0 },
    channels: [{ id: "1", name: "Canal salvo", playUrl: "/api/stream/saved" }],
    movies: [],
    series: [],
    descriptor: { type: "xtream", serverUrl: "https://provider.test", username: "user", password: "pass" }
  }));
  window.fetch = async (input) => {
    const pathname = new URL(String(input), window.location.href).pathname;
    if (pathname === "/api/config") return reply({ annualPrice: 30, paymentAvailable: false });
    if (pathname === "/api/xtream/connect") return reply({
      source: "xtream",
      account: { status: "active", expiresAt: "2026-12-31T12:00:00.000Z" },
      sessionId: "renewed-session",
      counts: { live: 1, movies: 0, series: 0 },
      channels: [{ id: "1", name: "Canal renovado", playUrl: "/api/stream/renewed" }]
    });
    return reply({ error: "Rota não preparada" }, false);
  };
  Object.defineProperty(window.HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return this.parentNode ? window.document.body : null; }
  });

  window.eval(appScript);
  await waitFor(() => Boolean(window.document.querySelector("[data-payment-unavailable]")));
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(window.location.pathname, "/assinar");
  assert.equal(window.document.querySelector(".premium-price strong").textContent.replace(/\s+/g, " ").trim(), "R$ 30");
  assert.equal(window.document.querySelector(".web-dashboard-grid"), null);
  dom.window.close();
});

test("usa a ponte nativa no APK sem abrir uma segunda conexão no WebView", async () => {
  const dom = new JSDOM(html, {
    url: "https://gate.test/?platform=androidtv",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.sessionStorage.setItem("gate.adShown", "true");
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLMediaElement.prototype.play = async () => {};
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLMediaElement.prototype.load = () => {};
  Object.defineProperty(window.HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return this.parentNode ? window.document.body : null; }
  });

  const nativeCalls = { preview: [], fullscreen: 0, close: 0 };
  window.GateNativePlayer = {
    preview(...args) { nativeCalls.preview.push(args); },
    playFullscreen() {},
    fullscreen() { nativeCalls.fullscreen += 1; },
    resizePreview() {},
    close() { nativeCalls.close += 1; }
  };
  window.fetch = async (input, options = {}) => {
    const pathname = new URL(String(input), window.location.href).pathname;
    if (pathname === "/api/config") return reply({ annualPrice: 30, adDurationSeconds: 10 });
    if (pathname === "/api/xtream/connect") return reply({
      source: "xtream",
      sessionId: "native-session",
      counts: { live: 1, movies: 0, series: 0 },
      channels: [{ id: "7", name: "Canal Nativo", group: "Teste", playUrl: "/api/stream/token", fallbackPlayUrl: "/api/stream/token-ts", streamType: "hls", fallbackStreamType: "mpegts" }]
    });
    if (pathname === "/api/xtream/epg") return reply({ items: { 7: {} } });
    if (pathname === "/api/xtream/catalog") return reply({ total: 0, items: [] });
    return reply({ error: "Rota de teste não preparada" }, false);
  };

  window.eval(appScript);
  await waitFor(() => window.document.querySelector(".hero"));
  assert.equal(window.document.body.classList.contains("native-player"), true);
  const form = window.document.querySelector("#xtream-form");
  form.elements.serverUrl.value = "provider.test";
  form.elements.username.value = "user";
  form.elements.password.value = "pass";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => window.document.querySelector(".live-launch"));
  window.document.querySelector(".live-launch").click();
  await waitFor(() => window.document.querySelector(".live-channel-row"));
  const channel = window.document.querySelector(".live-channel-row");
  channel.click();
  await waitFor(() => nativeCalls.preview.length === 1);
  assert.match(nativeCalls.preview[0][0], /\/api\/stream\/token\?direct=1$/);
  assert.match(nativeCalls.preview[0][1], /\/api\/stream\/token-ts\?direct=1$/);
  assert.equal(window.document.querySelector("#live-preview-video").getAttribute("src"), null);
  await new Promise((resolve) => setTimeout(resolve, 450));
  channel.click();
  assert.equal(nativeCalls.fullscreen, 1);
  dom.window.close();
});
