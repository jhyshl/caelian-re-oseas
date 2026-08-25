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
    expect(snapshot.battle?.state.player.buffs.strength).toEqual({
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
    const hpBeforeDefense = secondSession!.state.player.hp;
    await database.battleSessions.put(secondSession!);
    await battleRepository.endTurn(profile.id, battleId);

    snapshot = await repository.snapshot(profile.id);
    expect(hpBeforeDefense - snapshot.battle!.state.player.hp).toBe(1);
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

  it('支付 HP 条件积木会扣除生命并执行后续效果', async () => {
    const cards = Array.from({ length: 8 }, (_, index) => ({
      id: `custom_hp_cost_${index}`,
      name: `血契试作${index + 1}`,
      type: 'skill',
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
    const beforePlayerHp = session.state.player.hp;
    const beforeEnemyHp = session.state.enemies[0]!.hp;

    await battles.playCard(profile.id, {
      battleId: session.id,
      handIndex: 0,
      targetIndex: 0,
    });
    session = (await database.battleSessions.get(session.id))!;
    expect(session.state.player.hp).toBe(beforePlayerHp - 5);
    expect(session.state.enemies[0]!.hp).toBeLessThan(beforeEnemyHp);
    expect(
      session.state.log.some((entry) =>
        entry.text.includes('支付 5 HP 作为卡牌效果代价'),
      ),
    ).toBe(true);
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

  it('让 30% 吸血属性与旧被动叠加，并让凯利安和特莱奥继承属性的 80%', async () => {
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
    expect(session.state.companion?.lifesteal).toBe(24);
    expect(session.state.companion?.summons[0]?.lifesteal).toBe(24);
    session.state.player.hp = 40;
    session.state.player.attack = 0;
    session.state.player.ap = 20;
    expect(session.state.player.passiveEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'lifesteal_ratio', value: 0.1 }),
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
    expect(current.state.player.hp).toBe(48);

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
    expect(current.state.player.hp).toBe(42);
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
