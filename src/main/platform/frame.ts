export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Coordinates are DIP after the platform bridge has converted the frame. */
export interface Frame {
  bounds: WindowBounds;
  appPath?: string;
}

export type HelperFrame = { visible: false } | ({ visible: true } & Frame);

/** Helpers are untrusted process boundaries; reject malformed or absurd frames. */
export function parseHelperFrame(line: string): HelperFrame | undefined {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== 'object') return undefined;
  const value = data as Record<string, unknown>;
  if (value.visible === false) return { visible: false };
  if (value.visible !== true || !value.bounds || typeof value.bounds !== 'object') {
    return undefined;
  }
  const bounds = value.bounds as Record<string, unknown>;
  for (const key of ['x', 'y', 'width', 'height']) {
    const number = bounds[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > 100_000) {
      return undefined;
    }
  }
  if ((bounds.width as number) <= 0 || (bounds.height as number) <= 0) return undefined;
  const appPath = value.appPath;
  if (
    appPath !== undefined &&
    (typeof appPath !== 'string' ||
      !appPath ||
      appPath.length > 32_768 ||
      /[\u0000-\u001f]/u.test(appPath))
  ) {
    return undefined;
  }
  return {
    visible: true,
    bounds: {
      x: bounds.x as number,
      y: bounds.y as number,
      width: bounds.width as number,
      height: bounds.height as number,
    },
    ...(typeof appPath === 'string' ? { appPath } : {}),
  };
}
