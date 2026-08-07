import type { QuestCompletionResult, QuestRecord } from '@/domain/types';
import { updateGuildRank } from '@/guild-progression';
import { grantPlayerExperience } from '@/player/progression';
import { normalizeRegion } from '@/worldbook/region-switcher';
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
      commissionType?: 'combat' | 'gather' | 'escort' | 'investigate';
      targetName?: string;
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
      commissionType: input.commissionType,
      commissionTarget: input.targetName,
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

  async progressCommission(profileId: string, questId: string): Promise<void> {
    const quest = await this.commission(profileId, questId);
    if (quest.status !== 'active') throw new Error('该委托当前不能推进');
    if (quest.commissionType === 'combat') {
      throw new Error('讨伐委托会在战斗胜利后自动累计');
    }
    if (quest.commissionType === 'gather') {
      const target = quest.commissionTarget?.trim();
      if (!target) throw new Error('该采集委托缺少目标物品');
      const stack = await this.db.inventoryStacks
        .where('profileId')
        .equals(profileId)
        .filter((entry) => entry.itemId === target || entry.name === target)
        .first();
      const required = Math.max(1, quest.totalStages);
      if (!stack || stack.quantity < required) {
        throw new Error(`需要 ${target} ×${required}，当前持有 ${stack?.quantity ?? 0}`);
      }
      stack.quantity -= required;
      stack.updatedAt = Date.now();
      if (stack.quantity > 0) await this.db.inventoryStacks.put(stack);
      else await this.db.inventoryStacks.delete(stack.id);
    } else {
      const world = await this.db.worldStates.get(profileId);
      if (
        normalizeRegion(world?.region || world?.location) !==
        normalizeRegion(quest.region)
      ) {
        throw new Error(`请先前往${quest.region}再完成现场行动`);
      }
    }
    quest.currentStage = quest.totalStages;
    quest.status = 'ready';
    quest.updatedAt = Date.now();
    await this.db.questRecords.put(quest);
  }

  async completeCommission(
    profileId: string,
    questId: string,
  ): Promise<QuestCompletionResult> {
    const quest = await this.commission(profileId, questId);
    if (quest.status !== 'ready') throw new Error('委托目标尚未完成');
    const [player, guild] = await Promise.all([
      this.db.playerStates.get(profileId),
      this.db.guildStates.get(profileId),
    ]);
    if (!player?.created || !guild) throw new Error('玩家或协会档案不存在');
    const now = Date.now();
    const startingLevel = player.level;
    grantPlayerExperience(player, quest.rewardExperience);
    player.gold += quest.rewardGold;
    player.updatedAt = now;
    guild.experience += quest.rewardGuildExperience;
    guild.completedTaskCount += 1;
    guild.updatedAt = now;
    updateGuildRank(guild);
    await this.db.playerStates.put(player);
    await this.db.guildStates.put(guild);
    await this.db.questHistory.put({
      id: quest.id,
      profileId,
      kind: 'commission',
      title: quest.title,
      definitionId: quest.definitionId,
      rewardExperience: quest.rewardExperience,
      rewardGold: quest.rewardGold,
      rewardGuildExperience: quest.rewardGuildExperience,
      completedDate: new Date(now).toISOString(),
      updatedAt: now,
    });
    await this.db.questRecords.delete(quest.id);
    return {
      questId: quest.id,
      definitionId: quest.definitionId ?? quest.id,
      title: quest.title,
      experience: quest.rewardExperience,
      gold: quest.rewardGold,
      guildExperience: quest.rewardGuildExperience,
      collectibles: [],
      levelsGained: player.level - startingLevel,
    };
  }

  async abandon(profileId: string, questId: string): Promise<void> {
    const quest = await this.db.questRecords.get(questId);
    if (!quest || quest.profileId !== profileId) {
      throw new Error('任务不存在');
    }
    if (quest.kind === 'main') throw new Error('主线任务不能放弃');
    await this.db.questRecords.delete(questId);
  }

  private async commission(
    profileId: string,
    questId: string,
  ): Promise<QuestRecord> {
    const quest = await this.db.questRecords.get(questId);
    if (!quest || quest.profileId !== profileId || quest.kind !== 'commission') {
      throw new Error('协会委托不存在');
    }
    return quest;
  }
}
