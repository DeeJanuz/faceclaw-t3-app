# T3 for Faceclaw

A standalone Android APK for the general Faceclaw host. It contains the T3 client, reviewed conversation/plan workflows, bridge pairing settings, and optional customizations extracted from the personal T3 fork. The existing computer service in `../faceclaw-t3-bridge` remains the backend.

The Android package is `com.faceclaw.t3`. It uses the same mutually approved Faceclaw SDK service boundary as Signal. Installing the APK does not grant it control of Faceclaw. Approve its host and individual customization features in Faceclaw, then choose per-feature priority there. APK-authored settings can enable bundles or individual features; different features can have different winners.

## Build and checks

Requires Node, JDK 21, Android SDK/build-tools 35, and the sibling `../faceclaw-app-platform/android-sdk`. Java SDK sources and shared font assets are packaged into this APK. No BLE controller, notification listener service, headset firmware flasher, host file browser, or full Faceclaw application is bundled.

```sh
npm ci
npm run check
JAVA_HOME=/path/to/jdk21 ANDROID_HOME=/path/to/android-sdk npm run build
ANDROID_HOME=/path/to/android-sdk python3 scripts/verify_apk.py platforms/android/app/build/outputs/apk/debug/app-debug.apk --expected-package com.faceclaw.t3
```

The debug APK is for isolated testing. Use your own stable signing identity for an eventual release. Do not uninstall the current fork until native integration and physical-glasses regression checks pass.

## Setup

1. Install the general Faceclaw host and this APK. Open T3 from your phone launcher or select it under Faceclaw's **Manage Android applications**. Both open **T3 settings** directly. Use **Faceclaw permissions and priority** to approve T3, select the host, and grant individual features. These controls also remain available through the host manager's **Permissions and priority** button.
2. Pair the existing computer bridge with its address and pairing passphrase in T3 settings. Fresh pairing and manual configuration are intentional.
3. Select the assistant project, model, and reasoning level. Enable desired assistant, bridge dictation, refinement, and device-tool roles.
4. Enable optional T3 customizations. Approve each desired capability and set its priority in Faceclaw. Disabled winners reveal the next enabled, approved app according to your chosen order.

**T3 gestures** makes double tap go back through menus and screens; at the dashboard it turns the display off, and another double tap wakes it. Tap then hold opens the app switcher, and one hold opens App actions. **App actions menus** separately controls the menu presentation, including access to System actions. These settings need the customization bundle enabled and their respective host grants. The preview and sample-data controls are at the bottom of T3 settings.

The phone preview uses the same extracted T3 layer stack as the glasses APK surface. Sample data is synthetic; its prompts do not go to a live bridge. `../faceclaw-t3-bridge/scripts/faceclaw-dev-server.mjs` provides the existing isolated integration fixture.

Frame conversion uses one bulk JavaScript-to-Android buffer transfer for both the preview and host surfaces. The [emulator pixel benchmark](tests/android/README.md) checks pixel fidelity and buffer bounds and compares transfer time with the former per-pixel path.

Navigation cards show their content during expansion and reveal the dashboard during collapse. Sessions keeps only its heading during the first 90% of expansion, then lays out and reveals its list; closing retains the populated card. The heading follows the card while body pixels are progressively revealed at fixed positions to reduce Bluetooth update size; the animation cadence remains 40 ms (25 requested frames per second). Content snapshots are limited to the active transition and invalidated by data changes. Render requests from the same interaction are combined into one frame using the latest state. Ask Assistant uses the same populated transition. Its return animation reveals a fresh dashboard only for dashboard-origin capture; reply capture retains its opaque background, and cancellation clears transcript pixels before animating.

## Boundaries

The host retains the glasses connection, input delivery, Android permissions, conflict order, and all native/APK notification action authority. The APK supplies launcher/folder rendering, app menus, T3 screens, notification previews/inbox/readers, and configuration tokens for shared navigation, layout and typography. Host configuration persists across APK process restarts; live service loss falls back to host behavior.

Pairing credentials and pending plan/approval locks retain the fork's Android Keystore-backed encryption. Android backup is disabled. IPC actions are scoped to the selected host, winning feature, current generation, and request identity. In-flight actions are never queued for reconnection or automatically retried after an unknown outcome. The original project/replay guard and six-proactive-calls-per-minute limit remain on the desktop tool relay.

Notification UI snapshots are bounded, assembled only when complete, and purged on grant loss. The phone notification app picker searches host-authorized app names and package IDs, refreshes as catalogs arrive, and supports catalogs of up to 4,096 apps through fragmented snapshots. This requires the matching host update; older hosts truncate the alphabetized catalog to 20,000 characters. Android profile visibility still applies. The separate Own inbox content grant supplies read/open/dismiss access while T3 is visible, even when another app controls global notifications; it grants no reply authority. Group dismissal validates every member before dispatch. External APK notification contents stay outside the T3 workspace and assistant tool catalog. Replies remain entirely host-reviewed; this APK receives a status, never the host's reviewed reply text or another APK's reply token. Navigation, pairing changes, permission changes and timeout cancel stale reviews. Host Anthropic refinement uses a separate gesture-bound request; its API credentials remain in the host. Launcher folder tools execute against the active APK’s own folder settings. Own-app capture requires a fresh gesture and a separately approved transcription capability; final text enters a T3 draft and cannot send itself.

## Source and regression ownership

See [EXTRACTION.md](EXTRACTION.md) for the checkpoint source, imported test ownership, and validation record. The fork remains the reference until end-to-end regression testing is complete.


## Shared window motion

T3 consumes `@faceclaw/motion` from the sibling platform SDK. The [SDK motion contract](../faceclaw-app-platform/android-sdk/WINDOW_MOTION.md) defines the optional 360 ms / 40 ms card and notification behavior. Window, dropdown and expanded-reader transitions defer body rendering until 90% open, discard body rasters before closing, and reverse from the last drawn rectangle. Application data and scroll state remain separate. In-process render requests coalesce through the shared SDK helper. The cadence is a target, not a measured glasses frame rate.
