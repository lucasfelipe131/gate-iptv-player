import dns from "node:dns/promises";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import express from "express";
import helmet from "helmet";
import { createQrSvgDataUrl } from "./lib/qr-data-url.mjs";
import { createTicketStore } from "./lib/stream-tickets.mjs";
import { createUrlSigner } from "./lib/signed-url.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const APP_VERSION = JSON.parse(
  readFileSync(path.join(__dirname, "package.json"), "utf8")
).version;
const MAX_CATALOG_ITEMS = 2000;
const MAX_LIVE_ITEMS = 6000;
const SESSION_TTL = 24 * 60 * 60 * 1000;
const HLS_TICKET_TTL = 30 * 60 * 1000;
const MAX_STREAM_TICKETS = 50_000;
// Teto por dono da sessao. O teto global sozinho fazia a lista de um usuario
// despejar o ticket do canal que outro usuario estava assistindo.
const MAX_TICKETS_PER_OWNER = positiveIntegerSetting("MAX_TICKETS_PER_OWNER", 12_000);
// Cada leitura acumula os pedacos e depois copia para um bloco contiguo: o pico
// e cerca do dobro deste valor. Ajuste junto com a memoria do container.
const MAX_CATALOG_BYTES = positiveIntegerSetting("MAX_CATALOG_BYTES", 24_000_000);
const SHARED_TICKET_OWNER = "shared";
const IMAGE_SIGNING_KEY = String(process.env.IMAGE_SIGNING_KEY || "").trim()
  ? Buffer.from(String(process.env.IMAGE_SIGNING_KEY).trim(), "utf8")
  : crypto.randomBytes(32);
const NATIVE_DIRECT_KEY = String(process.env.NATIVE_DIRECT_KEY || "").trim();
const PAIRING_SESSION_TTL = Math.min(
  15 * 60 * 1000,
  Math.max(50, Number(process.env.PAIRING_SESSION_TTL_MS) || 5 * 60 * 1000)
);
const PAIRING_TOMBSTONE_TTL = 10 * 60 * 1000;
const PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PAIRING_ENCRYPTION_KEY = crypto.randomBytes(32);
const IMA_SDK_URL = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";
const ANNUAL_PLAN = Object.freeze({
  id: "gate-tv-annual",
  name: "GATE TV — assinatura anual",
  amount: 30,
  currency: "BRL",
  interval: "year",
  intervalCount: 1
});

const IS_PRODUCTION = String(process.env.NODE_ENV || "").toLowerCase() === "production";
// Fora de producao o http: continua liberado para testar fonte local sem TLS.
const INSECURE_SOURCES = IS_PRODUCTION ? [] : ["http:"];

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://imasdk.googleapis.com"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:", "https:", ...INSECURE_SOURCES],
      mediaSrc: ["'self'", "blob:", "https:", ...INSECURE_SOURCES],
      connectSrc: ["'self'", "https:", "blob:", ...INSECURE_SOURCES],
      fontSrc: ["'self'"],
      frameSrc: ["'self'", "https://imasdk.googleapis.com", "https://*.doubleclick.net", "https://*.googlesyndication.com"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'", "app:", "file:", "webos:"]
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  // The signed webOS shell is cross-origin (app/file). frame-ancestors above is
  // the authoritative allowlist; X-Frame-Options: SAMEORIGIN would block it.
  xFrameOptions: false
}));
app.use(express.json({ limit: "2mb" }));

const requestBuckets = new Map();
const sensitiveRequestBuckets = new Map();
app.use("/api", (req, res, next) => {
  const now = Date.now();
  const streamRequest = req.path.startsWith("/stream/");
  const key = `${req.ip || "unknown"}:${streamRequest ? "media" : "control"}`;
  const recent = (requestBuckets.get(key) || []).filter((time) => now - time < 60_000);
  const limit = streamRequest ? 900 : 70;
  if (recent.length >= limit) return res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
  recent.push(now);
  requestBuckets.set(key, recent);
  next();
});

