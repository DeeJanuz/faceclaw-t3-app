package com.faceclaw.app;

import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.Executors;

import okhttp3.Dispatcher;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/**
 * Thin okhttp WebSocket wrapper for the TypeScript side. Sends text frames
 * (JSON protocols) and binary frames (raw audio for Soniox). Listener callbacks are
 * posted to the Looper of the thread that constructed this object, so a JS
 * isolate (main thread or app worker) always receives them on its own
 * thread; a Looper-less constructing thread falls back to the main thread.
 */
public class FaceclawWebSocket {
    private static final String TAG = "FaceclawWebSocket";
    private static volatile OkHttpClient sharedClient;
    // WebSocket handshakes must be allowed to overlap. A single executor lets a
    // stalled reconnect hold the queue in front of dictation/refinement sockets.
    private static final Dispatcher backendDispatcher = new Dispatcher(Executors.newCachedThreadPool(r -> {
        Thread thread = new Thread(r, "FaceclawT3Backend");
        thread.setDaemon(true);
        return thread;
    }));
    private static final int MAX_QUEUED_TEXT_MESSAGES = 64;
    private static final long MAX_QUEUED_TEXT_BYTES = 8L * 1024L * 1024L;

    private final Handler callbackHandler;
    private final Object callbackToken = new Object();
    private final Object callbackLock = new Object();
    private final WebSocket socket;
    private int queuedTextMessages;
    private long queuedTextBytes;
    private volatile boolean closeRequested;

