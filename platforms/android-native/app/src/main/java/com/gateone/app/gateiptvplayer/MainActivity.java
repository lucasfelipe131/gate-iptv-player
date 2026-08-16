package com.gateone.app.gateiptvplayer;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.UiModeManager;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Rect;
import android.media.AudioManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DecoderCounters;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * GATE TV Android/Android TV shell.
 *
 * The catalogue is rendered by the hosted web application, but every stream is
 * decoded by a native engine. Media3 is intentionally the first choice,
 * especially for HLS. LibVLC is only reached after Media3 has returned an error
 * or failed the progress watchdog.
 */
@OptIn(markerClass = UnstableApi.class)
public final class MainActivity extends Activity {
    private static final String HOME = "https://gate-iptv-player-production.up.railway.app/";
    private static final String APP_VERSION = "0.6.5";
    private static final String USER_AGENT = "GATE-TV-NATIVE/" + APP_VERSION;
    static final String PREFERENCES = "gate_tv_preferences";
    static final String PREFERENCE_AUTO_START = "auto_start_on_boot";
    private static final String PREFERENCE_PLAYER_ENGINE = "player_engine";
    private static final String PREFERENCE_QUALITY_MODE = "quality_mode";
    private static final String PREFERENCE_VIDEO_FIT = "video_fit";
    private static final String PREFERENCE_SCREEN_SIZE = "screen_size";
    private static final String PREFERENCE_WEB_VERSION = "web_shell_version";

    // A frozen live stream must recover quickly, but slow channel starts still
    // need enough time on entry-level TVs and congested Wi-Fi networks.
    private static final long START_TIMEOUT_MS = 30_000L;
    private static final long BUFFER_TIMEOUT_MS = 18_000L;
    private static final long STALL_TIMEOUT_MS = 15_000L;
    private static final long VIDEO_STALL_TIMEOUT_MS = 18_000L;
    private static final long FIRST_VIDEO_FRAME_TIMEOUT_MS = 20_000L;
    private static final long WATCHDOG_INTERVAL_MS = 1_000L;
    private static final long STABLE_PLAYBACK_WINDOW_MS = 60_000L;
    private static final long RECOVERY_COOLDOWN_MS = 2_000L;
    private static final long BACKGROUND_RELEASE_DELAY_MS = 45_000L;
    private static final int MAX_SAME_ENGINE_RECOVERIES = 2;

    private enum Engine {
        MEDIA3,
        VLC
    }

    private static final class PlaybackRequest {
        final String primaryUrl;
        final String fallbackUrl;
        final String name;
        final String streamType;

        PlaybackRequest(String primaryUrl, String fallbackUrl, String name, String streamType) {
            this.primaryUrl = safe(primaryUrl);
            this.fallbackUrl = safe(fallbackUrl);
            this.name = safe(name);
            this.streamType = normalizeStreamType(streamType, primaryUrl);
        }

        boolean matches(String nextPrimary, String nextFallback, String nextType) {
            return primaryUrl.equals(safe(nextPrimary))
                    && fallbackUrl.equals(safe(nextFallback))
                    && streamType.equals(normalizeStreamType(nextType, nextPrimary));
        }
    }

    private static final class PlaybackAttempt {
        final Engine engine;
        final String url;
        final String streamType;
        final boolean resilientBuffer;
        final int networkCacheMs;

        PlaybackAttempt(Engine engine, String url, String streamType,
                        boolean resilientBuffer, int networkCacheMs) {
            this.engine = engine;
            this.url = url;
            this.streamType = streamType;
            this.resilientBuffer = resilientBuffer;
            this.networkCacheMs = networkCacheMs;
        }
    }

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<PlaybackAttempt> attempts = new ArrayList<>();

    private FrameLayout root;
    private WebView catalogue;
    private FrameLayout playerLayer;
    private VLCVideoLayout vlcView;
    private PlayerView exoView;
    private TextView playerState;

    private LibVLC libVlc;
    private MediaPlayer vlcPlayer;
    private ExoPlayer exoPlayer;
    private PlaybackRequest currentRequest;
    private PlaybackAttempt activeAttempt;
    private Rect previewBounds;

    private volatile boolean nativePlaying;
    private boolean fullscreen;
    private boolean liveSession;
    private volatile boolean playbackStarted;
    private boolean attemptHasPlayed;
    private boolean switchingAttempt;
    private boolean activityResumed;
    private boolean suspendedForBackground;
    private boolean pendingAttemptOnResume;
    private boolean manuallyPaused;
    private boolean pausedForAudioFocus;
    private boolean duckedForAudioFocus;
    private boolean networkAvailable = true;
    private boolean networkCallbackRegistered;
    private boolean videoFramesSeen;
    private boolean videoTrackExpected;

    private int attemptIndex;
    private int retryRound;
    private int sameEngineRecoveries;
    private int exoPlaybackState = Player.STATE_IDLE;
    private volatile long playbackSessionId;
    private volatile long activeAttemptToken;
    private long scheduledTaskToken;
    private long refreshSerial;
    private long attemptStartedAt;
    private long lastProgressAt;
    private volatile long lastRenderedFrameAt;
    private long stablePlaybackSince;
    private long bufferingSince;
    private long lastExoPosition = C.TIME_UNSET;
    private long lastVlcTime = -1L;
    private float lastVlcPosition = -1f;
    private int lastRenderedVideoBufferCount = -1;

