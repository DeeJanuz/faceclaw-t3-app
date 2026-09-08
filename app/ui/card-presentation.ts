import type { GrayImage, UiFont } from '../graphics/image';

export const CARD_FRAME_MS = 40;
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
