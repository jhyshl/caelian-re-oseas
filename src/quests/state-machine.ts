import type {
  QuestProgressSnapshot,
  QuestTrackerState,
} from '@/domain/types';
import {
  questNode,
  type QuestDefinition,
  type QuestJudgeResult,
} from '@/quests/schema';

export interface QuestTransitionDecision {
  accepted: boolean;
  reason:
    | 'stay'
    | 'accepted'
    | 'unknown-transition'
    | 'local-authority-required'
    | 'judge-authority-required'
    | 'wrong-target'
    | 'guard-not-satisfied'
    | 'completion-gate-not-satisfied'
    | 'low-confidence'
    | 'awaiting-item-submission';
  next: QuestProgressSnapshot;
}

export function initialQuestProgress(
  quest: QuestDefinition,
): QuestProgressSnapshot {
  const node = questNode(quest, quest.startNodeId);
  return {
    status: node.status,
    trackerState: node.status === 'active' ? 'armed' : 'ended',
    currentStage: node.stage,
    currentNodeId: node.id,
    currentStageId: node.stageId,
    currentSceneId: node.sceneId,
    currentBeatId: node.id,
    completedSceneIds: [],
    objective: node.objective,
    summary: '',
    ...(node.ending ? { ending: node.ending } : {}),
    ...rewardSnapshot(quest, node.ending),
  };
}

export function applyJudgeResult(
  quest: QuestDefinition,
  current: QuestProgressSnapshot,
  result: QuestJudgeResult,
): QuestTransitionDecision {
  const currentNode = questNode(quest, current.currentNodeId);
  const stayed: QuestProgressSnapshot = {
    ...current,
    trackerState: trackerStateFor(result.sceneState, current.trackerState),
    summary: result.summary,
  };
  if (result.progress === 'stay') {
    return { accepted: false, reason: 'stay', next: stayed };
  }

  const transition = currentNode.transitions.find(
    (candidate) => candidate.id === result.matchedTransitionId,
  );
  if (!transition) {
    return { accepted: false, reason: 'unknown-transition', next: stayed };
  }
  if (transition.authority !== 'judge') {
    return {
      accepted: false,
      reason: 'local-authority-required',
      next: stayed,
    };
  }
  if (transition.to !== result.suggestedNodeId) {
    return { accepted: false, reason: 'wrong-target', next: stayed };
  }
  if (!result.completionGateSatisfied) {
    return {
      accepted: false,
      reason: 'completion-gate-not-satisfied',
      next: stayed,
    };
  }
  const completedSceneIds = new Set(current.completedSceneIds ?? []);
  if (
    (transition.guards?.incompleteSceneId &&
      completedSceneIds.has(transition.guards.incompleteSceneId)) ||
    transition.guards?.completedSceneIds?.some(
      (sceneId) => !completedSceneIds.has(sceneId),
    )
  ) {
    return { accepted: false, reason: 'guard-not-satisfied', next: stayed };
  }
  if (result.confidence < transition.minConfidence) {
    return { accepted: false, reason: 'low-confidence', next: stayed };
  }

  const target = questNode(quest, transition.to);
  const next: QuestProgressSnapshot = {
    status: target.status,
    trackerState:
      target.status === 'active'
        ? trackerStateFor(result.sceneState, 'tracking')
        : 'ended',
    currentStage: target.stage,
    currentNodeId: target.id,
    currentStageId: target.stageId,
    currentSceneId: target.sceneId,
    currentBeatId: target.id,
    completedSceneIds: completedScenes(current, transition.effects?.completeSceneId),
    objective: target.objective,
    summary: result.summary,
    ...(target.ending ? { ending: target.ending } : {}),
    ...rewardSnapshot(quest, target.ending),
  };
  return { accepted: true, reason: 'accepted', next };
}

export function applyLocalTransition(
  quest: QuestDefinition,
  current: QuestProgressSnapshot,
  transitionId: string,
  summary: string,
): QuestTransitionDecision {
  const currentNode = questNode(quest, current.currentNodeId);
  const transition = currentNode.transitions.find(
    (candidate) => candidate.id === transitionId,
  );
  if (!transition) {
    return { accepted: false, reason: 'unknown-transition', next: current };
  }
  if (transition.authority !== 'local') {
    return {
      accepted: false,
      reason: 'judge-authority-required',
      next: current,
    };
  }
  const target = questNode(quest, transition.to);
  return {
    accepted: true,
    reason: 'accepted',
    next: {
      status: target.status,
      trackerState: target.status === 'active' ? 'tracking' : 'ended',
      currentStage: target.stage,
      currentNodeId: target.id,
      currentStageId: target.stageId,
      currentSceneId: target.sceneId,
      currentBeatId: target.id,
      completedSceneIds: completedScenes(
        current,
        transition.effects?.completeSceneId,
      ),
      objective: target.objective,
      summary: summary.trim(),
      ...(target.ending ? { ending: target.ending } : {}),
      ...rewardSnapshot(quest, target.ending),
    },
  };
}

function completedScenes(
  current: QuestProgressSnapshot,
  completedSceneId?: string,
): string[] {
  const completed = new Set(current.completedSceneIds ?? []);
  if (completedSceneId) completed.add(completedSceneId);
  return [...completed];
}

function rewardSnapshot(
  quest: QuestDefinition,
  ending?: string,
): Pick<
  QuestProgressSnapshot,
  'rewardExperience' | 'rewardGold' | 'rewardGuildExperience'
> {
  const reward =
    (ending ? quest.rewards.endings[ending] : undefined) ??
    quest.rewards.default;
  return {
    rewardExperience: reward.experience,
    rewardGold: reward.gold,
    rewardGuildExperience: reward.guildExperience,
  };
}

function trackerStateFor(
  sceneState: QuestJudgeResult['sceneState'],
  fallback: QuestTrackerState,
): QuestTrackerState {
  switch (sceneState) {
    case 'in_scene':
    case 'candidate_complete':
    case 'candidate_failed':
      return 'tracking';
    case 'temporary_detour':
      return 'detour';
    case 'left_scene':
    case 'drifted':
      return 'suspended';
    case 'uncertain':
      return fallback === 'evaluating' ? 'tracking' : fallback;
  }
}
