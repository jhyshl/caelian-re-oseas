import type { CardDefinition, CardEffect } from '@/content/types';
import {
  normalizeWorkshopMechanism,
  readWorkshopMechanisms,
  saveWorkshopMechanism,
  type WorkshopMechanismManifest,
} from '@/workshop-mechanisms';

export const WORKSHOP_STORAGE_KEY = 'caelian_custom_workshop_packs_v1';
export const WORKSHOP_DRAFT_STORAGE_KEY = 'caelian_custom_workshop_drafts_v1';
export const WORKSHOP_EXTENSION_STORAGE_KEY =
  'caelian_custom_workshop_extensions_v1';
export const WORKSHOP_FORMAT = 'caelian_workshop_class_pack';
export const WORKSHOP_EXTENSION_FORMAT = 'caelian_workshop_extension';
export const WORKSHOP_MAIN_CLASSES = [
  'knight',
  'mage',
  'artisan',
  'freelance',
] as const;

export type WorkshopMainClass = (typeof WORKSHOP_MAIN_CLASSES)[number];

export interface WorkshopTalent {
  name: string;
  description: string;
  effects: CardEffect[];
}

export interface WorkshopCard extends CardDefinition {
  id: string;
  custom: true;
  powerScore: number;
}

export interface WorkshopClass {
  id: string;
  main: WorkshopMainClass;
  name: string;
  description: string;
  talent: WorkshopTalent;
  cards: WorkshopCard[];
  /** All card copies granted to the player when this profession is installed. */
  cardPool: string[];
  /** Exactly 15 card copies equipped as the default deck. */
  starterDeck: string[];
  mechanismIds?: string[];
  custom: true;
}

export interface WorkshopPack {
  format: typeof WORKSHOP_FORMAT;
  version: 1;
  packName: string;
  author: string;
  exported_at: string;
  classes: WorkshopClass[];
  /** Declarative mechanisms bundled with the profession for portable imports. */
  mechanisms?: WorkshopMechanismManifest[];
}

export interface WorkshopDraft {
  id: string;
  updatedAt: number;
  value: Partial<WorkshopClass>;
}

export interface WorkshopEffectPreset {
  id: string;
  label: string;
  description: string;
  cardTypes: Array<'attack' | 'defense' | 'skill' | 'summon'>;
  effects: CardEffect[];
}

export interface WorkshopExtensionManifest {
  format: typeof WORKSHOP_EXTENSION_FORMAT;
  version: 1;
  id: string;
  name: string;
  author: string;
  description: string;
  presets: WorkshopEffectPreset[];
}

export type WorkshopImportResult =
  | { kind: 'class-pack'; pack: WorkshopPack }
  | { kind: 'extension'; extension: WorkshopExtensionManifest };

export interface WorkshopExtensionApi {
  readonly apiVersion: 1;
  register(value: unknown): WorkshopExtensionManifest;
  list(): WorkshopExtensionManifest[];
  remove(extensionId: string): boolean;
  validateClassPack(value: unknown): WorkshopPack;
  importArtifact(value: unknown): WorkshopImportResult;
}

type UnknownRecord = Record<string, unknown>;
type Amount = number | 'all';

const TARGET_MULTIPLIERS: Record<string, number> = {
  all_enemies: 1.6,
  all_allies: 1.5,
  all_summons: 1.4,
};
const CARD_LIMITS = [10, 22, 36, 52, 68, 86, 106, 128, 152, 178, 206];
const ALLOWED_BUFFS = [
  'strength',
  'fortitude',
  'agility',
  'regen',
  'thorns',
  'ap_regen',
  'draw_regen',
  'shield_regen',
  'heal_regen',
  'damage_bonus',
  'spell_damage_bonus',
  'damage_reduce',
  'mp_regen',
  'blood_burn',
];
const ALLOWED_DEBUFFS = [
  'burn',
  'poison',
  'weak',
  'vulnerable',
  'freeze',
  'entangle',
];
const VALID_CARD_EFFECT_TYPES = new Set([
  'damage',
  'gain_mp',
  'spend_mp_damage',
  'spend_mp_shield',
  'mp_to_ap',
  'shield',
  'heal',
  'draw',
  'gain_ap',
  'apply_buff',
  'apply_debuff',
  'cleanse',
  'dispel',
  'strip_shield',
  'strip_buffs',
  'thorns',
  'trap',
  'damage_from_shield',
  'damage_per_debuff',
  'discard',
  'recover_discard',
  'discard_all_damage',
  'destroy_summon',
  'reveal_intent',
  'summon',
  'conditional_bonus',
  'conditional_group',
]);
const TALENT_LIMITS: Record<
  string,
  { min: number; max: number; defaultValue: number }
> = {
  battle_start_shield: { min: 0, max: 20, defaultValue: 5 },
  turn_start_heal: { min: 0, max: 5, defaultValue: 1 },
  attack_bonus: { min: 0, max: 5, defaultValue: 1 },
  shield_bonus: { min: 0, max: 0.5, defaultValue: 0.1 },
  extra_draw: { min: 0, max: 2, defaultValue: 1 },
  first_turn_ap: { min: 0, max: 2, defaultValue: 1 },
  damage_reduction: { min: 0, max: 3, defaultValue: 1 },
  always_reveal_intent: { min: 0, max: 0, defaultValue: 0 },
  turn_start_cleanse: { min: 1, max: 1, defaultValue: 1 },
  turn_start_debuff_shield: { min: 0, max: 8, defaultValue: 2 },
};
const CONDITION_DISCOUNTS: Record<string, number> = {
  self_has_shield: 0.86,
  self_no_shield: 0.9,
  enemy_has_shield: 0.86,
  enemy_no_shield: 0.9,
  enemy_has_debuff: 0.84,
  enemy_no_debuff: 0.92,
  enemy_has_specific_debuff: 0.8,
  enemy_no_specific_debuff: 0.9,
  self_has_buff: 0.9,
  self_no_buff: 0.92,
  self_full_hp: 0.82,
  self_not_full_hp: 0.88,
  has_summon: 0.82,
  no_summon: 0.95,
  spend_mp: 0.74,
  discard: 0.78,
  destroy_summon: 0.62,
};

