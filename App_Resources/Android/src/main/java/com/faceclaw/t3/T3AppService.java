package com.faceclaw.t3;
import com.faceclaw.sdk.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.HashMap;
import java.util.Map;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import org.json.JSONObject;
public final class T3AppService extends FaceclawAppService {
 private static final int DRAW_RECORD_BYTES=9;
 private static final int MAX_RESOURCE_ALIASES=8192;
 private static long nextResourceEpoch=1;
 public static T3RuntimeListener listener;
 public static T3AppService instance;
 private final Map<String,ResourceHandle> resourcesByKey=new HashMap<>();
 private final Map<Integer,ResourceHandle> resourcesById=new HashMap<>();
 private final Map<String,String> sceneFingerprints=new HashMap<>();
 private final Map<String,Long> sceneFingerprintVersions=new HashMap<>();
 private FaceclawSession resourceSession;
 private long resourceEpoch;
 private boolean resourceFallback;
 private long nextSceneVersion=1;
 @Override public void onCreate() { super.onCreate(); instance=this; deliver("created",new JSONObject()); }
 @Override public void onDestroy() { deliver("destroyed",new JSONObject()); instance=null; super.onDestroy(); }
 @Override protected synchronized void onSessionReady(FaceclawSession session) {
  if(resourceSession!=session){resourceSession=session;resourcesByKey.clear();resourcesById.clear();sceneFingerprints.clear();sceneFingerprintVersions.clear();resourceEpoch=nextResourceEpoch++;resourceFallback=false;}
  session.controls().onReady(()->session.controls().setWindowPolicy(new WindowPolicy(WindowPolicy.Height.MIN,true,false,false,false,false),result->{}));
  deliver("connected",new JSONObject());
 }
 @Override protected void onHostSnapshot(HostSnapshot snapshot) { deliver("host-snapshot",snapshot.toJson()); }
 @Override protected void onInput(RenderSurface surface,FaceclawInputEvent event) {
  if(surface.id().startsWith("extension:"))deliver("extension-event",Protocol.object("feature",surface.id().substring(10),"generation",surface.generation(),"type","input","data",Protocol.object("input",event.extras)));
  else deliver("input",event.extras);
 }
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
 public boolean submitGrayBuffer(ByteBuffer gray,int offset,int length,int width,int height,String feature,boolean requestNextFrame,String traceId) {
  return submit(gray,offset,length,width,height,feature,requestNextFrame,traceId,null,null);
 }

 /** Submit raster fallback pixels plus optional registered image/glyph placements. */
 public boolean submitGrayBufferWithDraws(ByteBuffer gray,int offset,int length,int width,int height,String feature,boolean requestNextFrame,String traceId,ByteBuffer drawWire,int drawOffset,int drawLength) {
  return submit(gray,offset,length,width,height,feature,requestNextFrame,traceId,decodeDraws(drawWire,drawOffset,drawLength),null);
 }

 /** Submit raster fallback, cached draws, and one copy from the last accepted frame. */
 public boolean submitGrayBufferWithDrawsAndCopy(ByteBuffer gray,int offset,int length,int width,int height,String feature,boolean requestNextFrame,String traceId,ByteBuffer drawWire,int drawOffset,int drawLength,int sourceX,int sourceY,int copyWidth,int copyHeight,int destinationX,int destinationY) {
  RetainedRegionCopy copy;
  try{copy=new RetainedRegionCopy(sourceX,sourceY,copyWidth,copyHeight,destinationX,destinationY);}catch(IllegalArgumentException invalid){return false;}
  return submit(gray,offset,length,width,height,feature,requestNextFrame,traceId,decodeDraws(drawWire,drawOffset,drawLength),copy);
 }

