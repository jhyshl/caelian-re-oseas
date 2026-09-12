export interface WorkshopStatusOption {
  id: string;
  name: string;
  polarity: 'buff' | 'debuff';
  kind: 'buff' | 'debuff' | 'dot';
  value: number;
  unit: 'count' | 'percent' | 'ratio';
  template?: Record<string, unknown>;
}

function effect(
  id: string,
  name: string,
  kind: WorkshopStatusOption['kind'],
  value = 1,
  unit: WorkshopStatusOption['unit'] = 'count',
  template?: WorkshopStatusOption['template'],
): WorkshopStatusOption {
  return { id, name, kind, polarity: kind === 'buff' ? 'buff' : 'debuff', value, unit, ...(template ? { template } : {}) };
}

// Only standalone effects implemented by physics.mjs or nativeEvent belong here.
// Catalogs and display-name maps also contain resource counters and phase flags.
export const WORKSHOP_STATUS_LIBRARY: readonly WorkshopStatusOption[] = [
  effect('strength', '攻击力增加（固定值）', 'buff'),
  effect('fortitude', '防御增加（固定值）', 'buff'),
  effect('attack_up', '攻击力提高', 'buff', .2, 'ratio'),
  effect('defense_up', '防御提高', 'buff', .2, 'ratio'),
  effect('speed_up', '速度提高', 'buff', .2, 'ratio'),
  effect('speed_flat', '速度增加（固定值）', 'buff', 1, 'count', { canonicalStatus: 'speed_up', speedFlat: true }),
  effect('crit_up', '暴击率增加（百分点）', 'buff', 10),
  effect('crit_damage_up', '暴击伤害增加（百分点）', 'buff', 25),
  effect('swift', '迅捷', 'buff'),
  effect('效果抵抗增加', '效果抵抗提高', 'buff', .2, 'ratio'),
  effect('evasion_up', '闪避提高', 'buff', .1, 'ratio'),
  effect('direct_damage_up', '直接伤害提高', 'buff', .2, 'ratio'),
  effect('direct_damage_reduction', '坚韧：直接减伤', 'buff', .15, 'ratio'),
  effect('治疗量增加', '治疗量提高', 'buff', .2, 'ratio'),
  effect('治疗与护盾提高%', '治疗与护盾提高', 'buff', .2, 'ratio'),
  effect('taunt', '嘲讽', 'buff'),
  effect('death_save', '抵挡致命伤并保留1生命', 'buff', 1, 'count', { canonicalStatus: '濒死保留1HP', charges: 1 }),
  effect('regen', '生命再生', 'buff'),
  effect('heal_regen', '回合恢复生命', 'buff'),
  effect('shield_regen', '回合获得护盾', 'buff'),
  effect('ap_regen', '回合恢复AP', 'buff'),
  effect('draw_regen', '回合抽牌', 'buff'),
  effect('mp_regen', '回合恢复魔力', 'buff'),
  effect('thorns', '反伤', 'buff'),
  effect('defense_reflect', '防御反震', 'buff'),
  effect('counterattack', '反击', 'buff'),
  effect('on_hit_draw', '受击抽牌', 'buff'),
  effect('weak', '虚弱：直接伤害降低', 'debuff', .2, 'ratio'),
  effect('fear', '恐惧：直接伤害降低', 'debuff', .2, 'ratio'),
  effect('vulnerable', '易伤', 'debuff', .15, 'ratio'),
  effect('armor_break', '防御降低', 'debuff', .2, 'ratio'),
  effect('speed_down', '速度降低', 'debuff', .2, 'ratio'),
  effect('evasion_down', '闪避降低', 'debuff', .1, 'ratio'),
  effect('healing_down', '受到治疗降低', 'debuff', .2, 'ratio'),
  effect('freeze', '冻结：跳过下一次行动', 'debuff'),
  effect('petrify', '石化：跳过下一次行动', 'debuff'),
  effect('stun', '眩晕：跳过下一次行动', 'debuff'),
  effect('sleep', '沉眠：跳过行动，受击解除', 'debuff'),
  effect('hard_control', '跳过下一次行动', 'debuff'),
  effect('burn', '灼烧', 'dot', .35, 'ratio'),
  effect('poison', '中毒', 'dot', .35, 'ratio'),
  effect('bleed', '流血', 'dot', .35, 'ratio'),
  effect('corrosion', '腐蚀', 'dot', .35, 'ratio'),
  effect('curse', '诅咒伤害', 'dot', .35, 'ratio'),
].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

const entries = new Map(WORKSHOP_STATUS_LIBRARY.map(entry => [entry.id, entry]));

export function workshopBuiltinStatus(id: string): WorkshopStatusOption | undefined {
  return entries.get(id);
}

export function workshopTurns(value: unknown, fallback = 1): number {
  const n = Number(value ?? fallback);
  if (!Number.isSafeInteger(n) || (n !== -1 && n < 1)) throw Error('持续回合请填写正整数，或 -1 表示整场战斗');
  return n;
}

export function workshopMaxStacks(value: unknown, fallback = 3): number {
  const n = Number(value ?? fallback);
  if (!Number.isSafeInteger(n) || n < 0) throw Error('可叠加上限请填写非负整数，0 表示不设上限');
  return n;
}

export function workshopStatusInput(id: string, unit?: WorkshopStatusOption['unit']): { label: string; hint: string } {
  const def = workshopBuiltinStatus(id), resolved = unit ?? def?.unit;
  if (def?.kind === 'dot') return {
    label: resolved === 'percent' ? '每跳攻击百分数（35 = 35%）' : '每跳攻击倍率（0.35 = 35%）',
    hint: `每层每跳伤害 = 施加时攻击力 × ${resolved === 'percent' ? '百分数 ÷ 100' : '倍率'}。攻击力 100 时，填写 ${resolved === 'percent' ? '35' : '0.35'} 得到每跳 35 点基础伤害；还会计算目标防御和护盾，DOT 不暴击。公式结果也按此单位解释。`,
  };
  if (resolved === 'ratio') return { label: '效果倍率（0.2 = 20%）', hint: '填写小数倍率：0.2 表示 20%，1 表示 100%。使用公式时，公式结果也是倍率。' };
  if (resolved === 'percent') return { label: '效果百分数（20 = 20%）', hint: '填写百分数：20 表示 20%，无需写成 0.2。' };
  if (['crit_up', 'crit_damage_up'].includes(id)) return { label: '增加百分点（10 = 10 个百分点）', hint: '填写增加的百分点，例如原本 20%，增加 10 个百分点后为 30%。' };
  return { label: '数值', hint: '' };
}

export const WORKSHOP_DOT_STACK_HINT = '每次施加 1 层，回合内施加次数不限。上限针对目标身上的同类工坊 DOT；0 为不设上限。满层时保留每跳伤害较高的层，同伤害时优先保留剩余回合较长的层。';
