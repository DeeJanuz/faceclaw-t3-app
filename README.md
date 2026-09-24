# T3 for Faceclaw

A standalone Android APK for the general Faceclaw host. It contains the T3 client, reviewed conversation/plan workflows, bridge pairing settings, and optional customizations extracted from the personal T3 fork. The [T3 computer bridge](https://github.com/DeeJanuz/faceclaw-t3-bridge) remains the backend. The host and SDK live in the [Faceclaw fork](https://github.com/DeeJanuz/faceclaw).

The Android package is `com.faceclaw.t3`. It uses the same mutually approved Faceclaw SDK service boundary as Signal. Installing the APK does not grant it control of Faceclaw. Approve its host and individual customization features in Faceclaw, then choose per-feature priority there. APK-authored settings can enable bundles or individual features; different features can have different winners.

## Build and checks

Requires Node, JDK 21 and Android SDK/build-tools 35. The Faceclaw SDK is pinned to `1.1.0-rc.1.7e3d0f2df31b` and vendored under `vendor/` (Java AAR and `@faceclaw/motion` npm package), so a fresh clone builds without the host checkout; see [Updating the SDK](#updating-the-sdk). Shared font assets are packaged into this APK. No BLE controller, notification listener service, headset firmware flasher, host file browser, or full Faceclaw application is bundled.

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

Dashboard weather refreshes automatically while T3 is visible on the glasses, using Faceclaw's location permission. The host fetches weather on first display and every 30 minutes, with a one-minute retry delay after failures. Opening the host Weather app is not required. Hidden dashboards do not start new weather requests; they refresh when visible again if the cached result is due. This requires a host build with dashboard weather refresh support.

The phone preview uses the same extracted T3 layer stack as the glasses APK surface. Sample data is synthetic; its prompts do not go to a live bridge. The bridge's [`scripts/faceclaw-dev-server.mjs`](https://github.com/DeeJanuz/faceclaw-t3-bridge/blob/main/scripts/faceclaw-dev-server.mjs) provides an isolated integration fixture.

Frame conversion uses one bulk JavaScript-to-Android buffer transfer for both the preview and host surfaces. The [emulator pixel benchmark](tests/android/README.md) checks pixel fidelity and buffer bounds and compares transfer time with the former per-pixel path.

Ordinary T3 screen navigation and dictation open and close immediately. Session lists, transcripts, settings and the homepage render their destination without slide or card transitions. Notification previews, inbox expansion, notification reading and dismissal retain their animations. Render requests from one interaction still coalesce through host credits. Dictation remains opaque, clears transcripts on cancellation, and restores its destination before releasing the shell overlay.

## Boundaries

The host retains the glasses connection, input delivery, Android permissions, conflict order, and all native/APK notification action authority. The APK supplies launcher/folder rendering, app menus, T3 screens, notification previews/inbox/readers, and configuration tokens for shared navigation, layout and typography. Host configuration persists across APK process restarts; live service loss falls back to host behavior.

Feature authority uses each feature's epoch, separately from the complete settings snapshot revision. Unrelated provider updates preserve T3's partial notification snapshots, launcher replay ledger and ongoing UI transitions. Rebuild this APK against the matching platform SDK when testing the host's priority lifecycle fixes. The SDK's [Demo A/B checklist](https://github.com/DeeJanuz/faceclaw/blob/main/android-sdk/priority-demo/DEVICE-CHECKLIST.md) covers T3-above-demo priority and on-device fallback acceptance.

Pairing credentials and pending plan/approval locks retain the fork's Android Keystore-backed encryption. Android backup is disabled. IPC actions are scoped to the selected host, winning feature, current generation, and request identity. In-flight actions are never queued for reconnection or automatically retried after an unknown outcome. The original project/replay guard and six-proactive-calls-per-minute limit remain on the desktop tool relay.

Notification UI snapshots are bounded, assembled only when complete, and purged on grant loss. The phone notification app picker searches host-authorized app names and package IDs, refreshes as catalogs arrive, and supports catalogs of up to 4,096 apps through fragmented snapshots. This requires the matching host update; older hosts truncate the alphabetized catalog to 20,000 characters. Android profile visibility still applies. The separate Own inbox content grant supplies read/open/dismiss access while T3 is visible, even when another app controls global notifications; it grants no reply authority. Group dismissal validates every member before dispatch. External APK notification snapshots stay outside assistant tools. Explicitly authorized conversation history uses the separate messaging capability described below. Replies remain entirely host-reviewed; this APK receives a status, never the host's reviewed reply text or another APK's reply token. Navigation, pairing changes, permission changes and timeout cancel stale reviews. Host Anthropic refinement uses a separate gesture-bound request; its API credentials remain in the host. Launcher folder tools execute against the active APK’s own folder settings. Dictation capture requires a fresh gesture and the host dictation grant; the capture card is the review surface, and its send tap submits the final text directly.

## Source and regression ownership

See [EXTRACTION.md](EXTRACTION.md) for the checkpoint source, imported test ownership, and validation record. The earlier personal fork is deprecated and retained privately for reference and rollback. Active development uses this SDK APK and the general host. End-to-end physical-glasses regression validation remains required; archiving does not establish parity.


## Shared window motion

T3 consumes the vendored `@faceclaw/motion` SDK package. The [SDK motion contract](https://github.com/DeeJanuz/faceclaw/blob/main/android-sdk/WINDOW_MOTION.md) defines the optional 360 ms card and notification behavior, sampled on host credits. Notification dropdown and expanded-reader transitions defer body rendering until 90% open, discard body rasters before closing, and reverse from the last drawn rectangle. Application data and scroll state remain separate. In-process render requests coalesce through the shared SDK helper. The cadence is a target, not a measured glasses frame rate.

## Assistant messaging

Matching host and SDK builds add text-only Signal and SMS tools through the existing desktop bridge. The agent can find recipients, request session-scoped history permission, save or update drafts, and request review. Only the host's paginated glasses review can authorize Send. Double tap cancels; dictate corrections to T3, then review again. Reconnect never sends automatically. Updated T3 refuses legacy notification read/reply tools when the host cannot enforce the new consent and review rules.

History needs explicit glasses consent for each conversation. Saved drafts are encrypted and partitioned by project, pairing identity and the approved APK signer. To revoke history directly, use the host's **Settings > Messaging > Revoke assistant history access**. Phone setup is required once for SMS permissions and native Signal linking/host approval; routine messaging stays on the glasses.

See the host's [setup, behavior and verification notes](https://github.com/DeeJanuz/faceclaw/blob/main/docs/ASSISTANT-MESSAGING.md). Physical Signal/SMS sends and phone-screen-off glasses acceptance remain unverified; debug builds and emulator checks are not release certification.

## Default dictation

T3 requests Faceclaw’s default dictation engine instead of forcing bridge Whisper. Faceclaw defaults to on-device Moonshine. Download the model under **Settings > Voice > On-device voice model** and select **On-device** under **Transcription Provider** for offline speech recognition. T3 bridge transcription remains an explicit optional host override; disable that override for on-device dictation. Existing host provider choices are preserved. Sending a completed draft to T3 still requires the bridge connection.

## Changing a session model

While viewing an idle T3 conversation, long press to open the app actions menu and choose **Change model**. The picker uses the current bridge model catalog, applies the selected model to the existing session, and returns to the conversation. The bridge rejects the change while a turn or pending plan input is active, or if another client changed the session first.

## Multiple T3 computers

Use the [bridge federation setup](https://github.com/DeeJanuz/faceclaw-t3-bridge/blob/main/docs/peers.md) to pair the bridges on your computers. This APK routes sessions, projects, models, plan answers, and actions by environment ID. Lists show the owning computer and unavailable peers. Changing the phone's host clears the old workspace and subscriptions; it does not replay actions or switch hosts automatically. Legacy assistant settings still select the host's local primary project.

## Current transport build

The Java SDK resolves from `vendor/maven` and `@faceclaw/motion` from
`vendor/npm`. To build against a sibling `faceclaw-app-platform` checkout
instead, pass `-PfaceclawSdkSource=true` (Java source) or
`-PfaceclawSdkRepository=<maven dir>` (another packaged candidate). APK verification
checks that NativeScript exposes the Glanceboard registration and publication methods. This host requires Faceclaw firmware revision 22 or newer; an APK
install alone does not update the glasses. Follow the SDK's
[transport contract](https://github.com/DeeJanuz/faceclaw/blob/main/android-sdk/TRANSPORT_CONTRACT.md).

Ordinary navigation does not schedule animation samples. Static screens retain
cached glyph/scene rendering and Gray8 fallback. Notification animations remain
credit-driven. A full retained-scene commit after intervening raster frames
restores the homepage even when its fingerprint matches its earlier value.

## Navigation policy

Screen-to-screen animations are disabled. The earlier full-width and short-travel
experiments are retired. Notification animations remain enabled, including the
notification-origin return handoff. Dictation displays its full-size opaque card
immediately and closes without a shrink animation; privacy and capture cleanup
still run before the overlay is released.

The dashboard has Audio controls and Sessions cards. Tap Audio controls to reveal a single icon row: Previous Track, Play/Pause, Next Track. Commands go through Android AudioManager media-key dispatch to the active media session. The center icon follows Android’s music-active signal; the command always toggles through Android rather than guessing which action to send. Back collapses the controls. Card focus uses the outer border; focus inside Audio controls or Sessions uses brackets on both sides of the selected item. Sessions expands inline with unviewed completed turns, newest first; select the card, tap, then select a conversation. The final “Sessions” row opens the full session list, and is the only row when nothing is waiting. Long lists scroll within the right-hand column while the clock and notification button stay fixed.

A completed turn leaves the dashboard after its conversation is displayed or a reply is accepted, including conversations opened through notifications. Read markers persist on the phone per bridge pairing, computer, session, and completed turn. A later completed turn appears again. Running and settled sessions stay out of this list. Existing completed turns without a local read marker appear on first use; dismissing a notification alone does not mark a conversation read. Dashboard changes are immediate; notification animations remain enabled.

## Glanceboard

Glanceboard shows completed sessions that still need attention. Tap-and-hold while asleep uses the host board and existing dismissal behavior; awake tap-and-hold keeps the app switcher.

## Updating the SDK

Package a candidate in the Faceclaw fork with
`python3 android-sdk/scripts/package-candidate.py`, then copy it in:

```sh
scripts/update-sdk.sh 1.1.0-rc.1.<digest> [path/to/output/sdk-independence]
npm install
npm run check
```

The script verifies the recorded SHA-256 sums, replaces `vendor/`, and updates
the version pinned in `package.json` and `App_Resources/Android/app.gradle`.
