import { afterEach, describe, expect, it } from 'vitest';
import { loadMarketCatalogs } from '@/content/catalogs/market';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GatheringRepository } from '@/storage/repositories/gathering-repository';
import { GameRepository } from '@/storage/repository';
import {
  HUNTING_MATERIAL_IDS,
  rollHuntingRewards,
} from '@/content/cooking';

const databases: CaelianDatabase[] = [];

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

async function setup(options: {
  region?: string;
  place?: string;
  now?: Date;
  random?: () => number;
} = {}) {
  const database = new CaelianDatabase(
    'alpha',
    `caelian-gathering-${crypto.randomUUID()}`,
  );
  databases.push(database);
  const game = new GameRepository(database, new EventBus());
  const profile = await game.ensureProfile(
    `chat:gathering:${crypto.randomUUID()}`,
  );
  const region = options.region ?? '伊拉亚城';
  const place = options.place ?? '城郊';
  await database.worldStates.update(profile.id, {
    region,
    place,
    location: place ? `${region} · ${place}` : region,
    updatedAt: Date.now(),
  });
  const clock = {
    value: options.now ?? new Date(2026, 7, 30, 10, 30, 0),
  };
  const repository = new GatheringRepository(database, {
    now: () => new Date(clock.value.getTime()),
    random: options.random,
  });
  return { clock, database, game, profile, repository };
}

function stockSnapshot(
  items: Array<{
    listingKey: string;
    itemId: string;
    initialStock: number;
    remaining: number;
  }>,
) {
  return items.map((item) => ({
    listingKey: item.listingKey,
    itemId: item.itemId,
    initialStock: item.initialStock,
    remaining: item.remaining,
  }));
}

