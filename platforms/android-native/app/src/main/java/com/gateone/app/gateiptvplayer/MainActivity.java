package com.gateone.app.gateiptvplayer;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

import java.util.ArrayList;

/** Native VLC overlay for MPEG-TS/HLS streams.  The GATE catalogue stays in WebView. */
public final class MainActivity extends Activity {
    private static final String HOME = "https://gate-iptv-player-production.up.railway.app/";
    private WebView catalogue;
    private FrameLayout playerLayer;
    private VLCVideoLayout videoLayout;
    private TextView state;
    private LibVLC vlc;
    private MediaPlayer mediaPlayer;
    private boolean nativePlaying;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        FrameLayout root = new FrameLayout(this);
        catalogue = new WebView(this);
        catalogue.setBackgroundColor(Color.rgb(5, 14, 29));
        catalogue.getSettings().setJavaScriptEnabled(true);
        catalogue.getSettings().setDomStorageEnabled(true);
        catalogue.getSettings().setMediaPlaybackRequiresUserGesture(false);
        catalogue.setWebChromeClient(new WebChromeClient());
        catalogue.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) { installNativeBridge(); }
        });
        catalogue.addJavascriptInterface(new PlayerBridge(), "GateNativePlayer");
        root.addView(catalogue, new FrameLayout.LayoutParams(-1, -1));

        playerLayer = new FrameLayout(this);
        playerLayer.setBackgroundColor(Color.BLACK);
        videoLayout = new VLCVideoLayout(this);
        playerLayer.addView(videoLayout, new FrameLayout.LayoutParams(-1, -1));
        state = new TextView(this);
        state.setTextColor(Color.WHITE); state.setTextSize(18); state.setPadding(32, 28, 32, 28);
        playerLayer.addView(state, new FrameLayout.LayoutParams(-2, -2));
        playerLayer.setVisibility(View.GONE);
        root.addView(playerLayer, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        catalogue.loadUrl(HOME);
    }

    private void installNativeBridge() {
        String script = "javascript:(function(){if(window.__gateNativeVlc)return;window.__gateNativeVlc=1;" +
                "document.addEventListener('play',function(e){var v=e.target;if(v&&v.tagName==='VIDEO'&&v.currentSrc){" +
                "try{window.GateNativePlayer.play(v.currentSrc);v.pause();}catch(x){}}},true);})();";
        catalogue.evaluateJavascript(script, null);
    }

    private final class PlayerBridge {
        @JavascriptInterface public void play(final String url) { runOnUiThread(() -> startVlc(url)); }
        @JavascriptInterface public void close() { runOnUiThread(MainActivity.this::closeVlc); }
    }

    private void startVlc(String url) {
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) return;
        closeVlc();
        ArrayList<String> options = new ArrayList<>();
        options.add("--network-caching=1800");
        options.add("--live-caching=2200");
        options.add("--file-caching=1200");
        options.add("--http-reconnect");
        options.add("--avcodec-hw=any");
        options.add("--drop-late-frames");
        options.add("--skip-frames");
        vlc = new LibVLC(this, options);
        mediaPlayer = new MediaPlayer(vlc);
        mediaPlayer.attachViews(videoLayout, null, false, false);
        Media media = new Media(vlc, android.net.Uri.parse(url));
        media.addOption(":network-caching=1800");
        media.addOption(":http-reconnect");
        mediaPlayer.setMedia(media); media.release();
        mediaPlayer.setEventListener(event -> {
            if (event.type == MediaPlayer.Event.Playing) runOnUiThread(() -> state.setText(""));
            if (event.type == MediaPlayer.Event.EncounteredError) runOnUiThread(() -> state.setText("Reconectando ao canal…"));
        });
        state.setText("Conectando…");
        playerLayer.setVisibility(View.VISIBLE);
        nativePlaying = true;
        mediaPlayer.play();
    }

    private void closeVlc() {
        nativePlaying = false;
        playerLayer.setVisibility(View.GONE);
        if (mediaPlayer != null) { mediaPlayer.stop(); mediaPlayer.detachViews(); mediaPlayer.release(); mediaPlayer = null; }
        if (vlc != null) { vlc.release(); vlc = null; }
    }

    @Override public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && nativePlaying) { closeVlc(); return true; }
        return super.onKeyDown(keyCode, event);
    }
    @Override protected void onDestroy() { closeVlc(); catalogue.destroy(); super.onDestroy(); }
}
