import { CARD_FRAME_MS } from '../card-presentation';
import { GrayImage } from '../../graphics/image';
import { getDefaultSmallFont } from '../../graphics/ui-fonts';
import { notificationCardRect, paintNotificationCard } from './notification-card';
import type { Layer, LayerContext, PaintBelow } from '../layers';
import type { InputEvent } from '../gestures';
import { appViewportRect } from './geometry';

/** Five-second silent preview. It never removes the inbox entry on timeout. */
export class TimedNotificationLayer implements Layer {
  readonly acceptsDirectional = true;
  private readonly started = Date.now();
  private deadline = this.started + 5000;
  private timer: ReturnType<typeof setInterval> | null;
  constructor(private title: string, private text: string, private open: () => void,
    private dismiss: () => void, expire: () => void, repaint: () => void, private readonly showBackdrop = true) {
    this.timer = setInterval(() => { if (Date.now() >= this.deadline) expire(); else repaint(); }, CARD_FRAME_MS);
  }
  update(title: string, text: string, restartWindow = false): void {
    this.title = title; this.text = text;
    if (restartWindow) this.deadline = Date.now() + 5000;
  }
  paint(ctx: LayerContext, below: PaintBelow): GrayImage {
    const size = ctx.stack.getBaseSize();
    // Awake arrivals overlay the existing planes. A notification-only wake
    // keeps the sleeping app hidden until the user explicitly opens content.
    const image = this.showBackdrop ? below() : new GrayImage(size.width, size.height, 0);
    const box = appViewportRect('medium');
    const font = getDefaultSmallFont();
    const elapsed = Date.now() - this.started;
    const progress = Math.min(1, elapsed / 300, Math.max(0, (this.deadline - Date.now()) / 300));
    const rect = notificationCardRect(box);
    rect.y = box.y + 12;
    rect.y -= Math.round((1 - progress) ** 3 * rect.height);
    paintNotificationCard(image, rect, font, { title: this.title, text: this.text, progress: (this.deadline - Date.now()) / 5000 });
    return image;
  }
  handleInput(event: InputEvent): void {
    if (event.type === 'click') this.open();
    else if (event.type.startsWith('swipe-') || event.type.startsWith('scroll-') || event.type === 'double-click' || event.type === 'short-then-long-press') this.dismiss();
  }
  onRemoved(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
