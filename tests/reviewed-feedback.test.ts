import { refreshWorkshopProfessionCatalogs } from '@/content/catalogs/professions';
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import { saveWorkshopPack, normalizeCardEffect } from '@/workshop';
import { loadCardCatalog } from '@/content/catalogs/cards';
import { previewBattleCard } from '@/battle/card-preview';
import { DEFAULT_STAR_SCALING } from '@/workshop-stars';
import { catalog as nativeCatalog } from '@/battle/rework/runtime/physics.mjs';
import { battleDamageFloat, battleCardText } from '@/battle/presentation';
import * as api from '@/battle/rework/runtime/api.mjs';
import type { CardEffect } from '@/content/types';
const databases: CaelianDatabase[] = [];
afterEach(async () => {
  localStorage.clear();
  await Promise.all(databases.splice(0).map(async db => { db.close(); await db.delete(); }));
});
function profession(effects: CardEffect[][] = []) {
  const cards = Array.from({ length: 9 }, (_, i) => ({ id: `review_card_${i}`, name: `反馈测试卡${i}`, type: 'skill', cost: 0,
    starScaling: DEFAULT_STAR_SCALING, effects: effects[i] ?? [{ type: 'shield', value: 1, target: 'self' }] }));
  return { format: 'caelian_workshop_class_pack', version: 1, classes: [{ id: 'custom_class_reviewed', main: 'freelance', name: '反馈测试职业',
    talent: { name: '空天赋', effects: [] }, cards, cardPool: [...cards, ...cards].map(c => c.id), starterDeck: Array.from({ length: 15 }, (_, i) => cards[i % 9]!.id) }] };
}
async function setup(pack = profession()) {
  const saved = saveWorkshopPack(pack);
  refreshWorkshopProfessionCatalogs();
  const db = new CaelianDatabase('alpha', `reviewed-feedback-${crypto.randomUUID()}`); databases.push(db);
  const game = new GameRepository(db, new EventBus(), { random: () => .5 });
  const profile = await game.ensureProfile('feedback-chat');
  let sequence = 0;
  const run = async (type: string, payload: unknown) => {
    const result = await game.execute(profile.id, { id: `feedback:${sequence++}`, type, payload } as any);
    expect(result.status, JSON.stringify(result)).toBe('applied');
  };
  await run('player.create', { name: '反馈测试', classMain: 'freelance', subclass: saved.classes[0]!.id });
  return { db, game, profile, run, saved };
}
describe('已查看反馈回归', () => {
  it('已在使用的职业删除技能后，旧牌组与职业存档去除失效卡，战斗不再抽到幽灵卡', async () => {
    const pack = profession(); const f = await setup(pack);
    const deleted = pack.classes[0]!.cards.pop()!.id;
    pack.classes[0]!.cardPool = pack.classes[0]!.cardPool.filter(id => id !== deleted);
    pack.classes[0]!.cardPool.push(pack.classes[0]!.cards[0]!.id);
    pack.classes[0]!.starterDeck = pack.classes[0]!.starterDeck.map(id => id === deleted ? pack.classes[0]!.cards[0]!.id : id);
    saveWorkshopPack(pack);
    // Start directly without opening/reloading the deck panel first.
    await f.run('battle.start', {});
    const state = await f.game.snapshot(f.profile.id);
    expect(state.cards.some(c => c.cardId === deleted)).toBe(false);
    expect(state.decks.some(d => d.cardIds.includes(deleted))).toBe(false);
    expect(state.decks[0]!.cardStars).toHaveLength(state.decks[0]!.cardIds.length);
    const player = state.battle!.state.player;
    const catalog = await loadCardCatalog();
    for (const card of [...player.hand, ...player.drawPile, ...player.discardPile]) expect(catalog[card.cardId]).toBeDefined();
  });
  it('生命转攻击、攻击转防御、速度转换与新版状态条件经实际出牌结算，暴击增益可到期', async () => {
    const f = await setup(profession([
      [{ type: 'apply_buff', nativeStatus: true, buff: 'strength', value: 5, scaling: { stat: 'hpMax', percent: 10 }, turns: 2, target: 'self' }],
      [{ type: 'apply_buff', nativeStatus: true, buff: 'fortitude', value: 0, scaling: { stat: 'attack', percent: 50 }, turns: 2, target: 'self' }],
      [{ type: 'apply_buff', nativeStatus: true, buff: 'speed_flat', value: 0, scaling: { stat: 'defense', percent: 100 }, turns: 2, target: 'self' },
        { type: 'conditional_group', conditions: [{ type: 'self_has_specific_buff', buff: 'speed_up' }], then_effects: [{ type: 'shield', value: 999, target: 'self' }] }],
      [{ type: 'apply_buff', nativeStatus: true, buff: 'crit_up', value: 100, turns: 1, target: 'self' }, { type: 'apply_buff', nativeStatus: true, buff: 'crit_damage_up', value: 100, turns: 1, target: 'self' }],
      [{ type: 'conditional_group', operator: 'and', conditions: [{ type: 'self_has_specific_buff', buff: 'crit_up' }], then_effects: [{ type: 'shield', value: 19, target: 'self' }], else_effects: [{ type: 'shield', value: 1, target: 'self' }] }],
      [{ type: 'apply_debuff', nativeStatus: true, debuff: 'armor_break', value: .2, turns: 2, target: 'enemy', baseChance: 100 },
        { type: 'conditional_group', operator: 'and', conditions: [{ type: 'enemy_has_specific_debuff', debuff: 'armor_break' }], then_effects: [{ type: 'shield', value: 13, target: 'self' }], else_effects: [{ type: 'shield', value: 1, target: 'self' }] }],
    ]));
    await f.run('battle.start', { workshopTest: { professionId: f.saved.classes[0]!.id, attributes: { hpMax: 0, attack: 0, defense: 0, speed: 0, actionPointsPerTurn: 0 }, dummyCount: 1, dummyHp: 10000, dummyAttack: 0, dummyDefense: 0, dummyInvincible: false, dummyAttackEnabled: false, autoRespawn: false, playerInvincible: false } });
    const session = (await f.db.battleSessions.where('profileId').equals(f.profile.id).first())!;
    const core = api.hydrate(session.state.rework);
    core.player.hp = core.player.maxHp = 1000; core.player.shield = 0;
    Object.assign(core.player.stats, { attack: 100, defense: 20, speed: 100, crit: 0, critDamage: 50, ehr: 80 });
    core.enemies[0].stats.res = 0;
    core.player.ap = core.player.apMax = 10;
    core.player.hand = [0, 1, 2, 3, 4, 5].map(i => ({ id: f.saved.classes[0]!.cards[i]!.id, uid: `feedback-card:${i}`, legacy: true, ap: 0, star: 1, effects: [] }));
    core.player.deck = []; core.player.discard = [];
    api.project(core, session.state); await f.db.battleSessions.put(session);
    const read = async () => api.hydrate((await f.db.battleSessions.get(session.id))!.state.rework);
    const play = () => f.run('battle.play-card', { battleId: session.id, handIndex: 0, targetIndex: 0 });
    await play(); let g = await read(); expect(g.stat(g.player, 'attack')).toBe(205);
    await play(); g = await read(); expect(g.stat(g.player, 'defense')).toBe(123);
    await play(); g = await read(); expect(g.stat(g.player, 'speed')).toBe(223);
    await play(); g = await read(); expect(g.stat(g.player, 'crit')).toBe(100); expect(g.stat(g.player, 'critDamage')).toBe(150);
    await play(); g = await read(); expect(g.player.shield).toBe(19);
    await play(); g = await read(); expect(g.player.shield).toBe(32);
    await f.run('battle.end-turn', { battleId: session.id });
    g = await read(); expect(g.stat(g.player, 'crit')).toBe(0); expect(g.stat(g.player, 'critDamage')).toBe(50);
  });
  it.each([[0, 1, 0], [100, 1, 0], [0, 1, 60], [100, 1, 60], [0, 2, 60]])('x+y% 伤害：暴击率 %i、攻击 %i 次、护盾 %i，与扣血及日志一致', async (crit, hits, shield) => {
    const f = await setup(profession([[{ type: 'damage', value: 100, hits, scaling: { stat: 'attack', percent: 100 }, target: 'enemy' }]]));
    await f.run('battle.start', { monsterId: 'mon_slime' });
    const session = (await f.db.battleSessions.where('profileId').equals(f.profile.id).first())!;
    const core = api.hydrate(session.state.rework);
    Object.assign(core.player.stats, { attack: 300, speed: 10000, crit, critDamage: 50 });
    core.player.buffs = []; core.player.debuffs = []; core.player.ap = 10;
    Object.assign(core.enemies[0].stats, { defense: 3 * (100 + 5 * core.player.level), speed: 1 });
    core.enemies[0].hp = core.enemies[0].maxHp = 10000; core.enemies[0].shield = shield;
    core.enemies[0].buffs = []; core.enemies[0].debuffs = [];
    const cardId = f.saved.classes[0]!.cards[0]!.id;
    core.player.hand = [{ id: cardId, uid: 'single-hit', legacy: true, ap: 0, star: 1, effects: [] }];
    api.project(core, session.state); session.state.animations = []; session.state.log = [];
    await f.db.battleSessions.put(session);
    const before = JSON.stringify(session.state);
    const preview = previewBattleCard(session.state, (await loadCardCatalog())[cardId]!, 0);
    expect(JSON.stringify(session.state)).toBe(before);
    await f.run('battle.play-card', { battleId: session.id, handIndex: 0, targetIndex: 0 });
    const result = (await f.db.battleSessions.get(session.id))!.state;
    const damage = (result.animations ?? []).filter(e => e.kind === 'damage' && e.targetId === core.enemies[0].id);
    expect(damage).toHaveLength(hits!);
    expect(10000 - result.enemies[0]!.hp).toBe((crit ? 150 : 100) * hits! - shield!);
    expect(damage[0]!.amount).toBe(crit ? 150 : 100);
    expect(preview.enemyDamage[0]).toBe(100 * hits! - shield!);
    expect(damage[0]!.critical).toBe(crit === 100);
    expect(damage[0]!.label).toContain('反馈测试卡0');
    expect(battleDamageFloat(damage[0]!)).toContain(crit ? '暴击' : '−');
    if (shield) expect(battleDamageFloat(damage[0]!)).toContain('护盾−60');
    expect(battleCardText((await loadCardCatalog())[cardId]!, 1, session.state, { attack: 300, defense: 0, hpMax: 100, targetHpMax: 10000 })).toContain('减伤前、未暴击');
    if (hits! > 1) expect(damage[1]!.label).toContain('第2/2次攻击');
  });
  it('同名一星和三星卡按选中的实体预览，预览不消耗手牌或随机数', async () => {
    const f = await setup(); await f.run('battle.start', { monsterId: 'mon_slime' });
    const session = (await f.db.battleSessions.where('profileId').equals(f.profile.id).first())!;
    const core = api.hydrate(session.state.rework);
    const native = nativeCatalog.cards.find((c: any) => c.effects.length === 1 && c.effects[0].kind === 'damage' && !c.effects[0].condition && c.ap <= 2)!;
    core.player.ap = 10; core.player.stats.attack = 100; core.enemies[0].hp = core.enemies[0].maxHp = 10000;
    core.player.hand = [1, 3].map(star => ({ ...structuredClone(native), star, uid: `star-${star}` }));
    api.project(core, session.state);
    const before = JSON.stringify(session.state);
    const card = (await loadCardCatalog())[native.id]!;
    const one = previewBattleCard(session.state, { ...card, previewInstanceId: 'star-1', previewStars: 1 }, 0);
    const three = previewBattleCard(session.state, { ...card, previewInstanceId: 'star-3', previewStars: 3 }, 0);
    expect(three.enemyDamage[0]).toBeCloseTo(one.enemyDamage[0]! * 1.2);
    expect(JSON.stringify(session.state)).toBe(before);
  });
  it('百分比增益保留小数，扩展公式不会被保存器悄悄删除', () => {
    expect(normalizeCardEffect({ type: 'apply_buff', nativeStatus: true, buff: 'speed_up', value: .1, scaling: { stat: 'effectResist', percent: 2.5 }, turns: 2, target: 'self' })).toMatchObject({ value: .1, scaling: { stat: 'effectResist', percent: 2.5 } });
  });
});
