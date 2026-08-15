import assert from "node:assert/strict";
import test from "node:test";

const originalEnvironment = {
  nodeEnv: process.env.NODE_ENV,
  pairingTtl: process.env.PAIRING_SESSION_TTL_MS,
  pairingCreateLimit: process.env.RATE_LIMIT_PAIRING_CREATE,
  publicAppUrl: process.env.PUBLIC_APP_URL,
  railwayPublicDomain: process.env.RAILWAY_PUBLIC_DOMAIN,
  mercadoPagoToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
  paymentLinkUrl: process.env.PAYMENT_LINK_URL
};

process.env.PAIRING_SESSION_TTL_MS = "1500";
process.env.RATE_LIMIT_PAIRING_CREATE = "3";
process.env.PUBLIC_APP_URL = "https://gate.example";
delete process.env.MERCADOPAGO_ACCESS_TOKEN;
delete process.env.PAYMENT_LINK_URL;

const { app } = await import("../server.mjs");
const nativeFetch = globalThis.fetch;
const server = await new Promise((resolve) => {
  const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
});
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

async function request(pathname, { method = "GET", body, token, ip = "203.0.113.10" } = {}) {
  const response = await nativeFetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "x-forwarded-for": ip
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { response, data, text };
}

function restoreEnvironment() {
  for (const [key, value] of Object.entries({
    NODE_ENV: originalEnvironment.nodeEnv,
    PAIRING_SESSION_TTL_MS: originalEnvironment.pairingTtl,
    RATE_LIMIT_PAIRING_CREATE: originalEnvironment.pairingCreateLimit,
    PUBLIC_APP_URL: originalEnvironment.publicAppUrl,
    RAILWAY_PUBLIC_DOMAIN: originalEnvironment.railwayPublicDomain,
    MERCADOPAGO_ACCESS_TOKEN: originalEnvironment.mercadoPagoToken,
    PAYMENT_LINK_URL: originalEnvironment.paymentLinkUrl
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("backend de pareamento, cobrança e renovação de ticket mantém contratos seguros", async (t) => {
  try {
    await t.test("usa o domínio público automático do Railway em produção", async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      const previousPublicAppUrl = process.env.PUBLIC_APP_URL;
      const previousRailwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
      process.env.NODE_ENV = "production";
      delete process.env.PUBLIC_APP_URL;
      process.env.RAILWAY_PUBLIC_DOMAIN = "gate-production.example";
      try {
        const created = await request("/api/pairing/sessions", { method: "POST", body: {}, ip: "203.0.113.9" });
        assert.equal(created.response.status, 201);
        assert.equal(created.data.qrTargetUrl, `https://gate-production.example/pair?code=${created.data.code}`);
      } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
        if (previousPublicAppUrl === undefined) delete process.env.PUBLIC_APP_URL; else process.env.PUBLIC_APP_URL = previousPublicAppUrl;
        if (previousRailwayDomain === undefined) delete process.env.RAILWAY_PUBLIC_DOMAIN; else process.env.RAILWAY_PUBLIC_DOMAIN = previousRailwayDomain;
      }
    });

    await t.test("pareia Xtream com código legível, token secreto e consumo único", async () => {
      const created = await request("/api/pairing/sessions", { method: "POST", body: {}, ip: "203.0.113.11" });
      assert.equal(created.response.status, 201);
      assert.match(created.data.code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
      assert.ok(created.data.deviceToken.length >= 40);
      assert.equal(created.data.status, "pending");
      assert.equal(created.data.qrTargetUrl, `https://gate.example/pair?code=${created.data.code}`);
      assert.doesNotMatch(created.data.qrTargetUrl, new RegExp(created.data.deviceToken));
      assert.match(created.data.qrDataUrl, /^data:image\/svg\+xml;base64,/);
      const pairingSvg = Buffer.from(created.data.qrDataUrl.split(",")[1], "base64").toString("utf8");
      assert.match(pairingSvg, /^<svg[^>]+shape-rendering="crispEdges"/);
      assert.match(pairingSvg, /<path d="M/);
      assert.doesNotMatch(created.data.qrDataUrl, /quickchart|gate\.example|deviceToken/i);

      const pending = await request(`/api/pairing/${created.data.code}`, { ip: "203.0.113.12" });
      assert.equal(pending.response.status, 200);
      assert.equal(pending.data.status, "pending");
      assert.equal("deviceToken" in pending.data, false);

      const descriptor = {
        type: "xtream",
        name: "Minha lista",
        serverUrl: "https://provider.example/player_api.php?username=embedded-user&password=embedded-password",
        username: "subscriber-user",
        password: "subscriber-password"
      };
      const submitted = await request(`/api/pairing/${created.data.code}`, {
        method: "PUT",
        body: { descriptor },
        ip: "203.0.113.13"
      });
      assert.equal(submitted.response.status, 202);
      assert.equal(submitted.data.status, "ready");
      assert.equal(submitted.data.descriptorType, "xtream");
      assert.doesNotMatch(submitted.text, /subscriber-user|subscriber-password|embedded-password/);

      const publicStatus = await request(`/api/pairing/${created.data.code}`, { ip: "203.0.113.14" });
      assert.equal(publicStatus.data.status, "ready");
      assert.doesNotMatch(publicStatus.text, /subscriber-user|subscriber-password|embedded-password/);

      const unauthorized = await request(`/api/pairing/${created.data.code}/consume`, {
        method: "POST",
        body: {},
        token: "token-incorreto",
        ip: "203.0.113.15"
      });
      assert.equal(unauthorized.response.status, 401);

      const consumed = await request(`/api/pairing/${created.data.code}/consume`, {
        method: "POST",
        body: {},
        token: created.data.deviceToken,
        ip: "203.0.113.16"
      });
      assert.equal(consumed.response.status, 200);
      assert.equal(consumed.data.status, "consumed");
      assert.deepEqual(consumed.data.descriptor, {
        type: "xtream",
        name: "Minha lista",
        serverUrl: "https://provider.example",
        username: "subscriber-user",
        password: "subscriber-password"
      });

      const consumedAgain = await request(`/api/pairing/${created.data.code}/consume`, {
        method: "POST",
        body: {},
        token: created.data.deviceToken,
        ip: "203.0.113.17"
      });
      assert.equal(consumedAgain.response.status, 410);
      assert.equal(consumedAgain.data.code, "PAIRING_CONSUMED");
    });

    await t.test("aceita M3U e elimina o descriptor depois do primeiro consumo", async () => {
      const created = await request("/api/pairing/sessions", { method: "POST", body: {}, ip: "203.0.113.21" });
      const secretUrl = "https://playlist.example/get.php?username=m3u-user&password=m3u-secret&type=m3u_plus";
      const submitted = await request(`/api/pairing/${created.data.code}`, {
        method: "PUT",
        body: { descriptor: { type: "m3u", name: "Casa", url: secretUrl } },
        ip: "203.0.113.22"
      });
      assert.equal(submitted.response.status, 202);
      assert.doesNotMatch(submitted.text, /m3u-user|m3u-secret/);
      const consumed = await request(`/api/pairing/${created.data.code}/consume`, {
        method: "POST",
        body: {},
        token: created.data.deviceToken,
        ip: "203.0.113.23"
      });
      assert.equal(consumed.data.descriptor.url, secretUrl);
      const status = await request(`/api/pairing/${created.data.code}`, { ip: "203.0.113.24" });
      assert.equal(status.data.status, "consumed");
      assert.doesNotMatch(status.text, /m3u-user|m3u-secret/);
    });

    await t.test("expira a sessão curta e limita criação por IP", async () => {
      const expiring = await request("/api/pairing/sessions", { method: "POST", body: {}, ip: "203.0.113.31" });
      await new Promise((resolve) => setTimeout(resolve, 1650));
      const expired = await request(`/api/pairing/${expiring.data.code}/consume`, {
        method: "POST",
        body: {},
        token: expiring.data.deviceToken,
        ip: "203.0.113.32"
      });
      assert.equal(expired.response.status, 410);
      assert.equal(expired.data.code, "PAIRING_EXPIRED");

      for (let index = 0; index < 3; index += 1) {
        const allowed = await request("/api/pairing/sessions", { method: "POST", body: {}, ip: "203.0.113.40" });
        assert.equal(allowed.response.status, 201);
      }
      const limited = await request("/api/pairing/sessions", { method: "POST", body: {}, ip: "203.0.113.40" });
      assert.equal(limited.response.status, 429);
      assert.equal(limited.data.code, "RATE_LIMITED");
      assert.ok(Number(limited.response.headers.get("retry-after")) >= 1);
    });

    await t.test("cobrança permanece bloqueada sem confirmação e licença persistente", async () => {
      delete process.env.MERCADOPAGO_ACCESS_TOKEN;
      delete process.env.PAYMENT_LINK_URL;
      const unavailable = await request("/api/billing/checkout", {
        method: "POST",
        body: {},
        ip: "203.0.113.51"
      });
      assert.equal(unavailable.response.status, 503);
      assert.equal(unavailable.data.status, "payment_not_configured");
      assert.equal(unavailable.data.plan.amount, 30);
      assert.equal(unavailable.data.plan.currency, "BRL");
      assert.equal(unavailable.data.plan.interval, "year");

      process.env.PAYMENT_LINK_URL = "https://pay.example/gate-annual";
      const fallback = await request("/api/billing/checkout", {
        method: "POST",
        body: {},
        ip: "203.0.113.52"
      });
      assert.equal(fallback.response.status, 503);
      assert.equal(fallback.data.code, "ACTIVATION_PIPELINE_REQUIRED");
      const billingConfig = await request("/api/billing/config", { ip: "203.0.113.54" });
      assert.equal(billingConfig.data.checkoutAvailable, false);
      assert.equal(billingConfig.data.activationReady, false);
      assert.equal(billingConfig.data.providerConfigured, true);

      process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-mercadopago-private-token";
      let providerCalled = false;
      globalThis.fetch = async () => { providerCalled = true; throw new Error("não deveria chamar o provedor"); };
      try {
        const mercadoPago = await request("/api/billing/checkout", {
          method: "POST",
          body: { email: "cliente@example.com", amount: 0.01 },
          ip: "203.0.113.53"
        });
        assert.equal(mercadoPago.response.status, 503);
        assert.equal(mercadoPago.data.code, "ACTIVATION_PIPELINE_REQUIRED");
        assert.equal(mercadoPago.data.plan.amount, 30, "o cliente não controla o preço");
        assert.equal(providerCalled, false, "nenhum pagamento pode ser criado antes da ativação persistente");
        assert.doesNotMatch(mercadoPago.text, /TEST-mercadopago-private-token/);
      } finally {
        globalThis.fetch = nativeFetch;
      }
    });

    await t.test("renova o mesmo ticket de stream por 24 horas sem expor a origem", async () => {
      const registered = await request("/api/stream/register", {
        method: "POST",
        body: { url: "https://8.8.8.8/live.ts?username=stream-user&password=stream-secret" },
        ip: "203.0.113.61"
      });
      assert.equal(registered.response.status, 200);
      assert.match(registered.data.playUrl, /^\/api\/stream\/[A-Za-z0-9_-]+$/);
      assert.doesNotMatch(registered.text, /stream-user|stream-secret|8\.8\.8\.8/);
      const refreshed = await request(`${registered.data.playUrl}/refresh`, {
        method: "POST",
        body: {},
        ip: "203.0.113.62"
      });
      assert.equal(refreshed.response.status, 200);
      assert.equal(refreshed.data.playUrl, registered.data.playUrl);
      assert.equal(refreshed.data.expiresInSeconds, 24 * 60 * 60);
      assert.doesNotMatch(refreshed.text, /stream-user|stream-secret|8\.8\.8\.8/);
    });
  } finally {
    globalThis.fetch = nativeFetch;
    restoreEnvironment();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
