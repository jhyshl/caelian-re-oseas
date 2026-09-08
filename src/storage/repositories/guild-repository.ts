import type { QuestCompletionResult, QuestRecord } from '@/domain/types';
import { updateGuildRank } from '@/guild-progression';
import { grantPlayerExperience } from '@/player/progression';
import { normalizeRegion } from '@/worldbook/region-switcher';
import type { CaelianDatabase } from '@/storage/database';
import { loadGuildCatalogs } from '@/content/catalogs/guild';
import { commissionBoard, commissionGoalsMet, escortDestinations } from '@/guild-commissions';

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
      commissionType?: 'combat' | 'gather' | 'combat_gather' | 'escort' | 'investigate';
      targetName?: string;
      destination?: string;
    },
  ): Promise<void> {
    const player = await this.db.playerStates.get(profileId);
    if (!player) throw new Error('玩家档案不存在');
    if (!player.created) throw new Error('请先创建冒险者');
    const { tasks } = await loadGuildCatalogs();
    const definition = tasks.find(task => task.id === input.taskId);
    if (definition) input = { ...input, commissionType: definition.type as typeof input.commissionType, targetName: definition.target, totalStages: definition.count ?? 1 };
    if (!input.commissionType || input.commissionType === 'investigate') throw new Error('该旧委托需要刷新为战斗或提交物品任务');
    if (input.commissionType === 'combat_gather' && !definition?.items?.length) throw new Error('复合委托缺少物品目标');
    if (input.commissionType === 'escort') {
      const access = await this.db.regionAccess.where('profileId').equals(profileId).toArray();
      const world = await this.db.worldStates.get(profileId);
      if (normalizeRegion(world?.region || world?.location) !== normalizeRegion(input.region)) throw new Error('请先到护送起点接取委托');
      const destination = normalizeRegion(input.destination);
      if (!escortDestinations(input.region, access).includes(destination)) throw new Error('护送终点必须是起点以外已解锁的地区，请刷新委托');
      input.destination = destination;
      input.objective = `从${normalizeRegion(input.region)}护送至${destination}，到达终点后交付。`;
    }
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
      commissionVersion: 2,
      commissionAcceptedAt: now,
      commissionKills: 0,
      commissionBattleIds: [],
      commissionItems: definition?.items ?? (input.commissionType === 'gather' && input.targetName ? [{ itemId: input.targetName, count: input.totalStages }] : []),
      commissionItemsSubmitted: false,
      escortDestination: input.destination,
      escortArrived: false,
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
    if (quest.commissionVersion !== 2) throw new Error('请刷新旧委托后重试');
    if (quest.commissionType === 'combat') {
      throw new Error('讨伐委托会在战斗胜利后自动累计');
    }
    if (quest.commissionType === 'gather' || quest.commissionType === 'combat_gather') {
      if (quest.commissionItemsSubmitted) throw new Error('物品已提交，请完成剩余战斗目标');
      const items = quest.commissionItems ?? [];
      if (!items.length) throw new Error('该委托缺少物品目标');
      const inventory = await this.db.inventoryStacks.where('profileId').equals(profileId).toArray();
      const changed = new Map<string, typeof inventory[number]>();
      for (const item of items) {
        const stacks = inventory.filter(stack => stack.itemId === item.itemId || stack.name === item.itemId);
        const owned = stacks.reduce((sum, stack) => sum + stack.quantity, 0);
        if (owned < item.count) throw new Error(`需要 ${item.itemId} ×${item.count}，当前持有 ${owned}`);
        let remaining = item.count;
        for (const stack of stacks) {
          const used = Math.min(stack.quantity, remaining); stack.quantity -= used; remaining -= used;
          if (used) { stack.updatedAt = Date.now(); changed.set(stack.id, stack); }
        }
      }
      for (const stack of changed.values()) {
        if (stack.quantity) await this.db.inventoryStacks.put(stack); else await this.db.inventoryStacks.delete(stack.id);
      }
      quest.commissionItemsSubmitted = true;
    } else if (quest.commissionType === 'escort') {
      const world = await this.db.worldStates.get(profileId);
      if (
        !quest.escortDestination || normalizeRegion(quest.escortDestination) === normalizeRegion(quest.region) ||
        normalizeRegion(world?.region || world?.location) !==
        normalizeRegion(quest.escortDestination) || (world?.updatedAt ?? 0) <= (quest.commissionAcceptedAt ?? 0)
      ) {
        throw new Error(`请从${quest.region}护送至${quest.escortDestination ?? '其他已解锁地区'}后交付`);
      }
      quest.escortArrived = true;
    } else throw new Error('该委托不支持手动完成');
    if (commissionGoalsMet(quest)) { quest.currentStage = quest.totalStages; quest.status = 'ready'; }
    quest.updatedAt = Date.now();
    await this.db.questRecords.put(quest);
  }

  async completeCommission(
    profileId: string,
    questId: string,
  ): Promise<QuestCompletionResult> {
    const quest = await this.commission(profileId, questId);
    if (quest.status !== 'ready' || !commissionGoalsMet(quest)) throw new Error('委托目标尚未完成');
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

  async migrateCommissions(profileId: string): Promise<void> {
    const { tasks } = await loadGuildCatalogs();
    await this.db.transaction('rw', [this.db.questRecords, this.db.regionAccess], async () => {
      const access = await this.db.regionAccess.where('profileId').equals(profileId).toArray();
      const board = commissionBoard(tasks, access);
      const quests = await this.db.questRecords.where('profileId').equals(profileId).filter(q => q.kind === 'commission' && (q.commissionVersion !== 2 || q.commissionType === 'escort' && !q.escortDestination)).toArray();
      for (const quest of quests) {
        const task = tasks.find(t => t.id === quest.definitionId || `${t.name}:${t.region}` === quest.definitionId);
        const oldType = quest.commissionType;
        quest.commissionType = (task?.type ?? (oldType === 'investigate' ? 'combat' : oldType ?? 'combat')) as QuestRecord['commissionType'];
        quest.commissionTarget = task?.target ?? quest.commissionTarget ?? '哥布林';
        quest.totalStages = task?.count ?? quest.totalStages;
        quest.commissionKills = oldType === 'combat' ? Math.min(quest.totalStages, quest.currentStage) : 0;
        quest.commissionItems = task?.items ?? (quest.commissionType === 'gather' ? [{ itemId: quest.commissionTarget, count: quest.totalStages }] : []);
        // A ready legacy gather record was created only after items were deducted.
        quest.commissionItemsSubmitted = oldType === 'gather' && quest.status === 'ready';
        quest.commissionVersion = 2;
        quest.commissionAcceptedAt = Date.now();
        quest.commissionBattleIds = [];
        if (quest.commissionType === 'escort') {
          quest.escortDestination = board.find(t => t.id === quest.definitionId)?.destination ?? escortDestinations(quest.region, access)[0];
          quest.escortArrived = false;
          quest.objective = quest.escortDestination ? `从${quest.region}护送至${quest.escortDestination}，到达后交付。` : '解锁起点以外的地区后刷新护送路线。';
        } else if (task) quest.objective = task.desc;
        quest.currentStage = quest.commissionKills;
        quest.status = commissionGoalsMet(quest) ? 'ready' : 'active';
        if (quest.status === 'ready') quest.currentStage = quest.totalStages;
        quest.updatedAt = Date.now();
        await this.db.questRecords.put(quest);
      }
    });
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