function positiveIntegerSetting(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function sensitiveRateLimit(scope, fallbackLimit, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${scope}:${req.ip || "unknown"}`;
    const limit = positiveIntegerSetting(`RATE_LIMIT_${scope.toUpperCase()}`, fallbackLimit);
    const recent = (sensitiveRequestBuckets.get(key) || []).filter((time) => now - time < windowMs);
    if (recent.length >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
      res.setHeader("retry-after", String(retryAfterSeconds));
      res.setHeader("cache-control", "no-store");
      return res.status(429).json({
        error: "Muitas tentativas. Aguarde antes de tentar novamente.",
        code: "RATE_LIMITED",
        retryAfterSeconds
      });
    }
    recent.push(now);
    sensitiveRequestBuckets.set(key, recent);
    return next();
  };
}

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

async function resolveRemoteTarget(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || "").trim()); } catch { throw new Error("URL inválida."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Use uma URL HTTP ou HTTPS.");
  if (parsed.username || parsed.password) throw new Error("Não inclua credenciais no endereço da fonte.");
  const host = parsed.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Endereço local não permitido.");
  }
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Endereço de rede privada não permitido.");
  }
  const selected = records.find(({ family }) => family === 4) || records[0];
  return { parsed, address: selected.address, family: selected.family };
}

async function validateRemoteUrl(rawUrl) {
  return (await resolveRemoteTarget(rawUrl)).parsed;
}

function requestPinnedRemote(target, headers, timeoutMs) {
  const { parsed, address, family } = target;
  const transport = parsed.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = transport.request({
      protocol: parsed.protocol,
      hostname: address,
      family,
      port: parsed.port ? Number(parsed.port) : undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method: "GET",
      servername: parsed.protocol === "https:" && !net.isIP(parsed.hostname) ? parsed.hostname : undefined,
      headers: {
        "user-agent": `GATE-IPTV-PLAYER/${APP_VERSION}`,
        "accept-encoding": "identity",
        ...headers,
        host: parsed.host
      }
    }, (nodeResponse) => {
      if (settled) {
        nodeResponse.destroy();
        return;
      }
      settled = true;
      clearTimeout(timer);
      const responseHeaders = new Headers();
      for (const [name, rawValue] of Object.entries(nodeResponse.headers)) {
        if (Array.isArray(rawValue)) rawValue.forEach((value) => responseHeaders.append(name, value));
        else if (rawValue != null) responseHeaders.set(name, String(rawValue));
      }
      const status = Number(nodeResponse.statusCode || 502);
      const noBody = status === 204 || status === 205 || status === 304;
      if (noBody) nodeResponse.resume();
      const body = noBody ? null : Readable.toWeb(nodeResponse);
      resolve(new Response(body, {
        status,
        statusText: nodeResponse.statusMessage || "",
        headers: responseHeaders
      }));
    });
    const timer = setTimeout(() => {
      request.destroy(Object.assign(new Error("REMOTE_TIMEOUT"), { code: "REMOTE_TIMEOUT" }));
    }, Math.min(60_000, Math.max(1_000, Number(timeoutMs) || 20_000)));
    request.once("error", (error) => {
      clearTimeout(timer);
      finishError(error);
    });
    request.end();
  });
}

async function openRemote(rawUrl, { headers = {}, timeoutMs = 20_000 } = {}) {
  let target = await resolveRemoteTarget(rawUrl);
  try {
    for (let redirect = 0; redirect < 5; redirect += 1) {
      const response = await requestPinnedRemote(target, headers, timeoutMs);
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        response.body?.cancel().catch(() => {});
        target = await resolveRemoteTarget(new URL(response.headers.get("location"), target.parsed).toString());
        continue;
      }
      return { response, finalUrl: target.parsed, clearTimer: () => {} };
    }
    throw new Error("A fonte realizou redirecionamentos demais.");
  } catch (error) {
    if (error?.code === "REMOTE_TIMEOUT" || error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new Error("A fonte demorou demais para responder.");
    }
    throw error;
  }
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("A resposta da fonte é maior que o limite permitido.");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("A resposta da fonte é maior que o limite permitido.");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

async function safeFetch(rawUrl, { maxBytes = 8_000_000, asJson = false, timeoutMs = 30_000 } = {}) {
  const remote = await openRemote(rawUrl, {
    timeoutMs,
    headers: { accept: asJson ? "application/json" : "*/*" }
  });
  try {
    if (!remote.response.ok) throw new Error(`A fonte respondeu com status ${remote.response.status}.`);
    const bytes = await readLimited(remote.response, maxBytes);
    const text = new TextDecoder().decode(bytes);
    if (!asJson) return text;
    try { return JSON.parse(text); } catch { throw new Error("A fonte não retornou dados válidos."); }
  } finally {
    remote.clearTimer();
  }
}

function safeLabel(value, fallback = "Sem nome") {
  return String(value || fallback).replace(/[<>]/g, "").slice(0, 160);
}

function safeText(value, maxLength = 1200) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeHttpUrl(value, { maxLength = 4096, requireHttps = false } = {}) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) throw new Error("Informe uma URL válida.");
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error("Informe uma URL válida."); }
  if (requireHttps ? parsed.protocol !== "https:" : !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(requireHttps ? "O endereço de pagamento deve usar HTTPS." : "Use uma URL HTTP ou HTTPS.");
  }
  if (!parsed.hostname) throw new Error("Informe uma URL válida.");
  parsed.hash = "";
  return parsed.toString();
}

function normalizePairingCode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 8 || [...compact].some((character) => !PAIRING_CODE_ALPHABET.includes(character))) {
    throw new Error("Código de pareamento inválido.");
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function newPairingCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = crypto.randomBytes(8);
    const compact = [...bytes].map((byte) => PAIRING_CODE_ALPHABET[byte % PAIRING_CODE_ALPHABET.length]).join("");
    const code = `${compact.slice(0, 4)}-${compact.slice(4)}`;
    if (!pairingSessions.has(code)) return code;
  }
  throw new Error("Não foi possível gerar um código de pareamento. Tente novamente.");
}

function hashDeviceToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest();
}

function verifyDeviceToken(entry, token) {
  if (!entry?.deviceTokenHash || typeof token !== "string" || token.length < 32 || token.length > 200) return false;
  const candidate = hashDeviceToken(token);
  return candidate.length === entry.deviceTokenHash.length && crypto.timingSafeEqual(candidate, entry.deviceTokenHash);
}

function encryptPairingDescriptor(descriptor) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", PAIRING_ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(descriptor), "utf8"), cipher.final()]);
  return { iv, ciphertext, authenticationTag: cipher.getAuthTag() };
}

function decryptPairingDescriptor(encrypted) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", PAIRING_ENCRYPTION_KEY, encrypted.iv);
  decipher.setAuthTag(encrypted.authenticationTag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString("utf8"));
}

function normalizePairingDescriptor(input) {
  const value = input && typeof input === "object" ? input : {};
  const type = String(value.type || value.kind || "").trim().toLowerCase();
  const name = safeLabel(value.name || value.label || (type === "xtream" ? "Lista Xtream" : "Lista M3U"));
  if (type === "xtream") {
    const rawServerUrl = String(value.serverUrl || value.server || "").trim();
    if (!rawServerUrl || rawServerUrl.length > 2048) throw new Error("Informe o endereço do servidor Xtream.");
    let inputUrl = rawServerUrl;
    if (inputUrl.startsWith("//")) inputUrl = `http:${inputUrl}`;
    else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(inputUrl)) inputUrl = `http://${inputUrl}`;
    const parsed = new URL(normalizeHttpUrl(inputUrl, { maxLength: 2048 }));
    const embeddedUsername = parsed.searchParams.get("username") || parsed.searchParams.get("user") || "";
    const embeddedPassword = parsed.searchParams.get("password") || parsed.searchParams.get("pass") || "";
    const username = String(value.username || embeddedUsername || "").trim();
    const password = String(value.password || embeddedPassword || "");
    if (!username || !password || username.length > 512 || password.length > 512) {
      throw new Error("Informe usuário e senha da lista Xtream.");
    }
    parsed.username = "";
    parsed.password = "";
    parsed.pathname = parsed.pathname.replace(/\/(?:player_api|panel_api|get|xmltv)\.php\/?$/i, "").replace(/\/+$/, "");
    parsed.search = "";
    return {
      type: "xtream",
      name,
      serverUrl: parsed.toString().replace(/\/$/, ""),
      username,
      password
    };
  }
  if (type === "m3u" || type === "playlist") {
    const url = normalizeHttpUrl(value.url || value.m3uUrl, { maxLength: 4096 });
    return { type: "m3u", name, url };
  }
  throw new Error("Escolha uma lista Xtream ou M3U.");
}

function parseXtreamServer(value) {
  let input = String(value || "").trim();
  if (!input) throw new Error("Informe o endereço do servidor.");
  if (input.startsWith("//")) input = `http:${input}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = `http://${input}`;
  const parsed = new URL(input);
  const embeddedUsername = parsed.searchParams.get("username") || parsed.searchParams.get("user") || "";
  const embeddedPassword = parsed.searchParams.get("password") || parsed.searchParams.get("pass") || "";
  parsed.pathname = parsed.pathname.replace(/\/(?:player_api|panel_api|get|xmltv)\.php\/?$/i, "").replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return { base: parsed.toString().replace(/\/$/, ""), embeddedUsername, embeddedPassword };
}

function normalizeBaseUrl(value) {
  return parseXtreamServer(value).base;
}

const ticketStore = createTicketStore({
  maxPerOwner: MAX_TICKETS_PER_OWNER,
  maxTotal: MAX_STREAM_TICKETS,
  sessionTtlMs: SESSION_TTL,
  hlsTtlMs: HLS_TICKET_TTL,
  sharedOwner: SHARED_TICKET_OWNER
});
const imageSigner = createUrlSigner(IMAGE_SIGNING_KEY);
const xtreamSessions = new Map();
const pairingSessions = new Map();

function signedImageUrl(rawUrl) {
  const signed = imageSigner.sign(rawUrl);
  return signed ? `/api/image/${signed}` : "";
}

function registerStream(remoteUrl, kind = "media", ownerId = SHARED_TICKET_OWNER) {
  const token = ticketStore.register(remoteUrl, kind, ownerId);
  return token ? `/api/stream/${token}` : "";
}

function activeStreamTicket(token) {
  return ticketStore.active(token);
}

