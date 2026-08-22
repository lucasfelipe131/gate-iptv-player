import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readFileSync } from "node:fs";

// Versao unica, lida do package.json — evita que os manifestos voltem a divergir.
const APP_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(
  path.join(root, "platforms/android-native/app/src/main/java/com/gateone/app/gateiptvplayer/MainActivity.java"),
  "utf8"
);
const appGradle = fs.readFileSync(
  path.join(root, "platforms/android-native/app/build.gradle"),
  "utf8"
);
const manifest = fs.readFileSync(
  path.join(root, "platforms/android-native/app/src/main/AndroidManifest.xml"),
  "utf8"
);
const launcherIcon = fs.readFileSync(
  path.join(root, "platforms/android-native/app/src/main/res/drawable/gate_icon.xml"),
  "utf8"
);
const bootReceiver = fs.readFileSync(
  path.join(root, "platforms/android-native/app/src/main/java/com/gateone/app/gateiptvplayer/BootReceiver.java"),
  "utf8"
);

test("publica o motor Android TV na mesma versão do package.json", () => {
  assert.match(appGradle, /versionCode \d+/);
  assert.ok(appGradle.includes(`versionName '${APP_VERSION}'`), "build.gradle deve seguir o package.json");
  assert.match(appGradle, /splits\s*\{[\s\S]*abi\s*\{/);
  assert.match(appGradle, /include 'armeabi-v7a', 'arm64-v8a'/);
  assert.match(appGradle, /universalApk false/);
  assert.ok(source.includes(`APP_VERSION = "${APP_VERSION}"`), "MainActivity deve usar a versão do package.json");
  assert.match(source, /GATE-TV-NATIVE\/" \+ APP_VERSION/);
  assert.match(source, /GATE-IPTV-PLAYER\/" \+ APP_VERSION/);
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
  assert.match(source, /\? currentRequest\.streamType\s*: "auto"/);
  assert.doesNotMatch(source, /"hls"\.equals\(currentRequest\.streamType\) \? "mpegts"/);
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
  assert.match(source, /FIRST_VIDEO_FRAME_TIMEOUT_MS = 20_000L/);
  assert.match(source, /WATCHDOG_INTERVAL_MS = 1_000L/);
  assert.match(source, /import androidx\.media3\.exoplayer\.DecoderCounters;/);
  assert.doesNotMatch(source, /import androidx\.media3\.decoder\.DecoderCounters;/);
  assert.match(source, /getVideoDecoderCounters/);
  assert.match(source, /renderedOutputBufferCount/);
  assert.match(source, /videoFramesSeen[\s\S]*lastRenderedFrameAt/);
  assert.match(source, /onTracksChanged\(Tracks tracks\)/);
  assert.match(source, /onRenderedFirstFrame\(\)/);
  assert.match(source, /O áudio iniciou, mas a imagem não apareceu/);
  assert.match(source, /setKeepContentOnPlayerReset\(false\)/);
  assert.match(source, /rebuildExoSurface\(\)/);
  assert.match(source, /rebuildVlcSurface\(\)/);
  assert.match(source, /eventType == MediaPlayer\.Event\.TimeChanged/);
  assert.match(source, /eventType == MediaPlayer\.Event\.Vout/);
  assert.match(source, /event\.getVoutCount\(\)/);
  assert.match(source, /O LibVLC perdeu a saída de vídeo/);
  assert.match(source, /activeAttempt\.engine == Engine\.MEDIA3/);
});

test("oferece inicialização automática após o boot sem ativá-la à força", () => {
  assert.match(manifest, /permission\.RECEIVE_BOOT_COMPLETED/);
  assert.match(manifest, /android\.intent\.action\.BOOT_COMPLETED/);
  assert.match(manifest, /android:name="\.BootReceiver"/);
  assert.match(bootReceiver, /PREFERENCE_AUTO_START/);
  assert.match(bootReceiver, /getBoolean\(MainActivity\.PREFERENCE_AUTO_START, false\)/);
  assert.match(bootReceiver, /FLAG_ACTIVITY_NEW_TASK/);
  assert.match(source, /isAutoStartEnabled\(\)/);
  assert.match(source, /setAutoStartEnabled\(boolean enabled\)/);
});

test("publica a identidade visual no launcher da TV", () => {
  assert.match(manifest, /android:icon="@drawable\/gate_icon"/);
  assert.match(manifest, /android:roundIcon="@drawable\/gate_icon"/);
  assert.match(manifest, /android:banner="@drawable\/tv_banner"/);
  assert.match(launcherIcon, /android:viewportWidth="128"/);
  assert.match(launcherIcon, /android:fillColor="#168BFF"/);
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
