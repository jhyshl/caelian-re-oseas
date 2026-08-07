import type { BattleItemDefinition, CardEffect } from '@/content/types';
import type { BattlePlayerState } from '@/domain/types';

const IMMEDIATE_EFFECT_TYPES = new Set([
  'heal',
  'gain_mp',
  'heal_mp',
  'buff',
  'cleanse',
  'cleanse_specific',
  'shield',
  'damage',
]);

export interface BattleConsumableContext {
  player: Pick<
    BattlePlayerState,
    'hp' | 'hpMax' | 'mp' | 'mpMax' | 'buffs' | 'debuffs'
  >;
  hasLivingEnemy: boolean;
}

export function isBattleUsableItem(
  definition: BattleItemDefinition | undefined,
): boolean {
  return Boolean(definition?.effect && isBattleUsableEffect(definition.effect));
}

export function isBattleUsableEffect(effect: CardEffect): boolean {
  if (effect.type === 'multi') {
    const effects = childEffects(effect);
    return effects.length > 0 && effects.every(isBattleUsableEffect);
  }
  return IMMEDIATE_EFFECT_TYPES.has(effect.type);
}

export function canApplyBattleConsumable(
  effect: CardEffect,
  context: BattleConsumableContext,
): boolean {
  const { player } = context;
  switch (effect.type) {
    case 'heal':
      return player.hp < player.hpMax && positive(effect.value);
    case 'gain_mp':
      return player.mp < player.mpMax && positive(effect.value);
    case 'heal_mp':
      return (
        (player.hp < player.hpMax && positive(effect.heal)) ||
        (player.mp < player.mpMax && positive(effect.mp))
      );
    case 'buff':
      return Boolean(String(effect.buff ?? '').trim()) && positive(effect.value);
    case 'cleanse':
      return Object.keys(player.debuffs).length > 0;
    case 'cleanse_specific':
      return Boolean(player.debuffs[String(effect.debuff ?? '')]);
    case 'shield':
      return positive(effect.value);
    case 'damage':
      return context.hasLivingEnemy && positive(effect.value);
    case 'multi':
      return childEffects(effect).some((child) =>
        canApplyBattleConsumable(child, context),
      );
    default:
      return false;
  }
}

export function childEffects(effect: CardEffect): CardEffect[] {
  if (!Array.isArray(effect.effects)) return [];
  return effect.effects.filter(
    (child): child is CardEffect =>
      typeof child === 'object' &&
      child !== null &&
      typeof (child as CardEffect).type === 'string',
  );
}

function positive(value: unknown): boolean {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}
