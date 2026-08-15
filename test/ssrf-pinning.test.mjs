import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

test("fixa o IP público validado no socket para impedir DNS rebinding", () => {
  assert.match(source, /resolveRemoteTarget/);
  assert.match(source, /records\.some\(\(\{ address \}\) => isPrivateIp\(address\)\)/);
  assert.match(source, /hostname: address/);
  assert.match(source, /servername:[^\n]+parsed\.hostname/);
  assert.match(source, /host: parsed\.host/);
  const openRemote = source.match(/async function openRemote[\s\S]*?\n\}/)?.[0] || "";
  assert.match(openRemote, /requestPinnedRemote/);
  assert.doesNotMatch(openRemote, /fetch\(/);
});

test("recusa credenciais embutidas e revalida cada redirecionamento", () => {
  assert.match(source, /parsed\.username \|\| parsed\.password/);
  assert.match(source, /resolveRemoteTarget\(new URL\(response\.headers\.get\("location"\)/);
});
