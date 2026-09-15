import { GrayImage } from "../graphics/image";
import { singlePlane, type Plane } from "../graphics/plane";
import { type InputEvent } from "./gestures";
import { type Layer, LayerStack, noopLayerActions } from "./layers";
import { CONTEXT_MENU_DIM, MenuLayer, type MenuItem, type MenuLayout } from "./menu";


/** App actions open on a single hold. Display off and System actions wrap
 * each app's contextual entries; tap then hold remains the shell switcher. */

/** Centered over the viewport; visually matches the shell's system menu position. */
export const WINDOW_MENU_LAYOUT: MenuLayout = {
  x: "center",
  y: 8,
  width: 272,
  minHeight: 150,
  dimUnderneath: CONTEXT_MENU_DIM,
};

/** Shared ordering for app menus in both native and worker windows. */
export function appActionItems(items: MenuItem[], displayOff: () => void, systemActions: () => void): MenuItem[] {
  return [
    { label: 'Display off', onSelect: ctx => { ctx.stack.pop(); displayOff(); } },
    ...items,
    { label: 'System actions', onSelect: ctx => { ctx.stack.pop(); systemActions(); } },
  ];
}

export class WindowMenuLayer extends MenuLayer {
  constructor(title: string | null, items: MenuItem[]) {
    super(title, items, WINDOW_MENU_LAYOUT);
    // The shared policy may put Display off first. Opening a menu must not
    // leave power as the armed default when a release or synthesized click
    // follows the hold; users can still scroll back to select it deliberately.
    const safeIndex = items.findIndex(item => item.label !== 'Display off' && item.disabled !== true);
    if (safeIndex >= 0) this.selectItem(safeIndex);
  }
}
