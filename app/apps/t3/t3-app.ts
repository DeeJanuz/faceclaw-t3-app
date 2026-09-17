import { resourceKey } from './resource';
import { CARD_TEXT_BRIGHTNESS, cardLineStep } from '../../ui/card-presentation';
import { paintActivityIndicator } from './activity-indicator';
import { RenderingComparisonLayer } from "../developer/rendering-comparison";
import { notificationCardRect, paintNotificationCard } from '../../ui/shell/notification-card';
import { buildSessionRows, reflowDictationText, paginateMessageText, paginateText, paginateTranscriptWithLiveTurn, retainTranscriptPage, selectResponsePage, transcriptPageHeader, activeActivityMarker, extractActiveActivityLine, type TranscriptPage, type PageBox } from './hub-view-model';
import { WindowMotion, cardRect, paintCardFace, paintCardContents, paintSelectionChevron, CARD_MOTION_MS, type CardRect } from './card-motion';
import { openT3Alert, dismissT3Alert, visibleT3Alerts, findT3Alert, getT3NotificationReply, openT3NotificationApp } from "./notifications-ui";
import { Frame } from '@nativescript/core';
import { paintT3Dashboard, dashboardTargets } from './dashboard';
import { weatherBridge } from '../../native/weather';
import { timeFormatSetting } from '../../ui/dashboard-settings';
import { GrayImage } from '../../graphics/image';
import { getDefaultSmallFont } from '../../graphics/ui-fonts';
import { truncateText, wrapText } from '../../graphics/textwrap';
import { type Layer, type LayerContext } from '../../ui/layers';
import { type InputEvent } from '../../ui/gestures';
import { presentationNow } from '../../ui/presentation-clock';
import { shell } from '../../ui/shell/shell';
import { createInProcessWindow, type InProcessAppOptions, type InProcessWindow } from '../../ui/shell/in-process-window';
import { getT3Config } from '../../t3/config';
import { onHostEvent, onHostState } from '../../extensions/host';
import { t3Workspace as state, initializeT3, connectT3, setT3ReaderVisible } from './runtime';
import type { ReviewedReplyDestination } from './workspace';
import type { ModelSummary, NewSessionModelSelection, PlanQuestion, ProposedPlan } from './protocol';
import type { T3Alert } from './workspace';

// Keep this signal additive for reduced test harnesses and embedders that do
// not expose the optional reader-demand hook yet.
function updateReaderVisibility(visible: boolean): void {
  if (typeof setT3ReaderVisible === 'function') setT3ReaderVisible(visible);
}

export const T3_WINDOW_ID = 't3';
export const T3_SURFACE_ID = 'window:t3';
type Screen = 'dashboard' | 'phone-settings' | 'projects' | 'sessions' | 'reader' | 'actions' | 'new-project' | 'new-model' | 'new-reasoning' | 'new-summary' | 'compose' | 'draft' | 'inbox' | 'notification' | 'questions' | 'question-text' | 'choices' | 'plan-review' | 'session-reasoning' | 'session-model' | 'proposed-plan' | 'plan-approve';
type Navigation = { screen: Screen; selected: string; scroll: number; projectId: string; threadId: string };
type Row = { id: string; title: string; detail?: string; disabled?: boolean; section?: boolean; action: () => void | Promise<void> };
export type SlideTransportHint = { key: number; offsetX: number };
type SlideMotion = { id: number; fromScreen: Screen; toScreen: Screen; from: GrayImage; to?: GrayImage; direction: 1 | -1; started: number | null; progress: number; distance: number };
const slideEase = (progress: number): number => 1 - (1 - Math.max(0, Math.min(1, progress))) ** 3;
const inverseSlideEase = (value: number): number => 1 - Math.cbrt(1 - Math.max(0, Math.min(1, value)));
// Bound newly exposed columns so a delayed credit cannot turn into one large
// glyph upload burst. At the standard viewport this keeps dense lists near the
// SDK's recommended 100-150 newly visible glyphs per submitted frame.
const MAX_SLIDE_STEP_PX = 64;
let activeLayer: T3Layer | null = null;

export function openT3Assistant(): void { if (!isT3FlowProtected()) activeLayer?.askAssistant(); }
export function openT3Thread(threadId: string, returnWindowId?: string): void { activeLayer?.openThread(threadId, returnWindowId, true); }
export function isT3FlowProtected(): boolean { return Boolean(activeLayer && shell.isWindowFocused(T3_WINDOW_ID) && ["compose", "draft", "questions", "question-text", "choices", "plan-review", "proposed-plan", "plan-approve", "session-reasoning", "session-model"].includes(activeLayer.screen)); }
export function showT3AlertInCurrentConversation(alert: T3Alert): boolean { return activeLayer?.showAlertInCurrentConversation(alert) ?? false; }
export function openT3Inbox(): void { activeLayer?.go('inbox'); }
export function setT3NotificationOrigin(rect: CardRect): void { activeLayer?.setNotificationOrigin(rect); }
export function openT3Notification(alertId?: string, returnWindowId?: string, returnToSleep = false): void { activeLayer?.openNotification(alertId, returnWindowId, returnToSleep); }

export class T3Layer implements Layer {
  readonly acceptsDirectional = true;
  screen: Screen = 'dashboard';
  private selected = 'assistant';
  private scroll = 0;
  private projectId = '';
  private history: Navigation[] = [];
  private draft = '';
  private draftIsDictated = false;
  private reviewedReplyDestination: ReviewedReplyDestination | null = null;
  private draftLocked = false;
  private draftMode: 'default' | 'plan' | undefined;
  private reasoningModel: NewSessionModelSelection | null = null;
  private reasoningThreadId = '';
  private reviewedPlan: { threadId: string; plan: ProposedPlan } | null = null;
  private creation: { projectId: string; environmentId?: string; modelSelection?: NewSessionModelSelection; assistant?: boolean } | null = null;
  private pickedModel: ModelSummary | null = null;
  private questionIndex = 0;
  private checked: number[] = [];
  private dictatingAnswer = false;
  private returnWindowId: string | null = null;
  private notificationId = '';
  private notificationGroupId = '';
  private notificationNotice = '';
  private notificationReviewPending=false;
  private notificationReturnToSleep = false;
  private atReaderEnd = false;
  private viewWidth = 576;
  private viewHeight = 452;
  private get rowHeight(): number { return getDefaultSmallFont().lineHeight + 10; }
  private transcriptLayoutKey = '';
  private transcriptFont: PageBox['font'] | null = null;
  private transcriptPages: TranscriptPage[] = [];
  private transcriptSource: typeof state.transcript = null;
  private followResponse: Set<string> | null = null;
  private readerThread = '';
  private notificationOrigin: CardRect | undefined;
  private motion: { model: WindowMotion; source: CardRect; from: CardRect; to: CardRect; started: number | null; closing: boolean; content?: GrayImage; heading?: GrayImage; backdrop?: GrayImage } | null = null;
  private slide: SlideMotion | null = null;
  private nextSlideId = 1;
  private slideTransportHint: SlideTransportHint | undefined;
  private returnFocus = 'assistant';
  private pageCount = 1;
  private planIdentity = '';
  private optionPage = 0;
  private visibleActivity = false;

