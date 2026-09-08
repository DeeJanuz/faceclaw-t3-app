import {onHostEvent} from './host';
export type SharedStyle={font?:string;size?:number;raster?:'crisp'|'hinted'|'antialiased';borderWidth?:number;selectionBorderWidth?:number;cardRadius?:number};
let style:SharedStyle={};let revision=0;
const listeners=new Set<()=>void>();
export function sharedStyle():SharedStyle{return style;}
export function sharedStyleRevision():number{return revision;}
export function onSharedStyle(listener:()=>void):()=>void{listeners.add(listener);return ()=>listeners.delete(listener);}
onHostEvent((type,data)=>{
 if(type!=='shared-style'&&type!=='disconnected')return;
 const next:SharedStyle={};
 if(type==='shared-style'){
  if(typeof data.font==='string'&&/^(Inter_18pt|Roboto|RobotoMono|Montserrat)-(Regular|Light|Bold)\.ttf$/.test(data.font))next.font=data.font;
  if(Number.isInteger(data.size)&&data.size>=8&&data.size<=20)next.size=data.size;
  if(['crisp','hinted','antialiased'].includes(data.raster))next.raster=data.raster;
  for(const field of ['borderWidth','selectionBorderWidth','cardRadius'] as const)if(Number.isInteger(data[field])&&data[field]>=0&&data[field]<=24)next[field]=data[field];
 }
 style=next;revision++;for(const listener of listeners)listener();
});
