import { WindowMotion, DURATION_MS, type Rect, type MotionFrame } from '@faceclaw/motion';
import { GrayImage } from '../../graphics/image';
import { getDefaultSmallFont } from '../../graphics/ui-fonts';
import { notificationCardRect, paintNotificationCard } from './notification-card';
import type { Layer, LayerContext, PaintBelow } from '../layers';
import type { InputEvent } from '../gestures';
import { appViewportRect } from './geometry';
import { presentationNow } from '../presentation-clock';

/** A bounded arrival preview uses the same motion/content contract as app windows. */
// The host owns the normal expiry of a bound preview. This longer local
// watchdog only covers a lost host close or a provider that never receives the
// first frame; it must never beat a valid host lease at the configured deadline.
const HOST_EXPIRY_FALLBACK_GRACE_MS = 3000;
const OPEN_HANDOFF_TIMEOUT_MS = 8000;
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
  private openingDeadline = 0;
  private openingTimedOut = false;
  // Invalidates callbacks from a previous close/expiry when a replacement
  // preview reuses this layer. An old async result must never settle the new
  // notification.
  private operation = 0;
  private armed = false;
  private hostManaged: boolean;
  private startTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.removed) return;
      if (this.opening && Date.now() >= this.openingDeadline) {
        // Input cancels the host's ordinary lease. Keep a separate bounded
        // watchdog alive until the reader confirms that its window opened.
        this.opening = false;
        this.openingTimedOut = true;
        this.beginClose(this.expire);
        this.finishClose();
        return;
      }
      if (this.hostManaged && !this.opening && !this.closeAction && !this.settling && Date.now() >= this.deadline + HOST_EXPIRY_FALLBACK_GRACE_MS) {
        // A provider can lose the handoff response after the card's normal
        // window. Invalidate that open attempt before settling the fallback;
        // otherwise `finishClose` would intentionally wait forever for the
        // unresolved opening promise.
        this.opening = false;
        this.beginClose(this.expire);
        // This is a liveness fallback, so do not wait for a compositor
        // animation that may itself be the thing that was lost.
        this.finishClose();
      }
      if (!this.armed) return;
      // The host owns expiry for a bound preview. Its input path cancels the
      // host lease before forwarding the gesture to this layer, so a second
      // independent timer cannot win a tap that was already admitted there.
      if (!this.hostManaged && !this.closeAction && !this.settling && !this.opening && Date.now() >= this.deadline - DURATION_MS) this.beginClose(this.expire);
      this.repaint();
      // Also expire previews that were never painted or lost their render target.
      if (!this.hostManaged && !this.opening && ((Date.now() >= this.deadline && !this.motion) || Date.now() >= this.deadline + DURATION_MS)) this.finishClose();
    }, 1000);
  }
  constructor(private title: string, private text: string, private open: () => void,
    private dismiss: () => void | boolean | Promise<boolean>, private expire: () => void, private repaint: () => void,
    private readonly showBackdrop = true, durationMs = 5000, private readonly wokeDisplay = false, hostManaged = false) {
    this.durationMs = [3000, 5000, 7000, 10000].includes(durationMs) ? durationMs : 5000;
    this.hostManaged = hostManaged;
    this.deadline = Date.now() + this.durationMs;
    this.timer = null;
    this.startTimer();
  }
  currentRect(): Rect | undefined { return this.lastFrame ? { ...this.lastFrame.rect } : undefined; }
  isOpening(): boolean { return this.opening; }
  didOpeningTimeout(): boolean { return this.openingTimedOut; }
  update(title: string, text: string, restartWindow = false, durationMs?: number, hostManaged?: boolean): void {
    this.title = title; this.text = text;
    if (durationMs !== undefined && [3000, 5000, 7000, 10000].includes(durationMs)) this.durationMs = durationMs;
    if (hostManaged === true) this.hostManaged = true;
    if (restartWindow) {
      this.operation++;
      this.deadline = Date.now() + this.durationMs;
      // A new presentation gets a fresh interaction lease. This matters when
      // the previous card was waiting on an open/dismiss promise and had
      // already stopped its timer.
      this.opening = false;
      this.openingDeadline = 0;
      this.openingTimedOut = false;
      this.settling = false;
      this.closeAction = null;
      if (this.lastFrame && this.motion) {
        const box = appViewportRect('medium'), target = notificationCardRect(box); target.y = box.y + 12;
        this.motion?.retarget(target, false); this.closeAction = null; this.settling = false;
      }
      if (this.timer === null) this.startTimer();
    }
  }
  /** Align the visible progress bar with the host-owned surface lease. */
  setHostDeadline(deadlineMs: number): void {
    const now = Date.now();
    if (!this.hostManaged || this.removed || !Number.isFinite(deadlineMs) || deadlineMs < now - 1000 || deadlineMs > now + 15000) return;
    this.deadline = deadlineMs;
    this.armed = true;
    this.repaint();
  }
  private beginClose(action: () => void | boolean | Promise<boolean>): void {
    if (this.closeAction || this.settling || this.removed) return;
    this.operation++;
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
    this.openingDeadline = 0;
    this.openingTimedOut = false;
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
      const operation = this.operation;
      Promise.resolve(result).then(ok => {
        if (operation !== this.operation || this.removed) return;
        ok === false ? this.reopen() : this.onRemoved();
      }, () => {
        if (operation !== this.operation || this.removed) return;
        this.reopen();
      });
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
    if (event.type === 'click' || event.type === 'pointer-click' || (event.type === 'double-click' && this.wokeDisplay)) {
      if (this.opening) return;
      // The host has already stopped its ordinary lease on click. Keep the
      // local interval alive as a bounded handoff watchdog.
      this.opening = true;
      this.openingDeadline = Date.now() + OPEN_HANDOFF_TIMEOUT_MS;
      this.openingTimedOut = false;
      this.closeAction = null;
      this.open();
    }
    else if (event.type.startsWith('swipe-') || event.type.startsWith('scroll-') || event.type === 'double-click' || event.type === 'long-press' || event.type === 'short-then-long-press') this.beginClose(this.dismiss);
  }
  reopenAfterOpenFailure(): void {
    if (this.removed || !this.opening) return;
    this.opening = false;
    this.openingDeadline = 0;
    this.openingTimedOut = false;
    this.armed = true;
    // The close animation may already have retargeted the card above the
    // viewport. Reuse the normal reopen path so a failed destination leaves a
    // visible, tappable card instead of only restarting an invisible timer.
    if (this.motion) this.reopen();
    else {
      this.closeAction = null;
      this.settling = false;
      this.deadline = Date.now() + this.durationMs;
      this.repaint();
    }
    this.startTimer();
  }
  needsAnimation(): boolean {
    if (!this.motion || this.removed || this.opening) return false;
    const frame = this.motion.sample(presentationNow());
    if (frame) this.lastFrame = frame;
    if (frame?.done && frame.closing) { setTimeout(() => this.finishClose(), 0); return false; }
    return !frame?.done;
  }
  onRemoved(): void {
    this.operation++;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null; this.removed = true; this.armed = false; this.settling = false; this.opening = false; this.openingDeadline = 0; this.openingTimedOut = false; this.motion?.cancel(); this.motion = null; this.lastFrame = null; this.closeAction = null;
  }
}
