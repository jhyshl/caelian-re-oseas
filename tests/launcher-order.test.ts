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
  'card-square',
  'inventory',
  'guild',
];

const legacyLauncherOrder: PanelName[] = [
  'character',
  'affinity',
  'deck',
  'card-square',
  'inventory',
  'crafting',
  'guild',
  'mailbox',
  'market',
  'map',
  'worldbook',
  'battle',
  'achievements',
  'settings',
  'feedback',
  'surveys',
  'release-notes',
];

const launcherOrderWithGathering: PanelName[] = [
  ...legacyLauncherOrder.slice(0, 9),
  'gathering',
  ...legacyLauncherOrder.slice(9),
];

describe('Floating launcher order', () => {
  it('保留有效的玩家顺序并把新入口追加到末尾', () => {
    expect(
      normalizeLauncherOrder(
        ['deck', 'character', 'deck', 'removed', null],
        available,
      ),
    ).toEqual([
      'deck',
      'character',
      'affinity',
      'card-square',
      'inventory',
      'guild',
    ]);
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
      'card-square',
      'inventory',
    ]);
  });

  it('旧版十七项顺序载入后只在末尾追加一次采集入口', () => {
    const normalized = normalizeLauncherOrder(
      legacyLauncherOrder,
      launcherOrderWithGathering,
    );

    expect(normalized).toEqual([...legacyLauncherOrder, 'gathering']);
    expect(
      normalized.filter((panel) => panel === 'gathering'),
    ).toHaveLength(1);
  });
});
