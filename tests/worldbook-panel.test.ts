import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App as VueApp } from 'vue';
import WorldbookPanel from '@/modules/worldbook/App.vue';
import type { PanelContext } from '@/kernel/public-api';

let mountedApp: VueApp<Element> | undefined;

afterEach(() => {
  mountedApp?.unmount();
  mountedApp = undefined;
  document.body.replaceChildren();
});

describe('世界书快捷开关面板', () => {
  it('点击地区按钮把目标 enabled 值传给内核，并用宿主回读状态刷新文案', async () => {
    let enabled = false;
    const getRegionWorldbookStatus = vi.fn(async () => ({
      status: 'current' as const,
      regions: [
        {
          region: '伊拉亚城',
          total: 1,
          enabled: enabled ? 1 : 0,
          state: enabled ? ('on' as const) : ('off' as const),
        },
      ],
    }));
    const setRegionWorldbook = vi.fn(async (region: string, next: boolean) => {
      enabled = next;
      return {
        status: 'applied' as const,
        region,
        touched: 1,
        changed: 1,
      };
    });
    const context = {
      api: {
        getRegionWorldbookStatus,
        setRegionWorldbook,
        closePanel: vi.fn(),
      },
    } as unknown as PanelContext;
    const host = document.createElement('div');
    document.body.append(host);
    mountedApp = createApp(WorldbookPanel, { context });
    mountedApp.mount(host);

    await vi.waitFor(() => {
      expect(host.querySelector('.region-row')?.textContent).toContain(
        '一键开启',
      );
    });
    host.querySelector<HTMLButtonElement>('.region-row')?.click();
    await nextTick();

    await vi.waitFor(() => {
      expect(setRegionWorldbook).toHaveBeenCalledWith('伊拉亚城', true);
      expect(getRegionWorldbookStatus).toHaveBeenCalledTimes(2);
      expect(host.querySelector('.region-row')?.textContent).toContain(
        '一键关闭',
      );
      expect(host.textContent).toContain('伊拉亚城相关条目已全部开启');
    });
  });
});
