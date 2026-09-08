package com.faceclaw.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import org.json.JSONArray;

/** App-owned silent notifications. Unique string tags avoid hash collisions. */
public final class FaceclawT3Notifications {
    private static final String CHANNEL = "t3-agent-events";
    private static final String PREFIX = "t3:";
    private static final String SIGNING_ALIAS = "faceclaw-t3-notification-launch";
    private static final java.util.LinkedHashMap<String, Long> consumed = new java.util.LinkedHashMap<>();
    private static byte[] sign(String payload) throws Exception {
        java.security.KeyStore keys = java.security.KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        if (!keys.containsAlias(SIGNING_ALIAS)) {
            javax.crypto.KeyGenerator generator = javax.crypto.KeyGenerator.getInstance(android.security.keystore.KeyProperties.KEY_ALGORITHM_HMAC_SHA256, "AndroidKeyStore");
            generator.init(new android.security.keystore.KeyGenParameterSpec.Builder(SIGNING_ALIAS,
                android.security.keystore.KeyProperties.PURPOSE_SIGN | android.security.keystore.KeyProperties.PURPOSE_VERIFY).build());
            generator.generateKey();
        }
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256"); mac.init(keys.getKey(SIGNING_ALIAS, null));
        return mac.doFinal(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    private static String pairingIdentity(Context context) throws Exception {
        String fingerprint = FaceclawT3Secrets.fingerprint(FaceclawT3Secrets.read(context));
        org.json.JSONObject settings = new org.json.JSONObject(FaceclawSettings.getInstance(context).getString("t3.config", "{}"));
        if (fingerprint.isEmpty()) throw new IllegalStateException("T3_NOT_PAIRED");
        return new JSONArray().put(settings.optString("bridgeUrl", "ws://10.0.2.2:8787")).put(fingerprint).toString();
    }
    private static String launchPayload(Context context, String threadId, String nonce, long issuedAt, String pairing) {
        return new JSONArray().put(context.getPackageName()).put(pairing).put(threadId).put(nonce).put(issuedAt).toString();
    }
    /** Only authenticated app-issued notifications may select a thread through the exported launcher. */
    public static synchronized String consumeThread(Context context, Intent intent) {
        try {
            if (intent == null || intent.getComponent() == null || !context.getPackageName().equals(intent.getComponent().getPackageName())) return "";
            String thread = intent.getStringExtra("t3.threadId");
            String nonce = intent.getStringExtra("t3.launchNonce");
            String signature = intent.getStringExtra("t3.launchSignature");
            String pairing = intent.getStringExtra("t3.launchPairing");
            if (pairing == null || !pairing.equals(pairingIdentity(context))) return "";
            long issuedAt = intent.getLongExtra("t3.launchIssuedAt", 0);
            long now = System.currentTimeMillis();
            if (thread == null || thread.isEmpty() || thread.length() > 256 || nonce == null || nonce.length() > 64 || signature == null || signature.length() > 128 || issuedAt > now + 5000 || now - issuedAt > 7L * 86400000) return "";
            String expectedData = "faceclaw-t3://thread/" + android.net.Uri.encode(thread);
            if (!expectedData.equals(intent.getDataString())) return "";
            byte[] actual = android.util.Base64.decode(signature, android.util.Base64.NO_WRAP);
            if (!java.security.MessageDigest.isEqual(actual, sign(launchPayload(context, thread, nonce, issuedAt, pairing)))) return "";
            if (consumed.containsKey(nonce)) return "";
            consumed.put(nonce, issuedAt);
            while (consumed.size() > 1024) consumed.remove(consumed.keySet().iterator().next());
            return thread;
        } catch (Exception e) { return ""; }
    }
    public static boolean post(Context context, String id, String threadId, String title, String text) {
        if (id == null || id.isEmpty() || id.length() > 512 || threadId == null || threadId.length() > 256) throw new IllegalArgumentException("T3_NOTIFICATION_INVALID");
        // Posting is an explicit local preference, separate from glasses alerts.
        if (!"true".equals(FaceclawSettings.getInstance(context).getString("t3.phone-notifications", "false"))) return false;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return false;
        NotificationChannel existing = manager.getNotificationChannel(CHANNEL);
        if (existing != null && existing.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "T3 agent notifications", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setSound(null, null); channel.enableVibration(false); manager.createNotificationChannel(channel);
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) throw new IllegalStateException("T3_LAUNCH_UNAVAILABLE");
        launch.setData(android.net.Uri.parse("faceclaw-t3://thread/" + android.net.Uri.encode(threadId)));
        launch.putExtra("t3.threadId", threadId);
        try {
            String nonce = java.util.UUID.randomUUID().toString(); long issuedAt = System.currentTimeMillis();
            String pairing = pairingIdentity(context); launch.putExtra("t3.launchPairing", pairing);
            launch.putExtra("t3.launchNonce", nonce); launch.putExtra("t3.launchIssuedAt", issuedAt);
            launch.putExtra("t3.launchSignature", android.util.Base64.encodeToString(sign(launchPayload(context, threadId, nonce, issuedAt, pairing)), android.util.Base64.NO_WRAP));
        } catch (Exception e) { throw new IllegalStateException("T3_NOTIFICATION_SIGN_FAILED"); }
        PendingIntent open = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title == null ? "T3" : title)
            .setContentText(text == null ? "" : text).setStyle(new Notification.BigTextStyle().bigText(text))
            .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setCategory(Notification.CATEGORY_MESSAGE).build();
        manager.notify(PREFIX + id, 1, notification);
        return true;
    }
    public static void dismiss(Context context, String id) {
        context.getSystemService(NotificationManager.class).cancel(PREFIX + id, 1);
    }
    private static boolean isT3Event(android.service.notification.StatusBarNotification item) {
        String tag = item.getTag();
        return item.getId() == 1 && tag != null && tag.startsWith(PREFIX)
            && CHANNEL.equals(item.getNotification().getChannelId());
    }
    /** Clear only this app's T3 events; leave connection and alarm channels alone. */
    public static void dismissAll(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        for (android.service.notification.StatusBarNotification item : manager.getActiveNotifications()) {
            if (isT3Event(item)) manager.cancel(item.getTag(), item.getId());
        }
    }
    /** Own app's active IDs requires no NotificationListener permission. */
    public static String activeIds(Context context) {
        JSONArray ids = new JSONArray();
        for (android.service.notification.StatusBarNotification item : context.getSystemService(NotificationManager.class).getActiveNotifications()) {
            if (isT3Event(item)) ids.put(item.getTag().substring(PREFIX.length()));
        }
        return ids.toString();
    }
}
