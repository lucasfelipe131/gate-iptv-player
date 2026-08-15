import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const appScript = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const workerScript = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");

const reply = (payload, ok = true) => ({ ok, json: async () => payload });

test("prioriza o proxy web e não reinicia uma transmissão saudável aos 20 segundos", async () => {
  const dom = new JSDOM(html, {
    url: "https://gate.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.sessionStorage.setItem("gate.adShown", "true");
  window.fetch = async () => reply({ annualPrice: 30, adDurationSeconds: 10 });
  window.HTMLMediaElement.prototype.play = async () => {};
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLMediaElement.prototype.load = () => {};

  let now = 1_000;
  let watchdog = null;
  let createCount = 0;
  const handlers = new Map();
  window.Date.now = () => now;
  window.setInterval = (callback) => { watchdog = callback; return 1; };
  window.clearInterval = () => {};
  window.mpegts = {
    isSupported: () => true,
    Events: { ERROR: "error", STATISTICS_INFO: "stats" },
    createPlayer(source) {
      createCount += 1;
      assert.equal(source.url, "https://gate.test/api/stream/test-token");
      return {
        attachMediaElement() {},
        load() {},
        play: async () => {},
        pause() {},
        unload() {},
        detachMediaElement() {},
        destroy() {},
        on(name, callback) { handlers.set(name, callback); }
      };
    }
  };

  window.eval(`${appScript}\nwindow.__gatePlaybackTest = { startWebPlayback, streamCandidates };`);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const video = window.document.querySelector("#video-player");
  Object.defineProperty(video, "paused", { configurable: true, get: () => false });
  Object.defineProperty(video, "readyState", { configurable: true, get: () => 4 });
  Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 0 });
  Object.defineProperty(video, "buffered", {
    configurable: true,
    value: { length: 1, start: () => 0, end: () => 60 }
  });

  const candidates = window.__gatePlaybackTest.streamCandidates({
    playUrl: "/api/stream/test-token",
    streamType: "mpegts"
  });
  assert.equal(candidates[0].direct, false);
  assert.equal(candidates[1].direct, true);

  window.__gatePlaybackTest.startWebPlayback(video, {
    playUrl: "/api/stream/test-token",
    streamType: "mpegts"
  });
  video.dispatchEvent(new window.Event("playing"));
  handlers.get("stats")?.({ decodedFramesDelta: 25 });
  now += 21_000;
  watchdog();

  assert.equal(createCount, 1, "o watchdog não deve recriar um fluxo que ainda tem buffer");
  dom.window.close();
});

