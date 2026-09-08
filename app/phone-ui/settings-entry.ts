import { Application, Frame } from '@nativescript/core';

const settingsAction = 'com.faceclaw.action.APP_SETTINGS';
const settingsPage = 'phone-ui/t3-settings-page';

/** Public Intents only navigate. Never read extras or change configuration/host grants. */
export function openRequestedSettings(activity: any, frame: Frame | undefined): void {
  const intent = activity?.getIntent();
  if (intent?.getAction() !== settingsAction || !frame) return;
  if (frame.currentEntry?.moduleName !== settingsPage) {
    frame.navigate({ moduleName: settingsPage, clearHistory: true, animated: false });
  }
  // Consume this request; returning from background must preserve the user's next page.
  intent.setAction(android.content.Intent.ACTION_MAIN);
}

export function initializeSettingsEntry(): void {
  // NativeScript emits resume after onPostResume, when Fragment navigation is safe.
  // It also sets the Activity's Intent on onNewIntent, covering warm/reused launches.
  Application.on(Application.resumeEvent, (args: any) => {
    const root = Application.getRootView();
    if (root instanceof Frame) openRequestedSettings(args.activity ?? args.android, root);
  });
}