  needsAnimation(): boolean { return Boolean(this.motion || this.slide); }
  frameTransportHint(): SlideTransportHint | undefined { return this.slideTransportHint; }
  nextAnimationDelayMs(): number | null {
    if (this.motion || this.slide || !this.visibleActivity) return null;
    const phaseMs = 140;
    return phaseMs - (presentationNow() % phaseMs);
  }
  private animate(from: CardRect, to: CardRect, closing = false): void {
    if (this.screen === 'compose' || !this.isBaseVisible() || shell.hasOverlay()) {
      console.info(`[T3Motion] skipped direction=${closing?'close':'open'} compose=${this.screen==='compose'} base=${this.isBaseVisible()} overlay=${shell.hasOverlay()}`);
      return;
    }
    const source = closing ? (this.screen === 'inbox' ? this.dropdownRect() : this.fullRect()) : to;
    from = this.motion?.model.lastRect ?? from;
    // Closing never lays out or snapshots the outgoing body.
    const heading = closing ? this.paintStatic(false, true) : undefined;
    heading?.bakeDeferredDrawsInPlace();
    this.slide = null;
    this.motion?.model.cancel();
    this.motion = { model: new WindowMotion(from, to, closing), source, from, to, started: null, closing, heading };
    console.info(`[T3Motion] started direction=${closing?'close':'open'}`);

  }
  private slideDirection(from: Screen, to: Screen): 1 | -1 | 0 {
    if ((from === 'dashboard' && to === 'sessions') || (from === 'sessions' && to === 'reader')) return 1;
    if ((from === 'sessions' && to === 'dashboard') || (from === 'reader' && to === 'sessions')) return -1;
    return 0;
  }
  private startSlide(fromScreen: Screen, toScreen: Screen, direction: 1 | -1): void {
    if (!this.isBaseVisible() || shell.hasOverlay() || this.viewWidth <= 0 || this.viewHeight <= 0) return;
    const now = presentationNow();
    const prior = this.slide;
    if (prior && prior.fromScreen === toScreen && prior.toScreen === fromScreen) {
      const reversedDistance = Math.max(0, this.viewWidth - prior.distance);
      const reversedProgress = inverseSlideEase(reversedDistance / this.viewWidth);
      this.slide = { id: this.nextSlideId++, fromScreen, toScreen, from: this.paintStatic(), direction,
        started: now - reversedProgress * CARD_MOTION_MS, progress: reversedProgress, distance: reversedDistance };
    } else {
      const from = this.paintStatic();
      this.slide = { id: this.nextSlideId++, fromScreen, toScreen, from, direction, started: null, progress: 0, distance: 0 };
    }
    this.motion?.model.cancel();
    this.motion = null;
    console.info(`[T3Slide] started from=${fromScreen} to=${toScreen}`);
  }
  /** Data invalidation never keeps pixels from a notification or prior conversation alive. */
  contentChanged(): void {
    if (this.slide) {
      this.slide.to = undefined;
      if (this.slide.fromScreen === 'reader' && this.screen !== 'reader') {
        this.slide.from = new GrayImage(this.viewWidth, this.viewHeight, 0);
      }
    }
    if (!this.motion) return;
    if (this.motion.closing) {
      // Drop private outgoing pixels without abandoning the geometric return.
      console.info('[T3Motion] invalidated reason=content continuing=neutral-outline');
      this.motion.content = undefined;
      this.motion.heading = new GrayImage(this.viewWidth, this.viewHeight, 0);
      this.motion.backdrop = undefined;
    }
    else { this.motion.content = undefined; this.motion.heading = undefined; this.motion.backdrop = undefined; }
  }
  backdropChanged(): void {
    if (this.motion) this.motion.backdrop = undefined;
    if (this.slide?.toScreen === 'dashboard' && this.screen === 'dashboard') this.slide.to = undefined;
  }
  hostStateChanged(change?: 'ambient' | 'content'): void {
    if (change === 'ambient') this.backdropChanged();
    else this.contentChanged();
  }
  onRemoved(): void {
    if(this.motion)console.info('[T3Motion] cancelled reason=input-or-lifecycle');
    if(this.slide)console.info('[T3Slide] cancelled reason=input-or-lifecycle');
    this.motion?.model.cancel(); this.motion = null; this.slide = null;
  }
  setNotificationOrigin(rect: CardRect): void { this.notificationOrigin = { ...rect }; }
  private paintMotionBackdrop(image: GrayImage, selected: string, dim: boolean): void {
    const motion = this.motion!;
    // A notification over another app has no T3 dashboard to repaint behind it.
    if (this.screen === 'notification' && this.returnWindowId) return;
    if (!motion.backdrop || motion.backdrop.width !== image.width || motion.backdrop.height !== image.height) {
      let backdrop = paintT3Dashboard(image.width, image.height, selected, visibleT3Alerts().length,
        state.demo ? 'Sample data' : state.status, weatherBridge.snapshot(), timeFormatSetting.get(), new Date(), shell.getBatteryLevels());
      if (dim) backdrop = backdrop.dimmed(.5);
      // Freeze and rasterize the backdrop once per transition. Each frame only
      // copies pixels and paints the moving card, including the return animation.
      backdrop.bakeDeferredDrawsInPlace();
      motion.backdrop = backdrop;
    }
    image.pixels.set(motion.backdrop.pixels);
  }
  private homeRect(): CardRect { return dashboardTargets(this.viewWidth, this.viewHeight).find(row => row.id === this.returnFocus) || this.fullRect(); }
  private fullRect(): CardRect { return { x: 0, y: 0, width: this.viewWidth - 5, height: this.viewHeight - 5 }; }
  private dropdownRect(): CardRect { return notificationCardRect({ x: 0, y: 0, width: this.viewWidth, height: 288 }); }
  private pageBox(footer = false): PageBox {
    const font = getDefaultSmallFont();
    return { font, width: this.viewWidth - 37, height: this.viewHeight - 62 - (footer ? font.lineHeight + 16 : 0), lineHeight: cardLineStep(font) };
  }
  // The capture overlay has already collapsed; publish only the restored app.
  private cancelCompose(): void { if (this.screen === 'compose') this.back(false); }

  constructor(private repaint: () => void, private readonly isBaseVisible: () => boolean = () => true) {}

  /** Silence arrivals only for the conversation currently on the visible reader. */
  isAlertVisible(alert: T3Alert): boolean {
    if (!shell.isWindowVisible(T3_WINDOW_ID) || !this.isBaseVisible() ||
        (shell.hasOverlay() && !shell.getNotificationPreviewId())) return false;
    return this.matchesAlertConversation(alert);
  }

  /** A matching asleep reader wakes in place instead of showing a preview. */
  showAlertInCurrentConversation(alert: T3Alert): boolean {
    if (this.isAlertVisible(alert)) return true;
    const woke = this.isBaseVisible() && this.matchesAlertConversation(alert) && shell.wakeWindowForNotification(T3_WINDOW_ID);
    if (woke && alert.kind === 'phone') this.notificationReturnToSleep = true;
    return woke;
  }

  private matchesAlertConversation(alert: T3Alert): boolean {
    if (alert.kind === 't3') return this.screen === 'reader' && Boolean(alert.threadId) &&
      state.selectedThreadId === alert.threadId && state.selectedEnvironmentId === alert.environmentId && state.transcript?.session.id === alert.threadId;
    if (this.screen !== 'notification') return false;
    const current = this.currentNotification();
    return current?.kind === 'phone' && (alert.groupId
      ? current.groupId === alert.groupId
      : current.threadId === alert.threadId && Boolean(alert.threadId));
  }

  go(screen: Screen, remember = true, animateTransition = true): void {
    if (screen !== 'notification') this.notificationReturnToSleep = false;
    const fromScreen = this.screen;
    const slideDirection = animateTransition ? this.slideDirection(fromScreen, screen) : 0;
    const transition = animateTransition && (slideDirection !== 0 || this.screen === 'dashboard' || screen === 'dashboard' || (this.screen === 'inbox' && screen === 'notification') || (this.screen === 'notification' && screen === 'inbox'));
    if (!transition) this.onRemoved();
    if (slideDirection) this.startSlide(fromScreen, screen, slideDirection);
    else if (animateTransition && this.screen === 'dashboard' && screen !== 'dashboard') { this.returnFocus = this.selected; if (screen !== 'compose') this.animate(this.homeRect(), screen === 'inbox' ? this.dropdownRect() : this.fullRect()); }
    if (!slideDirection && animateTransition && screen === 'dashboard' && this.screen !== 'dashboard') this.animate(this.screen === 'inbox' ? this.dropdownRect() : this.fullRect(), this.homeRect(), true);
    if (animateTransition && this.screen === 'inbox' && screen === 'notification') this.animate(this.dropdownRect(), this.fullRect());
    if (animateTransition && this.screen === 'notification' && screen === 'inbox') this.animate(this.fullRect(), this.dropdownRect(), true);
    if (remember) this.history.push({ screen: this.screen, selected: this.selected, scroll: this.scroll, projectId: this.projectId, threadId: state.selectedThreadKey });
    this.screen = screen; this.selected = screen === 'dashboard' ? 'assistant' : ''; this.scroll = 0; this.atReaderEnd = false; updateReaderVisibility(screen === 'reader'); this.repaint();
  }

