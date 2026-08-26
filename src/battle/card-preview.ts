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
  return card.type === 'spell';
}

function cardId(card: CardDefinition): string {
  return String((card as CardDefinition & { id?: unknown }).id ?? '');
}

function cardResourceText(card: CardDefinition): string {
  return `${card.description ?? ''}；${String(card.brief ?? '')}；${card.name ?? ''}`;
}

const CLASS_RESOURCE_OWNERS: Record<string, string> = {
  holy_sigil: 'holy_knight',
  dragon_soul: 'dragon_knight',
  element_resonance: 'elementalist',
  ember_echo: 'fire_mage',
  wind_mark: 'wind_mage',
  thunder_charge: 'thunder_mage',
  growth: 'wood_mage',
  furnace_heat: 'blacksmith',
  parts: 'mechanic',
  abyss_echo: 'dark_mage',
  hunter_prepare: 'vampire_hunter',
};

function classResourceKey(value: unknown): string {
  const key = String(value ?? 'class_resource').toLowerCase();
  if (/圣印|sigil/.test(key)) return 'holy_sigil';
  if (/龙魂|dragon[_\s-]*soul/.test(key)) return 'dragon_soul';
  if (/余烬|ember/.test(key)) return 'ember_echo';
  if (/风痕|wind[_\s-]*mark/.test(key)) return 'wind_mark';
  if (/生长|growth/.test(key)) return 'growth';
  if (/炉温|furnace|heat/.test(key)) return 'furnace_heat';
  if (/零件|part/.test(key)) return 'parts';
  if (/雷|charge/.test(key)) return 'thunder_charge';
  if (/共鸣|resonance/.test(key)) return 'element_resonance';
  if (/深渊|abyss/.test(key)) return 'abyss_echo';
  if (/猎杀|hunter[_\s-]*prepare/.test(key)) return 'hunter_prepare';
  return key.replace(/\s+/g, '_');
}

function classResourceValue(state: LocalBattleState, value: unknown): number {
  const key = classResourceKey(value);
  const owner = CLASS_RESOURCE_OWNERS[key];
  if (owner && state.player.subclass !== owner) return 0;
  if (key === 'abyss_echo') {
    if (Array.isArray(state.player.abyssEchoBatches)) {
      return state.player.abyssEchoBatches.reduce(
        (sum, batch) =>
          batch.value > 0 && state.turn - batch.turn < 2
            ? sum + Math.max(0, Math.floor(number(batch.value)))
            : sum,
        0,
      );
    }
    return Math.max(
      0,
      Math.floor(
        Math.max(
          number(state.player.abyssEcho),
          number(state.player.classResources?.abyss_echo),
        ),
      ),
    );
  }
  return Math.max(
    0,
    Math.floor(number(state.player.classResources?.[key])),
  );
}

function isAbyssSpellCard(card: CardDefinition): boolean {
  return (
    (card.cls === 'dark_mage' || card.cat === 'sub_dark_mage') &&
    (card.type === 'spell' ||
      cardElement(card) === 'dark' ||
      /深渊|虚空|暗|黑潮/.test(`${card.name}${card.description}`))
  );
}

function cardElement(card: CardDefinition): string {
  const direct = String(
    (card as CardDefinition & { element?: unknown }).element ?? '',
  );
  if (direct) return direct;
  return String(card.effects?.find((effect) => effect.element)?.element ?? '');
}

function effectiveCardMpCost(
  state: LocalBattleState,
  card: CardDefinition,
): number {
  let cost = Math.max(0, number(card.mpCost));
  if (isSpellCard(card)) {
    cost -= effectValue(state.player.buffs.next_spell_mp_reduce);
    if (cardElement(card) === 'water') {
      cost -= effectValue(state.player.buffs.next_water_spell_mp_reduce);
    }
  }
  return Math.max(0, Math.round(cost));
}

