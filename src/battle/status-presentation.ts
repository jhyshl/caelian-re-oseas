import type { BattleTimedEffect } from '@/domain/types';
import { formatNumber } from '@/ui/format-number';

export type StatusDisplayEffect = BattleTimedEffect & { displayUnit?: 'flat' | 'percent' | 'count'; dot?: boolean };
export interface StatusDisplayEntry { key: string; name: string; effect: StatusDisplayEffect }
interface NativeStatus {
  status?: string; canonicalStatus?: string; value?: number; valueUnit?: string;
  speedFlat?: boolean; snapshotDamage?: number; remaining?: number; expireAtPhase?: number;
  charges?: number; ruleLabel?: string; ruleData?: Record<string, unknown>; ruleHidden?: boolean;
}
interface NativeActor { phaseCount: number; buffs: NativeStatus[]; debuffs: NativeStatus[]; dots: NativeStatus[] }

export const nativeStatusNames: Record<string, string> = {
  attack_up: '攻击提高', defense_up: '防御提高', speed_up: '速度提高', speed_down: '减速',
  armor_break: '破甲', direct_damage_up: '直接增伤', damage_up: '伤害提高',
  direct_damage_reduction: '直接减伤', healing_down: '治疗降低', healing_received_down: '受疗降低',
  hard_control: '行动封锁', stun: '眩晕', sleep: '沉眠', petrify: '石化', silence: '沉默',
  taunt: '嘲讽', wet: '湿润', fear: '恐惧', curse: '蚀魂', abyss: '深渊侵蚀',
  shock: '感电', wind_dot: '风蚀', evasion_up: '闪避提高', evasion_down: '闪避降低',
  counter_preparation: '反击准备', hunt_mark: '猎痕', gaze_mark: '凝视', black_tide_mark: '黑潮印记',
};
const percentageStatuses = new Set([
  'attack_up','defense_up','speed_up','speed_down','armor_break','direct_damage_up','damage_up',
  'direct_damage_reduction','healing_down','healing_received_down','weak','fear','vulnerable',
  'evasion_up','evasion_down','hunt_mark','gaze_mark','black_tide_mark',
]);
const flags = new Set(['freeze','stun','sleep','petrify','hard_control','taunt','silence','wet','counter_preparation']);

/** Read the native records so legacy display projections never become combat inputs. */
export function nativeStatusEntries(actor: NativeActor, kind: 'buff' | 'debuff'): StatusDisplayEntry[] {
  const records = kind === 'buff' ? actor.buffs : [...actor.debuffs, ...actor.dots];
  const entries: StatusDisplayEntry[] = [];
  for (const [index, record] of records.entries()) {
    if (record.ruleHidden) continue;
    const name = record.canonicalStatus ?? record.status ?? '';
    const rawTurns = record.remaining ?? Math.max(1, (record.expireAtPhase ?? actor.phaseCount + 1) - actor.phaseCount);
    const turns = Number.isFinite(rawTurns) ? rawTurns : -1;
    if (name === 'swift') {
      const previous = entries.find(e => e.name === 'swift');
      if (previous) { previous.effect.stacks = (previous.effect.stacks ?? 1) + 1; previous.effect.turns = Math.max(previous.effect.turns, turns); continue; }
    }
    const dot = record.snapshotDamage !== undefined;
    const percent = !dot && !record.speedFlat && (record.valueUnit === 'ratio' || record.valueUnit === 'percent' || percentageStatuses.has(name));
    let value = record.snapshotDamage ?? record.value ?? 1;
    if (percent && record.valueUnit !== 'percent' && (record.valueUnit === 'ratio' || Math.abs(value) <= 1)) value *= 100;
    entries.push({key:`${name}:${index}`,name,effect:{
      value,turns,charges:record.charges,stacks:name==='swift'?1:undefined,
      ruleLabel:record.ruleLabel,ruleData:record.ruleData,
      displayUnit:percent?'percent':flags.has(name)||record.valueUnit==='count'?'count':'flat',dot,
    }});
  }
  return entries;
}

export function statusValueText(name: string, effect: StatusDisplayEffect): string {
  if (flags.has(name)) return '';
  if (effect.dot) return `每次结算基础伤害 ${formatNumber(effect.value)} 点`;
  const unit = effect.displayUnit ?? (percentageStatuses.has(name) ? 'percent' : 'flat');
  return `${unit==='count'?'层数':'数值'} ${formatNumber(effect.value)}${unit==='percent'?'%':unit==='flat'?' 点':''}`;
}