  openThread(threadId: string, returnWindowId?: string, fromNotification = false): void {
    if (returnWindowId && returnWindowId !== T3_WINDOW_ID && !returnWindowId.startsWith('apk:com.faceclaw.t3/')) this.returnWindowId = returnWindowId;
    else this.returnWindowId = null;
    if (fromNotification) {
      // A notification opens a visit, not another page in the previous thread.
      this.history = [{ screen: 'dashboard', selected: 'inbox', scroll: 0, projectId: '', threadId: '' }];
    }
    this.go('reader', !fromNotification);
    this.readerThread = ''; this.followResponse = null; this.planIdentity = '';
    void state.openThread(threadId);
  }

  openNotification(alertId?: string, returnWindowId?: string, returnToSleep = false): void {
    this.returnWindowId = returnWindowId && returnWindowId !== T3_WINDOW_ID && !returnWindowId.startsWith('apk:com.faceclaw.t3/') ? returnWindowId : null;
    if (this.screen === 'dashboard') this.selected = 'inbox';
    this.notificationId = alertId || '';
    const alert = alertId ? findT3Alert(alertId) : undefined;
    this.notificationReturnToSleep = alert?.kind === 'phone' && returnToSleep;
    this.notificationGroupId = alert?.kind === 'phone' ? alert.groupId || '' : '';
    this.notificationNotice = '';
    this.go(alertId ? 'notification' : 'inbox');
    if (alertId && this.notificationOrigin) { const origin = this.notificationOrigin; this.notificationOrigin = undefined; this.onRemoved(); this.animate(origin, this.fullRect()); }
  }

  private currentNotification() {
    return findT3Alert(this.notificationId) || (this.notificationGroupId ? visibleT3Alerts().find(alert => alert.kind === 'phone' && alert.groupId === this.notificationGroupId) : undefined);
  }

  private replyToCurrentNotification(): void {
    const alert = this.currentNotification();
    const reply = alert && getT3NotificationReply(alert.id);
    if (!reply) return;
    const history = this.history[this.history.length - 1];
    const notificationId = this.notificationId;
    const sameVisit = () => this.screen === 'notification' && this.history[this.history.length - 1] === history && this.notificationId === notificationId;
    const isVisible = () => sameVisit() && this.currentNotification()?.id === alert.id && shell.isWindowFocused(T3_WINDOW_ID);
    const isCurrent = () => isVisible() && reply.isCurrent();
    this.notificationNotice = '';
    if(this.notificationReviewPending)return;
    this.notificationReviewPending=true;
    this.notificationNotice="Review reply on glasses.";
    this.repaint();
    void reply.review(isCurrent).then(status => {
      this.notificationReviewPending=false;
      if (status === 'sent') { if (sameVisit()) this.closeNotificationReader(); return; }
      if (!isVisible()) return;
      this.notificationNotice = { sent: 'Reply sent.', 'draft-saved': 'Draft saved in app. Open app to send.', unknown: 'Send outcome unknown. Check app before retrying.', rejected: 'Reply unavailable. Nothing sent.' }[status];
      this.repaint();
    });
  }

  private back(animateTransition = true): void {
    if (state.busy && this.screen !== 'notification') return;
    if (!animateTransition) this.motion = null;
    const returnToSleep = this.screen === 'notification' && this.notificationReturnToSleep;
    this.notificationReturnToSleep = false;
    if (returnToSleep) shell.sleepAtAppRoot();
    if (this.screen === 'dashboard') { this.history = []; this.returnWindowId = null; shell.respondToBack(true); return; }
    shell.respondToBack(false);
    const draftCreation = this.creation;
    if (['draft', 'compose'].includes(this.screen)) { this.draft = ''; this.draftMode = undefined; this.draftIsDictated = false; this.draftLocked = false; this.dictatingAnswer = false; this.reviewedReplyDestination = null; this.creation = null; }
    if (this.returnWindowId && ['reader', 'notification', 'question-text', 'choices', 'plan-review'].includes(this.screen)) { const id = this.returnWindowId; this.returnWindowId = null; shell.focusWindow(id); return; }
    if (this.screen === 'reader') {
      // Replies, steering and plan edits are internal to this thread visit.
      // Back leaves the visit instead of restoring a reader's earlier page.
      const internal: Screen[] = ['reader', 'actions', 'compose', 'draft', 'questions', 'question-text', 'choices',
        'plan-review', 'proposed-plan', 'plan-approve', 'session-reasoning', 'session-model', 'new-project', 'new-model', 'new-reasoning', 'new-summary'];
      while (this.history.length && internal.includes(this.history[this.history.length - 1].screen)) this.history.pop();
    }
    const previous = this.history.pop();
    if (previous) {
      const slideDirection = animateTransition ? this.slideDirection(this.screen, previous.screen) : 0;
      if (slideDirection) this.startSlide(this.screen, previous.screen, slideDirection);
      if (animateTransition && this.screen === 'notification' && previous.screen === 'inbox') this.animate(this.fullRect(), this.dropdownRect(), true);
      if (!slideDirection && animateTransition && previous.screen === 'dashboard') this.animate(this.screen === 'inbox' ? this.dropdownRect() : this.fullRect(), this.homeRect(), true);
      if (previous.screen === 'new-summary') this.creation = draftCreation;
      this.screen = previous.screen; this.selected = previous.selected; this.scroll = previous.scroll; this.projectId = previous.projectId; updateReaderVisibility(this.screen === 'reader');
      if (previous.threadId && previous.threadId !== state.selectedThreadKey) void state.openThread(previous.threadId);
    } else { this.go('dashboard', false, animateTransition); return; }
    this.repaint();
  }

  receiveText(text: string, dictated = false): void {
    if (!text.trim() || state.busy || this.draftLocked) return;
    if (!['compose', 'draft', 'reader', 'actions'].includes(this.screen)) { this.creation = null; this.dictatingAnswer = false; this.go('new-project'); return; }
    this.draft = text.trim();
    this.draftIsDictated = dictated;
    this.reviewedReplyDestination = null;
    this.go('draft', false);
  }

  private async submitDictatedText(text: string, destination: ReviewedReplyDestination): Promise<void> {
    if (!text.trim() || state.busy || this.draftLocked) return;
    this.draft = text.trim();
    this.draftIsDictated = true;
    this.reviewedReplyDestination = destination;
    await this.submitDraft();
  }

  private async submitDraft(): Promise<void> {
    if (this.draftLocked || !this.draft.trim()) return;
    if (this.dictatingAnswer) {
      const question = this.question();
      if (question) state.setAnswer(state.selectedThreadId, { questionId: question.id, optionIndexes: [], text: this.draft });
      this.dictatingAnswer = false; this.draft = '';
      this.history = this.history.filter(item => !['question-text', 'choices', 'compose', 'draft'].includes(item.screen));
      this.nextPlanQuestion();
      return;
    }
    this.followResponse = new Set(state.transcript?.turns.flatMap(turn => turn.messages.map(message => message.id)) || []);
    this.draftLocked = true;
    const options = this.creation?.modelSelection ? { projectId: this.creation.projectId, environmentId: this.creation.environmentId, modelSelection: this.creation.modelSelection, assistant: this.creation.assistant } : undefined;
    const reviewedDestination = !options && this.draftIsDictated ? this.reviewedReplyDestination : null;
    if (reviewedDestination) {
      const current = getT3Config();
      const pairing = JSON.stringify([current.bridgeUrl, current.pairingFingerprint]);
      if (pairing !== reviewedDestination.pairing || state.selectedThreadId !== reviewedDestination.threadId || state.selectedEnvironmentId !== reviewedDestination.environmentId) {
        // Dictation was captured for a different bridge identity or thread.
        // Keep the draft visible, but never replay it into the new destination.
        state.canRetryLastSend = false;
        state.fail(Object.assign(new Error('The dictation destination changed. Capture it again.'), { code: 'destination_changed' }));
        this.repaint();
        return;
      }
    }
    const sent = await state.send(this.draft, options, reviewedDestination
      ? { reviewedDestination }
      : !options && this.draftMode ? { interactionMode: this.draftMode } : undefined);
    if (!sent && state.canRetryLastSend) this.draftLocked = false;
    if (sent) {
      this.draft = ''; this.draftMode = undefined; this.creation = null; this.draftLocked = false; this.reviewedReplyDestination = null;
      this.history = this.history.filter(item => !['compose', 'draft', 'new-project', 'new-model', 'new-reasoning', 'new-summary'].includes(item.screen));
      this.readerThread = ''; this.go('reader', false);
    } else if (this.screen !== 'draft') {
      // A failed direct send keeps the text reachable for the existing retry
      // path without making a second review part of the successful flow.
      this.go('draft', false);
    }
    this.repaint();
  }

