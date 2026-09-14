import { CARD_TEXT_BRIGHTNESS, cardLineStep } from '../card-presentation';
import { GrayImage } from "../../graphics/image";
import { getDefaultSmallFont } from "../../graphics/ui-fonts";
import { paginateMessageText, reflowDictationText } from "../../apps/t3/hub-view-model";
import { voiceControlBridge, type VoiceTranscriptEvent } from "../../native/voice-control";
import type { AnthropicStreamHandle } from "../../native/anthropic";
import { type InputEvent } from "../gestures";
import { type Layer, type LayerActions, type LayerContext } from "../layers";
import { appViewportRect } from "./geometry";
import { cardRect, paintCardFace, paintCardContents, CARD_MOTION_MS, type CardRect } from "../../apps/t3/card-motion";
import { presentationNow } from "../presentation-clock";

const FINAL_TIMEOUT_MS = 95000;
const EXPANSION_MS = CARD_MOTION_MS;

type T3DictationOptions = {
  actions: LayerActions;
  /** Starting control bounds in app-content coordinates. */
  origin?: CardRect;
  /** Explicit dashboard renderer only. Never pass a conversation or lower layer. */
  paintDashboard?: (width: number, height: number) => GrayImage;
  dismiss: () => void;
  onClosed: () => void;
  /** Called after the sole review surface's send tap. */
  onDraft: (text: string) => void;
  onCancelled: () => void;
  refine?: (options: { original: string; followup: string; onDone: (text: string) => void; onError: (error: string) => void }) => AnthropicStreamHandle;
};

/** T3's direct capture surface, independent of the shell's generic send menu. */
export class T3DictationLayer implements Layer {
  private phase: "capturing" | "finalizing" | "review" | "continuing" | "finalizing-refinement" | "refining" | "error" | "closing" = "capturing";
  private text = "";
  private cachedLayout: { source: string; font: ReturnType<typeof getDefaultSmallFont>; width: number; height: number; pages: string[][]; lines: string[] } | null = null;
  private motionContent: GrayImage | null = null;
  private backdrop: GrayImage | null = null;
  private error = "";
  private capturing = false;
  private removed = false;
  private delivered = false;
  private startedAt = Date.now();
  private expansionStartedAt: number | null = null;
  private closedAt = 0;
  private lastRenderedSecond = -1;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  private refinement: AnthropicStreamHandle | null = null;
  private baseText = "";
  private operation = 0;
  private reviewPage = 0;
  private unsubscribeTranscript: (() => void) | null = null;
  private unsubscribeStatus: (() => void) | null = null;

  constructor(private readonly options: T3DictationOptions) {}

  isAnimatingCard(): boolean {
    return !this.removed && (this.phase === "closing" ? presentationNow() - this.closedAt < CARD_MOTION_MS
      : this.expansionStartedAt === null || presentationNow() - this.expansionStartedAt < CARD_MOTION_MS);
  }

  needsAnimation(): boolean {
    if (this.phase === "closing" && presentationNow() - this.closedAt >= EXPANSION_MS) {
      if (!this.removed) this.options.dismiss();
      return false;
    }
    return this.isAnimatingCard();
  }

  invalidateBackdrop(): void { this.backdrop = null; }

