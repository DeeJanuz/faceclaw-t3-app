import { Observable, ObservableArray, type EventData, type Page, type SearchBar } from '@nativescript/core';
import { readNotificationApps, type NotificationApp } from '../native/notification-apps';
import { onHostState } from '../extensions/host';
import { getT3Config, onT3ConfigChanged } from '../t3/config';
import { allowsT3PhoneNotification, saveT3NotificationApps, onT3NotificationAppsChanged } from '../t3/notification-preferences';

class NotificationAppsModel extends Observable {
  private installedApps: NotificationApp[] = readNotificationApps();
  private query = '';
  private offConfig: () => void;
  private rows: Observable[] = [];

  constructor() {
    super();
    this.reloadApps();
    const offConfig = onT3ConfigChanged(() => this.refresh());
    const offApps = onT3NotificationAppsChanged(() => this.refresh());
    const offHost = onHostState(() => this.reloadApps());
    this.offConfig = () => { offConfig(); offApps(); offHost(); };
  }
  private reloadApps(): void {
    const apps = readNotificationApps();
    if (this.get('apps') && JSON.stringify(apps) === JSON.stringify(this.installedApps)) return;
    this.installedApps = apps;
    this.rows = this.installedApps.map(app => {
      const row = new Observable();
      row.set('name', app.name); row.set('packageName', app.packageName); row.set('toggle', this.toggle);
      return row;
    });
    this.refresh(true);
  }
  dispose(): void { this.offConfig(); }

  search = (args: EventData) => {
    this.query = String((args.object as any).text || '').trim().toLocaleLowerCase();
    this.refresh(true);
  };
  allowAll = () => this.save([]);
  muteAll = () => this.save([...new Set([...getT3Config().notificationExcludedApps, ...this.installedApps.map(app => app.packageName)])]);

  private save(excluded: string[]): void {
    if (getT3Config().notificationOverride !== true) return;
    try { saveT3NotificationApps(excluded); this.set('error', ''); }
    catch { this.set('error', 'Could not save notification apps.'); }
    this.refresh();
  }
  private toggle = (args: EventData): void => {
    const packageName = (args.object as any).bindingContext?.get('packageName');
    if (typeof packageName !== 'string' || !this.installedApps.some(app => app.packageName === packageName)) return;
    const config = getT3Config();
    if (config.notificationOverride !== true) return;
    const enabled = Boolean((args.object as any).checked);
    if (enabled === allowsT3PhoneNotification(packageName, config)) return;
    const excluded = new Set(config.notificationExcludedApps);
    if (enabled) excluded.delete(packageName); else excluded.add(packageName);
    this.save([...excluded]);
  };
  private refresh(rebuild = false): void {
    const config = getT3Config();
    const enabled = config.notificationOverride === true;
    this.set('overrideEnabled', enabled);
    this.set('summary', enabled ? 'Switch off apps to hide their T3 previews and inbox entries. New apps start enabled. Phone notifications follow Android settings; Faceclaw app notifications follow their app permissions.' : 'Turn on Use T3 for Faceclaw notifications to choose apps.');
    for (const row of this.rows) row.set('allowed', allowsT3PhoneNotification(row.get('packageName'), config));
    const visible = this.rows.filter(row => `${row.get('name')} ${row.get('packageName')}`.toLocaleLowerCase().includes(this.query));
    this.set('empty', visible.length ? '' : 'No matching apps.');
    if (rebuild || !this.get('apps')) this.set('apps', new ObservableArray(visible));
  }
}

export function navigatingTo(args: EventData): void { (args.object as Page).bindingContext = new NotificationAppsModel(); }
export function unloaded(args: EventData): void { ((args.object as Page).bindingContext as NotificationAppsModel)?.dispose(); }

function searchChanged(args: EventData): void {
  const model = (args.object as SearchBar).bindingContext;
  if (model instanceof NotificationAppsModel) model.search(args);
}
export function searchLoaded(args: EventData): void {
  const bar = args.object as SearchBar;
  // SearchBar emits textChange but does not declare it as an XML-bindable event.
  bar.off('textChange', searchChanged);
  bar.on('textChange', searchChanged);
  searchChanged(args);
}
export function searchUnloaded(args: EventData): void { (args.object as SearchBar).off('textChange', searchChanged); }