export const WORKSHOP_EFFECT_OPTIONS = [
  { type: 'damage', label: '造成伤害', value: 8, target: 'enemy' },
  { type: 'shield', label: '获得护盾', value: 8, target: 'self' },
  { type: 'heal', label: '恢复生命', value: 6, target: 'self' },
  { type: 'draw', label: '抽牌', value: 1, target: 'self' },
  { type: 'gain_ap', label: '获得 AP', value: 1, target: 'self' },
  { type: 'gain_mp', label: '恢复 MP', value: 4, target: 'self' },
  { type: 'apply_buff', label: '施加增益', value: 1, turns: 1, buff: 'strength', target: 'self' },
  { type: 'apply_debuff', label: '施加减益', value: 1, turns: 1, debuff: 'burn', target: 'enemy' },
  { type: 'cleanse', label: '净化自身', amount: 1, target: 'self' },
  { type: 'dispel', label: '驱散敌人', amount: 1, target: 'enemy' },
  { type: 'strip_shield', label: '移除护盾', target: 'enemy' },
  { type: 'strip_buffs', label: '移除全部增益', target: 'enemy' },
  { type: 'trap', label: '设置陷阱', value: 6, target: 'enemy' },
  { type: 'damage_from_shield', label: '按护盾造成伤害', ratio: 0.5, target: 'enemy' },
  { type: 'damage_per_debuff', label: '按减益造成伤害', value: 3, target: 'enemy' },
  { type: 'discard', label: '弃牌', amount: 1, target: 'self' },
  { type: 'recover_discard', label: '回收弃牌', amount: 1, target: 'self' },
  { type: 'discard_all_damage', label: '弃尽手牌造成伤害', value: 4, target: 'enemy' },
  { type: 'destroy_summon', label: '牺牲召唤物', amount: 1, target: 'random_summons' },
  { type: 'spend_mp_damage', label: '消耗 MP 造成伤害', value: 3, amount: 3, target: 'enemy' },
  { type: 'spend_mp_shield', label: '消耗 MP 获得护盾', value: 3, amount: 3, target: 'self' },
  { type: 'mp_to_ap', label: 'MP 转换 AP', value: 1, amount: 6, target: 'self' },
  { type: 'reveal_intent', label: '洞察敌人意图', target: 'self' },
  {
    type: 'conditional_group',
    label: '条件效果组',
    logic: 'and',
    conditions: [{ type: 'self_has_shield' }],
    then_effects: [{ type: 'damage', value: 6, target: 'enemy' }],
    else_effects: [],
  },
  {
    type: 'summon',
    label: '创建召唤物',
    target: 'self',
    name: '召唤物',
    attackable: true,
    hp_ratio: 35,
    unique_by_name: true,
    skills: [
      {
        name: '攻击',
        weight: 1,
        effects: [{ type: 'damage', value: 5, target: 'enemy' }],
      },
    ],
  },
] as const;

export const WORKSHOP_TALENT_OPTIONS = [
  ['battle_start_shield', '战斗开始获得护盾'],
  ['turn_start_heal', '回合开始恢复生命'],
  ['attack_bonus', '攻击牌伤害增加'],
  ['shield_bonus', '护盾效果比例增加'],
  ['extra_draw', '每回合额外抽牌'],
  ['first_turn_ap', '首回合额外 AP'],
  ['damage_reduction', '受到伤害降低'],
  ['always_reveal_intent', '始终显示敌人意图'],
  ['turn_start_cleanse', '回合开始净化'],
  ['turn_start_debuff_shield', '有减益时回合开始获得护盾'],
] as const;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback = 0): number {
  return Math.max(min, Math.min(max, number(value, fallback)));
}

function amount(value: unknown, fallback = 1): Amount {
  if (value === 'all' || value === true) return 'all';
  return Math.max(0, Math.floor(number(value, fallback)));
}

function slug(value: unknown): string {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'unnamed'
  );
}

function safeId(value: unknown): string {
  return String(value ?? '').replace(/[^\w-]/g, '_');
}