function allowDirectRoute(req) {
  const nativeClient = /GATE-TV-NATIVE/i.test(String(req.headers["user-agent"] || ""));
  if (!nativeClient) return false;
  if (!NATIVE_DIRECT_KEY) return true;
  const provided = String(req.get("x-gate-native-key") || "");
  if (provided.length !== NATIVE_DIRECT_KEY.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(NATIVE_DIRECT_KEY, "utf8"));
}

function streamTicketResponse(token, entry) {
  return {
    playUrl: `/api/stream/${token}`,
    streamType: streamTypeFor(entry.url),
    expiresAt: new Date(entry.expiresAt).toISOString(),
    expiresInSeconds: Math.floor((entry.ttlMs || SESSION_TTL) / 1000)
  };
}

function imageContentType(rawUrl, reportedType = "") {
  if (/^image\/(?:avif|bmp|gif|jpe?g|png|svg\+xml|webp|x-icon)/i.test(reportedType)) {
    return reportedType;
  }
  const pathname = (() => {
    try { return new URL(String(rawUrl || "")).pathname.toLowerCase(); }
    catch { return String(rawUrl || "").toLowerCase(); }
  })();
  if (/\.png$/.test(pathname)) return "image/png";
  if (/\.webp$/.test(pathname)) return "image/webp";
  if (/\.gif$/.test(pathname)) return "image/gif";
  if (/\.svg$/.test(pathname)) return "image/svg+xml";
  if (/\.avif$/.test(pathname)) return "image/avif";
  if (/\.ico$/.test(pathname)) return "image/x-icon";
  return "image/jpeg";
}

function detectedImageContentType(bytes, rawUrl, reportedType = "") {
  if (bytes?.length >= 12) {
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png";
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
    const beginning = new TextDecoder().decode(bytes.slice(0, 320)).trimStart();
    if (beginning.startsWith("<svg") || beginning.startsWith("<?xml") && beginning.includes("<svg")) return "image/svg+xml";
  }
  return imageContentType(rawUrl, reportedType);
}

function streamTypeFor(url, fallback = "auto") {
  const pathname = (() => { try { return new URL(url).pathname; } catch { return String(url || ""); } })();
  if (/\.m3u8$/i.test(pathname)) return "hls";
  if (/\.ts$/i.test(pathname)) return "mpegts";
  if (/\.(mp4|mkv|avi)$/i.test(pathname)) return "video";
  return fallback;
}

function proxiedItem({ id, name, group, logo, url, streamType, fallbackUrl, fallbackStreamType, seriesId, sessionId, ownerId, season, description, rating, year, genre, epgChannelId }) {
  const owner = ownerId || sessionId || SHARED_TICKET_OWNER;
  return {
    ...(id != null ? { id: String(id) } : {}),
    name: safeLabel(name),
    group: safeLabel(group || "Outros"),
    logo: logo ? signedImageUrl(logo) : "",
    playUrl: url ? registerStream(url, "media", owner) : "",
    streamType: streamType || (url ? streamTypeFor(url) : "auto"),
    ...(fallbackUrl ? {
      fallbackPlayUrl: registerStream(fallbackUrl, "media", owner),
      fallbackStreamType: fallbackStreamType || streamTypeFor(fallbackUrl)
    } : {}),
    ...(seriesId != null ? { seriesId: String(seriesId) } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(season != null ? { season: Number(season) || 0 } : {}),
    ...(description ? { description: safeText(description) } : {}),
    ...(rating ? { rating: safeLabel(rating, "") } : {}),
    ...(year ? { year: safeLabel(year, "") } : {}),
    ...(genre ? { genre: safeLabel(genre, "") } : {}),
    ...(epgChannelId ? { epgChannelId: safeLabel(epgChannelId, "") } : {})
  };
}

function parseM3u(text, ownerId = SHARED_TICKET_OWNER, limit = MAX_CATALOG_ITEMS) {
  const lines = String(text || "").split(/\r?\n/);
  const result = { channels: [], movies: [], series: [] };
  let metadata = null;
  let total = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) {
      const title = line.includes(",") ? line.slice(line.lastIndexOf(",") + 1).trim() : "Canal";
      const attr = (name) => line.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] || "";
      metadata = {
        name: safeLabel(attr("tvg-name") || title),
        group: safeLabel(attr("group-title") || "Outros"),
        logo: attr("tvg-logo"),
        epgChannelId: attr("tvg-id")
      };
    } else if (metadata && /^(https?:\/\/)/i.test(line)) {
      const group = metadata.group.toLowerCase();
      const pathname = (() => { try { return new URL(line).pathname.toLowerCase(); } catch { return ""; } })();
      const kind = pathname.includes("/movie/") || /filmes?|movies?|vod/.test(group)
        ? "movies"
        : pathname.includes("/series/") || /s[eé]ries?|novelas?|animes?/.test(group) ? "series" : "channels";
      result[kind].push(proxiedItem({ ...metadata, url: line, ownerId }));
      metadata = null;
      total += 1;
      if (total >= limit) break;
    }
  }
  return result;
}

function xtreamApi(base, username, password, action = "", apiPath = "player_api.php") {
  const query = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  return `${base}/${apiPath}?${query}${action ? `&action=${action}` : ""}`;
}

function payloadArray(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  if (payload && typeof payload === "object") {
    const values = Object.values(payload);
    if (values.length && values.every((value) => value && typeof value === "object")) return values;
  }
  return [];
}

function categoryMap(items) {
  return new Map(payloadArray(items, ["categories", "data"]).map((item) => [String(item.category_id ?? item.id), safeLabel(item.category_name || item.name || "Outros")]));
}

