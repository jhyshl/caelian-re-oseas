import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import BattleApp from '@/modules/battle/App.vue';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import { EventBus } from '@/kernel/event-bus';
import type { PanelContext } from '@/kernel/public-api';
import * as battleRuntime from '@/battle/rework/runtime/api.mjs';
import {catalog} from '@/battle/rework/runtime/physics.mjs';

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
  it('选中特莱奥后，真实出牌和治疗预览都作用于特莱奥，非法目标不会消耗手牌', async () => {
    db = new CaelianDatabase('alpha', 'battle-ally-' + crypto.randomUUID());
    const game = new GameRepository(db, new EventBus());
    const profile = await game.ensureProfile('ally-' + crypto.randomUUID());
    await game.execute(profile.id, {id:'create',type:'player.create',payload:{name:'友方目标验证',classMain:'knight',subclass:'holy_knight'}});
    await game.execute(profile.id, {id:'start',type:'battle.start',payload:{monsterId:'mon_orc',companionPresent:true,storyTriggered:true}});
    const session = (await db.battleSessions.where('profileId').equals(profile.id).first())!;
    const core = battleRuntime.hydrate(session.state.rework), trelio = core.allies.find((a:any)=>a.id==='trelio');
    core.player.hp = Math.round(core.player.maxHp / 2);trelio.hp = Math.round(trelio.maxHp / 2);core.player.ap=10;
    core.player.hand=[{...structuredClone(catalog.cards.find((c:any)=>c.id==='wm_purifying_rain')),uid:'target-test',star:1}];
    core.addStatus(core.enemies[0],trelio,{kind:'debuff',status:'weak',value:.2,turns:3},{skipEffectRoll:true});
    battleRuntime.project(core,session.state);await db.battleSessions.put(session);
    const preview = battleRuntime.preview(session.state,'wm_purifying_rain',0,'trelio');
    expect(preview.playerHp).toBe(0);expect(preview.companionHp).toBe(0);expect(preview.summonHp?.trelio).toBeGreaterThan(0);
    await expect(game.execute(profile.id,{id:'invalid',type:'battle.play-card',payload:{battleId:session.id,handIndex:0,allyTargetId:session.state.enemies[0]!.id}})).rejects.toThrow('所选己方目标');
    expect((await db.battleSessions.get(session.id))!.state.player.ap).toBe(10);
    const result = await game.execute(profile.id,{id:'heal-trelio',type:'battle.play-card',payload:{battleId:session.id,handIndex:0,allyTargetId:'trelio'}});
    expect(result.status,JSON.stringify(result)).toBe('applied');
    const saved = (await db.battleSessions.get(session.id))!.state;
    expect(saved.player.hp).toBe(session.state.player.hp);expect(saved.companion!.hp).toBe(session.state.companion!.hp);
    expect(saved.companion!.summons[0]!.hp).toBeCloseTo(trelio.hp + preview.summonHp!.trelio!);
    const restored = battleRuntime.hydrate(saved.rework);expect(restored.hasStatus(restored.allies.find((a:any)=>a.id==='trelio'),'weak')).toBe(false);
  });

  it('隐藏意图和预告日志，双击查看全部技能；携带洞察藏品后显示意图', async () => {
    db = new CaelianDatabase('alpha', 'battle-ui-' + crypto.randomUUID());
    const game = new GameRepository(db, new EventBus(), { random: () => 0 });
    const profile = await game.ensureProfile('ui-' + crypto.randomUUID());
    await game.execute(profile.id, { id: 'create', type: 'player.create', payload: { name: '显示验证', classMain: 'knight', subclass: 'holy_knight' } });
    await game.execute(profile.id, { id: 'start', type: 'battle.start', payload: { monsterId: 'mon_slime', source: '显示验证', companionPresent:true, storyTriggered:true } });
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
    expect(host.querySelector('.companion-sequence')).toBeNull();
    const caelian = host.querySelector<HTMLButtonElement>('.companion-unit')!;
    caelian.click(); await nextTick();
    expect(caelian.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    caelian.click(); caelian.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await nextTick();
    const partyDialog=document.querySelector('[role="dialog"]')!;
    expect(partyDialog.querySelectorAll('article')).toHaveLength(8);
    expect(partyDialog.textContent).toContain('黎明誓约');expect(partyDialog.textContent).toContain('圣辉镇压');expect(partyDialog.textContent).toContain('4 AP');
    partyDialog.querySelector<HTMLButtonElement>('button')!.click();await nextTick();
    expect(caelian.getAttribute('aria-pressed')).toBe('true');
    const trelio = host.querySelector<HTMLButtonElement>('.companion-summon')!;
    trelio.click();await nextTick();
    expect(trelio.getAttribute('aria-pressed')).toBe('true');expect(caelian.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    trelio.click();trelio.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));await nextTick();
    const petDialog=document.querySelector('[role="dialog"]')!;
    expect(petDialog.querySelectorAll('article')).toHaveLength(3);expect(petDialog.textContent).toContain('圣翼庇护');expect(petDialog.textContent).toContain('震慑龙息');
    expect(trelio.getAttribute('aria-pressed')).toBe('true');expect(execute).not.toHaveBeenCalled();
  });
});
