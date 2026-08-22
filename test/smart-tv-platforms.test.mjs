import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readFileSync } from "node:fs";

// Versao unica, lida do package.json — evita que os manifestos voltem a divergir.
const APP_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("webOS abre o layout Android TV diretamente, sem iframe bloqueando cliques", async () => {
  const manifest = JSON.parse(await read("platforms/webos/appinfo.json"));
  const html = await read("platforms/webos/index.html");
  const bridge = await read("platforms/webos/bridge.js");
  const remote = await read("public/webos-remote.js");
  const runtime = await read("public/webos-android-runtime.js");
  const androidLayout = await read("public/index-webos-android.html");
  const documentation = await read("platforms/webos/README.md");

  assert.equal(manifest.main, "index.html");
  assert.equal(manifest.type, "web");
  assert.equal(manifest.version, APP_VERSION);
  assert.equal(manifest.disableBackHistoryAPI, true);
  assert.ok(manifest.appDescription.length <= 60);
  assert.match(documentation, /webOS TV 22 ou superior/);

  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /http-equiv="refresh"/);
  assert.match(html, /index-webos-android\.html/);
  assert.match(html, /platform=androidtv/);
  assert.match(html, /runtime=webos/);
  assert.match(html, /layout=androidtv/);
  assert.match(html, /nativePlayer=html5/);
  assert.match(html, /shellVersion=0\.7\.1/);
  assert.doesNotMatch(html, /<iframe/i);

  assert.match(bridge, /PLATFORM = "webos"/);
  assert.match(bridge, /UI_PLATFORM = "androidtv"/);
  assert.match(bridge, /APP_URL = "https:\/\/gate-iptv-player-production\.up\.railway\.app\/index-webos-android\.html"/);
  assert.match(bridge, /SHELL_VERSION = "0\.7\.1"/);
  assert.match(bridge, /nativePlayer=html5/);
  assert.match(bridge, /location\.replace\(buildLaunchUrl/);
  assert.doesNotMatch(bridge, /contentWindow|postMessage|gate-webos-remote/);

  assert.match(androidLayout, /webos-android-runtime\.js\?v=0\.7\.1/);
  assert.match(androidLayout, /app\.js\?v=0\.7\.1/);
  assert.match(runtime, /Service Worker disabled on LG webOS runtime/);
  assert.match(runtime, /safeConfig\.enableWorker = false/);
  assert.match(remote, /runtimePlatform === "webos"/);
  assert.match(remote, /androidTvLayout/);
  assert.doesNotMatch(bridge, /password|authorization|bearer/i);
});

test("Tizen package is scoped to the production origin and AVPlay can recover", async () => {
  const config = await read("platforms/tizen/config.xml");
  const html = await read("platforms/tizen/index.html");
  const bridge = await read("platforms/tizen/bridge.js");
  const documentation = await read("platforms/tizen/README.md");

  assert.match(config, /tizen:profile name="tv-samsung"/);
  assert.match(config, /GATEIPTV01\.GateTV/);
  assert.match(config, /required_version="6\.5"/);
  assert.doesNotMatch(config, /required_version="(?:[1-5](?:\.[0-9]+)?|6\.[0-4])"/);
  assert.match(documentation, /Tizen 6\.5 ou superior/);
  assert.match(documentation, /bundle legado transpilado/);
  assert.match(config, /privilege\/tv\.inputdevice/);
  assert.match(config, /origin="https:\/\/gate-iptv-player-production\.up\.railway\.app"/);
  assert.match(html, /application\/avplayer/);
  assert.match(html, /\$WEBAPIS\/webapis\/webapis\.js/);
  assert.match(bridge, /nativePlayer", "avplay"/);
  assert.match(bridge, /webapis\.avplay/);
  assert.match(bridge, /setListener\(playerListener\(\)\)/);
  assert.match(bridge, /onbufferingstart/);
  assert.match(bridge, /onstreamcompleted/);
  assert.match(bridge, /avplay-watchdog/);
  assert.match(bridge, /player\.close\(\)/);
  assert.match(bridge, /PLAY_PAUSE: 10252/);
  assert.doesNotMatch(bridge, /password|authorization|bearer/i);
});

test("Smart TV packaging scripts are valid POSIX shell", async () => {
  const packageJson = JSON.parse(await read("package.json"));

  for (const script of ["scripts/package-webos.sh", "scripts/package-tizen.sh"]) {
    const path = fileURLToPath(new URL(`../${script}`, import.meta.url));
    const result = spawnSync("sh", ["-n", path], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }

  assert.equal(packageJson.scripts["package:webos"], "sh scripts/package-webos.sh");
  assert.equal(packageJson.scripts["package:tizen"], "sh scripts/package-tizen.sh");

  const webosScript = await read("scripts/package-webos.sh");
  assert.match(webosScript, /platforms\/webos/);
  assert.match(webosScript, /ares-package/);
  assert.match(webosScript, /mktemp -d/);
  assert.match(webosScript, /trap cleanup/);

  const tizenScript = await read("scripts/package-tizen.sh");
  assert.match(tizenScript, /TIZEN_SECURITY_PROFILE/);
  assert.match(tizenScript, /tizen build-web/);
  assert.match(tizenScript, /tizen package -t wgt/);
  assert.match(tizenScript, /mktemp -d/);
  assert.match(tizenScript, /trap cleanup/);
  assert.doesNotMatch(tizenScript, /password|\.p12|author\.pfx/i);
});
