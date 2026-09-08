import type { CardDefinition, CardEffect, RelicDefinition } from '@/content/types';
import type { GameSnapshot, LocalBattleState } from '@/domain/types';
import { describeReworkEffects, reworkCard, type ReworkEffect, type CardDisplayStats } from './rework/catalog';
import { scaleWorkshopCard } from '@/workshop-stars';
import { roundNumbersInText } from '@/ui/format-number';
import { describeRuleProgram, type RuleProgram } from '@/workshop-program';

function revealsIntent(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const effect = raw as CardEffect;
  return effect.type === 'always_reveal_intent' && effect.value !== false ||
    Array.isArray(effect.effects) && effect.effects.some(revealsIntent);
}

export function canViewMonsterIntent(snapshot: Pick<GameSnapshot, 'relics'> | null | undefined, relics: Record<string, RelicDefinition>): boolean {
  return snapshot?.relics.some(row => row.carried && revealsIntent(relics[row.relicId]?.effect)) ?? false;
}

export function cleanCombatCopy(text: string): string {
  return roundNumbersInText(text
    .replace(/伤害预览按命中[^。\n]*(?:。|$)/g, '')
    .replace(/(?:每个目标的每段独立判定暴击|逐目标逐段判定暴击|每目标逐段独立判定暴击)/g, '')
    .replace(/(?:仅使用攻击快照、星级、目标防御和护盾|受本战治疗额度限制|所有目标均相对施放者阵营；友方为怪物队伍。)/g, '')
    .replace(/(?:原始直接伤害预算|直接伤害原始总预算)[^。\n]*(?:。|$)/g, '')
    .replace(/技能与目标在玩家阶段开始时锁定[^。\n]*(?:。|$)/g, '')
    .replace(/[，；]\s*([，；。]|$)/g, '$1').trim());
}

export function battleCardText(card: CardDefinition, stars: number, state: LocalBattleState, stats: CardDisplayStats): string {
  const native = reworkCard(String(card.id));
  if (native) return cleanCombatCopy(describeReworkEffects(native.effects, stars, stats));
  const scaled = scaleWorkshopCard(card, stars);
  const toEffect = (effect: CardEffect): ReworkEffect => {
    if(effect.type==='rule_program')return {kind:'utility',text:describeRuleProgram(effect.program as RuleProgram,{self:{...stats,hp:state.player.hp,hpMax:state.player.hpMax,shield:state.player.shield,ap:state.player.ap},target:state.enemies[state.selectedTarget] as unknown as Record<string,number>,star:stars})};
    const next = { ...effect, kind: effect.type } as ReworkEffect;
    const scaling = effect.scaling as { stat?: string; percent?: number } | undefined;
    const attr: Record<string, number> = { attack: stats.attack, defense: stats.defense, hp: state.player.hp, shield: state.player.shield, mp: state.player.mp };
    const scaledValue = Number(effect.value ?? 0) + (scaling ? (attr[scaling.stat ?? ''] ?? 0) * Math.max(0, Math.min(Number(scaling.percent ?? 0), 200 * Math.max(1, Number(effect.starRatioMultiplier ?? 1)))) / 100 : 0);
    const value = scaling ? Math.max(0, Math.round(scaledValue)) : scaledValue;
    if (['damage', 'shield', 'heal'].includes(effect.type)) {
      next.flat = value + (effect.type === 'damage' && card.type === 'attack' && (!scaled.resolvedStarScale || !effect.scaling) ? Math.floor(stats.attack * .35 * Number((scaled.resolvedStarScale as {ratio?:number} | undefined)?.ratio ?? 1)) : 0);
      if (effect.type === 'damage') next.flat = Number(next.flat) * Math.max(1, Number(effect.hits ?? 1));
    } else if (effect.type === 'apply_buff' || effect.type === 'apply_debuff') {
      next.kind = effect.type === 'apply_buff' ? 'buff' : 'debuff';next.status = effect.buff ?? effect.debuff;next.value = value;
    } else if (['draw', 'discard', 'cleanse', 'dispel'].includes(effect.type)) next.amount = effect.amount ?? effect.value;
    else if (!['summon', 'conditional', 'chant', 'resource'].includes(effect.type)) {
      next.kind = 'utility';next.action = String(effect.description ?? scaled.description ?? '');
      if (effect.value !== undefined) next.action += ` ${value}`;
    }
    for (const key of ['effects', 'then_effects', 'else_effects', 'entry']) if (Array.isArray(effect[key])) next[key] = (effect[key] as CardEffect[]).map(toEffect);
    if (Array.isArray(effect.skills)) next.skills = effect.skills.map(skill => ({ ...skill, effects: (skill.effects ?? []).map(toEffect) }));
    return next;
  };
  return cleanCombatCopy(describeReworkEffects(scaled.effects.map(toEffect), 1, stats));
}
