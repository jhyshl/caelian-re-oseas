import battleRulesJson from '@/content/generated/battle/rules.json';
import type { CardDefinition, CardEffect } from '@/content/types';
import type {
  BattleEnemyState,
  BattleFriendlyTargetId,
  BattleTimedEffect,
  LocalBattleState,
} from '@/domain/types';
import { MAGICIAN_BLANK_CARD_ID } from '@/content/catalogs/magician';

const battleRules = battleRulesJson as {
  playerAttackScale?: number;
  enemyDefenseScale?: number;
};

export interface BattleCardPreview {
  enemyDamage: number[];
  playerHp: number;
  playerHpCost: number;
  companionHp: number;
  playerMp: number;
  playerMpCost: number;
}

interface DamagePreviewOptions {
  ignoreDefense?: boolean;
  ignoreWeak?: boolean;
  ignoreStrength?: boolean;
  ignoreVulnerable?: boolean;
  ignoreDamageHalve?: boolean;
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function effectValue(effect?: BattleTimedEffect): number {
  return effect ? number(effect.value) : 0;
}

function passiveEffectValue(state: LocalBattleState, type: string): number {
  return (state.player.passiveEffects ?? []).reduce<number>((sum, rawEffect) => {
    if (typeof rawEffect !== 'object' || rawEffect === null) return sum;
    const effect = rawEffect as CardEffect;
    return effect.type === type ? sum + number(effect.value ?? effect.ratio) : sum;
  }, 0);
}

function isSpellCard(card: CardDefinition): boolean {
  return (
    card.type === 'spell' ||
    /mage|magic|spell|法|术|奥术|元素|魔/.test(
      `${String(card.cat ?? '')}${card.name}${card.description}`,
    )
  );
}

function conditionMatches(
  raw: unknown,
  state: LocalBattleState,
  target: BattleEnemyState,
): boolean {
  const detail =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const condition =
    typeof raw === 'string'
      ? raw
      : String(detail.condition ?? detail.type ?? '');
  switch (condition) {
    case 'has_shield':
    case 'self_has_shield':
      return state.player.shield > 0;
    case 'self_no_shield':
      return state.player.shield <= 0;
    case 'self_no_debuff':
      return Object.keys(state.player.debuffs).length === 0;
    case 'self_has_debuff':
      return Object.keys(state.player.debuffs).length > 0;
    case 'enemy_has_debuff':
      return Object.keys(target.debuffs).length > 0;
    case 'enemy_no_debuff':
      return Object.keys(target.debuffs).length === 0;
    case 'enemy_has_specific_debuff':
      return Boolean(target.debuffs[String(detail.debuff)]);
    case 'enemy_has_buff':
      return Object.keys(target.buffs).length > 0;
    case 'enemy_has_shield':
      return target.shield > 0;
    case 'enemy_no_shield':
      return target.shield <= 0;
    case 'self_has_buff':
      return Object.keys(state.player.buffs).length > 0;
    case 'self_has_specific_buff':
      return Boolean(state.player.buffs[String(detail.buff)]);
    case 'self_no_buff':
      return Object.keys(state.player.buffs).length === 0;
    case 'self_full_hp':
      return state.player.hp >= state.player.hpMax;
    case 'self_not_full_hp':
      return state.player.hp < state.player.hpMax;
    case 'has_summon':
      return state.player.summons.length > 0;
    case 'no_summon':
      return state.player.summons.length === 0;
    case 'low_hp':
    case 'self_low_hp':
      return state.player.hp <= state.player.hpMax * 0.5;
    case 'self_hp_below_percent':
      return (
        state.player.hp <=
        state.player.hpMax * (number(detail.percent ?? detail.value, 50) / 100)
      );
    default:
      return false;
  }
}

function cardDamageBonus(
  card: CardDefinition,
  state: LocalBattleState,
  target: BattleEnemyState,
): number {
  let bonus =
    effectValue(state.player.buffs.damage_bonus) +
    effectValue(state.player.buffs.empower);
  if (card.type === 'attack') {
    bonus +=
      passiveEffectValue(state, 'attack_bonus') +
      effectValue(state.player.buffs.next_attack_bonus);
  }
  if (isSpellCard(card)) {
    bonus += effectValue(state.player.buffs.spell_damage_bonus);
  }
  for (const rawEffect of state.player.passiveEffects ?? []) {
    if (typeof rawEffect !== 'object' || rawEffect === null) continue;
    const effect = rawEffect as CardEffect;
    if (
      effect.type === 'tag_damage_bonus' &&
      Array.isArray(effect.tags) &&
      effect.tags.map(String).some((tag) => target.tags.includes(tag))
    ) {
      bonus += number(effect.value ?? effect.bonus);
    }
  }
  for (const effect of card.effects ?? []) {
    if (
      effect.type === 'conditional_bonus' &&
      conditionMatches(effect, state, target)
    ) {
      bonus += number(effect.bonus);
    }
    if (
      effect.type === 'bonus_vs_tag' &&
      Array.isArray(effect.tags) &&
      effect.tags.map(String).some((tag) => target.tags.includes(tag))
    ) {
      bonus += number(effect.bonus);
    }
  }
  return bonus;
}

function cardDamageMultiplier(
  card: CardDefinition,
  state: LocalBattleState,
  target: BattleEnemyState,
): number {
  let multiplier = card.effects?.some(
    (effect) =>
      effect.type === 'conditional_double' &&
      conditionMatches(effect, state, target),
  )
    ? 2
    : 1;
  if (card.type === 'attack' && state.player.buffs.spell_double) multiplier *= 2;
  return multiplier;
}

function previewDamageAmount(
  state: LocalBattleState,
  target: BattleEnemyState,
  rawAmount: number,
  options: DamagePreviewOptions = {},
): number {
  let amount = Math.max(0, Math.round(rawAmount));
  const source = state.player;
  if (amount > 0 && target.buffs.damage_immune) return 0;
  if (source.buffs.blood_burn) {
    amount = Math.ceil(
      amount * (1 + Math.max(0, effectValue(source.buffs.blood_burn)) / 100),
    );
  }
  if (!options.ignoreWeak && source.debuffs.weak) amount = Math.floor(amount * 0.75);
  if (!options.ignoreStrength) amount += effectValue(source.buffs.strength);
  if (source.buffs.monster_frenzy) {
    amount = Math.ceil(
      amount * (1 + Math.max(0, effectValue(source.buffs.monster_frenzy)) / 100),
    );
  }
  if (!options.ignoreVulnerable && target.debuffs.vulnerable) {
    amount = Math.ceil(amount * 1.5);
  }
  if (target.debuffs.curse_mark) {
    amount += Math.max(1, effectValue(target.debuffs.curse_mark));
  }
  if (target.debuffs.abyss_mark) {
    amount += Math.max(
      1,
      effectValue(target.debuffs.abyss_mark) + Math.floor(amount * 0.08),
    );
  }
  const damageResist = Math.min(
    95,
    Math.max(0, effectValue(target.buffs.damage_resist)),
  );
  if (damageResist > 0) amount = Math.ceil((amount * (100 - damageResist)) / 100);
  if (!options.ignoreDamageHalve && target.buffs.damage_halve) {
    amount = Math.ceil(amount * 0.5);
  }
  if (!options.ignoreDefense) {
    amount -=
      Math.floor(
        target.defense * number(battleRules.enemyDefenseScale, 0.26),
      ) + effectValue(target.buffs.fortitude);
  }
  if (target.buffs.evidence_barrier) {
    amount *= Math.max(
      0,
      1 - effectValue(target.buffs.evidence_barrier) / 100,
    );
  }
  return Math.max(rawAmount > 0 ? 1 : 0, Math.round(amount));
}

function effectTargetIndexes(
  state: LocalBattleState,
  effect: CardEffect,
  selectedTarget: number,
): number[] {
  if (effect.target === 'all_enemies') {
    return state.enemies.flatMap((enemy, index) => (enemy.hp > 0 ? [index] : []));
  }
  if (effect.target === 'random_enemy') return [];
  return state.enemies[selectedTarget]?.hp && state.enemies[selectedTarget]!.hp > 0
    ? [selectedTarget]
    : [];
}

function friendlyTargetIds(
  state: LocalBattleState,
  effect: CardEffect,
  allyTargetId: BattleFriendlyTargetId,
): BattleFriendlyTargetId[] {
  if (effect.target === 'all_allies') {
    return state.companion ? ['player', 'caelian'] : ['player'];
  }
  return allyTargetId === 'caelian' && state.companion
    ? ['caelian']
    : ['player'];
}

function healPreview(
  state: LocalBattleState,
  targetId: BattleFriendlyTargetId,
  rawAmount: number,
): { restored: number; overflow: number } {
  const target = targetId === 'caelian' ? state.companion : state.player;
  if (!target || (targetId === 'caelian' && state.companion?.injured)) {
    return { restored: 0, overflow: 0 };
  }
  const healBlock = Math.min(
    100,
    Math.max(0, effectValue(target.debuffs.heal_block)),
  );
  const amount = Math.max(
    0,
    Math.floor((Math.round(rawAmount) * (100 - healBlock)) / 100),
  );
  const missing = Math.max(0, target.hpMax - target.hp);
  return {
    restored: Math.min(missing, amount),
    overflow: Math.max(0, amount - missing),
  };
}

function removedEffectCount(
  effects: Record<string, BattleTimedEffect>,
  requested: unknown,
): number {
  const count = Object.keys(effects).length;
  if (requested === 'all') return count;
  return Math.min(count, Math.max(1, number(requested, 1)));
}

export function previewBattleCard(
  state: LocalBattleState,
  card: CardDefinition,
  selectedTarget: number,
  allyTargetId: BattleFriendlyTargetId = 'player',
): BattleCardPreview {
  const primaryTarget = state.enemies[selectedTarget];
  const damageBonus = primaryTarget
    ? cardDamageBonus(card, state, primaryTarget)
    : 0;
  const damageMultiplier = primaryTarget
    ? cardDamageMultiplier(card, state, primaryTarget)
    : 1;
  const preview: BattleCardPreview = {
    enemyDamage: state.enemies.map(() => 0),
    playerHp: 0,
    playerHpCost: 0,
    companionHp: 0,
    playerMp: 0,
    playerMpCost: Math.min(
      state.player.mp,
      Math.max(0, number(card.mpCost)),
    ),
  };
  let availableMp = Math.max(0, state.player.mp - preview.playerMpCost);
  const addEnemyDamage = (
    index: number,
    rawAmount: number,
    options?: DamagePreviewOptions,
  ) => {
    const enemy = state.enemies[index];
    if (!enemy || enemy.hp <= 0) return;
    preview.enemyDamage[index] =
      (preview.enemyDamage[index] ?? 0) +
      previewDamageAmount(state, enemy, rawAmount, options);
  };
  const addHeal = (targetId: BattleFriendlyTargetId, rawAmount: number) => {
    const heal = healPreview(state, targetId, rawAmount);
    if (targetId === 'caelian') preview.companionHp += heal.restored;
    else preview.playerHp += heal.restored;
    if (
      targetId === 'player' &&
      state.player.subclass === 'priest' &&
      heal.overflow > 0
    ) {
      addEnemyDamage(selectedTarget, heal.overflow, {
        ignoreDefense: true,
        ignoreWeak: true,
        ignoreStrength: true,
        ignoreVulnerable: true,
        ignoreDamageHalve: true,
      });
    }
  };

  for (const effect of card.effects ?? []) {
    const indexes = effectTargetIndexes(state, effect, selectedTarget);
    if (effect.type === 'damage') {
      for (const index of indexes) {
        const base =
          number(effect.value) +
          (card.type === 'attack'
            ? Math.floor(
                state.player.attack * number(battleRules.playerAttackScale, 0.35),
              )
            : 0) +
          damageBonus;
        const damage = Math.max(0, Math.round(base * damageMultiplier));
        const hits = Math.max(1, number(effect.hits, 1));
        for (let hit = 0; hit < hits; hit += 1) addEnemyDamage(index, damage);
      }
    } else if (effect.type === 'damage_from_shield') {
      for (const index of indexes) {
        addEnemyDamage(index, Math.round(state.player.shield * number(effect.ratio)));
      }
    } else if (effect.type === 'damage_from_enemy_shield') {
      for (const index of indexes) {
        addEnemyDamage(
          index,
          Math.round(state.enemies[index]!.shield * number(effect.ratio)),
        );
      }
    } else if (effect.type === 'damage_per_debuff') {
      for (const index of indexes) {
        addEnemyDamage(
          index,
          Object.keys(state.enemies[index]!.debuffs).length * number(effect.value),
        );
      }
    } else if (effect.type === 'damage_per_buff') {
      for (const index of indexes) {
        addEnemyDamage(
          index,
          Object.keys(state.player.buffs).length * number(effect.value),
        );
      }
    } else if (effect.type === 'damage_per_summon') {
      for (const index of indexes) {
        addEnemyDamage(
          index,
          number(effect.base) + state.player.summons.length * number(effect.value),
        );
      }
    } else if (effect.type === 'spend_mp_damage') {
      const mpCost = Math.max(0, number(effect.amount));
      if (availableMp >= mpCost) {
        preview.playerMpCost += mpCost;
        availableMp -= mpCost;
        for (const index of indexes) {
          addEnemyDamage(index, number(effect.value) * Math.max(1, mpCost));
        }
      }
    } else if (effect.type === 'spend_mp_shield' || effect.type === 'mp_to_ap') {
      const mpCost = Math.max(0, number(effect.amount));
      if (availableMp >= mpCost) {
        preview.playerMpCost += mpCost;
        availableMp -= mpCost;
      }
    } else if (effect.type === 'self_damage') {
      const remainingHp = Math.max(0, state.player.hp - preview.playerHpCost);
      preview.playerHpCost += Math.min(
        remainingHp,
        Math.max(0, number(effect.value ?? effect.amount)),
      );
    } else if (effect.type === 'discard_all_damage') {
      const discarded = Math.max(
        0,
        state.player.hand.filter(
          (instance) => instance.cardId !== MAGICIAN_BLANK_CARD_ID,
        ).length - 1,
      );
      for (const index of indexes) {
        addEnemyDamage(index, discarded * number(effect.value));
      }
    } else if (effect.type === 'discard_blank_damage') {
      const discarded = state.player.hand.filter(
        (instance) => instance.cardId === MAGICIAN_BLANK_CARD_ID,
      ).length;
      for (const index of indexes) {
        addEnemyDamage(index, discarded * number(effect.value));
      }
    } else if (effect.type === 'damage_per_class_resource') {
      const resource = String(effect.resource ?? 'resource');
      const stored = state.player.classResources?.[resource] ?? 0;
      for (const index of indexes) addEnemyDamage(index, stored * number(effect.value));
    } else if (effect.type === 'consume_debuff_damage') {
      const debuff = String(effect.debuff ?? '');
      for (const index of indexes) {
        if (debuff && state.enemies[index]!.debuffs[debuff]) {
          addEnemyDamage(index, number(effect.value));
        }
      }
    } else if (effect.type === 'destroy_summon_damage_per') {
      const mechanicalOnly = Boolean(effect.mechanicalOnly);
      const candidates = state.player.summons.filter(
        (summon) =>
          !mechanicalOnly || /机|械|炮|傀儡|机械/i.test(`${summon.id}${summon.name}`),
      );
      const requested =
        effect.amount === 'all'
          ? candidates.length
          : Math.max(1, number(effect.amount, 1));
      const destroyed = Math.min(candidates.length, requested);
      for (const index of indexes) {
        addEnemyDamage(index, destroyed * number(effect.value));
      }
    } else if (effect.type === 'heal' || effect.type === 'heal_overflow_shield') {
      for (const targetId of friendlyTargetIds(state, effect, allyTargetId)) {
        addHeal(targetId, number(effect.value));
      }
    } else if (effect.type === 'cleanse_heal_per') {
      for (const targetId of friendlyTargetIds(state, effect, allyTargetId)) {
        const target = targetId === 'caelian' ? state.companion : state.player;
        if (!target) continue;
        addHeal(
          targetId,
          removedEffectCount(target.debuffs, effect.amount) * number(effect.value),
        );
      }
    } else if (effect.type === 'strip_buffs_heal_per') {
      const target = state.enemies[selectedTarget];
      if (target) {
        addHeal(
          'player',
          removedEffectCount(target.buffs, effect.amount) * number(effect.value),
        );
      }
    } else if (effect.type === 'gain_mp') {
      const missing = Math.max(0, state.player.mpMax - availableMp);
      const restored = Math.min(missing, Math.max(0, number(effect.value)));
      preview.playerMp += restored;
      availableMp += restored;
    } else if (effect.type === 'gain_mp_per_class_resource') {
      const resource = String(effect.resource ?? 'resource');
      const stored = state.player.classResources?.[resource] ?? 0;
      const missing = Math.max(0, state.player.mpMax - availableMp);
      const restored = Math.min(missing, stored * number(effect.value));
      preview.playerMp += restored;
      availableMp += restored;
    }
  }
  return preview;
}
