import type { AppDefinition } from '../app-definition';
import { createT3AppWindow, T3_SURFACE_ID, T3_WINDOW_ID } from './t3-app';
import { initializeT3 } from './runtime';

const t3App: AppDefinition = {
  appId: 't3', title: 'T3 Assistant', icon: 'terminal',
  boot: () => initializeT3(),
  launch: ctx => ctx.launchInProcessApp(T3_WINDOW_ID, T3_SURFACE_ID, createT3AppWindow),
};
export default t3App;
