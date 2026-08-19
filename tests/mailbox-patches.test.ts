import { afterEach, describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_PATCH_REGISTRY,
  MEMORY_TOGETHER_ACHIEVEMENT_ID,
  MEMORY_TOGETHER_REWARD_GOLD,
} from '@/achievements/patch-registry';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import { BattleRepository } from '@/storage/repositories/battle-repository';
import { MarketRepository } from '@/storage/repositories/market-repository';

const databases: CaelianDatabase[] = [];

function createRepository() {
  const database = new CaelianDatabase(
    'alpha',
    `caelian-alpha-mailbox-${crypto.randomUUID()}`,
  );
  databases.push(database);
  return {
    database,
    repository: new GameRepository(database, new EventBus()),
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

describe('Achievement patch mailbox', () => {
  it('只在2026年8月19日首次领取同行的记忆，重复同步保持静默', async () => {
    const { repository } = createRepository();
    const profile = await repository.ensureProfile('memory-together-on-date');
    await repository.execute(profile.id, {
      id: 'memory-together-create-player',
      type: 'player.create',
      payload: {
        name: '同行者',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const goldBefore = (await repository.snapshot(profile.id)).player.gold;
    const claimDate = new Date(2026, 7, 19, 12, 0, 0);

    await expect(
      repository.syncPatchEntitlements(profile.id, [], claimDate),
    ).resolves.toMatchObject({
      receivedMailIds: [],
      claimedRewardIds: [],
      claimedAchievementIds: [MEMORY_TOGETHER_ACHIEVEMENT_ID],
    });
    const claimed = await repository.snapshot(profile.id);
    expect(claimed.player.gold).toBe(
      goldBefore + MEMORY_TOGETHER_REWARD_GOLD,
    );
    expect(
      claimed.achievements.find(
        (entry) => entry.achievementId === MEMORY_TOGETHER_ACHIEVEMENT_ID,
      ),
    ).toMatchObject({ unlocked: true, progress: 1 });

    await expect(
      repository.syncPatchEntitlements(profile.id, [], claimDate),
    ).resolves.toMatchObject({ claimedAchievementIds: [] });
    expect((await repository.snapshot(profile.id)).player.gold).toBe(
      goldBefore + MEMORY_TOGETHER_REWARD_GOLD,
    );
  });

  it('非限定日期即使收到同名补丁信号也不创建成就、不发奖励', async () => {
    const { repository } = createRepository();
    const profile = await repository.ensureProfile('memory-together-expired');
    await repository.execute(profile.id, {
      id: 'memory-together-expired-create-player',
      type: 'player.create',
      payload: {
        name: '迟到的同行者',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const goldBefore = (await repository.snapshot(profile.id)).player.gold;

    await expect(
      repository.syncPatchEntitlements(
        profile.id,
        [{ id: 'caelian-memory-together-v1', opened: true }],
        new Date(2026, 7, 20, 0, 0, 1),
      ),
    ).resolves.toMatchObject({
      receivedMailIds: [],
      claimedRewardIds: [],
      claimedAchievementIds: [],
    });
    const expired = await repository.snapshot(profile.id);
    expect(expired.player.gold).toBe(goldBefore);
    expect(
      expired.achievements.some(
        (entry) => entry.achievementId === MEMORY_TOGETHER_ACHIEVEMENT_ID,
      ),
    ).toBe(false);
  });

  it('保留三个补丁的原始奖励与藏品文本', () => {
    expect(ACHIEVEMENT_PATCH_REGISTRY['old-player']).toMatchObject({
      achievement: { id: 'ach_thanks_old_caelian', name: '感谢有你' },
      reward: {
        gold: 5000,
        collectible: {
          id: 'special_reshaped_quill',
          name: '重塑的羽毛笔',
          summary: '浩瀚银河，爱赋长歌，感谢遇见',
        },
      },
    });
    expect(ACHIEVEMENT_PATCH_REGISTRY['repo-reward']).toMatchObject({
      achievement: { id: 'ach_repo_reward', name: '好饭，当赏！' },
      reward: {
        gold: 2000,
        collectible: {
          id: 'special_golden_shovel',
          name: '金铲子',
          summary: '如此美味的饭我还能再吃一碗',
        },
      },
    });
    expect(ACHIEVEMENT_PATCH_REGISTRY['old-timer']).toMatchObject({
      achievement: { id: 'ach_launch_old_timer', name: '老资历' },
      reward: {
        gold: 500,
        collectible: {
          id: 'special_silver_fork',
          name: '银叉子',
          summary: '吃到热乎的了',
        },
      },
    });
  });

  it('补丁送达后显示未读邮件，首次开启结算奖励且反复阅读不重复发放', async () => {
    const { database, repository } = createRepository();
    const profile = await repository.ensureProfile('mailbox-patch');
    const goldBefore = (await repository.snapshot(profile.id)).player.gold;

    await repository.syncPatchEntitlements(profile.id, [
      { id: 'old-player', opened: false },
    ]);

    await expect(repository.mailboxState(profile.id)).resolves.toMatchObject({
      unreadCount: 1,
      entries: [
        {
          id: 'mail_thanks_old_caelian',
          title: '给亲爱的你',
          unread: true,
          rewardClaimedAt: null,
        },
      ],
    });
    expect((await repository.snapshot(profile.id)).player.gold).toBe(
      goldBefore,
    );

    await repository.execute(profile.id, {
      id: 'open-old-player-mail-first',
      type: 'mail.open',
      payload: { mailId: 'mail_thanks_old_caelian' },
    });
    const firstOpen = await repository.snapshot(profile.id);
    expect(firstOpen.player.gold).toBe(goldBefore + 5000);
    expect(
      firstOpen.achievements.find(
        (entry) => entry.achievementId === 'ach_thanks_old_caelian',
      ),
    ).toMatchObject({ unlocked: true });
    await expect(
      database.specialCollectibles.get(
        `${profile.id}:special_reshaped_quill`,
      ),
    ).resolves.toMatchObject({
      name: '重塑的羽毛笔',
      summary: '浩瀚银河，爱赋长歌，感谢遇见',
    });

    await repository.execute(profile.id, {
      id: 'open-old-player-mail-again',
      type: 'mail.open',
      payload: { mailId: 'mail_thanks_old_caelian' },
    });
    expect((await repository.snapshot(profile.id)).player.gold).toBe(
      goldBefore + 5000,
    );
    await expect(repository.mailboxState(profile.id)).resolves.toMatchObject({
      unreadCount: 0,
      entries: [
        {
          id: 'mail_thanks_old_caelian',
          unread: false,
        },
      ],
    });
  });

  it('已在旧补丁中读过的信自动迁移奖励，新冒险档只补藏品而不重复加金币', async () => {
    const { repository } = createRepository();
    const first = await repository.ensureProfile('mailbox-migrate-a');
    const firstGold = (await repository.snapshot(first.id)).player.gold;

    await repository.syncPatchEntitlements(first.id, [
      { id: 'old-timer', opened: true },
    ]);
    expect((await repository.snapshot(first.id)).player.gold).toBe(
      firstGold + 500,
    );

    const second = await repository.ensureProfile('mailbox-migrate-b');
    const secondGold = (await repository.snapshot(second.id)).player.gold;
    await repository.syncPatchEntitlements(second.id, [
      { id: 'old-timer', opened: true },
    ]);
    const secondSnapshot = await repository.snapshot(second.id);
    expect(secondSnapshot.player.gold).toBe(secondGold);
    expect(
      secondSnapshot.relics.some(
        (entry) => entry.relicId === 'special_silver_fork',
      ),
    ).toBe(true);
  });

  it('把羽毛笔与金铲子的原始效果接入 Alpha 本地战斗', async () => {
    const { database, repository } = createRepository();
    const featherProfile = await repository.ensureProfile(
      'patch-battle-feather',
    );
    await repository.execute(featherProfile.id, {
      id: 'patch-battle-feather-player',
      type: 'player.create',
      payload: {
        name: '羽毛笔测试',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    await repository.syncPatchEntitlements(featherProfile.id, [
      { id: 'old-player', opened: true },
    ]);
    const featherBattle = new BattleRepository(database, () => 0.5);
    await featherBattle.prepare();
    await featherBattle.start(featherProfile.id, {
      monsterId: 'mon_slime',
      count: 2,
    });
    const featherState = (await repository.snapshot(featherProfile.id))
      .battle!.state;
    expect(featherState.enemies.filter((enemy) => enemy.hp <= 0)).toHaveLength(
      1,
    );
    expect(
      featherState.animations?.some(
        (event) => event.sourceId === 'special_reshaped_quill',
      ),
    ).toBe(true);

    await database.battleSessions.clear();
    const shovelProfile = await repository.ensureProfile(
      'patch-battle-shovel',
    );
    await repository.execute(shovelProfile.id, {
      id: 'patch-battle-shovel-player',
      type: 'player.create',
      payload: {
        name: '金铲子测试',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    await repository.syncPatchEntitlements(shovelProfile.id, [
      { id: 'repo-reward', opened: true },
    ]);
    const shovelBattle = new BattleRepository(database, () => 0);
    await shovelBattle.prepare();
    await shovelBattle.start(shovelProfile.id, {
      monsterId: 'mon_slime',
      count: 1,
    });
    const shovelState = (await repository.snapshot(shovelProfile.id))
      .battle!.state;
    expect(shovelState.status).toBe('victory');
    expect(
      shovelState.animations?.some(
        (event) => event.sourceId === 'special_golden_shovel',
      ),
    ).toBe(true);
  });

  it('银叉子未携带也能让特产以20%概率半价，并保留第十次保底计数', async () => {
    const { database, repository } = createRepository();
    const profile = await repository.ensureProfile('patch-market-fork');
    await repository.syncPatchEntitlements(profile.id, [
      { id: 'old-timer', opened: true },
    ]);
    await database.ownedRelics.update(
      `${profile.id}:special_silver_fork`,
      { carried: false },
    );
    await database.playerStates.update(profile.id, { gold: 100_000 });
    const market = new MarketRepository(
      database,
      () => new Date(2026, 6, 30, 16, 30),
      () => 0,
    );
    const view = await market.view(profile.id);
    const specialty = view.listings.find(
      (listing) => listing.kind === 'item' && listing.tab === 'specialty',
    )!;
    const goldBefore = (await database.playerStates.get(profile.id))!.gold;
    await market.buy(profile.id, {
      listingKey: specialty.key,
      quantity: 1,
    });
    expect((await database.playerStates.get(profile.id))!.gold).toBe(
      goldBefore - Math.ceil(specialty.price * 0.5),
    );
  });
});
