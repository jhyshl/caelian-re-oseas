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
});
