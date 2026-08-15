import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = fs.readFileSync(path.join(root, "public/platform-player.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const loader = fs.readFileSync(path.join(root, "public/tizen-loader.js"), "utf8");

test("carrega o adaptador de plataforma antes do núcleo compartilhado", () => {
  assert.match(loader, /\$WEBAPIS\/webapis\/webapis\.js/);
  assert.match(html, /tizen-loader\.js[^]*platform-player\.js/);
  assert.match(html, /platform-player\.js[^]*app\.js/);
});

test("Tizen usa AVPlay e recupera fim ou congelamento sem sair do canal", () => {
  assert.match(script, /global\.webapis\?\.avplay/);
  assert.match(script, /onstreamcompleted\(\)[^]*retry\(/);
  assert.match(script, /oncurrentplaytime\(\)/);
  assert.match(script, /STALL_TIMEOUT_MS = 18_000/);
  assert.match(script, /avplay\.prepareAsync/);
  assert.match(script, /PLAYER_DISPLAY_MODE_LETTER_BOX/);
});

test("Tizen mantém rotas primária e reserva com tentativas limitadas", () => {
  assert.match(script, /RETRY_LIMIT_PER_ROUTE = 2/);
  assert.match(script, /\[primaryUrl, fallbackUrl\]/);
  assert.match(script, /target\.routeIndex = \(target\.routeIndex \+ 1\) % target\.urls\.length/);
});

test("callbacks e retries de um canal antigo não interferem no canal novo", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://gate.test/?platform=tizen",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  const openCalls = [];
  const listeners = [];
  const preparations = [];
  let playCalls = 0;
  window.webapis = { avplay: {
    getState: () => "IDLE",
    stop() {},
    close() {},
    open(url) { openCalls.push(url); },
    setDisplayRect() {},
    setDisplayMethod() {},
    setStreamingProperty() {},
    setListener(listener) { listeners.push(listener); },
    prepareAsync(success, failure) { preparations.push({ success, failure }); },
    play() { playCalls += 1; }
  } };
  window.eval(script);

  window.GateNativePlayer.playFullscreen("https://provider.test/old.ts", "https://provider.test/old-fallback.ts", "Antigo", "mpegts");
  listeners[0].onerror();
  window.GateNativePlayer.playFullscreen("https://provider.test/new.ts", "", "Novo", "mpegts");
  preparations[0].success();
  await new Promise((resolve) => setTimeout(resolve, 760));

  assert.deepEqual(openCalls, ["https://provider.test/old.ts", "https://provider.test/new.ts"]);
  assert.equal(playCalls, 0, "prepareAsync antigo não deve iniciar o canal novo");
  preparations[1].success();
  assert.equal(playCalls, 1);

  window.GateNativePlayer.close();
  listeners[1].onerror();
  await new Promise((resolve) => setTimeout(resolve, 760));
  assert.equal(openCalls.length, 2, "retry pendente deve ser cancelado ao fechar");
  dom.window.close();
});
