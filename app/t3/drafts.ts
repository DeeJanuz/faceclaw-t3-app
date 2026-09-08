import { Utils } from '@nativescript/core';
declare const com: any;
const store = () => com.faceclaw.app.FaceclawT3Secrets;
const context = () => Utils.android.getApplicationContext();
export function saveT3PlanDraft(key: string, value: unknown): void { store().writeDraft(context(), key, JSON.stringify(value)); }
export function loadT3PlanDraft<T = unknown>(key: string): T | null { const value = String(store().readDraft(context(), key)); return value ? JSON.parse(value) : null; }
export function deleteT3PlanDraft(key: string): void { store().writeDraft(context(), key, ''); }
