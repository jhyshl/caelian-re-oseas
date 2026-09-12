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
  it('升级时以旧存档已确认进度为基准，旧分支记录不再把主线推回零', async () => {
    const { database, quest, repository } = await setup();
    await repository.bindFloor('profile', { questId: quest.id, floor: floor(2, 'old-body', 'old-lineage'),
      judgeResult: {}, summary: '已完成广场登记', next: { status: 'active', trackerState: 'tracking', currentStage: 1, currentNodeId: 'approval', objective: '审批材料' } });
    const tracker = (await repository.getTracker('profile', quest.id))!;
    delete tracker.floorHistoryVersion;
    await database.questTrackerStates.put(tracker);
    expect(await repository.reconcileFloors('profile', [floor(2, 'current-body', 'current-lineage')])).toEqual([]);
    expect((await repository.getTracker('profile', quest.id))?.current.currentNodeId).toBe('approval');
    expect((await database.questRecords.get(quest.id))?.currentStage).toBe(1);
    await repository.bindFloor('profile', { questId: quest.id, floor: floor(3, 'new-body', 'new-lineage'),
      judgeResult: {}, summary: '继续校庆', next: { status: 'active', trackerState: 'tracking', currentStage: 2, currentNodeId: 'next', objective: '继续' } });
    await repository.reconcileFloors('profile', [floor(2, 'current-body', 'current-lineage'), floor(3, 'new-body', 'new-lineage'), floor(4, 'append', 'append')]);
    expect((await repository.getTracker('profile', quest.id))?.current.currentStage).toBe(2);
    await repository.rollbackFromFloor('profile', 3);
    expect((await repository.getTracker('profile', quest.id))?.current.currentStage).toBe(1);
  });
  it('只保存最近十楼；回退后同楼层的新正文重新绑定且重复事件不发双份赠礼', async () => {
    const { database, quest, repository } = await setup();
    for (let index=0; index<14; index++) await repository.bindFloor('profile', {
      questId:quest.id, floor:floor(index,`body-${index}`,`lineage-${index}`), judgeResult:{}, summary:`第${index}楼`,
      next:{status:'active',trackerState:'tracking',currentStage:1,currentNodeId:`node-${index}`,objective:'继续调查'},
    });
    expect((await repository.listCheckpoints('profile',quest.id)).map(item=>item.floorIndex)).toEqual([4,5,6,7,8,9,10,11,12,13]);
    await repository.rollbackFromFloor('profile',12);
    expect((await repository.getTracker('profile',quest.id))?.current).toMatchObject({currentNodeId:'node-11',summary:'第11楼'});
    const input={questId:quest.id,floor:floor(12,'rerolled','new-lineage'),judgeResult:{},summary:'新分支',
      giftItems:[{itemId:'小血瓶',itemName:'小血瓶',count:1}],
      next:{status:'active' as const,trackerState:'tracking' as const,currentStage:1,currentNodeId:'new-branch',objective:'新目标'}};
    await repository.bindFloor('profile',input);await repository.bindFloor('profile',input);
    expect((await repository.getTracker('profile',quest.id))?.current.currentNodeId).toBe('new-branch');
    expect((await database.inventoryStacks.get('profile:小血瓶'))?.quantity).toBe(1);
    expect((await repository.listCheckpoints('profile',quest.id)).some(item=>item.floorIndex===13)).toBe(false);
  });
  it('原子发放合法剧情赠礼，并在删除楼层后撤回该楼赠礼', async () => {
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
    expect(await repository.rollbackFromFloor('profile', 2)).toHaveLength(1);
    expect(await database.inventoryStacks.get('profile:小血瓶')).toBeUndefined();
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

  it('删除楼层时恢复到保留楼层的节点和摘要', async () => {
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
    expect(result).toHaveLength(1);
    expect(await repository.listCheckpoints('profile', quest.id)).toHaveLength(
      1,
    );
    expect(await database.questRecords.get(quest.id)).toMatchObject({
      currentStage: 1,
      objective: '调查现场',
    });
  });

  it('较早楼层被编辑时回退并允许重生成后重新判定', async () => {
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
    expect(result).toHaveLength(1);
    expect(await repository.listCheckpoints('profile', quest.id)).toHaveLength(
      0,
    );
    await expect(
      repository.hasCheckpointForFloor(
        'profile',
        quest.id,
        floor(4, 'same-reply-edited', 'edited-lineage'),
      ),
    ).resolves.toBe(false);
    expect(await database.questRecords.get(quest.id)).toMatchObject({
      currentStage: 0,
      objective: '前往任务地点',
    });
  });
});
