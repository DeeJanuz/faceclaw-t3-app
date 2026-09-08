import {getBooleanSetting,setBooleanSetting,onSettingsStoreChanged} from '../native/settings-store';
import {getT3Config,onT3ConfigChanged} from '../t3/config';
import {publishExtensions,onHostEvent} from './host';
export const customizationGroups=[{id:'launcher',label:'Launcher and folders'},{id:'navigation',label:'T3 gestures'},{id:'app-menu',label:'App actions menus'},{id:'window-layout',label:'Window layout'},{id:'typography',label:'Typography'}] as const;
export function customizationsEnabled():boolean{return getBooleanSetting('t3.customizations.enabled',false);}
export function customizationEnabled(id:string):boolean{return getBooleanSetting(`t3.customizations.${id}`,true);}
export function setCustomizationsEnabled(value:boolean):void{setBooleanSetting('t3.customizations.enabled',value);}
export function setCustomizationEnabled(id:string,value:boolean):void{if(customizationGroups.some(group=>group.id===id))setBooleanSetting(`t3.customizations.${id}`,value);}
export function extensionDeclarations(){
 const config=getT3Config(),enabled=customizationsEnabled();
 const configurations:Record<string,Record<string,unknown>>={
  launcher:{label:'T3 vertical launcher',filesDefaultView:'list'},navigation:{doubleTap:'back',rootBack:'sleep',tapHold:'switcher',hold:'app-menu',wakeFocus:'window'},
  'app-menu':{title:'App actions',displayOffFirst:true,systemActionsLast:true,systemTitle:'System actions'},
  'window-layout':{centered:true,sidebarMode:'overlay',switcherHeight:'display',dividerWidth:2,ownTopBar:false,ownHeightMode:'medium',inputDialogs:'viewport'},
  typography:{font:'Inter_18pt-Regular.ttf',size:17,raster:'crisp',borderWidth:2,selectionBorderWidth:3,cardRadius:8},
 };
 return [
  {feature:'notification-content',enabled:true,configuration:{label:'T3 own notification inbox'}},
  ...customizationGroups.map(group=>({feature:`ui.${group.id}`,enabled:enabled&&customizationEnabled(group.id),configuration:configurations[group.id]})),
  {feature:'ui.notifications',enabled:config.notificationOverride,configuration:{label:'T3 notification inbox and previews'}},
  {feature:'assistant',enabled:config.enabled&&config.preferAssistant,configuration:{label:'T3 assistant'}},
  {feature:'transcription',enabled:config.enabled&&config.bridgeDictation,configuration:{label:'T3 bridge Whisper'}},
  {feature:'refinement',enabled:config.enabled&&config.refinementProvider==='t3',configuration:{label:'T3 Luna refinement'}},
  {feature:'device-tools',enabled:config.enabled&&config.allowTools,configuration:{label:'T3 assistant device tools'}},
 ];
}
export function initializeExtensionSettings():void{
 const publish=()=>publishExtensions(extensionDeclarations());
 onHostEvent(type=>{if(type==='connected')publish();});onT3ConfigChanged(publish);
 onSettingsStoreChanged(key=>{if(key.startsWith('t3.customizations.'))publish();});
}
