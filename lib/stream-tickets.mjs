import crypto from "node:crypto";

// Armazenamento de tickets de reprodução.
//
// O desenho anterior mantinha um único mapa global com teto de 50 mil entradas.
// Uma lista Xtream grande registra dezenas de milhares de tickets de uma vez, e
// ao bater no teto a expulsão era global: a lista que um usuário estava
// carregando derrubava o ticket do canal que outro usuário estava assistindo
// naquele instante. Aqui o teto passa a ser por dono (sessão), e o teto global
// existe só como último recurso.
//
// Map e Set preservam ordem de inserção, e cada acesso reinsere a entrada.
// A cabeça da coleção é, portanto, sempre a menos usada recentemente, o que
// torna a expulsão O(1) em vez de varrer o mapa inteiro a cada registro.

export function createTicketStore({
  maxPerOwner = 12_000,
  maxTotal = 50_000,
  sessionTtlMs = 24 * 60 * 60 * 1000,
  hlsTtlMs = 30 * 60 * 1000,
  sharedOwner = "shared",
  now = () => Date.now(),
  createToken = () => crypto.randomBytes(18).toString("base64url")
} = {}) {
  const tickets = new Map();
  const tokenByKey = new Map();
  const byOwner = new Map();

  function bucketFor(ownerId) {
    let bucket = byOwner.get(ownerId);
    if (!bucket) { bucket = new Set(); byOwner.set(ownerId, bucket); }
    return bucket;
  }

  function remove(token, entry = tickets.get(token)) {
    if (!entry) return false;
    tickets.delete(token);
    if (tokenByKey.get(entry.ticketKey) === token) tokenByKey.delete(entry.ticketKey);
    const bucket = byOwner.get(entry.ownerId);
    if (bucket) {
      bucket.delete(token);
      if (!bucket.size) byOwner.delete(entry.ownerId);
    }
    return true;
  }

  function evictOldest(collection) {
    const oldest = collection.keys().next().value;
    if (oldest === undefined) return false;
    return remove(oldest);
  }

  function enforceLimits(ownerId) {
    const bucket = byOwner.get(ownerId);
    while (bucket && bucket.size >= maxPerOwner) {
      if (!evictOldest(bucket)) break;
    }
    while (tickets.size >= maxTotal) {
      if (!evictOldest(tickets)) break;
    }
  }

  function register(remoteUrl, kind = "media", ownerId = sharedOwner) {
    const url = String(remoteUrl || "").trim();
    if (!url) return "";
    const owner = String(ownerId || sharedOwner);
    const moment = now();
    const ticketKey = `${owner}:${kind}:${url}`;
    const existingToken = tokenByKey.get(ticketKey);
    const existing = existingToken && tickets.get(existingToken);
    if (existing && existing.expiresAt > moment) return existingToken;
    enforceLimits(owner);
    const token = createToken();
    const ttlMs = kind === "hls" ? hlsTtlMs : sessionTtlMs;
    tickets.set(token, {
      url, kind, ticketKey, ttlMs, ownerId: owner,
      createdAt: moment, lastAccessAt: moment, expiresAt: moment + ttlMs
    });
    tokenByKey.set(ticketKey, token);
    bucketFor(owner).add(token);
    return token;
  }

  function active(token) {
    const key = String(token || "");
    const entry = tickets.get(key);
    if (!entry) return null;
    const moment = now();
    if (entry.expiresAt <= moment) { remove(key, entry); return null; }
    entry.lastAccessAt = moment;
    entry.expiresAt = moment + entry.ttlMs;
    // Reinsere para manter a ordem por uso recente nas duas coleções.
    tickets.delete(key); tickets.set(key, entry);
    const bucket = byOwner.get(entry.ownerId);
    if (bucket) { bucket.delete(key); bucket.add(key); }
    return entry;
  }

  function prune(moment = now()) {
    let removed = 0;
    for (const [token, entry] of tickets) {
      if (entry.expiresAt <= moment) { remove(token, entry); removed += 1; }
    }
    for (const [ownerId, bucket] of byOwner) if (!bucket.size) byOwner.delete(ownerId);
    return removed;
  }

  return {
    register, active, remove, prune,
    get size() { return tickets.size; },
    ownerSize: (ownerId) => byOwner.get(String(ownerId))?.size || 0,
    ownerCount: () => byOwner.size
  };
}