  startCapture(): void {
    if (this.removed || this.capturing) return;
    this.startedAt = Date.now();
    this.expansionStartedAt = null;
    this.capturing = true;
    this.unsubscribeTranscript = voiceControlBridge.onTranscript(event => this.onTranscript(event));
    // onStatus replays the preceding capture's status upon subscription.
    // Ignore that replay; only events emitted after this capture starts apply.
    let subscribing = true;
    this.unsubscribeStatus = voiceControlBridge.onStatus(state => {
      if (subscribing || this.removed || this.phase === "closing") return;
      if (/^Ignored|^T3_STT_UNAVAILABLE|not downloaded|needs an active|Could not start|Voice control failed/i.test(state.status)) {
        this.fail(/^Ignored/i.test(state.status) ? "Voice not recognized. Nothing sent." : "Dictation unavailable. Nothing sent.");
      }
    });
    subscribing = false;
    // Only the elapsed-seconds label is timer driven. Card motion itself asks
    // for its next host render credit through the submitted frame.
    this.elapsedTimer = setInterval(() => {
      if (this.removed || this.isAnimatingCard()) return;
      const second = Math.floor((Date.now() - this.startedAt) / 1000);
      if (this.lastRenderedSecond === second) return;
      this.lastRenderedSecond = second;this.options.actions.requestRender();
    }, 1000);
    try {
      void Promise.resolve(this.options.actions.startVoiceCapture(false)).catch(() => this.fail("Could not start dictation. Nothing sent."));
    } catch {
      this.fail("Could not start dictation. Nothing sent.");
    }
    this.options.actions.requestRender();
  }

  /** Set finalizing before stopping: the native recognizer can finish synchronously. */
  endCapture(): void {
    if (this.removed || !this.capturing || this.phase !== "capturing") return;
    this.capturing = false;
    this.phase = "finalizing";
    this.motionContent = null;
    this.finalizeTimer = setTimeout(() => this.fail("Transcript timed out. Nothing sent."), FINAL_TIMEOUT_MS);
    this.stopCapture();
    this.options.actions.requestRender();
  }

  private stopCapture(): void {
    try {
      void Promise.resolve(this.options.actions.stopVoiceCapture()).catch(() => this.fail("Could not finish dictation. Nothing sent."));
    } catch {
      this.fail("Could not finish dictation. Nothing sent.");
    }
  }

  private onTranscript(event: VoiceTranscriptEvent): void {
    if (this.removed || this.phase === "closing" || this.phase === "error" || this.delivered) return;
    if (this.phase === "refining" || this.phase === "review") return;
    // Events contain the entire current utterance, not incremental deltas.
    this.text = event.text.trim();
    this.cachedLayout = null;
    this.motionContent = null;
    if (event.isFinal && this.phase === "finalizing") {
      // Empty finals are authoritative, including speaker-verification rejection.
      // Never replace them with the earlier, unverified partial transcript.
      if (!this.text) {
        this.fail("No speech captured. Nothing sent.");
        return;
      }
      this.phase = "review";
      this.reviewPage = 0;
      this.error = "";
      if (this.finalizeTimer !== null) clearTimeout(this.finalizeTimer);
      this.finalizeTimer = null;
      this.options.actions.requestRender();
      return;
    }
    if (event.isFinal && this.phase === "finalizing-refinement") {
      if (!this.text) {
        this.restoreRefinementFailure("No edit instruction was captured");
        return;
      }
      this.beginRefinement();
      return;
    }
    this.options.actions.requestRender();
  }

  private fail(message: string): void {
    if (this.removed || this.delivered || this.phase === "closing" || this.phase === "error") return;
    if (this.phase === "continuing" || this.phase === "finalizing-refinement" || this.phase === "refining") {
      this.restoreRefinementFailure(message);
      return;
    }
    this.phase = "error";
    this.error = message;
    this.text = "";
    this.cachedLayout = null;
    this.motionContent = null;
    if (this.finalizeTimer !== null) clearTimeout(this.finalizeTimer);
    this.finalizeTimer = null;
    this.refinement?.cancel();
    this.refinement = null;
    if (this.capturing) {
      this.capturing = false;
      this.stopCapture();
    }
    this.options.actions.requestRender();
  }

