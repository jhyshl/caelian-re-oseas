import { afterEach, describe, expect, it } from 'vitest';
import { loadMonsterCatalog } from '@/content/catalogs/battle';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { BattleRepository } from '@/storage/repositories/battle-repository';
import { GameRepository } from '@/storage/repository';
import { saveWorkshopPack } from '@/workshop';

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
    ).toBe(15);

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
    expect(snapshot.battle?.state.player.buffs.strength).toEqual({
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
    const battleRepository = new BattleRepository(database, () => 0);
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
});
