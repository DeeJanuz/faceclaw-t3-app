const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const transpiled = new Map();
function load(path, imports = {}, globals = {}) {
  const module = { exports: {} };
  let code = transpiled.get(path);
  if (!code) {
    code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    transpiled.set(path, code);
  }
  const localRequire = name => { if (name === './resource') return load('app/apps/t3/resource.ts'); if (name === './token-accounting') return load('app/apps/t3/token-accounting.ts'); if (name === '@faceclaw/motion') return require(name); if (!(name in imports)) throw Error(name); return imports[name]; };
  const names = Object.keys(globals);
  Function('module', 'exports', 'require', ...names, code)(module, module.exports, localRequire, ...names.map(name => globals[name]));
  return module.exports;
}
const face = load('app/ui/card-presentation.ts');
const notificationCard = load('app/ui/shell/notification-card.ts', { '../card-presentation': face, '../../graphics/textwrap': { truncateText: (_font, text) => text, wrapText: (_font, text) => [text] } });
const previewContext = { stack: { getBaseSize: () => ({ width: 576, height: 288 }) } };
const previewImage = () => ({ bakeDeferredDrawsInPlace() {}, fillRoundedRect() {}, drawRoundedRect() {}, drawText() {}, fillRect() {} });
const previewImports = {
  '../../graphics/image': {},
  '../../graphics/ui-fonts': { getDefaultSmallFont: () => ({ lineHeight: 16, measureText: () => 10 }) },
  '../../graphics/textwrap': {},
  './geometry': { appViewportRect: () => ({ x: 0, y: 0, width: 576, height: 288 }) },
  './notification-card': notificationCard,
  '../card-presentation': face,
};
let hub;
test('session menu preserves duplicate IDs across computers and shows unavailable peers', () => {
  const sessions = ['a', 'b'].map(environmentId => ({ id: 'same', projectId: 'project', projectTitle: 'Project',
    title: 'Session', environmentId, environmentLabel: environmentId, status: 'ready', settled: false, lastActivityAt: new Date().toISOString() }));
  const rows = hub.buildSessionRows({ unsettled: sessions, settled: [], environments: [{ environmentId: 'c', label: 'Computer C', status: 'offline' }] });
  const targets = rows.filter(row => row.key.startsWith('session:')).map(row => row.value);
  assert.equal(targets.length, 2);
  assert.notEqual(targets[0], targets[1]);
  assert.ok(rows.some(row => row.text.includes('Computer C') && !row.selectable));
});
test('duplicate project labels use computer names and preserve both resource identities', () => {
  const rows = hub.buildProjectRows(['Deej-7i', "Daenon's Pro14"].map((environmentLabel, index) => ({
    id: 'same', title: 'Even Realities', environmentId: String(index), environmentLabel, canStartSession: true,
  })));
  assert.equal(rows[0].text, 'Even Realities · Deej-7i');
  assert.equal(rows[1].text, "Even Realities · Daenon's Pro14");
  assert.notEqual(rows[0].value, rows[1].value);
});
test.before(async () => { hub = load('app/apps/t3/hub-view-model.ts', { '@evenrealities/pretext': await import('@evenrealities/pretext'), '../../graphics/textwrap': load('app/graphics/textwrap.ts') }); });
const { T3Workspace } = load('app/apps/t3/workspace.ts', { '../../t3/security': load('app/t3/security.ts') });
const { T3DemoApi } = load('app/apps/t3/demo.ts');
function setup(animationClock, raster = false, t3Config = {}) {
  const api = new T3DemoApi(); const state = new T3Workspace(api); state.demo = true; const dismissed = []; const navigation = { yielded: 0, phone: 0, focused: [], events: [], wakes: 0, returned: [], backAcks: 0 }; let permitDismiss = true, deferDismiss = false, resolveDismiss;
  const visibility = { on: true, foreground: 't3', overlay: false, preview: null, appBase: true }; let visible; let reply; let focused = true; let returnResult = true, deferReturn = false, resolveReturn; const reviews = []; const counts = []; const drawn = []; const placements = []; const cards = []; const brackets = []; const borders = [];
  const alerts = () => visible || state.alerts;
  // Layout-only tests do not inspect raster bytes. Avoid retaining hundreds of
  // full viewport buffers now that a slide deliberately caches both pages.
  class Image { constructor(width = 576, height = 452) { this.width = width; this.height = height; this.pixels = new Uint8Array(0); this.draws = []; } fillRect() {} bakeDeferredDrawsInPlace() {} fillRoundedRect() {} drawRoundedRect(...args) { borders.push(args); } drawText(_font, x, y, text) { drawn.push(text); placements.push({ x, y, text }); } drawImage() {} bitBlt() {} dimmed() { return this; } }
  const RasterImage = raster ? load('app/graphics/image.ts', { './textwrap': {} }).GrayImage : Image;
  const font = raster ? load('app/graphics/bdffont.ts', { '@nativescript/core': {} }).BdfFont.parse(fs.readFileSync('app/fonts/terminus/ter-u18n.bdf', 'utf8')) : { lineHeight: 17, measureText: value => Array.from(value).length * 7, getGlyph: () => ({ dwidthX: 7 }) };
  const targets = raster ? [{ id: 'sessions', x: 259, y: 149, width: 288, height: 44 }, { id: 'inbox', x: 447, y: 14, width: 100, height: 40 }] : [];
  const shell = { respondToBack(atRoot) { if(atRoot) { navigation.yielded++; navigation.events.push('sleep'); } else navigation.backAcks++; }, closeNotificationReader() {}, getBatteryLevels: () => ({ headset: 72, headsetCharging: false }), startVoiceInput() {}, openReviewedVoiceInput: (...args) => reviews.push(args), focusWindow(id) { navigation.focused.push(id); navigation.events.push('focus:' + id); }, returnNotificationVisit(id) { navigation.returned.push(id); return deferReturn ? new Promise(resolve => { resolveReturn = () => resolve(returnResult); }) : Promise.resolve(returnResult); }, sleepAtAppRoot() { navigation.yielded++; navigation.events.push('sleep'); }, isWindowFocused: () => focused, isWindowVisible: id => visibility.on && visibility.foreground === id, hasOverlay: () => visibility.overlay, getNotificationPreviewId: () => visibility.preview,
    wakeWindowForNotification: id => {
      if (visibility.on || visibility.foreground !== id || visibility.overlay || visibility.preview) return false;
      visibility.on = true; navigation.wakes++; return true;
    } };
  const { T3Layer } = load('app/apps/t3/t3-app.ts', {
    '../../ui/card-presentation': face,
    './activity-indicator': load('app/apps/t3/activity-indicator.ts', { '../../ui/card-presentation': face, '../../graphics/textwrap': { truncateText: (_font, text) => text } }),
    '../developer/rendering-comparison': { RenderingComparisonLayer: class {} },
    './notifications-ui': { openT3Alert() {}, openT3NotificationApp: id => { navigation.events.push('open-app:' + id); return true; }, visibleT3Alerts: alerts, findT3Alert: id => alerts().find(alert => alert.id === id), getT3NotificationReply: id => {
      const selected=typeof reply==='function'?reply(id):reply;
      if(!selected)return selected;
      return {...selected,review:current=>new Promise(resolve=>{let used=false;reviews.push([{label:'Send reply',onSend:text=>{if(used||!current())return;used=true;const accepted=selected.send(text,status=>resolve(status));if(!accepted)resolve('rejected');else if(!selected.successMessage)resolve('sent');}},current,()=>resolve('rejected')]);})};
    }, dismissT3Alert(alert) { dismissed.push(alert.id); if (!permitDismiss) return false; if (deferDismiss) return new Promise(resolve => { resolveDismiss = () => { state.removeAlert(alert.id); resolve(true); }; }); state.removeAlert(alert.id); return true; } }, '@nativescript/core': { Frame: { topmost: () => ({ navigate: () => navigation.phone++ }) } },
    '../../ui/shell/notification-card': { ...notificationCard, paintNotificationCard(image, rect, font, content) { cards.push(rect); notificationCard.paintNotificationCard(image, rect, font, content); } },
    './hub-view-model': hub, './card-motion': { ...load('app/apps/t3/card-motion.ts', { '../../ui/card-presentation': face }), paintCardFace(image, rect) { cards.push(rect); if (raster) face.paintCardFace(image, rect); }, paintFocusBrackets(_image, left, right, top, height) { brackets.push({ left, right, top, height }); }, HUB_CARD: {x:0,y:0,width:576,height:288}, HUB_DROPDOWN: {x:16,y:12,width:544,height:104} },
    './dashboard': { dashboardTargets: () => targets, paintT3Dashboard: (_w, _h, _selected, count) => {
      counts.push(count); const image = new RasterImage(_w, _h);
      if (raster) { image.drawText(font, 22, 20, 'DASHBOARD', 190); image.drawText(font, 22, 75, 'Synthetic home content', 190); for (const target of targets) { image.drawRoundedRect(target.x, target.y, target.width, target.height, 235, 8, 2); image.drawText(font, target.x + 16, target.y + 10, target.id.toUpperCase(), 190); } }
      return image;
    } }, '../../native/weather': { weatherBridge: { snapshot: () => ({}) } }, '../../ui/dashboard-settings': { timeFormatSetting: { get: () => '24h' } }, '../../graphics/image': { GrayImage: RasterImage }, '../../graphics/ui-fonts': { getDefaultSmallFont: () => font }, '../../graphics/textwrap': { truncateText: (_font, text) => text, wrapText: (_font, text) => String(text).split('\n') }, '../../graphics/icons': { renderIcon: () => null },
    '../../ui/presentation-clock': { presentationNow: () => animationClock?.now ?? Date.now() },
    '../../native/media-controls': { isMediaPlaying: () => false, sendMediaCommand: command => { navigation.events.push('media:' + command); return true; } },
    '../../extensions/host': { onHostEvent: () => () => {}, onHostState: () => () => {} },
    '../../ui/shell/shell': { shell }, '../../ui/shell/in-process-window': {},
    '../../t3/config': { getT3Config: () => t3Config },
    '../../t3/activity-indicator-mode': load('app/t3/activity-indicator-mode.ts'), './runtime': { t3Workspace: state },
  }, animationClock ? { Date: class extends Date { static now() { return animationClock.now; } } } : {});
  const layer = new T3Layer(() => {}, () => visibility.appBase);
  state.onChange(() => layer.contentChanged());
  return { api, state, visibility, dismissed, navigation, reviews, counts, drawn, placements, cards, brackets, borders, setVisible: value => { visible = value; }, setReply: value => { reply = value; }, setFocused: value => { focused = value; }, setReturnResult: value => { returnResult = value; }, deferDismiss: () => { deferDismiss = true; }, resolveDismiss: () => { deferDismiss = false; const done = resolveDismiss; resolveDismiss = undefined; done?.(); }, deferReturn: () => { deferReturn = true; }, resolveReturn: () => { deferReturn = false; const done = resolveReturn; resolveReturn = undefined; done?.(); }, denyDismiss: () => { permitDismiss = false; }, layer };
}
test('assistant draft requires review tap and preserves assistant.start intent', async () => {
  const { api, state, layer } = setup(); await state.refresh();
  layer.askAssistant();
  assert.equal(layer.screen, 'draft');
  assert.equal(api.calls.filter(m => m.endsWith('.start')).length, 0);
  await layer.handleInput({ type: 'click' });
  assert.equal(api.calls.filter(m => m === 'assistant.start').length, 1);
  assert.equal(api.calls.filter(m => m === 'thread.start').length, 0);
  assert.equal(layer.screen, 'reader');
});
test('plan review submits only from its submit row, and cannot submit twice', async () => {
  const { api, state, layer } = setup(); await state.refresh(); await state.openThread('plan');
  state.setAnswer('plan', { questionId: 'layout', optionIndexes: [0], text: '' });
  layer.openPlanReview();
  assert.equal(layer.selected, 'review-1', 'incomplete review focuses the first unanswered question');
  assert.equal(layer.rows().find(row => row.id === 'submit').disabled, true);
  await layer.handleInput({ type: 'click' });
  assert.equal(layer.screen, 'question'); assert.equal(layer.questionIndex, 1, 'a review row edits its question');
  assert.equal(api.calls.includes('plan.submit'), false);
  for (const q of state.plans.get('plan').request.questions) state.setAnswer('plan', { questionId: q.id, optionIndexes: [0], text: '' });
  layer.openPlanReview(); assert.equal(layer.selected, 'submit');
  await layer.handleInput({ type: 'scroll-up' }); await layer.handleInput({ type: 'click' });
  assert.equal(layer.screen, 'question'); assert.equal(api.calls.includes('plan.submit'), false);
  layer.openPlanReview(); await layer.handleInput({ type: 'click' }); await layer.handleInput({ type: 'click' });
  assert.equal(api.calls.filter(m => m === 'plan.submit').length, 1);
});
test('notification back leaves a retained T3 reader for the dashboard', async () => {
  const { state, layer } = setup(); await state.refresh(); await state.openThread('voice');
  layer.screen = 'reader'; layer.scroll = 7; layer.openThread('ui', 't3', true);
  await layer.handleInput({ type: 'double-click' });
  assert.equal(layer.screen, 'dashboard'); assert.equal(layer.scroll, 0);
});
test('notification visit return acknowledges SDK back and uses the opaque host visit', async () => {
  const h = setup(); h.state.alerts = [{ id: 'one', kind: 'phone', threadId: 'phone', title: 'Sender', body: 'Hello', createdAt: 1 }];
  h.layer.openNotification('one', 'prior-app', false, 'lease-1');
  await h.layer.handleInput({ type: 'double-click' });
  assert.deepEqual(h.navigation.returned, ['lease-1']);
  assert.equal(h.navigation.backAcks, 1);
});
test('notification return transition absorbs a repeated back instead of sleeping the dashboard', async () => {
  const h = setup(); await h.state.refresh(); h.layer.openThread('voice', undefined, true, 'lease-1');
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.screen, 'dashboard'); assert.equal(h.navigation.yielded, 0);
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.navigation.yielded, 0); assert.equal(h.navigation.backAcks, 2); assert.deepEqual(h.navigation.returned, ['lease-1']);
  h.layer.onRemoved(); await h.layer.handleInput({ type: 'double-click' }); assert.equal(h.navigation.yielded, 1);
});
test('preview timeout leaves inbox untouched; swipe uses dismissal callback once', () => {
  let now = 0, tick, cleared = 0, expired = 0, opened = 0, dismissed = 0;
  const { TimedNotificationLayer } = load('app/ui/shell/timed-notification.ts', {
    ...previewImports, '../presentation-clock': { presentationNow: () => now },
  }, { Date: { now: () => now }, setInterval: cb => { tick = cb; return 1; }, clearInterval: () => cleared++ });
  const layer = new TimedNotificationLayer('Title', 'Text', () => opened++, () => dismissed++, () => { expired++; layer.onRemoved(); }, () => {});
  layer.paint(previewContext, previewImage);
  now = 4500; tick(); assert.equal(expired, 0);
  now = 6000; tick(); assert.equal(expired, 1); assert.equal(dismissed, 0); assert.equal(opened, 0); assert.equal(cleared, 1);
  const next = new TimedNotificationLayer('Title', 'Text', () => opened++, () => dismissed++, () => {}, () => {});
  next.handleInput({ type: 'swipe-down' }); assert.equal(dismissed, 1); next.onRemoved();
});
test('preview tap opens only once and keeps a bounded handoff watchdog', () => {
  let now = 0, tick, opened = 0, expired = 0;
  const { TimedNotificationLayer } = load('app/ui/shell/timed-notification.ts', {
    '../../graphics/image': {}, '../../graphics/ui-fonts': {}, '../../graphics/textwrap': {}, './geometry': {}, './notification-card': notificationCard, '../card-presentation': face, '../presentation-clock': { presentationNow: () => now },
  }, { Date: { now: () => now }, setInterval: cb => { tick = cb; return 1; }, clearInterval: () => {} });
  const layer = new TimedNotificationLayer('Title', 'Text', () => opened++, () => {}, () => { expired++; }, () => {});
  layer.handleInput({ type: 'click' }); layer.handleInput({ type: 'click' });
  now = 7000; tick(); assert.equal(expired, 0);
  now = 8000; tick();
  assert.equal(opened, 1); assert.equal(expired, 1);
});
test('host-bound previews leave expiry arbitration to the host lease', () => {
  let now = 0, tick, opened = 0, expired = 0;
  const { TimedNotificationLayer } = load('app/ui/shell/timed-notification.ts', {
    ...previewImports, '../presentation-clock': { presentationNow: () => now },
  }, { Date: { now: () => now }, setInterval: cb => { tick = cb; return 1; }, clearInterval: () => {} });
  const layer = new TimedNotificationLayer('Title', 'Text', () => opened++, () => {}, () => expired++, () => {}, true, 5000, false, true);
  layer.paint(previewContext, previewImage);
  now = 20_000; tick();
  assert.equal(expired, 1, 'a lost host close must still have a bounded local recovery');
  layer.handleInput({ type: 'click' });
  assert.equal(opened, 0, 'a recovered preview cannot be reopened after its watchdog closed it');
});
test('host deadline drives the fallback after the revealed-frame lease', () => {
  let now = 0, tick, expired = 0;
  const { TimedNotificationLayer } = load('app/ui/shell/timed-notification.ts', {
    ...previewImports, '../presentation-clock': { presentationNow: () => now },
  }, { Date: { now: () => now }, setInterval: cb => { tick = cb; return 1; }, clearInterval: () => {} });
  const layer = new TimedNotificationLayer('Title', 'Text', () => {}, () => {}, () => { expired++; layer.onRemoved(); }, () => {}, true, 5000, false, true);
  layer.paint(previewContext, previewImage);
  layer.setHostDeadline(7000);
  now = 9999; tick(); assert.equal(expired, 0);
  now = 10_000; tick(); assert.equal(expired, 1);
});
test('host-bound preview cannot be held forever by a stuck reader open', () => {
  let now = 0, expired = 0, sequence = 0;
  const active = new Map();
  const { TimedNotificationLayer } = load('app/ui/shell/timed-notification.ts', {
    ...previewImports, '../presentation-clock': { presentationNow: () => now },
  }, { Date: { now: () => now }, setInterval: cb => { active.set(++sequence, cb); return sequence; }, clearInterval: id => active.delete(id) });
  const layer = new TimedNotificationLayer('Title', 'Text', () => new Promise(() => {}), () => {}, () => { expired++; layer.onRemoved(); }, () => {}, true, 5000, false, true);
  layer.paint(previewContext, previewImage);
  layer.handleInput({ type: 'click' });
  assert.equal(active.size, 1, 'tap must retain the handoff watchdog');
  now = 9000; for (const tick of [...active.values()]) tick();
  assert.equal(expired, 1);
  assert.equal(active.size, 0);
});
test('plain long press dismisses the interruption and never opens its reader', () => {
  let opened = 0, dismissed = 0;
  const { TimedNotificationLayer } = load('app/ui/shell/timed-notification.ts', {
    ...previewImports, '../presentation-clock': { presentationNow: () => 0 },
  }, { Date: { now: () => 0 }, setInterval: () => 1, clearInterval: () => {} });
  const layer = new TimedNotificationLayer('Title', 'Text', () => opened++, () => dismissed++, () => {}, () => {});
  layer.handleInput({ type: 'long-press' });
  layer.handleInput({ type: 'long-press-release' });
  layer.handleInput({ type: 'click' });
  assert.equal(dismissed, 1);
  assert.equal(opened, 0);
});
test('a replacement preview resets an interrupted open operation', async () => {
  let resolveOpen;
  let opened = 0, expired = 0;
  const { TimedNotificationLayer } = load('app/ui/shell/timed-notification.ts', {
    ...previewImports, '../presentation-clock': { presentationNow: () => 0 },
  }, { Date: { now: () => 0 }, setInterval: () => 1, clearInterval: () => {} });
  const layer = new TimedNotificationLayer('A', 'A', () => {
    opened++;
    return new Promise(resolve => { resolveOpen = resolve; });
  }, () => {}, () => { expired++; }, () => {});
  layer.handleInput({ type: 'click' });
  layer.update('B', 'B', true, 5000);
  // The replacement is independently tappable even while A's promise is
  // unresolved. Its second tap is ignored only after it starts its own open.
  layer.handleInput({ type: 'click' });
  assert.equal(opened, 2);
  resolveOpen?.(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(expired, 0);
});
test('pointer taps and wake-origin double taps open notification previews', () => {
  const create = (wokeDisplay, event) => {
    let opened = 0, dismissed = 0;
    const { TimedNotificationLayer } = load('app/ui/shell/timed-notification.ts', {
      ...previewImports, '../presentation-clock': { presentationNow: () => 0 },
    }, { Date: { now: () => 0 }, setInterval: () => 1, clearInterval: () => {} });
    const layer = new TimedNotificationLayer('Title', 'Text', () => opened++, () => dismissed++, () => {}, () => {}, true, 5000, wokeDisplay);
    layer.handleInput(event);
    return { opened, dismissed };
  };
  assert.deepEqual(create(false, { type: 'pointer-click', x: 40, y: 30 }), { opened: 1, dismissed: 0 });
  assert.deepEqual(create(true, { type: 'double-click' }), { opened: 1, dismissed: 0 });
  assert.deepEqual(create(false, { type: 'double-click' }), { opened: 0, dismissed: 1 });
});
test('failed preview open restarts a fresh local timeout', () => {
  let now = 0, tick, expired = 0;
  const { TimedNotificationLayer } = load('app/ui/shell/timed-notification.ts', {
    '../../graphics/image': {}, '../../graphics/ui-fonts': {}, '../../graphics/textwrap': {}, './geometry': {}, './notification-card': notificationCard, '../card-presentation': face, '../presentation-clock': { presentationNow: () => now },
  }, { Date: { now: () => now }, setInterval: cb => { tick = cb; return 1; }, clearInterval: () => {} });
  const layer = new TimedNotificationLayer('Title', 'Text', () => {}, () => {}, () => { expired++; layer.onRemoved(); }, () => {});
  layer.handleInput({ type: 'click' }); now = 7000; tick(); assert.equal(expired, 0);
  layer.reopenAfterOpenFailure(); now = 11_500; tick(); assert.equal(expired, 0);
  now = 11_676; tick(); assert.equal(expired, 1);
});
test('notification preview duration accepts only the four supported windows', () => {
  for (const duration of [3000, 5000, 7000, 10000]) {
    let now = 0, tick, expired = 0;
    const { TimedNotificationLayer } = load('app/ui/shell/timed-notification.ts', {
      ...previewImports, '../presentation-clock': { presentationNow: () => now },
    }, { Date: { now: () => now }, setInterval: cb => { tick = cb; return 1; }, clearInterval: () => {} });
    const layer = new TimedNotificationLayer('Title', 'Text', () => {}, () => {}, () => { expired++; layer.onRemoved(); }, () => {}, true, duration);
    layer.paint(previewContext, previewImage);
    now = duration - 500; tick(); assert.equal(expired, 0);
    now = duration + 1000; tick(); assert.equal(expired, 1);
  }
  let now = 0, tick, expired = 0;
  const { TimedNotificationLayer } = load('app/ui/shell/timed-notification.ts', {
    ...previewImports, '../presentation-clock': { presentationNow: () => now },
  }, { Date: { now: () => now }, setInterval: cb => { tick = cb; return 1; }, clearInterval: () => {} });
  const fallback = new TimedNotificationLayer('Title', 'Text', () => {}, () => {}, () => { expired++; fallback.onRemoved(); }, () => {}, true, 6000);
  fallback.paint(previewContext, previewImage);
  now = 6000; tick(); assert.equal(expired, 1);
});
test('completion baseline and reconnect stay quiet; new completions notify once', async () => {
  const api = new T3DemoApi(); const state = new T3Workspace(api); let arrivals = 0;
  state.onArrival(() => arrivals++);
  await state.refresh(); assert.equal(arrivals, 0);
  api.completeAgent(); await state.refresh(); await state.refresh(); assert.equal(arrivals, 1);
  state.disconnected(); api.completeAgent(); await state.refresh(); assert.equal(arrivals, 1);
});
test('updated phone notification replaces its prior version and stale open reference', () => {
  const state = new T3Workspace(new T3DemoApi());
  const old = { id: 'phone:key:1', kind: 'phone', threadId: 'key', title: 'Sender', body: 'Old', createdAt: 1 };
  state.addAlert(old); state.addAlert({ ...old, id: 'phone:key:2', body: 'New', createdAt: 2 });
  assert.equal(state.alerts.length, 1); assert.equal(state.alerts[0].body, 'New'); assert.equal(state.alerts.includes(old), false);
});

test('ring inbox navigation exposes dismissal in the context menu without a horizontal swipe', async () => {
  const { state, layer, dismissed } = setup();
  state.addAlert({ id: 'first', kind: 'phone', threadId: 'one', title: 'One', body: 'First', createdAt: 1 });
  state.addAlert({ id: 'second', kind: 'phone', threadId: 'two', title: 'Two', body: 'Second', createdAt: 2 });
  layer.go('inbox');
  layer.selected = layer.rows()[0].id;
  await layer.handleInput({ type: 'scroll-down', source: 'ring' });
  const target = layer.selected;
  let popped = 0;
  await layer.menuItems().find(item => item.label === 'Dismiss notification').onSelect({ stack: { pop: () => popped++ } });
  assert.deepEqual(dismissed, [target]); assert.equal(popped, 1);
  await layer.handleInput({ type: 'double-click', source: 'ring' });
  assert.equal(layer.screen, 'dashboard');
});

test('T3 homepage has Notifications, Audio controls and Sessions with Settings in App actions', () => {
  const { layer } = setup();
  assert.deepEqual(Array.from(layer.rows(), row => row.id), ['inbox', 'audio', 'sessions']);
});
test('only dashboard-root back sleeps the display, including after direct nested entry', async () => {
  const { layer, navigation } = setup();
  layer.go('sessions'); layer.go('projects');
  await layer.handleInput({ type: 'double-click', source: 'ring' });
  assert.equal(layer.screen, 'sessions'); assert.equal(navigation.yielded, 0);
  await layer.handleInput({ type: 'double-click', source: 'ring' });
  assert.equal(layer.screen, 'dashboard'); assert.equal(navigation.yielded, 0);
  await layer.handleInput({ type: 'double-click', source: 'ring' }); assert.equal(navigation.yielded, 1);
  layer.screen = 'reader'; layer.history = [];
  await layer.handleInput({ type: 'double-click', source: 'ring' });
  assert.equal(layer.screen, 'dashboard'); assert.equal(navigation.yielded, 1);
});
test('double tap closes App actions before backing through T3 to dashboard sleep', async () => {
  const gestures = load('app/ui/gestures.ts');
  const { LayerStack, noopLayerActions } = load('app/ui/layers.ts', {
    '../graphics/image': { G2_LENS_WIDTH: 576, G2_LENS_HEIGHT: 452 },
    '../graphics/plane': {}, '../native/frame-timings': {}, './gestures': gestures,
  });
  const { MenuLayer } = load('app/ui/menu.ts', {
    '../graphics/image': { G2_LENS_HEIGHT: 452 }, '../graphics/textwrap': {},
    '../graphics/ui-fonts': {}, '../util/numeric-util': {}, './gestures': gestures, './metrics': {},
  });
  for (const source of ['ring', 'watch']) {
    const { layer, navigation } = setup();
    const stack = new LayerStack(layer, noopLayerActions, { width: 576, height: 452 });
    layer.go('sessions'); layer.go('projects');
    stack.push(new MenuLayer('App actions', [{ label: 'Display off', onSelect: () => assert.fail('Back must not select an action') }]));
    await stack.handleInput({ type: 'double-click', source });
    assert.equal(stack.isAtBase(), true);
    assert.equal(layer.screen, 'projects'); assert.equal(navigation.yielded, 0);
    await stack.handleInput({ type: 'double-click', source });
    assert.equal(layer.screen, 'sessions'); assert.equal(navigation.yielded, 0);
    await stack.handleInput({ type: 'double-click', source });
    assert.equal(layer.screen, 'dashboard'); assert.equal(navigation.yielded, 0);
    await stack.handleInput({ type: 'double-click', source });
    assert.equal(navigation.yielded, 1);
  }
});
test('Settings opens phone configuration and leaves a check-phone screen with dashboard back', async () => {
  const { layer, navigation } = setup();
  let popped = 0;
  layer.menuItems().find(row => row.label === 'Settings').onSelect({ stack: { pop: () => popped++ } });
  assert.equal(popped, 1);
  assert.equal(layer.screen, 'phone-settings'); assert.match(layer.body(), /Check your phone/); assert.equal(navigation.phone, 1);
  await layer.handleInput({ type: 'double-click', source: 'ring' });
  assert.equal(layer.screen, 'dashboard'); assert.equal(navigation.yielded, 0);
});
test('Sessions uses Hub section rows and opens project selection only through new session', async () => {
  const { layer, state } = setup(); await state.refresh();
  await layer.rows().find(row => row.id === 'sessions').action();
  await layer.rows().find(row => row.id === 'sessions-all').action();
  assert.equal(layer.screen, 'sessions'); assert.equal(layer.rows().some(row => row.id === 'projects'), false); assert.equal(layer.rows()[0].title, 'START NEW SESSION'); assert.ok(layer.rows().some(row => row.title === 'UNSETTLED' && row.section));
  await layer.rows().find(row => row.id === 'new').action(); assert.equal(layer.screen, 'new-project');
});

test('a conversation tap starts reply dictation without an action-menu step', async () => {
  const { layer, state } = setup(); await state.refresh(); await state.openThread('voice');
  layer.screen = 'reader'; await layer.handleInput({ type: 'click' });
  assert.equal(layer.screen, 'draft');
  assert.deepEqual(Array.from(layer.menuItems(), item => item.label), ['Use plan mode', 'Use normal mode', 'Change model', 'Change reasoning']);
});
test('draft and transcript scrolling advances one page and clamps at the boundaries', async () => {
  const { layer } = setup();
  for (const screen of ['draft', 'reader']) {
    layer.screen = screen; layer.pageCount = 3; layer.scroll = 0;
    await layer.handleInput({ type: 'scroll-down' }); assert.equal(layer.scroll, 1);
    await layer.handleInput({ type: 'scroll-down' }); await layer.handleInput({ type: 'scroll-down' }); assert.equal(layer.scroll, 2);
    await layer.handleInput({ type: 'scroll-up' }); assert.equal(layer.scroll, 1);
  }
});
test('session section labels cannot take ring focus and Hub names include project prefixes', async () => {
  const { layer, state } = setup(); await state.refresh(); layer.go('sessions'); layer.selected = 'new';
  await layer.handleInput({ type: 'scroll-down' });
  const row = layer.rows().find(row => row.id === layer.selected);
  assert.equal(row.section, false); assert.match(row.title, /^[A-Z0-9?]{2} - /);
  assert.match(row.title, /WORKING$/);
});
test('reply cancellation returns directly to its conversation, not an empty compose page', async () => {
  const { layer, state } = setup(); await state.refresh(); await state.openThread('voice'); layer.screen = 'reader';
  await layer.handleInput({ type: 'click' }); assert.equal(layer.screen, 'draft');
  await layer.handleInput({ type: 'double-click' }); assert.equal(layer.screen, 'reader');
});

test('finished dictation shrink restores the dashboard without ever submitting a second empty card', async () => {
  const { layer, state } = setup(); await state.refresh();
  layer.go('compose');
  const renders = [];
  layer.repaint = () => renders.push({ screen: layer.screen, motion: layer.motion });
  layer.cancelCompose();
  assert.equal(renders.length, 1, 'cancel publishes only the restored destination');
  assert.equal(renders[0].screen, 'dashboard');
  assert.equal(renders[0].motion, null, 'no already-collapsed card may be reopened even for one frame');
});


test('opaque cards cover deferred backdrop text and icons while retaining content outside', () => {
  const graphics = load('app/graphics/image.ts', { './textwrap': {} });
  const { GrayImage } = graphics;
  const { paintCardFace } = load('app/apps/t3/card-motion.ts', { '../../ui/card-presentation': face });
  const image = new GrayImage(80, 80, 0);
  const glyph = { bbxWidth: 1, bbxHeight: 1, bbxX: 0, bbxY: 0, bitmapRows: [128] };
  const font = { ascent: 1 };
  image.drawGlyph(font, glyph, 20, 20, 240);
  image.drawGlyph(font, glyph, 60, 60, 180);
  image.drawImage(new GrayImage(2, 2, 210), 22, 22);
  paintCardFace(image, { x: 10, y: 10, width: 40, height: 40 });
  image.drawGlyph(font, glyph, 25, 25, 230);
  const painted = image.withDrawsBaked();
  assert.equal(painted.pixels[20 * 80 + 20], 1);
  assert.equal(painted.pixels[22 * 80 + 22], 1);
  assert.equal(painted.pixels[60 * 80 + 60], 180);
  assert.equal(painted.pixels[25 * 80 + 25], 230);
});

test('opaque clipped blits copy scanlines and preserve translated deferred glyphs', () => {
  const { GrayImage } = load('app/graphics/image.ts', { './textwrap': {} });
  const source = new GrayImage(4, 2, 0);
  source.pixels.set([1, 2, 3, 4, 5, 6, 7, 8]);
  const glyph = { bbxWidth: 1, bbxHeight: 1, bbxX: 0, bbxY: 0, bitmapRows: [128] };
  source.drawGlyph({ ascent: 1 }, glyph, 2, 1, 200);
  const target = new GrayImage(5, 2, 9);
  target.bitBlt(source, -1, 0);
  assert.deepEqual(Array.from(target.pixels), [2, 3, 4, 9, 9, 6, 7, 8, 9, 9]);
  assert.equal(target.draws.length, 1);
  assert.equal(target.draws[0].x, 1);
  assert.equal(target.draws[0].y, 1);
});


test('notification inbox menu action dismisses selected entry and retains the next card', async () => {
  const h = setup();
  h.state.addAlert({ id: 'one', kind: 'phone', threadId: 'first', title: 'First', body: 'Message', createdAt: 1 });
  h.state.addAlert({ id: 'two', kind: 'phone', threadId: 'second', title: 'Second', body: 'Message', createdAt: 2 });
  h.layer.go('inbox'); h.layer.selected = 'two';
  await h.layer.menuItems().find(item => item.label === 'Dismiss notification')?.onSelect({ stack: { pop() {} } });
  assert.deepEqual(h.dismissed, ['two']); assert.equal(h.layer.screen, 'inbox');
  assert.equal(h.layer.selected, 'one'); assert.equal(h.navigation.yielded, 0);
  assert.equal(h.layer.claimsNotificationDismissGesture(), true);
  h.layer.screen = 'reader'; assert.equal(h.layer.claimsNotificationDismissGesture(), false);
});

test('notification reader menu action restores its interrupted app after successful cancellation', async () => {
  const h = setup();
  h.state.addAlert({ id: 'one', kind: 'phone', threadId: 'first', title: 'First', body: 'Message', createdAt: 1 });
  h.layer.openNotification('one', 'notes');
  await h.layer.menuItems().find(item => item.label === 'Dismiss notification')?.onSelect({ stack: { pop() {} } });
  assert.deepEqual(h.dismissed, ['one']); assert.deepEqual(h.navigation.focused, ['notes']);
  assert.equal(h.state.alerts.length, 0); assert.equal(h.navigation.yielded, 0);
});

test('notification reader failed or stale dismissal cannot close content or act on another notification', async () => {
  const h = setup(); h.denyDismiss();
  h.state.addAlert({ id: 'one', kind: 'phone', threadId: 'first', title: 'First', body: 'Message', createdAt: 1 });
  h.layer.openNotification('one', 'notes');
  await h.layer.menuItems().find(item => item.label === 'Dismiss notification')?.onSelect({ stack: { pop() {} } });
  assert.equal(h.layer.screen, 'notification'); assert.equal(h.state.alerts.length, 1);
  assert.deepEqual(h.navigation.focused, []);
  h.state.alerts = [{ id: 'two', kind: 'phone', threadId: 'second', title: 'Second', body: 'Message', createdAt: 2 }];
  await h.layer.menuItems().find(item => item.label === 'Dismiss notification')?.onSelect({ stack: { pop() {} } });
  assert.deepEqual(h.dismissed, ['one']); assert.equal(h.state.alerts[0].id, 'two');
});

test('notification workspace replaces one conversation across keys without removing other threads', () => {
  const state = new T3Workspace(new T3DemoApi()); let arrivals = 0; state.onArrival(() => arrivals++);
  const base = { kind: 'phone', title: 'Sender', body: 'First', createdAt: 1 };
  state.addAlert({ ...base, id: 'old', threadId: 'old-key', groupId: 'conversation-one', arrivalFingerprint: 'first' });
  state.addAlert({ ...base, id: 'other', threadId: 'other-key', groupId: 'conversation-two' });
  state.addAlert({ ...base, id: 'new', threadId: 'new-key', groupId: 'conversation-one', body: 'New', arrivalFingerprint: 'second' });
  assert.deepEqual(Array.from(state.alerts, alert => alert.id), ['new', 'other']);
  state.addAlert({ ...state.alerts[0], id: 'reposted' }, false);
  assert.equal(arrivals, 3); assert.deepEqual(Array.from(state.alerts, alert => alert.id), ['reposted', 'other']);
});

test('dashboard and inbox bell use the same active cards after restart and filtering', () => {
  const h = setup(); h.state.alerts = [{ id: 'stale-cache' }];
  h.setVisible([{ id: 'native-one', title: 'One' }, { id: 'native-two', title: 'Two' }]);
  const ctx = { stack: { getBaseSize: () => ({ width: 576, height: 288 }) } };
  h.layer.paint(ctx); assert.equal(h.counts.at(-1), 2);
  h.layer.go('inbox'); h.layer.motion = null; h.layer.paint(ctx); assert.equal(h.counts.at(-1), 2);
  h.setVisible([]); h.layer.paint(ctx); assert.equal(h.counts.at(-1), 0);
});

test('notification reader tap opens one reviewed reply destination without sending', async () => {
  const h = setup(); const sent = [];
  h.state.alerts = [{ id: 'one', kind: 'phone', title: 'Sender', body: 'Message' }];
  h.setReply({ isCurrent: () => true, send: text => { sent.push(text); return true; } });
  h.layer.openNotification('one'); await h.layer.handleInput({ type: 'click' });
  assert.equal(h.reviews.length, 1); assert.deepEqual(sent, []); assert.equal(h.layer.screen, 'notification');
  const [target, canStart] = h.reviews[0];
  assert.equal(target.label, 'Send reply'); assert.equal(canStart(), true);
  target.onSend('Reviewed text'); await new Promise(resolve=>setImmediate(resolve)); assert.deepEqual(sent, ['Reviewed text']); assert.equal(h.layer.screen, 'dashboard'); assert.equal(h.layer.notificationNotice, '');
});

test('notification review rejects navigation, focus loss and changed native versions', async () => {
  for (const mutate of [h => h.layer.go('dashboard'), h => h.setFocused(false),
    h => h.setVisible([{ id: 'replacement', kind: 'phone', groupId: 'same-thread' }]), h => h.setVisible([])]) {
    const h = setup(); let sent = 0;
    h.state.alerts = [{ id: 'one', kind: 'phone', groupId: 'same-thread' }];
    h.setReply({ isCurrent: () => true, send: () => { sent++; return true; } });
    h.layer.openNotification('one'); await h.layer.handleInput({ type: 'click' });
    mutate(h); assert.equal(h.reviews[0][1](), false); h.reviews[0][0].onSend('Reviewed text'); assert.equal(sent, 0);
  }
});

test('opened reader follows only its known conversation and tap binds the replacement version', async () => {
  const h = setup(); const bound = [];
  h.state.alerts = [{ id: 'old', kind: 'phone', groupId: 'app-profile-thread', title: 'Sender', body: 'Old' }];
  h.layer.openNotification('old');
  h.setVisible([{ id: 'new', kind: 'phone', groupId: 'app-profile-thread', title: 'Sender', body: 'New' }]);
  h.setReply(id => { bound.push(id); return { isCurrent: () => true, send: () => true }; });
  assert.match(h.layer.body(), /New/); await h.layer.handleInput({ type: 'click' }); assert.deepEqual(bound, ['new']);
  h.setVisible([{ id: 'other', kind: 'phone', groupId: 'other-profile-thread', title: 'Sender', body: 'Private' }]);
  assert.equal(h.layer.body(), 'Notification no longer available.');
  await h.layer.handleInput({ type: 'click' }); assert.equal(h.reviews.length, 1);
});

test('notification reader provides a reply affordance only for an enabled text action', async () => {
  const h = setup(); h.state.alerts = [{ id: 'one', kind: 'phone', title: 'Sender', body: 'Message' }]; h.layer.openNotification('one'); h.layer.motion = null;
  const ctx = { stack: { getBaseSize: () => ({ width: 576, height: 288 }) } };
  h.layer.paint(ctx); assert.equal(h.drawn.at(-1), 'Reply unavailable for this notification');
  await h.layer.handleInput({ type: 'click' }); assert.equal(h.reviews.length, 0);
  h.setReply({ isCurrent: () => true, send: () => false }); h.layer.paint(ctx); assert.equal(h.drawn.at(-1), 'Tap to dictate reply');
});

test('successful wake-origin reply automatically restores sleep and the interrupted app', async () => {
  const h = setup(); h.state.alerts = [{ id: 'one', kind: 'phone' }]; let sent = 0;
  h.setReply({ isCurrent: () => true, send: () => { sent++; return true; } });
  h.layer.openNotification('one', 'notes', true);
  await h.layer.handleInput({ type: 'click' });
  assert.equal(h.layer.notificationReturnToSleep, true); assert.equal(h.navigation.yielded, 0);
  h.reviews[0][0].onSend('Reviewed reply'); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent, 1); assert.equal(h.layer.notificationReturnToSleep, false); assert.equal(h.navigation.yielded, 1);
  assert.deepEqual(h.dismissed, []); // The host dismisses the bound notification after sending. assert.deepEqual(h.navigation.events, ['sleep', 'focus:notes']);
  assert.equal(h.layer.notificationReturnToSleep, false);
  h.reviews[0][0].onSend('Late callback'); assert.equal(sent, 1); assert.equal(h.navigation.yielded, 1);
});

