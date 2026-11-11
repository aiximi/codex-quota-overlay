import type { WindowBounds } from './frame.js';

interface OverlayWindow {
  isVisible(): boolean;
  hide(): void;
  showInactive(): void;
  setBounds(bounds: WindowBounds): void;
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
  private missingSince: number | undefined;
  private lastRecreate = -Infinity;

  constructor(private readonly macOS: boolean) {}

  update(
    window: OverlayWindow,
    eligible: boolean,
    nativeVisible?: boolean,
    now = Date.now(),
    desiredBounds?: WindowBounds,
    recreate?: () => void,
  ): void {
    if (!eligible) {
      // Do not trust isVisible() when hiding either: native and framework state
      // can disagree after changing Spaces, locking or sleeping.
      window.hide();
      this.eligible = false;
      this.lastShow = -Infinity;
      this.missingSince = undefined;
      return;
    }
    const returning = !this.eligible;
    this.eligible = true;
    if (nativeVisible === true) {
      this.missingSince = undefined;
    } else if (this.macOS && nativeVisible === false) {
      // Only fresh native observations can establish persistent failure. UI
      // renders without a native observation must never recreate a window.
      this.missingSince ??= now;
      if (recreate && now - this.missingSince >= 5_000 && now - this.lastRecreate >= 30_000) {
        // Set these before the callback: restarting tracking can synchronously
        // clear eligibility. Its reset must not bypass the recreation cooldown.
        this.lastRecreate = now;
        this.missingSince = undefined;
        recreate();
        return;
      }
    }
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
      // Electron may still return the requested bounds while WindowServer has
      // placed the surface elsewhere. Reapply placement even when cached
      // getBounds() equals the intended rectangle.
      if (desiredBounds) window.setBounds(desiredBounds);
    }
    window.showInactive();
  }
}