function extensionId(value: unknown, fallback: string): string {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function normalizeTarget(effect: UnknownRecord, type: string): string {
  const selfTypes = new Set([
    'shield',
    'heal',
    'apply_buff',
    'cleanse',
    'discard',
    'recover_discard',
    'draw',
    'gain_ap',
    'gain_mp',
    'mp_to_ap',
    'reveal_intent',
    'thorns',
    'spend_mp_shield',
  ]);
  const target = String(
    effect.target ??
      (type === 'destroy_summon'
        ? 'random_summons'
        : selfTypes.has(type)
          ? 'self'
          : 'enemy'),
  );
  const enemyTargets = ['enemy', 'all_enemies', 'random_enemy'];
  const allyTargets = ['self', 'all_allies', 'random_allies', 'selected_allies'];
  const targetRules: Record<string, string[]> = {
    damage: enemyTargets,
    spend_mp_damage: enemyTargets,
    trap: enemyTargets,
    damage_from_shield: enemyTargets,
    damage_per_debuff: enemyTargets,
    strip_shield: enemyTargets,
    strip_buffs: enemyTargets,
    dispel: enemyTargets,
    shield: allyTargets,
    spend_mp_shield: allyTargets,
    heal: allyTargets,
    apply_buff: allyTargets,
    cleanse: allyTargets,
    apply_debuff: [...enemyTargets, ...allyTargets],
    destroy_summon: [
      'all_summons',
      'random_summons',
      'selected_summons',
    ],
  };
  const allowed = targetRules[type];
  if (!allowed || allowed.includes(target)) return target;
  return type === 'destroy_summon'
    ? 'random_summons'
    : selfTypes.has(type)
      ? 'self'
      : 'enemy';
}

function normalizeCondition(value: unknown): CardEffect | undefined {
  const source = record(value);
  const type = String(source.type ?? source.condition ?? '');
  const baseDiscount = CONDITION_DISCOUNTS[type];
  if (!baseDiscount) return undefined;
  const result: CardEffect = {
    type,
    discount: clamp(source.discount, 0.1, 1, baseDiscount),
  };
  if (type.includes('specific_debuff')) {
    const debuff = String(source.debuff ?? '');
    if (!ALLOWED_DEBUFFS.includes(debuff)) return undefined;
    result.debuff = debuff;
  }
  if (['spend_mp', 'discard', 'destroy_summon'].includes(type)) {
    const normalized = amount(source.amount ?? source.value, 1);
    result.amount = normalized === 'all' ? 'all' : Math.max(1, normalized);
    result.value = normalized === 'all' ? 99 : Math.max(1, normalized);
  }
  if (type === 'destroy_summon') {
    result.target = String(source.target ?? 'random_summons');
    result.target_count = Math.max(
      1,
      Math.floor(number(source.target_count ?? source.count ?? result.amount, 1)),
    );
  }
  return result;
}

function normalizeSummon(value: UnknownRecord): CardEffect | undefined {
  const source = record(value.summon ?? value);
  const attackable = source.attackable !== false;
  const skills = (Array.isArray(source.skills) ? source.skills : [])
    .slice(0, 3)
    .flatMap((rawSkill, index) => {
      const skill = record(rawSkill);
      const effects = (Array.isArray(skill.effects) ? skill.effects : [])
        .slice(0, 3)
        .flatMap((entry) => {
          const normalized = normalizeCardEffect(entry);
          return normalized &&
            [
              'damage',
              'shield',
              'heal',
              'apply_buff',
              'apply_debuff',
              'cleanse',
              'dispel',
              'strip_shield',
              'strip_buffs',
              'trap',
              'damage_from_shield',
              'damage_per_debuff',
            ].includes(normalized.type)
            ? [normalized]
            : [];
        });
      if (!effects.length) return [];
      return [
        {
          name: String(skill.name ?? `技能${index + 1}`).trim().slice(0, 16),
          weight: Math.max(0.01, number(skill.weight, 1)),
          effects,
        },
      ];
    });
  if (!skills.length) return undefined;
  const weightTotal = skills.reduce((sum, skill) => sum + skill.weight, 0);
  for (const skill of skills) skill.weight /= weightTotal;
  return {
    type: 'summon',
    target: 'self',
    name: String(source.name ?? '召唤物').trim().slice(0, 18) || '召唤物',
    attackable,
    hp_ratio: attackable ? clamp(source.hp_ratio, 1, 200, 35) : 0,
    duration: attackable
      ? summonExpectedTurns(clamp(source.hp_ratio, 1, 200, 35))
      : Math.max(1, Math.floor(number(source.duration, 3))),
    mechanical: !attackable,
    unique_by_name: source.unique_by_name !== false,
    skills,
  };
}

export function normalizeCardEffect(value: unknown): CardEffect | undefined {
  const source = record(value);
  const type = String(source.type ?? '').trim();
  if (!VALID_CARD_EFFECT_TYPES.has(type)) return undefined;
  if (type === 'summon') return normalizeSummon(source);
  if (type === 'conditional_group') {
    const conditions = (Array.isArray(source.conditions)
      ? source.conditions
      : []
    )
      .slice(0, 8)
      .flatMap((entry) => {
        const normalized = normalizeCondition(entry);
        return normalized ? [normalized] : [];
      });
    const thenEffects = (Array.isArray(source.then_effects)
      ? source.then_effects
      : []
    )
      .slice(0, 8)
      .flatMap((entry) => {
        const normalized = normalizeCardEffect(entry);
        return normalized && normalized.type !== 'conditional_group'
          ? [normalized]
          : [];
      });
    const elseEffects = (Array.isArray(source.else_effects)
      ? source.else_effects
      : []
    )
      .slice(0, 8)
      .flatMap((entry) => {
        const normalized = normalizeCardEffect(entry);
        return normalized && normalized.type !== 'conditional_group'
          ? [normalized]
          : [];
      });
    if (!conditions.length || !thenEffects.length) return undefined;
    const logic = source.logic === 'or' ? 'or' : 'and';
    return {
      type,
      target: 'self',
      logic,
      conditions,
      then_effects: thenEffects,
      else_effects: elseEffects,
      discount: conditionDiscount(conditions, logic),
    };
  }
  const result: CardEffect = {
    type,
    target: normalizeTarget(source, type),
  };
  const numericKeys = [
    'value',
    'turns',
    'ratio',
    'bonus',
    'amount',
    'hits',
  ];
  for (const key of numericKeys) {
    if (source[key] !== undefined) {
      result[key] =
        key === 'turns'
          ? clamp(source[key], 1, 99, 1)
          : clamp(source[key], 0, 999999);
    }
  }
  if (
    ['random_enemy', 'random_allies', 'selected_allies', 'random_summons', 'selected_summons'].includes(
      String(result.target),
    )
  ) {
    result.target_count = Math.max(
      1,
      Math.floor(number(source.target_count ?? source.count, 1)),
    );
  }
  if (
    ['cleanse', 'dispel', 'discard', 'recover_discard', 'destroy_summon'].includes(
      type,
    )
  ) {
    const normalized = amount(source.amount ?? source.value, 1);
    result.amount = normalized;
    result.value = normalized === 'all' ? 99 : Math.max(1, normalized);
  }
  if (type === 'apply_buff') {
    const buff = String(source.buff ?? '');
    if (!ALLOWED_BUFFS.includes(buff)) return undefined;
    result.buff = buff;
    result.turns = clamp(source.turns, 1, 99, 1);
    result.value = clamp(source.value, 0, 999999, 1);
  }
  if (type === 'apply_debuff') {
    const debuff = String(source.debuff ?? '');
    if (!ALLOWED_DEBUFFS.includes(debuff)) return undefined;
    result.debuff = debuff;
    result.turns = clamp(source.turns, 1, 99, 1);
    if (['burn', 'poison'].includes(debuff)) {
      result.value = clamp(source.value, 0, 999999, 1);
    } else {
      delete result.value;
    }
  }
  if (type === 'damage' && source.lifesteal_ratio !== undefined) {
    result.lifesteal_ratio = clamp(source.lifesteal_ratio, 0, 0.6);
  }
  if (type === 'damage_from_shield') {
    result.ratio = clamp(source.ratio, 0, 1, 0.5);
  }
  if (type === 'thorns') {
    result.value = clamp(source.value, 0, 16);
  }
  if (type === 'conditional_bonus') {
    const allowed = [
      'enemy_has_debuff',
      'enemy_has_specific_debuff',
      'no_shield',
      'has_shield',
      'has_summon',
      'self_has_buff',
      'self_full_hp',
      'bonus_per_self_buff',
      'bonus_by_lost_hp_ratio',
      'bonus_by_max_hp_ratio',
    ];
    const condition = String(source.condition ?? 'enemy_has_debuff');
    result.condition = allowed.includes(condition)
      ? condition
      : 'enemy_has_debuff';
    if (result.condition === 'enemy_has_specific_debuff') {
      const debuff = String(source.debuff ?? '');
      if (!ALLOWED_DEBUFFS.includes(debuff)) return undefined;
      result.debuff = debuff;
    }
    if (
      ['bonus_by_lost_hp_ratio', 'bonus_by_max_hp_ratio'].includes(
        String(result.condition),
      )
    ) {
      result.ratio = clamp(source.ratio ?? source.bonus, 0, 999999, 10);
    }
  }
  return result;
}

export function normalizeTalentEffect(value: unknown): CardEffect | undefined {
  const source = record(value);
  const type = String(source.type ?? '');
  const rule = TALENT_LIMITS[type];
  if (!rule) return undefined;
  const effect: CardEffect = { type };
  if (rule.max > 0) {
    effect.value = clamp(
      source.value,
      rule.min,
      rule.max,
      rule.defaultValue,
    );
  }
  return effect;
}

function effectUniqueKey(effect: CardEffect): string {
  if (effect.type === 'apply_buff') return `apply_buff:${effect.buff ?? ''}`;
  if (effect.type === 'apply_debuff') {
    return `apply_debuff:${effect.debuff ?? ''}`;
  }
  if (effect.type === 'conditional_bonus') {
    return `conditional_bonus:${effect.condition ?? ''}:${effect.debuff ?? ''}`;
  }
  return effect.type;
}

function ensureUniqueEffects(effects: CardEffect[], cardName: string): void {
  const seen = new Set<string>();
  for (const effect of effects) {
    const key = effectUniqueKey(effect);
    if (seen.has(key)) {
      throw new Error(
        `${cardName} 中「${key.split(':')[0]}」类效果重复。每张牌同类效果只能添加一次。`,
      );
    }
    seen.add(key);
  }
}

function durationDiscount(turns: unknown): number {
  const value = Math.max(1, number(turns, 1));
  if (value <= 1) return 1;
  if (value === 2) return 0.85;
  if (value === 3) return 0.75;
  if (value === 4) return 0.65;
  return 0.6;
}

function targetMultiplier(effect: CardEffect): number {
  const target = String(effect.target ?? '');
  const count = Math.max(1, number(effect.target_count, 1));
  if (target === 'random_enemy' || target === 'random_allies') {
    return 0.85 * count;
  }
  if (target === 'selected_allies') return 1 + (count - 1) * 0.55;
  if (target === 'random_summons') return 0.75 * count;
  if (target === 'selected_summons') return 0.9 * count;
  return TARGET_MULTIPLIERS[target] ?? 1;
}

function amountCost(value: unknown, one: number, all: number): number {
  return value === 'all' ? all : Math.max(1, number(value, 1)) * one;
}

function summonExpectedTurns(hpRatio: number): number {
  if (hpRatio <= 20) return 1;
  if (hpRatio <= 35) return 2;
  if (hpRatio <= 50) return 3;
  if (hpRatio <= 75) return 4;
  return 5;
}

function singleEffectScore(effect: CardEffect): number {
  const value = number(effect.value);
  const turns = Math.max(1, number(effect.turns, 1));
  const multiplier = targetMultiplier(effect);
  switch (effect.type) {
    case 'damage':
      return (value + number(effect.lifesteal_ratio) * 12) * multiplier;
    case 'shield':
      return value * 0.75 * multiplier;
    case 'heal':
      return value * 0.85 * multiplier;
    case 'draw':
      return value * 6;
    case 'gain_ap':
      return value * 9;
    case 'gain_mp':
      return value * 0.75;
    case 'mp_to_ap':
      return Math.max(0, value * 9 - number(effect.amount) * 0.65);
    case 'spend_mp_damage':
      return (
        Math.max(
          0,
          value * Math.max(1, number(effect.amount, 1)) * 0.85 -
            number(effect.amount) * 0.55,
        ) * multiplier
      );
    case 'spend_mp_shield':
      return (
        Math.max(
          0,
          value * Math.max(1, number(effect.amount, 1)) * 0.62 -
            number(effect.amount) * 0.55,
        ) * multiplier
      );
    case 'apply_debuff':
      return (
        ({
          freeze: 14,
          entangle: 10,
          weak: 7,
          vulnerable: 8,
          burn: 4,
          poison: 4,
        }[String(effect.debuff)] ?? 6) *
        turns *
        multiplier
      );
    case 'apply_buff': {
      const perTurn =
        {
          strength: 6,
          fortitude: 5,
          agility: 5,
          regen: 4,
          thorns: 4,
          ap_regen: 9,
          draw_regen: 7,
          shield_regen: 3,
          heal_regen: 3.5,
          damage_bonus: 4,
          spell_damage_bonus: 4,
          damage_reduce: 4,
          mp_regen: 1.2,
          blood_burn: 3,
        }[String(effect.buff)] ?? 5;
      return (
        perTurn *
        Math.max(1, value || 1) *
        turns *
        durationDiscount(turns) *
        multiplier *
        (effect.buff === 'blood_burn' ? 0.72 : 1)
      );
    }
    case 'cleanse':
      return amountCost(effect.amount, 6, 18) * multiplier;
    case 'dispel':
      return amountCost(effect.amount, 6, 14) * multiplier;
    case 'strip_shield':
      return 8 * multiplier;
    case 'strip_buffs':
      return 14 * multiplier;
    case 'trap':
      return value * 0.8 * multiplier;
    case 'damage_from_shield':
      return number(effect.ratio) * 16 * multiplier;
    case 'damage_per_debuff':
      return value * 2.2 * multiplier;
    case 'discard':
      return effect.amount === 'all' ? 6 : number(effect.amount) * 2;
    case 'recover_discard':
      return effect.amount === 'all' ? 18 : number(effect.amount) * 5;
    case 'destroy_summon':
      return effect.amount === 'all' ? -30 : -number(effect.amount, 1) * 14;
    case 'discard_all_damage':
      return value * 5 * multiplier;
    case 'reveal_intent':
      return 5;
    case 'summon': {
      const skills = Array.isArray(effect.skills) ? effect.skills : [];
      const expected = skills.reduce((sum, rawSkill) => {
        const skill = record(rawSkill);
        const effects = Array.isArray(skill.effects)
          ? (skill.effects as CardEffect[])
          : [];
        return (
          sum +
          effects.reduce(
            (skillSum, child) => skillSum + singleEffectScore(child),
            0,
          ) *
            number(skill.weight, 0)
        );
      }, 0);
      if (effect.attackable === false) {
        return expected * Math.max(1, number(effect.duration, 3)) * 1.15;
      }
      const hpRatio = Math.max(1, number(effect.hp_ratio, 35));
      return hpRatio * 0.28 + expected * summonExpectedTurns(hpRatio);
    }
    case 'conditional_group': {
      const thenScore = (Array.isArray(effect.then_effects)
        ? (effect.then_effects as CardEffect[])
        : []
      ).reduce((sum, child) => sum + singleEffectScore(child), 0);
      const elseScore = (Array.isArray(effect.else_effects)
        ? (effect.else_effects as CardEffect[])
        : []
      ).reduce((sum, child) => sum + singleEffectScore(child), 0);
      return Math.max(thenScore * number(effect.discount, 1), elseScore);
    }
    case 'conditional_bonus':
      if (
        ['bonus_by_lost_hp_ratio', 'bonus_by_max_hp_ratio'].includes(
          String(effect.condition),
        )
      ) {
        return number(effect.ratio) * 1.1 + 8;
      }
      if (effect.condition === 'bonus_per_self_buff') {
        return number(effect.bonus) * 3 + 8;
      }
      return (
        number(effect.bonus) * 0.75 +
        (effect.condition === 'enemy_has_specific_debuff' ? 3 : 5)
      );
    default:
      return 0;
  }
}

export function cardScore(card: Pick<CardDefinition, 'effects'>): number {
  return (card.effects ?? []).reduce(
    (sum, effect) => sum + singleEffectScore(effect),
    0,
  );
}

export function cardLimit(cost: number): number {
  return CARD_LIMITS[Math.max(0, Math.min(10, Math.floor(cost)))] ?? 10;
}

export function rarityFromScore(score: number): string {
  if (score >= 130) return 'legendary';
  if (score >= 90) return 'epic';
  if (score >= 58) return 'rare';
  if (score >= 30) return 'uncommon';
  return 'common';
}

export function talentScore(effects: CardEffect[]): number {
  return effects.reduce((score, effect) => {
    const value = number(effect.value);
    if (effect.type === 'battle_start_shield') return score + value * 0.7;
    if (effect.type === 'turn_start_heal') return score + value * 4;
    if (effect.type === 'attack_bonus') return score + value * 4;
    if (effect.type === 'shield_bonus') return score + value * 35;
    if (effect.type === 'extra_draw') return score + value * 9;
    if (effect.type === 'first_turn_ap') return score + value * 9;
    if (effect.type === 'damage_reduction') return score + value * 6;
    if (effect.type === 'always_reveal_intent') return score + 8;
    if (effect.type === 'turn_start_cleanse') {
      return score + number(effect.value, 1) * 10;
    }
    if (effect.type === 'turn_start_debuff_shield') {
      return score + value * 1.2;
    }
    return score + 6;
  }, 0);
}

export function normalizeWorkshopCard(
  value: unknown,
  classId: string,
  index = 0,
): WorkshopCard {
  const source = record(value);
  const name = String(source.name ?? '').trim().slice(0, 20);
  if (!name) throw new Error('卡牌缺少名称');
  const type = ['attack', 'defense', 'skill', 'summon'].includes(
    String(source.type),
  )
    ? String(source.type)
    : 'skill';
  const cost = clamp(source.cost, 0, 10, 1);
  const effects = (Array.isArray(source.effects) ? source.effects : [])
    .slice(0, 8)
    .flatMap((entry) => {
      const normalized = normalizeCardEffect(entry);
      return normalized ? [normalized] : [];
    });
  ensureUniqueEffects(effects, `卡牌「${name}」`);
  if (type === 'summon' && !effects.some((effect) => effect.type === 'summon')) {
    throw new Error(`召唤牌「${name}」必须创建一个召唤物。`);
  }
  if (type !== 'summon' && effects.some((effect) => effect.type === 'summon')) {
    throw new Error(`只有召唤类型卡牌才能保存召唤物。`);
  }
  if (!effects.length) throw new Error(`卡牌「${name}」没有有效效果`);
  const description =
    String(source.description ?? source.brief ?? '').trim().slice(0, 90) ||
    name;
  const card: WorkshopCard = {
    id: safeId(
      source.id ??
        `custom_card_${slug(classId)}_${index}_${slug(name)}`,
    ),
    name,
    type,
    cost,
    rarity: 'common',
    description,
    brief: description,
    effects,
    cat: `sub_${classId}`,
    cls: 'custom',
    custom: true,
    powerScore: 0,
  };
  const score = cardScore(card);
  card.rarity = rarityFromScore(score);
  card.powerScore = Math.round(score);
  const limit = cardLimit(cost);
  if (score > limit) {
    throw new Error(
      `卡牌「${name}」强度过高（${Math.round(score)}/${limit}），请提高费用或降低数值。`,
    );
  }
  return card;
}

export function normalizeWorkshopClass(
  value: unknown,
  index = 0,
): WorkshopClass {
  const source = record(value);
  const name = String(source.name ?? '').trim().slice(0, 18);
  if (!name) throw new Error('职业缺少名称');
  const main = WORKSHOP_MAIN_CLASSES.includes(
    source.main as WorkshopMainClass,
  )
    ? (source.main as WorkshopMainClass)
    : 'freelance';
  const id = safeId(
    source.id ??
      `custom_class_${slug(name)}_${Date.now().toString(36).slice(-5)}${index}`,
  );
  const talentSource = record(source.talent);
  const talentEffects = (Array.isArray(talentSource.effects)
    ? talentSource.effects
    : []
  )
    .slice(0, 4)
    .flatMap((entry) => {
      const normalized = normalizeTalentEffect(entry);
      return normalized ? [normalized] : [];
    });
  const talentTypes = new Set<string>();
  for (const effect of talentEffects) {
    if (talentTypes.has(effect.type)) {
      throw new Error(
        `职业「${name}」的天赋效果「${effect.type}」重复。每个天赋词条只能添加一次。`,
      );
    }
    talentTypes.add(effect.type);
  }
  const talentPower = talentScore(talentEffects);
  if (talentPower > 24) {
    throw new Error(
      `职业「${name}」的天赋强度过高（${Math.round(talentPower)}/24），请减少数值或删除部分词条。`,
    );
  }
  const rawCards = Array.isArray(source.cards) ? source.cards : [];
  if (rawCards.length < 8 || rawCards.length > 16) {
    throw new Error(`职业「${name}」需要 8–16 种不同卡牌。`);
  }
  const cards = rawCards.map(
    (entry, cardIndex) => normalizeWorkshopCard(entry, id, cardIndex),
  );
  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw new Error(`职业「${name}」存在重复的卡牌 ID。`);
  }
  if (
    new Set(cards.map((card) => card.name.trim().toLocaleLowerCase('zh-CN')))
      .size !== cards.length
  ) {
    throw new Error(`职业「${name}」的 8–16 种卡牌必须使用不同名称。`);
  }
  const cardIds = new Set(cards.map((card) => card.id));
  const starterDeck = (
    Array.isArray(source.starterDeck) ? source.starterDeck : []
  )
    .map(String)
    .filter((cardId) => cardIds.has(cardId));
  if (starterDeck.length !== 15) {
    throw new Error(`职业「${name}」的基础卡组构筑必须正好 15 张。`);
  }

  const cardPool = (
    Array.isArray(source.cardPool) ? source.cardPool : []
  )
    .map(String)
    .filter((cardId) => cardIds.has(cardId));
  if (cardPool.length < 16 || cardPool.length > 32) {
    throw new Error(`职业「${name}」的可配置职业卡池必须为 16–32 张。`);
  }
  if (new Set(cardPool).size !== cards.length) {
    throw new Error(`职业「${name}」的每一种卡牌都必须出现在职业卡池中。`);
  }
  const starterCounts = starterDeck.reduce<Record<string, number>>(
    (result, cardId) => {
      result[cardId] = (result[cardId] ?? 0) + 1;
      return result;
    },
    {},
  );
  const poolCounts = cardPool.reduce<Record<string, number>>(
    (result, cardId) => {
      result[cardId] = (result[cardId] ?? 0) + 1;
      return result;
    },
    {},
  );
  if (
    Object.entries(starterCounts).some(
      ([cardId, count]) => count > (poolCounts[cardId] ?? 0),
    )
  ) {
    throw new Error(`职业「${name}」的基础构筑数量不能超过职业卡池持有数。`);
  }
  return {
    id,
    main,
    name,
    description:
      String(source.description ?? '').trim().slice(0, 120) ||
      '玩家创意工坊职业。',
    talent: {
      name:
        String(talentSource.name ?? '自定义天赋').trim().slice(0, 18) ||
        '自定义天赋',
      description:
        String(talentSource.description ?? '')
          .trim()
          .slice(0, 100) || '玩家自定义职业天赋。',
      effects: talentEffects,
    },
    cards,
    cardPool,
    starterDeck,
    mechanismIds: (Array.isArray(source.mechanismIds)
      ? source.mechanismIds
      : []
    )
      .map((entry) => extensionId(entry, ''))
      .filter(Boolean)
      .slice(0, 12),
    custom: true,
  };
}

