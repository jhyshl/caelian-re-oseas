import type {
  EquipmentInstanceRecord,
  QuestFloorCheckpointRecord,
  QuestCompletionResult,
  QuestProgressSnapshot,
  QuestRecord,
  QuestTrackerRecord,
  SpecialCollectibleRecord,
  TavernFloorReference,
} from '@/domain/types';
import type { CaelianDatabase } from '@/storage/database';
import { grantPlayerExperience } from '@/player/progression';
import { updateGuildRank } from '@/guild-progression';
import {
  questNode,
  type QuestDefinition,
} from '@/quests/schema';
import { applyLocalTransition } from '@/quests/state-machine';

export interface BindQuestFloorInput {
  questId: string;
  floor: TavernFloorReference;
  judgeResult: unknown;
  summary: string;
  next: Omit<QuestProgressSnapshot, 'summary'>;
  baseline?: QuestProgressSnapshot;
  giftItems?: Array<{ itemId: string; itemName: string; count: number }>;
}

export interface QuestFloorRollbackResult {
  questId: string;
  cutoffFloorIndex: number;
  removedCheckpointCount: number;
  restored: QuestProgressSnapshot;
}

export interface ApplyLocalQuestTransitionInput {
  questId: string;
  definition: QuestDefinition;
  transitionId: string;
  floor: TavernFloorReference;
  mode: 'automatic' | 'submit' | 'action';
}

/**
 * Stores committed quest progress with Tavern floors as an audit trail.
 * Once a node is committed, later message edits, swipes, or deletions must not
 * move the player's durable quest state backwards.
 */
export class QuestProgressRepository {
  constructor(private readonly db: CaelianDatabase) {}

  async bindFloor(
    profileId: string,
    input: BindQuestFloorInput,
  ): Promise<QuestTrackerRecord> {
    this.validateFloor(input.floor);
    const summary = input.summary.trim();
    if (summary.length > 8_000) {
      throw new Error('任务摘要不能超过 8000 个字符');
    }

    return this.db.transaction(
      'rw',
      this.db.questRecords,
      this.db.questTrackerStates,
      this.db.questFloorCheckpoints,
      this.db.inventoryStacks,
      this.db.equipmentInstances,
      async () => {
        const quest = await this.requireQuest(profileId, input.questId);
        this.validateNextState(quest, input.next);

        const trackerId = this.trackerId(profileId, input.questId);
        const existing = await this.db.questTrackerStates.get(trackerId);
        const tracker =
          existing ??
          this.createTracker(
            profileId,
            quest,
            Date.now(),
            input.baseline,
          );
        const checkpoints = await this.questCheckpoints(
          profileId,
          input.questId,
        );
        if (
          checkpoints.some(
            (checkpoint) => checkpoint.floorIndex >= input.floor.index,
          )
        ) {
          return tracker;
        }
        const before = tracker.current;
        const after: QuestProgressSnapshot = {
          ...input.next,
          summary,
        };
        const now = Date.now();
        const checkpoint: QuestFloorCheckpointRecord = {
          id: this.checkpointId(trackerId, input.floor),
          profileId,
          questId: input.questId,
          floorId: input.floor.id,
          floorIndex: input.floor.index,
          floorFingerprint: input.floor.fingerprint,
          lineageHash: input.floor.lineageHash,
          source: 'judge',
          judgeResult: {
            ...(input.judgeResult && typeof input.judgeResult === 'object'
              ? input.judgeResult
              : { raw: input.judgeResult }),
            appliedGiftItems: input.giftItems ?? [],
          },
          summary,
          before,
          after,
          createdAt: now,
        };

        for (const item of input.giftItems ?? []) {
          const id = `${profileId}:${item.itemId}`;
          const stack = await this.db.inventoryStacks.get(id);
          await this.db.inventoryStacks.put({
            id,
            profileId,
            itemId: item.itemId,
            name: stack?.name ?? item.itemName,
            quantity: (stack?.quantity ?? 0) + item.count,
            updatedAt: now,
          });
        }
        await this.db.questFloorCheckpoints.put(checkpoint);

        const updated: QuestTrackerRecord = {
          ...tracker,
          current: after,
          updatedAt: now,
        };
        await this.db.questTrackerStates.put(updated);
        await this.applySnapshotToQuest(quest, after, now);
        return updated;
      },
    );
  }

