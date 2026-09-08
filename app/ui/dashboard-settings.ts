import { getStringSetting } from '../native/settings-store';
export interface ConfigSettingString {get():string; set(value:string):void; title?:string; key?:string; label?:string;}
export interface ConfigSettingBoolean {get():boolean; set(value:boolean):void; title?:string;}
export const timeFormatSetting = {get: (): '12h'|'24h' => getStringSetting('t3.clock.format','12h') === '24h' ? '24h':'12h'};