  private record(): void {
    if (state.busy || this.draftLocked) return;
    if (state.demo) {
      this.receiveText(this.dictatingAnswer ? 'Check the reconnect flow and preserve the reading position.' : 'Show me the next step and keep the response concise.');
      return;
    }
    const targetScreen = this.screen;
    const config = getT3Config();
    const identity = JSON.stringify([config.bridgeUrl, config.pairingFingerprint]);
    const targetThread = state.selectedThreadId;
    const targetEnvironment = state.selectedEnvironmentId;
    const targetCreation = this.creation;
    const targetHistory = this.history[this.history.length - 1];
    const targetQuestion = this.questionIndex;
    const targetAnswer = this.dictatingAnswer;
    const canStart = () => {
      const current = getT3Config();
      return activeLayer === this && !state.demo && current.enabled && !state.busy && !this.draftLocked &&
        this.screen === targetScreen && state.selectedThreadId === targetThread && state.selectedEnvironmentId === targetEnvironment && this.creation === targetCreation &&
        this.history[this.history.length - 1] === targetHistory && this.questionIndex === targetQuestion &&
        this.dictatingAnswer === targetAnswer && JSON.stringify([current.bridgeUrl, current.pairingFingerprint]) === identity;
    };
    shell.startT3Dictation(text => {
      if (!canStart()) return;
      void this.submitDictatedText(text, { threadId: targetThread, ...(targetEnvironment ? { environmentId: targetEnvironment } : {}), pairing: identity });
    }, () => { if (canStart()) this.cancelCompose(); }, canStart, targetHistory?.screen === 'dashboard' ? this.homeRect() : this.fullRect());
  }

  askAssistant(): void {
    const config = getT3Config();
    if (state.demo) { this.startCompose({ projectId: 'assistant', assistant: true, modelSelection: { instanceId: 'demo', model: 'preview-astra', reasoningId: 'high' } }); return; }
    if (!config.assistantProjectId || !config.assistantModel || !config.assistantProvider) { this.settings(); return; }
    this.startCompose({ projectId: config.assistantProjectId, environmentId: config.assistantEnvironmentId || undefined, assistant: true, modelSelection: { instanceId: config.assistantProvider, model: config.assistantModel, ...(config.assistantReasoning ? { reasoningId: config.assistantReasoning } : {}) } });
  }

  private startCompose(creation: T3Layer['creation'] = null): void {
    this.creation = creation; this.dictatingAnswer = false; this.draft = ''; this.draftIsDictated = false; this.reviewedReplyDestination = null; this.draftMode = undefined; this.draftLocked = false;
    this.go('compose'); this.record();
  }

  private question(): PlanQuestion | null {
    return state.getPlan(state.selectedThreadId)?.request.questions[this.questionIndex] ?? null;
  }

  private canChangeSession(): boolean {
    const session = state.transcript?.session;
    return Boolean(session && session.id === state.selectedThreadId && session.interactionMode &&
      ['idle', 'ready', 'interrupted', 'stopped', 'error'].includes(session.status) && !state.busy);
  }

  private sessionDraft(): boolean { return this.screen === 'draft' && !this.creation && !this.dictatingAnswer && !this.draftLocked; }

  private openModel(): void {
    if (!this.canChangeSession() || !state.transcript?.session.modelSelection) return;
    this.go('session-model');
    this.selected = `${state.transcript.session.modelSelection.instanceId}/${state.transcript.session.modelSelection.model}`;
    void state.refresh();
  }

  private openReasoning(): void {
    if (!this.canChangeSession() || !state.transcript?.session.modelSelection) return;
    this.reasoningModel = { ...state.transcript.session.modelSelection };
    this.reasoningThreadId = state.transcript.session.id;
    this.go('session-reasoning');
    this.selected = this.reasoningModel.reasoningId || '';
    void state.refresh();
  }

  private openProposedPlan(): void {
    const plan = state.transcript?.pendingProposedPlan;
    if (!plan || !state.transcript || state.busy) return;
    this.reviewedPlan = { threadId: state.transcript.session.id, plan: { ...plan } };
    this.go('proposed-plan');
  }

  private title(): string {
    const titles: Record<Screen, string> = {
      'session-reasoning': 'Session reasoning', 'session-model': 'Session model', 'proposed-plan': 'Proposed plan', 'plan-approve': 'Approve and implement?',
      dashboard: 'T3 Assistant', 'phone-settings': 'Settings', projects: 'Projects', sessions: 'Sessions', reader: state.transcript?.session.title || 'Conversation',
      actions: 'Conversation', 'new-project': 'New conversation', 'new-model': 'Choose a model', 'new-reasoning': 'Reasoning', 'new-summary': 'New session',
      compose: this.creation ? 'New message' : 'Reply', draft: 'Review draft', inbox: 'Notifications', notification: 'Notification', questions: 'Plan questions', 'question-text': this.question()?.header || 'Question', choices: this.question()?.header || 'Choose an answer', 'plan-review': 'Review answers',
    };
    return titles[this.screen];
  }

  private rows(): Row[] {
    if (this.screen === 'session-reasoning') {
      const model = this.reasoningModel;
      const threadId = this.reasoningThreadId;
      const choices = state.modelsFor(state.selectedEnvironmentId).find(item => item.instanceId === model?.instanceId && item.model === model.model)?.reasoningChoices ?? [];
      return choices.map(choice => ({ id: choice.id, title: `${choice.label}${choice.id === state.transcript?.session.modelSelection?.reasoningId ? ' (current)' : ''}`,
        disabled: state.busy, action: async () => {
          if (model && await state.setReasoning(threadId, choice.id, model) && this.screen === 'session-reasoning') this.back();
        } }));
    }
    if (this.screen === 'session-model') {
      const session = state.transcript?.session;
      const expected = session?.modelSelection;
      return state.modelsFor(state.selectedEnvironmentId).map(model => ({
        id: `${model.instanceId}/${model.model}`,
        title: `${model.name}${model.instanceId === expected?.instanceId && model.model === expected.model ? ' (current)' : ''}`,
        detail: model.providerName,
        action: async () => {
          if (!session || !expected || !this.canChangeSession()) return;
          const sameModel = model.instanceId === expected.instanceId && model.model === expected.model;
          const reasoningId = sameModel
            ? expected.reasoningId
            : model.reasoningChoices.find(choice => choice.isDefault)?.id;
          const selection: NewSessionModelSelection = {
            instanceId: model.instanceId,
            model: model.model,
            ...(reasoningId ? { reasoningId } : {}),
          };
          if (await state.setModel(session.id, selection, expected) && this.screen === 'session-model') this.back();
        },
      }));
    }
    if (this.screen === 'dashboard') return [
      { id: 'inbox', title: 'Notifications', action: () => this.go('inbox') },
      { id: 'assistant', title: 'Ask Assistant', detail: 'Fresh conversation in your assistant project', action: () => {
        this.askAssistant();
      } },
      { id: 'sessions', title: 'Sessions', action: () => { this.projectId = ''; this.go('sessions'); } },
    ];
    if (this.screen === 'projects' || this.screen === 'new-project') return state.projects.map(project => ({
      id: resourceKey(project.id, project.environmentId), title: `${project.title}${project.environmentLabel ? " · " + project.environmentLabel : ""}`, detail: this.screen === 'new-project' ? 'Start a new conversation' : `${state.sessions.filter(s => s.projectId === project.id && s.environmentId === project.environmentId).length} conversations`,
      disabled: this.screen === 'new-project' && !project.canStartSession,
      action: () => {
        if (this.screen === 'new-project') { this.creation = { projectId: project.id, environmentId: project.environmentId }; this.go('new-model'); }
        else { this.projectId = resourceKey(project.id, project.environmentId); this.go('sessions'); }
      },
    }));
    if (this.screen === 'sessions') return buildSessionRows({ snapshotId: '', frozenAt: '', unsettled: state.sessions.filter(session => !session.settled), settled: state.sessions.filter(session => session.settled), environments: state.environments }, Date.now(), state.projects).map(row => ({
      id: row.key === 'new' ? 'new' : row.value || row.key, title: row.text, section: !row.selectable,
      action: () => { if (row.key === 'new') this.go('new-project'); else if (row.value) this.openThread(row.value); },
    }));
    if (this.screen === 'new-model') return state.modelsFor(this.creation?.environmentId).map(model => ({
      id: `${model.instanceId}/${model.model}`, title: model.name, detail: model.providerName,
      action: () => {
        this.pickedModel = model;
        if (!this.creation) return;
        this.creation.modelSelection = { instanceId: model.instanceId, model: model.model };
        if (model.reasoningChoices.length) this.go('new-reasoning');
        else this.go('new-summary');
      },
    }));
    if (this.screen === 'new-reasoning') return (this.pickedModel?.reasoningChoices || []).map(reasoning => ({
      id: reasoning.id, title: reasoning.label, detail: reasoning.isDefault ? 'Default for this model' : this.pickedModel!.name,
      action: () => { if (this.creation?.modelSelection) { this.creation.modelSelection.reasoningId = reasoning.id; this.go('new-summary'); } },
    }));
    if (this.screen === 'inbox') return visibleT3Alerts().map(alert => ({
      id: alert.id, title: alert.title, detail: alert.body, action: async () => { await openT3Alert(alert); },
    }));
    if (this.screen === 'choices') {
      const question = this.question();
      if (!question) return [];
      const accept = (indexes: number[]) => { state.setAnswer(state.selectedThreadId, { questionId: question.id, optionIndexes: indexes, text: '' }); this.nextPlanQuestion(); };
      return [
        ...question.options.map((option, index) => ({ id: `option-${index}`, title: `${question.multiSelect ? `${this.checked.includes(index) ? '[x]' : '[ ]'} ` : ''}${option.label}`, detail: option.description,
          action: () => { if (question.multiSelect) { this.checked = this.checked.includes(index) ? this.checked.filter(i => i !== index) : [...this.checked, index]; this.repaint(); } else accept([index]); } })),
        ...(question.multiSelect ? [{ id: 'accept', title: 'Use selected answers', disabled: !this.checked.length, action: () => accept(this.checked) }] : []),
        { id: 'dictate', title: 'Dictate your own answer', action: () => { this.dictatingAnswer = true; this.creation = null; this.draft = ''; this.go('compose'); this.record(); } },
      ];
    }
    return [];
  }