export function normalizeWorkshopPack(value: unknown): WorkshopPack {
  const source = record(value);
  const classesSource = Array.isArray(source.classes)
    ? source.classes
    : source.id && source.name
      ? [source]
      : [];
  const classes = classesSource.map((entry, index) =>
    normalizeWorkshopClass(entry, index),
  );
  if (!classes.length) throw new Error('职业包中没有有效职业。');
  const mechanisms = (Array.isArray(source.mechanisms) ? source.mechanisms : [])
    .slice(0, 20)
    .map((entry) => normalizeWorkshopMechanism(entry));
  const uniqueMechanisms = [
    ...new Map(mechanisms.map((entry) => [entry.id, entry])).values(),
  ];
  return {
    format: WORKSHOP_FORMAT,
    version: 1,
    packName: String(source.packName ?? classes[0]?.name ?? '创意工坊职业包').slice(
      0,
      30,
    ),
    author: String(source.author ?? '玩家自定义').slice(0, 30),
    exported_at: String(source.exported_at ?? new Date().toISOString()),
    classes,
    ...(uniqueMechanisms.length ? { mechanisms: uniqueMechanisms } : {}),
  };
}

function conditionDiscount(
  conditions: CardEffect[],
  logic: 'and' | 'or',
): number {
  const discounts = conditions.map((condition) =>
    number(condition.discount, 1),
  );
  return logic === 'or'
    ? Math.max(...discounts)
    : discounts.reduce((result, discount) => result * discount, 1);
}

