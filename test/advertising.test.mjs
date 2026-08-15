import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const appScript = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const originalVastTag = process.env.VAST_AD_TAG_URL;
delete process.env.VAST_AD_TAG_URL;

const { app } = await import("../server.mjs");
const server = await new Promise((resolve) => {
  const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function config() {
  const response = await fetch(`${baseUrl}/api/config`);
  return { response, data: await response.json() };
}

test("configura VAST somente com HTTPS e libera apenas o SDK IMA oficial na CSP", async () => {
  try {
    delete process.env.VAST_AD_TAG_URL;
    const disabled = await config();
    assert.equal(disabled.data.ads.enabled, false);
    assert.equal(disabled.data.ads.mode, "house");
    assert.equal(disabled.data.ads.vastAdTagUrl, null);
    assert.equal(disabled.data.ads.sdkUrl, null);
    assert.deepEqual(disabled.data.ads.houseAd, { enabled: true, durationSeconds: 10 });

    process.env.VAST_AD_TAG_URL = "http://ads.example/vast";
    assert.equal((await config()).data.ads.enabled, false, "tag HTTP deve permanecer desabilitada");
    process.env.VAST_AD_TAG_URL = "https://user:secret@ads.example/vast";
    assert.equal((await config()).data.ads.enabled, false, "userinfo não pode ser exposto na tag");

    const tag = "https://pubads.g.doubleclick.net/gampad/ads?iu=/1234/gate&sz=1280x720&output=vast";
    process.env.VAST_AD_TAG_URL = tag;
    const enabled = await config();
    assert.equal(enabled.data.ads.enabled, true);
    assert.equal(enabled.data.ads.provider, "google-ima");
    assert.equal(enabled.data.ads.sdkUrl, "https://imasdk.googleapis.com/js/sdkloader/ima3.js");
    assert.equal(enabled.data.ads.vastAdTagUrl, tag);
    assert.equal(enabled.data.ads.fallback, "house");
    assert.equal(enabled.data.ads.loadTimeoutMs, 7000);
    assert.equal(enabled.data.ads.maxPlaybackSeconds, 45);

    const csp = enabled.response.headers.get("content-security-policy") || "";
    assert.match(csp, /script-src 'self' https:\/\/imasdk\.googleapis\.com/);
    assert.match(csp, /frame-src 'self' https:\/\/imasdk\.googleapis\.com https:\/\/\*\.doubleclick\.net https:\/\/\*\.googlesyndication\.com/);
    assert.doesNotMatch(csp, /unsafe-eval/);
  } finally {
    if (originalVastTag === undefined) delete process.env.VAST_AD_TAG_URL;
    else process.env.VAST_AD_TAG_URL = originalVastTag;
  }
});

test("Web só carrega IMA quando configurado e usa house ad com encerramento automático em falhas", async () => {
  assert.equal(new JSDOM(html).window.document.querySelector("script[src*='imasdk.googleapis.com']"), null, "IMA não deve ser carregado estaticamente");
  const dom = new JSDOM(html, {
    url: "https://gate.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.sessionStorage.setItem("gate.adShown", "true");
  window.fetch = async () => ({ ok: true, json: async () => ({ annualPrice: 30, adDurationSeconds: 10, paymentAvailable: false }) });
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLMediaElement.prototype.load = () => {};
  window.eval(`${appScript}\nwindow.__gateAdsTest = { state, showAd };`);
  await new Promise((resolve) => setTimeout(resolve, 25));

  let sdkLoads = 0;
  const originalAppendChild = window.document.head.appendChild.bind(window.document.head);
  window.__gateAdsTest.state.config.ads = { enabled: false, mode: "house", houseAd: { enabled: true, durationSeconds: .1 } };
  window.sessionStorage.removeItem("gate.adShown");
  await window.__gateAdsTest.showAd();
  assert.equal(sdkLoads, 0);
  assert.equal(window.document.querySelector("#ad-overlay").classList.contains("hidden"), true);
  assert.equal(window.sessionStorage.getItem("gate.adShown"), "true");

  window.document.head.appendChild = (script) => {
    if (script.dataset.gateImaSdk === "true") {
      sdkLoads += 1;
      assert.equal(script.src, "https://imasdk.googleapis.com/js/sdkloader/ima3.js");
      const handlers = new Map();
      class AdsLoader {
        addEventListener(type, handler) { handlers.set(type, handler); }
        requestAds() { queueMicrotask(() => handlers.get("ad-error")?.({})); }
        destroy() {}
      }
      window.google = { ima: {
        settings: { setLocale() {} },
        AdDisplayContainer: class { initialize() {} destroy() {} },
        AdsLoader,
        AdsRequest: class { setAdWillAutoPlay() {} setAdWillPlayMuted() {} setContinuousPlayback() {} },
        AdsRenderingSettings: class {},
        AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: "manager-loaded" } },
        AdErrorEvent: { Type: { AD_ERROR: "ad-error" } },
        AdEvent: { Type: { STARTED: "started", CONTENT_RESUME_REQUESTED: "resume", ALL_ADS_COMPLETED: "all-complete", SKIPPED: "skipped" } },
        ViewMode: { NORMAL: "normal" }
      } };
      queueMicrotask(() => script.onload?.());
      return script;
    }
    return originalAppendChild(script);
  };
  window.__gateAdsTest.state.config.ads = {
    enabled: true,
    provider: "google-ima",
    sdkUrl: "https://imasdk.googleapis.com/js/sdkloader/ima3.js",
    vastAdTagUrl: "https://pubads.g.doubleclick.net/gampad/ads?output=vast",
    loadTimeoutMs: 1000,
    maxPlaybackSeconds: 5,
    houseAd: { enabled: true, durationSeconds: .1 }
  };
  window.sessionStorage.removeItem("gate.adShown");
  await Promise.race([
    window.__gateAdsTest.showAd(),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("falha do anúncio bloqueou o aplicativo")), 2_000))
  ]);
  assert.equal(sdkLoads, 1);
  assert.equal(window.document.querySelector("#ad-overlay").classList.contains("hidden"), true);
  assert.equal(window.sessionStorage.getItem("gate.adShown"), "true");
  dom.window.close();
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