test('failed wake-origin dismissal retains its reader and sleep intent', async () => {
  const h = setup(); h.state.alerts = [{ id: 'one', kind: 'phone' }]; h.denyDismiss();
  h.layer.openNotification('one', 'notes', true);
  await h.layer.menuItems().find(item => item.label === 'Dismiss notification')?.onSelect({ stack: { pop() {} } });
  assert.equal(h.layer.screen, 'notification'); assert.equal(h.layer.notificationReturnToSleep, true);
  assert.deepEqual(h.navigation.events, []); assert.equal(h.state.alerts.length, 1);
});

test('wake-origin reader explicitly closes to sleep when reply has removed its notification', async () => {
  const h = setup(); h.state.alerts = [{ id: 'one', kind: 'phone' }];
  h.layer.openNotification('one', 'notes', true); h.state.alerts = [];
  await h.layer.handleInput({ type: 'double-click' });
  assert.deepEqual(h.dismissed, []); assert.deepEqual(h.navigation.events, ['sleep', 'focus:notes']);
});

test('direct inbox reopen clears prior wake origin and ordinary dismissal stays awake', async () => {
  const h = setup(); h.state.alerts = [{ id: 'one', kind: 'phone' }];
  h.layer.openNotification('one', 'notes', true);
  h.layer.openNotification('one', 'notes');
  await h.layer.menuItems().find(item => item.label === 'Dismiss notification')?.onSelect({ stack: { pop() {} } });
  assert.deepEqual(h.navigation.events, ['focus:notes']); assert.equal(h.navigation.yielded, 0);
});

