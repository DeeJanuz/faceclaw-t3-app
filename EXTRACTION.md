# Extraction record

Source: `../archive/faceclaw-t3` (archived 2026-09-10; formerly `../faceclaw-t3`) checkpoint `8734017`, tagged `checkpoint/pre-t3-apk-extraction-20260907`. Computer bridge checkpoint `ce5dc8e`; general host platform checkpoint `eb4c264`. Root rollback manifest: `../output/t3-apk-extraction/rollback-manifest.json`.

Retained source includes `apps/t3` workspace, protocols, demo data, hub view model, T3Layer, dashboard, clock, activity and card renderers; `t3` pairing/client/config/security/drafts/assistant/STT/refinement; Java Keystore/pairing/WebSocket/HTTP/settings/font/icon/phone-notification helpers; graphics/fonts; T3 dictation and timed notification layers; launcher list/folders and reusable menu primitives. The launcher window's host registration tail was removed; its renderer and navigation remain APK-owned.

Adapted host boundaries live in `app/extensions`, `app/native`, and `app/ui/shell`. Native notification dismissal is asynchronous and closes a reader only after the host confirms success. Notification reply review moved to the host; the T3 reader retains its identity/current-view checks and cancels invalidated host review tickets. The phone shell is an APK preview and setup page, with no BLE responsibilities.

The imported APK-owned suite retains 121 tests covering T3 security, uncertain dispatch/plan approvals, exact UI workflows, measured text, ICU compatibility, and dictation lifecycle. Twenty-one added regression tests cover snapshot assembly/grants, request/result scope, disconnect/timeout no replay, own capture provenance, proactive rate limiting, asynchronous dismissal, and content-free review cancellation, host refinement/configuration, own inbox scope and group dismissal, and launcher folder validation.

Thirteen original tests were reassigned during extraction rather than importing the host implementation into this APK. Ten matching shell/native cases now run in `../faceclaw-app-platform/tests/host-voice-notification-security.test.cjs`. The configurable input viewport is covered by the host suite. The two background authorization and relay cases are covered across the host device-tool boundary, bridge suite, and the APK's complete `startT3ToolRelay` project/replay/six-call test. Original scenario inventory:

- Full-shell reviewed voice lifecycle after microphone permission.
- Notification disappearing during permission prompt prevents capture/send.
- Review cleanup during sleep cannot wake the display.
- Project-authorized background app launch versus ordinary proactive gate.
- T3 background replay/project/six-call rate gates (APK now tests its adapted rate and replay boundaries).
- Native notification removal callback proxy contract.
- Native snapshot changes invalidate icons without fake arrivals.
- Native reply access/freshness/creator/duplicate checks.
- Native removal invalidates caches and reaches observers.
- APK review cancellation under a newer overlay cannot send later.
- APK search-only callback rechecks authority after permission.
- APK search cancellation cannot deliver a late query/send target.
- Generic host input dialog fills the configured viewport.

## Validation record

- NativeScript service-only bootstrap on emulator-5554: new package installed, service started without launching an Activity, Java callback reached the TypeScript listener. No physical-device installation.
- Standalone full APK compiles and its extracted dashboard renders in the native phone preview. Fixture bridge pairing succeeds; five customization features report Active after mutual approval and independent host grants.
- `npm run typecheck` passes.
- `npm run check`: typecheck and all 142 tests pass. The added cases also cover zero-dim overlays, own-notification duplicate suppression, Watch input provenance, and the complete desktop tool relay.
- Production dependency audit: zero reported vulnerabilities. Sixteen inherited development-tool advisories remain (2 low, 5 moderate, 9 high); no broad toolchain upgrade was included in this extraction.
- Final debug APK passes package, signature, native RELRO, 16 KB ELF and ZIP alignment checks. SHA-256: `8da4cfebe490a74b4f6074dc1e87e8e08841703e6555c75e952b6fbc6807df45`.
- On emulator-5554 with the final general host: the T3 dashboard and own inbox render; the separate notification-content grant works while global notification override is off; a Watch hold opens the exact app menu; selecting a synthetic Shell notification opens its host-owned native reader. Phone preview updates after switching away and returning.
- On the final host build, the global T3 launcher renders its list and launches Files. Disabling only the launcher provider restores the stock icon grid while the other customization grants remain active. Global Files menus and the T3 own menu both reach the host-owned System actions menu; the own menu calls the authenticated SDK API rather than imitating Close window.
- These checks do not establish physical-glasses parity or end-to-end global assistant/transcription/notification override behavior. Those checks remain required before retiring the fork.
- Host/SDK boundary checks and host regression ownership are maintained in the sibling platform repository. Full integration and physical-glasses checks still govern retiring the fork.

Build artifacts, screenshots, emulator data and credentials are excluded from Git. No private settings or keys were copied from existing applications.
