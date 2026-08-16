import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const [app, remote, runtime, html, css, appinfo] = await Promise.all([
  read("public/app.js"),
  read("public/webos-remote.js"),
  read("public/webos-android-runtime.js"),
  read("public/index-webos-android.html"),
  read("public/webos-input-fix.css"),
  read("platforms/webos/appinfo.json")
]);

test("QR webOS usa uma única requisição em andamento e polling sem sobreposição", () => {
  assert.match(app, /let pairingGeneration = 0/);
  assert.match(app, /let pairingStartPromise = null/);
  assert.match(app, /if \(!force && pairingStartPromise\)/);
  assert.match(app, /generation !== pairingGeneration/);
  assert.match(app, /schedulePairingPoll\(pairing, 2_500\)/);
  assert.match(app, /pairing\.nextPollDelay/);
  assert.doesNotMatch(app, /setInterval\(pollPairingSession, 1_750\)/);
  assert.match(app, /requestPairing\(false\)/);
  assert.match(app, /requestPairing\(true\)/);
});

test("um OK físico não gera um segundo clique nativo", () => {
  assert.match(remote, /lastActivationAt/);
  assert.match(remote, /lastActivationTarget/);
  assert.match(remote, /event\.repeat/);
  assert.match(remote, /!event\.isTrusted/);
  assert.match(remote, /Date\.now\(\) - lastActivationAt >= 700/);
  assert.match(remote, /tv-settings-modal/);
  assert.match(remote, /pairing-modal/);
  assert.match(remote, /version: "1\.2\.0"/);
});

test("runtime LG é identificado como webOS e não reinstala Service Worker", () => {
  assert.match(app, /runtimePlatform === "webos" \? "webos"/);
  assert.match(app, /runtimePlatform !== "webos"/);
  assert.match(runtime, /webos-runtime/);
  assert.match(runtime, /data-tv-platform/);
  assert.match(runtime, /version: "0\.7\.1"/);
});

test("modal e foco do QR têm uma camada visível específica para a LG", () => {
  assert.match(html, /webos-input-fix\.css\?v=0\.7\.1/);
  assert.match(css, /#pairing-modal \.pairing-card/);
  assert.match(css, /\.modal:not\(\.hidden\)/);
  assert.match(css, /outline: 5px solid #d5ff47/);
  assert.equal(JSON.parse(appinfo).version, "0.7.1");
});