 private boolean submit(ByteBuffer gray,int offset,int length,int width,int height,String feature,boolean requestNextFrame,String traceId,DrawBatch draws,RetainedRegionCopy copy) {
  FaceclawSession current=session();if(current==null||gray==null||width<1||height<1||length!=width*height||offset<0)return false;
  ByteBuffer source=gray.duplicate();int start=source.position()+offset;if(start<source.position()||start+length>source.limit())return false;source.position(start);source.limit(start+length);source=source.slice();
  RenderSurface surface=feature==null||feature.isEmpty()?current.windowSurface():current.extensionSurface(feature);
  if(surface.width()!=width||surface.height()!=height)return false;
  FrameMetadata.Builder metadata=FrameMetadata.builder(current.nextClientFrameId(),current.nextContentVersion()).fullDamage(width,height).requestNextFrame(requestNextFrame).traceId(traceId);
  if(draws!=null)metadata.draws(draws);
  if(copy!=null)metadata.retainedCopy(copy);
  return surface.submitGray8(source,metadata.build());
 }

 /** Register immutable Gray8 data once per SDK session. Returns zero when raster fallback should be used alone. */
 public synchronized int registerGrayResource(String key,ByteBuffer gray,int offset,int length,int width,int height,boolean glyph) {
  FaceclawSession current=session();if(current==null||current!=resourceSession||key==null||key.isEmpty()||key.length()>256||gray==null||width<1||height<1||length!=width*height||offset<0)return 0;
  if(resourceFallback)return 0;
  ResourceHandle existing=resourcesByKey.get(key);if(existing!=null)return existing.id;
  if(resourcesByKey.size()>=MAX_RESOURCE_ALIASES){resourceFallback=true;return 0;}
  try{
   ByteBuffer source=gray.duplicate();int start=source.position()+offset;if(start<source.position()||start+length>source.limit())return 0;source.position(start);source.limit(start+length);source=source.slice();
   ResourceHandle handle=glyph?current.resources().registerGlyph(width,height,source):current.resources().registerGrayImage(width,height,source);
   resourcesByKey.put(key,handle);resourcesById.put(handle.id,handle);return handle.id;
  }catch(RuntimeException invalid){
   if(invalid.getMessage()!=null&&invalid.getMessage().contains("Resource quota exceeded"))resourceFallback=true;
   return 0;
  }
 }

 /** Register a printable glyph with stable font/encoding identity for firmware string tables. */
 public synchronized int registerGrayGlyphResource(String key,String fontKey,int encoding,ByteBuffer gray,int offset,int length,int width,int height) {
  FaceclawSession current=session();if(current==null||current!=resourceSession||key==null||key.isEmpty()||key.length()>256||gray==null||width<1||height<1||length!=width*height||offset<0)return 0;
  if(resourceFallback)return 0;ResourceHandle existing=resourcesByKey.get(key);if(existing!=null)return existing.id;
  if(resourcesByKey.size()>=MAX_RESOURCE_ALIASES){resourceFallback=true;return 0;}
  try{
   ByteBuffer source=gray.duplicate();int start=source.position()+offset;if(start<source.position()||start+length>source.limit())return 0;source.position(start);source.limit(start+length);source=source.slice();
   ResourceHandle handle=current.resources().registerGlyph(fontKey,encoding,width,height,source);
   resourcesByKey.put(key,handle);resourcesById.put(handle.id,handle);return handle.id;
  }catch(RuntimeException invalid){
   if(invalid.getMessage()!=null&&invalid.getMessage().contains("Resource quota exceeded"))resourceFallback=true;
   return 0;
  }
 }

 /** Warm every unique resource referenced by a prepared transition frame. */
 public synchronized boolean prefetchGrayResources(ByteBuffer drawWire,int drawOffset,int drawLength) {
  FaceclawSession current=session();if(current==null||current!=resourceSession)return false;
  ArrayList<ResourcePlacement> placements=decodePlacements(drawWire,drawOffset,drawLength);if(placements==null)return false;
  LinkedHashSet<ResourceHandle> resources=new LinkedHashSet<>();for(ResourcePlacement placement:placements)resources.add(placement.resource);
  if(resources.isEmpty()||resources.size()>128)return false;
  try{return current.resources().prefetch(resources);}catch(RuntimeException invalid){return false;}
 }

