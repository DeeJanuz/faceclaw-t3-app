# Notification popup audit, September 19, 2026

Implemented in the existing T3 and host checkouts. Physical-glasses verification remains outstanding. All five active repositories were clean at the start, so there were no existing changes to checkpoint.

## Findings and fixes

- **Reader frames could target a closed popup.** `runtime.ts` retained the closing extension surface, then set `notificationMode` back to `reader` after completing the handoff. A subsequent host refresh could route the normal reader's frames into that obsolete surface. The same flag suppressed subsequent arrivals. Handoff now retires the extension surface and its routing together. The new runtime regression fails against committed source and passes with the fix.
- **Sending an open request was mistaken for opening a window.** The Java SDK's legacy `requestOpenWindow()` returns transport acceptance. Popup visits now use the negotiated `window.open` control result and proceed only on `applied`; older hosts retain the bounded open-event fallback. The existing bell/host-inbox path remains unchanged.
- **Delayed close events could erase an opening card.** The matching handoff identity now survives until window readiness and reader creation. Failed opens can restore the same preview; replaced or expired previews cannot complete a stale open. Local previews also retain their identity until completion.
- **Replacement popups lost the sleep origin.** The host now carries the first popup's display state and origin window through replacements. New arrivals during a handed-off visit still refresh the inbox but cannot replace that visit's return destination.
- **Returning from another app reset T3's retained page to the inbox.** Closing the temporary reader now restores T3's saved page, selection and scroll as well as returning the host to the captured app. Popup entry no longer changes the dashboard's selection to the bell.

The working expanded-notification renderer, tap-to-dictate flow, double-tap dismissal, swipe dismissal, and host-reviewed reply authority are reused. No notification-content grants, pairing checks, reply tokens, Android permissions, or database schemas changed. A canceled or rejected reply keeps its reader available; a confirmed send exits the visit.

## Validation

- T3: `npm run check`, TypeScript and 264 tests pass.
- Host: 43 focused notification, wake, compositor, surface and reply-security tests pass.
- Full host suite: 456/459 pass. The three touch-contact/pinball failures reproduce against committed `HEAD` source without these changes.
- `git diff --check` passes in both repositories.
- Matching host and T3 debug APKs built successfully for the authorized September 19 device test. Installed APKs were backed up and signing certificates verified before updating through Windows ADB at `<phone-lan-address>:<adb-port>`. Build, install and live-log artifacts are under `../output/notification-test-20260919/`. Physical UX results remain pending the user test.

## Required device verification

Use matching host and T3 builds. Check each case from display-off, the T3 dashboard, a scrolled T3 page, and another foreground app:

1. Arrival shows the preview. Swipe dismisses; timeout leaves the notification in the inbox. Both restore the original display/app state.
2. Tap expands the same reader as the bell. The next tap starts reply dictation/review. Cancel retains the reader; confirmed send restores the original display/app state.
3. Double tap from the expanded reader dismisses and restores the original display/app state.
4. Replace a preview while initially asleep, then open and dismiss the replacement. The display returns to off.
5. Receive another notification during the expanded visit. It appears in the inbox without changing the current visit's return destination.
6. After closing a visit, receive another popup and repeat. Verify visible frames and gestures, not only populated inbox data.

Hardware timing and physical display behavior are not established by the automated tests.

## Physical test follow-up: native lifecycle actions

The display-on popup, expansion and reply worked on the glasses. A display-off arrival then expanded and replied successfully, but returned to the dashboard without turning the display off.

Root cause: `ExtensionContract.action()` omitted `notification-return`, `notification-reopen` and `notification-abandon`. Both the provider SDK and host native ingress rejected these actions before the TypeScript handlers could run. The local reader still returned to its saved page; the host retained its handed-off visit, which could suppress subsequent arrivals. Restarting the diagnostic host cleared that state and allowed another screen-off preview.

The native allowlist now admits these three actions exclusively under `ui.notifications`. Existing host checks still bind them to the current provider generation, opaque presentation identity, foreground window, display state and protected-flow rules. The SDK regression fails before the change and passes afterward; the SDK suite and 38 focused host tests pass. Both APKs must be rebuilt against the updated SDK. Content-free arrival and return logs were added for physical verification. Final sleep restoration remains pending the user retest.
