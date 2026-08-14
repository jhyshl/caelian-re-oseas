import { afterEach, describe, expect, it } from 'vitest';
import {
  MAGICIAN_BLANK_CARD_ID,
  MAGICIAN_PASSIVE_ID,
  MAGICIAN_SUBCLASS_ID,
} from '@/content/catalogs/magician';
import type { BattleCardInstance, BattleSessionRecord } from '@/domain/types';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { BattleRepository } from '@/storage/repositories/battle-repository';
import { GameRepository } from '@/storage/repository';

const databases: CaelianDatabase[] = [];

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

function instance(instanceId: string, cardId: string): BattleCardInstance {
  return { instanceId, cardId };
}

function blankCount(session: BattleSessionRecord): number {
  const player = session.state.player;
  return [...player.hand, ...player.drawPile, ...player.discardPile].filter(
    (card) => card.cardId === MAGICIAN_BLANK_CARD_ID,
  ).length;
}

async function setup(name: string) {
  const database = new CaelianDatabase(
    'alpha',
    `caelian-magician-${name}-${crypto.randomUUID()}`,
  );
  databases.push(database);
  const game = new GameRepository(database, new EventBus());
  const profile = await game.ensureProfile(`chat:magician:${name}`);
  await game.execute(profile.id, {
    id: `create-magician:${name}`,
    type: 'player.create',
    payload: {
      name: '魔术师测试员',
      classMain: 'freelance',
      subclass: MAGICIAN_SUBCLASS_ID,
    },
  });
  const battles = new BattleRepository(database, () => 0);
  await battles.prepare();
  await battles.start(profile.id, {
    monsterId: 'mon_slime',
    source: '魔术师测试遭遇',
  });
  const session = await database.battleSessions
    .where('profileId')
    .equals(profile.id)
    .first();
  if (!session) throw new Error('测试战斗未创建');
  session.state.player.hp = 10_000;
  session.state.player.hpMax = 10_000;
  session.state.player.ap = 20;
  session.state.player.apMax = 20;
  session.state.enemies[0]!.hp = 500;
  session.state.enemies[0]!.hpMax = 500;
  session.state.enemies[0]!.shield = 0;
  session.state.enemies[0]!.defense = 0;
  session.state.enemies[0]!.speed = 0;
  session.state.enemies[0]!.buffs = {};
  session.state.enemies[0]!.debuffs.freeze = { value: 1, turns: 99 };
  await database.battleSessions.put(session);
  return { database, game, profile, battles, battleId: session.id };
}

