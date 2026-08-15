import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const QRCode = require("../vendor/qrcode/index.cjs");
const ERROR_CORRECTION_M = 0;
const DEFAULT_QUIET_ZONE = 4;
const MAX_QR_PAYLOAD_BYTES = 2_300;

function svgDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export function createQrSvgDataUrl(value, { quietZone = DEFAULT_QUIET_ZONE } = {}) {
  const payload = String(value || "");
  const byteLength = Buffer.byteLength(payload, "utf8");
  if (!payload || byteLength > MAX_QR_PAYLOAD_BYTES) {
    throw new RangeError("O conteúdo do QR Code é inválido ou excede o limite seguro.");
  }
  if (!Number.isSafeInteger(quietZone) || quietZone < 4 || quietZone > 16) {
    throw new RangeError("A margem do QR Code deve ter entre 4 e 16 módulos.");
  }

  const qr = new QRCode(0, ERROR_CORRECTION_M);
  qr.addData(Buffer.from(payload, "utf8").toString("latin1"));
  qr.make();

  const modules = qr.getModuleCount();
  const size = modules + quietZone * 2;
  const darkModules = [];
  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (qr.isDark(row, column)) darkModules.push(`M${column + quietZone} ${row + quietZone}h1v1h-1z`);
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR Code"><rect width="${size}" height="${size}" fill="#fff"/><path d="${darkModules.join("")}" fill="#000"/></svg>`;
  return svgDataUrl(svg);
}

export function decodeSvgDataUrl(dataUrl) {
  const prefix = "data:image/svg+xml;base64,";
  if (!String(dataUrl || "").startsWith(prefix)) throw new TypeError("Data URL SVG inválida.");
  return Buffer.from(String(dataUrl).slice(prefix.length), "base64").toString("utf8");
}
