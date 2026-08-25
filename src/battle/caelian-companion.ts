import type {
  BattleCompanionSkillState,
  BattleCompanionState,
} from '@/domain/types';

export const CAELIAN_SKILLS: readonly BattleCompanionSkillState[] = [
  {
    id: 'radiant_lance',
    name: '辉光龙枪',
    apCost: 2,
    description: '以圣辉龙枪攻击当前敌人。',
  },
  {
    id: 'aegis_procession',
    name: '圣行壁垒',
    apCost: 2,
    description: '为玩家与凯利安提供护盾。',
  },
  {
    id: 'dawn_mend',
    name: '破晓疗愈',
    apCost: 3,
    description: '治疗当前生命比例最低的可治疗友方。',
  },
  {
    id: 'trelio_convergence',
    name: '特莱奥·圣龙合击',
    apCost: 3,
    description: '凯利安与特莱奥依次攻击当前敌人。',
  },
  {
    id: 'purifying_standard',
    name: '净辉战旗',
    apCost: 2,
    description: '净化玩家与未重伤的凯利安，并短暂强化防御。',
  },
  {
    id: 'sunlit_judgement',
    name: '曜光裁决',
    apCost: 4,
    description: '对全部敌人造成光明伤害。',
  },
] as const;

export function createCaelianCompanion(
  playerLevel: number,
  random: () => number,
  playerLifesteal = 0,
): BattleCompanionState {
  const level = Math.max(1, Math.floor(playerLevel));
  const inheritedLifesteal =
    Math.max(0, Math.min(30, Number(playerLifesteal) || 0)) * 0.8;
  const sequence = [...CAELIAN_SKILLS];
  for (let index = sequence.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [sequence[index], sequence[swap]] = [sequence[swap]!, sequence[index]!];
  }
  const hpMax = 70 + level * 12;
  const trelioHpMax = 82 + level * 14;
  return {
    id: 'caelian',
    name: '凯利安',
    profession: '圣辉龙骑',
    level,
    hp: hpMax,
    hpMax,
    shield: 0,
    attack: 8 + level * 3,
    defense: 6 + level * 2,
    speed: 7 + Math.floor(level * 1.5),
    lifesteal: inheritedLifesteal,
    buffs: {},
    debuffs: {},
    injured: false,
    actionSequence: sequence,
    actionIndex: 0,
    summons: [
      {
        id: 'trelio',
        name: '特莱奥',
        hp: trelioHpMax,
        hpMax: trelioHpMax,
        shield: 0,
        attack: 10 + Math.floor(level * 3.4),
        defense: 8 + Math.floor(level * 2.5),
        speed: 6 + Math.floor(level * 1.2),
        lifesteal: inheritedLifesteal,
        buffs: {},
        debuffs: {},
      },
    ],
  };
}
