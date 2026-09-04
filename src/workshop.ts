import type { CardDefinition, CardEffect } from '@/content/types';
import { safeCardEffectHits } from '@/battle/execution-limits';
import {
  normalizeWorkshopMechanism,
  readWorkshopMechanisms,
  saveWorkshopMechanisms,
  WORKSHOP_MECHANISM_STORAGE_KEY,
  type WorkshopMechanismManifest,
} from '@/workshop-mechanisms';

export const WORKSHOP_STORAGE_KEY = 'caelian_custom_workshop_packs_v1';
export const WORKSHOP_TEST_STORAGE_KEY =
  'caelian_custom_workshop_test_packs_v1';
const LEGACY_WORKSHOP_ASSESSMENT_STORAGE_KEY =
  'caelian_workshop_assessments_v1';
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
  /** Player-defined classification used by imported script mechanisms. */
  tags: string[];
  custom: true;
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
  /** Declarative or script mechanisms bundled for portable profession imports. */
  mechanisms?: WorkshopMechanismManifest[];
}

export interface WorkshopTestCandidate {
  pack: WorkshopPack;
  profession: WorkshopClass;
  /** Candidate-local definitions override installed definitions only in tests. */
  mechanisms: WorkshopMechanismManifest[];
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

export const WORKSHOP_SCALING_STATS = [
  ['hp', '当前生命值'],
  ['attack', '攻击力'],
  ['shield', '当前护盾值'],
  ['defense', '防御力'],
  ['mp', '当前魔力'],
] as const;

type WorkshopScalingStat = (typeof WORKSHOP_SCALING_STATS)[number][0];

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
  'defense_reflect',
  'counterattack',
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
  'generate_blank_to_draw',
  'blank_regen',
  'discard_blank_damage',
  'destroy_summon',
  'reveal_intent',
  'summon',
  'conditional_bonus',
  'conditional_group',
  'workshop_resource_change',
  'apply_workshop_status',
]);
const TALENT_DEFAULTS: Record<string, number | undefined> = {
  battle_start_shield: 5,
  turn_start_heal: 1,
  attack_bonus: 1,
  shield_bonus: 0.1,
  extra_draw: 1,
  first_turn_ap: 1,
  damage_reduction: 1,
  always_reveal_intent: undefined,
  turn_start_cleanse: 1,
  turn_start_debuff_shield: 2,
  hand_limit_bonus: 5,
  defense_reflect: undefined,
  counterattack: undefined,
};
const VALID_CONDITION_TYPES = new Set([
  'self_has_shield',
  'self_no_shield',
  'enemy_has_shield',
  'enemy_no_shield',
  'enemy_has_debuff',
  'enemy_no_debuff',
  'enemy_has_specific_debuff',
  'enemy_no_specific_debuff',
  'self_has_buff',
  'self_no_buff',
  'self_full_hp',
  'self_not_full_hp',
  'has_summon',
  'no_summon',
  'same_card_played_this_turn',
  'previous_card_same_name',
  'spend_mp',
  'spend_hp',
  'discard',
  'destroy_summon',
  'spend_workshop_resource',
]);
const WORKSHOP_RARITIES = new Set([
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
]);

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
  { type: 'generate_blank_to_draw', label: '洗入空白牌', value: 1, target: 'self' },
  { type: 'blank_regen', label: '持续洗入空白牌', value: 1, turns: 3, target: 'self' },
  { type: 'discard_blank_damage', label: '揭晓空白牌造成伤害', value: 12, target: 'enemy' },
  { type: 'destroy_summon', label: '牺牲召唤物', amount: 1, target: 'random_summons' },
  { type: 'spend_mp_damage', label: '消耗 MP 造成伤害', value: 3, amount: 3, target: 'enemy' },
  { type: 'spend_mp_shield', label: '消耗 MP 获得护盾', value: 3, amount: 3, target: 'self' },
  { type: 'mp_to_ap', label: 'MP 转换 AP', value: 1, amount: 6, target: 'self' },
  { type: 'reveal_intent', label: '洞察敌人意图', target: 'self' },
  {
    type: 'workshop_resource_change',
    label: '增减自定义资源',
    mechanismId: '',
    resourceId: '',
    mode: 'add',
    value: 1,
    target: 'self',
  },
  {
    type: 'apply_workshop_status',
    label: '施加自定义状态',
    mechanismId: '',
    statusId: '',
    value: 1,
    turns: 2,
    target: 'self',
  },
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
  ['hand_limit_bonus', '手牌上限提高'],
  ['defense_reflect', '防反：按护盾与防御反伤'],
  ['counterattack', '反击：受击后造成10%攻击力伤害'],
  ['apply_workshop_status', '战斗开始施加自定义状态'],
  ['workshop_resource_change', '自定义资源变动'],
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

