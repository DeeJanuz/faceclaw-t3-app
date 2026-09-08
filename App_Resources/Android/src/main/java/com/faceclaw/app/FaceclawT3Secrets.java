package com.faceclaw.app;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** T3 bearer token is encrypted under Android Keystore in the no-backup directory.
 * It is deliberately absent from Faceclaw's settings export and Android backup. */
public final class FaceclawT3Secrets {
    private static final String ALIAS = "faceclaw-t3-pairing";
    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            gen.generateKey();
        }
        return (SecretKey)store.getKey(ALIAS, null);
    }
    public static synchronized String read(Context ctx) {
        java.io.File file = new java.io.File(ctx.getNoBackupFilesDir(), "t3-token");
        if (!file.exists()) return "";
        try {
            String[] parts = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8).split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception e) { throw new IllegalStateException("T3_CREDENTIAL_READ_FAILED"); }
    }
    public static synchronized void write(Context ctx, String token) {
        java.io.File file = new java.io.File(ctx.getNoBackupFilesDir(), "t3-token");
        try {
            if (token.isEmpty()) { Files.deleteIfExists(file.toPath()); return; }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
            String value = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(token.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            android.util.AtomicFile atomic = new android.util.AtomicFile(file);
            java.io.FileOutputStream out = null;
            try { out = atomic.startWrite(); out.write(value.getBytes(StandardCharsets.UTF_8)); atomic.finishWrite(out); }
            catch (Exception e) { if (out != null) atomic.failWrite(out); throw e; }
        } catch (Exception e) { throw new IllegalStateException("T3_CREDENTIAL_WRITE_FAILED"); }
    }
    /** Non-secret pairing identity for cache/draft partitioning; never store the bearer in a key. */
    public static String fingerprint(String token) {
        if (token == null || token.isEmpty()) return "";
        try {
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(); for (byte b : digest) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (Exception e) { throw new IllegalStateException("T3_IDENTITY_FAILED"); }
    }

    private static java.io.File draftFile(Context ctx, String id) throws Exception {
        if (id == null || id.isEmpty() || id.length() > 4096) throw new IllegalArgumentException("T3_DRAFT_INVALID");
        byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(id.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(); for (byte b : digest) hex.append(String.format("%02x", b));
        return new java.io.File(ctx.getNoBackupFilesDir(), "t3-draft-" + hex);
    }
    public static synchronized String readDraft(Context ctx, String id) {
        try {
            java.io.File file = draftFile(ctx, id);
            if (!file.exists()) return "";
            if (System.currentTimeMillis() - file.lastModified() > 7L * 86400000) { Files.deleteIfExists(file.toPath()); return ""; }
            String[] parts = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8).split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception e) { throw new IllegalStateException("T3_DRAFT_READ_FAILED"); }
    }
    public static synchronized void writeDraft(Context ctx, String id, String value) {
        try {
            java.io.File file = draftFile(ctx, id);
            if (value.isEmpty()) { Files.deleteIfExists(file.toPath()); return; }
            if (value.length() > 65536) throw new IllegalArgumentException();
            java.io.File[] drafts = ctx.getNoBackupFilesDir().listFiles((dir, name) -> name.startsWith("t3-draft-"));
            if (!file.exists() && drafts != null && drafts.length >= 16) {
                java.util.Arrays.sort(drafts, java.util.Comparator.comparingLong(java.io.File::lastModified));
                Files.deleteIfExists(drafts[0].toPath());
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
            String encrypted = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            android.util.AtomicFile atomic = new android.util.AtomicFile(file); java.io.FileOutputStream out = null;
            try { out = atomic.startWrite(); out.write(encrypted.getBytes(StandardCharsets.UTF_8)); atomic.finishWrite(out); }
            catch (Exception e) { if (out != null) atomic.failWrite(out); throw e; }
        } catch (Exception e) { throw new IllegalStateException("T3_DRAFT_WRITE_FAILED"); }
    }

}
