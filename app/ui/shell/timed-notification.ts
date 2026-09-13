import { WindowMotion, DURATION_MS, type Rect, type MotionFrame } from '@faceclaw/motion';
import { GrayImage } from '../../graphics/image';
import { getDefaultSmallFont } from '../../graphics/ui-fonts';
import { notificationCardRect, paintNotificationCard } from './notification-card';
import type { Layer, LayerContext, PaintBelow } from '../layers';
import type { InputEvent } from '../gestures';
import { appViewportRect } from './geometry';
import { presentationNow } from '../presentation-clock';

/** A five-second arrival uses the same motion/content contract as app windows. */
export class TimedNotificationLayer implements Layer {
  readonly acceptsDirectional = true;
  private deadline = Date.now() + 5000;
  private timer: ReturnType<typeof setInterval> | null;
  private motion: WindowMotion | null = null;
  private lastFrame: MotionFrame | null = null;
  private viewport = '';
  private removed = false;
  private closeAction: (() => void) | null = null;
  constructor(private title: string, private text: string, private open: () => void,
    private dismiss: () => void, private expire: () => void, private repaint: () => void, private readonly showBackdrop = true) {
    this.timer = setInterval(() => {
      if (this.removed) return;
      if (!this.closeAction && Date.now() >= this.deadline - DURATION_MS) this.beginClose(this.expire);
      this.repaint();
      // Also expire previews that were never painted or lost their render target.
      if ((Date.now() >= this.deadline && !this.motion) || Date.now() >= this.deadline + DURATION_MS) this.finishClose();
    }, 1000);
  }
  currentRect(): Rect | undefined { return this.lastFrame ? { ...this.lastFrame.rect } : undefined; }
  update(title: string, text: string, restartWindow = false): void {
    this.title = title; this.text = text;
    if (restartWindow) {
      this.deadline = Date.now() + 5000;
      if (this.closeAction && this.lastFrame) {
        const box = appViewportRect('medium'), target = notificationCardRect(box); target.y = box.y + 12;
        this.motion?.retarget(target, false); this.closeAction = null;
      }
    }
  }
  private beginClose(action: () => void): void {
    if (this.closeAction || this.removed) return;
    this.closeAction = action;
    if (this.lastFrame && this.motion) {
      const target = { ...this.lastFrame.rect, y: -this.lastFrame.rect.height };
      this.motion.retarget(target, true);
    }
    if (!this.motion) { this.finishClose(); return; }
    this.repaint();
  }
  private finishClose(): void {
    const action = this.closeAction; this.closeAction = null;
    if (!action || this.removed) return;
    this.onRemoved(); action();
  }
  paint(ctx: LayerContext, below: PaintBelow): GrayImage {
    const size = ctx.stack.getBaseSize();
    const image = this.showBackdrop ? below() : new GrayImage(size.width, size.height, 0);
    if (this.removed) return image;
    const key = `${size.width}:${size.height}`;
    const box = appViewportRect('medium'), target = notificationCardRect(box); target.y = box.y + 12;
    if (this.viewport && this.viewport !== key) { this.onRemoved(); this.expire(); return image; }
    this.viewport = key;
    if (!this.motion) this.motion = new WindowMotion({ ...target, y: -target.height }, target);
    const frame = this.motion.sample(presentationNow());
    if (frame) this.lastFrame = frame;
    const current = this.lastFrame!;
    if (current.done && current.closing) { this.finishClose(); return image; }
    paintNotificationCard(image, current.rect, getDefaultSmallFont(), {
      title: this.title, text: this.text, bodyVisible: current.bodyVisible,
      progress: (this.deadline - Date.now()) / 5000,
    });
    return image;
  }
  handleInput(event: InputEvent): void {
    if (this.removed) return;
    if (event.type === 'click') this.open();
    else if (event.type.startsWith('swipe-') || event.type.startsWith('scroll-') || event.type === 'double-click' || event.type === 'short-then-long-press') this.beginClose(this.dismiss);
  }
  needsAnimation(): boolean {
    if (!this.motion || this.removed) return false;
    const frame = this.motion.sample(presentationNow());
    if (frame) this.lastFrame = frame;
    if (frame?.done && frame.closing) { setTimeout(() => this.finishClose(), 0); return false; }
    return !frame?.done;
  }
  onRemoved(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null; this.removed = true; this.motion?.cancel(); this.motion = null; this.lastFrame = null; this.closeAction = null;
  }
}
