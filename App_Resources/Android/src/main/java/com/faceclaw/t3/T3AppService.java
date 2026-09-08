package com.faceclaw.t3;
import com.faceclaw.sdk.FaceclawAppService;
import org.json.JSONObject;
public final class T3AppService extends FaceclawAppService {
 public static T3RuntimeListener listener;
 public static T3AppService instance;
 @Override public void onCreate() { super.onCreate(); instance=this; deliver("created",new JSONObject()); }
 @Override public void onDestroy() { deliver("destroyed",new JSONObject()); instance=null; super.onDestroy(); }
 @Override protected void onHostConnected() { deliver("connected",new JSONObject()); }
 @Override protected void onHostDisconnected() { deliver("disconnected",new JSONObject()); }
 @Override protected void onHostEvent(String type,JSONObject data) { deliver(type,data); }
 private void deliver(String type,JSONObject data) { if(listener!=null) listener.onEvent(this,type,data.toString()); }
}
