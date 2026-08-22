import assert from "node:assert/strict";
import test from "node:test";
import { createTicketStore } from "../lib/stream-tickets.mjs";
import { createUrlSigner } from "../lib/signed-url.mjs";

function store(overrides = {}) {
  let counter = 0;
  return createTicketStore({
    maxPerOwner: 3,
    maxTotal: 100,
    sessionTtlMs: 1000,
    hlsTtlMs: 500,
    createToken: () => `t${counter += 1}`,
    ...overrides
  });
}

test("o teto é aplicado por dono, não no conjunto", () => {
  const tickets = store();
  for (let index = 0; index < 3; index += 1) tickets.register(`http://a/${index}`, "media", "sessao-a");
  const canalDaSessaoB = tickets.register("http://b/canal", "media", "sessao-b");

  // A sessão A no teto força despejo dentro dela mesma.
  tickets.register("http://a/extra", "media", "sessao-a");

  assert.equal(tickets.ownerSize("sessao-a"), 3, "a sessão A permanece no seu teto");
  assert.ok(tickets.active(canalDaSessaoB), "o canal de outra sessão continua vivo");
});

test("uma lista grande não derruba o canal que outro usuário assiste", () => {
  const tickets = store({ maxPerOwner: 5 });
  const assistindo = tickets.register("http://origem/canal-ao-vivo", "media", "espectador");
  for (let index = 0; index < 200; index += 1) tickets.register(`http://origem/item-${index}`, "media", "quem-carrega");

  assert.ok(tickets.active(assistindo), "o ticket em uso sobrevive à lista do vizinho");
  assert.equal(tickets.ownerSize("quem-carrega"), 5);
});

test("o acesso renova a validade e move a entrada para o fim da fila", () => {
  let agora = 0;
  const tickets = store({ maxPerOwner: 2, now: () => agora });
  const primeiro = tickets.register("http://origem/1", "media", "dono");
  tickets.register("http://origem/2", "media", "dono");

  agora = 400;
  assert.ok(tickets.active(primeiro), "ainda dentro da validade");

  // No teto, o despejo tira o menos usado recentemente — o segundo, não o primeiro.
  tickets.register("http://origem/3", "media", "dono");
  assert.ok(tickets.active(primeiro), "o ticket acessado há pouco permanece");
});

test("ticket expirado deixa de valer e some do armazenamento", () => {
  let agora = 0;
  const tickets = store({ now: () => agora });
  const token = tickets.register("http://origem/canal", "media", "dono");

  agora = 1001;
  assert.equal(tickets.active(token), null, "expirado não é devolvido");
  assert.equal(tickets.size, 0, "e não fica ocupando memória");
});

test("a mesma URL do mesmo dono reaproveita o ticket; de donos diferentes, não", () => {
  const tickets = store();
  const a = tickets.register("http://origem/canal", "media", "dono-a");
  const aDeNovo = tickets.register("http://origem/canal", "media", "dono-a");
  const b = tickets.register("http://origem/canal", "media", "dono-b");

  assert.equal(a, aDeNovo, "reaproveita dentro do mesmo dono");
  assert.notEqual(a, b, "donos diferentes não compartilham ticket");
});

test("prune remove só o que expirou", () => {
  let agora = 0;
  const tickets = store({ maxPerOwner: 10, now: () => agora });
  tickets.register("http://origem/hls.m3u8", "hls", "dono");
  const longo = tickets.register("http://origem/canal", "media", "dono");

  agora = 600;
  assert.equal(tickets.prune(), 1, "o ticket HLS de validade curta sai");
  assert.ok(tickets.active(longo), "o de validade longa continua");
});

test("a URL assinada só é aceita com a assinatura correta", () => {
  const signer = createUrlSigner("chave-de-teste");
  const assinada = signer.sign("http://origem/logo.png");
  const [assinatura, payload] = assinada.split("/");

  assert.equal(signer.verify(assinatura, payload), "http://origem/logo.png");
  assert.equal(signer.verify("a".repeat(assinatura.length), payload), "", "assinatura trocada é recusada");
  assert.equal(signer.verify(assinatura, Buffer.from("http://atacante/x", "utf8").toString("base64url")), "",
    "trocar a URL invalida a assinatura");
});

test("outra chave não valida a assinatura", () => {
  const assinada = createUrlSigner("chave-a").sign("http://origem/capa.jpg");
  const [assinatura, payload] = assinada.split("/");
  assert.equal(createUrlSigner("chave-b").verify(assinatura, payload), "");
});

test("URL vazia ou longa demais não gera assinatura", () => {
  const signer = createUrlSigner("chave");
  assert.equal(signer.sign(""), "");
  assert.equal(signer.sign(`http://origem/${"x".repeat(2000)}`), "");
});
