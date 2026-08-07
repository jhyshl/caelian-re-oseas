import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
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

describe('GameRepository', () => {
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
    await repository.execute(profile.id, {
      id: 'accept-level-reward-commission',
      type: 'quest.accept',
      payload: {
        taskId,
        title: '升级奖励测试委托',
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
    expect(snapshot.player).toMatchObject({ level: 2, statPoints: 8 });
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
    expect(snapshot.equipment).toEqual([
      expect.objectContaining({ stars: 2 }),
    ]);
    expect(snapshot.relics).toHaveLength(1);
    expect(snapshot.player.pendingLevelRewards).toEqual([]);
  });
});
