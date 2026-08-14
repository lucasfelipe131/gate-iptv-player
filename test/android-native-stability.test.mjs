import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "platforms/android-native/app/src/main/java/com/gateone/app/gateiptvplayer/MainActivity.java"), "utf8");

test("mantém o canal aberto durante pausas transitórias da TV", () => {
  const onPause = source.match(/protected void onPause\(\) \{([\s\S]*?)\n    \}/)?.[1] || "";
  assert.doesNotMatch(onPause, /closeNativePlayer\(\)/);
  assert.match(onPause, /BACKGROUND_RELEASE_DELAY_MS/);
  assert.match(source, /BACKGROUND_RELEASE_DELAY_MS = 60_000L/);
});

test("usa buffer conservador e recuperação contínua no player nativo", () => {
  assert.match(source, /START_TIMEOUT_MS = 35_000L/);
  assert.match(source, /STALL_TIMEOUT_MS = 45_000L/);
  assert.match(source, /new PlaybackAttempt\(true, url, streamType, 10_000\)/);
  assert.match(source, /setBufferDurationsMs\(10_000, 90_000, 3_000, 8_000\)/);
  assert.match(source, /Mantendo o canal aberto e reconectando/);
  assert.doesNotMatch(source, /MAX_RETRY_ROUNDS/);
});
