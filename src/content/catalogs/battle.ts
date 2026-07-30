import type { CardEffect } from '@/content/types';
import { readWorkshopPacks, workshopPassiveId } from '@/workshop';

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
    monsterCache = module.default as unknown as Record<
      string,
      MonsterDefinition
    >;
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
  }
  refreshWorkshopPassiveCatalog();
  return passiveCache;
}
