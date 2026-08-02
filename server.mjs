import dns from "node:dns/promises";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const MAX_CATALOG_ITEMS = 2000;
const MAX_LIVE_ITEMS = 6000;
const SESSION_TTL = 6 * 60 * 60 * 1000;

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
app.use(express.json({ limit: "2mb" }));

const requestBuckets = new Map();
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
  if (!records.length || records.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Endereço de rede privada não permitido.");
  }
  return parsed;
}

async function openRemote(rawUrl, { headers = {}, timeoutMs = 20_000 } = {}) {
  let current = await validateRemoteUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let redirect = 0; redirect < 5; redirect += 1) {
      const response = await fetch(current, {
        redirect: "manual",
        headers: { "user-agent": "GATE-IPTV-PLAYER/0.2", ...headers },
        signal: controller.signal
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        response.body?.cancel().catch(() => {});
        current = await validateRemoteUrl(new URL(response.headers.get("location"), current).toString());
        continue;
      }
      return { response, finalUrl: current, clearTimer: () => clearTimeout(timer) };
    }
    throw new Error("A fonte realizou redirecionamentos demais.");
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
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

function normalizeBaseUrl(value) {
  const parsed = new URL(String(value || "").trim());
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

const streamTickets = new Map();
const streamTicketByUrl = new Map();
const xtreamSessions = new Map();

function registerStream(remoteUrl, kind = "media") {
  const url = String(remoteUrl || "").trim();
  if (!url) return "";
  const ticketKey = `${kind}:${url}`;
  const existingToken = streamTicketByUrl.get(ticketKey);
  const existing = existingToken && streamTickets.get(existingToken);
  if (existing && existing.expiresAt > Date.now()) return `/api/stream/${existingToken}`;
  const token = crypto.randomBytes(18).toString("base64url");
  const entry = { url, kind, ticketKey, expiresAt: Date.now() + SESSION_TTL };
  streamTickets.set(token, entry);
  streamTicketByUrl.set(ticketKey, token);
  return `/api/stream/${token}`;
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

function proxiedItem({ id, name, group, logo, url, streamType, seriesId, sessionId, season, description, rating, year, genre, epgChannelId }) {
  return {
    ...(id != null ? { id: String(id) } : {}),
    name: safeLabel(name),
    group: safeLabel(group || "Outros"),
    logo: logo ? registerStream(String(logo).slice(0, 1800), "image") : "",
    playUrl: url ? registerStream(url) : "",
    streamType: streamType || (url ? streamTypeFor(url) : "auto"),
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

function parseM3u(text, limit = MAX_CATALOG_ITEMS) {
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
      result[kind].push(proxiedItem({ ...metadata, url: line }));
      metadata = null;
      total += 1;
      if (total >= limit) break;
    }
  }
  return result;
}

function xtreamApi(base, username, password, action = "") {
  const query = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  return `${base}/player_api.php?${query}${action ? `&action=${action}` : ""}`;
}

function categoryMap(items) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [String(item.category_id), safeLabel(item.category_name || "Outros")]));
}

