import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAchievementDefinitions } from '@/content/catalogs/achievements';
import {
  loadDailyGiftItemPool,
  loadMarketItemsByRegion,
} from '@/content/catalogs/inventory';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';

const databases: CaelianDatabase[] = [];

function createRepository() {
  const database = new CaelianDatabase(
    'alpha',
    `caelian-alpha-achievements-${crypto.randomUUID()}`,
  );
  databases.push(database);
  const events = new EventBus();
  return {
    database,
    events,
    repository: new GameRepository(database, events),
  };
}

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

describe('AchievementRepository integration', () => {
  it('保留旧版 95 项并接入今昔的诗行特殊成就', async () => {
    const definitions = await loadAchievementDefinitions();
    expect(Object.keys(definitions)).toHaveLength(97);
    expect(definitions.ach_re_oseas).toMatchObject({
      name: 'Re∞: 欧西亚斯',
      star: 3,
      condition: '首次打开这张卡',
    });
    expect(definitions.ach_past_present_poem).toMatchObject({
      name: '今昔的诗行',
      star: 5,
    });
  });

  it('按聊天内容与本地状态自动解锁，并在不同冒险档间共享成就', async () => {
    const { repository, events } = createRepository();
    const notices = vi.fn();
    events.on('achievement.unlocked', notices);
    const first = await repository.ensureProfile('achievement-chat-a');
    const second = await repository.ensureProfile('achievement-chat-b');

    await repository.scanAchievements(first.id, [
      '开场',
      '回复',
      '凯利安抱起特莱奥。',
    ]);
    await repository.execute(first.id, {
      id: 'affinity-100',
      type: 'narrative.update',
      payload: {
        companion: { affinity: 100 },
      },
    });

    const secondSnapshot = await repository.snapshot(second.id);
    const unlocked = new Set(
      secondSnapshot.achievements
        .filter((record) => record.unlocked)
        .map((record) => record.achievementId),
    );
    expect(unlocked.has('ach_re_oseas')).toBe(true);
    expect(unlocked.has('ach_first_meet_caelian')).toBe(true);
    expect(unlocked.has('ach_trelao_hug')).toBe(true);
    expect(unlocked.has('ach_caelian_affection_100')).toBe(true);
    expect(notices).toHaveBeenCalled();
  });

  it('按旧版规则结算感谢信、空白书页和每日十件赠礼', async () => {
    const { repository } = createRepository();
    const profile = await repository.ensureProfile('achievement-poem');
    const before = await repository.snapshot(profile.id);

    await expect(
      repository.execute(profile.id, {
        id: 'claim-poem',
        type: 'achievement.claim-poem-letter',
        payload: {},
      }),
    ).resolves.toMatchObject({ status: 'applied' });

    const afterLetter = await repository.snapshot(profile.id);
    expect(afterLetter.player.gold - before.player.gold).toBe(1834);
    expect(
      afterLetter.relics.some(
        (relic) => relic.relicId === 'special_blank_page',
      ),
    ).toBe(true);
    expect(
      afterLetter.achievements.find(
        (record) => record.achievementId === 'ach_past_present_poem',
      ),
    ).toMatchObject({ unlocked: true });
    await expect(
      repository.achievementSpecialState(profile.id),
    ).resolves.toMatchObject({
      letterClaimed: true,
      dailyGiftAvailable: true,
    });

    await repository.execute(profile.id, {
      id: 'claim-poem-daily',
      type: 'achievement.claim-daily-gift',
      payload: {},
    });
    const afterGift = await repository.snapshot(profile.id);
    const giftPool = new Set(
      (await loadDailyGiftItemPool()).map((item) => item.itemId),
    );
    const dailyQuantity = afterGift.inventory
      .filter((stack) => giftPool.has(stack.itemId))
      .reduce((total, stack) => total + stack.quantity, 0);
    expect(dailyQuantity).toBe(10);
    expect(
      afterGift.inventory.every(
        (stack) =>
          !stack.itemId.startsWith('daily:') || giftPool.has(stack.itemId),
      ),
    ).toBe(true);
    const marketRows = await loadMarketItemsByRegion();
    const actualMarketNames = new Set(
      Object.values(marketRows)
        .flat()
        .filter(
          (item) =>
            item.marketKind !== 'equipment' &&
            item.marketKind !== 'relic',
        )
        .map((item) => item.name),
    );
    expect(
      afterGift.inventory
        .filter((stack) => giftPool.has(stack.itemId))
        .every((stack) => actualMarketNames.has(stack.name)),
    ).toBe(true);
    await expect(
      repository.achievementSpecialState(profile.id),
    ).resolves.toMatchObject({
      dailyGiftAvailable: false,
    });
    await expect(
      repository.execute(profile.id, {
        id: 'claim-poem-daily-again',
        type: 'achievement.claim-daily-gift',
        payload: {},
      }),
    ).rejects.toThrow('今天已经领取过赠礼');
  });
});

describe('Adventure profile resolution', () => {
  it('关闭时新聊天新建档，开启时后续新聊天沿用当前冒险档', async () => {
    const { repository } = createRepository();
    const first = await repository.resolveProfile('save-chat-a');
    const second = await repository.resolveProfile('save-chat-b');
    expect(second.id).not.toBe(first.id);

    await repository.execute(first.id, {
      id: 'enable-shared-save',
      type: 'settings.update',
      payload: { preserveAdventureSave: true },
    });
    const shared = await repository.resolveProfile('save-chat-c');
    expect(shared.id).toBe(first.id);

    await repository.execute(first.id, {
      id: 'disable-shared-save',
      type: 'settings.update',
      payload: { preserveAdventureSave: false },
    });
    const fresh = await repository.resolveProfile('save-chat-d');
    expect(fresh.id).not.toBe(first.id);

    await repository.execute(fresh.id, {
      id: 're-enable-shared-save',
      type: 'settings.update',
      payload: { preserveAdventureSave: true },
    });
    const newlyShared = await repository.resolveProfile('save-chat-e');
    expect(newlyShared.id).toBe(fresh.id);
  });

  it('把保留冒险存档开关同步到所有档案显示', async () => {
    const { repository } = createRepository();
    const first = await repository.resolveProfile('settings-chat-a');
    const second = await repository.resolveProfile('settings-chat-b');

    await repository.execute(first.id, {
      id: 'sync-shared-save-setting',
      type: 'settings.update',
      payload: { preserveAdventureSave: true },
    });

    expect((await repository.snapshot(first.id)).settings).toMatchObject({
      preserveAdventureSave: true,
      sharedProfileId: first.id,
    });
    expect((await repository.snapshot(second.id)).settings).toMatchObject({
      preserveAdventureSave: true,
      sharedProfileId: first.id,
    });
  });
});
