import type { CardDefinition, ProfessionTalent } from '@/content/types';

export const MAGICIAN_SUBCLASS_ID = 'magician';
export const MAGICIAN_PASSIVE_ID = 'pas_magician_showmanship';
export const MAGICIAN_BLANK_CARD_ID = 'mg_blank_card';
export const MAGICIAN_BLANK_LIMIT = 8;

export const MAGICIAN_CARD_IDS = [
  'mg_quick_cut',
  'mg_card_switch',
  'mg_false_shuffle',
  'mg_forced_draw',
  'mg_advance_notice',
  'mg_sleeve_cache',
  'mg_smoke_and_mirrors',
  'mg_hat_mechanism',
  'mg_inexhaustible_case',
  'mg_card_knife',
  'mg_chain_cards',
  'mg_flying_cards',
  'mg_truth_revealed',
] as const;

export const MAGICIAN_STARTER_DECK: string[] = [
  'mg_quick_cut',
  'mg_quick_cut',
  'mg_card_switch',
  'mg_false_shuffle',
  'mg_forced_draw',
  'mg_advance_notice',
  'mg_sleeve_cache',
  'mg_smoke_and_mirrors',
  'mg_hat_mechanism',
  'mg_inexhaustible_case',
  'mg_inexhaustible_case',
  'mg_card_knife',
  'mg_chain_cards',
  'mg_flying_cards',
  'mg_truth_revealed',
];

export const MAGICIAN_CARD_POOL: string[] = MAGICIAN_CARD_IDS.flatMap((id) => [
  id,
  id,
]);

const magicianCard = (
  id: string,
  definition: CardDefinition,
): CardDefinition => ({
  id,
  ...definition,
  cat: 'sub_magician',
  cls: MAGICIAN_SUBCLASS_ID,
  source: 'caelian_alpha_43',
});