function conditionMatches(
  raw: unknown,
  state: LocalBattleState,
  target: BattleEnemyState,
  card?: CardDefinition,
  availableMp = state.player.mp,
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
    case 'enemy_has_any_specific_debuff':
      return (
        Array.isArray(detail.debuffs) &&
        detail.debuffs
          .map(String)
          .some((debuff) => Boolean(target.debuffs[debuff]))
      );
    case 'enemy_has_buff':
      return Object.keys(target.buffs).length > 0;
    case 'enemy_has_shield':
      return target.shield > 0;
    case 'enemy_no_shield':
    case 'no_shield':
      return target.shield <= 0;
    case 'enemy_no_specific_debuff':
      return !target.debuffs[String(detail.debuff)];
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
    case 'spend_mp':
      return availableMp >= number(detail.amount ?? detail.value, 1);
    case 'spend_hp':
      return state.player.hp > number(detail.amount ?? detail.value, 1);
    case 'discard':
      return (
        state.player.hand.filter(
          (instance) => instance.cardId !== MAGICIAN_BLANK_CARD_ID,
        ).length >= number(detail.amount ?? detail.value, 1)
      );
    case 'destroy_summon': {
      const mechanicalOnly = Boolean(detail.mechanicalOnly);
      const summons = state.player.summons.filter(
        (summon) =>
          (summon.hp === null || summon.hp > 0) &&
          (!mechanicalOnly ||
            (summon.mechanical ?? summon.attackable === false)),
      );
      return summons.length >= number(detail.amount ?? detail.value, 1);
    }
    case 'low_hp':
    case 'self_low_hp':
      return state.player.hp <= state.player.hpMax * 0.5;
    case 'self_hp_below_percent':
      return (
        state.player.hp <=
        state.player.hpMax *
          (number(detail.percent ?? detail.amount ?? detail.value, 50) / 100)
      );
    case 'mp_below_percent':
      return (
        availableMp <=
        state.player.mpMax *
          (number(detail.percent ?? detail.amount ?? detail.value, 50) / 100)
      );
    case 'last_card_was_spell':
      return state.player.lastCardType === 'spell';
    case 'previous_card_same_name':
      return Boolean(card && cardId(card) && state.player.lastCardId === cardId(card));
    case 'same_card_played_this_turn':
      return Boolean(
        card &&
          cardId(card) &&
          (state.player.cardsPlayedThisTurn?.[cardId(card)] ?? 0) > 0,
      );
    case 'summon_died_this_battle':
      return (state.player.summonsLost ?? 0) > 0;
    case 'has_chant':
      return state.player.chants.length > 0;
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
      effectValue(state.player.buffs.next_attack_bonus) +
      effectValue(state.player.buffs.purified_power);
    if (
      state.player.subclass === 'vampire_hunter' &&
      state.player.buffs.blood_moon
    ) {
      bonus += Math.max(3, Math.ceil(state.player.hpMax * 0.08));
    }
  }
  if (isSpellCard(card)) {
    bonus += effectValue(state.player.buffs.spell_damage_bonus);
  }
  if (
    state.player.buffs.undead_damage_bonus &&
    target.tags.includes('undead')
  ) {
    bonus += effectValue(state.player.buffs.undead_damage_bonus);
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
      conditionMatches(effect, state, target, card)
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
  if (
    state.player.subclass === 'dark_mage' &&
    isAbyssSpellCard(card)
  ) {
    bonus += classResourceValue(state, 'abyss_echo') * 2;
  }
  if (
    state.player.subclass === 'dragon_knight' &&
    card.type === 'attack' &&
    classResourceValue(state, 'dragon_soul') >= 3
  ) {
    bonus += 6;
  }
  if (state.player.subclass === 'blacksmith' && card.type === 'attack') {
    bonus += classResourceValue(state, 'furnace_heat') * 2;
  }
  if (
    state.player.subclass === 'wind_mage' &&
    /风痕/.test(cardResourceText(card))
  ) {
    bonus += classResourceValue(state, 'wind_mark') * 3;
  }
  const thunderText = cardResourceText(card);
  if (
    state.player.subclass === 'thunder_mage' &&
    (/(?:每层|每点|每个)\s*(?:雷荷)?充能[^；，。]*伤害/.test(thunderText) ||
      /(?:雷荷)?充能\s*(?:每层|每点|每个)[^；，。]*伤害/.test(thunderText) ||
      /消耗\s*(?:全部\s*)?(?:雷荷)?充能[^；，。]*[+＋]\s*\d+\s*伤害/.test(
        thunderText,
      ) ||
      (/消耗\s*(?:全部\s*)?(?:雷荷)?充能/.test(thunderText) &&
        /每层\s*[+＋]\s*\d+\s*伤害/.test(thunderText)))
  ) {
    bonus += classResourceValue(state, 'thunder_charge') * 3;
  }
  return bonus;
}

