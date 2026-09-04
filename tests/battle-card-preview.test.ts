import { describe, expect, it } from 'vitest';
import { previewBattleCard } from '@/battle/card-preview';
import { cardNameHistoryKey } from '@/battle/card-history';
import { MAX_CARD_EFFECT_HITS } from '@/battle/execution-limits';
import type { CardDefinition } from '@/content/types';
import type {
  BattleCompanionState,
  BattleEnemyState,
  BattlePlayerState,
  LocalBattleState,
} from '@/domain/types';
import { MAGICIAN_BLANK_CARD_ID } from '@/content/catalogs/magician';

function player(overrides: Partial<BattlePlayerState> = {}): BattlePlayerState {
  return {
    name: '预览玩家',
    subclass: 'holy_knight',
    hp: 80,
    hpMax: 80,
    mp: 30,
    mpMax: 30,
    shield: 0,
    attack: 20,
    defense: 5,
    speed: 5,
    ap: 5,
    apMax: 5,
    initialDraw: 5,
    drawPerTurn: 3,
    handLimit: 10,
    drawPile: [],
    discardPile: [],
    hand: [{ instanceId: 'preview:card', cardId: 'preview-card' }],
    buffs: {},
    debuffs: {},
    summons: [],
    chants: [],
    passiveEffects: [],
    classResources: {},
    ...overrides,
  };
}

function enemy(overrides: Partial<BattleEnemyState> = {}): BattleEnemyState {
  return {
    id: 'preview-enemy',
    definitionId: 'preview-enemy',
    name: '预览木桩',
    hp: 100,
    hpMax: 100,
    shield: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    difficulty: 'normal',
    tags: [],
    xp: 0,
    gold: [0, 0],
    loot: [],
    buffs: {},
    debuffs: {},
    intent: null,
    ...overrides,
  };
}

function companion(
  overrides: Partial<BattleCompanionState> = {},
): BattleCompanionState {
  return {
    id: 'caelian',
    name: '凯利安',
    profession: '圣辉龙骑',
    level: 1,
    hp: 60,
    hpMax: 80,
    shield: 0,
    attack: 10,
    defense: 5,
    speed: 5,
    buffs: {},
    debuffs: {},
    injured: false,
    actionSequence: [],
    actionIndex: 0,
    summons: [],
    ...overrides,
  };
}

function state(
  playerState: BattlePlayerState,
  companionState?: BattleCompanionState,
): LocalBattleState {
  return {
    schemaVersion: 1,
    status: 'ongoing',
    phase: 'player',
    turn: 1,
    selectedTarget: 0,
    player: playerState,
    ...(companionState ? { companion: companionState } : {}),
    enemies: [enemy()],
    rewards: null,
    log: [],
    animations: [],
  };
}