describe('魔术师战斗机制', () => {
  it('转职时获得 26 张职业卡、15 张初始牌组和 15 张手牌上限', async () => {
    const { game, profile } = await setup('profession');
    const snapshot = await game.snapshot(profile.id);
    expect(snapshot.cards).toHaveLength(13);
    expect(
      snapshot.cards.reduce((sum, card) => sum + card.quantity, 0),
    ).toBe(26);
    expect(snapshot.decks.find((deck) => deck.active)?.cardIds).toHaveLength(15);
    expect(snapshot.passives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ passiveId: MAGICIAN_PASSIVE_ID }),
      ]),
    );
    expect(snapshot.battle?.state.player.handLimit).toBe(15);
    expect(snapshot.battle?.state.player.drawPerTurn).toBe(4);
  });

  it('保护空白牌免受按钮、普通弃牌和直接打出影响', async () => {
    const { database, profile, battles, battleId } = await setup('protected');
    let session = (await database.battleSessions.get(battleId))!;
    session.state.player.hand = [
      instance('blank:1', MAGICIAN_BLANK_CARD_ID),
      instance('blank:2', MAGICIAN_BLANK_CARD_ID),
      instance('normal:1', 'mg_quick_cut'),
      instance('normal:2', 'mg_card_knife'),
    ];
    session.state.player.drawPile = [
      instance('draw:1', 'mg_quick_cut'),
      instance('draw:2', 'mg_card_knife'),
      instance('draw:3', 'mg_chain_cards'),
    ];
    session.state.player.discardPile = [];
    await database.battleSessions.put(session);

    await battles.discardHand(profile.id, battleId);
    session = (await database.battleSessions.get(battleId))!;
    expect(
      session.state.player.hand.filter(
        (card) => card.cardId === MAGICIAN_BLANK_CARD_ID,
      ),
    ).toHaveLength(2);
    expect(session.state.player.discardPile.map((card) => card.cardId)).toEqual([
      'mg_quick_cut',
      'mg_card_knife',
    ]);

    session.state.player.ap = 20;
    session.state.player.hand = [
      instance('switch:1', 'mg_card_switch'),
      instance('blank:3', MAGICIAN_BLANK_CARD_ID),
    ];
    session.state.player.drawPile = [instance('draw:4', 'mg_quick_cut')];
    await database.battleSessions.put(session);
    await expect(
      battles.playCard(profile.id, {
        battleId,
        handIndex: 0,
        targetIndex: 0,
      }),
    ).rejects.toThrow('需要 1 张可弃置的非空白手牌');
    await expect(
      battles.playCard(profile.id, {
        battleId,
        handIndex: 1,
        targetIndex: 0,
      }),
    ).rejects.toThrow('空白牌无法打出');

    session = (await database.battleSessions.get(battleId))!;
    session.state.player.hand.push(instance('normal:3', 'mg_card_knife'));
    session.state.player.drawPile.push(
      instance('draw:5', 'mg_quick_cut'),
      instance('draw:6', 'mg_chain_cards'),
    );
    await database.battleSessions.put(session);
    await battles.playCard(profile.id, {
      battleId,
      handIndex: 0,
      targetIndex: 0,
    });
    session = (await database.battleSessions.get(battleId))!;
    expect(
      session.state.player.hand.some(
        (card) => card.cardId === MAGICIAN_BLANK_CARD_ID,
      ),
    ).toBe(true);
    expect(
      session.state.player.discardPile.some(
        (card) => card.cardId === MAGICIAN_BLANK_CARD_ID,
      ),
    ).toBe(false);
  });

  it('让多张不竭牌匣独立叠加三回合，并把空白牌总数限制为 8', async () => {
    const { database, profile, battles, battleId } = await setup('stacking');
    let session = (await database.battleSessions.get(battleId))!;
    session.state.player.hand = [
      instance('case:1', 'mg_inexhaustible_case'),
      instance('case:2', 'mg_inexhaustible_case'),
    ];
    session.state.player.drawPile = Array.from({ length: 30 }, (_, index) =>
      instance(`draw:${index}`, 'mg_quick_cut'),
    );
    session.state.player.discardPile = [];
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, { battleId, handIndex: 0, targetIndex: 0 });
    await battles.playCard(profile.id, { battleId, handIndex: 0, targetIndex: 0 });
    session = (await database.battleSessions.get(battleId))!;
    expect(session.state.player.blankGenerators).toHaveLength(2);

    for (let turn = 1; turn <= 3; turn += 1) {
      await battles.endTurn(profile.id, battleId);
      session = (await database.battleSessions.get(battleId))!;
      expect(blankCount(session)).toBe(turn * 2);
    }
    expect(session.state.player.blankGenerators).toHaveLength(0);

    session.state.player.ap = 20;
    session.state.player.hand.push(
      instance('sleeve:1', 'mg_sleeve_cache'),
      instance('sleeve:2', 'mg_sleeve_cache'),
    );
    await database.battleSessions.put(session);
    let sleeveIndex = session.state.player.hand.findIndex(
      (card) => card.cardId === 'mg_sleeve_cache',
    );
    await battles.playCard(profile.id, {
      battleId,
      handIndex: sleeveIndex,
      targetIndex: 0,
    });
    session = (await database.battleSessions.get(battleId))!;
    expect(blankCount(session)).toBe(8);
    sleeveIndex = session.state.player.hand.findIndex(
      (card) => card.cardId === 'mg_sleeve_cache',
    );
    await battles.playCard(profile.id, {
      battleId,
      handIndex: sleeveIndex,
      targetIndex: 0,
    });
    session = (await database.battleSessions.get(battleId))!;
    expect(blankCount(session)).toBe(8);
  });

  it('分别按非空白牌和空白牌结算两种弃牌终结', async () => {
    const { database, profile, battles, battleId } = await setup('finishers');
    let session = (await database.battleSessions.get(battleId))!;
    session.state.player.hand = [
      instance('flying:1', 'mg_flying_cards'),
      instance('normal:1', 'mg_quick_cut'),
      instance('normal:2', 'mg_card_knife'),
      instance('normal:3', 'mg_chain_cards'),
      instance('blank:1', MAGICIAN_BLANK_CARD_ID),
      instance('blank:2', MAGICIAN_BLANK_CARD_ID),
    ];
    session.state.player.drawPile = [];
    session.state.player.discardPile = [];
    await database.battleSessions.put(session);
    await battles.playCard(profile.id, { battleId, handIndex: 0, targetIndex: 0 });
    session = (await database.battleSessions.get(battleId))!;
    expect(session.state.enemies[0]?.hp).toBe(488);
    expect(session.state.player.hand).toHaveLength(2);
    expect(session.state.player.hand.every((card) => card.cardId === MAGICIAN_BLANK_CARD_ID)).toBe(true);

    session.state.player.ap = 20;
    session.state.player.hand = [
      instance('truth:1', 'mg_truth_revealed'),
      ...Array.from({ length: 8 }, (_, index) =>
        instance(`truth-blank:${index}`, MAGICIAN_BLANK_CARD_ID),
      ),
      instance('truth-normal:1', 'mg_quick_cut'),
    ];
    session.state.player.discardPile = [];
    session.state.enemies[0]!.hp = 500;
    await database.battleSessions.put(session);
    await battles.playCard(profile.id, { battleId, handIndex: 0, targetIndex: 0 });
    session = (await database.battleSessions.get(battleId))!;
    expect(session.state.enemies[0]?.hp).toBe(404);
    expect(session.state.player.hand.map((card) => card.cardId)).toEqual([
      'mg_quick_cut',
    ]);
    expect(blankCount(session)).toBe(0);
  });
});
