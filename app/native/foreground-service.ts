import { Utils } from '@nativescript/core';
declare const android:any;
export function openConnectionNotificationSettings():void{const context=Utils.android.getApplicationContext();context.startActivity(new android.content.Intent('android.settings.APP_NOTIFICATION_SETTINGS').putExtra('android.provider.extra.APP_PACKAGE',context.getPackageName()).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));}
