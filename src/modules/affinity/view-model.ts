import type { SocialProgressRecord } from '@/domain/types';
import {
  AFFINITY_MAX,
  RELATIONSHIP_MILESTONES,
  relationshipStage,
} from '@/mvu/contracts';

export { AFFINITY_MAX } from '@/mvu/contracts';

export interface AffinityViewModel {
  affinity: number;
  percent: number;
  relationshipStage: string;
  mood: string;
  location: string;
  clothing: string;
  innerThought: string;
  nextStageLabel: string;
  nextStageRemaining: number;
  isMaximum: boolean;
}

export function createAffinityViewModel(
  social: SocialProgressRecord,
): AffinityViewModel {
  const affinity = clampAffinity(social.affinity);
  const nextStage = RELATIONSHIP_MILESTONES.find(
    ({ threshold }) => affinity < threshold,
  );

  return {
    affinity,
    percent: (affinity / AFFINITY_MAX) * 100,
    relationshipStage: relationshipStage(affinity),
    mood: cleanText(social.mood, '平静'),
    location: cleanText(social.location, '圣德里安学院'),
    clothing: cleanText(
      social.clothing,
      '白色暗纹衬衫搭配红金色马甲',
    ),
    innerThought: cleanText(social.innerThought, '暂无记录'),
    nextStageLabel: nextStage?.label ?? '伴侣',
    nextStageRemaining: nextStage
      ? Math.max(0, nextStage.threshold - affinity)
      : 0,
    isMaximum: !nextStage,
  };
}

function clampAffinity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.max(0, Math.min(AFFINITY_MAX, value));
  return Math.round(clamped * 2) / 2;
}

function cleanText(value: string, fallback: string): string {
  return value.trim() || fallback;
}