  handleInput(event: InputEvent): void {
    if (this.removed || this.phase === "closing") return;
    if (event.type === "double-click" || (event.type === "click" && this.phase === "error")) {
      this.phase = "closing";
      this.closedAt = presentationNow();
      this.backdrop = null;
      this.text = "";
      this.cachedLayout = null;
      this.motionContent = null;
      if (this.capturing) {
        this.capturing = false;
        this.stopCapture();
      }
      this.options.actions.requestRender();
    } else if (this.phase === "review" && (event.type === "swipe-down" || event.type === "scroll-down")) {
      this.startContinuation();
    } else if (this.phase === "review" && (event.type === "swipe-up" || event.type === "scroll-up")) {
      this.nextReviewPage();
    } else if (this.phase === "review" && event.type === "click") {
      this.sendDraft();
    } else if (this.phase === "continuing" && event.type === "click") {
      this.endContinuation();
    } else if (this.phase === "refining") {
      return;
    } else if (event.type === "click") {
      this.endCapture();
    }
  }

  private sendDraft(): void {
    if (this.delivered || !this.text.trim()) return;
    const draft = this.text.trim();
    this.delivered = true;
    this.options.dismiss();
    this.options.onDraft(draft);
  }

  private startContinuation(): void {
    if (this.removed || this.phase !== "review" || !this.text.trim()) return;
    this.baseText = this.text.trim();
    this.text = "";
    this.error = "";
    this.reviewPage = 0;
    this.phase = "continuing";
    this.capturing = true;
    try {
      void Promise.resolve(this.options.actions.startVoiceCapture(false)).catch(() => this.fail("Could not start refinement. Nothing sent."));
    } catch {
      this.fail("Could not start refinement. Nothing sent.");
    }
    this.options.actions.requestRender();
  }

  private endContinuation(): void {
    if (!this.capturing || this.phase !== "continuing") return;
    this.capturing = false;
    this.phase = "finalizing-refinement";
    this.finalizeTimer = setTimeout(() => this.restoreRefinementFailure("Edit transcription timed out"), FINAL_TIMEOUT_MS);
    this.stopCapture();
    this.options.actions.requestRender();
  }

  private beginRefinement(): void {
    if (this.removed || this.phase !== "finalizing-refinement") return;
    if (this.finalizeTimer !== null) clearTimeout(this.finalizeTimer);
    this.finalizeTimer = null;
    const followup = this.text.trim();
    if (!followup) { this.restoreRefinementFailure("No edit instruction was captured"); return; }
    this.phase = "refining";
    this.text = "";
    this.reviewPage = 0;
    if (!this.options.refine) {
      this.restoreRefinementFailure("Luna refinement is not configured");
      return;
    }
    const operation = ++this.operation;
    let handle: AnthropicStreamHandle;
    try {
      handle = this.options.refine({
        original: this.baseText,
        followup,
        onDone: text => {
          if (this.removed || this.phase !== "refining" || operation !== this.operation) return;
          this.refinement = null;
          const revised = text.trim();
          if (!revised) { this.restoreRefinementFailure("Luna returned empty text"); return; }
          this.text = revised;
          this.error = "";
          this.reviewPage = 0;
          this.phase = "review";
          this.cachedLayout = null;
          this.options.actions.requestRender();
        },
        onError: error => {
          if (this.removed || this.phase !== "refining" || operation !== this.operation) return;
          this.refinement = null;
          this.restoreRefinementFailure(this.refinementError(error));
        },
      });
    } catch (error) {
      this.restoreRefinementFailure(this.refinementError(error instanceof Error ? error.message : String(error)));
      return;
    }
    if (this.removed || this.phase !== "refining" || operation !== this.operation) handle.cancel();
    else this.refinement = handle;
    this.options.actions.requestRender();
  }

  private refinementError(error: unknown): string {
    const code = String(error || "").trim();
    const labels: Record<string, string> = {
      T3_REFINEMENT_EMPTY: "Luna returned no changes",
      T3_REFINEMENT_FAILED: "the bridge could not complete the rewrite",
      T3_REQUEST_TIMEOUT: "the bridge timed out",
      T3_CONNECTION_DROPPED: "the bridge connection dropped",
      T3_NOT_CONNECTED: "the bridge is disconnected",
      refinement_unavailable: "the bridge has no Luna runtime configured",
      refinement_isolation_failed: "the Luna runtime failed its safety check",
      refinement_timeout: "the bridge timed out",
      refinement_invalid: "the bridge returned invalid text",
      refinement_failed: "the bridge could not complete the rewrite",
    };
    return labels[code] ?? "the bridge could not complete the rewrite";
  }

