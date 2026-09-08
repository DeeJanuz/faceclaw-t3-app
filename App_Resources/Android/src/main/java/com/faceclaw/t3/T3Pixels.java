package com.faceclaw.t3;
import android.graphics.Bitmap;
import java.nio.ByteBuffer;
public final class T3Pixels {
 public static Bitmap bitmap(byte[] gray,int width,int height) { return bitmap(gray,width,height,false); }
 public static Bitmap extensionBitmap(byte[] gray,int width,int height) { return bitmap(gray,width,height,true); }
 /** NativeScript transfers the ArrayBuffer in one call; no per-pixel JS/Java writes. */
 public static Bitmap bitmapBuffer(ByteBuffer gray,int offset,int length,int width,int height,boolean transparent) {
  int count=frameSize(width,height);
  if(gray==null||offset<0||length!=count||offset>gray.remaining()-count)throw new IllegalArgumentException("Invalid frame buffer");
  // Duplicate preserves the caller's position/limit. Copy only the requested view and
  // finish synchronously; never retain the JS-backed buffer or access adjacent bytes.
  ByteBuffer view=gray.duplicate(); view.position(view.position()+offset);
  byte[] pixels=new byte[count]; view.get(pixels);
  return bitmap(pixels,width,height,transparent);
 }
 private static int frameSize(int width,int height) {
  if(width<1||height<1||width>640||height>480)throw new IllegalArgumentException("Invalid frame dimensions");
  return width*height;
 }
 private static Bitmap bitmap(byte[] gray,int width,int height,boolean transparent) {
  if(gray==null||gray.length!=frameSize(width,height))throw new IllegalArgumentException("Invalid frame");
  int[] colors=new int[gray.length];for(int i=0;i<gray.length;i++){int c=gray[i]&255;colors[i]=transparent&&c==0?0:0xff000000|(c<<16)|(c<<8)|c;}
  return Bitmap.createBitmap(colors,width,height,Bitmap.Config.ARGB_8888);
 }
 private T3Pixels() {}
}
