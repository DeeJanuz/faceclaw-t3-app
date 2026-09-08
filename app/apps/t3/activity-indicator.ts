import type { GrayImage, UiFont } from '../../graphics/image';
import { truncateText } from '../../graphics/textwrap';
import { CARD_TEXT_BRIGHTNESS } from '../../ui/card-presentation';

export const ACTIVITY_INDICATOR_SIZE = 22;
const SPOKES = [
  [9, 0, 4, 6], [16, 3, 4, 4], [16, 9, 6, 4], [16, 16, 4, 4],
  [9, 16, 4, 6], [3, 16, 4, 4], [0, 9, 6, 4], [3, 3, 4, 4],
] as const;

/** Pixel geometry stays legible even when the chosen font has tiny spinner glyphs. */
export function paintActivityIndicator(image: GrayImage, font: UiFont, x: number, y: number,
  width: number, rowHeight: number, label: string, frame: number): void {
  const size = Math.min(ACTIVITY_INDICATOR_SIZE, rowHeight);
  const scale = size / ACTIVITY_INDICATOR_SIZE;
  const top = y + Math.floor((rowHeight - size) / 2);
  const phase = ((Math.floor(frame) % 8) + 8) % 8;
  SPOKES.forEach(([sx, sy, sw, sh], index) => {
    const age = (phase - index + 8) % 8;
    const value = age === 0 ? CARD_TEXT_BRIGHTNESS : age === 1 ? 155 : age === 2 ? 120 : 70;
    image.fillRect(x + Math.round(sx * scale), top + Math.round(sy * scale),
      Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)), value);
  });
  const labelX = x + size + 8;
  image.drawText(font, labelX, y, truncateText(font, label, Math.max(0, width - size - 8)), CARD_TEXT_BRIGHTNESS);
}