    // Single constructor (no overloads) so NativeScript constructor resolution
    // can never pick a variant that drops the auth header; callers with no
    // header pass null/null.
    public FaceclawWebSocket(String url, final FaceclawWebSocketListener listener, String headerName, String headerValue) {
        if (url == null || url.trim().isEmpty()) {
            throw new IllegalArgumentException("url is required");
        }
        if (listener == null) {
            throw new IllegalArgumentException("listener is required");
        }
        Looper looper = Looper.myLooper();
        callbackHandler = new Handler(looper != null ? looper : Looper.getMainLooper());
        Request.Builder builder = new Request.Builder().url(url.trim());
        if (headerName != null && !headerName.isEmpty() && headerValue != null) {
            builder.addHeader(headerName, headerValue);
        }
        Request request = builder.build();
        // Redacted diagnostics: confirm the auth header is actually present on
        // the handshake and carries a plausible value (not empty/truncated).
        StringBuilder headerLog = new StringBuilder();
        for (String name : request.headers().names()) {
            String value = request.header(name);
            headerLog.append(name).append('=').append(redact(value)).append(' ');
        }
        Log.i(TAG, "ws connect host=" + request.url().host() + request.url().encodedPath()
                + " headers=[" + headerLog.toString().trim() + "]");
        socket = getClient().newWebSocket(request, new WebSocketListener() {
            @Override public void onOpen(WebSocket webSocket, Response response) {
                Log.i(TAG, "ws open host=" + request.url().host()
                        + request.url().encodedPath() + " protocol="
                        + (response.header("Sec-WebSocket-Protocol") == null ? "none" : "negotiated"));
                postControlCallback(() -> {
                    try {
                        listener.onOpen();
                    } catch (Throwable t) {
                        Log.w(TAG, "listener onOpen failed", t);
                    }
                });
            }

            @Override public void onMessage(WebSocket webSocket, String text) {
                if (!postTextCallback(text, () -> {
                    try {
                        listener.onTextMessage(text);
                    } catch (Throwable t) {
                        Log.w(TAG, "listener onTextMessage failed", t);
                    }
                })) abortForBacklog(listener);
            }

            @Override public void onClosing(WebSocket webSocket, int code, String reason) {
                webSocket.close(code, reason);
            }

            @Override public void onClosed(WebSocket webSocket, int code, String reason) {
                postControlCallback(() -> {
                    try {
                        listener.onClosed(sanitizeCloseCode(code), closeCategory(code));
                    } catch (Throwable t) {
                        Log.w(TAG, "listener onClosed failed", t);
                    }
                });
            }

            @Override public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                if (closeRequested) {
                    return;
                }
                final String message = "network:" + (t == null ? "unknown" : t.getClass().getSimpleName())
                        + (response == null ? "" : ":http=" + response.code());
                Log.w(TAG, "ws failure host=" + request.url().host()
                        + request.url().encodedPath() + " reason=" + message);
                postControlCallback(() -> {
                    try {
                        listener.onFailure(message);
                    } catch (Throwable inner) {
                        Log.w(TAG, "listener onFailure failed", inner);
                    }
                });
            }
        });
    }

    private void postControlCallback(Runnable callback) {
        callbackHandler.postAtTime(() -> {
            synchronized (callbackLock) {
                if (closeRequested) return;
            }
            callback.run();
        }, callbackToken, SystemClock.uptimeMillis());
    }

    private boolean postTextCallback(String text, Runnable callback) {
        final long bytes = Math.max(0L, (long) (text == null ? 0 : text.length()) * 2L);
        synchronized (callbackLock) {
            if (closeRequested || bytes > MAX_QUEUED_TEXT_BYTES || queuedTextMessages >= MAX_QUEUED_TEXT_MESSAGES || queuedTextBytes + bytes > MAX_QUEUED_TEXT_BYTES) return false;
            queuedTextMessages++;
            queuedTextBytes += bytes;
            boolean posted = callbackHandler.postAtTime(() -> {
                synchronized (callbackLock) {
                    if (queuedTextMessages > 0) queuedTextMessages--;
                    queuedTextBytes = Math.max(0L, queuedTextBytes - bytes);
                    if (closeRequested) return;
                }
                callback.run();
            }, callbackToken, SystemClock.uptimeMillis());
            if (!posted) {
                queuedTextMessages--;
                queuedTextBytes -= bytes;
            }
            return posted;
        }
    }

    private void abortForBacklog(final FaceclawWebSocketListener listener) {
        synchronized (callbackLock) {
            if (closeRequested) return;
            closeRequested = true;
            queuedTextMessages = 0;
            queuedTextBytes = 0;
        }
        callbackHandler.removeCallbacksAndMessages(callbackToken);
        try { socket.cancel(); } catch (Throwable ignored) { }
        callbackHandler.post(() -> {
            try { listener.onFailure("network:callback-backlog"); }
            catch (Throwable t) { Log.w(TAG, "listener onFailure failed", t); }
        });
    }

    private void clearCallbacks() {
        synchronized (callbackLock) {
            queuedTextMessages = 0;
            queuedTextBytes = 0;
        }
        callbackHandler.removeCallbacksAndMessages(callbackToken);
    }

    private static OkHttpClient getClient() {
        OkHttpClient client = sharedClient;
        if (client == null) {
            synchronized (FaceclawWebSocket.class) {
                if (sharedClient == null) {
                    sharedClient = new OkHttpClient.Builder()
                        .dispatcher(backendDispatcher)
                        .followRedirects(false)
                        .followSslRedirects(false)
                        .pingInterval(20, TimeUnit.SECONDS)
                        .addInterceptor(FaceclawHttp.userAgentInterceptor())
                        .build();
                }
                client = sharedClient;
            }
        }
        return client;
    }

    private static String redact(String value) {
        if (value == null) {
            return "null";
        }
        int len = value.length();
        return "[redacted]";
    }

    private static int sanitizeCloseCode(int code) {
        return code >= 1000 && code <= 4999 ? code : 1006;
    }

    private static String closeCategory(int code) {
        if (code == 1000) return "normal";
        if (code == 1001) return "going-away";
        if (code == 1008) return "policy";
        if (code >= 4000 && code <= 4999) return "application";
        return code >= 1000 && code <= 1015 ? "protocol-or-server" : "unknown";
    }

    public boolean sendText(String message) {
        return socket.send(message == null ? "" : message);
    }

    public boolean sendBinary(byte[] bytes) {
        return socket.send(ByteString.of(bytes == null ? new byte[0] : bytes));
    }

    public void close(int code, String reason) {
        closeRequested = true;
        clearCallbacks();
        try {
            if (!socket.close(code, reason)) {
                socket.cancel();
            }
        } catch (Throwable t) {
            socket.cancel();
        }
    }

    /** Cancel a handshake immediately when its owner times out or is replaced. */
    public void cancel() {
        closeRequested = true;
        clearCallbacks();
        socket.cancel();
    }
}