  settings(): void {
    if (this.screen !== 'phone-settings') this.go('phone-settings');
    Frame.topmost()?.navigate('phone-ui/t3-settings-page');
  }

  private body(): string {
    if (this.screen === 'proposed-plan') return this.reviewedPlan?.plan.planMarkdown || 'This plan is no longer available.';
    if (this.screen === 'plan-approve') {
      const review = this.reviewedPlan;
      if (!review) return 'This plan is no longer available.';
      if (state.busy) return 'Starting implementation…';
      if (state.isPlanApprovalLocked(review.threadId, review.plan)) return state.error || 'Approval status is uncertain. Check this plan in T3 before trying again.';
      return state.error || 'Tap to approve this plan and start implementation.\n\nDouble-tap returns to the plan.';
    }
    if (this.screen === 'notification') {
      const alert = this.currentNotification();
      return alert ? `${alert.title}\n\n${alert.body}` : 'Notification no longer available.';
    }
    if (this.screen === 'phone-settings') return 'Check your phone\n\nManage your T3 connection, assistant, models, and dictation in T3 Assistant settings on your phone.\n\nDouble-tap to return.';
    if (this.screen === 'new-summary') return `${state.projects.find(project => project.id === this.creation?.projectId && project.environmentId === this.creation?.environmentId)?.title || 'New session'}\n\n${this.pickedModel?.name || ''}\nReasoning: ${this.pickedModel?.reasoningChoices.find(choice => choice.id === this.creation?.modelSelection?.reasoningId)?.label || 'Provider default'}\nSpeed: Normal`;
    if (this.screen === 'question-text') {
      const question = this.question();
      return question?.question || 'This question has been resolved.';
    }
    if (this.screen === 'compose') return state.demo ? 'Use Dictate to try a sample draft, or type into this app from the phone keyboard.' : 'Dictate using the microphone, or type into this app from the phone keyboard. Review dictated text on the capture card before sending.';
    if (this.screen === 'draft') return this.draftIsDictated ? reflowDictationText(this.draft) : this.draft;
    if (this.screen === 'plan-review') {
      const draft = state.getPlan(state.selectedThreadId);
      if (!draft) return 'This request has been resolved.';
      return draft.request.questions.map((question, index) => {
        const answer = draft.answers.find(a => a.questionId === question.id);
        return `${index + 1}. ${question.question}\n${answer?.text || answer?.optionIndexes.map(i => question.options[i]?.label).join('; ') || 'Not answered'}`;
      }).join('\n\n') + `\n\n${draft.notice || (draft.answers.length === draft.request.questions.length ? 'All answers ready. Tap here to submit.' : 'Answer every question before submitting.')}`;
    }
    if (!state.transcript) return state.error || 'Loading conversation…';
    const activity = (state.transcript.liveActivities || []).map(item => `${item.completedAt ? 'Done' : 'Working'} · ${item.label}`).join('\n');
    return state.transcript.turns.map(turn => [
      turn.separatorLabel,
      ...turn.messages.map(message => `${message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Assistant' : 'System'}\n${message.text}`),
    ].join('\n\n')).join('\n\n') + (activity ? `\n\nActivity\n${activity}` : '') + (state.transcript.liveActivity ? `\n\n${state.transcript.liveActivity.label || state.transcript.liveActivity.phase}…` : '');
  }

  private nextPlanQuestion(index?: number): void {
    const plan = state.getPlan(state.selectedThreadId);
    if (!plan || plan.locked) return;
    const unanswered = plan.request.questions.findIndex(question => !plan.answers.some(answer => answer.questionId === question.id));
    this.questionIndex = index === undefined ? Math.max(0, unanswered) : (index + plan.request.questions.length) % plan.request.questions.length;
    this.go(index === undefined && unanswered < 0 ? 'plan-review' : 'question-text', false);
  }

  private planPages(): { title: string; text: string }[] {
    const plan = state.getPlan(state.selectedThreadId);
    if (!plan) return [{ title: 'T3', text: 'This request has been resolved.' }];
    if (plan.locked) return [{ title: 'CHECKING SUBMISSION', text: plan.notice || 'Answers are locked to prevent duplicates.' }];
    const pages = (text: string) => paginateText(text, this.pageBox());
    if (this.screen === 'plan-review') {
      const content = plan.request.questions.flatMap((question, index) => {
        const answer = plan.answers.find(answer => answer.questionId === question.id);
        return pages(`${index + 1}. ${question.question}\nAnswer: ${answer?.text || answer?.optionIndexes.map(option => question.options[option]?.label).join('; ') || 'Not answered'}`);
      });
      return [...content.map((text, index) => ({ title: `REVIEW | ${index + 1}/${content.length}`, text })), { title: `SUBMIT ${plan.answers.length}/${plan.request.questions.length} ANSWERS`, text: `${plan.answers.length === plan.request.questions.length ? 'Ready to submit all answers.' : 'Answer every question first.'}\n${plan.notice || 'Nothing has been sent.'}` }];
    }
    const question = this.question();
    if (!question) return [{ title: 'QUESTION', text: 'This request has been resolved.' }];
    const content = pages(question.question);
    return content.map((text, index) => ({ title: `QUESTION ${this.questionIndex + 1}/${plan.request.questions.length} | ${index + 1}/${content.length}`, text }));
  }

