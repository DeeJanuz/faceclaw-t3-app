import {getFolderAssignments,getFolders,setAppFolder,disbandFolder,resolveFolderName,FOLDER_NAME_MAX_LENGTH} from '../apps/launcher/launcher-folders';
import {hostState,onHostEvent,respondHostRequest} from './host';
export function runLauncherFolderTool(name:string,args:unknown):{ok:boolean;content?:string;error?:string}{
 const fail=(error:string)=>({ok:false,error});const done=(content:string)=>({ok:true,content});
 if(!args||typeof args!=='object'||Array.isArray(args))return fail('Invalid arguments');
 const value=args as Record<string,unknown>;const allowed=name==='apps.list_folders'?[]:name==='apps.move_to_folder'?['app_id','folder']:name==='apps.remove_from_folder'?['app_id']:name==='apps.disband_folder'?['folder']:null;
 if(!allowed||Object.keys(value).some(key=>!allowed.includes(key)))return fail('Unknown launcher operation or argument');
 const apps=(hostState as any).apps??[];const ids=apps.map((app:any)=>app.appId);const describe=(id:string)=>`${id} ("${apps.find((app:any)=>app.appId===id)?.title??id}")`;
 if(name==='apps.list_folders'){
  const lines:string[]=[];for(const [folder,members] of getFolders()){const known=members.filter(id=>ids.includes(id)).sort();if(known.length)lines.push(`${folder}: ${known.map(describe).join(', ')}`);}
  const assignments=getFolderAssignments(),ungrouped=ids.filter((id:string)=>!assignments[id]);lines.push(`Ungrouped: ${ungrouped.length?ungrouped.map(describe).join(', '):'(none)'}`);return done(lines.join('\n'));
 }
 if(allowed.includes('app_id')&&(typeof value.app_id!=='string'||!ids.includes(value.app_id)))return fail('Unknown app');
 let folder='';if(allowed.includes('folder')){if(typeof value.folder!=='string')return fail('Invalid folder');folder=resolveFolderName(value.folder);if(!folder||folder.length>FOLDER_NAME_MAX_LENGTH||/[\u0000-\u001f\u007f]/.test(folder))return fail('Invalid folder');}
 const appId=value.app_id as string;
 if(name==='apps.move_to_folder'){setAppFolder(appId,folder);return done(`Moved ${describe(appId)} into "${folder}".`);}
 if(name==='apps.remove_from_folder'){setAppFolder(appId,null);return done(`Removed ${describe(appId)} from its folder.`);}
 const moved=disbandFolder(folder);return moved?done(`Disbanded "${folder}"; ${moved} apps moved to the top level.`):fail('Folder not found');
}
export function initializeLauncherTools():void{
 const seen=new Set<string>();
 onHostEvent((type,envelope)=>{
  if(type==='disconnected'||type==='destroyed'){seen.clear();return;}
  if(type==='extensions'){if(!Array.isArray(envelope.changedFeatures)||envelope.changedFeatures.includes('ui.launcher'))seen.clear();return;}
  if(type!=='extension-event'||envelope.feature!=='ui.launcher'||envelope.type!=='request'||envelope.data?.operation!=='folder-tool')return;
  const data=envelope.data;if(typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.requestId)||seen.has(data.requestId))return;
  if(seen.size>=512){respondHostRequest('ui.launcher',envelope.generation,data.requestId,{ok:false,error:'Too many requests'});return;}
  seen.add(data.requestId);
  try{respondHostRequest('ui.launcher',envelope.generation,data.requestId,runLauncherFolderTool(data.name,data.arguments));}catch{respondHostRequest('ui.launcher',envelope.generation,data.requestId,{ok:false,error:'Folder operation failed'});}
 });
}
