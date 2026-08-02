import dns from "node:dns/promises";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      mediaSrc: ["'self'", "blob:", "https:", "http:"],
      connectSrc: ["'self'", "https:", "http:", "blob:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(express.json({ limit: "700kb" }));

const requestBuckets = new Map();
app.use("/api", (req, res, next) => {
  const now = Date.now();
  const key = req.ip || "unknown";
  const recent = (requestBuckets.get(key) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 35) return res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
  recent.push(now);
  requestBuckets.set(key, recent);
  next();
});

function isPrivateIp(address) {
  const value = address.toLowerCase().replace(/^::ffff:/, "");
  if (net.isIPv4(value)) {
    const parts = value.split(".").map(Number);
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) || parts[0] >= 224;
  }
  return value === "::" || value === "::1" || value.startsWith("fc") ||
    value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") ||
    value.startsWith("fea") || value.startsWith("feb");
}

async function validateRemoteUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || "").trim()); } catch { throw new Error("URL inválida."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Use uma URL HTTP ou HTTPS.");
  const host = parsed.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Endereço local não permitido.");
  }
  const records = await dns.lookup(host, { all: true });
  if (!records.length || records.some(({ address }) => isPrivateIp(address))) throw new Error("Endereço de rede privada não permitido.");
  return parsed;
}

async function safeFetch(rawUrl, { maxBytes = 6_000_000, asJson = false } = {}) {
  let current = await validateRemoteUrl(rawUrl);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "user-agent": "GATE-IPTV-PLAYER/0.1", accept: asJson ? "application/json" : "*/*" },
      signal: AbortSignal.timeout(12_000)
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      current = await validateRemoteUrl(new URL(response.headers.get("location"), current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`A fonte respondeu com status ${response.status}.`);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maxBytes) throw new Error("A resposta da fonte é maior que o limite permitido.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("A resposta da fonte é maior que o limite permitido.");
    const text = new TextDecoder().decode(bytes);
    if (!asJson) return text;
    try { return JSON.parse(text); } catch { throw new Error("A fonte não retornou dados válidos."); }
  }
  throw new Error("A fonte realizou redirecionamentos demais.");
}

function safeLabel(value, fallback = "Sem nome") {
  return String(value || fallback).replace(/[<>]/g, "").slice(0, 120);
}

function parseM3u(text, limit = 140) {
  const lines = String(text || "").split(/\r?\n/);
  const channels = [];
  let metadata = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) {
      const title = line.includes(",") ? line.slice(line.lastIndexOf(",") + 1).trim() : "Canal";
      const attr = (name) => line.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] || "";
      metadata = { name: safeLabel(attr("tvg-name") || title), group: safeLabel(attr("group-title") || "Outros"), logo: attr("tvg-logo") };
    } else if (metadata && /^(https?:\/\/)/i.test(line)) {
      channels.push({ ...metadata, url: line });
      metadata = null;
      if (channels.length >= limit) break;
    }
  }
  return channels;
}

function normalizeBaseUrl(value) {
  const parsed = new URL(String(value || "").trim());
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "gate-iptv-player" }));
app.get("/api/config", (_req, res) => res.json({
  annualPrice: 30,
  adDurationSeconds: 10,
  paymentAvailable: Boolean(process.env.PAYMENT_LINK_URL)
}));

app.post("/api/m3u/parse", async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    if (!url) return res.status(400).json({ error: "Informe a URL da lista." });
    const text = await safeFetch(url);
    if (!/^#EXTM3U/m.test(text)) return res.status(422).json({ error: "O arquivo não parece ser uma lista M3U válida." });
    const channels = parseM3u(text);
    return res.json({ source: "m3u", count: channels.length, channels });
  } catch (error) {
    return res.status(422).json({ error: error.message || "Não foi possível abrir a lista." });
  }
});

