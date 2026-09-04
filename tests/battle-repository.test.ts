import { afterEach, describe, expect, it } from 'vitest';
import { loadMonsterCatalog } from '@/content/catalogs/battle';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { BattleRepository } from '@/storage/repositories/battle-repository';
import { cardNameHistoryKey } from '@/battle/card-history';
import { MAX_CARD_EFFECT_HITS } from '@/battle/execution-limits';
import { GameRepository } from '@/storage/repository';
import { saveWorkshopPack } from '@/workshop';
import {
  readWorkshopMechanisms,
  saveWorkshopMechanism,
} from '@/workshop-mechanisms';

const databases: CaelianDatabase[] = [];

afterEach(async () => {
  localStorage.clear();
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

describe('本地战斗仓库', () => {
  it('在隔离测试场使用满级临时角色并让死亡木桩自动复活', async () => {
    const cards = Array.from({ length: 8 }, (_, index) => ({
      id: `custom_test_card_${index}`,
      name: `测试攻击${index + 1}`,
      type: 'attack',
      cost: 0,
      effects: [{ type: 'damage', value: 1, target: 'enemy' }],
    }));
    saveWorkshopPack({
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '测试职业包',
      classes: [
        {
          id: 'custom_class_battle_test',
          main: 'mage',
          name: '木桩测试师',
          talent: { name: '测试天赋', description: '无额外效果', effects: [] },
          cards,
          cardPool: [...cards, ...cards].map((card) => card.id),
          starterDeck: Array.from(
            { length: 15 },
            (_, index) => cards[index % cards.length]!.id,
          ),
        },
      ],
    });
    const database = new CaelianDatabase(
      'alpha',
      `caelian-workshop-battle-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:workshop-battle');
    await repository.execute(profile.id, {
      id: 'workshop-test-player-create',
      type: 'player.create',
      payload: {
        name: '测试玩家',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const playerBefore = await database.playerStates.get(profile.id);

    const started = await repository.execute(profile.id, {
      id: 'workshop-test-start',
      type: 'battle.start',
      payload: {
        workshopTest: {
          professionId: 'custom_class_battle_test',
          mechanismIds: [],
          dummyCount: 2,
          dummyHp: 1,
          dummyAttack: 100,
          dummyDefense: 0,
          dummyInvincible: false,
          dummyAttackEnabled: false,
          autoRespawn: true,
          playerInvincible: true,
          attributes: {
            hpMax: 40,
            mpMax: 30,
            attack: 220,
            defense: 180,
            speed: 100,
            actionPointsPerTurn: 6,
          },
        },
      },
    });
    expect(started.status).toBe('applied');
    let snapshot = await repository.snapshot(profile.id);
    expect(snapshot.battle?.state.workshopTest).toMatchObject({
      professionId: 'custom_class_battle_test',
      respawns: 0,
      autoRespawn: true,
    });
    expect(snapshot.battle?.state.player.subclass).toBe(
      'custom_class_battle_test',
    );

    const battleId = snapshot.battle!.id;
    await repository.execute(profile.id, {
      id: 'workshop-test-hit',
      type: 'battle.play-card',
      payload: { battleId, handIndex: 0, targetIndex: 0 },
    });
    snapshot = await repository.snapshot(profile.id);
    expect(snapshot.battle?.state.status).toBe('ongoing');
    expect(snapshot.battle?.state.enemies[0]?.hp).toBe(1);
    expect(snapshot.battle?.state.workshopTest?.respawns).toBe(1);

    await repository.execute(profile.id, {
      id: 'workshop-test-stop',
      type: 'battle.surrender',
      payload: { battleId },
    });
    const playerAfter = await database.playerStates.get(profile.id);
    expect(playerAfter).toMatchObject({
      hp: playerBefore?.hp,
      mp: playerBefore?.mp,
      gold: playerBefore?.gold,
      subclass: playerBefore?.subclass,
    });
  });

  it('在工坊实战中执行 x+y% 属性公式并移除己方护盾', async () => {
    const cards = Array.from({ length: 8 }, (_, index) => ({
      id: `custom_formula_card_${index}`,
      name: `公式卡牌${index + 1}`,
      type: 'skill',
      cost: index === 0 ? 3 : 1,
      effects:
        index === 0
          ? [
              {
                type: 'damage',
                value: 5,
                scaling: { stat: 'attack', percent: 50 },
                target: 'enemy',
              },
            ]
          : index === 1
            ? [{ type: 'strip_shield', target: 'self' }]
            : index === 2
              ? [
                  {
                    type: 'apply_buff',
                    buff: 'counterattack',
                    value: 1,
                    turns: 3,
                    target: 'self',
                  },
                ]
              : index === 3
                ? [
                    {
                      type: 'damage',
                      value: 1,
                      hits: 999_999,
                      target: 'enemy',
                    },
                  ]
              : [{ type: 'draw', value: 1, target: 'self' }],
    }));
    saveWorkshopPack({
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '公式测试职业包',
      classes: [
        {
          id: 'custom_class_formula_test',
          main: 'mage',
          name: '公式测试师',
          talent: { name: '无', description: '无', effects: [] },
          cards,
          cardPool: [...cards, ...cards].map((card) => card.id),
          starterDeck: Array.from(
            { length: 15 },
            (_, index) => cards[index % cards.length]!.id,
          ),
        },
      ],
    });
    const database = new CaelianDatabase(
      'alpha',
      `caelian-workshop-formula-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:workshop-formula');
    await game.execute(profile.id, {
      id: 'workshop-formula-player-create',
      type: 'player.create',
      payload: {
        name: '公式测试玩家',
        classMain: 'mage',
        subclass: 'fire_mage',
      },
    });
    await game.execute(profile.id, {
      id: 'workshop-formula-start',
      type: 'battle.start',
      payload: {
        workshopTest: {
          professionId: 'custom_class_formula_test',
          mechanismIds: [],
          dummyCount: 1,
          dummyHp: 500,
          dummyAttack: 0,
          dummyDefense: 0,
          dummyInvincible: false,
          dummyAttackEnabled: false,
          autoRespawn: false,
          playerInvincible: true,
          attributes: {
            hpMax: 40,
            mpMax: 30,
            attack: 40,
            defense: 0,
            speed: 0,
            actionPointsPerTurn: 10,
          },
        },
      },
    });
    let session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    session.state.player.hand.unshift(
      {
        instanceId: 'test:formula-damage',
        cardId: 'custom_formula_card_0',
      },
      {
        instanceId: 'test:strip-self',
        cardId: 'custom_formula_card_1',
      },
      {
        instanceId: 'test:counter-buff-a',
        cardId: 'custom_formula_card_2',
      },
      {
        instanceId: 'test:counter-buff-b',
        cardId: 'custom_formula_card_2',
      },
    );
    session.state.player.attack = 40;
    session.state.player.shield = 30;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    await database.battleSessions.put(session);

    await game.execute(profile.id, {
      id: 'workshop-formula-hit',
      type: 'battle.play-card',
      payload: { battleId: session.id, handIndex: 0, targetIndex: 0 },
    });
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.enemies[0]!.hp).toBe(475);

    await game.execute(profile.id, {
      id: 'workshop-strip-self',
      type: 'battle.play-card',
      payload: { battleId: session.id, handIndex: 0, targetIndex: 0 },
    });
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.player.shield).toBe(0);

    for (const suffix of ['a', 'b']) {
      await game.execute(profile.id, {
        id: `workshop-counter-buff-${suffix}`,
        type: 'battle.play-card',
        payload: { battleId: session.id, handIndex: 0, targetIndex: 0 },
      });
    }
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.player.buffs.counterattack).toMatchObject({
      value: 1,
      turns: 6,
      stacks: 1,
    });

    session.state.player.hand.unshift({
      instanceId: 'test:bounded-hits',
      cardId: 'custom_formula_card_3',
    });
    session.state.player.ap = 99;
    await database.battleSessions.put(session);
    await game.execute(profile.id, {
      id: 'workshop-bounded-hits',
      type: 'battle.play-card',
      payload: { battleId: session.id, handIndex: 0, targetIndex: 0 },
    });
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.enemies[0]!.hp).toBe(475 - MAX_CARD_EFFECT_HITS);
  });

  it('让导入代码机制读取玩家卡牌标签并改写实际伤害', async () => {
    const cards = Array.from({ length: 8 }, (_, index) => ({
      id: `custom_script_card_${index}`,
      name: `近战测试${index + 1}`,
      type: 'attack',
      tags: ['melee'],
      cost: 0,
      effects: [{ type: 'damage', value: 1, target: 'enemy' }],
    }));
    saveWorkshopPack({
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '代码机制测试职业包',
      mechanisms: [
        {
          format: 'caelian_workshop_script_mechanism',
          version: 1,
          id: 'test.melee-runtime',
          name: '近战覆写',
          triggers: ['before_damage'],
          resources: [
            {
              id: 'hits',
              label: '近战命中',
              min: 0,
              max: 99,
              initial: 0,
              visible: true,
            },
          ],
          source: `
            function handle(ctx) {
              if (!ctx.event.cardTags.includes('melee')) return {};
              return {
                resources: { hits: ctx.resources.hits + 1 },
                event: { amount: 100 }
              };
            }
          `,
        },
      ],
      classes: [
        {
          id: 'custom_class_script_battle_test',
          main: 'freelance',
          name: '脚本测试师',
          talent: { name: '无', description: '无额外效果', effects: [] },
          cards,
          cardPool: [...cards, ...cards].map((card) => card.id),
          starterDeck: Array.from(
            { length: 15 },
            (_, index) => cards[index % cards.length]!.id,
          ),
          mechanismIds: ['test.melee-runtime'],
        },
      ],
    });
    expect(
      readWorkshopMechanisms().some(
        (mechanism) => mechanism.id === 'test.melee-runtime',
      ),
    ).toBe(true);
    const database = new CaelianDatabase(
      'alpha',
      `caelian-workshop-script-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:workshop-script');
    await repository.execute(profile.id, {
      id: 'workshop-script-player-create',
      type: 'player.create',
      payload: {
        name: '代码机制测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battleRepository = new BattleRepository(database, () => 0);
    await battleRepository.prepare();
    await battleRepository.start(profile.id, {
      workshopTest: {
        professionId: 'custom_class_script_battle_test',
        mechanismIds: [],
        dummyCount: 1,
        dummyHp: 500,
        dummyAttack: 0,
        dummyDefense: 0,
        dummyInvincible: false,
        dummyAttackEnabled: false,
        autoRespawn: false,
        playerInvincible: true,
        attributes: {
          hpMax: 0,
          mpMax: 0,
          attack: 0,
          defense: 0,
          speed: 0,
          actionPointsPerTurn: 0,
        },
      },
    });
    let snapshot = await repository.snapshot(profile.id);
    const battleId = snapshot.battle!.id;
    await battleRepository.playCard(profile.id, {
      battleId,
      handIndex: 0,
      targetIndex: 0,
    });
    snapshot = await repository.snapshot(profile.id);
    expect(snapshot.battle?.state.enemies[0]?.hp).toBe(400);
    expect(
      snapshot.battle?.state.workshopMechanisms?.resources[
        'test.melee-runtime:hits'
      ],
    ).toBe(1);
  });

  it('从出战牌组创建战斗，并按旧版规则保留手牌后每回合抽三张', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-battle-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:battle', {
      playerName: '战斗测试员',
    });
    await repository.execute(profile.id, {
      id: 'battle-player-create',
      type: 'player.create',
      payload: {
        name: '战斗测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });

    const started = await repository.execute(profile.id, {
      id: 'battle-start',
      type: 'battle.start',
      payload: {
        monsterId: 'mon_slime',
        source: '测试遭遇',
      },
    });
    expect(started.status).toBe('applied');

    let snapshot = await repository.snapshot(profile.id);
    expect(snapshot.battle).not.toBeNull();
    expect(snapshot.battle?.storyTriggered).toBe(false);
    expect(snapshot.battle?.state).toMatchObject({
      schemaVersion: 1,
      status: 'ongoing',
      phase: 'player',
      turn: 1,
    });
    expect(snapshot.battle?.state.player.hand).toHaveLength(5);
    expect(
      (snapshot.battle?.state.player.hand.length ?? 0) +
        (snapshot.battle?.state.player.drawPile.length ?? 0) +
        (snapshot.battle?.state.player.discardPile.length ?? 0),
    ).toBe(16);

    const battleId = snapshot.battle!.id;
    const endedTurn = await repository.execute(profile.id, {
      id: 'battle-end-turn',
      type: 'battle.end-turn',
      payload: { battleId },
    });
    expect(endedTurn.status).toBe('applied');

    snapshot = await repository.snapshot(profile.id);
    expect(snapshot.battle?.state.turn).toBe(2);
    expect(snapshot.battle?.state.phase).toBe('player');
    expect(snapshot.battle?.state.player.hand).toHaveLength(8);
    expect(snapshot.battle?.state.player.ap).toBe(
      snapshot.battle?.state.player.apMax,
    );
  });

  it('将弃牌重抽与行动点消耗原子化保存到 IndexedDB', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-battle-discard-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:battle-discard');
    await repository.execute(profile.id, {
      id: 'discard-player-create',
      type: 'player.create',
      payload: {
        name: '弃牌测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    await repository.execute(profile.id, {
      id: 'discard-battle-start',
      type: 'battle.start',
      payload: { monsterId: 'mon_slime' },
    });

    let snapshot = await repository.snapshot(profile.id);
    const battleId = snapshot.battle!.id;
    const initialAp = snapshot.battle!.state.player.ap;
    const session = await database.battleSessions.get(battleId);
    session!.state.player.hp = session!.state.player.hpMax;
    session!.state.player.buffs.blood_burn = {
      value: 20,
      turns: 2,
      stacks: 2,
    };
    const expectedBloodBurnLoss =
      Math.max(1, Math.floor(session!.state.player.hpMax * 0.02)) * 2;
    await database.battleSessions.put(session!);
    const result = await repository.execute(profile.id, {
      id: 'discard-hand',
      type: 'battle.discard-hand',
      payload: { battleId },
    });
    expect(result.status).toBe('applied');

    snapshot = await repository.snapshot(profile.id);
    expect(snapshot.battle?.state.player.ap).toBe(initialAp - 1);
    expect(snapshot.battle?.state.player.hand).toHaveLength(3);
    expect(snapshot.battle?.state.player.discardPile).toHaveLength(5);
    expect(snapshot.battle?.state.player.hp).toBe(
      snapshot.battle!.state.player.hpMax - expectedBloodBurnLoss,
    );
  });

  it('在玩家行动阶段从背包使用回血、回蓝与增益药剂并实时扣除数量', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-battle-item-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:battle-items');
    await repository.execute(profile.id, {
      id: 'item-player-create',
      type: 'player.create',
      payload: {
        name: '药剂测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    for (const item of ['小血瓶', '小魔药瓶', '力量药水']) {
      await repository.execute(profile.id, {
        id: `grant:${item}`,
        type: 'inventory.adjust',
        payload: { itemId: item, name: item, delta: 1 },
      });
    }
    await repository.execute(profile.id, {
      id: 'item-battle-start',
      type: 'battle.start',
      payload: { monsterId: 'mon_slime' },
    });

    let snapshot = await repository.snapshot(profile.id);
    const battleId = snapshot.battle!.id;
    const session = await database.battleSessions.get(battleId);
    session!.state.player.hp = 35;
    session!.state.player.mp = 4;
    const initialAp = session!.state.player.ap;
    await database.battleSessions.put(session!);

    for (const itemId of ['小血瓶', '小魔药瓶', '力量药水']) {
      await expect(
        repository.execute(profile.id, {
          id: `use:${itemId}`,
          type: 'battle.use-item',
          payload: { battleId, itemId },
        }),
      ).resolves.toMatchObject({ status: 'applied' });
    }

    snapshot = await repository.snapshot(profile.id);
    expect(snapshot.battle?.state.player).toMatchObject({
      hp: 60,
      mp: 14,
      ap: initialAp,
      buffs: { strength: { value: 5, turns: 3 } },
    });
    expect(snapshot.inventory).toEqual([]);
    expect(snapshot.achievements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          achievementId: 'ach_consumable_heal_hp',
          unlocked: true,
        }),
      ]),
    );
    expect(
      snapshot.battle?.state.log.map((entry) => entry.text),
    ).toEqual(
      expect.arrayContaining([
        '小血瓶恢复 25 HP',
        '小魔药瓶恢复 10 MP',
        '力量药水赋予 strength 5，持续 3 回合',
      ]),
    );
  });

  it('拒绝在战斗中即时使用标注为下一场生效的药剂', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-battle-next-item-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:next-battle-item');
    await repository.execute(profile.id, {
      id: 'next-item-player-create',
      type: 'player.create',
      payload: {
        name: '秘药测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    await repository.execute(profile.id, {
      id: 'grant-next-item',
      type: 'inventory.adjust',
      payload: { itemId: '力量秘药', name: '力量秘药', delta: 1 },
    });
    await repository.execute(profile.id, {
      id: 'next-item-battle-start',
      type: 'battle.start',
      payload: { monsterId: 'mon_slime' },
    });
    const snapshot = await repository.snapshot(profile.id);

    await expect(
      repository.execute(profile.id, {
        id: 'use-next-item',
        type: 'battle.use-item',
        payload: {
          battleId: snapshot.battle!.id,
          itemId: '力量秘药',
        },
      }),
    ).rejects.toThrow('不能在当前战斗中即时使用');
    expect((await repository.snapshot(profile.id)).inventory).toEqual([
      expect.objectContaining({ itemId: '力量秘药', quantity: 1 }),
    ]);
  });

  it('在战斗前消耗秘药，并把增益带入下一场战斗', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-battle-preparation-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:battle-preparation');
    await repository.execute(profile.id, {
      id: 'preparation-player-create',
      type: 'player.create',
      payload: {
        name: '战前药剂测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    await repository.execute(profile.id, {
      id: 'grant-preparation-item',
      type: 'inventory.adjust',
      payload: { itemId: '力量秘药', name: '力量秘药', delta: 1 },
    });
    await repository.execute(profile.id, {
      id: 'prepare-battle-item',
      type: 'battle.prepare-item',
      payload: { itemId: '力量秘药' },
    });
    expect((await repository.snapshot(profile.id)).inventory).toEqual([]);

    await repository.execute(profile.id, {
      id: 'prepared-battle-start',
      type: 'battle.start',
      payload: { monsterId: 'mon_slime' },
    });
    const snapshot = await repository.snapshot(profile.id);
    expect(snapshot.battle?.state.player.buffs.strength).toMatchObject({
      value: 5,
      turns: 3,
      fresh: true,
    });
    expect(snapshot.player.pendingBattleEffects).toEqual([]);
  });

  it('按实际结算顺序保存敌方攻击、伤害与回合结束动画事件', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-battle-animation-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:battle-animation');
    await repository.execute(profile.id, {
      id: 'animation-player-create',
      type: 'player.create',
      payload: {
        name: '动画测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battleRepository = new BattleRepository(database, () => 0.5);
    await battleRepository.prepare();
    await battleRepository.start(profile.id, {
      monsterId: 'mon_slime',
      count: 1,
    });

    let snapshot = await repository.snapshot(profile.id);
    const battleId = snapshot.battle!.id;
    const initialEventCount =
      snapshot.battle!.state.animations?.length ?? 0;
    await battleRepository.endTurn(profile.id, battleId);

    snapshot = await repository.snapshot(profile.id);
    const events =
      snapshot.battle!.state.animations?.slice(initialEventCount) ?? [];
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['turn', 'enemy-action', 'damage']),
    );
    expect(events.find((event) => event.kind === 'damage')).toMatchObject({
      sourceSide: 'enemy',
      targetSide: 'player',
      targetId: 'player',
    });
    expect(events.at(-1)).toMatchObject({
      kind: 'turn',
      phaseAfter: 'player',
      turnAfter: 2,
    });
  });

  it('按旧版让速度、敏捷、坚韧和百分比减伤参与实际结算', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-battle-legacy-stats-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:battle-legacy-stats');
    await repository.execute(profile.id, {
      id: 'legacy-stats-player-create',
      type: 'player.create',
      payload: {
        name: '旧版属性测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battleRepository = new BattleRepository(database, () => 0.5);
    await battleRepository.prepare();
    await battleRepository.start(profile.id, {
      monsterId: 'mon_slime',
      count: 1,
    });

    let snapshot = await repository.snapshot(profile.id);
    const battleId = snapshot.battle!.id;
    const session = await database.battleSessions.get(battleId);
    expect(session).toBeDefined();
    session!.state.player.buffs.agility = { value: 95, turns: 2 };
    const hpBeforeDodge = session!.state.player.hp;
    await database.battleSessions.put(session!);
    await battleRepository.endTurn(profile.id, battleId);

    snapshot = await repository.snapshot(profile.id);
    expect(snapshot.battle!.state.player.hp).toBe(hpBeforeDodge);
    expect(snapshot.battle!.state.log.some((entry) => entry.text.includes('敏捷/速度闪避'))).toBe(true);

    const secondSession = await database.battleSessions.get(battleId);
    secondSession!.state.player.buffs = {
      fortitude: { value: 50, turns: 2 },
      damage_resist: { value: 50, turns: 2 },
    };
    secondSession!.state.player.speed = 0;
    secondSession!.state.player.defense = 0;
    secondSession!.state.enemies[0]!.intent = {
      skillId: 'attack',
      name: '普通攻击',
      kind: '攻击',
      description: '减伤公式回归用的固定攻击。',
      amount: secondSession!.state.enemies[0]!.attack,
      hits: 1,
    };
    const hpBeforeDefense = secondSession!.state.player.hp;
    await database.battleSessions.put(secondSession!);
    await battleRepository.endTurn(profile.id, battleId);

    snapshot = await repository.snapshot(profile.id);
    expect(hpBeforeDefense - snapshot.battle!.state.player.hp).toBe(1);
  });

  it('按攻击前护盾结算双向防反，并让天赋与buff分别叠加反击次数', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-battle-reactions-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:battle-reactions');
    await game.execute(profile.id, {
      id: 'battle-reactions-player-create',
      type: 'player.create',
      payload: {
        name: '反应测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battles = new BattleRepository(database, () => 0.5);
    await battles.prepare();
    await battles.start(profile.id, { monsterId: 'mon_slime', count: 1 });

    let session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    const player = session.state.player;
    const enemy = session.state.enemies[0]!;
    player.hpMax = 200;
    player.hp = 200;
    player.attack = 100;
    player.defense = 50;
    player.speed = 0;
    player.shield = 20;
    player.buffs = {
      defense_reflect: { value: 1, turns: 3 },
    };
    player.debuffs = {};
    player.passiveEffects = [{ type: 'defense_reflect' }];
    enemy.hpMax = 200;
    enemy.hp = 200;
    enemy.attack = 10;
    enemy.defense = 0;
    enemy.speed = 0;
    enemy.shield = 5;
    enemy.buffs = {};
    enemy.debuffs = {};
    enemy.intent = null;
    await database.battleSessions.put(session);

    await battles.endTurn(profile.id, session.id);
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.enemies[0]).toMatchObject({ hp: 197, shield: 0 });
    expect(session.state.player.shield).toBe(19);
    expect(
      session.state.animations?.filter((event) => event.label === '防反'),
    ).toHaveLength(1);

    session.state.player.hp = 200;
    session.state.player.shield = 100;
    session.state.player.attack = 100;
    session.state.player.buffs = {
      counterattack: { value: 1, turns: 3 },
      blood_burn: { value: 0, turns: 3, stacks: 1 },
    };
    session.state.player.passiveEffects = [{ type: 'counterattack' }];
    session.state.enemies[0]!.hp = 200;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.attack = 10;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.buffs = {};
    session.state.enemies[0]!.debuffs = {};
    session.state.enemies[0]!.intent = null;
    await database.battleSessions.put(session);

    await battles.endTurn(profile.id, session.id);
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.enemies[0]!.hp).toBe(180);
    expect(session.state.player.hp).toBe(192);
    expect(
      session.state.animations?.filter((event) =>
        String(event.label).startsWith('反击'),
      ),
    ).toHaveLength(2);

    session.state.player.hp = 200;
    session.state.player.shield = 5;
    session.state.player.attack = 0;
    session.state.player.ap = 10;
    session.state.player.buffs = {};
    session.state.player.passiveEffects = [];
    session.state.player.hand.unshift({
      instanceId: 'test:enemy-defense-reflect',
      cardId: 'hk_lumen_slash',
    });
    session.state.enemies[0]!.hp = 200;
    session.state.enemies[0]!.shield = 10;
    session.state.enemies[0]!.defense = 250;
    session.state.enemies[0]!.buffs = {
      defense_reflect: { value: 1, turns: 3 },
    };
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.player).toMatchObject({ hp: 193, shield: 0 });
    expect(
      session.state.animations?.at(-2)?.label === '防反' ||
        session.state.animations?.at(-1)?.label === '防反',
    ).toBe(true);
  });

  it('多段攻击每段都按该段攻击前的当前护盾重新计算防反', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'defense-reflect-multi-hit',
      'holy_knight',
      () => 0.5,
    );
    session.state.player.hp = session.state.player.hpMax = 200;
    session.state.player.shield = 20;
    session.state.player.defense = 50;
    session.state.player.speed = 0;
    session.state.player.buffs = {
      defense_reflect: { value: 1, turns: 3 },
    };
    session.state.player.debuffs = {};
    session.state.player.passiveEffects = [];
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 200;
    session.state.enemies[0]!.attack = 20;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.buffs = {};
    session.state.enemies[0]!.debuffs = {};
    session.state.enemies[0]!.intent = {
      skillId: 'frenzy',
      name: '狂乱撕咬',
      kind: '连击',
      description: '测试两段攻击',
      amount: 20,
      hits: 2,
    };
    await database.battleSessions.put(session);

    await battles.endTurn(profile.id, session.id);

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.shield).toBe(8);
    expect(current.state.enemies[0]!.hp).toBe(186);
    expect(
      current.state.animations
        ?.filter((event) => event.label === '防反')
        .map((event) => event.amount),
    ).toEqual([8, 6]);
  });

  it('双方同时拥有防反时只结算原攻击目标的一次防反', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'defense-reflect-no-recursion',
      'holy_knight',
    );
    session.state.player.hp = session.state.player.hpMax = 200;
    session.state.player.attack = 0;
    session.state.player.ap = 10;
    session.state.player.shield = 10;
    session.state.player.defense = 100;
    session.state.player.speed = 0;
    session.state.player.buffs = {
      defense_reflect: { value: 1, turns: 3 },
    };
    session.state.player.debuffs = {};
    session.state.player.passiveEffects = [];
    session.state.player.hand = [
      {
        instanceId: 'test:defense-reflect-no-recursion',
        cardId: 'hk_lumen_slash',
      },
    ];
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 200;
    session.state.enemies[0]!.shield = 10;
    session.state.enemies[0]!.defense = 100;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.buffs = {
      defense_reflect: { value: 1, turns: 3 },
    };
    session.state.enemies[0]!.debuffs = {};
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });

    const current = (await database.battleSessions.get(session.id))!;
    const reflectEvents = current.state.animations?.filter(
      (event) => event.label === '防反',
    );
    expect(reflectEvents).toHaveLength(1);
    expect(reflectEvents?.[0]?.amount).toBe(8);
    expect(current.state.player).toMatchObject({ hp: 200, shield: 2 });
  });

  it('新防反造成的伤害不会触发旧荆棘的二次反弹', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'defense-reflect-does-not-trigger-thorns',
      'holy_knight',
    );
    session.state.player.hp = session.state.player.hpMax = 200;
    session.state.player.attack = 0;
    session.state.player.ap = 10;
    session.state.player.shield = 0;
    session.state.player.speed = 0;
    session.state.player.buffs = {
      thorns: { value: 7, turns: 3 },
    };
    session.state.player.debuffs = {};
    session.state.player.passiveEffects = [];
    session.state.player.hand = [
      {
        instanceId: 'test:defense-reflect-does-not-trigger-thorns',
        cardId: 'hk_lumen_slash',
      },
    ];
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 200;
    session.state.enemies[0]!.shield = 10;
    session.state.enemies[0]!.defense = 100;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.buffs = {
      defense_reflect: { value: 1, turns: 3 },
    };
    session.state.enemies[0]!.debuffs = {};
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.hp).toBe(192);
    expect(current.state.enemies[0]).toMatchObject({ hp: 200, shield: 9 });
    expect(
      current.state.animations?.filter(
        (event) => event.label === '荆棘反弹',
      ),
    ).toHaveLength(0);
  });

  it('工坊before_damage机制不能改写防反的固定公式伤害', async () => {
    const mechanismId = 'test.fixed-defense-reflect';
    saveWorkshopMechanism({
      format: 'caelian_workshop_script_mechanism',
      version: 1,
      id: mechanismId,
      name: '防反固定伤害测试',
      triggers: ['before_damage'],
      resources: [],
      source: `
        function handle(ctx) {
          if (ctx.event.origin !== 'defense_reflect') return {};
          return { event: { amount: 999 } };
        }
      `,
    });
    const { database, profile, battles, session } = await createStartedBattle(
      'defense-reflect-fixed-damage',
      'holy_knight',
      () => 0.5,
    );
    session.state.workshopMechanisms = {
      ids: [mechanismId],
      resources: {},
      fired: [],
      disabled: [],
      errors: {},
    };
    session.state.player.hp = session.state.player.hpMax = 200;
    session.state.player.shield = 10;
    session.state.player.defense = 100;
    session.state.player.speed = 0;
    session.state.player.buffs = {
      defense_reflect: { value: 1, turns: 3 },
    };
    session.state.player.debuffs = {};
    session.state.player.passiveEffects = [];
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 200;
    session.state.enemies[0]!.attack = 10;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.buffs = {};
    session.state.enemies[0]!.debuffs = {};
    session.state.enemies[0]!.intent = null;
    await database.battleSessions.put(session);

    await battles.endTurn(profile.id, session.id);

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(192);
    expect(
      current.state.animations?.find((event) => event.label === '防反')?.amount,
    ).toBe(8);
  });

  it('防反公式锁定零防御、150%上限与四舍五入边界', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'defense-reflect-formula-boundaries',
      'holy_knight',
    );
    let caseIndex = 0;
    const resolveCase = async (
      defense: number,
      shield: number,
    ): Promise<{ damage: number; reflected: number[] }> => {
      let current = (await database.battleSessions.get(session.id))!;
      current.state.player.hp = current.state.player.hpMax = 200;
      current.state.player.attack = 0;
      current.state.player.ap = 10;
      current.state.player.shield = 0;
      current.state.player.speed = 0;
      current.state.player.buffs = {};
      current.state.player.debuffs = {};
      current.state.player.passiveEffects = [];
      current.state.player.hand = [
        {
          instanceId: `test:defense-reflect-boundary:${caseIndex}`,
          cardId: 'hk_lumen_slash',
        },
      ];
      current.state.enemies[0]!.hp = current.state.enemies[0]!.hpMax = 1_000;
      current.state.enemies[0]!.shield = shield;
      current.state.enemies[0]!.defense = defense;
      current.state.enemies[0]!.speed = 0;
      current.state.enemies[0]!.buffs = {
        defense_reflect: { value: 1, turns: 3 },
      };
      current.state.enemies[0]!.debuffs = {};
      const reflectedBefore =
        current.state.animations?.filter((event) => event.label === '防反')
          .length ?? 0;
      await database.battleSessions.put(current);

      await battles.playCard(profile.id, {
        battleId: session.id,
        handIndex: 0,
        targetIndex: 0,
      });

      current = (await database.battleSessions.get(session.id))!;
      caseIndex += 1;
      return {
        damage: 200 - current.state.player.hp,
        reflected:
          current.state.animations
            ?.filter((event) => event.label === '防反')
            .slice(reflectedBefore)
            .map((event) => Number(event.amount)) ?? [],
      };
    };

    await expect(resolveCase(0, 10)).resolves.toEqual({
      damage: 0,
      reflected: [],
    });
    await expect(resolveCase(150, 10)).resolves.toEqual({
      damage: 12,
      reflected: [12],
    });
    await expect(resolveCase(300, 10)).resolves.toEqual({
      damage: 12,
      reflected: [12],
    });
    await expect(resolveCase(50, 1)).resolves.toEqual({
      damage: 0,
      reflected: [],
    });
    await expect(resolveCase(63, 1)).resolves.toEqual({
      damage: 1,
      reflected: [1],
    });
  });

  it('按旧版实际结算冻结、再生、流血与濒死保护', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-battle-legacy-status-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:battle-legacy-status');
    await repository.execute(profile.id, {
      id: 'legacy-status-player-create',
      type: 'player.create',
      payload: {
        name: '旧版状态测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battleRepository = new BattleRepository(database, () => 0.5);
    await battleRepository.prepare();
    await battleRepository.start(profile.id, {
      monsterId: 'mon_slime',
      count: 1,
    });

    let snapshot = await repository.snapshot(profile.id);
    const battleId = snapshot.battle!.id;
    let session = await database.battleSessions.get(battleId);
    const enemy = session!.state.enemies[0]!;
    enemy.debuffs.freeze = { value: 1, turns: 2 };
    session!.state.player.hp = session!.state.player.hpMax - 10;
    session!.state.player.buffs.regen = { value: 3, turns: 2 };
    session!.state.player.debuffs.bleed = { value: 2, turns: 2 };
    const hpBeforeStatuses = session!.state.player.hp;
    const expectedBleed = 2 + Math.floor(enemy.attack * 0.06);
    await database.battleSessions.put(session!);
    await battleRepository.endTurn(profile.id, battleId);

    snapshot = await repository.snapshot(profile.id);
    expect(snapshot.battle!.state.player.hp).toBe(
      hpBeforeStatuses + 3 - expectedBleed,
    );
    expect(
      snapshot.battle!.state.log.some((entry) =>
        entry.text.includes('被冰冻，跳过行动'),
      ),
    ).toBe(true);

    session = await database.battleSessions.get(battleId);
    session!.state.player.hp = 1;
    session!.state.player.shield = 0;
    session!.state.player.speed = 0;
    session!.state.player.defense = 0;
    session!.state.player.buffs = {
      death_save: { value: 1, turns: 2, charges: 1 },
    };
    session!.state.player.debuffs = {};
    session!.state.enemies[0]!.debuffs = {};
    session!.state.enemies[0]!.intent = null;
    await database.battleSessions.put(session!);
    await battleRepository.endTurn(profile.id, battleId);

    snapshot = await repository.snapshot(profile.id);
    expect(snapshot.battle!.state.player.hp).toBe(1);
    expect(snapshot.battle!.state.player.buffs.death_save).toBeUndefined();
    expect(
      snapshot.battle!.state.log.some((entry) =>
        entry.text.includes('守护效果抵挡了致命伤'),
      ),
    ).toBe(true);
  });

  it('按旧版概率为普通怪物生成迅捷词缀和敏捷效果', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-battle-swift-affix-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:battle-swift-affix');
    await repository.execute(profile.id, {
      id: 'swift-affix-player-create',
      type: 'player.create',
      payload: {
        name: '词缀测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battleRepository = new BattleRepository(database, () => 0);
    await battleRepository.prepare();
    await battleRepository.start(profile.id, {
      monsterId: 'mon_slime',
      count: 1,
    });

    const enemy = (await repository.snapshot(profile.id)).battle!.state.enemies[0]!;
    expect(enemy).toMatchObject({
      affix: 'swift',
      affixName: '迅捷',
      buffs: { agility: { value: 8, turns: 2 } },
    });
    expect(enemy.name).toMatch(/^迅捷/);
  });

  it('探索时只从当前地区加权抽取怪物，并能生成独立的群体敌人', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-battle-explore-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:battle-explore');
    await repository.execute(profile.id, {
      id: 'explore-player-create',
      type: 'player.create',
      payload: {
        name: '地区探索员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battleRepository = new BattleRepository(database, () => 0);
    await battleRepository.prepare();
    await battleRepository.start(profile.id, {});

    const snapshot = await repository.snapshot(profile.id);
    const catalog = await loadMonsterCatalog();
    const definitionId = snapshot.battle!.state.enemies[0]!.definitionId;
    expect(catalog[definitionId]?.regions).toContain(snapshot.world.region);
    expect(snapshot.battle?.state.enemies).toHaveLength(3);
    expect(
      new Set(snapshot.battle?.state.enemies.map((enemy) => enemy.id)).size,
    ).toBe(3);
  });

  it('玩家等级与冒险难度会共同提高同一怪物的动态战斗属性', async () => {
    async function createScaledEnemy(
      level: number,
      difficulty: 'normal' | 'hell',
    ) {
      const database = new CaelianDatabase(
        'alpha',
        `caelian-battle-scale-test-${crypto.randomUUID()}`,
      );
      databases.push(database);
      const repository = new GameRepository(database, new EventBus());
      const profile = await repository.ensureProfile(
        `chat:scale:${level}:${difficulty}`,
      );
      await repository.execute(profile.id, {
        id: `scale-player-create:${level}:${difficulty}`,
        type: 'player.create',
        payload: {
          name: '强度测试员',
          classMain: 'knight',
          subclass: 'holy_knight',
        },
      });
      await repository.execute(profile.id, {
        id: `scale-player-level:${level}:${difficulty}`,
        type: 'player.update',
        payload: { level },
      });
      await repository.execute(profile.id, {
        id: `scale-difficulty:${level}:${difficulty}`,
        type: 'settings.update',
        payload: { battleDifficulty: difficulty },
      });
      const battleRepository = new BattleRepository(database, () => 0.5);
      await battleRepository.prepare();
      await battleRepository.start(profile.id, {
        monsterId: 'mon_slime',
        count: 1,
      });
      return (await repository.snapshot(profile.id)).battle!.state.enemies[0]!;
    }

    const normalLevelOne = await createScaledEnemy(1, 'normal');
    const hellLevelTen = await createScaledEnemy(10, 'hell');
    expect(hellLevelTen.hpMax).toBeGreaterThan(normalLevelOne.hpMax);
    expect(hellLevelTen.attack).toBeGreaterThan(normalLevelOne.attack);
    expect(hellLevelTen.defense).toBeGreaterThan(normalLevelOne.defense);
  });

  it('让凯利安按本场固定序列消耗剩余AP并逐个生成行动动画', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-companion-sequence-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:companion-sequence');
    await game.execute(profile.id, {
      id: 'companion-sequence-player-create',
      type: 'player.create',
      payload: {
        name: '同行测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    await game.execute(profile.id, {
      id: 'companion-sequence-player-level',
      type: 'player.update',
      payload: { level: 6 },
    });
    let roll = 0.24;
    const battles = new BattleRepository(database, () => roll);
    await battles.prepare();
    await battles.start(profile.id, {
      monsterId: 'mon_slime',
      companionPresent: true,
      storyTriggered: true,
    });

    let session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    const companion = session.state.companion!;
    expect(companion).toMatchObject({
      level: 6,
      hp: companion.hpMax,
      injured: false,
    });
    expect(companion.summons[0]).toMatchObject({
      id: 'trelio',
      hp: companion.summons[0]!.hpMax,
    });
    const originalSequence = companion.actionSequence.map((skill) => skill.id);
    const startingIndex = companion.actionIndex;
    session.state.player.ap = 5;
    session.state.enemies[0]!.hp = 100_000;
    session.state.enemies[0]!.hpMax = 100_000;
    session.state.enemies[0]!.attack = 0;
    session.state.enemies[0]!.intent = null;
    companion.attack = 0;
    companion.summons[0]!.attack = 0;
    const previousAnimationCount = session.state.animations?.length ?? 0;
    await database.battleSessions.put(session);

    let remaining = 5;
    const expectedSkills = [] as typeof companion.actionSequence;
    while (expectedSkills.length < companion.actionSequence.length) {
      const skill = companion.actionSequence[
        (startingIndex + expectedSkills.length) % companion.actionSequence.length
      ]!;
      if (skill.apCost > remaining) break;
      remaining -= skill.apCost;
      expectedSkills.push(skill);
    }
    roll = 0.24;
    await battles.endTurn(profile.id, session.id);
    session = (await database.battleSessions.get(session.id))!;
    const newAnimations = (session.state.animations ?? []).slice(
      previousAnimationCount,
    );
    const caelianActions = newAnimations.filter(
      (event) =>
        event.kind === 'companion-action' &&
        event.sourceSide === 'companion',
    );
    expect(caelianActions.map((event) => event.label)).toEqual(
      expectedSkills.map((skill) => skill.name),
    );
    expect(caelianActions.map((event) => event.apAfter)).toEqual(
      expectedSkills.map((_, index) =>
        5 - expectedSkills
          .slice(0, index + 1)
          .reduce((total, skill) => total + skill.apCost, 0),
      ),
    );
    expect(session.state.companion?.actionSequence.map((skill) => skill.id)).toEqual(
      originalSequence,
    );
    expect(session.state.companion?.actionIndex).toBe(
      (startingIndex + expectedSkills.length) % originalSequence.length,
    );
    const lastCompanionAnimation = Math.max(
      ...newAnimations
        .map((event, index) =>
          ['companion', 'summon'].includes(event.sourceSide ?? '') ? index : -1,
        ),
    );
    const firstEnemyAnimation = newAnimations.findIndex(
      (event) => event.kind === 'enemy-action',
    );
    expect(lastCompanionAnimation).toBeLessThan(firstEnemyAnimation);

    const retainedIndex = session.state.companion!.actionIndex;
    session.state.player.ap = 0;
    const beforeNoAp = session.state.animations?.length ?? 0;
    await database.battleSessions.put(session);
    await battles.endTurn(profile.id, session.id);
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.companion?.actionIndex).toBe(retainedIndex);
    expect(
      (session.state.animations ?? [])
        .slice(beforeNoAp)
        .filter((event) => event.sourceSide === 'companion'),
    ).toHaveLength(0);
  });

  it('允许治疗牌选择凯利安，未选择己方目标时则默认治疗玩家', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-friendly-target-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:friendly-target');
    await game.execute(profile.id, {
      id: 'friendly-target-player-create',
      type: 'player.create',
      payload: {
        name: '治疗目标测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battles = new BattleRepository(database, () => 0.4);
    await battles.prepare();
    await battles.start(profile.id, {
      monsterId: 'mon_slime',
      companionPresent: true,
    });
    let session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    const playerHp = session.state.player.hpMax - 12;
    const companionHp = session.state.companion!.hpMax - 20;
    session.state.player.hp = playerHp;
    session.state.companion!.hp = companionHp;
    session.state.player.ap = 10;
    session.state.player.hand.unshift({
      instanceId: 'test:caelian-heal',
      cardId: 'hk_holy_heal',
    });
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      allyTargetId: 'caelian',
    });
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.player.hp).toBe(playerHp);
    expect(session.state.companion!.hp).toBeGreaterThan(companionHp);

    const healedCompanionHp = session.state.companion!.hp;
    session.state.player.ap = 10;
    session.state.player.hand.unshift({
      instanceId: 'test:default-player-heal',
      cardId: 'hk_holy_heal',
    });
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
    });
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.player.hp).toBeGreaterThan(playerHp);
    expect(session.state.companion!.hp).toBe(healedCompanionHp);
  });

  it('敌人可以击伤凯利安，重伤后凯利安停止行动且无法被治疗', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-injury-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:caelian-injury');
    await game.execute(profile.id, {
      id: 'caelian-injury-player-create',
      type: 'player.create',
      payload: {
        name: '重伤测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    let roll = 0;
    const battles = new BattleRepository(database, () => roll);
    await battles.prepare();
    await battles.start(profile.id, {
      monsterId: 'mon_slime',
      companionPresent: true,
    });
    let session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    session.state.player.ap = 0;
    session.state.companion!.hp = 1;
    session.state.companion!.defense = 0;
    session.state.companion!.speed = 0;
    session.state.companion!.summons[0]!.attack = 0;
    session.state.enemies[0]!.hp = 100_000;
    session.state.enemies[0]!.hpMax = 100_000;
    session.state.enemies[0]!.attack = 1_000;
    session.state.enemies[0]!.intent = null;
    await database.battleSessions.put(session);
    roll = 0.5;
    await battles.endTurn(profile.id, session.id);
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.companion).toMatchObject({
      hp: 0,
      shield: 0,
      injured: true,
    });

    const retainedIndex = session.state.companion!.actionIndex;
    session.state.player.ap = 10;
    session.state.player.hand.unshift({
      instanceId: 'test:injured-heal',
      cardId: 'hk_holy_heal',
    });
    await database.battleSessions.put(session);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      allyTargetId: 'caelian',
    });
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.companion).toMatchObject({
      hp: 0,
      shield: 0,
      injured: true,
      actionIndex: retainedIndex,
    });
  });

  it('按旧版把牧师对自己的过量治疗等量转化为当前目标伤害', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-priest-overheal-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:priest-overheal');
    await game.execute(profile.id, {
      id: 'priest-overheal-player-create',
      type: 'player.create',
      payload: {
        name: '过量治疗测试员',
        classMain: 'freelance',
        subclass: 'priest',
      },
    });
    const battles = new BattleRepository(database, () => 0);
    await battles.prepare();
    await battles.start(profile.id, { monsterId: 'mon_slime', count: 1 });

    let session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    const target = session.state.enemies[0]!;
    session.state.player.hp = session.state.player.hpMax;
    session.state.player.ap = 10;
    session.state.player.buffs.strength = { value: 200, turns: 2 };
    session.state.player.debuffs.weak = { value: 1, turns: 2 };
    session.state.player.hand.unshift({
      instanceId: 'test:priest-overheal',
      cardId: 'pr_heal',
    });
    target.hp = 1_000;
    target.hpMax = 1_000;
    target.defense = 1_000;
    target.speed = 1_000;
    target.buffs.damage_halve = { value: 1, turns: 2, charges: 1 };
    target.debuffs.vulnerable = { value: 1, turns: 2 };
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      allyTargetId: 'player',
    });
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.player.hp).toBe(session.state.player.hpMax);
    expect(session.state.enemies[0]!.hp).toBe(986);
    expect(session.state.enemies[0]!.buffs.damage_halve).toBeDefined();
    expect(
      session.state.animations?.some(
        (event) =>
          event.kind === 'damage' &&
          event.amount === 14 &&
          event.label === '过量治疗转化',
      ),
    ).toBe(true);
  });

  it('让攻击力同时进入攻击牌与中毒、灼烧、流血、腐蚀乘区', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-player-attack-scaling-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:player-attack-scaling');
    await game.execute(profile.id, {
      id: 'attack-scaling-player-create',
      type: 'player.create',
      payload: {
        name: '攻击乘区测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battles = new BattleRepository(database, () => 0.99);
    await battles.prepare();
    await battles.start(profile.id, { monsterId: 'mon_slime', count: 1 });

    let session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    session.state.player.attack = 20;
    session.state.player.ap = 10;
    session.state.player.hand.unshift({
      instanceId: 'test:attack-scaling',
      cardId: 'hk_lumen_slash',
    });
    const target = session.state.enemies[0]!;
    target.hp = 1_000;
    target.hpMax = 1_000;
    target.defense = 0;
    target.speed = 0;
    target.buffs = {};
    target.debuffs = {};
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.enemies[0]!.hp).toBe(985);

    const dottedTarget = session.state.enemies[0]!;
    dottedTarget.attack = 0;
    dottedTarget.intent = null;
    dottedTarget.shield = 100;
    dottedTarget.debuffs = {
      poison: { value: 4, turns: 2 },
      burn: { value: 2, turns: 2 },
      bleed: { value: 3, turns: 2 },
      corrosion: { value: 5, turns: 2 },
      freeze: { value: 1, turns: 2 },
    };
    await database.battleSessions.put(session);

    await battles.endTurn(profile.id, session.id);
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.enemies[0]).toMatchObject({
      hp: 972,
      shield: 94,
    });
  });

  it('自动探索群体遭遇会组合当前地区的不同怪物', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-mixed-encounter-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:mixed-encounter');
    await game.execute(profile.id, {
      id: 'mixed-encounter-player-create',
      type: 'player.create',
      payload: {
        name: '混合遭遇测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battles = new BattleRepository(database, () => 0);
    await battles.prepare();
    await battles.start(profile.id, {});

    const session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    expect(session.state.enemies.length).toBeGreaterThan(1);
    expect(
      new Set(session.state.enemies.map((enemy) => enemy.definitionId)).size,
    ).toBeGreaterThan(1);
    expect(session.source).toContain('混合群体遭遇');
  });

  it('怪物净化者优先行动并解除队友冻结，使队友能够继续行动', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-enemy-team-cleanse-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:enemy-team-cleanse');
    await game.execute(profile.id, {
      id: 'enemy-team-cleanse-player-create',
      type: 'player.create',
      payload: {
        name: '怪物联动测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battles = new BattleRepository(database, () => 0.5);
    await battles.prepare();
    await battles.start(profile.id, {
      monsterId: 'mon_false_priest',
      count: 2,
    });

    let session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    const purifier = session.state.enemies[0]!;
    const frozenAlly = session.state.enemies[1]!;
    session.state.player.ap = 0;
    session.state.player.hp = session.state.player.hpMax = 10_000;
    purifier.attack = 0;
    frozenAlly.attack = 0;
    purifier.intent = {
      skillId: 'false_absolution',
      name: '伪典赦免',
      kind: '净化',
      description: '为怪物队伍净化全部减益。',
      amount: 0,
      hits: 1,
    };
    frozenAlly.intent = {
      skillId: 'attack',
      name: '攻击',
      kind: '攻击',
      description: '',
      amount: 1,
      hits: 1,
    };
    frozenAlly.debuffs.freeze = { value: 1, turns: 3 };
    const animationStart = session.state.animations?.length ?? 0;
    await database.battleSessions.put(session);

    await battles.endTurn(profile.id, session.id);
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.enemies[1]!.debuffs.freeze).toBeUndefined();
    expect(
      (session.state.animations ?? [])
        .slice(animationStart)
        .some(
          (animation) =>
            animation.kind === 'enemy-action' &&
            animation.sourceId === frozenAlly.id,
        ),
    ).toBe(true);
    expect(
      session.state.log.some((entry) =>
        entry.text.includes('为怪物队伍净化了'),
      ),
    ).toBe(true);
  });

  it('支付 HP 条件积木会扣除生命，并让后续伤害保留职业增伤', async () => {
    const cards = Array.from({ length: 8 }, (_, index) => ({
      id: `custom_hp_cost_${index}`,
      name: `血契试作${index + 1}`,
      type: 'spell',
      cost: 1,
      effects: [
        {
          type: 'conditional_group',
          logic: 'and',
          conditions: [{ type: 'spend_hp', amount: 5 }],
          then_effects: [{ type: 'damage', value: 5, target: 'enemy' }],
          else_effects: [],
        },
      ],
    }));
    saveWorkshopPack({
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '血契积木测试包',
      classes: [
        {
          id: 'custom_hp_cost_class',
          main: 'freelance',
          name: '血契测试师',
          talent: { name: '无', description: '无', effects: [] },
          cards,
          cardPool: [...cards, ...cards].map((card) => card.id),
          starterDeck: Array.from(
            { length: 15 },
            (_, index) => cards[index % cards.length]!.id,
          ),
        },
      ],
    });
    const database = new CaelianDatabase(
      'alpha',
      `caelian-hp-condition-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:hp-condition');
    await game.execute(profile.id, {
      id: 'hp-condition-player-create',
      type: 'player.create',
      payload: {
        name: '生命支付测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battles = new BattleRepository(database, () => 0);
    await battles.prepare();
    await battles.start(profile.id, {
      workshopTest: {
        professionId: 'custom_hp_cost_class',
        mechanismIds: [],
        dummyCount: 1,
        dummyHp: 100,
        dummyAttack: 0,
        dummyDefense: 0,
        dummyInvincible: false,
        dummyAttackEnabled: false,
        autoRespawn: false,
        playerInvincible: true,
        attributes: {
          hpMax: 40,
          mpMax: 30,
          attack: 0,
          defense: 0,
          speed: 0,
          actionPointsPerTurn: 6,
        },
      },
    });
    let session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    session.state.player.buffs.damage_bonus = {
      value: 7,
      turns: 2,
    };
    await database.battleSessions.put(session);
    const beforePlayerHp = session.state.player.hp;
    const beforeEnemyHp = session.state.enemies[0]!.hp;

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.player.hp).toBe(beforePlayerHp - 5);
    expect(session.state.enemies[0]!.hp).toBe(beforeEnemyHp - 12);
    expect(
      session.state.log.some((entry) =>
        entry.text.includes('支付 5 HP 作为卡牌效果代价'),
      ),
    ).toBe(true);
  });

  it('让非武器大师职业按名称判定本轮同名牌与上一张同名牌', async () => {
    const cards = Array.from({ length: 8 }, (_, index) => ({
      id: `custom_same_name_${index}`,
      name: index === 0 ? '回声斩' : `历史测试牌${index}`,
      type: 'attack',
      cost: 1,
      effects:
        index === 0
          ? [
              {
                type: 'conditional_group',
                conditions: [{ type: 'same_card_played_this_turn' }],
                then_effects: [{ type: 'damage', value: 5, target: 'enemy' }],
                else_effects: [{ type: 'damage', value: 1, target: 'enemy' }],
              },
            ]
          : index === 2
            ? [
                {
                  type: 'conditional_group',
                  conditions: [{ type: 'previous_card_same_name' }],
                  then_effects: [{ type: 'damage', value: 7, target: 'enemy' }],
                  else_effects: [{ type: 'damage', value: 2, target: 'enemy' }],
                },
              ]
          : [{ type: 'damage', value: 0, target: 'enemy' }],
    }));
    saveWorkshopPack({
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '同名历史条件测试包',
      classes: [
        {
          id: 'custom_same_name_class',
          main: 'freelance',
          name: '回声测试师',
          talent: { name: '无', description: '无', effects: [] },
          cards,
          cardPool: [...cards, ...cards].map((card) => card.id),
          starterDeck: Array.from(
            { length: 15 },
            (_, index) => cards[index % cards.length]!.id,
          ),
        },
      ],
    });
    const database = new CaelianDatabase(
      'alpha',
      `caelian-same-name-condition-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:same-name-condition');
    await game.execute(profile.id, {
      id: 'same-name-condition-player-create',
      type: 'player.create',
      payload: {
        name: '同名条件测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const battles = new BattleRepository(database, () => 0);
    await battles.prepare();
    await battles.start(profile.id, {
      workshopTest: {
        professionId: 'custom_same_name_class',
        mechanismIds: [],
        dummyCount: 1,
        dummyHp: 1_000,
        dummyAttack: 0,
        dummyDefense: 0,
        dummyInvincible: false,
        dummyAttackEnabled: false,
        autoRespawn: false,
        playerInvincible: true,
        attributes: {
          hpMax: 40,
          mpMax: 30,
          attack: 0,
          defense: 0,
          speed: 0,
          actionPointsPerTurn: 20,
        },
      },
    });
    let session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    session.state.player.hand = [
      { instanceId: 'same-name:first', cardId: cards[0]!.id },
      { instanceId: 'same-name:filler', cardId: cards[1]!.id },
      { instanceId: 'same-name:separated', cardId: cards[0]!.id },
      { instanceId: 'previous-name:first', cardId: cards[2]!.id },
      { instanceId: 'previous-name:consecutive', cardId: cards[2]!.id },
    ];
    session.state.player.drawPile = [];
    session.state.player.discardPile = [];
    session.state.player.ap = 20;
    session.state.player.apMax = 20;
    session.state.player.attack = 0;
    await database.battleSessions.put(session);

    let hpBefore = session.state.enemies[0]!.hp;
    for (const expectedDamage of [1, 0, 5, 2, 7]) {
      await battles.playCard(profile.id, {
        battleId: session.id,
        handIndex: 0,
        targetIndex: 0,
      });
      session = (await database.battleSessions.get(session.id))!;
      expect(hpBefore - session.state.enemies[0]!.hp).toBe(expectedDamage);
      hpBefore = session.state.enemies[0]!.hp;
    }
    expect(session.state.player.cardNamesPlayedThisTurn).toMatchObject({
      [cardNameHistoryKey('回声斩')]: 2,
      [cardNameHistoryKey('历史测试牌1')]: 1,
      [cardNameHistoryKey('历史测试牌2')]: 2,
    });
    expect(session.state.player.lastCardName).toBe('历史测试牌2');

    await battles.endTurn(profile.id, session.id);
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.player.cardNamesPlayedThisTurn).toEqual({});

    session.state.player.cardsPlayedThisTurn = { [cards[0]!.id]: 1 };
    session.state.player.cardNamesPlayedThisTurn = undefined;
    session.state.player.hand = [
      { instanceId: 'same-name:migration-filler', cardId: cards[1]!.id },
      { instanceId: 'same-name:migration-check', cardId: cards[0]!.id },
    ];
    session.state.player.drawPile = [];
    session.state.player.discardPile = [];
    session.state.player.ap = 20;
    session.state.enemies[0]!.hp = 1_000;
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    session = (await database.battleSessions.get(session.id))!;
    hpBefore = session.state.enemies[0]!.hp;
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    session = (await database.battleSessions.get(session.id))!;
    expect(hpBefore - session.state.enemies[0]!.hp).toBe(5);
    expect(session.state.player.cardNamesPlayedThisTurn).toMatchObject({
      [cardNameHistoryKey('回声斩')]: 2,
      [cardNameHistoryKey('历史测试牌1')]: 1,
    });
  });

  it('开战前按实际持有数量拒绝旧存档中的非法重复卡牌', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-illegal-deck-start-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:illegal-deck-start');
    await game.execute(profile.id, {
      id: 'illegal-deck-player-create',
      type: 'player.create',
      payload: {
        name: '非法牌组测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const deck = (await database.decks
      .where('profileId')
      .equals(profile.id)
      .first())!;
    const cardId = deck.cardIds[0]!;
    const owned = (await database.ownedCards.get(`${profile.id}:${cardId}`))!;
    deck.cardIds = Array.from({ length: owned.quantity + 1 }, () => cardId);
    await database.decks.put(deck);
    const battles = new BattleRepository(database, () => 0.99);
    await battles.prepare();

    await expect(
      battles.start(profile.id, { monsterId: 'mon_slime', count: 1 }),
    ).rejects.toThrow(`当前仅持有 ${owned.quantity} 张`);
  });

  it('让烧血绕过护盾且保留 1HP，并限制主动弃牌每回合一次', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'blood-burn-discard-limit',
      'holy_knight',
    );
    session.state.player.hp = 20;
    session.state.player.shield = 50;
    session.state.player.buffs.blood_burn = {
      value: 20,
      turns: 5,
      stacks: 2,
    };
    session.state.enemies[0]!.attack = 0;
    session.state.enemies[0]!.intent = null;
    await database.battleSessions.put(session);

    await battles.discardHand(profile.id, session.id);
    let current = (await database.battleSessions.get(session.id))!;
    const burnPerStack = Math.max(
      1,
      Math.floor(current.state.player.hpMax * 0.02),
    );
    expect(current.state.player).toMatchObject({
      hp: 20 - burnPerStack * 2,
      shield: 50,
      manualDiscardTurn: 1,
    });
    current.state.player.hp = 1;
    await database.battleSessions.put(current);
    await expect(battles.discardHand(profile.id, session.id)).rejects.toThrow(
      '本回合已使用过一次主动弃牌',
    );

    await battles.endTurn(profile.id, session.id);
    await battles.discardHand(profile.id, session.id);
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.manualDiscardTurn).toBe(2);
    expect(current.state.player.hp).toBe(1);
  });

  it('在普通牌无法支付完整烧血时原子拒绝，并允许恰好保留 1HP 的边界', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'blood-burn-card-hp-gate',
      'holy_knight',
    );
    session.state.player.hpMax = 100;
    session.state.player.hp = 2;
    session.state.player.ap = session.state.player.apMax;
    session.state.player.hand = [
      { instanceId: 'blood-burn-normal-card', cardId: 'hk_lumen_slash' },
    ];
    session.state.player.discardPile = [];
    session.state.player.buffs.blood_burn = {
      value: 20,
      turns: 5,
      stacks: 1,
    };
    session.state.enemies[0]!.hp = 1_000;
    session.state.enemies[0]!.hpMax = 1_000;
    await database.battleSessions.put(session);
    const before = structuredClone(session.state);

    await expect(
      battles.playCard(profile.id, {
        battleId: session.id,
        handIndex: 0,
        targetIndex: 0,
      }),
    ).rejects.toThrow('烧血结算后必须至少保留 1HP');

    let current = (await database.battleSessions.get(session.id))!;
    expect(current.state).toEqual(before);

    current.state.player.hp = 3;
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });

    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.hp).toBe(1);
    expect(current.state.player.hand).toHaveLength(0);
    expect(current.state.player.discardPile).toEqual([
      { instanceId: 'blood-burn-normal-card', cardId: 'hk_lumen_slash' },
    ]);
    expect(current.state.status).toBe('ongoing');
  });

  it('让治疗自己的卡牌先恢复生命再结算烧血', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'blood-burn-heal-first',
      'priest',
    );
    session.state.player.hpMax = 100;
    session.state.player.hp = 1;
    session.state.player.ap = session.state.player.apMax;
    session.state.player.hand = [
      { instanceId: 'blood-burn-heal-card', cardId: 'pr_heal' },
    ];
    session.state.player.buffs.blood_burn = {
      value: 20,
      turns: 5,
      stacks: 1,
    };
    session.state.enemies[0]!.hp = 1_000;
    session.state.enemies[0]!.hpMax = 1_000;
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
      allyTargetId: 'player',
    });

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.hp).toBe(13);
    expect(current.state.player.hand).toHaveLength(0);
    expect(current.state.status).toBe('ongoing');
  });

  it('低血时不允许借治疗凯利安绕过玩家自身的烧血门槛', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'blood-burn-companion-heal-gate',
      'priest',
      () => 0.99,
      true,
    );
    session.state.player.hpMax = 100;
    session.state.player.hp = 2;
    session.state.player.ap = session.state.player.apMax;
    session.state.player.hand = [
      { instanceId: 'blood-burn-companion-heal', cardId: 'pr_heal' },
    ];
    session.state.player.buffs.blood_burn = {
      value: 20,
      turns: 5,
      stacks: 1,
    };
    await database.battleSessions.put(session);

    await expect(
      battles.playCard(profile.id, {
        battleId: session.id,
        handIndex: 0,
        targetIndex: 0,
        allyTargetId: 'caelian',
      }),
    ).rejects.toThrow('烧血结算后必须至少保留 1HP');

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.hp).toBe(2);
    expect(current.state.player.hand).toEqual([
      { instanceId: 'blood-burn-companion-heal', cardId: 'pr_heal' },
    ]);
  });

  it('把三张“中毒层数翻倍”牌按乘法结算而不是中毒 +2', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'poison-double',
      'wood_mage',
    );
    session.state.player.attack = 0;
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 10_000;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.debuffs.poison = { value: 4, turns: 3 };
    await database.battleSessions.put(session);

    let expected = 4;
    for (const cardId of [
      'wood_poison_bloom',
      'al_catalyst',
      'ap_poison_amplifier',
    ]) {
      const current = (await database.battleSessions.get(session.id))!;
      current.state.player.ap = 20;
      current.state.player.mp = 100;
      current.state.player.hand.unshift({
        instanceId: `test:${cardId}`,
        cardId,
      });
      await database.battleSessions.put(current);
      await battles.playCard(profile.id, {
        battleId: session.id,
        handIndex: 0,
        targetIndex: 0,
      });
      expected *= 2;
      const after = (await database.battleSessions.get(session.id))!;
      expect(after.state.enemies[0]!.debuffs.poison?.value).toBe(expected);
    }
  });

  it('按职业限定资源并让龙魂、炉温、风痕、雷荷与零件进入实际伤害', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'class-resource-damage',
      'dragon_knight',
    );

    async function playWithResource(
      subclass: string,
      cardId: string,
      resource: string,
      value: number,
    ) {
      const current = (await database.battleSessions.get(session.id))!;
      current.state.player.subclass = subclass;
      current.state.player.attack = 0;
      current.state.player.ap = 20;
      current.state.player.mp = current.state.player.mpMax = 100;
      current.state.player.passiveEffects = [];
      current.state.player.classResources = { [resource]: value };
      current.state.enemies[0]!.hp = current.state.enemies[0]!.hpMax = 1_000;
      current.state.enemies[0]!.shield = 0;
      current.state.enemies[0]!.defense = 0;
      current.state.enemies[0]!.speed = 0;
      current.state.enemies[0]!.buffs = {};
      current.state.enemies[0]!.debuffs = {};
      current.state.player.hand.unshift({
        instanceId: `test:${subclass}:${cardId}`,
        cardId,
      });
      await database.battleSessions.put(current);
      await battles.playCard(profile.id, {
        battleId: session.id,
        handIndex: 0,
        targetIndex: 0,
      });
      return 1_000 - (await database.battleSessions.get(session.id))!.state.enemies[0]!.hp;
    }

    expect(await playWithResource('dragon_knight', 'dk_skyfall', 'dragon_soul', 3)).toBe(30);
    expect(await playWithResource('blacksmith', 'bs_hammer', 'furnace_heat', 2)).toBe(13);
    expect(await playWithResource('wind_mage', 'wind_pressure_cut', 'wind_mark', 2)).toBe(22);
    expect(await playWithResource('thunder_mage', 'th_thunderbolt', 'thunder_charge', 2)).toBe(24);
    expect(await playWithResource('mechanic', 'mc_parts_bomb', 'parts', 3)).toBe(15);
  });

  it('元素法师打出无元素功能牌后仍保留上一个元素', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'elementalist-last-element',
      'elementalist',
    );
    session.state.player.attack = 0;
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 10_000;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    await database.battleSessions.put(session);

    for (const cardId of ['em_fire_spark', 'em_element_sense', 'em_ice_needle']) {
      const current = (await database.battleSessions.get(session.id))!;
      current.state.player.ap = 20;
      current.state.player.mp = 100;
      current.state.player.hand.unshift({
        instanceId: `test:elementalist-last-element:${cardId}`,
        cardId,
      });
      await database.battleSessions.put(current);
      await battles.playCard(profile.id, {
        battleId: session.id,
        handIndex: 0,
        targetIndex: 0,
      });
    }

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.lastElementalistElement).toBe('water');
    expect(current.state.player.classResources?.element_resonance).toBe(1);
  });

  it('雷系消耗牌结算后仍按魔力消耗回充1层', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'thunder-charge-spend-and-regain',
      'thunder_mage',
    );
    session.state.player.attack = 0;
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.player.classResources = { thunder_charge: 3 };
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 10_000;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.player.hand.unshift({
      instanceId: 'test:thunder-charge-spend-all',
      cardId: 'th_thunderbolt',
    });
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    let current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.classResources?.thunder_charge).toBe(1);

    current.state.player.ap = 20;
    current.state.player.mp = 100;
    current.state.player.hand.unshift({
      instanceId: 'test:thunder-charge-spend-one',
      cardId: 'th_arc_jump',
    });
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.classResources?.thunder_charge).toBe(1);

    current.state.player.ap = 20;
    current.state.player.classResources = { thunder_charge: 0 };
    current.state.player.hand.unshift({
      instanceId: 'test:thunder-charge-gain-two',
      cardId: 'th_capacitor',
    });
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.classResources?.thunder_charge).toBe(2);
  });

  it('风暴核心的充能技能写入雷荷职业资源', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'storm-core-charge',
      'thunder_mage',
    );
    session.state.player.ap = 20;
    session.state.player.classResources = { thunder_charge: 0 };
    session.state.player.hand.unshift({
      instanceId: 'test:storm-core-charge',
      cardId: 'th_storm_core',
    });
    session.state.enemies[0]!.attack = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.debuffs.freeze = { value: 1, turns: 10 };
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    await battles.endTurn(profile.id, session.id);
    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.classResources?.thunder_charge).toBe(1);
    expect(current.state.player.buffs.thunder_charge).toBeUndefined();
  });

  it('结算武器大师同名连击，并在新回合清空计数', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'weapon-master-combo',
      'weapon_master',
    );
    session.state.player.attack = 0;
    session.state.player.ap = 20;
    session.state.player.passiveEffects = [];
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 1_000;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.buffs = {};
    session.state.enemies[0]!.debuffs = {};
    session.state.enemies[0]!.debuffs.freeze = { value: 1, turns: 10 };
    let current = session;
    let hpBefore = 1_000;
    for (const [index, expected] of [10, 12, 14].entries()) {
      current.state.player.hand.unshift({
        instanceId: `test:weapon-master-combo:${index}`,
        cardId: 'wmst_pierce',
      });
      await database.battleSessions.put(current);
      await battles.playCard(profile.id, {
        battleId: session.id,
        handIndex: 0,
        targetIndex: 0,
      });
      current = (await database.battleSessions.get(session.id))!;
      expect(hpBefore - current.state.enemies[0]!.hp).toBe(expected);
      hpBefore = current.state.enemies[0]!.hp;
    }
    expect(current.state.player.cardsPlayedThisTurn?.wmst_pierce).toBe(3);
    await battles.endTurn(profile.id, session.id);
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.cardsPlayedThisTurn).toEqual({});
  });

  it('按理智分档强化暗黑牧师伤害，并在零理智时按 50% 攻击自己', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'dark-priest-sanity',
      'dark_priest',
      () => 0,
    );
    session.state.player.hp = session.state.player.hpMax = 200;
    session.state.player.attack = 0;
    session.state.player.defense = 0;
    session.state.player.speed = 0;
    session.state.player.ap = 20;
    session.state.player.passiveEffects = [];
    session.state.player.sanity = 60;
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 1_000;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.buffs = {};
    session.state.enemies[0]!.debuffs = {};
    session.state.player.hand.unshift({
      instanceId: 'test:dark-priest-tier',
      cardId: 'dp_mind_lash',
    });
    await database.battleSessions.put(session);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    let current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(991);
    expect(current.state.player.sanity).toBe(55);

    current.state.player.hp = 200;
    current.state.player.sanity = 0;
    current.state.player.ap = 20;
    current.state.player.buffs = {};
    current.state.player.debuffs = {};
    current.state.player.hand.unshift({
      instanceId: 'test:dark-priest-redirect',
      cardId: 'dp_mind_lash',
    });
    const enemyHpBefore = current.state.enemies[0]!.hp;
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(enemyHpBefore);
    expect(current.state.player.hp).toBe(189);
    expect(current.state.player.sanity).toBe(0);
  });

  it('锁定并在回合开始结算奥术吟诵，同时回复 1 魔力', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'arcane-chant-resolution',
      'arcane_mage',
    );
    session.state.player.attack = 0;
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 1_000;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.debuffs.freeze = { value: 1, turns: 10 };
    session.state.player.hand.unshift({
      instanceId: 'test:arcane-chant',
      cardId: 'ar_arcane_missile',
    });
    await database.battleSessions.put(session);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    let current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(1_000);
    expect(current.state.player.chants).toHaveLength(1);
    expect(current.state.player.chants[0]!.turns).toBe(2);
    await battles.endTurn(profile.id, session.id);
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.chants[0]!.turns).toBe(1);
    current.state.player.mp = 0;
    await database.battleSessions.put(current);
    await battles.endTurn(profile.id, session.id);
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(986);
    expect(current.state.player.chants).toEqual([]);
    expect(current.state.player.mp).toBe(7);
  });

  it('吟诵队列已满时不消耗行动点、魔力或手牌', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'arcane-chant-full',
      'arcane_mage',
    );
    session.state.player.ap = 20;
    session.state.player.mp = 50;
    session.state.player.chants = Array.from({ length: 3 }, (_, index) => ({
      id: `test:full-chant:${index}`,
      name: `已在吟诵 ${index + 1}`,
      turns: 2,
      effects: [],
    }));
    session.state.player.hand.unshift({
      instanceId: 'test:rejected-full-chant',
      cardId: 'ar_arcane_missile',
    });
    const before = {
      ap: session.state.player.ap,
      mp: session.state.player.mp,
      hand: session.state.player.hand.map((entry) => entry.instanceId),
      discard: session.state.player.discardPile.map((entry) => entry.instanceId),
    };
    await database.battleSessions.put(session);

    await battles
      .playCard(profile.id, { battleId: session.id, handIndex: 0 })
      .catch(() => undefined);

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player).toMatchObject({
      ap: before.ap,
      mp: before.mp,
    });
    expect(current.state.player.hand.map((entry) => entry.instanceId)).toEqual(
      before.hand,
    );
    expect(
      current.state.player.discardPile.map((entry) => entry.instanceId),
    ).toEqual(before.discard);
    expect(current.state.player.chants).toHaveLength(3);
  });

  it('按受伤批次显示、强化、消耗并过期深渊回声', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'abyss-echo-batches',
      'dark_mage',
    );
    session.state.player.hp = session.state.player.hpMax = 200;
    session.state.player.attack = 0;
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.player.hand.unshift(
      { instanceId: 'test:echo-loss:1', cardId: 'dm_blood_mana' },
      { instanceId: 'test:echo-loss:2', cardId: 'dm_blood_mana' },
    );
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 1_000;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.debuffs.freeze = { value: 1, turns: 10 };
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, { battleId: session.id, handIndex: 0 });
    await battles.playCard(profile.id, { battleId: session.id, handIndex: 0 });
    let current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.abyssEcho).toBe(2);
    expect(current.state.player.classResources?.abyss_echo).toBe(2);
    expect(current.state.player.abyssEchoBatches).toEqual([{ turn: 1, value: 2 }]);

    current.state.player.hand.unshift({
      instanceId: 'test:echo-damage',
      cardId: 'dm_void_spark',
    });
    const hpBefore = current.state.enemies[0]!.hp;
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, { battleId: session.id, handIndex: 0 });
    current = (await database.battleSessions.get(session.id))!;
    expect(hpBefore - current.state.enemies[0]!.hp).toBe(13);
    expect(current.state.player.abyssEcho).toBe(3);

    current.state.player.mp = 0;
    current.state.player.hand.unshift({
      instanceId: 'test:echo-return',
      cardId: 'dm_echo_return',
    });
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, { battleId: session.id, handIndex: 0 });
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.mp).toBe(3);
    expect(current.state.player.abyssEcho).toBe(0);
    expect(current.state.player.abyssEchoBatches).toEqual([]);

    current.state.player.hand.unshift({
      instanceId: 'test:echo-expiry',
      cardId: 'dm_blood_mana',
    });
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, { battleId: session.id, handIndex: 0 });
    await battles.endTurn(profile.id, session.id);
    expect((await database.battleSessions.get(session.id))!.state.player.abyssEcho).toBe(1);
    await battles.endTurn(profile.id, session.id);
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.abyssEcho).toBe(0);
    expect(current.state.player.classResources?.abyss_echo).toBe(0);
  });

  it('迁移旧进行中战斗的深渊回声而不丢失层数', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'legacy-abyss-echo-migration',
      'dark_mage',
    );
    session.state.player.attack = 0;
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.player.passiveEffects = [];
    delete session.state.player.abyssEchoBatches;
    session.state.player.abyssEcho = 3;
    session.state.player.classResources = { abyss_echo: 3 };
    session.state.player.hand.unshift({
      instanceId: 'test:legacy-abyss-echo-migration',
      cardId: 'dm_dark_bolt',
    });
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 1_000;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(978);
    expect(current.state.player.abyssEcho).toBe(3);
    expect(current.state.player.classResources?.abyss_echo).toBe(3);
    expect(current.state.player.abyssEchoBatches).toEqual([
      { turn: 1, value: 3 },
    ]);
  });

  it('非深渊法师受伤时清理旧存档残留的深渊回声', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'non-dark-abyss-echo-cleanup',
      'holy_knight',
    );
    session.state.player.hp = session.state.player.hpMax = 100;
    session.state.player.shield = 50;
    session.state.player.abyssEcho = 3;
    session.state.player.abyssEchoBatches = [{ turn: 1, value: 3 }];
    session.state.player.classResources = {
      holy_sigil: 2,
      abyss_echo: 3,
    };
    session.state.player.buffs.blood_burn = {
      value: 1,
      turns: 3,
      stacks: 1,
    };
    await database.battleSessions.put(session);

    await battles.discardHand(profile.id, session.id);

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.hp).toBe(98);
    expect(current.state.player.shield).toBe(50);
    expect(current.state.player.abyssEcho).toBe(0);
    expect(current.state.player.abyssEchoBatches).toEqual([]);
    expect(current.state.player.classResources).toEqual({ holy_sigil: 2 });
  });

  it('普通玩家召唤物不继承玩家的吸血属性', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'player-summon-no-lifesteal',
      'summoner',
    );
    session.state.player.hp = 40;
    session.state.player.hpMax = 100;
    session.state.player.lifesteal = 30;
    session.state.player.passiveEffects = [];
    session.state.player.summons.push({
      id: 'test:no-lifesteal-summon',
      name: '不继承吸血的召唤物',
      duration: 2,
      hp: null,
      skills: [
        {
          name: '召唤物打击',
          weight: 1,
          effects: [{ type: 'damage', value: 20, target: 'enemy' }],
        },
      ],
    });
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 1_000;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.debuffs.freeze = { value: 1, turns: 10 };
    await database.battleSessions.put(session);

    await battles.endTurn(profile.id, session.id);
    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(980);
    expect(current.state.player.hp).toBe(40);
  });

  it('只限制 30% 面板加点，装备与藏品可继续叠加并让凯利安、特莱奥继承总吸血的 80%', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-lifesteal-stacking-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:lifesteal-stacking');
    await game.execute(profile.id, {
      id: 'lifesteal-player-create',
      type: 'player.create',
      payload: {
        name: '吸血测试员',
        classMain: 'mage',
        subclass: 'dark_mage',
      },
    });
    const player = (await database.playerStates.get(profile.id))!;
    player.lifesteal = 30;
    await database.playerStates.put(player);
    const equipmentId = `${profile.id}:lifesteal-accessory`;
    await database.equipmentInstances.add({
      id: equipmentId,
      profileId: profile.id,
      baseId: 'test-lifesteal-accessory',
      name: '吸血测试饰品',
      slot: 'accessory',
      rarity: 'rare',
      stars: 1,
      stats: { lifesteal: 20 },
      description: '吸血+20%',
      updatedAt: Date.now(),
    });
    await database.equipmentLoadouts.put({
      profileId: profile.id,
      weaponId: null,
      armorId: null,
      accessoryId: equipmentId,
      updatedAt: Date.now(),
    });
    await database.ownedRelics.put({
      id: `${profile.id}:r_blood_amber`,
      profileId: profile.id,
      relicId: 'r_blood_amber',
      carried: true,
      acquiredAt: Date.now(),
      updatedAt: Date.now(),
    });
    const battles = new BattleRepository(database, () => 0.99);
    await battles.prepare();
    await battles.start(profile.id, {
      monsterId: 'mon_slime',
      count: 1,
      companionPresent: true,
    });
    const session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    expect(session.state.player.lifesteal).toBe(50);
    expect(session.state.companion?.lifesteal).toBe(52);
    expect(session.state.companion?.summons[0]?.lifesteal).toBe(52);
    session.state.player.hp = 40;
    session.state.player.attack = 0;
    session.state.player.ap = 20;
    expect(session.state.player.passiveEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'lifesteal_ratio', value: 0.1 }),
        expect.objectContaining({ type: 'lifesteal_ratio', value: 0.05 }),
      ]),
    );
    session.state.player.hand.unshift({
      instanceId: 'test:lifesteal-hit',
      cardId: 'hk_final_judge',
    });
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 1_000;
    session.state.enemies[0]!.shield = 10;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.buffs = {};
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    let current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(978);
    expect(current.state.player.hp).toBe(54);

    current.state.player.hp = 40;
    current.state.player.ap = 20;
    current.state.player.hand.unshift({
      instanceId: 'test:lifesteal-fully-shielded',
      cardId: 'hk_final_judge',
    });
    current.state.enemies[0]!.hp = 1_000;
    current.state.enemies[0]!.shield = 1_000;
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.hp).toBe(40);

    current.state.player.hp = 40;
    current.state.player.ap = 20;
    current.state.player.hand.unshift({
      instanceId: 'test:lifesteal-overkill',
      cardId: 'hk_final_judge',
    });
    current.state.enemies[0]!.hp = 5;
    current.state.enemies[0]!.shield = 0;
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(0);
    expect(current.state.player.hp).toBe(43);
  });

  it('下一张法术、召唤与机械召唤减费只在匹配卡牌打出时生效并消耗', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'matched-card-cost-reductions',
      'summoner',
    );
    session.state.player.attack = 0;
    session.state.player.ap = 30;
    session.state.player.mp = session.state.player.mpMax = 50;
    session.state.player.passiveEffects = [];
    session.state.player.buffs = {
      next_spell_ap_free: { value: 1, turns: 3, charges: 1 },
      next_spell_ap_reduce: { value: 1, turns: 3, charges: 1 },
      next_spell_mp_reduce: { value: 1, turns: 3, charges: 1 },
      next_water_spell_mp_reduce: { value: 2, turns: 3, charges: 1 },
      next_summon_ap_reduce: { value: 1, turns: 3, charges: 1 },
      next_mech_summon_ap_reduce: { value: 1, turns: 3, charges: 1 },
    };
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 10_000;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    await database.battleSessions.put(session);

    async function play(cardId: string) {
      const current = (await database.battleSessions.get(session.id))!;
      current.state.player.hand.unshift({
        instanceId: `test:matched-cost:${cardId}`,
        cardId,
      });
      await database.battleSessions.put(current);
      await battles.playCard(profile.id, {
        battleId: session.id,
        handIndex: 0,
        targetIndex: 0,
      });
      return (await database.battleSessions.get(session.id))!;
    }

    let current = await play('vh_moon_arc');
    expect(current.state.player).toMatchObject({ ap: 28, mp: 50 });
    for (const key of [
      'next_spell_ap_free',
      'next_spell_ap_reduce',
      'next_spell_mp_reduce',
      'next_water_spell_mp_reduce',
      'next_summon_ap_reduce',
      'next_mech_summon_ap_reduce',
    ]) {
      expect(current.state.player.buffs).toHaveProperty(key);
    }

    current = await play('su_command_attack');
    expect(current.state.player).toMatchObject({ ap: 28, mp: 49 });
    expect(current.state.player.buffs).not.toHaveProperty(
      'next_spell_ap_free',
    );
    expect(current.state.player.buffs).not.toHaveProperty(
      'next_spell_ap_reduce',
    );
    expect(current.state.player.buffs).not.toHaveProperty(
      'next_spell_mp_reduce',
    );
    expect(current.state.player.buffs).toHaveProperty(
      'next_water_spell_mp_reduce',
    );
    expect(current.state.player.buffs).toHaveProperty(
      'next_summon_ap_reduce',
    );
    expect(current.state.player.buffs).toHaveProperty(
      'next_mech_summon_ap_reduce',
    );

    current = await play('wm_water_bolt');
    expect(current.state.player).toMatchObject({ ap: 27, mp: 49 });
    expect(current.state.player.buffs).not.toHaveProperty(
      'next_water_spell_mp_reduce',
    );
    expect(current.state.player.buffs).toHaveProperty(
      'next_summon_ap_reduce',
    );
    expect(current.state.player.buffs).toHaveProperty(
      'next_mech_summon_ap_reduce',
    );

    current = await play('su_lesser_familiar');
    expect(current.state.player).toMatchObject({ ap: 27, mp: 48 });
    expect(current.state.player.buffs).not.toHaveProperty(
      'next_summon_ap_reduce',
    );
    expect(current.state.player.buffs).toHaveProperty(
      'next_mech_summon_ap_reduce',
    );

    current = await play('mc_turret');
    expect(current.state.player).toMatchObject({ ap: 26, mp: 48 });
    expect(current.state.player.buffs).not.toHaveProperty(
      'next_mech_summon_ap_reduce',
    );
  });

  it('法术与雷系增幅按卡牌类型计算并只由有效伤害法术消耗', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'spell-and-thunder-amplification',
      'elementalist',
    );
    session.state.player.attack = 0;
    session.state.player.ap = 30;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.player.passiveEffects = [];
    session.state.player.buffs = {
      spell_amp_percent: { value: 25, turns: 3, charges: 1 },
    };
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 1_000;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.buffs = {};
    await database.battleSessions.put(session);

    async function play(cardId: string) {
      const current = (await database.battleSessions.get(session.id))!;
      current.state.player.hand.unshift({
        instanceId: `test:spell-amp:${cardId}`,
        cardId,
      });
      await database.battleSessions.put(current);
      await battles.playCard(profile.id, {
        battleId: session.id,
        handIndex: 0,
        targetIndex: 0,
      });
      return (await database.battleSessions.get(session.id))!;
    }

    let current = await play('lm_purge_wave');
    expect(current.state.enemies[0]!.hp).toBe(1_000);
    expect(current.state.player.buffs).toHaveProperty('spell_amp_percent');

    current = await play('em_meteor');
    expect(current.state.enemies[0]!.hp).toBe(965);
    expect(current.state.player.buffs).not.toHaveProperty('spell_amp_percent');

    current.state.player.buffs.thunder_spell_amp = {
      value: 40,
      turns: 3,
      charges: 1,
    };
    current.state.player.hand.unshift({
      instanceId: 'test:non-thunder-before-amp',
      cardId: 'wm_water_bolt',
    });
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(958);
    expect(current.state.player.buffs).toHaveProperty('thunder_spell_amp');

    current = await play('th_storm_javelin');
    expect(current.state.enemies[0]!.hp).toBe(919);
    expect(current.state.player.buffs).not.toHaveProperty('thunder_spell_amp');
  });

  it('治疗与护盾法术正确叠加通用法术、治疗护盾专用增幅', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'spell-heal-shield-amplification',
      'water_mage',
    );
    session.state.player.hpMax = 100;
    session.state.player.hp = 10;
    session.state.player.shield = 0;
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.player.passiveEffects = [];
    session.state.player.buffs = {
      spell_amp_percent: { value: 25, turns: 3, charges: 1 },
      spell_heal_shield_amp: { value: 35, turns: 3, charges: 1 },
      healing_amp_percent: { value: 20, turns: 3 },
    };
    await database.battleSessions.put(session);

    session.state.player.hand.unshift({
      instanceId: 'test:amplified-heal',
      cardId: 'wm_healing_stream',
    });
    await database.battleSessions.put(session);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    let current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.hp).toBe(36);
    expect(current.state.player.buffs).not.toHaveProperty('spell_amp_percent');
    expect(current.state.player.buffs).not.toHaveProperty(
      'spell_heal_shield_amp',
    );
    expect(current.state.player.buffs).toHaveProperty('healing_amp_percent');

    current.state.player.buffs.spell_amp_percent = {
      value: 25,
      turns: 3,
      charges: 1,
    };
    current.state.player.buffs.spell_heal_shield_amp = {
      value: 35,
      turns: 3,
      charges: 1,
    };
    current.state.player.hand.unshift({
      instanceId: 'test:amplified-shield',
      cardId: 'wm_tide_shield',
    });
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.shield).toBe(25);
    expect(current.state.player.buffs).not.toHaveProperty('spell_amp_percent');
    expect(current.state.player.buffs).not.toHaveProperty(
      'spell_heal_shield_amp',
    );
  });

  it('回合结束伤害在玩家结束回合时按文本数值结算', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'end-turn-enemy-damage',
      'wind_mage',
    );
    session.state.player.attack = 0;
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.player.passiveEffects = [];
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 100;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.debuffs.freeze = { value: 1, turns: 10 };
    session.state.player.hand.unshift({
      instanceId: 'test:end-turn-damage-field',
      cardId: 'wind_cutting_field',
    });
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    let current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(100);
    expect(current.state.player.buffs.end_turn_enemy_damage).toMatchObject({
      value: 8,
      turns: 2,
    });

    await battles.endTurn(profile.id, session.id);
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(92);
  });

  it('灵魂收割只在实际击杀时回复 6 点魔力', async () => {
    async function resolveSoulReap(label: string, enemyHp: number) {
      const { database, profile, battles, session } = await createStartedBattle(
        label,
        'dark_mage',
      );
      session.state.player.attack = 0;
      session.state.player.ap = 20;
      session.state.player.mp = 20;
      session.state.player.mpMax = 100;
      session.state.player.passiveEffects = [];
      session.state.enemies[0]!.hp = enemyHp;
      session.state.enemies[0]!.hpMax = Math.max(100, enemyHp);
      session.state.enemies[0]!.shield = 0;
      session.state.enemies[0]!.defense = 0;
      session.state.enemies[0]!.speed = 0;
      session.state.player.hand.unshift({
        instanceId: `test:soul-reap:${label}`,
        cardId: 'dm_soul_reap',
      });
      await database.battleSessions.put(session);
      await battles.playCard(profile.id, {
        battleId: session.id,
        handIndex: 0,
        targetIndex: 0,
      });
      return (await database.battleSessions.get(session.id))!;
    }

    const survived = await resolveSoulReap('soul-reap-no-kill', 100);
    expect(survived.state.enemies[0]!.hp).toBe(74);
    expect(survived.state.player.mp).toBe(12);

    const killed = await resolveSoulReap('soul-reap-kill', 20);
    expect(killed.state.enemies[0]!.hp).toBe(0);
    expect(killed.state.player.mp).toBe(18);
  });

  it('对不死敌人的持续加成按全体卡的每个目标分别计算', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'undead-bonus-per-target',
      'vampire_hunter',
    );
    session.state.player.attack = 0;
    session.state.player.ap = 20;
    session.state.player.passiveEffects = [];
    session.state.player.buffs = {
      undead_damage_bonus: { value: 6, turns: 3 },
    };
    const undead = session.state.enemies[0]!;
    undead.id = 'test:undead-target';
    undead.name = '不死目标';
    undead.hp = undead.hpMax = 100;
    undead.shield = 0;
    undead.defense = 0;
    undead.speed = 0;
    undead.tags = ['undead'];
    undead.buffs = {};
    undead.debuffs = {};
    const living = structuredClone(undead);
    living.id = 'test:living-target';
    living.name = '普通目标';
    living.tags = [];
    session.state.enemies = [undead, living];
    session.state.selectedTarget = 0;
    session.state.player.hand.unshift({
      instanceId: 'test:undead-all-targets',
      cardId: 'vh_moon_arc',
    });
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies.map((enemy) => enemy.hp)).toEqual([89, 95]);
  });

  it('双重契约让新召唤物立即额外行动，召唤增幅提高后续技能数值', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'summon-entry-and-skill-amplification',
      'summoner',
    );
    session.state.player.attack = 0;
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.player.passiveEffects = [];
    session.state.player.buffs = {
      summon_entry_double: { value: 1, turns: 2, charges: 1 },
    };
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 1_000;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.debuffs.freeze = { value: 1, turns: 10 };
    session.state.player.hand.unshift({
      instanceId: 'test:entry-double-familiar',
      cardId: 'su_lesser_familiar',
    });
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    let current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(996);
    expect(current.state.player.summons).toHaveLength(1);
    expect(current.state.player.buffs).not.toHaveProperty(
      'summon_entry_double',
    );

    current.state.player.hand.unshift({
      instanceId: 'test:amplify-existing-summon',
      cardId: 'su_blood_contract',
    });
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.summons[0]?.buffs?.summon_skill_amp).toMatchObject(
      { value: 25, turns: 1 },
    );

    await battles.endTurn(profile.id, session.id);
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(991);
  });

  it('再次召唤同名限时召唤物会刷新完整存在回合而不是直接跳过', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'same-summon-duration-refresh',
      'summoner',
    );
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.player.summons = [
      {
        id: 'legacy:mana-sprite',
        name: '魔力精灵',
        duration: 1,
        hp: 1,
        hpMax: 1,
        shield: 0,
        attack: 0,
        defense: 0,
        speed: 0,
        attackable: false,
        mechanical: true,
        buffs: {},
        debuffs: {},
        skills: [],
      },
    ];
    session.state.player.hand.unshift({
      instanceId: 'test:same-summon-duration-refresh',
      cardId: 'su_mana_sprite',
    });
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.summons).toHaveLength(1);
    expect(current.state.player.summons[0]).toMatchObject({
      id: 'legacy:mana-sprite',
      name: '魔力精灵',
      duration: 3,
    });
    expect(
      current.state.log.some((entry) =>
        entry.text.includes('魔力精灵 的存在时间已刷新至 3 回合'),
      ),
    ).toBe(true);
  });

  it('可攻击召唤物拦截敌方攻击，机械召唤物行动后按存在时间离场', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'summon-intercept-and-mechanical-expiry',
      'mechanic',
    );
    session.state.player.hp = session.state.player.hpMax = 100;
    session.state.player.shield = 0;
    session.state.player.defense = 0;
    session.state.player.passiveEffects = [];
    session.state.player.summonsLost = 0;
    session.state.player.summons = [
      {
        id: 'test:expiring-turret',
        name: '即将过期的炮台',
        duration: 1,
        hp: 1,
        hpMax: 1,
        shield: 0,
        attack: 0,
        defense: 0,
        speed: 0,
        attackable: false,
        mechanical: true,
        buffs: {},
        debuffs: {},
        skills: [
          {
            name: '炮击',
            weight: 1,
            effects: [{ type: 'damage', value: 6, target: 'enemy' }],
          },
        ],
      },
      {
        id: 'test:intercepting-guard',
        name: '拦截守卫',
        duration: 1,
        hp: 40,
        hpMax: 40,
        shield: 0,
        attack: 0,
        defense: 0,
        speed: 0,
        attackable: true,
        mechanical: false,
        buffs: {},
        debuffs: {},
        skills: [{ name: '守备', weight: 1, effects: [] }],
      },
    ];
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 1_000;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.attack = 20;
    session.state.enemies[0]!.intent = null;
    await database.battleSessions.put(session);

    await battles.endTurn(profile.id, session.id);

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(994);
    expect(current.state.player.hp).toBe(100);
    expect(current.state.player.summons).toHaveLength(1);
    expect(current.state.player.summons[0]).toMatchObject({
      id: 'test:intercepting-guard',
      hp: 30,
      duration: 1,
    });
    expect(current.state.player.summonsLost).toBe(1);
  });

  it('召唤物技能的 self 目标会治疗并为召唤物自身提供护盾', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'summon-self-target',
      'summoner',
    );
    session.state.player.hp = 50;
    session.state.player.hpMax = 100;
    session.state.player.shield = 0;
    session.state.player.passiveEffects = [];
    session.state.player.summons = [
      {
        id: 'test:self-target-summon',
        name: '自疗召唤物',
        duration: 3,
        hp: 10,
        hpMax: 20,
        shield: 0,
        attack: 0,
        defense: 0,
        speed: 0,
        attackable: true,
        mechanical: false,
        buffs: {},
        debuffs: {},
        skills: [
          {
            name: '自我修复',
            weight: 1,
            effects: [
              { type: 'heal', value: 5, target: 'self' },
              { type: 'shield', value: 4, target: 'self' },
            ],
          },
        ],
      },
    ];
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 1_000;
    session.state.enemies[0]!.debuffs.freeze = { value: 1, turns: 10 };
    await database.battleSessions.put(session);

    await battles.endTurn(profile.id, session.id);

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player).toMatchObject({ hp: 50, shield: 0 });
    expect(current.state.player.summons[0]).toMatchObject({
      hp: 15,
      hpMax: 20,
      shield: 4,
    });
  });

  it('同名状态按施加实例保留各自数值与持续时间', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'independent-status-instances',
      'apothecary',
    );
    session.state.player.ap = 20;
    session.state.player.passiveEffects = [];
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 10_000;
    session.state.enemies[0]!.debuffs.freeze = { value: 1, turns: 10 };
    session.state.player.hand.unshift(
      { instanceId: 'test:short-strength', cardId: 'ap_vitality_surge' },
      { instanceId: 'test:long-strength', cardId: 'ap_forbidden_elixir' },
    );
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });

    let current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.buffs.strength).toMatchObject({
      value: 8,
      turns: 3,
      stacks: 2,
    });
    expect(current.state.player.buffs.strength?.instances).toEqual([
      expect.objectContaining({ value: 2, turns: 1, fresh: true }),
      expect.objectContaining({ value: 6, turns: 3, fresh: true }),
    ]);

    await battles.endTurn(profile.id, session.id);
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.buffs.strength?.instances).toEqual([
      expect.objectContaining({ value: 2, turns: 1 }),
      expect.objectContaining({ value: 6, turns: 3 }),
    ]);

    await battles.endTurn(profile.id, session.id);
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.buffs.strength).toMatchObject({
      value: 6,
      turns: 2,
      stacks: 1,
    });
    expect(current.state.player.buffs.strength?.instances).toEqual([
      expect.objectContaining({ value: 6, turns: 2 }),
    ]);
  });

  it('中毒翻倍会逐层翻倍并保留每层原本的持续时间', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'double-poison-instances',
      'apothecary',
    );
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.player.passiveEffects = [];
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 10_000;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.defense = 0;
    session.state.player.hand.unshift(
      { instanceId: 'test:short-poison', cardId: 'ap_bitter_toxin' },
      { instanceId: 'test:long-poison', cardId: 'dm_plague_mist' },
      { instanceId: 'test:double-poison', cardId: 'ap_poison_amplifier' },
    );
    await database.battleSessions.put(session);

    for (let index = 0; index < 3; index += 1) {
      await battles.playCard(profile.id, {
        battleId: session.id,
        handIndex: 0,
        targetIndex: 0,
      });
    }

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.debuffs.poison).toMatchObject({
      value: 20,
      turns: 3,
      stacks: 2,
    });
    expect(current.state.enemies[0]!.debuffs.poison?.instances).toEqual([
      expect.objectContaining({ value: 10, turns: 1 }),
      expect.objectContaining({ value: 10, turns: 3 }),
    ]);
  });

  it('旧存档的聚合状态会作为单个兼容层继续倒计时', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'legacy-aggregate-status',
      'holy_knight',
    );
    session.state.player.passiveEffects = [];
    session.state.player.buffs.strength = {
      value: 7,
      turns: 2,
      fresh: false,
    };
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 10_000;
    session.state.enemies[0]!.debuffs.freeze = { value: 1, turns: 10 };
    await database.battleSessions.put(session);

    await battles.endTurn(profile.id, session.id);

    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.buffs.strength).toMatchObject({
      value: 7,
      turns: 1,
      stacks: 1,
    });
    expect(current.state.player.buffs.strength?.instances).toEqual([
      expect.objectContaining({ value: 7, turns: 1 }),
    ]);
  });

  it('按指定减益判定绞杀根，并让爆燃按全部灼烧数值乘算', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'profession-condition-and-burnout',
      'wood_mage',
    );
    session.state.player.attack = 0;
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.player.passiveEffects = [];
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 1_000;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.debuffs.weak = { value: 1, turns: 2 };
    session.state.player.hand.unshift({
      instanceId: 'test:wood-strangling-root',
      cardId: 'wood_strangling_root',
    });
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    let current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(970);

    current.state.player.subclass = 'fire_mage';
    current.state.player.ap = 20;
    current.state.player.mp = 100;
    current.state.enemies[0]!.hp = 1_000;
    current.state.enemies[0]!.debuffs.burn = {
      value: 7,
      turns: 3,
      instances: [
        { value: 3, turns: 1 },
        { value: 4, turns: 3 },
      ],
    };
    current.state.player.hand.unshift({
      instanceId: 'test:fire-burnout',
      cardId: 'fm_burnout',
    });
    await database.battleSessions.put(current);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(972);
    expect(current.state.enemies[0]!.debuffs.burn).toBeUndefined();
  });

  it('公式破坏按敌方独立强化层数造成伤害', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'formula-break-target-buffs',
      'arcane_mage',
    );
    session.state.player.attack = 0;
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.player.passiveEffects = [];
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 1_000;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.buffs.strength = {
      value: 5,
      turns: 3,
      instances: [
        { value: 2, turns: 2 },
        { value: 3, turns: 3 },
      ],
    };
    session.state.enemies[0]!.buffs.regen = { value: 1, turns: 2 };
    session.state.player.hand.unshift({
      instanceId: 'test:formula-break',
      cardId: 'ar_formula_break',
    });
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(976);
    expect(
      Object.values(current.state.enemies[0]!.buffs).reduce(
        (sum, effect) => sum + (effect.instances?.length ?? effect.stacks ?? 1),
        0,
      ),
    ).toBe(2);
  });

  it('按旧版公式让每个减益伤害计入攻击力与深渊回声', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'damage-per-debuff-legacy-formula',
      'dark_mage',
    );
    session.state.player.attack = 20;
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.player.passiveEffects = [];
    session.state.player.abyssEchoBatches = [{ turn: 1, value: 3 }];
    session.state.player.abyssEcho = 3;
    session.state.player.classResources = { abyss_echo: 3 };
    session.state.enemies[0]!.hp = session.state.enemies[0]!.hpMax = 1_000;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    session.state.enemies[0]!.debuffs = {
      weak: { value: 1, turns: 2 },
      poison: { value: 2, turns: 2 },
    };
    session.state.player.hand.unshift({
      instanceId: 'test:dark-debuff-burst',
      cardId: 'dm_debuff_burst',
    });
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies[0]!.hp).toBe(974);
  });

  it('自身失血绕过护盾、敏捷与防御直接扣除生命', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'direct-self-damage',
      'water_mage',
      () => 0,
    );
    session.state.player.hp = 30;
    session.state.player.shield = 99;
    session.state.player.defense = 999;
    session.state.player.buffs.agility = { value: 95, turns: 3 };
    session.state.player.ap = 20;
    session.state.player.mp = 0;
    session.state.player.hand.unshift({
      instanceId: 'test:mana-evaporation',
      cardId: 'wm_mana_evap',
    });
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player).toMatchObject({ hp: 25, shield: 99, mp: 4 });
    expect(current.state.player.buffs.agility).toBeDefined();
  });

  it('召回按剩余回合与生命比例回魔，最终协议只摧毁机械并攻击全体', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'summon-recall-and-final-protocol',
      'summoner',
    );
    const secondEnemy = structuredClone(session.state.enemies[0]!);
    secondEnemy.id = `${secondEnemy.id}:second`;
    secondEnemy.name = `${secondEnemy.name}乙`;
    session.state.enemies.push(secondEnemy);
    session.state.player.ap = 20;
    session.state.player.mp = 0;
    session.state.player.summons = [
      {
        id: 'test:recall-target',
        name: '契约灵',
        duration: 2,
        hp: 20,
        hpMax: 20,
        attackable: true,
        mechanical: false,
        skills: [],
      },
    ];
    session.state.player.hand.unshift({
      instanceId: 'test:summon-recall',
      cardId: 'su_recall',
    });
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    let current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.mp).toBe(5);
    expect(current.state.player.summons).toHaveLength(0);

    current.state.player.subclass = 'mechanic';
    current.state.player.ap = 20;
    current.state.player.summons = [
      {
        id: 'test:mechanical',
        name: '机械核心',
        duration: 3,
        hp: 1,
        hpMax: 1,
        attackable: false,
        mechanical: true,
        skills: [],
      },
      {
        id: 'test:living',
        name: '守护兽',
        duration: 3,
        hp: 20,
        hpMax: 20,
        attackable: true,
        mechanical: false,
        skills: [],
      },
    ];
    for (const enemy of current.state.enemies) {
      enemy.hp = enemy.hpMax = 1_000;
      enemy.defense = 0;
      enemy.speed = 0;
    }
    current.state.player.hand.unshift({
      instanceId: 'test:final-protocol',
      cardId: 'mc_final_protocol',
    });
    await database.battleSessions.put(current);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.enemies.map((enemy) => enemy.hp)).toEqual([992, 992]);
    expect(current.state.player.summons.map((summon) => summon.id)).toEqual([
      'test:living',
    ]);
  });

  it('没有可摧毁召唤物时不会消耗终末契约的费用或手牌', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'summon-destruction-precheck',
      'summoner',
    );
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.player.summons = [];
    session.state.player.hand.unshift({
      instanceId: 'test:final-contract-without-summon',
      cardId: 'su_final_contract',
    });
    const handCount = session.state.player.hand.length;
    await database.battleSessions.put(session);

    await expect(
      battles.playCard(profile.id, {
        battleId: session.id,
        handIndex: 0,
        targetIndex: 0,
      }),
    ).rejects.toThrow('场上没有可摧毁的召唤物');
    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.ap).toBe(20);
    expect(current.state.player.mp).toBe(100);
    expect(current.state.player.hand).toHaveLength(handCount);
  });

  it('法术回收、召唤回收与最早吟诵都按卡牌文本筛选', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'filtered-recovery-and-earliest-chant',
      'water_mage',
    );
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.player.hand = [
      { instanceId: 'test:clear-current', cardId: 'wm_clear_current' },
    ];
    session.state.player.discardPile = [
      { instanceId: 'test:recover-spell', cardId: 'wm_water_bolt' },
      { instanceId: 'test:skip-skill', cardId: 'wm_mana_spring' },
    ];
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    let current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.hand.map((entry) => entry.cardId)).toContain(
      'wm_water_bolt',
    );
    expect(current.state.player.discardPile.map((entry) => entry.cardId)).toContain(
      'wm_mana_spring',
    );

    current.state.player.subclass = 'mechanic';
    current.state.player.ap = 20;
    current.state.player.hand = [
      { instanceId: 'test:rebuild', cardId: 'mc_rebuild' },
    ];
    current.state.player.discardPile = [
      { instanceId: 'test:recover-summon', cardId: 'mc_barrier_generator' },
      { instanceId: 'test:skip-skill', cardId: 'mc_overclock' },
    ];
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.hand.map((entry) => entry.cardId)).toContain(
      'mc_barrier_generator',
    );
    expect(current.state.player.discardPile.map((entry) => entry.cardId)).toContain(
      'mc_overclock',
    );

    current.state.player.subclass = 'arcane_mage';
    current.state.player.ap = 20;
    current.state.player.chants = [
      { id: 'slow', name: '慢咏唱', turns: 3, effects: [] },
      { id: 'fast', name: '快咏唱', turns: 1, effects: [] },
    ];
    current.state.player.hand = [
      { instanceId: 'test:spell-copy', cardId: 'ar_spell_copy' },
    ];
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.chants).toHaveLength(3);
    expect(current.state.player.chants[2]).toMatchObject({
      name: '快咏唱·复写',
      turns: 1,
    });
  });

  it('法师职业的技能牌不会误消耗下一张法术减费', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'strict-spell-card-type',
      'dark_mage',
    );
    session.state.player.hp = 100;
    session.state.player.ap = 10;
    session.state.player.buffs.next_spell_ap_free = {
      value: 1,
      turns: 3,
      charges: 1,
    };
    session.state.player.hand.unshift({
      instanceId: 'test:dark-mage-skill',
      cardId: 'dm_ritual_draw',
    });
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.ap).toBe(9);
    expect(current.state.player.buffs.next_spell_ap_free).toBeDefined();
  });

  it('移形换位获得风痕，自动锻锤只在技能实际触发时获得炉温', async () => {
    const { database, profile, battles, session } = await createStartedBattle(
      'profession-resource-trigger-timing',
      'wind_mage',
      () => 0,
    );
    session.state.player.ap = 20;
    session.state.player.mp = session.state.player.mpMax = 100;
    session.state.player.classResources = {};
    session.state.player.hand.unshift({
      instanceId: 'test:wind-reposition',
      cardId: 'wind_reposition',
    });
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    let current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.classResources?.wind_mark).toBe(1);

    current.state.player.subclass = 'blacksmith';
    current.state.player.ap = 20;
    current.state.player.classResources = { furnace_heat: 1 };
    current.state.player.hand.unshift({
      instanceId: 'test:auto-hammer',
      cardId: 'bs_auto_hammer',
    });
    current.state.enemies[0]!.attack = 0;
    current.state.enemies[0]!.intent = null;
    await database.battleSessions.put(current);
    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.classResources?.furnace_heat).toBe(1);

    await battles.endTurn(profile.id, session.id);
    current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.classResources?.furnace_heat).toBe(1);
  });

  it('商人买路钱按敌人数量、等级与难度计价，逃跑随机损失金币', async () => {
    const bribe = await createStartedBattle(
      'merchant-bribe-scaling',
      'merchant',
      () => 0.5,
    );
    const secondEnemy = structuredClone(bribe.session.state.enemies[0]!);
    secondEnemy.id = `${secondEnemy.id}:second`;
    bribe.session.state.enemies[0]!.level = 2;
    bribe.session.state.enemies[0]!.difficulty = 'hard';
    secondEnemy.level = 3;
    secondEnemy.difficulty = 'hard';
    bribe.session.state.enemies.push(secondEnemy);
    bribe.session.state.player.gold = 1_000;
    bribe.session.state.player.ap = 20;
    bribe.session.state.player.hand.unshift({
      instanceId: 'test:merchant-bribe',
      cardId: 'me_bribe',
    });
    await bribe.database.battleSessions.put(bribe.session);

    await bribe.battles.playCard(bribe.profile.id, {
      battleId: bribe.session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    const bribeAfter = (await bribe.database.battleSessions.get(
      bribe.session.id,
    ))!;
    expect(bribeAfter.state.player.gold).toBe(766);
    expect(bribeAfter.state.status).toBe('victory');

    const flee = await createStartedBattle(
      'merchant-random-flee-cost',
      'merchant',
      () => 0.5,
    );
    flee.session.state.player.gold = 100;
    flee.session.state.player.hp = 80;
    flee.session.state.player.hpMax = 80;
    flee.session.state.player.ap = 20;
    flee.session.state.player.hand.unshift({
      instanceId: 'test:merchant-flee',
      cardId: 'me_panic_escape',
    });
    await flee.database.battleSessions.put(flee.session);

    await flee.battles.playCard(flee.profile.id, {
      battleId: flee.session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    const fleeAfter = (await flee.database.battleSessions.get(flee.session.id))!;
    expect(fleeAfter.state.player).toMatchObject({ gold: 50, hp: 40 });
    expect(fleeAfter.state.status).toBe('surrendered');
  });

  it('装备只提高生命魔力上限，低血结算不会凭空加减装备数值', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-equipment-current-resource-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const game = new GameRepository(database, new EventBus());
    const profile = await game.ensureProfile('chat:equipment-current-resource');
    await game.execute(profile.id, {
      id: 'equipment-current-player-create',
      type: 'player.create',
      payload: {
        name: '装备当前值测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const player = (await database.playerStates.get(profile.id))!;
    player.hp = 5;
    player.mp = 3;
    await database.playerStates.put(player);
    const equipmentId = `${profile.id}:test-maxima`;
    await database.equipmentInstances.add({
      id: equipmentId,
      profileId: profile.id,
      baseId: 'test-maxima',
      name: '上限测试剑',
      slot: 'weapon',
      rarity: 'common',
      stars: 1,
      stats: { hpMax: 20, mpMax: 10 },
      description: '',
      updatedAt: Date.now(),
    });
    await database.equipmentLoadouts.put({
      profileId: profile.id,
      weaponId: equipmentId,
      armorId: null,
      accessoryId: null,
      updatedAt: Date.now(),
    });
    const battles = new BattleRepository(database, () => 0.99);
    await battles.prepare();
    await battles.start(profile.id, { monsterId: 'mon_slime', count: 1 });
    const session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .first())!;
    expect(session.state.player).toMatchObject({
      hp: 5,
      hpMax: player.hpMax + 20,
      mp: 3,
      mpMax: player.mpMax + 10,
    });
    session.state.player.attack = 0;
    session.state.player.ap = 20;
    session.state.player.hand.unshift({
      instanceId: 'test:equipment-settlement-hit',
      cardId: 'hk_final_judge',
    });
    session.state.enemies[0]!.hp = 1;
    session.state.enemies[0]!.shield = 0;
    session.state.enemies[0]!.defense = 0;
    session.state.enemies[0]!.speed = 0;
    await database.battleSessions.put(session);

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    expect(await database.playerStates.get(profile.id)).toMatchObject({
      hp: 5,
      mp: 3,
    });
    await battles.finish(profile.id, session.id);

    const stored = (await database.playerStates.get(profile.id))!;
    stored.hp = stored.hpMax + 10;
    stored.mp = stored.mpMax + 5;
    await database.playerStates.put(stored);
    await battles.start(profile.id, { monsterId: 'mon_slime', count: 1 });
    const secondSession = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .filter((entry) => entry.active)
      .first())!;
    expect(secondSession.state.player).toMatchObject({
      hp: stored.hpMax + 10,
      hpMax: stored.hpMax + 20,
      mp: stored.mpMax + 5,
      mpMax: stored.mpMax + 10,
    });
    secondSession.state.player.attack = 0;
    secondSession.state.player.ap = 20;
    secondSession.state.player.hand.unshift({
      instanceId: 'test:equipment-high-current-settlement-hit',
      cardId: 'hk_final_judge',
    });
    secondSession.state.enemies[0]!.hp = 1;
    secondSession.state.enemies[0]!.shield = 0;
    secondSession.state.enemies[0]!.defense = 0;
    secondSession.state.enemies[0]!.speed = 0;
    await database.battleSessions.put(secondSession);
    await battles.playCard(profile.id, {
      battleId: secondSession.id,
      handIndex: 0,
      targetIndex: 0,
    });
    expect(await database.playerStates.get(profile.id)).toMatchObject({
      hp: stored.hpMax + 10,
      mp: stored.mpMax + 5,
    });
  });
});

async function createStartedBattle(
  label: string,
  subclass: string,
  random: () => number = () => 0.99,
  companionPresent = false,
) {
  const database = new CaelianDatabase(
    'alpha',
    `caelian-${label}-${crypto.randomUUID()}`,
  );
  databases.push(database);
  const game = new GameRepository(database, new EventBus());
  const profile = await game.ensureProfile(`chat:${label}`);
  await game.execute(profile.id, {
    id: `${label}:player-create`,
    type: 'player.create',
    payload: {
      name: `${label}测试员`,
      classMain: ['holy_knight', 'shadow_knight', 'dragon_knight'].includes(
        subclass,
      )
        ? 'knight'
        : [
              'elementalist',
              'fire_mage',
              'water_mage',
              'wind_mage',
              'thunder_mage',
              'wood_mage',
              'light_mage',
              'dark_mage',
              'arcane_mage',
              'summoner',
            ].includes(subclass)
          ? 'mage'
          : ['alchemist', 'apothecary', 'blacksmith', 'mechanic'].includes(
                subclass,
              )
            ? 'artisan'
            : 'freelance',
      subclass,
    },
  });
  const battles = new BattleRepository(database, random);
  await battles.prepare();
  await battles.start(profile.id, {
    monsterId: 'mon_slime',
    count: 1,
    companionPresent,
  });
  const session = (await database.battleSessions
    .where('profileId')
    .equals(profile.id)
    .first())!;
  return { database, game, profile, battles, session };
}
