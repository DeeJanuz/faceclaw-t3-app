package com.faceclaw.app;

/** Content callbacks are delivered on the constructing looper; close details are sanitized. */
public interface FaceclawWebSocketListener {
    void onOpen();
    void onTextMessage(String message);
    void onClosed(int code, String reason);
    void onFailure(String message);
}
