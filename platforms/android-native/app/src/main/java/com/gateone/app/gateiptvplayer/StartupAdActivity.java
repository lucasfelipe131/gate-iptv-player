package com.gateone.app.gateiptvplayer;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.VideoView;

import com.google.ads.interactivemedia.v3.api.AdEvent;
import com.google.ads.interactivemedia.v3.api.AdsLoader;
import com.google.ads.interactivemedia.v3.api.AdsManager;
import com.google.ads.interactivemedia.v3.api.AdsRenderingSettings;
import com.google.ads.interactivemedia.v3.api.AdsRequest;
import com.google.ads.interactivemedia.v3.api.ImaSdkFactory;
import com.google.ads.interactivemedia.v3.api.ImaSdkSettings;
import com.google.ads.interactivemedia.v3.api.player.VideoProgressUpdate;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Cold-start gate for Android and Google TV.
 *
 * The real VAST tag is read from the hosted /api/config endpoint. A missing tag,
 * no-fill, SDK error or timeout always opens MainActivity instead of blocking
 * the television. The web shell skips its own ad for Android wrappers so the
 * same launch never produces two ads.
 */
public final class StartupAdActivity extends Activity {
    private static final String APP_VERSION = "0.6.5";
    private static final String CONFIG_URL =
            "https://gate-iptv-player-production.up.railway.app/api/config"
                    + "?platform=androidtv&appVersion=" + APP_VERSION;
    private static final String MONETIZATION_PREFERENCES = "gate_monetization";
    private static final String PREFERENCE_LAST_AD_STARTED_AT = "last_startup_ad_started_at";
    private static final String PREFERENCE_AD_FREE = "ad_free";

    // One paid opening ad at most every four hours on the same TV.
    private static final long MIN_AD_INTERVAL_MS = 4L * 60L * 60L * 1000L;
    private static final long CONFIG_FAIL_SAFE_MS = 5_500L;
    private static final int MAX_CONFIG_BYTES = 64 * 1024;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService configExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean mainOpened = new AtomicBoolean(false);

    private FrameLayout adRoot;
    private VideoView adVideo;
    private TextView loadingMessage;

    private ImaSdkFactory sdkFactory;
    private ImaSdkSettings sdkSettings;
    private AdsLoader adsLoader;
    private AdsManager adsManager;
    private StartupAdPlayerAdapter adPlayer;
    private boolean adStarted;
    private boolean iconFallbackShowing;

    private final Runnable configFailSafe = this::openMainActivity;
    private final Runnable adFailSafe = this::openMainActivity;

    private static final class AdConfiguration {
        final String vastTagUrl;
        final int loadTimeoutMs;
        final int maxPlaybackSeconds;

        AdConfiguration(String vastTagUrl, int loadTimeoutMs, int maxPlaybackSeconds) {
            this.vastTagUrl = vastTagUrl;
            this.loadTimeoutMs = loadTimeoutMs;
            this.maxPlaybackSeconds = maxPlaybackSeconds;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersiveMode();
        createAdUi();

        SharedPreferences preferences =
                getSharedPreferences(MONETIZATION_PREFERENCES, MODE_PRIVATE);
        long lastStartedAt = preferences.getLong(PREFERENCE_LAST_AD_STARTED_AT, 0L);
        boolean recentlyShown = lastStartedAt > 0L
                && System.currentTimeMillis() - lastStartedAt < MIN_AD_INTERVAL_MS;
        if (preferences.getBoolean(PREFERENCE_AD_FREE, false) || recentlyShown) {
            openMainActivity();
            return;
        }

        initializeIma();
        handler.postDelayed(configFailSafe, CONFIG_FAIL_SAFE_MS);
        configExecutor.execute(() -> {
            AdConfiguration configuration = downloadConfiguration();
            handler.post(() -> {
                if (mainOpened.get()) return;
                if (configuration == null) {
                    openMainActivity();
                    return;
                }
                requestOpeningAd(configuration);
            });
        });
    }

