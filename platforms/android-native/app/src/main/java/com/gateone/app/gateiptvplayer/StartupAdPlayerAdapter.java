package com.gateone.app.gateiptvplayer;

import android.media.AudioManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.widget.VideoView;

import com.google.ads.interactivemedia.v3.api.AdPodInfo;
import com.google.ads.interactivemedia.v3.api.player.AdMediaInfo;
import com.google.ads.interactivemedia.v3.api.player.VideoAdPlayer;
import com.google.ads.interactivemedia.v3.api.player.VideoProgressUpdate;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Minimal VideoView adapter used only by the native opening-ad Activity.
 *
 * Preloading stays disabled, so a single AdMediaInfo can be tracked safely.
 */
final class StartupAdPlayerAdapter implements VideoAdPlayer {
    private static final long PROGRESS_INTERVAL_MS = 250L;

    private final VideoView videoView;
    private final AudioManager audioManager;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<VideoAdPlayerCallback> callbacks = new CopyOnWriteArrayList<>();

    private AdMediaInfo loadedAd;
    private int adDurationMs;
    private int savedPositionMs;
    private boolean trackingProgress;

    private final Runnable progressTick = new Runnable() {
        @Override
        public void run() {
            if (!trackingProgress) return;
            VideoProgressUpdate progress = getAdProgress();
            for (VideoAdPlayerCallback callback : callbacks) {
                callback.onAdProgress(loadedAd, progress);
            }
            handler.postDelayed(this, PROGRESS_INTERVAL_MS);
        }
    };

    StartupAdPlayerAdapter(VideoView videoView, AudioManager audioManager) {
        this.videoView = videoView;
        this.audioManager = audioManager;
    }

    @Override
    public void addCallback(VideoAdPlayerCallback callback) {
        if (callback != null) callbacks.add(callback);
    }

    @Override
    public void loadAd(AdMediaInfo adMediaInfo, AdPodInfo adPodInfo) {
        loadedAd = adMediaInfo;
    }

    @Override
    public void pauseAd(AdMediaInfo adMediaInfo) {
        savedPositionMs = Math.max(0, videoView.getCurrentPosition());
        try { videoView.pause(); } catch (RuntimeException ignored) {}
        stopProgressTracking();
    }

    @Override
    public void playAd(AdMediaInfo adMediaInfo) {
        loadedAd = adMediaInfo;
        videoView.setVideoURI(Uri.parse(adMediaInfo.getUrl()));
        videoView.setOnPreparedListener(mediaPlayer -> {
            adDurationMs = Math.max(0, mediaPlayer.getDuration());
            if (savedPositionMs > 0) mediaPlayer.seekTo(savedPositionMs);
            mediaPlayer.start();
            startProgressTracking();
        });
        videoView.setOnErrorListener((mediaPlayer, what, extra) -> {
            stopProgressTracking();
            for (VideoAdPlayerCallback callback : callbacks) callback.onError(loadedAd);
            return true;
        });
        videoView.setOnCompletionListener(mediaPlayer -> {
            savedPositionMs = 0;
            stopProgressTracking();
            for (VideoAdPlayerCallback callback : callbacks) callback.onEnded(loadedAd);
        });
    }

    @Override
    public void release() {
        stopProgressTracking();
        try { videoView.stopPlayback(); } catch (RuntimeException ignored) {}
        callbacks.clear();
        loadedAd = null;
    }

    @Override
    public void removeCallback(VideoAdPlayerCallback callback) {
        callbacks.remove(callback);
    }

    @Override
    public void stopAd(AdMediaInfo adMediaInfo) {
        savedPositionMs = 0;
        stopProgressTracking();
        try { videoView.stopPlayback(); } catch (RuntimeException ignored) {}
    }

    @Override
    public int getVolume() {
        if (audioManager == null) return 100;
        int maximum = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        if (maximum <= 0) return 0;
        int current = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
        return Math.max(0, Math.min(100, Math.round((current * 100f) / maximum)));
    }

    @Override
    public VideoProgressUpdate getAdProgress() {
        if (loadedAd == null || adDurationMs <= 0) return VideoProgressUpdate.VIDEO_TIME_NOT_READY;
        return new VideoProgressUpdate(
                Math.max(0, videoView.getCurrentPosition()),
                adDurationMs
        );
    }

    private void startProgressTracking() {
        stopProgressTracking();
        trackingProgress = true;
        handler.post(progressTick);
    }

    private void stopProgressTracking() {
        trackingProgress = false;
        handler.removeCallbacks(progressTick);
    }
}