async function connectXtream({ serverUrl, username, password, source = "xtream" }) {
  const parsedServer = parseXtreamServer(serverUrl);
  const base = parsedServer.base;
  username = String(username || parsedServer.embeddedUsername || "").trim();
  password = String(password || parsedServer.embeddedPassword || "");
  if (!username || !password) throw new Error("Informe usuário e senha.");
  await validateRemoteUrl(base);
  let account;
  let apiPath = "player_api.php";
  let accountError;
  for (const candidate of ["player_api.php", "panel_api.php"]) {
    try {
      account = await safeFetch(xtreamApi(base, username, password, "", candidate), { maxBytes: 2_000_000, asJson: true, timeoutMs: 25_000 });
      if (account?.user_info || account?.userInfo) { apiPath = candidate; break; }
    } catch (error) { accountError = error; }
  }
  const userInfo = account?.user_info || account?.userInfo;
  if (!userInfo) throw accountError || new Error("A fonte não retornou uma conta Xtream compatível.");
  if (["0", "false", "disabled", "banned", "expired"].includes(String(userInfo.auth ?? userInfo.status ?? "1").toLowerCase())) throw new Error("A fonte não autorizou estes dados.");

  const [categoriesResult, liveResult] = await Promise.allSettled([
    safeFetch(xtreamApi(base, username, password, "get_live_categories", apiPath), { maxBytes: 3_000_000, asJson: true, timeoutMs: 35_000 }),
    safeFetch(xtreamApi(base, username, password, "get_live_streams", apiPath), { maxBytes: MAX_CATALOG_BYTES, asJson: true, timeoutMs: 45_000 })
  ]);
  const live = liveResult.status === "fulfilled" ? payloadArray(liveResult.value, ["live_streams", "streams", "channels", "data"]) : [];
  if (!live.length) {
    const reason = liveResult.status === "rejected" ? liveResult.reason?.message : "Nenhum canal foi retornado.";
    throw new Error(`A conta foi autenticada, mas os canais não puderam ser carregados. ${reason || ""}`.trim());
  }
  const liveCategories = categoryMap(categoriesResult.status === "fulfilled" ? categoriesResult.value : []);
  const formats = Array.isArray(userInfo.allowed_output_formats) ? userInfo.allowed_output_formats : String(userInfo.allowed_output_formats || "").split(/[,|\s]+/);
  const supportsHls = formats.some((format) => String(format).toLowerCase() === "m3u8");
  const supportsTs = !formats.length || formats.some((format) => ["ts", "mpegts", "mpeg-ts"].includes(String(format).toLowerCase()));
  const extension = supportsHls ? "m3u8" : "ts";
  const sessionId = crypto.randomBytes(18).toString("base64url");
  xtreamSessions.set(sessionId, { base, username, password, apiPath, expiresAt: Date.now() + SESSION_TTL });
  const channels = live.slice(0, MAX_LIVE_ITEMS).map((item) => proxiedItem({
    ownerId: sessionId,
    id: item.stream_id ?? item.id ?? item.num,
    name: item.name || item.title,
    logo: item.stream_icon || item.logo || item.tvg_logo,
    group: liveCategories.get(String(item.category_id ?? item.category)) || item.category_name || item.group || "Ao vivo",
    epgChannelId: item.epg_channel_id || item.tvg_id,
    url: `${base}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${item.stream_id ?? item.id}.${extension}`,
    streamType: extension === "m3u8" ? "hls" : "mpegts",
    fallbackUrl: supportsHls && supportsTs
      ? `${base}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${item.stream_id ?? item.id}.ts`
      : "",
    fallbackStreamType: "mpegts"
  }));
  return {
    source,
    sessionId,
    account: {
      username: safeLabel(username),
      status: safeLabel(userInfo.status || "Ativo"),
      expiresAt: userInfo.exp_date ? new Date(Number(userInfo.exp_date) * 1000).toISOString() : null,
      maxConnections: Number(userInfo.max_connections || 0)
    },
    counts: { live: live.length, loadedLive: channels.length, movies: null, series: null },
    channels,
    movies: [],
    series: []
  };
}

function maybeDecodeBase64(value) {
  const text = String(value || "").trim();
  if (!text || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return text;
  try {
    const decoded = Buffer.from(text, "base64").toString("utf8");
    if (!decoded || decoded.includes("\uFFFD") || /[\u0000-\u0008]/.test(decoded)) return text;
    return decoded;
  } catch { return text; }
}

function epgTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric).toISOString();
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeEpgListing(listing) {
  return {
    title: safeText(maybeDecodeBase64(listing?.title) || "Programação não informada", 220),
    description: safeText(maybeDecodeBase64(listing?.description), 600),
    start: epgTimestamp(listing?.start_timestamp || listing?.start),
    end: epgTimestamp(listing?.stop_timestamp || listing?.end)
  };
}

function getXtreamSession(sessionId) {
  const session = xtreamSessions.get(String(sessionId || ""));
  if (!session || session.expiresAt <= Date.now()) throw new Error("A sessão da lista expirou. Conecte a lista novamente.");
  session.expiresAt = Date.now() + SESSION_TTL;
  return session;
}

function rewriteManifest(text, baseUrl, ownerId = SHARED_TICKET_OWNER) {
  return String(text).split(/\r?\n/).map((rawLine) => {
    const line = rawLine.trim();
    if (!line) return rawLine;
    if (!line.startsWith("#")) return registerStream(new URL(line, baseUrl).toString(), "hls", ownerId);
    return rawLine.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${registerStream(new URL(uri, baseUrl).toString(), "hls", ownerId)}"`);
  }).join("\n");
}

function expirePairingSession(entry, now = Date.now()) {
  if (!["consumed", "expired"].includes(entry.status) && entry.expiresAt <= now) {
    entry.status = "expired";
    entry.encryptedDescriptor = null;
    entry.descriptorType = null;
    entry.deviceTokenHash = null;
    entry.purgeAt = now + PAIRING_TOMBSTONE_TTL;
  }
  return entry;
}

function publicPairingSession(entry) {
  expirePairingSession(entry);
  return {
    code: entry.code,
    status: entry.status,
    expiresAt: new Date(entry.expiresAt).toISOString(),
    ...(entry.descriptorType ? { descriptorType: entry.descriptorType } : {}),
    ...(entry.submittedAt ? { submittedAt: new Date(entry.submittedAt).toISOString() } : {}),
    ...(entry.consumedAt ? { consumedAt: new Date(entry.consumedAt).toISOString() } : {})
  };
}