  async acceptDefinition(
    profileId: string,
    definition: QuestDefinition,
  ): Promise<QuestRecord> {
    return this.db.transaction(
      'rw',
      this.db.playerStates,
      this.db.questRecords,
      this.db.questHistory,
      async () => {
        const player = await this.db.playerStates.get(profileId);
        if (!player?.created) throw new Error('请先创建冒险者');
        if (player.level < definition.minimumLevel) {
          throw new Error(
            `该任务需要玩家等级 Lv.${definition.minimumLevel}`,
          );
        }
        const existing = await this.db.questRecords
          .where('profileId')
          .equals(profileId)
          .filter((quest) => quest.definitionId === definition.id)
          .first();
        if (existing) throw new Error('该任务已经在任务记录中');
        const completed = await this.db.questHistory
          .where('profileId')
          .equals(profileId)
          .filter((quest) => quest.definitionId === definition.id)
          .first();
        if (completed) throw new Error('该任务已经完成，不能重复接取');

        const start = questNode(definition, definition.startNodeId);
        const rewards = definition.rewards.default;
        const now = Date.now();
        const record: QuestRecord = {
          id: `${profileId}:${definition.kind}:${definition.id}`,
          profileId,
          definitionId: definition.id,
          kind: definition.kind,
          title: definition.name,
          region: definition.region,
          objective: start.objective,
          status: start.status,
          currentStage: start.stage,
          totalStages: Math.max(
            ...definition.nodes.map((node) => node.stage),
          ),
          rewardExperience: rewards.experience,
          rewardGold: rewards.gold,
          rewardGuildExperience: rewards.guildExperience,
          updatedAt: now,
        };
        await this.db.questRecords.add(record);
        return record;
      },
    );
  }

  async selectQuest(
    profileId: string,
    questId: string,
    baseline: QuestProgressSnapshot,
  ): Promise<QuestTrackerRecord> {
    return this.db.transaction(
      'rw',
      this.db.questRecords,
      this.db.questTrackerStates,
      async () => {
        const quest = await this.requireQuest(profileId, questId);
        if (!['active', 'ready'].includes(quest.status)) {
          throw new Error('只有进行中或等待结算的任务可以开始追踪');
        }
        const trackers = await this.db.questTrackerStates
          .where('profileId')
          .equals(profileId)
          .toArray();
        if (trackers.length > 0) {
          await this.db.questTrackerStates.bulkPut(
            trackers.map((tracker) => ({
              ...tracker,
              selected: false,
            })),
          );
        }
        const id = this.trackerId(profileId, questId);
        const existing = await this.db.questTrackerStates.get(id);
        const current = existing?.current ?? baseline;
        const selected: QuestTrackerRecord = {
          ...(existing ??
            this.createTracker(profileId, quest, Date.now(), baseline)),
          selected: true,
          current: {
            ...current,
            trackerState:
              current.status === 'active' ? 'armed' : 'ended',
          },
          updatedAt: Date.now(),
        };
        await this.db.questTrackerStates.put(selected);
        return selected;
      },
    );
  }

  async setSelectedTrackerState(
    profileId: string,
    state: 'armed' | 'manualPaused',
  ): Promise<QuestTrackerRecord | undefined> {
    const tracker = await this.selectedTracker(profileId);
    if (!tracker) return undefined;
    if (state === 'armed' && tracker.current.status !== 'active') {
      throw new Error('已经结束的任务不能继续追踪');
    }
    const updated: QuestTrackerRecord = {
      ...tracker,
      current: { ...tracker.current, trackerState: state },
      updatedAt: Date.now(),
    };
    await this.db.questTrackerStates.put(updated);
    return updated;
  }