    private void createAdUi() {
        adRoot = new FrameLayout(this);
        adRoot.setBackgroundColor(Color.BLACK);
        adRoot.setFocusable(true);
        adRoot.setFocusableInTouchMode(true);

        adVideo = new VideoView(this);
        adVideo.setBackgroundColor(Color.BLACK);
        adRoot.addView(adVideo, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        loadingMessage = new TextView(this);
        loadingMessage.setText("GATE TV\nPreparando publicidade…");
        loadingMessage.setTextColor(Color.WHITE);
        loadingMessage.setTextSize(20f);
        loadingMessage.setGravity(Gravity.CENTER);
        loadingMessage.setLineSpacing(8f, 1f);
        loadingMessage.setContentDescription("Preparando publicidade");
        adRoot.addView(loadingMessage, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        setContentView(adRoot);
    }

    private void initializeIma() {
        sdkFactory = ImaSdkFactory.getInstance();
        sdkFactory.initialize(this, getSdkSettings());

        AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        adPlayer = new StartupAdPlayerAdapter(adVideo, audioManager);
        adsLoader = sdkFactory.createAdsLoader(
                this,
                getSdkSettings(),
                ImaSdkFactory.createAdDisplayContainer(adRoot, adPlayer)
        );

        adsLoader.addAdErrorListener(event -> openMainActivity());
        adsLoader.addAdsLoadedListener(event -> {
            if (mainOpened.get()) return;
            adsManager = event.getAdsManager();
            adsManager.addAdErrorListener(error -> openMainActivity());
            adsManager.addAdEventListener(this::handleAdEvent);

            AdsRenderingSettings renderingSettings = sdkFactory.createAdsRenderingSettings();
            renderingSettings.setEnablePreloading(false);
            renderingSettings.setFocusSkipButtonWhenAvailable(true);
            adsManager.init(renderingSettings);
        });
    }

    private ImaSdkSettings getSdkSettings() {
        if (sdkSettings == null) {
            sdkSettings = ImaSdkFactory.getInstance().createImaSdkSettings();
            sdkSettings.setLanguage("pt_br");
        }
        return sdkSettings;
    }

    private void requestOpeningAd(AdConfiguration configuration) {
        handler.removeCallbacks(configFailSafe);
        long maximumWaitMs = configuration.loadTimeoutMs
                + configuration.maxPlaybackSeconds * 1_000L
                + 2_000L;
        handler.postDelayed(adFailSafe, Math.min(60_000L, Math.max(8_000L, maximumWaitMs)));

        AdsRequest request = sdkFactory.createAdsRequest();
        request.setAdTagUrl(configuration.vastTagUrl);
        request.setContentProgressProvider(() -> VideoProgressUpdate.VIDEO_TIME_NOT_READY);
        adsLoader.requestAds(request);
    }

    private void handleAdEvent(AdEvent event) {
        if (mainOpened.get()) return;
        switch (event.getType()) {
            case LOADED -> {
                try { adsManager.start(); }
                catch (RuntimeException ignored) { openMainActivity(); }
            }
            case STARTED -> {
                adStarted = true;
                getSharedPreferences(MONETIZATION_PREFERENCES, MODE_PRIVATE)
                        .edit()
                        .putLong(PREFERENCE_LAST_AD_STARTED_AT, System.currentTimeMillis())
                        .apply();
                if (loadingMessage != null) loadingMessage.setVisibility(View.GONE);
                adRoot.requestFocus();
            }
            case ICON_TAPPED -> {
                iconFallbackShowing = true;
                try { adsManager.pause(); } catch (RuntimeException ignored) {}
            }
            case ICON_FALLBACK_IMAGE_CLOSED -> {
                if (!iconFallbackShowing) return;
                iconFallbackShowing = false;
                try { adsManager.resume(); } catch (RuntimeException ignored) {}
            }
            case SKIPPED, ALL_ADS_COMPLETED, CONTENT_RESUME_REQUESTED -> openMainActivity();
            default -> {
                // IMA handles quartiles, viewability and skip-button rendering.
            }
        }
    }

    private AdConfiguration downloadConfiguration() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(CONFIG_URL).openConnection();
            connection.setConnectTimeout(2_500);
            connection.setReadTimeout(2_500);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "GATE-TV-NATIVE/" + APP_VERSION);
            connection.setUseCaches(false);

            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) return null;
            String body;
            try (InputStream input = connection.getInputStream()) {
                body = readUtf8(input);
            }

            JSONObject ads = new JSONObject(body).optJSONObject("ads");
            if (ads == null || !ads.optBoolean("enabled", false)) return null;
            String tag = ads.optString("vastAdTagUrl", "").trim();
            if (!isSafeVastTag(tag)) return null;

            int loadTimeoutMs = clamp(ads.optInt("loadTimeoutMs", 7_000), 1_000, 10_000);
            int maxPlaybackSeconds =
                    clamp(ads.optInt("maxPlaybackSeconds", 45), 5, 45);
            return new AdConfiguration(tag, loadTimeoutMs, maxPlaybackSeconds);
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static boolean isSafeVastTag(String value) {
        if (value == null || value.isEmpty() || value.length() > 8_192) return false;
        Uri uri = Uri.parse(value);
        return "https".equalsIgnoreCase(uri.getScheme())
                && uri.getHost() != null
                && !uri.getHost().isEmpty()
                && uri.getUserInfo() == null;
    }

    private static String readUtf8(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4_096];
        int total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > MAX_CONFIG_BYTES) throw new IllegalStateException("Configuração grande demais.");
            output.write(buffer, 0, count);
        }
        return output.toString(StandardCharsets.UTF_8.name());
    }

    private static int clamp(int value, int minimum, int maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private void openMainActivity() {
        if (!mainOpened.compareAndSet(false, true)) return;
        handler.removeCallbacks(configFailSafe);
        handler.removeCallbacks(adFailSafe);
        configExecutor.shutdownNow();
        releaseAdResources();

        Intent intent = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        overridePendingTransition(0, 0);
        finish();
    }

    private void releaseAdResources() {
        if (adsManager != null) {
            try { adsManager.destroy(); } catch (RuntimeException ignored) {}
            adsManager = null;
        }
        if (adPlayer != null) {
            adPlayer.release();
            adPlayer = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (!adStarted) openMainActivity();
        // During a playing ad the IMA UI owns TV focus and exposes Skip when allowed.
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(configFailSafe);
        handler.removeCallbacks(adFailSafe);
        configExecutor.shutdownNow();
        if (!mainOpened.get()) releaseAdResources();
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersiveMode();
    }

    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }
}
