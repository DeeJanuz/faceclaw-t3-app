import {ToolRateLimit} from './tool-rate-limit';
import {isT3AssistantTurnActive} from './assistant';
import {getT3Config,onT3ConfigChanged} from './config';
import {t3Client,type T3Event} from './client';
import {ToolReplayGuard} from './security';
import {hostState,onHostState,onHostEvent,ownsFeature,requestHostAction,sendHostAction} from '../extensions/host';
/** Bridge credentials and project replay guard authorize requests; host independently checks its grants. */
export function startT3ToolRelay():()=>void{
 const replay=new ToolReplayGuard();const rate=new ToolRateLimit();let stopped=false,epoch=0;const active=new Set<string>();
 let primaryEnvironmentId: string | undefined;
 const localAssistant=()=>{const config=getT3Config();return !config.assistantEnvironmentId || config.assistantEnvironmentId===primaryEnvironmentId;};
 let registeredCatalog='';let registeringCatalog='';let lastHeartbeat=0,catalogRevision=0;
 let bridgeSession = `t3-${Date.now()}-${Math.random().toString(36).slice(2)}`;
 const heartbeat=()=>{const now=Date.now();if(now-lastHeartbeat<4500)return;const config=getT3Config();if(!stopped&&config.enabled&&localAssistant()&&config.allowTools&&config.assistantProjectId&&t3Client.connected&&ownsFeature('device-tools')){lastHeartbeat=now;sendHostAction('device-tools','messaging-session',{projectId:config.assistantProjectId,pairingFingerprint:config.pairingFingerprint,bridgeSession,active:true});}};
 const invalidateMessaging=()=>{const config=getT3Config();sendHostAction('device-tools','messaging-session',{projectId:config.assistantProjectId,pairingFingerprint:config.pairingFingerprint,bridgeSession,active:false});bridgeSession=`t3-${Date.now()}-${Math.random().toString(36).slice(2)}`;lastHeartbeat=0;registeredCatalog='';registeringCatalog='';};
 const heartbeatTimer=setInterval(heartbeat,5000);
 const reviewedMessagingAvailable=()=>Array.isArray(hostState.tools)&&hostState.tools.some(tool=>tool?.name==='messaging.review');
 const safeTool=(name:string)=>!['host.notifications.action','t3.notifications.action'].includes(name)&&(!['notifications.list','host.notifications.list','t3.notifications.list','host.notifications.reply','t3.notifications.reply'].includes(name)||reviewedMessagingAvailable());
 const register=()=>{heartbeat();const config=getT3Config();if(stopped||!localAssistant()||!config.enabled||!config.allowTools||!config.assistantProjectId||!t3Client.connected||!ownsFeature('device-tools'))return;
  const tools=(hostState.tools??[]).filter(tool=>typeof tool?.name==='string'&&typeof tool?.description==='string'&&tool.inputSchema&&typeof tool.inputSchema==='object'&&safeTool(tool.name)).slice(0,128);
  // Host state is published once per second. Register only when the actual
  // catalog changes, otherwise a hidden app creates a bridge request stream.
  const catalog=JSON.stringify({projectId:config.assistantProjectId,tools:tools.map(tool=>({...tool,name:tool.name.replace(/^host\.notifications\./,'t3.notifications.')}))});
  if(catalog===registeredCatalog||catalog===registeringCatalog)return;
  registeringCatalog=catalog;
  void t3Client.rpc('faceclaw.capabilities.register',{protocolVersion:1,catalogRevision:++catalogRevision,...JSON.parse(catalog)}).then(()=>{
   if(registeringCatalog===catalog){registeredCatalog=catalog;registeringCatalog='';}
  }).catch(()=>{if(registeringCatalog===catalog)registeringCatalog='';});
 };
 const event=async(frame:T3Event)=>{
  const config=getT3Config();if(!['faceclaw.capability.call','faceclaw.tool.call'].includes(frame.event)||stopped||!localAssistant()||!config.enabled||!config.allowTools||!ownsFeature('device-tools')||!replay.admit(frame.payload,config.assistantProjectId))return;
  const call=frame.payload,started=epoch,resultMethod=frame.event==='faceclaw.capability.call'?'faceclaw.capabilities.result':'faceclaw.tools.result';
  if(!safeTool(call.name)){void t3Client.rpc(resultMethod,{callId:call.callId,result:{content:[{type:'text',text:'Update the Faceclaw host for consent-scoped history and reviewed replies.'}],isError:true}}).catch(()=>{});return;}
  if(!rate.admit(isT3AssistantTurnActive())){void t3Client.rpc(resultMethod,{callId:call.callId,result:{content:[{type:'text',text:'Proactive action rate limit exceeded; try again later'}],isError:true}}).catch(()=>{});return;}
  active.add(call.callId);
  let result:any;
  try{const response=await requestHostAction('device-tools','tool-call',{...call,pairingFingerprint:config.pairingFingerprint,bridgeSession,name:call.name.replace(/^t3\.notifications\./,'host.notifications.')});const value=response.result??response;result=Array.isArray(value.content)?value:{content:[{type:'text',text:value.ok?String(value.content??'Completed.'):String(value.error??'Tool failed')}],...(value.ok===false?{isError:true}:{})};}
  catch{result={content:[{type:'text',text:'Tool unavailable or outcome unknown. Check device before retrying.'}],isError:true};}
  if(stopped||started!==epoch||!active.delete(call.callId)||!t3Client.connected)return;
  void t3Client.rpc(resultMethod,{callId:call.callId,result}).catch(()=>{});
 };
 const unsubs=[t3Client.onEvent(frame=>{if(frame.event==='bridge.status'){primaryEnvironmentId=frame.payload?.environments?.find((e:any)=>e.isPrimary)?.environmentId;register();}void event(frame);}),t3Client.onStateChange(state=>{if(state.connected)register();else{primaryEnvironmentId=undefined;invalidateMessaging();epoch++;active.clear();}}),onHostState(register),onHostEvent(type=>{if(type==='extensions')register();if(type==='disconnected'){invalidateMessaging();epoch++;active.clear();}}),onT3ConfigChanged(()=>{invalidateMessaging();epoch++;active.clear();register();})];
 register();return ()=>{invalidateMessaging();clearInterval(heartbeatTimer);stopped=true;epoch++;active.clear();for(const unsub of unsubs)unsub();};
}
