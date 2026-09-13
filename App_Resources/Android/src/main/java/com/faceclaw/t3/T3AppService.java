package com.faceclaw.t3;
import com.faceclaw.sdk.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.HashMap;
import java.util.Map;
import java.util.ArrayList;
import org.json.JSONObject;
public final class T3AppService extends FaceclawAppService {
 private static final int DRAW_RECORD_BYTES=9;
 private static long nextResourceEpoch=1;
 public static T3RuntimeListener listener;
 public static T3AppService instance;
 private final Map<String,ResourceHandle> resourcesByKey=new HashMap<>();
 private final Map<Integer,ResourceHandle> resourcesById=new HashMap<>();
 private FaceclawSession resourceSession;
 private long resourceEpoch;
 private long nextSceneVersion=1;
 @Override public void onCreate() { super.onCreate(); instance=this; deliver("created",new JSONObject()); }
 @Override public void onDestroy() { deliver("destroyed",new JSONObject()); instance=null; super.onDestroy(); }
 @Override protected synchronized void onSessionReady(FaceclawSession session) {
  if(resourceSession!=session){resourceSession=session;resourcesByKey.clear();resourcesById.clear();resourceEpoch=nextResourceEpoch++;}
  deliver("connected",new JSONObject());
 }
 @Override protected void onHostSnapshot(HostSnapshot snapshot) { deliver("host-snapshot",snapshot.toJson()); }
 @Override protected void onInput(RenderSurface surface,FaceclawInputEvent event) { deliver("input",event.extras); }
 @Override protected void onControlEvent(ControlEvent event) { deliver(event.type,event.data); }
 @Override protected void onSessionLost(DisconnectInfo info) {
  deliver("disconnected",Protocol.object("category",info.reason.name(),"recoverable",info.recoverable,"detail",info.detail));
 }
 @Override protected void onFrameOutcome(FrameOutcome outcome) { deliver("frame-outcome",outcome.toJson()); }

 /**
  * NativeScript transfers the Uint8Array backing buffer once. The SDK writes
  * it directly into a persistent Gray8 lease; no Bitmap or ARGB array exists
  * anywhere in T3's display path.
  */
 public boolean submitGrayBuffer(ByteBuffer gray,int offset,int length,int width,int height,String feature,boolean requestNextFrame) {
  return submit(gray,offset,length,width,height,feature,requestNextFrame,null);
 }

 /** Submit raster fallback pixels plus optional registered image/glyph placements. */
 public boolean submitGrayBufferWithDraws(ByteBuffer gray,int offset,int length,int width,int height,String feature,boolean requestNextFrame,ByteBuffer drawWire,int drawOffset,int drawLength) {
  return submit(gray,offset,length,width,height,feature,requestNextFrame,decodeDraws(drawWire,drawOffset,drawLength));
 }

 private boolean submit(ByteBuffer gray,int offset,int length,int width,int height,String feature,boolean requestNextFrame,DrawBatch draws) {
  FaceclawSession current=session();if(current==null||gray==null||width<1||height<1||length!=width*height||offset<0)return false;
  ByteBuffer source=gray.duplicate();int start=source.position()+offset;if(start<source.position()||start+length>source.limit())return false;source.position(start);source.limit(start+length);source=source.slice();
  RenderSurface surface=feature==null||feature.isEmpty()?current.windowSurface():current.extensionSurface(feature);
  if(surface.width()!=width||surface.height()!=height)return false;
  FrameMetadata.Builder metadata=FrameMetadata.builder(current.nextClientFrameId(),current.nextContentVersion()).fullDamage(width,height).requestNextFrame(requestNextFrame);
  if(draws!=null)metadata.draws(draws);
  return surface.submitGray8(source,metadata.build());
 }

 /** Register immutable Gray8 data once per SDK session. Returns zero when raster fallback should be used alone. */
 public synchronized int registerGrayResource(String key,ByteBuffer gray,int offset,int length,int width,int height,boolean glyph) {
  FaceclawSession current=session();if(current==null||current!=resourceSession||key==null||key.isEmpty()||key.length()>256||gray==null||width<1||height<1||length!=width*height||offset<0)return 0;
  ResourceHandle existing=resourcesByKey.get(key);if(existing!=null)return existing.id;
  try{
   ByteBuffer source=gray.duplicate();int start=source.position()+offset;if(start<source.position()||start+length>source.limit())return 0;source.position(start);source.limit(start+length);source=source.slice();
   ResourceHandle handle=glyph?current.resources().registerGlyph(width,height,source):current.resources().registerGrayImage(width,height,source);
   resourcesByKey.put(key,handle);resourcesById.put(handle.id,handle);return handle.id;
  }catch(RuntimeException invalid){return 0;}
 }

