import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const [html, app, css, polish, proJs, sw, server] = await Promise.all([
  read("public/index.html"),
  read("public/app.js"),
  read("public/web-ui.css"),
  read("public/ui-polish.css"),
  read("public/pro-ui.js"),
  read("public/sw.js"),
  read("server.mjs")
]);

test("publica uma camada visual exclusiva da Web depois das camadas de TV", () => {
  const base = html.indexOf("/styles.css?v=0.6.1-web");
  const tv = html.indexOf("/pro-ui.css?v=1.0.0");
  const web = html.indexOf("/web-ui.css?v=2.0.0");
  assert.ok(base >= 0);
  assert.ok(tv > base);
  assert.ok(web > tv);
  assert.match(html, /app\.js\?v=0\.6\.1-web/);
  assert.match(css, /body\.browser-mode \.sidebar[^]*display:\s*flex/);
  assert.match(css, /grid-template-columns:\s*var\(--web-sidebar\) minmax\(0, 1fr\)/);
  assert.match(proJs, /gate-browser-polish/);
  assert.match(polish, /body\.gate-browser-polish\.browser-mode \.live-channel-row/);
});

test("home Web tem landing nova, dashboard e ações de QR e Premium", () => {
  assert.match(app, /function renderBrowserWelcome\(\)/);
  assert.match(app, /class="web-product-preview"/);
  assert.match(app, /class="web-step-grid"/);
  assert.match(app, /class="web-dashboard-grid"/);
  assert.match(app, /Adicionar por QR Code/);
  assert.match(app, /class="web-premium-card focusable" href="\/assinar"/);
  assert.match(app, /document\.body\.classList\.contains\("browser-mode"\)/);
});

test("navegação Web vira dock inferior em telas menores sem afetar o modo TV", () => {
  assert.match(css, /@media \(max-width:\s*1020px\)[^]*body\.browser-mode \.sidebar[^]*position:\s*fixed/);
  assert.match(css, /grid-template-columns:\s*repeat\(5, 1fr\)/);
  assert.doesNotMatch(css, /(^|\n)(?!\s*body\.browser-mode)[^{\n]+\.sidebar\s*\{/);
});

test("pareamento e assinatura recebem hierarquia Web sem mudar seus contratos", () => {
  assert.match(app, /id="pair-portal-form"/);
  assert.match(app, /name="code"/);
  assert.match(app, /PASSO 2 DE 3/);
  assert.match(app, /id="subscription-form"/);
  assert.match(app, /data-payment-unavailable/);
  assert.match(app, /state\.config\?\.annualPrice \|\| 30/);
  assert.match(css, /body\.browser-mode \.pair-confidence/);
  assert.match(css, /body\.browser-mode \.premium-price/);
});

test("rollout usa revisão nova, não salva erros e revalida CSS e JS", () => {
  assert.match(sw, /gate-player-v18-tv-ui-2-1/);
  assert.match(sw, /web-ui\.css\?v=2\.0\.0/);
  assert.match(sw, /ui-polish\.css\?v=2\.1\.0/);
  assert.match(sw, /if \(response\.ok\)/);
  assert.match(sw, /event\.waitUntil\(caches\.open\(CACHE\)/);
  assert.match(sw, /key\.startsWith\(CACHE_PREFIX\)/);
  assert.match(app, /updateViaCache:\s*"none"/);
  assert.match(server, /else if \([^\n]*css\|js/);
  assert.match(server, /no-cache, no-store, must-revalidate/);
  assert.doesNotMatch(sw, /gate-player-v17-web-ui-2/);
});
