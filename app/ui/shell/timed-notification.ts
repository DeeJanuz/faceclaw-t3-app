import { WindowMotion, DURATION_MS, type Rect, type MotionFrame } from '@faceclaw/motion';
import { GrayImage } from '../../graphics/image';
import { getDefaultSmallFont } from '../../graphics/ui-fonts';
import { notificationCardRect, paintNotificationCard } from './notification-card';
import type { Layer, LayerContext, PaintBelow } from '../layers';
import type { InputEvent } from '../gestures';
import { appViewportRect } from './geometry';
import { presentationNow } from '../presentation-clock';

/** A bounded arrival preview uses the same motion/content contract as app windows. */
export class TimedNotificationLayer implements Layer {
  readonly acceptsDirectional = true;
  private durationMs: number;
  private deadline: number;
  private timer: ReturnType<typeof setInterval> | null;
  private motion: WindowMotion | null = null;
  private lastFrame: MotionFrame | null = null;
  private viewport = '';
  private removed = false;
  private closeAction: (() => void | boolean | Promise<boolean>) | null = null;
  private settling = false;
  private opening = false;
  private armed = false;
  private startTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.removed) return;
      if (!this.armed) return;
      if (!this.closeAction && !this.settling && !this.opening && Date.now() >= this.deadline - DURATION_MS) this.beginClose(this.expire);
      this.repaint();
      // Also expire previews that were never painted or lost their render target.
      if (!this.opening && ((Date.now() >= this.deadline && !this.motion) || Date.now() >= this.deadline + DURATION_MS)) this.finishClose();
    }, 1000);
  }
  constructor(private title: string, private text: string, private open: () => void,
    private dismiss: () => void | boolean | Promise<boolean>, private expire: () => void, private repaint: () => void,
    private readonly showBackdrop = true, durationMs = 5000) {
    this.durationMs = [3000, 5000, 7000, 10000].includes(durationMs) ? durationMs : 5000;
    this.deadline = Date.now() + this.durationMs;
    this.timer = null;
    this.startTimer();
  }
  currentRect(): Rect | undefined { return this.lastFrame ? { ...this.lastFrame.rect } : undefined; }
  isOpening(): boolean { return this.opening; }
  update(title: string, text: string, restartWindow = false, durationMs?: number): void {
    this.title = title; this.text = text;
    if (durationMs !== undefined && [3000, 5000, 7000, 10000].includes(durationMs)) this.durationMs = durationMs;
    if (restartWindow) {
      this.deadline = Date.now() + this.durationMs;
      if (this.closeAction && this.lastFrame) {
        const box = appViewportRect('medium'), target = notificationCardRect(box); target.y = box.y + 12;
        this.motion?.retarget(target, false); this.closeAction = null; this.settling = false;
      }
    }
  }
  private beginClose(action: () => void | boolean | Promise<boolean>): void {
    if (this.closeAction || this.settling || this.removed) return;
    this.closeAction = action;
    if (this.lastFrame && this.motion) {
      const target = { ...this.lastFrame.rect, y: -this.lastFrame.rect.height };
      this.motion.retarget(target, true);
    }
    if (!this.motion) { this.finishClose(); return; }
    this.repaint();
  }
  private reopen(): void {
    if (this.removed) return;
    const box = appViewportRect('medium'), target = notificationCardRect(box); target.y = box.y + 12;
    this.deadline = Date.now() + this.durationMs;
    this.motion?.retarget(target, false);
    this.closeAction = null; this.settling = false;
    this.repaint();
  }
  private finishClose(): void {
    if (this.settling || this.removed || this.opening) return;
    const action = this.closeAction; this.closeAction = null;
    if (!action) return;
    let result: void | boolean | Promise<boolean>;
    try { result = action(); } catch { result = false; }
    if (result && typeof (result as Promise<boolean>).then === 'function') {
      this.settling = true;
      Promise.resolve(result).then(ok => ok === false ? this.reopen() : this.onRemoved(), () => this.reopen());
      return;
    }
    if (result === false) { this.reopen(); return; }
    this.onRemoved();
  }
  paint(ctx: LayerContext, below: PaintBelow): GrayImage {
    const size = ctx.stack.getBaseSize();
    const image = this.showBackdrop ? below() : new GrayImage(size.width, size.height, 0);
    if (this.removed) return image;
    const key = `${size.width}:${size.height}`;
    const box = appViewportRect('medium'), target = notificationCardRect(box); target.y = box.y + 12;
    if (this.viewport && this.viewport !== key) { this.onRemoved(); this.expire(); return image; }
    this.viewport = key;
    // The first admitted frame must contain tappable notification pixels. A
    // render-credit round trip can occasionally stall after that frame while
    // the glasses wake. Starting at the top edge keeps the card visible for
    // its full lease; later credits still animate it down to the resting row.
    if (!this.motion) this.motion = new WindowMotion({ ...target, y: Math.min(0, target.y) }, target);
    const frame = this.motion.sample(presentationNow());
    if (frame) this.lastFrame = frame;
    const current = this.lastFrame!;
    if (!this.armed) { this.armed = true; this.deadline = Date.now() + this.durationMs; }
    if (current.done && current.closing) { this.finishClose(); return image; }
    paintNotificationCard(image, current.rect, getDefaultSmallFont(), {
      title: this.title, text: this.text, bodyVisible: current.bodyVisible,
      progress: (this.deadline - Date.now()) / this.durationMs,
    });
    return image;
  }
  handleInput(event: InputEvent): void {
    if (this.removed) return;
    if (event.type === 'click') {
      if (this.opening) return;
      // The host has already stopped its lease on click. Stop this local
      // timeout before handing the notification to the normal T3 window.
      this.opening = true;
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
      this.closeAction = null;
      this.open();
    }
    else if (event.type.startsWith('swipe-') || event.type.startsWith('scroll-') || event.type === 'double-click' || event.type === 'short-then-long-press') this.beginClose(this.dismiss);
  }
  reopenAfterOpenFailure(): void {
    if (this.removed || !this.opening) return;
    this.opening = false;
    this.armed = true;
    this.closeAction = null;
    this.settling = false;
    this.deadline = Date.now() + this.durationMs;
    this.startTimer();
    this.repaint();
  }
  needsAnimation(): boolean {
    if (!this.motion || this.removed || this.opening) return false;
    const frame = this.motion.sample(presentationNow());
    if (frame) this.lastFrame = frame;
    if (frame?.done && frame.closing) { setTimeout(() => this.finishClose(), 0); return false; }
    return !frame?.done;
  }
  onRemoved(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null; this.removed = true; this.armed = false; this.settling = false; this.motion?.cancel(); this.motion = null; this.lastFrame = null; this.closeAction = null;
  }
}