test('reader back restores wake-origin sleep but reply cancellation alone does not', async () => {
  const h = setup(); h.state.alerts = [{ id: 'one', kind: 'phone' }];
  h.setReply({ isCurrent: () => true, send: () => true });
  h.layer.openNotification('one', 'notes', true); await h.layer.handleInput({ type: 'click' });
  h.reviews[0][2]();
  assert.equal(h.navigation.yielded, 0); assert.equal(h.layer.notificationReturnToSleep, true);
  await h.layer.handleInput({ type: 'double-click' });
  assert.deepEqual(h.navigation.events, ['sleep', 'focus:notes']); assert.deepEqual(h.dismissed, ['one']);
});

test('T3 readers fill the configured viewport and repaginate unchanged transcripts on resize', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('voice');
  const transcript = h.state.transcript;
  transcript.turns = [{ id: 'layout', startedAt: '', endedAt: '', durationSeconds: 1, separatorLabel: '', messages: [
    { id: 'wide', role: 'assistant', text: 'Wide content '.repeat(350), streaming: false, createdAt: '', updatedAt: '' },
  ] }];
  h.layer.screen = 'reader'; h.layer.motion = null;
  h.layer.paint({ stack: { getBaseSize: () => ({ width: 576, height: 288 }) } });
  const smallPages = h.layer.pageCount;
  h.placements.length = 0; h.cards.length = 0;
  h.layer.paint({ stack: { getBaseSize: () => ({ width: 640, height: 452 }) } });
  assert.ok(h.layer.pageCount < smallPages);
  assert.equal(h.cards.length, 0, 'the transcript floats without an outer card');
  // The retained final page may be short; inspect a full page for vertical capacity.
  h.layer.scroll = 0; h.placements.length = 0;
  h.layer.paint({ stack: { getBaseSize: () => ({ width: 640, height: 452 }) } });
  assert.ok(h.placements.some(p => p.y > 288));
  assert.ok(h.placements.every(p => p.x >= 0 && p.y + 17 <= 452));
});

