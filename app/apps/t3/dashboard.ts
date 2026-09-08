import { CARD_TEXT_BRIGHTNESS } from '../../ui/card-presentation';
import { GrayImage } from '../../graphics/image';
import { getDefaultSmallFont } from '../../graphics/ui-fonts';
import { truncateText } from '../../graphics/textwrap';
import { renderIcon } from '../../graphics/icons';
import { drawBattery } from '../../graphics/battery';
import type { WeatherState } from '../../native/weather';
import { renderClockPixels } from './dashboard-clock';
import { paintSelectionChevron } from './card-motion';

/** Compact dashboard stays at the top of the available content area. */
export function dashboardTargets(width: number, height: number) {
  const x = Math.max(0, Math.round((width - 576) / 2));
  const y = 0;
  return [
    { id: 'inbox', x: x + 447, y: y + 14, width: 100, height: 40 },
    ...['assistant', 'sessions'].map((id, index) => ({ id, x: x + 259, y: y + 95 + index * 54, width: 288, height: 44 })),
  ];
}

export function paintT3Dashboard(width: number, height: number, selected: string, unread: number,
  status: string, weather: WeatherState, timeFormat: string, now = new Date(),
  battery: { headset: number | null; headsetCharging: boolean | null } = { headset: null, headsetCharging: null }): GrayImage {
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
  image.drawText(font, x + 22, y + 255, truncateText(font, weather.locationName || 'Set up in Weather', 222), 140);
  for (const rect of dashboardTargets(width, height)) {
    const focused = selected === rect.id;
    image.drawRoundedRect(rect.x, rect.y, rect.width, rect.height, focused ? 245 : 95, 6, focused ? 3 : 2);
    if (focused) paintSelectionChevron(image, rect.x + 12, rect.y + rect.height / 2);

    if (rect.id === 'inbox') {
      const bell = renderIcon('bell', 24);
      if (bell) image.drawImage(bell, rect.x + 25, rect.y + 8);
      image.drawText(labelFont, rect.x + 61, rect.y + Math.round((rect.height - labelFont.lineHeight) / 2), String(Math.max(0, unread)), focused ? CARD_TEXT_BRIGHTNESS : 165);
    } else {
      const label = { assistant: 'Ask Assistant', sessions: 'Sessions' }[rect.id]!;
      image.drawText(labelFont, rect.x + 32, rect.y + Math.round((rect.height - labelFont.lineHeight) / 2), label, focused ? CARD_TEXT_BRIGHTNESS : 165);
    }
  }

  return image;
}
