import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const [html, shellHtml, css, bootstrap, remote, server, docker, appinfo, bridge, platformPlayer] = await Promise.all([
  read("public/index-webos.html"),
  read("platforms/webos/index.html"),
  read("public/webos-safe.css"),
  read("public/webos-safe-bootstrap.js"),
  read("public/webos-remote-safe.js"),
  read("server.mjs"),
  read("Dockerfile"),
  read("platforms/webos/appinfo.json"),
  read("platforms/webos/bridge.js"),
  read("public/platform-player.js")
]);

test("LG recebe HTML leve e conecta somente o adaptador nativo necessário", () => {
  assert.match(html, /webos-safe\.css\?v=0\.6\.5/);
  assert.match(html, /webos-safe-bootstrap\.js\?v=0\.6\.5/);
  assert.match(html, /webos-remote-safe\.js\?v=0\.6\.5/);
  assert.match(html, /platform-player\.js\?v=0\.6\.5[^]*app\.js\?v=0\.6\.5/);
  assert.doesNotMatch(html, /tizen-loader\.js/);
  assert.doesNotMatch(html, /web-ui\.css/);
  assert.doesNotMatch(html, /ui-polish\.css/);
  assert.doesNotMatch(html, /pro-ui\.js/);
  assert.match(platformPlayer, /gate-native-player/);
  assert.match(platformPlayer, /requestedPlatform === "webos"/);
});

test("modo seguro remove cache antigo, informa prontidão ao shell e usa navegação leve", () => {
  assert.match(bootstrap, /getRegistrations/);
  assert.match(bootstrap, /gate\.adShown/);
  assert.match(bootstrap, /gate-webos-booting/);
  assert.match(bootstrap, /gate-webos-ready/);
  assert.match(bootstrap, /gate-webos-error/);
  assert.match(bootstrap, /dispatchRemoteKey/);
  assert.match(remote, /childList:\s*true,\s*subtree:\s*true/);
  assert.doesNotMatch(remote, /attributeFilter/);
});

test("layout LG mantém canais grandes e reduz a pressão visual", () => {
  assert.match(css, /\.channel-logo[\s\S]*width:\s*70px/);
  assert.match(css, /\.live-channel-row[\s\S]*min-height:\s*90px/);
  assert.match(css, /\.catalog-grid[\s\S]*repeat\(4,/);
  assert.match(css, /\.sidebar\s*\{\s*display:\s*none/);
  assert.match(css, /min-width:\s*2500px[^]*live-preview-stage[^]*620px/);
});

test("servidor entrega a variante LG antes do middleware estático", () => {
  assert.match(server, /function servePlatformIndex/);
  assert.ok(server.indexOf('app.get("/", servePlatformIndex)') < server.indexOf('app.use(express.static'));
  assert.match(server, /api\/client-diagnostics/);
});

test("todos os scripts de TV são convertidos para Chromium 79", () => {
  assert.match(docker, /public\/platform-player\.js/);
  assert.match(docker, /public\/webos-safe-bootstrap\.js/);
  assert.match(docker, /public\/webos-remote-safe\.js/);
});

test("novo IPK webOS 0.6.6 abre a aplicação dentro do shell sem redirecionamento externo", () => {
  const info = JSON.parse(appinfo);
  assert.equal(info.version, "0.6.6");
  assert.equal(info.supportTouchMode, "virtual");
  assert.match(shellHtml, /id="gate-app"/);
  assert.match(shellHtml, /<iframe/i);
  assert.match(shellHtml, /shellVersion=0\.6\.6/);
  assert.match(shellHtml, /boot=iframe/);
  assert.match(shellHtml, /bridgeToken=gate-webos-0\.6\.6/);
  assert.match(shellHtml, /frame-src https:\/\/gate-iptv-player-production\.up\.railway\.app/);
  assert.doesNotMatch(shellHtml, /http-equiv="refresh"/);
  assert.match(bridge, /SHELL_VERSION = "0\.6\.6"/);
  assert.match(bridge, /contentWindow\.focus\(\)/);
  assert.match(bridge, /postMessage\(/);
  assert.match(bridge, /gate-webos-ready/);
  assert.doesNotMatch(bridge, /location\.replace/);
});

test("boot webOS possui recuperação automática e botão funcional somente em falha", () => {
  assert.match(shellHtml, /id="boot-screen"/);
  assert.match(shellHtml, /id="retry"[^>]*class="hidden"|class="hidden"[^>]*id="retry"/);
  assert.match(shellHtml, /reveal-app[^]*8s/);
  assert.match(bridge, /READY_TIMEOUT_MS = 18000/);
  assert.match(bridge, /showFailure/);
  assert.match(bridge, /loadApp\(true\)/);
  assert.match(bridge, /frame\.addEventListener\("load"/);
  assert.match(bridge, /frame\.addEventListener\("error"/);
  assert.match(bridge, /gate-webos-remote/);
  assert.match(bridge, /navigator\.onLine === false|root\.addEventListener\("offline"/);
});