function weaponMasterComboBonus(
  card: CardDefinition,
  state: LocalBattleState,
): number {
  const id = cardId(card);
  if (
    state.player.subclass !== 'weapon_master' ||
    card.type !== 'attack' ||
    !id ||
    state.player.buffs.weapon_master_no_combo
  ) {
    return 0;
  }
  let playedBefore = state.player.cardsPlayedThisTurn?.[id] ?? 0;
  if (state.player.buffs.weapon_master_force_combo && playedBefore < 1) {
    playedBefore = 1;
  }
  if (playedBefore <= 0) return 0;
  const base = playedBefore === 1 ? 2 : 4;
  const extra = effectValue(state.player.buffs.weapon_master_bonus_extra);
  const cap = 4 + effectValue(state.player.buffs.weapon_master_combo_cap);
  return Math.min(cap, base + extra);
}

function cardDamageMultiplier(
  card: CardDefinition,
  state: LocalBattleState,
  target: BattleEnemyState,
): number {
  let multiplier = card.effects?.some(
    (effect) =>
      effect.type === 'conditional_double' &&
      conditionMatches(effect, state, target, card),
  )
    ? 2
    : 1;
  if (card.type === 'attack' && state.player.buffs.spell_double) multiplier *= 2;
  if (card.type === 'attack' && state.player.buffs.weapon_master_attack_amp) {
    multiplier *=
      1 + effectValue(state.player.buffs.weapon_master_attack_amp) / 100;
  }
  if (card.type === 'attack' && state.player.buffs.attack_amp_percent) {
    multiplier *= 1 + effectValue(state.player.buffs.attack_amp_percent) / 100;
  }
  if (isSpellCard(card) && state.player.buffs.spell_amp_percent) {
    multiplier *= 1 + effectValue(state.player.buffs.spell_amp_percent) / 100;
  }
  if (
    isSpellCard(card) &&
    cardElement(card) === 'thunder' &&
    state.player.buffs.thunder_spell_amp
  ) {
    multiplier *= 1 + effectValue(state.player.buffs.thunder_spell_amp) / 100;
  }
  if (
    state.player.subclass === 'dark_priest' &&
    (card.type === 'attack' || card.type === 'spell')
  ) {
    const lostSanity = 100 - Math.min(100, Math.max(0, number(state.player.sanity, 100)));
    multiplier *= 1 + Math.min(5, Math.floor(lostSanity / 20)) * 0.08;
  }
  return multiplier;
}

