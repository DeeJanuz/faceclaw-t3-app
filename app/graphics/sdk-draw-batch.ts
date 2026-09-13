import { grayToNibble, type DeferredDraw, type GrayImage } from "./image";

const RECORD_BYTES = 9;
let resourceEpoch = -1;
const resourceIds = new Map<string, number>();
const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;

export type SdkRetainedScene = {
  patch: Uint8Array;
  patchX: number;
  patchY: number;
  patchWidth: number;
  patchHeight: number;
  draws: Uint8Array | null;
};

/**
 * Encodes T3's existing retained glyph/image information for SDK 1.0. The
 * caller still bakes those same draws into Gray8, so optional host metadata
 * can be dropped without changing a pixel.
 */
export function encodeSdkDrawBatch(service: any, image: GrayImage, retainedDraws: readonly DeferredDraw[] = image.draws): Uint8Array | null {
  const draws = retainedDraws;
  if (!draws.length || !service) return null;
  const epoch = Number(service.getResourceEpoch?.() ?? 0);
  if (epoch !== resourceEpoch) {
    resourceEpoch = epoch;
    resourceIds.clear();
  }
  const records: Array<{ id: number; x: number; y: number }> = [];
  for (const draw of draws) {
    const registered = registerDraw(service, draw);
    if (registered) records.push(registered);
  }
  if (!records.length) return null;
  const bytes = new Uint8Array(records.length * RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  records.forEach((record, index) => {
    const offset = index * RECORD_BYTES;
    view.setUint32(offset, record.id, true);
    view.setInt16(offset + 4, record.x, true);
    view.setInt16(offset + 6, record.y, true);
    view.setUint8(offset + 8, 255);
  });
  return bytes;
}

/** Convert a stable single-plane T3 screen into a retained raster patch plus resource nodes. */
export function encodeSdkRetainedScene(service: any, source: GrayImage): SdkRetainedScene | null {
  if (source.draws.some(draw => draw.kind === "fwtext")) return null;
  const draws = encodeSdkDrawBatch(service, source, source.draws);
  const expectedDraws = source.draws.filter(draw => draw.kind === "image" || (draw.kind === "glyph" && draw.glyph.bbxWidth > 0 && draw.glyph.bbxHeight > 0)).length;
  if ((draws?.byteLength ?? 0) !== expectedDraws * RECORD_BYTES) return null;
  let left = source.width, top = source.height, right = -1, bottom = -1;
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    if (source.pixels[y * source.width + x] === 0) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left) return { patch: new Uint8Array(0), patchX: 0, patchY: 0, patchWidth: 0, patchHeight: 0, draws };
  const width = right - left + 1, height = bottom - top + 1;
  const patch = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) patch.set(source.pixels.subarray((top + y) * source.width + left, (top + y) * source.width + left + width), y * width);
  // Leave headroom for Bundle/node framing beneath the stable 256 KiB command limit.
  if (patch.byteLength + (draws?.byteLength ?? 0) + expectedDraws * 160 > 240 * 1024) return null;
  return { patch, patchX: left, patchY: top, patchWidth: width, patchHeight: height, draws };
}

function registerDraw(service: any, draw: DeferredDraw): { id: number; x: number; y: number } | null {
  if (draw.kind === "fwtext") return null;
  if (draw.kind === "image") {
    const source = draw.source.withDrawsBaked();
    const key = `image:${objectId(draw.source)}:${source.width}x${source.height}`;
    const id = register(service, key, source.pixels, source.width, source.height, false);
    return id ? { id, x: draw.x, y: draw.y } : null;
  }
  const glyph = draw.glyph;
  if (glyph.bbxWidth <= 0 || glyph.bbxHeight <= 0) return null;
  const pixels = glyphPixels(draw);
  const fontKey = draw.font.atlasKey ?? `process-${objectId(draw.font)}`;
  const key = `glyph:${fontKey}:${objectId(glyph)}:${glyph.encoding}:${draw.value}:${glyph.bbxWidth}x${glyph.bbxHeight}`;
  const id = register(service, key, pixels, glyph.bbxWidth, glyph.bbxHeight, true);
  return id ? {
    id,
    x: draw.x + glyph.bbxX,
    y: draw.y + draw.font.ascent - (glyph.bbxHeight + glyph.bbxY),
  } : null;
}

function objectId(value: object): number {
  const existing = objectIds.get(value);
  if (existing) return existing;
  const id = nextObjectId++;
  objectIds.set(value, id);
  return id;
}

function register(service: any, key: string, pixels: Uint8Array, width: number, height: number, glyph: boolean): number {
  const cached = resourceIds.get(key);
  if (cached) return cached;
  const id = Number(service.registerGrayResource(key, pixels.buffer, pixels.byteOffset, pixels.byteLength, width, height, glyph));
  if (id > 0) resourceIds.set(key, id);
  return id;
}

function glyphPixels(draw: Extract<DeferredDraw, { kind: "glyph" }>): Uint8Array {
  const glyph = draw.glyph;
  const pixels = new Uint8Array(glyph.bbxWidth * glyph.bbxHeight);
  if (glyph.coverage) {
    const top = grayToNibble(draw.value);
    for (let i = 0; i < pixels.length; i++) pixels[i] = Math.floor(((glyph.coverage[i] ?? 0) * top) / 15) * 16;
    return pixels;
  }
  const rowBitWidth = ((glyph.bbxWidth + 7) >> 3) << 3;
  for (let row = 0; row < glyph.bbxHeight; row++) {
    const bits = glyph.bitmapRows[row] ?? 0;
    for (let col = 0; col < glyph.bbxWidth; col++) {
      if (((bits >> (rowBitWidth - 1 - col)) & 1) !== 0) pixels[row * glyph.bbxWidth + col] = draw.value;
    }
  }
  return pixels;
}
