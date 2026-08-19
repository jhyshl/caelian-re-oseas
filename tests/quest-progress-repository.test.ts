import { afterEach, describe, expect, it } from 'vitest';
import type {
  QuestRecord,
  TavernFloorReference,
} from '@/domain/types';
import { CaelianDatabase } from '@/storage/database';
import { QuestProgressRepository } from '@/storage/repositories/quest-progress-repository';

const databases: CaelianDatabase[] = [];

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

function floor(
  index: number,
  fingerprint: string,
  lineageHash: string,
): TavernFloorReference {
  return {
    id: `${index}:${fingerprint}`,
    index,
    role: 'assistant',
    fingerprint,
    lineageHash,
  };
}

async function setup() {
  const database = new CaelianDatabase(
    'alpha',
    `caelian-quest-progress-${crypto.randomUUID()}`,
  );
  databases.push(database);
  const quest: QuestRecord = {
    id: 'profile:commission:test',
    profileId: 'profile',
    kind: 'commission',
    title: '测试任务',
    region: '测试地区',
    objective: '前往任务地点',
    status: 'active',
    currentStage: 0,
    totalStages: 4,
    rewardExperience: 10,
    rewardGold: 10,
    rewardGuildExperience: 1,
    updatedAt: 1,
  };
  await database.questRecords.put(quest);
  return {
    database,
    quest,
    repository: new QuestProgressRepository(database),
  };
}

describe('QuestProgressRepository', () => {
  it('原子发放合法剧情赠礼，并在楼层变化后保留已提交结果', async () => {
    const { database, quest, repository } = await setup();
    await repository.bindFloor('profile', {
      questId: quest.id,
      floor: floor(2, 'gift', 'gift-lineage'),
      judgeResult: { progress: 'stay' },
      giftItems: [{ itemId: '小血瓶', itemName: '小血瓶', count: 2 }],
      summary: 'NPC 赠送了药瓶。',
      next: {
        status: 'active',
        trackerState: 'tracking',
        currentStage: 0,
        currentNodeId: 'stage:0',
        objective: '前往任务地点',
      },
    });
    expect(await database.inventoryStacks.get('profile:小血瓶')).toMatchObject({
      quantity: 2,
    });
    await expect(repository.rollbackFromFloor('profile', 2)).resolves.toEqual(
      [],
    );
    expect(await database.inventoryStacks.get('profile:小血瓶')).toMatchObject({
      quantity: 2,
    });
  });

  it('把副 API 结果、摘要和任务状态绑定到同一个楼层', async () => {
    const { database, quest, repository } = await setup();
    await repository.bindFloor('profile', {
      questId: quest.id,
      floor: floor(2, 'reply-a', 'lineage-a'),
      judgeResult: { progress: 'transition', confidence: 0.93 },
      summary: '玩家已经抵达任务地点。',
      next: {
        status: 'active',
        trackerState: 'tracking',
        currentStage: 1,
        currentNodeId: 'arrived',
        objective: '调查现场',
      },
    });

    const checkpoints = await repository.listCheckpoints(
      'profile',
      quest.id,
    );
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]).toMatchObject({
      floorIndex: 2,
      floorFingerprint: 'reply-a',
      lineageHash: 'lineage-a',
      summary: '玩家已经抵达任务地点。',
      judgeResult: { progress: 'transition', confidence: 0.93 },
      after: {
        currentNodeId: 'arrived',
        currentStage: 1,
      },
    });
    expect(await database.questRecords.get(quest.id)).toMatchObject({
      currentStage: 1,
      objective: '调查现场',
    });
  });

  it('删除楼层时不撤销已经确认的任务进度', async () => {
    const { database, quest, repository } = await setup();
    await repository.bindFloor('profile', {
      questId: quest.id,
      floor: floor(2, 'reply-a', 'lineage-a'),
      judgeResult: { progress: 'transition' },
      summary: '抵达现场。',
      next: {
        status: 'active',
        trackerState: 'tracking',
        currentStage: 1,
        currentNodeId: 'arrived',
        objective: '调查现场',
      },
    });
    await repository.bindFloor('profile', {
      questId: quest.id,
      floor: floor(4, 'reply-b', 'lineage-b'),
      judgeResult: { progress: 'transition' },
      summary: '发现了足迹。',
      next: {
        status: 'active',
        trackerState: 'tracking',
        currentStage: 2,
        currentNodeId: 'found-tracks',
        objective: '追踪足迹',
      },
    });

    const result = await repository.rollbackFromFloor('profile', 4);
    expect(result).toEqual([]);
    expect(await repository.listCheckpoints('profile', quest.id)).toHaveLength(
      2,
    );
    expect(await database.questRecords.get(quest.id)).toMatchObject({
      currentStage: 2,
      objective: '追踪足迹',
    });
  });

  it('较早楼层被编辑时保留已确认节点并避免重复判定', async () => {
    const { database, quest, repository } = await setup();
    await repository.bindFloor('profile', {
      questId: quest.id,
      floor: floor(4, 'same-reply', 'original-lineage'),
      judgeResult: { progress: 'transition' },
      summary: '已经发现线索。',
      next: {
        status: 'active',
        trackerState: 'tracking',
        currentStage: 1,
        currentNodeId: 'clue',
        objective: '继续调查',
      },
    });

    const result = await repository.reconcileFloors('profile', [
      floor(4, 'same-reply', 'edited-lineage'),
    ]);
    expect(result).toEqual([]);
    expect(await repository.listCheckpoints('profile', quest.id)).toHaveLength(
      1,
    );
    await expect(
      repository.hasCheckpointForFloor(
        'profile',
        quest.id,
        floor(4, 'same-reply-edited', 'edited-lineage'),
      ),
    ).resolves.toBe(true);
    expect(await database.questRecords.get(quest.id)).toMatchObject({
      currentStage: 1,
      objective: '继续调查',
    });
  });
});
