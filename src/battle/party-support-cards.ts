import type { CardDefinition, CardEffect } from '@/content/types';

type PartyCardSpec = {
  name: string;
  description: string;
  effects: CardEffect[];
};

const SPECS: Record<string, PartyCardSpec> = {
  holy_knight: { name: '圣辉同袍誓', description: '我方全体获得10护盾并净化1个负面状态。', effects: [{ type: 'shield', value: 10, target: 'all_allies' }, { type: 'cleanse', amount: 1, target: 'all_allies' }] },
  shadow_knight: { name: '影幕掩护', description: '我方全体获得6护盾与1层敏捷。', effects: [{ type: 'shield', value: 6, target: 'all_allies' }, { type: 'apply_buff', buff: 'agility', value: 1, turns: 1, target: 'all_allies' }] },
  dragon_knight: { name: '龙鳞并肩', description: '我方全体获得12护盾与1层坚韧。', effects: [{ type: 'shield', value: 12, target: 'all_allies' }, { type: 'apply_buff', buff: 'fortitude', value: 1, turns: 1, target: 'all_allies' }] },
  elementalist: { name: '四象守环', description: '我方全体获得8护盾与1层减伤。', effects: [{ type: 'shield', value: 8, target: 'all_allies' }, { type: 'apply_buff', buff: 'damage_reduce', value: 1, turns: 1, target: 'all_allies' }] },
  fire_mage: { name: '暖焰鼓舞', description: '我方全体回复8HP并获得1层力量。', effects: [{ type: 'heal', value: 8, target: 'all_allies' }, { type: 'apply_buff', buff: 'strength', value: 1, turns: 1, target: 'all_allies' }] },
  water_mage: { name: '清潮共沐', description: '我方全体回复10HP并净化1个负面状态。', effects: [{ type: 'heal', value: 10, target: 'all_allies' }, { type: 'cleanse', amount: 1, target: 'all_allies' }] },
  wind_mage: { name: '同行顺风', description: '我方全体获得1层敏捷，持续2回合。', effects: [{ type: 'apply_buff', buff: 'agility', value: 1, turns: 2, target: 'all_allies' }] },
  thunder_mage: { name: '雷域接地', description: '我方全体获得10护盾并净化1个负面状态。', effects: [{ type: 'shield', value: 10, target: 'all_allies' }, { type: 'cleanse', amount: 1, target: 'all_allies' }] },
  wood_mage: { name: '共生林息', description: '我方全体回复9HP并获得1层再生。', effects: [{ type: 'heal', value: 9, target: 'all_allies' }, { type: 'apply_buff', buff: 'regen', value: 1, turns: 2, target: 'all_allies' }] },
  light_mage: { name: '双辉祝祷', description: '我方全体回复8HP并获得10护盾。', effects: [{ type: 'heal', value: 8, target: 'all_allies' }, { type: 'shield', value: 10, target: 'all_allies' }] },
  dark_mage: { name: '暗幕庇佑', description: '我方全体获得10护盾与1层敏捷。', effects: [{ type: 'shield', value: 10, target: 'all_allies' }, { type: 'apply_buff', buff: 'agility', value: 1, turns: 1, target: 'all_allies' }] },
  arcane_mage: { name: '奥术共振障壁', description: '我方全体获得12护盾与1层减伤。', effects: [{ type: 'shield', value: 12, target: 'all_allies' }, { type: 'apply_buff', buff: 'damage_reduce', value: 1, turns: 1, target: 'all_allies' }] },
  summoner: { name: '灵契护阵', description: '我方全体获得8护盾与1层再生。', effects: [{ type: 'shield', value: 8, target: 'all_allies' }, { type: 'apply_buff', buff: 'regen', value: 1, turns: 2, target: 'all_allies' }] },
  alchemist: { name: '群体振奋合剂', description: '我方全体回复10HP并获得1层力量。', effects: [{ type: 'heal', value: 10, target: 'all_allies' }, { type: 'apply_buff', buff: 'strength', value: 1, turns: 1, target: 'all_allies' }] },
  apothecary: { name: '广域净疗药雾', description: '我方全体回复9HP并净化1个负面状态。', effects: [{ type: 'heal', value: 9, target: 'all_allies' }, { type: 'cleanse', amount: 1, target: 'all_allies' }] },
  blacksmith: { name: '同袍覆甲', description: '我方全体获得12护盾与1层坚韧。', effects: [{ type: 'shield', value: 12, target: 'all_allies' }, { type: 'apply_buff', buff: 'fortitude', value: 1, turns: 1, target: 'all_allies' }] },
  mechanic: { name: '联防力场', description: '我方全体获得12护盾与1层敏捷。', effects: [{ type: 'shield', value: 12, target: 'all_allies' }, { type: 'apply_buff', buff: 'agility', value: 1, turns: 1, target: 'all_allies' }] },
  priest: { name: '同心祷愈', description: '我方全体回复9HP并净化1个负面状态。', effects: [{ type: 'heal', value: 9, target: 'all_allies' }, { type: 'cleanse', amount: 1, target: 'all_allies' }] },
  nun: { name: '静默圣幕', description: '我方全体获得10护盾与1层减伤。', effects: [{ type: 'shield', value: 10, target: 'all_allies' }, { type: 'apply_buff', buff: 'damage_reduce', value: 1, turns: 1, target: 'all_allies' }] },
  vampire_hunter: { name: '银誓掩护', description: '我方全体获得8护盾与1层力量。', effects: [{ type: 'shield', value: 8, target: 'all_allies' }, { type: 'apply_buff', buff: 'strength', value: 1, turns: 1, target: 'all_allies' }] },
  weapon_master: { name: '兵势连环', description: '我方全体获得10护盾与1层坚韧。', effects: [{ type: 'shield', value: 10, target: 'all_allies' }, { type: 'apply_buff', buff: 'fortitude', value: 1, turns: 1, target: 'all_allies' }] },
  astrologer: { name: '双星守望', description: '我方全体获得8护盾与1层敏捷，持续2回合。', effects: [{ type: 'shield', value: 8, target: 'all_allies' }, { type: 'apply_buff', buff: 'agility', value: 1, turns: 2, target: 'all_allies' }] },
  dark_priest: { name: '晦光共祷', description: '我方全体回复8HP并获得1层减伤。', effects: [{ type: 'heal', value: 8, target: 'all_allies' }, { type: 'apply_buff', buff: 'damage_reduce', value: 1, turns: 1, target: 'all_allies' }] },
  merchant: { name: '雇佣护卫阵', description: '我方全体获得8护盾与1层坚韧。', effects: [{ type: 'shield', value: 8, target: 'all_allies' }, { type: 'apply_buff', buff: 'fortitude', value: 1, turns: 1, target: 'all_allies' }] },
};

export const PARTY_SUPPORT_CARDS: Record<string, CardDefinition> = Object.fromEntries(
  Object.entries(SPECS).map(([subclass, spec]) => {
    const id = partySupportCardId(subclass);
    return [id, {
      id,
      name: spec.name,
      type: 'skill',
      cost: 2,
      rarity: 'common',
      cls: subclass,
      description: `AP 2｜${spec.description}`,
      brief: spec.description,
      effects: spec.effects,
      source: 'caelian_party_support',
    } satisfies CardDefinition];
  }),
);

export function partySupportCardId(subclass: string): string {
  return `party_support_${subclass}`;
}

export function hasPartySupportCard(subclass: string): boolean {
  return Object.hasOwn(SPECS, subclass);
}