function amplifiedCardEffectValue(
  state: LocalBattleState,
  card: CardDefinition,
  kind: 'heal' | 'shield',
  rawValue: number,
): number {
  let value = Math.max(0, rawValue);
  if (isSpellCard(card) && state.player.buffs.spell_amp_percent) {
    value = Math.ceil(
      value * (1 + effectValue(state.player.buffs.spell_amp_percent) / 100),
    );
  }
  if (isSpellCard(card) && state.player.buffs.spell_heal_shield_amp) {
    value = Math.ceil(
      value *
        (1 + effectValue(state.player.buffs.spell_heal_shield_amp) / 100),
    );
  }
  if (kind === 'heal' && state.player.buffs.healing_amp_percent) {
    value = Math.ceil(
      value * (1 + effectValue(state.player.buffs.healing_amp_percent) / 100),
    );
  }
  return Math.max(0, Math.round(value));
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
  const alive = state.enemies.flatMap((enemy, index) =>
    enemy.hp > 0 ? [index] : [],
  );
  if (effect.target === 'all_enemies') {
    return alive;
  }
  if (effect.target === 'random_enemy') {
    const prioritized = alive.includes(selectedTarget)
      ? [selectedTarget, ...alive.filter((index) => index !== selectedTarget)]
      : alive;
    return prioritized.slice(0, Math.max(1, number(effect.target_count, 1)));
  }
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
  const count = Object.values(effects).reduce((total, effect) => {
    const instances =
      Array.isArray(effect.instances) && effect.instances.length > 0
        ? effect.instances
        : [effect];
    return (
      total +
      instances.filter(
        (instance) =>
          !instance.undispellable && !instance.uncleanseable,
      ).length
    );
  }, 0);
  if (requested === 'all') return count;
  return Math.min(count, Math.max(1, number(requested, 1)));
}

function activeEffectCount(
  effects: Record<string, BattleTimedEffect>,
): number {
  return Object.values(effects).reduce(
    (total, effect) =>
      total +
      (Array.isArray(effect.instances) && effect.instances.length > 0
        ? effect.instances.length
        : Math.max(1, number(effect.stacks, 1))),
    0,
  );
}

function timedEffectTotalValue(effect?: BattleTimedEffect): number {
  if (!effect) return 0;
  if (Array.isArray(effect.instances) && effect.instances.length > 0) {
    return effect.instances.reduce(
      (sum, instance) => sum + Math.max(1, number(instance.value)),
      0,
    );
  }
  const count = Math.max(1, Math.floor(number(effect.stacks, 1)));
  return count * Math.max(1, effectValue(effect) / count);
}

