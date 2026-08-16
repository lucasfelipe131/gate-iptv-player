import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const [html, shellHtml, css, bootstrap, remoteSafe, remote, server, docker, appinfo, bridge, platformPlayer] = await Promise.all([
  read("public/index-webos.html"),
  read("platforms/webos/index.html"),
  read("public/webos-safe.css"),
  read("public/webos-safe-bootstrap.js"),
  read("public/webos-remote-safe.js"),
  read("public/webos-remote.js"),
  read("server.mjs"),
  read("Dockerfile"),
  read("platforms/webos/appinfo.json"),
  read("platforms/webos/bridge.js"),
  read("public/platform-player.js")
]);

test("a variante webOS leve continua disponível como fallback", () => {
  assert.match(html, /webos-safe\.css\?v=0\.6\.5/);
  assert.match(html, /webos-safe-bootstrap\.js\?v=0\.6\.5/);
  assert.match(html, /webos-remote-safe\.js\?v=0\.6\.5/);
  assert.match(html, /platform-player\.js\?v=0\.6\.5[^]*app\.js\?v=0\.6\.5/);
  assert.doesNotMatch(html, /tizen-loader\.js/);
  assert.doesNotMatch(html, /web-ui\.css/);
  assert.doesNotMatch(html, /ui-polish\.css/);
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

test("IPK 0.6.7 abre o mesmo layout Android TV e não intercepta canais com ponte inexistente", () => {
  const info = JSON.parse(appinfo);
  assert.equal(info.version, "0.6.7");
  assert.equal(info.supportTouchMode, "virtual");
  assert.match(shellHtml, /id="gate-app"/);
  assert.match(shellHtml, /<iframe/i);
  assert.match(shellHtml, /platform=androidtv/);
  assert.match(shellHtml, /runtime=webos/);
  assert.match(shellHtml, /layout=androidtv/);
  assert.match(shellHtml, /nativePlayer=html5/);
  assert.match(shellHtml, /shellVersion=0\.6\.7/);
  assert.match(shellHtml, /bridgeToken=gate-webos-0\.6\.7/);
  assert.match(bridge, /SHELL_VERSION = "0\.6\.7"/);
  assert.match(bridge, /UI_PLATFORM = "androidtv"/);
  assert.match(bridge, /nativePlayer=html5/);
  assert.doesNotMatch(bridge, /gate-native-player/);
});

test("controle LG entra no iframe e a abertura não fica presa no botão", () => {
  assert.match(shellHtml, /id="boot-screen"/);
  assert.match(shellHtml, /id="retry"[^>]*class="hidden"|class="hidden"[^>]*id="retry"/);
  assert.match(bridge, /READY_TIMEOUT_MS = 20000/);
  assert.match(bridge, /frame\.addEventListener\("load"/);
  assert.match(bridge, /setTimeout\(markReady, 850\)/);
  assert.match(bridge, /if \(!ready && navigator\.onLine !== false\) markReady\(\)/);
  assert.match(bridge, /gate-webos-remote/);
  assert.match(remote, /runtimePlatform === "webos"/);
  assert.match(remote, /event\.source !== window\.parent/);
  assert.match(remote, /dispatchBridgedKey/);
  assert.match(remote, /window\.dispatchEvent\(synthetic\)/);
  assert.match(remote, /androidTvLayout/);
});