 public synchronized long getResourceEpoch(){return resourceEpoch;}

 /** Commit stable T3 chrome as retained nodes. False asks TypeScript to submit its baked raster fallback. */
 public synchronized boolean submitRetainedScene(ByteBuffer patchWire,int patchOffset,int patchLength,int patchX,int patchY,int patchWidth,int patchHeight,int surfaceWidth,int surfaceHeight,String feature,ByteBuffer drawWire,int drawOffset,int drawLength) {
  FaceclawSession current=session();if(current==null||current!=resourceSession)return false;RenderSurface surface=feature==null||feature.isEmpty()?current.windowSurface():current.extensionSurface(feature);if(surface.width()!=surfaceWidth||surface.height()!=surfaceHeight)return false;
  ArrayList<ResourcePlacement> placements=decodePlacements(drawWire,drawOffset,drawLength);if(drawLength>0&&placements==null)return false;
  try{
   SceneTransaction.Builder transaction=SceneTransaction.builder(nextSceneVersion++).clear();ArrayList<Long> order=new ArrayList<>();long nodeId=1;
   if(patchLength>0){if(patchWire==null||patchWidth<1||patchHeight<1||patchLength!=patchWidth*patchHeight)return false;ByteBuffer patch=patchWire.duplicate();int start=patch.position()+patchOffset;if(patchOffset<0||start<patch.position()||start+patchLength>patch.limit())return false;patch.position(start);patch.limit(start+patchLength);transaction.upsert(new SceneNode.RasterPatch(nodeId,patchWidth,patchHeight,patch.slice(),patchX,patchY,0,255,255));order.add(nodeId++);}
   if(placements!=null)for(ResourcePlacement placement:placements){transaction.upsert(new SceneNode.Resource(nodeId,placement.resource,placement.x,placement.y,1,placement.brightness,255));order.add(nodeId++);}
   long[] ids=new long[order.size()];for(int i=0;i<ids.length;i++)ids[i]=order.get(i);transaction.order(ids);return surface.scene().commit(transaction.build());
  }catch(RuntimeException invalid){return false;}
 }

 /** Invalid metadata is intentionally dropped; it never invalidates the baked raster frame. */
 private synchronized DrawBatch decodeDraws(ByteBuffer wire,int offset,int length) {
  ArrayList<ResourcePlacement> placements=decodePlacements(wire,offset,length);if(placements==null)return null;DrawBatch.Builder result=DrawBatch.builder();for(ResourcePlacement placement:placements)result.place(placement.resource,placement.x,placement.y,placement.brightness);return result.build();
 }
 private static final class ResourcePlacement {final ResourceHandle resource;final int x,y,brightness;ResourcePlacement(ResourceHandle resource,int x,int y,int brightness){this.resource=resource;this.x=x;this.y=y;this.brightness=brightness;}}
 private synchronized ArrayList<ResourcePlacement> decodePlacements(ByteBuffer wire,int offset,int length){
  if(length==0)return new ArrayList<>();if(wire==null||offset<0||length<0||length%DRAW_RECORD_BYTES!=0||length>Protocol.MAX_COMMAND_BYTES)return null;
  try{ByteBuffer input=wire.duplicate().order(ByteOrder.LITTLE_ENDIAN);int start=input.position()+offset;if(start<input.position()||start+length>input.limit())return null;input.position(start);input.limit(start+length);ArrayList<ResourcePlacement> result=new ArrayList<>();while(input.remaining()>=DRAW_RECORD_BYTES){ResourceHandle resource=resourcesById.get(input.getInt());int x=input.getShort(),y=input.getShort(),brightness=input.get()&0xff;if(resource==null)return null;result.add(new ResourcePlacement(resource,x,y,brightness));}return result;}catch(RuntimeException invalid){return null;}
 }
 public void invalidateSurface(String feature,int reason) {
  FaceclawSession current=session();if(current==null)return;InvalidateReason[] reasons=InvalidateReason.values();InvalidateReason value=reason>=0&&reason<reasons.length?reasons[reason]:InvalidateReason.STATE;
  (feature==null||feature.isEmpty()?current.windowSurface():current.extensionSurface(feature)).invalidate(value);
 }
 private void deliver(String type,JSONObject data) { if(listener!=null) listener.onEvent(this,type,data.toString()); }
}