function pairingBaseUrl(req) {
  const production = IS_PRODUCTION;
  const railwayDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN || "").trim();
  const railwayUrl = railwayDomain
    ? (/^https?:\/\//i.test(railwayDomain) ? railwayDomain : `https://${railwayDomain}`)
    : "";
  const configured = String(process.env.PUBLIC_APP_URL || (production ? railwayUrl : process.env.APP_URL) || "").trim();
  if (configured) {
    try {
      return normalizeHttpUrl(configured, { maxLength: 2048, requireHttps: production }).replace(/\/$/, "");
    } catch {
      throw new Error("PUBLIC_APP_URL inválida para o pareamento.");
    }
  }
  if (production) throw new Error("Configure PUBLIC_APP_URL ou RAILWAY_PUBLIC_DOMAIN com a origem HTTPS pública do aplicativo.");
  const host = String(req.get("host") || "").replace(/[\r\n]/g, "");
  if (!host) throw new Error("Não foi possível determinar o endereço público do aplicativo.");
  if (/[\s/@\\?#]/.test(host)) throw new Error("Host local inválido para o pareamento.");
  let origin;
  try { origin = new URL(`${req.protocol}://${host}`); }
  catch { throw new Error("Host local inválido para o pareamento."); }
  const hostname = origin.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const localHostname = hostname === "localhost" || hostname.endsWith(".localhost");
  const localAddress = net.isIP(hostname) > 0 && isPrivateIp(hostname);
  if (!localHostname && !localAddress) {
    throw new Error("Configure PUBLIC_APP_URL para gerar links de pareamento fora do ambiente local.");
  }
  return origin.origin;
}

function configuredPaymentLink() {
  try {
    return process.env.PAYMENT_LINK_URL
      ? normalizeHttpUrl(process.env.PAYMENT_LINK_URL, { maxLength: 4096, requireHttps: true })
      : null;
  } catch { return null; }
}

function configuredVastAdTagUrl() {
  const rawUrl = String(process.env.VAST_AD_TAG_URL || "").trim();
  if (!rawUrl) return null;
  try {
    const normalized = normalizeHttpUrl(rawUrl, { maxLength: 8192, requireHttps: true });
    const parsed = new URL(normalized);
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch { return null; }
}

function advertisingConfiguration() {
  const vastAdTagUrl = configuredVastAdTagUrl();
  const enabled = Boolean(vastAdTagUrl);
  return {
    enabled,
    mode: enabled ? "vast" : "house",
    provider: enabled ? "google-ima" : null,
    sdkUrl: enabled ? IMA_SDK_URL : null,
    vastAdTagUrl,
    loadTimeoutMs: 7_000,
    maxPlaybackSeconds: 45,
    fallback: "house",
    houseAd: { enabled: true, durationSeconds: 10 }
  };
}

function billingConfiguration() {
  const mercadoPago = Boolean(String(process.env.MERCADOPAGO_ACCESS_TOKEN || "").trim());
  const paymentLink = configuredPaymentLink();
  const providerConfigured = mercadoPago || Boolean(paymentLink);
  return {
    checkoutAvailable: false,
    activationReady: false,
    providerConfigured,
    provider: providerConfigured ? "activation_pending" : "unconfigured"
  };
}

function respondWithCheckout(_req, res, context = {}) {
  res.setHeader("cache-control", "no-store");
  const configuration = billingConfiguration();
  return res.status(503).json({
    ...(context.mac ? { mac: context.mac } : {}),
    status: "payment_not_configured",
    code: configuration.providerConfigured ? "ACTIVATION_PIPELINE_REQUIRED" : "PAYMENT_NOT_CONFIGURED",
    error: configuration.providerConfigured
      ? "A cobrança está bloqueada até a confirmação autenticada e a ativação persistente da licença estarem concluídas."
      : "A cobrança ainda não foi configurada.",
    plan: ANNUAL_PLAN
  });
}

app.post("/api/client-diagnostics", (req, res) => {
  const platform = String(req.body?.platform || "unknown").replace(/[^a-z0-9_-]/gi, "").slice(0, 30);
  const kind = String(req.body?.kind || "event").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
  const message = String(req.body?.message || "").replace(/[\r\n]/g, " ").slice(0, 500);
  const extra = String(req.body?.extra || "").replace(/[\r\n]/g, " ").slice(0, 300);
  console.warn(`CLIENT_DIAGNOSTIC platform=${platform} kind=${kind} message=${JSON.stringify(message)} extra=${JSON.stringify(extra)}`);
  res.setHeader("cache-control", "no-store");
  return res.status(204).end();
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "gate-iptv-player", version: APP_VERSION }));
app.get("/api/config", (_req, res) => {
  const billing = billingConfiguration();
  const ads = advertisingConfiguration();
  return res.json({
    annualPrice: ANNUAL_PLAN.amount,
    currency: ANNUAL_PLAN.currency,
    adDurationSeconds: ads.houseAd.durationSeconds,
    ads,
    paymentAvailable: billing.checkoutAvailable,
    subscription: ANNUAL_PLAN,
    billing
  });
});
app.get("/api/billing/config", (_req, res) => res.json({ plan: ANNUAL_PLAN, ...billingConfiguration() }));

app.post("/api/pairing/sessions", sensitiveRateLimit("pairing_create", 12, 60_000), (req, res) => {
  try {
    const now = Date.now();
    const code = newPairingCode();
    const deviceToken = crypto.randomBytes(32).toString("base64url");
    const entry = {
      code,
      status: "pending",
      encryptedDescriptor: null,
      descriptorType: null,
      deviceTokenHash: hashDeviceToken(deviceToken),
      createdAt: now,
      expiresAt: now + PAIRING_SESSION_TTL,
      purgeAt: now + PAIRING_SESSION_TTL + PAIRING_TOMBSTONE_TTL
    };
    pairingSessions.set(code, entry);
    const pairUrl = new URL("/pair", `${pairingBaseUrl(req)}/`);
    pairUrl.searchParams.set("code", code);
    const qrDataUrl = createQrSvgDataUrl(pairUrl.toString());
    res.setHeader("cache-control", "no-store");
    return res.status(201).json({
      ...publicPairingSession(entry),
      deviceToken,
      pairUrl: pairUrl.toString(),
      qrTargetUrl: pairUrl.toString(),
      qrDataUrl,
      statusUrl: `/api/pairing/${encodeURIComponent(code)}`,
      submitUrl: `/api/pairing/${encodeURIComponent(code)}`,
      consumeUrl: `/api/pairing/${encodeURIComponent(code)}/consume`,
      expiresInSeconds: Math.ceil(PAIRING_SESSION_TTL / 1000)
    });
  } catch {
    return res.status(500).json({ error: "Não foi possível iniciar o pareamento." });
  }
});

app.get("/api/pairing/:code", sensitiveRateLimit("pairing_lookup", 60, 60_000), (req, res) => {
  let code;
  try { code = normalizePairingCode(req.params.code); }
  catch (error) { return res.status(400).json({ error: error.message, code: "INVALID_PAIRING_CODE" }); }
  const entry = pairingSessions.get(code);
  if (!entry) return res.status(404).json({ error: "Código de pareamento não encontrado.", code: "PAIRING_NOT_FOUND" });
  res.setHeader("cache-control", "no-store");
  return res.json(publicPairingSession(entry));
});

app.put("/api/pairing/:code", sensitiveRateLimit("pairing_submit", 8, 10 * 60_000), (req, res) => {
  let code;
  try { code = normalizePairingCode(req.params.code); }
  catch (error) { return res.status(400).json({ error: error.message, code: "INVALID_PAIRING_CODE" }); }
  const entry = pairingSessions.get(code);
  if (!entry) return res.status(404).json({ error: "Código de pareamento não encontrado.", code: "PAIRING_NOT_FOUND" });
  expirePairingSession(entry);
  if (entry.status === "expired") return res.status(410).json({ error: "Este código expirou. Gere um novo código na TV.", code: "PAIRING_EXPIRED" });
  if (entry.status === "consumed") return res.status(410).json({ error: "Este código já foi consumido.", code: "PAIRING_CONSUMED" });
  if (entry.status === "ready") return res.status(409).json({ error: "Uma lista já foi enviada para este código.", code: "PAIRING_ALREADY_SUBMITTED" });
  try {
    const descriptor = normalizePairingDescriptor(req.body?.descriptor || req.body);
    entry.encryptedDescriptor = encryptPairingDescriptor(descriptor);
    entry.descriptorType = descriptor.type;
    entry.status = "ready";
    entry.submittedAt = Date.now();
    res.setHeader("cache-control", "no-store");
    return res.status(202).json(publicPairingSession(entry));
  } catch (error) {
    return res.status(422).json({ error: error.message || "Os dados da lista são inválidos.", code: "INVALID_PLAYLIST_DESCRIPTOR" });
  }
});

app.post("/api/pairing/:code/consume", sensitiveRateLimit("pairing_consume", 30, 60_000), (req, res) => {
  let code;
  try { code = normalizePairingCode(req.params.code); }
  catch (error) { return res.status(400).json({ error: error.message, code: "INVALID_PAIRING_CODE" }); }
  const entry = pairingSessions.get(code);
  if (!entry) return res.status(404).json({ error: "Código de pareamento não encontrado.", code: "PAIRING_NOT_FOUND" });
  expirePairingSession(entry);
  if (entry.status === "expired") return res.status(410).json({ error: "Este código expirou. Gere um novo código na TV.", code: "PAIRING_EXPIRED" });
  if (entry.status === "consumed") return res.status(410).json({ error: "Os dados deste pareamento já foram consumidos.", code: "PAIRING_CONSUMED" });
  const authorization = String(req.get("authorization") || "");
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!verifyDeviceToken(entry, token)) {
    return res.status(401).json({ error: "Token do dispositivo inválido.", code: "INVALID_DEVICE_TOKEN" });
  }
  if (entry.status !== "ready" || !entry.encryptedDescriptor) {
    return res.status(409).json({ error: "A lista ainda não foi enviada pelo celular.", code: "PAIRING_NOT_READY" });
  }
  let descriptor;
  try { descriptor = decryptPairingDescriptor(entry.encryptedDescriptor); }
  catch { return res.status(500).json({ error: "Não foi possível recuperar os dados pareados.", code: "PAIRING_DATA_UNAVAILABLE" }); }
  entry.encryptedDescriptor = null;
  entry.descriptorType = null;
  entry.deviceTokenHash = null;
  entry.status = "consumed";
  entry.consumedAt = Date.now();
  entry.purgeAt = entry.consumedAt + PAIRING_TOMBSTONE_TTL;
  res.setHeader("cache-control", "no-store");
  return res.json({ code, status: "consumed", consumedAt: new Date(entry.consumedAt).toISOString(), descriptor });
});

app.post("/api/billing/checkout", sensitiveRateLimit("billing_checkout", 10, 10 * 60_000), (req, res) => respondWithCheckout(req, res));

app.post("/api/m3u/parse", async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    if (!url) return res.status(400).json({ error: "Informe a URL da lista." });
    const parsed = await validateRemoteUrl(url);
    const username = parsed.searchParams.get("username");
    const password = parsed.searchParams.get("password");
    if (/\/get\.php$/i.test(parsed.pathname) && username && password) {
      const serverUrl = `${parsed.protocol}//${parsed.host}`;
      return res.json(await connectXtream({ serverUrl, username, password, source: "xtream-m3u" }));
    }
    const text = await safeFetch(url, { maxBytes: MAX_CATALOG_BYTES, timeoutMs: 50_000 });
    if (!/^#EXTM3U/m.test(text)) return res.status(422).json({ error: "O arquivo não parece ser uma lista M3U válida." });
    const listOwner = crypto.randomBytes(18).toString("base64url");
    const catalog = parseM3u(text, listOwner);
    const count = catalog.channels.length + catalog.movies.length + catalog.series.length;
    if (!count) return res.status(422).json({ error: "Nenhum item reproduzível foi encontrado na lista." });
    return res.json({ source: "m3u", count, counts: { live: catalog.channels.length, movies: catalog.movies.length, series: catalog.series.length }, ...catalog });
  } catch (error) {
    return res.status(422).json({ error: error.message || "Não foi possível abrir a lista." });
  }
});