  private restoreRefinementFailure(message: string): void {
    if (this.removed || this.phase === "closing") return;
    const wasCapturing = this.capturing;
    this.capturing = false;
    if (this.finalizeTimer !== null) clearTimeout(this.finalizeTimer);
    this.finalizeTimer = null;
    this.refinement?.cancel();
    this.refinement = null;
    this.operation++;
    this.text = this.baseText;
    this.error = message;
    this.reviewPage = 0;
    this.phase = "review";
    this.cachedLayout = null;
    if (wasCapturing) {
      // We are already back on the last good draft. A late stop rejection must
      // not replace that draft with a second fatal error state.
      try { void Promise.resolve(this.options.actions.stopVoiceCapture()).catch(() => {}); } catch { /* Best effort cleanup. */ }
    }
    this.options.actions.requestRender();
  }

  private nextReviewPage(): void {
    if (!this.cachedLayout || this.cachedLayout.source !== this.text) {
      this.cachedLayout = null;
      this.options.actions.requestRender();
      return;
    }
    this.reviewPage = Math.min(this.cachedLayout.pages.length - 1, this.reviewPage + 1);
    this.options.actions.requestRender();
  }

  paint(_ctx: LayerContext, _paintBelow: () => GrayImage): GrayImage {
    // Do not request lower planes. Only the explicit dashboard can be revealed.
    // Value 1 also occludes the shell's color-key surface.
    const viewport = appViewportRect("medium");
    const image = new GrayImage(viewport.width, viewport.height, 1);
    const left = viewport.x;
    const top = viewport.y;
    const elapsed = this.phase === "closing" ? presentationNow() - this.closedAt
      : this.expansionStartedAt === null ? 0 : presentationNow() - this.expansionStartedAt;
    const from = this.options.origin ?? { x: 0, y: 0, width: viewport.width - 5, height: viewport.height - 5 };
    const full = { x: 0, y: 0, width: viewport.width - 5, height: viewport.height - 5 };
    const rect = this.phase === "closing"
      ? cardRect(full, from, elapsed / EXPANSION_MS)
      : cardRect(from, full, elapsed / EXPANSION_MS);
    const moving = elapsed < EXPANSION_MS || this.phase === "closing";
    if (moving && this.options.paintDashboard) {
      if (!this.backdrop || this.backdrop.width !== image.width || this.backdrop.height !== image.height) {
        const dashboard = this.options.paintDashboard(image.width, image.height);
        this.backdrop = this.phase === "closing" ? dashboard : dashboard.dimmed(.5);
        this.backdrop.bakeDeferredDrawsInPlace();
        // Keep the shell opaque even where the dashboard has transparent pixels.
        const pixels = this.backdrop.pixels;
        for (let i = 0; i < pixels.length; i++) if (pixels[i] === 0) pixels[i] = 1;
      }
      image.pixels.set(this.backdrop.pixels);
    }
    const face = { ...rect, x: left + rect.x, y: top + rect.y };
    paintCardFace(image, face);
    if (moving) {
      if (!this.motionContent || this.motionContent.width !== image.width || this.motionContent.height !== image.height) {
        this.motionContent = new GrayImage(image.width, image.height, 1);
        this.paintText(this.motionContent, viewport);
        this.motionContent.bakeDeferredDrawsInPlace();
      }
      paintCardContents(image, this.motionContent, { ...full, x: left, y: top }, face);
      // Font and dashboard rasterization must not consume the first visible frames.
      if (this.phase !== "closing" && this.expansionStartedAt === null) this.expansionStartedAt = presentationNow();
    } else {
      this.motionContent = null;
      this.backdrop = null;
      this.paintText(image, viewport);
    }
    return image;
  }

