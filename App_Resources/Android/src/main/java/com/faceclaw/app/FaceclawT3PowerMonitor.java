package com.faceclaw.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;

/**
 * Process-owned hints used to accelerate an eligible T3 reconnect after the
 * device leaves idle or a usable route returns. The authenticated WebSocket
 * handshake remains the source of truth; this class never claims reachability.
 */
public final class FaceclawT3PowerMonitor {
    private final Context context;
    private final ConnectivityManager connectivity;
    private final PowerManager power;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ConnectivityManager.NetworkCallback networkCallback;
    private BroadcastReceiver idleReceiver;
    private FaceclawT3PowerMonitorListener listener;
    private boolean started;

    public FaceclawT3PowerMonitor(Context context) {
        if (context == null) throw new IllegalArgumentException("context is required");
        this.context = context.getApplicationContext();
        this.connectivity = (ConnectivityManager) this.context.getSystemService(Context.CONNECTIVITY_SERVICE);
        this.power = (PowerManager) this.context.getSystemService(Context.POWER_SERVICE);
    }

    public synchronized void start(FaceclawT3PowerMonitorListener next) {
        if (next == null) throw new IllegalArgumentException("listener is required");
        listener = next;
        if (started) return;
        started = true;

        if (connectivity != null) {
            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network network) { emitNetwork(true); }
                @Override public void onLost(Network network) { emitNetwork(hasActiveNetwork()); }
            };
            try { connectivity.registerDefaultNetworkCallback(networkCallback, handler); }
            catch (RuntimeException ignored) { networkCallback = null; }
            emitNetwork(hasActiveNetwork());
        }

        idleReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context ignored, Intent intent) {
                if (PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED.equals(intent.getAction())) emitIdle();
            }
        };
        try {
            context.registerReceiver(idleReceiver, new IntentFilter(PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED));
            emitIdle();
        } catch (RuntimeException ignored) {
            idleReceiver = null;
        }
    }

    public synchronized void stop() {
        started = false;
        if (connectivity != null && networkCallback != null) {
            try { connectivity.unregisterNetworkCallback(networkCallback); } catch (RuntimeException ignored) { }
        }
        networkCallback = null;
        if (idleReceiver != null) {
            try { context.unregisterReceiver(idleReceiver); } catch (RuntimeException ignored) { }
        }
        idleReceiver = null;
        listener = null;
    }

    public boolean isDeviceIdle() {
        return power != null && android.os.Build.VERSION.SDK_INT >= 23 && power.isDeviceIdleMode();
    }

    public boolean hasActiveNetwork() {
        return connectivity != null && connectivity.getActiveNetwork() != null;
    }

    private void emitNetwork(final boolean available) {
        final FaceclawT3PowerMonitorListener current;
        synchronized (this) { if (!started) return; current = listener; }
        if (current == null) return;
        handler.post(() -> { synchronized (FaceclawT3PowerMonitor.this) { if (!started || listener != current) return; } try { current.onNetworkAvailable(available); } catch (Throwable ignored) { } });
    }

    private void emitIdle() {
        final boolean idle = isDeviceIdle();
        final FaceclawT3PowerMonitorListener current;
        synchronized (this) { if (!started) return; current = listener; }
        if (current == null) return;
        handler.post(() -> { synchronized (FaceclawT3PowerMonitor.this) { if (!started || listener != current) return; } try { current.onDeviceIdleChanged(idle); } catch (Throwable ignored) { } });
    }
}
