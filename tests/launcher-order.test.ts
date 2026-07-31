import { describe, expect, it } from 'vitest';
import type { PanelName } from '@/kernel/public-api';
import {
  normalizeLauncherOrder,
  prioritizeLauncherPanels,
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

  it('按玩家依次点击的编号优先排序，其余入口保持原顺序', () => {
    expect(
      prioritizeLauncherPanels(available, [
        'guild',
        'deck',
        'guild',
        'diagnostics',
      ]),
    ).toEqual([
      'guild',
      'deck',
      'character',
      'affinity',
      'inventory',
    ]);
  });
});
