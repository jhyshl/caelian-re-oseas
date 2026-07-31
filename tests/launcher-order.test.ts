import { describe, expect, it } from 'vitest';
import type { PanelName } from '@/kernel/public-api';
import {
  moveLauncherPanel,
  moveLauncherPanelBefore,
  normalizeLauncherOrder,
} from '@/modules/shell/launcher-order';

const available: PanelName[] = [
  'character',
  'affinity',
  'deck',
  'inventory',
  'guild',
];

describe('Floating launcher order', () => {
  it('保留有效的玩家顺序并把新入口追加到末尾', () => {
    expect(
      normalizeLauncherOrder(
        ['deck', 'character', 'deck', 'removed', null],
        available,
      ),
    ).toEqual(['deck', 'character', 'affinity', 'inventory', 'guild']);
  });

  it('支持逐格移动并阻止越界', () => {
    expect(moveLauncherPanel(available, 'deck', -1)).toEqual([
      'character',
      'deck',
      'affinity',
      'inventory',
      'guild',
    ]);
    expect(moveLauncherPanel(available, 'character', -1)).toEqual(available);
  });

  it('支持桌面拖动到另一个入口之前', () => {
    expect(moveLauncherPanelBefore(available, 'guild', 'affinity')).toEqual([
      'character',
      'guild',
      'affinity',
      'deck',
      'inventory',
    ]);
  });
});
