import {onHostEvent} from './host';
import {pairT3} from '../t3/pairing';
import {connectT3,t3Workspace} from '../apps/t3/runtime';
/** The SDK admits this event only from the mutually approved host after its pairing dialog. */
export function initializeHostConfiguration():void {
 let pairing=false;
 onHostEvent((type,data)=>{
  if(type!=='configure'||pairing)return;
  if(typeof data.endpoint!=='string'||data.endpoint.length>2048||typeof data.code!=='string'||data.code.length<16||data.code.length>512)return;
  let endpoint:URL;
  try {endpoint=new URL(data.endpoint);if(endpoint.protocol!=='https:')return;endpoint.protocol='wss:';}catch{return;}
  pairing=true;
  void pairT3(endpoint.toString(),data.code).then(()=>connectT3()).catch(()=>t3Workspace.fail(new Error('T3_PAIR_FAILED'))).finally(()=>{pairing=false;});
 });
}
