import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("interface oferece QR, portal móvel e consumo único na TV", async () => {
  const [html, app] = await Promise.all([read("public/index.html"), read("public/app.js")]);
  assert.match(html, /id="pairing-modal"/);
  assert.match(html, /id="pairing-qr"/);
  assert.match(app, /\/api\/pairing\/sessions/);
  assert.match(app, /\/consume/);
  assert.match(app, /authorization: `Bearer \$\{pairing\.deviceToken\}`/);
  assert.match(app, /location\.pathname === "\/pair"/);
  assert.match(app, /method: "PUT"/);
  assert.match(app, /trustedQrDataUrl\(payload\.qrDataUrl\)/);
  assert.match(app, /qr\.src = qrDataUrl/);
  assert.doesNotMatch(app, /quickchart\.io|pairingQrImage/);
});

test("assinatura anual não cobra enquanto a ativação persistente não existe", async () => {
  const app = await read("public/app.js");
  assert.match(app, /\["\/assinar", "\/renovar"\]\.includes\(location\.pathname\)/);
  assert.doesNotMatch(app, /gate\.adFree[^\n]*=[^\n]*(?:success|approved)/i);
  assert.match(app, /paymentAvailable === true \|\| state\.config\?\.billing\?\.checkoutAvailable === true/);
  assert.match(app, /data-payment-unavailable/);
  assert.match(app, /Nenhum pagamento será solicitado e nenhuma ativação foi realizada/);
});

test("expiração do pareamento encerra polling e contagem e restaura o loader", async () => {
  const app = await read("public/app.js");
  assert.match(app, /function stopPairingTimers\(pairing\)[^]*clearInterval\(pairing\.pollTimer\)[^]*clearInterval\(pairing\.countdownTimer\)/);
  assert.match(app, /if \(!seconds\)[^]*stopPairingTimers\(state\.pairing\)/);
  assert.match(app, /loader\.innerHTML = "<i><\/i><span>Gerando código seguro…<\/span>"/);
});

test("origem do pareamento exige configuração pública em produção", async () => {
  const server = await read("server.mjs");
  assert.match(server, /NODE_ENV[^]*=== "production"/);
  assert.match(server, /if \(production\) throw new Error\("Configure PUBLIC_APP_URL/);
  assert.match(server, /requireHttps: production/);
  assert.match(server, /localHostname[^]*localAddress/);
});

test("falha publicitária nunca bloqueia o início do aplicativo", async () => {
  const app = await read("public/app.js");
  assert.match(app, /function showAd\(/);
  assert.match(app, /\["webos", "tizen"\]\.includes/);
  assert.match(app, /gate\.adShown/);
  assert.match(app, /adFree/);
});