  private paintText(image: GrayImage, viewport: ReturnType<typeof appViewportRect>): void {
    const left = viewport.x, top = viewport.y;
    const font = getDefaultSmallFont();
    const lineHeight = cardLineStep(font);
    const title = this.phase === "closing" ? "CANCELLED" : this.phase === "capturing" ? `LISTENING | ${Math.floor((Date.now() - this.startedAt) / 1000)}s` : this.phase === "continuing" ? "REFINEMENT INPUT" : this.phase === "finalizing-refinement" ? "FINISHING EDIT" : this.phase === "refining" ? "REFINING" : this.phase === "finalizing" ? "FINISHING TRANSCRIPT" : this.phase === "review" ? "REVIEW DRAFT" : "DICTATION";
    image.drawText(font, left + 16, top + 14, title, 190);
    const body = this.phase === "closing" ? "Nothing sent." : this.phase === "error" ? `${this.error}\n\nTap to go back.` : this.text || (this.phase === "capturing" ? "Speak your message..." : this.phase === "continuing" ? "Say an edit or follow-up..." : this.phase === "finalizing-refinement" ? "Waiting for final edit..." : this.phase === "refining" ? "Luna is refining..." : "Nothing sent.");
    const textWidth = viewport.width - 37;
    const textHeight = viewport.height - 65 - font.lineHeight - 28;
    let layout = this.cachedLayout;
    if (!layout || layout.source !== body || layout.font !== font || layout.width !== textWidth || layout.height !== textHeight) {
      const displayBody = this.phase === "error" ? body : reflowDictationText(body);
      const pages = paginateMessageText(displayBody, { font, width: textWidth, height: textHeight, lineHeight });
      const pageLines = pages.map(page => page.split("\n"));
      // During capture, keep the newest page visible. Review starts at page
      // one and lets the wearer page forward before sending.
      const page = this.phase === "review" ? Math.min(this.reviewPage, pageLines.length - 1) : pageLines.length - 1;
      layout = { source: body, font, width: textWidth, height: textHeight, pages: pageLines, lines: pageLines[page]! };
      this.cachedLayout = layout;
    }
    if (this.phase === "review" && this.cachedLayout.pages.length > 0) {
      this.reviewPage = Math.min(this.reviewPage, this.cachedLayout.pages.length - 1);
      this.cachedLayout.lines = this.cachedLayout.pages[this.reviewPage]!;
    }
    const lines = layout.lines;
    lines.forEach((line, index) => image.drawText(font, left + 16, top + 65 + index * lineHeight, line, CARD_TEXT_BRIGHTNESS));
    if (this.phase === "review") {
      const pageHint = this.cachedLayout.pages.length > 1 ? ` · ${this.reviewPage + 1}/${this.cachedLayout.pages.length}` : "";
      const errorHint = this.error ? `Luna: ${this.error} · tap send · swipe down to retry` : "";
      image.drawText(font, left + 16, top + viewport.height - font.lineHeight - 16, errorHint || `Tap send · swipe down to refine${pageHint}`, errorHint ? 180 : 145);
    }
  }

  onRemoved(): void {
    if (this.removed) return;
    this.removed = true;
    this.operation++;
    this.backdrop = null;
    this.unsubscribeTranscript?.(); this.unsubscribeTranscript = null;
    this.unsubscribeStatus?.(); this.unsubscribeStatus = null;
    if (this.elapsedTimer !== null) clearInterval(this.elapsedTimer);
    if (this.finalizeTimer !== null) clearTimeout(this.finalizeTimer);
    this.refinement?.cancel();
    this.elapsedTimer = null;
    this.finalizeTimer = null;
    this.text = "";
    this.cachedLayout = null;
    this.motionContent = null;
    if (this.capturing) {
      this.capturing = false;
      this.stopCapture();
    }
    // Restore and submit the destination before onClosed clears the opaque
    // shell frame. Cleanup must still run if a destination callback fails.
    try {
      if (!this.delivered) this.options.onCancelled();
    } finally {
      this.options.onClosed();
    }
  }
}