  async applyLocalQuestTransition(
    profileId: string,
    input: ApplyLocalQuestTransitionInput,
  ): Promise<QuestTrackerRecord> {
    this.validateFloor(input.floor);
    return this.db.transaction(
      'rw',
      [
        this.db.questRecords,
        this.db.questTrackerStates,
        this.db.questFloorCheckpoints,
        this.db.inventoryStacks,
        this.db.equipmentInstances,
        this.db.battleSessions,
      ],
      async () => {
        const quest = await this.requireQuest(profileId, input.questId);
        if (quest.definitionId !== input.definition.id) {
          throw new Error('任务记录与任务定义不匹配');
        }
        const trackerId = this.trackerId(profileId, input.questId);
        const tracker = await this.db.questTrackerStates.get(trackerId);
        if (!tracker?.selected) throw new Error('该任务当前没有被追踪');
        const checkpointId = this.localCheckpointId(
          trackerId,
          input.floor,
          input.transitionId,
        );
        if (await this.db.questFloorCheckpoints.get(checkpointId)) {
          return tracker;
        }

        const node = questNode(
          input.definition,
          tracker.current.currentNodeId,
        );
        const transition = node.transitions.find(
          (candidate) => candidate.id === input.transitionId,
        );
        if (!transition || transition.authority !== 'local') {
          throw new Error('当前节点不存在指定的本地任务跳转');
        }
        const trigger = transition.localTrigger;
        if (!trigger) throw new Error('本地任务跳转缺少触发条件');
        const automatic = [
          'inventory_at_least',
          'parallel_scenes_complete',
          'battle_won',
        ].includes(trigger.type);
        if (
          (input.mode === 'automatic' && !automatic) ||
          (input.mode === 'submit' && trigger.type !== 'submit_item') ||
          (input.mode === 'action' && automatic)
        ) {
          throw new Error('本地任务动作类型不匹配');
        }
        const now = Date.now();
        let summary: string;
        let grantedEquipmentIds: string[] = [];
        if (
          trigger.type === 'inventory_at_least' ||
          trigger.type === 'submit_item'
        ) {
          const stackId = `${profileId}:${trigger.itemId}`;
          const stack = await this.db.inventoryStacks.get(stackId);
          const quantity = stack?.quantity ?? 0;
          if (quantity < trigger.count) {
            throw new Error(
              `${trigger.itemName}不足：需要 ${trigger.count}，当前 ${quantity}`,
            );
          }
          if (trigger.type === 'submit_item') {
            const remaining = quantity - trigger.count;
            if (remaining === 0) {
              await this.db.inventoryStacks.delete(stackId);
            } else if (stack) {
              await this.db.inventoryStacks.put({
                ...stack,
                quantity: remaining,
                updatedAt: now,
              });
            }
            summary = `玩家已提交${trigger.itemName}×${trigger.count}。`;
          } else {
            summary = `本地背包已确认持有${trigger.itemName}×${quantity}。`;
          }
        } else if (trigger.type === 'claim_items') {
          for (const item of trigger.items) {
            const id = `${profileId}:${item.itemId}`;
            const current = await this.db.inventoryStacks.get(id);
            await this.db.inventoryStacks.put({
              id,
              profileId,
              itemId: item.itemId,
              name: current?.name ?? item.itemName,
              quantity: (current?.quantity ?? 0) + item.count,
              updatedAt: now,
            });
          }
          summary = `玩家已领取${trigger.items.map((item) => `${item.itemName}×${item.count}`).join('、')}。`;
        } else if (trigger.type === 'claim_equipment') {
          grantedEquipmentIds = Array.from(
            { length: trigger.equipment.count },
            (_, index) =>
              `${profileId}:${trigger.equipment.baseId}:quest:${encodeURIComponent(transition.id)}:${now}:${index}`,
          );
          const records: EquipmentInstanceRecord[] = grantedEquipmentIds.map(
            (id) => ({
              id,
              profileId,
              baseId: trigger.equipment.baseId,
              name: trigger.equipment.name,
              slot: trigger.equipment.slot,
              rarity: trigger.equipment.rarity,
              stars: trigger.equipment.stars,
              stats: { ...trigger.equipment.stats },
              description: trigger.equipment.description,
              updatedAt: now,
            }),
          );
          await this.db.equipmentInstances.bulkAdd(records);
          summary = `玩家已领取${trigger.equipment.name}×${trigger.equipment.count}。`;
        } else if (trigger.type === 'parallel_scenes_complete') {
          const completed = new Set(tracker.current.completedSceneIds ?? []);
          if (!trigger.sceneIds.every((sceneId) => completed.has(sceneId))) {
            throw new Error('并行剧情节点尚未全部完成');
          }
          summary = `并行剧情已完成：${trigger.sceneIds.join('、')}。`;
        } else if (trigger.type === 'battle_won') {
          const victory = await this.db.battleSessions
            .where('profileId')
            .equals(profileId)
            .filter(
              (battle) =>
                battle.relatedQuestId === quest.id &&
                battle.state.status === 'victory' &&
                battle.state.enemies.some(
                  (enemy) => enemy.definitionId === trigger.monsterId,
                ),
            )
            .first();
          if (!victory) throw new Error('尚未检测到对应任务战斗胜利');
          summary = `本地战斗记录确认已击败${trigger.monsterId}。`;
        } else {
          summary = '玩家已在任务面板确认当前动作。';
        }
        const decision = applyLocalTransition(
          input.definition,
          tracker.current,
          transition.id,
          summary,
        );
        if (!decision.accepted) throw new Error('本地任务跳转被状态机拒绝');
        const checkpoint: QuestFloorCheckpointRecord = {
          id: checkpointId,
          profileId,
          questId: quest.id,
          floorId: input.floor.id,
          floorIndex: input.floor.index,
          floorFingerprint: input.floor.fingerprint,
          lineageHash: input.floor.lineageHash,
          source: 'local',
          judgeResult: {
            source: 'local',
            transitionId: transition.id,
            trigger,
            ...(grantedEquipmentIds.length > 0
              ? { grantedEquipmentIds }
              : {}),
          },
          summary,
          before: tracker.current,
          after: decision.next,
          createdAt: now,
        };
        const updated: QuestTrackerRecord = {
          ...tracker,
          current: decision.next,
          updatedAt: now,
        };
        await this.db.questFloorCheckpoints.put(checkpoint);
        await this.db.questTrackerStates.put(updated);
        await this.applySnapshotToQuest(quest, decision.next, now);
        return updated;
      },
    );
  }

