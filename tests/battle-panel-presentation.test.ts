import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import BattleApp from '@/modules/battle/App.vue';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import { EventBus } from '@/kernel/event-bus';
import type { PanelContext } from '@/kernel/public-api';

vi.mock('@/modules/battle/card-face', async importOriginal => ({
  ...await importOriginal<typeof import('@/modules/battle/card-face')>(),
  loadBattleCardFaceUrls: async () => ({}),
}));

let app: App | undefined;
let db: CaelianDatabase | undefined;
afterEach(async () => {
  app?.unmount(); app = undefined;
  document.body.replaceChildren();
  if (db) { db.close(); await db.delete(); db = undefined; }
});

describe('战斗技能查看入口', () => {
  it('隐藏意图和预告日志，双击查看全部技能；携带洞察藏品后显示意图', async () => {
    db = new CaelianDatabase('alpha', 'battle-ui-' + crypto.randomUUID());
    const game = new GameRepository(db, new EventBus(), { random: () => 0 });
    const profile = await game.ensureProfile('ui-' + crypto.randomUUID());
    await game.execute(profile.id, { id: 'create', type: 'player.create', payload: { name: '显示验证', classMain: 'knight', subclass: 'holy_knight' } });
    await game.execute(profile.id, { id: 'start', type: 'battle.start', payload: { monsterId: 'mon_slime', source: '显示验证' } });
    const snapshot = await game.snapshot(profile.id);
    expect(snapshot.battle?.state.enemies.length).toBeGreaterThan(0);
    snapshot.battle!.state.enemies[0]!.critRate = 100 / 6;
    snapshot.battle!.state.log.push({ id: 'hidden-intent', text: '意图：秘密行动', turn: 1, kind: 'enemy' });
    let refresh: (() => Promise<void>) | undefined;
    const execute = vi.fn();
    const context = { document, api: {
      query: vi.fn(async () => structuredClone(snapshot)), execute,
      on: vi.fn((event, fn) => { if (event === 'state.changed') refresh = fn; return () => undefined; }),
      getThemeState: () => ({ active: 'default' }), closePanel: vi.fn(), navigatePanel: vi.fn(),
    } } as unknown as PanelContext;
    const host = document.createElement('div'); document.body.append(host);
    app = createApp(BattleApp, { context }); app.mount(host);
    await vi.waitFor(() => expect(host.querySelector('.enemy-card')).not.toBeNull());
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === '战况')!.click();
    await nextTick();
    expect(host.querySelector('.intent')).toBeNull();
    expect(host.textContent).not.toContain('秘密行动');
    expect(host.querySelector('.enemy-card')?.textContent).toContain('16.67%');
    const enemy = host.querySelector<HTMLButtonElement>('.enemy-card')!;
    enemy.focus(); enemy.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await nextTick();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-label')).toContain('技能模组');
    expect(dialog.querySelectorAll('article')).toHaveLength(4);
    expect(dialog.textContent).not.toContain('秘密行动');
    const close = dialog.querySelector<HTMLButtonElement>('button')!;
    expect(document.activeElement).toBe(close);
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(enemy);
    expect(execute).not.toHaveBeenCalled();
    snapshot.relics.push({ relicId: 'r_silver_compass', carried: true } as typeof snapshot.relics[number]);
    await refresh!(); await nextTick();
    expect(host.querySelector('.intent')).not.toBeNull();
    expect(host.textContent).toContain('秘密行动');
    expect(host.textContent).not.toContain('伤害预览按命中');
  });
});
