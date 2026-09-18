package com.faceclaw.app;

/** Content-free process power/network hints for the T3 reconnect policy. */
public interface FaceclawT3PowerMonitorListener {
    void onNetworkAvailable(boolean available);
    void onDeviceIdleChanged(boolean idle);
}
