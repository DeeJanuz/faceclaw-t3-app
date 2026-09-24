import type { GrayImage, UiFont } from '../graphics/image';

export const CARD_TEXT_BRIGHTNESS = 190;

/** Inter 17px has a 20px line box; the preferred body pitch is 25px. */
export function cardLineStep(font: UiFont): number { return font.lineHeight + 5; }

export type CardRect = { x: number; y: number; width: number; height: number };

/** One bright outline avoids a doubled edge on the monochrome lens. */
export function paintCardFace(image: GrayImage, rect: CardRect): void {
  // Text and icons are deferred above their image raster. Bake the backdrop
  // before painting an opaque card so they cannot bleed through its face.
  image.bakeDeferredDrawsInPlace();
  image.fillRoundedRect(rect.x, rect.y, rect.width, rect.height, 1, 8);
  image.drawRoundedRect(rect.x, rect.y, rect.width, rect.height, 235, 8, 2);
}

/** Square brackets mark focus inside a card without competing with its outline.
 * `right` is the x of the right bracket's two-pixel bar. */
export function paintFocusBrackets(image: GrayImage, left: number, right: number, top: number, height = 24, value = 245): void {
  image.fillRect(left, top, 2, height, value);
  image.fillRect(right, top, 2, height, value);
  for (const y of [top, top + height - 2]) {
    image.fillRect(left, y, 8, 2, value);
    image.fillRect(right - 6, y, 8, 2, value);
  }
}
