import { CARD_TEXT_BRIGHTNESS, cardLineStep } from '../card-presentation';
import { G2_LENS_HEIGHT, G2_LENS_WIDTH, GrayImage } from "../../graphics/image";
import { getDefaultSmallFont } from "../../graphics/ui-fonts";
import { paginateMessageText, reflowDictationText } from "../../apps/t3/hub-view-model";
import { voiceControlBridge, type VoiceTranscriptEvent } from "../../native/voice-control";
import { type InputEvent } from "../gestures";
import { type Layer, type LayerActions, type LayerContext } from "../layers";
import { appViewportRect } from "./geometry";
import { cardRect, paintCardFace, CARD_MOTION_MS, CARD_FRAME_MS, type CardRect } from "../../apps/t3/card-motion";

const FINAL_TIMEOUT_MS = 95000;
const EXPANSION_MS = CARD_MOTION_MS;

type T3DictationOptions = {
  actions: LayerActions;
  /** Starting control bounds in app-content coordinates. */
  origin?: CardRect;
  dismiss: () => void;
  onClosed: () => void;
  /** Local draft handoff only. The owning T3 screen requires a separate send tap. */
  onDraft: (text: string) => void;
  onCancelled: () => void;
};

/** T3's direct capture surface, independent of the shell's generic send menu. */
export class T3DictationLayer implements Layer {
  private phase: "capturing" | "finalizing" | "error" | "closing" = "capturing";
  private text = "";
  private cachedLayout: { source: string; font: ReturnType<typeof getDefaultSmallFont>; width: number; height: number; lines: string[] } | null = null;
  private error = "";
  private capturing = false;
  private removed = false;
  private delivered = false;
  private startedAt = Date.now();
  private closedAt = 0;
  private lastRenderedSecond = -1;
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeTranscript: (() => void) | null = null;
  private unsubscribeStatus: (() => void) | null = null;

  constructor(private readonly options: T3DictationOptions) {}

  isAnimatingCard(): boolean {
    return !this.removed && Date.now() - (this.phase === "closing" ? this.closedAt : this.startedAt) < CARD_MOTION_MS;
  }

  startCapture(): void {
    if (this.removed || this.capturing) return;
    this.startedAt = Date.now();
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
    this.animationTimer = setInterval(() => {
      if (this.removed) return;
      if (this.phase === "closing" && Date.now() - this.closedAt >= EXPANSION_MS) {
        this.options.dismiss();
        return;
      }
      const age = Date.now() - this.startedAt;
      const second = Math.floor(age / 1000);
      if (this.phase !== "closing" && age >= EXPANSION_MS && this.lastRenderedSecond === second) return;
      // Frame-rate rendering is only needed during expansion; mic time ticks once a second.
      if (age >= EXPANSION_MS) this.lastRenderedSecond = second;
      this.options.actions.requestRender();
    }, CARD_FRAME_MS);
    try {
      void Promise.resolve(this.options.actions.startVoiceCapture(false, "t3")).catch(() => this.fail("Could not start dictation. Nothing sent."));
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
    // Events contain the entire current utterance, not incremental deltas.
    this.text = event.text.trim();
    this.cachedLayout = null;
    if (event.isFinal && this.phase === "finalizing") {
      // Empty finals are authoritative, including speaker-verification rejection.
      // Never replace them with the earlier, unverified partial transcript.
      if (!this.text) {
        this.fail("No speech captured. Nothing sent.");
        return;
      }
      const draft = this.text;
      this.delivered = true;
      this.options.dismiss();
      this.options.onDraft(draft);
      return;
    }
    this.options.actions.requestRender();
  }

  private fail(message: string): void {
    if (this.removed || this.delivered || this.phase === "closing" || this.phase === "error") return;
    this.phase = "error";
    this.error = message;
    this.text = "";
    this.cachedLayout = null;
    if (this.finalizeTimer !== null) clearTimeout(this.finalizeTimer);
    this.finalizeTimer = null;
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
      this.closedAt = Date.now();
      this.text = "";
      this.cachedLayout = null;
      if (this.capturing) {
        this.capturing = false;
        this.stopCapture();
      }
      this.options.actions.requestRender();
    } else if (event.type === "click") {
      this.endCapture();
    }
  }

  paint(_ctx: LayerContext, _paintBelow: () => GrayImage): GrayImage {
    // Do not request lower planes. Value 1 also occludes the shell's color-key surface.
    const viewport = appViewportRect("medium");
    const image = new GrayImage(viewport.width, viewport.height, 1);
    const left = viewport.x;
    const top = viewport.y;
    const elapsed = Date.now() - (this.phase === "closing" ? this.closedAt : this.startedAt);
    const from = this.options.origin ?? { x: 0, y: 0, width: viewport.width - 5, height: viewport.height - 5 };
    const full = { x: 0, y: 0, width: viewport.width - 5, height: viewport.height - 5 };
    const rect = this.phase === "closing"
      ? cardRect(full, from, elapsed / EXPANSION_MS)
      : cardRect(from, full, elapsed / EXPANSION_MS);
    paintCardFace(image, { ...rect, x: left + rect.x, y: top + rect.y });
    if (elapsed < EXPANSION_MS || this.phase === "closing") return image;
    const font = getDefaultSmallFont();
    const lineHeight = cardLineStep(font);
    const title = this.phase === "capturing" ? `LISTENING | ${Math.floor((Date.now() - this.startedAt) / 1000)}s` : this.phase === "finalizing" ? "FINISHING TRANSCRIPT" : "DICTATION";
    image.drawText(font, left + 16, top + 14, title, 190);
    const body = this.phase === "error" ? `${this.error}\n\nTap to go back.` : this.text || (this.phase === "capturing" ? "Speak your message..." : "Nothing sent.");
    const textWidth = viewport.width - 37;
    const textHeight = viewport.height - 65 - font.lineHeight - 28;
    let layout = this.cachedLayout;
    if (!layout || layout.source !== body || layout.font !== font || layout.width !== textWidth || layout.height !== textHeight) {
      const displayBody = this.phase === "error" ? body : reflowDictationText(body);
      const pages = paginateMessageText(displayBody, { font, width: textWidth, height: textHeight, lineHeight });
      // Capture follows the last measured page until the user opens draft review.
      layout = { source: body, font, width: textWidth, height: textHeight, lines: pages[pages.length - 1]!.split("\n") };
      this.cachedLayout = layout;
    }
    const lines = layout.lines;
    lines.forEach((line, index) => image.drawText(font, left + 16, top + 65 + index * lineHeight, line, CARD_TEXT_BRIGHTNESS));
    if (this.phase === "finalizing" && this.text) image.drawText(font, left + 16, top + viewport.height - font.lineHeight - 16, "Nothing sent.", 145);
    return image;
  }

  onRemoved(): void {
    if (this.removed) return;
    this.removed = true;
    this.unsubscribeTranscript?.(); this.unsubscribeTranscript = null;
    this.unsubscribeStatus?.(); this.unsubscribeStatus = null;
    if (this.animationTimer !== null) clearInterval(this.animationTimer);
    if (this.finalizeTimer !== null) clearTimeout(this.finalizeTimer);
    this.animationTimer = null;
    this.finalizeTimer = null;
    this.text = "";
    this.cachedLayout = null;
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
