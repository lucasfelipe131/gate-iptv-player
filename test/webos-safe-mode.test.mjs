import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("IPK 0.6.8 usa a tela Android TV e libera a inicialização em até três segundos", () => {
  const info = JSON.parse(appinfo);
  assert.equal(info.version, "0.6.8");
  assert.equal(info.supportTouchMode, "virtual");
  assert.match(shellHtml, /id="gate-app"/);
  assert.match(shellHtml, /<iframe/i);
  assert.match(shellHtml, /index-webos-android\.html/);
  assert.match(shellHtml, /platform=androidtv/);
  assert.match(shellHtml, /runtime=webos/);
  assert.match(shellHtml, /nativePlayer=html5/);
  assert.match(shellHtml, /shellVersion=0\.6\.8/);
  assert.match(shellHtml, /bridgeToken=gate-webos-0\.6\.8/);
  assert.match(shellHtml, /release-boot[^]*3s/);

  assert.match(bridge, /SHELL_VERSION = "0\.6\.8"/);
  assert.match(bridge, /APP_PATH = "\/index-webos-android\.html"/);
  assert.match(bridge, /UI_PLATFORM = "androidtv"/);
  assert.match(bridge, /nativePlayer=html5/);
  assert.match(bridge, /setTimeout\(markReady, 2800\)/);
  assert.match(bridge, /bootScreen\.style\.display = "none"/);
  assert.match(bridge, /bootScreen\.hidden = true/);
  assert.doesNotMatch(bridge, /location\.replace/);
});

test("runtime webOS desativa cache antigo e força MPEG-TS sem Worker", () => {
  assert.match(androidHtml, /web-ui\.css\?v=0\.6\.8/);
  assert.match(androidHtml, /ui-polish\.css\?v=0\.6\.8/);
  assert.match(androidHtml, /webos-android-runtime\.js\?v=0\.6\.8/);
  assert.match(androidHtml, /platform-player\.js\?v=0\.6\.8[^]*app\.js\?v=0\.6\.8/);
  assert.match(runtime, /getRegistrations/);
  assert.match(runtime, /Service Worker disabled on LG webOS runtime/);
  assert.match(runtime, /safeConfig\.enableWorker = false/);
  assert.match(runtime, /safeConfig\.lazyLoad = false/);
  assert.match(runtime, /gate-webos-ready/);
  assert.match(runtime, /gate\.adShown/);
});

test("controle LG continua encaminhado para o layout Android TV", () => {
  assert.match(remote, /runtimePlatform === "webos"/);
  assert.match(remote, /androidTvLayout/);
  assert.match(remote, /event\.source !== window\.parent/);
  assert.match(remote, /dispatchBridgedKey/);
  assert.match(remote, /window\.dispatchEvent\(synthetic\)/);
  assert.match(bridge, /gate-webos-remote/);
});