export function workshopPassiveId(classId: string): string {
  return `custom_passive_${classId.replace(/^custom_class_/, '')}`;
}

export function readWorkshopPacks(): WorkshopPack[] {
  try {
    const raw = localStorage.getItem(WORKSHOP_STORAGE_KEY);
    const values: unknown[] = raw ? JSON.parse(raw) : [];
    return Array.isArray(values)
      ? values.flatMap((entry) => {
          try {
            return [normalizeWorkshopPack(entry)];
          } catch {
            return [];
          }
        })
      : [];
  } catch {
    return [];
  }
}

function writeWorkshopPacks(packs: WorkshopPack[]): void {
  localStorage.setItem(WORKSHOP_STORAGE_KEY, JSON.stringify(packs));
}

export function saveWorkshopPack(value: unknown): WorkshopPack {
  const normalized = normalizeWorkshopPack(value);
  for (const mechanism of normalized.mechanisms ?? []) {
    saveWorkshopMechanism(mechanism);
  }
  const classIds = new Set(normalized.classes.map((entry) => entry.id));
  const kept = readWorkshopPacks().filter(
    (pack) => !pack.classes.some((entry) => classIds.has(entry.id)),
  );
  writeWorkshopPacks([...kept, normalized]);
  return normalized;
}

export function deleteWorkshopClass(classId: string): boolean {
  let removed = false;
  const next = readWorkshopPacks().flatMap((pack) => {
    const classes = pack.classes.filter((entry) => {
      if (entry.id !== classId) return true;
      removed = true;
      return false;
    });
    return classes.length ? [{ ...pack, classes }] : [];
  });
  if (removed) writeWorkshopPacks(next);
  return removed;
}

