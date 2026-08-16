import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

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

test("modo seguro remove cache antigo e usa navegação sem observar mudanças de classe", () => {
  assert.match(bootstrap, /getRegistrations/);
  assert.match(bootstrap, /gate\.adShown/);
  assert.match(bootstrap, /ui-empty/);
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

test("novo IPK webOS 0.6.5 abre como app hospedado sem depender de iframe", () => {
  const info = JSON.parse(appinfo);
  assert.equal(info.version, "0.6.5");
  assert.equal(info.supportTouchMode, "virtual");
  assert.match(shellHtml, /http-equiv="refresh"/);
  assert.match(shellHtml, /shellVersion=0\.6\.5/);
  assert.doesNotMatch(shellHtml, /<iframe/i);
  assert.match(bridge, /SHELL_VERSION = "0\.6\.5"/);
  assert.match(bridge, /location\.replace\(buildLaunchUrl\(\)\)/);
  assert.match(bridge, /boot=hosted/);
  assert.doesNotMatch(bridge, /parent-webos|gate-native-player/);
});

test("boot webOS redireciona online e mantém recuperação focável offline", () => {
  function executeBoot(online) {
    let readyHandler;
    let redirectedTo = "";
    const status = { textContent: "" };
    const retry = {
      disabled: false,
      textContent: "",
      addEventListener() {},
      focus() { this.focused = true; }
    };
    const context = {
      navigator: { onLine: online },
      encodeURIComponent,
      Object,
      document: {
        getElementById(id) { return id === "status" ? status : id === "retry" ? retry : null; },
        addEventListener(name, handler) { if (name === "DOMContentLoaded") readyHandler = handler; }
      },
      addEventListener() {},
      clearTimeout() {},
      setTimeout(handler) { handler(); return 1; },
      location: { replace(url) { redirectedTo = url; } }
    };
    context.window = context;
    vm.runInNewContext(bridge, context);
    readyHandler();
    return { redirectedTo, retry, status };
  }

  const online = executeBoot(true);
  assert.match(online.redirectedTo, /^https:\/\/gate-iptv-player-production\.up\.railway\.app\/\?/);
  assert.match(online.redirectedTo, /platform=webos/);
  assert.match(online.redirectedTo, /shellVersion=0\.6\.5/);
  assert.match(online.redirectedTo, /boot=hosted/);

  const offline = executeBoot(false);
  assert.equal(offline.redirectedTo, "");
  assert.match(offline.status.textContent, /sem internet/i);
  assert.equal(offline.retry.disabled, false);
  assert.equal(offline.retry.focused, true);
});