app.post("/api/xtream/connect", async (req, res) => {
  try {
    const serverUrl = String(req.body?.serverUrl || "").trim();
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) return res.status(400).json({ error: "Informe usuário e senha." });
    return res.json(await connectXtream({ serverUrl, username, password }));
  } catch (error) {
    return res.status(422).json({ error: error.message || "Não foi possível conectar à fonte Xtream." });
  }
});

app.post("/api/xtream/catalog", async (req, res) => {
  try {
    const session = getXtreamSession(req.body?.sessionId);
    const kind = req.body?.kind === "series" ? "series" : "movies";
    const categoryAction = kind === "movies" ? "get_vod_categories" : "get_series_categories";
    const contentAction = kind === "movies" ? "get_vod_streams" : "get_series";
    const [categoriesResult, itemsResult] = await Promise.allSettled([
      safeFetch(xtreamApi(session.base, session.username, session.password, categoryAction, session.apiPath), { maxBytes: 3_000_000, asJson: true, timeoutMs: 35_000 }),
      safeFetch(xtreamApi(session.base, session.username, session.password, contentAction, session.apiPath), { maxBytes: MAX_CATALOG_BYTES, asJson: true, timeoutMs: 55_000 })
    ]);
    const rawItems = itemsResult.status === "fulfilled" ? payloadArray(itemsResult.value, kind === "movies" ? ["vod_streams", "movies", "streams", "data"] : ["series", "items", "data"]) : [];
    if (!rawItems.length && itemsResult.status === "rejected") throw itemsResult.reason;
    const categories = categoryMap(categoriesResult.status === "fulfilled" ? categoriesResult.value : []);
    const items = rawItems.slice(0, MAX_CATALOG_ITEMS).map((item) => {
      const common = {
        ownerId: req.body.sessionId,
        id: kind === "movies" ? (item.stream_id ?? item.vod_id ?? item.movie_id ?? item.id) : (item.series_id ?? item.id),
        name: item.name || item.title,
        logo: kind === "movies" ? (item.stream_icon || item.cover || item.cover_big || item.logo) : (item.cover || item.cover_big || item.stream_icon || item.logo),
        group: categories.get(String(item.category_id ?? item.category)) || item.category_name || item.group || (kind === "movies" ? "Filmes" : "Séries"),
        description: item.plot || item.description || item.info?.plot,
        rating: item.rating || item.rating_5based,
        year: item.year || item.releaseDate || item.releasedate,
        genre: item.genre
      };
      if (kind === "movies") {
        const extension = String(item.container_extension || "mp4").replace(/[^a-z0-9]/gi, "") || "mp4";
        const streamId = item.stream_id ?? item.vod_id ?? item.movie_id ?? item.id;
        return proxiedItem({ ...common, url: `${session.base}/movie/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${streamId}.${extension}`, streamType: extension === "m3u8" ? "hls" : "video" });
      }
      return proxiedItem({ ...common, seriesId: item.series_id ?? item.id, sessionId: req.body.sessionId });
    });
    return res.json({ kind, total: rawItems.length, loaded: items.length, items });
  } catch (error) {
    return res.status(422).json({ error: error.message || "Não foi possível carregar este catálogo." });
  }
});

app.post("/api/xtream/epg", async (req, res) => {
  try {
    const session = getXtreamSession(req.body?.sessionId);
    const streamIds = [...new Set((Array.isArray(req.body?.streamIds) ? req.body.streamIds : [])
      .map((value) => String(value || "").replace(/[^0-9]/g, ""))
      .filter(Boolean))].slice(0, 10);
    if (!streamIds.length) return res.json({ items: {} });
    const results = await Promise.allSettled(streamIds.map(async (streamId) => {
      const url = `${xtreamApi(session.base, session.username, session.password, "get_short_epg", session.apiPath)}&stream_id=${encodeURIComponent(streamId)}&limit=3`;
      const payload = await safeFetch(url, { maxBytes: 1_500_000, asJson: true, timeoutMs: 20_000 });
      const listings = (Array.isArray(payload?.epg_listings) ? payload.epg_listings : Array.isArray(payload) ? payload : [])
        .map(normalizeEpgListing)
        .filter((item) => item.title)
        .sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
      const now = Date.now();
      const currentIndex = listings.findIndex((item) => {
        const start = item.start ? new Date(item.start).getTime() : 0;
        const end = item.end ? new Date(item.end).getTime() : Number.POSITIVE_INFINITY;
        return start <= now && now < end;
      });
      const current = listings[currentIndex >= 0 ? currentIndex : 0] || null;
      const next = listings[currentIndex >= 0 ? currentIndex + 1 : 1] || null;
      return [streamId, { current, next }];
    }));
    const items = Object.fromEntries(results.filter((result) => result.status === "fulfilled").map((result) => result.value));
    return res.json({ items });
  } catch (error) {
    return res.status(422).json({ error: error.message || "Não foi possível carregar o guia dos canais." });
  }
});

