package com.faceclaw.t3.pixeltest;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;

/** Emulator-only tests run inside the real T3 APK; they never select a host or pair a bridge. */
public final class PixelBufferInstrumentation extends Instrumentation {
 private Method convert;
 private Bitmap bitmap(ByteBuffer pixels,int offset,int length,int width,int height,boolean transparent) throws Exception {
  return (Bitmap)convert.invoke(null,pixels,offset,length,width,height,transparent);
 }
 private static void check(boolean value,String message) { if(!value)throw new AssertionError(message); }
 private void rejected(ByteBuffer pixels,int offset,int length,int width,int height) throws Exception {
  try { bitmap(pixels,offset,length,width,height,false); throw new AssertionError("Invalid buffer accepted"); }
  catch(InvocationTargetException error) { if(!(error.getCause() instanceof IllegalArgumentException))throw error; }
 }
 @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
 @Override public void onStart() {
  Bundle result=new Bundle(); Activity activity=null;
  try {
   ClassLoader loader=getTargetContext().getClassLoader();
   Class<?> pixels=Class.forName("com.faceclaw.t3.T3Pixels",true,loader);
   convert=pixels.getMethod("bitmapBuffer",ByteBuffer.class,int.class,int.class,int.class,int.class,boolean.class);
   for(boolean direct:new boolean[]{false,true})for(boolean transparent:new boolean[]{false,true}) {
    ByteBuffer source=direct?ByteBuffer.allocateDirect(8):ByteBuffer.allocate(8);
    source.put(new byte[]{99,98,0,127,(byte)128,(byte)255,97,96}); source.position(1); source.limit(7);
    ByteBuffer view=source.asReadOnlyBuffer();
    Bitmap frame=bitmap(view,1,4,2,2,transparent);
    check(view.position()==1&&view.limit()==7,"Caller buffer cursor mutated");
    int[] expected={transparent?0:0xff000000,0xff7f7f7f,0xff808080,0xffffffff};
    for(int i=0;i<4;i++)check(frame.getPixel(i%2,i/2)==expected[i],"Grayscale, alpha, or offset changed");
    source.put(2,(byte)42); check(frame.getPixel(0,0)==expected[0],"Bitmap retained mutable buffer"); frame.recycle();
   }
   rejected(null,0,4,2,2); rejected(ByteBuffer.allocate(4),-1,4,2,2);
   rejected(ByteBuffer.allocate(4),Integer.MAX_VALUE,4,2,2); rejected(ByteBuffer.allocate(4),0,3,2,2);
   rejected(ByteBuffer.allocate(4),0,5,2,2); rejected(ByteBuffer.allocate(3),0,4,2,2);
   rejected(ByteBuffer.allocate(4),0,0,0,2); rejected(ByteBuffer.allocate(4),0,4,Integer.MAX_VALUE,2);
   rejected(ByteBuffer.allocate(4),0,4,640,481);
   bitmap(ByteBuffer.allocate(640*480),0,640*480,640,480,false).recycle();
   activity=startActivitySync(new Intent().setComponent(new ComponentName("com.faceclaw.t3","com.tns.NativeScriptActivity")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
   File script=new File(getTargetContext().getCacheDir(),"pixel-benchmark.js");
   try(java.io.InputStream input=getContext().getAssets().open("pixel-benchmark.js");FileOutputStream output=new FileOutputStream(script)) { byte[] block=new byte[8192];int size;while((size=input.read(block))!=-1)output.write(block,0,size); }
   final String[] measured={null};final Throwable[] failure={null};
   runOnMainSync(()->{
    try {
     Class<?> runtime=Class.forName("com.tns.Runtime",true,loader);
     Object instance=runtime.getMethod("getCurrentRuntime").invoke(null);
     measured[0]=String.valueOf(runtime.getMethod("runScript",File.class).invoke(instance,script));
    } catch(Throwable error) { failure[0]=error; }
   });
   script.delete(); if(failure[0]!=null)throw new AssertionError("NativeScript benchmark failed",failure[0]);
   result.putString("stream","PASS native colors/alpha, offset/position, read-only/direct buffers, snapshot ownership, 9 invalid inputs, maximum dimensions\nNativeScript bridge timing (milliseconds): "+measured[0]+"\n");
   finish(-1,result);
  } catch(Throwable error) { result.putString("stream","FAIL "+android.util.Log.getStackTraceString(error));finish(0,result); }
 }
}
