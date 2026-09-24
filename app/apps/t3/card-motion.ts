import type { GrayImage } from '../../graphics/image';
import type { CardRect } from '../../ui/card-presentation';
export { paintCardFace, paintFocusBrackets, type CardRect } from '../../ui/card-presentation';

export { WindowMotion, DURATION_MS as CARD_MOTION_MS, interpolateRect as cardRect } from '@faceclaw/motion';

/** Move the heading, then reveal stationary body pixels as the card unfolds.
 * Moving the entire text raster makes each Bluetooth update erase and resend
 * every line. Stable body coordinates let the display reuse already visible ink.
 */
export function paintCardContents(image: GrayImage, content: GrayImage, source: CardRect, target: CardRect): void {
  const inset = 8, headingHeight = 42;
  const copy = (sx: number, sy: number, dx: number, dy: number, width: number, height: number) => {
    const left = Math.max(0, -sx, -dx), right = Math.min(width, content.width - sx, image.width - dx);
    for (let row = Math.max(0, -sy, -dy); row < height && sy + row < content.height && dy + row < image.height; row++) {
      if (right <= left) break;
      const start = (sy + row) * content.width + sx + left;
      image.pixels.set(content.pixels.subarray(start, start + right - left), (dy + row) * image.width + dx + left);
    }
  };
  copy(source.x + inset, source.y + inset, target.x + inset, target.y + inset,
    Math.max(0, Math.min(source.width, target.width) - inset * 2),
    Math.max(0, Math.min(headingHeight - inset, target.height - inset * 2)));
  const left = Math.max(source.x + inset, target.x + inset);
  const top = Math.max(source.y + headingHeight, target.y + headingHeight);
  const right = Math.min(source.x + source.width - inset, target.x + target.width - inset);
  const bottom = Math.min(source.y + source.height - inset, target.y + target.height - inset);
  copy(left, top, left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}
