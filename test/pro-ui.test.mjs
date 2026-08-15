import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, proCss, proJs, serviceWorker] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/pro-ui.css", import.meta.url), "utf8"),
  readFile(new URL("../public/pro-ui.js", import.meta.url), "utf8"),
  readFile(new URL("../public/sw.js", import.meta.url), "utf8")
]);

test("carrega a camada visual profissional depois dos estilos base", () => {
  const base = indexHtml.indexOf("/styles.css");
  const webos = indexHtml.indexOf("/webos.css");
  const professional = indexHtml.indexOf("/pro-ui.css");
  assert.ok(base >= 0);
  assert.ok(webos > base);
  assert.ok(professional > webos);
  assert.match(indexHtml, /pro-ui\.js\?v=1\.0\.0/);
});

test("amplia logotipos, linhas de canais e navegação para TV", () => {
  assert.match(proCss, /\.channel-logo[\s\S]*width:\s*60px/);
  assert.match(proCss, /\.live-channel-row[\s\S]*min-height:\s*78px/);
  assert.match(proCss, /\.library-launchers[\s\S]*repeat\(2,/);
  assert.match(proCss, /outline:\s*5px solid var\(--gate-focus\)/);
  assert.match(proCss, /\.catalog-grid[\s\S]*repeat\(5,/);
});

test("exibe orientação contextual sem interferir nos comandos do player", () => {
  assert.match(proJs, /OK abre a prévia/);
  assert.match(proJs, /OK reproduz ou pausa/);
  assert.match(proJs, /GateProUI/);
  assert.doesNotMatch(proJs, /stopImmediatePropagation/);
});

test("service worker publica os novos recursos sem usar o cache antigo", () => {
  assert.match(serviceWorker, /gate-player-v17-web-ui-2/);
  assert.match(serviceWorker, /pro-ui\.css\?v=1\.0\.0/);
  assert.match(serviceWorker, /pro-ui\.js\?v=1\.0\.0/);
  assert.match(serviceWorker, /web-ui\.css\?v=2\.0\.0/);
});
