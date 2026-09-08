import { getDefaultSmallFont } from "../../graphics/ui-fonts";
import { truncateText } from "../../graphics/textwrap";
import { GrayImage } from "../../graphics/image";
import { type Plane } from "../../graphics/plane";
import { renderIcon, type IconName } from "../../graphics/icons";
import { clamp } from "../../util/numeric-util";
import { InputEvent } from "../../ui/gestures";
import { Layer, LayerActions, LayerContext } from "../../ui/layers";
import { drawSelectionHighlight, MenuLayer, scrollToKeepSelectionVisible, type MenuItem } from "../../ui/menu";
import { WINDOW_MENU_LAYOUT } from "../../ui/window-menu";


import {
  getFolderAssignments,
  getFolders,
  getFolderStateFingerprint,
  setAppFolder,
  unusedNewFolderName,
} from "./launcher-folders";
import { shell } from "../../ui/shell/shell";

export type LauncherAppEntry = {
  appId: string;
  label: string;
  icon: IconName;
  uninstallable?: boolean;
  /** Dynamic artwork for installed apps; icon remains the fallback. */
  renderIcon?: (size: number) => GrayImage | null;
  iconKey?: string;
};

export type LauncherOptions = {
  actions: LayerActions;
  apps: () => LauncherAppEntry[];
  launchApp: (appId: string) => Promise<void> | void;
  uninstallApp: (appId: string) => Promise<void> | void;
  /** Submit a painted viewport-sized frame (as planes) to this window's surface. */
  submitFrame: (planes: Plane[], paintMs: number, frameId: number) => Promise<void>;
  /** Flip the launcher's compositor surface visibility on foreground changes. */
  setSurfaceVisible: (visible: boolean) => void;
};

export const LAUNCHER_WINDOW_ID = "launcher";
export const LAUNCHER_SURFACE_ID = "window:launcher";

const LIST_TOP = 6;
const ICON_SIZE = 24;

type LauncherEntry =
  | { kind: "app"; label: string; icon: IconName; appId: string; renderIcon?: (size: number) => GrayImage | null }
  | { kind: "folder"; label: string; name: string };

/** A single vertical list, with the same selection model for every input device. */
export class LauncherListLayer implements Layer {
  private selectedIndex = 0;
  private scrollRow = 0;
  private currentFolder: string | null = null;

  constructor(private readonly options: LauncherOptions) {}