  private readerPage(): { title: string; text: string; activity?: { line: number; label: string } } {
    const transcript = state.transcript;
    if (!transcript) return { title: 'T3 | LOADING', text: state.error || 'Loading conversation…' };
    const box = this.pageBox();
    const layoutKey = `${box.width}:${box.height}:${box.lineHeight}`;
    if (transcript !== this.transcriptSource || layoutKey !== this.transcriptLayoutKey || box.font !== this.transcriptFont) {
      const old = this.transcriptPages;
      const last = this.scroll === old.length - 1;
      const fresh = this.readerThread !== resourceKey(transcript.session.id, transcript.session.environmentId);
      this.transcriptPages = paginateTranscriptWithLiveTurn(transcript.turns, transcript.liveActivities || [], transcript.liveActivity, box);
      const working = ['running', 'starting'].includes(transcript.session.status);
      if (this.followResponse && (fresh || last)) this.scroll = selectResponsePage(this.transcriptPages, this.followResponse, working).pageIndex;
      else this.scroll = fresh || last ? this.transcriptPages.length - 1 : retainTranscriptPage(old, this.scroll, this.transcriptPages);
      if (!working) this.followResponse = null;
      this.transcriptSource = transcript; this.transcriptLayoutKey = layoutKey; this.transcriptFont = box.font; this.readerThread = resourceKey(transcript.session.id, transcript.session.environmentId);
    }
    this.pageCount = this.transcriptPages.length;
    this.scroll = Math.max(0, Math.min(this.scroll, this.pageCount - 1));
    const page = this.transcriptPages[this.scroll];
    if (!page) return { title: 'T3 | NO TURNS | 1/1', text: '(empty)' };
    const working = ['running', 'starting'].includes(transcript.session.status);
    const unread = this.pageCount - this.scroll - 1;
    const selection = transcript.session.modelSelection;
    const selectedModel = selection ? state.modelsFor(transcript.session.environmentId)
      .find(model => model.instanceId === selection.instanceId && model.model === selection.model) : undefined;
    const title = transcriptPageHeader(page, this.scroll + 1, this.pageCount, transcript.tokenUsage, {
      working, unread, font: box.font, width: box.width, model: selectedModel?.name || selection?.model,
    });
    const extracted = page.activeActivity ? extractActiveActivityLine(page.text, page.activeActivity, box.width, page.activeActivityLabel) : null;
    return { title, text: extracted?.body ?? page.text,
      activity: extracted && page.activeActivity ? { line: extracted.lineIndex,
        label: activeActivityMarker(page.activeActivity, 0, page.activeActivityLabel).slice(2, -2) } : undefined };
  }

  paint(ctx: LayerContext): GrayImage {
    this.slideTransportHint = undefined;
    const { width, height } = ctx.stack.getBaseSize();
    if (width !== this.viewWidth || height !== this.viewHeight || !this.isBaseVisible() || shell.hasOverlay()) {
      if(this.motion)console.info(`[T3Motion] cancelled reason=visibility-or-geometry overlay=${shell.hasOverlay()}`);
      if(this.slide)console.info(`[T3Slide] cancelled reason=visibility-or-geometry overlay=${shell.hasOverlay()}`);
      this.motion = null;
      this.slide = null;
    }
    this.viewWidth = width; this.viewHeight = height;
    const pending = state.getPlan(state.selectedThreadId);
    const identity = pending ? `${state.selectedThreadId}:${pending.request.requestId}:${pending.request.revision}` : '';
    if (this.screen === 'reader' && identity && identity !== this.planIdentity) { this.planIdentity = identity; this.nextPlanQuestion(); }
    if (['question-text', 'choices', 'plan-review'].includes(this.screen) && !pending) { this.motion = null; this.screen = 'reader'; this.scroll = 0; updateReaderVisibility(true); }
    const slide = this.slide;
    if (slide) {
      // Lay out each complete page once. Deferred glyph identity survives the
      // translation, while retained-copy metadata moves the overlap cheaply.
      if (!slide.to) slide.to = this.paintStatic();
      const now = presentationNow();
      if (slide.started === null) slide.started = now;
      const linear = Math.max(0, Math.min(1, (now - slide.started) / CARD_MOTION_MS));
      const desiredDistance = Math.round(width * slideEase(linear));
      const distance = Math.min(desiredDistance, slide.distance + MAX_SLIDE_STEP_PX);
      slide.distance = distance;
      slide.progress = inverseSlideEase(distance / width);
      const image = new GrayImage(width, height, 0);
      const outgoingX = slide.direction === 1 ? -distance : distance;
      const incomingX = slide.direction === 1 ? width - distance : -width + distance;
      image.bitBlt(slide.from, outgoingX, 0);
      image.bitBlt(slide.to, incomingX, 0);
      this.slideTransportHint = { key: slide.id, offsetX: outgoingX };
      if (distance >= width) {
        console.info('[T3Slide] completed'); this.slide = null;
      }
      return image;
    }
    const motion = this.motion;
    if (motion) {
      if (!motion.heading) { motion.heading = this.paintStatic(false, true); motion.heading.bakeDeferredDrawsInPlace(); }
      const image = new GrayImage(width, height, 0);
      this.paintMotionBackdrop(image, motion.closing ? this.selected : this.returnFocus, !motion.closing);
      // Start after preparing the first lightweight frame, not before layout.
      const frame = motion.model.sample(presentationNow());
      motion.started = motion.model.started;
      if (!frame || frame.done) { console.info('[T3Motion] completed');this.motion = null; }
      else {
        let content = motion.heading;
        if (frame.bodyVisible) {
          if (!motion.content) { motion.content = this.paintStatic(false); motion.content.bakeDeferredDrawsInPlace(); }
          content = motion.content;
        }
        paintCardFace(image, frame.rect);
        paintCardContents(image, content, motion.source, frame.rect);
        return image;
      }
    }
    return this.paintStatic();
  }