    private ConnectivityManager connectivityManager;
    private AudioManager audioManager;
    private boolean hasAudioFocus;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersiveMode();

        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        networkAvailable = isNetworkCurrentlyAvailable();

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(5, 14, 29));

        catalogue = new WebView(this);
        catalogue.setBackgroundColor(Color.rgb(5, 14, 29));
        WebSettings settings = catalogue.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        boolean webShellChanged = !APP_VERSION.equals(getSharedPreferences(PREFERENCES, MODE_PRIVATE)
                .getString(PREFERENCE_WEB_VERSION, ""));
        settings.setCacheMode(webShellChanged ? WebSettings.LOAD_NO_CACHE : WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " GATE-IPTV-PLAYER/" + APP_VERSION);
        catalogue.setWebChromeClient(new WebChromeClient());
        catalogue.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
                        .putString(PREFERENCE_WEB_VERSION, APP_VERSION)
                        .apply();
                view.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT);
            }
        });
        catalogue.addJavascriptInterface(new PlayerBridge(), "GateNativePlayer");
        root.addView(catalogue, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        playerLayer = new FrameLayout(this);
        playerLayer.setBackgroundColor(Color.BLACK);
        playerLayer.setClickable(false);
        playerLayer.setFocusable(false);

        vlcView = createVlcView();
        playerLayer.addView(vlcView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        exoView = createExoView();
        playerLayer.addView(exoView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        playerState = new TextView(this);
        playerState.setTextColor(Color.WHITE);
        playerState.setTextSize(17);
        playerState.setPadding(30, 22, 30, 22);
        playerState.setBackgroundColor(0xB3000000);
        playerState.setFocusable(false);
        playerLayer.addView(playerState, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        playerLayer.setVisibility(View.GONE);
        root.addView(playerLayer, new FrameLayout.LayoutParams(1, 1));

        setContentView(root);
        activityResumed = true;
        registerNetworkMonitor();
        catalogue.loadUrl(HOME + (isTelevision() ? "?platform=androidtv" : "?platform=android")
                + "&appVersion=" + APP_VERSION);
        handler.post(watchdog);
    }

    private static String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private static String normalizeStreamType(String streamType, String url) {
        String normalized = safe(streamType).toLowerCase(Locale.US);
        if ("hls".equals(normalized) || "mpegts".equals(normalized)) return normalized;
        String candidate = safe(url).toLowerCase(Locale.US);
        if (candidate.matches(".*\\.m3u8(?:$|[?#]).*")) return "hls";
        if (candidate.matches(".*\\.ts(?:$|[?#]).*")) return "mpegts";
        return "auto";
    }

    private boolean isTelevision() {
        UiModeManager manager = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
        return manager != null
                && manager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
    }

    private PlayerView createExoView() {
        PlayerView view = new PlayerView(this);
        view.setUseController(false);
        view.setKeepContentOnPlayerReset(false);
        view.setShutterBackgroundColor(Color.BLACK);
        view.setResizeMode(exoResizeMode());
        view.setVisibility(View.GONE);
        return view;
    }

    private VLCVideoLayout createVlcView() {
        VLCVideoLayout view = new VLCVideoLayout(this);
        view.setVisibility(View.GONE);
        return view;
    }

    private void rebuildVlcSurface() {
        if (vlcView != null) playerLayer.removeView(vlcView);
        vlcView = createVlcView();
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        );
        playerLayer.addView(vlcView, 0, params);
    }

    private void rebuildExoSurface() {
        if (exoView != null) playerLayer.removeView(exoView);
        exoView = createExoView();
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        );
        playerLayer.addView(exoView, Math.min(1, playerLayer.getChildCount()), params);
    }

    private final class PlayerBridge {
        @JavascriptInterface
        public void preview(String url, String fallbackUrl, String name, String streamType,
                            int x, int y, int width, int height) {
            runOnUiThread(() -> {
                previewBounds = new Rect(x, y, x + Math.max(1, width), y + Math.max(1, height));
                fullscreen = false;
                liveSession = true;
                startOrReusePlayback(url, fallbackUrl, name, streamType, true);
                applyPreviewBounds();
            });
        }

        @JavascriptInterface
        public void playFullscreen(String url, String fallbackUrl, String name, String streamType) {
            runOnUiThread(() -> {
                boolean sameChannel = currentRequest != null
                        && currentRequest.matches(url, fallbackUrl, streamType);
                boolean requestedLiveSession = (sameChannel && liveSession)
                        || isLikelyLiveStream(streamType, url);
                if (!sameChannel) {
                    previewBounds = null;
                    liveSession = requestedLiveSession;
                }
                fullscreen = true;
                startOrReusePlayback(url, fallbackUrl, name, streamType, requestedLiveSession);
                applyFullscreenBounds();
            });
        }

        @JavascriptInterface
        public void fullscreen() {
            runOnUiThread(() -> {
                if (!nativePlaying) return;
                fullscreen = true;
                applyFullscreenBounds();
            });
        }

        @JavascriptInterface
        public void resizePreview(int x, int y, int width, int height) {
            runOnUiThread(() -> {
                if (!nativePlaying || fullscreen) return;
                previewBounds = new Rect(x, y, x + Math.max(1, width), y + Math.max(1, height));
                applyPreviewBounds();
            });
        }

        @JavascriptInterface
        public void close() {
            runOnUiThread(MainActivity.this::closeNativePlayer);
        }

        @JavascriptInterface
        public boolean isAutoStartEnabled() {
            return getSharedPreferences(PREFERENCES, MODE_PRIVATE)
                    .getBoolean(PREFERENCE_AUTO_START, false);
        }

        @JavascriptInterface
        public void setAutoStartEnabled(boolean enabled) {
            getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
                    .putBoolean(PREFERENCE_AUTO_START, enabled)
                    .apply();
        }

        @JavascriptInterface
        public String getPreferredEngine() {
            return choicePreference(PREFERENCE_PLAYER_ENGINE, "auto", "auto", "media3", "vlc");
        }

        @JavascriptInterface
        public void setPreferredEngine(String value) {
            String normalized = normalizeChoice(value, "auto", "auto", "media3", "vlc");
            saveChoicePreference(PREFERENCE_PLAYER_ENGINE, normalized);
            runOnUiThread(MainActivity.this::restartCurrentPlaybackForPreference);
        }

        @JavascriptInterface
        public String getQualityMode() {
            return choicePreference(PREFERENCE_QUALITY_MODE, "auto", "auto", "stable", "max");
        }

        @JavascriptInterface
        public void setQualityMode(String value) {
            String normalized = normalizeChoice(value, "auto", "auto", "stable", "max");
            saveChoicePreference(PREFERENCE_QUALITY_MODE, normalized);
            runOnUiThread(MainActivity.this::restartCurrentPlaybackForPreference);
        }

        @JavascriptInterface
        public String getVideoFit() {
            return choicePreference(PREFERENCE_VIDEO_FIT, "fit", "fit", "zoom", "stretch");
        }

        @JavascriptInterface
        public void setVideoFit(String value) {
            String normalized = normalizeChoice(value, "fit", "fit", "zoom", "stretch");
            saveChoicePreference(PREFERENCE_VIDEO_FIT, normalized);
            runOnUiThread(MainActivity.this::applyVideoResizeMode);
        }

        @JavascriptInterface
        public String getScreenSize() {
            return choicePreference(PREFERENCE_SCREEN_SIZE, "100", "100", "95", "90");
        }

        @JavascriptInterface
        public void setScreenSize(String value) {
            String normalized = normalizeChoice(value, "100", "100", "95", "90");
            saveChoicePreference(PREFERENCE_SCREEN_SIZE, normalized);
            runOnUiThread(() -> {
                if (nativePlaying && fullscreen) applyFullscreenBounds();
            });
        }
    }

    private static String normalizeChoice(String value, String fallback, String... allowed) {
        String normalized = safe(value).toLowerCase(Locale.US);
        for (String candidate : allowed) if (candidate.equals(normalized)) return normalized;
        return fallback;
    }

    private String choicePreference(String key, String fallback, String... allowed) {
        String value = getSharedPreferences(PREFERENCES, MODE_PRIVATE).getString(key, fallback);
        return normalizeChoice(value, fallback, allowed);
    }

    private void saveChoicePreference(String key, String value) {
        getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit().putString(key, value).apply();
    }

    private void restartCurrentPlaybackForPreference() {
        applyVideoResizeMode();
        if (!nativePlaying || currentRequest == null) return;
        PlaybackRequest request = currentRequest;
        boolean wasFullscreen = fullscreen;
        boolean wasLive = liveSession;
        startPlayback(request.primaryUrl, request.fallbackUrl, request.name, request.streamType, wasLive);
        fullscreen = wasFullscreen;
        if (wasFullscreen) applyFullscreenBounds();
        else applyPreviewBounds();
    }

    private void startOrReusePlayback(String primaryUrl, String fallbackUrl, String name,
                                      String streamType, boolean asLiveSession) {
        if (currentRequest != null
                && currentRequest.matches(primaryUrl, fallbackUrl, streamType)
                && nativePlaying) {
            liveSession = liveSession || asLiveSession;
            manuallyPaused = false;
            if (suspendedForBackground || (exoPlayer == null && vlcPlayer == null)) {
                suspendedForBackground = false;
                pendingAttemptOnResume = false;
                sameEngineRecoveries = 0;
                attemptHasPlayed = false;
                resumePendingAttempt(true);
            } else {
                resumeEngines();
            }
            return;
        }
        startPlayback(primaryUrl, fallbackUrl, name, streamType, asLiveSession);
    }

    private void startPlayback(String primaryUrl, String fallbackUrl, String name,
                               String streamType, boolean asLiveSession) {
        invalidateActiveAttempt();
        releaseEngines();
        attempts.clear();
        currentRequest = new PlaybackRequest(primaryUrl, fallbackUrl, name, streamType);
        addAttempts(currentRequest.primaryUrl, currentRequest.streamType);
        if (!currentRequest.fallbackUrl.isEmpty()
                && !currentRequest.fallbackUrl.equals(currentRequest.primaryUrl)) {
            String fallbackType = isSameGateTicket(
                    currentRequest.primaryUrl,
                    currentRequest.fallbackUrl
            ) ? currentRequest.streamType
                    : "auto";
            addAttempts(currentRequest.fallbackUrl, fallbackType);
        }

        playbackSessionId += 1L;
        attemptIndex = 0;
        retryRound = 0;
        sameEngineRecoveries = 0;
        nativePlaying = !attempts.isEmpty();
        liveSession = asLiveSession;
        manuallyPaused = false;
        pausedForAudioFocus = false;
        suspendedForBackground = false;
        pendingAttemptOnResume = false;
        playerLayer.setVisibility(nativePlaying ? View.VISIBLE : View.GONE);

        if (!nativePlaying) {
            notifyWeb("onError", "O endereço deste canal é inválido.");
            return;
        }
        requestAudioFocus();
        startAttempt(playbackSessionId);
    }

    private void addAttempts(String url, String streamType) {
        if (!isSupportedNetworkUrl(url)) return;
        String type = normalizeStreamType(streamType, url);

        PlaybackAttempt media3Fast = new PlaybackAttempt(Engine.MEDIA3, url, type, false, 0);
        PlaybackAttempt media3Resilient = new PlaybackAttempt(Engine.MEDIA3, url, type, true, 0);
        PlaybackAttempt vlcCompatible = new PlaybackAttempt(
                Engine.VLC,
                url,
                type,
                true,
                "hls".equals(type) ? 6_000 : 8_000
        );
        String preferredEngine = choicePreference(
                PREFERENCE_PLAYER_ENGINE, "auto", "auto", "media3", "vlc");
        if ("vlc".equals(preferredEngine)) {
            attempts.add(vlcCompatible);
            attempts.add(media3Fast);
            attempts.add(media3Resilient);
        } else {
            // Media3 uses adaptive bitrate and a second, larger buffer profile.
            // LibVLC remains available as a decoder fallback on difficult feeds.
            attempts.add(media3Fast);
            attempts.add(media3Resilient);
            attempts.add(vlcCompatible);
        }
    }

    private static boolean isSupportedNetworkUrl(String value) {
        try {
            String scheme = Uri.parse(safe(value)).getScheme();
            return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private static boolean isLikelyLiveStream(String streamType, String url) {
        String normalized = normalizeStreamType(streamType, url);
        return "hls".equals(normalized) || "mpegts".equals(normalized);
    }

    private static boolean isSameGateTicket(String first, String second) {
        try {
            Uri home = Uri.parse(HOME);
            Uri left = Uri.parse(first);
            Uri right = Uri.parse(second);
            return left.getHost() != null
                    && left.getHost().equalsIgnoreCase(home.getHost())
                    && left.getHost().equalsIgnoreCase(right.getHost())
                    && left.getPath() != null
                    && left.getPath().startsWith("/api/stream/")
                    && left.getPath().equals(right.getPath());
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private void startAttempt(long sessionId) {
        if (!isCurrentSession(sessionId)) return;
        if (!activityResumed) {
            pendingAttemptOnResume = true;
            return;
        }
        if (!networkAvailable) {
            switchingAttempt = false;
            showState("Sem internet. O canal será retomado quando a conexão voltar.");
            return;
        }
        if (attemptIndex >= attempts.size()) {
            invalidateActiveAttempt();
            releaseEngines();
            retryRound += 1;
            attemptIndex = 0;
            switchingAttempt = true;
            long delay = Math.min(30_000L, 2_000L << Math.min(4, retryRound - 1));
            showState("Sinal indisponível. Mantendo o canal aberto e reconectando…");
            if (retryRound == 1) {
                notifyWeb("onError", "O sinal caiu. A GATE TV está reconectando o mesmo canal.");
            }
            scheduleSessionTask(sessionId, delay, () -> {
                switchingAttempt = false;
                startAttempt(sessionId);
            });
            return;
        }

        sameEngineRecoveries = 0;
        attemptHasPlayed = false;
        switchingAttempt = false;
        activeAttempt = attempts.get(attemptIndex);
        launchCurrentAttempt(sessionId, false);
    }

    private void launchCurrentAttempt(long sessionId, boolean refreshRoute) {
        if (!isCurrentSession(sessionId) || activeAttempt == null) return;
        if (!activityResumed) {
            pendingAttemptOnResume = true;
            return;
        }
        if (!networkAvailable) {
            showState("Sem internet. Aguardando para retomar o canal…");
            return;
        }

        // Invalidates any older reconnect timer for this same channel.
        scheduledTaskToken += 1L;
        invalidateActiveAttempt();
        releaseEngines();
        long attemptToken = activeAttemptToken;
        playbackStarted = false;
        videoFramesSeen = false;
        videoTrackExpected = false;
        exoPlaybackState = Player.STATE_IDLE;
        lastExoPosition = C.TIME_UNSET;
        lastVlcTime = -1L;
        lastVlcPosition = -1f;
        lastRenderedVideoBufferCount = -1;
        lastRenderedFrameAt = 0L;
        stablePlaybackSince = 0L;
        bufferingSince = 0L;
        attemptStartedAt = SystemClock.elapsedRealtime();
        lastProgressAt = attemptStartedAt;
        switchingAttempt = false;
        showState(attemptIndex == 0 && !refreshRoute
                ? "Conectando…"
                : refreshRoute
                ? "Renovando o sinal sem sair do canal…"
                : "Ajustando motor e rota…");

        String playbackUrl = refreshedGateUrl(activeAttempt.url, refreshRoute);
        if (activeAttempt.engine == Engine.MEDIA3) {
            startExoPlayer(activeAttempt, playbackUrl, sessionId, attemptToken);
        } else {
            startVlc(activeAttempt, playbackUrl, sessionId, attemptToken);
        }
    }

    private void resumePendingAttempt(boolean refreshRoute) {
        if (!nativePlaying) return;
        if (attemptIndex >= attempts.size()) {
            startAttempt(playbackSessionId);
            return;
        }
        activeAttempt = attempts.get(attemptIndex);
        launchCurrentAttempt(playbackSessionId, refreshRoute);
    }

    private String refreshedGateUrl(String value, boolean refreshRoute) {
        if (!refreshRoute) return value;
        try {
            Uri source = Uri.parse(value);
            Uri home = Uri.parse(HOME);
            if (source.getHost() != null
                    && source.getHost().equalsIgnoreCase(home.getHost())
                    && source.getPath() != null
                    && source.getPath().startsWith("/api/stream/")) {
                refreshSerial += 1L;
                return source.buildUpon()
                        .appendQueryParameter("_gate_refresh", String.valueOf(refreshSerial))
                        .build()
                        .toString();
            }
        } catch (RuntimeException ignored) {
            // Signed provider URLs must never be modified.
        }
        return value;
    }

    private void startExoPlayer(PlaybackAttempt attempt, String playbackUrl,
                                long sessionId, long attemptToken) {
        rebuildExoSurface();
        vlcView.setVisibility(View.GONE);
        exoView.setVisibility(View.VISIBLE);

        Map<String, String> requestHeaders = new HashMap<>();
        requestHeaders.put("Cache-Control", "no-cache");
        requestHeaders.put("Pragma", "no-cache");
        requestHeaders.put("Accept", "application/vnd.apple.mpegurl, application/x-mpegURL, video/mp2t, */*");

        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent(USER_AGENT)
                .setConnectTimeoutMs(20_000)
                .setReadTimeoutMs(35_000)
                .setAllowCrossProtocolRedirects(true)
                .setDefaultRequestProperties(requestHeaders);
        DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(this, httpFactory);
        DefaultExtractorsFactory extractorsFactory = new DefaultExtractorsFactory()
                .setTsExtractorFlags(
                        DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS
                                | DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES
                                | DefaultTsPayloadReaderFactory.FLAG_ENABLE_HDMV_DTS_AUDIO_STREAMS);
        DefaultMediaSourceFactory sourceFactory = new DefaultMediaSourceFactory(this, extractorsFactory)
                .setDataSourceFactory(dataSourceFactory);

        int minBufferMs = attempt.resilientBuffer ? 10_000 : 5_000;
        int maxBufferMs = attempt.resilientBuffer ? 36_000 : 24_000;
        int playbackBufferMs = attempt.resilientBuffer ? 2_500 : 1_500;
        int rebufferMs = attempt.resilientBuffer ? 6_000 : 3_500;
        int targetBufferBytes = attempt.resilientBuffer
                ? 48 * 1024 * 1024
                : 32 * 1024 * 1024;
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(minBufferMs, maxBufferMs, playbackBufferMs, rebufferMs)
                .setTargetBufferBytes(targetBufferBytes)
                .setPrioritizeTimeOverSizeThresholds(false)
                .build();
        DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(this)
                .setEnableDecoderFallback(true);

        DefaultTrackSelector trackSelector = new DefaultTrackSelector(this);
        DefaultTrackSelector.Parameters.Builder trackParameters = trackSelector.buildUponParameters();
        if ("stable".equals(choicePreference(
                PREFERENCE_QUALITY_MODE, "auto", "auto", "stable", "max"))) {
            trackParameters.setMaxVideoSize(1920, 1080);
        }
        trackSelector.setParameters(trackParameters.build());

        exoPlayer = new ExoPlayer.Builder(this, renderersFactory)
                .setMediaSourceFactory(sourceFactory)
                .setLoadControl(loadControl)
                .setTrackSelector(trackSelector)
                .build();
        exoView.setPlayer(exoPlayer);
        applyVideoResizeMode();

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build();
        exoPlayer.setAudioAttributes(audioAttributes, false);
        exoPlayer.setHandleAudioBecomingNoisy(true);
        exoPlayer.setVolume(duckedForAudioFocus ? 0.2f : 1f);
        exoPlayer.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (!isCurrentAttempt(sessionId, attemptToken)) return;
                exoPlaybackState = state;
                if (state == Player.STATE_BUFFERING) {
                    if (bufferingSince == 0L) bufferingSince = SystemClock.elapsedRealtime();
                    if (playbackStarted) showState("Sinal oscilando. Recuperando…");
                } else {
                    bufferingSince = 0L;
                }
                if (state == Player.STATE_ENDED) {
                    if (liveSession) {
                        handleEngineFailure(sessionId, attemptToken,
                                "A transmissão ao vivo encerrou inesperadamente.", true);
                    } else {
                        manuallyPaused = true;
                        showState("Reprodução concluída");
                    }
                }
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) markPlaying(sessionId, attemptToken, "Media3");
            }

            @Override
            public void onTracksChanged(Tracks tracks) {
                if (!isCurrentAttempt(sessionId, attemptToken)) return;
                videoTrackExpected = tracks.isTypeSelected(C.TRACK_TYPE_VIDEO);
            }

            @Override
            public void onRenderedFirstFrame() {
                if (!isCurrentAttempt(sessionId, attemptToken)) return;
                long now = SystemClock.elapsedRealtime();
                videoFramesSeen = true;
                lastRenderedFrameAt = now;
                recordProgress(now);
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                String reason = error.getErrorCodeName();
                handleEngineFailure(sessionId, attemptToken,
                        "O Media3 perdeu o sinal (" + reason + ").", false);
            }
        });

        MediaItem.Builder mediaBuilder = new MediaItem.Builder().setUri(playbackUrl);
        if ("hls".equals(attempt.streamType)) {
            mediaBuilder.setMimeType(MimeTypes.APPLICATION_M3U8);
            mediaBuilder.setLiveConfiguration(new MediaItem.LiveConfiguration.Builder()
                    .setTargetOffsetMs(attempt.resilientBuffer ? 10_000L : 5_000L)
                    .setMinPlaybackSpeed(0.97f)
                    .setMaxPlaybackSpeed(1.04f)
                    .build());
        } else if ("mpegts".equals(attempt.streamType)) {
            mediaBuilder.setMimeType(MimeTypes.VIDEO_MP2T);
        }
        exoPlayer.setMediaItem(mediaBuilder.build(), true);
        exoPlayer.setPlayWhenReady(true);
        exoPlayer.prepare();
        exoPlayer.play();
    }

    private void startVlc(PlaybackAttempt attempt, String playbackUrl,
                          long sessionId, long attemptToken) {
        rebuildVlcSurface();
        exoView.setVisibility(View.GONE);
        vlcView.setVisibility(View.VISIBLE);
        videoTrackExpected = true;

        ArrayList<String> options = new ArrayList<>();
        options.add("--network-caching=" + attempt.networkCacheMs);
        options.add("--live-caching=" + attempt.networkCacheMs);
        options.add("--file-caching=3000");
        options.add("--http-reconnect");
        options.add("--http-continuous");
        options.add("--http-user-agent=" + USER_AGENT);
        options.add("--avcodec-hw=any");
        options.add("--drop-late-frames");
        options.add("--skip-frames");
        options.add("--audio-time-stretch");

        libVlc = new LibVLC(this, options);
        vlcPlayer = new MediaPlayer(libVlc);
        vlcPlayer.attachViews(vlcView, null, false, false);
        applyVideoResizeMode();
        vlcPlayer.setVolume(duckedForAudioFocus ? 20 : 100);
        Media media = new Media(libVlc, Uri.parse(playbackUrl));
        media.setHWDecoderEnabled(true, false);
        media.addOption(":network-caching=" + attempt.networkCacheMs);
        media.addOption(":live-caching=" + attempt.networkCacheMs);
        media.addOption(":http-reconnect");
        media.addOption(":http-continuous");
        media.addOption(":http-user-agent=" + USER_AGENT);
        vlcPlayer.setMedia(media);
        media.release();
        vlcPlayer.setEventListener(event -> {
            int eventType = event.type;
            float buffering = eventType == MediaPlayer.Event.Buffering
                    ? event.getBuffering()
                    : -1f;
            int videoOutputs = eventType == MediaPlayer.Event.Vout
                    ? event.getVoutCount()
                    : -1;
            handler.post(() -> handleVlcEvent(
                    eventType,
                    buffering,
                    videoOutputs,
                    sessionId,
                    attemptToken
            ));
        });
        vlcPlayer.play();
    }

    private void handleVlcEvent(int eventType, float buffering, int videoOutputs,
                                long sessionId, long attemptToken) {
        if (!isCurrentAttempt(sessionId, attemptToken) || vlcPlayer == null) return;
        if (eventType == MediaPlayer.Event.Playing) {
            bufferingSince = 0L;
            markPlaying(sessionId, attemptToken, "LibVLC");
        } else if (eventType == MediaPlayer.Event.TimeChanged) {
            // TimeChanged is emitted by LibVLC only when its media clock moves.
            recordProgress(SystemClock.elapsedRealtime());
        } else if (eventType == MediaPlayer.Event.PositionChanged) {
            float position = vlcPlayer.getPosition();
            if (position >= 0f && (lastVlcPosition < 0f || Math.abs(position - lastVlcPosition) > 0.0001f)) {
                lastVlcPosition = position;
                recordProgress(SystemClock.elapsedRealtime());
            }
        } else if (eventType == MediaPlayer.Event.Buffering) {
            if (buffering >= 99.5f) {
                bufferingSince = 0L;
            } else {
                if (bufferingSince == 0L) bufferingSince = SystemClock.elapsedRealtime();
                if (playbackStarted) showState("Sinal oscilando. Recuperando…");
            }
        } else if (eventType == MediaPlayer.Event.Vout) {
            if (videoOutputs > 0) {
                long now = SystemClock.elapsedRealtime();
                videoFramesSeen = true;
                lastRenderedFrameAt = now;
                recordProgress(now);
            } else if (playbackStarted && videoFramesSeen) {
                handleEngineFailure(sessionId, attemptToken,
                        "O LibVLC perdeu a saída de vídeo.", false);
            }
        } else if (eventType == MediaPlayer.Event.EncounteredError) {
            handleEngineFailure(sessionId, attemptToken, "O LibVLC perdeu o sinal.", false);
        } else if (eventType == MediaPlayer.Event.EndReached) {
            if (liveSession) {
                handleEngineFailure(sessionId, attemptToken,
                        "A transmissão ao vivo encerrou inesperadamente.", true);
            } else {
                manuallyPaused = true;
                showState("Reprodução concluída");
            }
        }
    }

    private void markPlaying(long sessionId, long attemptToken, String engine) {
        if (!isCurrentAttempt(sessionId, attemptToken)) return;
        boolean firstStart = !playbackStarted;
        playbackStarted = true;
        attemptHasPlayed = true;
        bufferingSince = 0L;
        recordProgress(SystemClock.elapsedRealtime());
        playerState.setVisibility(View.GONE);
        if (firstStart) notifyWeb("onEngine", engine);
    }

    private void recordProgress(long now) {
        lastProgressAt = now;
        if (stablePlaybackSince == 0L) stablePlaybackSince = now;
    }

    private void handleEngineFailure(long sessionId, long attemptToken,
                                     String reason, boolean endedLiveStream) {
        if (!isCurrentAttempt(sessionId, attemptToken) || switchingAttempt) return;
        if (!networkAvailable) {
            showState("Sem internet. O canal será retomado automaticamente.");
            return;
        }

        boolean refreshSameEngine = (attemptHasPlayed || endedLiveStream)
                && sameEngineRecoveries < MAX_SAME_ENGINE_RECOVERIES;
        if (refreshSameEngine) {
            sameEngineRecoveries += 1;
            switchingAttempt = true;
            invalidateActiveAttempt();
            releaseEngines();
            showState("Renovando o sinal do mesmo canal…");
            scheduleSessionTask(sessionId, RECOVERY_COOLDOWN_MS * sameEngineRecoveries, () -> {
                if (attemptIndex >= attempts.size()) return;
                activeAttempt = attempts.get(attemptIndex);
                switchingAttempt = false;
                launchCurrentAttempt(sessionId, true);
            });
            return;
        }

        switchingAttempt = true;
        invalidateActiveAttempt();
        releaseEngines();
        attemptIndex += 1;
        showState(reason + " Tentando outra rota…");
        scheduleSessionTask(sessionId, 500L, () -> {
            switchingAttempt = false;
            startAttempt(sessionId);
        });
    }

    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            if (nativePlaying && activityResumed && !suspendedForBackground
                    && !manuallyPaused && !pausedForAudioFocus && !switchingAttempt) {
                long now = SystemClock.elapsedRealtime();
                updateClockProgress(now);

                if (playbackStarted
                        && stablePlaybackSince > 0L
                        && now - stablePlaybackSince >= STABLE_PLAYBACK_WINDOW_MS) {
                    // A later five-minute ticket expiry may be renewed again, but
                    // two rapid failures still advance to a different route/engine.
                    retryRound = 0;
                    sameEngineRecoveries = 0;
                }

                long sessionId = playbackSessionId;
                long attemptToken = activeAttemptToken;
                if (!networkAvailable) {
                    showState("Sem internet. Aguardando para retomar o canal…");
                } else if (!playbackStarted && now - attemptStartedAt > START_TIMEOUT_MS) {
                    handleEngineFailure(sessionId, attemptToken,
                            "O canal demorou para iniciar.", false);
                } else if (bufferingSince > 0L && now - bufferingSince > BUFFER_TIMEOUT_MS) {
                    handleEngineFailure(sessionId, attemptToken,
                            "O buffer parou de receber dados.", false);
                } else if (playbackStarted && videoTrackExpected && !videoFramesSeen
                        && now - attemptStartedAt > FIRST_VIDEO_FRAME_TIMEOUT_MS) {
                    handleEngineFailure(sessionId, attemptToken,
                            "O áudio iniciou, mas a imagem não apareceu.", false);
                } else if (activeAttempt != null && activeAttempt.engine == Engine.MEDIA3
                        && playbackStarted && videoFramesSeen
                        && now - lastRenderedFrameAt > VIDEO_STALL_TIMEOUT_MS) {
                    handleEngineFailure(sessionId, attemptToken,
                            "A imagem congelou.", false);
                } else if (playbackStarted && now - lastProgressAt > STALL_TIMEOUT_MS) {
                    handleEngineFailure(sessionId, attemptToken,
                            "O relógio da transmissão parou.", false);
                } else if (exoPlayer != null
                        && exoPlaybackState == Player.STATE_READY
                        && exoPlayer.getPlayWhenReady()
                        && !exoPlayer.isPlaying()
                        && exoPlayer.getPlaybackSuppressionReason()
                        == Player.PLAYBACK_SUPPRESSION_REASON_NONE
                        && now - lastProgressAt > 4_000L) {
                    // Some Android TV firmware silently leaves MediaCodec ready
                    // but paused after an HDMI/audio-focus transition.
                    exoPlayer.play();
                }
            }
            handler.postDelayed(this, WATCHDOG_INTERVAL_MS);
        }
    };

    private void updateClockProgress(long now) {
        if (exoPlayer != null) {
            long position = exoPlayer.getCurrentPosition();
            if (position != C.TIME_UNSET && position >= 0L
                    && (lastExoPosition == C.TIME_UNSET
                    || Math.abs(position - lastExoPosition) >= 120L)) {
                lastExoPosition = position;
                recordProgress(now);
                if (!playbackStarted) {
                    markPlaying(playbackSessionId, activeAttemptToken, "Media3");
                }
            }
            DecoderCounters videoCounters = exoPlayer.getVideoDecoderCounters();
            if (videoCounters != null) {
                videoCounters.ensureUpdated();
                int renderedBuffers = videoCounters.renderedOutputBufferCount;
                if (lastRenderedVideoBufferCount < 0 || renderedBuffers != lastRenderedVideoBufferCount) {
                    lastRenderedVideoBufferCount = renderedBuffers;
                    if (renderedBuffers > 0) {
                        videoFramesSeen = true;
                        lastRenderedFrameAt = now;
                        recordProgress(now);
                    }
                }
            }
            if (lastRenderedFrameAt > 0L) {
                videoFramesSeen = true;
                if (lastRenderedFrameAt > lastProgressAt) recordProgress(lastRenderedFrameAt);
            }
        } else if (vlcPlayer != null && vlcPlayer.isPlaying()) {
            // LibVLC exposes Vout surface-count changes but no stable per-frame
            // counter. Vout catches a lost surface; clock and buffering events
            // cover a stream that stops delivering data.
            long time = vlcPlayer.getTime();
            if (time >= 0L && (lastVlcTime < 0L || Math.abs(time - lastVlcTime) >= 120L)) {
                lastVlcTime = time;
                recordProgress(now);
            }
        }
    }

    private void scheduleSessionTask(long sessionId, long delayMs, Runnable action) {
        long taskToken = ++scheduledTaskToken;
        handler.postDelayed(() -> {
            if (!isCurrentSession(sessionId) || scheduledTaskToken != taskToken) return;
            if (!activityResumed) {
                pendingAttemptOnResume = true;
                return;
            }
            action.run();
        }, delayMs);
    }

    private boolean isCurrentSession(long sessionId) {
        return nativePlaying && playbackSessionId == sessionId;
    }

    private boolean isCurrentAttempt(long sessionId, long attemptToken) {
        return isCurrentSession(sessionId) && activeAttemptToken == attemptToken;
    }

    private void invalidateActiveAttempt() {
        activeAttemptToken += 1L;
    }

    private void applyPreviewBounds() {
        if (previewBounds == null) return;
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                Math.max(1, previewBounds.width()),
                Math.max(1, previewBounds.height())
        );
        params.leftMargin = Math.max(0, previewBounds.left);
        params.topMargin = Math.max(0, previewBounds.top);
        playerLayer.setLayoutParams(params);
        playerLayer.setVisibility(View.VISIBLE);
    }

    private void applyFullscreenBounds() {
        enterImmersiveMode();
        int percent;
        try {
            percent = Integer.parseInt(choicePreference(
                    PREFERENCE_SCREEN_SIZE, "100", "100", "95", "90"));
        } catch (NumberFormatException ignored) {
            percent = 100;
        }
        int rootWidth = root.getWidth() > 0 ? root.getWidth() : getResources().getDisplayMetrics().widthPixels;
        int rootHeight = root.getHeight() > 0 ? root.getHeight() : getResources().getDisplayMetrics().heightPixels;
        int width = percent >= 100 ? ViewGroup.LayoutParams.MATCH_PARENT : Math.max(1, rootWidth * percent / 100);
        int height = percent >= 100 ? ViewGroup.LayoutParams.MATCH_PARENT : Math.max(1, rootHeight * percent / 100);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                width,
                height
        );
        params.gravity = Gravity.CENTER;
        params.leftMargin = 0;
        params.topMargin = 0;
        playerLayer.setLayoutParams(params);
        playerLayer.setVisibility(View.VISIBLE);
    }

    private int exoResizeMode() {
        String mode = choicePreference(PREFERENCE_VIDEO_FIT, "fit", "fit", "zoom", "stretch");
        if ("zoom".equals(mode)) return AspectRatioFrameLayout.RESIZE_MODE_ZOOM;
        if ("stretch".equals(mode)) return AspectRatioFrameLayout.RESIZE_MODE_FILL;
        return AspectRatioFrameLayout.RESIZE_MODE_FIT;
    }

    private void applyVideoResizeMode() {
        String mode = choicePreference(PREFERENCE_VIDEO_FIT, "fit", "fit", "zoom", "stretch");
        if (exoView != null) exoView.setResizeMode(exoResizeMode());
        if (vlcView != null) {
            float scale = "zoom".equals(mode) ? 1.12f : 1f;
            vlcView.setScaleX(scale);
            vlcView.setScaleY(scale);
        }
        if (vlcPlayer != null) {
            vlcPlayer.setScale(0f);
            vlcPlayer.setAspectRatio("stretch".equals(mode) ? "16:9" : null);
        }
    }

    private void showState(String message) {
        if (playerState == null) return;
        playerState.setText(message);
        playerState.setVisibility(View.VISIBLE);
    }

    private void notifyWeb(String method, String value) {
        if (catalogue == null) return;
        String quoted = org.json.JSONObject.quote(value == null ? "" : value);
        catalogue.evaluateJavascript(
                "window.GateNativeHooks&&window.GateNativeHooks." + method
                        + "&&window.GateNativeHooks." + method + "(" + quoted + ")",
                null
        );
    }

    private void releaseEngines() {
        if (vlcPlayer != null) {
            vlcPlayer.setEventListener(null);
            vlcPlayer.stop();
            vlcPlayer.detachViews();
            vlcPlayer.release();
            vlcPlayer = null;
        }
        if (libVlc != null) {
            libVlc.release();
            libVlc = null;
        }
        if (exoPlayer != null) {
            exoView.setPlayer(null);
            exoPlayer.stop();
            exoPlayer.release();
            exoPlayer = null;
        }
    }

    private void pauseEngines() {
        if (exoPlayer != null) exoPlayer.pause();
        if (vlcPlayer != null && vlcPlayer.isPlaying()) vlcPlayer.pause();
    }

    private void resumeEngines() {
        if (!nativePlaying || manuallyPaused || !activityResumed) return;
        if (!requestAudioFocus()) {
            pausedForAudioFocus = false;
            manuallyPaused = true;
            showState("Áudio indisponível  •  OK para tentar novamente");
            return;
        }
        pausedForAudioFocus = false;
        duckedForAudioFocus = false;
        setEngineVolume(false);
        resetWatchdogAfterResume();
        if (exoPlayer != null) {
            exoPlayer.setPlayWhenReady(true);
            exoPlayer.play();
        } else if (vlcPlayer != null) {
            vlcPlayer.play();
        }
    }

    private void resetWatchdogAfterResume() {
        long now = SystemClock.elapsedRealtime();
        lastProgressAt = now;
        stablePlaybackSince = playbackStarted ? now : 0L;
        if (!playbackStarted) attemptStartedAt = now;
        if (videoFramesSeen) lastRenderedFrameAt = now;
        bufferingSince = exoPlayer != null && exoPlaybackState == Player.STATE_BUFFERING
                ? now
                : 0L;
    }

    private void setEngineVolume(boolean ducked) {
        if (exoPlayer != null) exoPlayer.setVolume(ducked ? 0.2f : 1f);
        if (vlcPlayer != null) vlcPlayer.setVolume(ducked ? 20 : 100);
    }

    private void togglePlaybackFromRemote() {
        if (!nativePlaying) return;
        if (manuallyPaused) {
            manuallyPaused = false;
            showState("Retomando…");
            resumeEngines();
        } else {
            manuallyPaused = true;
            pauseEngines();
            showState("Pausado  •  OK para continuar");
        }
    }

    private void closeNativePlayer() {
        closeNativePlayer(true);
    }

    private void closeNativePlayer(boolean notifyCatalogue) {
        if (!nativePlaying && playerLayer != null
                && playerLayer.getVisibility() == View.GONE) return;
        playbackSessionId += 1L;
        scheduledTaskToken += 1L;
        invalidateActiveAttempt();
        nativePlaying = false;
        fullscreen = false;
        liveSession = false;
        playbackStarted = false;
        attemptHasPlayed = false;
        switchingAttempt = false;
        suspendedForBackground = false;
        pendingAttemptOnResume = false;
        manuallyPaused = false;
        pausedForAudioFocus = false;
        duckedForAudioFocus = false;
        currentRequest = null;
        activeAttempt = null;
        attempts.clear();
        releaseEngines();
        abandonAudioFocus();
        if (playerLayer != null) playerLayer.setVisibility(View.GONE);
        if (notifyCatalogue) notifyWeb("onClosed", "");
    }

    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (event.getRepeatCount() == 0 && nativePlaying) {
            if (keyCode == KeyEvent.KEYCODE_BACK) {
                if (fullscreen && previewBounds != null) {
                    fullscreen = false;
                    applyPreviewBounds();
                } else {
                    closeNativePlayer();
                }
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                    || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY
                    || keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE
                    || (fullscreen && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                    || keyCode == KeyEvent.KEYCODE_ENTER))) {
                togglePlaybackFromRemote();
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_MEDIA_STOP) {
                closeNativePlayer();
                return true;
            }
            if (fullscreen && (keyCode == KeyEvent.KEYCODE_DPAD_LEFT
                    || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT
                    || keyCode == KeyEvent.KEYCODE_DPAD_UP
                    || keyCode == KeyEvent.KEYCODE_DPAD_DOWN)) {
                // Do not move the hidden catalogue focus while video is fullscreen.
                return true;
            }
        }
        if (keyCode == KeyEvent.KEYCODE_PROG_GREEN) {
            catalogue.evaluateJavascript(
                    "document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',keyCode:184,which:184,bubbles:true}))",
                    null
            );
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            catalogue.evaluateJavascript(
                    "document.dispatchEvent(new KeyboardEvent('keydown',{key:'BrowserBack',keyCode:4,which:4,bubbles:true}))",
                    null
            );
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @SuppressWarnings("deprecation")
    private boolean requestAudioFocus() {
        if (audioManager == null) {
            hasAudioFocus = true;
            return true;
        }
        if (hasAudioFocus) return true;
        int result = audioManager.requestAudioFocus(
                audioFocusChangeListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
        );
        hasAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        return hasAudioFocus;
    }

    @SuppressWarnings("deprecation")
    private void abandonAudioFocus() {
        if (audioManager != null && hasAudioFocus) {
            audioManager.abandonAudioFocus(audioFocusChangeListener);
        }
        hasAudioFocus = false;
    }

    private final AudioManager.OnAudioFocusChangeListener audioFocusChangeListener = focusChange ->
            handler.post(() -> {
                if (!nativePlaying) return;
                if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
                    hasAudioFocus = true;
                    if (duckedForAudioFocus) {
                        duckedForAudioFocus = false;
                        setEngineVolume(false);
                    }
                    if (pausedForAudioFocus && !manuallyPaused) resumeEngines();
                } else if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                    hasAudioFocus = false;
                    duckedForAudioFocus = true;
                    setEngineVolume(true);
                } else if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                    hasAudioFocus = false;
                    duckedForAudioFocus = false;
                    setEngineVolume(false);
                    pausedForAudioFocus = !manuallyPaused;
                    pauseEngines();
                    if (!manuallyPaused) showState("Áudio interrompido temporariamente…");
                } else if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
                    // A permanent loss is not followed by AUDIOFOCUS_GAIN. Keep
                    // recovery under explicit user control instead of disabling
                    // the watchdog forever in pausedForAudioFocus.
                    hasAudioFocus = false;
                    duckedForAudioFocus = false;
                    setEngineVolume(false);
                    pausedForAudioFocus = false;
                    manuallyPaused = true;
                    pauseEngines();
                    showState("Áudio em uso por outro app  •  OK para retomar");
                }
            });

    private boolean isNetworkCurrentlyAvailable() {
        if (connectivityManager == null) return true;
        try {
            Network network = connectivityManager.getActiveNetwork();
            NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(network);
            return capabilities != null
                    && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (RuntimeException ignored) {
            return true;
        }
    }

    private void registerNetworkMonitor() {
        if (connectivityManager == null || networkCallbackRegistered) return;
        try {
            NetworkRequest request = new NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build();
            connectivityManager.registerNetworkCallback(request, networkCallback);
            networkCallbackRegistered = true;
        } catch (RuntimeException ignored) {
            networkCallbackRegistered = false;
        }
    }

    private final ConnectivityManager.NetworkCallback networkCallback =
            new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    handler.post(() -> {
                        boolean wasUnavailable = !networkAvailable;
                        networkAvailable = isNetworkCurrentlyAvailable();
                        if (wasUnavailable && networkAvailable && nativePlaying && activityResumed) {
                            showState("Internet restabelecida. Retomando o canal…");
                            sameEngineRecoveries = 0;
                            attemptHasPlayed = false;
                            switchingAttempt = false;
                            resumePendingAttempt(true);
                        }
                    });
                }

                @Override
                public void onLost(Network network) {
                    handler.postDelayed(() -> {
                        networkAvailable = isNetworkCurrentlyAvailable();
                        if (!networkAvailable && nativePlaying) {
                            showState("Sem internet. O canal será retomado automaticamente.");
                        }
                    }, 300L);
                }
            };

    @Override
    protected void onPause() {
        activityResumed = false;
        handler.removeCallbacks(backgroundRelease);
        if (nativePlaying && !manuallyPaused) {
            pauseEngines();
            pausedForAudioFocus = true;
        }
        abandonAudioFocus();
        if (catalogue != null) catalogue.onPause();
        handler.postDelayed(backgroundRelease, BACKGROUND_RELEASE_DELAY_MS);
        super.onPause();
    }

    private final Runnable backgroundRelease = () -> {
        if (!activityResumed && nativePlaying) {
            invalidateActiveAttempt();
            releaseEngines();
            suspendedForBackground = true;
        }
    };

    @Override
    protected void onResume() {
        super.onResume();
        activityResumed = true;
        handler.removeCallbacks(backgroundRelease);
        enterImmersiveMode();
        if (catalogue != null) catalogue.onResume();
        if (!nativePlaying) return;

        pausedForAudioFocus = false;
        requestAudioFocus();
        if (suspendedForBackground || pendingAttemptOnResume
                || (exoPlayer == null && vlcPlayer == null)) {
            suspendedForBackground = false;
            pendingAttemptOnResume = false;
            resumePendingAttempt(true);
        } else if (!manuallyPaused) {
            resumeEngines();
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (connectivityManager != null && networkCallbackRegistered) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
                // The system can unregister it first while the process exits.
            }
            networkCallbackRegistered = false;
        }
        closeNativePlayer(false);
        if (catalogue != null) {
            catalogue.removeJavascriptInterface("GateNativePlayer");
            catalogue.destroy();
            catalogue = null;
        }
        super.onDestroy();
    }
}