export function exportWorkshopPack(value?: unknown): WorkshopPack {
  if (value) {
    const normalized = normalizeWorkshopPack(value);
    return attachReferencedMechanisms({
      ...normalized,
      exported_at: new Date().toISOString(),
    });
  }
  return attachReferencedMechanisms({
    format: WORKSHOP_FORMAT,
    version: 1,
    packName: '凯利安创意工坊职业包合集',
    author: '玩家自定义',
    exported_at: new Date().toISOString(),
    classes: readWorkshopPacks().flatMap((pack) => pack.classes),
  });
}

function attachReferencedMechanisms(pack: WorkshopPack): WorkshopPack {
  const required = new Set(
    pack.classes.flatMap((profession) => profession.mechanismIds ?? []),
  );
  if (!required.size) return pack;
  const candidates = [
    ...(pack.mechanisms ?? []),
    ...readWorkshopMechanisms(),
  ];
  const mechanisms = [
    ...new Map(
      candidates
        .filter((mechanism) => required.has(mechanism.id))
        .map((mechanism) => [mechanism.id, mechanism]),
    ).values(),
  ];
  return mechanisms.length ? { ...pack, mechanisms } : pack;
}

export function readWorkshopDrafts(): WorkshopDraft[] {
  try {
    const raw = localStorage.getItem(WORKSHOP_DRAFT_STORAGE_KEY);
    const values = raw ? JSON.parse(raw) : [];
    return Array.isArray(values) ? values.slice(0, 40) : [];
  } catch {
    return [];
  }
}

