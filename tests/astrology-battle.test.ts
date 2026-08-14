import { afterEach, describe, expect, it } from 'vitest';
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

async function setup(name: string) {
  const database = new CaelianDatabase(
    'alpha',
    `caelian-astrology-${name}-${crypto.randomUUID()}`,
  );
  databases.push(database);
  const game = new GameRepository(database, new EventBus());
  const profile = await game.ensureProfile(`chat:astrology:${name}`);
  await game.execute(profile.id, {
    id: `create-astrologer:${name}`,
    type: 'player.create',
    payload: {
      name: '占星测试员',
      classMain: 'freelance',
      subclass: 'astrologer',
    },
  });
  const battles = new BattleRepository(database, () => 0);
  await battles.prepare();
  await battles.start(profile.id, {
    monsterId: 'mon_slime',
    source: '占星弹窗测试遭遇',
  });
  const session = await database.battleSessions
    .where('profileId')
    .equals(profile.id)
    .first();
  if (!session) throw new Error('测试战斗未创建');
  session.state.player.ap = 20;
  session.state.player.apMax = 20;
  session.state.player.mp = 20;
  session.state.player.mpMax = 20;
  session.state.player.hand = [
    { instanceId: 'astrology:play', cardId: 'as_astrology' },
  ];
  session.state.player.drawPile = [];
  session.state.player.discardPile = [];
  session.state.enemies[0]!.hp = 10_000;
  session.state.enemies[0]!.hpMax = 10_000;
  await database.battleSessions.put(session);
  return { database, game, profile, battles, battleId: session.id };
}

describe('占星术战斗选牌', () => {
  it('打出占星术后弹出三选一状态，选完才把临时牌加入手牌', async () => {
    const { database, game, profile, battles, battleId } = await setup('pick');

    await battles.playCard(profile.id, {
      battleId,
      handIndex: 0,
      targetIndex: 0,
    });
    let session = (await database.battleSessions.get(battleId))!;
    expect(session.state.player.pendingCardChoice).toMatchObject({
      type: 'astrology',
      title: '占星术',
      pick: 1,
      picked: [],
    });
    expect(session.state.player.pendingCardChoice?.choices).toHaveLength(3);
    expect(session.state.player.hand).toHaveLength(0);
    await expect(battles.endTurn(profile.id, battleId)).rejects.toThrow(
      '请先完成当前占星选牌',
    );

    const chosen = session.state.player.pendingCardChoice!.choices[0]!;
    const result = await game.execute(profile.id, {
      id: 'choose-astrology-card',
      type: 'battle.choose-astrology-card',
      payload: { battleId, choiceIndex: 0 },
    });
    expect(result.status).toBe('applied');
    session = (await database.battleSessions.get(battleId))!;
    expect(session.state.player.pendingCardChoice).toBeUndefined();
    expect(session.state.player.hand.map((card) => card.cardId)).toEqual([
      chosen,
    ]);
  });

  it('大占星术保留已选项，完成两次选择后才关闭弹窗', async () => {
    const { database, profile, battles, battleId } = await setup('grand');
    const session = (await database.battleSessions.get(battleId))!;
    session.state.player.hand = [
      { instanceId: 'grand:play', cardId: 'as_grand_astrology' },
    ];
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId,
      handIndex: 0,
      targetIndex: 0,
    });
    await battles.chooseAstrologyCard(profile.id, { battleId, choiceIndex: 0 });
    let current = (await database.battleSessions.get(battleId))!;
    expect(current.state.player.pendingCardChoice).toMatchObject({
      title: '大占星术',
      pick: 2,
      picked: [0],
    });
    await expect(
      battles.chooseAstrologyCard(profile.id, { battleId, choiceIndex: 0 }),
    ).rejects.toThrow('不可选择');

    await battles.chooseAstrologyCard(profile.id, { battleId, choiceIndex: 1 });
    current = (await database.battleSessions.get(battleId))!;
    expect(current.state.player.pendingCardChoice).toBeUndefined();
    expect(current.state.player.hand).toHaveLength(2);
  });
});
