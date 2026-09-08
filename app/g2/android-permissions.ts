import { Application,Utils } from '@nativescript/core';
declare const android:any;
export async function requestPostNotificationsPermission():Promise<boolean>{
 const context=Utils.android.getApplicationContext();if(android.os.Build.VERSION.SDK_INT<33)return true;
 if(context.checkSelfPermission('android.permission.POST_NOTIFICATIONS')===0)return true;
 const activity=Application.android.foregroundActivity??Application.android.startActivity;if(!activity)return false;
 return new Promise(resolve=>{const code=7331;const listener=(event:any)=>{if(event.requestCode!==code)return;Application.android.off('activityRequestPermissions',listener);resolve(event.grantResults?.[0]===0);};Application.android.on('activityRequestPermissions',listener);activity.requestPermissions(['android.permission.POST_NOTIFICATIONS'],code);});
}
