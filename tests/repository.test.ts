import { afterEach, describe, expect, it } from 'vitest';
import { loadEquipmentDefinitions } from '@/content/catalogs/inventory';
import { scaleReworkEquipment } from '@/battle/rework/equipment';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GLOBAL_SETTINGS_ID } from '@/storage/defaults';
import { GameRepository } from '@/storage/repository';
import type { SettingsRecord } from '@/domain/types';

const databases: CaelianDatabase[] = [];

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

describe('GameRepository', () => {
  it('旧设置安全回退且心动主题永久解锁写入幂等', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-heart-theme-unlock-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:caelian-heart-theme');

    expect((await repository.snapshot(profile.id)).settings).toMatchObject({
      caelianHeartThemeUnlocked: false,
    });
    expect(await database.settings.get(GLOBAL_SETTINGS_ID)).toMatchObject({
      caelianHeartThemeUnlocked: false,
    });

    const current = (await database.settings.get(profile.id))!;
    const legacy = { ...current } as Partial<SettingsRecord>;
    delete legacy.caelianHeartThemeUnlocked;
    await database.settings.put(legacy as SettingsRecord);
    expect((await repository.snapshot(profile.id)).settings).toMatchObject({
      caelianHeartThemeUnlocked: false,
    });

    await expect(repository.unlockCaelianHeartTheme(profile.id)).resolves.toBe(
      true,
    );
    await expect(repository.unlockCaelianHeartTheme(profile.id)).resolves.toBe(
      false,
    );
    expect((await repository.snapshot(profile.id)).settings).toMatchObject({
      caelianHeartThemeUnlocked: true,
    });
  });

  it('生命每点加10且只改变上限，装备生命参与截断并禁止洗点回血', async () => {
    const database = new CaelianDatabase('alpha', `caelian-new-stat-hp-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:new-stat-hp');
    const base = (await database.playerStates.get(profile.id))!.hpMax;
    const equipmentId = `${profile.id}:allocation-maxima`;
    await database.equipmentInstances.add({
      id: equipmentId, profileId: profile.id, baseId: 'allocation-maxima',
      name: '加点上限测试装备', slot: 'accessory', rarity: 'common', stars: 1,
      stats: { hp_max: 20 }, description: '', updatedAt: Date.now(),
      ...{ equipmentRulesVersion: 1, itemLevel: 1 },
    });
    await database.equipmentLoadouts.update(profile.id, { accessoryId: equipmentId });
    await database.playerStates.update(profile.id, { hp: base + 20, statPoints: 4 });
    await repository.execute(profile.id, {
      id: 'equipped-hp-add', type: 'player.allocate-stat',
      payload: { stat: 'hpMax', direction: 'add' },
    });
    expect(await database.playerStates.get(profile.id)).toMatchObject({
      hp: base + 20, hpMax: base + 10, statPoints: 3,
    });
    await repository.execute(profile.id, {
      id: 'equipped-hp-remove', type: 'player.allocate-stat',
      payload: { stat: 'hpMax', direction: 'remove' },
    });
    expect(await database.playerStates.get(profile.id)).toMatchObject({
      hp: base + 20, hpMax: base, statPoints: 4,
    });
    await database.playerStates.update(profile.id, { hp: 1 });
    for (const direction of ['add', 'remove'] as const) {
      await repository.execute(profile.id, {
        id: `no-free-heal-${direction}`, type: 'player.allocate-stat',
        payload: { stat: 'hpMax', direction },
      });
    }
    expect(await database.playerStates.get(profile.id)).toMatchObject({ hp: 1, statPoints: 4 });
    for (const stat of ['mpMax', 'lifesteal']) {
      expect(await repository.execute(profile.id, {
        id: `obsolete-stat-${stat}`, type: 'player.allocate-stat',
        payload: { stat, direction: 'add' },
      })).toMatchObject({ status: 'rejected' });
    }
  });

  it.each([
    ['critRate', 1, 100], ['critDamage', 2, 250],
    ['effectHit', 2, 80], ['effectResist', 2, 80],
  ] as const)('%s按新兑换率加点、原价退点、封顶拒绝不扣资源', async (stat, gain, cap) => {
    const database = new CaelianDatabase('alpha', `caelian-new-stat-${stat}-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile(`chat:new-stat-${stat}`);
    const base = (await database.playerStates.get(profile.id))![stat] ?? 0;
    await database.playerStates.update(profile.id, { statPoints: 4 });
    expect(await repository.execute(profile.id, {
      id: `${stat}-add`, type: 'player.allocate-stat', payload: { stat, direction: 'add' },
    })).toMatchObject({ status: 'applied' });
    expect(await database.playerStates.get(profile.id)).toMatchObject({ [stat]: base + gain, statPoints: 3 });
    await repository.execute(profile.id, {
      id: `${stat}-remove`, type: 'player.allocate-stat', payload: { stat, direction: 'remove' },
    });
    expect(await database.playerStates.get(profile.id)).toMatchObject({ [stat]: base, statPoints: 4 });
    await database.playerStates.update(profile.id, (player) => { player[stat] = cap; player.statPoints = 2; });
    await database.statAllocations.update(profile.id, { [stat]: (cap - base) / gain });
    await expect(repository.execute(profile.id, {
      id: `${stat}-cap`, type: 'player.allocate-stat', payload: { stat, direction: 'add' },
    })).rejects.toThrow('上限');
    expect(await database.playerStates.get(profile.id)).toMatchObject({ [stat]: cap, statPoints: 2 });
  });
  it('地图移动命令会统一地区别名并同步地区、地点与展示位置', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-world-move-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:world-move');

    await expect(
      repository.execute(profile.id, {
        id: 'move-to-solavia-palace',
        type: 'world.move',
        payload: {
          region: '索拉姆',
          place: '皇宫',
          location: '错误的旧位置',
        },
      }),
    ).resolves.toMatchObject({ status: 'applied' });

    expect((await repository.snapshot(profile.id)).world).toMatchObject({
      region: '索拉维亚',
      place: '皇宫',
      location: '索拉维亚 · 皇宫',
    });
  });

  it('使用命令 ID 防止同一背包调整被重复执行', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-alpha-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:test', {
      playerName: '测试者',
    });
    const command = {
      id: 'message-10:inventory-1',
      type: 'inventory.adjust',
      payload: {
        itemId: 'alpha_supply',
        name: 'Alpha 补给',
        delta: 2,
      },
    };

    await expect(repository.execute(profile.id, command)).resolves.toMatchObject({
      status: 'applied',
    });
    await expect(repository.execute(profile.id, command)).resolves.toMatchObject({
      status: 'duplicate',
    });

    const snapshot = await repository.snapshot(profile.id);
    expect(snapshot.inventory).toHaveLength(1);
    expect(snapshot.inventory[0]?.quantity).toBe(2);
  });

  it('从背包直接使用恢复消耗品并原子更新角色数值与剩余数量', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-inventory-consumable-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:inventory-consumable');
    await repository.execute(profile.id, {
      id: 'consumable-player-create',
      type: 'player.create',
      payload: {
        name: '药剂测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    await database.playerStates.update(profile.id, { hp: 30, mp: 5 });
    await repository.execute(profile.id, {
      id: 'grant-small-health-potion',
      type: 'inventory.adjust',
      payload: { itemId: '小血瓶', name: '小血瓶', delta: 2 },
    });
    await repository.execute(profile.id, {
      id: 'grant-small-mana-potion',
      type: 'inventory.adjust',
      payload: { itemId: '小魔药瓶', name: '小魔药瓶', delta: 1 },
    });

    await expect(
      repository.execute(profile.id, {
        id: 'use-small-health-potion',
        type: 'inventory.use-consumable',
        payload: { itemId: '小血瓶' },
      }),
    ).resolves.toMatchObject({ status: 'applied' });
    await expect(
      repository.execute(profile.id, {
        id: 'use-small-mana-potion',
        type: 'inventory.use-consumable',
        payload: { itemId: '小魔药瓶' },
      }),
    ).resolves.toMatchObject({ status: 'applied' });

    const snapshot = await repository.snapshot(profile.id);
    expect(snapshot.player).toMatchObject({ hp: 55, mp: 15 });
    expect(snapshot.inventory).toEqual([
      expect.objectContaining({ itemId: '小血瓶', quantity: 1 }),
    ]);
    await expect(
      repository.execute(profile.id, {
        id: 'use-small-health-potion',
        type: 'inventory.use-consumable',
        payload: { itemId: '小血瓶' },
      }),
    ).resolves.toMatchObject({ status: 'duplicate' });
    expect((await repository.snapshot(profile.id)).player.hp).toBe(55);

    await repository.execute(profile.id, {
      id: 'grant-medium-health-potion',
      type: 'inventory.adjust',
      payload: { itemId: '中血瓶', name: '中血瓶', delta: 1 },
    });
    await repository.execute(profile.id, {
      id: 'start-battle-before-inventory-use',
      type: 'battle.start',
      payload: { monsterId: 'mon_slime', count: 1 },
    });
    await expect(
      repository.execute(profile.id, {
        id: 'reject-inventory-use-during-battle',
        type: 'inventory.use-consumable',
        payload: { itemId: '中血瓶' },
      }),
    ).rejects.toThrow('战斗中请从战斗背包使用消耗品');
    expect((await repository.snapshot(profile.id)).inventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: '中血瓶', quantity: 1 }),
      ]),
    );
  });

  it('恢复数值已满时拒绝消耗药剂且不扣除背包数量', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-inventory-full-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:inventory-full');
    await repository.execute(profile.id, {
      id: 'full-player-create',
      type: 'player.create',
      payload: {
        name: '满状态测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    await repository.execute(profile.id, {
      id: 'grant-full-health-potion',
      type: 'inventory.adjust',
      payload: { itemId: '小血瓶', name: '小血瓶', delta: 1 },
    });

    await expect(
      repository.execute(profile.id, {
        id: 'reject-full-health-potion',
        type: 'inventory.use-consumable',
        payload: { itemId: '小血瓶' },
      }),
    ).rejects.toThrow('当前生命与魔力均无需恢复');
    expect((await repository.snapshot(profile.id)).inventory).toEqual([
      expect.objectContaining({ itemId: '小血瓶', quantity: 1 }),
    ]);
  });

  it('在事务中拒绝会产生负数的背包命令', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-alpha-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:negative');

    await expect(
      repository.execute(profile.id, {
        id: 'negative-1',
        type: 'inventory.adjust',
        payload: { itemId: 'missing', delta: -1 },
      }),
    ).rejects.toThrow('背包数量不能小于 0');

    expect(await database.commandInbox.get('negative-1')).toBeUndefined();
  });

  it('接受中文协会委托并写入独立任务表', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-alpha-test-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:guild', {
      playerName: '测试冒险者',
    });
    await repository.execute(profile.id, {
      id: 'create-adventurer',
      type: 'player.create',
      payload: {
        name: '测试冒险者',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });

    const result = await repository.execute(profile.id, {
      id: 'accept-chinese-commission',
      type: 'quest.accept',
      payload: {
        taskId: '清理学院附近的哥布林营地:圣德里安学院',
        title: '清理学院附近的哥布林营地',
        region: '圣德里安学院',
        objective: '圣德里安学院东侧森林边缘发现哥布林聚集',
        totalStages: 5,
        rewardExperience: 120,
        rewardGold: 120,
        rewardGuildExperience: 22,
        minimumLevel: 1,
      },
    });

    expect(result.status).toBe('applied');
    const snapshot = await repository.snapshot(profile.id);
    expect(snapshot.quests).toHaveLength(1);
    expect(snapshot.quests[0]).toMatchObject({
      title: '清理学院附近的哥布林营地',
      kind: 'commission',
      totalStages: 5,
    });
  });

  it('提交采集委托材料并完成本地结算与公会晋升', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-commission-settlement-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:guild-settlement');
    await repository.execute(profile.id, {
      id: 'settlement-player-create',
      type: 'player.create',
      payload: {
        name: '委托测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    await repository.execute(profile.id, {
      id: 'grant-commission-material',
      type: 'inventory.adjust',
      payload: { itemId: '食人花花粉', name: '食人花花粉', delta: 3 },
    });
    const taskId = '采集食人花花粉:艾瑟拉森林';
    await repository.execute(profile.id, {
      id: 'accept-gather-commission',
      type: 'quest.accept',
      payload: {
        taskId,
        title: '采集食人花花粉',
        region: '艾瑟拉森林',
        objective: '提交食人花花粉',
        totalStages: 3,
        rewardExperience: 90,
        rewardGold: 165,
        rewardGuildExperience: 220,
        minimumLevel: 1,
        commissionType: 'gather',
        targetName: '食人花花粉',
      },
    });
    const questId = `${profile.id}:commission:${taskId}`;
    await repository.execute(profile.id, {
      id: 'progress-gather-commission',
      type: 'quest.commission-progress',
      payload: { questId },
    });
    expect((await repository.snapshot(profile.id)).quests[0]).toMatchObject({
      status: 'ready',
      currentStage: 3,
    });
    await repository.execute(profile.id, {
      id: 'complete-gather-commission',
      type: 'quest.commission-complete',
      payload: { questId },
    });
    const settled = await repository.snapshot(profile.id);
    expect(settled.quests).toEqual([]);
    expect(settled.inventory).toEqual([]);
    expect(settled.questHistory[0]?.title).toBe('采集食人花花粉');
    expect(settled.guild).toMatchObject({ rank: 'iron', completedTaskCount: 1 });
  });

  it('任务升级后持久保留装备与藏品选择并可分别领取', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-level-reward-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:level-reward');
    await repository.execute(profile.id, {
      id: 'level-reward-player-create',
      type: 'player.create',
      payload: {
        name: '升级奖励测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    await database.playerStates.update(profile.id, { experience: 90 });
    const taskId = '升级奖励测试委托:伊拉亚城';
    await repository.execute(profile.id,{id:'level-reward-material',type:'inventory.adjust',payload:{itemId:'测试材料',name:'测试材料',delta:1}});
    await repository.execute(profile.id, {
      id: 'accept-level-reward-commission',
      type: 'quest.accept',
      payload: {
        taskId,
        title: '升级奖励测试委托',
        commissionType: 'gather',
        targetName: '测试材料',
        region: '伊拉亚城',
        objective: '完成一次测试',
        totalStages: 1,
        rewardExperience: 20,
        rewardGold: 0,
        rewardGuildExperience: 0,
        minimumLevel: 1,
      },
    });
    const questId = `${profile.id}:commission:${taskId}`;
    await repository.execute(profile.id, {
      id: 'progress-level-reward-commission',
      type: 'quest.commission-progress',
      payload: { questId },
    });
    await repository.execute(profile.id, {
      id: 'complete-level-reward-commission',
      type: 'quest.commission-complete',
      payload: { questId },
    });

    let snapshot = await repository.snapshot(profile.id);
    expect(snapshot.player).toMatchObject({ level: 2, statPoints: 10 });
    expect(snapshot.player.pendingLevelRewards).toEqual([
      expect.objectContaining({ id: 'level-2', level: 2 }),
    ]);

    await repository.execute(profile.id, {
      id: 'prepare-level-reward',
      type: 'player.prepare-level-rewards',
      payload: {},
    });
    snapshot = await repository.snapshot(profile.id);
    const reward = snapshot.player.pendingLevelRewards?.[0];
    expect(reward?.equipmentIds).toHaveLength(5);
    expect(reward?.relicIds).toHaveLength(3);

    await repository.execute(profile.id, {
      id: 'claim-level-equipment',
      type: 'player.claim-level-reward',
      payload: {
        rewardId: reward!.id,
        kind: 'equipment',
        choiceId: reward!.equipmentIds[0],
      },
    });
    await repository.execute(profile.id, {
      id: 'claim-level-relic',
      type: 'player.claim-level-reward',
      payload: {
        rewardId: reward!.id,
        kind: 'relic',
        choiceId: reward!.relicIds[0],
      },
    });
    snapshot = await repository.snapshot(profile.id);
    const equipmentDefinitions = await loadEquipmentDefinitions();
    const chosenEquipment = equipmentDefinitions[reward!.equipmentIds[0]!];
    expect(snapshot.equipment).toEqual([
      expect.objectContaining({
        stars: 2,
        stats: scaleReworkEquipment(chosenEquipment!.stats, 2, snapshot.player.level, chosenEquipment!.rarity),
        itemLevel: snapshot.player.level, equipmentRulesVersion: 1,
      }),
    ]);
    expect(snapshot.relics).toHaveLength(1);
    expect(snapshot.player.pendingLevelRewards).toEqual([]);
  });
});
