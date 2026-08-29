import type { CardDefinition, CardEffect } from '@/content/types';
import type {
  BattleFriendlyTargetId,
  BattleTimedEffect,
} from '@/domain/types';

export const BLOOD_BURN_INSUFFICIENT_HP_MESSAGE =
  '生命值不足：烧血结算后必须至少保留 1HP；请先使用治疗自己的卡牌。';

export interface BloodBurnAction {
  amountPerStack: number;
  stacks: number;
  total: number;
}

type BloodBurnSource = {
  hp: number;
  hpMax: number;
  buffs: Record<string, BattleTimedEffect>;
};

const PLAYER_HEAL_EFFECT_TYPES = new Set([
  'heal',
  'heal_overflow_shield',
  'cleanse_heal_per',
]);

function nestedEffects(effect: CardEffect): CardEffect[] {
  return ['effects', 'then_effects', 'else_effects'].flatMap((key) =>
    Array.isArray(effect[key]) ? (effect[key] as CardEffect[]) : [],
  );
}

function effectHealsPlayer(
  effect: CardEffect,
  allyTargetId: BattleFriendlyTargetId,
): boolean {
  if (effect.type === 'strip_buffs_heal_per') return true;
  if (PLAYER_HEAL_EFFECT_TYPES.has(effect.type)) {
    if (effect.target === 'all_summons') return false;
    if (effect.target === 'all_allies') return true;
    return allyTargetId !== 'caelian';
  }
  return nestedEffects(effect).some((child) =>
    effectHealsPlayer(child, allyTargetId),
  );
}

export function cardHealsPlayerBeforeBloodBurn(
  card: CardDefinition,
  allyTargetId: BattleFriendlyTargetId,
): boolean {
  return (card.effects ?? []).some((effect) =>
    effectHealsPlayer(effect, allyTargetId),
  );
}

export function bloodBurnAction(
  source: Pick<BloodBurnSource, 'hpMax' | 'buffs'>,
): BloodBurnAction | null {
  const effect = source.buffs.blood_burn;
  if (!effect) return null;
  const rawStacks = Number(effect.stacks ?? 1);
  const stacks = Number.isFinite(rawStacks)
    ? Math.max(1, Math.floor(rawStacks))
    : 1;
  const amountPerStack = Math.max(1, Math.floor(source.hpMax * 0.02));
  return {
    amountPerStack,
    stacks,
    total: amountPerStack * stacks,
  };
}

export function bloodBurnCardUnavailableReason(
  player: BloodBurnSource,
  card: CardDefinition,
  allyTargetId: BattleFriendlyTargetId,
): string {
  const action = bloodBurnAction(player);
  if (
    !action ||
    cardHealsPlayerBeforeBloodBurn(card, allyTargetId) ||
    player.hp > action.total
  ) {
    return '';
  }
  return BLOOD_BURN_INSUFFICIENT_HP_MESSAGE;
}
