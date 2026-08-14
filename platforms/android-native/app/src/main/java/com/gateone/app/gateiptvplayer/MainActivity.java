package com.gateone.app.gateiptvplayer;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.UiModeManager;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.KeyEvent;
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
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.ui.PlayerView;

import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

import java.util.ArrayList;
import java.util.List;

/**
 * GATE TV native shell.
 *
 * The catalogue remains web based, while video is decoded natively. LibVLC is
 * the primary engine for broad IPTV codec support. Media3/ExoPlayer is an
 * automatic fallback for streams that are better handled by Android codecs.
 */
@OptIn(markerClass = UnstableApi.class)
public final class MainActivity extends Activity {
    private static final String HOME = "https://gate-iptv-player-production.up.railway.app/";
    private static final String USER_AGENT = "GATE-TV-NATIVE/0.5.3";
    private static final long START_TIMEOUT_MS = 22_000L;
    private static final long STALL_TIMEOUT_MS = 20_000L;
    private static final int MAX_RETRY_ROUNDS = 2;

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
    private Rect previewBounds;
    private boolean nativePlaying;
    private boolean fullscreen;
    private boolean playbackStarted;
    private int attemptIndex;
    private int retryRound;
    private long lastProgressAt;
    private long lastExoPosition = -1L;
    private boolean switchingAttempt;

    private static final class PlaybackAttempt {
        final boolean useVlc;
        final String url;
        final String streamType;
        final int networkCacheMs;