test('session selection floats while question/review cards fill the viewport and inbox stays compact', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('plan');
  const paint = () => { h.cards.length = 0; h.layer.motion = null; h.layer.paint({ stack: { getBaseSize: () => ({ width: 640, height: 452 }) } }); };
  h.layer.screen = 'sessions'; paint(); assert.equal(h.cards.length, 0, 'the session selector has no outer card');
  for (const screen of ['new-project', 'new-model', 'new-reasoning', 'question', 'plan-review', 'draft']) {
    h.layer.screen = screen; paint(); assert.equal(h.cards[0].width, 635, screen); assert.equal(h.cards[0].height, 447, screen);
  }
  h.layer.screen = 'inbox'; paint(); assert.equal(h.cards[0].width, 544); assert.equal(h.cards[0].height, 104);
});

test('session and new-session lists mark focus with brackets instead of a bounded row box', async () => {
  const h = setup(); await h.state.refresh();
  const paint = () => { h.brackets.length = 0; h.borders.length = 0; h.layer.paint({ stack: { getBaseSize: () => ({ width: 640, height: 452 }) } }); };
  for (const screen of ['sessions', 'new-project']) {
    h.layer.screen = screen; h.layer.selected = '';
    paint(); assert.equal(h.brackets.length, 1, screen); assert.equal(h.borders.length, 0, `${screen} draws no focus box`);
    const firstY = h.brackets[0].top;
    await h.layer.handleInput({ type: 'scroll-down' }); paint();
    assert.equal(h.brackets.length, 1, screen); assert.ok(h.brackets[0].top > firstY, screen);
  }
});

const questionPaint = h => { h.brackets.length = 0; h.placements.length = 0; h.layer.motion = null; h.layer.paint({ stack: { getBaseSize: () => ({ width: 576, height: 452 }) } }); };

test('a plan question shows its text above bracket-focused answers and a dictation row', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('plan');
  h.layer.screen = 'reader'; questionPaint(h);
  assert.equal(h.layer.screen, 'question'); assert.equal(h.layer.questionIndex, 0);
  assert.deepEqual(h.layer.rows().map(row => row.id), ['option-0', 'option-1', 'dictate']);
  questionPaint(h);
  const text = h.placements.map(p => p.text);
  assert.ok(text.includes('QUESTION 1/3 | LAYOUT'));
  const question = h.placements.find(p => p.text === 'Which conversation layout should we test first?');
  const option = h.placements.find(p => p.text === 'Full-height reader');
  assert.ok(question && option && question.y < option.y, 'question text sits above its answers');
  assert.ok(text.includes('Dictate answer'));
  assert.ok(text.includes('Use the taller Faceclaw viewport.'), 'the focused answer explains itself in the footer');
  assert.equal(h.brackets.length, 1);
  const firstTop = h.brackets[0].top;
  await h.layer.handleInput({ type: 'scroll-down' }); questionPaint(h);
  assert.equal(h.layer.selected, 'option-1'); assert.ok(h.brackets[0].top > firstTop);
  await h.layer.handleInput({ type: 'click' });
  assert.deepEqual(h.state.getPlan('plan').answers[0].optionIndexes, [1]);
  assert.equal(h.layer.screen, 'question'); assert.equal(h.layer.questionIndex, 1);
});

test('double tap walks back through questions and review before leaving to the conversation', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('plan');
  h.layer.go('sessions'); h.layer.openThread('plan'); await new Promise(resolve => setImmediate(resolve));
  questionPaint(h);
  assert.equal(h.layer.screen, 'question');
  await h.layer.handleInput({ type: 'scroll-down' }); await h.layer.handleInput({ type: 'click' });
  assert.equal(h.layer.questionIndex, 1);
  await h.layer.handleInput({ type: 'click' });
  for (let i = 0; i < 3; i++) await h.layer.handleInput({ type: 'scroll-down' });
  assert.equal(h.layer.selected, 'accept');
  await h.layer.handleInput({ type: 'click' });
  assert.equal(h.layer.questionIndex, 2);
  await h.layer.handleInput({ type: 'click' });
  assert.equal(h.layer.screen, 'plan-review');
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.screen, 'question'); assert.equal(h.layer.questionIndex, 2);
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.questionIndex, 1); assert.deepEqual(h.layer.checked, [0], 'multi-select answers are restored');
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.questionIndex, 0); assert.equal(h.layer.selected, 'option-1', 'the saved answer takes focus');
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.screen, 'reader'); assert.equal(h.navigation.yielded, 0);
  questionPaint(h); assert.equal(h.layer.screen, 'reader', 'the reader does not bounce back into the questions');
  assert.ok(h.layer.menuItems().some(item => item.label === 'Answer questions'));
  await h.layer.handleInput({ type: 'click' });
  assert.equal(h.layer.screen, 'plan-review', 'a reader tap resumes the answer set');
  h.layer.go('reader', false); await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.screen, 'sessions');
});

test('multi-select answers toggle checks and require Done', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('plan');
  h.layer.openPlanQuestion(1);
  assert.equal(h.layer.rows().find(row => row.id === 'accept').disabled, true);
  await h.layer.handleInput({ type: 'scroll-down' }); await h.layer.handleInput({ type: 'scroll-down' });
  await h.layer.handleInput({ type: 'click' });
  await h.layer.handleInput({ type: 'scroll-up' }); await h.layer.handleInput({ type: 'scroll-up' });
  await h.layer.handleInput({ type: 'click' });
  assert.deepEqual(h.layer.rows().filter(row => row.checked).map(row => row.id), ['option-0', 'option-2']);
  assert.equal(h.layer.screen, 'question'); assert.equal(h.state.getPlan('plan').answers.length, 0, 'toggling saves nothing');
  const done = h.layer.rows().find(row => row.id === 'accept');
  assert.equal(done.title, 'Done · 2 selected'); await done.action();
  assert.deepEqual(h.state.getPlan('plan').answers[0].optionIndexes, [0, 2]);
});

test('dictated or typed answers replace the options for that question', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('plan');
  h.layer.openPlanQuestion(0);
  await h.layer.rows().find(row => row.id === 'dictate').action();
  assert.equal(h.layer.screen, 'draft'); assert.equal(h.layer.dictatingAnswer, true);
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.screen, 'question', 'cancelling a dictated answer returns to its question');
  await h.layer.rows().find(row => row.id === 'dictate').action();
  await h.layer.handleInput({ type: 'click' });
  assert.equal(h.state.getPlan('plan').answers[0].text, 'Check the reconnect flow and preserve the reading position.');
  assert.equal(h.layer.questionIndex, 1);
  h.layer.openPlanQuestion(0);
  assert.equal(h.layer.selected, 'dictate');
  assert.match(h.layer.rows().find(row => row.id === 'dictate').title, /^Dictated: Check the reconnect/);
  assert.equal(h.layer.rows().some(row => row.checked), false);
  h.layer.receiveText('Typed on the phone');
  assert.equal(h.layer.screen, 'draft'); await h.layer.handleInput({ type: 'click' });
  assert.equal(h.state.getPlan('plan').answers.find(answer => answer.questionId === 'layout').text, 'Typed on the phone');
  assert.equal(h.api.calls.includes('turn.send'), false, 'question answers never send as conversation messages');
});

test('long question text scrolls into view before its answers', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('plan');
  const question = h.state.getPlan('plan').request.questions[0];
  // The harness wraps one line per explicit break.
  question.question = Array.from({ length: 16 }, (_, i) => `Line ${i + 1}`).join('\n');
  h.layer.openPlanQuestion(0);
  assert.equal(h.layer.selected, 'question-body', 'overflowing text is read before choosing');
  questionPaint(h);
  assert.ok(h.placements.some(p => p.text === 'Line 1')); assert.equal(h.brackets.length, 0);
  assert.ok(h.placements.some(p => p.text === 'Scroll down for the answers.'));
  let guard = 0;
  while (h.layer.selected === 'question-body' && guard++ < 10) await h.layer.handleInput({ type: 'scroll-down' });
  assert.equal(h.layer.selected, 'option-0');
  questionPaint(h);
  assert.ok(h.placements.some(p => p.text === 'Line 16')); assert.ok(!h.placements.some(p => p.text === 'Line 1'));
  assert.ok(h.placements.some(p => p.text === 'Full-height reader')); assert.equal(h.brackets.length, 1);
  await h.layer.handleInput({ type: 'scroll-up' });
  assert.equal(h.layer.selected, 'question-body');
  guard = 0;
  while (h.layer.scroll > 0 && guard++ < 10) await h.layer.handleInput({ type: 'scroll-up' });
  questionPaint(h); assert.ok(h.placements.some(p => p.text === 'Line 1'));
  await h.layer.handleInput({ type: 'click' });
  assert.equal(h.state.getPlan('plan').answers.length, 0, 'a tap while reading never picks an answer');
});

