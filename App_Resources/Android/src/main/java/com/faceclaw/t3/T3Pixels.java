package com.faceclaw.t3;
import android.graphics.Bitmap;
public final class T3Pixels {
 public static Bitmap bitmap(byte[] gray,int width,int height) { return bitmap(gray,width,height,false); }
 public static Bitmap extensionBitmap(byte[] gray,int width,int height) { return bitmap(gray,width,height,true); }
 private static Bitmap bitmap(byte[] gray,int width,int height,boolean transparent) {
  if(width<1||height<1||width>640||height>480||gray==null||gray.length!=width*height)throw new IllegalArgumentException("Invalid frame");
  int[] colors=new int[gray.length];for(int i=0;i<gray.length;i++){int c=gray[i]&255;colors[i]=transparent&&c==0?0:0xff000000|(c<<16)|(c<<8)|c;}
  return Bitmap.createBitmap(colors,width,height,Bitmap.Config.ARGB_8888);
 }
 private T3Pixels() {}
}
