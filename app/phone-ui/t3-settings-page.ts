import {customizationGroups,customizationsEnabled,customizationEnabled,setCustomizationsEnabled,setCustomizationEnabled} from '../extensions/settings';
import {onHostEvent,effectiveFeature,ownsFeature} from '../extensions/host';
import { Observable, Frame, Application, Utils, type EventData, type Page, action, alert } from '@nativescript/core';
import { getT3Config, saveT3Config, type T3Config } from '../t3/config';
import { pairT3 } from '../t3/pairing';
import { t3Client } from '../t3/client';
import { readT3PhoneNotificationsEnabled, saveT3PhoneNotificationsEnabled } from '../t3/notification-preferences';
import { requestPostNotificationsPermission } from '../g2/android-permissions';
import { openConnectionNotificationSettings } from '../native/foreground-service';
import { dashboardController } from '../g2/dashboard-controller';
import { connectT3, useT3SampleData, t3Workspace } from '../apps/t3/runtime';
import type { EnvironmentSummary, ModelSummary, ProjectSummary } from '../apps/t3/protocol';

class T3SettingsModel extends Observable {
  private config: T3Config;
  private models: ModelSummary[] = [];
  private offState: () => void;
  private ready = false;
  private notificationRequest = 0;
  private offExtensions:()=>void=()=>{};
  constructor() {
    super(); this.config = getT3Config();
    this.set('bridgeUrl', this.config.bridgeUrl); this.set('passphrase', ''); this.set('canPair', true);
    this.sync();
    this.set('status', t3Client.state().status);
    this.offExtensions=onHostEvent(type=>{if(type==='extensions'||type==='disconnected')this.syncCustomizations();});
    this.offState = t3Client.onStateChange(state => this.set('status', state.status));
    this.ready = true;
  }
  dispose(): void { this.ready = false; this.notificationRequest++; this.offState(); this.offExtensions(); this.set('passphrase', ''); }
  private sync(): void {
    this.syncCustomizations();
    this.set('phoneNotifications', readT3PhoneNotificationsEnabled());
    for (const key of ['enabled', 'preferAssistant', 'bridgeDictation', 'allowTools', 'notificationOverride'] as const) this.set(key, this.config[key]);
    const project = t3Workspace.projects.find(p => p.id === this.config.assistantProjectId && (this.config.assistantEnvironmentId ? p.environmentId === this.config.assistantEnvironmentId : t3Workspace.environments?.find(e => e.isPrimary)?.environmentId === p.environmentId));
    this.set('projectLabel', project ? `Project: ${project.title}${project.environmentLabel ? " · " + project.environmentLabel : ""}` : this.config.assistantProjectId ? 'Change assistant project' : 'Choose assistant project');
    this.set('modelLabel', this.config.assistantModel ? `Model: ${this.config.assistantModel}` : 'Choose assistant model');
    this.set('reasoningLabel', `Reasoning: ${this.config.assistantReasoning || 'Default'}`);
    this.set('refinementLabel', this.config.refinementProvider === 't3' ? 'Luna · low · T3 bridge' : 'Anthropic · Faceclaw configuration');
  }
  private syncCustomizations():void {
    this.set('customizationsEnabled',customizationsEnabled());
    for(const group of customizationGroups){this.set(`custom_${group.id.replace('-','_')}`,customizationEnabled(group.id));}
    this.set('overrideStatus',[...customizationGroups.map(g=>({feature:`ui.${g.id}`,label:g.label})),{feature:'notification-content',label:'Own inbox content'},{feature:'ui.notifications',label:'Notifications'},{feature:'assistant',label:'Assistant'},{feature:'transcription',label:'Transcription'},{feature:'refinement',label:'Refinement'},{feature:'device-tools',label:'Device tools'}].map(item=>`${item.label}: ${item.feature==='notification-content'?(effectiveFeature(item.feature)?.contenders?.some(candidate=>candidate.component?.startsWith('com.faceclaw.t3/')&&candidate.granted)?'Allowed while T3 is visible':'Awaiting host approval'):ownsFeature(item.feature)?'Active':effectiveFeature(item.feature)?.component?'Another app has priority':'Disabled or awaiting host approval'}`).join('\n'));
  }
  toggleCustomizations=(args:EventData)=>{if(this.ready)setCustomizationsEnabled(this.checked(args));this.syncCustomizations();};
  toggleLauncher=(args:EventData)=>{if(this.ready)setCustomizationEnabled('launcher',this.checked(args));this.syncCustomizations();};
  toggleNavigation=(args:EventData)=>{if(this.ready)setCustomizationEnabled('navigation',this.checked(args));this.syncCustomizations();};
  toggleMenus=(args:EventData)=>{if(this.ready)setCustomizationEnabled('app-menu',this.checked(args));this.syncCustomizations();};
  toggleLayout=(args:EventData)=>{if(this.ready)setCustomizationEnabled('window-layout',this.checked(args));this.syncCustomizations();};
  toggleTypography=(args:EventData)=>{if(this.ready)setCustomizationEnabled('typography',this.checked(args));this.syncCustomizations();};
  private openHostSettings = async (feature?: string) => {
    const context = Utils.android.getApplicationContext();
    const manager = context.getPackageManager();
    const matches = manager.queryIntentActivities(new android.content.Intent('com.faceclaw.action.MANAGE_APPS'), 0);
    const hosts: {label:string; packageName:string; name:string}[] = [];
    for(let i=0;i<matches.size();i++) {
      const match=matches.get(i), info=match.activityInfo;
      if(info?.exported && info.enabled && info.applicationInfo?.enabled) hosts.push({label:String(match.loadLabel(manager)),packageName:String(info.packageName),name:String(info.name)});
    }
    if(!hosts.length) { await alert({title:'Open Faceclaw',message:'Open Faceclaw settings, then Installed apps → Manage Android applications → Permissions and priority. Approve T3, select this host, and choose feature permissions and priority.',okButtonText:'OK'}); return; }
    let selected=hosts[0];
    if(hosts.length>1) {
      const labels=hosts.map(host=>`${host.label} (${host.packageName})`);
      const choice=await action({title:'Choose your Faceclaw host',cancelButtonText:'Cancel',actions:labels});
      const index=labels.indexOf(choice);if(index<0)return;selected=hosts[index];
    }
    try {
      const intent=new android.content.Intent('com.faceclaw.action.MANAGE_APPS')
        .setComponent(new android.content.ComponentName(selected.packageName,selected.name)).putExtra('appPackage',context.getPackageName());
      if (feature) intent.putExtra('feature', feature);
      const activity=Application.android.foregroundActivity;
      if(activity) activity.startActivity(intent); else context.startActivity(intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
    } catch { await alert({title:'Open Faceclaw',message:'Could not open Faceclaw permissions. Open your Faceclaw app and try again.',okButtonText:'OK'}); }
  };
  featureAccess = (args: EventData) => { void this.openHostSettings(String((args.object as any).get('feature'))); };
  hostSettings = () => { void this.openHostSettings(); };
  assistantAccess = () => { void this.openHostSettings('assistant'); };
  refinementAccess = () => { void this.openHostSettings('refinement'); };
  private save(update: Partial<T3Config>): void {
    try { saveT3Config(update); this.config = getT3Config(); this.sync(); }
    catch (error) { this.set('status', error instanceof Error ? error.message : 'T3_CONFIG_FAILED'); }
  }
  private checked(args: EventData): boolean { return Boolean((args.object as any).checked); }
  toggleEnabled = (args: EventData) => { if (this.ready && this.checked(args) !== this.config.enabled) this.save({ enabled: this.checked(args) }); };
  toggleAssistant = (args: EventData) => { if (this.ready && this.checked(args) !== this.config.preferAssistant) this.save({ preferAssistant: this.checked(args) }); };
  toggleDictation = (args: EventData) => { if (this.ready && this.checked(args) !== this.config.bridgeDictation) this.save({ bridgeDictation: this.checked(args) }); };
  toggleTools = (args: EventData) => { if (this.ready && this.checked(args) !== this.config.allowTools) this.save({ allowTools: this.checked(args) }); };
  toggleNotifications = (args: EventData) => { if (this.ready && this.checked(args) !== this.config.notificationOverride) this.save({ notificationOverride: this.checked(args) }); };
  togglePhoneNotifications = async (args: EventData) => {
    if (!this.ready) return;
    const requested = this.checked(args);
    const generation = ++this.notificationRequest;
    if (requested === readT3PhoneNotificationsEnabled()) return;
    if (!requested) { saveT3PhoneNotificationsEnabled(false); return; }
    const granted = await requestPostNotificationsPermission();
    if (!this.ready || generation !== this.notificationRequest) return;
    saveT3PhoneNotificationsEnabled(granted);
    this.set('phoneNotifications', granted);
  };
  connectionNotificationSettings = () => {
    try { openConnectionNotificationSettings(); }
    catch { this.set('status', 'Open Android Settings > Apps > Faceclaw T3 > Notifications > Faceclaw dashboard.'); }
  };
  chooseNotificationApps = () => { if (getT3Config().notificationOverride === true) Frame.topmost()?.navigate('phone-ui/t3-notification-apps-page'); };

  pair = async () => {
    this.set('canPair', false); this.set('status', 'Pairing…');
    const passphrase = String(this.get('passphrase') || '');
    this.set('passphrase', '');
    try {
      await pairT3(String(this.get('bridgeUrl') || '').trim(), passphrase);
      this.config = getT3Config(); this.sync(); await connectT3();
      this.set('status', t3Client.state().status);
    } catch (error) { this.set('status', error instanceof Error ? error.message : 'T3_PAIR_FAILED'); }
    finally { this.set('canPair', true); }
  };

  private async assistantModels(): Promise<ModelSummary[]> {
    let environmentId = this.config.assistantEnvironmentId;
    if (!environmentId) {
      const result = await t3Client.rpc<{ environments: EnvironmentSummary[] }>('environments.list');
      environmentId = result.environments.find(environment => environment.isPrimary)?.environmentId;
    }
    return (await t3Client.rpc<{ models: ModelSummary[] }>('models.list', environmentId ? { environmentId } : {})).models;
  }
  chooseProject = async () => {
    try {
      await t3Client.connect();
      const catalog = await t3Client.rpc<{ projects: ProjectSummary[] }>('projects.list');
      const result = catalog;
      const labels = result.projects.map(p => result.projects.filter(other => other.title === p.title).length > 1 ? `${p.title} · ${p.environmentLabel || 'This computer'}` : p.title);
      const selected = await action({ title: 'Assistant project', cancelButtonText: 'Cancel', actions: labels });
      const index = labels.indexOf(selected);
      if (index >= 0) { const project = result.projects[index]; this.save({ assistantProjectId: project.id, assistantEnvironmentId: project.environmentId || '', assistantProvider: '', assistantModel: '', assistantReasoning: '' }); this.set('projectLabel', `Project: ${project.title}${project.environmentLabel ? ' · ' + project.environmentLabel : ''}`); }
    } catch (error) { this.set('status', error instanceof Error ? error.message : 'T3_PROJECTS_FAILED'); }
  };

  chooseModel = async () => {
    try {
      await t3Client.connect();
      this.models = await this.assistantModels();
      const labels = this.models.map(m => `${m.providerName} · ${m.name}`);
      const selected = await action({ title: 'Assistant model', cancelButtonText: 'Cancel', actions: labels });
      const model = this.models[labels.indexOf(selected)];
      if (model) this.save({ assistantProvider: model.instanceId, assistantModel: model.model, assistantReasoning: model.reasoningChoices.find(r => r.isDefault)?.id || '' });
    } catch (error) { this.set('status', error instanceof Error ? error.message : 'T3_MODELS_FAILED'); }
  };

  chooseReasoning = async () => {
    try {
      await t3Client.connect();
      this.models = await this.assistantModels();
      const model = this.models.find(m => m.instanceId === this.config.assistantProvider && m.model === this.config.assistantModel);
      if (!model) { this.set('status', 'Choose an available model first.'); return; }
      const choices = model.reasoningChoices;
      const selected = await action({ title: 'Reasoning', cancelButtonText: 'Cancel', actions: choices.map(r => r.label) });
      const choice = choices.find(r => r.label === selected);
      if (choice) this.save({ assistantReasoning: choice.id });
    } catch (error) { this.set('status', error instanceof Error ? error.message : 'T3_MODELS_FAILED'); }
  };

  chooseRefinement = async () => {
    const choice = await action({ title: 'Draft refinement', cancelButtonText: 'Cancel', actions: ['Luna · low · T3 bridge', 'Anthropic · Faceclaw configuration'] });
    if (choice.startsWith('Luna')) this.save({ refinementProvider: 't3' });
    else if (choice.startsWith('Anthropic')) this.save({ refinementProvider: 'anthropic' });
  };
  preview = async () => { await useT3SampleData(); Frame.topmost()?.navigate('main-page'); await dashboardController.openApp('t3'); };
  openLive = async () => { await connectT3(); Frame.topmost()?.navigate('main-page'); await dashboardController.openApp('t3'); };
}

export function loaded(args: EventData): void {
  Application.android.foregroundActivity?.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
  const page = args.object as Page;
  if (!page.bindingContext) page.bindingContext = new T3SettingsModel();
}
export function unloaded(args: EventData): void {
  const page = args.object as Page;
  (page.bindingContext as T3SettingsModel)?.dispose();
  page.bindingContext = null;
}
