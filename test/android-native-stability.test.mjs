import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(
  path.join(root, "platforms/android-native/app/src/main/java/com/gateone/app/gateiptvplayer/MainActivity.java"),
  "utf8"
);
const appGradle = fs.readFileSync(
  path.join(root, "platforms/android-native/app/build.gradle"),
  "utf8"
);

test("publica o motor Android TV como versão 0.6.0 coerente", () => {
  assert.match(appGradle, /versionCode 60/);
  assert.match(appGradle, /versionName '0\.6\.0'/);
  assert.match(source, /GATE-TV-NATIVE\/0\.6\.0/);
  assert.match(source, /GATE-IPTV-PLAYER\/0\.6\.0/);
  assert.doesNotMatch(source, /\.isBlank\(\)/, "isBlank não existe em vários Android TV antigos");
});

test("prioriza Media3 e só adiciona LibVLC depois dos perfis ExoPlayer", () => {
  const addAttempts = source.match(/private void addAttempts\([\s\S]*?\n    \}/)?.[0] || "";
  const firstMedia3 = addAttempts.indexOf("Engine.MEDIA3");
  const secondMedia3 = addAttempts.indexOf("Engine.MEDIA3", firstMedia3 + 1);
  const vlc = addAttempts.indexOf("Engine.VLC");
  assert.ok(firstMedia3 >= 0 && secondMedia3 > firstMedia3 && vlc > secondMedia3);
  assert.match(source, /setEnableDecoderFallback\(true\)/);
  assert.match(source, /MimeTypes\.APPLICATION_M3U8/);
  assert.match(source, /setLiveConfiguration/);
});

test("isola callbacks e tarefas atrasadas por canal e tentativa", () => {
  assert.match(source, /playbackSessionId/);
  assert.match(source, /activeAttemptToken/);
  assert.match(source, /isCurrentSession\(sessionId\)/);
  assert.match(source, /isCurrentAttempt\(sessionId, attemptToken\)/);
  assert.match(source, /scheduleSessionTask/);
  assert.match(source, /scheduledTaskToken != taskToken/);
  assert.match(source, /currentRequest\.matches/);
});

test("detecta congelamento por buffer, relógio e frames de vídeo", () => {
  assert.match(source, /START_TIMEOUT_MS = 30_000L/);
  assert.match(source, /BUFFER_TIMEOUT_MS = 18_000L/);
  assert.match(source, /STALL_TIMEOUT_MS = 15_000L/);
  assert.match(source, /VIDEO_STALL_TIMEOUT_MS = 18_000L/);
  assert.match(source, /WATCHDOG_INTERVAL_MS = 1_000L/);
  assert.match(source, /getVideoDecoderCounters/);
  assert.match(source, /renderedOutputBufferCount/);
  assert.match(source, /videoFramesSeen[\s\S]*lastRenderedFrameAt/);
  assert.match(source, /eventType == MediaPlayer\.Event\.TimeChanged/);
  assert.match(source, /LibVLC 3\.7\.5 does not expose a stable rendered-frame counter/);
});

test("renova ticket do mesmo canal sem entrar em loop de player", () => {
  assert.match(source, /MAX_SAME_ENGINE_RECOVERIES = 2/);
  assert.match(source, /STABLE_PLAYBACK_WINDOW_MS = 60_000L/);
  assert.match(source, /appendQueryParameter\("_gate_refresh"/);
  assert.match(source, /Signed provider URLs must never be modified/);
  assert.match(source, /Renovando o sinal do mesmo canal/);
  assert.match(source, /state == Player\.STATE_ENDED[\s\S]*liveSession/);
  assert.match(source, /Mantendo o canal aberto e reconectando/);
});

test("preserva canal no ciclo de vida e restaura áudio e rede", () => {
  const onPause = source.match(/protected void onPause\(\) \{([\s\S]*?)\n    \}/)?.[1] || "";
  assert.doesNotMatch(onPause, /closeNativePlayer\(/);
  assert.match(onPause, /pauseEngines\(\)/);
  assert.match(source, /BACKGROUND_RELEASE_DELAY_MS = 45_000L/);
  assert.match(source, /suspendedForBackground/);
  assert.match(source, /resumePendingAttempt\(true\)/);
  assert.match(source, /requestAudioFocus/);
  assert.match(source, /registerNetworkMonitor/);
  assert.match(source, /resetWatchdogAfterResume\(\)/);
  assert.match(source, /lastRenderedFrameAt = now/);
  assert.match(source, /attemptStartedAt = now/);
});

test("diferencia perda permanente, transitória e duck do foco de áudio", () => {
  assert.match(source, /AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK[\s\S]*setEngineVolume\(true\)/);
  assert.match(source, /AUDIOFOCUS_LOSS_TRANSIENT[\s\S]*pausedForAudioFocus = !manuallyPaused/);
  assert.match(source, /AUDIOFOCUS_LOSS\)[\s\S]*pausedForAudioFocus = false;[\s\S]*manuallyPaused = true/);
  assert.match(source, /private boolean requestAudioFocus\(\)/);
  assert.match(source, /if \(!requestAudioFocus\(\)\)/);
  assert.match(source, /exoPlayer\.setVolume\(duckedForAudioFocus \? 0\.2f : 1f\)/);
  assert.match(source, /vlcPlayer\.setVolume\(duckedForAudioFocus \? 20 : 100\)/);
});

test("limita o buffer por tempo e memória nas TVs de entrada", () => {
  assert.match(source, /maxBufferMs = attempt\.resilientBuffer \? 36_000 : 24_000/);
  assert.match(source, /48 \* 1024 \* 1024/);
  assert.match(source, /32 \* 1024 \* 1024/);
  assert.match(source, /setTargetBufferBytes\(targetBufferBytes\)/);
  assert.match(source, /setPrioritizeTimeOverSizeThresholds\(false\)/);
});

test("reconhece HLS e MPEG-TS abertos diretamente em tela cheia como live", () => {
  assert.match(source, /isLikelyLiveStream\(streamType, url\)/);
  assert.match(source, /"hls"\.equals\(normalized\) \|\| "mpegts"\.equals\(normalized\)/);
  assert.match(source, /startOrReusePlayback\(url, fallbackUrl, name, streamType, requestedLiveSession\)/);
});

test("controle remoto não movimenta a interface escondida durante tela cheia", () => {
  assert.match(source, /KEYCODE_MEDIA_PLAY_PAUSE/);
  assert.match(source, /KEYCODE_MEDIA_STOP/);
  assert.match(source, /KEYCODE_DPAD_CENTER/);
  assert.match(source, /Do not move the hidden catalogue focus/);
  assert.match(source, /fullscreen && previewBounds != null/);
});