test('dictated draft review reflows Whisper segment boundaries while keeping authoritative send text', () => {
  const h = setup(); h.layer.screen = 'compose';
  const raw = 'A Whisper recognition segment\n continues in the next segment.';
  h.layer.receiveText(raw, true);
  assert.equal(h.layer.body(), 'A Whisper recognition segment continues in the next segment.');
  assert.equal(h.layer.draft, raw);
  h.layer.receiveText(raw, false); assert.equal(h.layer.body(), raw, 'typed source line breaks remain explicit');
});

test('capture cancellation with no prior navigation publishes one static dashboard', () => {
  const { layer } = setup(); layer.screen = 'compose'; layer.history = [];
  layer.motion = { from: {}, to: {}, started: 0 }; const renders = [];
  layer.repaint = () => renders.push({ screen: layer.screen, motion: layer.motion });
  layer.cancelCompose();
  assert.deepEqual(renders, [{ screen: 'dashboard', motion: null }]);
});

test('capture cancellation retains its reader position and ordinary navigation is immediate', () => {
  const { layer } = setup(); layer.screen = 'reader'; layer.scroll = 7;
  layer.go('compose'); const renders = [];
  layer.repaint = () => renders.push({ screen: layer.screen, scroll: layer.scroll, motion: layer.motion });
  layer.cancelCompose();
  assert.deepEqual(renders, [{ screen: 'reader', scroll: 7, motion: null }]);
  layer.screen = 'dashboard'; layer.go('sessions'); layer.back();
  assert.equal(layer.screen, 'dashboard'); assert.equal(layer.slide, null, 'ordinary dashboard return is immediate');
});

test('phone taps use the same full-size menu geometry as rendered rows', async () => {
  const h = setup();
  h.state.projects = Array.from({ length: 20 }, (_, index) => ({ id: 'p' + index, title: 'Project ' + index, canStartSession: true }));
  h.layer.screen = 'new-project';
  h.layer.paint({ stack: { getBaseSize: () => ({ width: 640, height: 452 }) } });
  assert.equal(await h.layer.hitTest(20, 30), false, 'header must not select a row');
  assert.equal(await h.layer.hitTest(620, 42 + 10 * 27 + 1), true, 'right and lower full-size content remains tappable');
  assert.equal(h.layer.creation.projectId, 'p10');
  assert.equal(h.layer.screen, 'new-model');
});

test('topmost full-size menu row is tappable at its painted position', async () => {
  const h = setup(); await h.state.refresh(); h.layer.screen = 'sessions';
  h.layer.paint({ stack: { getBaseSize: () => ({ width: 640, height: 452 }) } });
  assert.equal(await h.layer.hitTest(20, 45), true); assert.equal(h.layer.screen, 'new-project');
});


test('thinking and tool activity use a visible geometric indicator without shifting transcript rows', async () => {
  for (const phase of ['thinking', 'tool']) {
    const h = setup(); await h.state.refresh(); await h.state.openThread('voice');
    const transcript = h.state.transcript;
    transcript.session.status = 'running';
    transcript.turns = [{ id: 'live', startedAt: '2026-09-07T00:00:00Z', endedAt: null, durationSeconds: null, messages: [] }];
    transcript.liveActivities = [];
    transcript.liveActivity = { phase, label: phase === 'tool' ? 'Read project files' : 'Thinking', updatedAt: '2026-09-07T00:00:01Z' };
    h.layer.screen = 'reader'; h.layer.motion = null;
    h.layer.paint({ stack: { getBaseSize: () => ({ width: 640, height: 452 }) } });
    assert.equal(h.layer.needsAnimation(), false, 'activity uses a sparse deadline rather than every host credit');
    assert.ok(h.layer.nextAnimationDelayMs() > 0 && h.layer.nextAnimationDelayMs() <= 140);
    const label = h.placements.find(row => row.text === (phase === 'tool' ? 'Read project files' : 'thinking'));
    assert.ok(label); assert.equal(label.x, 46); // 22px indicator + 8px gap after x=16
    assert.ok(h.drawn.every(text => !/[◐◓◑◒]/.test(text)));
    assert.ok(h.placements.every(row => row.y + 17 <= 452));
  }
});

test('battery activity modes slow or stop only decorative indicator deadlines', async () => {
  for (const [mode, expectedDelay] of [['efficient', 500], ['static', null]]) {
    const h = setup({ now: 1000 }, false, { activityIndicatorMode: mode });
    await h.state.refresh(); await h.state.openThread('voice');
    h.state.transcript.session.status = 'running';
    h.state.transcript.turns = [{ id: 'live', startedAt: '2026-09-07T00:00:00Z', endedAt: null, durationSeconds: null, messages: [] }];
    h.state.transcript.liveActivities = [];
    h.state.transcript.liveActivity = { phase: 'thinking', label: 'Thinking', updatedAt: '2026-09-07T00:00:01Z' };
    h.layer.screen = 'reader'; h.layer.motion = null;
    h.layer.paint({ stack: { getBaseSize: () => ({ width: 640, height: 452 }) } });
    assert.equal(h.layer.nextAnimationDelayMs(), expectedDelay);
  }
});

test('disconnect preserves transcript text but stops stale live animation', () => {
  const h = setup();
  h.state.transcript = { snapshotId: 'one', session: { id: 'thread', status: 'running' }, turns: [], liveActivities: [],
    liveActivity: { phase: 'thinking', label: 'Thinking', updatedAt: new Date().toISOString() } };
  const previousSession = h.state.transcript.session;
  h.state.disconnected();
  assert.equal(h.state.transcript.liveActivity, null);
  assert.equal(h.state.transcript.session, previousSession);
});


test('same-thread silence requires a visible reader and its current loaded transcript', () => {
  const h = setup(); const alert = { kind: 't3', threadId: 'reading' };
  h.layer.screen = 'reader'; h.state.selectedThreadId = 'reading'; h.state.transcript = { session: { id: 'reading' } };
  assert.equal(h.layer.isAlertVisible(alert), true);
  h.setFocused(false); assert.equal(h.layer.isAlertVisible(alert), true, 'sidebar leaves conversation visible');
  h.visibility.overlay = true; h.visibility.preview = 'other-arrival';
  assert.equal(h.layer.isAlertVisible(alert), true, 'another floating preview does not replace the visible conversation');
  h.visibility.preview = null; assert.equal(h.layer.isAlertVisible(alert), false, 'opaque shell modal obscures reader');
  h.visibility.overlay = false;
  for (const key of ['appBase', 'on']) {
    h.visibility[key] = false; assert.equal(h.layer.isAlertVisible(alert), false, key); h.visibility[key] = true;
  }
  h.visibility.foreground = 'notes'; assert.equal(h.layer.isAlertVisible(alert), false); h.visibility.foreground = 't3';
  for (const screen of ['dashboard', 'sessions', 'inbox', 'actions']) {
    h.layer.screen = screen; assert.equal(h.layer.isAlertVisible(alert), false, screen);
  }
  h.layer.screen = 'reader';
  assert.equal(h.layer.isAlertVisible({ kind: 't3', threadId: 'other' }), false);
  h.state.transcript = null; assert.equal(h.layer.isAlertVisible(alert), false, 'a stale selection is insufficient');
  h.state.transcript = { session: { id: 'previous-account' } }; assert.equal(h.layer.isAlertVisible(alert), false);
});

test('phone reader silences only the same app/profile-scoped conversation across native key changes', () => {
  const h = setup();
  const groupId = JSON.stringify(['conversation', 'chat', 0, '83']);
  h.state.alerts = [{ id: 'first', kind: 'phone', threadId: 'old-key', groupId }];
  h.layer.openNotification('first');
  const latest = { id: 'latest', kind: 'phone', threadId: 'new-key', groupId };
  h.state.alerts = [latest];
  assert.equal(h.layer.isAlertVisible(latest), true);
  for (const group of [['conversation', 'other-app', 0, '83'], ['conversation', 'chat', 10, '83'], ['conversation', 'chat', 0, '84']]) {
    assert.equal(h.layer.isAlertVisible({ ...latest, groupId: JSON.stringify(group) }), false);
  }
  assert.equal(h.layer.isAlertVisible({ kind: 't3', threadId: 'new-key' }), false);
  h.visibility.on = false; assert.equal(h.layer.isAlertVisible(latest), false);
  h.visibility.on = true; h.state.alerts = []; assert.equal(h.layer.isAlertVisible(latest), false, 'removed native source cannot authorize silence');
});


test('same retained sleeping T3 reader wakes in place without moving its reading position', () => {
  const h = setup(); const alert = { kind: 't3', threadId: 'reading' };
  h.layer.screen = 'reader'; h.layer.scroll = 3; h.state.selectedThreadId = 'reading';
  h.state.transcript = { session: { id: 'reading' } }; h.visibility.on = false;
  assert.equal(h.layer.showAlertInCurrentConversation(alert), true);
  assert.equal(h.navigation.wakes, 1); assert.equal(h.layer.screen, 'reader'); assert.equal(h.layer.scroll, 3);
  assert.equal(h.state.selectedThreadId, 'reading'); assert.equal(h.api.calls.length, 0); assert.deepEqual(h.navigation.focused, []);
  assert.equal(h.layer.showAlertInCurrentConversation(alert), true);
  assert.equal(h.navigation.wakes, 1, 'already awake does not wake again');
});

test('sleeping stale selection, different thread, obscuring app layer and other foreground never wake directly', () => {
  for (const variation of ['different-thread', 'loading', 'stale-transcript', 'different-app', 'app-overlay', 'shell-overlay', 'dashboard', 'draft']) {
    const h = setup(); const alert = { kind: 't3', threadId: 'reading' };
    h.layer.screen = 'reader'; h.state.selectedThreadId = 'reading'; h.state.transcript = { session: { id: 'reading' } }; h.visibility.on = false;
    if (variation === 'different-thread') alert.threadId = 'other';
    if (variation === 'loading') h.state.transcript = null;
    if (variation === 'stale-transcript') h.state.transcript.session.id = 'old-account';
    if (variation === 'different-app') h.visibility.foreground = 'notes';
    if (variation === 'app-overlay') h.visibility.appBase = false;
    if (variation === 'shell-overlay') h.visibility.overlay = true;
    if (variation === 'dashboard' || variation === 'draft') h.layer.screen = variation;
    assert.equal(h.layer.showAlertInCurrentConversation(alert), false, variation);
    assert.equal(h.navigation.wakes, 0); assert.equal(h.visibility.on, false);
  }
});

test('sleeping phone reader wakes only for its authorized scoped conversation and preserves navigation', () => {
  const h = setup(); const groupId = JSON.stringify(['conversation', 'chat', 0, '83']);
  h.state.alerts = [{ id: 'first', kind: 'phone', threadId: 'old-key', groupId }];
  h.layer.openNotification('first', 'notes'); h.layer.scroll = 2; h.visibility.on = false;
  const latest = { id: 'latest', kind: 'phone', threadId: 'new-key', groupId };
  h.state.alerts = [latest];
  for (const group of [['conversation', 'other-app', 0, '83'], ['conversation', 'chat', 10, '83'], ['conversation', 'chat', 0, '84']]) {
    assert.equal(h.layer.showAlertInCurrentConversation({ ...latest, groupId: JSON.stringify(group) }), false);
  }
  assert.equal(h.navigation.wakes, 0);
  assert.equal(h.layer.showAlertInCurrentConversation(latest), true); assert.equal(h.navigation.wakes, 1);
  assert.equal(h.layer.screen, 'notification'); assert.equal(h.layer.scroll, 2); assert.equal(h.layer.returnWindowId, 'notes');
  assert.equal(h.reviews.length, 0); assert.deepEqual(h.dismissed, []);
  h.visibility.on = false; h.state.alerts = [];
  assert.equal(h.layer.showAlertInCurrentConversation(latest), false, 'removed or filtered source cannot wake');
  assert.equal(h.navigation.wakes, 1);
});

test('draft app actions select plan mode without sending until the review tap', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('voice');
  h.layer.screen = 'reader'; await h.layer.handleInput({ type: 'click' });
  const original = h.layer.draft;
  await h.layer.menuItems().find(item => item.label === 'Use plan mode').onSelect({ stack: { pop() {} } });
  assert.equal(h.layer.draftMode, 'plan'); assert.equal(h.layer.draft, original);
  assert.equal(h.api.calls.includes('turn.send'), false);
  await h.layer.handleInput({ type: 'click' });
  assert.equal(h.api.calls.filter(method => method === 'turn.send').length, 1);
  assert.equal(h.state.transcript.session.interactionMode, 'plan');
});

test('mode controls are hidden for active sessions and custom question answers', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('ui');
  h.layer.screen = 'reader'; await h.layer.handleInput({ type: 'click' });
  assert.equal(h.layer.menuItems().some(item => item.label === 'Use plan mode'), false);
  h.state.transcript.session.status = 'idle'; h.layer.dictatingAnswer = true;
  assert.equal(h.layer.menuItems().some(item => item.label === 'Use plan mode'), false);
});

test('changing reasoning preserves the reviewed draft and its mode selection', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('voice');
  h.layer.screen = 'reader'; await h.layer.handleInput({ type: 'click' });
  const original = h.layer.draft;
  h.layer.draftMode = 'plan';
  await h.layer.menuItems().find(item => item.label === 'Change reasoning').onSelect({ stack: { pop() {} } });
  assert.equal(h.layer.screen, 'session-reasoning');
  await h.layer.rows().find(row => row.id === 'medium').action();
  assert.equal(h.layer.screen, 'draft'); assert.equal(h.layer.draft, original); assert.equal(h.layer.draftMode, 'plan');
  assert.equal(h.state.transcript.session.modelSelection.reasoningId, 'medium');
  assert.equal(h.api.calls.includes('turn.send'), false);
});

