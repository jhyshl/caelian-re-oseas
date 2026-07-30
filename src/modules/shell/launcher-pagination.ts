export const LAUNCHER_PAGE_SIZE = 6;

export function paginateLauncherItems<T>(
  items: readonly T[],
  pageSize = LAUNCHER_PAGE_SIZE,
): T[][] {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error('悬浮窗分页容量必须是正整数');
  }
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += pageSize) {
    pages.push(items.slice(index, index + pageSize));
  }
  return pages.length > 0 ? pages : [[]];
}

export function horizontalSwipeDirection(
  deltaX: number,
  deltaY: number,
  threshold = 38,
): -1 | 0 | 1 {
  if (
    Math.abs(deltaX) < threshold ||
    Math.abs(deltaX) <= Math.abs(deltaY)
  ) {
    return 0;
  }
  return deltaX < 0 ? 1 : -1;
}