  async submitPendingItem(
    profileId: string,
    questId: string,
  ): Promise<QuestTrackerRecord> {
    return this.db.transaction(
      'rw',
      this.db.questRecords,
      this.db.questTrackerStates,
      this.db.questFloorCheckpoints,
      this.db.inventoryStacks,
      async () => {
        const quest = await this.requireQuest(profileId, questId);
        const trackerId = this.trackerId(profileId, questId);
        const tracker = await this.db.questTrackerStates.get(trackerId);
        if (!tracker?.selected) throw new Error('该任务当前没有被追踪');
        const pending = tracker.current.pendingItemSubmission;
        if (!pending) throw new Error('当前剧情没有等待提交的物品');
        const stackId = `${profileId}:${pending.itemId}`;
        const stack = await this.db.inventoryStacks.get(stackId);
        const owned = stack?.quantity ?? 0;
        if (owned < pending.count) {
          throw new Error(
            `${pending.itemName}数量不足：需要 ${pending.count}，当前 ${owned}`,
          );
        }
        const now = Date.now();
        const remaining = owned - pending.count;
        if (remaining === 0) await this.db.inventoryStacks.delete(stackId);
        else if (stack) {
          await this.db.inventoryStacks.put({
            ...stack,
            quantity: remaining,
            updatedAt: now,
          });
        }
        const after: QuestProgressSnapshot = {
          ...pending.deferredProgress,
          summary: `${tracker.current.summary}\n玩家已提交${pending.itemName}×${pending.count}。`.trim(),
        };
        const checkpoint: QuestFloorCheckpointRecord = {
          id: `${this.checkpointId(trackerId, {
            id: pending.requestedFloorId,
            index: pending.requestedFloorIndex,
            role: 'assistant',
            fingerprint: pending.requestedFloorFingerprint,
            lineageHash: pending.requestedLineageHash,
          })}:pending-submission`,
          profileId,
          questId,
          floorId: pending.requestedFloorId,
          floorIndex: pending.requestedFloorIndex,
          floorFingerprint: pending.requestedFloorFingerprint,
          lineageHash: pending.requestedLineageHash,
          source: 'local',
          judgeResult: {
            source: 'pending-item-submission',
            trigger: {
              type: 'submit_item',
              itemId: pending.itemId,
              itemName: pending.itemName,
              count: pending.count,
            },
          },
          summary: after.summary,
          before: tracker.current,
          after,
          createdAt: now,
        };
        const updated: QuestTrackerRecord = {
          ...tracker,
          current: after,
          updatedAt: now,
        };
        await this.db.questFloorCheckpoints.put(checkpoint);
        await this.db.questTrackerStates.put(updated);
        await this.applySnapshotToQuest(quest, after, now);
        return updated;
      },
    );
  }

