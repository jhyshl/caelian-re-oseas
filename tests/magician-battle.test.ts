import { afterEach, describe, expect, it } from 'vitest';
import { MAGICIAN_BLANK_CARD_ID, MAGICIAN_PASSIVE_ID, MAGICIAN_SUBCLASS_ID } from '@/content/catalogs/magician';
import { hydrate, project } from '@/battle/rework/runtime/api.mjs';
import type { BattleCardInstance, BattleSessionRecord } from '@/domain/types';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { BattleRepository } from '@/storage/repositories/battle-repository';
import { GameRepository } from '@/storage/repository';

const databases: CaelianDatabase[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (db) => { db.close(); await db.delete(); }));
});
function instance(instanceId: string, cardId: string, stars = 1): BattleCardInstance {
  return { instanceId, cardId, stars };
}
function blankCount(session: BattleSessionRecord): number {
  const p = session.state.player;
  return [...p.hand, ...p.drawPile, ...p.discardPile].filter((c) => c.cardId === MAGICIAN_BLANK_CARD_ID).length;
}
async function setup(name: string) {
  const database = new CaelianDatabase('alpha', `caelian-magician-${name}-${crypto.randomUUID()}`);
  databases.push(database);
  const game = new GameRepository(database, new EventBus());
  const profile = await game.ensureProfile(`chat:magician:${name}`);
  await game.execute(profile.id, { id: `create-magician:${name}`, type: 'player.create', payload: { name: '魔术师测试员', classMain: 'freelance', subclass: MAGICIAN_SUBCLASS_ID } });
  const battles = new BattleRepository(database, () => 0);
  await battles.prepare();
  await battles.start(profile.id, { monsterId: 'mon_slime', source: '魔术师重置机制验证' });
  const session = (await database.battleSessions.where('profileId').equals(profile.id).first())!;
  // Construct deterministic combat actors, then use repository commands for every real action.
  const core = hydrate(session.state.rework);
  core.player.hp = core.player.maxHp = 10_000;
  core.player.ap = core.player.apMax = 20;
  Object.assign(core.player.stats, { hp: 10_000, attack: 100, speed: 1_000, crit: 0 });
  core.player.buffs = [];
  core.player.debuffs = [];
  for (const enemy of core.enemies) {
    enemy.hp = enemy.maxHp = 10_000;
    enemy.shield = 0;
    enemy.buffs = [];
    enemy.debuffs = [];
    Object.assign(enemy.stats, { hp: 10_000, defense: 0, speed: 1, crit: 0 });
  }
  project(core, session.state);
  await database.battleSessions.put(session);
  return { database, game, profile, battles, battleId: session.id };
}

