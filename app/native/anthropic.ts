import { nativeService,onHostEvent } from '../extensions/host';
export interface RefineDictationOptions { original:string; followup:string; onDone:(text:string)=>void; onError:(error:string)=>void; }
export interface AnthropicStreamHandle {cancel():void;}
let sequence=0;
/** Host Anthropic credentials remain in the host. A response belongs to this one request. */
export function refineDictation(options:RefineDictationOptions):AnthropicStreamHandle {
 const requestId=`t3-refine-${Date.now()}-${++sequence}`;
 const service=nativeService();let closed=false;let timer:ReturnType<typeof setTimeout>|undefined;
 const cleanup=()=>{closed=true;if(timer)clearTimeout(timer);off();};
 const cancel=()=>{if(closed)return;cleanup();service?.cancelHostRefinement(requestId);};
 const off=onHostEvent((type,data)=>{
  if(closed)return;
  if(type==='disconnected'||type==='destroyed'){cleanup();options.onError('HOST_CONNECTION_LOST');return;}
  if(data.requestId!==requestId)return;
  if(type==='host-refinement-result'){cleanup();if(typeof data.text==='string'&&data.text.trim()&&data.text.length<=8000)options.onDone(data.text);else options.onError('REFINEMENT_INVALID');}
  if(type==='host-refinement-rejected'){cleanup();options.onError('REFINEMENT_UNAVAILABLE');}
 });
 timer=setTimeout(()=>{cancel();options.onError('REFINEMENT_TIMEOUT');},120000);
 if(!service?.requestHostRefinement(requestId,options.original,options.followup)){cleanup();options.onError('REFINEMENT_UNAVAILABLE');}
 return {cancel};
}
