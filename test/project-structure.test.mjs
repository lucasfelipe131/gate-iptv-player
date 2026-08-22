import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readFileSync } from "node:fs";

// Versao unica, lida do package.json — evita que os manifestos voltem a divergir.
const APP_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

test("mantém uma única versão em todas as plataformas", async () => {
  const [web, android, webos, tizen] = await Promise.all([
    read("platforms/web/platform.config.json"),
    read("platforms/android-native/app/build.gradle"),
    read("platforms/webos/appinfo.json"),
    read("platforms/tizen/config.xml")
  ]);

  assert.equal(JSON.parse(web).version, APP_VERSION);
  assert.ok(android.includes(`versionName '${APP_VERSION}'`), "build.gradle deve seguir o package.json");
  assert.equal(JSON.parse(webos).version, APP_VERSION);
  assert.ok(tizen.includes(`version="${APP_VERSION}"`), "config.xml da Tizen deve seguir o package.json");
});

test("Web declara as rotas de pareamento e assinatura", async () => {
  const web = JSON.parse(await read("platforms/web/platform.config.json"));
  assert.equal(web.pairingRoute, "/pair");
  assert.equal(web.subscriptionRoute, "/assinar");
});
