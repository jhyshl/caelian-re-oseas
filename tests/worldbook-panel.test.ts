import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App as VueApp } from 'vue';
import WorldbookPanel from '@/modules/worldbook/App.vue';
import type { PanelContext } from '@/kernel/public-api';

let mountedApp: VueApp<Element> | undefined;

function mountPanel(context: PanelContext, host: HTMLElement) {
  mountedApp = createApp(WorldbookPanel, { context });
  mountedApp.mount(host);
}

afterEach(() => {
  mountedApp?.unmount();
  mountedApp = undefined;
  document.body.replaceChildren();
});

describe('世界书快捷开关面板', () => {
  it('读取失败显示真实原因并在角色加载事件后自动恢复，卸载时退订', async () => {
    let listener: ((payload: { event: string }) => Promise<void>) | undefined;
    const dispose = vi.fn();
    const read = vi.fn().mockRejectedValueOnce(new Error('世界书仍在加载')).mockResolvedValue({ status: 'current', regions: [{ region: '伊拉亚城', total: 1, enabled: 0, state: 'off' }] });
    const context = { api: { getRegionWorldbookStatus: read, on: vi.fn((_event, callback) => { listener = callback; return dispose; }), closePanel: vi.fn() } } as unknown as PanelContext;
    const host = document.createElement('div');
    document.body.append(host);
    mountPanel(context, host);
    await vi.waitFor(() => expect(host.textContent).toContain('世界书仍在加载'));
    expect(host.textContent).not.toContain('未绑定');
    await listener!({ event: 'CHAT_LOADED' });
    await nextTick();
    expect(host.querySelector('.region-row')?.textContent).toContain('一键开启');
    expect(host.textContent).not.toContain('世界书仍在加载');
    mountedApp!.unmount();
    mountedApp = undefined;
    expect(dispose).toHaveBeenCalledOnce();
  });

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
    mountPanel(context, host);

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
