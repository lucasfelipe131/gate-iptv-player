import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

test("mantém os produtos separados e publica a versão 0.6.4", async () => {
  const [web, android, webos, tizen] = await Promise.all([
    read("platforms/web/platform.config.json"),
    read("platforms/android-native/app/build.gradle"),
    read("platforms/webos/appinfo.json"),
    read("platforms/tizen/config.xml")
  ]);

  assert.equal(JSON.parse(web).version, "0.6.4");
  assert.match(android, /versionName '0\.6\.4'/);
  assert.equal(JSON.parse(webos).version, "0.6.4");
  assert.match(tizen, /version="0\.6\.4"/);
});

test("Web declara as rotas de pareamento e assinatura", async () => {
  const web = JSON.parse(await read("platforms/web/platform.config.json"));
  assert.equal(web.pairingRoute, "/pair");
  assert.equal(web.subscriptionRoute, "/assinar");
});
