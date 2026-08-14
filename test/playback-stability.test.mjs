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
  assert.match(appScript, /stashInitialSize: session\.preview \? 3 \* 1024 \* 1024 : 8 \* 1024 \* 1024/);
  assert.match(appScript, /maxBufferLength: preview \? 60 : 120/);
  assert.match(appScript, /starvationLimit = preview \? 45_000 : 60_000/);
  assert.match(appScript, /Mantendo o canal aberto e procurando uma rota estável/);
});
