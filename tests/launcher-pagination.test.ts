import { describe, expect, it } from 'vitest';
import {
  horizontalSwipeDirection,
  launcherPageDirection,
  paginateLauncherItems,
} from '@/modules/shell/launcher-pagination';

describe('Floating launcher pagination', () => {
  it('每页最多两行三列共六个入口', () => {
    const pages = paginateLauncherItems(
      Array.from({ length: 13 }, (_, index) => index + 1),
    );
    expect(pages).toEqual([
      [1, 2, 3, 4, 5, 6],
      [7, 8, 9, 10, 11, 12],
      [13],
    ]);
  });

  it('只把明显的横向手势识别为翻页', () => {
    expect(horizontalSwipeDirection(-80, 8)).toBe(1);
    expect(horizontalSwipeDirection(80, 8)).toBe(-1);
    expect(horizontalSwipeDirection(22, 2)).toBe(0);
    expect(horizontalSwipeDirection(80, 100)).toBe(0);
  });

  it('根据目标页选择最短的滑动方向', () => {
    expect(launcherPageDirection(0, 1, 3)).toBe(1);
    expect(launcherPageDirection(1, 0, 3)).toBe(-1);
    expect(launcherPageDirection(2, 0, 3)).toBe(1);
  });
});
