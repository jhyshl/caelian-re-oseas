import type {
  QuestRecord,
  QuestTrackerRecord,
  TavernFloorReference,
} from '@/domain/types';
import type { QuestJudgeClient } from '@/quests/judge-client';
import type { QuestConversationMessage } from '@/quests/prompt-builder';
import {
  questNode,
  type QuestDefinition,
} from '@/quests/schema';
import {
  applyJudgeResult,
  initialQuestProgress,
  type QuestTransitionDecision,
} from '@/quests/state-machine';
import { QuestProgressRepository } from '@/storage/repositories/quest-progress-repository';

export interface EvaluateQuestTurnInput {
  profileId: string;
  questRecord: QuestRecord;
  quest: QuestDefinition;
  floor: TavernFloorReference;
  currentLocation: string;
  recentMessages: QuestConversationMessage[];
  onEvaluationStart?: () => void;
}

export type EvaluateQuestTurnResult =
  | {
      status: 'skipped';
      reason:
        | 'quest-mismatch'
        | 'not-active'
        | 'tracker-disabled'
        | 'outside-node-location'
        | 'not-assistant-floor'
        | 'already-evaluated';
    }
  | {
      status: 'evaluated';
      decision: QuestTransitionDecision;
      tracker: QuestTrackerRecord;
    };

export class QuestTrackerService {
  constructor(
    private readonly progress: QuestProgressRepository,
    private readonly judge: QuestJudgeClient,
  ) {}

  async evaluateAssistantTurn(
    input: EvaluateQuestTurnInput,
  ): Promise<EvaluateQuestTurnResult> {
    if (input.questRecord.definitionId !== input.quest.id) {
      return { status: 'skipped', reason: 'quest-mismatch' };
    }
    if (input.floor.role !== 'assistant') {
      return { status: 'skipped', reason: 'not-assistant-floor' };
    }
    if (input.questRecord.status !== 'active') {
      return { status: 'skipped', reason: 'not-active' };
    }

    const baseline = initialQuestProgress(input.quest);
    const existing = await this.progress.getTracker(
      input.profileId,
      input.questRecord.id,
    );
    const current = existing?.current ?? baseline;
    if (
      ['idle', 'manualPaused', 'suspended', 'ended'].includes(
        current.trackerState,
      )
    ) {
      return { status: 'skipped', reason: 'tracker-disabled' };
    }

    if (
      await this.progress.hasCheckpointForFloor(
        input.profileId,
        input.questRecord.id,
        input.floor,
      )
    ) {
      return { status: 'skipped', reason: 'already-evaluated' };
    }

    const node = questNode(input.quest, current.currentNodeId);
    if (
      current.trackerState === 'armed' &&
      !questLocationMatches(input.currentLocation, node.locations)
    ) {
      return { status: 'skipped', reason: 'outside-node-location' };
    }

    input.onEvaluationStart?.();
    const evaluation = await this.judge.evaluate({
      quest: input.quest,
      progress: current,
      currentLocation: input.currentLocation,
      recentMessages: input.recentMessages,
    });
    const decision = applyJudgeResult(
      input.quest,
      current,
      evaluation.result,
    );
    const { summary, ...next } = decision.next;
    const tracker = await this.progress.bindFloor(input.profileId, {
      questId: input.questRecord.id,
      floor: input.floor,
      summary,
      baseline,
      next,
      judgeResult: {
        ...evaluation.result,
        rawResponse: evaluation.rawResponse,
        transitionAccepted: decision.accepted,
        transitionDecision: decision.reason,
      },
    });
    return { status: 'evaluated', decision, tracker };
  }
}

export function questLocationMatches(
  current: string,
  allowed: string[],
): boolean {
  if (allowed.length === 0) return true;
  const normalized = current.trim().toLocaleLowerCase();
  if (!normalized) return false;
  return allowed.some((location) => {
    const candidate = location.trim().toLocaleLowerCase();
    return normalized.includes(candidate) || candidate.includes(normalized);
  });
}