test("service worker nunca intercepta nem armazena streams e APIs ao vivo", () => {
  assert.match(workerScript, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(workerScript, /event\.request\.headers\.has\("range"\)/);
  assert.doesNotMatch(workerScript, /gate-player-v12/);
});

test("usa reservas maiores e não encerra o canal quando todas as rotas oscilam", () => {
  assert.match(appScript, /stashInitialSize: session\.preview \? 1024 \* 1024 : 3 \* 1024 \* 1024/);
  assert.match(appScript, /maxBufferLength: preview \? Math\.min\(20, buffer\.target\) : buffer\.target/);
  assert.match(appScript, /starvationLimit = preview \? 15_000 : 22_000/);
  assert.match(appScript, /Mantendo o canal aberto e procurando uma rota estável/);
});

test("reconecta quando um servidor encerra silenciosamente o fluxo depois de já iniciado", () => {
  assert.match(appScript, /listen\("ended"[^]*if \(!session\.live\)/);
  assert.match(appScript, /retryWebCandidate\(session, "O servidor encerrou o sinal/);
  assert.match(appScript, /unexpectedPauseAt > \(preview \? 6_000 : 9_000\)/);
  assert.match(appScript, /session\.userPaused/);
  assert.match(appScript, /\["LOADING_COMPLETE", "RECOVERED_EARLY_EOF"\]/);
  assert.match(appScript, /O servidor encerrou o fluxo\. Reconectando o mesmo canal/);
});

test("encerra VOD normalmente sem reabrir o filme ou episódio", async () => {
  const dom = new JSDOM(html, {
    url: "https://gate.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.sessionStorage.setItem("gate.adShown", "true");
  window.fetch = async () => reply({ annualPrice: 30, adDurationSeconds: 10, paymentAvailable: false });
  window.HTMLMediaElement.prototype.play = async () => {};
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLMediaElement.prototype.load = () => {};
  window.eval(`${appScript}\nwindow.__gatePlaybackTest = { startWebPlayback, state };`);
  await new Promise((resolve) => setTimeout(resolve, 25));

  const media = window.document.querySelector("#video-player");
  const session = window.__gatePlaybackTest.startWebPlayback(media, {
    playUrl: "/api/stream/vod-token",
    streamType: "video",
    live: false
  });
  media.dispatchEvent(new window.Event("playing"));
  media.dispatchEvent(new window.Event("ended"));
  await new Promise((resolve) => setTimeout(resolve, 760));

  assert.equal(session.completed, true);
  assert.equal(session.destroyed, false);
  assert.equal(session.index, 0);
  assert.equal(window.__gatePlaybackTest.state.webPlayer, session);
  assert.equal(window.document.querySelector("#player-status-text").textContent, "Reprodução concluída.");
  dom.window.close();
});

test("simula encerramento aos cinco minutos e reabre o mesmo canal automaticamente", async () => {
  const dom = new JSDOM(html, {
    url: "https://gate.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.sessionStorage.setItem("gate.adShown", "true");
  window.fetch = async () => reply({ annualPrice: 30, adDurationSeconds: 10 });

  let paused = false;
  let ended = false;
  let currentTime = 0;
  let createCount = 0;
  window.HTMLMediaElement.prototype.play = async () => {};
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLMediaElement.prototype.load = () => {};
  window.mpegts = {
    isSupported: () => true,
    Events: {
      ERROR: "error",
      STATISTICS_INFO: "stats",
      LOADING_COMPLETE: "complete",
      RECOVERED_EARLY_EOF: "early-eof"
    },
    createPlayer() {
      createCount += 1;
      return {
        attachMediaElement() {},
        load() {},
        play: async () => {},
        pause() {},
        unload() {},
        detachMediaElement() {},
        destroy() {},
        on() {}
      };
    }
  };

  window.eval(`${appScript}\nwindow.__gatePlaybackTest = { startWebPlayback };`);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const media = window.document.querySelector("#video-player");
  Object.defineProperties(media, {
    paused: { configurable: true, get: () => paused },
    ended: { configurable: true, get: () => ended },
    currentTime: { configurable: true, get: () => currentTime },
    readyState: { configurable: true, get: () => paused ? 2 : 4 }
  });

  window.__gatePlaybackTest.startWebPlayback(media, {
    playUrl: "/api/stream/five-minute-token",
    streamType: "mpegts"
  });
  media.dispatchEvent(new window.Event("playing"));
  for (let second = 1; second <= 300; second += 1) {
    currentTime = second;
    media.dispatchEvent(new window.Event("timeupdate"));
  }
  assert.equal(createCount, 1, "a transmissão saudável não deve ser recriada durante os cinco minutos");

  paused = true;
  ended = true;
  media.dispatchEvent(new window.Event("ended"));
  await new Promise((resolve) => setTimeout(resolve, 760));
  assert.equal(createCount, 2, "o mesmo canal deve abrir uma nova conexão após o encerramento do servidor");
  dom.window.close();
});

test("limita o buffer de Smart TVs para evitar pressão de memória após vários minutos", () => {
  assert.match(appScript, /const TV_STREAM_BUFFER = Object\.freeze/);
  assert.match(appScript, /maximum: 60/);
  assert.match(appScript, /maxBufferSize: constrainedTv \? 48 \* 1024 \* 1024/);
  assert.match(appScript, /autoCleanupMaxBackwardDuration: 30/);
  assert.match(appScript, /liveBufferLatencyChasing: true/);
});

test("inicia a prévia web em modo compatível com autoplay e recupera início pausado", () => {
  assert.match(appScript, /<video id="live-preview-video" playsinline muted autoplay>/);
  assert.match(appScript, /session\.media\.muted = true/);
  assert.match(appScript, /now - session\.lastPlayAttemptAt >= 2_500/);
  assert.match(appScript, /startupLimit = preview \? 18_000 : 35_000/);
  assert.doesNotMatch(appScript, /session\.switching \|\| media\.paused \|\| document\.hidden/);
});

test("sair da tela cheia volta à lista de canais sem retornar à home", () => {
  assert.match(appScript, /live-preview-stage\.live-preview-immersive/);
  assert.match(appScript, /backPressed && \(document\.fullscreenElement \|\| document\.webkitFullscreenElement \|\| liveFullscreen\)/);
  assert.match(appScript, /document\.exitFullscreen\(\)\.catch/);
  assert.match(appScript, /document\.body\.classList\.remove\("live-preview-open"\)/);
});
