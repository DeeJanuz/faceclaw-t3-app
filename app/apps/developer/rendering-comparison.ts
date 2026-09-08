import { GrayImage } from '../../graphics/image';
import { getDefaultSmallFont } from '../../graphics/ui-fonts';
import { ensurePreinstalledFonts, installedFontPath } from '../../graphics/installed-fonts';
import { TtfFont } from '../../graphics/ttf-font';
import { truncateText, wrapText } from '../../graphics/textwrap';
import type { InputEvent } from '../../ui/gestures';
import type { Layer, LayerContext } from '../../ui/layers';

const INTER = 'Inter_18pt-Regular.ttf';
type Profile = { label: string; file: string; size: number; pitch: number; brightness: number };
const BASELINE: Profile = { label: 'Inter', file: INTER, size: 16, pitch: 23, brightness: 235 };
const TESTS: readonly { label: string; variants: readonly Profile[] }[] = [
  { label: 'Font shape', variants: [BASELINE, { ...BASELINE, label: 'Roboto', file: 'Roboto-Regular.ttf' }] },
  { label: 'Size', variants: [BASELINE, { ...BASELINE, size: 17 }] },
  { label: 'Line spacing', variants: [BASELINE, { ...BASELINE, pitch: 25 }] },
  { label: 'Brightness', variants: [BASELINE, { ...BASELINE, brightness: 220 }, { ...BASELINE, brightness: 190 }] },
];
const SESSION_ROWS = [
  'ilI1 O0 rn/m | AVATAR 0123456789',
  '> Sessions: Plan the next release',
  '  Review notification settings and display layout',
  '  Read the latest assistant response',
];
const PARAGRAPH = 'Reading should feel easy from the first sentence to the last. Follow each line at a comfortable pace, then look away and find your place again. Notice whether small letters remain distinct and whether bright strokes glow into the gaps around them. The narrow path winds past a quiet garden, where morning light falls across the wall. We will review the next release, check the remaining tasks, and choose a clear plan for tomorrow. A useful display keeps enough words on screen without making you work to tell similar letters apart. Compare the same passage before choosing the version that feels easiest to read.';

/** Controlled visual comparisons; no saved font or display settings change. */
export class RenderingComparisonLayer implements Layer {
  private test = 0;
  private variant = 0;

  paint(ctx: LayerContext): GrayImage {
    const { width, height } = ctx.stack.getBaseSize();
    const image = new GrayImage(width, height, 1);
    const trial = TESTS[this.test]!;
    const profile = trial.variants[this.variant]!;
    ensurePreinstalledFonts();
    const labelFont = TtfFont.load(installedFontPath(INTER), 16, 1, 'crisp') ?? getDefaultSmallFont();
    const font = TtfFont.load(installedFontPath(profile.file), profile.size, 1, 'crisp');
    const labelPitch = labelFont.lineHeight + 4;
    const textWidth = width - 32;
    const top = 18 + labelPitch * 3;
    const bottom = height - labelPitch * 2 - 12;
    const capacity = font ? Math.max(0, Math.floor((bottom - top - font.lineHeight) / profile.pitch) + 1) : 0;
    const lines = font ? [
      ...SESSION_ROWS.map(text => truncateText(font, text, textWidth)),
      ...wrapText(font, PARAGRAPH, textWidth),
    ] : [];
    const label = (y: number, text: string) => image.drawText(labelFont, 16, y, truncateText(labelFont, text, textWidth), 190);
    label(10, `${this.test + 1}/4 ${trial.label} | ${this.variant + 1}/${trial.variants.length} ${profile.label}`);
    label(10 + labelPitch, `${profile.size}px | ${profile.pitch}px spacing | Brightness ${profile.brightness}`);
    label(10 + labelPitch * 2, font ? `${Math.min(capacity, lines.length)}/${lines.length} lines shown | ${capacity} fit | Crisp` : 'Font unavailable; comparison cannot be shown');
    image.drawRoundedRect(5, top - 5, width - 10, Math.max(1, bottom - top + 10), 235, 6, 2);
    if (font) lines.slice(0, capacity).forEach((text, row) => {
      image.drawText(font, 16, top + row * profile.pitch, text, profile.brightness);
    });
    label(height - labelPitch * 2, 'Scroll: test | Tap: variant');
    label(height - labelPitch, 'Double-tap: back | Saved settings unchanged');
    return image;
  }

  handleInput(event: InputEvent, ctx: LayerContext): void {
    if (event.type === 'double-click') { ctx.stack.pop(); return; }
    if (event.type === 'click') this.variant = (this.variant + 1) % TESTS[this.test]!.variants.length;
    else if (event.type === 'scroll-down' || event.type === 'scroll-up') {
      this.test = (this.test + (event.type === 'scroll-down' ? 1 : TESTS.length - 1)) % TESTS.length;
      this.variant = 0;
    } else return;
    ctx.actions.requestRender();
  }
}