test('reasoning selection never retargets a different thread opened in the meantime', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('voice');
  h.layer.screen = 'reader'; h.layer.openReasoning();
  await h.state.openThread('day');
  await h.layer.rows().find(row => row.id === 'medium').action();
  assert.equal(h.api.calls.includes('thread.reasoning.set'), false);
});

test('session model picker shows pending and rejected outcomes without losing its context', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('voice');
  h.layer.screen = 'reader'; await h.layer.handleInput({ type: 'click' });
  await h.layer.menuItems().find(item => item.label === 'Change model').onSelect({ stack: { pop() {} } });
  await Promise.resolve(); await Promise.resolve();
  let reject;
  h.state.setModel = () => new Promise(resolve => { reject = () => { h.state.error = 'invalid_request: Strict payload rejected'; resolve(false); }; });
  const pending = h.layer.rows().find(row => row.id === 'demo/preview-luna').action();
  h.drawn.length = 0; h.layer.paint({ stack: { getBaseSize: () => ({ width: 640, height: 452 }) } });
  assert.ok(h.drawn.includes('APPLYING CHANGE...'));
  reject(); await pending;
  assert.equal(h.layer.screen, 'session-model');
  h.drawn.length = 0; h.layer.paint({ stack: { getBaseSize: () => ({ width: 640, height: 452 }) } });
  assert.ok(h.drawn.includes('invalid_request: Strict payload rejected'));
});

test('completed-plan approval needs its own confirmation tap and starts implementation once', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('completed-plan');
  h.layer.screen = 'reader';
  await h.layer.menuItems().find(item => item.label === 'Review plan').onSelect({ stack: { pop() {} } });
  assert.equal(h.layer.screen, 'proposed-plan');
  await h.layer.handleInput({ type: 'click' });
  assert.equal(h.api.calls.includes('plan.approve'), false);
  await h.layer.menuItems().find(item => item.label === 'Approve and implement').onSelect({ stack: { pop() {} } });
  assert.equal(h.layer.screen, 'plan-approve'); assert.equal(h.api.calls.includes('plan.approve'), false);
  await h.layer.handleInput({ type: 'double-click' }); assert.equal(h.layer.screen, 'proposed-plan');
  await h.layer.menuItems().find(item => item.label === 'Approve and implement').onSelect({ stack: { pop() {} } });
  await h.layer.handleInput({ type: 'click' });
  assert.equal(h.layer.screen, 'reader'); assert.equal(h.api.calls.filter(method => method === 'plan.approve').length, 1);
});

test('requesting changes keeps the next reviewed draft in plan mode', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('completed-plan');
  h.layer.screen = 'reader'; h.layer.openProposedPlan();
  h.state.transcript.session.interactionMode = 'default';
  await h.layer.menuItems().find(item => item.label === 'Request changes').onSelect({ stack: { pop() {} } });
  assert.equal(h.layer.screen, 'draft'); assert.equal(h.layer.draftMode, 'plan');
  assert.equal(h.api.calls.includes('plan.approve'), false);
  assert.equal(h.api.calls.includes('turn.send'), false);
});

test('tap then hold in a notification reader neither replies nor dismisses', async () => {
  const h = setup(); h.state.alerts = [{ id: 'one', kind: 'phone' }];
  h.layer.openNotification('one', 'notes', true);
  await h.layer.handleInput({ type: 'short-then-long-press' });
  assert.equal(h.layer.screen, 'notification'); assert.deepEqual(h.dismissed, []); assert.deepEqual(h.reviews, []);
});

for (const initiallyAwake of [true, false]) {
  test(`in-place notification wake keeps its origin through reply and back (awake=${initiallyAwake})`, async () => {
    const h = setup(); const alert = { id: 'one', kind: 'phone', threadId: 'phone-thread', groupId: 'conversation' };
    h.state.alerts = [alert]; h.layer.openNotification('one');
    h.visibility.on = initiallyAwake;
    h.setReply({ isCurrent: () => true, send: () => true });
    assert.equal(h.layer.showAlertInCurrentConversation(alert), true);
    await h.layer.handleInput({ type: 'click' });
    h.reviews[0][0].onSend('Reviewed reply'); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.navigation.yielded, initiallyAwake ? 0 : 1);
  });
}

test('back after repeated replies exits the thread to its session list, not an earlier page', async () => {
  const h = setup(); await h.state.refresh();
  h.layer.go('sessions'); h.layer.selected = 'voice'; h.layer.openThread('voice');
  await h.state.openThread('voice');
  for (let turn = 0; turn < 3; turn++) {
    h.layer.scroll = turn + 2;
    await h.layer.handleInput({ type: 'click' });
    assert.equal(h.layer.screen, 'draft');
    await h.layer.handleInput({ type: 'click' });
    assert.equal(h.layer.screen, 'reader');
  }
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.screen, 'sessions'); assert.equal(h.layer.selected, 'voice');
  assert.equal(h.navigation.yielded, 0);
});

test('back after active-turn steering preserves the session-list origin', async () => {
  const h = setup(); await h.state.refresh(); h.layer.go('sessions'); h.layer.openThread('ui');
  await h.state.openThread('ui');
  await h.layer.handleInput({ type: 'click' });
  await h.layer.handleInput({ type: 'click' });
  assert.ok(h.api.calls.includes('turn.steer'));
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.screen, 'sessions');
});

test('notification entry replaces a retained reader return page with the dashboard', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('voice');
  h.layer.go('sessions'); h.layer.go('reader'); h.layer.scroll = 4;
  h.layer.openThread('day', 't3', true); await h.state.openThread('day');
  await h.layer.handleInput({ type: 'click' }); await h.layer.handleInput({ type: 'click' });
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.screen, 'dashboard'); assert.equal(h.navigation.yielded, 0);
});

test('notification entry from T3 does not treat its own APK window as an interrupted app', async () => {
  const h = setup(); await h.state.refresh();
  h.layer.openThread('voice', 'apk:com.faceclaw.t3/com.faceclaw.t3.T3AppService', true);
  assert.equal(h.layer.returnWindowId, null);
});

test('notification thread returns to the interrupted external app after replying', async () => {
  const h = setup(); await h.state.refresh(); h.layer.openThread('voice', 'notes', true);
  await h.state.openThread('voice');
  await h.layer.handleInput({ type: 'click' }); await h.layer.handleInput({ type: 'click' });
  await h.layer.handleInput({ type: 'double-click' });
  assert.deepEqual(h.navigation.focused, ['notes']);
});

test('cancelling a reply still returns to its current reader before exiting the visit', async () => {
  const h = setup(); await h.state.refresh(); h.layer.go('sessions'); h.layer.openThread('voice');
  await h.state.openThread('voice'); h.layer.scroll = 3;
  await h.layer.handleInput({ type: 'click' });
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.screen, 'reader'); assert.equal(h.layer.scroll, 3);
  await h.layer.handleInput({ type: 'double-click' }); assert.equal(h.layer.screen, 'sessions');
});

 test('inbox expansion and collapse reuse their backdrop and refresh at the shared endpoint', async () => {
  const clock = { now: 1000 };
  const { layer, counts } = setup(clock, true);
  let height = 452;
  const ctx = { stack: { getBaseSize: () => ({ width: 576, height }) } };
  layer.selected = 'inbox';
  layer.go('inbox');
  layer.paint(ctx);
  assert.equal(counts.length, 1);
  for (const target of [1040, 1105, 1190, 1319]) { clock.now = target; layer.paint(ctx); }
  assert.equal(counts.length, 1, 'intermediate frames reuse the dashboard');
  height = 288;
  layer.paint(ctx);
  assert.equal(counts.length, 2, 'viewport changes rebuild the snapshot');
  clock.now = 1360;
  layer.paint(ctx);
  assert.equal(layer.motion, null);
  assert.equal(counts.length, 3, 'completed expansion paints current dashboard data');
  await layer.handleInput({ type: 'double-click' });
  layer.paint(ctx);
  const collapsePaints = counts.length;
  for (const target of [1400, 1465, 1550, 1679]) { clock.now = target; layer.paint(ctx); }
  assert.equal(counts.length, collapsePaints, 'collapse also reuses its dashboard');
  clock.now = 1720;
  layer.paint(ctx);
  assert.equal(layer.motion, null);
  assert.equal(counts.length, collapsePaints + 1, 'completed collapse refreshes dashboard');
});

test('dashboard inbox stays top aligned in both viewport heights', () => {
  const { layer } = setup();
  for (const height of [288, 452]) {
    layer.viewHeight = height;
    assert.equal(layer.dropdownRect().y, 12);
    assert.equal(layer.dropdownRect().height, 104);
  }
});
function finishSlide(layer, ctx, clock) {
  clock.now += 1000;
  for (let frame = 0; frame < 32 && layer.slide; frame++) layer.paint(ctx);
  assert.equal(layer.slide, null, 'paced slide reaches its final offset');
}

test('APK reader reports handoff then bounded app result without claiming early delivery', async () => {
 const h = setup(); let result;
 h.state.alerts = [{ id: 'apk-one', kind: 'phone', threadId: 'apk:app/.Service:1', title: 'Sender', body: 'Message' }];
 h.setReply({ isCurrent: () => true, successMessage: 'Reply submitted to app.', send: (_text, callback) => { result = callback; return true; } });
 h.layer.openNotification('apk-one'); await h.layer.handleInput({ type: 'click' }); h.reviews[0][0].onSend('Reviewed');
 assert.equal(h.layer.notificationNotice, ''); result('draft-saved'); await new Promise(resolve=>setImmediate(resolve)); assert.match(h.layer.notificationNotice, /Draft saved in app/);
 h.layer.go('dashboard'); result('sent'); assert.notEqual(h.layer.notificationNotice, 'Reply sent.');
});
test('explicit APK conversation action clears wake-return state without sleeping', () => {
 const h = setup(); h.state.alerts = [{ id: 'apk-one', kind: 'phone', threadId: 'apk:app/.Service:1', title: 'Sender', body: 'Message' }];
 h.layer.openNotification('apk-one', 'notes', true);
 h.layer.menuItems().find(item => item.label === 'Open conversation in app').onSelect({ stack: { pop() {} } });
 assert.deepEqual(h.navigation.events, ['open-app:apk-one']); assert.equal(h.layer.notificationReturnToSleep, false); assert.equal(h.layer.screen, 'inbox');
});

function contentPixels(image, rect) {
  let count = 0;
  for (let y = Math.max(0, rect.y + 8); y < Math.min(image.height, rect.y + rect.height - 8); y++)
    for (let x = Math.max(0, rect.x + 8); x < Math.min(image.width, rect.x + rect.width - 8); x++)
      if (image.pixels[y * image.width + x] === 190) count++;
  return count;
}
function saveMotionFrame(name, image) {
  if (!process.env.T3_TRANSITION_ARTIFACT_DIR) return;
  image.bakeDeferredDrawsInPlace();
  fs.mkdirSync(process.env.T3_TRANSITION_ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(`${process.env.T3_TRANSITION_ARTIFACT_DIR}/${name}.pgm`, Buffer.concat([Buffer.from(`P5\n${image.width} ${image.height}\n255\n`), Buffer.from(image.pixels)]));
}

test('arrival dropdown rests at the top in both band and full-height viewports', () => {
 for (const height of [288,452]) {
  let now=0,painted;
  const {TimedNotificationLayer}=load('app/ui/shell/timed-notification.ts',{
   '../../graphics/image':{},'../../graphics/ui-fonts':{getDefaultSmallFont:()=>({})},'./geometry':{appViewportRect:()=>({x:0,y:0,width:576,height})},
   './notification-card':{notificationCardRect:notificationCard.notificationCardRect,paintNotificationCard:(_image,rect)=>painted=rect},'../card-presentation':face,'../presentation-clock':{presentationNow:()=>now},
  },{Date:{now:()=>now},setInterval:()=>1,clearInterval(){}});
  const layer=new TimedNotificationLayer('Title','Text',()=>{},()=>{},()=>{},()=>{});
  const ctx={stack:{getBaseSize:()=>({width:576,height})}};layer.paint(ctx,()=>({}));
  assert.equal(painted.y,0,'the first admitted frame is visible even if the next animation credit stalls');
  now=360;layer.paint(ctx,()=>({}));assert.equal(painted.y,12);
  layer.onRemoved();
 }
});

test('long press dismisses the selected list item and exiting an expanded item removes it', async () => {
 const h=setup();h.state.alerts=[{id:'one',kind:'phone'},{id:'two',kind:'phone'}];h.layer.go('inbox');h.layer.selected='one';
 await h.layer.handleInput({type:'long-press'});assert.deepEqual(h.dismissed,['one']);assert.equal(h.layer.screen,'inbox');assert.equal(h.layer.selected,'two');
 h.layer.openNotification('two');await h.layer.handleInput({type:'double-click'});assert.deepEqual(h.dismissed,['one','two']);assert.equal(h.layer.screen,'inbox');assert.equal(h.navigation.yielded,0);
});
test('expanded notification dismissal is single-flight and acknowledges repeated back gestures', async () => {
 const h=setup();h.state.alerts=[{id:'one',kind:'phone'}];h.layer.go('inbox');h.layer.openNotification('one',undefined,false,'lease-1');h.deferDismiss();
 const first=h.layer.handleInput({type:'double-click'});await Promise.resolve();
 await h.layer.handleInput({type:'double-click'});assert.deepEqual(h.dismissed,['one']);assert.equal(h.navigation.backAcks,2);assert.equal(h.layer.screen,'notification');
 h.resolveDismiss();await first;assert.equal(h.layer.screen,'inbox');assert.deepEqual(h.navigation.returned,['lease-1']);
});
test('expanded notification returns locally without waiting for the host visit acknowledgement', async () => {
 const h=setup();h.state.alerts=[{id:'one',kind:'phone'}];h.layer.go('inbox');h.layer.openNotification('one',undefined,false,'lease-1');h.deferReturn();
 await h.layer.handleInput({type:'double-click'});assert.equal(h.layer.screen,'inbox');assert.deepEqual(h.navigation.returned,['lease-1']);assert.equal(h.navigation.backAcks,1);
 h.resolveReturn();await Promise.resolve();assert.equal(h.layer.screen,'inbox');
});
test('a confirmed reply closes even if Android already removed its notification', async () => {
 const h=setup();h.state.alerts=[{id:'one',kind:'phone'}];h.layer.go('sessions');h.layer.openNotification('one','apk:com.faceclaw.t3/com.faceclaw.t3.T3AppService');
 h.setReply({isCurrent:()=>true,send:()=>{h.state.alerts=[];return true;}});await h.layer.handleInput({type:'click'});h.reviews[0][0].onSend('Reply');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.layer.screen,'sessions');assert.deepEqual(h.navigation.events,[]);
});