describe('战斗卡牌预览', () => {
  it('把异常多段数限制在同步执行安全边界内', () => {
    const current = state(player());
    current.enemies = [enemy({ hp: 1_000, hpMax: 1_000 })];
    const card: CardDefinition = {
      name: '多段执行边界',
      type: 'skill',
      cost: 0,
      rarity: 'common',
      description: '',
      effects: [
        { type: 'damage', value: 1, hits: 999_999, target: 'enemy' },
      ],
    };

    expect(previewBattleCard(current, card, 0).enemyDamage[0]).toBe(
      MAX_CARD_EFFECT_HITS,
    );
  });

  it('把攻击力乘区计入点击或拖动时显示的预计伤害', () => {
    const card: CardDefinition = {
      name: '预览斩击',
      type: 'attack',
      cost: 1,
      rarity: 'common',
      description: '',
      effects: [{ type: 'damage', value: 8, target: 'enemy' }],
    };

    expect(previewBattleCard(state(player()), card, 0).enemyDamage[0]).toBe(15);
  });

  it('同时预览牧师溢出伤害、目标治疗与实际可恢复魔力', () => {
    const priest = player({
      subclass: 'priest',
      hp: 70,
      mp: 27,
    });
    const current = state(priest, companion());
    const heal: CardDefinition = {
      name: '治疗术',
      type: 'skill',
      cost: 1,
      rarity: 'common',
      description: '',
      effects: [{ type: 'heal', value: 14, target: 'self' }],
    };
    const mana: CardDefinition = {
      name: '魔力泉',
      type: 'skill',
      cost: 1,
      rarity: 'common',
      description: '',
      effects: [{ type: 'gain_mp', value: 5 }],
    };

    const selfPreview = previewBattleCard(current, heal, 0, 'player');
    expect(selfPreview).toMatchObject({
      enemyDamage: [4],
      playerHp: 10,
      companionHp: 0,
    });

    const companionPreview = previewBattleCard(current, heal, 0, 'caelian');
    expect(companionPreview).toMatchObject({
      enemyDamage: [0],
      playerHp: 0,
      companionHp: 14,
    });
    expect(previewBattleCard(current, mana, 0).playerMp).toBe(3);
  });

  it('分别预览魔术师非空白牌终结和空白牌揭晓伤害', () => {
    const current = state(
      player({
        subclass: 'magician',
        hand: [
          { instanceId: 'finisher', cardId: 'mg_flying_cards' },
          { instanceId: 'normal:1', cardId: 'mg_quick_cut' },
          { instanceId: 'normal:2', cardId: 'mg_card_knife' },
          { instanceId: 'normal:3', cardId: 'mg_chain_cards' },
          { instanceId: 'blank:1', cardId: MAGICIAN_BLANK_CARD_ID },
          { instanceId: 'blank:2', cardId: MAGICIAN_BLANK_CARD_ID },
        ],
      }),
    );
    const flyingCards: CardDefinition = {
      name: '漫天飞牌',
      type: 'skill',
      cost: 2,
      rarity: 'common',
      description: '',
      effects: [{ type: 'discard_all_damage', value: 4, target: 'enemy' }],
    };
    const truthRevealed: CardDefinition = {
      name: '真相揭晓',
      type: 'skill',
      cost: 4,
      rarity: 'rare',
      description: '',
      effects: [{ type: 'discard_blank_damage', value: 12, target: 'enemy' }],
    };

    expect(previewBattleCard(current, flyingCards, 0).enemyDamage[0]).toBe(12);
    expect(previewBattleCard(current, truthRevealed, 0).enemyDamage[0]).toBe(24);
  });

  it('把卡牌魔力消耗、自伤和回复合并为血条内的净变化', () => {
    const current = state(player({ hp: 50, hpMax: 80, mp: 30, mpMax: 30 }));
    const card: CardDefinition = {
      name: '代价预览',
      type: 'spell',
      cost: 1,
      mpCost: 5,
      rarity: 'common',
      description: '',
      effects: [
        { type: 'self_damage', value: 8 },
        { type: 'gain_mp', value: 3 },
      ],
    };

    expect(previewBattleCard(current, card, 0)).toMatchObject({
      playerHp: 0,
      playerHpCost: 8,
      playerMp: 3,
      playerMpCost: 5,
    });
  });

  it('预览会采用下一张法术减费与法术、治疗增幅的实际数值', () => {
    const current = state(
      player({
        hp: 50,
        mp: 10,
        buffs: {
          next_spell_mp_reduce: { value: 2, turns: 1, charges: 1 },
          spell_amp_percent: { value: 20, turns: 1, charges: 1 },
          healing_amp_percent: { value: 35, turns: 1 },
        },
      }),
    );
    const card: CardDefinition = {
      name: '增幅治疗预览',
      type: 'spell',
      cost: 1,
      mpCost: 5,
      rarity: 'common',
      description: '',
      effects: [{ type: 'heal', value: 10, target: 'self' }],
    };

    expect(previewBattleCard(current, card, 0)).toMatchObject({
      playerHp: 17,
      playerMpCost: 3,
    });
  });

  it('范围预览会按每个目标分别计算克制标签增伤', () => {
    const current = state(
      player({
        attack: 0,
        buffs: {
          undead_damage_bonus: { value: 6, turns: 2 },
        },
      }),
    );
    current.enemies = [
      enemy({ id: 'undead', tags: ['undead'] }),
      enemy({ id: 'living', tags: [] }),
    ];
    const card: CardDefinition = {
      name: '范围克制预览',
      type: 'attack',
      cost: 1,
      rarity: 'common',
      description: '',
      effects: [{ type: 'damage', value: 6, target: 'all_enemies' }],
    };

    expect(previewBattleCard(current, card, 0).enemyDamage).toEqual([12, 6]);
  });

  it('支持指定 debuff 条件，并按目标 buff 独立层数计算伤害', () => {
    const current = state(
      player({
        attack: 0,
        buffs: {
          regen: { value: 3, turns: 1 },
          next_spell_mp_reduce: { value: 2, turns: 1 },
        },
      }),
    );
    current.enemies[0] = enemy({
      buffs: {
        regen: {
          value: 5,
          turns: 2,
          stacks: 2,
          instances: [
            { value: 2, turns: 1 },
            { value: 3, turns: 2 },
          ],
        },
      },
      debuffs: { weak: { value: 0, turns: 1 } },
    });
    const card: CardDefinition = {
      name: '绞杀计数预览',
      type: 'spell',
      cost: 1,
      rarity: 'common',
      description: '',
      effects: [
        {
          type: 'conditional_bonus',
          condition: 'enemy_has_any_specific_debuff',
          debuffs: ['freeze', 'weak'],
          bonus: 8,
        },
        { type: 'damage', value: 10, target: 'enemy' },
        { type: 'damage_per_buff', value: 3, target: 'enemy' },
      ],
    };

    expect(previewBattleCard(current, card, 0).enemyDamage[0]).toBe(24);
  });

  it('爆燃预览按 debuff 聚合值乘以倍率，而不是固定伤害', () => {
    const current = state(player({ attack: 0 }));
    current.enemies[0] = enemy({
      debuffs: {
        burn: {
          value: 5,
          turns: 2,
          stacks: 2,
          instances: [
            { value: 2, turns: 1 },
            { value: 3, turns: 2 },
          ],
        },
      },
    });
    const card: CardDefinition = {
      id: 'fm_burnout',
      name: '爆燃',
      type: 'spell',
      cost: 2,
      rarity: 'rare',
      description: '',
      effects: [
        {
          type: 'consume_debuff_damage',
          debuff: 'burn',
          value: 4,
          target: 'enemy',
        },
      ],
    };

    expect(previewBattleCard(current, card, 0).enemyDamage[0]).toBe(20);
  });

  it('每个减益伤害预览计入攻击力与深渊回声', () => {
    const current = state(
      player({
        subclass: 'dark_mage',
        attack: 20,
        abyssEcho: 3,
        classResources: { abyss_echo: 3 },
        abyssEchoBatches: [{ turn: 1, value: 3 }],
      }),
    );
    current.enemies[0] = enemy({
      debuffs: {
        weak: { value: 1, turns: 2 },
        poison: { value: 2, turns: 2 },
      },
    });
    const card: CardDefinition = {
      name: '恶意爆破',
      type: 'spell',
      cls: 'dark_mage',
      cost: 2,
      rarity: 'rare',
      description: '',
      effects: [{ type: 'damage_per_debuff', value: 7, target: 'enemy' }],
    };

    expect(previewBattleCard(current, card, 0).enemyDamage[0]).toBe(26);
  });

  it('递归预览条件效果，并识别无护盾与本回合同名卡', () => {
    const nested: CardDefinition = {
      name: '条件攻击',
      type: 'spell',
      cost: 1,
      rarity: 'common',
      description: '',
      effects: [
        {
          type: 'conditional_group',
          conditions: [{ type: 'no_shield' }],
          then_effects: [{ type: 'damage', value: 9, target: 'enemy' }],
          else_effects: [{ type: 'damage', value: 3, target: 'enemy' }],
        },
      ],
    };
    expect(
      previewBattleCard(state(player({ attack: 0 })), nested, 0)
        .enemyDamage[0],
    ).toBe(9);

    const repeated: CardDefinition = {
      id: 'wmst_quick_slash',
      name: '快速斩',
      type: 'attack',
      cost: 1,
      rarity: 'common',
      description: '',
      effects: [
        { type: 'damage', value: 6, target: 'enemy' },
        {
          type: 'conditional_bonus',
          condition: 'same_card_played_this_turn',
          bonus: 2,
        },
      ],
    };
    const weaponMaster = state(
      player({
        subclass: 'weapon_master',
        attack: 0,
        cardsPlayedThisTurn: { wmst_quick_slash: 1 },
      }),
    );
    expect(previewBattleCard(weaponMaster, repeated, 0).enemyDamage[0]).toBe(10);
  });

  it('按显示名称预览本轮同名与上一张同名条件', () => {
    const repeatedByName: CardDefinition = {
      id: 'custom_echo_current',
      name: '回声斩',
      type: 'attack',
      cost: 1,
      rarity: 'common',
      description: '',
      effects: [
        {
          type: 'conditional_group',
          logic: 'and',
          conditions: [
            { type: 'same_card_played_this_turn' },
            { type: 'previous_card_same_name' },
          ],
          then_effects: [{ type: 'damage', value: 9, target: 'enemy' }],
          else_effects: [{ type: 'damage', value: 2, target: 'enemy' }],
        },
      ],
    };
    const history = state(
      player({
        attack: 0,
        cardsPlayedThisTurn: { custom_echo_other: 1 },
        cardNamesPlayedThisTurn: { [cardNameHistoryKey('回声斩')]: 1 },
        lastCardId: 'custom_echo_other',
        lastCardName: '回声斩',
      }),
    );
    expect(previewBattleCard(history, repeatedByName, 0).enemyDamage[0]).toBe(9);

    history.player.lastCardName = '佯攻';
    expect(previewBattleCard(history, repeatedByName, 0).enemyDamage[0]).toBe(2);

    const sameNameOnly: CardDefinition = {
      ...repeatedByName,
      id: 'custom_echo_same_only',
      effects: [
        {
          type: 'conditional_group',
          conditions: [{ type: 'same_card_played_this_turn' }],
          then_effects: [{ type: 'damage', value: 5, target: 'enemy' }],
          else_effects: [{ type: 'damage', value: 1, target: 'enemy' }],
        },
      ],
    };
    expect(previewBattleCard(history, sameNameOnly, 0).enemyDamage[0]).toBe(5);

    const previousNameOnly: CardDefinition = {
      ...repeatedByName,
      id: 'custom_echo_previous_only',
      effects: [
        {
          type: 'conditional_group',
          conditions: [{ type: 'previous_card_same_name' }],
          then_effects: [{ type: 'damage', value: 7, target: 'enemy' }],
          else_effects: [{ type: 'damage', value: 2, target: 'enemy' }],
        },
      ],
    };
    expect(previewBattleCard(history, previousNameOnly, 0).enemyDamage[0]).toBe(2);
    history.player.lastCardName = '回声斩';
    expect(previewBattleCard(history, previousNameOnly, 0).enemyDamage[0]).toBe(7);
  });

  it('只把 type=spell 当作法术，不再被卡名或职业文字误判', () => {
    const current = state(
      player({
        attack: 0,
        mp: 10,
        buffs: {
          next_spell_mp_reduce: { value: 3, turns: 1, charges: 1 },
          spell_amp_percent: { value: 100, turns: 1, charges: 1 },
        },
      }),
    );
    const card: CardDefinition = {
      name: '奥术法师的魔力技巧',
      type: 'skill',
      cat: 'sub_arcane_mage',
      cost: 1,
      mpCost: 5,
      rarity: 'common',
      description: '使用魔术造成伤害',
      effects: [{ type: 'damage', value: 10, target: 'enemy' }],
    };

    expect(previewBattleCard(current, card, 0)).toMatchObject({
      enemyDamage: [10],
      playerMpCost: 5,
    });
  });

  it('同步职业资源与特殊伤害分支', () => {
    const cases: Array<{
      current: LocalBattleState;
      card: CardDefinition;
      expected: number;
    }> = [
      {
        current: state(
          player({
            subclass: 'dark_mage',
            attack: 0,
            abyssEcho: 99,
            classResources: { abyss_echo: 99 },
            abyssEchoBatches: [
              { turn: 1, value: 3 },
              { turn: -2, value: 50 },
            ],
          }),
        ),
        card: {
          name: '深渊法术',
          type: 'spell',
          cls: 'dark_mage',
          cost: 1,
          rarity: 'common',
          description: '',
          effects: [{ type: 'damage', value: 4, target: 'enemy' }],
        },
        expected: 10,
      },
      {
        current: state(
          player({
            subclass: 'dragon_knight',
            attack: 0,
            classResources: { dragon_soul: 3 },
          }),
        ),
        card: {
          name: '龙枪',
          type: 'attack',
          cost: 1,
          rarity: 'common',
          description: '',
          effects: [{ type: 'damage', value: 4, target: 'enemy' }],
        },
        expected: 10,
      },
      {
        current: state(
          player({
            subclass: 'blacksmith',
            attack: 0,
            classResources: { furnace_heat: 2 },
          }),
        ),
        card: {
          name: '炉火斩',
          type: 'attack',
          cost: 1,
          rarity: 'common',
          description: '',
          effects: [{ type: 'damage', value: 4, target: 'enemy' }],
        },
        expected: 8,
      },
      {
        current: state(
          player({
            subclass: 'wind_mage',
            attack: 0,
            classResources: { wind_mark: 2 },
          }),
        ),
        card: {
          name: '风压刃',
          type: 'spell',
          cost: 1,
          rarity: 'common',
          description: '消耗风痕增伤',
          effects: [{ type: 'damage', value: 4, target: 'enemy' }],
        },
        expected: 10,
      },
      {
        current: state(
          player({
            subclass: 'thunder_mage',
            attack: 0,
            classResources: { thunder_charge: 2 },
          }),
        ),
        card: {
          name: '雷荷引爆',
          type: 'spell',
          cost: 1,
          rarity: 'common',
          description: '消耗全部雷荷充能，每层 +3 伤害',
          effects: [{ type: 'damage', value: 4, target: 'enemy' }],
        },
        expected: 10,
      },
      {
        current: state(
          player({
            subclass: 'dark_priest',
            attack: 0,
            sanity: 60,
          }),
        ),
        card: {
          name: '低理智一击',
          type: 'attack',
          cost: 1,
          rarity: 'common',
          description: '',
          effects: [{ type: 'damage', value: 10, target: 'enemy' }],
        },
        expected: 12,
      },
    ];

    for (const entry of cases) {
      expect(previewBattleCard(entry.current, entry.card, 0).enemyDamage[0]).toBe(
        entry.expected,
      );
    }
  });

  it('伤害自带的吸血按怪物实际掉血预览回复量', () => {
    const current = state(player({ hp: 50, hpMax: 80, attack: 0 }));
    current.enemies[0] = enemy({ shield: 6 });
    const card: CardDefinition = {
      name: '血诗篇',
      type: 'attack',
      cost: 2,
      rarity: 'rare',
      description: '',
      effects: [
        {
          type: 'damage',
          value: 14,
          target: 'enemy',
          lifesteal_ratio: 0.3,
        },
      ],
    };

    expect(previewBattleCard(current, card, 0)).toMatchObject({
      enemyDamage: [14],
      playerHp: 2,
    });
  });

  it('面板与外部来源的总吸血按破盾后实际掉血进入预览', () => {
    const current = state(
      player({ hp: 50, hpMax: 80, attack: 0, lifesteal: 55 }),
    );
    current.enemies[0] = enemy({ shield: 6 });
    const card: CardDefinition = {
      name: '吸血试斩',
      type: 'attack',
      cost: 1,
      rarity: 'common',
      description: '',
      effects: [{ type: 'damage', value: 14, target: 'enemy' }],
    };

    expect(previewBattleCard(current, card, 0)).toMatchObject({
      enemyDamage: [14],
      playerHp: 4,
    });
  });

  it('依赖敌方护盾的后续伤害按前序伤害后的剩余护盾预览', () => {
    const current = state(player({ attack: 0 }));
    current.enemies[0] = enemy({ shield: 20 });
    const card: CardDefinition = {
      name: '破盾连段',
      type: 'attack',
      cost: 1,
      rarity: 'common',
      description: '',
      effects: [
        { type: 'damage', value: 12, target: 'enemy' },
        { type: 'damage_from_enemy_shield', ratio: 0.5, target: 'enemy' },
      ],
    };

    expect(previewBattleCard(current, card, 0).enemyDamage[0]).toBe(16);
  });

  it('机械召唤物以 mechanical 字段识别，并按 enemy_target 预览范围', () => {
    const current = state(player({ attack: 0 }));
    current.enemies = [enemy({ id: 'first' }), enemy({ id: 'second' })];
    current.player.summons = [
      {
        id: 'fake-cannon',
        name: '看起来像机械炮台',
        duration: 2,
        hp: null,
        mechanical: false,
        skills: [],
      },
      {
        id: 'real-mech',
        name: '助手',
        duration: 2,
        hp: null,
        mechanical: true,
        skills: [],
      },
    ];
    const card: CardDefinition = {
      name: '最终协议',
      type: 'skill',
      cost: 3,
      rarity: 'legendary',
      description: '',
      effects: [
        {
          type: 'destroy_summon_damage_per',
          amount: 'all',
          value: 8,
          mechanicalOnly: true,
          enemy_target: 'all_enemies',
        },
      ],
    };

    expect(previewBattleCard(current, card, 0).enemyDamage).toEqual([8, 8]);
  });

  it('预览特殊回魔资源值与随机目标', () => {
    const current = state(
      player({
        subclass: 'dark_mage',
        mp: 5,
        mpMax: 30,
        abyssEchoBatches: [{ turn: 1, value: 3 }],
        summons: [
          {
            id: 'summon',
            name: '召唤物',
            duration: 2,
            hp: 10,
            hpMax: 20,
            skills: [],
          },
        ],
      }),
    );
    current.enemies = [enemy({ id: 'first' }), enemy({ id: 'second' })];
    const echoReturn: CardDefinition = {
      name: '回声返还',
      type: 'skill',
      cost: 0,
      rarity: 'common',
      description: '',
      effects: [{ type: 'restore_mp_per_abyss_echo', value: 1 }],
    };
    const recall: CardDefinition = {
      name: '召回',
      type: 'skill',
      cost: 0,
      rarity: 'common',
      description: '',
      effects: [{ type: 'recall_summon_mp', amount: 1, max: 5 }],
    };
    const random: CardDefinition = {
      name: '随机雷击',
      type: 'spell',
      cost: 1,
      rarity: 'common',
      description: '',
      effects: [{ type: 'damage', value: 5, target: 'random_enemy' }],
    };

    expect(previewBattleCard(current, echoReturn, 0).playerMp).toBe(3);
    expect(previewBattleCard(current, recall, 0).playerMp).toBe(4);
    expect(previewBattleCard(current, random, 1).enemyDamage).toEqual([0, 5]);
  });
});