describe('魔术师重置战斗机制', () => {
  it('转职保留 26 张职业卡、15 张初始牌组、15 张手牌上限与职业额外抽牌', async () => {
    const { game, profile, battles, database, battleId } = await setup('profession');
    const current = await game.snapshot(profile.id);
    expect(current.cards).toHaveLength(13);
    expect(current.cards.reduce((sum, card) => sum + card.quantity, 0)).toBe(26);
    expect(current.decks.find((deck) => deck.active)?.cardIds).toHaveLength(15);
    expect(current.passives).toEqual(expect.arrayContaining([expect.objectContaining({ passiveId: MAGICIAN_PASSIVE_ID })]));
    expect(current.battle?.state.player.handLimit).toBe(15);
    expect(current.battle?.state.player.drawPerTurn).toBe(3);
    expect(current.battle?.state.player.hand).toHaveLength(6);
    await battles.endTurn(profile.id, battleId);
    expect((await database.battleSessions.get(battleId))!.state.player.hand).toHaveLength(10);
  });

  it('空白牌不能直接打出、作为普通弃牌代价或被手动弃牌，失败时不扣 AP', async () => {
    const { database, profile, battles, battleId } = await setup('protected');
    let current = (await database.battleSessions.get(battleId))!;
    current.state.player.hand = [
      instance('blank:1', MAGICIAN_BLANK_CARD_ID), instance('blank:2', MAGICIAN_BLANK_CARD_ID),
      instance('normal:1', 'mg_quick_cut'), instance('normal:2', 'mg_card_knife'),
    ];
    current.state.player.drawPile = [
      instance('draw:1', 'mg_quick_cut'), instance('draw:2', 'mg_card_knife'), instance('draw:3', 'mg_chain_cards'),
    ];
    current.state.player.discardPile = [];
    await database.battleSessions.put(current);
    await battles.discardHand(profile.id, battleId);
    current = (await database.battleSessions.get(battleId))!;
    expect(current.state.player.hand.filter((c) => c.cardId === MAGICIAN_BLANK_CARD_ID)).toHaveLength(2);
    expect(current.state.player.discardPile.map((c) => c.instanceId)).toEqual(['normal:1', 'normal:2']);
    expect(current.state.player.ap).toBe(19);
    await expect(battles.discardHand(profile.id, battleId)).rejects.toThrow();

    current.state.player.ap = 20;
    current.state.player.hand = [instance('switch:1', 'mg_card_switch'), instance('blank:3', MAGICIAN_BLANK_CARD_ID)];
    current.state.player.drawPile = [instance('draw:4', 'mg_quick_cut'), instance('draw:5', 'mg_chain_cards')];
    current.state.player.discardPile = [];
    await database.battleSessions.put(current);
    for (const handIndex of [0, 1]) {
      await expect(battles.playCard(profile.id, { battleId, handIndex, targetIndex: 0 })).rejects.toThrow();
      const unchanged = (await database.battleSessions.get(battleId))!;
      expect(unchanged.state.player.ap).toBe(20);
      expect(unchanged.state.player.hand).toEqual(current.state.player.hand);
      expect(unchanged.state.player.pendingCardChoice).toBeUndefined();
    }
    current.state.player.hand.push(instance('normal:3', 'mg_card_knife'));
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, { battleId, handIndex: 0, targetIndex: 0 });
    current = (await database.battleSessions.get(battleId))!;
    expect(current.state.player.ap).toBe(19);
    expect(current.state.player.hand.map((c) => c.instanceId)).toEqual(['blank:3', 'draw:4', 'draw:5']);
    expect(current.state.player.discardPile.map((c) => c.instanceId)).toEqual(['normal:3', 'switch:1']);
  });

  it('不竭牌匣同名刷新而不叠加，恰好生成三轮；空白存量共用八张上限', async () => {
    const { database, profile, battles, battleId } = await setup('refresh');
    let current = (await database.battleSessions.get(battleId))!;
    current.state.player.hand = [instance('case:1', 'mg_inexhaustible_case'), instance('case:2', 'mg_inexhaustible_case')];
    current.state.player.drawPile = Array.from({ length: 30 }, (_, i) => instance(`draw:${i}`, 'mg_quick_cut'));
    current.state.player.discardPile = [];
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, { battleId, handIndex: 0, targetIndex: 0 });
    await battles.playCard(profile.id, { battleId, handIndex: 0, targetIndex: 0 });
    current = (await database.battleSessions.get(battleId))!;
    expect(current.state.player.ap).toBe(18);
    expect(blankCount(current)).toBe(0);
    for (let turn = 1; turn <= 4; turn++) {
      await battles.endTurn(profile.id, battleId);
      current = (await database.battleSessions.get(battleId))!;
      expect(blankCount(current)).toBe(Math.min(turn, 3));
    }
    current.state.player.ap = 20;
    current.state.player.hand.push(...[1, 2, 3, 4].map((i) => instance(`sleeve:${i}`, 'mg_sleeve_cache')));
    await database.battleSessions.put(current);
    for (const expected of [5, 7, 8, 8]) {
      current = (await database.battleSessions.get(battleId))!;
      const handIndex = current.state.player.hand.findIndex((c) => c.cardId === 'mg_sleeve_cache');
      await battles.playCard(profile.id, { battleId, handIndex, targetIndex: 0 });
      current = (await database.battleSessions.get(battleId))!;
      expect(blankCount(current)).toBe(expected);
    }
    expect(current.state.player.ap).toBe(16);
  });

  it('漫天飞牌允许选择并提前确认 1–4 张普通牌，按实际弃牌数结算且不触发被弃牌效果', async () => {
    const { database, profile, battles, battleId } = await setup('flying');
    let current = (await database.battleSessions.get(battleId))!;
    current.state.player.hand = [
      instance('flying:1', 'mg_flying_cards'),
      instance('normal:1', 'mg_quick_cut'), instance('normal:2', 'mg_card_knife'), instance('normal:3', 'mg_chain_cards'),
      instance('blank:1', MAGICIAN_BLANK_CARD_ID), instance('blank:2', MAGICIAN_BLANK_CARD_ID),
    ];
    current.state.player.drawPile = [];
    current.state.player.discardPile = [];
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, { battleId, handIndex: 0, targetIndex: 0 });
    current = (await database.battleSessions.get(battleId))!;
    const pending = current.state.player.pendingCardChoice!;
    expect(pending).toMatchObject({ type: 'rework', title: '选择弃置的卡牌', pick: 3, min: 1, picked: [] });
    expect(pending.choices).toHaveLength(3);
    expect(pending.choices).not.toContain(MAGICIAN_BLANK_CARD_ID);
    expect(current.state.player.ap).toBe(20);
    expect(current.state.enemies[0]!.hp).toBe(10_000);
    await expect(battles.chooseAstrologyCard(profile.id, { battleId, choiceIndex: -1 })).rejects.toThrow(/选择/);
    await battles.chooseAstrologyCard(profile.id, { battleId, choiceIndex: 0 });
    await battles.chooseAstrologyCard(profile.id, { battleId, choiceIndex: 1 });
    current = (await database.battleSessions.get(battleId))!;
    expect(current.state.player.ap).toBe(20);
    expect(current.state.enemies[0]!.hp).toBe(10_000);
    await battles.chooseAstrologyCard(profile.id, { battleId, choiceIndex: -1 });
    current = (await database.battleSessions.get(battleId))!;
    expect(current.state.player.pendingCardChoice).toBeUndefined();
    expect(current.state.player.ap).toBe(18);
    expect(current.state.enemies[0]!.hp).toBeCloseTo(10_000 - 2 * (15 + 0.5 * 100), 8);
    expect(current.state.player.hand).toHaveLength(3);
    expect(current.state.player.hand.filter((c) => c.cardId === MAGICIAN_BLANK_CARD_ID)).toHaveLength(2);
    expect(current.state.player.discardPile).toHaveLength(3);
    expect(current.state.player.drawPile).toHaveLength(0);
  });

  it.each([1, 3])('真相揭晓以 %s 星按八张空白结算，移除临时实体且保留普通手牌', async (stars) => {
    const { database, profile, battles, battleId } = await setup(`truth:${stars}`);
    let current = (await database.battleSessions.get(battleId))!;
    current.state.player.hand = [
      instance('truth:1', 'mg_truth_revealed', stars),
      ...Array.from({ length: 8 }, (_, i) => instance(`blank:${i}`, MAGICIAN_BLANK_CARD_ID)),
      instance('normal:1', 'mg_quick_cut'),
    ];
    current.state.player.drawPile = [];
    current.state.player.discardPile = [];
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, { battleId, handIndex: 0, targetIndex: 0 });
    current = (await database.battleSessions.get(battleId))!;
    const starMultiplier = stars === 3 ? 1.2 : 1;
    expect(current.state.enemies[0]!.hp).toBeCloseTo(10_000 - 8 * (20 + 0.55 * 100) * starMultiplier, 8);
    expect(current.state.player.ap).toBe(16);
    expect(current.state.player.hand.map((c) => c.instanceId)).toEqual(['normal:1']);
    expect(current.state.player.discardPile.map((c) => c.cardId)).toEqual(['mg_truth_revealed']);
    expect(blankCount(current)).toBe(0);
  });
});
