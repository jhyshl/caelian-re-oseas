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
});