  async availableAutomaticTransition(
    profileId: string,
    questId: string,
    definition: QuestDefinition,
  ): Promise<string | undefined> {
    const tracker = await this.db.questTrackerStates.get(
      this.trackerId(profileId, questId),
    );
    if (!tracker?.selected || tracker.current.status !== 'active') {
      return undefined;
    }
    const node = questNode(definition, tracker.current.currentNodeId);
    for (const transition of node.transitions) {
      if (transition.authority !== 'local' || !transition.localTrigger) continue;
      const trigger = transition.localTrigger;
      if (trigger.type === 'inventory_at_least') {
        const stack = await this.db.inventoryStacks.get(
          `${profileId}:${trigger.itemId}`,
        );
        if ((stack?.quantity ?? 0) >= trigger.count) return transition.id;
      }
      if (trigger.type === 'parallel_scenes_complete') {
        const completed = new Set(tracker.current.completedSceneIds ?? []);
        if (trigger.sceneIds.every((sceneId) => completed.has(sceneId))) {
          return transition.id;
        }
      }
      if (trigger.type === 'battle_won') {
        const victory = await this.db.battleSessions
          .where('profileId')
          .equals(profileId)
          .filter(
            (battle) =>
              battle.relatedQuestId === questId &&
              battle.state.status === 'victory' &&
              battle.state.enemies.some(
                (enemy) => enemy.definitionId === trigger.monsterId,
              ),
          )
          .first();
        if (victory) return transition.id;
      }
    }
    return undefined;
  }

