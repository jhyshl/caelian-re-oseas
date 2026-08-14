import { describe, expect, it } from 'vitest';
import { previewBattleCard } from '@/battle/card-preview';
import type { CardDefinition } from '@/content/types';
import type {
  BattleCompanionState,
  BattleEnemyState,
  BattlePlayerState,
  LocalBattleState,
} from '@/domain/types';

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
});
