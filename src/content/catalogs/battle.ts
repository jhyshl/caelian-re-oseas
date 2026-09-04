import type { CardEffect } from '@/content/types';
import { readWorkshopPacks, workshopPassiveId } from '@/workshop';
import {
  MAGICIAN_PASSIVE,
  MAGICIAN_PASSIVE_ID,
} from '@/content/catalogs/magician';

export interface MonsterSkillDefinition {
  name: string;
  intent?: string;
  desc?: string;
  weight?: number;
  effects?: CardEffect[];
}

export interface MonsterDefinition {
  id?: string;
  name: string;
  level?: number;
  hp?: number;
  maxHp?: number;
  attack?: number;
  defense?: number;
  speed?: number;
  description?: string;
  difficulty?: string;
  mechanics?: string;
  source_attacks?: string;
  regions?: string[];
  xp?: number;
  gold?: number | number[];
  tags?: string[];
  loot?: Array<{
    id?: string;
    name?: string;
    chance?: number;
  }>;
  level_range?: number[];
  patterns?: string[];
  skills?: Record<string, MonsterSkillDefinition>;
  battle_start_buffs?: Array<{
    buff?: string;
    key?: string;
    value?: number;
    turns?: number;
    charges?: number;
    undispellable?: boolean;
  }>;
  battle_start_debuffs?: Array<{
    debuff?: string;
    key?: string;
    value?: number;
    turns?: number;
    charges?: number;
    uncleanseable?: boolean;
  }>;
  [key: string]: unknown;
}

export interface BattleRules {
  initialDraw: number;
  baseDrawPerTurn: number;
  handLimit: number;
  playerAttackScale: number;
  playerDefenseScale: number;
  enemyAttackScale: number;
  enemyDefenseScale: number;
  speedDodgePerPoint: number;
  maxSpeedDodge: number;
  mpRegenBase?: number;
  mpRegenDivisor?: number;
}

export interface PassiveDefinition {
  id?: string;
  name: string;
  description: string;
  effect?: CardEffect;
}

let monsterCache: Record<string, MonsterDefinition> | undefined;
let rulesCache: BattleRules | undefined;
let passiveCache: Record<string, PassiveDefinition> | undefined;
const installedWorkshopPassiveIds = new Set<string>();

function normalizeMonsterSkills(
  value: unknown,
): Record<string, MonsterSkillDefinition> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const source = value as Record<string, unknown>;
  const normalized = Object.fromEntries(
    Object.entries(source).filter(
      ([key, skill]) =>
        key !== 'actions' &&
        Boolean(skill) &&
        typeof skill === 'object' &&
        !Array.isArray(skill),
    ),
  ) as Record<string, MonsterSkillDefinition>;
  const actions = Array.isArray(source.actions) ? source.actions : [];
  for (const [index, action] of actions.entries()) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) continue;
    normalized[`action_${index + 1}`] = action as MonsterSkillDefinition;
  }
  return normalized;
}

// These additions live beside the generated legacy catalog so content:verify can
// continue to guarantee that the imported source data itself was not rewritten.
const MONSTER_TEAM_SKILL_OVERLAYS: Record<
  string,
  Record<string, MonsterSkillDefinition>
