import {onHostEvent,nativeService,respondHostRequest} from './host';
import {sendT3Assistant} from '../t3/assistant';
import {T3SttClient} from '../t3/stt';
import {refineT3Dictation} from '../t3/refinement';
import {getT3Config,onT3ConfigChanged} from '../t3/config';
import {toUint8Array} from '../util/array-util';
declare const org:any,android:any;
type Request={feature:string;generation:number;id:string;cancel:()=>void;stt?:T3SttClient;ownCapture?:boolean};
const requests=new Map<string,Request>();
function key(feature:string,id:string){return `${feature}:${id}`;}
export function initializeProviders():void{
 const cancelAll=()=>{for(const request of requests.values())request.cancel();requests.clear();};
 onT3ConfigChanged(cancelAll);
 onHostEvent((type,envelope)=>{
  if(type==='disconnected'||type==='destroyed'){cancelAll();return;}
  if(type==='own-capture-closed'){for(const [key,request] of requests)if(request.ownCapture){request.cancel();requests.delete(key);}return;}
  if(type!=='extension-event')return;
  const {feature,generation}=envelope,data=envelope.data??{};const id=data.requestId;
  if(!['assistant','transcription','refinement'].includes(feature)||typeof id!=='string'||id.length>128)return;
  const requestKey=key(feature,id);
  if(envelope.type==='cancel'){requests.get(requestKey)?.cancel();requests.delete(requestKey);return;}
  if(envelope.type==='event'&&feature==='transcription'){
   const request=requests.get(requestKey);if(!request||request.generation!==generation||!request.stt)return;
   if(data.event==='finish'){request.stt.finish();return;}
   if(data.event==='audio'){
    try{if(typeof data.pcmBase64!=='string'||data.pcmBase64.length>5464||!/^[A-Za-z0-9+/]*={0,2}$/.test(data.pcmBase64))throw new Error();const pcm=toUint8Array(android.util.Base64.decode(data.pcmBase64,android.util.Base64.NO_WRAP));if(pcm.length>4096||pcm.length%2)throw new Error();request.stt.acceptPcm(pcm);pcm.fill(0);}catch{request.cancel();requests.delete(requestKey);respondHostRequest(feature,generation,id,{error:'invalid_audio'});}
   }
   return;
  }
  if(envelope.type!=='request'||requests.has(requestKey)||requests.size>=8)return;
  const config=getT3Config();
  if(!config.enabled){respondHostRequest(feature,generation,id,{error:'T3_DISABLED',dispatched:false});return;}
  const request:Request={feature,generation,id,ownCapture:data.ownCapture===true,cancel:()=>{}};requests.set(requestKey,request);
  const current=()=>requests.get(requestKey)===request;
  const finish=(result:Record<string,unknown>)=>{if(!current())return;requests.delete(requestKey);respondHostRequest(feature,generation,id,result);};
  const progress=(result:Record<string,unknown>)=>{if(current())nativeService()?.reportExtensionProgress(feature,generation,id,new org.json.JSONObject(JSON.stringify(result)));};
  if(feature==='assistant'){
   if(typeof data.text!=='string'||!data.text.trim()||data.text.length>8000){finish({error:'invalid_request',dispatched:false});return;}
   let text='';const handle=sendT3Assistant(data.text,{onTextDelta:(_delta,full)=>{text=full;progress({text});},onToolActivity:activity=>progress({text,activity}),onTurnDone:result=>finish({text,stopReason:result.stopReason,dispatched:true}),onError:()=>finish({error:'T3_ASSISTANT_FAILED',dispatched:true})},()=>{finish({error:'T3_UNAVAILABLE',dispatched:false});return {cancel(){}};});request.cancel=()=>handle.cancel();
  }else if(feature==='refinement'){
   if(config.refinementProvider!=='t3'||typeof data.original!=='string'||typeof data.followup!=='string'||data.original.length>20000||data.followup.length>4000){finish({error:'REFINEMENT_UNAVAILABLE'});return;}
   const handle=refineT3Dictation({original:data.original,followup:data.followup,onDone:text=>finish({text}),onError:()=>finish({error:'T3_REFINEMENT_FAILED'})});request.cancel=()=>handle.cancel();
  }else{
   if(data.operation!=='start'||data.sampleRate!==16000||data.format!=='pcm_s16le'){finish({error:'invalid_audio'});return;}
   const stt=new T3SttClient({apiKey:'',onTranscript:event=>{if(event.isFinal)finish({text:event.text});else progress({text:event.text,isFinal:false});},onStatus:status=>progress({status}),onError:()=>finish({error:'dictation_failed'})},()=>finish({error:'transcription_unavailable'}),'t3');
   request.stt=stt;request.cancel=()=>stt.stop();stt.start();
  }
 });
}
