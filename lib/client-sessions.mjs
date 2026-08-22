import crypto from "node:crypto";

// Sessões de cliente.
//
// Todas as rotas de controle (abrir lista, conectar Xtream, registrar link)
// aceitavam requisição anônima. Quem descobrisse o domínio podia registrar as
// próprias URLs e transmitir pelo servidor por tempo indeterminado, com a conta
// da Railway pagando a banda.
//
// Isto não substitui conta de assinante — um atacante também consegue abrir uma
// sessão. O que muda é que o uso deixa de ser anônimo e ilimitado: a emissão é
// limitada por IP, cada sessão tem validade e teto de registros, e dá para
// revogar. É mitigação real; a barreira definitiva é a conta persistente.

export function createSessionStore({
  ttlMs = 12 * 60 * 60 * 1000,
  maxPerIp = 8,
  maxRegistrationsPerSession = 40_000,
  now = () => Date.now(),
  createToken = () => crypto.randomBytes(32).toString("base64url")
} = {}) {
  const sessions = new Map();
  const byIp = new Map();

  function forget(token, session = sessions.get(token)) {
    if (!session) return false;
    sessions.delete(token);
    const tokens = byIp.get(session.ip);
    if (tokens) {
      tokens.delete(token);
      if (!tokens.size) byIp.delete(session.ip);
    }
    return true;
  }

  function issue(ip) {
    const address = String(ip || "unknown");
    const moment = now();

    // Expira o que já venceu antes de aplicar o teto do IP.
    for (const token of [...(byIp.get(address) || [])]) {
      const session = sessions.get(token);
      if (!session || session.expiresAt <= moment) forget(token, session);
    }
    // No teto, a sessão mais antiga do IP cede lugar à nova.
    while ((byIp.get(address)?.size || 0) >= maxPerIp) {
      const oldest = byIp.get(address)?.keys().next().value;
      if (oldest === undefined) break;
      forget(oldest);
    }

    const token = createToken();
    sessions.set(token, { ip: address, createdAt: moment, expiresAt: moment + ttlMs, registrations: 0 });
    let tokens = byIp.get(address);
    if (!tokens) { tokens = new Set(); byIp.set(address, tokens); }
    tokens.add(token);
    return { token, expiresInSeconds: Math.floor(ttlMs / 1000) };
  }

  function verify(token) {
    const key = String(token || "");
    if (!key) return null;
    const session = sessions.get(key);
    if (!session) return null;
    const moment = now();
    if (session.expiresAt <= moment) { forget(key, session); return null; }
    session.expiresAt = moment + ttlMs;
    return session;
  }

  function countRegistration(token, amount = 1) {
    const session = verify(token);
    if (!session) return false;
    if (session.registrations + amount > maxRegistrationsPerSession) return false;
    session.registrations += amount;
    return true;
  }

  function prune(moment = now()) {
    let removed = 0;
    for (const [token, session] of sessions) {
      if (session.expiresAt <= moment) { forget(token, session); removed += 1; }
    }
    return removed;
  }

  return {
    issue, verify, countRegistration, prune, revoke: forget,
    get size() { return sessions.size; },
    ipSize: (ip) => byIp.get(String(ip))?.size || 0
  };
}
