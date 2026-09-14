package com.faceclaw.t3;

import android.graphics.Bitmap;
import java.nio.ByteBuffer;

/** Phone-only preview conversion. Glasses frames never pass through this class. */
public final class T3PreviewPixels {
 private static Bitmap bitmap;
 private static int[] colors;
 public static synchronized Bitmap bitmapBuffer(ByteBuffer gray,int offset,int length,int width,int height) {
  if(gray==null||width<1||height<1||width>640||height>480||length!=width*height||offset<0)throw new IllegalArgumentException("Invalid preview frame");
  ByteBuffer view=gray.duplicate();int start=view.position()+offset;if(start<view.position()||start+length>view.limit())throw new IllegalArgumentException("Invalid preview buffer");view.position(start);view.limit(start+length);
  if(bitmap==null||bitmap.getWidth()!=width||bitmap.getHeight()!=height){bitmap=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);colors=new int[length];}
  for(int i=0;i<length;i++){int c=view.get()&255;colors[i]=0xff000000|(c<<16)|(c<<8)|c;}
  bitmap.setPixels(colors,0,width,0,0,width,height);return bitmap;
 }
 public static synchronized void release() {
  // Drop the cache after the page clears its ImageSource. Do not recycle the
  // Bitmap here: Android's ImageView may still be finishing its final draw.
  bitmap=null;colors=null;
 }
 private T3PreviewPixels() {}
}