  private paintStatic(includeBackdrop = true, headingOnly = false): GrayImage {
    this.visibleActivity = false;
    const width = this.viewWidth, height = this.viewHeight;
    const pending = state.getPlan(state.selectedThreadId);
    const image = new GrayImage(width, height, 0);
    const font = getDefaultSmallFont();
    if (this.screen === 'dashboard') {
      if (!this.rows().some(row => row.id === this.selected)) this.selected = 'assistant';
      return paintT3Dashboard(width, height, this.selected, visibleT3Alerts().length, state.demo ? 'Sample data' : state.status, weatherBridge.snapshot(), timeFormatSetting.get(), new Date(), shell.getBatteryLevels());
    }
    if (headingOnly) {
      const rect = this.screen === 'inbox' ? this.dropdownRect() : this.fullRect();
      paintCardFace(image, rect);
      image.drawText(font, rect.x + 16, rect.y + 10, this.title().toUpperCase(), CARD_TEXT_BRIGHTNESS);
      return image;
    }
    const rows = this.rows();
    const x = 0, y = 0;
    const textWidth = width - 37;
    if (this.screen === 'compose') return image;
    if (this.screen === 'inbox') {
      if (includeBackdrop) image.drawImage(paintT3Dashboard(width, height, 'inbox', rows.length, '', weatherBridge.snapshot(), timeFormatSetting.get(), new Date(), shell.getBatteryLevels()).dimmed(.5), 0, 0);
      const rect = this.dropdownRect();
      if (!rows.some(row => row.id === this.selected)) this.selected = rows[0]?.id || '';
      const index = Math.max(0, rows.findIndex(row => row.id === this.selected));
      const row = rows[index];
      paintNotificationCard(image, rect, font, { title: row?.title || 'NOTIFICATIONS',
        text: row?.detail || 'You are all caught up.', counter: `${row ? index + 1 : 0}/${rows.length}` });
      return image;
    }
    if (['question-text', 'choices', 'plan-review'].includes(this.screen)) {
      paintCardFace(image, this.fullRect());
      let card: { title: string; text: string };
      if (this.screen === 'choices' && !pending?.locked) {
        const choices = rows.flatMap(row => paginateText(`${row.title}\n${row.detail || ''}`, this.pageBox()).map(text => ({ row, text })));
        this.optionPage = Math.max(0, Math.min(this.optionPage, choices.length - 1));
        const choice = choices[this.optionPage];
        this.selected = choice?.row.id || '';
        this.pageCount = choices.length;
        card = { title: `ANSWER ${this.questionIndex + 1}/${pending?.request.questions.length || 1} | ${this.optionPage + 1}/${choices.length}`, text: choice?.text || 'No answers available.' };
      } else {
        const pages = this.planPages(); this.pageCount = pages.length;
        this.scroll = Math.max(0, Math.min(this.scroll, pages.length - 1));
        this.atReaderEnd = this.scroll === pages.length - 1;
        card = pages[this.scroll];
      }
      image.drawText(font, 16, 10, truncateText(font, card.title, textWidth), CARD_TEXT_BRIGHTNESS);
      card.text.split('\n').forEach((line, index) => image.drawText(font, 16, 42 + index * (cardLineStep(font)), line, CARD_TEXT_BRIGHTNESS));
      return image;
    }
    // Sessions and the transcript use the lens itself as their canvas. Their
    // headings, selection state, and content remain, without a full-screen
    // card edge around them.
    if (this.screen !== 'sessions' && this.screen !== 'reader') paintCardFace(image, this.fullRect());
    const top = y + 42;
    const reader = ['reader', 'draft', 'new-summary', 'plan-review', 'question-text', 'phone-settings', 'notification', 'proposed-plan', 'plan-approve'].includes(this.screen);
    let title = this.title().toUpperCase();
    if (reader) {
      let text = this.body();
      let activity: { line: number; label: string } | undefined;
      if (this.screen === 'reader') { const page = this.readerPage(); title = page.title; text = page.text; activity = page.activity; this.visibleActivity = Boolean(activity); }
      else {
        const pages = paginateMessageText(text, this.pageBox(this.screen === 'draft' || this.screen === 'notification'));
        this.pageCount = pages.length;
        this.scroll = Math.max(0, Math.min(this.scroll, pages.length - 1));
        this.atReaderEnd = this.scroll === pages.length - 1;
        text = pages[this.scroll];
        const mode = !this.creation && !this.dictatingAnswer ? this.draftMode ?? state.transcript?.session.interactionMode : undefined;
        title = this.screen === 'draft' ? `${this.dictatingAnswer ? 'ANSWER' : mode === 'plan' ? 'PLAN DRAFT' : mode === 'default' ? 'NORMAL DRAFT' : 'DRAFT'} | ${this.scroll + 1}/${pages.length} | ${this.dictatingAnswer ? 'TAP TO KEEP' : 'NOT SENT'}` : `${title} | ${this.scroll + 1}/${pages.length}`;
      }
      image.drawText(font, x + 16, y + 10, truncateText(font, title, textWidth), CARD_TEXT_BRIGHTNESS);
      const lines = text.split('\n');
      const step = cardLineStep(font);
      lines.forEach((line, index) => {
        if (activity?.line === index) paintActivityIndicator(image, font, x + 16, top + index * step,
          textWidth, step, activity.label, Math.floor(presentationNow() / 140));
        else image.drawText(font, x + 16, top + index * step, line, CARD_TEXT_BRIGHTNESS);
      });
      if (this.screen === 'draft' && (this.draftLocked || state.error)) image.drawText(font, x + 16, height - font.lineHeight - 16, truncateText(font, state.error || 'SENDING TO T3 CODE', textWidth), 180);
      if (this.screen === 'notification') {
        const alert = this.currentNotification();
        const hint = this.notificationNotice || (alert && getT3NotificationReply(alert.id) ? 'Tap to dictate reply' : 'Reply unavailable for this notification');
        image.drawText(font, x + 16, height - font.lineHeight - 16, truncateText(font, hint, textWidth), 180);
      }
    } else {
      if (!rows.some(row => row.id === this.selected && !row.section)) this.selected = rows.find(row => !row.section)?.id || '';
      const index = Math.max(0, rows.findIndex(row => row.id === this.selected));
      const selectable = rows.filter(row => !row.section);
      const count = Math.max(1, Math.floor(this.pageBox().height / this.rowHeight));
      this.scroll = Math.min(Math.max(0, index - 2), Math.max(0, rows.length - count));
      const heading = this.screen === 'new-project' ? 'SELECT PROJECT' : this.screen === 'new-model' ? 'SELECT MODEL' : this.screen === 'new-reasoning' ? 'SELECT REASONING' : title;
      image.drawText(font, x + 16, y + 10, `${heading} | ${Math.max(0, selectable.findIndex(row => row.id === this.selected) + 1)}/${selectable.length}`, CARD_TEXT_BRIGHTNESS);
      rows.slice(this.scroll, this.scroll + count).forEach((row, offset) => {
        const rowY = top + offset * this.rowHeight;
        const selected = row.id === this.selected;
        if (selected) {
          image.drawRoundedRect(x + 8, rowY - 3, width - 21, this.rowHeight, 210, 4, 3);
          paintSelectionChevron(image, x + 16, rowY + font.lineHeight / 2);
        }
        image.drawText(font, x + 32, rowY, truncateText(font, row.title, textWidth - 16), row.section ? 130 : row.disabled ? 85 : selected ? CARD_TEXT_BRIGHTNESS : 165);
      });
      if (!rows.length) image.drawText(font, x + 16, top, truncateText(font, state.error || 'Nothing here yet.', textWidth), 170);
    }
    return image;
  }

  async handleInput(event: InputEvent): Promise<void> {
    // Synthetic release/menu notifications must not cancel a just-started animation.
    if (['click', 'scroll-up', 'scroll-down', 'swipe-up', 'swipe-down', 'swipe-right'].includes(event.type)) this.onRemoved();
    if (this.screen === 'inbox' && event.type === 'swipe-left') { const alert = findT3Alert(this.selected); if (alert) dismissT3Alert(alert); return; }
    if (event.type === 'long-press' && this.claimsNotificationDismissGesture()) { await this.dismissSelectedNotification(); return; }
    if (event.type === 'double-click' || event.type === 'swipe-left') {
      if (this.screen === 'notification') await this.dismissSelectedNotification(); else this.back();
      return;
    }
    if (['question-text', 'choices', 'plan-review'].includes(this.screen) && state.getPlan(state.selectedThreadId)?.locked) return;
    const direction = event.type === 'scroll-down' || event.type === 'swipe-down' ? 1 : event.type === 'scroll-up' || event.type === 'swipe-up' ? -1 : 0;
    if (direction) {
      if (this.screen === 'choices') { this.optionPage = Math.max(0, Math.min(this.pageCount - 1, this.optionPage + direction)); return; }
      const rows = this.rows().filter(row => !row.section);
      if (rows.length) { const index = Math.max(0, rows.findIndex(row => row.id === this.selected)); this.selected = rows[this.screen === 'dashboard' || this.screen === 'inbox' ? (index + direction + rows.length) % rows.length : Math.max(0, Math.min(rows.length - 1, index + direction))].id; }
      else this.scroll = Math.max(0, Math.min(this.pageCount - 1, this.scroll + direction));
      return;
    }
    if (event.type !== 'click' && event.type !== 'swipe-right') return;
    if (this.screen === 'proposed-plan') { this.scroll = Math.min(this.pageCount - 1, this.scroll + 1); return; }
    if (this.screen === 'plan-approve') {
      const review = this.reviewedPlan;
      if (review && await state.approvePlan(review.threadId, review.plan) && this.screen === 'plan-approve') {
        this.reviewedPlan = null;
        this.history = this.history.filter(item => !['proposed-plan', 'plan-approve'].includes(item.screen));
        this.go('reader', false);
      }
      return;
    }
    if (this.screen === 'notification') { this.replyToCurrentNotification(); return; }
    if (this.screen === 'question-text') { this.checked = [...(state.getPlan(state.selectedThreadId)?.answers.find(answer => answer.questionId === this.question()?.id)?.optionIndexes || [])]; this.optionPage = 0; this.go('choices', false); return; }
    if (this.screen === 'reader') { this.startCompose(); return; }
    if (this.screen === 'new-summary') { this.startCompose(this.creation); return; }
    if (this.screen === 'compose') { this.record(); return; }
    if (this.screen === 'draft') {
      await this.submitDraft();
      return;
    }
    if (this.screen === 'plan-review') { if (this.atReaderEnd) await state.submitPlan(state.selectedThreadId); else this.scroll = Math.min(this.pageCount - 1, this.scroll + 1); return; }
    const row = this.rows().find(row => row.id === this.selected) || this.rows()[0];
    if (row && !row.disabled) await row.action();
  }

