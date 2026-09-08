import type { GrayImage } from '../../graphics/image';
import type { CardRect } from '../../ui/card-presentation';
export { paintCardFace, CARD_FRAME_MS, type CardRect } from '../../ui/card-presentation';

export const CARD_MOTION_MS = 360;
const ease = (n: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, n)), 3);

/** Width leads height slightly, giving the outline a soft unfolding motion. */
export function cardRect(from: CardRect, to: CardRect, progress: number): CardRect {
  const horizontal = ease(progress / .78);
  const vertical = ease((progress - .1) / .9);
  return {
    x: Math.round(from.x + (to.x - from.x) * horizontal),
    y: Math.round(from.y + (to.y - from.y) * vertical),
    width: Math.round(from.width + (to.width - from.width) * horizontal),
    height: Math.max(2, Math.round(from.height + (to.height - from.height) * vertical)),
  };
}

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

/** A two-pixel chevron marks the single ring-selected control. */
export function paintSelectionChevron(image: GrayImage, x: number, centerY: number, value = 245): void {
  const y = Math.round(centerY);
  for (let offset = 0; offset < 2; offset++) {
    image.drawLine(x + offset, y - 4, x + 4 + offset, y, value);
    image.drawLine(x + 4 + offset, y, x + offset, y + 4, value);
  }
}
