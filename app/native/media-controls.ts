import { Utils } from '@nativescript/core';

declare const android: any;
export type MediaCommand = 'next' | 'previous' | 'toggle';

/** Android routes media keys to the current media session without an app-specific login. */
export function sendMediaCommand(command: MediaCommand): boolean {
  if (!global.isAndroid) return false;
  try {
    const context = Utils.android.getApplicationContext();
    const manager = context.getSystemService(android.content.Context.AUDIO_SERVICE);
    if (!manager) return false;
    const KeyEvent = android.view.KeyEvent;
    const key = { next: KeyEvent.KEYCODE_MEDIA_NEXT, previous: KeyEvent.KEYCODE_MEDIA_PREVIOUS, toggle: KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE }[command];
    manager.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, key));
    manager.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, key));
    return true;
  } catch { return false; }
}

/** Playback hint for the icon; the toggle itself is always resolved by Android. */
export function isMediaPlaying(): boolean {
  if (!global.isAndroid) return false;
  try {
    return Boolean(Utils.android.getApplicationContext()
      .getSystemService(android.content.Context.AUDIO_SERVICE)?.isMusicActive());
  } catch { return false; }
}
