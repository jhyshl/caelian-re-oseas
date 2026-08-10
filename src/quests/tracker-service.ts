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
  type QuestNodeDefinition,
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
      !questSceneActivationMatches({
        currentLocation: input.currentLocation,
        node,
        recentMessages: input.recentMessages,
      })
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
  const normalized = normalizeQuestLocationText(current);
  if (!normalized) return false;
  return allowed.some((location) => {
    const candidate = normalizeQuestLocationText(location);
    if (!candidate) return false;
    return normalized.includes(candidate) || candidate.includes(normalized);
  });
}

export interface QuestSceneActivationInput {
  currentLocation: string;
  node: Pick<QuestNodeDefinition, 'locations' | 'sceneTitle'>;
  recentMessages: QuestConversationMessage[];
}

/**
 * Prefer the local world location, but allow the latest conversation to arm
 * the judge when Tavern/MVU location output is late or uses a common alias.
 * The secondary judge remains authoritative for whether the scene is active.
 */
export function questSceneActivationMatches(
  input: QuestSceneActivationInput,
): boolean {
  if (input.node.locations.length === 0) return true;
  if (questLocationMatches(input.currentLocation, input.node.locations)) {
    return true;
  }

  const recent = normalizeQuestLocationText(
    input.recentMessages
      .slice(-6)
      .map((message) => message.content)
      .join('\n'),
  );
  if (!recent) return false;

  return sceneActivationHints(input.node).some((hint) =>
    recent.includes(hint),
  );
}

function sceneActivationHints(
  node: Pick<QuestNodeDefinition, 'locations' | 'sceneTitle'>,
): string[] {
  const hints = new Set<string>();
  const sceneTitle = normalizeQuestLocationText(node.sceneTitle);
  if (sceneTitle.length >= 2) hints.add(sceneTitle);

  for (const location of node.locations) {
    const normalized = normalizeQuestLocationText(location);
    if (normalized.length < 2) continue;
    hints.add(normalized);
    if (sceneTitle.includes(normalized)) {
      const remainder = sceneTitle.replace(normalized, '');
      if (remainder.length >= 2) hints.add(remainder);
    }
  }
  return [...hints];
}

function normalizeQuestLocationText(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/中央商业(?:街区|街)/g, '中央商业区')
    .replace(/冒险家协会/g, '冒险者协会')
    .replace(/[\s·・—:：>＞/\\\-_,，。！？!?；;（）()【】[\]「」“”'"]+/g, '');
}