        PlaybackAttempt(boolean useVlc, String url, String streamType, int networkCacheMs) {
            this.useVlc = useVlc;
            this.url = url;
            this.streamType = streamType;
            this.networkCacheMs = networkCacheMs;
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersiveMode();

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
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " GATE-IPTV-PLAYER/0.5.3");
        catalogue.setWebChromeClient(new WebChromeClient());
        catalogue.setWebViewClient(new WebViewClient());
        catalogue.addJavascriptInterface(new PlayerBridge(), "GateNativePlayer");
        root.addView(catalogue, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        playerLayer = new FrameLayout(this);
        playerLayer.setBackgroundColor(Color.BLACK);
        playerLayer.setClickable(false);
        playerLayer.setFocusable(false);

        vlcView = new VLCVideoLayout(this);
        playerLayer.addView(vlcView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        exoView = new PlayerView(this);
        exoView.setUseController(false);
        exoView.setKeepContentOnPlayerReset(true);
        exoView.setShutterBackgroundColor(Color.BLACK);
        exoView.setVisibility(View.GONE);
        playerLayer.addView(exoView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        playerState = new TextView(this);
        playerState.setTextColor(Color.WHITE);
        playerState.setTextSize(16);
        playerState.setPadding(26, 20, 26, 20);
        playerState.setBackgroundColor(0x99000000);
        playerLayer.addView(playerState, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        playerLayer.setVisibility(View.GONE);
        root.addView(playerLayer, new FrameLayout.LayoutParams(1, 1));

        setContentView(root);
        catalogue.loadUrl(HOME + (isTelevision() ? "?platform=androidtv" : "?platform=android"));
        handler.post(watchdog);
    }

    private boolean isTelevision() {
        UiModeManager manager = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
        return manager != null && manager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
    }

    private final class PlayerBridge {
        @JavascriptInterface
        public void preview(String url, String fallbackUrl, String name, String streamType,
                            int x, int y, int width, int height) {
            runOnUiThread(() -> {
                previewBounds = new Rect(x, y, x + Math.max(1, width), y + Math.max(1, height));
                fullscreen = false;
                startPlayback(url, fallbackUrl, streamType);
                applyPreviewBounds();
            });
        }

        @JavascriptInterface
        public void playFullscreen(String url, String fallbackUrl, String name, String streamType) {
            runOnUiThread(() -> {
                previewBounds = null;
                fullscreen = true;
                startPlayback(url, fallbackUrl, streamType);
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
    }

    private void startPlayback(String primaryUrl, String fallbackUrl, String streamType) {
        releaseEngines();
        attempts.clear();
        addAttempts(primaryUrl, streamType);
        if (fallbackUrl != null && !fallbackUrl.isBlank() && !fallbackUrl.equals(primaryUrl)) {
            addAttempts(fallbackUrl, "mpegts".equalsIgnoreCase(streamType) ? streamType : "mpegts");
        }
        attemptIndex = 0;
        retryRound = 0;
        nativePlaying = true;
        playbackStarted = false;
        switchingAttempt = false;
        lastProgressAt = SystemClock.elapsedRealtime();
        playerLayer.setVisibility(View.VISIBLE);
        startAttempt();
    }

    private void addAttempts(String url, String streamType) {
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) return;
        if ("hls".equalsIgnoreCase(streamType)) {
            attempts.add(new PlaybackAttempt(false, url, streamType, 0));
            attempts.add(new PlaybackAttempt(true, url, streamType, 2_500));
            attempts.add(new PlaybackAttempt(true, url, streamType, 5_000));
        } else {
            attempts.add(new PlaybackAttempt(true, url, streamType, 2_500));
            attempts.add(new PlaybackAttempt(true, url, streamType, 5_000));
            attempts.add(new PlaybackAttempt(false, url, streamType, 0));
        }
    }

    private void startAttempt() {
        if (!nativePlaying) return;
        if (attemptIndex >= attempts.size()) {
            if (retryRound < MAX_RETRY_ROUNDS) {
                retryRound += 1;
                attemptIndex = 0;
                showState("Reconectando a fonte…");
                handler.postDelayed(this::startAttempt, 1_500L * retryRound);
                return;
            } else {
                showState("O canal não respondeu nos motores VLC e Media3.");
                notifyWeb("onError", "Não foi possível estabilizar este canal. Tente outro canal ou verifique a origem da lista.");
                return;
            }
        }
        PlaybackAttempt attempt = attempts.get(attemptIndex);
        switchingAttempt = false;
        playbackStarted = false;
        lastExoPosition = -1L;
        lastProgressAt = SystemClock.elapsedRealtime();
        showState(attemptIndex == 0 ? "Conectando…" : "Ajustando motor e rota…");
        if (attempt.useVlc) startVlc(attempt); else startExoPlayer(attempt);
    }

    private void startVlc(PlaybackAttempt attempt) {
        releaseEngines();
        exoView.setVisibility(View.GONE);
        vlcView.setVisibility(View.VISIBLE);

        ArrayList<String> options = new ArrayList<>();
        options.add("--network-caching=" + attempt.networkCacheMs);
        options.add("--live-caching=" + attempt.networkCacheMs);
        options.add("--file-caching=1000");
        options.add("--http-reconnect");
        options.add("--http-user-agent=" + USER_AGENT);
        options.add("--avcodec-hw=any");
        options.add("--drop-late-frames");
        options.add("--skip-frames");
        options.add("--audio-time-stretch");

        libVlc = new LibVLC(this, options);
        vlcPlayer = new MediaPlayer(libVlc);
        vlcPlayer.attachViews(vlcView, null, false, false);
        Media media = new Media(libVlc, Uri.parse(attempt.url));
        media.addOption(":network-caching=" + attempt.networkCacheMs);
        media.addOption(":http-reconnect");
        media.addOption(":http-user-agent=" + USER_AGENT);
        vlcPlayer.setMedia(media);
        media.release();
        vlcPlayer.setEventListener(event -> {
            if (!nativePlaying) return;
            if (event.type == MediaPlayer.Event.Playing) {
                runOnUiThread(() -> markPlaying("LibVLC"));
            } else if (event.type == MediaPlayer.Event.TimeChanged || event.type == MediaPlayer.Event.PositionChanged) {
                lastProgressAt = SystemClock.elapsedRealtime();
            } else if (event.type == MediaPlayer.Event.Buffering) {
                runOnUiThread(() -> {
                    if (playbackStarted) showState("Sinal oscilando. Recuperando…");
                });
            } else if (event.type == MediaPlayer.Event.EncounteredError) {
                runOnUiThread(MainActivity.this::tryNextAttempt);
            } else if (event.type == MediaPlayer.Event.EndReached) {
                runOnUiThread(MainActivity.this::tryNextAttempt);
            }
        });
        vlcPlayer.play();
    }

    private void startExoPlayer(PlaybackAttempt attempt) {
        releaseEngines();
        vlcView.setVisibility(View.GONE);
        exoView.setVisibility(View.VISIBLE);

        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent(USER_AGENT)
                .setConnectTimeoutMs(15_000)
                .setReadTimeoutMs(25_000)
                .setAllowCrossProtocolRedirects(true);
        DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(this, httpFactory);
        DefaultExtractorsFactory extractorsFactory = new DefaultExtractorsFactory()
                .setTsExtractorFlags(
                        DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS
                                | DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES);
        DefaultMediaSourceFactory sourceFactory = new DefaultMediaSourceFactory(this, extractorsFactory)
                .setDataSourceFactory(dataSourceFactory);
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(5_000, 45_000, 1_500, 3_000)
                .setPrioritizeTimeOverSizeThresholds(true)
                .build();

        exoPlayer = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(sourceFactory)
                .setLoadControl(loadControl)
                .build();
        exoView.setPlayer(exoPlayer);
        exoPlayer.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_READY && exoPlayer != null && exoPlayer.getPlayWhenReady()) {
                    markPlaying("Media3");
                } else if (playbackState == Player.STATE_BUFFERING && playbackStarted) {
                    showState("Sinal oscilando. Recuperando…");
                } else if (playbackState == Player.STATE_ENDED) {
                    tryNextAttempt();
                }
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) markPlaying("Media3");
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                tryNextAttempt();
            }
        });
        MediaItem.Builder mediaBuilder = new MediaItem.Builder().setUri(attempt.url);
        if ("hls".equalsIgnoreCase(attempt.streamType)) mediaBuilder.setMimeType(MimeTypes.APPLICATION_M3U8);
        else if ("mpegts".equalsIgnoreCase(attempt.streamType)) mediaBuilder.setMimeType("video/mp2t");
        exoPlayer.setMediaItem(mediaBuilder.build());
        exoPlayer.prepare();
        exoPlayer.play();
    }

