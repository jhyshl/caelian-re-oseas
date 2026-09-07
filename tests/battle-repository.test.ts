import { MAX_CARD_EFFECT_HITS } from '@/battle/execution-limits';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMonsterCatalog } from '@/content/catalogs/battle';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { BattleRepository } from '@/storage/repositories/battle-repository';
import { cardNameHistoryKey } from '@/battle/card-history';
import * as runtime from '@/battle/rework/runtime/api.mjs';
import { GameRepository } from '@/storage/repository';
import { saveWorkshopPack } from '@/workshop';
import {
  readWorkshopMechanisms,
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
    session.state.player.critRate = 0;
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
    await database.playerStates.update(profile.id,{critRate:0});
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
    snapshot.battle!.state.player.critRate = 0;
    await database.battleSessions.put(snapshot.battle!);
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

  it('从出战牌组创建战斗，保留手牌并按AP轮次抽牌', async () => {
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
      snapshot.battle!.state.player.hpMax,
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
    expect(snapshot.battle?.state.enemies).toHaveLength(1);
    expect(
      new Set(snapshot.battle?.state.enemies.map((enemy) => enemy.id)).size,
    ).toBe(1);
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
      cardId: 'lm_holy_mend',
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
      cardId: 'lm_holy_mend',
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
    const core=runtime.hydrate(session.state.rework);runtime.syncExternal(core,session.state);
    const target=core.allies.find((a:any)=>a.id==='caelian');target.shield=0;target.hp=1;
    core.beginAction(core.enemies[0],{id:'injury-check'});
    core.damage(core.enemies[0],target,{flat:1000,atk:0,crit:false},{forceHit:true});
    runtime.project(core,session.state);
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
      cardId: 'lm_holy_mend',
    });
    await database.battleSessions.put(session);
    await expect(battles.playCard(profile.id, {
      battleId: session.id, handIndex: 0, allyTargetId: 'caelian',
    })).rejects.toThrow('已重伤');
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.companion).toMatchObject({
      hp: 0,
      shield: 0,
      injured: true,
      actionIndex: retainedIndex,
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
    await database.playerStates.update(profile.id,{level:20});
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
    session.state.player.critRate=0;
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
    session.state.player.critRate=0;
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
    session.state.player.critRate=0;
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
    ).rejects.toThrow('ILLEGAL_CARD su_final_contract');
    const current = (await database.battleSessions.get(session.id))!;
    expect(current.state.player.ap).toBe(20);
    expect(current.state.player.mp).toBe(100);
    expect(current.state.player.hand).toHaveLength(handCount);
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
