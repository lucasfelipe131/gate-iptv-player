import assert from "node:assert/strict";
import test from "node:test";
import { createSessionStore } from "../lib/client-sessions.mjs";

function store(overrides = {}) {
  let counter = 0;
  return createSessionStore({
    ttlMs: 1000,
    maxPerIp: 3,
    maxRegistrationsPerSession: 10,
    createToken: () => `s${counter += 1}`,
    ...overrides
  });
}

test("emite sessão válida e reconhece o token", () => {
  const sessions = store();
  const { token, expiresInSeconds } = sessions.issue("203.0.113.10");
  assert.ok(token);
  assert.equal(expiresInSeconds, 1);
  assert.ok(sessions.verify(token));
});

test("token desconhecido ou vazio não vale", () => {
  const sessions = store();
  assert.equal(sessions.verify("inexistente"), null);
  assert.equal(sessions.verify(""), null);
  assert.equal(sessions.verify(undefined), null);
});

test("o mesmo IP não acumula sessões além do teto", () => {
  const sessions = store();
  const primeira = sessions.issue("198.51.100.7").token;
  for (let index = 0; index < 3; index += 1) sessions.issue("198.51.100.7");

  assert.equal(sessions.ipSize("198.51.100.7"), 3, "o IP fica no teto");
  assert.equal(sessions.verify(primeira), null, "a mais antiga foi revogada");
});

test("o teto é por IP, não global", () => {
  const sessions = store();
  const deOutroIp = sessions.issue("192.0.2.1").token;
  for (let index = 0; index < 5; index += 1) sessions.issue("192.0.2.2");

  assert.ok(sessions.verify(deOutroIp), "sessão de outro IP não é afetada");
  assert.equal(sessions.ipSize("192.0.2.2"), 3);
});

test("a sessão expira e some do armazenamento", () => {
  let agora = 0;
  const sessions = store({ now: () => agora });
  const { token } = sessions.issue("203.0.113.1");

  agora = 1001;
  assert.equal(sessions.verify(token), null);
  assert.equal(sessions.size, 0);
});

test("o uso renova a validade", () => {
  let agora = 0;
  const sessions = store({ now: () => agora });
  const { token } = sessions.issue("203.0.113.2");

  agora = 900;
  assert.ok(sessions.verify(token), "ainda válida");
  agora = 1800;
  assert.ok(sessions.verify(token), "renovada pelo acesso anterior");
});

test("o teto de registros por sessão é respeitado", () => {
  const sessions = store();
  const { token } = sessions.issue("203.0.113.3");

  assert.equal(sessions.countRegistration(token, 6), true);
  assert.equal(sessions.countRegistration(token, 4), true, "chega exatamente ao teto");
  assert.equal(sessions.countRegistration(token, 1), false, "passar do teto é recusado");
});

test("registro em sessão inválida é recusado", () => {
  const sessions = store();
  assert.equal(sessions.countRegistration("nao-existe", 1), false);
});

test("revogar invalida a sessão na hora", () => {
  const sessions = store();
  const { token } = sessions.issue("203.0.113.4");
  assert.equal(sessions.revoke(token), true);
  assert.equal(sessions.verify(token), null);
});

test("prune remove só o que venceu", () => {
  let agora = 0;
  const sessions = store({ now: () => agora, maxPerIp: 10 });
  sessions.issue("203.0.113.5");
  agora = 600;
  const recente = sessions.issue("203.0.113.6").token;

  agora = 1100;
  assert.equal(sessions.prune(), 1, "a primeira venceu");
  assert.ok(sessions.verify(recente), "a segunda continua");
});
