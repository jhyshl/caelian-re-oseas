/**
 * Read-only public-catalog overlay. The interpreter must keep reading the reviewed
 * source catalog: its exact predicate strings are intentional dispatch keys.
 *
 * Integration: applyReworkMonsters(...) once at the END of loadMonsterCatalog's
 * generated/legacy overlay construction. Do not append MONSTER_TEAM_SKILL_OVERLAYS
 * afterwards or those retired random-era skills will return.
 */
import rawCatalog from '@/battle/rework/catalog.json';
import { encounter } from './runtime/model.mjs';
import { BALANCE_PATCH } from './runtime/balance.mjs';
import type { MonsterDefinition, MonsterSkillDefinition } from '@/content/catalogs/battle';
import type { CardEffect } from '@/content/types';

type Data = Record<string, unknown>;
type Tier = 'normal' | 'elite' | 'boss';
interface SourceSkill extends Data {
  id: string;
  name: string;
  condition?: string;
  executeIf?: string;
  summary?: string;
  effects: Data[];
}
interface SourceMonster extends Data {
  id: string;
  name: string;
  tier: Tier;
  skills: SourceSkill[];
  statMultipliers: { hp: number; attack: number; defense: number; speed: number };
  statsAt20: { crit: number; critDamage: number; ehr: number; res: number };
}
export interface ReworkPublicMonsterStats {
  level: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  critRate: number;
  critDamage: number;
  effectHit: number;
  effectResist: number;
}
export interface ReworkPublicSkill extends MonsterSkillDefinition {
  id: string;
  priority: number;
  cooldown: number;
  condition: string;
  effects: CardEffect[];
  available: boolean;
  disabledReason?: string;
  [key: string]: unknown;
}
const definitions = [...rawCatalog.monsters, ...rawCatalog.bosses] as unknown as SourceMonster[];
const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]));
const clamp = (value: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
const list = (value: unknown): Data[] => Array.isArray(value)
  ? value.filter((entry): entry is Data => Boolean(entry) && typeof entry === 'object') : [];
const text = (value: unknown): string => typeof value === 'string'
  ? value : Array.isArray(value) ? value.map(text).filter(Boolean).join('；') : '';

/** Reference values for one monster; group HP/action budgets are applied in combat. */
export function reworkMonsterReferenceStats(id: string, requestedLevel = 20): ReworkPublicMonsterStats | undefined {
  const definition = definitionMap.get(id);
  if (!definition) return undefined;
  const level = Number.isFinite(requestedLevel) ? clamp(Math.floor(requestedLevel), 1, 100) : 20;
  const stats = encounter([definition], level, BALANCE_PATCH)[0].stats;
  return { level, hp: stats.hp, attack: stats.attack, defense: stats.defense, speed: stats.speed,
    critRate: stats.crit, critDamage: stats.critDamage, effectHit: stats.ehr, effectResist: stats.res };

}

function compatibleValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compatibleValue);
  if (!value || typeof value !== 'object') return value;
  const record = value as Data;
  const copy: Data = Object.fromEntries(Object.entries(record).map(([key, nested]) => [key, compatibleValue(nested)]));
  if (typeof record.kind === 'string') copy.type = record.kind;
  return copy;
}
function compatibleEffect(effect: Data): CardEffect {
  const copy = compatibleValue(effect) as Data;
  return { ...copy, type: text(copy.type || copy.kind) || 'utility' };
}
function isRetiredWeakSelfBuff(skill: SourceSkill): boolean {
  const effect = skill.effects[0];
  return skill.effects.length === 1 && Boolean(effect) &&
    (effect!.kind ?? effect!.type) === 'buff' && effect!.status === 'attack_up' &&
    effect!.target === 'self' && effect!.turns === 2 && effect!.value === 0.15;
}
const shieldCounterConditions: Record<string, string> = {
  '目标上一轮结束无盾或本体上一轮采取防御/强化行动': '总是',
  '目标上一轮结束无盾': '总是',
  '目标上一轮结束时无盾': '总是',
  '玩家上一轮结束时无盾且当前生命高于50%': '自身当前生命高于50%',
  '目标上一轮结束无盾且有虚弱': '目标仍有虚弱',
  '目标有灼烧且上一轮结束无盾': '目标仍有灼烧',
};
const shieldRule = '目标护盾达到本次预告阈值时，重击直接伤害降低30%；阈值取目标最大生命10%与本次非暴击、经防御结算伤害35%中的较大值。少量护盾不再取消重击，其他公开条件仍须满足。';
const readable = (value: string) => value
  .replace(/attack_up/g, '攻击提高').replace(/defense_up/g, '防御提高')
  .replace(/speed_up/g, '速度提高').replace(/all_allies/g, '全体怪物队友')
  .replace(/\bself\b/g, '自身').replace(/\bally\b/g, '一名怪物队友');

