package com.faceclaw.app;

import android.os.Handler;
import android.os.Looper;
import okhttp3.*;
import java.io.IOException;
import java.util.concurrent.TimeUnit;

public final class FaceclawT3Pairing {
    public static void pair(String url, String json, FaceclawSseListener listener) {
        Handler handler = new Handler(Looper.myLooper() == null ? Looper.getMainLooper() : Looper.myLooper());
        OkHttpClient client = new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
            .callTimeout(15, TimeUnit.SECONDS).addInterceptor(FaceclawHttp.userAgentInterceptor()).build();
        Request request = new Request.Builder().url(url).post(RequestBody.create(json, MediaType.get("application/json"))).build();
        client.newCall(request).enqueue(new Callback() {
            public void onFailure(Call call, IOException error) { handler.post(() -> listener.onFailure("T3_PAIR_FAILED")); }
            public void onResponse(Call call, Response response) throws IOException {
                try (ResponseBody body = response.body()) {
                    if (!response.isSuccessful()) { handler.post(() -> listener.onHttpError(response.code(), "")); return; }
                    if (body == null) { handler.post(() -> listener.onFailure("T3_PAIR_INVALID")); return; }
                    java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
                    java.io.InputStream input = body.byteStream();
                    byte[] chunk = new byte[1024]; int count;
                    while (buffer.size() <= 8192 && (count = input.read(chunk, 0, Math.min(chunk.length, 8193 - buffer.size()))) != -1) buffer.write(chunk, 0, count);
                    byte[] bytes = buffer.toByteArray();
                    if (bytes.length > 8192) { handler.post(() -> listener.onFailure("T3_PAIR_INVALID")); return; }
                    String result = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
                    handler.post(() -> { listener.onLine(result); listener.onComplete(); });
                } catch (IOException error) { handler.post(() -> listener.onFailure("T3_PAIR_FAILED")); }
            }
        });
    }
}