async function connectXtream({ serverUrl, username, password, source = "xtream" }) {
  const base = normalizeBaseUrl(serverUrl);
  await validateRemoteUrl(base);
  const account = await safeFetch(xtreamApi(base, username, password), { maxBytes: 2_000_000, asJson: true, timeoutMs: 25_000 });
  if (!account?.user_info || String(account.user_info.auth) !== "1") throw new Error("A fonte não autorizou estes dados.");

  const [categoriesResult, liveResult] = await Promise.allSettled([
    safeFetch(xtreamApi(base, username, password, "get_live_categories"), { maxBytes: 3_000_000, asJson: true, timeoutMs: 35_000 }),
    safeFetch(xtreamApi(base, username, password, "get_live_streams"), { maxBytes: 42_000_000, asJson: true, timeoutMs: 45_000 })
  ]);
  const live = liveResult.status === "fulfilled" && Array.isArray(liveResult.value) ? liveResult.value : [];
  if (!live.length) {
    const reason = liveResult.status === "rejected" ? liveResult.reason?.message : "Nenhum canal foi retornado.";
    throw new Error(`A conta foi autenticada, mas os canais não puderam ser carregados. ${reason || ""}`.trim());
  }
  const liveCategories = categoryMap(categoriesResult.status === "fulfilled" ? categoriesResult.value : []);
  const extension = account.user_info.allowed_output_formats?.includes("m3u8") ? "m3u8" : "ts";
  const sessionId = crypto.randomBytes(18).toString("base64url");
  xtreamSessions.set(sessionId, { base, username, password, expiresAt: Date.now() + SESSION_TTL });
  const channels = live.slice(0, MAX_LIVE_ITEMS).map((item) => proxiedItem({
    id: item.stream_id,
    name: item.name,
    logo: item.stream_icon,
    group: liveCategories.get(String(item.category_id)) || item.category_name || "Ao vivo",
    epgChannelId: item.epg_channel_id,
    url: `${base}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${item.stream_id}.${extension}`,
    streamType: extension === "m3u8" ? "hls" : "mpegts"
  }));
  return {
    source,
    sessionId,
    account: {
      username: safeLabel(username),
      status: safeLabel(account.user_info.status || "Ativo"),
      expiresAt: account.user_info.exp_date ? new Date(Number(account.user_info.exp_date) * 1000).toISOString() : null,
      maxConnections: Number(account.user_info.max_connections || 0)
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

function rewriteManifest(text, baseUrl) {
  return String(text).split(/\r?\n/).map((rawLine) => {
    const line = rawLine.trim();
    if (!line) return rawLine;
    if (!line.startsWith("#")) return registerStream(new URL(line, baseUrl).toString());
    return rawLine.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${registerStream(new URL(uri, baseUrl).toString())}"`);
  }).join("\n");
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "gate-iptv-player", version: "0.4.1" }));
app.get("/api/config", (_req, res) => res.json({ annualPrice: 30, adDurationSeconds: 10, paymentAvailable: Boolean(process.env.PAYMENT_LINK_URL) }));

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
    const text = await safeFetch(url, { maxBytes: 38_000_000, timeoutMs: 50_000 });
    if (!/^#EXTM3U/m.test(text)) return res.status(422).json({ error: "O arquivo não parece ser uma lista M3U válida." });
    const catalog = parseM3u(text);
    const count = catalog.channels.length + catalog.movies.length + catalog.series.length;
    if (!count) return res.status(422).json({ error: "Nenhum item reproduzível foi encontrado na lista." });
    return res.json({ source: "m3u", count, counts: { live: catalog.channels.length, movies: catalog.movies.length, series: catalog.series.length }, ...catalog });
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
      safeFetch(xtreamApi(session.base, session.username, session.password, categoryAction), { maxBytes: 3_000_000, asJson: true, timeoutMs: 35_000 }),
      safeFetch(xtreamApi(session.base, session.username, session.password, contentAction), { maxBytes: 48_000_000, asJson: true, timeoutMs: 55_000 })
    ]);
    const rawItems = itemsResult.status === "fulfilled" && Array.isArray(itemsResult.value) ? itemsResult.value : [];
    if (!rawItems.length && itemsResult.status === "rejected") throw itemsResult.reason;
    const categories = categoryMap(categoriesResult.status === "fulfilled" ? categoriesResult.value : []);
    const items = rawItems.slice(0, MAX_CATALOG_ITEMS).map((item) => {
      const common = {
        id: kind === "movies" ? item.stream_id : item.series_id,
        name: item.name,
        logo: kind === "movies" ? item.stream_icon : item.cover,
        group: categories.get(String(item.category_id)) || item.category_name || (kind === "movies" ? "Filmes" : "Séries"),
        description: item.plot || item.description || item.info?.plot,
        rating: item.rating || item.rating_5based,
        year: item.year || item.releaseDate || item.releasedate,
        genre: item.genre
      };
      if (kind === "movies") {
        const extension = String(item.container_extension || "mp4").replace(/[^a-z0-9]/gi, "") || "mp4";
        return proxiedItem({ ...common, url: `${session.base}/movie/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${item.stream_id}.${extension}`, streamType: "video" });
      }
      return proxiedItem({ ...common, seriesId: item.series_id, sessionId: req.body.sessionId });
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
      const url = `${xtreamApi(session.base, session.username, session.password, "get_short_epg")}&stream_id=${encodeURIComponent(streamId)}&limit=3`;
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

app.post("/api/xtream/series", async (req, res) => {
  try {
    const session = getXtreamSession(req.body?.sessionId);
    const seriesId = String(req.body?.seriesId || "").replace(/[^0-9]/g, "");
    if (!seriesId) return res.status(400).json({ error: "Série inválida." });
    const info = await safeFetch(`${xtreamApi(session.base, session.username, session.password, "get_series_info")}&series_id=${encodeURIComponent(seriesId)}`, { maxBytes: 18_000_000, asJson: true, timeoutMs: 45_000 });
    const episodes = Object.entries(info?.episodes || {}).flatMap(([season, entries]) => (Array.isArray(entries) ? entries : []).map((episode) => {
      const extension = String(episode.container_extension || "mp4").replace(/[^a-z0-9]/gi, "") || "mp4";
      return proxiedItem({
        id: episode.id,
        name: episode.title || `Episódio ${episode.episode_num || episode.id}`,
        group: `Temporada ${season}`,
        season,
        logo: info?.info?.cover,
        description: episode.info?.plot || episode.plot || info?.info?.plot,
        rating: episode.info?.rating || info?.info?.rating,
        year: episode.info?.releasedate || info?.info?.releaseDate,
        url: `${session.base}/series/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${episode.id}.${extension}`,
        streamType: extension === "m3u8" ? "hls" : "video"
      });
    }));
    return res.json({
      name: safeLabel(info?.info?.name || "Série"),
      description: safeText(info?.info?.plot || info?.info?.description),
      rating: safeLabel(info?.info?.rating || "", ""),
      genre: safeLabel(info?.info?.genre || "", ""),
      episodes: episodes.slice(0, 700)
    });
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
    return res.json({ items: items.map((item) => proxiedItem(item)) });
  } catch (error) {
    return res.status(422).json({ error: error.message || "Não foi possível preparar os itens." });
  }
});

app.post("/api/stream/register", async (req, res) => {
  try {
    const parsed = await validateRemoteUrl(req.body?.url);
    return res.json({ playUrl: registerStream(parsed.toString()), streamType: streamTypeFor(parsed.toString()) });
  } catch (error) {
    return res.status(422).json({ error: error.message || "Não foi possível preparar o link." });
  }
});

app.get("/api/stream/:token", async (req, res) => {
  const entry = streamTickets.get(req.params.token);
  if (!entry || entry.expiresAt <= Date.now()) return res.status(404).json({ error: "Este link de reprodução expirou. Conecte a lista novamente." });
  entry.expiresAt = Date.now() + SESSION_TTL;
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
    res.setHeader("accept-ranges", response.headers.get("accept-ranges") || "bytes");
    if (manifest) {
      try {
        const bytes = await readLimited(response, 4_000_000);
        const text = new TextDecoder().decode(bytes);
        res.type("application/vnd.apple.mpegurl").send(rewriteManifest(text, remote.finalUrl));
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
    Readable.fromWeb(response.body).on("error", () => { if (!res.headersSent) res.sendStatus(502); else res.end(); }).pipe(res);
  } catch (error) {
    if (!res.headersSent) res.status(502).json({ error: error.message || "A fonte não respondeu ao player." });
    else res.end();
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

app.post("/api/renewals", (req, res) => {
  const rawMac = String(req.body?.mac || "").trim().toUpperCase();
  const compact = rawMac.replace(/[^0-9A-F]/g, "");
  if (!/^[0-9A-F]{12}$/.test(compact)) return res.status(400).json({ error: "Informe um MAC com 12 caracteres hexadecimais." });
  const mac = compact.match(/.{2}/g).join(":");
  const protocol = `GATE-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const checkoutUrl = process.env.PAYMENT_LINK_URL || null;
  return res.status(201).json({ protocol, mac, plan: "Sem anúncios — 1 ano", amount: 30, checkoutUrl, status: checkoutUrl ? "ready_for_payment" : "awaiting_payment_configuration" });
});

setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of streamTickets) {
    if (entry.expiresAt <= now) { streamTickets.delete(token); streamTicketByUrl.delete(entry.ticketKey || `media:${entry.url}`); }
  }
  for (const [id, session] of xtreamSessions) if (session.expiresAt <= now) xtreamSessions.delete(id);
  for (const [key, times] of requestBuckets) if (!times.some((time) => now - time < 60_000)) requestBuckets.delete(key);
}, 10 * 60 * 1000).unref();

app.use("/vendor/hls.min.js", express.static(path.join(__dirname, "node_modules/hls.js/dist/hls.min.js")));
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (/\/(index\.html|app\.js|styles\.css|sw\.js)$/.test(filePath)) {
      res.setHeader("cache-control", "no-cache, no-store, must-revalidate");
    }
  }
}));
app.get("/{*path}", (_req, res) => res.sendFile(path.join(__dirname, "public/index.html")));
app.use((error, _req, res, _next) => res.status(500).json({ error: error?.message || "Erro interno." }));

app.listen(port, "0.0.0.0", () => console.log(`GATE IPTV PLAYER online na porta ${port}`));
