package com.gateone.app.gateiptvplayer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Opens GATE TV after a full Android TV boot when the user enables the option. */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        boolean bootAction = Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action);
        if (!bootAction) return;

        boolean enabled = context.getSharedPreferences(
                        MainActivity.PREFERENCES,
                        Context.MODE_PRIVATE
                )
                .getBoolean(MainActivity.PREFERENCE_AUTO_START, false);
        if (!enabled) return;

        Intent launch = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try {
            context.startActivity(launch);
        } catch (RuntimeException ignored) {
            // Some TV manufacturers block background activity launches.
        }
    }
}