function publicSkill(source: SourceSkill, monsterId: string): ReworkPublicSkill {
  const copy = structuredClone(source);
  const retired = isRetiredWeakSelfBuff(copy);
  const shieldCounter = Boolean(copy.executeIf?.includes('无盾')) && monsterId.startsWith('mon_');
  const condition = shieldCounter
    ? shieldCounterConditions[copy.condition ?? ''] ?? copy.condition ?? ''
    : copy.condition ?? '';
  if (copy.id === 'mon_heat_core__skill_2') {
    for (const effect of copy.effects) {
      if ((effect.type ?? effect.kind) === 'buff' && effect.status === 'attack_up' && effect.value === 0.2 && effect.turns === 1) effect.turns = 2;
    }
    copy.summary = '自身攻击提高20%，持续2回合，可驱散。';
  }
  const disabledReason = retired ? '已停用：怪物不再单独花主要行动使用此弱自强化技能。' : undefined;
  const desc = [
    disabledReason,
    condition ? '使用条件：' + condition : '',
    readable(copy.summary ?? ''),
    shieldCounter ? shieldRule : text(copy.executeIf),
    text(copy.targetSelection) ? '目标选择：' + text(copy.targetSelection) : '',
    text(copy.telegraph), text(copy.fallback),
    '所有目标均相对施放者阵营；友方为怪物队伍。',
  ].filter(Boolean).join('；');
  return {
    ...copy,
    id: copy.id,
    name: copy.name,
    priority: Number(copy.priority ?? 0),
    cooldown: Number(copy.cooldown ?? 0),
    condition,
    effects: copy.effects.map(compatibleEffect),
    intent: copy.effects.some((effect) => (effect.kind ?? effect.type) === 'damage') ? '攻击' : '支援',
    desc,
    available: !retired,
    ...(disabledReason ? { disabledReason } : {}),
    ...(shieldCounter ? {
      reviewedCondition: source.condition,
      executeIf: '执行时保留原非护盾状态条件；达到预告护盾阈值时直伤降低30%。',
      reviewedExecuteIf: source.executeIf,
      shieldCounterRule: shieldRule,
    } : {}),
  };
}
function publicHelpers(value: unknown, monsterId: string): Data[] {
  return list(value).map((helper) => ({
    ...structuredClone(helper),
    skills: list(helper.skills).map((skill, index) => publicSkill({
      ...skill,
      id: text(skill.id) || text(helper.id) + '__skill_' + (index + 1),
      name: text(skill.name) || '机制行动',
      effects: list(skill.effects),
    }, monsterId)),
  }));
}
function mechanicsText(definition: SourceMonster): string {
  const mechanic = definition.mechanic && typeof definition.mechanic === 'object' ? definition.mechanic as Data : {};
  return [
    text(definition.role),
    text(mechanic.name), text(mechanic.state), text(mechanic.rules),
    text(mechanic.counterplay) || text(definition.counterplay),
    text(mechanic.failure), text(definition.teamwork),
    text(definition.healingCap), text(definition.control),
    ...list(definition.contextActions).map((action) =>
      '场景动作「' + text(action.name) + '」：' + String(action.ap ?? 0) + 'AP；' + text(action.effect) + '；' + text(action.limit)),
    ...list(definition.helpers).map((helper) =>
      '协作单位「' + text(helper.name) + '」：' + text(helper.role) + '；' +
      list(helper.skills).map((skill) => text(skill.name) + '：' + text(skill.summary)).join('；')),
  ].filter(Boolean).join('\n');
}

/** Preserve identity, reward tables and installed additions; replace every built-in combat definition. */
export function applyReworkMonsters(legacy: Record<string, MonsterDefinition>): Record<string, MonsterDefinition> {
  const result = { ...legacy };
  for (const definition of definitions) {
    const previous = legacy[definition.id];
    const stats = reworkMonsterReferenceStats(definition.id, 20)!;
    const skills = Object.fromEntries(definition.skills.map((skill) => [skill.id, publicSkill(skill, definition.id)]));
    const regions = Array.isArray(definition.regions) ? definition.regions as string[]
      : text(definition.region) ? [text(definition.region)] : previous?.regions ?? [];
    result[definition.id] = {
      ...previous,
      id: definition.id,
      name: definition.name,
      hp: stats.hp, maxHp: stats.hp,
      attack: stats.attack, defense: stats.defense, speed: stats.speed,
      critRate: stats.critRate, critDamage: stats.critDamage,
      effectHit: stats.effectHit, effectResist: stats.effectResist,
      regions: [...regions],
      tags: [...new Set([...(previous?.tags ?? []), ...(Array.isArray(definition.tags) ? definition.tags as string[] : []), ...(definition.tier === 'boss' ? ['boss'] : [])])],
      difficulty: definition.tier === 'boss' ? 'boss' : text(definition.legacyDifficulty) || previous?.difficulty || 'normal',
      mechanics: mechanicsText(definition),
      source_attacks: Object.values(skills).filter((skill) => skill.available).map((skill) => skill.name).join('、'),
      skills,
      patterns: [],
      battle_start_buffs: [],
      battle_start_debuffs: [],
      rework: true,
      reworkVersion: '2026-09-07-v3',
      reworkReferenceLevel: 20,
      reworkReferenceStats: stats,
      reworkStatsNote: '面板参考20级单体遭遇；实际等级随地区追赶玩家，组队时共用遭遇总生命与行动预算。',
      tier: definition.tier,
      role: definition.role,
      roleKey: definition.roleKey,
      statMultipliers: structuredClone(definition.statMultipliers),
      reworkMechanic: structuredClone(definition.mechanic),
      reworkContextActions: structuredClone(definition.contextActions ?? []),
      reworkHelpers: publicHelpers(definition.helpers, definition.id),
      reworkAI: {
        policy: 'deterministic_snapshot_priority',
        actionBudget: 1,
        priority: '先筛选冷却、合法目标、条件与正收益，再按优先级降序，同值按稳定技能ID；无随机选招。',
        snapshot: '每轮玩家阶段开始公开并锁定技能和目标，读取上一轮玩家已发生行动与当前公开状态。',
        fallback: '只执行已公开的条件分支或后备行动，不在行动中改选更高优先级技能。',
      },
    };
  }
  return result;
}
