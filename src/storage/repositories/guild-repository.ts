import type { QuestRecord } from '@/domain/types';
import type { CaelianDatabase } from '@/storage/database';

export class GuildRepository {
  constructor(private readonly db: CaelianDatabase) {}

  async acceptCommission(
    profileId: string,
    input: {
      taskId: string;
      title: string;
      region: string;
      objective: string;
      totalStages: number;
      rewardExperience: number;
      rewardGold: number;
      rewardGuildExperience: number;
      minimumLevel: number;
    },
  ): Promise<void> {
    const player = await this.db.playerStates.get(profileId);
    if (!player) throw new Error('玩家档案不存在');
    if (!player.created) throw new Error('请先创建冒险者');
    if (player.level < input.minimumLevel) {
      throw new Error(`该委托需要玩家等级 Lv.${input.minimumLevel}`);
    }
    const active = await this.db.questRecords
      .where('profileId')
      .equals(profileId)
      .filter(
        (quest) =>
          quest.kind === 'commission' &&
          ['active', 'ready'].includes(quest.status),
      )
      .count();
    if (active >= 3) throw new Error('同时最多接受 3 个协会委托');

    const id = `${profileId}:commission:${input.taskId}`;
    if (await this.db.questRecords.get(id)) {
      throw new Error('该委托已经在任务列表中');
    }
    const now = Date.now();
    const quest: QuestRecord = {
      id,
      profileId,
      definitionId: input.taskId,
      kind: 'commission',
      title: input.title,
      region: input.region,
      objective: input.objective,
      status: 'active',
      currentStage: 0,
      totalStages: input.totalStages,
      rewardExperience: input.rewardExperience,
      rewardGold: input.rewardGold,
      rewardGuildExperience: input.rewardGuildExperience,
      updatedAt: now,
    };
    await this.db.questRecords.add(quest);
  }

  async abandon(profileId: string, questId: string): Promise<void> {
    const quest = await this.db.questRecords.get(questId);
    if (!quest || quest.profileId !== profileId) {
      throw new Error('任务不存在');
    }
    if (quest.kind === 'main') throw new Error('主线任务不能放弃');
    await this.db.questRecords.delete(questId);
  }
}
