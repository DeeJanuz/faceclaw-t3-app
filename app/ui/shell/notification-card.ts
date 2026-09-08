import { CARD_TEXT_BRIGHTNESS, cardLineStep } from '../card-presentation';
import type { GrayImage, UiFont } from '../../graphics/image';
import { truncateText, wrapText } from '../../graphics/textwrap';
import { paintCardFace, type CardRect } from '../card-presentation';

/** The arrival preview and inbox share a compact card in either viewport mode. */
export function notificationCardRect(viewport: CardRect): CardRect {
  return { x: viewport.x + Math.round((viewport.width - 576) / 2) + 16,
    y: viewport.y + Math.round((viewport.height - 288) / 2) + 12, width: 544, height: 104 };
}

export function paintNotificationCard(image: GrayImage, rect: CardRect, font: UiFont,
  content: { title: string; text: string; counter?: string; progress?: number }): void {
  paintCardFace(image, rect);
  const left = rect.x + 14;
  const width = rect.width - 28;
  const counterWidth = content.counter ? font.measureText(content.counter) : 0;
  image.drawText(font, left, rect.y + 12, truncateText(font, content.title, width - (counterWidth ? counterWidth + 14 : 0)), CARD_TEXT_BRIGHTNESS);
  if (content.counter) image.drawText(font, left + width - counterWidth, rect.y + 12, content.counter, 170);
  const bodyTop = 39;
  const lineHeight = cardLineStep(font);
  const bodyBottom = rect.height - 14;
  const lineCount = Math.max(0, Math.min(2, 1 + Math.floor((bodyBottom - bodyTop - font.lineHeight) / lineHeight)));
  wrapText(font, content.text, width).slice(0, lineCount).forEach((line, i) => image.drawText(font, left, rect.y + bodyTop + i * lineHeight, line, CARD_TEXT_BRIGHTNESS));
  if (content.progress !== undefined) image.fillRect(left, rect.y + rect.height - 9, Math.round(width * Math.max(0, Math.min(1, content.progress))), 2, 150);
}
