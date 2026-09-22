import { GlanceCanvas, type GlanceWidgetRegistry, type GlanceWidgetRequest } from '@faceclaw/motion';
import { renderClockPixels } from './dashboard-clock';
import { drawBattery } from '../../graphics/battery';

/** App-owned declarations and layout. The host knows neither widget's identity or design. */
export const t3GlanceWidgets: GlanceWidgetRegistry = { version: 1, widgets: [
  { id: 'default', label: 'T3 attention', kind: 'list', rows: 1, refreshMs: 30000 },
  { id: 'home', label: 'T3 home', kind: 'scene', rows: 2, refreshMs: 60000, uses: ['battery', 'weather', 'time-format'] },
] };
export function t3HomeWidget(request: GlanceWidgetRequest, now = new Date()) {
  const context = request.context ?? {}, weather = context.weather, battery = context.battery;
  const expiresAt = Math.max(now.getTime() + 2000, (Math.floor(now.getTime()/60000)+1)*60000);
  const canvas = new GlanceCanvas('home', expiresAt);
  const date = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()]} ${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
  canvas.text(22,12,date,140);
  const charge = battery?.headset != null && Number.isFinite(battery.headset) && battery.headset >= 0 && battery.headset <= 100 ? Math.round(battery.headset) : null;
  canvas.text(168,12,charge === null ? '--%' : `${charge}%`,48);
  const icon = drawBattery(charge ?? 0, battery?.headsetCharging === true);
  canvas.bitmap(218,17,icon.width,icon.height,icon.pixels,190);
  const twelve = context.timeFormat !== '24h';
  canvas.bitmap(46,66,128,144,renderClockPixels(String(twelve ? now.getHours()%12 || 12 : now.getHours()),String(now.getMinutes())));
  if (twelve) canvas.text(178,188,now.getHours() >= 12 ? 'PM' : 'AM',60);
  const condition = weather?.current ? `${weather.current.temperatureF === null ? '--' : Math.round(weather.current.temperatureF)}°F · ${weather.current.description}`
    : weather?.phase === 'permission-required' ? 'Weather needs location' : weather?.phase === 'error' ? 'Weather unavailable' : 'Loading weather…';
  canvas.text(22,228,condition.slice(0,256),244);
  canvas.text(22,255,(weather?.locationName || 'Local weather').slice(0,256),244,140);
  return canvas.build();
}
