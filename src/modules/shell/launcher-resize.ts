export const LAUNCHER_MENU_SCALE_STORAGE_KEY =
  'caelian_launcher_menu_scale_v1';
export const MIN_LAUNCHER_MENU_SCALE = 0.65;
export const MAX_LAUNCHER_MENU_SCALE = 1.5;

export type LauncherHorizontalResizeHandle = 'left' | 'right';
export type LauncherVerticalResizeHandle = 'top' | 'bottom';
export type LauncherCornerResizeHandle =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';
export type LauncherResizeHandle =
  | LauncherHorizontalResizeHandle
  | LauncherVerticalResizeHandle
  | LauncherCornerResizeHandle;

export interface LauncherMenuGrowth {
  horizontal: LauncherHorizontalResizeHandle;
  vertical: LauncherVerticalResizeHandle;
}

export interface LauncherResizePoint {
  x: number;
  y: number;
}

export interface LauncherResizeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LauncherResizeViewportRect {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
}

export interface LauncherScaleFromPointerOptions {
  handle: LauncherResizeHandle;
  anchor: LauncherResizePoint;
  startPointer: LauncherResizePoint;
  currentPointer: LauncherResizePoint;
  startScale: number;
  minScale?: number;
  maxScale?: number;
}

/**
 * Restores a persisted launcher-menu scale while rejecting non-numeric values.
 */
export function normalizeLauncherMenuScale(
  value: unknown,
  fallback = 1,
): number {
  const normalizedFallback = clamp(
    parseFiniteScale(fallback) ?? 1,
    MIN_LAUNCHER_MENU_SCALE,
    MAX_LAUNCHER_MENU_SCALE,
  );
  const parsed = parseFiniteScale(value);
  if (parsed === undefined) return normalizedFallback;
  return clamp(
    parsed,
    MIN_LAUNCHER_MENU_SCALE,
    MAX_LAUNCHER_MENU_SCALE,
  );
}

/**
 * Returns the two free edges and the free outer corner for the menu direction.
 * The opposite corner stays anchored beside the launcher while resizing.
 */
export function launcherResizeHandlesForGrowth(
  growth: LauncherMenuGrowth,
): readonly [
  LauncherHorizontalResizeHandle,
  LauncherVerticalResizeHandle,
  LauncherCornerResizeHandle,
] {
  const horizontal = growth.horizontal;
  const vertical = growth.vertical;
  return [horizontal, vertical, `${vertical}-${horizontal}`];
}

/**
 * Resolves a pointer on the menu's free outer border to a proportional resize
 * handle. The inner launcher-side edges stay available to the menu controls.
 */
export function launcherResizeHandleAtPoint(
  rect: LauncherResizeRect,
  point: LauncherResizePoint,
  growth: LauncherMenuGrowth,
  threshold: number,
): LauncherResizeHandle | null {
  if (!pointsAreFinite(point)) return null;
  const left = finiteOr(rect.left, 0);
  const top = finiteOr(rect.top, 0);
  const width = nonNegativeFiniteOr(rect.width, 0);
  const height = nonNegativeFiniteOr(rect.height, 0);
  const right = left + width;
  const bottom = top + height;
  const edgeThreshold = Math.max(0, finiteOr(threshold, 0));
  if (
    width === 0 ||
    height === 0 ||
    point.x < left ||
    point.x > right ||
    point.y < top ||
    point.y > bottom
  ) {
    return null;
  }

  const horizontalDistance =
    growth.horizontal === 'left'
      ? point.x - left
      : right - point.x;
  const verticalDistance =
    growth.vertical === 'top' ? point.y - top : bottom - point.y;
  const onHorizontalEdge = horizontalDistance <= edgeThreshold;
  const onVerticalEdge = verticalDistance <= edgeThreshold;

  if (onHorizontalEdge && onVerticalEdge) {
    return `${growth.vertical}-${growth.horizontal}`;
  }
  if (onHorizontalEdge) return growth.horizontal;
  if (onVerticalEdge) return growth.vertical;
  return null;
}

/** Returns the fixed point opposite a resize handle. */
export function launcherResizeAnchor(
  rect: LauncherResizeRect,
  handle: LauncherResizeHandle,
): LauncherResizePoint {
  const left = finiteOr(rect.left, 0);
  const top = finiteOr(rect.top, 0);
  const width = nonNegativeFiniteOr(rect.width, 0);
  const height = nonNegativeFiniteOr(rect.height, 0);
  const right = left + width;
  const bottom = top + height;
  const centerX = left + width / 2;
  const centerY = top + height / 2;

  switch (handle) {
    case 'left':
      return { x: right, y: centerY };
    case 'right':
      return { x: left, y: centerY };
    case 'top':
      return { x: centerX, y: bottom };
    case 'bottom':
      return { x: centerX, y: top };
    case 'top-left':
      return { x: right, y: bottom };
    case 'top-right':
      return { x: left, y: bottom };
    case 'bottom-left':
      return { x: right, y: top };
    case 'bottom-right':
      return { x: left, y: top };
  }
}

