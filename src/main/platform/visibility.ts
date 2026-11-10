interface OverlayWindow {
  isVisible(): boolean;
  hide(): void;
  showInactive(): void;
  setVisibleOnAllWorkspaces(
    visible: boolean,
    options: { visibleOnFullScreen: boolean; skipTransformProcessType: boolean },
  ): void;
}

/** Electron's media source ID contains the macOS CGWindowID, not its NSView pointer. */
export function overlayWindowId(sourceId: string): number | undefined {
  const match = /^window:(\d+):\d+$/u.exec(sourceId);
  const id = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(id) && id > 0 && id <= 0xffff_ffff ? id : undefined;
}

/** Reconcile intended visibility with the actual macOS window-server observation. */
export class OverlayVisibility {
  private eligible = false;
  private lastShow = -Infinity;

  constructor(private readonly macOS: boolean) {}

  update(
    window: OverlayWindow,
    eligible: boolean,
    nativeVisible?: boolean,
    now = Date.now(),
  ): void {
    if (!eligible) {
      // Do not trust isVisible() when hiding either: native and framework state
      // can disagree after changing Spaces, locking or sleeping.
      window.hide();
      this.eligible = false;
      this.lastShow = -Infinity;
      return;
    }
    const returning = !this.eligible;
    this.eligible = true;
    if (nativeVisible ?? window.isVisible()) return;
    if (!returning && now - this.lastShow < 1_000) return;
    this.lastShow = now;
    if (this.macOS) {
      // Force a new order-in when Electron still considers an off-Space panel
      // visible. The app already runs as an accessory; avoid changing its type.
      window.hide();
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    }
    window.showInactive();
  }
}
