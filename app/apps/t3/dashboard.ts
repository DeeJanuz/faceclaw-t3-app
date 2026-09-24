import { decodeMediaArtwork } from '@faceclaw/motion';
import { CARD_TEXT_BRIGHTNESS, paintFocusBrackets } from '../../ui/card-presentation';
import { GrayImage } from '../../graphics/image';
import { getDefaultSmallFont } from '../../graphics/ui-fonts';
import { truncateText } from '../../graphics/textwrap';
import { renderIcon } from '../../graphics/icons';
import { drawBattery } from '../../graphics/battery';
import type { WeatherState } from '../../native/weather';
import { renderClockPixels } from './dashboard-clock';

export interface DashboardCards {
  sessions: { id: string; title: string }[];
  audioExpanded: boolean;
  audioNotice?: string;
  audioPlaying?: boolean;
  audioMedia?: import('../../extensions/host').HostMedia | null;
  activeCard: 'audio' | 'sessions' | null;
}
const emptyCards: DashboardCards = { sessions: [], audioExpanded: false, activeCard: null };
const AUDIO_ROWS = [{ id: 'audio-previous', title: 'Previous Track' }, { id: 'audio-toggle', title: 'Play/Pause' }, { id: 'audio-next', title: 'Next Track' }];

/** Shared geometry for painting, gestures and touch. Only the card column scrolls. */
export function dashboardTargets(width: number, height: number, cards: DashboardCards = emptyCards, selected = '') {
  const x = Math.max(0, Math.round((width - 576) / 2));
  const left = x + 259;
  const audioHeight = cards.audioExpanded ? 132 : 44;
  const sessionY = 95 + audioHeight + 10;
  const sessionHeight = 44 + cards.sessions.length * 32;
  const rows = [
    { id: 'audio', title: 'Audio controls', x: left, y: 95, width: 288, height: audioHeight, card: true },
    ...(cards.audioExpanded ? AUDIO_ROWS.map((row, i) => ({ ...row, x: left + i * 96, y: 183, width: 96, height: 44, card: false })) : []),
    { id: 'sessions', title: 'Sessions', x: left, y: sessionY, width: 288, height: sessionHeight, card: true },
    ...cards.sessions.map((row, i) => ({ ...row, x: left, y: sessionY + 6 + i * 32, width: 288, height: 32, card: false })),
    { id: 'sessions-all', title: 'Sessions', x: left, y: sessionY + cards.sessions.length * 32, width: 288, height: 44, card: false },
  ];
  const focus = rows.find(row => row.id === selected);
  const bottom = sessionY + sessionHeight;
  const focusBottom = focus ? focus.y + (focus.card ? 44 : focus.height) : 0;
  const offset = Math.min(Math.max(0, bottom - height + 8), Math.max(0, focusBottom - height + 8));
  return [
    { id: 'inbox', title: 'Notifications', x: x + 447, y: 14, width: 100, height: 40, card: true },
    ...rows.map(row => ({ ...row, y: row.y - offset })),
  ];
}

