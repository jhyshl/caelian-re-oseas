import { afterEach, describe, expect, it } from 'vitest';
import { reworkCard } from '@/battle/rework/catalog';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { BattleRepository } from '@/storage/repositories/battle-repository';
import { GameRepository } from '@/storage/repository';

const databases: CaelianDatabase[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (db) => { db.close(); await db.delete(); }));
});

async function setup(name: string, cardId = 'as_astrology') {
  const database = new CaelianDatabase('alpha', `caelian-astrology-${name}-${crypto.randomUUID()}`);
  databases.push(database);
  const game = new GameRepository(database, new EventBus());
  const profile = await game.ensureProfile(`chat:astrology:${name}`);
  await game.execute(profile.id, { id: `create-astrologer:${name}`, type: 'player.create', payload: { name: '占星测试员', classMain: 'freelance', subclass: 'astrologer' } });
  const battles = new BattleRepository(database, () => 0);
  await battles.prepare();
  await battles.start(profile.id, { monsterId: 'mon_slime', source: '占星弹窗测试遭遇' });
  const session = (await database.battleSessions.where('profileId').equals(profile.id).first())!;
  session.state.player.ap = 20;
  session.state.player.hand = [{ instanceId: 'astrology:play', cardId, stars: 3 }];
  session.state.player.drawPile = [];
  session.state.player.discardPile = [];
  session.state.enemies[0]!.hp = 10_000;
  session.state.enemies[0]!.hpMax = 10_000;
  await database.battleSessions.put(session);
  return { database, game, profile, battles, battleId: session.id, initialResource: session.state.player.classResources?.['星辉'] ?? 0 };
}

describe('占星术重置选牌', () => {
  it('三选一保持选择事务，完成后只扣一次 AP/星辉并生成一星临时牌', async () => {
    const { database, game, profile, battles, battleId, initialResource } = await setup('pick');
    expect(initialResource).toBeGreaterThanOrEqual(1);
    await battles.playCard(profile.id, { battleId, handIndex: 0, targetIndex: 0 });
    let current = (await database.battleSessions.get(battleId))!;
    const pending = current.state.player.pendingCardChoice!;
    expect(pending).toMatchObject({ type: 'rework', title: '星象发现：选择卡牌', pick: 1, picked: [] });
    expect(pending.choices).toHaveLength(3);
    expect(new Set(pending.choices).size).toBe(3);
    expect(current.state.player.hand.map((c) => c.cardId)).toEqual(['as_astrology']);
    expect(current.state.player.ap).toBe(20);
    expect(current.state.player.classResources?.['星辉']).toBe(initialResource);
    await expect(battles.endTurn(profile.id, battleId)).rejects.toThrow(/请先完成/);
    await expect(battles.discardHand(profile.id, battleId)).rejects.toThrow(/请先完成/);
    const chosen = pending.choices[0]!;
    expect(reworkCard(chosen)).toBeDefined();
    const ownedBefore = await database.ownedCards.where('profileId').equals(profile.id).toArray();
    const result = await game.execute(profile.id, { id: 'choose-astrology-card', type: 'battle.choose-astrology-card', payload: { battleId, choiceIndex: 0 } });
    expect(result.status).toBe('applied');
    current = (await database.battleSessions.get(battleId))!;
    expect(current.state.player.pendingCardChoice).toBeUndefined();
    expect(current.state.player.hand).toMatchObject([{ cardId: chosen, stars: 1 }]);
    expect(current.state.player.ap).toBe(19);
    expect(current.state.player.classResources?.['星辉']).toBe(initialResource - 1);
    expect(current.state.player.discardPile.map((c) => c.cardId)).toEqual(['as_astrology']);
    expect(await database.ownedCards.where('profileId').equals(profile.id).toArray()).toEqual(ownedBefore);
    expect(current.state.reworkCards?.[current.state.player.hand[0]!.instanceId]?.cost).toBe(reworkCard(chosen)!.ap);
    expect((await game.execute(profile.id, { id: 'choose-astrology-card', type: 'battle.choose-astrology-card', payload: { battleId, choiceIndex: 0 } })).status).toBe('duplicate');
    expect((await database.battleSessions.get(battleId))!.state.player.ap).toBe(19);
  });

  it('五选二持久化已选项，拒绝重复/越界/提前完成，重载后按原星盘续选', async () => {
    const { database, profile, battles, battleId, initialResource } = await setup('grand', 'as_grand_astrology');
    await battles.playCard(profile.id, { battleId, handIndex: 0, targetIndex: 0 });
    const before = (await database.battleSessions.get(battleId))!;
    const choices = before.state.player.pendingCardChoice!.choices;
    expect(choices).toHaveLength(5);
    expect(new Set(choices).size).toBe(5);
    await battles.chooseAstrologyCard(profile.id, { battleId, choiceIndex: 0 });
    let current = (await database.battleSessions.get(battleId))!;
    expect(current.state.player.pendingCardChoice).toMatchObject({ type: 'rework', pick: 2, picked: [0], choices });
    expect(current.state.player.ap).toBe(20);
    expect(current.state.player.classResources?.['星辉']).toBe(initialResource);
    for (const choiceIndex of [0, 5, -1]) {
      await expect(battles.chooseAstrologyCard(profile.id, { battleId, choiceIndex })).rejects.toThrow(/选择/);
      const unchanged = (await database.battleSessions.get(battleId))!;
      expect(unchanged.state.player.pendingCardChoice).toEqual(current.state.player.pendingCardChoice);
      expect(unchanged.state.player.hand).toEqual(current.state.player.hand);
      expect(unchanged.state.player.ap).toBe(20);
    }
    const restored = new BattleRepository(database, () => 0.99);
    await restored.prepare();
    await restored.chooseAstrologyCard(profile.id, { battleId, choiceIndex: 1 });
    current = (await database.battleSessions.get(battleId))!;
    expect(current.state.player.pendingCardChoice).toBeUndefined();
    expect(current.state.player.hand.map((card) => card.cardId)).toEqual([choices[0], choices[1]]);
    expect(current.state.player.hand.every((card) => card.stars === 1)).toBe(true);
    expect(current.state.player.ap).toBe(18);
    expect(current.state.player.classResources?.['星辉']).toBe(initialResource - 2);
    expect(current.state.player.discardPile.map((c) => c.cardId)).toEqual(['as_grand_astrology']);
  });
});
