import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readFileSync } from "node:fs";

// Versao unica, lida do package.json — evita que os manifestos voltem a divergir.
const APP_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const [legacyHtml, shellHtml, androidHtml, css, bootstrap, remoteSafe, remote, runtime, server, docker, appinfo, bridge, platformPlayer] = await Promise.all([
  read("public/index-webos.html"),
  read("platforms/webos/index.html"),
  read("public/index-webos-android.html"),
  read("public/webos-safe.css"),
  read("public/webos-safe-bootstrap.js"),
  read("public/webos-remote-safe.js"),
  read("public/webos-remote.js"),
  read("public/webos-android-runtime.js"),
  read("server.mjs"),
  read("Dockerfile"),
  read("platforms/webos/appinfo.json"),
  read("platforms/webos/bridge.js"),
  read("public/platform-player.js")
]);

test("a variante webOS leve continua disponível como fallback", () => {
  assert.match(legacyHtml, /webos-safe\.css\?v=0\.6\.5/);
  assert.match(legacyHtml, /webos-safe-bootstrap\.js\?v=0\.6\.5/);
  assert.match(legacyHtml, /webos-remote-safe\.js\?v=0\.6\.5/);
  assert.match(legacyHtml, /platform-player\.js\?v=0\.6\.5[^]*app\.js\?v=0\.6\.5/);
  assert.doesNotMatch(legacyHtml, /tizen-loader\.js/);
  assert.match(platformPlayer, /requestedPlatform === "webos"/);
});

test("modo seguro legado remove cache antigo e mantém navegação leve", () => {
  assert.match(bootstrap, /getRegistrations/);
  assert.match(bootstrap, /gate\.adShown/);
  assert.match(remoteSafe, /childList:\s*true,\s*subtree:\s*true/);
  assert.doesNotMatch(remoteSafe, /attributeFilter/);
});

test("layout seguro preserva logos grandes sem efeitos pesados", () => {
  assert.match(css, /\.channel-logo[\s\S]*width:\s*70px/);
  assert.match(css, /\.live-channel-row[\s\S]*min-height:\s*90px/);
  assert.match(css, /\.catalog-grid[\s\S]*repeat\(4,/);
});

test("servidor mantém a variante LG disponível antes do middleware estático", () => {
  assert.match(server, /function servePlatformIndex/);
  assert.ok(server.indexOf('app.get("/", servePlatformIndex)') < server.indexOf('app.use(express.static'));
  assert.match(server, /api\/client-diagnostics/);
});

test("scripts usados em TVs antigas continuam convertidos para Chromium 79", () => {
  assert.match(docker, /public\/platform-player\.js/);
  assert.match(docker, /public\/webos-safe-bootstrap\.js/);
  assert.match(docker, /public\/webos-remote-safe\.js/);
});

test("o IPK publicado abre o layout Android TV na janela principal", () => {
  const info = JSON.parse(appinfo);
  assert.equal(info.version, APP_VERSION);
  assert.equal(info.supportTouchMode, "virtual");
  assert.ok(info.appDescription.length <= 60);
  assert.match(shellHtml, /http-equiv="refresh"/);
  assert.match(shellHtml, /index-webos-android\.html/);
  assert.match(shellHtml, /platform=androidtv/);
  assert.match(shellHtml, /runtime=webos/);
  assert.match(shellHtml, /nativePlayer=html5/);
  assert.match(shellHtml, /shellVersion=0\.7\.1/);
  assert.doesNotMatch(shellHtml, /<iframe/i);

  assert.match(bridge, /SHELL_VERSION = "0\.7\.1"/);
  assert.match(bridge, /APP_URL = "https:\/\/gate-iptv-player-production\.up\.railway\.app\/index-webos-android\.html"/);
  assert.match(bridge, /UI_PLATFORM = "androidtv"/);
  assert.match(bridge, /nativePlayer=html5/);
  assert.match(bridge, /location\.replace\(buildLaunchUrl/);
  assert.doesNotMatch(bridge, /contentWindow|postMessage|gate-webos-remote/);
});

test("runtime webOS desativa cache antigo e força MPEG-TS sem Worker", () => {
  assert.match(androidHtml, /web-ui\.css\?v=0\.7\.1/);
  assert.match(androidHtml, /ui-polish\.css\?v=0\.7\.1/);
  assert.match(androidHtml, /webos-android-runtime\.js\?v=0\.7\.1/);
  assert.match(androidHtml, /platform-player\.js\?v=0\.7\.1[^]*app\.js\?v=0\.7\.1/);
  assert.match(runtime, /getRegistrations/);
  assert.match(runtime, /Service Worker disabled on LG webOS runtime/);
  assert.match(runtime, /safeConfig\.enableWorker = false/);
  assert.match(runtime, /safeConfig\.lazyLoad = false/);
  assert.match(runtime, /gate\.adShown/);
});

test("controle LG atua diretamente no documento hospedado", () => {
  assert.match(remote, /runtimePlatform === "webos"/);
  assert.match(remote, /androidTvLayout/);
  assert.match(remote, /window\.addEventListener\("keydown", handleKeyDown/);
  assert.match(remote, /active\.click\(\)/);
  assert.doesNotMatch(shellHtml, /iframe/);
});