function workshopTag(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(/[^\p{L}\p{N}._:-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
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
    'generate_blank_to_draw',
    'blank_regen',
    'workshop_resource_change',
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
  const summonTargets = [
    'all_summons',
    'random_summons',
    'selected_summons',
  ];
  const targetRules: Record<string, string[]> = {
    damage: enemyTargets,
    spend_mp_damage: enemyTargets,
    trap: enemyTargets,
    damage_from_shield: enemyTargets,
    damage_per_debuff: enemyTargets,
    discard_blank_damage: enemyTargets,
    strip_shield: [...enemyTargets, ...allyTargets, ...summonTargets],
    strip_buffs: enemyTargets,
    dispel: enemyTargets,
    shield: allyTargets,
    spend_mp_shield: allyTargets,
    heal: allyTargets,
    apply_buff: allyTargets,
    cleanse: allyTargets,
    apply_debuff: [...enemyTargets, ...allyTargets],
    apply_workshop_status: [
      ...enemyTargets,
      ...allyTargets,
      ...summonTargets,
    ],
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

function normalizeScaling(value: unknown):
  | { stat: WorkshopScalingStat; percent: number }
  | undefined {
  const source = record(value);
  const stat = String(source.stat ?? '') as WorkshopScalingStat;
  if (!WORKSHOP_SCALING_STATS.some(([key]) => key === stat)) return undefined;
  const percent = clamp(source.percent, 0, 999_999);
  if (percent <= 0) return undefined;
  return { stat, percent };
}

function normalizeCondition(value: unknown): CardEffect | undefined {
  const source = record(value);
  const type = String(source.type ?? source.condition ?? '');
  if (!VALID_CONDITION_TYPES.has(type)) return undefined;
  const result: CardEffect = { type };
  if (type === 'spend_workshop_resource') {
    const mechanismId = extensionId(source.mechanismId, '');
    const resourceId = extensionId(source.resourceId, '');
    if (!mechanismId || !resourceId) return undefined;
    result.mechanismId = mechanismId;
    result.resourceId = resourceId;
    result.amount = amount(source.amount ?? source.value, 1);
    result.value = result.amount === 'all' ? 99 : result.amount;
    return result;
  }
  if (type.includes('specific_debuff')) {
    const debuff = String(source.debuff ?? '');
    if (!ALLOWED_DEBUFFS.includes(debuff)) return undefined;
    result.debuff = debuff;
  }
  if (['spend_mp', 'spend_hp', 'discard', 'destroy_summon'].includes(type)) {
    const normalized =
      type === 'spend_hp'
        ? Math.max(1, Math.floor(number(source.amount ?? source.value, 1)))
        : amount(source.amount ?? source.value, 1);
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
    hp_ratio: attackable ? clamp(source.hp_ratio, 1, 999_999, 35) : 0,
    duration: Math.max(1, Math.floor(number(source.duration, 3))),
    mechanical: !attackable,
    unique_by_name: source.unique_by_name !== false,
    skills,
  };
}

export function normalizeCardEffect(value: unknown): CardEffect | undefined {
  const source = record(value);
  const type = String(source.type ?? '').trim();
  if (!VALID_CARD_EFFECT_TYPES.has(type)) return undefined;
  if (type === 'workshop_resource_change') {
    const mechanismId = extensionId(source.mechanismId, '');
    const resourceId = extensionId(source.resourceId, '');
    if (!mechanismId || !resourceId) return undefined;
    return {
      type,
      target: 'self',
      mechanismId,
      resourceId,
      mode: source.mode === 'set' ? 'set' : 'add',
      value: clamp(source.value, -999_999, 999_999),
    };
  }
  if (type === 'apply_workshop_status') {
    const mechanismId = extensionId(source.mechanismId, '');
    const statusId = extensionId(source.statusId, '');
    if (!mechanismId || !statusId) return undefined;
    return {
      type,
      target: normalizeTarget(source, type),
      mechanismId,
      statusId,
      value: clamp(source.value, 1, 999_999, 1),
      turns: clamp(source.turns, 1, 99, 2),
    };
  }
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
          : key === 'hits'
            ? safeCardEffectHits(source[key])
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
    result.value = ['defense_reflect', 'counterattack'].includes(buff)
      ? 1
      : clamp(source.value, 0, 999999, 1);
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
    result.lifesteal_ratio = clamp(source.lifesteal_ratio, 0, 999_999);
  }
  if (type === 'damage_from_shield') {
    result.ratio = clamp(source.ratio, 0, 999_999, 0.5);
  }
  if (type === 'thorns') {
    result.value = clamp(source.value, 0, 999_999);
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
  if (
    typeof result.value === 'number' &&
    !(
      type === 'apply_buff' &&
      ['defense_reflect', 'counterattack'].includes(String(result.buff))
    )
  ) {
    const scaling = normalizeScaling(source.scaling);
    if (scaling) result.scaling = scaling;
  }
  return result;
}

export function normalizeTalentEffect(value: unknown): CardEffect | undefined {
  const source = record(value);
  const type = String(source.type ?? '');
  if (type === 'apply_workshop_status') {
    const mechanismId = extensionId(source.mechanismId, '');
    const statusId = extensionId(source.statusId, '');
    if (!mechanismId || !statusId) return undefined;
    const target = String(source.target ?? 'self');
    const rawTurns = source.turns === undefined ? -1 : number(source.turns, -1);
    return {
      type,
      trigger: 'battle_start',
      target: ['self', 'all_enemies', 'all_summons'].includes(target)
        ? target
        : 'self',
      mechanismId,
      statusId,
      value: clamp(source.value, 1, 999_999, 1),
      turns: rawTurns === -1 ? -1 : clamp(rawTurns, 1, 99, 1),
    };
  }
  if (type === 'workshop_resource_change') {
    const mechanismId = extensionId(source.mechanismId, '');
    const resourceId = extensionId(source.resourceId, '');
    if (!mechanismId || !resourceId) return undefined;
    return {
      type,
      trigger: source.trigger === 'turn_start' ? 'turn_start' : 'battle_start',
      target: 'self',
      mechanismId,
      resourceId,
      mode: source.mode === 'set' ? 'set' : 'add',
      value: clamp(source.value, -999_999, 999_999),
    };
  }
  if (!(type in TALENT_DEFAULTS)) return undefined;
  const effect: CardEffect = { type };
  const defaultValue = TALENT_DEFAULTS[type];
  if (defaultValue !== undefined) {
    effect.value = clamp(source.value, 0, 999_999, defaultValue);
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
  if (effect.type === 'workshop_resource_change') {
    return `${effect.type}:${effect.mechanismId ?? ''}:${effect.resourceId ?? ''}`;
  }
  if (effect.type === 'apply_workshop_status') {
    return `${effect.type}:${effect.mechanismId ?? ''}:${effect.statusId ?? ''}`;
  }
  return effect.type;
}

function talentEffectUniqueKey(effect: CardEffect): string {
  if (effect.type === 'apply_workshop_status') {
    return [
      effect.type,
      effect.mechanismId ?? '',
      effect.statusId ?? '',
      effect.target ?? 'self',
    ].join(':');
  }
  if (effect.type === 'workshop_resource_change') {
    return [
      effect.type,
      effect.mechanismId ?? '',
      effect.resourceId ?? '',
      effect.trigger ?? 'battle_start',
    ].join(':');
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
  const cost = clamp(source.cost, 0, 999_999, 1);
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
  const requestedTags = Array.isArray(source.tags)
    ? source.tags
    : String(source.tags ?? '').split(/[，,\s]+/);
  const tags = [
    ...new Set(
      requestedTags
        .map(workshopTag)
        .filter(Boolean),
    ),
  ].slice(0, 12);
  const card: WorkshopCard = {
    id: safeId(
      source.id ??
        `custom_card_${slug(classId)}_${index}_${slug(name)}`,
    ),
    name,
    type,
    cost,
    rarity: WORKSHOP_RARITIES.has(String(source.rarity))
      ? String(source.rarity)
      : 'common',
    description,
    brief: description,
    tags,
    effects,
    cat: `sub_${classId}`,
    cls: 'custom',
    custom: true,
  };
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
    const key = talentEffectUniqueKey(effect);
    if (talentTypes.has(key)) {
      throw new Error(
        `职业「${name}」的天赋效果「${effect.type}」重复。每个天赋词条只能添加一次。`,
      );
    }
    talentTypes.add(key);
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

function workshopResourceReferences(
  value: unknown,
  result: Array<{ mechanismId: string; resourceId: string }> = [],
): Array<{ mechanismId: string; resourceId: string }> {
  if (Array.isArray(value)) {
    for (const entry of value) workshopResourceReferences(entry, result);
    return result;
  }
  if (!value || typeof value !== 'object') return result;
  const source = value as UnknownRecord;
  if (
    ['workshop_resource_change', 'spend_workshop_resource'].includes(
      String(source.type ?? ''),
    )
  ) {
    result.push({
      mechanismId: String(source.mechanismId ?? ''),
      resourceId: String(source.resourceId ?? ''),
    });
  }
  for (const child of Object.values(source)) {
    if (child && typeof child === 'object') {
      workshopResourceReferences(child, result);
    }
  }
  return result;
}

function workshopStatusReferences(
  value: unknown,
  result: Array<{ mechanismId: string; statusId: string }> = [],
): Array<{ mechanismId: string; statusId: string }> {
  if (Array.isArray(value)) {
    for (const entry of value) workshopStatusReferences(entry, result);
    return result;
  }
  if (!value || typeof value !== 'object') return result;
  const source = value as UnknownRecord;
  if (source.type === 'apply_workshop_status') {
    result.push({
      mechanismId: String(source.mechanismId ?? ''),
      statusId: String(source.statusId ?? ''),
    });
  }
  for (const child of Object.values(source)) {
    if (child && typeof child === 'object') {
      workshopStatusReferences(child, result);
    }
  }
  return result;
}

function validateWorkshopResourceReferences(
  classes: WorkshopClass[],
  bundled: WorkshopMechanismManifest[],
): void {
  const manifests = new Map(
    [...readWorkshopMechanisms(), ...bundled].map((entry) => [entry.id, entry]),
  );
  for (const profession of classes) {
    const enabled = new Set(profession.mechanismIds ?? []);
    for (const mechanismId of enabled) {
      if (!manifests.has(mechanismId)) {
        throw new Error(
          `职业「${profession.name}」引用了不存在的底层机制 ${mechanismId}。`,
        );
      }
    }
    for (const reference of workshopResourceReferences({
      cards: profession.cards,
      talent: profession.talent.effects,
    })) {
      if (!enabled.has(reference.mechanismId)) {
        throw new Error(
          `职业「${profession.name}」没有启用卡牌或天赋引用的机制 ${reference.mechanismId}。`,
        );
      }
      const manifest = manifests.get(reference.mechanismId);
      if (
        !manifest?.resources.some(
          (resource) => resource.id === reference.resourceId,
        )
      ) {
        throw new Error(
          `职业「${profession.name}」引用了不存在的自定义资源 ${reference.resourceId}。`,
        );
      }
    }
    for (const reference of workshopStatusReferences({
      cards: profession.cards,
      talent: profession.talent.effects,
    })) {
      if (!enabled.has(reference.mechanismId)) {
        throw new Error(
          `职业「${profession.name}」没有启用卡牌或天赋引用的状态机制 ${reference.mechanismId}。`,
        );
      }
      const manifest = manifests.get(reference.mechanismId);
      if (!manifest?.statuses.some((status) => status.id === reference.statusId)) {
        throw new Error(
          `职业「${profession.name}」引用了不存在的自定义状态 ${reference.statusId}。`,
        );
      }
    }
  }
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
  validateWorkshopResourceReferences(classes, uniqueMechanisms);
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

export function workshopPassiveId(classId: string): string {
  return `custom_passive_${classId.replace(/^custom_class_/, '')}`;
}

function publishedWorkshopMechanisms(
  profession: WorkshopClass,
): WorkshopMechanismManifest[] {
  const requested = new Set(profession.mechanismIds ?? []);
  return readWorkshopMechanisms().filter((entry) => requested.has(entry.id));
}

function validatePublishedPackReferences(pack: WorkshopPack): WorkshopPack {
  // Installed battles resolve mechanisms from the global catalog. Portable
  // snapshots are installed before this validation runs.
  validateWorkshopResourceReferences(pack.classes, []);
  return pack;
}

function readWorkshopStorageValues(storageKey: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const sanitized = parsed.map(stripLegacyWorkshopMetadata);
    if (JSON.stringify(sanitized) !== JSON.stringify(parsed)) {
      localStorage.setItem(storageKey, JSON.stringify(sanitized));
    }
    return sanitized;
  } catch {
    return [];
  }
}

function stripLegacyWorkshopMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLegacyWorkshopMetadata);
  if (!value || typeof value !== 'object') return value;
  const result: UnknownRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (['certifications', 'powerScore', 'discount'].includes(key)) continue;
    result[key] = stripLegacyWorkshopMetadata(child);
  }
  return result;
}

function readStoredWorkshopPacks(storageKey: string): WorkshopPack[] {
  return readWorkshopStorageValues(storageKey).flatMap((entry) => {
    try {
      return [validatePublishedPackReferences(normalizeWorkshopPack(entry))];
    } catch {
      return [];
    }
  });
}

function rawWorkshopClassIds(value: unknown): string[] {
  const source = record(value);
  const classes = Array.isArray(source.classes)
    ? source.classes
    : source.id
      ? [source]
      : [];
  return classes
    .map((entry) => String(record(entry).id ?? '').trim())
    .filter(Boolean);
}

function withoutLegacyWorkshopMetadata(source: UnknownRecord): UnknownRecord {
  const cleaned = { ...source };
  delete cleaned.certifications;
  return cleaned;
}

function packsWithoutClasses(
  packs: unknown[],
  classIds: ReadonlySet<string>,
): unknown[] {
  return packs.flatMap((entry) => {
    const source = record(entry);
    const cleaned = withoutLegacyWorkshopMetadata(source);
    if (!Array.isArray(source.classes)) {
      return rawWorkshopClassIds(entry).some((classId) => classIds.has(classId))
        ? []
        : [cleaned];
    }
    const classes = source.classes.filter((profession) => {
      const classId = String(record(profession).id ?? '').trim();
      return !classIds.has(classId);
    });
    if (!classes.length) return [];
    return [{ ...cleaned, classes }];
  });
}

function storedPacksWithoutClasses(
  storageKey: string,
  classIds: ReadonlySet<string>,
): unknown[] {
  return packsWithoutClasses(readWorkshopStorageValues(storageKey), classIds);
}

function deleteStoredWorkshopClass(
  storageKey: string,
  classId: string,
): boolean {
  const current = readWorkshopStorageValues(storageKey);
  const next = packsWithoutClasses(current, new Set([classId]));
  const removed =
    current.flatMap(rawWorkshopClassIds).includes(classId) &&
    !next.flatMap(rawWorkshopClassIds).includes(classId);
  if (removed) localStorage.setItem(storageKey, JSON.stringify(next));
  return removed;
}

function writeWorkshopPacks(packs: unknown[]): void {
  localStorage.setItem(WORKSHOP_STORAGE_KEY, JSON.stringify(packs));
}

function restoreWorkshopStorage(
  snapshots: ReadonlyArray<readonly [string, string | null]>,
): void {
  for (const [key, value] of snapshots) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // Preserve the original error. Restoring a smaller previous value should
      // normally succeed even after a quota failure.
    }
  }
}

/**
 * Alpha 68/Beta 1.15 stored newly saved professions as test candidates. Move
 * every valid candidate into the normal catalog once, with the newest candidate
 * replacing an older installed copy of the same profession.
 */
export function migrateLegacyWorkshopTestPacks(): number {
  const snapshots = [
    [WORKSHOP_STORAGE_KEY, localStorage.getItem(WORKSHOP_STORAGE_KEY)],
    [WORKSHOP_TEST_STORAGE_KEY, localStorage.getItem(WORKSHOP_TEST_STORAGE_KEY)],
    [
      WORKSHOP_MECHANISM_STORAGE_KEY,
      localStorage.getItem(WORKSHOP_MECHANISM_STORAGE_KEY),
    ],
    [
      LEGACY_WORKSHOP_ASSESSMENT_STORAGE_KEY,
      localStorage.getItem(LEGACY_WORKSHOP_ASSESSMENT_STORAGE_KEY),
    ],
  ] as const;
  try {
    const legacy = readWorkshopStorageValues(WORKSHOP_TEST_STORAGE_KEY);
    if (!legacy.length) {
      localStorage.removeItem(LEGACY_WORKSHOP_ASSESSMENT_STORAGE_KEY);
      return 0;
    }
    let installed = readWorkshopStorageValues(WORKSHOP_STORAGE_KEY);
    const retained: unknown[] = [];
    const bundledMechanisms: WorkshopMechanismManifest[] = [];
    let migrated = 0;
    for (const entry of legacy) {
      try {
        const pack = normalizeWorkshopPack(entry);
        bundledMechanisms.push(...(pack.mechanisms ?? []));
        const classIds = new Set(
          pack.classes.map((profession) => profession.id),
        );
        installed = [...packsWithoutClasses(installed, classIds), pack];
        migrated += pack.classes.length;
      } catch {
        // Never discard a legacy candidate that cannot be normalized safely.
        retained.push(entry);
      }
    }
    if (bundledMechanisms.length) {
      saveWorkshopMechanisms(bundledMechanisms);
    }
    if (migrated > 0) writeWorkshopPacks(installed);
    if (retained.length) {
      localStorage.setItem(WORKSHOP_TEST_STORAGE_KEY, JSON.stringify(retained));
    } else {
      localStorage.removeItem(WORKSHOP_TEST_STORAGE_KEY);
    }
    localStorage.removeItem(LEGACY_WORKSHOP_ASSESSMENT_STORAGE_KEY);
    return migrated;
  } catch {
    restoreWorkshopStorage(snapshots);
    return 0;
  }
}

export function readWorkshopPacks(): WorkshopPack[] {
  localStorage.removeItem(LEGACY_WORKSHOP_ASSESSMENT_STORAGE_KEY);
  migrateLegacyWorkshopTestPacks();
  return readStoredWorkshopPacks(WORKSHOP_STORAGE_KEY);
}

export function saveWorkshopPack(value: unknown): WorkshopPack {
  migrateLegacyWorkshopTestPacks();
  const normalized = normalizeWorkshopPack(value);
  const classIds = new Set(normalized.classes.map((entry) => entry.id));
  const kept = storedPacksWithoutClasses(WORKSHOP_STORAGE_KEY, classIds);
  const snapshots = [
    [WORKSHOP_STORAGE_KEY, localStorage.getItem(WORKSHOP_STORAGE_KEY)],
    [
      WORKSHOP_MECHANISM_STORAGE_KEY,
      localStorage.getItem(WORKSHOP_MECHANISM_STORAGE_KEY),
    ],
  ] as const;
  try {
    if (normalized.mechanisms?.length) {
      saveWorkshopMechanisms(normalized.mechanisms);
    }
    writeWorkshopPacks([...kept, normalized]);
    return validatePublishedPackReferences(normalized);
  } catch (error) {
    restoreWorkshopStorage(snapshots);
    throw error;
  }
}

function workshopCandidateFromPacks(
  packs: WorkshopPack[],
  classId: string,
): { pack: WorkshopPack; profession: WorkshopClass } | undefined {
  for (let index = packs.length - 1; index >= 0; index -= 1) {
    const pack = packs[index];
    const profession = pack?.classes.find((entry) => entry.id === classId);
    if (pack && profession) return { pack, profession };
  }
  return undefined;
}

/** Resolves a saved profession for the optional isolated test arena. */
export function readWorkshopTestCandidate(
  classId: string,
): WorkshopTestCandidate | undefined {
  const saved = workshopCandidateFromPacks(readWorkshopPacks(), classId);
  return saved
    ? {
        ...saved,
        mechanisms: publishedWorkshopMechanisms(saved.profession),
      }
    : undefined;
}

export function deleteWorkshopClass(classId: string): boolean {
  migrateLegacyWorkshopTestPacks();
  return deleteStoredWorkshopClass(WORKSHOP_STORAGE_KEY, classId);
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
    ...readWorkshopMechanisms(),
    ...(pack.mechanisms ?? []),
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