export const MAGICIAN_CARDS: Record<string, CardDefinition> = {
  mg_quick_cut: magicianCard('mg_quick_cut', {
    name: '快速切牌',
    type: 'skill',
    cost: 1,
    rarity: 'common',
    description: 'AP 1｜抽 2 张牌。',
    brief: '抽 2 张牌。',
    effects: [{ type: 'draw', value: 2, target: 'self' }],
  }),
  mg_card_switch: magicianCard('mg_card_switch', {
    name: '换牌手法',
    type: 'skill',
    cost: 1,
    rarity: 'common',
    description: 'AP 1｜弃 1 张非空白牌，再抽 2 张牌。',
    brief: '弃 1 张非空白牌，再抽 2 张牌。',
    effects: [
      { type: 'discard', amount: 1, target: 'self' },
      { type: 'draw', value: 2, target: 'self' },
    ],
  }),
  mg_false_shuffle: magicianCard('mg_false_shuffle', {
    name: '假洗牌',
    type: 'skill',
    cost: 2,
    rarity: 'uncommon',
    description: 'AP 2｜弃 3 张非空白牌，再抽 4 张牌。',
    brief: '弃 3 张非空白牌，再抽 4 张牌。',
    effects: [
      { type: 'discard', amount: 3, target: 'self' },
      { type: 'draw', value: 4, target: 'self' },
    ],
  }),
  mg_forced_draw: magicianCard('mg_forced_draw', {
    name: '强制抽牌',
    type: 'skill',
    cost: 2,
    rarity: 'common',
    description: 'AP 2｜抽 3 张牌。',
    brief: '抽 3 张牌。',
    effects: [{ type: 'draw', value: 3, target: 'self' }],
  }),
  mg_advance_notice: magicianCard('mg_advance_notice', {
    name: '预告牌',
    type: 'skill',
    cost: 1,
    rarity: 'common',
    description: 'AP 1｜将 1 张空白牌洗入抽牌堆，再抽 1 张牌。',
    brief: '洗入 1 张空白牌，再抽 1 张牌。',
    effects: [
      { type: 'generate_blank_to_draw', value: 1, target: 'self' },
      { type: 'draw', value: 1, target: 'self' },
    ],
  }),
  mg_sleeve_cache: magicianCard('mg_sleeve_cache', {
    name: '袖中藏牌',
    type: 'skill',
    cost: 1,
    rarity: 'common',
    description: 'AP 1｜将 2 张空白牌洗入抽牌堆。',
    brief: '将 2 张空白牌洗入抽牌堆。',
    effects: [{ type: 'generate_blank_to_draw', value: 2, target: 'self' }],
  }),
  mg_smoke_and_mirrors: magicianCard('mg_smoke_and_mirrors', {
    name: '烟雾与镜子',
    type: 'defense',
    cost: 1,
    rarity: 'common',
    description: 'AP 1｜将 1 张空白牌洗入抽牌堆，获得 8 点护盾。',
    brief: '洗入 1 张空白牌，获得 8 点护盾。',
    effects: [
      { type: 'generate_blank_to_draw', value: 1, target: 'self' },
      { type: 'shield', value: 8, target: 'self' },
    ],
  }),
  mg_hat_mechanism: magicianCard('mg_hat_mechanism', {
    name: '帽中机关',
    type: 'defense',
    cost: 2,
    rarity: 'common',
    description: 'AP 2｜将 2 张空白牌洗入抽牌堆，获得 14 点护盾。',
    brief: '洗入 2 张空白牌，获得 14 点护盾。',
    effects: [
      { type: 'generate_blank_to_draw', value: 2, target: 'self' },
      { type: 'shield', value: 14, target: 'self' },
    ],
  }),
  mg_inexhaustible_case: magicianCard('mg_inexhaustible_case', {
    name: '不竭牌匣',
    type: 'skill',
    cost: 1,
    rarity: 'common',
    description:
      'AP 1｜之后 3 个玩家回合开始时，各将 1 张空白牌洗入抽牌堆。可叠加，每张牌匣独立生效。',
    brief: '之后 3 回合各洗入 1 张空白牌；可叠加。',
    effects: [{ type: 'blank_regen', value: 1, turns: 3, target: 'self' }],
  }),
  mg_card_knife: magicianCard('mg_card_knife', {
    name: '纸牌飞刀',
    type: 'attack',
    cost: 1,
    rarity: 'common',
    description: 'AP 1｜造成 5 点伤害，抽 1 张牌。',
    brief: '造成 5 点伤害，抽 1 张牌。',
    effects: [
      { type: 'damage', value: 5, target: 'enemy' },
      { type: 'draw', value: 1, target: 'self' },
    ],
  }),
  mg_chain_cards: magicianCard('mg_chain_cards', {
    name: '连环飞牌',
    type: 'attack',
    cost: 2,
    rarity: 'common',
    description: 'AP 2｜造成 10 点伤害，抽 2 张牌。',
    brief: '造成 10 点伤害，抽 2 张牌。',
    effects: [
      { type: 'damage', value: 10, target: 'enemy' },
      { type: 'draw', value: 2, target: 'self' },
    ],
  }),
  mg_flying_cards: magicianCard('mg_flying_cards', {
    name: '漫天飞牌',
    type: 'skill',
    cost: 2,
    rarity: 'common',
    description:
      'AP 2｜弃掉手中所有非空白牌；每实际弃 1 张，对一名敌人造成 4 点伤害。空白牌留在手中。',
    brief: '弃掉所有非空白牌，每张造成 4 点伤害。',
    effects: [{ type: 'discard_all_damage', value: 4, target: 'enemy' }],
  }),
  mg_truth_revealed: magicianCard('mg_truth_revealed', {
    name: '真相揭晓',
    type: 'skill',
    cost: 4,
    rarity: 'rare',
    description:
      'AP 4｜揭晓并移除手中所有空白牌；每移除 1 张，对一名敌人造成 12 点伤害。其他手牌不受影响。',
    brief: '移除所有空白牌，每张造成 12 点伤害。',
    effects: [{ type: 'discard_blank_damage', value: 12, target: 'enemy' }],
  }),
  [MAGICIAN_BLANK_CARD_ID]: magicianCard(MAGICIAN_BLANK_CARD_ID, {
    name: '空白牌',
    type: 'skill',
    cost: 0,
    rarity: 'common',
    description:
      '没有效果，无法打出，也不会被弃牌按钮或普通弃牌效果弃置；只有「真相揭晓」可以将其揭晓并移除。',
    brief: '无法打出或被普通弃置；只能由「真相揭晓」移除。',
    effects: [],
    unplayable: true,
    ephemeral: true,
    protectedFromDiscard: true,
    rewardable: false,
  }),
};

export const MAGICIAN_TALENT: ProfessionTalent = {
  title: '魔术师',
  playstyle:
    '快速抽牌、检索与换牌，把空白牌洗入抽牌堆，再用普通手牌或空白牌完成两种弃牌终结。',
  talent:
    '娴熟手法：每回合额外抽 1 张牌；手牌上限提高 5，最多持有 15 张手牌。空白牌最多同时存在 8 张。',
};

export const MAGICIAN_PASSIVE = {
  id: MAGICIAN_PASSIVE_ID,
  name: '娴熟手法',
  description:
    '每回合额外抽 1 张牌；手牌上限提高 5，最多持有 15 张手牌。',
  effect: {
    type: 'multi',
    effects: [
      { type: 'extra_draw', value: 1 },
      { type: 'hand_limit_bonus', value: 5 },
    ],
  },
};
