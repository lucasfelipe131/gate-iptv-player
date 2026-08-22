import crypto from "node:crypto";

// Logotipos e capas eram registrados como tickets, o que enchia o mapa de
// reprodução com uma entrada por item de catálogo. Uma URL assinada resolve o
// mesmo problema sem guardar estado: a assinatura prova que o endereço saiu
// deste servidor, e a validação continua passando pela checagem de SSRF.

const MAX_URL_LENGTH = 1800;

export function createUrlSigner(key) {
  const secret = Buffer.isBuffer(key) ? key : Buffer.from(String(key), "utf8");
  if (!secret.length) throw new Error("Chave de assinatura vazia.");

  function signature(payload) {
    return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  }

  return {
    sign(rawUrl) {
      const url = String(rawUrl || "").trim();
      if (!url || url.length > MAX_URL_LENGTH) return "";
      const payload = Buffer.from(url, "utf8").toString("base64url");
      return `${signature(payload)}/${payload}`;
    },
    verify(providedSignature, payload) {
      const provided = String(providedSignature || "");
      const encoded = String(payload || "");
      if (!provided || !encoded) return "";
      const expected = signature(encoded);
      if (provided.length !== expected.length) return "";
      if (!crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"))) return "";
      let url;
      try { url = Buffer.from(encoded, "base64url").toString("utf8"); }
      catch { return ""; }
      if (!url || url.length > MAX_URL_LENGTH) return "";
      return url;
    }
  };
}