    private void markPlaying(String engine) {
        playbackStarted = true;
        lastProgressAt = SystemClock.elapsedRealtime();
        playerState.setVisibility(View.GONE);
        notifyWeb("onEngine", engine);
    }

    private void tryNextAttempt() {
        if (!nativePlaying || switchingAttempt) return;
        switchingAttempt = true;
        attemptIndex += 1;
        handler.postDelayed(this::startAttempt, 350);
    }

    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            if (nativePlaying) {
                long now = SystemClock.elapsedRealtime();
                if (!playbackStarted && now - lastProgressAt > START_TIMEOUT_MS) {
                    tryNextAttempt();
                    lastProgressAt = now;
                } else if (playbackStarted && exoPlayer != null && exoPlayer.isPlaying()) {
                    long position = exoPlayer.getCurrentPosition();
                    if (lastExoPosition < 0L || position > lastExoPosition + 150L) {
                        lastExoPosition = position;
                        lastProgressAt = now;
                    } else if (now - lastProgressAt > STALL_TIMEOUT_MS) {
                        tryNextAttempt();
                        lastProgressAt = now;
                    }
                } else if (playbackStarted && now - lastProgressAt > STALL_TIMEOUT_MS) {
                    tryNextAttempt();
                    lastProgressAt = now;
                }
            }
            handler.postDelayed(this, 2_500L);
        }
    };

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
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        );
        params.leftMargin = 0;
        params.topMargin = 0;
        playerLayer.setLayoutParams(params);
        playerLayer.setVisibility(View.VISIBLE);
    }

    private void showState(String message) {
        playerState.setText(message);
        playerState.setVisibility(View.VISIBLE);
    }

    private void notifyWeb(String method, String value) {
        if (catalogue == null) return;
        String quoted = org.json.JSONObject.quote(value == null ? "" : value);
        catalogue.evaluateJavascript("window.GateNativeHooks&&window.GateNativeHooks." + method + "&&window.GateNativeHooks." + method + "(" + quoted + ")", null);
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
            exoPlayer.stop();
            exoPlayer.release();
            exoPlayer = null;
            exoView.setPlayer(null);
        }
    }

    private void closeNativePlayer() {
        if (!nativePlaying && playerLayer.getVisibility() == View.GONE) return;
        nativePlaying = false;
        fullscreen = false;
        playbackStarted = false;
        attempts.clear();
        releaseEngines();
        playerLayer.setVisibility(View.GONE);
        notifyWeb("onClosed", "");
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
        if (keyCode == KeyEvent.KEYCODE_BACK && nativePlaying) {
            if (fullscreen && previewBounds != null) {
                fullscreen = false;
                applyPreviewBounds();
            } else {
                closeNativePlayer();
            }
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_PROG_GREEN) {
            catalogue.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',keyCode:184,which:184,bubbles:true}))", null);
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            catalogue.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'BrowserBack',keyCode:4,which:4,bubbles:true}))", null);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        if (nativePlaying) closeNativePlayer();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        closeNativePlayer();
        if (catalogue != null) catalogue.destroy();
        super.onDestroy();
    }
}