test('a confirmed reply returns on a clean frame without retaining the notification animation', async () => {
 const h=setup();h.state.alerts=[{id:'one',kind:'phone'}];h.layer.openNotification('one');
 h.setReply({isCurrent:()=>true,send:()=>{h.state.alerts=[];return true;}});await h.layer.handleInput({type:'click'});h.reviews[0][0].onSend('Reply');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.layer.screen,'dashboard');assert.equal(h.layer.motion,null);
});

test('a failed visit acknowledgement still leaves a removed notification reader', async () => {
 const h=setup();h.state.alerts=[{id:'one',kind:'phone'}];h.layer.go('sessions');h.layer.openNotification('one',undefined,false,'lease-1');h.setReturnResult(false);
 h.setReply({isCurrent:()=>true,send:()=>{h.state.alerts=[];return true;}});await h.layer.handleInput({type:'click'});h.reviews[0][0].onSend('Reply');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.layer.screen,'sessions');assert.equal(h.layer.notificationNotice,'');assert.deepEqual(h.navigation.returned,['lease-1']);
});

test('arrival animation gates body, reverses dismissal without a jump and cancels on removal', () => {
 let now=0, painted, tick, dismissed=0, expired=0;
 const {TimedNotificationLayer}=load('app/ui/shell/timed-notification.ts',{
  '../../graphics/image':{},'../../graphics/ui-fonts':{getDefaultSmallFont:()=>({})},'./geometry':{appViewportRect:()=>({x:0,y:0,width:576,height:452})},
  './notification-card':{notificationCardRect:notificationCard.notificationCardRect,paintNotificationCard:(_image,rect,_font,content)=>painted={rect,content}},'../presentation-clock':{presentationNow:()=>now},
 },{Date:{now:()=>now},setInterval:callback=>{tick=callback;return 1;},clearInterval(){}});
 const layer=new TimedNotificationLayer('Title','Text',()=>{},()=>dismissed++,()=>expired++,()=>{});
 const ctx={stack:{getBaseSize:()=>({width:576,height:452})}};
 layer.paint(ctx,()=>({})); assert.equal(painted.content.bodyVisible,false);
 now=323;layer.paint(ctx,()=>({}));assert.equal(painted.content.bodyVisible,false);
 now=324;layer.paint(ctx,()=>({}));assert.equal(painted.content.bodyVisible,true);
 const before=JSON.stringify(painted.rect);layer.handleInput({type:'double-click'});layer.paint(ctx,()=>({}));
 assert.equal(JSON.stringify(painted.rect),before);assert.equal(painted.content.bodyVisible,false);assert.equal(dismissed,0);
 now=684;layer.paint(ctx,()=>({}));assert.equal(dismissed,1);
 now=10000;tick();assert.equal(dismissed,1);assert.equal(expired,0);
});

test('failed async preview dismissal restores a usable card', async () => {
 let now=0, dismissed=0, resolveDismiss;
 const {TimedNotificationLayer}=load('app/ui/shell/timed-notification.ts',{
  '../../graphics/image':{},'../../graphics/ui-fonts':{getDefaultSmallFont:()=>({})},'./geometry':{appViewportRect:()=>({x:0,y:0,width:576,height:452})},
  './notification-card':{notificationCardRect:notificationCard.notificationCardRect,paintNotificationCard(){}},'../presentation-clock':{presentationNow:()=>now},
 },{Date:{now:()=>now},setInterval:()=>1,clearInterval(){}});
 const layer=new TimedNotificationLayer('Title','Text',()=>{},()=>{dismissed++;return new Promise(resolve=>{resolveDismiss=resolve;});},()=>{},()=>{});
 const ctx={stack:{getBaseSize:()=>({width:576,height:452})}};
 layer.paint(ctx,()=>({})); now=324; layer.paint(ctx,()=>({})); layer.handleInput({type:'swipe-down'}); layer.paint(ctx,()=>({})); now=684; layer.paint(ctx,()=>({}));
 assert.equal(dismissed,1); resolveDismiss(false); await new Promise(resolve=>setImmediate(resolve));
 layer.handleInput({type:'swipe-down'}); layer.paint(ctx,()=>({})); now=1044; layer.paint(ctx,()=>({}));
 assert.equal(dismissed,2); resolveDismiss(true); await new Promise(resolve=>setImmediate(resolve));
});

test('expanded notification starts at the preview rectangle and defers its body', () => {
 const clock={now:1000},h=setup(clock,true),ctx={stack:{getBaseSize:()=>({width:576,height:452})}};
 h.state.alerts=[{id:'one',kind:'phone',title:'Sender',body:'Synthetic message body'}];
 const origin={x:20,y:12,width:530,height:130};h.layer.setNotificationOrigin(origin);h.layer.openNotification('one');
 h.layer.paint(ctx);assert.deepEqual(JSON.parse(JSON.stringify(h.layer.motion.model.lastRect)),origin);
 for(const time of [1000,1180,1323]){clock.now=time;h.layer.paint(ctx);assert.equal(h.layer.motion.content,undefined);}
 clock.now=1324;h.layer.paint(ctx);assert.ok(h.layer.motion.content);
 clock.now=1900;h.layer.paint(ctx);assert.equal(h.layer.motion,null,'stalled renderer settles immediately');
});


test('assistant remains available through invocation, with no dashboard button', () => {
  const h = setup(); let captures = 0;
  h.layer.record = () => { captures++; };
  h.layer.screen = 'dashboard';
  assert.equal(h.layer.rows().find(row => row.id === 'assistant'), undefined);
  h.layer.askAssistant();
  const expected = JSON.stringify(h.layer.creation);
  assert.equal(h.layer.screen, 'compose');
  assert.equal(h.layer.creation.assistant, true);
  h.layer.screen = 'reader'; h.layer.draft = 'Previous draft';
  h.layer.askAssistant();
  assert.equal(h.layer.screen, 'compose');
  assert.equal(h.layer.draft, '');
  assert.equal(JSON.stringify(h.layer.creation), expected);
  assert.equal(captures, 2);
});

test('reader token tracker follows model changes without moving the selected transcript page', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('voice');
  h.state.transcript.turns = Array.from({ length: 3 }, (_, i) => ({ id: `turn-${i}`, startedAt: '', endedAt: '', durationSeconds: 1, separatorLabel: '', messages: [
    { id: `message-${i}`, role: 'assistant', text: `Turn ${i} content`, streaming: false, createdAt: '', updatedAt: '' },
  ] }));
  h.state.transcript.session.modelSelection = { instanceId: 'demo', model: 'preview-astra' };
  h.state.transcript.tokenUsage = { contextTokens: 48000, contextWindowTokens: 272000, totalTokens: 312000, updatedAt: null };
  h.layer.screen = 'reader'; h.layer.readerPage(); h.layer.scroll = 0;
  assert.match(h.layer.readerPage().title, /ASTRA · CTX 48k\/272k \| TOTAL 312k/);
  h.state.transcript = { ...h.state.transcript,
    session: { ...h.state.transcript.session, modelSelection: { instanceId: 'demo', model: 'preview-luna' } },
    tokenUsage: { contextTokens: 22000, contextWindowTokens: 128000, totalTokens: 330000, updatedAt: null } };
  assert.match(h.layer.readerPage().title, /LUNA · CTX 22k\/128k \| TOTAL 330k/);
  assert.equal(h.layer.scroll, 0);
});

test('popup dismissal restores the exact T3 page retained behind another app', async () => {
 const h=setup();h.state.alerts=[{id:'one',kind:'phone'}];
 h.layer.go('sessions');h.layer.selected='session-7';h.layer.scroll=3;
 h.layer.openNotification('one','compass',false,'host-visit');
 await h.layer.handleInput({type:'double-click'});
 assert.equal(h.layer.screen,'sessions');assert.equal(h.layer.selected,'session-7');assert.equal(h.layer.scroll,3);
 assert.deepEqual(h.navigation.returned,['host-visit']);
});

test('popup over the dashboard preserves its selection on reply or dismissal', async () => {
 for(const reply of [false,true]) {
  const h=setup();h.state.alerts=[{id:'one',kind:'phone'}];h.layer.selected='sessions';
  h.layer.openNotification('one',undefined,true,'host-visit');
  if(reply){h.setReply({isCurrent:()=>true,send:()=>true});await h.layer.handleInput({type:'click'});h.reviews[0][0].onSend('Reply');await new Promise(resolve=>setImmediate(resolve));}
  else await h.layer.handleInput({type:'double-click'});
  assert.equal(h.layer.screen,'dashboard');assert.equal(h.layer.selected,'sessions');
  assert.deepEqual(h.navigation.returned,['host-visit']);assert.equal(h.navigation.yielded,0,'host visit owns power restoration');
 }
});

test('ordinary T3 navigation paints the destination immediately while notifications keep motion', async () => {
 const h=setup(),ctx={stack:{getBaseSize:()=>({width:576,height:452})}};
 await h.state.refresh();
 for(const screen of ['sessions','new-project','new-model','actions','dashboard']){
  h.layer.go(screen);h.layer.paint(ctx);
  assert.equal(h.layer.motion,null,screen);assert.equal(h.layer.slide,null,screen);assert.equal(h.layer.needsAnimation(),false,screen);
 }
 h.layer.go('sessions');h.layer.openThread('voice');await new Promise(resolve=>setImmediate(resolve));h.layer.paint(ctx);
 assert.equal(h.layer.screen,'reader');assert.equal(h.layer.needsAnimation(),false);
 h.layer.back();assert.equal(h.layer.screen,'sessions');assert.equal(h.layer.needsAnimation(),false);
 h.layer.back();assert.equal(h.layer.screen,'dashboard');assert.equal(h.layer.needsAnimation(),false);
 h.layer.go('inbox');assert.ok(h.layer.motion,'notification inbox still opens with motion');
 h.layer.back();assert.ok(h.layer.motion,'notification inbox still closes with motion');
});

test('dashboard audio expands in place, dispatches media commands, and consumes back', async () => {
  const h = setup();
  assert.deepEqual(h.layer.rows().map(row => row.id), ['inbox', 'audio', 'sessions']);
  await h.layer.handleInput({ type: 'click' });
  assert.equal(h.layer.screen, 'dashboard');
  assert.equal(h.layer.audioExpanded, true);
  assert.equal(h.layer.selected, 'audio-toggle');
  assert.deepEqual(h.layer.rows().map(row => row.id), ['audio-previous', 'audio-toggle', 'audio-next']);
  for (const command of ['previous', 'toggle', 'next']) {
    h.layer.selected = `audio-${command}`;
    await h.layer.handleInput({ type: 'click' });
  }
  assert.deepEqual(h.navigation.events, ['media:previous', 'media:toggle', 'media:next']);
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.audioExpanded, false);
  assert.equal(h.layer.selected, 'audio');
  assert.equal(h.navigation.yielded, 0);
  assert.equal(h.layer.needsAnimation(), false);
});

const completedSession = (id, turn, minute = 1, environmentId = 'computer-a') => ({
  id, environmentId, title: id, projectId: 'p', projectTitle: 'Project', status: 'ready', settled: false,
  completedTurn: { id: turn, completedAt: `2026-09-21T10:${String(minute).padStart(2, '0')}:00Z` }, lastActivityAt: '',
});

test('dashboard sessions require entering the card, then opening a session or the full list', async () => {
  const h = setup();
  h.state.applySessions([completedSession('older', 'one'), completedSession('newer', 'two', 2)]);
  h.layer.selected = 'sessions';
  await h.layer.handleInput({ type: 'click' });
  assert.equal(h.layer.screen, 'dashboard');
  assert.deepEqual(h.layer.rows().map(row => row.title), ['newer', 'older', 'Sessions']);
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.selected, 'sessions');
  assert.equal(h.navigation.yielded, 0);
  await h.layer.handleInput({ type: 'click' });
  let opened;
  h.layer.openThread = id => { opened = id; };
  await h.layer.handleInput({ type: 'click' });
  assert.equal(opened, JSON.stringify(['computer-a', 'newer']));
  h.layer.selected = 'sessions-all';
  await h.layer.handleInput({ type: 'click' });
  assert.equal(h.layer.screen, 'sessions');
  assert.equal(h.layer.needsAnimation(), false);
});