  async completeDefinition(
    profileId: string,
    definition: QuestDefinition,
  ): Promise<QuestCompletionResult> {
    return this.db.transaction(
      'rw',
      [
        this.db.profiles,
        this.db.playerStates,
        this.db.guildStates,
        this.db.regionAccess,
        this.db.questRecords,
        this.db.questHistory,
        this.db.questTrackerStates,
        this.db.questFloorCheckpoints,
        this.db.specialCollectibles,
        this.db.ownedRelics,
      ],
      async () => {
        const quest = await this.db.questRecords
          .where('profileId')
          .equals(profileId)
          .filter((candidate) => candidate.definitionId === definition.id)
          .first();
        if (!quest) throw new Error('待结算任务不存在');
        if (quest.status !== 'ready') throw new Error('任务尚未达到结算条件');
        const tracker = await this.db.questTrackerStates.get(
          this.trackerId(profileId, quest.id),
        );
        const ending = tracker?.current.ending ?? quest.ending;
        const reward =
          (ending ? definition.rewards.endings[ending] : undefined) ??
          definition.rewards.default;
        const [player, guild] = await Promise.all([
          this.db.playerStates.get(profileId),
          this.db.guildStates.get(profileId),
        ]);
        if (!player?.created) throw new Error('玩家档案不存在');
        if (!guild) throw new Error('协会档案不存在');

        const now = Date.now();
        const startingLevel = player.level;
        grantPlayerExperience(player, reward.experience);
        player.gold += reward.gold;
        player.updatedAt = now;
        guild.experience += reward.guildExperience;
        guild.completedTaskCount += 1;
        guild.updatedAt = now;
        updateGuildRank(guild);
        await this.db.playerStates.put(player);
        await this.db.guildStates.put(guild);
        if (definition.id === 'main_niyasos_failed_sacrifice') {
          await this.db.regionAccess.update(`${profileId}:abyss_sea`, {
            accessible: true,
            unlockCondition: '',
            updatedAt: now,
          });
        }

        let carriedCount = await this.db.ownedRelics
          .where('profileId')
          .equals(profileId)
          .filter((relic) => relic.carried)
          .count();
        for (const name of reward.collectibles) {
          const collectibleId = `quest:${definition.id}:${name}`;
          const id = `${profileId}:${collectibleId}`;
          const collectible: SpecialCollectibleRecord = {
            id,
            profileId,
            collectibleId,
            name,
            summary: `完成任务「${definition.name}」${ending ? `结局 ${ending}` : ''}的纪念品。`,
            source: `任务：${definition.name}`,
            acquiredDate: new Date(now).toISOString(),
            updatedAt: now,
          };
          await this.db.specialCollectibles.put(collectible);
          const carried = carriedCount < 5;
          await this.db.ownedRelics.put({
            id,
            profileId,
            relicId: collectibleId,
            carried,
            acquiredAt: now,
            updatedAt: now,
          });
          if (carried) carriedCount += 1;
        }

        await this.db.questHistory.put({
          id: quest.id,
          profileId,
          kind: quest.kind,
          title: quest.title,
          definitionId: definition.id,
          ...(ending ? { ending } : {}),
          rewardExperience: reward.experience,
          rewardGold: reward.gold,
          rewardGuildExperience: reward.guildExperience,
          rewardCollectibles: [...reward.collectibles],
          completedDate: new Date(now).toISOString(),
          updatedAt: now,
        });
        const checkpoints = await this.questCheckpoints(profileId, quest.id);
        if (checkpoints.length > 0) {
          await this.db.questFloorCheckpoints.bulkDelete(
            checkpoints.map((checkpoint) => checkpoint.id),
          );
        }
        await this.db.questTrackerStates.delete(
          this.trackerId(profileId, quest.id),
        );
        await this.db.questRecords.delete(quest.id);
        await this.db.profiles.update(profileId, { updatedAt: now });
        return {
          questId: quest.id,
          definitionId: definition.id,
          title: definition.name,
          ...(ending ? { ending } : {}),
          experience: reward.experience,
          gold: reward.gold,
          guildExperience: reward.guildExperience,
          collectibles: [...reward.collectibles],
          levelsGained: player.level - startingLevel,
        };
      },
    );
  }

  selectedTracker(
    profileId: string,
  ): Promise<QuestTrackerRecord | undefined> {
    return this.db.questTrackerStates
      .where('profileId')
      .equals(profileId)
      .filter((tracker) => tracker.selected === true)
      .first();
  }

  async rollbackFromFloor(
    profileId: string,
    floorIndex: number,
  ): Promise<QuestFloorRollbackResult[]> {
    void profileId;
    void floorIndex;
    return [];
  }

  async reconcileFloors(
    profileId: string,
    floors: TavernFloorReference[],
  ): Promise<QuestFloorRollbackResult[]> {
    void profileId;
    void floors;
    return [];
  }

  getTracker(
    profileId: string,
    questId: string,
  ): Promise<QuestTrackerRecord | undefined> {
    return this.db.questTrackerStates.get(this.trackerId(profileId, questId));
  }

  listCheckpoints(
    profileId: string,
    questId: string,
  ): Promise<QuestFloorCheckpointRecord[]> {
    return this.questCheckpoints(profileId, questId);
  }

  async hasCheckpointForFloor(
    profileId: string,
    questId: string,
    floor: TavernFloorReference,
  ): Promise<boolean> {
    const checkpoints = await this.questCheckpoints(profileId, questId);
    return checkpoints.some(
      (checkpoint) => checkpoint.floorIndex >= floor.index,
    );
  }