app.post("/api/xtream/connect", async (req, res) => {
  try {
    const serverUrl = normalizeBaseUrl(req.body?.serverUrl);
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) return res.status(400).json({ error: "Informe usuário e senha." });
    await validateRemoteUrl(serverUrl);
    const query = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    const api = `${serverUrl}/player_api.php?${query}`;
    const account = await safeFetch(api, { maxBytes: 1_500_000, asJson: true });
    if (!account?.user_info || String(account.user_info.auth) !== "1") {
      return res.status(401).json({ error: "A fonte não autorizou estes dados." });
    }
    const [liveResult, vodResult, seriesResult] = await Promise.allSettled([
      safeFetch(`${api}&action=get_live_streams`, { maxBytes: 5_000_000, asJson: true }),
      safeFetch(`${api}&action=get_vod_streams`, { maxBytes: 4_000_000, asJson: true }),
      safeFetch(`${api}&action=get_series`, { maxBytes: 4_000_000, asJson: true })
    ]);
    const live = liveResult.status === "fulfilled" && Array.isArray(liveResult.value) ? liveResult.value : [];
    const vod = vodResult.status === "fulfilled" && Array.isArray(vodResult.value) ? vodResult.value : [];
    const series = seriesResult.status === "fulfilled" && Array.isArray(seriesResult.value) ? seriesResult.value : [];
    const extension = account.user_info.allowed_output_formats?.includes("m3u8") ? "m3u8" : "ts";
    const sampleLive = live.slice(0, 80).map((item) => ({
      id: String(item.stream_id),
      name: safeLabel(item.name),
      logo: String(item.stream_icon || "").slice(0, 900),
      group: safeLabel(item.category_name || "Ao vivo"),
      url: `${serverUrl}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${item.stream_id}.${extension}`
    }));
    return res.json({
      source: "xtream",
      account: {
        username: safeLabel(username),
        status: safeLabel(account.user_info.status || "Ativo"),
        expiresAt: account.user_info.exp_date ? new Date(Number(account.user_info.exp_date) * 1000).toISOString() : null,
        maxConnections: Number(account.user_info.max_connections || 0)
      },
      counts: { live: live.length, movies: vod.length, series: series.length },
      channels: sampleLive,
      movies: vod.slice(0, 18).map((item) => ({ name: safeLabel(item.name), logo: String(item.stream_icon || "").slice(0, 900) })),
      series: series.slice(0, 18).map((item) => ({ name: safeLabel(item.name), logo: String(item.cover || "").slice(0, 900) }))
    });
  } catch (error) {
    return res.status(422).json({ error: error.message || "Não foi possível conectar à fonte Xtream." });
  }
});

app.post("/api/portal/validate", async (req, res) => {
  try {
    const portalUrl = String(req.body?.portalUrl || "").trim();
    const mac = String(req.body?.mac || "").trim().toUpperCase();
    await validateRemoteUrl(portalUrl);
    if (!/^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/.test(mac)) return res.status(400).json({ error: "Informe um MAC válido." });
    return res.json({
      source: "portal",
      status: "validated",
      message: "Portal e MAC validados. A conexão completa depende do protocolo habilitado pelo seu provedor autorizado."
    });
  } catch (error) {
    return res.status(422).json({ error: error.message || "Não foi possível validar o portal." });
  }
});

app.post("/api/renewals", (req, res) => {
  const rawMac = String(req.body?.mac || "").trim().toUpperCase();
  const compact = rawMac.replace(/[^0-9A-F]/g, "");
  if (!/^[0-9A-F]{12}$/.test(compact)) return res.status(400).json({ error: "Informe um MAC com 12 caracteres hexadecimais." });
  const mac = compact.match(/.{2}/g).join(":");
  const protocol = `GATE-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const checkoutUrl = process.env.PAYMENT_LINK_URL || null;
  return res.status(201).json({
    protocol,
    mac,
    plan: "Sem anúncios — 1 ano",
    amount: 30,
    checkoutUrl,
    status: checkoutUrl ? "ready_for_payment" : "awaiting_payment_configuration"
  });
});

app.use("/vendor/hls.min.js", express.static(path.join(__dirname, "node_modules/hls.js/dist/hls.min.js")));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));
app.get("/{*path}", (_req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

app.use((error, _req, res, _next) => {
  res.status(500).json({ error: error?.message || "Erro interno." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`GATE IPTV PLAYER online na porta ${port}`);
});
