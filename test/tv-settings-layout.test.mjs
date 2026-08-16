import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const [html, webosHtml, app, polish, webosCss, webosRemote, android] = await Promise.all([
  read("public/index.html"),
  read("public/index-webos.html"),
  read("public/app.js"),
  read("public/ui-polish.css"),
  read("public/webos-safe.css"),
  read("public/webos-remote-safe.js"),
  read("platforms/android-native/app/src/main/java/com/gateone/app/gateiptvplayer/MainActivity.java")
]);

test("seleção de conteúdo usa a largura total e mantém uma volta clara", () => {
  assert.match(app, /classList\.toggle\("catalog-focus-view", focusedBrowse\)/);
  assert.match(app, /class="round-action browse-back focusable" data-action="go-home"/);
  assert.match(polish, /catalog-focus-view \.sidebar \{ display: none !important; \}/);
  assert.match(polish, /catalog-focus-view \.app-shell \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(polish, /catalog-focus-view \.live-layout[\s\S]*240px 650px/);
  assert.match(polish, /min-width:\s*2500px[\s\S]*catalog-focus-view \.live-layout[\s\S]*390px 920px/);
});

test("QR fica na home ou dentro de configurações e não polui a barra lateral", () => {
  const sidebar = html.match(/<aside class="sidebar"[\s\S]*?<\/aside>/)?.[0] || "";
  assert.doesNotMatch(sidebar, /data-action="open-pairing"/);
  assert.doesNotMatch(sidebar, /data-action="open-source"/);
  assert.match(sidebar, /data-action="open-tv-settings"/);
  assert.match(app, /const pairing = homeView \? `[\s\S]*data-action="open-pairing"/);
  assert.match(html, /data-action="settings-open-pairing"/);
  assert.match(html, /data-action="settings-open-source"/);
});

test("central reúne motor, qualidade, formato, tamanho e autostart", () => {
  for (const page of [html, webosHtml]) {
    assert.match(page, /id="tv-settings-modal"/);
    assert.match(page, /data-action="set-player-engine"/);
    assert.match(page, /data-action="set-quality-mode"/);
    assert.match(page, /data-action="set-video-fit"/);
    assert.match(page, /data-action="set-screen-size"/);
    assert.match(page, /Máxima · até 4K/);
  }
  assert.match(html, /id="autostart-toggle"/);
  assert.match(app, /applyVisualPlayerSettings/);
  assert.match(polish, /data-video-fit="zoom"/);
  assert.match(polish, /data-screen-size="90"/);
  assert.match(webosCss, /tv-settings-sections/);
  assert.match(webosRemote, /"tv-settings-modal"/);
});

test("web alterna motores por rota e preserva recuperação automática", () => {
  assert.match(app, /function webEngineOrder\(candidate\)/);
  assert.match(app, /\["native", "hlsjs"\]/);
  assert.match(app, /\["hlsjs", "native"\]/);
  assert.match(app, /session\.engineIndex \+ 1 < engines\.length/);
  assert.match(app, /applyHlsQualityPreference\(hls\)/);
  assert.match(app, /hls\.autoLevelCapping/);
  assert.match(app, /surfaceResetCount/);
});

test("Android expõe preferências e mantém fallback Media3 e LibVLC", () => {
  assert.match(android, /getPreferredEngine\(\)/);
  assert.match(android, /setPreferredEngine\(String value\)/);
  assert.match(android, /getQualityMode\(\)/);
  assert.match(android, /setQualityMode\(String value\)/);
  assert.match(android, /getVideoFit\(\)/);
  assert.match(android, /setVideoFit\(String value\)/);
  assert.match(android, /getScreenSize\(\)/);
  assert.match(android, /setScreenSize\(String value\)/);
  assert.match(android, /"vlc"\.equals\(preferredEngine\)/);
  assert.match(android, /attempts\.add\(vlcCompatible\)[\s\S]*attempts\.add\(media3Fast\)/);
  assert.match(android, /setMaxVideoSize\(1920, 1080\)/);
  assert.match(android, /RESIZE_MODE_ZOOM/);
  assert.match(android, /RESIZE_MODE_FILL/);
  assert.match(android, /params\.gravity = Gravity\.CENTER/);
});