  async hitTest(x: number, y: number): Promise<boolean> {
    this.motion = null; this.slide = null;
    const rows = this.rows();
    if (this.screen === 'dashboard') {
      const target = dashboardTargets(this.viewWidth, this.viewHeight).find(target => x >= target.x && x < target.x + target.width && y >= target.y && y < target.y + target.height);
      const row = rows.find(row => row.id === target?.id);
      if (!row) return false;
      this.selected = row.id; await row.action(); return true;
    }
    const contains = (rect: CardRect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
    if (this.screen === 'inbox') {
      if (!contains(this.dropdownRect())) return false;
      await this.handleInput({ type: 'click' } as InputEvent); return true;
    }
    if (!contains(this.fullRect())) return false;
    if (!rows.length || this.screen === 'choices') { await this.handleInput({ type: 'click' } as InputEvent); return true; }
    const offset = Math.floor((y - 42) / this.rowHeight);
    const visibleCount = Math.max(1, Math.floor(this.pageBox().height / this.rowHeight));
    const index = this.scroll + offset;
    if (offset < 0 || offset >= visibleCount || !rows[index] || rows[index].section) return false;
    this.selected = rows[index].id;
    if (!rows[index].disabled) await rows[index].action();
    return true;
  }

  menuItems() {
    if (this.screen === 'dashboard') return [{ label: 'Settings', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); this.settings(); } }];
    if (this.screen === 'proposed-plan') {
      const review = this.reviewedPlan;
      if (!review || state.busy || state.isPlanApprovalLocked(review.threadId, review.plan)) return [];
      return [
        { label: 'Approve and implement', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); state.error = ''; this.go('plan-approve'); } },
        { label: 'Request changes', onSelect: (ctx: LayerContext) => {
          ctx.stack.pop();
          if (state.selectedThreadId !== review.threadId || !this.canChangeSession()) return;
          this.startCompose(); this.draftMode = 'plan'; this.repaint();
        } },
      ];
    }
    if (['session-reasoning', 'session-model', 'plan-approve'].includes(this.screen)) return [];
    if (this.sessionDraft() && this.canChangeSession()) return [
      { label: 'Use plan mode', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); if (this.sessionDraft() && this.canChangeSession()) { this.draftMode = 'plan'; this.repaint(); } } },
      { label: 'Use normal mode', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); if (this.sessionDraft() && this.canChangeSession()) { this.draftMode = 'default'; this.repaint(); } } },
      ...(state.transcript?.session.modelSelection ? [
        { label: 'Change model', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); this.openModel(); } },
        { label: 'Change reasoning', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); this.openReasoning(); } },
      ] : []),
    ];
    if (this.screen === 'notification') {
      const alert = this.currentNotification();
      return alert ? [
        ...(alert.kind === 'phone' && alert.threadId?.startsWith('apk:') ? [{ label: 'Open conversation in app', onSelect: (ctx: LayerContext) => {
          ctx.stack.pop();
          if (this.currentNotification()?.id !== alert.id || !openT3NotificationApp(alert.id)) return;
          this.notificationReturnToSleep = false; this.notificationId = ''; this.notificationGroupId = ''; this.returnWindowId = null;
          this.go('inbox', false);
        } }] : []),
        { label: 'Dismiss notification', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); this.dismissSelectedNotification(); } },
      ] : [];
    }
    if (['compose', 'draft', 'phone-settings'].includes(this.screen)) return [];
    if (['question-text', 'choices', 'plan-review'].includes(this.screen)) return state.getPlan(state.selectedThreadId)?.locked ? [] : [
      { label: 'Next question', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); this.nextPlanQuestion(this.questionIndex + 1); } },
      { label: 'Previous question', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); this.nextPlanQuestion(this.questionIndex - 1); } },
      { label: 'Review answers', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); this.go('plan-review', false); } },
    ];
    if (this.screen === 'inbox') return visibleT3Alerts().length ? [{ label: 'Dismiss notification', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); this.dismissSelectedNotification(); } }] : [];
    const selectedSession = this.screen === 'sessions' ? state.sessions.find(session => resourceKey(session.id, session.environmentId) === this.selected) : this.screen === 'reader' ? state.transcript?.session : null;
    const canSettle = selectedSession && !['running', 'starting'].includes(selectedSession.status) && !state.plans.has(resourceKey(selectedSession.id, selectedSession.environmentId));
    return [
      ...(this.screen === 'reader' && state.transcript?.pendingProposedPlan ? [{ label: 'Review plan', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); this.openProposedPlan(); } }] : []),
      ...(this.screen === 'reader' && this.canChangeSession() && state.transcript?.session.modelSelection ? [
        { label: 'Change model', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); this.openModel(); } },
        { label: 'Change reasoning', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); this.openReasoning(); } },
      ] : []),
      { label: 'Display comparison', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); ctx.stack.push(new RenderingComparisonLayer()); } },
      { label: 'Ask assistant', onSelect: (ctx: LayerContext) => { ctx.stack.pop(); const homeScreen = this.screen; this.screen = 'dashboard'; const assistant = this.rows().find(row => row.id === 'assistant'); this.screen = homeScreen; void assistant?.action(); } },
      ...(canSettle ? [{ label: 'Settle session', onSelect: async (ctx: LayerContext) => { ctx.stack.pop(); await state.settle(selectedSession.id, selectedSession.environmentId); } }] : []),
    ];
  }

  claimsNotificationDismissGesture(): boolean { return this.isBaseVisible() && ['inbox', 'notification'].includes(this.screen); }

  private async dismissSelectedNotification(): Promise<void> {
    const visible = visibleT3Alerts();
    const index = visible.findIndex(alert => alert.id === this.selected);
    const alert = this.screen === 'notification' ? this.currentNotification() : visible[index < 0 ? 0 : index];
    if (!alert) {
      // A reply can remove its native notification before the reader is closed.
      if (this.screen === 'notification') this.closeNotificationReader();
      return;
    }
    const screen = this.screen, visit = this.history[this.history.length - 1], notificationId = this.notificationId;
    if (!await dismissT3Alert(alert)) return;
    if (this.screen !== screen || this.history[this.history.length - 1] !== visit || this.notificationId !== notificationId) return;
    if (this.screen === 'notification') this.closeNotificationReader();
    else {
      const remaining = visibleT3Alerts();
      this.selected = remaining[Math.max(0, Math.min(index, remaining.length - 1))]?.id || '';
      this.repaint();
    }
  }

  private closeNotificationReader(): void {
    const returnToSleep = this.notificationReturnToSleep;
    const returnToInbox = this.history[this.history.length - 1]?.screen === 'inbox';
    this.notificationNotice = '';
    this.notificationReturnToSleep = false;
    this.notificationId = '';
    this.notificationGroupId = '';
    // Blank before restoring any underlying app. Closing reply review alone
    // never sleeps; dismissal/back completes this notification wake-up visit.
    if (returnToSleep) shell.sleepAtAppRoot();
    if (this.returnWindowId) { const id = this.returnWindowId; this.returnWindowId = null; this.go('inbox', false); shell.focusWindow(id); }
    else { if (returnToSleep || !returnToInbox) shell.closeNotificationReader(); this.back(); }
  }

}

export function createT3AppWindow(options: InProcessAppOptions): InProcessWindow {
  initializeT3();
  let app: InProcessWindow;
  const repaint = () => {
    if (!app) return;
    app.setHeightMode('medium');
    app.requestRender();
  };
  const layer = new T3Layer(repaint, () => app?.stack.isAtBase() ?? false);
  activeLayer = layer;
  const unsubscribe = state.onChange(() => { layer.contentChanged(); repaint(); });
  const offWeather = weatherBridge.onStateChange(() => { layer.backdropChanged(); repaint(); });
  const offHostState = onHostState(change => layer.hostStateChanged(change));
  const offHostEvent = onHostEvent((type,data) => {
    if (type==='extensions' && (!Array.isArray(data.changedFeatures) || data.changedFeatures.some((feature:string)=>['ui.typography','ui.navigation','ui.window-layout','ui.notifications'].includes(feature)))) layer.onRemoved();
    if (['visibility', 'close', 'disconnected', 'destroyed', 'extension-surface', 'shared-style'].includes(type)) layer.onRemoved();
  });
  const clockTimer = setInterval(() => { if (layer.screen === 'dashboard' && shell.isWindowVisible(T3_WINDOW_ID)) repaint(); }, 15000);
  // The general host owns weather refresh and publishes scoped state changes.
  app = createInProcessWindow({
    appId: 't3', windowId: T3_WINDOW_ID, title: 'T3 Assistant', iconLetter: 'T3', icon: 'terminal', closeable: true, heightMode: 'medium',
    actions: options.actions, suppressSystemMenuFallback: true, claimsNotificationDismissGesture: () => layer.claimsNotificationDismissGesture(), baseLayer: layer, menuItems: () => layer.menuItems(), receiveTextInput: text => layer.receiveText(text),
    canPaint: options.canPaint, requestPaintPermission: options.requestPaintPermission,
    retainedSceneEligible: () => layer.screen === 'dashboard' && !layer.needsAnimation(),
    frameTransportHint: () => layer.frameTransportHint(),
    submitFrame: options.submitFrame, setSurfaceVisible: options.setSurfaceVisible, removeSurface: options.removeSurface, reconfigureSurface: options.reconfigureSurface,
    onClosed: () => { layer.onRemoved(); unsubscribe(); offWeather(); offHostState(); offHostEvent(); clearInterval(clockTimer); if (activeLayer === layer) activeLayer = null; options.onClosed(); },
  });
  if (getT3Config().enabled && !state.demo) void connectT3();
  return app;
}
