export type DockSide = 'left' | 'right' | null;

export interface LauncherPosition {
  x: number;
  y: number;
}

export interface LauncherFootprint {
  width: number;
  height: number;
}

export interface LauncherPlacement {
  position: LauncherPosition;
  dockSide: DockSide;
}

export interface ViewportRect {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
}

export const DESKTOP_LAUNCHER_SIZE = 58;
export const MOBILE_LAUNCHER_SIZE = 54;
export const JOURNEY_DESKTOP_LAUNCHER_SIZE = 98;
export const JOURNEY_MOBILE_LAUNCHER_WIDTH = 84;
export const JOURNEY_MOBILE_LAUNCHER_HEIGHT = 96;
export const LAUNCHER_MARGIN = 6;
export const DOCK_DISTANCE = 28;
export const DOCK_PEEK = 18;
export const JOURNEY_DOCK_PEEK = 42;

export function launcherSizeForViewport(width: number): number {
  return width < 640 ? MOBILE_LAUNCHER_SIZE : DESKTOP_LAUNCHER_SIZE;
}

export function launcherFootprintForViewport(
  width: number,
  journeyTheme = false,
): LauncherFootprint {
  if (journeyTheme) {
    return width < 760
      ? {
          width: JOURNEY_MOBILE_LAUNCHER_WIDTH,
          height: JOURNEY_MOBILE_LAUNCHER_HEIGHT,
        }
      : {
          width: JOURNEY_DESKTOP_LAUNCHER_SIZE,
          height: JOURNEY_DESKTOP_LAUNCHER_SIZE,
        };
  }

  const size = launcherSizeForViewport(width);
  return { width: size, height: size };
}

export function clampLauncherPosition(
  position: LauncherPosition,
  viewport: ViewportRect,
  size: number | LauncherFootprint,
  margin = LAUNCHER_MARGIN,
): LauncherPosition {
  const footprint = normalizeLauncherFootprint(size);
  const minX = viewport.offsetLeft + margin;
  const maxX = Math.max(
    minX,
    viewport.offsetLeft + viewport.width - footprint.width - margin,
  );
  const minY = viewport.offsetTop + margin;
  const maxY = Math.max(
    minY,
    viewport.offsetTop + viewport.height - footprint.height - margin,
  );

  return {
    x: clampFinite(position.x, minX, maxX),
    y: clampFinite(position.y, minY, maxY),
  };
}

export function resolveLauncherDrop(
  position: LauncherPosition,
  viewport: ViewportRect,
  size: number | LauncherFootprint,
  dockDistance = DOCK_DISTANCE,
): LauncherPlacement {
  const footprint = normalizeLauncherFootprint(size);
  const clamped = clampLauncherPosition(position, viewport, size);
  const leftX = viewport.offsetLeft + LAUNCHER_MARGIN;
  const rightX =
    viewport.offsetLeft + viewport.width - footprint.width - LAUNCHER_MARGIN;
  const leftGap = Math.abs(clamped.x - leftX);
  const rightGap = Math.abs(rightX - clamped.x);

  if (leftGap > dockDistance && rightGap > dockDistance) {
    return { position: clamped, dockSide: null };
  }

  const dockSide: Exclude<DockSide, null> =
    leftGap <= rightGap ? 'left' : 'right';
  return {
    position: {
      x: dockSide === 'left' ? leftX : rightX,
      y: clamped.y,
    },
    dockSide,
  };
}

export function retractLauncherPosition(
  position: LauncherPosition,
  viewport: ViewportRect,
  size: number | LauncherFootprint,
  dockSide: Exclude<DockSide, null>,
  peek = DOCK_PEEK,
): LauncherPosition {
  const footprint = normalizeLauncherFootprint(size);
  const clamped = clampLauncherPosition(position, viewport, size);
  return {
    x:
      dockSide === 'left'
        ? viewport.offsetLeft - footprint.width + peek
        : viewport.offsetLeft + viewport.width - peek,
    y: clamped.y,
  };
}

function normalizeLauncherFootprint(
  size: number | LauncherFootprint,
): LauncherFootprint {
  return typeof size === 'number'
    ? { width: size, height: size }
    : size;
}

function clampFinite(value: number, min: number, max: number): number {
  const finiteValue = Number.isFinite(value) ? value : min;
  return Math.max(min, Math.min(max, finiteValue));
}
