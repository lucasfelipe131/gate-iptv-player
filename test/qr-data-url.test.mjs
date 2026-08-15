import assert from "node:assert/strict";
import test from "node:test";
import { createQrSvgDataUrl, decodeSvgDataUrl } from "../lib/qr-data-url.mjs";

test("gera QR SVG determinístico e inteiramente local", () => {
  const target = "https://gate.example/pair?code=ABCD-EFGH";
  const first = createQrSvgDataUrl(target);
  const second = createQrSvgDataUrl(target);

  assert.equal(first, second);
  assert.match(first, /^data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(first, /https?:|quickchart|gate\.example/i);

  const svg = decodeSvgDataUrl(first);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /<rect[^>]+fill="#fff"\/>/);
  assert.match(svg, /<path d="M\d+ \d+h1v1h-1z/);
  assert.doesNotMatch(svg, /gate\.example|ABCD-EFGH/);
});

test("recusa payload vazio, excessivo e margem insegura", () => {
  assert.throws(() => createQrSvgDataUrl(""), /inválido|limite/);
  assert.throws(() => createQrSvgDataUrl("x".repeat(2_301)), /limite/);
  assert.throws(() => createQrSvgDataUrl("https://gate.example", { quietZone: 2 }), /margem/);
});