test('empty dashboard sessions card opens the full list directly', async () => {
  const h = setup(); h.layer.selected = 'sessions';
  await h.layer.handleInput({ type: 'click' });
  assert.equal(h.layer.screen, 'sessions');
});

test('viewed completion receipts survive restart, isolate computers and pairing, and allow new turns', () => {
  let saved; let scope = 'first';
  const storage = { scope: () => scope, load: () => saved, save: value => { saved = value; } };
  const one = completedSession('same', 'one');
  const other = completedSession('same', 'one', 2, 'computer-b');
  let state = new T3Workspace({}); state.setViewedTurnStorage(storage);
  state.applySessions([one, other, { ...completedSession('busy', 'old'), status: 'running' }, { ...completedSession('settled', 'old'), settled: true }]);
  assert.deepEqual(state.awaitingSessions.map(s => s.environmentId), ['computer-b', 'computer-a']);
  state.markSessionViewed(one);
  assert.deepEqual(state.awaitingSessions, [other]);
  state = new T3Workspace({}); state.setViewedTurnStorage(storage); state.applySessions([one, other]);
  assert.deepEqual(state.awaitingSessions, [other]);
  const next = completedSession('same', 'two', 3);
  state.applySessions([next, other]); assert.deepEqual(state.awaitingSessions, [next, other]);
  scope = 'second'; saved = undefined; state.applySessions([one]); assert.deepEqual(state.awaitingSessions, [one]);
});

test('only displaying a visible completed transcript clears its dashboard entry', () => {
  const h = setup(); const session = completedSession('same', 'one');
  h.state.applySessions([session]);
  h.state.selectedThreadId = session.id; h.state.selectedEnvironmentId = session.environmentId;
  h.state.transcript = { session, turns: [] };
  h.layer.paint(previewContext);
  assert.equal(h.state.awaitingSessions.length, 1, 'background transcript is not a view');
  h.layer.go('reader'); h.layer.paint(previewContext);
  assert.equal(h.state.awaitingSessions.length, 0);
  h.state.applySessions([completedSession('same', 'two')]);
  h.layer.paint(previewContext);
  assert.equal(h.state.awaitingSessions.length, 1, 'stale reader does not acknowledge a newer turn');
});

test('dashboard geometry expands downwards and scrolls every pending entry into the short viewport', () => {
  const { dashboardTargets } = load('app/apps/t3/dashboard.ts', {
    '../../ui/card-presentation': face, '../../graphics/image': {}, '../../graphics/ui-fonts': {},
    '../../graphics/textwrap': {}, '../../graphics/icons': {}, '../../graphics/battery': {},
    './dashboard-clock': {}, './card-motion': {},
  });
  const cards = { sessions: [], audioExpanded: false, activeCard: null };
  const compact = dashboardTargets(576, 288, cards);
  assert.equal(compact.find(r => r.id === 'sessions').height, 44);
  const expanded = dashboardTargets(576, 452, { ...cards, audioExpanded: true });
  assert.equal(expanded.find(r => r.id === 'sessions').y - compact.find(r => r.id === 'sessions').y, 88);
  cards.sessions = Array.from({ length: 30 }, (_, i) => ({ id: `pending:${i}`, title: `Session ${i}` }));
  for (const id of [...cards.sessions.map(s => s.id), 'sessions-all']) {
    const rows = dashboardTargets(576, 288, cards, id);
    const row = rows.find(r => r.id === id);
    assert.ok(row.y >= 66 && row.y + row.height <= 288, id);
    assert.equal(rows.find(r => r.id === 'inbox').y, 14);
  }
});

test('media controls dispatch previous, play/pause and next through Android AudioManager', () => {
  const events = [];
  class KeyEvent { constructor(action, code) { this.action = action; this.code = code; } }
  Object.assign(KeyEvent, { ACTION_DOWN: 0, ACTION_UP: 1, KEYCODE_MEDIA_NEXT: 87, KEYCODE_MEDIA_PREVIOUS: 88, KEYCODE_MEDIA_PLAY_PAUSE: 85 });
  const { sendMediaCommand } = load('app/native/media-controls.ts', {
    '@nativescript/core': { Utils: { android: { getApplicationContext: () => ({ getSystemService: () => ({ dispatchMediaKeyEvent: event => events.push([event.action, event.code]) }) }) } } },
  }, { global: { isAndroid: true }, android: { content: { Context: { AUDIO_SERVICE: 'audio' } }, view: { KeyEvent } } });
  for (const command of ['previous', 'toggle', 'next']) assert.equal(sendMediaCommand(command), true);
  assert.deepEqual(events, [[0, 88], [1, 88], [0, 85], [1, 85], [0, 87], [1, 87]]);
});

test('hidden and covered readers do not clear waiting sessions', () => {
  for (const hidden of [true, false]) {
    const h = setup(); const session = completedSession('same', 'one');
    h.state.applySessions([session]); h.state.selectedThreadId = session.id; h.state.selectedEnvironmentId = session.environmentId;
    h.state.transcript = { session, turns: [] }; h.layer.go('reader');
    if (hidden) h.visibility.on = false; else h.visibility.overlay = true;
    h.layer.paint(previewContext);
    assert.equal(h.state.awaitingSessions.length, 1);
  }
});

test('dashboard uses brackets only inside cards and audio icons share one row', () => {
  const fills = [], icons = [], images = [];
  class Image {
    constructor(width, height) { this.width = width; this.height = height; this.pixels = new Uint8Array(width * height); }
    fillRect(...args) { fills.push(args); }
    drawRoundedRect() {} drawText() {}
    drawImage(image, x, y) { images.push({ image, x, y }); }
  }
  const { paintT3Dashboard, dashboardTargets } = load('app/apps/t3/dashboard.ts', {
    '../../ui/card-presentation': face, '../../graphics/image': { GrayImage: Image },
    '../../graphics/ui-fonts': { getDefaultSmallFont: () => ({ lineHeight: 18 }) },
    '../../graphics/textwrap': { truncateText: (_font, text) => text },
    '../../graphics/icons': { renderIcon: name => { icons.push(name); return { name }; } },
    '../../graphics/battery': { drawBattery: () => ({}) },
    './dashboard-clock': { renderClockPixels: () => new Uint8Array(128 * 144) },
  });
  const cards = { sessions: [{ id: 'pending:one', title: 'One' }], audioExpanded: true, activeCard: null };
  const paint = selected => {
    fills.length = 0; icons.length = 0; images.length = 0;
    paintT3Dashboard(576, 288, selected, 0, '', {}, '24h', new Date(), undefined, cards);
  };
  for (const id of ['audio', 'sessions', 'inbox']) { paint(id); assert.equal(fills.length, 0, 'outer focus has no bracket or chevron'); }
  cards.activeCard = 'audio'; paint('audio-toggle');
  assert.equal(fills.length, 6, 'two three-sided brackets');
  assert.deepEqual(icons.filter(name => name.startsWith('media-')), ['media-previous', 'media-play', 'media-next']);
  const controls = images.filter(draw => draw.image.name?.startsWith('media-'));
  assert.equal(new Set(controls.map(draw => draw.y)).size, 1);
  assert.ok(controls[0].x < controls[1].x && controls[1].x < controls[2].x);
  const targets = dashboardTargets(576, 288, cards, 'audio-toggle').filter(row => row.id.startsWith('audio-'));
  assert.deepEqual(targets.map(row => row.width), [96, 96, 96]);
  assert.equal(new Set(targets.map(row => row.y)).size, 1);
  cards.audioPlaying = true; paint('audio-toggle'); assert.ok(icons.includes('media-pause'));
  cards.activeCard = 'sessions'; paint('pending:one'); assert.equal(fills.length, 6);
  cards.audioMedia = { title: 'Track', artist: 'Artist', art: { width: 2, height: 2, gray4: '05af' } };
  paint('audio-toggle');
  const artwork = images.find(draw => draw.image.width === 2)?.image;
  assert.deepEqual(Array.from(artwork.pixels), [0, 85, 170, 255]);
  paint('audio-toggle');
  assert.equal(images.find(draw => draw.image.width === 2)?.image, artwork, 'unchanged artwork reuses decoded pixels');
  cards.audioMedia.art = { width: 65, height: 1, gray4: '0'.repeat(65) };
  paint('audio-toggle'); assert.ok(icons.includes('music'), 'invalid artwork uses fallback');
  cards.audioExpanded = false; paint('audio');
  assert.ok(!icons.includes('music'), 'collapsed card has no artwork');
});

test('playback icon follows Android music activity without changing command routing', () => {
  let active = false;
  const { isMediaPlaying } = load('app/native/media-controls.ts', {
    '@nativescript/core': { Utils: { android: { getApplicationContext: () => ({ getSystemService: () => ({ isMusicActive: () => active }) }) } } },
  }, { global: { isAndroid: true }, android: { content: { Context: { AUDIO_SERVICE: 'audio' } } } });
  assert.equal(isMediaPlaying(), false); active = true; assert.equal(isMediaPlaying(), true);
});

test('returning from dashboard attention keeps the next waiting session one tap away', async () => {
  const h = setup();
  const older = completedSession('older', 'one'), newer = completedSession('newer', 'two', 2);
  h.state.applySessions([older, newer]);
  const opened = [];
  h.state.openThread = async id => { opened.push(id); };
  h.layer.selected = 'sessions';
  await h.layer.handleInput({ type: 'click' });
  await h.layer.handleInput({ type: 'click' });
  assert.equal(h.layer.screen, 'reader');
  h.state.markSessionViewed(newer);
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.screen, 'dashboard');
  assert.equal(h.layer.dashboardCard, 'sessions');
  assert.equal(h.layer.selected, `pending:${JSON.stringify(['computer-a', 'older'])}`);
  await h.layer.handleInput({ type: 'click' });
  assert.equal(h.layer.screen, 'reader');
  assert.equal(opened.at(-1), JSON.stringify(['computer-a', 'older']));
  h.state.markSessionViewed(older);
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.screen, 'dashboard');
  assert.equal(h.layer.dashboardCard, null);
  assert.equal(h.layer.selected, 'sessions');
  assert.equal(h.navigation.yielded, 0);
});

test('returning from the full sessions list does not enter the dashboard attention card', async () => {
  const h = setup();
  h.state.applySessions([completedSession('waiting', 'one')]);
  h.layer.selected = 'sessions';
  await h.layer.handleInput({ type: 'click' });
  h.layer.selected = 'sessions-all';
  await h.layer.handleInput({ type: 'click' });
  await h.layer.handleInput({ type: 'double-click' });
  assert.equal(h.layer.screen, 'dashboard');
  assert.equal(h.layer.dashboardCard, null);
  assert.equal(h.layer.selected, 'sessions');
});

test('pending questions alert once, lead the dashboard sessions card, and clear when answered', async () => {
  const { state, layer } = setup();
  const session = { id: 'q', projectId: 'p', projectTitle: 'Faceclaw', title: 'Pick a layout', status: 'running', settled: false,
    lastActivityAt: new Date().toISOString(), completedTurn: null };
  const done = { id: 'd', projectId: 'p', projectTitle: 'Faceclaw', title: 'Finished work', status: 'idle', settled: false,
    lastActivityAt: new Date().toISOString(), completedTurn: { id: 'turn', completedAt: new Date().toISOString() } };
  const arrivals = []; state.onArrival(alert => arrivals.push(alert));
  state.applySessions([{ ...session, hasPendingUserInput: true }, done]);
  assert.equal(arrivals.length, 0, 'questions already waiting at startup join the inbox silently');
  assert.equal(state.alerts.filter(alert => alert.id.includes(':input:')).length, 1);
  state.applySessions([session, done]);
  assert.equal(state.alerts.some(alert => alert.id.includes(':input:')), false, 'an answered question clears its alert');
  state.applySessions([{ ...session, hasPendingUserInput: true }, done]);
  state.applySessions([{ ...session, hasPendingUserInput: true }, done]);
  assert.equal(arrivals.length, 1, 'a new question alerts once while it stays pending');
  assert.equal(arrivals[0].title, 'Question · Faceclaw'); assert.equal(arrivals[0].threadId, 'q');
  assert.equal(arrivals[0].question, true, 'question alerts are marked glasses-only');
  assert.deepEqual(state.awaitingSessions.map(item => item.id), ['q', 'd'], 'a running session waiting on a question leads the card');
  assert.equal(layer.dashboardCards().sessions[0].title, '? Pick a layout');
  layer.selected = 'sessions'; await layer.rows().find(row => row.id === 'sessions').action();
  assert.equal(layer.rows()[0].title, '? Pick a layout');
});

test('opening a pending-question session lands on its first question', async () => {
  const h = setup(); await h.state.refresh();
  assert.equal(h.state.awaitingSessions[0].id, 'plan');
  h.layer.selected = 'sessions'; await h.layer.rows().find(row => row.id === 'sessions').action();
  await h.layer.rows()[0].action(); await new Promise(resolve => setImmediate(resolve));
  h.layer.motion = null; h.layer.slide = null; h.layer.paint({ stack: { getBaseSize: () => ({ width: 576, height: 452 }) } });
  assert.equal(h.layer.screen, 'question'); assert.equal(h.layer.questionIndex, 0);
});

test('full sessions list labels a session waiting on a question as QUESTION', () => {
  const at = new Date().toISOString();
  const base = { projectId: 'p', projectTitle: 'Faceclaw', settled: false, lastActivityAt: at, completedTurn: null };
  const rows = hub.buildSessionRows({ unsettled: [{ ...base, id: 'q', title: 'Pick', status: 'running', hasPendingUserInput: true }, { ...base, id: 'w', title: 'Busy', status: 'running' }], settled: [] });
  assert.match(rows.find(row => row.value === 'q').text, /QUESTION$/);
  assert.match(rows.find(row => row.value === 'w').text, /WORKING$/);
});