function seriesPayload(session, info, ownerId = SHARED_TICKET_OWNER) {
  const seriesInfo = info?.info || info?.series_info || {};
  const seasonEntries = Array.isArray(info?.episodes) ? [["1", info.episodes]] : Object.entries(info?.episodes || {});
  const episodes = seasonEntries.flatMap(([season, entries]) => payloadArray(entries, ["episodes", "items", "data"]).map((episode) => {
    const extension = String(episode.container_extension || episode.extension || "mp4").replace(/[^a-z0-9]/gi, "") || "mp4";
    const episodeId = episode.id ?? episode.stream_id ?? episode.episode_id;
    return proxiedItem({
      ownerId,
      id: episodeId,
      name: episode.title || episode.name || `Episódio ${episode.episode_num || episodeId}`,
      group: `Temporada ${episode.season ?? season}`,
      season: episode.season ?? season,
      logo: episode.info?.movie_image || episode.movie_image || seriesInfo.cover || seriesInfo.cover_big,
      description: episode.info?.plot || episode.plot || episode.description || seriesInfo.plot || seriesInfo.description,
      rating: episode.info?.rating || episode.rating || seriesInfo.rating,
      year: episode.info?.releasedate || episode.releasedate || seriesInfo.releaseDate || seriesInfo.year,
      url: `${session.base}/series/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${episodeId}.${extension}`,
      streamType: extension === "m3u8" ? "hls" : "video"
    });
  })).filter((episode) => episode.id && episode.playUrl).sort((a, b) => (a.season - b.season) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  return {
    name: safeLabel(seriesInfo.name || seriesInfo.title || "Série"),
    description: safeText(seriesInfo.plot || seriesInfo.description),
    rating: safeLabel(seriesInfo.rating || "", ""),
    genre: safeLabel(seriesInfo.genre || "", ""),
    year: safeLabel(seriesInfo.releaseDate || seriesInfo.releasedate || seriesInfo.year || "", ""),
    logo: seriesInfo.cover || seriesInfo.cover_big ? signedImageUrl(seriesInfo.cover || seriesInfo.cover_big) : "",
    episodes: episodes.slice(0, 700)
  };
}

app.post("/api/xtream/details", async (req, res) => {
  try {
    const session = getXtreamSession(req.body?.sessionId);
    const kind = req.body?.kind === "series" ? "series" : "movies";
    const itemId = String(req.body?.itemId || "").replace(/[^0-9]/g, "");
    if (!itemId) return res.status(400).json({ error: "Conteúdo inválido." });
    if (kind === "series") {
      const info = await safeFetch(`${xtreamApi(session.base, session.username, session.password, "get_series_info", session.apiPath)}&series_id=${encodeURIComponent(itemId)}`, { maxBytes: Math.min(MAX_CATALOG_BYTES, 18_000_000), asJson: true, timeoutMs: 45_000 });
      const payload = seriesPayload(session, info, req.body.sessionId);
      return res.json({
        name: payload.name,
        description: payload.description,
        rating: payload.rating,
        genre: payload.genre,
        year: payload.year,
        logo: payload.logo,
        firstEpisode: payload.episodes[0] || null
      });
    }
    const payload = await safeFetch(`${xtreamApi(session.base, session.username, session.password, "get_vod_info", session.apiPath)}&vod_id=${encodeURIComponent(itemId)}`, { maxBytes: 6_000_000, asJson: true, timeoutMs: 35_000 });
    const movie = payload?.movie_data || payload?.movie || {};
    const info = payload?.info || payload?.vod_info || {};
    const logo = info.movie_image || info.cover_big || info.cover || movie.stream_icon || movie.cover || "";
    return res.json({
      name: safeLabel(movie.name || info.name || info.title || "Filme"),
      description: safeText(info.plot || info.description || movie.plot || movie.description),
      rating: safeLabel(info.rating || info.rating_5based || movie.rating || "", ""),
      genre: safeLabel(info.genre || movie.genre || "", ""),
      year: safeLabel(info.year || info.releasedate || info.releaseDate || movie.year || "", ""),
      logo: logo ? signedImageUrl(logo) : ""
    });
  } catch (error) {
    return res.status(422).json({ error: error.message || "Não foi possível carregar os detalhes." });
  }
});

app.post("/api/xtream/series", async (req, res) => {
  try {
    const session = getXtreamSession(req.body?.sessionId);
    const seriesId = String(req.body?.seriesId || "").replace(/[^0-9]/g, "");
    if (!seriesId) return res.status(400).json({ error: "Série inválida." });
    const info = await safeFetch(`${xtreamApi(session.base, session.username, session.password, "get_series_info", session.apiPath)}&series_id=${encodeURIComponent(seriesId)}`, { maxBytes: Math.min(MAX_CATALOG_BYTES, 18_000_000), asJson: true, timeoutMs: 45_000 });
    return res.json(seriesPayload(session, info, req.body.sessionId));
  } catch (error) {
    return res.status(422).json({ error: error.message || "Não foi possível carregar os episódios." });
  }
});

app.post("/api/streams/register", async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 800) : [];
    if (!items.length) return res.status(400).json({ error: "Nenhum item foi informado." });
    const checkedHosts = new Map();
    for (const item of items) {
      const parsed = new URL(String(item.url || ""));
      const hostKey = `${parsed.protocol}//${parsed.host}`;
      if (!checkedHosts.has(hostKey)) checkedHosts.set(hostKey, validateRemoteUrl(parsed.toString()));
    }
    await Promise.all(checkedHosts.values());
    const owner = String(req.body?.sessionId || "") || crypto.randomBytes(18).toString("base64url");
    return res.json({ items: items.map((item) => proxiedItem({ ...item, ownerId: owner })) });
  } catch (error) {
    return res.status(422).json({ error: error.message || "Não foi possível preparar os itens." });
  }
});

app.post("/api/stream/register", async (req, res) => {
  try {
    const parsed = await validateRemoteUrl(req.body?.url);
    const owner = String(req.body?.sessionId || "") || crypto.randomBytes(18).toString("base64url");
    return res.json({ playUrl: registerStream(parsed.toString(), "media", owner), streamType: streamTypeFor(parsed.toString()) });
  } catch (error) {
    return res.status(422).json({ error: error.message || "Não foi possível preparar o link." });
  }
});

app.post("/api/stream/:token/refresh", (req, res) => {
  const entry = activeStreamTicket(req.params.token);
  if (!entry) return res.status(404).json({ error: "Este link de reprodução expirou. Conecte a lista novamente." });
  res.setHeader("cache-control", "private, no-store");
  return res.json(streamTicketResponse(req.params.token, entry));
});

