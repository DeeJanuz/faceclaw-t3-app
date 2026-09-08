(function () {
  const results = [];
  const pixelsApi = com.faceclaw.t3.T3Pixels;
  for (const size of [[576, 260], [576, 452], [640, 480]]) {
    const width = size[0], height = size[1], length = width * height;
    const storage = new Uint8Array(length + 34), pixels = storage.subarray(17, 17 + length);
    for (let i = 0; i < length; i++) pixels[i] = i & 255;
    function oldConversion() {
      const bytes = Array.create('byte', length);
      for (let i = 0; i < length; i++) bytes[i] = pixels[i] > 127 ? pixels[i] - 256 : pixels[i];
      return pixelsApi.bitmap(bytes, width, height);
    }
    function bulkConversion() { return pixelsApi.bitmapBuffer(pixels.buffer, pixels.byteOffset, pixels.byteLength, width, height, false); }
    for (let i = 0; i < 3; i++) { oldConversion().recycle(); bulkConversion().recycle(); }
    const oldTimes = [], bulkTimes = [];
    for (let i = 0; i < 15; i++) {
      // Alternate order to reduce warm-up, thermal and collection-order bias.
      for (const variant of i % 2 ? ['bulk', 'old'] : ['old', 'bulk']) {
        const start = java.lang.System.nanoTime();
        const bitmap = variant === 'old' ? oldConversion() : bulkConversion();
        const elapsed = (java.lang.System.nanoTime() - start) / 1000000;
        (variant === 'old' ? oldTimes : bulkTimes).push(elapsed);
        if (bitmap.getPixel(1, 0) !== (0xff010101 | 0)) throw new Error('Measured frame changed pixels');
        bitmap.recycle();
      }
    }
    function stats(values) { const sorted = values.slice().sort((a, b) => a - b); return { median: sorted[7], p95: sorted[14] }; }
    const old = stats(oldTimes), bulk = stats(bulkTimes);
    results.push({ width, height, samples: 15, old, bulk, medianSpeedup: old.median / bulk.median });
  }
  return JSON.stringify(results);
})();