export function paintT3Dashboard(width: number, height: number, selected: string, unread: number,
  status: string, weather: WeatherState, timeFormat: string, now = new Date(),
  battery: { headset: number | null; headsetCharging: boolean | null } = { headset: null, headsetCharging: null }, cards: DashboardCards = emptyCards): GrayImage {
  const image = new GrayImage(width, height, 0);
  const font = getDefaultSmallFont();
  const labelFont = font;
  const x = Math.max(0, Math.round((width - 576) / 2));
  const y = 0;
  const date = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()]} ${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  image.drawText(font, x + 22, y + 12, truncateText(font, date, 140), CARD_TEXT_BRIGHTNESS);
  const charge = battery.headset !== null && Number.isFinite(battery.headset) && battery.headset >= 0 && battery.headset <= 100
    ? Math.round(battery.headset) : null;
  image.drawText(font, x + 168, y + 12, charge === null ? '--%' : `${charge}%`, CARD_TEXT_BRIGHTNESS);
  image.drawImage(drawBattery(charge ?? 0, battery.headsetCharging === true), x + 218, y + 17);
  const twelveHour = timeFormat !== '24h';
  const hour = twelveHour ? now.getHours() % 12 || 12 : now.getHours();
  const clock = new GrayImage(128, 144, 0);
  clock.pixels.set(renderClockPixels(String(hour), String(now.getMinutes())));
  image.drawImage(clock, x + 46, y + 66);
  if (twelveHour) image.drawText(font, x + 178, y + 188, now.getHours() >= 12 ? 'PM' : 'AM', 190);
  const condition = weather.current
    ? `${weather.current.temperatureF === null ? '--' : Math.round(weather.current.temperatureF)}°F · ${weather.current.description}`
    : weather.phase === 'permission-required' ? 'Weather needs location' : weather.phase === 'error' ? 'Weather unavailable' : 'Loading weather…';
  image.drawText(font, x + 22, y + 228, truncateText(font, condition, 222), CARD_TEXT_BRIGHTNESS);
  image.drawText(font, x + 22, y + 255, truncateText(font, weather.locationName || (weather.phase === 'permission-required' ? 'Allow location in Faceclaw' : 'Local weather'), 222), 140);
  const column = new GrayImage(288, Math.max(1, height - 66), 0);
  for (const rect of dashboardTargets(width, height, cards, selected)) {
    const focused = selected === rect.id;
    if (rect.id === 'inbox') {
      image.drawRoundedRect(rect.x, rect.y, rect.width, rect.height, focused ? 245 : 95, 6, focused ? 3 : 2);
      const bell = renderIcon('bell', 24);
      if (bell) image.drawImage(bell, rect.x + 25, rect.y + 8);
      image.drawText(labelFont, rect.x + 61, rect.y + Math.round((rect.height - labelFont.lineHeight) / 2), String(Math.max(0, unread)), focused ? CARD_TEXT_BRIGHTNESS : 165);
      continue;
    }
    const top = rect.y - 66;
    if (top >= column.height || top + rect.height <= 0) continue;
    if (rect.card) {
      const active = focused || cards.activeCard === rect.id;
      column.drawRoundedRect(0, top, rect.width, rect.height, active ? 245 : 95, 6, active ? 3 : 2);
    }
    if (rect.id === 'audio' && cards.audioExpanded) {
      const media = cards.audioMedia;
      const art = audioArtwork(media?.art);
      const icon = art ?? renderIcon('music', 40);
      if (icon) column.drawImage(icon, 12 + Math.round((64 - icon.width) / 2), top + 12 + Math.round((64 - icon.height) / 2));
      column.drawText(labelFont, 88, top + 17, truncateText(labelFont, media?.title || 'Audio controls', 184), CARD_TEXT_BRIGHTNESS);
      column.drawText(labelFont, 88, top + 45, truncateText(labelFont, cards.audioNotice || media?.artist || '', 184), 165);
      continue;
    }
    // Sessions has no extra heading: names followed by the full-list link.
    if (rect.id === 'sessions') continue;
    const rowHeight = rect.id === 'audio' ? 44 : rect.height;
    const localX = rect.x - (x + 259);
    if (focused && !rect.card && cards.activeCard) {
      // Square brackets distinguish focus inside a card from its outer border.
      paintFocusBrackets(column, localX + 8, localX + rect.width - 10, top + Math.round((rowHeight - 24) / 2));
    }
    if (rect.id.startsWith('audio-')) {
      const name = rect.id === 'audio-toggle' ? (cards.audioPlaying ? 'media-pause' : 'media-play')
        : rect.id === 'audio-previous' ? 'media-previous' : 'media-next';
      const icon = renderIcon(name, 26);
      if (icon) column.drawImage(icon, localX + Math.round((rect.width - 26) / 2), top + 9);
      continue;
    }
    const textY = rect.y + Math.round((rowHeight - labelFont.lineHeight) / 2);
    if (textY >= 66 && textY + labelFont.lineHeight <= height) image.drawText(labelFont, rect.x + 32, textY,
      truncateText(labelFont, rect.id === 'audio' && cards.audioNotice ? cards.audioNotice : rect.title, 244), focused ? CARD_TEXT_BRIGHTNESS : 165);
  }
  image.drawImage(column, x + 259, 66);
  return image;
}

// Decode only when artwork changes; keep one bounded image, never a track history.
let artworkKey = '';
let artworkImage: GrayImage | null = null;
function audioArtwork(art: import('../../extensions/host').HostMedia['art'] | undefined): GrayImage | null {
  if (!art) { artworkKey = ''; artworkImage = null; return null; }
  const key = `${art.width}:${art.height}:${art.gray4}`;
  if (key !== artworkKey) {
    const decoded = decodeMediaArtwork(art);
    if (!decoded) { artworkKey = ''; artworkImage = null; return null; }
    artworkKey = key; artworkImage = new GrayImage(decoded.width, decoded.height, 0);
    artworkImage.pixels.set(decoded.pixels);
  }
  return artworkImage;
}