app.get("/api/stream/:token", async (req, res) => {
  const entry = activeStreamTicket(req.params.token);
  if (!entry) return res.status(404).json({ error: "Este link de reprodução expirou. Conecte a lista novamente." });
  res.setHeader("x-gate-ticket-expires-at", new Date(entry.expiresAt).toISOString());
  // A rota direta devolve a URL da fonte, que em Xtream carrega usuario e senha
  // no caminho. O gatilho por query foi removido: nenhum cliente o usava e ele
  // entregava as credenciais a qualquer visitante. Quando NATIVE_DIRECT_KEY
  // estiver configurada, so o cliente nativo que provar posse da chave recebe o
  // desvio; sem a chave, mantem-se o comportamento anterior por compatibilidade
  // com o APK ja publicado.
  if (entry.kind !== "image" && allowDirectRoute(req)) {
    res.setHeader("cache-control", "private, no-store");
    res.setHeader("x-gate-route", "direct");
    return res.redirect(307, entry.url);
  }
  try {
    const headers = entry.kind === "image"
      ? { accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" }
      : {};
    if (req.headers.range) headers.range = req.headers.range;
    const remote = await openRemote(entry.url, { headers, timeoutMs: 25_000 });
    const response = remote.response;
    if (!response.ok && response.status !== 206) {
      remote.clearTimer();
      return res.status(response.status).json({ error: `A fonte recusou a reprodução (${response.status}).` });
    }
    const reportedType = response.headers.get("content-type") || "";
    if (entry.kind === "image") {
      try {
        const bytes = await readLimited(response, 12_000_000);
        res.status(response.status);
        res.setHeader("cache-control", "private, max-age=1800");
        res.setHeader("content-type", detectedImageContentType(bytes, remote.finalUrl || entry.url, reportedType));
        res.send(Buffer.from(bytes));
      } finally { remote.clearTimer(); }
      return;
    }
    const contentType = reportedType || "application/octet-stream";
    const manifest = /mpegurl|m3u8/i.test(contentType) || /\.m3u8($|\?)/i.test(remote.finalUrl.toString());
    res.status(response.status);
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-gate-route", "proxy");
    res.setHeader("accept-ranges", response.headers.get("accept-ranges") || "bytes");
    if (manifest) {
      try {
        const bytes = await readLimited(response, 4_000_000);
        const text = new TextDecoder().decode(bytes);
        res.type("application/vnd.apple.mpegurl").send(rewriteManifest(text, remote.finalUrl, entry.ownerId));
      } finally { remote.clearTimer(); }
      return;
    }
    remote.clearTimer();
    res.setHeader("content-type", contentType);
    for (const header of ["content-length", "content-range", "last-modified", "etag"]) {
      const value = response.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    if (!response.body) return res.end();
    const upstream = Readable.fromWeb(response.body);
    res.once("close", () => { if (!res.writableEnded) upstream.destroy(); });
    upstream.on("error", () => { if (!res.headersSent) res.sendStatus(502); else res.end(); }).pipe(res);
  } catch (error) {
    if (!res.headersSent) res.status(502).json({ error: error.message || "A fonte não respondeu ao player." });
    else res.end();
  }
});

app.get("/api/image/:signature/:payload", async (req, res) => {
  const rawUrl = imageSigner.verify(req.params.signature, req.params.payload);
  if (!rawUrl) return res.status(403).json({ error: "Imagem nao autorizada." });
  try {
    const remote = await openRemote(rawUrl, {
      headers: { accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" },
      timeoutMs: 15_000
    });
    try {
      if (!remote.response.ok) return res.status(remote.response.status).end();
      const bytes = await readLimited(remote.response, 12_000_000);
      res.setHeader("cache-control", "public, max-age=86400");
      res.setHeader("content-type", detectedImageContentType(bytes, remote.finalUrl || rawUrl, remote.response.headers.get("content-type") || ""));
      return res.send(Buffer.from(bytes));
    } finally { remote.clearTimer(); }
  } catch {
    return res.status(502).end();
  }
});

app.post("/api/portal/validate", async (req, res) => {
  try {
    const portalUrl = String(req.body?.portalUrl || "").trim();
    const mac = String(req.body?.mac || "").trim().toUpperCase();
    await validateRemoteUrl(portalUrl);
    if (!/^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/.test(mac)) return res.status(400).json({ error: "Informe um MAC válido." });
    return res.json({ source: "portal", status: "validated", message: "Portal e MAC validados. A conexão completa depende do protocolo habilitado pelo seu provedor autorizado." });
  } catch (error) {
    return res.status(422).json({ error: error.message || "Não foi possível validar o portal." });
  }
});

app.post("/api/renewals", sensitiveRateLimit("billing_checkout", 10, 10 * 60_000), (req, res) => {
  const rawMac = String(req.body?.mac || "").trim().toUpperCase();
  const compact = rawMac.replace(/[^0-9A-F]/g, "");
  if (!/^[0-9A-F]{12}$/.test(compact)) return res.status(400).json({ error: "Informe um MAC com 12 caracteres hexadecimais." });
  const mac = compact.match(/.{2}/g).join(":");
  return respondWithCheckout(req, res, { mac });
});

setInterval(() => {
  const now = Date.now();
  ticketStore.prune(now);
  for (const [id, session] of xtreamSessions) if (session.expiresAt <= now) xtreamSessions.delete(id);
  for (const [code, entry] of pairingSessions) {
    expirePairingSession(entry, now);
    if (entry.purgeAt <= now) pairingSessions.delete(code);
  }
  for (const [key, times] of requestBuckets) if (!times.some((time) => now - time < 60_000)) requestBuckets.delete(key);
  for (const [key, times] of sensitiveRequestBuckets) if (!times.some((time) => now - time < 10 * 60_000)) sensitiveRequestBuckets.delete(key);
}, 10 * 60 * 1000).unref();

app.use("/vendor/hls.min.js", express.static(path.join(__dirname, "node_modules/hls.js/dist/hls.min.js")));
app.use("/vendor/mpegts.min.js", express.static(path.join(__dirname, "node_modules/mpegts.js/dist/mpegts.js")));
function servePlatformIndex(req, res, next) {
  if (String(req.query?.platform || "").toLowerCase() !== "webos") return next();
  res.setHeader("cache-control", "no-cache, no-store, must-revalidate");
  res.setHeader("x-gate-ui-mode", "webos-safe-1.1.0");
  return res.sendFile(path.join(__dirname, "public/index-webos.html"));
}
app.get("/", servePlatformIndex);
app.get("/index.html", servePlatformIndex);

app.use(express.static(path.join(__dirname, "public"), {
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (/\/(index\.html|sw\.js)$/.test(filePath)) {
      res.setHeader("cache-control", "no-cache, no-store, must-revalidate");
    } else if (/\.(?:css|js)$/.test(filePath)) {
      res.setHeader("cache-control", "no-cache, must-revalidate");
    }
  }
}));
app.get("/{*path}", (_req, res) => {
  res.setHeader("cache-control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(__dirname, "public/index.html"));
});
app.use((error, _req, res, _next) => {
  const reference = crypto.randomBytes(6).toString("hex");
  console.error(`UNHANDLED_ERROR ref=${reference}`, error);
  res.status(500).json({ error: "Erro interno. Tente novamente.", reference });
});

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const server = app.listen(port, "0.0.0.0", () => console.log(`GATE IPTV PLAYER ${APP_VERSION} online na porta ${port}`));
  // A Railway envia SIGTERM a cada deploy. Sem isto, quem esta assistindo perde
  // a imagem no meio da transmissao em vez de reconectar.
  const shutdown = (signal) => {
    console.log(`Encerrando por ${signal}. Drenando conexoes…`);
    const forced = setTimeout(() => {
      console.warn("Prazo de drenagem esgotado. Encerrando a forca.");
      process.exit(1);
    }, 15_000);
    forced.unref();
    server.close(() => {
      clearTimeout(forced);
      process.exit(0);
    });
  };
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => shutdown(signal));
}

export { app };
