const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, imports = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => { if (!(name in imports)) throw Error(name); return imports[name]; }, ...globals });
  return module.exports;
}
const face = load('app/ui/card-presentation.ts');
const notificationCard = load('app/ui/shell/notification-card.ts', { '../card-presentation': face, '../../graphics/textwrap': { truncateText: (_font, text) => text, wrapText: (_font, text) => [text] } });
let hub;
test.before(async () => { hub = load('app/apps/t3/hub-view-model.ts', { '@evenrealities/pretext': await import('@evenrealities/pretext'), '../../graphics/textwrap': load('app/graphics/textwrap.ts') }); });
const { T3Workspace } = load('app/apps/t3/workspace.ts', { '../../t3/security': load('app/t3/security.ts') });
const { T3DemoApi } = load('app/apps/t3/demo.ts');
function setup(animationClock, raster = false) {
  const api = new T3DemoApi(); const state = new T3Workspace(api); state.demo = true; const dismissed = []; const navigation = { yielded: 0, phone: 0, focused: [], events: [], wakes: 0 }; let permitDismiss = true;
  const visibility = { on: true, foreground: 't3', overlay: false, preview: null, appBase: true }; let visible; let reply; let focused = true; const reviews = []; const counts = []; const drawn = []; const placements = []; const cards = []; const chevrons = []; const borders = [];
  const alerts = () => visible || state.alerts;
  class Image { constructor(width = 576, height = 452) { this.width = width; this.height = height; this.pixels = new Uint8Array(width * height); } fillRect() {} bakeDeferredDrawsInPlace() {} fillRoundedRect() {} drawRoundedRect(...args) { borders.push(args); } drawText(_font, x, y, text) { drawn.push(text); placements.push({ x, y, text }); } drawImage() {} dimmed() { return this; } }
  const RasterImage = raster ? load('app/graphics/image.ts', { './textwrap': {} }).GrayImage : Image;
  const font = raster ? load('app/graphics/bdffont.ts', { '@nativescript/core': {} }).BdfFont.parse(fs.readFileSync('app/fonts/terminus/ter-u18n.bdf', 'utf8')) : { lineHeight: 17, measureText: value => Array.from(value).length * 7, getGlyph: () => ({ dwidthX: 7 }) };
  const targets = raster ? [{ id: 'sessions', x: 259, y: 149, width: 288, height: 44 }, { id: 'inbox', x: 447, y: 14, width: 100, height: 40 }] : [];
  const shell = { closeNotificationReader() {}, getBatteryLevels: () => ({ headset: 72, headsetCharging: false }), startVoiceInput() {}, openReviewedVoiceInput: (...args) => reviews.push(args), focusWindow(id) { navigation.focused.push(id); navigation.events.push('focus:' + id); }, sleepAtAppRoot() { navigation.yielded++; navigation.events.push('sleep'); }, isWindowFocused: () => focused, isWindowVisible: id => visibility.on && visibility.foreground === id, hasOverlay: () => visibility.overlay, getNotificationPreviewId: () => visibility.preview,
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
    }, dismissT3Alert(alert) { dismissed.push(alert.id); if (!permitDismiss) return false; state.removeAlert(alert.id); return true; } }, '@nativescript/core': { Frame: { topmost: () => ({ navigate: () => navigation.phone++ }) } },
    '../../ui/shell/notification-card': { ...notificationCard, paintNotificationCard(image, rect, font, content) { cards.push(rect); notificationCard.paintNotificationCard(image, rect, font, content); } },
    './hub-view-model': hub, './card-motion': { ...(animationClock ? load('app/apps/t3/card-motion.ts', { '../../ui/card-presentation': face }) : {}), paintCardFace(image, rect) { cards.push(rect); if (raster) face.paintCardFace(image, rect); }, paintSelectionChevron(_image, x, y) { chevrons.push({ x, y }); }, HUB_CARD: {x:0,y:0,width:576,height:288}, HUB_DROPDOWN: {x:16,y:12,width:544,height:104} },
    './dashboard': { dashboardTargets: () => targets, paintT3Dashboard: (_w, _h, _selected, count) => {
      counts.push(count); const image = new RasterImage(_w, _h);
      if (raster) { image.drawText(font, 22, 20, 'DASHBOARD', 190); image.drawText(font, 22, 75, 'Synthetic home content', 190); for (const target of targets) { image.drawRoundedRect(target.x, target.y, target.width, target.height, 235, 8, 2); image.drawText(font, target.x + 16, target.y + 10, target.id.toUpperCase(), 190); } }
      return image;
    } }, '../../native/weather': { weatherBridge: { snapshot: () => ({}) } }, '../../ui/dashboard-settings': { timeFormatSetting: { get: () => '24h' } }, '../../graphics/image': { GrayImage: RasterImage }, '../../graphics/ui-fonts': { getDefaultSmallFont: () => font }, '../../graphics/textwrap': { truncateText: (_font, text) => text, wrapText: (_font, text) => [text] },
    '../../extensions/host': { onHostEvent: () => () => {}, onHostState: () => () => {} },
    '../../ui/shell/shell': { shell }, '../../ui/shell/in-process-window': {},
    '../../t3/config': { getT3Config: () => ({}) }, './runtime': { t3Workspace: state },
  }, animationClock ? { Date: class extends Date { static now() { return animationClock.now; } } } : {});
  const layer = new T3Layer(() => {}, () => visibility.appBase);
  state.onChange(() => layer.contentChanged());
  return { api, state, visibility, dismissed, navigation, reviews, counts, drawn, placements, cards, chevrons, borders, setVisible: value => { visible = value; }, setReply: value => { reply = value; }, setFocused: value => { focused = value; }, denyDismiss: () => { permitDismiss = false; }, layer };
}
test('assistant draft requires review tap and preserves assistant.start intent', async () => {
  const { api, state, layer } = setup(); await state.refresh();
  await layer.rows().find(row => row.id === 'assistant').action();
  assert.equal(layer.screen, 'draft');
  assert.equal(api.calls.filter(m => m.endsWith('.start')).length, 0);
  await layer.handleInput({ type: 'click' });
  assert.equal(api.calls.filter(m => m === 'assistant.start').length, 1);
  assert.equal(api.calls.filter(m => m === 'thread.start').length, 0);
  assert.equal(layer.screen, 'reader');
});
test('plan review cannot submit before reader reaches the end, and cannot submit twice', async () => {
  const { api, state, layer } = setup(); await state.refresh(); await state.openThread('plan');
  for (const q of state.plans.get('plan').request.questions) state.setAnswer('plan', { questionId: q.id, optionIndexes: [0], text: '' });
  layer.go('plan-review'); await layer.handleInput({ type: 'click' });
  assert.equal(api.calls.includes('plan.submit'), false);
  layer.atReaderEnd = true; await layer.handleInput({ type: 'click' }); await layer.handleInput({ type: 'click' });
  assert.equal(api.calls.filter(m => m === 'plan.submit').length, 1);
});
test('notification back leaves a retained T3 reader for the dashboard', async () => {
  const { state, layer } = setup(); await state.refresh(); await state.openThread('voice');
  layer.screen = 'reader'; layer.scroll = 7; layer.openThread('ui', 't3', true);
  await layer.handleInput({ type: 'double-click' });
  assert.equal(layer.screen, 'dashboard'); assert.equal(layer.scroll, 0);
});
test('preview timeout leaves inbox untouched; swipe uses dismissal callback once', () => {
  let now = 0, tick, cleared = 0, expired = 0, opened = 0, dismissed = 0;
  const { TimedNotificationLayer } = load('app/ui/shell/timed-notification.ts', {
    '../../graphics/image': {}, '../../graphics/ui-fonts': {}, '../../graphics/textwrap': {}, './geometry': {}, './notification-card': notificationCard, '../card-presentation': face,
  }, { Date: { now: () => now }, setInterval: cb => { tick = cb; return 1; }, clearInterval: () => cleared++ });
  const layer = new TimedNotificationLayer('Title', 'Text', () => opened++, () => dismissed++, () => { expired++; layer.onRemoved(); }, () => {});
  now = 4999; tick(); assert.equal(expired, 0);
  now = 5000; tick(); assert.equal(expired, 1); assert.equal(dismissed, 0); assert.equal(opened, 0); assert.equal(cleared, 1);
  const next = new TimedNotificationLayer('Title', 'Text', () => opened++, () => dismissed++, () => {}, () => {});
  next.handleInput({ type: 'swipe-down' }); assert.equal(dismissed, 1); next.onRemoved();
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

test('T3 homepage has Notifications, Ask Assistant and Sessions with Settings in App actions', () => {
  const { layer } = setup();
  assert.deepEqual(Array.from(layer.rows(), row => row.id), ['inbox', 'assistant', 'sessions']);
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
  assert.equal(layer.screen, 'sessions'); assert.equal(layer.rows().some(row => row.id === 'projects'), false); assert.equal(layer.rows()[0].title, 'START NEW SESSION'); assert.ok(layer.rows().some(row => row.title === 'UNSETTLED' && row.section));
  await layer.rows().find(row => row.id === 'new').action(); assert.equal(layer.screen, 'new-project');
});

test('a conversation tap starts reply dictation without an action-menu step', async () => {
  const { layer, state } = setup(); await state.refresh(); await state.openThread('voice');
  layer.screen = 'reader'; await layer.handleInput({ type: 'click' });
  assert.equal(layer.screen, 'draft');
  assert.deepEqual(Array.from(layer.menuItems(), item => item.label), ['Use plan mode', 'Use normal mode', 'Change reasoning']);
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
  assert.equal(h.cards[0].width, 635); assert.equal(h.cards[0].height, 447);
  // The retained final page may be short; inspect a full page for vertical capacity.
  h.layer.scroll = 0; h.placements.length = 0;
  h.layer.paint({ stack: { getBaseSize: () => ({ width: 640, height: 452 }) } });
  assert.ok(h.placements.some(p => p.y > 288));
  assert.ok(h.placements.every(p => p.x >= 0 && p.y + 17 <= 452));
});

test('selection and question/review cards share the full content viewport while inbox stays compact', async () => {
  const h = setup(); await h.state.refresh(); await h.state.openThread('plan');
  const paint = () => { h.cards.length = 0; h.layer.motion = null; h.layer.paint({ stack: { getBaseSize: () => ({ width: 640, height: 452 }) } }); };
  for (const screen of ['sessions', 'new-project', 'new-model', 'new-reasoning', 'question-text', 'choices', 'plan-review', 'draft']) {
    h.layer.screen = screen; paint(); assert.equal(h.cards[0].width, 635, screen); assert.equal(h.cards[0].height, 447, screen);
  }
  h.layer.screen = 'inbox'; paint(); assert.equal(h.cards[0].width, 544); assert.equal(h.cards[0].height, 104);
});

test('session selection moves one chevron with its three-pixel outline', async () => {
  const h = setup(); await h.state.refresh(); h.layer.screen = 'sessions';
  const paint = () => { h.chevrons.length = 0; h.borders.length = 0; h.layer.paint({ stack: { getBaseSize: () => ({ width: 640, height: 452 }) } }); };
  paint(); assert.equal(h.chevrons.length, 1); assert.equal(h.borders.filter(border => border[6] === 3).length, 1);
  const firstY = h.chevrons[0].y;
  await h.layer.handleInput({ type: 'scroll-down' }); paint();
  assert.equal(h.chevrons.length, 1); assert.ok(h.chevrons[0].y > firstY); assert.equal(h.borders.filter(border => border[6] === 3).length, 1);
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

test('capture cancellation retains its reader position while ordinary navigation keeps card motion', () => {
  const { layer } = setup(); layer.screen = 'reader'; layer.scroll = 7;
  layer.go('compose'); const renders = [];
  layer.repaint = () => renders.push({ screen: layer.screen, scroll: layer.scroll, motion: layer.motion });
  layer.cancelCompose();
  assert.deepEqual(renders, [{ screen: 'reader', scroll: 7, motion: null }]);
  layer.screen = 'dashboard'; layer.go('sessions'); layer.back();
  assert.equal(layer.screen, 'dashboard'); assert.ok(layer.motion, 'ordinary dashboard return still animates');
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
    const label = h.placements.find(row => row.text === (phase === 'tool' ? 'Read project files' : 'thinking'));
    assert.ok(label); assert.equal(label.x, 46); // 22px indicator + 8px gap after x=16
    assert.ok(h.drawn.every(text => !/[◐◓◑◒]/.test(text)));
    assert.ok(h.placements.every(row => row.y + 17 <= 452));
  }
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
  const { layer, counts } = setup(clock);
  let height = 452;
  const ctx = { stack: { getBaseSize: () => ({ width: 576, height }) } };
  layer.selected = 'inbox';
  layer.go('inbox');
  layer.paint(ctx);
  assert.equal(counts.length, 1);
  for (clock.now = 1040; clock.now < 1320; clock.now += face.CARD_FRAME_MS) layer.paint(ctx);
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
  for (clock.now = 1400; clock.now < 1720; clock.now += face.CARD_FRAME_MS) layer.paint(ctx);
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
test('Sessions retains its content over the dashboard throughout collapse', async () => {
  const clock = { now: 1000 };
  const { layer, counts } = setup(clock);
  const ctx = { stack: { getBaseSize: () => ({ width: 576, height: 452 }) } };
  layer.selected = 'sessions';
  layer.go('sessions');
  clock.now = 1360;
  await layer.handleInput({ type: 'double-click' });
  for (; clock.now < 1720; clock.now += face.CARD_FRAME_MS) layer.paint(ctx);
  assert.equal(counts.length, 1, 'dashboard is visible during collapse and reused between frames');
  layer.paint(ctx);
  assert.equal(layer.motion, null);
  assert.equal(counts.length, 2);
  assert.equal(layer.selected, 'sessions');
});

test('APK reader reports handoff then bounded app result without claiming early delivery', async () => {
 const h = setup(); let result;
 h.state.alerts = [{ id: 'apk-one', kind: 'phone', threadId: 'apk:app/.Service:1', title: 'Sender', body: 'Message' }];
 h.setReply({ isCurrent: () => true, successMessage: 'Reply submitted to app.', send: (_text, callback) => { result = callback; return true; } });
 h.layer.openNotification('apk-one'); await h.layer.handleInput({ type: 'click' }); h.reviews[0][0].onSend('Reviewed');
 assert.equal(h.layer.notificationNotice, 'Review reply on glasses.'); result('draft-saved'); await new Promise(resolve=>setImmediate(resolve)); assert.match(h.layer.notificationNotice, /Draft saved in app/);
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
test('actual raster shows crisp card content in first/middle/final expand and collapse frames', async () => {
  const clock = { now: 1000 }, h = setup(clock, true), ctx = { stack: { getBaseSize: () => ({ width: 576, height: 452 }) } };
  await h.state.refresh(); h.layer.selected = 'sessions'; h.layer.go('sessions');
  const movement = load('app/apps/t3/card-motion.ts', { '../../ui/card-presentation': face });
  for (const [name, time] of [['first', 1000], ['middle', 1180], ['final', 1360]]) {
    clock.now = time; const image = h.layer.paint(ctx); image.bakeDeferredDrawsInPlace();
    const rect = name === 'final' ? h.layer.fullRect() : movement.cardRect(h.layer.motion.from, h.layer.motion.to, (time - 1000) / 360);
    assert.ok(contentPixels(image, rect) > 20, `expansion ${name} must include real text pixels`);
    saveMotionFrame(`expand-${name}`, image);
  }
  await h.layer.handleInput({ type: 'double-click' });
  for (const [name, time] of [['first', 1360], ['middle', 1540], ['final', 1720]]) {
    clock.now = time; const image = h.layer.paint(ctx); image.bakeDeferredDrawsInPlace();
    if (name !== 'final') {
      const rect = movement.cardRect(h.layer.motion.from, h.layer.motion.to, (time - 1360) / 360);
      assert.ok(contentPixels(image, rect) > 20, `collapse ${name} must retain outgoing text`);
    }
    if (name === 'middle') assert.ok(contentPixels(image, { x: 0, y: 0, width: 230, height: 100 }) > 20, 'dashboard content appears behind the shrinking card');
    saveMotionFrame(`collapse-${name}`, image);
  }
  assert.equal(h.layer.motion, null);
});

test('transition cache lays out a large session list once, rebuilds on new state, and never keeps invalidated outgoing pixels', async () => {
  const clock = { now: 1000 }, h = setup(clock, true), ctx = { stack: { getBaseSize: () => ({ width: 576, height: 452 }) } };
  await h.state.refresh();
  const original = h.state.sessions[0]; h.state.sessions = Array.from({ length: 228 }, (_, i) => ({ ...original, id: `synthetic-${i}`, title: `Synthetic session ${i}` }));
  const rows = h.layer.rows.bind(h.layer); let layouts = 0; h.layer.rows = () => { layouts++; return rows(); };
  h.layer.selected = 'sessions'; h.layer.go('sessions'); h.layer.paint(ctx);
  assert.equal(layouts, 0, 'opening heading does not load the list');
  clock.now = 1324; h.layer.paint(ctx);
  const oldContent = h.layer.motion.content, afterPrepare = layouts;
  clock.now = 1330; h.layer.paint(ctx); clock.now = 1340; h.layer.paint(ctx);
  assert.equal(layouts, afterPrepare, 'no session sorting/layout between cached frames');
  h.state.sessions = []; h.state.changed(); assert.equal(h.layer.motion.content, undefined);
  h.layer.paint(ctx); assert.notEqual(h.layer.motion.content, oldContent); assert.equal(layouts, afterPrepare + 1);
  clock.now = 1345; await h.layer.handleInput({ type: 'double-click' }); h.layer.paint(ctx);
  assert.ok(h.layer.motion.content);
  h.state.changed(); assert.equal(h.layer.motion, null, 'outgoing snapshot must be released when its source state changes');
  const fresh = h.layer.paint(ctx); fresh.bakeDeferredDrawsInPlace();
  assert.equal(h.layer.screen, 'dashboard'); assert.ok(contentPixels(fresh, { x: 0, y: 0, width: 230, height: 100 }) > 20);
});

test('resize, real input, overlays and removal end motion, while synthetic releases keep it running', async () => {
  const clock = { now: 1000 }, h = setup(clock, true); let width = 576, height = 452;
  const ctx = { stack: { getBaseSize: () => ({ width, height }) } };
  await h.state.refresh(); h.layer.selected = 'sessions'; h.layer.go('sessions'); h.layer.paint(ctx);
  const motion = h.layer.motion;
  await h.layer.handleInput({ type: 'long-press-release' }); await h.layer.handleInput({ type: 'system-menu-opened' });
  assert.equal(h.layer.motion, motion);
  await h.layer.handleInput({ type: 'scroll-down' }); assert.equal(h.layer.motion, null);
  assert.notEqual(h.layer.selected, '');
  await h.layer.handleInput({ type: 'double-click' }); h.layer.paint(ctx); assert.ok(h.layer.motion);
  await h.layer.handleInput({ type: 'click' }); assert.equal(h.layer.screen, 'sessions');
  h.layer.paint(ctx); assert.ok(h.layer.motion, 'reverse navigation starts a populated expansion immediately');
  width = 640; height = 288; const resized = h.layer.paint(ctx); resized.bakeDeferredDrawsInPlace();
  assert.equal(h.layer.motion, null); assert.equal(resized.width, 640); assert.equal(resized.height, 288); assert.ok(contentPixels(resized, h.layer.fullRect()) > 20);
  await h.layer.handleInput({ type: 'double-click' }); h.layer.paint(ctx); h.visibility.overlay = true; h.layer.paint(ctx);
  assert.equal(h.layer.motion, null);
  h.visibility.overlay = false; h.layer.go('sessions'); h.layer.paint(ctx); h.layer.onRemoved(); assert.equal(h.layer.motion, null);
});

test('Sessions defers list layout and body pixels until 90% of expansion', async () => {
  const clock = { now: 1000 }, h = setup(clock, true), ctx = { stack: { getBaseSize: () => ({ width: 576, height: 452 }) } };
  const movement = load('app/apps/t3/card-motion.ts', { '../../ui/card-presentation': face });
  await h.state.refresh();
  const original = h.state.sessions[0];
  h.state.sessions = Array.from({ length: 228 }, (_, i) => ({ ...original, id: `synthetic-${i}`, title: `Project ${i}: synthetic session` }));
  const rows = h.layer.rows.bind(h.layer); let layouts = 0;
  h.layer.rows = () => { layouts++; return rows(); };
  h.layer.selected = 'sessions'; h.layer.go('sessions');
  for (const elapsed of [0, 40, 180, 320, 323]) {
    clock.now = 1000 + elapsed;
    const image = h.layer.paint(ctx), motion = h.layer.motion;
    const rect = movement.cardRect(motion.from, motion.to, elapsed / 360);
    assert.ok(contentPixels(image, rect) > 20, 'heading stays visible');
    assert.equal(layouts, 0, 'no sorting or list layout before 90%');
    assert.equal(motion.content, undefined, 'no cached list raster before 90%');
    for (let y = rect.y + 42; y < rect.y + rect.height - 8; y++)
      for (let x = rect.x + 8; x < rect.x + rect.width - 8; x++)
        assert.equal(image.pixels[y * 576 + x], 1, 'card body stays empty');
    saveMotionFrame(`deferred-${elapsed}`, image);
  }
  clock.now = 1324; const revealed = h.layer.paint(ctx);
  assert.equal(layouts, 1); assert.ok(h.layer.motion.content);
  assert.ok(contentPixels(revealed, { x: 0, y: 42, width: 571, height: 400 }) > 20, 'list appears at 90%');
  saveMotionFrame('deferred-324', revealed);
  clock.now = 1340; h.layer.paint(ctx); assert.equal(layouts, 1, 'last animation frames reuse the list');
  clock.now = 1360; const final = h.layer.paint(ctx); final.bakeDeferredDrawsInPlace();
  assert.equal(h.layer.motion, null); assert.ok(contentPixels(final, h.layer.fullRect()) > 20);
});

test('arrival dropdown rests at the top in both band and full-height viewports', () => {
 for (const height of [288,452]) {
  let now=0,painted;
  const {TimedNotificationLayer}=load('app/ui/shell/timed-notification.ts',{
   '../../graphics/image':{},'../../graphics/ui-fonts':{getDefaultSmallFont:()=>({})},'./geometry':{appViewportRect:()=>({x:0,y:0,width:576,height})},
   './notification-card':{notificationCardRect:notificationCard.notificationCardRect,paintNotificationCard:(_image,rect)=>painted=rect},'../card-presentation':face,
  },{Date:{now:()=>now},setInterval:()=>1,clearInterval(){}});
  const layer=new TimedNotificationLayer('Title','Text',()=>{},()=>{},()=>{},()=>{});
  now=300;layer.paint({stack:{getBaseSize:()=>({width:576,height})}},()=>({}));assert.equal(painted.y,12);
  layer.onRemoved();
 }
});

test('long press dismisses the selected list item and exiting an expanded item removes it', async () => {
 const h=setup();h.state.alerts=[{id:'one',kind:'phone'},{id:'two',kind:'phone'}];h.layer.go('inbox');h.layer.selected='one';
 await h.layer.handleInput({type:'long-press'});assert.deepEqual(h.dismissed,['one']);assert.equal(h.layer.screen,'inbox');assert.equal(h.layer.selected,'two');
 h.layer.openNotification('two');await h.layer.handleInput({type:'double-click'});assert.deepEqual(h.dismissed,['one','two']);assert.equal(h.layer.screen,'inbox');assert.equal(h.navigation.yielded,0);
});
test('a confirmed reply closes even if Android already removed its notification', async () => {
 const h=setup();h.state.alerts=[{id:'one',kind:'phone'}];h.layer.go('sessions');h.layer.openNotification('one','apk:com.faceclaw.t3/com.faceclaw.t3.T3AppService');
 h.setReply({isCurrent:()=>true,send:()=>{h.state.alerts=[];return true;}});await h.layer.handleInput({type:'click'});h.reviews[0][0].onSend('Reply');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.layer.screen,'sessions');assert.deepEqual(h.navigation.events,[]);
});