/**
 * Converts a pointer drag into one uniform scale. Corner drags are projected
 * onto the start diagonal so off-axis movement cannot distort the aspect ratio.
 */
export function launcherScaleFromPointer({
  handle,
  anchor,
  startPointer,
  currentPointer,
  startScale,
  minScale = MIN_LAUNCHER_MENU_SCALE,
  maxScale = MAX_LAUNCHER_MENU_SCALE,
}: LauncherScaleFromPointerOptions): number {
  const lowerBound = normalizeLauncherMenuScale(
    minScale,
    MIN_LAUNCHER_MENU_SCALE,
  );
  const upperBound = Math.max(
    lowerBound,
    normalizeLauncherMenuScale(maxScale, MAX_LAUNCHER_MENU_SCALE),
  );
  const normalizedStartScale = clamp(
    normalizeLauncherMenuScale(startScale),
    lowerBound,
    upperBound,
  );

  if (!pointsAreFinite(anchor, startPointer, currentPointer)) {
    return normalizedStartScale;
  }

  const ratio = pointerScaleRatio(
    handle,
    anchor,
    startPointer,
    currentPointer,
  );
  if (!Number.isFinite(ratio)) return normalizedStartScale;

  return clamp(
    normalizedStartScale * ratio,
    lowerBound,
    upperBound,
  );
}

/**
 * Finds the largest absolute scale that keeps a currently rendered menu inside
 * the visual viewport while preserving its launcher-side anchor.
 */
export function maxLauncherMenuScaleForViewport(
  rect: LauncherResizeRect,
  currentScale: number,
  viewport: LauncherResizeViewportRect,
  growth: LauncherMenuGrowth,
): number {
  const scale = normalizeLauncherMenuScale(currentScale);
  const width = nonNegativeFiniteOr(rect.width, 0);
  const height = nonNegativeFiniteOr(rect.height, 0);
  if (width === 0 || height === 0) return MAX_LAUNCHER_MENU_SCALE;

  const left = finiteOr(rect.left, 0);
  const top = finiteOr(rect.top, 0);
  const right = left + width;
  const bottom = top + height;
  const viewportLeft = finiteOr(viewport.offsetLeft, 0);
  const viewportTop = finiteOr(viewport.offsetTop, 0);
  const viewportWidth = nonNegativeFiniteOr(viewport.width, 0);
  const viewportHeight = nonNegativeFiniteOr(viewport.height, 0);
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;

  const availableWidth =
    growth.horizontal === 'right'
      ? viewportRight - left
      : right - viewportLeft;
  const availableHeight =
    growth.vertical === 'bottom'
      ? viewportBottom - top
      : bottom - viewportTop;
  const unscaledWidth = width / scale;
  const unscaledHeight = height / scale;
  const widthLimit = Math.max(0, availableWidth) / unscaledWidth;
  const heightLimit = Math.max(0, availableHeight) / unscaledHeight;

  return clamp(
    Math.min(widthLimit, heightLimit),
    MIN_LAUNCHER_MENU_SCALE,
    MAX_LAUNCHER_MENU_SCALE,
  );
}

function pointerScaleRatio(
  handle: LauncherResizeHandle,
  anchor: LauncherResizePoint,
  startPointer: LauncherResizePoint,
  currentPointer: LauncherResizePoint,
): number {
  if (handle === 'left' || handle === 'right') {
    const startDistance = startPointer.x - anchor.x;
    if (Math.abs(startDistance) < Number.EPSILON) return Number.NaN;
    return (currentPointer.x - anchor.x) / startDistance;
  }

  if (handle === 'top' || handle === 'bottom') {
    const startDistance = startPointer.y - anchor.y;
    if (Math.abs(startDistance) < Number.EPSILON) return Number.NaN;
    return (currentPointer.y - anchor.y) / startDistance;
  }

  const startX = startPointer.x - anchor.x;
  const startY = startPointer.y - anchor.y;
  const startLengthSquared = startX * startX + startY * startY;
  if (startLengthSquared < Number.EPSILON) return Number.NaN;
  const currentX = currentPointer.x - anchor.x;
  const currentY = currentPointer.y - anchor.y;
  return (currentX * startX + currentY * startY) / startLengthSquared;
}

function pointsAreFinite(...points: LauncherResizePoint[]): boolean {
  return points.every(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
}

function parseFiniteScale(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function nonNegativeFiniteOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
