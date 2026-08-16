import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const gradle = read("platforms/android-native/app/build.gradle");
const manifest = read("platforms/android-native/app/src/main/AndroidManifest.xml");
const playWorkflow = read(".github/workflows/build-play-release.yml");
const webOsInfo = JSON.parse(read("platforms/webos/appinfo.json"));

test("Google Play release has private, conditional upload-key signing", () => {
  for (const name of [
    "ANDROID_KEYSTORE_PATH",
    "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEY_PASSWORD"
  ]) assert.match(gradle, new RegExp(name));

  assert.match(gradle, /bundle\s*\{/);
  assert.match(gradle, /arm64-v8a/);
  assert.match(gradle, /armeabi-v7a/);
  assert.match(gradle, /targetSdk 35/);
  assert.doesNotMatch(gradle, /storePassword\s+["'][^"']+["']/);
  assert.doesNotMatch(gradle, /keyPassword\s+["'][^"']+["']/);
});

test("manual workflow builds, signs and inspects the Android TV AAB", () => {
  assert.match(playWorkflow, /workflow_dispatch/);
  assert.match(playWorkflow, /bundleRelease/);
  assert.match(playWorkflow, /lintRelease/);
  assert.match(playWorkflow, /jarsigner -verify -strict/);
  assert.match(playWorkflow, /base\/lib\/arm64-v8a/);
  assert.match(playWorkflow, /base\/lib\/armeabi-v7a/);
  assert.match(playWorkflow, /0x4000/);
  assert.match(playWorkflow, /ANDROID_KEYSTORE_BASE64/);
  assert.match(playWorkflow, /GATE-TV-v0\.6\.5-Google-Play\.aab/);
});

test("Android manifest declares a television-only launcher experience", () => {
  assert.match(manifest, /android\.intent\.category\.LEANBACK_LAUNCHER/);
  assert.match(manifest, /android\.hardware\.touchscreen" android:required="false"/);
  assert.match(manifest, /android:banner="@drawable\/tv_banner"/);
});

test("public legal and support pages are complete and consistent", () => {
  const privacy = read("public/privacy.html");
  const terms = read("public/terms.html");
  const support = read("public/support.html");
  for (const page of [privacy, terms, support]) {
    assert.match(page, /Gate One Soluções Digitais/);
    assert.match(page, /lucasfelipe\.oliveira@hotmail\.com/);
    assert.match(page, /legal\.css/);
  }
  assert.match(privacy, /reprodutor independente/i);
  assert.match(privacy, /publicidade/i);
  assert.match(terms, /não comercializa nem disponibiliza conteúdo/i);
  assert.match(support, /não fornece listas/i);
});

test("review demo is deterministic and app-ads has no invented seller", () => {
  const demo = read("public/review-demo.m3u");
  assert.match(demo, /^#EXTM3U/m);
  assert.match(demo, /^https:\/\//m);

  const sellers = read("public/app-ads.txt")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  assert.deepEqual(sellers, []);
});

test("store documentation covers review, data safety and LG QA", () => {
  for (const relativePath of [
    "store/google-play/listing-pt-BR.md",
    "store/google-play/data-safety-draft.md",
    "store/google-play/review-access.md",
    "store/google-play/submission-checklist.md",
    "store/lg/listing-pt-BR.md",
    "store/lg/ux-scenario.md",
    "store/lg/submission-checklist.md"
  ]) {
    assert.ok(fs.statSync(path.join(root, relativePath)).size > 300, `${relativePath} incompleto`);
  }
  assert.match(read("store/google-play/review-access.md"), /review-demo\.m3u/);
  assert.match(read("store/lg/ux-scenario.md"), /review-demo\.m3u/);
});

test("webOS metadata describes the real LG player within Seller Lounge limits", () => {
  assert.equal(webOsInfo.id, "com.gateone.app.gateiptvplayer");
  assert.equal(webOsInfo.title, "GATE TV");
  assert.match(webOsInfo.appDescription, /webOS TV 22 ou superior/);
  assert.ok(webOsInfo.appDescription.length <= 60);
  assert.doesNotMatch(webOsInfo.appDescription, /interface Android TV/i);
});