export function saveWorkshopDraft(draft: WorkshopDraft): void {
  const kept = readWorkshopDrafts().filter((entry) => entry.id !== draft.id);
  localStorage.setItem(
    WORKSHOP_DRAFT_STORAGE_KEY,
    JSON.stringify([draft, ...kept].slice(0, 40)),
  );
}

export function normalizeWorkshopExtension(
  value: unknown,
): WorkshopExtensionManifest {
  const source = record(value);
  const name = String(source.name ?? '').trim().slice(0, 40);
  if (!name) throw new Error('扩展缺少名称。');
  const id = extensionId(source.id, `extension-${slug(name)}`);
  const rawPresets = Array.isArray(source.presets) ? source.presets : [];
  const presets = rawPresets.slice(0, 80).map((entry, index) => {
    const preset = record(entry);
    const label = String(preset.label ?? preset.name ?? '')
      .trim()
      .slice(0, 40);
    if (!label) throw new Error(`扩展「${name}」的第 ${index + 1} 个预设缺少名称。`);
    const effects = (Array.isArray(preset.effects) ? preset.effects : [])
      .slice(0, 8)
      .flatMap((effect) => {
        const normalized = normalizeCardEffect(effect);
        return normalized ? [normalized] : [];
      });
    if (!effects.length) {
      throw new Error(`扩展预设「${label}」没有可用效果。`);
    }
    const requestedTypes = Array.isArray(preset.cardTypes)
      ? preset.cardTypes.map(String)
      : [];
    const cardTypes = requestedTypes.filter(
      (type): type is 'attack' | 'defense' | 'skill' | 'summon' =>
        ['attack', 'defense', 'skill', 'summon'].includes(type),
    );
    return {
      id: extensionId(preset.id, `${id}.preset-${index + 1}`),
      label,
      description: String(preset.description ?? '').trim().slice(0, 160),
      cardTypes: cardTypes.length
        ? [...new Set(cardTypes)]
        : (['attack', 'defense', 'skill', 'summon'] as Array<
            'attack' | 'defense' | 'skill' | 'summon'
          >),
      effects,
    };
  });
  if (!presets.length) throw new Error(`扩展「${name}」没有效果预设。`);
  const presetIds = presets.map((preset) => preset.id);
  if (new Set(presetIds).size !== presetIds.length) {
    throw new Error(`扩展「${name}」包含重复的预设 ID。`);
  }
  return {
    format: WORKSHOP_EXTENSION_FORMAT,
    version: 1,
    id,
    name,
    author: String(source.author ?? '匿名作者').trim().slice(0, 40),
    description: String(source.description ?? '').trim().slice(0, 240),
    presets,
  };
}