> = {
  mon_goblin: {
    pack_rally: {
      name: '集群号令',
      intent: '支援',
      desc: '鼓舞所有仍在战斗的怪物。',
      weight: 0.72,
      effects: [
        {
          type: 'apply_buff',
          buff: 'strength',
          value: 1,
          turns: 2,
          target: 'all_enemies',
        },
      ],
    },
  },
  mon_goblin_archer: {
    covering_fire: {
      name: '交替掩护',
      intent: '支援',
      desc: '为怪物队伍提供掩护。',
      weight: 0.62,
      effects: [
        {
          type: 'shield',
          value: 3,
          defense_ratio: 0.2,
          target: 'all_enemies',
        },
      ],
    },
  },
  mon_water_sprite: {
    purifying_ripple: {
      name: '净澈涟漪',
      intent: '净化',
      desc: '净化所有怪物身上的减益。',
      weight: 0.78,
      effects: [{ type: 'cleanse', amount: 'all', target: 'all_enemies' }],
    },
  },
  mon_solar_guard: {
    shared_aegis: {
      name: '辉光战阵',
      intent: '支援',
      desc: '为所有怪物展开辉光护盾。',
      weight: 0.74,
      effects: [
        {
          type: 'shield',
          value: 5,
          defense_ratio: 0.25,
          target: 'all_enemies',
        },
      ],
    },
  },
  mon_false_priest: {
    false_absolution: {
      name: '伪典赦免',
      intent: '净化',
      desc: '为怪物队伍净化全部减益。',
      weight: 0.92,
      effects: [{ type: 'cleanse', amount: 'all', target: 'all_enemies' }],
    },
  },
  mon_murloc_tidecaller: {
    rising_tide: {
      name: '群潮共鸣',
      intent: '支援',
      desc: '潮水为所有怪物提供护盾与力量。',
      weight: 0.76,
      effects: [
        { type: 'shield', value: 4, target: 'all_enemies' },
        {
          type: 'apply_buff',
          buff: 'strength',
          value: 1,
          turns: 2,
          target: 'all_enemies',
        },
      ],
    },
  },
  mon_oldroot_treant: {
    root_network: {
      name: '根网庇护',
      intent: '支援',
      desc: '根系连接所有怪物并提供防护。',
      weight: 0.7,
      effects: [
        {
          type: 'apply_buff',
          buff: 'fortitude',
          value: 1,
          turns: 2,
          target: 'all_enemies',
        },
        {
          type: 'shield',
          value: 4,
          defense_ratio: 0.2,
          target: 'all_enemies',
        },
      ],
    },
  },
};

export function refreshWorkshopPassiveCatalog(): void {
  if (!passiveCache) return;
  for (const passiveId of installedWorkshopPassiveIds) {
    delete passiveCache[passiveId];
  }
  installedWorkshopPassiveIds.clear();
  for (const pack of readWorkshopPacks()) {
    for (const profession of pack.classes) {
      const passiveId = workshopPassiveId(profession.id);
      passiveCache[passiveId] = {
        id: passiveId,
        name: profession.talent.name || `${profession.name}天赋`,
        description: profession.talent.description,
        effect: {
          type: 'multi',
          effects: profession.talent.effects,
        },
      };
      installedWorkshopPassiveIds.add(passiveId);
    }
  }
}

export async function loadMonsterCatalog() {
  if (!monsterCache) {
    const module = await import(
      '@/content/generated/battle/monsters.json'
    );
    const generated = module.default as unknown as Record<
      string,
      MonsterDefinition
    >;
    monsterCache = Object.fromEntries(
      Object.entries(generated).map(([id, monster]) => {
        const skills = normalizeMonsterSkills(monster.skills);
        return [
          id,
          {
            ...monster,
            skills: {
              ...skills,
              ...(MONSTER_TEAM_SKILL_OVERLAYS[id] ?? {}),
            },
          },
        ];
      }),
    );
  }
  return monsterCache;
}

export async function loadBattleRules(): Promise<BattleRules> {
  if (!rulesCache) {
    const module = await import('@/content/generated/battle/rules.json');
    rulesCache = module.default as BattleRules;
  }
  return rulesCache;
}

export async function loadPassiveCatalog(): Promise<
  Record<string, PassiveDefinition>
> {
  if (!passiveCache) {
    const module = await import('@/content/generated/battle/passives.json');
    passiveCache = module.default as Record<string, PassiveDefinition>;
    passiveCache[MAGICIAN_PASSIVE_ID] = MAGICIAN_PASSIVE;
  }
  refreshWorkshopPassiveCatalog();
  return passiveCache;
}