describe('GatheringRepository', () => {
  it('只从现有数据库列出当前区域全部采集物，每项刷新 10 至 20 个', async () => {
    const { profile, repository } = await setup();
    const catalogs = await loadMarketCatalogs();
    const expectedIds = catalogs.gatherByRegion['伊拉亚城'] ?? [];
    const view = await repository.view(profile.id);

    expect(view).toMatchObject({
      regionId: '伊拉亚城',
      location: '伊拉亚城 · 城郊',
      availableRegion: true,
    });
    expect(new Set(view.items.map((item) => item.itemId))).toEqual(
      new Set(expectedIds),
    );
    expect(view.items).toHaveLength(expectedIds.length);
    expect(new Set(view.items.map((item) => item.itemId)).size).toBe(
      view.items.length,
    );

    for (const item of view.items) {
      const definition = catalogs.gatherResources[item.itemId];
      expect(definition).toBeDefined();
      expect(definition?.regions).toContain('伊拉亚城');
      expect(item).toMatchObject({
        name: definition?.name,
        description: definition?.desc,
        category: definition?.category,
        rarity: definition?.rarity,
        ownedCount: 0,
      });
      expect(Number.isInteger(item.initialStock)).toBe(true);
      expect(item.initialStock).toBeGreaterThanOrEqual(10);
      expect(item.initialStock).toBeLessThanOrEqual(20);
      expect(item.remaining).toBe(item.initialStock);
    }
    expect(
      view.items.find((item) => item.itemId === '空玻璃瓶'),
    ).toMatchObject({ action: 'search', actionLabel: '搜寻拾取' });
    expect(
      view.items.find((item) => item.itemId === '圣心百合'),
    ).toMatchObject({ action: 'gather', actionLabel: '采集' });
  });

  it('同一天反复读取与重建仓储都保留同一批库存', async () => {
    const { clock, database, profile, repository } = await setup();
    const first = await repository.view(profile.id);
    clock.value = new Date(2026, 7, 30, 23, 59, 59);
    const second = await repository.view(profile.id);
    const restored = await new GatheringRepository(database, {
      now: () => new Date(clock.value.getTime()),
    }).view(profile.id);

    expect(second.refreshKey).toBe(first.refreshKey);
    expect(stockSnapshot(second.items)).toEqual(stockSnapshot(first.items));
    expect(stockSnapshot(restored.items)).toEqual(stockSnapshot(first.items));
    expect(first.nextRefreshAt).toBe(
      new Date(2026, 7, 31, 0, 0, 0).getTime(),
    );
  });

  it('采集后原子扣减区域库存并合并到现有背包栈', async () => {
    const { database, profile, repository } = await setup();
    const before = await repository.view(profile.id);
    const target = before.items[0];
    expect(target).toBeDefined();
    await database.inventoryStacks.put({
      id: `${profile.id}:${target!.itemId}`,
      profileId: profile.id,
      itemId: target!.itemId,
      name: target!.name,
      quantity: 2,
      updatedAt: Date.now(),
    });

    await repository.collect(profile.id, {
      listingKey: target!.listingKey,
      quantity: 3,
    });

    expect(
      await database.inventoryStacks.get(`${profile.id}:${target!.itemId}`),
    ).toMatchObject({
      itemId: target!.itemId,
      name: target!.name,
      quantity: 5,
    });
    const after = await repository.view(profile.id);
    expect(
      after.items.find((item) => item.itemId === target!.itemId),
    ).toMatchObject({
      initialStock: target!.initialStock,
      remaining: target!.remaining - 3,
      ownedCount: 5,
    });
  });

  it('同一个采集命令重复提交只会领取一次', async () => {
    const { database, game, profile } = await setup({ now: new Date() });
    const before = await game.gatheringState(profile.id);
    const target = before.items[0];
    expect(target).toBeDefined();
    const command = {
      id: `gather-once:${crypto.randomUUID()}`,
      type: 'gather.collect',
      payload: {
        listingKey: target!.listingKey,
        quantity: 2,
      },
    };

    await expect(game.execute(profile.id, command)).resolves.toMatchObject({
      status: 'applied',
    });
    await expect(game.execute(profile.id, command)).resolves.toMatchObject({
      status: 'duplicate',
    });
    expect(
      await database.inventoryStacks.get(`${profile.id}:${target!.itemId}`),
    ).toMatchObject({ quantity: 2 });
    expect(
      (await game.gatheringState(profile.id)).items.find(
        (item) => item.itemId === target!.itemId,
      )?.remaining,
    ).toBe(target!.remaining - 2);
  });

  it('即使两个区域都有同名采集物，也拒绝上一区域的旧条目', async () => {
    const { database, profile, repository } = await setup();
    const ilaya = await repository.view(profile.id);
    const shared = ilaya.items.find((item) => item.itemId === '圣心百合');
    expect(shared).toBeDefined();
    await database.worldStates.update(profile.id, {
      region: '索拉维亚',
      place: '圣心大教堂',
      location: '索拉维亚 · 圣心大教堂',
      updatedAt: Date.now(),
    });

    await expect(
      repository.collect(profile.id, {
        listingKey: shared!.listingKey,
        quantity: 1,
      }),
    ).rejects.toThrow();
    expect(
      await database.inventoryStacks.get(`${profile.id}:圣心百合`),
    ).toBeUndefined();

    const solavia = await repository.view(profile.id);
    expect(solavia.regionId).toBe('索拉维亚');
    expect(solavia.items.some((item) => item.itemId === '圣心百合')).toBe(
      true,
    );
    expect(
      solavia.items.find((item) => item.itemId === '圣心百合')?.listingKey,
    ).not.toBe(shared!.listingKey);
  });

  it('零点后先刷新新日库存，并拒绝上一天的过期条目', async () => {
    const { clock, database, profile, repository } = await setup({
      now: new Date(2026, 7, 30, 23, 59, 59),
    });
    const first = await repository.view(profile.id);
    const target = first.items[0];
    expect(target).toBeDefined();

    clock.value = new Date(2026, 7, 31, 0, 0, 0);
    await expect(
      repository.collect(profile.id, {
        listingKey: target!.listingKey,
        quantity: 1,
      }),
    ).rejects.toThrow();
    expect(
      await database.inventoryStacks.get(`${profile.id}:${target!.itemId}`),
    ).toBeUndefined();

    const next = await repository.view(profile.id);
    expect(next.refreshKey).not.toBe(first.refreshKey);
    expect(next.nextRefreshAt).toBe(
      new Date(2026, 8, 1, 0, 0, 0).getTime(),
    );
    expect(next.items).toHaveLength(first.items.length);
    for (const item of next.items) {
      expect(item.initialStock).toBeGreaterThanOrEqual(10);
      expect(item.initialStock).toBeLessThanOrEqual(20);
      expect(item.remaining).toBe(item.initialStock);
    }
  });

  it('本地日期回退时沿用已见过的较新库存，不会反复补满', async () => {
    const { clock, profile, repository } = await setup({
      now: new Date(2026, 7, 30, 10, 0, 0),
    });
    await repository.view(profile.id);
    clock.value = new Date(2026, 7, 31, 10, 0, 0);
    const newer = await repository.view(profile.id);
    const target = newer.items[0];
    expect(target).toBeDefined();
    await repository.collect(profile.id, {
      listingKey: target!.listingKey,
      quantity: 2,
    });

    clock.value = new Date(2026, 7, 30, 10, 0, 0);
    const rolledBack = await repository.view(profile.id);
    expect(rolledBack.refreshKey).toBe(newer.refreshKey);
    expect(rolledBack.nextRefreshAt).toBe(
      new Date(2026, 8, 1, 0, 0, 0).getTime(),
    );
    expect(
      rolledBack.items.find((item) => item.itemId === target!.itemId),
    ).toMatchObject({
      listingKey: target!.listingKey,
      initialStock: target!.initialStock,
      remaining: target!.remaining - 2,
    });
  });

  it('没有真实采集目录的未知区域返回空列表', async () => {
    const { profile, repository } = await setup({
      region: '未知荒原',
      place: '无名旷野',
    });
    const view = await repository.view(profile.id);

    expect(view).toMatchObject({
      regionId: '未知荒原',
      location: '未知荒原 · 无名旷野',
      availableRegion: false,
      items: [],
    });
  });

  it('未知世界区域不会从地点文本猜测并冒充其他地区', async () => {
    const { database, profile, repository } = await setup({
      region: '未知荒原',
      place: '伊拉亚城旧址',
    });
    await database.worldStates.update(profile.id, {
      location: '未知荒原 · 伊拉亚城旧址',
      updatedAt: Date.now(),
    });

    await expect(repository.view(profile.id)).resolves.toMatchObject({
      regionId: '未知荒原',
      availableRegion: false,
      items: [],
    });
  });

  it('地区字段只包含已知地区字样时也不会被模糊匹配', async () => {
    const { profile, repository } = await setup({
      region: '未知荒原·伊拉亚城旧址',
      place: '断壁',
    });

    await expect(repository.view(profile.id)).resolves.toMatchObject({
      regionId: '未知荒原·伊拉亚城旧址',
      availableRegion: false,
      items: [],
    });
  });

  it.each([
    [0, 0, 'failure'],
    [40.5 / 101, 40, 'failure'],
    [41.5 / 101, 41, 'success'],
    [80.5 / 101, 80, 'success'],
    [81.5 / 101, 81, 'battle'],
    [1, 100, 'battle'],
  ] as const)('打猎随机值 %s 得到点数 %i 和 %s 结果', async (random, roll, outcome) => {
    const { profile, repository } = await setup({ random: () => random });
    await expect(repository.hunt(profile.id, 'mixed_tracks')).resolves.toMatchObject({
      data: { roll, outcome },
    });
  });

  it('成功打猎获得2至3种料理材料且每种1至10个', async () => {
    const values = [50 / 101, 0.9, 0.2, 0.8, 0.4, 0.7, 0.3];
    let index = 0;
    const { database, profile, repository } = await setup({
      random: () => values[index++] ?? 0.5,
    });
    const result = await repository.hunt(profile.id, 'mixed_tracks');
    expect(result.data.outcome).toBe('success');
    expect(result.data.rewards.length).toBeGreaterThanOrEqual(2);
    expect(result.data.rewards.length).toBeLessThanOrEqual(3);
    expect(new Set(result.data.rewards.map((item) => item.itemId)).size).toBe(
      result.data.rewards.length,
    );
    for (const item of result.data.rewards) {
      expect(item.quantity).toBeGreaterThanOrEqual(1);
      expect(item.quantity).toBeLessThanOrEqual(10);
      expect(await database.inventoryStacks.get(`${profile.id}:${item.itemId}`)).toMatchObject({
        quantity: item.quantity,
      });
    }
  });

  it('混合兽踪会洗牌全部四种主材料，鱼肉可以进入奖励', () => {
    const values = [0, 0, 0, 0.9, 0.1, 0.1, 0.1];
    let index = 0;
    const rewards = rollHuntingRewards(
      () => values[index++] ?? 0,
      ['鸡蛋', '鸡肉', '野猪肉', '鱼肉'],
    );
    expect(rewards.map((item) => item.itemId)).toContain('鱼肉');
  });

  it('只有81至100点生成的一次性凭证可以启动战斗，胜利后追加料理材料', async () => {
    const { database, game, profile, repository } = await setup({
      random: () => 1,
    });
    await game.execute(profile.id, {
      id: 'hunting-player-create',
      type: 'player.create',
      payload: {
        name: '猎人',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    await expect(
      game.execute(profile.id, {
        id: 'forged-hunting-battle',
        type: 'battle.start',
        payload: { huntingAnimalId: 'wild_fowl' },
      }),
    ).rejects.toThrow('请先在采集系统完成判定');

    const encounter = await repository.hunt(profile.id, 'wild_fowl');
    expect(encounter.data).toMatchObject({
      outcome: 'battle',
      battleToken: expect.any(String),
    });
    await expect(
      game.execute(profile.id, {
        id: 'legitimate-hunting-battle',
        type: 'battle.start',
        payload: {
          huntingAnimalId: 'wild_fowl',
          huntingToken: encounter.data.battleToken,
        },
      }),
    ).resolves.toMatchObject({ status: 'applied' });
    expect(
      await database.gatheringStates.get(`${profile.id}:hunting-pending`),
    ).toBeUndefined();
    expect((await game.snapshot(profile.id)).battle?.state.huntingContext).toMatchObject({
      animalId: 'wild_fowl',
    });

    const session = (await database.battleSessions
      .where('profileId')
      .equals(profile.id)
      .filter((entry) => entry.active)
      .first())!;
    session.state.enemies.forEach((enemy, index) => {
      enemy.hp = index === 0 ? 1 : 0;
      enemy.shield = 0;
      enemy.defense = 0;
      enemy.speed = 0;
    });
    session.state.player.ap = 99;
    session.state.player.hand.unshift({
      instanceId: 'hunting-victory-card',
      cardId: 'hk_lumen_slash',
    });
    await database.battleSessions.put(session);
    await expect(
      game.execute(profile.id, {
        id: 'hunting-victory-hit',
        type: 'battle.play-card',
        payload: {
          battleId: session.id,
          handIndex: 0,
          targetIndex: 0,
        },
      }),
    ).resolves.toMatchObject({ status: 'applied' });

    const finished = await game.snapshot(profile.id);
    expect(finished.battle?.state.status).toBe('victory');
    const huntingRewards = finished.inventory.filter((entry) =>
      HUNTING_MATERIAL_IDS.includes(
        entry.itemId as (typeof HUNTING_MATERIAL_IDS)[number],
      ),
    );
    expect(huntingRewards.length).toBeGreaterThanOrEqual(2);
    expect(huntingRewards.length).toBeLessThanOrEqual(3);
    for (const reward of huntingRewards) {
      expect(reward.quantity).toBeGreaterThanOrEqual(1);
      expect(reward.quantity).toBeLessThanOrEqual(10);
    }
  });
});