  /**
   * The entries to show, computed fresh from the folder state. Self-heals
   * currentFolder: if the open folder no longer exists (the assistant
   * disbanded it), the view falls back to the top list.
   */
  private entries(): LauncherEntry[] {
    const apps = this.options.apps();
    const byAppId = new Map(apps.map((app) => [app.appId, app]));
    if (this.currentFolder !== null) {
      const members = (getFolders().get(this.currentFolder) ?? [])
        .map((appId) => byAppId.get(appId))
        .filter(Boolean) as LauncherAppEntry[];
      if (members.length > 0) {
        return members
          .map((app): LauncherEntry => ({
            kind: "app",
            label: app.label,
            icon: app.icon,
            appId: app.appId,
            renderIcon: app.renderIcon,
          }))
          .sort((a, b) => a.label.localeCompare(b.label));
      }
      this.currentFolder = null;
    }
    const assignments = getFolderAssignments();
    const entries: LauncherEntry[] = [];
    // A folder entry appears only when it holds at least one known app; stale
    // assignments to removed apps are ignored.
    for (const [name, members] of getFolders()) {
      if (members.some((appId) => byAppId.has(appId))) {
        entries.push({ kind: "folder", label: name, name });
      }
    }
    for (const app of apps) {
      if (!assignments[app.appId]) {
        entries.push({
          kind: "app",
          label: app.label,
          icon: app.icon,
          appId: app.appId,
          renderIcon: app.renderIcon,
        });
      }
    }
    return entries.sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Leave a folder and restore selection to its list entry. */
  private exitFolder(): void {
    const folder = this.currentFolder;
    this.currentFolder = null;
    this.selectedIndex = Math.max(0, this.entries().findIndex(entry => entry.kind === "folder" && entry.name === folder));
    this.scrollRow = 0;
  }

  menuItems(): MenuItem[] {
    const entry = this.entries()[this.selectedIndex];
    if (!entry || entry.kind !== "app") return [];
    return [
      {
        label: "Move to folder",
        onSelect: (ctx) => {
          ctx.stack.pop();
          ctx.stack.push(
            new MenuLayer("Move to folder", this.moveToFolderItems(entry.appId), WINDOW_MENU_LAYOUT),
          );
        },
      },
      ...(this.options.apps().find((app) => app.appId === entry.appId)?.uninstallable
        ? [{
            label: "Uninstall",
            onSelect: (ctx: LayerContext) => {
              ctx.stack.pop();
              ctx.stack.push(
                new MenuLayer(
                  "Uninstall app?",
                  [
                    {
                      label: "Confirm uninstall",
                      onSelect: async (confirmCtx) => {
                        confirmCtx.stack.pop();
                        setAppFolder(entry.appId, null);
                        await this.options.uninstallApp(entry.appId);
                        this.selectedIndex = 0;
                      },
                    },
                    { label: "Cancel", onSelect: (confirmCtx) => confirmCtx.stack.pop() },
                  ],
                  WINDOW_MENU_LAYOUT,
                ),
              );
            },
          } satisfies MenuItem]
        : []),
    ];
  }

  /**
   * The folder-picker submenu: every existing folder except the app's own,
   * plus a generated-name "New folder" (ring input has no text entry) and,
   * when the app is in a folder, an escape back to the top level.
   */
  private moveToFolderItems(appId: string): MenuItem[] {
    const currentFolder = getFolderAssignments()[appId] ?? null;
    const items: MenuItem[] = [];
    for (const name of getFolders().keys()) {
      if (name === currentFolder) continue;
      items.push({
        label: name,
        onSelect: (ctx) => {
          setAppFolder(appId, name);
          ctx.stack.pop();
        },
      });
    }
    items.push({
      label: "New folder",
      onSelect: (ctx) => {
        setAppFolder(appId, unusedNewFolderName());
        ctx.stack.pop();
      },
    });
    if (currentFolder !== null) {
      items.push({
        label: "Remove from folder",
        onSelect: (ctx) => {
          setAppFolder(appId, null);
          ctx.stack.pop();
        },
      });
    }
    return items;
  }

  private layout(ctx: LayerContext) {
    const font = getDefaultSmallFont();
    const { width, height } = ctx.stack.getBaseSize();
    const top = LIST_TOP + font.lineHeight + 8;
    const rowHeight = Math.max(ICON_SIZE + 12, font.lineHeight + 16);
    const bottom = height - font.lineHeight - 12;
    return { font, width, height, top, rowHeight, count: Math.max(1, Math.floor((bottom - top) / rowHeight)) };
  }

  paint(ctx: LayerContext): GrayImage {
    const entries = this.entries();
    const { font, width, height, top, rowHeight, count } = this.layout(ctx);
    const image = new GrayImage(width, height, 0);
    this.selectedIndex = clamp(this.selectedIndex, 0, Math.max(0, entries.length - 1));
    this.scrollRow = scrollToKeepSelectionVisible(this.scrollRow, this.selectedIndex, count, entries.length);
    image.drawText(font, 12, LIST_TOP, truncateText(font, this.currentFolder ?? "Apps", width - 24), 220);
    for (let offset = 0; offset < count; offset++) {
      const index = this.scrollRow + offset;
      const entry = entries[index];
      if (!entry) break;
      const y = top + offset * rowHeight;
      if (index === this.selectedIndex) drawSelectionHighlight(image, 4, y + 1, width - 14, rowHeight - 3, ctx.stack.isFocused(), 6);
      const icon = entry.kind === "app" ? entry.renderIcon?.(ICON_SIZE) ?? renderIcon(entry.icon, ICON_SIZE) : renderIcon("folder-filled", ICON_SIZE);
      if (icon) image.drawImage(icon, 14 + Math.round((ICON_SIZE - icon.width) / 2), y + Math.round((rowHeight - icon.height) / 2));
      image.drawText(font, 50, y + Math.round((rowHeight - font.lineHeight) / 2), truncateText(font, entry.label, width - 80), 230);
      if (entry.kind === "folder") image.drawText(font, width - 26, y + Math.round((rowHeight - font.lineHeight) / 2), ">", 140);
    }
    if (!entries.length) image.drawText(font, 14, top + 10, "No apps", 140);
    if (entries.length > count) {
      const track = count * rowHeight;
      const thumb = Math.max(12, Math.round(track * count / entries.length));
      image.fillRect(width - 5, top, 2, track, 35);
      image.fillRect(width - 5, top + Math.round((track - thumb) * this.scrollRow / (entries.length - count)), 2, thumb, 160);
    }
    image.drawText(font, 12, height - font.lineHeight - 5, truncateText(font, "▲▼ choose   ● open   ●● back", width - 24), 125);
    return image;
  }

  async handleInput(event: InputEvent, _ctx: LayerContext): Promise<void> {
    const entries = this.entries();
    this.selectedIndex = clamp(this.selectedIndex, 0, Math.max(0, entries.length - 1));
    switch (event.type) {
      case "scroll-up":
      case "swipe-up":
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        return;
      case "scroll-down":
      case "swipe-down":
        this.selectedIndex = Math.min(Math.max(0, entries.length - 1), this.selectedIndex + 1);
        return;
      case "click":
        await this.openSelected(entries);
        return;
      case "double-click":
        if (this.currentFolder !== null) this.exitFolder();
        else shell.sleepAtAppRoot();
        return;
    }
  }

  async hitTest(x: number, y: number, ctx: LayerContext): Promise<boolean> {
    const entries = this.entries();
    const { width, top, rowHeight, count } = this.layout(ctx);
    if (x < 0 || x >= width || y < top || y >= top + count * rowHeight) return false;
    const index = this.scrollRow + Math.floor((y - top) / rowHeight);
    if (!entries[index]) return false;
    this.selectedIndex = index;
    await this.openSelected(entries);
    return true;
  }

  private async openSelected(entries: readonly LauncherEntry[]): Promise<void> {
    const entry = entries[this.selectedIndex];
    if (!entry) return;
    if (entry.kind === "folder") {
      this.currentFolder = entry.name;
      this.selectedIndex = 0;
      this.scrollRow = 0;
    } else {
      await this.options.launchApp(entry.appId);
    }
  }
}

