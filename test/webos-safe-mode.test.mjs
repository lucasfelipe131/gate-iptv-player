import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const [html, css, bootstrap, remote, server, docker, appinfo, bridge] = await Promise.all([
  read("public/index-webos.html"),
  read("public/webos-safe.css"),
  read("public/webos-safe-bootstrap.js"),
  read("public/webos-remote-safe.js"),
  read("server.mjs"),
  read("Dockerfile"),
  read("platforms/webos/appinfo.json"),
  read("platforms/webos/bridge.js")
]);

test("LG recebe HTML leve sem camadas de Tizen, browser ou UI dinâmica pesada", () => {
  assert.match(html, /webos-safe\.css\?v=1\.0\.0/);
  assert.match(html, /webos-safe-bootstrap\.js\?v=1\.0\.0/);
  assert.match(html, /webos-remote-safe\.js\?v=1\.0\.0/);
  assert.doesNotMatch(html, /tizen-loader\.js/);
  assert.doesNotMatch(html, /platform-player\.js/);
  assert.doesNotMatch(html, /web-ui\.css/);
  assert.doesNotMatch(html, /ui-polish\.css/);
  assert.doesNotMatch(html, /pro-ui\.js/);
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

test("novo IPK webOS inicia diretamente na revisão segura 0.6.1", () => {
  const info = JSON.parse(appinfo);
  assert.equal(info.version, "0.6.1");
  assert.equal(info.supportTouchMode, "virtual");
  assert.match(bridge, /SHELL_VERSION = "0\.6\.1"/);
  assert.match(bridge, /searchParams\.set\("safe", "1"\)/);
});
