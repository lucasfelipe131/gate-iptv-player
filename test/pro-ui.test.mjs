import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, proCss, proJs, polishCss, serviceWorker] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/pro-ui.css", import.meta.url), "utf8"),
  readFile(new URL("../public/pro-ui.js", import.meta.url), "utf8"),
  readFile(new URL("../public/ui-polish.css", import.meta.url), "utf8"),
  readFile(new URL("../public/sw.js", import.meta.url), "utf8")
]);

test("carrega a camada visual profissional depois dos estilos base", () => {
  const base = indexHtml.indexOf("/styles.css");
  const webos = indexHtml.indexOf("/webos.css");
  const professional = indexHtml.indexOf("/pro-ui.css");
  const web = indexHtml.indexOf("/web-ui.css");
  const polish = indexHtml.indexOf("/ui-polish.css?v=0.6.2");
  assert.ok(base >= 0);
  assert.ok(webos > base);
  assert.ok(professional > webos);
  assert.ok(web > professional);
  assert.ok(polish > web);
  assert.match(indexHtml, /id="gate-ui-polish-2"/);
  assert.match(indexHtml, /pro-ui\.js\?v=0\.6\.2/);
  assert.match(proJs, /ui-polish\.css\?v=0\.6\.2/);
});

test("amplia logotipos, linhas de canais e navegação para TV", () => {
  assert.match(polishCss, /--gate-tv-sidebar:\s*258px/);
  assert.match(polishCss, /\.channel-logo[\s\S]*width:\s*82px/);
  assert.match(polishCss, /\.live-channel-row[\s\S]*min-height:\s*102px/);
  assert.match(polishCss, /\.nav-item[\s\S]*min-height:\s*64px/);
  assert.match(polishCss, /outline:\s*5px solid var\(--gate-pro-accent\)/);
  assert.match(polishCss, /\.catalog-grid[\s\S]*repeat\(4,/);
  assert.match(polishCss, /min-width:\s*2500px[\s\S]*width:\s*110px/);
  assert.match(proCss, /\.library-launchers[\s\S]*repeat\(2,/);
});

test("exibe orientação contextual e sincroniza a navegação sem interferir no player", () => {
  assert.match(proJs, /OK abre a prévia/);
  assert.match(proJs, /OK reproduz ou pausa/);
  assert.match(proJs, /ensureSidebarGuide/);
  assert.match(proJs, /syncSidebar/);
  assert.match(proJs, /syncTopbar/);
  assert.match(proJs, /GateProUI/);
  assert.doesNotMatch(proJs, /stopImmediatePropagation/);
});

test("service worker publica os novos recursos sem usar o cache antigo", () => {
  assert.match(serviceWorker, /gate-player-v20-stability-layout-0-6-2/);
  for (const asset of ["pro-ui.css", "ui-polish.css", "pro-ui.js", "web-ui.css", "app.js"]) {
    assert.match(serviceWorker, new RegExp(`${asset.replace(".", "\\.")}\\?v=0\\.6\\.2`));
  }
  assert.doesNotMatch(serviceWorker, /gate-player-v19-tv-ui-2-1-direct/);
});
