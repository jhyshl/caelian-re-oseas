import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import { SocialInteractionRepository } from '@/storage/repositories/social-interaction-repository';

const databases: CaelianDatabase[] = [];

function database(label: string): CaelianDatabase {
  const value = new CaelianDatabase(
    'alpha',
    `caelian-social-${label}-${crypto.randomUUID()}`,
  );
  databases.push(value);
  return value;
}

function randomSequence(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (value) => {
      value.close();
      await value.delete();
    }),
  );
});

describe('SocialInteractionRepository', () => {
  it('只列出背包中可出售礼物，并原子执行正负0.5、扣库存与重复命令保护', async () => {
    const db = database('gift');
    const game = new GameRepository(db, new EventBus());
    const profile = await game.ensureProfile('chat:social-gift');
    await db.socialProgress.update(`${profile.id}:caelian`, {
      affinity: 100,
      updatedAt: Date.now(),
    });
    await db.inventoryStacks.bulkPut([
      {
        id: `${profile.id}:精制面包`,
        profileId: profile.id,
        itemId: '精制面包',
        name: '精制面包',
        quantity: 2,
        updatedAt: Date.now(),
      },
      {
        id: `${profile.id}:仿制血浆`,
        profileId: profile.id,
        itemId: '仿制血浆',
        name: '仿制血浆',
        quantity: 1,
        updatedAt: Date.now(),
      },
      {
        id: `${profile.id}:无价纪念石`,
        profileId: profile.id,
        itemId: '无价纪念石',
        name: '无价纪念石',
        quantity: 1,
        updatedAt: Date.now(),
      },
      {
        id: `${profile.id}:学生便当`,
        profileId: profile.id,
        itemId: '学生便当',
        name: '学生便当',
        quantity: 0,
        updatedAt: Date.now(),
      },
    ]);

    const options = await game.socialInteractionOptions(profile.id);
    expect(options.gifts.map((gift) => gift.itemId)).toEqual([
      '仿制血浆',
      '精制面包',
      '无价纪念石',
    ]);
    expect(options.gifts.find((gift) => gift.itemId === '精制面包')).toMatchObject({
      quantity: 2,
      affinityDelta: 0.5,
    });
    expect(options.gifts.find((gift) => gift.itemId === '仿制血浆')).toMatchObject({
      quantity: 1,
      affinityDelta: -0.5,
    });
    expect(options.gifts.find((gift) => gift.itemId === '无价纪念石')).toMatchObject({
      quantity: 1,
      price: 10,
      affinityDelta: 0.5,
    });

    const positive = {
      id: 'social-gift-positive',
      type: 'social.interact',
      payload: { action: 'caelian.gift', itemId: '精制面包' },
    } as const;
    await expect(game.execute(profile.id, positive)).resolves.toMatchObject({
      status: 'applied',
      affinityChanged: true,
    });
    expect(await db.socialProgress.get(`${profile.id}:caelian`)).toMatchObject({
      affinity: 100.5,
      pendingAffinityDelta: 0.5,
    });
    expect(await db.inventoryStacks.get(`${profile.id}:精制面包`)).toMatchObject({
      quantity: 1,
    });

    await expect(game.execute(profile.id, positive)).resolves.toMatchObject({
      status: 'duplicate',
    });
    expect(await db.socialProgress.get(`${profile.id}:caelian`)).toMatchObject({
      affinity: 100.5,
      pendingAffinityDelta: 0.5,
    });
    expect(await db.inventoryStacks.get(`${profile.id}:精制面包`)).toMatchObject({
      quantity: 1,
    });

    await expect(
      game.execute(profile.id, {
        id: 'social-gift-negative',
        type: 'social.interact',
        payload: { action: 'caelian.gift', itemId: '仿制血浆' },
      }),
    ).resolves.toMatchObject({ status: 'applied', affinityChanged: true });
    expect(await db.socialProgress.get(`${profile.id}:caelian`)).toMatchObject({
      affinity: 100,
      pendingAffinityDelta: 0,
    });
    expect(await db.inventoryStacks.get(`${profile.id}:仿制血浆`)).toBeUndefined();
  });

  it('确认已写回增量时只扣除捕获部分，保留并发产生的后续赠礼', async () => {
    const db = database('pending-affinity');
    const game = new GameRepository(db, new EventBus());
    const profile = await game.ensureProfile('chat:social-pending-affinity');
    await db.inventoryStacks.put({
      id: `${profile.id}:精制面包`,
      profileId: profile.id,
      itemId: '精制面包',
      name: '精制面包',
      quantity: 2,
      updatedAt: Date.now(),
    });

    for (const id of ['pending-gift-first', 'pending-gift-second']) {
      await expect(
        game.execute(profile.id, {
          id,
          type: 'social.interact',
          payload: { action: 'caelian.gift', itemId: '精制面包' },
        }),
      ).resolves.toMatchObject({ status: 'applied' });
    }
    expect(await game.pendingAffinityDelta(profile.id)).toBe(1);

    await expect(
      game.acknowledgePendingAffinityDelta(profile.id, 0.5),
    ).resolves.toBe(0.5);
    expect(await db.socialProgress.get(`${profile.id}:caelian`)).toMatchObject({
      affinity: 1,
      pendingAffinityDelta: 0.5,
    });
  });

  it('邀约列表和执行端都严格校验地区解锁、玩家等级及地点归属', async () => {
    const db = database('invite');
    const game = new GameRepository(db, new EventBus());
    const profile = await game.ensureProfile('chat:social-invite');
    await db.playerStates.update(profile.id, { level: 1 });
    await db.regionAccess.update(`${profile.id}:ilaya`, {
      accessible: false,
      unlockCondition: '测试锁定地区',
      updatedAt: Date.now(),
    });

    const interactions = new SocialInteractionRepository(db);
    await interactions.prepare();
    const options = await interactions.options(profile.id);
    expect(options.inviteRegions.map((region) => region.regionId)).toContain('academy');
    expect(options.inviteRegions.map((region) => region.regionId)).not.toContain('ilaya');
    expect(options.inviteRegions.map((region) => region.regionId)).not.toContain('solavia');

    await expect(
      interactions.interact(profile.id, {
        action: 'caelian.invite',
        regionId: 'ilaya',
        place: '',
      }),
    ).rejects.toThrow('测试锁定地区');
    await expect(
      interactions.interact(profile.id, {
        action: 'caelian.invite',
        regionId: 'solavia',
        place: '',
      }),
    ).rejects.toThrow('需要玩家等级 Lv.6');
    await expect(
      interactions.interact(profile.id, {
        action: 'caelian.invite',
        regionId: 'academy',
        place: '索拉维亚皇宫',
      }),
    ).rejects.toThrow('该地点不属于所选地区');
    await expect(
      interactions.interact(profile.id, {
        action: 'caelian.invite',
        regionId: 'academy',
        place: '正门',
      }),
    ).resolves.toMatchObject({
      prompt: '邀请凯利安前往圣德里安学院 · 正门',
      achievement: {
        event: 'caelian.invite',
        success: true,
        region: '圣德里安学院',
      },
    });
  });

  it('以严格小于8%的边界触发抚摸拒绝', async () => {
    const db = database('pet');
    const profile = await new GameRepository(db, new EventBus()).ensureProfile(
      'chat:social-pet',
    );
    const rejected = new SocialInteractionRepository(
      db,
      randomSequence(0.079, 0),
    );
    await rejected.prepare();
    await expect(
      rejected.interact(profile.id, { action: 'trelao.pet' }),
    ).resolves.toMatchObject({
      achievement: {
        event: 'trelao.pet',
        success: false,
        positive: false,
      },
    });

    const accepted = new SocialInteractionRepository(
      db,
      randomSequence(0.08, 0),
    );
    await accepted.prepare();
    await expect(
      accepted.interact(profile.id, { action: 'trelao.pet' }),
    ).resolves.toMatchObject({
      achievement: {
        event: 'trelao.pet',
        success: true,
        positive: true,
      },
    });
  });

  it('按旧版分类投喂、消耗一件物品且不改变凯利安好感', async () => {
    const db = database('feed');
    const game = new GameRepository(db, new EventBus());
    const profile = await game.ensureProfile('chat:social-feed');
    await db.socialProgress.update(`${profile.id}:caelian`, {
      affinity: 123.5,
      updatedAt: Date.now(),
    });
    await db.inventoryStacks.put({
      id: `${profile.id}:精制面包`,
      profileId: profile.id,
      itemId: '精制面包',
      name: '精制面包',
      quantity: 1,
      updatedAt: Date.now(),
    });

    const interactions = new SocialInteractionRepository(db, () => 0);
    await interactions.prepare();
    const before = await interactions.options(profile.id);
    expect(before.feeds.find((item) => item.itemId === '精制面包')).toMatchObject({
      result: 'like',
      category: 'specialty',
    });
    await expect(
      interactions.interact(profile.id, {
        action: 'trelao.feed',
        itemId: '精制面包',
      }),
    ).resolves.toMatchObject({
      achievement: {
        event: 'trelao.feed',
        liked: true,
      },
    });
    expect(await db.inventoryStacks.get(`${profile.id}:精制面包`)).toBeUndefined();
    expect(await db.socialProgress.get(`${profile.id}:caelian`)).toMatchObject({
      affinity: 123.5,
    });
  });
});