  async clearQuest(profileId: string, questId: string): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.questTrackerStates,
      this.db.questFloorCheckpoints,
      this.db.inventoryStacks,
      this.db.equipmentInstances,
      async () => {
        const trackerId = this.trackerId(profileId, questId);
        const checkpoints = await this.questCheckpoints(profileId, questId);
        if (checkpoints.length > 0) {
          await this.rollbackLocalEffects(checkpoints, Date.now());
          await this.db.questFloorCheckpoints.bulkDelete(
            checkpoints.map((checkpoint) => checkpoint.id),
          );
        }
        await this.db.questTrackerStates.delete(trackerId);
      },
    );
  }

  private async questCheckpoints(
    profileId: string,
    questId: string,
  ): Promise<QuestFloorCheckpointRecord[]> {
    const checkpoints = await this.db.questFloorCheckpoints
      .where('[profileId+questId]')
      .equals([profileId, questId])
      .toArray();
    const flowRank = (checkpoint: QuestFloorCheckpointRecord) =>
      checkpoint.source === 'judge' ? 0 : 1;
    return checkpoints.sort((left, right) => {
      const floorOrder = left.floorIndex - right.floorIndex;
      if (floorOrder !== 0) return floorOrder;
      const sourceOrder = flowRank(left) - flowRank(right);
      if (sourceOrder !== 0) return sourceOrder;
      if (left.after.currentNodeId === right.before.currentNodeId) return -1;
      if (right.after.currentNodeId === left.before.currentNodeId) return 1;
      return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
    });
  }

  private async rollbackLocalEffects(
    checkpoints: QuestFloorCheckpointRecord[],
    updatedAt: number,
  ): Promise<void> {
    for (const checkpoint of checkpoints) {
      const result = checkpoint.judgeResult;
      if (
        result &&
        typeof result === 'object' &&
        'appliedGiftItems' in result
      ) {
        const gifts = Array.isArray(result.appliedGiftItems)
          ? result.appliedGiftItems
          : [];
        for (const gift of gifts) {
          if (
            !gift ||
            typeof gift !== 'object' ||
            !('itemId' in gift) ||
            typeof gift.itemId !== 'string' ||
            !('count' in gift) ||
            typeof gift.count !== 'number'
          ) continue;
          const id = `${checkpoint.profileId}:${gift.itemId}`;
          const stack = await this.db.inventoryStacks.get(id);
          if (!stack) continue;
          const quantity = stack.quantity - gift.count;
          if (quantity <= 0) await this.db.inventoryStacks.delete(id);
          else await this.db.inventoryStacks.put({ ...stack, quantity, updatedAt });
        }
      }
      if (checkpoint.source !== 'local') continue;
      if (!result || typeof result !== 'object' || !('trigger' in result)) continue;
      const trigger = result.trigger;
      if (!trigger || typeof trigger !== 'object' || !('type' in trigger)) {
        continue;
      }
      if (
        trigger.type === 'submit_item' &&
        'itemId' in trigger &&
        typeof trigger.itemId === 'string' &&
        'itemName' in trigger &&
        typeof trigger.itemName === 'string' &&
        'count' in trigger &&
        typeof trigger.count === 'number'
      ) {
        const id = `${checkpoint.profileId}:${trigger.itemId}`;
        const stack = await this.db.inventoryStacks.get(id);
        await this.db.inventoryStacks.put({
          id,
          profileId: checkpoint.profileId,
          itemId: trigger.itemId,
          name: stack?.name ?? trigger.itemName,
          quantity: (stack?.quantity ?? 0) + trigger.count,
          updatedAt,
        });
      }
      if (trigger.type === 'claim_items' && 'items' in trigger) {
        const items = Array.isArray(trigger.items) ? trigger.items : [];
        for (const item of items) {
          if (
            !item ||
            typeof item !== 'object' ||
            !('itemId' in item) ||
            typeof item.itemId !== 'string' ||
            !('count' in item) ||
            typeof item.count !== 'number'
          ) {
            continue;
          }
          const id = `${checkpoint.profileId}:${item.itemId}`;
          const stack = await this.db.inventoryStacks.get(id);
          if (!stack) continue;
          const quantity = stack.quantity - item.count;
          if (quantity <= 0) await this.db.inventoryStacks.delete(id);
          else {
            await this.db.inventoryStacks.put({
              ...stack,
              quantity,
              updatedAt,
            });
          }
        }
      }
      if (
        trigger.type === 'claim_equipment' &&
        'grantedEquipmentIds' in result &&
        Array.isArray(result.grantedEquipmentIds)
      ) {
        await this.db.equipmentInstances.bulkDelete(
          result.grantedEquipmentIds.filter(
            (id): id is string => typeof id === 'string',
          ),
        );
      }
    }
  }

  private async requireQuest(
    profileId: string,
    questId: string,
  ): Promise<QuestRecord> {
    const quest = await this.db.questRecords.get(questId);
    if (!quest || quest.profileId !== profileId) {
      throw new Error('任务不存在或不属于当前存档');
    }
    return quest;
  }

  private createTracker(
    profileId: string,
    quest: QuestRecord,
    now: number,
    suppliedBaseline?: QuestProgressSnapshot,
  ): QuestTrackerRecord {
    const baseline: QuestProgressSnapshot =
      suppliedBaseline ?? {
        status: quest.status,
        trackerState: quest.status === 'active' ? 'armed' : 'idle',
        currentStage: quest.currentStage,
        currentNodeId: `stage:${quest.currentStage}`,
        objective: quest.objective,
        summary: '',
      };
    return {
      id: this.trackerId(profileId, quest.id),
      profileId,
      questId: quest.id,
      selected: true,
      baseline,
      current: baseline,
      updatedAt: now,
    };
  }

  private async applySnapshotToQuest(
    quest: QuestRecord,
    snapshot: QuestProgressSnapshot,
    updatedAt: number,
  ): Promise<void> {
    await this.db.questRecords.put({
      ...quest,
      status: snapshot.status,
      currentStage: snapshot.currentStage,
      objective: snapshot.objective,
      ...(snapshot.ending ? { ending: snapshot.ending } : { ending: undefined }),
      ...(snapshot.rewardExperience !== undefined
        ? { rewardExperience: snapshot.rewardExperience }
        : {}),
      ...(snapshot.rewardGold !== undefined
        ? { rewardGold: snapshot.rewardGold }
        : {}),
      ...(snapshot.rewardGuildExperience !== undefined
        ? { rewardGuildExperience: snapshot.rewardGuildExperience }
        : {}),
      updatedAt,
    });
  }

  private validateFloor(floor: TavernFloorReference): void {
    if (!Number.isInteger(floor.index) || floor.index < 0) {
      throw new Error('楼层序号无效');
    }
    if (!floor.id || !floor.fingerprint || !floor.lineageHash) {
      throw new Error('楼层引用不完整');
    }
  }

  private validateNextState(
    quest: QuestRecord,
    next: Omit<QuestProgressSnapshot, 'summary'>,
  ): void {
    if (
      !Number.isInteger(next.currentStage) ||
      next.currentStage < 0 ||
      next.currentStage > quest.totalStages
    ) {
      throw new Error('任务阶段超出允许范围');
    }
    if (!next.currentNodeId.trim()) throw new Error('任务节点不能为空');
    if (!next.objective.trim()) throw new Error('任务目标不能为空');
  }

  private trackerId(profileId: string, questId: string): string {
    return `${profileId}:quest-tracker:${encodeURIComponent(questId)}`;
  }

  private checkpointId(
    trackerId: string,
    floor: TavernFloorReference,
  ): string {
    return `${trackerId}:floor:${encodeURIComponent(floor.id)}`;
  }

  private localCheckpointId(
    trackerId: string,
    floor: TavernFloorReference,
    transitionId: string,
  ): string {
    return `${this.checkpointId(trackerId, floor)}:local:${encodeURIComponent(transitionId)}`;
  }
}