 public synchronized long getResourceEpoch(){return resourceEpoch;}
 public synchronized boolean isResourceFallback(){return resourceFallback;}
 public boolean hasRenderCredit(String feature){FaceclawSession current=session();if(current==null)return false;RenderSurface surface=feature==null||feature.isEmpty()?current.windowSurface():current.extensionSurface(feature);return surface.hasRenderCredit();}
 public synchronized boolean isRetainedSceneCurrent(String feature,String fingerprint){
  FaceclawSession current=session();if(current==null||current!=resourceSession||fingerprint==null)return false;String key=feature==null||feature.isEmpty()?"window":feature;Long version=sceneFingerprintVersions.get(key);if(version==null||!fingerprint.equals(sceneFingerprints.get(key)))return false;
  RenderSurface surface="window".equals(key)?current.windowSurface():current.extensionSurface(key);long pending=surface.scene().pendingVersion(),accepted=surface.scene().acceptedVersion();
  if(pending==version||accepted>=version)return true;sceneFingerprints.remove(key);sceneFingerprintVersions.remove(key);return false;
 }
 public synchronized boolean submitUnchangedRetainedScene(String feature,String fingerprint){
  if(!isRetainedSceneCurrent(feature,fingerprint))return false;FaceclawSession current=session();if(current==null)return false;RenderSurface surface=feature==null||feature.isEmpty()?current.windowSurface():current.extensionSurface(feature);
  long sceneVersion=nextSceneVersion++;boolean committed=surface.scene().commit(SceneTransaction.builder(sceneVersion).build());if(committed){String key=feature==null||feature.isEmpty()?"window":feature;sceneFingerprintVersions.put(key,sceneVersion);}return committed;
 }

 /** Commit stable T3 chrome as retained nodes. False asks TypeScript to submit its baked raster fallback. */
 public synchronized boolean submitRetainedScene(ByteBuffer patchWire,int patchOffset,int patchLength,int patchX,int patchY,int patchWidth,int patchHeight,int surfaceWidth,int surfaceHeight,String feature,ByteBuffer drawWire,int drawOffset,int drawLength,String fingerprint) {
  FaceclawSession current=session();if(current==null||current!=resourceSession)return false;RenderSurface surface=feature==null||feature.isEmpty()?current.windowSurface():current.extensionSurface(feature);if(surface.width()!=surfaceWidth||surface.height()!=surfaceHeight)return false;
  ArrayList<ResourcePlacement> placements=decodePlacements(drawWire,drawOffset,drawLength);if(drawLength>0&&placements==null)return false;
  try{
   long sceneVersion=nextSceneVersion++;SceneTransaction.Builder transaction=SceneTransaction.builder(sceneVersion).clear();ArrayList<Long> order=new ArrayList<>();long nodeId=1;
   if(patchLength>0){if(patchWire==null||patchWidth<1||patchHeight<1||patchLength!=patchWidth*patchHeight)return false;ByteBuffer patch=patchWire.duplicate();int start=patch.position()+patchOffset;if(patchOffset<0||start<patch.position()||start+patchLength>patch.limit())return false;patch.position(start);patch.limit(start+patchLength);transaction.upsert(new SceneNode.RasterPatch(nodeId,patchWidth,patchHeight,patch.slice(),patchX,patchY,0,255,255));order.add(nodeId++);}
   if(placements!=null)for(ResourcePlacement placement:placements){transaction.upsert(new SceneNode.Resource(nodeId,placement.resource,placement.x,placement.y,1,placement.brightness,255));order.add(nodeId++);}
   long[] ids=new long[order.size()];for(int i=0;i<ids.length;i++)ids[i]=order.get(i);transaction.order(ids);boolean committed=surface.scene().commit(transaction.build());if(committed){String key=feature==null||feature.isEmpty()?"window":feature;sceneFingerprints.put(key,fingerprint==null?"":fingerprint);sceneFingerprintVersions.put(key,sceneVersion);}return committed;
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