export function readWorkshopExtensions(): WorkshopExtensionManifest[] {
  try {
    const raw = localStorage.getItem(WORKSHOP_EXTENSION_STORAGE_KEY);
    const values: unknown[] = raw ? JSON.parse(raw) : [];
    return Array.isArray(values)
      ? values.flatMap((value) => {
          try {
            return [normalizeWorkshopExtension(value)];
          } catch {
            return [];
          }
        })
      : [];
  } catch {
    return [];
  }
}

function writeWorkshopExtensions(
  extensions: WorkshopExtensionManifest[],
): void {
  localStorage.setItem(
    WORKSHOP_EXTENSION_STORAGE_KEY,
    JSON.stringify(extensions.slice(0, 40)),
  );
}

export function saveWorkshopExtension(
  value: unknown,
): WorkshopExtensionManifest {
  const normalized = normalizeWorkshopExtension(value);
  const kept = readWorkshopExtensions().filter(
    (extension) => extension.id !== normalized.id,
  );
  writeWorkshopExtensions([...kept, normalized]);
  return normalized;
}

export function deleteWorkshopExtension(extensionIdValue: string): boolean {
  const extensions = readWorkshopExtensions();
  const next = extensions.filter(
    (extension) => extension.id !== extensionIdValue,
  );
  if (next.length === extensions.length) return false;
  writeWorkshopExtensions(next);
  return true;
}

export function importWorkshopArtifact(value: unknown): WorkshopImportResult {
  const source = record(value);
  if (source.format === WORKSHOP_EXTENSION_FORMAT) {
    return { kind: 'extension', extension: saveWorkshopExtension(value) };
  }
  return { kind: 'class-pack', pack: saveWorkshopPack(value) };
}

export function createWorkshopExtensionApi(): WorkshopExtensionApi {
  return Object.freeze({
    apiVersion: 1 as const,
    register: (value: unknown) => saveWorkshopExtension(value),
    list: () => readWorkshopExtensions(),
    remove: (id: string) => deleteWorkshopExtension(id),
    validateClassPack: (value: unknown) => normalizeWorkshopPack(value),
    importArtifact: (value: unknown) => importWorkshopArtifact(value),
  });
}
