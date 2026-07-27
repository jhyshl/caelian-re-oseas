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
});