export function previewBattleCard(
  state: LocalBattleState,
  card: CardDefinition,
  selectedTarget: number,
  allyTargetId: BattleFriendlyTargetId = 'player',
): BattleCardPreview {
  const cardMpCost = effectiveCardMpCost(state, card);
  const preview: BattleCardPreview = {
    enemyDamage: state.enemies.map(() => 0),
    playerHp: 0,
    playerHpCost: 0,
    companionHp: 0,
    playerMp: 0,
    playerMpCost: Math.min(
      state.player.mp,
      cardMpCost,
    ),
  };
  let availableMp = Math.max(0, state.player.mp - preview.playerMpCost);
  const predictedEnemyHp = state.enemies.map((enemy) => enemy.hp);
  const predictedEnemyShield = state.enemies.map((enemy) => enemy.shield);
  const playerAttributeLifestealRatio = Math.min(
    1,
    (Math.max(0, number(state.player.lifesteal)) +
      Math.max(0, passiveEffectValue(state, 'lifesteal_ratio')) * 100) /
      100,
  );
  let playerAttributeLifesteal = 0;
  const addEnemyDamage = (
    index: number,
    rawAmount: number,
    options?: DamagePreviewOptions,
  ): number => {
    const enemy = state.enemies[index];
    if (!enemy || enemy.hp <= 0) return 0;
    const amount = previewDamageAmount(state, enemy, rawAmount, options);
    preview.enemyDamage[index] =
      (preview.enemyDamage[index] ?? 0) +
      amount;
    const absorbed = Math.min(predictedEnemyShield[index] ?? 0, amount);
    predictedEnemyShield[index] = Math.max(
      0,
      (predictedEnemyShield[index] ?? 0) - absorbed,
    );
    const hpBefore = Math.max(0, predictedEnemyHp[index] ?? 0);
    const hpDamage = Math.min(hpBefore, Math.max(0, amount - absorbed));
    predictedEnemyHp[index] = hpBefore - hpDamage;
    playerAttributeLifesteal += Math.floor(
      hpDamage * playerAttributeLifestealRatio,
    );
    return hpDamage;
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
  const addMp = (rawAmount: number) => {
    const missing = Math.max(0, state.player.mpMax - availableMp);
    const restored = Math.min(missing, Math.max(0, rawAmount));
    preview.playerMp += restored;
    availableMp += restored;
  };
  const target = state.enemies[selectedTarget];
  const comboBonus = weaponMasterComboBonus(card, state);
  let comboBonusApplied = false;

  const previewEffects = (effects: CardEffect[]): void => {
    for (const effect of effects) {
      if (effect.type === 'conditional_group') {
        if (!target) continue;
        const conditions = Array.isArray(effect.conditions)
          ? (effect.conditions as CardEffect[])
          : [];
        const matches = conditions.map((condition) =>
          conditionMatches(condition, state, target, card, availableMp),
        );
        const passed =
          effect.logic === 'or'
            ? matches.some(Boolean)
            : matches.every(Boolean);
        if (passed) {
          const payable = (condition: CardEffect): boolean =>
            ['spend_mp', 'spend_hp'].includes(
              String(condition.condition ?? condition.type),
            );
          const paidConditions =
            effect.logic === 'or'
              ? conditions.filter(
                  (condition, index) => matches[index] && payable(condition),
                ).slice(0, 1)
              : conditions.filter(payable);
          for (const condition of paidConditions) {
            const kind = String(condition.condition ?? condition.type);
            const amount = Math.max(
              0,
              number(condition.amount ?? condition.value, 1),
            );
            if (kind === 'spend_mp') {
              preview.playerMpCost += amount;
              availableMp = Math.max(0, availableMp - amount);
            } else if (kind === 'spend_hp') {
              const remainingHp = Math.max(
                0,
                state.player.hp - preview.playerHpCost,
              );
              preview.playerHpCost += Math.min(remainingHp, amount);
            }
          }
        }
        const children = passed
          ? Array.isArray(effect.then_effects)
            ? (effect.then_effects as CardEffect[])
            : []
          : Array.isArray(effect.else_effects)
            ? (effect.else_effects as CardEffect[])
            : [];
        previewEffects(children);
        continue;
      }

      const indexes = effectTargetIndexes(state, effect, selectedTarget);
      if (effect.type === 'damage') {
        let totalHpDamage = 0;
        let killCount = 0;
        const appliedComboBonus = comboBonusApplied ? 0 : comboBonus;
        for (const index of indexes) {
          const enemy = state.enemies[index]!;
          const damageBonus =
            cardDamageBonus(card, state, enemy) + appliedComboBonus;
          const damageMultiplier = cardDamageMultiplier(card, state, enemy);
          const base =
            number(effect.value) +
            (card.type === 'attack'
              ? Math.floor(
                  state.player.attack *
                    number(battleRules.playerAttackScale, 0.35),
                )
              : 0) +
            damageBonus;
          const damage = Math.max(0, Math.round(base * damageMultiplier));
          const hits = Math.max(1, number(effect.hits, 1));
          const hpBefore = predictedEnemyHp[index] ?? 0;
          for (let hit = 0; hit < hits; hit += 1) {
            totalHpDamage += addEnemyDamage(index, damage);
          }
          if (hpBefore > 0 && (predictedEnemyHp[index] ?? 0) <= 0) {
            killCount += 1;
          }
        }
        comboBonusApplied = true;
        const effectLifesteal = Math.round(
          totalHpDamage * Math.max(0, number(effect.lifesteal_ratio)),
        );
        if (effectLifesteal > 0) addHeal('player', effectLifesteal);
        if (killCount > 0 && number(effect.on_kill_gain_mp) > 0) {
          addMp(killCount * number(effect.on_kill_gain_mp));
        }
      } else if (effect.type === 'damage_from_shield') {
        for (const index of indexes) {
          addEnemyDamage(
            index,
            Math.round(state.player.shield * number(effect.ratio)),
          );
        }
      } else if (effect.type === 'damage_from_enemy_shield') {
        for (const index of indexes) {
          addEnemyDamage(
            index,
            Math.round(
              (predictedEnemyShield[index] ?? 0) * number(effect.ratio),
            ),
          );
        }
      } else if (effect.type === 'damage_per_debuff') {
        for (const index of indexes) {
          const debuffCount = activeEffectCount(
            state.enemies[index]!.debuffs,
          );
          let amount =
            debuffCount * number(effect.value) +
            Math.floor(state.player.attack * 0.15 * debuffCount);
          if (isAbyssSpellCard(card)) {
            amount += classResourceValue(state, 'abyss_echo') * 2;
          }
          if (state.player.subclass === 'dark_priest' && amount > 0) {
            const lostSanity =
              100 -
              Math.min(100, Math.max(0, number(state.player.sanity, 100)));
            amount = Math.ceil(
              amount *
                (1 + Math.min(5, Math.floor(lostSanity / 20)) * 0.08),
            );
          }
          addEnemyDamage(index, amount);
        }
      } else if (effect.type === 'damage_per_buff') {
        for (const index of indexes) {
          addEnemyDamage(
            index,
            activeEffectCount(state.enemies[index]!.buffs) *
              number(effect.value),
          );
        }
      } else if (effect.type === 'damage_per_summon') {
        const summons = state.player.summons.filter(
          (summon) => summon.hp === null || summon.hp > 0,
        );
        for (const index of indexes) {
          addEnemyDamage(
            index,
            number(effect.base) + summons.length * number(effect.value),
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
      } else if (
        effect.type === 'spend_mp_shield' ||
        effect.type === 'mp_to_ap'
      ) {
        const mpCost = Math.max(0, number(effect.amount));
        if (availableMp >= mpCost) {
          preview.playerMpCost += mpCost;
          availableMp -= mpCost;
        }
      } else if (effect.type === 'self_damage') {
        const remainingHp = Math.max(
          0,
          state.player.hp - preview.playerHpCost,
        );
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
        const stored = classResourceValue(state, effect.resource);
        for (const index of indexes) {
          addEnemyDamage(index, stored * number(effect.value));
        }
      } else if (effect.type === 'consume_debuff_damage') {
        const debuff = String(effect.debuff ?? '');
        for (const index of indexes) {
          const stored = timedEffectTotalValue(
            state.enemies[index]!.debuffs[debuff],
          );
          if (debuff && stored > 0) {
            addEnemyDamage(index, stored * number(effect.value));
          }
        }
      } else if (effect.type === 'destroy_summon_damage_per') {
        const mechanicalOnly = Boolean(effect.mechanicalOnly);
        const candidates = state.player.summons.filter(
          (summon) =>
            (summon.hp === null || summon.hp > 0) &&
            (!mechanicalOnly ||
              (summon.mechanical ?? summon.attackable === false)),
        );
        const requested =
          effect.amount === 'all'
            ? candidates.length
            : Math.max(1, number(effect.amount, 1));
        const destroyed = Math.min(candidates.length, requested);
        const enemyIndexes = effectTargetIndexes(
          state,
          { ...effect, target: effect.enemy_target ?? 'enemy' },
          selectedTarget,
        );
        for (const index of enemyIndexes) {
          addEnemyDamage(index, destroyed * number(effect.value));
        }
      } else if (effect.type === 'strip_buffs_damage_per') {
        const enemy = state.enemies[selectedTarget];
        if (enemy) {
          addEnemyDamage(
            selectedTarget,
            removedEffectCount(enemy.buffs, effect.amount) *
              number(effect.value),
          );
        }
      } else if (effect.type === 'heal' || effect.type === 'heal_overflow_shield') {
        for (const targetId of friendlyTargetIds(state, effect, allyTargetId)) {
          addHeal(
            targetId,
            amplifiedCardEffectValue(state, card, 'heal', number(effect.value)),
          );
        }
      } else if (effect.type === 'cleanse_heal_per') {
        for (const targetId of friendlyTargetIds(state, effect, allyTargetId)) {
          const recipient =
            targetId === 'caelian' ? state.companion : state.player;
          if (!recipient) continue;
          addHeal(
            targetId,
            amplifiedCardEffectValue(
              state,
              card,
              'heal',
              removedEffectCount(recipient.debuffs, effect.amount) *
                number(effect.value),
            ),
          );
        }
      } else if (effect.type === 'strip_buffs_heal_per') {
        const enemy = state.enemies[selectedTarget];
        if (enemy) {
          addHeal(
            'player',
            amplifiedCardEffectValue(
              state,
              card,
              'heal',
              removedEffectCount(enemy.buffs, effect.amount) *
                number(effect.value),
            ),
          );
        }
      } else if (effect.type === 'gain_mp') {
        let requested = number(effect.value);
        const id = cardId(card);
        if (state.player.subclass === 'thunder_mage' && id === 'th_current_draw') {
          requested =
            classResourceValue(state, 'thunder_charge') *
            Math.max(1, requested);
        } else if (
          state.player.subclass === 'fire_mage' &&
          id === 'fm_ember_return'
        ) {
          requested =
            classResourceValue(state, 'ember_echo') > 0 ? requested : 0;
        } else if (
          state.player.subclass === 'wood_mage' &&
          id === 'wood_growth'
        ) {
          requested = classResourceValue(state, 'growth') > 0 ? requested : 0;
        }
        addMp(requested);
      } else if (effect.type === 'strip_buffs_gain_mp_per') {
        const enemy = state.enemies[selectedTarget];
        if (enemy) {
          addMp(
            removedEffectCount(enemy.buffs, effect.amount) *
              number(effect.value),
          );
        }
      } else if (effect.type === 'gain_mp_per_class_resource') {
        addMp(
          classResourceValue(state, effect.resource) * number(effect.value),
        );
      } else if (effect.type === 'restore_mp_per_abyss_echo') {
        addMp(
          classResourceValue(state, 'abyss_echo') * number(effect.value),
        );
      } else if (effect.type === 'gain_mp_per_chant') {
        addMp(state.player.chants.length * number(effect.value));
      } else if (effect.type === 'recall_summon_mp') {
        const candidates = state.player.summons.filter(
          (summon) => summon.hp === null || summon.hp > 0,
        );
        const requested = Math.min(
          candidates.length,
          Math.max(1, number(effect.amount, 1)),
        );
        const maximum = Math.max(1, number(effect.max, 999));
        const restored = candidates.slice(0, requested).reduce((sum, summon) => {
          const hpRatio =
            summon.hp !== null && number(summon.hpMax) > 0
              ? Math.max(0, summon.hp) / number(summon.hpMax)
              : 0;
          const value = Math.ceil(Math.max(0, summon.duration) + hpRatio * 3);
          return sum + Math.min(maximum, Math.max(1, value));
        }, 0);
        addMp(Math.min(maximum, restored));
      }
    }
  };

  previewEffects(card.effects ?? []);
  if (playerAttributeLifesteal > 0) {
    const restored = healPreview(
      state,
      'player',
      playerAttributeLifesteal,
    ).restored;
    preview.playerHp = Math.min(
      Math.max(0, state.player.hpMax - state.player.hp),
      preview.playerHp + restored,
    );
  }
  return preview;
}
