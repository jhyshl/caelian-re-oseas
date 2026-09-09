import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@/kernel/event-bus';
import { PanelRegistry } from '@/kernel/panel-registry';
import { PanelScope } from '@/kernel/panel-scope';
import type { PanelContext, PanelName } from '@/kernel/public-api';

const fixture = vi.hoisted(() => ({
  mounts: new Map<string, number>(),
  updates: new Map<string, number>(),
  mount: (panel: string, context: PanelContext) => {
    fixture.mounts.set(panel, (fixture.mounts.get(panel) ?? 0) + 1);
    const host = context.document.createElement('div');
    host.dataset.caelianPanel = panel;
    host.className = 'caelian-panel-host';
    host.innerHTML = '<section class="ca-frame"><input value="保留的界面草稿"></section>';
    context.document.body.append(host);
    const off = context.api.on('state.changed', () => {
      fixture.updates.set(panel, (fixture.updates.get(panel) ?? 0) + 1);
    });
    return () => { off(); host.remove(); };
  },
}));
vi.mock('@/modules/character/mount', () => ({ mount: (context: PanelContext) => fixture.mount('character', context) }));
vi.mock('@/modules/inventory/mount', () => ({ mount: (context: PanelContext) => fixture.mount('inventory', context) }));
vi.mock('@/modules/deck/mount', () => ({ mount: (context: PanelContext) => fixture.mount('deck', context) }));
vi.mock('@/modules/crafting/mount', () => ({ mount: (context: PanelContext) => fixture.mount('crafting', context) }));
vi.mock('@/modules/market/mount', () => ({ mount: (context: PanelContext) => fixture.mount('market', context) }));

const registries: PanelRegistry[] = [];
function setup() {
  const events = new EventBus();
  const registry = new PanelRegistry({
    document, api: { on: events.on.bind(events) } as PanelContext['api'],
  }, events);
  registries.push(registry);
  return { events, registry };
}
afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.closeAll()));
  fixture.mounts.clear();
  fixture.updates.clear();
});

describe('有限面板缓存', () => {
  it('恢复时不会被后续正文通知覆盖隐藏期间的头像变化', async () => {
    const events = new EventBus();
    const scope = new PanelScope({ document, api: { on: events.on.bind(events) } as PanelContext['api'] });
    const changed = vi.fn();
    scope.context.api.on('tavern.changed', changed);
    scope.suspend();
    await events.emit('tavern.changed', { event: 'PERSONA_CHANGED' });
    for (let index = 0; index < 10; index++) {
      await events.emit('tavern.changed', { event: 'GENERATION_ENDED' });
    }
    expect(changed).not.toHaveBeenCalled();
    await scope.resume();
    expect(changed.mock.calls).toEqual([
      [{ event: 'PERSONA_CHANGED' }], [{ event: 'GENERATION_ENDED' }],
    ]);
    scope.dispose();
  });

  it('切换存档取消尚未完成的挂载', async () => {
    const { registry } = setup();
    const opening = registry.open('character');
    await registry.resetPages();
    await opening;
    expect(document.querySelector('[data-caelian-panel="character"]')).toBeNull();
    await registry.open('character');
    expect(registry.list()).toEqual(['character']);
  });

  it('重开复用原界面，隐藏期间只保留最后一次数据通知', async () => {
    const { registry, events } = setup();
    await registry.navigate('character');
    const firstHost = document.querySelector<HTMLElement>('[data-caelian-panel="character"]')!;
    await registry.navigate('inventory');
    expect(firstHost.hidden).toBe(true);
    expect(registry.list()).toEqual(['inventory']);
    for (let index = 0; index < 30; index++) {
      await events.emit('state.changed', { command: { id: String(index), status: 'applied' } });
    }
    expect(fixture.updates.get('character')).toBeUndefined();
    await registry.navigate('character');
    expect(document.querySelector('[data-caelian-panel="character"]')).toBe(firstHost);
    expect(firstHost.hidden).toBe(false);
    expect(fixture.mounts.get('character')).toBe(1);
    expect(fixture.updates.get('character')).toBe(1);
  });

  it('最多保留三个隐藏界面，超出后淘汰最久未使用的界面', async () => {
    const { registry } = setup();
    for (const panel of ['character', 'inventory', 'deck', 'crafting', 'market'] as PanelName[]) {
      await registry.navigate(panel);
    }
    expect(document.querySelectorAll('[data-caelian-panel][hidden]')).toHaveLength(3);
    expect(document.querySelector('[data-caelian-panel="character"]')).toBeNull();
    await registry.navigate('character');
    expect(fixture.mounts.get('character')).toBe(2);
  });

  it('切换存档和关闭运行时清理全部旧实例与订阅', async () => {
    const { registry, events } = setup();
    await registry.navigate('character');
    await registry.navigate('inventory');
    await registry.resetPages();
    expect(document.querySelector('[data-caelian-panel]')).toBeNull();
    await events.emit('state.changed', { command: { id: 'new-profile', status: 'applied' } });
    expect(fixture.updates.size).toBe(0);
    await registry.open('character');
    expect(fixture.mounts.get('character')).toBe(2);
    await registry.closeAll();
    expect(document.querySelector('[data-caelian-panel]')).toBeNull();
  });
});
