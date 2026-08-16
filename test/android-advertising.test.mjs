import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const appGradle = read("platforms/android-native/app/build.gradle");
const manifest = read("platforms/android-native/app/src/main/AndroidManifest.xml");
const activity = read(
  "platforms/android-native/app/src/main/java/com/gateone/app/gateiptvplayer/StartupAdActivity.java"
);
const adapter = read(
  "platforms/android-native/app/src/main/java/com/gateone/app/gateiptvplayer/StartupAdPlayerAdapter.java"
);
const loader = read("public/tizen-loader.js");

test("Android TV usa o IMA nativo atual com desugaring", () => {
  assert.match(appGradle, /interactivemedia:3\.39\.0/);
  assert.match(appGradle, /coreLibraryDesugaringEnabled true/);
  assert.match(appGradle, /desugar_jdk_libs:2\.1\.5/);
  assert.match(appGradle, /compileSdk 36/);
  assert.match(appGradle, /targetSdk 35/);
  assert.match(adapter, /implements VideoAdPlayer/);
  assert.match(adapter, /callback\.onAdProgress/);
  assert.match(adapter, /callback\.onEnded/);
  assert.match(adapter, /callback\.onError/);
});

test("launcher abre o anúncio nativo antes do catálogo sem alterar o motor de canais", () => {
  assert.match(
    manifest,
    /android:name="\.StartupAdActivity"[\s\S]*android\.intent\.category\.LEANBACK_LAUNCHER/
  );
  assert.match(
    manifest,
    /android:name="\.StartupAdActivity"[\s\S]*android\.intent\.category\.LAUNCHER/
  );
  assert.match(manifest, /android:name="\.MainActivity"[^>]*android:exported="false"/);
  assert.doesNotMatch(
    manifest,
    /android:name="\.MainActivity"[\s\S]{0,400}android\.intent\.category\.LEANBACK_LAUNCHER/
  );
});

test("tag VAST vem do backend e qualquer falha libera o aplicativo", () => {
  assert.match(activity, /\/api\/config/);
  assert.match(activity, /vastAdTagUrl/);
  assert.match(activity, /CONFIG_FAIL_SAFE_MS = 5_500L/);
  assert.match(activity, /setConnectTimeout\(2_500\)/);
  assert.match(activity, /setReadTimeout\(2_500\)/);
  assert.match(activity, /setFocusSkipButtonWhenAvailable\(true\)/);
  assert.match(activity, /setEnablePreloading\(false\)/);
  assert.match(activity, /CONTENT_RESUME_REQUESTED/);
  assert.match(activity, /ALL_ADS_COMPLETED/);
  assert.match(activity, /AtomicBoolean mainOpened/);
  assert.match(activity, /MIN_AD_INTERVAL_MS = 4L \* 60L \* 60L \* 1000L/);
  assert.match(activity, /PREFERENCE_AD_FREE/);
  assert.doesNotMatch(activity, /21775744923|single_preroll|SAMPLE_VAST/i);
});

test("WebView Android não repete o anúncio que já foi tratado pelo launcher", () => {
  const android = new JSDOM("<!doctype html><html></html>", {
    url: "https://gate.test/?platform=androidtv",
    runScripts: "outside-only"
  });
  android.window.eval(loader);
  assert.equal(android.window.sessionStorage.getItem("gate.adShown"), "true");
  android.window.close();

  const browser = new JSDOM("<!doctype html><html></html>", {
    url: "https://gate.test/",
    runScripts: "outside-only"
  });
  browser.window.eval(loader);
  assert.equal(browser.window.sessionStorage.getItem("gate.adShown"), null);
  browser.window.close();
});
