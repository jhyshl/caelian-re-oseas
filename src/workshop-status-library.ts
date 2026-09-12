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
