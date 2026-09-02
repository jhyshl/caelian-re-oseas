import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App as VueApp } from 'vue';
import type { GameSnapshot } from '@/domain/types';
import type { PanelContext } from '@/kernel/public-api';
import InventoryApp from '@/modules/inventory/App.vue';

let mountedApp: VueApp<Element> | undefined;

afterEach(() => {
  mountedApp?.unmount();
  mountedApp = undefined;
  document.body.replaceChildren();
});

describe('背包藏品点击入口', () => {
  it('点击藏品卡片打开详情，且不会误触携带命令', async () => {
    const snapshot = {
      world: { location: '伊拉亚城-集市' },
      player: { hp: 80, hpMax: 80, mp: 30, mpMax: 30 },
      inventory: [],
      equipment: [],
      loadout: { weaponId: null, armorId: null, accessoryId: null },
      relics: [
        {
          id: 'profile:r_wolf_fang',
          profileId: 'profile',
          relicId: 'r_wolf_fang',
          carried: false,
          acquiredAt: 1,
          updatedAt: 1,
        },
      ],
      specialCollectibles: [
        {
          id: 'profile:special_mysterious_bug',
          profileId: 'profile',
          collectibleId: 'special_mysterious_bug',
          name: '神秘虫子',
          summary: 'X﹏X被抓到了',
          source: '特殊补丁：抓虫中……',
          acquiredDate: '2026-09-02',
          updatedAt: 1,
        },
      ],
    } as unknown as GameSnapshot;
    const execute = vi.fn();
    const context = {
      document,
      api: {
        query: vi.fn(async () => snapshot),
        execute,
        on: vi.fn(() => () => undefined),
        getThemeState: vi.fn(() => ({ active: 'default' })),
        closePanel: vi.fn(),
        navigatePanel: vi.fn(),
      },
    } as unknown as PanelContext;
    const panelHost = document.createElement('div');
    panelHost.dataset.caelianPanel = 'inventory';
    panelHost.className = 'caelian-panel-host';
    const root = document.createElement('div');
    panelHost.append(root);
    document.body.append(panelHost);
    mountedApp = createApp(InventoryApp, { context });
    mountedApp.mount(root);

    await vi.waitFor(() => {
      expect(panelHost.querySelector('.inventory-tabs')).not.toBeNull();
    });
    const relicTab = [
      ...panelHost.querySelectorAll<HTMLButtonElement>(
        '.inventory-tabs button',
      ),
    ].find((button) => button.textContent?.includes('藏品'));
    relicTab?.click();
    await nextTick();

    panelHost.querySelector<HTMLButtonElement>('.collectible-summary')?.click();
    await nextTick();

    expect(panelHost.querySelector('[role="dialog"]')?.textContent).toContain(
      '神秘虫子',
    );
    expect(
      panelHost.querySelector('[data-collectible-effect-text]')?.textContent,
    ).toContain('不进入可携带藏品背包');
    expect(execute).not.toHaveBeenCalled();
  });
});
